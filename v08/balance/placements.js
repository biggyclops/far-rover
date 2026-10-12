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
  const cx = tx + Math.floor(n / 2);
  const cy = ty + Math.floor(n / 2);
  return game.inCommandRange(cx, cy);
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

export function nearestLegalDrop(game) {
  const probe = game || unlockedProbe();
  const ice = probe.state.deepIce;
  if (!ice?.unlocked) return { distance: Infinity, at: null, type: null };
  let best = null;
  for (const type of ['storage', 'tunnel-hub']) {
    for (const spot of listLegalDrops(probe, type)) {
      if (!best || spot.d < best.d) best = { ...spot, type };
    }
  }
  return {
    distance: best ? best.d : Infinity,
    at: best,
    type: best?.type || null,
    ice: { tx: ice.tx, ty: ice.ty },
  };
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
      if (!game.inCommandRange(vx + 1, vy + 1)) continue;
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

export function listTunnelPlans(game) {
  const probe = game || unlockedProbe();
  const fars = listFarHubs(probe);
  const minSep = probe.C.tunnelHubMinSeparationTiles || 6;
  const plans = [];
  const seen = new Set();

  function add(id, far, home, vault, corr) {
    if (!far || !home) return;
    const key = uniqueKey([far, home, vault]);
    if (seen.has(key)) return;
    seen.add(key);
    plans.push({ id, far, home, vault, corr });
  }

  const p2 = P2_TUNNEL;
  if (probe.canPlace('tunnel-hub', p2.far.tx, p2.far.ty)
    && inRangePlacement(probe, 'tunnel-hub', p2.home.tx, p2.home.ty)) {
    add('p2', p2.far, p2.home, p2.vault, corridorLen(p2.home, p2.far));
  }

  for (const far of fars) {
    for (let ty = 0; ty < probe.C.mapHeight - 1; ty++) {
      for (let tx = 0; tx < probe.C.mapWidth - 1; tx++) {
        if (!inRangePlacement(probe, 'tunnel-hub', tx, ty)) continue;
        if (hubSep(far, { tx, ty }) < minSep) continue;
        const corr = corridorLen({ tx, ty }, far);
        if (corr == null || corr < 1) continue;
        const vault = findVault(probe, { tx, ty });
        if (!vault) continue;
        add(`corr-${corr}`, far, { tx, ty }, vault, corr);
      }
    }
  }
  plans.sort((a, b) => (a.corr ?? 99) - (b.corr ?? 99));
  const shortest = [];
  const used = new Set();
  for (const p of plans) {
    if (p.id === 'p2') {
      shortest.push(p);
      continue;
    }
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
    const best = all.find((p) => p.id !== 'auto');
    const auto = all.find((p) => p.id === 'auto') || { id: 'auto' };
    return best ? [best, auto] : [auto];
  }
  const all = listStorageLayouts(game);
  const best = all.find((p) => p.id === 'nearest-ice') || all.find((p) => p.id === 'p2-ring');
  const auto = all.find((p) => p.id === 'auto') || { id: 'auto' };
  return best ? [best, auto] : [auto];
}
