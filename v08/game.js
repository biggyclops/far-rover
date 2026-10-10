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

function isPlainGround(tile) {
  return tile && tile.type === TILE.GROUND;
}

function isBlockedForBuild(tile) {
  return !tile || tile.type !== TILE.GROUND || tile.buildingId || tile.craterM;
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
    armedOrder: null,
    camera: { x: 0, y: 0, zoom: C.defaultZoom },
    events: [],
    muted: false,
    stats: { notifies: 0, patches: 0, usedTunnel: false, usedHaulers: true },
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
    };
    state.units.push(u);
    return u;
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

  function deposit(unit, dest) {
    const iceRoom = Math.max(0, dest.iceCap - dest.ice);
    const regRoom = Math.max(0, dest.regolithCap - dest.regolith);
    const ice = Math.min(unit.cargo.ice, iceRoom);
    const reg = Math.min(unit.cargo.regolith, regRoom);
    dest.ice += ice;
    dest.regolith += reg;
    unit.cargo.ice -= ice;
    unit.cargo.regolith -= reg;
    return ice + reg;
  }

  function canPlace(type, tx, ty) {
    const n = buildingFootprint(type);
    if (tx < 0 || ty < 0 || tx + n > C.mapWidth || ty + n > C.mapHeight) return false;
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        if (isBlockedForBuild(tileAt(tx + x, ty + y))) return false;
      }
    }
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

  function updateUnit(unit, dt) {
    if (!unit.order && unit.lastOrder && canRepeat(unit.lastOrder)) {
      unit.order = resetOrder(unit.lastOrder);
    }
    const order = unit.order;
    if (!order) return;

    if (order.type === 'go') {
      if (moveToward(unit, order.x, order.y, dt) === 'arrived') finishOrder(unit);
      return;
    }

    if (order.type === 'mine') {
      const c = tileCenter(order.tx, order.ty);
      if (!closeToTile(unit, order.tx, order.ty)) {
        moveToward(unit, c.x, c.y, dt);
        return;
      }
      const r = mineTick(unit, order.tx, order.ty, dt);
      if (r === 'gone') finishOrder(unit);
      return;
    }

    if (order.type === 'charge') {
      const b = buildingById(order.buildingId) || habitat();
      if (!b) { finishOrder(unit); return; }
      if (!canChargeAt(unit, b)) {
        const spot = chargeSpot(b);
        moveToward(unit, spot.x, spot.y, dt);
        return;
      }
      if (unit.battery >= C.haulerBattery - 0.01) {
        finishOrder(unit);
        return;
      }
      const room = C.haulerBattery - unit.battery;
      const tot = totals();
      const amt = Math.min(room, C.haulerChargePerSecond * dt, tot.power);
      if (amt > 0) {
        spendPower(amt);
        unit.battery += amt;
      }
      return;
    }

    if (order.type === 'build') {
      const b = buildingById(order.buildingId);
      if (!b || b.complete) { finishOrder(unit); return; }
      const spot = tileCenter(b.tx, b.ty + buildingFootprint(b.type) - 0.5);
      if (Math.hypot(unit.x - spot.x, unit.y - spot.y) > C.tileSize * 0.7) {
        moveToward(unit, spot.x, spot.y, dt);
        return;
      }
      b._builders = (b._builders || 0) + 1;
      return;
    }

    if (order.type === 'haul') {
      const src = tileCenter(order.sourceTx, order.sourceTy);
      const dest = buildingById(order.destBuildingId) || nearestDrop(order.sourceTx, order.sourceTy);
      if (!dest) { finishOrder(unit); return; }
      if (!order.phase) order.phase = 'toSource';
      if (order.phase === 'toSource') {
        if (moveToward(unit, src.x, src.y, dt) === 'arrived' || closeToTile(unit, order.sourceTx, order.sourceTy)) {
          order.phase = 'mine';
        }
        return;
      }
      if (order.phase === 'mine') {
        const r = mineTick(unit, order.sourceTx, order.sourceTy, dt);
        if (r === 'full' || r === 'gone') order.phase = 'toDest';
        return;
      }
      if (order.phase === 'toDest') {
        const spot = chargeSpot(dest);
        if (moveToward(unit, spot.x, spot.y, dt) === 'arrived' || chebyshevToBuilding(worldToTile(unit.x, unit.y).tx, worldToTile(unit.x, unit.y).ty, dest) <= 1) {
          order.phase = 'unload';
        }
        return;
      }
      if (order.phase === 'unload') {
        deposit(unit, dest);
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
    addPower(solarOutputPerSecond() * dt);
    for (const u of state.units) updateUnit(u, dt);
    updateBuildings(dt);
    state.time += dt;
    if (state.orderMarker) {
      state.orderMarker.t += dt;
      if (state.orderMarker.t > 2.4) state.orderMarker = null;
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

  function unitAtWorld(x, y, radius = 22) {
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
  };
}
