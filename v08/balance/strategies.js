// Scripted players. Every action is a real order: place, build, print, dig, haul, charge, land.
// No setResources / setTime / teleport / completeBuilding / unlockDeepIce.

export const STRATEGY_IDS = [
  'haulers-2',
  'haulers-plus-1',
  'haulers-plus-2',
  'tunnel-1-digger',
  'tunnel-2-diggers',
  'mixed',
];

export const STRATEGY_META = {
  'haulers-2': { family: 'haulers', label: 'Haulers only (2 start)', extraHaulers: 0, diggers: 0, tunnel: false },
  'haulers-plus-1': { family: 'haulers', label: 'Haulers + print 1', extraHaulers: 1, diggers: 0, tunnel: false },
  'haulers-plus-2': { family: 'haulers', label: 'Haulers + print 2', extraHaulers: 2, diggers: 0, tunnel: false },
  'tunnel-1-digger': { family: 'tunnel', label: 'Tunnel, 1 digger', extraHaulers: 0, diggers: 1, tunnel: true },
  'tunnel-2-diggers': { family: 'tunnel', label: 'Tunnel, 2 diggers', extraHaulers: 0, diggers: 2, tunnel: true },
  mixed: { family: 'mixed', label: 'Mixed (1 hauls, 1 digs)', extraHaulers: 0, diggers: 1, tunnel: true },
};

const BUILD_COST = {
  solar: (C) => C.rimSolarCostRegolith,
  storage: (C) => C.storageCostRegolith,
  printer: (C) => C.printerCostRegolith,
  'tunnel-hub': (C) => C.tunnelHubCostRegolith,
  vault: (C) => C.vaultCostRegolith,
};

export function haulersOf(game) {
  return game.state.units.filter((u) => u.kind === 'hauler');
}

export function predictDeepIce(game) {
  const C = game.C;
  const hx = C.habitatTileX + 1;
  const hy = C.habitatTileY + 1;
  const dx = C.expeditionTileX - hx;
  const dy = C.expeditionTileY - hy;
  const len = Math.hypot(dx, dy) || 1;
  const aimX = Math.round(hx + (dx / len) * C.commandRangeRadius);
  const aimY = Math.round(hy + (dy / len) * C.commandRangeRadius);
  const candidates = [];
  for (let r = 0; r < 8; r++) {
    for (let y = aimY - r; y <= aimY + r; y++) {
      for (let x = aimX - r; x <= aimX + r; x++) {
        const t = game.tileAt(x, y);
        if (t && t.type === 'ground' && !t.buildingId && !t.craterM) {
          candidates.push({ tx: x, ty: y });
        }
      }
    }
    if (candidates.length) break;
  }
  return candidates[0] || { tx: aimX, ty: aimY };
}

function footprint(game, type) {
  return type === 'vault' ? game.C.vaultFootprint : game.C.buildingFootprint;
}

function overlaps(a, b, na, nb) {
  return a.tx < b.tx + nb && a.tx + na > b.tx && a.ty < b.ty + nb && a.ty + na > b.ty;
}

export function findPlace(game, type, preferTx, preferTy, extraBlocked = []) {
  const n = footprint(game, type);
  let best = null;
  let bestD = Infinity;
  for (let ty = 0; ty < game.C.mapHeight - n + 1; ty++) {
    for (let tx = 0; tx < game.C.mapWidth - n + 1; tx++) {
      if (!game.canPlace(type, tx, ty)) continue;
      if (extraBlocked.some((b) => overlaps({ tx, ty }, b, n, b.n || 2))) continue;
      const d = Math.hypot(tx - preferTx, ty - preferTy);
      if (d < bestD) {
        best = { tx, ty };
        bestD = d;
      }
    }
  }
  return best;
}

function shareAxis(a, b, n = 2) {
  const shareRow = Math.max(a.ty, b.ty) <= Math.min(a.ty + n - 1, b.ty + n - 1);
  const shareCol = Math.max(a.tx, b.tx) <= Math.min(a.tx + n - 1, b.tx + n - 1);
  return { shareRow, shareCol };
}

