import { CONFIG as C } from './config.js';
import { loadAssets } from './assets.js';
import { createAudio } from './audio.js';
import { createGame } from './game.js';
import { createRenderer } from './renderer.js';
import { bindInput } from './input.js';
import { bindHud } from './hud.js';
import { bindScout } from './scout.js';
import { bindTutorial } from './tutorial.js';
import {
  onHostedPatch,
  setHostedPatchInfo,
} from '../ui.js';

const canvas = document.getElementById('board');
const game = createGame();
const assets = await loadAssets();
const audio = createAudio(assets.sfx);
audio.bindGestures(document);
audio.setMuted(game.state.muted);

const renderer = createRenderer(canvas, assets, game);
renderer.resize();
renderer.centerOnHabitat();
requestAnimationFrame(() => {
  renderer.resize();
  if (!game.state.camera.userMoved) renderer.centerOnHabitat();
});
if (typeof ResizeObserver !== 'undefined') {
  const ro = new ResizeObserver(() => {
    renderer.resize();
    if (!game.state.camera.userMoved) renderer.centerOnHabitat();
  });
  ro.observe(canvas);
}

const scout = bindScout(document, game);
let tutorial = null;

const hud = bindHud(document, game, {
  onMute: (muted) => audio.setMuted(muted),
  onBuildScout: () => { scout.openBuild(); },
  onRecall: () => { game.startRecall(); },
  onLandCrew: () => { game.landCrew(); },
  onViewTrace: () => { scout.viewTrace(); },
  tutorialActive: () => tutorial?.active(),
  tileScreenPos: (tx, ty) => {
    const c = game.tileCenter(tx, ty);
    return renderer.worldToScreen(c.x, c.y);
  },
});

tutorial = bindTutorial(document, { game, scout, renderer, canvas, hud });

onHostedPatch((slot, condition, action) => game.queuePatch(slot, condition, action));
setHostedPatchInfo(() => ({
  left: game.patchesLeft(),
  pending: !!game.state.expedition.pendingPatch,
}));

const { pumpPan } = bindInput(canvas, game, renderer, {
  onExpedition: () => { scout.openOperate(); },
});

let last = performance.now();

function handleEvents(evs) {
  for (const ev of evs) {
    if (ev.type === 'select') audio.play(C.sfxSelect);
    if (ev.type === 'order') audio.play(C.sfxOrder);
    if (ev.type === 'build-complete') audio.play(C.sfxBuildComplete);
    if (ev.type === 'notify-ping') audio.play(C.sfxNotify);
    if (ev.type === 'deep-ice') renderer.focusTile(ev.tx, ev.ty);
    if (ev.type === 'patch-ready') {
      const ok = scout.applyIncomingPatch(ev);
      game.notePatchApplied(ok);
    }
    tutorial?.onEvent(ev);
  }
}

function frame(now) {
  const raw = Math.min(0.05, (now - last) / 1000);
  last = now;
  pumpPan(raw);
  renderer.tickCamPan(raw);
  const dt = raw * game.state.speed;
  if (dt > 0) {
    game.update(dt);
    renderer.recordTracks?.(dt);
  }
  const scoutDt = scout.isOpen() ? raw : dt;
  if (scoutDt > 0) scout.pump(scoutDt);
  audio.setDigLoop(game.isDigging());
  handleEvents(game.flushEvents());
  tutorial?.tick(raw);
  renderer.draw();
  hud.sync();
  tutorial?.sync();
  requestAnimationFrame(frame);
}

requestAnimationFrame(frame);

