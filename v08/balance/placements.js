// Hub and storage placement search. A single inner-ring layout is not enough:
// Player 2 won a 2-digger tunnel at 3:02 with ring-edge drops ~6 tiles from
// Deep Ice. The harness now tries P2's layouts plus the legal ring edge.

import { createGame } from '../game.js';

export const P2_HAULER_STORAGES = [
  { tx: 30, ty: 12 },
  { tx: 29, ty: 10 },
];

export const P2_TUNNEL = {
  far: { tx: 35, ty: 8 },
  home: { tx: 28, ty: 9 },
  vault: { tx: 25, ty: 6 },
};

// Player 2 r4: diagonal-touch line of 7 tiles, won at 3:34. Now illegal.
export const P2_DIAGONAL_334 = {
  far: { tx: 34, ty: 8 },
  home: { tx: 25, ty: 11 },
  line: { p0: { tx: 27, ty: 10 }, p1: { tx: 33, ty: 10 }, aligned: false, len: 7 },
};

export function chebyshevFootprint(tx, ty, n, x, y) {
  const dx = x < tx ? tx - x : x > tx + n - 1 ? x - (tx + n - 1) : 0;
  const dy = y < ty ? ty - y : y > ty + n - 1 ? y - (ty + n - 1) : 0;
  return Math.max(dx, dy);
}

export function euclidFootprint(tx, ty, n, x, y) {
  let min = Infinity;
  for (let dy = 0; dy < n; dy++) {
    for (let dx = 0; dx < n; dx++) {
      min = Math.min(min, Math.hypot((tx + dx) - x, (ty + dy) - y));
    }
  }
  return min;
}

function footprint(game, type) {
  return type === 'vault' ? game.C.vaultFootprint : game.C.buildingFootprint;
}

function inRangePlacement(game, type, tx, ty) {
  const n = footprint(game, type);
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      if (!game.inCommandRange(tx + x, ty + y)) return false;
    }
  }
  return true;
}

export function listLegalDrops(game, type) {
  const n = footprint(game, type);
  const out = [];
  const ice = game.state.deepIce;
  for (let ty = 0; ty < game.C.mapHeight - n + 1; ty++) {
    for (let tx = 0; tx < game.C.mapWidth - n + 1; tx++) {
      if (!game.canPlace(type, tx, ty)) continue;
      if (!inRangePlacement(game, type, tx, ty)) continue;
      const d = ice?.unlocked
        ? euclidFootprint(tx, ty, n, ice.tx, ice.ty)
        : Infinity;
      const cheb = ice?.unlocked
        ? chebyshevFootprint(tx, ty, n, ice.tx, ice.ty)
        : Infinity;
      out.push({ tx, ty, d, cheb });
    }
  }
  out.sort((a, b) => a.d - b.d || a.tx - b.tx || a.ty - b.ty);
  return out;
}

function cacheKey(game) {
  const C = game?.C;
  if (!C) return '';
  return [
    C.commandRangeRadius,
    C.deepIceTilesFromStartStorage,
    C.mapWidth,
    C.mapHeight,
    C.vaultFootprint,
    C.buildingFootprint,
  ].join('|');
}

let dropCache = { key: '', value: null };

export function nearestLegalDrop(game) {
  const probe = game || unlockedProbe();
  const ice = probe.state.deepIce;
  if (!ice?.unlocked) return { distance: Infinity, at: null, type: null };
  const key = cacheKey(probe);
  if (dropCache.key === key && dropCache.value) return dropCache.value;
  let best = null;
  for (const type of ['storage', 'tunnel-hub']) {
    for (const spot of listLegalDrops(probe, type)) {
      if (!best || spot.d < best.d) best = { ...spot, type };
    }
  }
  // Closest vault sits beside a ring-edge hub. Checking every in-range hub
  // is too slow; the nearest few hubs cover the ice-facing 9.85 poke.
  const hubs = listLegalDrops(probe, 'tunnel-hub').slice(0, 8);
  for (const hub of hubs) {
    const g = unlockedProbe();
    const placed = g.placeBuilding('tunnel-hub', hub.tx, hub.ty, false);
    if (!placed) continue;
    g.completeBuilding(placed.id);
    for (const spot of listLegalDrops(g, 'vault')) {
      if (!best || spot.d < best.d) best = { ...spot, type: 'vault', hub: { tx: hub.tx, ty: hub.ty } };
    }
  }
  const value = {
    distance: best ? best.d : Infinity,
    at: best,
    type: best?.type || null,
    ice: { tx: ice.tx, ty: ice.ty },
  };
  dropCache = { key, value };
  return value;
}

