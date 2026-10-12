// Scripted players. Every action is a UI-reachable order: place, print, Dig,
// or a right-click via issueContextual. No assignOrder dest shortcuts.

import { listTunnelPlans } from './placements.js';

export const STRATEGY_IDS = [
  'haulers-2',
  'haulers-plus-1',
  'haulers-plus-2',
  'haulers-plus-3',
  'haulers-plus-4',
  'tunnel-1-digger',
  'tunnel-2-diggers',
  'tunnel-3-diggers',
  'tunnel-4-diggers',
  'tunnel-plus-haulers',
  'mixed',
];

export const STRATEGY_META = {
  'haulers-2': { family: 'haulers', label: 'Haulers only (2 start)', extraHaulers: 0, diggers: 0, tunnel: false },
  'haulers-plus-1': { family: 'haulers', label: 'Haulers + print 1', extraHaulers: 1, diggers: 0, tunnel: false },
  'haulers-plus-2': { family: 'haulers', label: 'Haulers + print 2', extraHaulers: 2, diggers: 0, tunnel: false },
  'haulers-plus-3': { family: 'haulers', label: 'Haulers + print 3', extraHaulers: 3, diggers: 0, tunnel: false },
  'haulers-plus-4': { family: 'haulers', label: 'Haulers + print 4', extraHaulers: 4, diggers: 0, tunnel: false },
  'tunnel-1-digger': { family: 'tunnel', label: 'Tunnel, 1 digger', extraHaulers: 0, diggers: 1, tunnel: true },
  'tunnel-2-diggers': { family: 'tunnel', label: 'Tunnel, 2 diggers', extraHaulers: 0, diggers: 2, tunnel: true },
  'tunnel-3-diggers': { family: 'tunnel', label: 'Tunnel, 3 diggers', extraHaulers: 1, diggers: 3, tunnel: true },
  'tunnel-4-diggers': { family: 'tunnel', label: 'Tunnel, 4 diggers', extraHaulers: 2, diggers: 4, tunnel: true },
  'tunnel-plus-haulers': { family: 'tunnel', label: 'Tunnel + surface haulers', extraHaulers: 1, diggers: 2, tunnel: true, surfaceHaul: true },
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

function tileWorld(game, tx, ty) {
  return game.tileCenter(tx, ty);
}

function clickTile(game, units, tx, ty) {
  if (!units.length) return false;
  game.selectUnits(units.map((u) => u.id));
  const w = tileWorld(game, tx, ty);
  return game.issueContextual(w.x, w.y);
}

function clickWorld(game, units, x, y) {
  if (!units.length) return false;
  game.selectUnits(units.map((u) => u.id));
  return game.issueContextual(x, y);
}

function orderType(u) {
  return u.order?.type || null;
}

function canSpendPower(game) {
  return game.isDay() || game.storedForGoal().power > 80;
}

function tryPlace(game, units, type, preferTx, preferTy) {
  const C = game.C;
  const n = type === 'vault' ? C.vaultFootprint : C.buildingFootprint;
  const spots = [];
  for (let ty = 0; ty < C.mapHeight - n + 1; ty++) {
    for (let tx = 0; tx < C.mapWidth - n + 1; tx++) {
      if (!game.canPlace(type, tx, ty)) continue;
      spots.push({ tx, ty, d: Math.hypot(tx - preferTx, ty - preferTy) });
    }
  }
  spots.sort((a, b) => a.d - b.d);
  if (!spots.length) return null;
  game.selectUnits(units.map((u) => u.id));
  return game.placeBuilding(type, spots[0].tx, spots[0].ty, true);
}

function placeAt(game, units, type, tx, ty) {
  if (!game.canPlace(type, tx, ty)) return null;
  game.selectUnits(units.map((u) => u.id));
  return game.placeBuilding(type, tx, ty, true);
}

function regolithTile(game) {
  const hab = game.habitat();
  let best = null;
  let bestD = Infinity;
  for (let ty = 0; ty < game.C.mapHeight; ty++) {
    for (let tx = 0; tx < game.C.mapWidth; tx++) {
      if (!game.sourceHasWork(tx, ty)) continue;
      const t = game.tileAt(tx, ty);
      if (!t || t.type === 'ice') continue;
      const d = Math.hypot(tx - hab.tx, ty - hab.ty);
      if (d < bestD) {
        best = { tx, ty };
        bestD = d;
      }
    }
  }
  return best;
}

function iceSource(game) {
  if (game.state.deepIce.unlocked) {
    return { tx: game.state.deepIce.tx, ty: game.state.deepIce.ty };
  }
  const C = game.C;
  const shallow = game.tileAt(C.shallowIceTileX, C.shallowIceTileY);
  if (shallow && shallow.type === 'ice' && shallow.iceRemaining > 0) {
    return { tx: C.shallowIceTileX, ty: C.shallowIceTileY };
  }
  return null;
}

function iceCapReady(game) {
  return game.storedForGoal().iceCap + 1e-6 >= game.C.goalIceInStorage;
}

function buildersOf(units) {
  return units.filter((u) => {
    const t = orderType(u);
    if (t === 'charge') return u.battery >= 90;
    return t !== 'dig';
  });
}

function haulReady(units) {
  return units.filter((u) => {
    const t = orderType(u);
    if (t === 'build' || t === 'dig') return false;
    if (t === 'charge') return u.battery >= 90;
    if (t === 'haul') return u.status === 'blocked' || !!u.blockedReason;
    return true;
  });
}

function tendCharge(game, units) {
  if (!canSpendPower(game)) return;
  const hab = game.habitat();
  if (!hab) return;
  const low = units.filter((u) => u.battery <= 25 && orderType(u) !== 'charge');
  if (!low.length) return;
  const c = tileWorld(game, hab.tx + 1, hab.ty + 1);
  clickWorld(game, low, c.x, c.y);
}

function onIceJob(u, source) {
  return orderType(u) === 'haul'
    && source
    && u.order?.sourceTx === source.tx
    && u.order?.sourceTy === source.ty;
}

function tendHaul(game, units, source) {
  tendCharge(game, units);
  if (!source) return;
  const ready = units.filter((u) => {
    const t = orderType(u);
    if (t === 'build' || t === 'dig') return false;
    if (t === 'charge') return u.battery >= 90;
    if (onIceJob(u, source)) return u.status === 'blocked' || !!u.blockedReason;
    if (t === 'haul') {
      const carryingIce = (u.cargo?.ice || 0) > 0.001;
      if (carryingIce || u.order?.phase === 'unload' || u.order?.phase === 'mine') return false;
      return true;
    }
    return true;
  });
  if (ready.length) clickTile(game, ready, source.tx, source.ty);
}

function mineRegolith(game, units) {
  const src = regolithTile(game);
  if (!src) return;
  const already = units.filter((u) => (
    orderType(u) === 'haul' && u.order?.sourceTx === src.tx && u.order?.sourceTy === src.ty
  ));
  if (already.length) return;
  const free = units.filter((u) => {
    const t = orderType(u);
    if (t === 'build' || t === 'dig') return false;
    if (t === 'charge') return u.battery >= 90;
    if (t === 'haul') return false;
    return true;
  });
  if (free.length) clickTile(game, free.slice(0, 1), src.tx, src.ty);
}

function keepBuilding(game, units, building) {
  if (!building || building.complete) return 'ready';
  // Count builders on the whole roster. thinkHaulers passes a 1-hauler
  // subset for the second pad; if we only look at that subset, every think
  // yanks another ice hauler onto the build and delay-0 print-2 loses ~40 s.
  const onIt = haulersOf(game).filter((u) => orderType(u) === 'build' && u.order?.buildingId === building.id);
  if (!onIt.length) {
    const free = buildersOf(units);
    if (free.length) clickTile(game, free.slice(0, 1), building.tx, building.ty);
  }
  return 'building';
}

function afford(game, type) {
  return game.totals().regolith + 1e-6 >= BUILD_COST[type](game.C);
}

function ensurePlaced(game, mem, units, key, type, preferTx, preferTy, exact = null) {
  if (mem[key]) {
    const b = game.buildingById(mem[key]);
    if (!b) {
      delete mem[key];
    } else {
      return keepBuilding(game, units, b);
    }
  }
  if (!afford(game, type)) {
    mineRegolith(game, buildersOf(units));
    return 'waiting';
  }
  const crew = buildersOf(units);
  if (!crew.length) return 'waiting';
  const b = exact
    ? placeAt(game, crew, type, exact.tx, exact.ty)
    : tryPlace(game, crew, type, preferTx, preferTy);
  if (b) {
    mem[key] = b.id;
    return 'placed';
  }
  return 'blocked';
}

function ensureDrops(game, mem, units) {
  const drops = mem.layout?.drops;
  if (!drops?.length) return ensureStorages(game, mem, units, 2);
  for (let i = 0; i < drops.length; i++) {
    const d = drops[i];
    const st = ensurePlaced(game, mem, units, `drop${i}`, d.type, d.tx, d.ty, d);
    if (st !== 'ready') return st;
  }
  return 'ready';
}

function ensureStorages(game, mem, units, count) {
  const hab = game.habitat();
  const planned = mem.layout?.storages || [];
  for (let i = 0; i < count; i++) {
    const key = `storage${i}`;
    const exact = planned[i] || null;
    const st = ensurePlaced(
      game,
      mem,
      units,
      key,
      'storage',
      exact ? exact.tx : hab.tx + 4 + i * 3,
      exact ? exact.ty : hab.ty + 3,
      exact,
    );
    if (st !== 'ready') return st;
  }
  return 'ready';
}

function resolveTunnelLayout(game, layout) {
  if (layout?.far && layout?.home) return layout;
  const plan = listTunnelPlans(game).find((p) => p.far && p.home);
  if (!plan) return layout || {};
  return { ...layout, ...plan };
}

function placeFarHub(game, units, layout) {
  const deep = game.state.deepIce;
  if (!deep.unlocked) return null;
  const plan = resolveTunnelLayout(game, layout);
  if (plan?.far) {
    const exact = placeAt(game, units, 'tunnel-hub', plan.far.tx, plan.far.ty);
    if (exact) return exact;
  }
  for (let ty = deep.ty - 3; ty <= deep.ty + 1; ty++) {
    for (let tx = deep.tx - 3; tx <= deep.tx + 1; tx++) {
      const b = placeAt(game, units, 'tunnel-hub', tx, ty);
      if (b) return b;
    }
  }
  return tryPlace(game, units, 'tunnel-hub', deep.tx - 2, deep.ty - 1);
}

function placeHomeHub(game, units, farHub, layout) {
  const plan = resolveTunnelLayout(game, layout);
  if (plan?.home) {
    const exact = placeAt(game, units, 'tunnel-hub', plan.home.tx, plan.home.ty);
    if (exact) return exact;
  }
  const candidates = [];
  for (let tx = 0; tx < game.C.mapWidth - 1; tx++) candidates.push({ tx, ty: farHub.ty });
  for (let ty = 0; ty < game.C.mapHeight - 1; ty++) candidates.push({ tx: farHub.tx, ty });
  // Only axis-aligned homes keep a straight corridor. Prefer the ring edge
  // (closest to the far hub) so the harness sees Player 2's short haul.
  candidates.sort((a, b) => (
    Math.hypot(a.tx - farHub.tx, a.ty - farHub.ty) - Math.hypot(b.tx - farHub.tx, b.ty - farHub.ty)
  ));
  for (const p of candidates) {
    const b = placeAt(game, units, 'tunnel-hub', p.tx, p.ty);
    if (b) return b;
  }
  return null;
}

function placeVault(game, units, homeHub, layout) {
  const plan = resolveTunnelLayout(game, layout);
  if (plan?.vault) {
    const exact = placeAt(game, units, 'vault', plan.vault.tx, plan.vault.ty);
    if (exact) return exact;
  }
  const tries = [
    { tx: homeHub.tx - 3, ty: homeHub.ty },
    { tx: homeHub.tx + 2, ty: homeHub.ty },
    { tx: homeHub.tx, ty: homeHub.ty - 3 },
    { tx: homeHub.tx, ty: homeHub.ty + 2 },
  ];
  for (const p of tries) {
    const b = placeAt(game, units, 'vault', p.tx, p.ty);
    if (b) return b;
  }
  return tryPlace(game, units, 'vault', homeHub.tx - 3, homeHub.ty);
}

function tendDig(game, units, diggers) {
  tendCharge(game, units);
  const digging = units.filter((u) => orderType(u) === 'dig').length;
  if (digging >= diggers) return;
  const free = units.filter((u) => {
    const t = orderType(u);
    if (t === 'charge') return u.battery >= 90;
    return t !== 'build';
  });
  if (!free.length) return;
  const crew = free.slice(0, Math.max(1, diggers - digging));
  if (!game.state.tunnel.tiles.length) {
    const tiles = game.startDigCorridor();
    if (!tiles || !tiles.length) return;
  }
  game.state.armedOrder = 'dig';
  const tile = game.state.tunnel.tiles.find((x) => !x.done) || game.state.tunnel.tiles[0];
  if (tile) clickTile(game, crew, tile.tx, tile.ty);
  game.state.armedOrder = null;
}

export function createBrain(strategyId, opts = {}) {
  const meta = STRATEGY_META[strategyId];
  if (!meta) throw new Error(`unknown strategy ${strategyId}`);
  const mem = { launched: false, printed: 0, digging: false, layout: opts.layout || {} };

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

function emptyCrew(units) {
  return units.filter((u) => {
    const t = orderType(u);
    if ((u.cargo?.ice || 0) > 0.001) return false;
    if (t === 'build' || t === 'dig') return false;
    if (t === 'charge' && u.battery < 90) return false;
    return true;
  });
}

function tendPrint(game, mem, units, meta) {
  if (!meta.extraHaulers) return 'ready';
  const hab = game.habitat();
  const p = mem.printer && game.buildingById(mem.printer);
  if (!p) {
    ensurePlaced(game, mem, units, 'printer', 'printer', hab.tx - 4, hab.ty);
    return 'building';
  }
  if (!p.complete) {
    keepBuilding(game, units, p);
    return 'building';
  }
  if (mem.printed < meta.extraHaulers && !p.printing) {
    const printCost = typeof game.nextPrintCostRegolith === 'function'
      ? game.nextPrintCostRegolith()
      : game.C.printerHaulerCostRegolith;
    if (game.totals().regolith + 1e-6 < printCost) {
      mineRegolith(game, emptyCrew(units).slice(0, 1));
      return 'waiting';
    }
    if (game.totals().power + 1e-6 >= game.C.printerHaulerCostPower) {
      if (game.startPrint()) mem.printed += 1;
    }
    return 'printing';
  }
  if (p.printing || mem.printed < meta.extraHaulers) return 'printing';
  return 'ready';
}

function thinkHaulers(game, mem, units, meta) {
  const hab = game.habitat();
  const ice = iceSource(game);
  const pads = ['storage0', 'storage1'].filter((k) => game.buildingById(mem[k])?.complete).length;
  const miners = emptyCrew(units);

  if (meta.extraHaulers > 0) {
    const st = tendPrint(game, mem, units, meta);
    const p = mem.printer && game.buildingById(mem.printer);
    if (!p || !p.complete) return;
    if (st === 'waiting' && pads < 1) return;
  }

  if (mem.layout?.drops) {
    const st = ensureDrops(game, mem, units);
    if (st !== 'ready') return;
  } else if (pads < 2 && !iceCapReady(game)) {
    const crew = pads === 0 ? units : miners.slice(0, 1);
    const st = ensureStorages(game, mem, crew.length ? crew : units, 2);
    if (st !== 'ready' && pads === 0) return;
    const iceCrew = pads === 0
      ? []
      : units.filter((u) => !crew.includes(u));
    if (iceCrew.length) tendHaul(game, iceCrew, ice);
    if (st !== 'ready') return;
  }

  tendHaul(game, units, ice);
}

function thinkTunnel(game, mem, units, meta) {
  const crew = buildersOf(units);
  if (meta.extraHaulers > 0) {
    tendPrint(game, mem, units, meta);
    const p = mem.printer && game.buildingById(mem.printer);
    if (!p || !p.complete) return;
  }
  if (!game.state.deepIce.unlocked) return;
  if (!mem.layout?.far) mem.layout = resolveTunnelLayout(game, mem.layout);

  if (!mem.farHub) {
    const far = placeFarHub(game, crew, mem.layout);
    if (far) mem.farHub = far.id;
    else if (!afford(game, 'tunnel-hub')) mineRegolith(game, crew);
    return;
  }
  const farHub = game.buildingById(mem.farHub);
  if (keepBuilding(game, units, farHub) !== 'ready') return;

  if (!mem.homeHub) {
    const home = placeHomeHub(game, crew, farHub, mem.layout);
    if (home) mem.homeHub = home.id;
    else if (!afford(game, 'tunnel-hub')) mineRegolith(game, crew);
    return;
  }
  const homeHub = game.buildingById(mem.homeHub);
  if (keepBuilding(game, units, homeHub) !== 'ready') return;

  if (!mem.vault) {
    const vault = placeVault(game, crew, homeHub, mem.layout);
    if (vault) mem.vault = vault.id;
    else if (!afford(game, 'vault')) mineRegolith(game, crew);
    return;
  }
  const vault = game.buildingById(mem.vault);
  if (keepBuilding(game, units, vault) !== 'ready') return;

  if (!iceCapReady(game)) {
    ensureStorages(game, mem, crew.slice(0, 1), 1);
  }

  if (!game.tunnelReady()) {
    tendDig(game, units, meta.diggers);
    if (meta.surfaceHaul) {
      const hauling = units.filter((u) => orderType(u) !== 'dig' && orderType(u) !== 'build');
      tendHaul(game, hauling, iceSource(game));
    }
    return;
  }

  tendHaul(game, units, iceSource(game));
}

function thinkMixed(game, mem, units, meta) {
  const haulerA = units[0] ? [units[0]] : [];
  const haulerB = units.slice(1);
  const hab = game.habitat();

  const storageSt = ensurePlaced(game, mem, haulerA, 'storage0', 'storage', hab.tx + 4, hab.ty + 3);
  if (storageSt === 'ready' && !iceCapReady(game) && game.storedForGoal().ice + 1e-6 >= game.storedForGoal().iceCap - 1) {
    ensureStorages(game, mem, haulerA, 2);
  }

  if (game.state.deepIce.unlocked && haulerB.length) {
    if (!mem.layout?.far) mem.layout = resolveTunnelLayout(game, mem.layout);
    if (!mem.farHub) {
      const far = placeFarHub(game, haulerB, mem.layout);
      if (far) mem.farHub = far.id;
    } else if (keepBuilding(game, haulerB, game.buildingById(mem.farHub)) === 'ready') {
      if (!mem.homeHub) {
        const home = placeHomeHub(game, haulerB, game.buildingById(mem.farHub), mem.layout);
        if (home) mem.homeHub = home.id;
      } else if (keepBuilding(game, haulerB, game.buildingById(mem.homeHub)) === 'ready') {
        if (!mem.vault) {
          if (!afford(game, 'vault')) mineRegolith(game, haulerB);
          else {
            const vault = placeVault(game, haulerB, game.buildingById(mem.homeHub), mem.layout);
            if (vault) mem.vault = vault.id;
          }
        } else if (keepBuilding(game, haulerB, game.buildingById(mem.vault)) === 'ready') {
          if (!game.tunnelReady()) tendDig(game, haulerB, meta.diggers);
        }
      }
    }
  }

  if (game.tunnelReady() && game.state.deepIce.unlocked) {
    tendHaul(game, units, iceSource(game));
    return;
  }

  if (storageSt === 'ready') tendHaul(game, haulerA, iceSource(game));
}