function reservedBuildTiles(game) {
  const reserved = new Set();
  const deep = game.state.deepIce.unlocked
    ? { tx: game.state.deepIce.tx, ty: game.state.deepIce.ty }
    : predictDeepIce(game);
  reserved.add(`${deep.tx},${deep.ty}`);
  reserved.add(`${game.C.shallowIceTileX},${game.C.shallowIceTileY}`);
  return { reserved, deep };
}

function chebyshevToTile(tx, ty, n, iceTx, iceTy) {
  const dx = iceTx < tx ? tx - iceTx : iceTx > tx + n - 1 ? iceTx - (tx + n - 1) : 0;
  const dy = iceTy < ty ? ty - iceTy : iceTy > ty + n - 1 ? iceTy - (ty + n - 1) : 0;
  return Math.max(dx, dy);
}

function footprintFree(game, type, tx, ty, reserved, extra = []) {
  const n = footprint(game, type);
  if (tx < 0 || ty < 0 || tx + n > game.C.mapWidth || ty + n > game.C.mapHeight) return false;
  if (extra.some((b) => overlaps({ tx, ty }, b, n, b.n || 2))) return false;
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const px = tx + x;
      const py = ty + y;
      if (reserved.has(`${px},${py}`)) return false;
      const t = game.tileAt(px, py);
      if (!t || t.type !== 'ground' || t.buildingId || t.craterM) return false;
    }
  }
  if (type === 'tunnel-hub' && game.state.buildings.filter((b) => b.type === 'tunnel-hub').length >= game.C.tunnelHubCount) {
    return false;
  }
  return true;
}

const CLASSIC_TUNNEL = { home: { tx: 14, ty: 21 }, far: { tx: 28, ty: 21 }, vault: { tx: 11, ty: 21 } };

export function planTunnelSites(game) {
  const { reserved, deep } = reservedBuildTiles(game);
  const hab = game.habitat();
  const farCands = [];
  for (let ty = 0; ty < game.C.mapHeight - 1; ty++) {
    for (let tx = 0; tx < game.C.mapWidth - 1; tx++) {
      if (!footprintFree(game, 'tunnel-hub', tx, ty, reserved)) continue;
      const d = chebyshevToTile(tx, ty, 2, deep.tx, deep.ty);
      if (d >= 1 && d <= 4) farCands.push({ tx, ty, d });
    }
  }
  farCands.sort((a, b) => a.d - b.d || Math.hypot(a.tx - hab.tx, a.ty - hab.ty) - Math.hypot(b.tx - hab.tx, b.ty - hab.ty));

  let best = null;
  let bestScore = Infinity;
  for (const far of farCands) {
    for (let ty = 0; ty < game.C.mapHeight - 1; ty++) {
      for (let tx = 0; tx < game.C.mapWidth - 1; tx++) {
        if (tx === far.tx && ty === far.ty) continue;
        if (!footprintFree(game, 'tunnel-hub', tx, ty, reserved, [{ ...far, n: 2 }])) continue;
        const { shareRow, shareCol } = shareAxis({ tx, ty }, far);
        if (!shareRow && !shareCol) continue;
        const dHab = Math.hypot(tx - hab.tx, ty - hab.ty);
        const corridor = shareRow
          ? Math.abs(tx < far.tx ? far.tx - (tx + 2) : tx - (far.tx + 2))
          : Math.abs(ty < far.ty ? far.ty - (ty + 2) : ty - (far.ty + 2));
        if (corridor < 2 || corridor > 24) continue;
        const score = far.d * 8 + dHab + corridor * 0.35;
        if (score < bestScore) {
          bestScore = score;
          best = { far: { tx: far.tx, ty: far.ty }, home: { tx, ty }, deep };
        }
      }
    }
    if (best && best.far.d === 1) break;
  }

  if (!best && footprintFree(game, 'tunnel-hub', CLASSIC_TUNNEL.home.tx, CLASSIC_TUNNEL.home.ty, reserved)
    && footprintFree(game, 'tunnel-hub', CLASSIC_TUNNEL.far.tx, CLASSIC_TUNNEL.far.ty, reserved, [{ ...CLASSIC_TUNNEL.home, n: 2 }])) {
    best = { ...CLASSIC_TUNNEL, deep };
  }
  if (!best) {
    const far = findPlace(game, 'tunnel-hub', deep.tx - 3, deep.ty, [{ tx: deep.tx, ty: deep.ty, n: 1 }]);
    const home = far ? findPlace(game, 'tunnel-hub', hab.tx - 4, far.ty, [{ ...far, n: 2 }]) : null;
    best = { far, home, deep };
  }
  return best;
}