export function nearestLegalDropDistance(game) {
  return nearestLegalDrop(game).distance;
}

function unlockedProbe() {
  const g = createGame();
  g.unlockDeepIce();
  return g;
}

function canPlacePair(game, type, a, b) {
  return !!(a && b && game.canPlace(type, a.tx, a.ty) && game.canPlace(type, b.tx, b.ty));
}

function uniqueKey(parts) {
  return parts.map((p) => (p ? `${p.tx},${p.ty}` : '-')).join('|');
}

export function listStorageLayouts(game) {
  const probe = game || unlockedProbe();
  const spots = listLegalDrops(probe, 'storage');
  const layouts = [];
  const seen = new Set();

  function add(id, storages) {
    if (!storages?.[0] || !storages[1]) return;
    if (!canPlacePair(probe, 'storage', storages[0], storages[1])) return;
    const key = uniqueKey(storages);
    if (seen.has(key)) return;
    seen.add(key);
    layouts.push({ id, storages });
  }

  add('p2-ring', P2_HAULER_STORAGES);
  if (spots[0]) {
    const second = spots.find((s) => Math.max(Math.abs(s.tx - spots[0].tx), Math.abs(s.ty - spots[0].ty)) >= 2);
    add('nearest-ice', [spots[0], second || spots[1]].filter(Boolean));
  }
  const hubs = listLegalDrops(probe, 'tunnel-hub');
  if (hubs[0]) {
    const g = unlockedProbe();
    const placed = g.placeBuilding('tunnel-hub', hubs[0].tx, hubs[0].ty, false);
    if (placed) {
      g.completeBuilding(placed.id);
      const vaults = listLegalDrops(g, 'vault');
      if (vaults[0]) {
        layouts.push({
          id: 'hub-vault',
          drops: [
            { type: 'tunnel-hub', tx: hubs[0].tx, ty: hubs[0].ty },
            { type: 'vault', tx: vaults[0].tx, ty: vaults[0].ty },
          ],
        });
      }
    }
  }
  const hab = probe.habitat();
  if (hab) {
    const inner = spots
      .map((s) => ({ ...s, h: Math.hypot(s.tx - hab.tx, s.ty - hab.ty) }))
      .sort((a, b) => a.h - b.h);
    if (inner[0] && inner[1]) add('inner', [inner[0], inner[1]]);
  }
  layouts.push({ id: 'auto' });
  return layouts;
}

function listFarHubs(game) {
  const ice = game.state.deepIce;
  const n = game.C.buildingFootprint;
  const out = [];
  for (let ty = ice.ty - 3; ty <= ice.ty + 1; ty++) {
    for (let tx = ice.tx - 3; tx <= ice.tx + 1; tx++) {
      if (chebyshevFootprint(tx, ty, n, ice.tx, ice.ty) !== 1) continue;
      if (!game.canPlace('tunnel-hub', tx, ty)) continue;
      out.push({ tx, ty });
    }
  }
  return out;
}

function corridorLen(a, b) {
  const shareRow = Math.max(a.ty, b.ty) <= Math.min(a.ty + 1, b.ty + 1);
  const shareCol = Math.max(a.tx, b.tx) <= Math.min(a.tx + 1, b.tx + 1);
  if (shareRow) return a.tx < b.tx ? b.tx - a.tx - 2 : a.tx - b.tx - 2;
  if (shareCol) return a.ty < b.ty ? b.ty - a.ty - 2 : a.ty - b.ty - 2;
  return null;
}