function serialize() {
  const tot = game.totals();
  return {
    time: game.state.time,
    speed: game.state.speed,
    isDay: game.isDay(),
    isNight: !game.isDay(),
    solarOutput: game.solarOutputPerSecond(),
    ice: tot.ice,
    regolith: tot.regolith,
    power: tot.power,
    iceCap: tot.iceCap,
    selectedIds: [...game.state.selectedIds],
    selectedBuildingId: game.state.selectedBuildingId,
    muted: game.state.muted,
    unitCount: game.state.units.length,
    units: game.state.units.map((u) => ({
      id: u.id,
      kind: u.kind,
      x: u.x,
      y: u.y,
      battery: u.battery,
      cargo: { ...u.cargo },
      order: u.order ? u.order.type : null,
      lastOrder: u.lastOrder ? u.lastOrder.type : null,
      resumeOrder: u.resumeOrder ? u.resumeOrder.type : null,
      destBuildingId: u.order?.destBuildingId || u.resumeOrder?.destBuildingId || null,
      phase: u.order?.phase || null,
      status: u.status,
      task: game.unitTask(u),
      label: game.unitLabel(u),
      blockedReason: u.blockedReason || null,
    })),
    buildings: game.state.buildings.map((b) => ({
      id: b.id,
      type: b.type,
      tx: b.tx,
      ty: b.ty,
      complete: b.complete,
      buildTime: b.buildTime,
      printing: b.printing,
      printTime: b.printTime,
      ice: b.ice,
      iceCap: b.iceCap,
      regolith: b.regolith,
    })),
    iceTile: {
      type: game.tileAt(C.shallowIceTileX, C.shallowIceTileY).type,
      remaining: game.tileAt(C.shallowIceTileX, C.shallowIceTileY).iceRemaining,
    },
    view: game.state.view,
    zoom: game.state.camera.zoom,
    camX: game.state.camera.x,
    camY: game.state.camera.y,
    toast: game.state.toast ? game.state.toast.text : null,
    digging: game.isDigging(),
    stats: { ...game.state.stats },
    tunnel: {
      tiles: game.state.tunnel.tiles.map((t) => ({
        tx: t.tx,
        ty: t.ty,
        progress: t.progress,
        done: t.done,
        started: t.started,
        kind: t.kind,
      })),
      packets: game.state.tunnel.packets.map((p) => ({ ...p })),
      ready: game.tunnelReady(),
    },
    expedition: {
      launched: game.state.expedition.launched,
      ended: game.state.expedition.ended,
      recalling: game.state.expedition.recalling,
      recallUsed: game.state.expedition.recallUsed,
      marker: { ...game.state.expedition.marker },
      pendingPatch: !!game.state.expedition.pendingPatch,
      patchDelay: game.state.expedition.pendingPatch?.remaining ?? 0,
      pendingPings: game.state.expedition.pendingPings.length,
      activePings: game.state.expedition.activePings.length,
      log: game.state.expedition.log.map((e) => e.text),
      logKinds: game.state.expedition.log.map((e) => e.kind || null),
      lastPingKind: game.state.expedition.log.reduce((k, e) => e.kind || k, null),
      scoutStatus: game.state.expedition.scoutStatus || null,
      resultLine: game.state.expedition.resultLine || null,
    },
    deepIce: { ...game.state.deepIce },
    deepIceTile: game.state.deepIce.unlocked
      ? {
          type: game.tileAt(game.state.deepIce.tx, game.state.deepIce.ty)?.type || null,
          remaining: game.tileAt(game.state.deepIce.tx, game.state.deepIce.ty)?.iceRemaining || 0,
        }
      : null,
    patchesLeft: game.patchesLeft(),
    patchesUsed: game.patchesUsed(),
    patchesLabel: game.patchesLabel(),
    stored: game.storedForGoal(),
    transit: game.transitIce(),
    goalBanner: game.goalBanner(),
    canBuildScout: game.canBuildScout(),
    canRecall: game.canRecall(),
    armedOrder: game.state.armedOrder,
    orderPrompt: game.state.orderPrompt || null,
    canLandCrew: game.canLandCrew(),
    iceHint: game.showIceHint(),
    iceHintText: game.iceHintText(),
    scoutHint: game.showScoutHint(),
    objectives: game.objectiveProgress(),
    hoverTip: game.state.hoverTile
      ? game.iceHoverText(game.state.hoverTile.tx, game.state.hoverTile.ty)
      : '',
    tutorialMode: tutorial?.getMode() || null,
    tutorialStep: tutorial?.getStep() || 0,
    won: game.state.won,
    win: game.state.win ? { ...game.state.win } : null,
    scoutOpen: scout.isOpen(),
    scoutTick: scout.getSim()?.tick ?? 0,
    iceConfirmed: !!scout.getSim()?.iceConfirmed,
    scoutOutcome: scout.getSim()?.outcome || null,
    toastKind: game.state.toast?.kind || null,
    scoutTraceOpen: !!(document.querySelector('#scout-trace') && !document.querySelector('#scout-trace').hidden),
    tunnelPayoff: game.tunnelPayoffText(),
    hubPayoff: game.hubPayoffText(),
  };
}

function advance(seconds, opts = {}) {
  const step = 1 / 60;
  const pumpScout = opts.scout !== false;
  let left = seconds;
  while (left > 0) {
    const dt = Math.min(step, left);
    game.update(dt);
    if (pumpScout) scout.pump(dt);
    handleEvents(game.flushEvents());
    left -= dt;
  }
}

function clientPosForWorld(wx, wy) {
  const s = renderer.worldToScreen(wx, wy);
  const r = canvas.getBoundingClientRect();
  return { x: r.left + s.x, y: r.top + s.y };
}