function issue(game, units, order) {
  if (!units.length) return false;
  game.selectUnits(units.map((u) => u.id));
  const marker = order.x != null
    ? { x: order.x, y: order.y }
    : game.tileCenter(order.tx || order.sourceTx || 0, order.ty || order.sourceTy || 0);
  game.assignOrder(units, order, marker);
  return true;
}

function busyBuildingOrDigging(u) {
  return u.order?.type === 'build' || u.order?.type === 'dig';
}

function charging(u) {
  return u.order?.type === 'charge' && u.battery < 90;
}

function haulMatches(u, sourceTx, sourceTy, destId) {
  return u.order?.type === 'haul'
    && u.order.sourceTx === sourceTx
    && u.order.sourceTy === sourceTy
    && u.order.destBuildingId === destId
    && !u.blockedReason;
}

function regolithTile(game) {
  // #28: no regolith mine within 4 tiles of any building.
  const hab = game.habitat();
  let best = null;
  let bestD = Infinity;
  for (let ty = 0; ty < game.C.mapHeight; ty++) {
    for (let tx = 0; tx < game.C.mapWidth; tx++) {
      const t = game.tileAt(tx, ty);
      if (!t || t.type !== 'ground' || t.buildingId || t.craterM) continue;
      if (game.inNoMineZone(tx, ty)) continue;
      const d = Math.hypot(tx - hab.tx, ty - hab.ty);
      if (d < bestD) {
        best = { tx, ty };
        bestD = d;
      }
    }
  }
  return best || { tx: hab.tx, ty: hab.ty + 6 };
}

function mineRegolith(game, units) {
  const free = units.filter((u) => !busyBuildingOrDigging(u) && !charging(u));
  if (!free.length) return;
  const src = regolithTile(game);
  const dest = game.habitat();
  const need = free.filter((u) => !haulMatches(u, src.tx, src.ty, dest.id));
  if (need.length) issue(game, need, {
    type: 'haul',
    sourceTx: src.tx,
    sourceTy: src.ty,
    destBuildingId: dest.id,
    phase: 'toSource',
  });
}

function placeAndBuild(game, units, type, tx, ty) {
  const cost = BUILD_COST[type](game.C);
  if (game.totals().regolith + 1e-6 < cost) {
    mineRegolith(game, units);
    return 'need-reg';
  }
  const spot = tx != null ? { tx, ty } : findPlace(game, type, game.habitat().tx + 3, game.habitat().ty + 3);
  if (!spot || !game.canPlace(type, spot.tx, spot.ty)) return 'blocked';
  const builders = units.filter((u) => !charging(u));
  if (!builders.length) return null;
  game.selectUnits(builders.map((u) => u.id));
  const b = game.placeBuilding(type, spot.tx, spot.ty, true);
  return b || 'blocked';
}

function ensureBuilding(game, mem, units, key, type, tx, ty) {
  if (mem[key]) {
    const b = game.buildingById(mem[key]);
    if (b && !b.complete) {
      const onIt = units.filter((u) => u.order?.type === 'build' && u.order.buildingId === b.id);
      if (!onIt.length) {
        const free = units.filter((u) => !charging(u) && u.order?.type !== 'dig');
        if (free.length) issue(game, free, { type: 'build', buildingId: b.id });
      }
      return 'building';
    }
    return b?.complete ? 'ready' : 'missing';
  }
  const b = placeAndBuild(game, units, type, tx, ty);
  if (b && typeof b === 'object') {
    mem[key] = b.id;
    return 'placed';
  }
  if (b === 'need-reg') return 'waiting';
  if (b === 'blocked') return 'blocked';
  return 'waiting';
}

