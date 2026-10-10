import { CONFIG as C } from './config.js';
import { loadAssets } from './assets.js';
import { createAudio } from './audio.js';
import { createGame } from './game.js';
import { createRenderer } from './renderer.js';
import { bindInput } from './input.js';
import { bindHud } from './hud.js';
import { bindScout } from './scout.js';
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
renderer.centerOnHabitat();

const scout = bindScout(document, game);

const hud = bindHud(document, game, {
  onMute: (muted) => audio.setMuted(muted),
  onBuildScout: () => { scout.openBuild(); },
  onRecall: () => { game.startRecall(); },
  onLandCrew: () => { game.landCrew(); },
});

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
    if (ev.type === 'patch-applied') scout.applyIncomingPatch(ev);
  }
}

function frame(now) {
  const raw = Math.min(0.05, (now - last) / 1000);
  last = now;
  pumpPan(raw);
  const dt = raw * game.state.speed;
  if (dt > 0) {
    game.update(dt);
    scout.pump(dt);
  }
  audio.setDigLoop(game.isDigging());
  handleEvents(game.flushEvents());
  renderer.draw();
  hud.sync();
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
      phase: u.order?.phase || null,
      status: u.status,
      label: game.unitLabel(u),
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
    },
    deepIce: { ...game.state.deepIce },
    deepIceTile: game.state.deepIce.unlocked
      ? {
          type: game.tileAt(game.state.deepIce.tx, game.state.deepIce.ty)?.type || null,
          remaining: game.tileAt(game.state.deepIce.tx, game.state.deepIce.ty)?.iceRemaining || 0,
        }
      : null,
    patchesLeft: game.patchesLeft(),
    canLandCrew: game.canLandCrew(),
    won: game.state.won,
    win: game.state.win ? { ...game.state.win } : null,
    scoutOpen: scout.isOpen(),
    scoutTick: scout.getSim()?.tick ?? 0,
    iceConfirmed: !!scout.getSim()?.iceConfirmed,
  };
}

function advance(seconds) {
  const step = 1 / 60;
  let left = seconds;
  while (left > 0) {
    const dt = Math.min(step, left);
    game.update(dt);
    scout.pump(dt);
    handleEvents(game.flushEvents());
    left -= dt;
  }
}

function clientPosForWorld(wx, wy) {
  const s = renderer.worldToScreen(wx, wy);
  const r = canvas.getBoundingClientRect();
  return { x: r.left + s.x, y: r.top + s.y };
}

window.__v08Test = {
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
  },
  setBattery: (id, v) => {
    const u = game.unitById(id);
    if (u) u.battery = v;
  },
  selectUnits: (ids, additive) => game.selectUnits(ids, additive),
  selectBuilding: (id) => game.selectBuilding(id),
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
  launchProgram: (sensors, rules) => scout.launchProgram(sensors, rules),
  tickScout: (n) => scout.tickScout(n),
  confirmOnOre: () => scout.confirmOnOre(),
  openOperate: () => scout.openOperate(),
  openBuild: () => scout.openBuild(),
  hideOverlay: () => scout.hideOverlay(),
  queuePatch: (slot, condition, action) => game.queuePatch(slot, condition, action),
  startRecall: () => game.startRecall(),
  landCrew: () => game.landCrew(),
  unlockDeepIce: () => game.unlockDeepIce(),
  syncHud: () => hud.sync(),
  config: C,
};