function hubSep(a, b) {
  return Math.max(
    Math.max(a.tx - (b.tx + 1), b.tx - (a.tx + 1)),
    Math.max(a.ty - (b.ty + 1), b.ty - (a.ty + 1)),
  );
}

function findVault(game, home) {
  const n = game.C.vaultFootprint;
  for (let vy = home.ty - 3; vy <= home.ty + 2; vy++) {
    for (let vx = home.tx - 3; vx <= home.tx + 2; vx++) {
      const gapx = Math.max(vx - (home.tx + 1), home.tx - (vx + n - 1));
      const gapy = Math.max(vy - (home.ty + 1), home.ty - (vy + n - 1));
      if (Math.max(gapx, gapy) !== 1) continue;
      if (!inRangePlacement(game, 'vault', vx, vy)) continue;
      let ok = true;
      for (let y = 0; y < n && ok; y++) {
        for (let x = 0; x < n && ok; x++) {
          const t = game.tileAt(vx + x, vy + y);
          if (!t || t.type !== 'ground' || t.buildingId || t.craterM) ok = false;
          if (vx + x >= home.tx && vx + x <= home.tx + 1 && vy + y >= home.ty && vy + y <= home.ty + 1) ok = false;
        }
      }
      if (ok) return { tx: vx, ty: vy };
    }
  }
  return null;
}

export function lineOpts(home, far) {
  const opts = [];
  const [L, R] = home.tx < far.tx ? [home, far] : [far, home];
  for (let y = Math.max(L.ty, R.ty) - 1; y <= Math.min(L.ty, R.ty) + 2; y++) {
    const x0 = L.tx + 2;
    const x1 = R.tx - 1;
    if (x1 >= x0) {
      const aligned = y >= Math.max(L.ty, R.ty) && y <= Math.min(L.ty, R.ty) + 1;
      opts.push({
        p0: { tx: x0, ty: y },
        p1: { tx: x1, ty: y },
        len: x1 - x0 + 1,
        aligned,
      });
    }
  }
  const [T, B] = home.ty < far.ty ? [home, far] : [far, home];
  for (let x = Math.max(T.tx, B.tx) - 1; x <= Math.min(T.tx, B.tx) + 2; x++) {
    const y0 = T.ty + 2;
    const y1 = B.ty - 1;
    if (y1 >= y0) {
      const aligned = x >= Math.max(T.tx, B.tx) && x <= Math.min(T.tx, B.tx) + 1;
      opts.push({
        p0: { tx: x, ty: y0 },
        p1: { tx: x, ty: y1 },
        len: y1 - y0 + 1,
        aligned,
      });
    }
  }
  opts.sort((a, b) => a.len - b.len);
  return opts;
}

function vaultBesideHub(home, vx, vy, n) {
  const gapx = Math.max(vx - (home.tx + 1), home.tx - (vx + n - 1));
  const gapy = Math.max(vy - (home.ty + 1), home.ty - (vy + n - 1));
  return Math.max(gapx, gapy) === 1;
}

function vaultClearOfHub(vx, vy, n, hub) {
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const tx = vx + x;
      const ty = vy + y;
      if (tx >= hub.tx && tx <= hub.tx + 1 && ty >= hub.ty && ty <= hub.ty + 1) return false;
    }
  }
  return true;
}

function listVaultsNearHome(game, home, far, line) {
  const n = game.C.vaultFootprint;
  const out = [];
  for (let vy = home.ty - 4; vy <= home.ty + 3; vy++) {
    for (let vx = home.tx - 4; vx <= home.tx + 3; vx++) {
      if (!inRangePlacement(game, 'vault', vx, vy)) continue;
      if (!vaultBesideHub(home, vx, vy, n)) continue;
      if (!vaultClearOfHub(vx, vy, n, home)) continue;
      if (far && !vaultClearOfHub(vx, vy, n, far)) continue;
      if (line && !(line.p0.tx > vx + 2 || line.p1.tx < vx || line.p0.ty > vy + 2 || line.p1.ty < vy)) continue;
      let ok = true;
      for (let y = 0; y < n && ok; y++) {
        for (let x = 0; x < n && ok; x++) {
          const t = game.tileAt(vx + x, vy + y);
          if (!t || t.type !== 'ground' || t.buildingId || t.craterM) ok = false;
        }
      }
      if (ok) out.push({ tx: vx, ty: vy });
    }
  }
  return out;
}

