#!/usr/bin/env node
// Post-#28 economy retune against Game Designer's five criteria.
//   node v08/balance/retune-run.js
//   node v08/balance/retune-run.js --spam
//   node v08/balance/retune-run.js --set '{"haulerUpkeepPowerPerSec":0.2}'

import { writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createGame } from '../game.js';
import { applyOverrides, restoreConfig } from './config-override.js';
import {
  formatTime,
  runAllStrategies,
  runStrategy,
  criteriaScore,
  STRATEGY_IDS,
} from './harness.js';
import { createBrain, haulersOf } from './strategies.js';
import { attachScout } from './scout.js';

const HERE = dirname(fileURLToPath(import.meta.url));

function knobCount(summary) {
  return (summary.changes || []).filter((c) => ![
    'daySecondsAt1x',
    'nightSecondsAt1x',
    'commandRangeRadius',
  ].includes(c.key)).length;
}

function deltaSize(summary) {
  let n = 0;
  for (const c of summary.changes || []) {
    if (typeof c.from === 'number' && typeof c.to === 'number') {
      n += Math.abs(c.to - c.from) / Math.max(1e-9, Math.abs(c.from));
    } else n += 1;
  }
  return n;
}

function printSet(summary, title) {
  const lines = [];
  lines.push(`## ${title}  (${summary.gd?.passCount ?? '?'} / 5)`);
  if (summary.changes?.length) {
    for (const c of summary.changes) lines.push(`- \`${c.key}\`: ${c.from} → ${c.to}`);
  } else lines.push('No number changes.');
  lines.push('');
  lines.push('| Strategy | Win | Night | Power min | Ice | Haulers |');
  lines.push('|---|---:|:---:|---:|---:|---:|');
  for (const r of summary.results) {
    lines.push(`| ${r.label} | ${r.winTimeLabel} | ${r.hitNight ? 'yes' : 'no'} | ${r.powerMin ?? '—'} | ${r.ice} | ${r.haulerCount} |`);
  }
  const g = summary.gd || {};
  const t2 = summary.t2vsBestHaulers;
  lines.push('');
  lines.push(`1 print1 < haulers-2: ${g.print1BeatsHaulers ? 'PASS' : 'FAIL'}`);
  lines.push(`2 T2 20–35% vs best haulers: ${g.tunnel2in20to35 ? 'PASS' : 'FAIL'} (${t2 == null ? '—' : `${(t2 * 100).toFixed(1)}%`})`);
  lines.push(`3 every winner hits night: ${g.everyWinnerHitsNight ? 'PASS' : 'FAIL'}`);
  lines.push(`4 tunnel power min < 50: ${g.tunnelPowerBelow50 ? 'PASS' : 'FAIL'}`);
  lines.push(`5 no win under 4:00: ${g.noWinUnder4 ? 'PASS' : 'FAIL'}`);
  lines.push('');
  return lines.join('\n');
}

function rank(a, b) {
  const pa = a.gd?.passCount ?? 0;
  const pb = b.gd?.passCount ?? 0;
  if (pb !== pa) return pb - pa;
  const ka = knobCount(a);
  const kb = knobCount(b);
  if (ka !== kb) return ka - kb;
  return deltaSize(a) - deltaSize(b);
}

export function runPrinterSpam(overrides = {}, maxSeconds = 10 * 60) {
  applyOverrides(overrides);
  try {
    const game = createGame();
    const scout = attachScout(game);
    const think = createBrain('haulers-plus-2');
    const dt = 1 / 60;
    let thinkAcc = 0;
    let minPower = Infinity;
    let maxHaulers = 0;
    let printsStarted = 0;
    think(game, scout);
    while (game.state.time < maxSeconds) {
      game.update(dt);
      scout.pump(dt);
      game.flushEvents();
      const p = game.storedForGoal().power;
      if (p < minPower) minPower = p;
      maxHaulers = Math.max(maxHaulers, haulersOf(game).length);
      thinkAcc += dt;
      if (thinkAcc >= 0.5) {
        thinkAcc = 0;
        const printer = game.state.buildings.find((b) => b.type === 'printer' && b.complete);
        if (printer && !printer.printing && game.totals().regolith + 1e-6 >= game.C.printerHaulerCostRegolith
          && game.totals().power + 1e-6 >= game.C.printerHaulerCostPower) {
          if (game.startPrint()) printsStarted += 1;
        } else {
          think(game, scout);
        }
      }
    }
    return {
      time: game.state.time,
      haulers: haulersOf(game).length,
      maxHaulers,
      printsStarted,
      minPower: Math.round(minPower * 10) / 10,
      endPower: Math.round(game.storedForGoal().power * 10) / 10,
      starved: !!(game.C.haulerUpkeepPowerPerSec > 0 && game.totals().power <= 1e-6),
      overrides,
    };
  } finally {
    restoreConfig();
  }
}

