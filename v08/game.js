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
    },
    deepIce: { unlocked: false, tx: null, ty: null },
    won: false,
    win: null,
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

  function toast(text) {
    state.toast = { text, ttl: C.warningToastSeconds };
    emit('warning', { text });
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

  function addHauler(x, y) {
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
      status: 'idle',
      blockedReason: null,
    };
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
    const aimX = Math.round(hx + (dx / len) * C.commandRangeRadius);
    const aimY = Math.round(hy + (dy / len) * C.commandRangeRadius);
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
    state.deepIce = { unlocked: true, tx: at.tx, ty: at.ty };
    emit('deep-ice', { tx: at.tx, ty: at.ty });
    return state.deepIce;
  }

  function queueNotifyPing(entry) {
    state.expedition.pendingPings.push({
      remaining: C.notifyLinkDelaySeconds,
      tx: entry.tx ?? state.expedition.marker.tx,
      ty: entry.ty ?? state.expedition.marker.ty,
      text: entry.text || 'Notify',
      confirmed: !!entry.confirmed,
    });
  }

  function noteExpedition(text) {
    state.expedition.log.push({ t: state.time, text });
    if (state.expedition.log.length > 12) state.expedition.log.shift();
  }

  function markExpeditionLaunched() {
    state.expedition.launched = true;
    state.expedition.ended = false;
    state.expedition.recallUsed = false;
    state.expedition.recalling = false;
    noteExpedition('Scout launched');
  }

  function endExpedition() {
    state.expedition.ended = true;
    state.expedition.recalling = false;
    noteExpedition('Expedition ended');
    emit('expedition-ended');
  }

  function startRecall() {
    if (!state.expedition.launched || state.expedition.ended || state.expedition.recallUsed) return null;
    state.expedition.recallUsed = true;
    state.expedition.recalling = true;
    const m = state.expedition.marker;
    const c = tileCenter(m.tx, m.ty);
    const scout = addScout(c.x, c.y);
    state.expedition.scoutId = scout.id;
    const hab = habitat();
    const dest = tileCenter(hab.tx + 1, hab.ty + 1);
    assignOrder([scout], { type: 'go', x: dest.x, y: dest.y }, dest);
    noteExpedition('Recall: scout driving home');
    emit('recall');
    return scout;
  }

  function currentSol() {
    return Math.floor(state.time / C.solSecondsAt1x) + 1;
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

  function canLandCrew() {
    if (state.won) return false;
    const tot = totals();
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
        state.expedition.patchesThisSol += 1;
        state.stats.patches += 1;
        emit('patch-applied', { slot: p.slot, condition: p.condition, action: p.action });
        noteExpedition('Patch applied');
      }
    }
    const stillPending = [];
    for (const ping of state.expedition.pendingPings) {
      ping.remaining -= dt;
      if (ping.remaining <= 0) {
        state.expedition.activePings.push({ ...ping, age: 0 });
        state.stats.notifies += 1;
        noteExpedition(ping.text);
        toast(ping.text);
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
    const tot = totals();
    state.won = true;
    state.win = {
      time: state.time,
      logistics: state.stats.usedTunnel ? 'tunnel' : 'haulers only',
      notifies: state.stats.notifies,
      patches: state.stats.patches,
      ice: tot.ice,
      power: tot.power,
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
    const iceRoom = Math.max(0, dest.iceCap - dest.ice);
    const regRoom = Math.max(0, dest.regolithCap - dest.regolith);
    const ice = Math.min(unit.cargo.ice, iceRoom);
    const reg = Math.min(unit.cargo.regolith, regRoom);
    dest.ice += ice;
    dest.regolith += reg;
    unit.cargo.ice -= ice;
    unit.cargo.regolith -= reg;
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
    if (type === 'vault' && !hubBesideVault(type, tx, ty)) return false;
    return true;
  }

  function solTime() {
    const cycle = C.solSecondsAt1x;
    const t = ((state.time % cycle) + cycle) % cycle;
    return t;
  }

  function isDay() {
    return solTime() < C.daySecondsAt1x;
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

  function nearestDrop(tx, ty) {
    let best = null;
    let bestD = Infinity;
    for (const b of state.buildings) {
      if (!b.complete || (b.iceCap <= 0 && b.regolithCap <= 0)) continue;
      const d = chebyshevToBuilding(tx, ty, b);
      if (d < bestD) {
        best = b;
        bestD = d;
      }
    }
    return best;
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

  function moveToward(unit, wx, wy, dt) {
    const dx = wx - unit.x;
    const dy = wy - unit.y;
    const dist = Math.hypot(dx, dy);
    const step = C.tileSize * C.haulerSpeedTilesPerSecond * dt;
    const loaded = cargoAmount(unit) > 0.001;
    const drain = loaded ? C.haulerDrainPerTileLoaded : C.haulerDrainPerTileEmpty;
    if (unit.battery <= 0) return 'empty';
    if (dist < 0.5) return 'arrived';
    const travel = Math.min(step, dist);
    if (dist > 0.001) unit.facing = Math.atan2(dx, -dy);
    const tiles = travel / C.tileSize;
    unit.battery = Math.max(0, unit.battery - tiles * drain);
    const k = travel / dist;
    unit.x += dx * k;
    unit.y += dy * k;
    return travel >= dist - 0.01 ? 'arrived' : 'moving';
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
    if (order.type === 'mine') {
      const t = tileAt(order.tx, order.ty);
      if (!t) return false;
      if (t.type === TILE.ICE) return t.iceRemaining > 0;
      return isPlainGround(t);
    }
    if (order.type === 'haul') {
      const t = tileAt(order.sourceTx, order.sourceTy);
      if (!t) return false;
      if (t.type === TILE.ICE) return t.iceRemaining > 0;
      return isPlainGround(t);
    }
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
    const last = unit.lastOrder;
    unit.order = null;
    if (last && canRepeat(last)) unit.order = resetOrder(last);
  }

  function setOrderMarker(x, y) {
    state.orderMarker = { x, y, t: 0 };
  }

  function assignOrder(units, order, marker) {
    for (const u of units) {
      u.order = resetOrder(order);
      u.lastOrder = cloneOrder(u.order);
      u.blockedReason = null;
      u.status = order.type;
    }
    if (marker) setOrderMarker(marker.x, marker.y);
    emit('order');
  }

  function mineTick(unit, tx, ty, dt) {
    const t = tileAt(tx, ty);
    if (!t) return 'gone';
    const space = C.haulerCarry - cargoAmount(unit);
    if (space <= 0) return 'full';
    if (unit.battery <= 0) return 'empty';
    const take = Math.min(space, C.haulerMinePerSecond * dt);
    if (t.type === TILE.ICE && t.iceRemaining > 0) {
      const got = Math.min(take, t.iceRemaining);
      unit.cargo.ice += got;
      t.iceRemaining -= got;
      if (t.iceRemaining <= 0.0001) {
        t.iceRemaining = 0;
        t.type = TILE.ICE_MINED;
      }
      return 'mined';
    }
    if (isPlainGround(t)) {
      unit.cargo.regolith += take;
      return 'mined';
    }
    return 'gone';
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
    if (unit.status === 'blocked') return unit.blockedReason || 'Blocked';
    if (unit.status === 'idle') return 'Idle';
    return '';
  }

  function updateUnit(unit, dt) {
    if (!unit.order && unit.lastOrder && canRepeat(unit.lastOrder) && !unit.blockedReason) {
      unit.order = resetOrder(unit.lastOrder);
    }
    const order = unit.order;
    if (!order) {
      refreshUnitStatus(unit);
      return;
    }

    if (order.type === 'go') {
      if (moveToward(unit, order.x, order.y, dt) === 'arrived') finishOrder(unit);
      refreshUnitStatus(unit);
      return;
    }

    if (order.type === 'mine') {
      const c = tileCenter(order.tx, order.ty);
      if (!closeToTile(unit, order.tx, order.ty)) {
        moveToward(unit, c.x, c.y, dt);
        refreshUnitStatus(unit);
        return;
      }
      const r = mineTick(unit, order.tx, order.ty, dt);
      if (r === 'gone') finishOrder(unit);
      refreshUnitStatus(unit);
      return;
    }

    if (order.type === 'charge') {
      const b = buildingById(order.buildingId) || habitat();
      if (!b) { finishOrder(unit); refreshUnitStatus(unit); return; }
      if (!canChargeAt(unit, b)) {
        const spot = chargeSpot(b);
        moveToward(unit, spot.x, spot.y, dt);
        refreshUnitStatus(unit);
        return;
      }
      if (unit.battery >= C.haulerBattery - 0.01) {
        finishOrder(unit);
        refreshUnitStatus(unit);
        return;
      }
      const room = C.haulerBattery - unit.battery;
      const tot = totals();
      const amt = Math.min(room, C.haulerChargePerSecond * dt, tot.power);
      if (amt > 0) {
        spendPower(amt);
        unit.battery += amt;
      }
      refreshUnitStatus(unit);
      return;
    }

    if (order.type === 'build') {
      const b = buildingById(order.buildingId);
      if (!b || b.complete) { finishOrder(unit); refreshUnitStatus(unit); return; }
      const spot = tileCenter(b.tx, b.ty + buildingFootprint(b.type) - 0.5);
      if (Math.hypot(unit.x - spot.x, unit.y - spot.y) > C.tileSize * 0.7) {
        moveToward(unit, spot.x, spot.y, dt);
        refreshUnitStatus(unit);
        return;
      }
      b._builders = (b._builders || 0) + 1;
      refreshUnitStatus(unit);
      return;
    }

    if (order.type === 'dig') {
      const tile = currentDigTile();
      if (!tile) { finishOrder(unit); refreshUnitStatus(unit); return; }
      const c = tileCenter(tile.tx, tile.ty);
      if (!closeToTile(unit, tile.tx, tile.ty)) {
        moveToward(unit, c.x, c.y, dt);
        refreshUnitStatus(unit);
        return;
      }
      tile.diggers = (tile.diggers || 0) + 1;
      unit._digging = true;
      state.digging = true;
      refreshUnitStatus(unit);
      return;
    }

    if (order.type === 'haul') {
      const src = tileCenter(order.sourceTx, order.sourceTy);
      const dest = buildingById(order.destBuildingId) || nearestDrop(order.sourceTx, order.sourceTy);
      if (!dest) { finishOrder(unit); refreshUnitStatus(unit); return; }
      if (!order.phase) order.phase = 'toSource';
      if (order.phase === 'toSource') {
        if (moveToward(unit, src.x, src.y, dt) === 'arrived' || closeToTile(unit, order.sourceTx, order.sourceTy)) {
          order.phase = 'mine';
        }
        refreshUnitStatus(unit);
        return;
      }
      if (order.phase === 'mine') {
        const r = mineTick(unit, order.sourceTx, order.sourceTy, dt);
        if (r === 'full' || r === 'gone') order.phase = 'toDest';
        refreshUnitStatus(unit);
        return;
      }
      if (order.phase === 'toDest') {
        const spot = chargeSpot(dest);
        if (moveToward(unit, spot.x, spot.y, dt) === 'arrived' || chebyshevToBuilding(worldToTile(unit.x, unit.y).tx, worldToTile(unit.x, unit.y).ty, dest) <= 1) {
          order.phase = 'unload';
        }
        refreshUnitStatus(unit);
        return;
      }
      if (order.phase === 'unload') {
        const moved = deposit(unit, dest);
        if (moved.ice > 0 && (dest.type === 'habitat' || dest.type === 'storage')) {
          state.stats.usedHaulers = true;
        }
        if (dest.type === 'tunnel-hub') {
          dest.outboundIce = (dest.outboundIce || 0) + moved.ice;
          dest.outboundReg = (dest.outboundReg || 0) + moved.regolith;
        }
        const leftover = cargoAmount(unit);
        if (leftover > 0.001) {
          const iceFull = unit.cargo.ice > 0.001 && dest.iceCap > 0 && dest.ice >= dest.iceCap - 1e-6;
          const blocked = iceFull || moved.total <= 1e-6;
          if (blocked) {
            const reason = iceFull ? 'Ice storage full' : 'Storage full';
            if (unit.blockedReason !== reason) toast(reason);
            unit.blockedReason = reason;
            refreshUnitStatus(unit);
            return;
          }
        }
        unit.blockedReason = null;
        const t = tileAt(order.sourceTx, order.sourceTy);
        const empty = t && t.type === TILE.ICE && t.iceRemaining <= 0;
        if (empty) {
          unit.order = null;
          unit.lastOrder = null;
        } else {
          order.phase = 'toSource';
        }
      }
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

  function iceRoomAtHub(hub) {
    let room = Math.max(0, hub.iceCap - hub.ice);
    for (const v of vaultsBeside(hub)) room += Math.max(0, v.iceCap - v.ice);
    return room;
  }

  function fillVaultsFrom(hub) {
    const reserved = Math.max(0, hub.outboundIce || 0);
    let free = Math.max(0, hub.ice - reserved);
    for (const v of vaultsBeside(hub)) {
      const room = Math.max(0, v.iceCap - v.ice);
      const mv = Math.min(room, free);
      v.ice += mv;
      hub.ice -= mv;
      free -= mv;
    }
  }

  function pullVaultsTo(hub, amount) {
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

  function sendFromHub(hub) {
    if (!tunnelReady()) return;
    const dest = otherHub(hub);
    if (!dest) return;
    const wantIce = hub.outboundIce || 0;
    const wantReg = hub.outboundReg || 0;
    if (wantIce <= 1e-6 && wantReg <= 1e-6) return;
    const iceRoom = iceRoomAtHub(dest);
    const regRoom = Math.max(0, dest.regolithCap - dest.regolith);
    if (hub.ice < wantIce) pullVaultsTo(hub, wantIce - hub.ice);
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
    if (dest.ice > dest.iceCap) dest.ice = dest.iceCap;
    if (dest.regolith > dest.regolithCap) dest.regolith = dest.regolithCap;
    if (p.ice > 0 || p.regolith > 0) state.stats.usedTunnel = true;
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
    for (const hub of completeHubs()) {
      if (hub.ice <= 1e-6) pullVaultsTo(hub, hub.iceCap);
    }
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
        b.printTime += dt;
        if (b.printTime >= b.printNeeded) {
          b.printing = false;
          b.printTime = 0;
          const n = buildingFootprint(b.type);
          addHauler((b.tx + n) * C.tileSize + 8, (b.ty + n * 0.5) * C.tileSize);
          emit('build-complete', { kind: 'hauler' });
        }
      }
    }
  }

  function update(dt) {
    if (dt <= 0) return;
    state.digging = false;
    for (const u of state.units) u._digging = false;
    addPower(solarOutputPerSecond() * dt);
    for (const u of state.units) updateUnit(u, dt);
    updateDigTiles(dt);
    updateBuildings(dt);
    updateCargo(dt);
    updateExpedition(dt);
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
    if (state.selectedIds.length) emit('select');
  }

  function selectBuilding(bid) {
    state.selectedBuildingId = bid;
    state.selectedIds = [];
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

  function issueContextual(x, y) {
    const units = selectedUnits();
    if (!units.length) return false;
    const { tx, ty } = worldToTile(x, y);
    const tile = tileAt(tx, ty);
    const b = buildingAtTile(tx, ty);

    if (state.armedOrder === 'dig' || state.digPick) {
      if (!state.digPick) {
        const corridor = corridorBetweenHubs();
        if (corridor && corridor.length) {
          state.tunnel = { tiles: corridor, packets: state.tunnel.packets };
          const mark = tileCenter(corridor[0].tx, corridor[0].ty);
          assignOrder(units, { type: 'dig' }, mark);
          state.armedOrder = null;
          return true;
        }
        state.digPick = { tx, ty };
        return true;
      }
      startDigLine(state.digPick.tx, state.digPick.ty, tx, ty);
      assignOrder(units, { type: 'dig' }, tileCenter(tx, ty));
      state.digPick = null;
      state.armedOrder = null;
      return true;
    }

    if (state.armedOrder === 'haul' || state.haulPick) {
      if (!state.haulPick) {
        state.haulPick = { sourceTx: tx, sourceTy: ty };
        return true;
      }
      const dest = b && b.complete ? b : nearestDrop(tx, ty);
      if (!dest) return false;
      assignOrder(units, {
        type: 'haul',
        sourceTx: state.haulPick.sourceTx,
        sourceTy: state.haulPick.sourceTy,
        destBuildingId: dest.id,
        phase: 'toSource',
      }, tileCenter(state.haulPick.sourceTx, state.haulPick.sourceTy));
      state.haulPick = null;
      state.armedOrder = null;
      return true;
    }

    if (state.armedOrder === 'mine' && tile) {
      assignOrder(units, { type: 'mine', tx, ty }, tileCenter(tx, ty));
      state.armedOrder = null;
      return true;
    }

    if (state.armedOrder === 'charge') {
      const dest = (b && (b.type === 'habitat' || b.type === 'solar')) ? b : habitat();
      assignOrder(units, { type: 'charge', buildingId: dest.id }, tileCenter(dest.tx, dest.ty));
      state.armedOrder = null;
      return true;
    }

    if (b && !b.complete) {
      assignOrder(units, { type: 'build', buildingId: b.id }, tileCenter(b.tx, b.ty));
      return true;
    }
    if (b && (b.type === 'habitat' || b.type === 'solar')) {
      assignOrder(units, { type: 'charge', buildingId: b.id }, tileCenter(b.tx, b.ty));
      return true;
    }
    if (tile && tile.type === TILE.ICE) {
      assignOrder(units, { type: 'mine', tx, ty }, tileCenter(tx, ty));
      return true;
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
    if (!canPlace(type, tx, ty)) return null;
    if (totals().regolith < spec.reg) return null;
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

  function startPrint() {
    const p = state.buildings.find((b) => b.type === 'printer' && b.complete && !b.printing);
    if (!p) return false;
    const tot = totals();
    if (tot.regolith < C.printerHaulerCostRegolith || tot.power < C.printerHaulerCostPower) return false;
    spendRegolith(C.printerHaulerCostRegolith);
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
      const room = Math.max(0, b.iceCap - b.ice);
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
    stampTerrain(8, 8, TILE.CRATER_S);
    stampTerrain(32, 10, TILE.CRATER_S);
    stampTerrain(6, 28, TILE.CRATER_S);
    stampTerrain(30, 32, TILE.CRATER_S);
    stampTerrain(12, 30, TILE.PIT);
    stampTerrain(22, 8, TILE.CRATER_S);
    stampTerrain(10, 22, TILE.CRATER_S);
    stampTerrain(28, 28, TILE.PIT);
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
    canLandCrew,
    landCrew,
    currentSol,
    noteExpedition,
  };
}