let planCache = { key: '', plans: null };

export function listAllTunnelPlans(game) {
  const probe = game || unlockedProbe();
  if (!probe.state.deepIce.unlocked) probe.unlockDeepIce();
  const ice = probe.state.deepIce;
  const key = cacheKey(probe);
  if (planCache.key === key && planCache.plans) return planCache.plans;
  const fars = [];
  for (let ty = ice.ty - 2; ty <= ice.ty + 1; ty++) {
    for (let tx = ice.tx - 2; tx <= ice.tx + 1; tx++) {
      if (probe.canPlace('tunnel-hub', tx, ty) && !inRangePlacement(probe, 'tunnel-hub', tx, ty)) {
        fars.push({ tx, ty });
      }
    }
  }
  const plans = [];
  const seen = new Set();
  for (const far of fars) {
    const placed = unlockedProbe();
    placed.placeBuilding('tunnel-hub', far.tx, far.ty, false);
    for (let hy = 0; hy < probe.C.mapHeight - 1; hy++) {
      for (let hx = 0; hx < probe.C.mapWidth - 1; hx++) {
        if (!placed.canPlace('tunnel-hub', hx, hy)) continue;
        if (!inRangePlacement(placed, 'tunnel-hub', hx, hy)) continue;
        const home = { tx: hx, ty: hy };
        const opts = lineOpts(home, far);
        if (!opts.length) continue;
        for (const o of opts.slice(0, 2)) {
          const vaults = listVaultsNearHome(placed, home, far, o);
          if (!vaults.length) continue;
          const keyId = uniqueKey([far, home, vaults[0], o.p0, o.p1]);
          if (seen.has(keyId)) continue;
          seen.add(keyId);
          plans.push({
            id: o.aligned ? `corr-${o.len}` : `diag-${o.len}`,
            far,
            home,
            vault: vaults[0],
            corr: o.len,
            line: o,
            legal: !!o.aligned,
          });
        }
      }
    }
  }
  plans.sort((a, b) => (a.legal === b.legal ? 0 : a.legal ? -1 : 1) || a.corr - b.corr);
  planCache = { key, plans };
  return plans;
}

export function listTunnelPlans(game) {
  const all = listAllTunnelPlans(game);
  const legal = all.filter((p) => p.legal);
  const shortest = [];
  const used = new Set();
  for (const p of legal) {
    const k = `${p.far.tx},${p.far.ty}`;
    if (used.has(k) && shortest.length >= 3) continue;
    used.add(k);
    shortest.push(p);
    if (shortest.length >= 4) break;
  }
  shortest.push({ id: 'auto' });
  return shortest;
}

export function layoutsFor(strategyId, game) {
  const metaTunnel = strategyId.startsWith('tunnel') || strategyId === 'mixed';
  if (metaTunnel) {
    const all = listTunnelPlans(game);
    const best = all.filter((p) => p.id !== 'auto' && p.legal !== false);
    const auto = all.find((p) => p.id === 'auto') || { id: 'auto' };
    return best.length ? [...best.slice(0, 2), auto] : [auto];
  }
  const all = listStorageLayouts(game);
  const best = all.find((l) => l.id === 'nearest-ice') || all.find((l) => l.id === 'p2-ring');
  const hubVault = all.find((l) => l.id === 'hub-vault');
  const auto = all.find((l) => l.id === 'auto') || { id: 'auto' };
  const out = [];
  if (best) out.push(best);
  if (hubVault) out.push(hubVault);
  out.push(auto);
  return out;
}
