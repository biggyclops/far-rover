import { CONFIG as C } from './config.js';

export const TILE = {
  GROUND: 'ground',
  CRATER_S: 'crater-s',
  CRATER_M: 'crater-m',
  PIT: 'pit',
  ICE: 'ice',
  ICE_MINED: 'ice-mined',
};

export function tileVariant(tx, ty) {
  const n = Math.sin(tx * 127.1 + ty * 311.7 + 19.19) * 43758.5453;
  return (Math.floor(Math.abs(n - Math.floor(n)) * 4) % 4) + 1;
}

export function tileCenter(tx, ty) {
  return { x: (tx + 0.5) * C.tileSize, y: (ty + 0.5) * C.tileSize };
}

export function worldToTile(x, y) {
  return {
    tx: Math.max(0, Math.min(C.mapWidth - 1, Math.floor(x / C.tileSize))),
    ty: Math.max(0, Math.min(C.mapHeight - 1, Math.floor(y / C.tileSize))),
  };
}

function cargoAmount(unit) {
  return (unit.cargo.ice || 0) + (unit.cargo.regolith || 0);
}

function cloneOrder(order) {
  return order ? JSON.parse(JSON.stringify(order)) : null;
}

function buildingFootprint(type) {
  return type === 'vault' ? C.vaultFootprint : C.buildingFootprint;
}

function tilesOfBuilding(b) {
  const n = buildingFootprint(b.type);
  const out = [];
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) out.push({ tx: b.tx + x, ty: b.ty + y });
  }
  return out;
}

function chebyshevToBuilding(tx, ty, b) {
  const n = buildingFootprint(b.type);
  const dx = tx < b.tx ? b.tx - tx : tx > b.tx + n - 1 ? tx - (b.tx + n - 1) : 0;
  const dy = ty < b.ty ? b.ty - ty : ty > b.ty + n - 1 ? ty - (b.ty + n - 1) : 0;
  return Math.max(dx, dy);
}

function minChebyshevBetween(type, tx, ty, b) {
  const n = buildingFootprint(type);
  let best = Infinity;
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      best = Math.min(best, chebyshevToBuilding(tx + x, ty + y, b));
    }
  }
  return best;
}

function isPlainGround(tile) {
  return tile && tile.type === TILE.GROUND;
}

function isBlockedForBuild(tile) {
  return !tile || tile.type !== TILE.GROUND || tile.buildingId || tile.craterM;
}

function emptyTunnel() {
  return { tiles: [], packets: [] };
}

