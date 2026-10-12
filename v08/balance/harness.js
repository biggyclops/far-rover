// Headless driver for the real v08 sim. Imports createGame(); issues player orders only.

import { createGame } from '../game.js';
import { CONFIG, applyOverrides, restoreConfig, changedFromDefaults, DEFAULTS, expandOverrides } from './config-override.js';
import { attachScout } from './scout.js';
import { createBrain, STRATEGY_IDS, STRATEGY_META, haulersOf } from './strategies.js';
import { layoutsFor, nearestLegalDrop } from './placements.js';

export { STRATEGY_IDS, STRATEGY_META, CONFIG, DEFAULTS, changedFromDefaults };

export const REACTION_DELAYS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

// Criterion 2 (Game Designer, post-#55): with 2 diggers, the tunnel must beat
// the best hauler route including prints by 15–35% at delay 0–1 s, and still
// win outright (lead > 0, cap 35%) at every delay 0–10 s.
export function criterion2LeadOk(lead, delay = 0) {
  if (lead == null || !Number.isFinite(lead)) return false;
  if (lead > 0.35 + 1e-12) return false;
  if ((delay ?? 0) <= 1) return lead + 1e-12 >= 0.15;
  return lead > 0;
}

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

function situationKey(game) {
  return [
    game.state.deepIce.unlocked ? 1 : 0,
    game.tunnelReady() ? 1 : 0,
    game.canLandCrew() ? 1 : 0,
    game.state.units.filter((u) => u.kind === 'hauler').length,
    game.state.buildings.map((b) => `${b.type}:${b.complete ? 1 : 0}:${b.printing ? 1 : 0}`).join(','),
  ].join('|');
}

function runOnce(strategyId, opts, layout, applied) {
  const dt = opts.dt ?? 1 / 60;
  const delay = opts.reactionDelay ?? 0;
  // Reaction delay is a hold after a new situation (scout confirm, building
  // done, print done). It is not the think interval: using delay as thinkEvery
  // starved print-3 of re-clicks and made it *faster* at 5/7/8/10 s.
  const thinkEvery = opts.thinkEvery ?? 0.5;
  const maxSeconds = opts.maxSeconds ?? 30 * 60;
  const game = createGame();
  syncStartHaulers(game);
  const scout = attachScout(game);
  const think = createBrain(strategyId, { layout });
  let minPower = Infinity;
  let hitNight = false;
  let thinkAcc = 0;
  let nextThinkAt = 0;
  let lastKey = '';
  think(game, scout);
  lastKey = situationKey(game);

  while (game.state.time < maxSeconds && !game.state.won) {
    game.update(dt);
    scout.pump(dt);
    game.flushEvents();
    const stored = game.storedForGoal();
    if (stored.power < minPower) minPower = stored.power;
    if (!game.isDay()) hitNight = true;
    const key = situationKey(game);
    if (key !== lastKey) {
      lastKey = key;
      nextThinkAt = Math.max(nextThinkAt, game.state.time + delay);
    }
    thinkAcc += dt;
    if (thinkAcc >= thinkEvery && game.state.time + 1e-9 >= nextThinkAt) {
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
    reactionDelay: delay,
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
    // Default delay 0 is the fastest legal win (worst case for criterion 5).
    // Pass delays: REACTION_DELAYS (or call sweepReactionDelays) for the lead table.
    const delays = opts.delays
      || [opts.reactionDelay ?? 0];
    let best = null;
    const tried = [];
    for (const layout of layouts) {
      for (const delay of delays) {
        const r = runOnce(strategyId, { ...opts, reactionDelay: delay }, layout, applied);
        tried.push({
          layoutId: r.layoutId,
          delay,
          won: r.won,
          winTimeLabel: r.winTimeLabel,
          ice: r.ice,
        });
        if (betterResult(r, best)) best = r;
      }
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

export function summarize(results, overrides = {}, opts = {}) {
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
  const delay = opts.delay ?? results.find((r) => r.reactionDelay != null)?.reactionDelay ?? 0;
  const changes = changedFromDefaults(overrides);
  const gd = {
    print1BeatsHaulers: !!(print1?.won && haulers2?.won && print1.winTime < haulers2.winTime),
    tunnel2LeadOk: criterion2LeadOk(t2vsBestHaulers, delay),
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

export function sweepReactionDelays(overrides = {}, opts = {}) {
  const delays = opts.delays || REACTION_DELAYS;
  const pinned = {};
  for (const id of STRATEGY_IDS) {
    pinned[id] = runStrategy(id, overrides, { ...opts, delays: [0] });
  }
  const rows = [];
  for (const delay of delays) {
    const results = STRATEGY_IDS.map((id) => (
      delay === 0
        ? pinned[id]
        : runStrategy(id, overrides, {
          ...opts,
          layout: pinned[id].layout || { id: pinned[id].layoutId },
          delays: [delay],
          reactionDelay: delay,
        })
    ));
    const summary = summarize(results, overrides, { delay });
    const tunnel = results.find((r) => r.strategy === 'tunnel-2-diggers');
    const hauler = summary.bestHaulers;
    const lead = (tunnel?.won && hauler?.won)
      ? (hauler.winTime - tunnel.winTime) / hauler.winTime
      : null;
    rows.push({
      delay,
      tunnel: tunnel?.winTime ?? null,
      tunnelLabel: tunnel?.winTimeLabel ?? 'timeout',
      tunnelLayout: tunnel?.layoutId,
      haulers: hauler?.winTime ?? null,
      haulersLabel: hauler?.winTimeLabel ?? 'timeout',
      haulersStrategy: hauler?.strategy,
      haulersLayout: hauler?.layoutId,
      lead,
      gd: summary.gd,
      earliest: summary.bestAny?.winTime ?? null,
      earliestLabel: summary.bestAny?.winTimeLabel ?? 'timeout',
      earliestStrategy: summary.bestAny?.strategy,
    });
  }
  const t2 = pinned['tunnel-2-diggers'];
  const bestH0 = summarize(Object.values(pinned), overrides).bestHaulers;
  return {
    tunnelLayout: t2?.layoutId,
    haulersStrategy: bestH0?.strategy,
    haulersLayout: bestH0?.layoutId,
    rows,
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