const SETS = [
  { id: 'live', name: 'Live (goal 180 / dig 24 / carry 15)', overrides: {} },
  { id: 'upkeep-005', name: 'upkeep 0.05', overrides: { haulerUpkeepPowerPerSec: 0.05 } },
  { id: 'upkeep-010', name: 'upkeep 0.10', overrides: { haulerUpkeepPowerPerSec: 0.10 } },
  { id: 'upkeep-015', name: 'upkeep 0.15', overrides: { haulerUpkeepPowerPerSec: 0.15 } },
  { id: 'upkeep-020', name: 'upkeep 0.20', overrides: { haulerUpkeepPowerPerSec: 0.20 } },
  { id: 'upkeep-025', name: 'upkeep 0.25', overrides: { haulerUpkeepPowerPerSec: 0.25 } },
  { id: 'upkeep-030', name: 'upkeep 0.30', overrides: { haulerUpkeepPowerPerSec: 0.30 } },
  { id: 'print-15-10s', name: 'print 15 reg / 10s', overrides: { printerHaulerCostRegolith: 15, printerHaulerSeconds: 10 } },
  { id: 'print-15-10p-10s', name: 'print 15/10p/10s', overrides: { printerHaulerCostRegolith: 15, printerHaulerCostPower: 10, printerHaulerSeconds: 10 } },
  { id: 'print-20-15s', name: 'print 20 / 15s', overrides: { printerHaulerCostRegolith: 20, printerHaulerSeconds: 15 } },
  { id: 's5-print', name: 'section 5 print 50/20/30', overrides: { printerHaulerCostRegolith: 50, printerHaulerCostPower: 20, printerHaulerSeconds: 30 } },
  { id: 's5-mine', name: 'section 5 mine 0.25', overrides: { haulerMinePerSecond: 0.25 } },
  { id: 'digp-6', name: 'dig power 6', overrides: { digPowerPerTile: 6 } },
  { id: 'hab-120', name: 'habitat cap 120', overrides: { habitatPowerCapacity: 120 } },
  { id: 'solar-4', name: 'solar 4/s', overrides: { rimSolarPowerPerSecondDay: 4 } },
  { id: 'upkeep-03-hab-120', name: 'upkeep 0.30 + hab 120', overrides: { haulerUpkeepPowerPerSec: 0.30, habitatPowerCapacity: 120 } },
  { id: 'upkeep-03-solar-4', name: 'upkeep 0.30 + solar 4', overrides: { haulerUpkeepPowerPerSec: 0.30, rimSolarPowerPerSecondDay: 4 } },
  { id: 'upkeep-03-print-15', name: 'upkeep 0.30 + print 15/10s', overrides: { haulerUpkeepPowerPerSec: 0.30, printerHaulerCostRegolith: 15, printerHaulerSeconds: 10 } },
  { id: 'upkeep-02-hab-120-print-15', name: 'upkeep 0.20 + hab 120 + print 15/10s', overrides: { haulerUpkeepPowerPerSec: 0.20, habitatPowerCapacity: 120, printerHaulerCostRegolith: 15, printerHaulerSeconds: 10 } },
  { id: 'upkeep-03-hab-120-print-15', name: 'upkeep 0.30 + hab 120 + print 15/10s', overrides: { haulerUpkeepPowerPerSec: 0.30, habitatPowerCapacity: 120, printerHaulerCostRegolith: 15, printerHaulerSeconds: 10 } },
  { id: 'upkeep-03-hab-120-solar-4', name: 'upkeep 0.30 + hab 120 + solar 4', overrides: { haulerUpkeepPowerPerSec: 0.30, habitatPowerCapacity: 120, rimSolarPowerPerSecondDay: 4 } },
];

function parseArgs(argv) {
  const out = { spam: false, set: null, maxSeconds: 20 * 60 };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--spam') out.spam = true;
    else if (argv[i] === '--set') out.set = JSON.parse(argv[++i]);
    else if (argv[i] === '--max-seconds') out.maxSeconds = Number(argv[++i]);
  }
  return out;
}

function main() {
  const args = parseArgs(process.argv);
  const opts = { maxSeconds: args.maxSeconds, dt: 1 / 60 };

  if (args.spam) {
    const spam = runPrinterSpam(args.set || { haulerUpkeepPowerPerSec: 0.2 }, 10 * 60);
    console.log(JSON.stringify(spam, null, 2));
    return;
  }

  if (args.set) {
    const summary = runAllStrategies(args.set, opts);
    summary.score = criteriaScore(summary);
    console.log(printSet(summary, 'Override'));
    return;
  }

  const out = [];
  for (const set of SETS) {
    const t0 = Date.now();
    const summary = runAllStrategies(set.overrides, opts);
    summary.id = set.id;
    summary.name = set.name;
    summary.score = criteriaScore(summary);
    out.push(summary);
    console.error(`[retune] ${set.id} ${summary.gd.passCount}/5 knobs=${knobCount(summary)} ${((Date.now() - t0) / 1000).toFixed(1)}s`);
    console.log(printSet(summary, set.name));
  }
  out.sort(rank);
  writeFileSync(join(HERE, 'retune-results.json'), JSON.stringify(out, null, 2));
  console.log('## ranked');
  for (const s of out) {
    console.log(`${s.gd.passCount}/5 knobs=${knobCount(s)} ${s.id} T2=${s.t2vsBestHaulers == null ? '—' : `${(s.t2vsBestHaulers * 100).toFixed(1)}%`}`);
  }
}

if (resolve(process.argv[1] || '') === fileURLToPath(import.meta.url)) {
  main();
}

export { SETS, printSet, runPrinterSpam, rank };