export function createGame() {
  const state = {
    time: 0,
    speed: 1,
    nextId: 1,
    units: [],
    buildings: [],
    tiles: [],
    selectedIds: [],
    selectedBuildingId: null,
    orderMarker: null,
    boxSelect: null,
    buildGhost: null,
    haulPick: null,
    digPick: null,
    armedOrder: null,
    view: 'surface',
    toast: null,
    tunnel: emptyTunnel(),
    digging: false,
    camera: { x: 0, y: 0, zoom: C.defaultZoom },
    events: [],
    muted: false,
    stats: { notifies: 0, patches: 0, usedTunnel: false, usedHaulers: false },
    expedition: {
      launched: false,
      ended: false,
      marker: { tx: C.expeditionTileX, ty: C.expeditionTileY },
      recallUsed: false,
      recalling: false,
      scoutId: null,
      patchesThisSol: 0,
      patchSol: 1,
      pendingPatch: null,
      pendingPings: [],
      activePings: [],
      log: [],
      scoutStatus: null,
      resultLine: null,
      paper: null,
    },
    deepIce: { unlocked: false, tx: null, ty: null, foundAt: null },
    hoverTile: null,
    camPan: null,
    won: false,
    win: null,
    simAcc: 0,
  };

  function id() {
    return state.nextId++;
  }

  function emit(type, extra) {
    state.events.push({ type, ...(extra || {}) });
  }

  function flushEvents() {
    const ev = state.events;
    state.events = [];
    return ev;
  }

  function toast(text, ttl = C.warningToastSeconds, extra = {}) {
    state.toast = { text, ttl, kind: extra.kind || null };
    emit('warning', { text, kind: extra.kind || null });
  }

  function makeTiles() {
    state.tiles = [];
    for (let y = 0; y < C.mapHeight; y++) {
      const row = [];
      for (let x = 0; x < C.mapWidth; x++) {
        row.push({
          type: TILE.GROUND,
          variant: tileVariant(x, y),
          iceRemaining: 0,
          buildingId: null,
          craterM: false,
          craterMAnchor: false,
        });
      }
      state.tiles.push(row);
    }
  }

  function tileAt(tx, ty) {
    if (ty < 0 || tx < 0 || ty >= C.mapHeight || tx >= C.mapWidth) return null;
    return state.tiles[ty][tx];
  }

  function stampTerrain(tx, ty, type) {
    const t = tileAt(tx, ty);
    if (t) t.type = type;
  }

  function occupy(b) {
    for (const p of tilesOfBuilding(b)) {
      const t = tileAt(p.tx, p.ty);
      if (t) t.buildingId = b.id;
    }
  }

  function addBuilding(type, tx, ty, extras = {}) {
    const done = extras.complete !== false;
    const b = {
      id: id(),
      type,
      tx,
      ty,
      complete: done,
      buildTime: extras.buildTime || 0,
      buildNeeded: extras.buildNeeded || 0,
      ice: extras.ice || 0,
      regolith: extras.regolith || 0,
      power: extras.power || 0,
      iceCap: extras.iceCap || 0,
      regolithCap: extras.regolithCap || 0,
      powerCap: extras.powerCap || 0,
      printTime: 0,
      printNeeded: 0,
      printing: false,
      outboundIce: 0,
      outboundReg: 0,
    };
    state.buildings.push(b);
    occupy(b);
    return b;
  }

  function addHauler(x, y, rally = undefined) {
    const u = {
      id: id(),
      kind: 'hauler',
      x,
      y,
      facing: 0,
      battery: C.haulerBattery,
      cargo: { ice: 0, regolith: 0 },
      order: null,
      lastOrder: null,
      resumeOrder: null,
      status: 'idle',
      blockedReason: null,
    };
    if (rally !== undefined) {
      const order = rally || defaultHaulOrder();
      if (order) {
        u.order = resetOrder(order);
        u.lastOrder = cloneOrder(u.order);
        u.status = u.order.type;
      }
    }
    state.units.push(u);
    return u;
  }

  function addScout(x, y) {
    const u = {
      id: id(),
      kind: 'scout',
      x,
      y,
      facing: 0,
      battery: C.haulerBattery,
      cargo: { ice: 0, regolith: 0 },
      order: null,
      lastOrder: null,
      resumeOrder: null,
      status: 'idle',
      blockedReason: null,
    };
    state.units.push(u);
    return u;
  }

  function pickDeepIceTile() {
    const hx = C.habitatTileX + 1;
    const hy = C.habitatTileY + 1;
    const dx = C.expeditionTileX - hx;
    const dy = C.expeditionTileY - hy;
    const len = Math.hypot(dx, dy) || 1;
    const dist = C.deepIceTilesFromStartStorage || (C.commandRangeRadius + 8);
    const aimX = Math.round(hx + (dx / len) * dist);
    const aimY = Math.round(hy + (dy / len) * dist);
    const candidates = [];
    for (let r = 0; r < 6; r++) {
      for (let y = aimY - r; y <= aimY + r; y++) {
        for (let x = aimX - r; x <= aimX + r; x++) {
          const t = tileAt(x, y);
          if (t && isPlainGround(t) && !t.buildingId && !t.craterM) {
            candidates.push({ tx: x, ty: y });
          }
        }
      }
      if (candidates.length) break;
    }
    return candidates[0] || { tx: Math.max(0, Math.min(C.mapWidth - 1, aimX)), ty: Math.max(0, Math.min(C.mapHeight - 1, aimY)) };
  }

  function unlockDeepIce() {
    if (state.deepIce.unlocked) return state.deepIce;
    const at = pickDeepIceTile();
    const t = tileAt(at.tx, at.ty);
    if (t) {
      t.type = TILE.ICE;
      t.iceRemaining = C.deepIceAmount;
    }
    state.deepIce = { unlocked: true, tx: at.tx, ty: at.ty, foundAt: state.time };
    state.camPan = { tx: at.tx, ty: at.ty, t: 1.6 };
    toast('Deep Ice found! Send haulers to mine it.', 5);
    emit('deep-ice', { tx: at.tx, ty: at.ty });
    return state.deepIce;
  }

  function queueNotifyPing(entry) {
    const confirmed = !!entry.confirmed;
    const kind = entry.kind || (confirmed ? 'ice-confirm' : 'trace-ice');
    state.expedition.pendingPings.push({
      remaining: C.notifyLinkDelaySeconds,
      tx: entry.tx ?? state.expedition.marker.tx,
      ty: entry.ty ?? state.expedition.marker.ty,
      text: entry.kind === 'trace-ice' || (!confirmed && !entry.text)
        ? 'Trace ice only. Big deposits are farther out, past the craters.'
        : (entry.text || entry.label || 'Notify'),
      confirmed,
      kind,
      label: entry.label || null,
    });
  }

  function noteExpedition(text, extra = {}) {
    state.expedition.log.push({
      t: state.time,
      text,
      kind: extra.kind || null,
      label: extra.label || null,
    });
    if (state.expedition.log.length > 12) state.expedition.log.shift();
  }

  function markExpeditionLaunched(info = {}) {
    state.expedition.launched = true;
    state.expedition.ended = false;
    state.expedition.recallUsed = false;
    state.expedition.recalling = false;
    state.expedition.scoutStatus = 'running';
    state.expedition.resultLine = null;
    state.expedition.paper = { path: [], revealed: [], pings: [], tick: 0 };
    state.expedition.pendingPings = [];
    state.expedition.activePings = [];
    if (state.toast && (state.toast.kind === 'scout-result' || state.toast.kind === 'trace-ice' || state.toast.kind === 'ice-confirm')) {
      state.toast = null;
    }
    if (info.hasNotifyRule != null) state.expedition.hasNotifyRule = !!info.hasNotifyRule;
    noteExpedition('Scout launched');
  }

  function endExpedition(result = {}) {
    if (state.expedition.ended && !result.force) return state.expedition;
    state.expedition.ended = true;
    state.expedition.recalling = false;
    const line = result.line || result.text || 'Expedition ended';
    state.expedition.resultLine = line;
    state.expedition.scoutStatus = result.status || state.expedition.scoutStatus || 'returned';
    if (result.paper) state.expedition.paper = result.paper;
    noteExpedition(line, { kind: 'scout-result', label: state.expedition.scoutStatus });
    if (!result.silent) {
      toast(line, 8, { kind: 'scout-result', action: 'view-trace' });
    }
    emit('expedition-ended', { line, status: state.expedition.scoutStatus });
    return state.expedition;
  }

  function updateScoutPaper(paper) {
    state.expedition.paper = paper || state.expedition.paper;
    if (paper?.status && !state.expedition.ended) state.expedition.scoutStatus = paper.status;
  }

  function startRecall() {
    if (!state.expedition.launched || state.expedition.ended || state.expedition.recallUsed) return null;
    const liveScout = state.units.some((u) => u.kind === 'scout');
    if (liveScout) return null;
    state.expedition.recallUsed = true;
    state.expedition.recalling = false;
    endExpedition({ line: 'Recall: scout returning (no extra unit)', status: 'returned' });
    emit('recall');
    return { recalled: true };
  }

  function solOffset() {
    const day = C.daySecondsAt1x || 0;
    const left = C.startDaylightRemainingSec;
    if (left == null) return 0;
    return Math.max(0, day - left);
  }

  function currentSol() {
    return Math.floor((state.time + solOffset()) / C.solSecondsAt1x) + 1;
  }

  function patchesLeft() {
    const sol = currentSol();
    if (state.expedition.patchSol !== sol) {
      state.expedition.patchSol = sol;
      state.expedition.patchesThisSol = 0;
    }
    return Math.max(0, C.patchesPerSol - state.expedition.patchesThisSol);
  }

  function queuePatch(slot, condition, action) {
    if (patchesLeft() <= 0) return false;
    if (!state.expedition.launched || state.expedition.ended) return false;
    if (state.expedition.pendingPatch) return false;
    state.expedition.pendingPatch = {
      remaining: C.patchDelaySeconds,
      slot,
      condition,
      action,
    };
    noteExpedition('Patch linking…');
    emit('patch-queued');
    return true;
  }

  function clampStores() {
    for (const b of state.buildings) {
      if (b.type === 'tunnel-hub') {
        b.ice = Math.max(0, b.ice || 0);
      } else if (b.iceCap > 0) b.ice = Math.max(0, Math.min(b.iceCap, b.ice));
      else b.ice = 0;
      if (b.regolithCap > 0) b.regolith = Math.max(0, Math.min(b.regolithCap, b.regolith));
      else b.regolith = 0;
      if (b.powerCap > 0) b.power = Math.max(0, Math.min(b.powerCap, b.power));
      else b.power = 0;
    }
  }

  function inCommandRange(tx, ty) {
    const h = habitat();
    if (!h) return false;
    const cx = h.tx + 1;
    const cy = h.ty + 1;
    return Math.hypot((tx + 0.5) - cx, (ty + 0.5) - cy) <= C.commandRangeRadius + 1e-6;
  }

  function buildingCenterTile(b, tx = b?.tx, ty = b?.ty, type = b?.type) {
    const n = buildingFootprint(type);
    return { tx: tx + Math.floor(n / 2), ty: ty + Math.floor(n / 2) };
  }

  function buildingInCommandRange(b) {
    if (!b) return false;
    const c = buildingCenterTile(b);
    return inCommandRange(c.tx, c.ty);
  }

  function placementInCommandRange(type, tx, ty) {
    const c = buildingCenterTile(null, tx, ty, type);
    return inCommandRange(c.tx, c.ty);
  }

  function hubBesideDeepIceAt(tx, ty) {
    if (!state.deepIce.unlocked) return false;
    return chebyshevToBuilding(state.deepIce.tx, state.deepIce.ty, {
      type: 'tunnel-hub',
      tx,
      ty,
    }) === 1;
  }

  function hubBesideDeepIce(hub) {
    return !!(hub && hubBesideDeepIceAt(hub.tx, hub.ty));
  }

  function hubSeparationOk(tx, ty) {
    const min = C.tunnelHubMinSeparationTiles || 0;
    if (!min) return true;
    return hubs().every((h) => minChebyshevBetween('tunnel-hub', tx, ty, h) >= min);
  }

  function isValidDropTarget(b) {
    if (!b || !b.complete) return false;
    if (isTransitDrop(b)) return buildingInCommandRange(b) || hubBesideDeepIce(b);
    if (!isDropBuilding(b)) return false;
    return buildingInCommandRange(b);
  }

  function storedForGoal() {
    let ice = 0, power = 0, iceCap = 0, powerCap = 0;
    for (const b of state.buildings) {
      if (!b.complete) continue;
      if ((b.type === 'habitat' || b.type === 'storage' || b.type === 'vault') && buildingInCommandRange(b)) {
        ice += b.ice;
        iceCap += b.iceCap;
      }
      if (b.powerCap > 0) {
        power += b.power;
        powerCap += b.powerCap;
      }
    }
    return { ice, power, iceCap, powerCap };
  }

  function transitIce() {
    let ice = 0;
    let cap = 0;
    for (const b of state.buildings) {
      if (!b.complete) continue;
      if (b.type === 'tunnel-hub') {
        ice += b.ice;
        cap += b.iceCap;
      }
    }
    const pkt = packetTotals();
    ice += pkt.ice;
    return { ice, cap };
  }

  function canLandCrew() {
    if (state.won) return false;
    const tot = storedForGoal();
    return tot.ice + 1e-6 >= C.goalIceInStorage && tot.power + 1e-6 >= C.goalPowerInStorage;
  }

  function updateExpedition(dt) {
    if (state.expedition.patchSol !== currentSol()) {
      state.expedition.patchSol = currentSol();
      state.expedition.patchesThisSol = 0;
    }
    if (state.expedition.pendingPatch) {
      state.expedition.pendingPatch.remaining -= dt;
      if (state.expedition.pendingPatch.remaining <= 0) {
        const p = state.expedition.pendingPatch;
        state.expedition.pendingPatch = null;
        emit('patch-ready', { slot: p.slot, condition: p.condition, action: p.action });
      }
    }
    const stillPending = [];
    for (const ping of state.expedition.pendingPings) {
      ping.remaining -= dt;
      if (ping.remaining <= 0) {
        state.expedition.activePings.push({ ...ping, age: 0 });
        state.stats.notifies += 1;
        noteExpedition(ping.text, { kind: ping.kind, label: ping.label });
        toast(ping.text, C.warningToastSeconds, { kind: ping.kind });
        emit('notify-ping', ping);
        if (ping.confirmed) unlockDeepIce();
      } else stillPending.push(ping);
    }
    state.expedition.pendingPings = stillPending;
    state.expedition.activePings = state.expedition.activePings.filter((p) => {
      p.age += dt;
      return p.age < 1.2;
    });
    if (state.expedition.recalling && state.expedition.scoutId) {
      const scout = unitById(state.expedition.scoutId);
      const hab = habitat();
      if (scout && hab) {
        const dest = tileCenter(hab.tx + 1, hab.ty + 1);
        if (Math.hypot(scout.x - dest.x, scout.y - dest.y) < C.tileSize * 0.65) {
          scout.order = null;
          scout.lastOrder = null;
          endExpedition();
        }
      }
    }
  }

  function landCrew() {
    if (!canLandCrew()) return null;
    clampStores();
    const tot = storedForGoal();
    state.won = true;
    state.win = {
      time: state.time,
      logistics: (state.stats.goalIceByTunnel || 0) > (state.stats.goalIceByHauler || 0)
        ? 'tunnel'
        : 'haulers only',
      notifies: state.stats.notifies,
      patches: state.stats.patches,
      patchesLeft: patchesLeft(),
      patchesLabel: patchesLabel(),
      ice: tot.ice,
      power: tot.power,
      iceCap: tot.iceCap,
      powerCap: tot.powerCap,
    };
    state.speed = 0;
    emit('win');
    return state.win;
  }

  function packetTotals() {
    let ice = 0, regolith = 0;
    for (const p of state.tunnel.packets) {
      ice += p.ice;
      regolith += p.regolith;
    }
    return { ice, regolith };
  }

  function totals() {
    let ice = 0, regolith = 0, power = 0;
    let iceCap = 0, regolithCap = 0, powerCap = 0;
    for (const b of state.buildings) {
      if (!b.complete) continue;
      ice += b.ice;
      regolith += b.regolith;
      power += b.power;
      iceCap += b.iceCap;
      regolithCap += b.regolithCap;
      powerCap += b.powerCap;
    }
    const pkt = packetTotals();
    ice += pkt.ice;
    regolith += pkt.regolith;
    return { ice, regolith, power, iceCap, regolithCap, powerCap };
  }

  function spendRegolith(amount) {
    let left = amount;
    for (const b of state.buildings) {
      if (!b.complete || b.regolith <= 0) continue;
      const take = Math.min(b.regolith, left);
      b.regolith -= take;
      left -= take;
      if (left <= 0) return true;
    }
    return left <= 0;
  }

  function spendPower(amount) {
    let left = amount;
    for (const b of state.buildings) {
      if (!b.complete || b.power <= 0) continue;
      const take = Math.min(b.power, left);
      b.power -= take;
      left -= take;
      if (left <= 0) return true;
    }
    return left <= 0;
  }

  function addPower(amount) {
    let left = amount;
    for (const b of state.buildings) {
      if (!b.complete || b.powerCap <= 0) continue;
      const room = b.powerCap - b.power;
      const add = Math.min(room, left);
      b.power += add;
      left -= add;
      if (left <= 0) return;
    }
  }

  function addRegolith(amount) {
    let left = amount;
    for (const b of state.buildings) {
      if (!b.complete || b.regolithCap <= 0) continue;
      const room = b.regolithCap - b.regolith;
      const add = Math.min(room, left);
      b.regolith += add;
      left -= add;
      if (left <= 0) return left;
    }
    return left;
  }

  function deposit(unit, dest) {
    const iceRoom = dest.type === 'tunnel-hub'
      ? iceRoomAtHub(dest)
      : Math.max(0, dest.iceCap - dest.ice);
    const regRoom = Math.max(0, dest.regolithCap - dest.regolith);
    const ice = Math.min(unit.cargo.ice, iceRoom);
    const reg = Math.min(unit.cargo.regolith, regRoom);
    dest.ice += ice;
    dest.regolith += reg;
    unit.cargo.ice -= ice;
    unit.cargo.regolith -= reg;
    if (dest.type === 'tunnel-hub') fillVaultsFrom(dest);
    if (ice > 0 && (dest.type === 'habitat' || dest.type === 'storage' || dest.type === 'vault') && buildingInCommandRange(dest)) {
      state.stats.goalIceByHauler = (state.stats.goalIceByHauler || 0) + ice;
    }
    return { ice, regolith: reg, total: ice + reg };
  }

  function hubs() {
    return state.buildings.filter((b) => b.type === 'tunnel-hub');
  }

  function completeHubs() {
    return hubs().filter((b) => b.complete);
  }

  function vaultsBeside(hub) {
    return state.buildings.filter((b) => (
      b.type === 'vault' && b.complete && minChebyshevBetween('vault', b.tx, b.ty, hub) === 1
    ));
  }

  function hubBesideVault(type, tx, ty) {
    return hubs().some((h) => minChebyshevBetween(type, tx, ty, h) === 1);
  }

  function canPlace(type, tx, ty) {
    const n = buildingFootprint(type);
    if (tx < 0 || ty < 0 || tx + n > C.mapWidth || ty + n > C.mapHeight) return false;
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        if (isBlockedForBuild(tileAt(tx + x, ty + y))) return false;
      }
    }
    if (type === 'tunnel-hub' && hubs().length >= C.tunnelHubCount) return false;
    if (type === 'tunnel-hub' && !hubSeparationOk(tx, ty)) return false;
    if (type === 'vault' && !hubBesideVault(type, tx, ty)) return false;
    const inRange = placementInCommandRange(type, tx, ty);
    if (!inRange) {
      if (type === 'tunnel-hub' && hubBesideDeepIceAt(tx, ty)) return true;
      return false;
    }
    return true;
  }

  function solTime() {
    const cycle = C.solSecondsAt1x;
    const t = (((state.time + solOffset()) % cycle) + cycle) % cycle;
    return t;
  }

  function isDay() {
    return solTime() < C.daySecondsAt1x;
  }

  function powerDrawPerSecond() {
    return (C.haulerUpkeepPowerPerSec || 0)
      * state.units.filter((u) => u.kind === 'hauler').length;
  }

  function secondsUntilDawn() {
    if (isDay()) return (C.daySecondsAt1x - solTime()) + (C.nightSecondsAt1x || 0);
    return C.solSecondsAt1x - solTime();
  }

  function powerDeficit() {
    const stored = totals().power;
    if (stored <= 1e-6) return true;
    const net = solarOutputPerSecond() - powerDrawPerSecond();
    if (net >= -1e-9) return false;
    const timeToZero = stored / -net;
    return timeToZero <= secondsUntilDawn() + 1e-6;
  }

  function solarOutputPerSecond() {
    if (!isDay()) return 0;
    let n = 0;
    for (const b of state.buildings) {
      if (b.type === 'solar' && b.complete) n += C.rimSolarPowerPerSecondDay;
    }
    return n;
  }

  function habitat() {
    return state.buildings.find((b) => b.type === 'habitat');
  }

  function buildingById(bid) {
    return state.buildings.find((b) => b.id === bid) || null;
  }

  function unitById(uid) {
    return state.units.find((u) => u.id === uid) || null;
  }

  function selectedUnits() {
    return state.units.filter((u) => state.selectedIds.includes(u.id));
  }

  function isDropBuilding(b) {
    return !!(b && b.complete && (b.type === 'habitat' || b.type === 'storage' || b.type === 'vault'));
  }

  function isTransitDrop(b) {
    return !!(b && b.complete && b.type === 'tunnel-hub');
  }

  function inNoMineZone(tx, ty) {
    const r = C.noRegolithMineRadiusTiles;
    if (r == null) return false;
    for (const b of state.buildings) {
      if (chebyshevToBuilding(tx, ty, b) <= r) return true;
    }
    return false;
  }

  function sourceHasWork(tx, ty) {
    const t = tileAt(tx, ty);
    if (!t) return false;
    if (t.type === TILE.ICE) return (t.iceRemaining || 0) > 0;
    if (t.type === TILE.ICE_MINED || t.type === TILE.CRATER_S || t.type === TILE.PIT) return false;
    if (t.craterM || t.buildingId) return false;
    if (!isPlainGround(t)) return false;
    if (inNoMineZone(tx, ty)) return false;
    return true;
  }

  function nearestIceTile(tx, ty, radius = 1) {
    let best = null;
    let bestD = Infinity;
    for (let y = ty - radius; y <= ty + radius; y++) {
      for (let x = tx - radius; x <= tx + radius; x++) {
        const t = tileAt(x, y);
        if (!t || t.type !== TILE.ICE || (t.iceRemaining || 0) <= 0) continue;
        const d = Math.max(Math.abs(x - tx), Math.abs(y - ty)) + (y > ty ? -0.15 : 0);
        if (d < bestD) {
          best = { tx: x, ty: y };
          bestD = d;
        }
      }
    }
    return best;
  }

  function preferOrderTile(tx, ty) {
    const ice = nearestIceTile(tx, ty, 1);
    return ice || { tx, ty };
  }

  function buildingAtWorld(x, y) {
    const { tx, ty } = worldToTile(x, y);
    const direct = buildingAtTile(tx, ty);
    if (direct) return direct;
    let best = null;
    let bestD = Infinity;
    const pad = C.tileSize * 0.55;
    for (const b of state.buildings) {
      const n = buildingFootprint(b.type);
      const x0 = b.tx * C.tileSize - pad - C.tileSize * 0.25;
      const y0 = b.ty * C.tileSize - pad - C.tileSize * 0.25;
      const x1 = (b.tx + n) * C.tileSize + pad;
      const y1 = (b.ty + n) * C.tileSize + pad;
      if (x < x0 || y < y0 || x > x1 || y > y1) continue;
      const cx = (b.tx + n / 2) * C.tileSize;
      const cy = (b.ty + n / 2) * C.tileSize;
      const d = Math.hypot(x - cx, y - cy);
      if (d < bestD) {
        best = b;
        bestD = d;
      }
    }
    return best;
  }

  function unitsNear(x, y, radius = C.unitClickRadius) {
    return state.units
      .filter((u) => Math.hypot(u.x - x, u.y - y) < radius)
      .sort((a, b) => a.id - b.id);
  }

  function cycleSelectAt(x, y, additive = false) {
    const stack = unitsNear(x, y);
    if (!stack.length) return null;
    if (additive) {
      selectUnits([stack[0].id], true);
      return stack[0];
    }
    const cur = state.selectedIds[0];
    const idx = stack.findIndex((u) => u.id === cur);
    const next = idx >= 0 ? stack[(idx + 1) % stack.length] : stack[0];
    selectUnits([next.id]);
    return next;
  }

  function nearestHauler(x, y) {
    let best = null;
    let bestD = Infinity;
    for (const u of state.units) {
      if (u.kind !== 'hauler') continue;
      const d = Math.hypot(u.x - x, u.y - y);
      if (d < bestD) {
        best = u;
        bestD = d;
      }
    }
    return best;
  }

  function ensureHaulers(x, y) {
    let units = selectedUnits().filter((u) => u.kind === 'hauler');
    if (units.length) return units;
    const near = nearestHauler(x, y);
    if (!near) return [];
    selectUnits([near.id]);
    return [near];
  }

  function defaultHaulOrder() {
    let ice = null;
    const shallow = tileAt(C.shallowIceTileX, C.shallowIceTileY);
    if (shallow && shallow.type === TILE.ICE && (shallow.iceRemaining || 0) > 0) {
      ice = { tx: C.shallowIceTileX, ty: C.shallowIceTileY };
    } else if (state.deepIce.unlocked) {
      const t = tileAt(state.deepIce.tx, state.deepIce.ty);
      if (t && t.type === TILE.ICE && (t.iceRemaining || 0) > 0) {
        ice = { tx: state.deepIce.tx, ty: state.deepIce.ty };
      }
    }
    if (!ice) {
      outer: for (let y = 0; y < C.mapHeight; y++) {
        for (let x = 0; x < C.mapWidth; x++) {
          const t = tileAt(x, y);
          if (t && t.type === TILE.ICE && (t.iceRemaining || 0) > 0) {
            ice = { tx: x, ty: y };
            break outer;
          }
        }
      }
    }
    if (!ice) return null;
    const dest = nearestDrop(ice.tx, ice.ty, { cargo: { ice: 1, regolith: 0 } }, 'ice');
    if (!dest) return null;
    return {
      type: 'haul',
      sourceTx: ice.tx,
      sourceTy: ice.ty,
      destBuildingId: dest.id,
      phase: 'toSource',
    };
  }

  function rememberRally(order) {
    if (!order || (order.type !== 'haul' && order.type !== 'mine')) return;
    for (const b of state.buildings) {
      if (b.type === 'printer') b.rallyOrder = cloneOrder(order);
    }
  }

  function clearArmed() {
    state.armedOrder = null;
    state.haulPick = null;
    state.digPick = null;
    state.orderPrompt = null;
  }

  function buildCost(type) {
    const costs = {
      solar: { reg: C.rimSolarCostRegolith, power: 0, time: C.rimSolarBuildSeconds },
      storage: { reg: C.storageCostRegolith, power: 0, time: C.storageBuildSeconds },
      printer: { reg: C.printerCostRegolith, power: 0, time: C.printerBuildSeconds },
      'tunnel-hub': { reg: C.tunnelHubCostRegolith, power: 0, time: C.tunnelHubBuildSeconds },
      vault: { reg: C.vaultCostRegolith, power: 0, time: C.vaultBuildSeconds },
      hauler: { reg: nextPrintCostRegolith(), power: C.printerHaulerCostPower, time: C.printerHaulerSeconds },
    };
    return costs[type] || null;
  }

  function affordReason(type) {
    const spec = buildCost(type);
    if (!spec) return 'Unknown';
    const tot = totals();
    if (tot.regolith + 1e-6 < spec.reg) return `Need ${spec.reg} regolith`;
    if (spec.power > 0 && tot.power + 1e-6 < spec.power) return `Need ${spec.power} power`;
    if (type === 'hauler' && !state.buildings.some((b) => b.type === 'printer' && b.complete && !b.printing)) {
      return 'Need an idle printer';
    }
    if (type === 'tunnel-hub' && hubs().length >= C.tunnelHubCount) return 'Hub limit reached';
    return null;
  }

  function canBuildScout() {
    if (state.won) return false;
    if (!state.expedition.launched) return true;
    if (!state.expedition.ended) return false;
    return !state.deepIce.unlocked;
  }

  function canRecall() {
    return !!state.expedition.launched && !state.expedition.ended && !state.expedition.recallUsed;
  }

  function patchesUsed() {
    return state.stats.patches || 0;
  }

  function patchesLabel() {
    return `Patches used: ${patchesUsed()} · left: ${patchesLeft()}`;
  }

  function goalBanner() {
    const steps = objectiveProgress();
    const stored = storedForGoal();
    const ice = Math.floor(stored.ice + 1e-6);
    const power = Math.floor(stored.power + 1e-6);
    if (state.won) return 'Crew landed';
    if (state.deepIce.unlocked && !steps.haulDeep) {
      return `Haul Deep Ice home: ${ice} / ${C.goalIceInStorage}`;
    }
    if (!steps.mineShallow) return 'Select haulers, then right-click the ice to start a delivery loop';
    if (!state.deepIce.unlocked) return 'Scout: confirm a DEEP ice deposit (far side of the site)';
    if (!steps.haulDeep) return `Haul Deep Ice home: ${ice} / ${C.goalIceInStorage}`;
    if (!steps.landCrew) {
      return `Land crew: ${ice} / ${C.goalIceInStorage} ice · ${power} / ${C.goalPowerInStorage} power`;
    }
    return 'Land crew';
  }

  function unitTask(unit) {
    if (unit.blockedReason) return unit.blockedReason;
    if (!unit.order) {
      if (unit.resumeOrder?.type === 'haul') return 'hauling';
      if (unit.lastOrder?.type === 'haul' && canRepeat(unit.lastOrder)) return 'hauling';
      return 'idle';
    }
    if (unit.order.type === 'haul') {
      if (unit.order.phase === 'mine') return 'mining';
      if (unit.order.phase === 'toDest' || unit.order.phase === 'unload') return 'delivering';
      return 'hauling';
    }
    return unit.order.type;
  }

  function unitCard(unit) {
    if (!unit) return null;
    return {
      kind: unit.kind === 'scout' ? 'Scout' : 'Hauler',
      battery: unit.battery,
      cargo: cargoAmount(unit),
      carry: C.haulerCarry,
      task: unitTask(unit),
    };
  }

  function buildingRoom(b, kind) {
    if (!b) return 0;
    if (kind === 'ice') {
      if (b.type === 'tunnel-hub') return iceRoomAtHub(b);
      return Math.max(0, (b.iceCap || 0) - (b.ice || 0));
    }
    return Math.max(0, (b.regolithCap || 0) - (b.regolith || 0));
  }

  function dropRoom(kind) {
    let room = 0;
    for (const b of state.buildings) {
      if (!isValidDropTarget(b)) continue;
      room += buildingRoom(b, kind);
    }
    return room;
  }

  function nearestDrop(tx, ty, unit, preferKind) {
    const needIce = !!(unit && unit.cargo.ice > 0.001) || preferKind === 'ice';
    const needReg = !!(unit && unit.cargo.regolith > 0.001) || preferKind === 'regolith';
    const wantIce = needIce || (!needIce && !needReg);
    let best = null;
    let bestD = Infinity;
    for (const b of state.buildings) {
      if (!isValidDropTarget(b)) continue;
      const iceOk = buildingRoom(b, 'ice') > 1e-6;
      const regOk = buildingRoom(b, 'regolith') > 1e-6;
      if (needIce && !needReg && !iceOk) continue;
      if (needReg && !needIce && !regOk) continue;
      if (needIce && needReg && !iceOk && !regOk) continue;
      if (!needIce && !needReg && wantIce && !iceOk) continue;
      const d = chebyshevToBuilding(tx, ty, b);
      if (d < bestD) {
        best = b;
        bestD = d;
      }
    }
    return best;
  }

  function storageBlockedReason(unit) {
    const iceNeed = unit.cargo.ice > 0.001;
    const regNeed = unit.cargo.regolith > 0.001;
    const ice = dropRoom('ice');
    const reg = dropRoom('regolith');
    if (iceNeed && ice <= 1e-6 && !regNeed) return 'Ice storage full: build Storage or a Vault.';
    if (regNeed && reg <= 1e-6 && !iceNeed) return 'Storage full';
    if ((iceNeed || regNeed) && ice <= 1e-6 && reg <= 1e-6) return 'Ice storage full: build Storage or a Vault.';
    return null;
  }

  function rejectOrder(reason) {
    toast(reason);
    emit('order-reject', { reason });
    return false;
  }

  function lowBattery(unit) {
    return unit.battery <= C.haulerBattery * 0.2 + 1e-6;
  }

  function tilesBetween(x0, y0, x1, y1) {
    return Math.hypot(x1 - x0, y1 - y0) / C.tileSize;
  }

  function tripCost(unit, x, y, loaded) {
    const drain = loaded ? C.haulerDrainPerTileLoaded : C.haulerDrainPerTileEmpty;
    return tilesBetween(unit.x, unit.y, x, y) * drain;
  }

  function upcomingWaypoint(unit) {
    const order = unit.order;
    if (!order) return null;
    if (order.type === 'mine') return tileCenter(order.tx, order.ty);
    if (order.type === 'go') return { x: order.x, y: order.y };
    if (order.type === 'haul') {
      if (order.phase === 'toDest' || order.phase === 'unload') {
        const dest = buildingById(order.destBuildingId) || nearestDrop(order.sourceTx, order.sourceTy, unit);
        return dest ? chargeSpot(dest) : null;
      }
      return tileCenter(order.sourceTx, order.sourceTy);
    }
    if (order.type === 'charge') {
      const b = buildingById(order.buildingId) || habitat();
      return b ? chargeSpot(b) : null;
    }
    return null;
  }

  function shouldChargeNow(unit) {
    if (unit.kind !== 'hauler') return false;
    if (!unit.order || unit.order.type === 'charge') return false;
    if (unit.battery <= 0) return false;
    if (lowBattery(unit)) return true;
    const dest = upcomingWaypoint(unit);
    const home = habitat();
    if (!dest || !home) return false;
    const loaded = cargoAmount(unit) > 0.001;
    const homeSpot = chargeSpot(home);
    const toDest = tripCost(unit, dest.x, dest.y, loaded);
    const homeLoaded = unit.order.type === 'haul' && (unit.order.phase === 'toDest' || unit.order.phase === 'unload');
    const toHome = tilesBetween(dest.x, dest.y, homeSpot.x, homeSpot.y)
      * (homeLoaded ? C.haulerDrainPerTileLoaded : C.haulerDrainPerTileEmpty);
    return unit.battery < toDest + toHome + 1;
  }

  function insertCharge(unit) {
    if (unit.kind !== 'hauler') return;
    if (unit.order?.type === 'charge') return;
    if (unit.order) unit.resumeOrder = cloneOrder(unit.order);
    else if (unit.lastOrder) unit.resumeOrder = cloneOrder(unit.lastOrder);
    const dest = habitat();
    if (!dest) return;
    unit.order = { type: 'charge', buildingId: dest.id };
    unit.blockedReason = null;
    unit._strandWarned = false;
    unit.status = 'charge';
  }

  function noteStrand(unit) {
    unit.blockedReason = 'Hauler stranded';
    if (!unit._strandWarned) {
      toast('Hauler stranded');
      unit._strandWarned = true;
    }
  }

  function canChargeAt(unit, b) {
    if (!b || !b.complete) return false;
    const { tx, ty } = worldToTile(unit.x, unit.y);
    const d = chebyshevToBuilding(tx, ty, b);
    if (b.type === 'habitat') return d <= 1;
    if (b.type === 'solar') return d === 1 || d === 0;
    return false;
  }

  function chargeSpot(b) {
    const n = buildingFootprint(b.type);
    return tileCenter(b.tx + n / 2 - 0.5, b.ty + n);
  }

  function powerStarved() {
    return (C.haulerUpkeepPowerPerSec || 0) > 0 && totals().power <= 1e-6;
  }

  function moveToward(unit, wx, wy, dt) {
    const dx = wx - unit.x;
    const dy = wy - unit.y;
    const dist = Math.hypot(dx, dy);
    const crawl = unit.kind === 'hauler' && unit.battery <= 0;
    let speed = crawl
      ? (C.strandedCrawlTilesPerSecond || 0.25)
      : C.haulerSpeedTilesPerSecond;
    if (!crawl && unit.kind === 'hauler') {
      const at = worldToTile(unit.x, unit.y);
      if (!inCommandRange(at.tx, at.ty)) {
        const mult = C.haulerOffRoadSpeedMult;
        if (Number.isFinite(mult) && mult > 0) speed *= mult;
      }
    }
    const step = C.tileSize * speed * dt;
    const loaded = cargoAmount(unit) > 0.001;
    const drain = loaded ? C.haulerDrainPerTileLoaded : C.haulerDrainPerTileEmpty;
    if (crawl) noteStrand(unit);
    if (dist < 0.5) return { status: 'arrived', used: 0 };
    const travel = Math.min(step, dist);
    if (dist > 0.001) unit.facing = Math.atan2(dx, -dy);
    const tiles = travel / C.tileSize;
    if (!crawl) unit.battery = Math.max(0, unit.battery - tiles * drain);
    const k = travel / dist;
    unit.x += dx * k;
    unit.y += dy * k;
    const used = step <= 0 ? dt : dt * (travel / step);
    return { status: travel >= dist - 0.01 ? 'arrived' : 'moving', used };
  }

  function closeToTile(unit, tx, ty) {
    const c = tileCenter(tx, ty);
    return Math.hypot(unit.x - c.x, unit.y - c.y) < C.tileSize * 0.4;
  }

  function currentDigTile() {
    return state.tunnel.tiles.find((t) => !t.done) || null;
  }

  function canRepeat(order) {
    if (!order) return false;
    if (order.type === 'mine') return sourceHasWork(order.tx, order.ty);
    if (order.type === 'haul') return sourceHasWork(order.sourceTx, order.sourceTy);
    if (order.type === 'build') {
      const b = buildingById(order.buildingId);
      return b && !b.complete;
    }
    if (order.type === 'dig') return !!currentDigTile();
    return true;
  }

  function resetOrder(order) {
    const o = cloneOrder(order);
    if (o && o.type === 'haul') o.phase = 'toSource';
    return o;
  }

  function finishOrder(unit) {
    const resume = unit.resumeOrder;
    const last = unit.lastOrder;
    unit.order = null;
    if (resume && canRepeat(resume)) {
      unit.order = resetOrder(resume);
      if (resume.type !== 'charge') unit.lastOrder = cloneOrder(resume);
      unit.resumeOrder = null;
      return;
    }
    unit.resumeOrder = null;
    if (last && canRepeat(last)) unit.order = resetOrder(last);
  }

  function setOrderMarker(x, y) {
    state.orderMarker = { x, y, t: 0 };
  }

  function assignOrder(units, order, marker) {
    for (const u of units) {
      const priorHaul = (u.order?.type === 'haul' && cloneOrder(u.order))
        || (u.lastOrder?.type === 'haul' && cloneOrder(u.lastOrder))
        || (u.resumeOrder?.type === 'haul' && cloneOrder(u.resumeOrder));
      u._emptyAfterDrop = false;
      u.order = resetOrder(order);
      if (order.type === 'build' && priorHaul) {
        u.lastOrder = resetOrder(priorHaul);
      } else {
        u.lastOrder = cloneOrder(u.order);
      }
      u.resumeOrder = order.type === 'build' && priorHaul ? resetOrder(priorHaul) : null;
      u.blockedReason = null;
      u._strandWarned = false;
      u.status = order.type;
    }
    rememberRally(order);
    if (marker) setOrderMarker(marker.x, marker.y);
    emit('order');
  }

  function commandHaulIce(units, tx, ty) {
    return commandHaulTile(units, tx, ty);
  }

  function commandHaulTile(units, tx, ty) {
    const haulers = units.filter((u) => u.kind === 'hauler');
    if (!haulers.length) return rejectOrder('Not reachable');
    const tile = tileAt(tx, ty);
    const ice = tile && tile.type === TILE.ICE && (tile.iceRemaining || 0) > 0;
    if (!ice && !sourceHasWork(tx, ty)) {
      if (tile && (tile.type === TILE.ICE_MINED || tile.type === TILE.CRATER_S || tile.type === TILE.PIT || tile.craterM)) {
        return rejectOrder('Source empty');
      }
      return rejectOrder('Not reachable');
    }
    const live = haulers;
    const sample = live.find((u) => cargoAmount(u) > 0.001) || live[0];
    const prefer = ice ? 'ice' : 'regolith';
    const dest = nearestDrop(tx, ty, sample, prefer);
    if (!dest) return rejectOrder('No storage room');
    assignOrder(live, {
      type: 'haul',
      sourceTx: tx,
      sourceTy: ty,
      destBuildingId: dest.id,
      phase: 'toSource',
    }, tileCenter(tx, ty));
    for (const u of live) {
      if (cargoAmount(u) + 1e-6 >= C.haulerCarry) u.order.phase = 'toDest';
    }
    return true;
  }

  function commandDropOrCharge(units, b) {
    const haulers = units.filter((u) => u.kind === 'hauler');
    if (!haulers.length) return false;
    const live = haulers;
    const loaded = live.filter((u) => cargoAmount(u) > 0.001);
    const empty = live.filter((u) => cargoAmount(u) <= 0.001);
    if (loaded.length) {
      const kind = loaded[0].cargo.ice > 0.001 ? 'ice' : 'regolith';
      let dest = isValidDropTarget(b) ? b : null;
      if (!dest || (buildingRoom(dest, kind) <= 1e-6 && !hubPipelineHasRoom(dest))) {
        dest = nearestDrop(b.tx, b.ty, loaded[0], kind);
      }
      if (!dest) return rejectOrder('No storage room');
      for (const u of loaded) {
        const src = u.lastOrder?.sourceTx != null
          ? { tx: u.lastOrder.sourceTx, ty: u.lastOrder.sourceTy }
          : worldToTile(u.x, u.y);
        u.order = {
          type: 'haul',
          sourceTx: src.tx,
          sourceTy: src.ty,
          destBuildingId: dest.id,
          phase: 'toDest',
        };
        u.lastOrder = cloneOrder({ ...u.order, phase: 'toSource' });
        u.resumeOrder = null;
        u.blockedReason = null;
        u.status = 'haul';
      }
      emit('order');
      setOrderMarker(tileCenter(dest.tx, dest.ty).x, tileCenter(dest.tx, dest.ty).y);
    }
    if (empty.length && (b.type === 'habitat' || b.type === 'solar')) {
      assignOrder(empty, { type: 'charge', buildingId: b.id }, tileCenter(b.tx, b.ty));
    }
    if (empty.length && isTransitDrop(b) && !loaded.length) {
      const dest = isValidDropTarget(b) ? b : null;
      if (dest) {
        assignOrder(empty, {
          type: 'haul',
          sourceTx: empty[0].lastOrder?.sourceTx ?? worldToTile(empty[0].x, empty[0].y).tx,
          sourceTy: empty[0].lastOrder?.sourceTy ?? worldToTile(empty[0].x, empty[0].y).ty,
          destBuildingId: dest.id,
          phase: 'toSource',
        }, tileCenter(dest.tx, dest.ty));
      }
    }
    return loaded.length > 0 || empty.length > 0;
  }

  function mineTick(unit, tx, ty, dt) {
    const t = tileAt(tx, ty);
    const rate = C.haulerMinePerSecond;
    if (!t) return { status: 'gone', used: 0 };
    const space = C.haulerCarry - cargoAmount(unit);
    if (space <= 0) return { status: 'full', used: 0 };
    if (unit.battery <= 0) return { status: 'empty', used: 0 };
    const take = Math.min(space, rate * dt);
    if (t.type === TILE.ICE && t.iceRemaining > 0) {
      const got = Math.min(take, t.iceRemaining);
      unit.cargo.ice += got;
      t.iceRemaining -= got;
      if (t.iceRemaining <= 0.0001) {
        t.iceRemaining = 0;
        t.type = TILE.ICE_MINED;
      }
      const used = rate > 0 ? got / rate : dt;
      const status = t.iceRemaining <= 0 ? 'gone' : (cargoAmount(unit) + 1e-6 >= C.haulerCarry ? 'full' : 'mined');
      return { status, used };
    }
    if (isPlainGround(t) && !t.buildingId && !t.craterM && !inNoMineZone(tx, ty)) {
      unit.cargo.regolith += take;
      const used = rate > 0 ? take / rate : dt;
      const status = cargoAmount(unit) + 1e-6 >= C.haulerCarry ? 'full' : 'mined';
      return { status, used };
    }
    return { status: 'gone', used: 0 };
  }

  function refreshUnitStatus(unit) {
    if (unit.blockedReason) {
      unit.status = 'blocked';
      return;
    }
    if (!unit.order) {
      unit.status = 'idle';
      return;
    }
    unit.status = unit.order.type;
  }

  function unitLabel(unit) {
    if (unit.blockedReason) return unit.blockedReason;
    if (unit.status === 'blocked') return unit.blockedReason || 'Blocked';
    if (unit.status === 'idle') return 'Idle';
    return '';
  }

  function pauseOnFull(unit, reason) {
    if (unit.blockedReason !== reason) toast(reason);
    unit.blockedReason = reason;
    refreshUnitStatus(unit);
  }

  function endSourceEmpty(unit) {
    unit.order = null;
    unit.lastOrder = null;
    unit.blockedReason = null;
    unit.status = 'idle';
    toast('Source empty');
  }

  function chargeAfterStep(unit) {
    if (unit.kind !== 'hauler') return false;
    if (unit.blockedReason && /full/i.test(unit.blockedReason)) return false;
    if (unit.battery <= 0 || shouldChargeNow(unit) || (lowBattery(unit) && !unit.order)) {
      insertCharge(unit);
      return true;
    }
    return false;
  }

  function convertMineToHaul(unit, tx, ty) {
    const dest = nearestDrop(tx, ty, unit, unit.cargo.ice > 0.001 ? 'ice' : 'regolith');
    const blocked = storageBlockedReason(unit);
    if (blocked && !dest) {
      pauseOnFull(unit, blocked);
      return false;
    }
    if (!dest) return false;
    unit.order = {
      type: 'haul',
      sourceTx: tx,
      sourceTy: ty,
      destBuildingId: dest.id,
      phase: 'toDest',
    };
    unit.lastOrder = cloneOrder({ ...unit.order, phase: 'toSource' });
    unit.blockedReason = null;
    return true;
  }

  function mayInterruptForCharge(order, unit) {
    if (!order || order.type === 'charge') return false;
    if (order.type === 'haul' && (order.phase === 'mine' || order.phase === 'unload')) return false;
    if (order.type === 'mine' && closeToTile(unit, order.tx, order.ty)) return false;
    return true;
  }

  function stepUnit(unit, dt) {
    if (unit.kind === 'hauler' && unit.battery <= 0 && unit.order?.type !== 'charge') {
      insertCharge(unit);
    } else if (
      unit.kind === 'hauler'
      && unit.order?.type !== 'charge'
      && shouldChargeNow(unit)
      && mayInterruptForCharge(unit.order, unit)
    ) {
      insertCharge(unit);
    }
    if (unit.kind === 'hauler' && !unit.order && !unit.blockedReason) {
      if (unit.lastOrder && canRepeat(unit.lastOrder)) {
        unit.order = resetOrder(unit.lastOrder);
      } else if (lowBattery(unit) || unit.battery <= 0) {
        insertCharge(unit);
      }
    }
    const order = unit.order;
    if (!order) {
      refreshUnitStatus(unit);
      return dt;
    }
    if (unit.blockedReason && /full/i.test(unit.blockedReason)) {
      const kind = unit.cargo.ice > 0.001 ? 'ice' : 'regolith';
      if (dropRoom(kind) > 1e-6) {
        unit.blockedReason = null;
      } else {
        refreshUnitStatus(unit);
        return dt;
      }
    }

    if (order.type === 'go') {
      const moved = moveToward(unit, order.x, order.y, dt);
      if (moved.status === 'arrived') {
        finishOrder(unit);
        refreshUnitStatus(unit);
        return Math.max(moved.used, 1e-4);
      }
      refreshUnitStatus(unit);
      return dt;
    }

    if (order.type === 'mine') {
      const c = tileCenter(order.tx, order.ty);
      if (!closeToTile(unit, order.tx, order.ty)) {
        const moved = moveToward(unit, c.x, c.y, dt);
        if (moved.status === 'arrived') {
          refreshUnitStatus(unit);
          return Math.max(moved.used, 1e-4);
        }
        refreshUnitStatus(unit);
        return dt;
      }
      const r = mineTick(unit, order.tx, order.ty, dt);
      if (r.status === 'full') {
        convertMineToHaul(unit, order.tx, order.ty);
        refreshUnitStatus(unit);
        return Math.max(r.used, 1e-4);
      }
      if (r.status === 'gone') {
        if (cargoAmount(unit) > 0.001) {
          convertMineToHaul(unit, order.tx, order.ty);
          if (!sourceHasWork(order.tx, order.ty)) unit._emptyAfterDrop = true;
        } else {
          endSourceEmpty(unit);
        }
        refreshUnitStatus(unit);
        return Math.max(r.used, 1e-4);
      }
      refreshUnitStatus(unit);
      return dt;
    }

    if (order.type === 'charge') {
      const b = buildingById(order.buildingId) || habitat();
      if (!b) {
        finishOrder(unit);
        refreshUnitStatus(unit);
        return dt;
      }
      if (!canChargeAt(unit, b)) {
        const spot = chargeSpot(b);
        const moved = moveToward(unit, spot.x, spot.y, dt);
        if (moved.status === 'arrived') {
          refreshUnitStatus(unit);
          return Math.max(moved.used, 1e-4);
        }
        refreshUnitStatus(unit);
        return dt;
      }
      if (unit.battery >= C.haulerBattery - 0.01) {
        if (unit.resumeOrder) {
          unit.order = cloneOrder(unit.resumeOrder);
          if (unit.order.type === 'haul' && !unit.order.phase) unit.order.phase = 'toSource';
          unit.lastOrder = cloneOrder(unit.resumeOrder.type === 'charge' ? unit.lastOrder : unit.resumeOrder);
          unit.resumeOrder = null;
          unit.blockedReason = null;
        } else {
          finishOrder(unit);
        }
        refreshUnitStatus(unit);
        return Math.max(1e-4, dt * 0.05);
      }
      const room = C.haulerBattery - unit.battery;
      const tot = totals();
      const rate = C.haulerChargePerSecond;
      const amt = Math.min(room, rate * dt, tot.power);
      if (amt > 0) {
        spendPower(amt);
        unit.battery += amt;
      }
      const used = rate > 0 ? (amt > 0 ? amt / rate : dt) : dt;
      refreshUnitStatus(unit);
      if (unit.battery >= C.haulerBattery - 0.01) return Math.max(used, 1e-4);
      return dt;
    }

    if (order.type === 'build') {
      const b = buildingById(order.buildingId);
      if (!b || b.complete) {
        finishOrder(unit);
        refreshUnitStatus(unit);
        return dt;
      }
      const spot = tileCenter(b.tx, b.ty + buildingFootprint(b.type) - 0.5);
      if (Math.hypot(unit.x - spot.x, unit.y - spot.y) > C.tileSize * 0.7) {
        const moved = moveToward(unit, spot.x, spot.y, dt);
        if (moved.status === 'arrived') {
          refreshUnitStatus(unit);
          return Math.max(moved.used, 1e-4);
        }
        refreshUnitStatus(unit);
        return dt;
      }
      b._builders = (b._builders || 0) + 1;
      refreshUnitStatus(unit);
      return dt;
    }

    if (order.type === 'dig') {
      const tile = currentDigTile();
      if (!tile) {
        finishOrder(unit);
        refreshUnitStatus(unit);
        return dt;
      }
      const c = tileCenter(tile.tx, tile.ty);
      if (!closeToTile(unit, tile.tx, tile.ty)) {
        const moved = moveToward(unit, c.x, c.y, dt);
        if (moved.status === 'arrived') {
          refreshUnitStatus(unit);
          return Math.max(moved.used, 1e-4);
        }
        refreshUnitStatus(unit);
        return dt;
      }
      tile.diggers = (tile.diggers || 0) + 1;
      unit._digging = true;
      state.digging = true;
      refreshUnitStatus(unit);
      return dt;
    }

    if (order.type === 'haul') {
      const src = tileCenter(order.sourceTx, order.sourceTy);
      let dest = buildingById(order.destBuildingId);
      const kind = unit.cargo.ice > 0.001 ? 'ice' : (unit.cargo.regolith > 0.001 ? 'regolith' : 'ice');
      if (!dest || !isValidDropTarget(dest)) {
        dest = nearestDrop(order.sourceTx, order.sourceTy, unit, kind) || dest;
        if (dest) order.destBuildingId = dest.id;
      } else if (
        buildingRoom(dest, kind) <= 1e-6
        && dropRoom(kind) > 1e-6
        && !hubPipelineHasRoom(dest)
      ) {
        dest = nearestDrop(order.sourceTx, order.sourceTy, unit, kind) || dest;
        if (dest) order.destBuildingId = dest.id;
      }
      if (!dest) {
        finishOrder(unit);
        refreshUnitStatus(unit);
        return dt;
      }
      if (!order.phase) order.phase = 'toSource';
      if (order.phase === 'toSource') {
        const moved = moveToward(unit, src.x, src.y, dt);
        if (moved.status === 'arrived' || closeToTile(unit, order.sourceTx, order.sourceTy)) {
          order.phase = 'mine';
          refreshUnitStatus(unit);
          return Math.max(moved.used, 1e-4);
        }
        refreshUnitStatus(unit);
        return dt;
      }
      if (order.phase === 'mine') {
        const r = mineTick(unit, order.sourceTx, order.sourceTy, dt);
        if (r.status === 'full') {
          order.phase = 'toDest';
          refreshUnitStatus(unit);
          return Math.max(r.used, 1e-4);
        }
        if (r.status === 'gone') {
          if (cargoAmount(unit) > 0.001) {
            unit._emptyAfterDrop = true;
            order.phase = 'toDest';
          } else {
            endSourceEmpty(unit);
          }
          refreshUnitStatus(unit);
          return Math.max(r.used, 1e-4);
        }
        refreshUnitStatus(unit);
        return dt;
      }
      if (order.phase === 'toDest') {
        const spot = chargeSpot(dest);
        const moved = moveToward(unit, spot.x, spot.y, dt);
        const beside = chebyshevToBuilding(worldToTile(unit.x, unit.y).tx, worldToTile(unit.x, unit.y).ty, dest) <= 1;
        if (moved.status === 'arrived' || beside) {
          order.phase = 'unload';
          refreshUnitStatus(unit);
          return Math.max(moved.used, 1e-4);
        }
        refreshUnitStatus(unit);
        return dt;
      }
      if (order.phase === 'unload') {
        const moved = deposit(unit, dest);
        if (moved.ice > 0 && (dest.type === 'habitat' || dest.type === 'storage' || dest.type === 'vault')) {
          state.stats.usedHaulers = true;
        }
        if (dest.type === 'tunnel-hub') {
          dest.outboundIce = (dest.outboundIce || 0) + moved.ice;
          dest.outboundReg = (dest.outboundReg || 0) + moved.regolith;
        }
        const leftover = cargoAmount(unit);
        if (leftover > 0.001) {
          if (hubPipelineHasRoom(dest)) {
            unit.blockedReason = null;
            refreshUnitStatus(unit);
            return dt;
          }
          const reason = storageBlockedReason(unit);
          if (reason) {
            pauseOnFull(unit, reason);
            return dt;
          }
          const next = nearestDrop(worldToTile(unit.x, unit.y).tx, worldToTile(unit.x, unit.y).ty, unit);
          if (next && next.id !== dest.id) {
            order.destBuildingId = next.id;
            order.phase = 'toDest';
            unit.blockedReason = null;
            refreshUnitStatus(unit);
            return Math.max(1e-4, dt * 0.05);
          }
          pauseOnFull(unit, reason || 'Storage full');
          return dt;
        }
        unit.blockedReason = null;
        if (unit._emptyAfterDrop || !sourceHasWork(order.sourceTx, order.sourceTy)) {
          unit._emptyAfterDrop = false;
          endSourceEmpty(unit);
          refreshUnitStatus(unit);
          return dt;
        }
        order.phase = 'toSource';
        if (chargeAfterStep(unit)) {
          refreshUnitStatus(unit);
          return Math.max(1e-4, dt * 0.05);
        }
        refreshUnitStatus(unit);
        return Math.max(1e-4, dt * 0.05);
      }
    }
    refreshUnitStatus(unit);
    return dt;
  }

  function updateUnit(unit, dt) {
    let left = dt;
    let guard = 0;
    while (left > 1e-6 && guard++ < 24) {
      const before = left;
      const used = stepUnit(unit, left);
      if (used <= 1e-8) break;
      left -= Math.min(before, used);
      if (used >= before - 1e-8) break;
    }
    refreshUnitStatus(unit);
  }

  function axisTiles(tx0, ty0, tx1, ty1) {
    let ax = tx0, ay = ty0, bx = tx1, by = ty1;
    if (Math.abs(bx - ax) >= Math.abs(by - ay)) by = ay;
    else bx = ax;
    const kind = ax === bx ? 'v' : 'h';
    const dx = Math.sign(bx - ax);
    const dy = Math.sign(by - ay);
    const tiles = [];
    let x = ax, y = ay;
    for (let i = 0; i < C.mapWidth + C.mapHeight; i++) {
      const t = tileAt(x, y);
      if (t && !t.buildingId) {
        tiles.push({
          tx: x,
          ty: y,
          progress: 0,
          done: false,
          started: false,
          kind,
          diggers: 0,
        });
      }
      if (x === bx && y === by) break;
      if (!dx && !dy) break;
      x += dx;
      y += dy;
    }
    return tiles;
  }

  function corridorBetweenHubs() {
    const pair = hubs();
    if (pair.length !== 2) return null;
    const [a, b] = pair;
    const aY0 = a.ty, aY1 = a.ty + buildingFootprint(a.type) - 1;
    const bY0 = b.ty, bY1 = b.ty + buildingFootprint(b.type) - 1;
    const yLo = Math.max(aY0, bY0);
    const yHi = Math.min(aY1, bY1);
    if (yLo <= yHi) {
      const y = yLo;
      const aX1 = a.tx + buildingFootprint(a.type) - 1;
      const bX1 = b.tx + buildingFootprint(b.type) - 1;
      let x0, x1;
      if (aX1 < b.tx) { x0 = aX1 + 1; x1 = b.tx - 1; }
      else if (bX1 < a.tx) { x0 = bX1 + 1; x1 = a.tx - 1; }
      else return [];
      if (x0 > x1) return [];
      return axisTiles(x0, y, x1, y);
    }
    const aX0 = a.tx, aX1 = a.tx + buildingFootprint(a.type) - 1;
    const bX0 = b.tx, bX1b = b.tx + buildingFootprint(b.type) - 1;
    const xLo = Math.max(aX0, bX0);
    const xHi = Math.min(aX1, bX1b);
    if (xLo <= xHi) {
      const x = xLo;
      const aY1b = a.ty + buildingFootprint(a.type) - 1;
      const bY1b = b.ty + buildingFootprint(b.type) - 1;
      let y0, y1;
      if (aY1b < b.ty) { y0 = aY1b + 1; y1 = b.ty - 1; }
      else if (bY1b < a.ty) { y0 = bY1b + 1; y1 = a.ty - 1; }
      else return [];
      if (y0 > y1) return [];
      return axisTiles(x, y0, x, y1);
    }
    return null;
  }

  function startDigLine(tx0, ty0, tx1, ty1) {
    const tiles = axisTiles(tx0, ty0, tx1, ty1);
    state.tunnel = { tiles, packets: state.tunnel.packets };
    return tiles;
  }

  function startDigCorridor() {
    const tiles = corridorBetweenHubs();
    if (!tiles || !tiles.length) return null;
    state.tunnel = { tiles, packets: state.tunnel.packets };
    return tiles;
  }

  function updateDigTiles(dt) {
    for (const tile of state.tunnel.tiles) {
      if (tile.done) {
        tile.diggers = 0;
        continue;
      }
      if ((tile.diggers || 0) > 0) {
        if (!tile.started) {
          if (totals().power + 1e-6 < C.digPowerPerTile || !spendPower(C.digPowerPerTile)) {
            for (const u of state.units) {
              if (u._digging) {
                u.blockedReason = 'Need power';
                refreshUnitStatus(u);
              }
            }
            tile.diggers = 0;
            continue;
          }
          tile.started = true;
        }
        tile.progress += (tile.diggers * dt) / C.digSecondsPerTilePerRover;
        if (tile.progress >= 1) {
          tile.progress = 1;
          tile.done = true;
          addRegolith(C.digRegolithYieldPerTile);
        }
      }
      tile.diggers = 0;
    }
  }

  function hubTouchesTunnel(hub) {
    return state.tunnel.tiles.some((t) => t.done && chebyshevToBuilding(t.tx, t.ty, hub) <= 1);
  }

  function tunnelReady() {
    const ready = completeHubs();
    if (ready.length < 2) return false;
    const tiles = state.tunnel.tiles;
    if (!tiles.length || tiles.some((t) => !t.done)) return false;
    return ready.every((h) => hubTouchesTunnel(h));
  }

  function scoringStores() {
    return state.buildings.filter((b) => (
      b.complete
      && (b.type === 'habitat' || b.type === 'storage' || b.type === 'vault')
      && buildingInCommandRange(b)
    ));
  }

  function isScoringHomeHub(hub) {
    return !!(hub && hub.type === 'tunnel-hub' && vaultsBeside(hub).some((v) => buildingInCommandRange(v)));
  }

  function goalIceRoom(skipIds = new Set()) {
    let room = 0;
    for (const b of scoringStores()) {
      if (skipIds.has(b.id)) continue;
      room += Math.max(0, (b.iceCap || 0) - (b.ice || 0));
    }
    return room;
  }

  function overflowIceToGoal(amount, skipIds = new Set()) {
    let left = Math.max(0, amount);
    const stores = scoringStores().filter((b) => !skipIds.has(b.id));
    const rank = (t) => (t === 'vault' ? 0 : t === 'storage' ? 1 : 2);
    stores.sort((a, b) => rank(a.type) - rank(b.type));
    for (const b of stores) {
      if (left <= 1e-9) break;
      const room = Math.max(0, (b.iceCap || 0) - (b.ice || 0));
      const mv = Math.min(room, left);
      b.ice += mv;
      left -= mv;
    }
    return amount - left;
  }

  function iceRoomAtHub(hub) {
    let room = Math.max(0, hub.iceCap - hub.ice);
    const vaults = vaultsBeside(hub);
    for (const v of vaults) room += Math.max(0, v.iceCap - v.ice);
    if (isScoringHomeHub(hub)) {
      const skip = new Set([hub.id, ...vaults.map((v) => v.id)]);
      room += goalIceRoom(skip);
    }
    return room;
  }

  function settleHubIce(hub) {
    if (!hub || hub.type !== 'tunnel-hub') return;
    const home = isScoringHomeHub(hub);
    const reserved = home ? 0 : Math.max(0, hub.outboundIce || 0);
    let free = Math.max(0, hub.ice - reserved);
    const vaults = vaultsBeside(hub);
    for (const v of vaults) {
      const room = Math.max(0, v.iceCap - v.ice);
      const mv = Math.min(room, free);
      v.ice += mv;
      hub.ice -= mv;
      free -= mv;
    }
    if (home && free > 1e-9) {
      const skip = new Set(vaults.map((v) => v.id));
      const moved = overflowIceToGoal(free, skip);
      hub.ice -= moved;
    }
    if (hub.ice > hub.iceCap) {
      const extra = hub.ice - hub.iceCap;
      hub.ice = hub.iceCap;
      if (home) overflowIceToGoal(extra);
    }
  }

  function fillVaultsFrom(hub) {
    settleHubIce(hub);
  }

  function pullVaultsTo(hub, amount) {
    if (isScoringHomeHub(hub)) return;
    let need = Math.max(0, amount);
    for (const v of vaultsBeside(hub)) {
      if (need <= 0) break;
      const room = Math.max(0, hub.iceCap - hub.ice);
      const mv = Math.min(need, v.ice, room);
      v.ice -= mv;
      hub.ice += mv;
      need -= mv;
    }
  }

  function otherHub(hub) {
    return completeHubs().find((h) => h.id !== hub.id) || null;
  }

  function hubPipelineHasRoom(hub) {
    if (!hub || hub.type !== 'tunnel-hub') return false;
    if (iceRoomAtHub(hub) > 1e-6) return true;
    const dest = otherHub(hub);
    return !!(dest && iceRoomAtHub(dest) > 1e-6);
  }

  function sendFromHub(hub) {
    if (!tunnelReady()) return;
    const dest = otherHub(hub);
    if (!dest) return;
    if (isScoringHomeHub(hub)) hub.outboundIce = 0;
    const wantIce = hub.outboundIce || 0;
    const wantReg = hub.outboundReg || 0;
    if (wantIce <= 1e-6 && wantReg <= 1e-6) return;
    const iceRoom = iceRoomAtHub(dest);
    const regRoom = Math.max(0, dest.regolithCap - dest.regolith);
    if (hub.ice < wantIce && !isScoringHomeHub(hub)) pullVaultsTo(hub, wantIce - hub.ice);
    const ice = Math.min(hub.ice, wantIce, iceRoom);
    const reg = Math.min(hub.regolith, wantReg, regRoom);
    if (ice <= 1e-6 && reg <= 1e-6) return;
    hub.ice -= ice;
    hub.regolith -= reg;
    hub.outboundIce = Math.max(0, wantIce - ice);
    hub.outboundReg = Math.max(0, wantReg - reg);
    state.tunnel.packets.push({
      ice,
      regolith: reg,
      fromId: hub.id,
      toId: dest.id,
      traveled: 0,
      length: Math.max(state.tunnel.tiles.length, 0.001),
    });
  }

  function deliverPacket(p) {
    const dest = buildingById(p.toId);
    if (!dest) return;
    dest.ice += p.ice;
    dest.regolith += p.regolith;
    fillVaultsFrom(dest);
    if (dest.ice > dest.iceCap) {
      const extra = dest.ice - dest.iceCap;
      dest.ice = dest.iceCap;
      if (isScoringHomeHub(dest)) overflowIceToGoal(extra);
    }
    if (dest.regolith > dest.regolithCap) dest.regolith = dest.regolithCap;
    if (p.ice > 0 || p.regolith > 0) state.stats.usedTunnel = true;
    if (p.ice > 0) {
      const vaults = dest.type === 'tunnel-hub' ? vaultsBeside(dest) : [];
      const counted = [dest, ...vaults].some((b) => (
        (b.type === 'habitat' || b.type === 'storage' || b.type === 'vault' || b.type === 'tunnel-hub')
        && buildingInCommandRange(b)
      ));
      if (counted && vaults.some((v) => buildingInCommandRange(v))) {
        state.stats.goalIceByTunnel = (state.stats.goalIceByTunnel || 0) + p.ice;
      }
    }
  }

  function updateCargo(dt) {
    const keep = [];
    for (const p of state.tunnel.packets) {
      p.traveled += C.tunnelCargoTilesPerSecond * dt;
      if (p.traveled + 1e-6 >= p.length) deliverPacket(p);
      else keep.push(p);
    }
    state.tunnel.packets = keep;
    for (const hub of completeHubs()) fillVaultsFrom(hub);
    for (const hub of completeHubs()) sendFromHub(hub);
    for (const hub of completeHubs()) fillVaultsFrom(hub);
  }

  function updateBuildings(dt) {
    for (const b of state.buildings) {
      if (!b.complete) {
        if ((b._builders || 0) > 0) {
          b.buildTime += dt;
          if (b.buildTime >= b.buildNeeded) {
            b.complete = true;
            b.buildTime = b.buildNeeded;
            emit('build-complete', { buildingId: b.id, kind: b.type });
          }
        }
      }
      b._builders = 0;
      if (b.complete && b.printing) {
        if (powerStarved()) continue;
        b.printTime += dt;
        if (b.printTime >= b.printNeeded) {
          b.printing = false;
          b.printTime = 0;
          const n = buildingFootprint(b.type);
          addHauler((b.tx + n) * C.tileSize + 8, (b.ty + n * 0.5) * C.tileSize, b.rallyOrder || defaultHaulOrder());
          emit('build-complete', { kind: 'hauler' });
        }
      }
    }
  }

  function notePatchApplied(ok) {
    if (!ok) return false;
    state.expedition.patchesThisSol += 1;
    state.stats.patches += 1;
    noteExpedition('Patch applied');
    emit('patch-applied');
    return true;
  }

  function tick(dt) {
    state.digging = false;
    for (const u of state.units) u._digging = false;
    addPower(solarOutputPerSecond() * dt);
    const upkeep = (C.haulerUpkeepPowerPerSec || 0)
      * state.units.filter((u) => u.kind === 'hauler').length
      * dt;
    if (upkeep > 0) spendPower(upkeep);
    for (const u of state.units) updateUnit(u, dt);
    updateDigTiles(dt);
    updateBuildings(dt);
    updateCargo(dt);
    updateExpedition(dt);
    clampStores();
    state.time += dt;
    if (state.orderMarker) {
      state.orderMarker.t += dt;
      if (state.orderMarker.t > 2.4) state.orderMarker = null;
    }
    if (state.toast) {
      state.toast.ttl -= dt;
      if (state.toast.ttl <= 0) state.toast = null;
    }
  }

  function update(dt) {
    if (dt <= 0) return;
    const step = 1 / 60;
    state.simAcc = (state.simAcc || 0) + dt;
    let guard = 0;
    while (state.simAcc + 1e-12 >= step && guard++ < 4000) {
      tick(step);
      state.simAcc -= step;
    }
  }

  function selectUnits(ids, additive) {
    if (!additive) {
      state.selectedIds = [...ids];
      state.selectedBuildingId = null;
    } else {
      const set = new Set(state.selectedIds);
      for (const i of ids) {
        if (set.has(i)) set.delete(i);
        else set.add(i);
      }
      state.selectedIds = [...set];
    }
    if (!state.selectedIds.length && !additive) clearArmed();
    if (state.selectedIds.length) emit('select');
  }

  function selectBuilding(bid) {
    state.selectedBuildingId = bid;
    state.selectedIds = [];
    if (!bid) clearArmed();
    if (bid) emit('select');
  }

  function unitAtWorld(x, y, radius = C.unitClickRadius) {
    let best = null;
    let bestD = radius;
    for (const u of state.units) {
      const d = Math.hypot(u.x - x, u.y - y);
      if (d < bestD) {
        best = u;
        bestD = d;
      }
    }
    return best;
  }

  function buildingAtTile(tx, ty) {
    const t = tileAt(tx, ty);
    if (!t || !t.buildingId) return null;
    return buildingById(t.buildingId);
  }

  function tunnelAlreadyDug() {
    const tiles = state.tunnel.tiles;
    return tiles.length > 0 && tiles.every((t) => t.done);
  }

  function issueContextual(x, y) {
    const units = ensureHaulers(x, y);
    if (!units.length) return rejectOrder('Select a hauler');
    const raw = worldToTile(x, y);
    const pref = preferOrderTile(raw.tx, raw.ty);
    const tx = pref.tx;
    const ty = pref.ty;
    const tile = tileAt(tx, ty);
    const resource = tile && (tile.type === TILE.ICE || sourceHasWork(tx, ty));
    const b = (resource && !state.armedOrder && !state.haulPick && !state.digPick)
      ? null
      : (buildingAtWorld(x, y) || buildingAtTile(tx, ty));

    if (state.armedOrder === 'dig' || state.digPick) {
      if (tunnelAlreadyDug()) {
        clearArmed();
        return rejectOrder('Tunnel already dug');
      }
      if (!state.digPick) {
        const corridor = corridorBetweenHubs();
        if (corridor && corridor.length) {
          if (corridor.every((t) => t.done)) {
            clearArmed();
            return rejectOrder('Tunnel already dug');
          }
          state.tunnel = { tiles: corridor, packets: state.tunnel.packets };
          const mark = tileCenter(corridor[0].tx, corridor[0].ty);
          assignOrder(units, { type: 'dig' }, mark);
          clearArmed();
          return true;
        }
        state.digPick = { tx, ty };
        state.orderPrompt = 'Now click the other end of the tunnel';
        return true;
      }
      startDigLine(state.digPick.tx, state.digPick.ty, tx, ty);
      assignOrder(units, { type: 'dig' }, tileCenter(tx, ty));
      clearArmed();
      return true;
    }

    if (state.armedOrder === 'haul' || state.haulPick) {
      if ((b && (isDropBuilding(b) || isTransitDrop(b))) && !state.haulPick) {
        const loaded = units.some((u) => cargoAmount(u) > 0.001);
        if (loaded) {
          clearArmed();
          return commandDropOrCharge(units, b);
        }
        state.haulPick = null;
        state.orderPrompt = 'Now click the resource to haul';
        state.armedOrder = 'haul';
        return true;
      }
      if (!state.haulPick) {
        if (tile && (tile.type === TILE.ICE || sourceHasWork(tx, ty))) {
          clearArmed();
          return commandHaulTile(units, tx, ty);
        }
        state.haulPick = { sourceTx: tx, sourceTy: ty };
        state.orderPrompt = 'Now click the drop-off';
        return true;
      }
      const srcTile = tileAt(state.haulPick.sourceTx, state.haulPick.sourceTy);
      const prefer = srcTile?.type === TILE.ICE ? 'ice' : 'regolith';
      const dest = (b && (isDropBuilding(b) || isTransitDrop(b)))
        ? b
        : nearestDrop(tx, ty, units[0], prefer);
      if (!dest) {
        clearArmed();
        return rejectOrder('No storage room');
      }
      assignOrder(units, {
        type: 'haul',
        sourceTx: state.haulPick.sourceTx,
        sourceTy: state.haulPick.sourceTy,
        destBuildingId: dest.id,
        phase: 'toSource',
      }, tileCenter(state.haulPick.sourceTx, state.haulPick.sourceTy));
      clearArmed();
      return true;
    }

    if (state.armedOrder === 'mine') {
      if (units.every((u) => cargoAmount(u) + 1e-6 >= C.haulerCarry)) {
        clearArmed();
        if (!sourceHasWork(tx, ty) && !(tile && tile.type === TILE.ICE)) {
          const dest = nearestDrop(tx, ty, units[0], units[0].cargo.ice > 0.001 ? 'ice' : 'regolith');
          if (!dest) return rejectOrder("Can't: cargo full");
          return commandDropOrCharge(units, dest);
        }
        return commandHaulTile(units, tx, ty);
      }
      if (tile && tile.type === TILE.ICE) {
        clearArmed();
        return commandHaulTile(units, tx, ty);
      }
      assignOrder(units, { type: 'mine', tx, ty }, tileCenter(tx, ty));
      clearArmed();
      return true;
    }

    if (state.armedOrder === 'charge') {
      const dest = (b && (b.type === 'habitat' || b.type === 'solar')) ? b : habitat();
      assignOrder(units, { type: 'charge', buildingId: dest.id }, tileCenter(dest.tx, dest.ty));
      clearArmed();
      return true;
    }

    if (b && !b.complete) {
      assignOrder(units, { type: 'build', buildingId: b.id }, tileCenter(b.tx, b.ty));
      return true;
    }
    if (b && (isDropBuilding(b) || isTransitDrop(b) || b.type === 'solar')) {
      return commandDropOrCharge(units, b);
    }
    if (tile && (tile.type === TILE.ICE || sourceHasWork(tx, ty))) {
      return commandHaulTile(units, tx, ty);
    }
    if (tile && (tile.type === TILE.ICE_MINED || tile.type === TILE.CRATER_S || tile.type === TILE.PIT || tile.craterM)) {
      return rejectOrder('Source empty');
    }
    if (units.every((u) => cargoAmount(u) + 1e-6 >= C.haulerCarry)) {
      const dest = nearestDrop(tx, ty, units[0], units[0].cargo.ice > 0.001 ? 'ice' : 'regolith');
      if (!dest) return rejectOrder("Can't: cargo full");
      return commandDropOrCharge(units, dest);
    }
    assignOrder(units, { type: 'go', x, y }, { x, y });
    return true;
  }

  function placeBuilding(type, tx, ty, assignSelected = true) {
    const costs = {
      solar: { reg: C.rimSolarCostRegolith, time: C.rimSolarBuildSeconds, iceCap: 0, regCap: 0, powerCap: 0 },
      storage: { reg: C.storageCostRegolith, time: C.storageBuildSeconds, iceCap: C.storageIceCapacity, regCap: C.storageRegolithCapacity, powerCap: 0 },
      printer: { reg: C.printerCostRegolith, time: C.printerBuildSeconds, iceCap: 0, regCap: 0, powerCap: 0 },
      'tunnel-hub': { reg: C.tunnelHubCostRegolith, time: C.tunnelHubBuildSeconds, iceCap: C.hubIceCapacity, regCap: C.hubRegolithCapacity, powerCap: 0 },
      vault: { reg: C.vaultCostRegolith, time: C.vaultBuildSeconds, iceCap: C.vaultIceCapacity, regCap: 0, powerCap: 0 },
    };
    const spec = costs[type];
    if (!spec) return null;
    if (!canPlace(type, tx, ty)) {
      toast('Cannot place here');
      return null;
    }
    if (totals().regolith < spec.reg) {
      toast(`Need ${spec.reg} regolith`);
      return null;
    }
    spendRegolith(spec.reg);
    const b = addBuilding(type, tx, ty, {
      complete: false,
      buildTime: 0,
      buildNeeded: spec.time,
      iceCap: spec.iceCap,
      regolithCap: spec.regCap,
      powerCap: spec.powerCap,
    });
    if (assignSelected) {
      const units = selectedUnits();
      if (units.length) assignOrder(units, { type: 'build', buildingId: b.id }, tileCenter(tx, ty));
    }
    state.buildGhost = null;
    return b;
  }

  function nextPrintCostRegolith() {
    const printed = Math.max(0, state.units.filter((u) => u.kind === 'hauler').length - (C.startHaulers || 0));
    return (C.printerHaulerCostRegolith || 0) + printed * (C.printerHaulerCostRegolithStep || 0);
  }

  function startPrint() {
    const p = state.buildings.find((b) => b.type === 'printer' && b.complete && !b.printing);
    if (!p) {
      toast('Need an idle printer');
      return false;
    }
    const tot = totals();
    const regCost = nextPrintCostRegolith();
    if (tot.regolith < regCost) {
      toast(`Need ${regCost} regolith`);
      return false;
    }
    if (tot.power < C.printerHaulerCostPower) {
      toast(`Need ${C.printerHaulerCostPower} power`);
      return false;
    }
    spendRegolith(regCost);
    spendPower(C.printerHaulerCostPower);
    p.printing = true;
    p.printTime = 0;
    p.printNeeded = C.printerHaulerSeconds;
    return true;
  }

  function toggleView() {
    state.view = state.view === 'surface' ? 'underground' : 'surface';
    return state.view;
  }

  function setView(view) {
    state.view = view === 'underground' ? 'underground' : 'surface';
    return state.view;
  }

  function isDigging() {
    return !!state.digging;
  }

  function completeBuilding(bid) {
    const b = buildingById(bid);
    if (!b) return null;
    b.complete = true;
    b.buildTime = b.buildNeeded;
    return b;
  }

  function depositToBuilding(bid, amounts = {}) {
    const b = buildingById(bid);
    if (!b) return null;
    if (amounts.ice) {
      const room = b.type === 'tunnel-hub'
        ? iceRoomAtHub(b)
        : Math.max(0, b.iceCap - b.ice);
      const add = Math.min(room, amounts.ice);
      b.ice += add;
      if (b.type === 'tunnel-hub') b.outboundIce = (b.outboundIce || 0) + add;
    }
    if (amounts.regolith) {
      const room = Math.max(0, b.regolithCap - b.regolith);
      const add = Math.min(room, amounts.regolith);
      b.regolith += add;
      if (b.type === 'tunnel-hub') b.outboundReg = (b.outboundReg || 0) + add;
    }
    fillVaultsFrom(b);
    return { ice: b.ice, regolith: b.regolith };
  }

  function markTunnelDone() {
    for (const t of state.tunnel.tiles) {
      t.done = true;
      t.progress = 1;
      t.started = true;
    }
  }

  function bootstrap() {
    makeTiles();
    stampTerrain(9, 5, TILE.CRATER_S);
    stampTerrain(33, 13, TILE.CRATER_S);
    stampTerrain(4, 29, TILE.CRATER_S);
    stampTerrain(31, 32, TILE.CRATER_S);
    stampTerrain(12, 30, TILE.PIT);
    stampTerrain(22, 8, TILE.CRATER_S);
    stampTerrain(13, 20, TILE.CRATER_S);
    stampTerrain(28, 26, TILE.PIT);
    // crater-m is a feathered 2x2 overlay on ground, not a replacement tile.
    for (let y = 0; y < 2; y++) {
      for (let x = 0; x < 2; x++) {
        const t = tileAt(33 + x, 24 + y);
        if (t) t.craterM = true;
      }
    }
    tileAt(33, 24).craterMAnchor = true;

    const ice = tileAt(C.shallowIceTileX, C.shallowIceTileY);
    ice.type = TILE.ICE;
    ice.iceRemaining = C.shallowIceAmount;

    addBuilding('habitat', C.habitatTileX, C.habitatTileY, {
      complete: true,
      ice: C.startIce,
      regolith: C.startRegolith,
      power: C.startPower,
      iceCap: C.habitatIceCapacity,
      regolithCap: C.habitatRegolithCapacity,
      powerCap: C.habitatPowerCapacity,
    });
    addBuilding('solar', C.startSolarTileX, C.startSolarTileY, { complete: true });

    const h = habitat();
    const south = tileCenter(h.tx, h.ty + 3);
    const south2 = tileCenter(h.tx + 2, h.ty + 3);
    addHauler(south.x, south.y);
    addHauler(south2.x, south2.y);
  }

  bootstrap();

  function tunnelSpeedMultiple() {
    const walk = C.haulerSpeedTilesPerSecond || 1;
    const cargo = C.tunnelCargoTilesPerSecond || walk;
    return Math.round((cargo / walk) * 10) / 10;
  }

  function tunnelPayoffText() {
    return `Long haul? A tunnel moves ice ${tunnelSpeedMultiple()}x faster than haulers.`;
  }

  function hubPayoffText() {
    return `A tunnel moves ice ${tunnelSpeedMultiple()}x faster than haulers.`;
  }

  function roughGroundText() {
    const mult = C.haulerOffRoadSpeedMult;
    if (!Number.isFinite(mult) || mult >= 1) return '';
    return `Rough ground: haulers drive at ${Math.round(mult * 100)}% speed`;
  }

  function iceHoverText(tx, ty) {
    const t = tileAt(tx, ty);
    if (!t) return '';
    const b = buildingAtTile(tx, ty);
    if (b && b.type === 'tunnel-hub') return hubPayoffText();
    const deep = state.deepIce.unlocked && state.deepIce.tx === tx && state.deepIce.ty === ty;
    if (t.type === TILE.ICE) {
      return deep
        ? `Deep Ice — right-click to start a delivery loop. ${tunnelPayoffText()}`
        : 'Shallow ice — right-click to start a delivery loop';
    }
    if (t.type === TILE.ICE_MINED) return deep ? 'Deep Ice depleted' : 'Shallow ice depleted';
    if (!inCommandRange(tx, ty)) return roughGroundText();
    return '';
  }

  function showHaulHint() {
    if (state.won) return false;
    return !objectiveProgress().mineShallow;
  }

  function showScoutHint() {
    if (state.won || state.expedition.launched) return false;
    if (showHaulHint()) return false;
    const stored = storedForGoal().ice;
    const shallow = tileAt(C.shallowIceTileX, C.shallowIceTileY);
    const empty = !shallow || shallow.type === TILE.ICE_MINED || (shallow.iceRemaining || 0) <= 0;
    return stored + 1e-6 < C.goalIceInStorage || empty;
  }

  function showIceHint() {
    return showHaulHint() || showScoutHint();
  }

  function iceHintText() {
    if (showHaulHint()) return 'Select haulers, then right-click the ice to start a delivery loop';
    return 'Need more ice? Build a scout to find the Deep Ice deposit';
  }

  function objectiveProgress() {
    const shallow = tileAt(C.shallowIceTileX, C.shallowIceTileY);
    const minedShallow = !shallow
      || shallow.type === TILE.ICE_MINED
      || (shallow.iceRemaining + 1e-6) < C.shallowIceAmount;
    const deep = state.deepIce;
    const deepTile = deep.unlocked ? tileAt(deep.tx, deep.ty) : null;
    const hauledDeep = !!(deep.unlocked && deepTile && (
      deepTile.type === TILE.ICE_MINED || (deepTile.iceRemaining + 1e-6) < C.deepIceAmount
    ));
    return {
      mineShallow: minedShallow,
      buildScout: !!deep.unlocked,
      haulDeep: hauledDeep,
      landCrew: !!(state.won || canLandCrew()),
    };
  }

  return {
    state,
    C,
    tileAt,
    tileCenter,
    worldToTile,
    totals,
    isDay,
    solTime,
    solarOutputPerSecond,
    habitat,
    buildingById,
    unitById,
    selectedUnits,
    canPlace,
    update,
    flushEvents,
    selectUnits,
    selectBuilding,
    unitAtWorld,
    buildingAtTile,
    issueContextual,
    placeBuilding,
    startPrint,
    assignOrder,
    addHauler,
    tilesOfBuilding,
    chebyshevToBuilding,
    cargoAmount,
    startDigLine,
    startDigCorridor,
    toggleView,
    setView,
    isDigging,
    completeBuilding,
    depositToBuilding,
    markTunnelDone,
    unitLabel,
    corridorBetweenHubs,
    tunnelReady,
    buildingFootprint,
    addScout,
    unlockDeepIce,
    queueNotifyPing,
    queuePatch,
    patchesLeft,
    startRecall,
    markExpeditionLaunched,
    endExpedition,
    updateScoutPaper,
    powerDeficit,
    isValidDropTarget,
    canLandCrew,
    landCrew,
    currentSol,
    noteExpedition,
    clampStores,
    storedForGoal,
    iceHoverText,
    showIceHint,
    showScoutHint,
    iceHintText,
    objectiveProgress,
    tunnelSpeedMultiple,
    tunnelPayoffText,
    hubPayoffText,
    transitIce,
    nextPrintCostRegolith,
    powerDrawPerSecond,
    secondsUntilDawn,
    inCommandRange,
    buildingInCommandRange,
    buildingAtWorld,
    cycleSelectAt,
    unitsNear,
    canBuildScout,
    canRecall,
    patchesUsed,
    patchesLabel,
    notePatchApplied,
    affordReason,
    buildCost,
    goalBanner,
    unitCard,
    unitTask,
    sourceHasWork,
    inNoMineZone,
    commandHaulTile,
    clearArmed,
  };
}