function iceDest(game, preferTypes) {
  let best = null;
  let room = -1;
  for (const b of game.state.buildings) {
    if (!b.complete || b.iceCap <= 0) continue;
    if (preferTypes && !preferTypes.includes(b.type)) continue;
    const r = b.iceCap - b.ice;
    if (r > room) {
      room = r;
      best = b;
    }
  }
  if (best) return best;
  return game.state.buildings.find((b) => b.complete && b.iceCap > 0) || game.habitat();
}

function stickyDest(game, mem, preferTypes) {
  const cur = mem.haulDestId && game.buildingById(mem.haulDestId);
  if (cur && cur.complete && cur.iceCap - cur.ice > 8) return cur;
  const next = iceDest(game, preferTypes);
  if (next) mem.haulDestId = next.id;
  return next;
}

function iceSource(game, mem, preferDeep) {
  if (preferDeep && game.state.deepIce.unlocked) {
    return { tx: game.state.deepIce.tx, ty: game.state.deepIce.ty };
  }
  const C = game.C;
  const shallow = game.tileAt(C.shallowIceTileX, C.shallowIceTileY);
  if (shallow && shallow.type === 'ice' && shallow.iceRemaining > 0) {
    return { tx: C.shallowIceTileX, ty: C.shallowIceTileY };
  }
  if (game.state.deepIce.unlocked) {
    return { tx: game.state.deepIce.tx, ty: game.state.deepIce.ty };
  }
  return null;
}

function assignHaul(game, units, source, dest, forceDest = false) {
  // Instincts own the loop (mine → haul → resume after charge). Re-issuing
  // toSource every think resets toDest and fights nearestDrop. Only kick a
  // new order when idle, blocked, or forceDest says the tube dest must win.
  const need = units.filter((u) => {
    if (charging(u)) return false;
    if (u.order?.type === 'build' || u.order?.type === 'dig') return false;
    if (u.resumeOrder && u.order?.type === 'charge') return false;
    if (u.blockedReason && /full/i.test(u.blockedReason)) return true;
    if (forceDest && dest && u.order?.type === 'haul' && u.order.destBuildingId !== dest.id
      && u.order.phase !== 'unload' && u.order.phase !== 'mine') {
      return true;
    }
    if (u.order?.type === 'haul' || u.order?.type === 'mine') return false;
    if (!u.order && u.lastOrder?.type === 'haul' && (!forceDest || u.lastOrder.destBuildingId === dest?.id)) return false;
    return true;
  });
  if (need.length) {
    issue(game, need, {
      type: 'haul',
      sourceTx: source.tx,
      sourceTy: source.ty,
      destBuildingId: dest.id,
      phase: 'toSource',
    });
  }
}

function iceCapReady(game) {
  return game.storedForGoal().iceCap + 1e-6 >= game.C.goalIceInStorage;
}

function maybeMoreStorage(game, mem, units) {
  if (iceCapReady(game)) return 'ready';
  const storages = Object.keys(mem).filter((k) => k.startsWith('storage')).length;
  const key = `storage${storages}`;
  const hab = game.habitat();
  return ensureBuilding(game, mem, units, key, 'storage', hab.tx + 4 + storages * 3, hab.ty + 3);
}

export function createBrain(strategyId) {
  const meta = STRATEGY_META[strategyId];
  if (!meta) throw new Error(`unknown strategy ${strategyId}`);
  const mem = { launched: false, printed: 0, digging: false, sites: null };

  return function think(game, scout) {
    if (!mem.launched) {
      scout.launch();
      mem.launched = true;
    }
    const units = haulersOf(game);
    if (game.canLandCrew()) {
      game.landCrew();
      return;
    }

    if (meta.family === 'haulers') return thinkHaulers(game, mem, units, meta);
    if (meta.family === 'tunnel') return thinkTunnel(game, mem, units, meta);
    return thinkMixed(game, mem, units, meta);
  };
}