const debugHooks = {
  ready: true,
  getState: serialize,
  setSpeed: (s) => { game.state.speed = s; },
  advance,
  setTime: (t) => { game.state.time = t; },
  setResources: ({ ice, regolith, power } = {}) => {
    const h = game.habitat();
    if (ice != null) h.ice = ice;
    if (regolith != null) h.regolith = regolith;
    if (power != null) h.power = power;
    game.clampStores();
  },
  setBattery: (id, v) => {
    const u = game.unitById(id);
    if (u) u.battery = v;
  },
  selectUnits: (ids, additive) => game.selectUnits(ids, additive),
  selectBuilding: (id) => game.selectBuilding(id),
  issueContextual: (x, y) => game.issueContextual(x, y),
  armOrder: (kind) => { game.state.armedOrder = kind || null; },
  commandHaul: (tx, ty) => game.commandHaulTile(game.selectedUnits(), tx, ty),
  issueOrder: (order) => {
    const units = game.selectedUnits();
    if (!units.length) return false;
    const marker = order.x != null
      ? { x: order.x, y: order.y }
      : game.tileCenter(order.tx || order.sourceTx || 0, order.ty || order.sourceTy || 0);
    game.assignOrder(units, order, marker);
    return true;
  },
  placeBuilding: (type, tx, ty) => game.placeBuilding(type, tx, ty, true),
  startPrint: () => game.startPrint(),
  unitClientPos: (id) => {
    const u = game.unitById(id);
    return u ? clientPosForWorld(u.x, u.y) : null;
  },
  tileClientPos: (tx, ty) => {
    const c = game.tileCenter(tx, ty);
    return clientPosForWorld(c.x, c.y);
  },
  buildingClientPos: (id) => {
    const b = game.buildingById(id);
    if (!b) return null;
    return clientPosForWorld((b.tx + 1) * C.tileSize, (b.ty + 1) * C.tileSize);
  },
  setMuted: (m) => { game.state.muted = m; audio.setMuted(m); },
  startDigLine: (tx0, ty0, tx1, ty1) => game.startDigLine(tx0, ty0, tx1, ty1),
  startDigCorridor: () => game.startDigCorridor(),
  completeBuilding: (id) => game.completeBuilding(id),
  depositToBuilding: (id, amounts) => game.depositToBuilding(id, amounts),
  markTunnelDone: () => game.markTunnelDone(),
  setView: (view) => game.setView(view),
  toggleView: () => game.toggleView(),
  setUnitPos: (id, x, y) => {
    const u = game.unitById(id);
    if (u) { u.x = x; u.y = y; }
  },
  setFacing: (id, facing) => {
    const u = game.unitById(id);
    if (u) u.facing = facing;
  },
  launchProgram: (sensors, rules) => scout.launchProgram(sensors, rules),
  tickScout: (n) => scout.tickScout(n),
  confirmOnOre: () => scout.confirmOnOre(),
  pingOreCell: (cell) => scout.pingOreCell(cell),
  openOperate: () => scout.openOperate(),
  openTrace: () => scout.openTrace(),
  viewTrace: () => scout.viewTrace(),
  openBuild: () => scout.openBuild(),
  hideOverlay: () => scout.hideOverlay(),
  playTraceOnlyReturn: () => scout.playTraceOnlyReturn(),
  explainScoutResult: (sim) => scout.explainResult(sim),
  queuePatch: (slot, condition, action) => game.queuePatch(slot, condition, action),
  startRecall: () => game.startRecall(),
  notePatchApplied: (ok) => game.notePatchApplied(ok),
  landCrew: () => game.landCrew(),
  createDetachedGame: async () => {
    const mod = await import('./game.js');
    return mod.createGame();
  },
  unlockDeepIce: () => game.unlockDeepIce(),
  syncHud: () => hud.sync(),
  focusTile: (tx, ty) => renderer.focusTile(tx, ty),
  tileScreenPos: (tx, ty) => {
    const c = game.tileCenter(tx, ty);
    return renderer.worldToScreen(c.x, c.y);
  },
  viewSize: () => renderer.viewSize(),
  hudSafeInsets: () => renderer.hudSafeInsets(),
  setZoom: (z) => {
    game.state.camera.zoom = z;
    renderer.centerOnHabitat();
    renderer.clampCamera();
  },
  centerOnTile: (tx, ty) => {
    renderer.focusTile(tx, ty);
  },
  config: C,
  tutorial: {
    start: () => tutorial.startTutorial(),
    play: () => tutorial.startPlay(),
    skip: () => tutorial.skip(),
    showMe: () => tutorial.showMe(),
    tryThis: () => tutorial.tryThis(),
    next: () => tutorial.clickNext(),
    step: () => tutorial.getStep(),
    mode: () => tutorial.getMode(),
    stepDone: (n) => tutorial.stepDone(n),
    jump: (n) => tutorial.jump(n),
  },
};

if (new URLSearchParams(location.search).has('debug')) {
  window.__v08Test = debugHooks;
}
