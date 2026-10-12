// Headless driver for the real v08 sim. Imports createGame(); issues player orders only.

import { createGame } from '../game.js';
import { CONFIG, applyOverrides, restoreConfig, changedFromDefaults, DEFAULTS, expandOverrides } from './config-override.js';
import { attachScout } from './scout.js';
import { createBrain, STRATEGY_IDS, STRATEGY_META, haulersOf } from './strategies.js';
import { layoutsFor, nearestLegalDrop } from './placements.js';

export { STRATEGY_IDS, STRATEGY_META, CONFIG, DEFAULTS, changedFromDefaults };

export function formatTime(seconds) {
  if (seconds == null || !Number.isFinite(seconds)) return '—';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

function syncStartHaulers(game) {
  // bootstrap() hardcodes two haulers. Honor CONFIG.startHaulers as a
  // start-of-game rule so the documented sweep key actually moves the needle.
  const want = game.C.startHaulers;
  const hab = game.habitat();
  let n = haulersOf(game).length;
  while (n < want) {
    const c = game.tileCenter(hab.tx + (n % 4), hab.ty + 3);
    game.addHauler(c.x, c.y);
    n += 1;
  }
  while (n > want) {
    const idx = game.state.units.findIndex((u) => u.kind === 'hauler');
    if (idx < 0) break;
    game.state.units.splice(idx, 1);
    n -= 1;
  }
}

export function withOverrides(overrides, fn) {
  applyOverrides(overrides);
  try {
    return fn();
  } finally {
    restoreConfig();
  }
}

function betterResult(next, best) {
  if (!best) return true;
  if (next.won && !best.won) return true;
  if (!next.won && best.won) return false;
  if (next.won && best.won) return next.winTime < best.winTime;
  return next.ice > best.ice;
}

function runOnce(strategyId, opts, layout, applied) {
  const dt = opts.dt ?? 1 / 60;
  const thinkEvery = opts.thinkEvery ?? 0.5;
  const maxSeconds = opts.maxSeconds ?? 30 * 60;
  const game = createGame();
  syncStartHaulers(game);
  const scout = attachScout(game);
  const think = createBrain(strategyId, { layout });
  let minPower = Infinity;
  let hitNight = false;
  let thinkAcc = 0;
  think(game, scout);

  while (game.state.time < maxSeconds && !game.state.won) {
    game.update(dt);
    scout.pump(dt);
    game.flushEvents();
    const stored = game.storedForGoal();
    if (stored.power < minPower) minPower = stored.power;
    if (!game.isDay()) hitNight = true;
    thinkAcc += dt;
    if (thinkAcc >= thinkEvery) {
      thinkAcc = 0;
      think(game, scout);
    }
  }

  if (game.canLandCrew() && !game.state.won) game.landCrew();
  const stored = game.storedForGoal();
  if (stored.power < minPower) minPower = stored.power;
  if (!game.isDay()) hitNight = true;

  const win = game.state.win;
  const firstNightAt = game.C.startDaylightRemainingSec ?? game.C.daySecondsAt1x;
  return {
    strategy: strategyId,
    label: STRATEGY_META[strategyId].label,
    family: STRATEGY_META[strategyId].family,
    layoutId: layout?.id || 'auto',
    layout: layout || null,
    won: !!win,
    winTime: win ? win.time : null,
    winTimeLabel: win ? formatTime(win.time) : 'timeout',
    hitNight: hitNight || (win ? win.time >= firstNightAt : game.state.time >= firstNightAt),
    powerMin: Number.isFinite(minPower) ? round1(minPower) : null,
    ice: round1(stored.ice),
    power: round1(stored.power),
    iceCap: stored.iceCap,
    logistics: win?.logistics || (game.state.stats.usedTunnel ? 'tunnel' : 'haulers only'),
    usedTunnel: !!game.state.stats.usedTunnel,
    deepIceUnlocked: !!game.state.deepIce.unlocked,
    time: round1(game.state.time),
    haulerCount: haulersOf(game).length,
    orders: haulersOf(game).map((u) => ({
      order: u.order?.type || null,
      status: u.status,
      blocked: u.blockedReason || null,
      cargo: Math.round((u.cargo?.ice || 0) + (u.cargo?.regolith || 0)),
      battery: Math.round(u.battery),
    })),
    buildings: game.state.buildings.map((b) => `${b.type}${b.complete ? '' : '*'}`),
    drop: nearestLegalDrop(),
    overrides: applied,
  };
}

export function runStrategy(strategyId, overrides = {}, opts = {}) {
  // Match the live page's 1x integrator (main.js advance uses 1/60).
  // Player 2 measured 44.8 / 45.4 / 47.2 s at 1x / 4x / 16x — do not run this
  // harness at 4x or 16x if you want numbers that match a 1x playtest.
  return withOverrides(overrides, () => {
    const applied = expandOverrides(overrides);
    const layouts = opts.layout
      ? [opts.layout]
      : (opts.searchPlacements === false ? [{ id: 'auto' }] : layoutsFor(strategyId));
    let best = null;
    const tried = [];
    for (const layout of layouts) {
      const r = runOnce(strategyId, opts, layout, applied);
      tried.push({ layoutId: r.layoutId, won: r.won, winTimeLabel: r.winTimeLabel, ice: r.ice });
      if (betterResult(r, best)) best = r;
    }
    if (best) best.triedLayouts = tried;
    return best;
  });
}

function round1(n) {
  return Math.round(n * 10) / 10;
}

export function runAllStrategies(overrides = {}, opts = {}) {
  const results = [];
  for (const id of STRATEGY_IDS) {
    results.push(runStrategy(id, overrides, opts));
  }
  return summarize(results, overrides);
}

export function summarize(results, overrides = {}) {
  const won = results.filter((r) => r.won);
  const haulers = won.filter((r) => r.family === 'haulers');
  const tunnel = won.filter((r) => r.family === 'tunnel');
  const bestHaulers = haulers.sort((a, b) => a.winTime - b.winTime)[0] || null;
  const bestTunnel = tunnel.sort((a, b) => a.winTime - b.winTime)[0] || null;
  const bestAny = won.sort((a, b) => a.winTime - b.winTime)[0] || null;
  let tunnelAdvantage = null;
  if (bestHaulers && bestTunnel) {
    tunnelAdvantage = (bestHaulers.winTime - bestTunnel.winTime) / bestHaulers.winTime;
  }
  const haulers2 = results.find((r) => r.strategy === 'haulers-2');
  const print1 = results.find((r) => r.strategy === 'haulers-plus-1');
  const tunnel2 = results.find((r) => r.strategy === 'tunnel-2-diggers');
  const typical = bestHaulers?.winTime ?? haulers2?.winTime ?? bestAny?.winTime ?? null;
  const t2vsBestHaulers = (bestHaulers && tunnel2?.won)
    ? (bestHaulers.winTime - tunnel2.winTime) / bestHaulers.winTime
    : null;
  const changes = changedFromDefaults(overrides);
  const gd = {
    print1BeatsHaulers: !!(print1?.won && haulers2?.won && print1.winTime < haulers2.winTime),
    tunnel2in20to35: t2vsBestHaulers != null && t2vsBestHaulers >= 0.20 && t2vsBestHaulers <= 0.35,
    everyWinnerHitsNight: won.length > 0 && won.every((r) => r.hitNight),
    tunnelPowerBelow50: results.some((r) => r.family === 'tunnel' && r.powerMin != null && r.powerMin < 50),
    noWinUnder4: won.length > 0 && won.every((r) => r.winTime >= 4 * 60),
  };
  gd.passCount = Object.values(gd).filter((v) => v === true).length;
  return {
    overrides,
    changes,
    results,
    bestHaulers,
    bestTunnel,
    bestAny,
    tunnelAdvantage,
    t2vsBestHaulers,
    typicalWin: typical,
    gd,
    criteria: {
      tunnelBeatsHaulers15to30: tunnelAdvantage != null && tunnelAdvantage >= 0.15 && tunnelAdvantage <= 0.30,
      typicalWin6to10: typical != null && typical >= 6 * 60 && typical <= 10 * 60,
      nightHappens: results.some((r) => r.won && r.hitNight),
      tunnelHitsNight: !!(bestTunnel && bestTunnel.hitNight),
      haulersCanWin: !!bestHaulers,
    },
  };
}

export function criteriaScore(summary) {
  if (summary.gd) return summary.gd.passCount;
  const c = summary.criteria;
  let n = 0;
  if (c.haulersCanWin) n += 1;
  if (c.nightHappens) n += 1;
  if (c.typicalWin6to10) n += 1;
  if (c.tunnelBeatsHaulers15to30) n += 2;
  else if (summary.tunnelAdvantage != null && summary.tunnelAdvantage > 0 && summary.tunnelAdvantage < 0.45) n += 1;
  return n;
}