function thinkHaulers(game, mem, units, meta) {
  const hab = game.habitat();
  const storage = maybeMoreStorage(game, mem, units);
  if (storage !== 'ready' && !mem.storage0) return;

  const crew = units.filter((u) => !charging(u));
  const builder = crew[0] ? [crew[0]] : [];
  const rest = crew.slice(1);

  if (meta.extraHaulers > 0) {
    const printer = ensureBuilding(game, mem, builder, 'printer', 'printer', hab.tx - 4, hab.ty);
    if (printer !== 'ready') {
      const src = iceSource(game, mem, true);
      if (src && mem.storage0 && game.buildingById(mem.storage0)?.complete) {
        assignHaul(game, rest, src, stickyDest(game, mem, ['storage', 'habitat']));
      }
      return;
    }
    const p = game.buildingById(mem.printer);
    if (mem.printed < meta.extraHaulers) {
      if (p && !p.printing) {
        const tot = game.totals();
        if (tot.regolith + 1e-6 < game.C.printerHaulerCostRegolith) {
          mineRegolith(game, builder);
        } else if (game.startPrint()) {
          mem.printed += 1;
        }
      }
      const src = iceSource(game, mem, true);
      if (src && mem.storage0 && game.buildingById(mem.storage0)?.complete) {
        assignHaul(game, rest, src, stickyDest(game, mem, ['storage', 'habitat']));
      }
      return;
    }
  }

  if (storage !== 'ready') {
    maybeMoreStorage(game, mem, units.filter((u) => !charging(u)));
    const srcEarly = iceSource(game, mem, true);
    if (srcEarly && mem.storage0 && game.buildingById(mem.storage0)?.complete) {
      const free = units.filter((u) => !charging(u) && u.order?.type !== 'build');
      assignHaul(game, free, srcEarly, stickyDest(game, mem, ['storage', 'habitat']));
    }
    return;
  }

  const src = iceSource(game, mem, true);
  if (!src) return;
  const dest = stickyDest(game, mem, ['storage', 'habitat']);
  assignHaul(game, units, src, dest);
}

function thinkTunnel(game, mem, units, meta) {
  if (!mem.sites) mem.sites = planTunnelSites(game);
  const { home, far } = mem.sites || {};
  if (!home || !far) return;

  const all = units.filter((u) => !charging(u));
  const homeSt = ensureBuilding(game, mem, all, 'homeHub', 'tunnel-hub', home.tx, home.ty);
  if (homeSt === 'blocked') { mem.sites = planTunnelSites(game); return; }
  if (homeSt !== 'ready') return;
  const farSt = ensureBuilding(game, mem, all, 'farHub', 'tunnel-hub', far.tx, far.ty);
  if (farSt === 'blocked') {
    mem.sites = planTunnelSites(game);
    delete mem.farHub;
    return;
  }
  if (farSt !== 'ready') return;
  const vaultSpot = mem.sites.vault || findPlace(game, 'vault', home.tx - 3, home.ty);
  const vaultSt = vaultSpot
    ? ensureBuilding(game, mem, all, 'vault', 'vault', vaultSpot.tx, vaultSpot.ty)
    : 'blocked';
  if (vaultSt !== 'ready') {
    if (vaultSt === 'blocked') {
      const spot = findPlace(game, 'vault', home.tx + 3, home.ty);
      if (spot) ensureBuilding(game, mem, all, 'vault', 'vault', spot.tx, spot.ty);
    }
    return;
  }

  if (!game.tunnelReady()) {
    if (!mem.digging) {
      const tiles = game.startDigCorridor();
      if (tiles && tiles.length) {
        mem.digging = true;
        const diggers = all.slice(0, meta.diggers);
        issue(game, diggers, { type: 'dig' });
      }
    } else {
      const digging = units.filter((u) => u.order?.type === 'dig');
      if (digging.length < meta.diggers) {
        const free = all.filter((u) => u.order?.type !== 'dig' && u.order?.type !== 'build');
        issue(game, free.slice(0, meta.diggers - digging.length), { type: 'dig' });
      }
    }
    return;
  }

  const stored = game.storedForGoal();
  if (stored.iceCap + 1e-6 < game.C.goalIceInStorage) {
    maybeMoreStorage(game, mem, all.slice(0, 1));
  }

  const src = iceSource(game, mem, true);
  if (!src) return;
  const vault = game.buildingById(mem.vault);
  // Hubs are not scoring storage, and the home hub will pull ice back out of a
  // full vault. Keep feeding the tube until the vault is actually full, then
  // finish into habitat/storage.
  const vaultFull = vault && vault.ice >= vault.iceCap - 8;
  const dest = (!vaultFull && stored.iceCap - stored.ice > 8)
    ? game.buildingById(mem.farHub)
    : stickyDest(game, mem, ['storage', 'habitat']);
  if (!dest) return;
  const haulers = units.filter((u) => u.order?.type !== 'build');
  if (vaultFull) {
    for (const u of haulers) {
      const aimed = u.order?.destBuildingId || u.lastOrder?.destBuildingId;
      if (aimed === mem.farHub && (u.order?.phase === 'toSource' || !u.order || u.blockedReason)) {
        u.order = null;
        u.lastOrder = null;
        u.resumeOrder = null;
      }
    }
  }
  assignHaul(game, haulers, src, dest, !vaultFull);
}

function thinkMixed(game, mem, units, meta) {
  if (!mem.sites) mem.sites = planTunnelSites(game);
  const haulerA = units[0] ? [units[0]] : [];
  const haulerB = units[1] ? [units[1]] : units.slice(0, 1);
  const rest = units.slice(2);
  const hab = game.habitat();

  if (ensureBuilding(game, mem, haulerA, 'storage0', 'storage', hab.tx + 4, hab.ty + 3) !== 'ready') {
    if (mem.sites?.home && game.totals().regolith >= game.C.tunnelHubCostRegolith) {
      ensureBuilding(game, mem, haulerB, 'homeHub', 'tunnel-hub', mem.sites.home.tx, mem.sites.home.ty);
    }
    return;
  }

  const { home, far } = mem.sites || {};
  if (home && far) {
    const tunnelCrew = [...haulerB, ...rest].filter((u) => !charging(u));
    const homeSt = ensureBuilding(game, mem, tunnelCrew, 'homeHub', 'tunnel-hub', home.tx, home.ty);
    const farSt = homeSt === 'ready'
      ? ensureBuilding(game, mem, tunnelCrew, 'farHub', 'tunnel-hub', far.tx, far.ty)
      : homeSt;
    if (homeSt === 'blocked' || farSt === 'blocked') {
      mem.sites = planTunnelSites(game);
      if (mem.homeHub && game.buildingById(mem.homeHub)) {
        const existing = game.buildingById(mem.homeHub);
        mem.sites.home = { tx: existing.tx, ty: existing.ty };
      }
      delete mem.farHub;
    } else if (homeSt === 'ready' && farSt === 'ready') {
      const vaultSpot = mem.sites.vault || findPlace(game, 'vault', home.tx - 3, home.ty);
      const vaultSt = vaultSpot
        ? ensureBuilding(game, mem, tunnelCrew, 'vault', 'vault', vaultSpot.tx, vaultSpot.ty)
        : 'blocked';
      if (vaultSt === 'ready' && !game.tunnelReady() && !mem.digging) {
        const tiles = game.startDigCorridor();
        if (tiles && tiles.length) {
          mem.digging = true;
          issue(game, tunnelCrew.slice(0, meta.diggers), { type: 'dig' });
        }
      }
    }
  }

  if (!iceCapReady(game) && game.storedForGoal().ice + 1e-6 >= game.storedForGoal().iceCap - 1) {
    maybeMoreStorage(game, mem, haulerA);
  }

  if (game.tunnelReady() && game.state.deepIce.unlocked) {
    const src = iceSource(game, mem, true);
    const dest = game.buildingById(mem.farHub);
    if (src && dest) assignHaul(game, units, src, dest, true);
    return;
  }

  const src = iceSource(game, mem, true);
  if (src && mem.storage0 && game.buildingById(mem.storage0)?.complete) {
    const surface = haulerA.filter((u) => !charging(u) && u.order?.type !== 'build');
    assignHaul(game, surface, src, iceDest(game, ['storage', 'habitat']));
  }
}
