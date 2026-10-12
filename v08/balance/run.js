#!/usr/bin/env node
// Far Rover v0.8 balance harness. Default step is 1x (dt = 1/60).
// Player 2: same route was 44.8 / 45.4 / 47.2 s at 1x / 4x / 16x — do not
// pass a larger dt if you want numbers that match a 1x playtest.
//   node v08/balance/run.js
//   node v08/balance/run.js --overrides '{"goalIceInStorage":180}'
//   node v08/balance/run.js --strategy haulers-2
//   node v08/balance/run.js --sweep
//   node v08/balance/run.js --delays

import { writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { changedFromDefaults } from './config-override.js';
import { formatTime, runAllStrategies, runStrategy, criteriaScore, sweepReactionDelays, STRATEGY_IDS } from './harness.js';
import { CANDIDATES, SWEEP_GRID } from './candidates.js';
import { writeChartPng } from './chart.js';

const HERE = dirname(fileURLToPath(import.meta.url));

function parseArgs(argv) {
  const out = { overrides: {}, strategy: null, sweep: false, delays: false, report: false, json: false, maxSeconds: 30 * 60 };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--sweep') out.sweep = true;
    else if (a === '--delays') out.delays = true;
    else if (a === '--report') out.report = true;
    else if (a === '--json') out.json = true;
    else if (a === '--strategy') out.strategy = argv[++i];
    else if (a === '--max-seconds') out.maxSeconds = Number(argv[++i]);
    else if (a === '--overrides') Object.assign(out.overrides, JSON.parse(argv[++i]));
    else if (a.startsWith('--')) {
      const key = a.slice(2).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
      const raw = argv[++i];
      out.overrides[key] = Number.isFinite(Number(raw)) ? Number(raw) : raw;
    }
  }
  return out;
}

function printSummary(summary, title = 'Set') {
  const lines = [];
  lines.push(`## ${title}`);
  if (summary.changes.length) {
    lines.push('Changes from current Proposed numbers:');
    for (const c of summary.changes) {
      lines.push(`- \`${c.key}\`: ${c.from} → ${c.to}`);
    }
  } else {
    lines.push('No number changes (current Proposed set).');
  }
  lines.push('');
  lines.push('| Strategy | Best layout | Win | Night | Power min | Ice | Logistics |');
  lines.push('|---|---|---:|:---:|---:|---:|---|');
  for (const r of summary.results) {
    lines.push(`| ${r.label} | ${r.layoutId || 'auto'} | ${r.winTimeLabel} | ${r.hitNight ? 'yes' : 'no'} | ${r.powerMin ?? '—'} | ${r.ice} | ${r.logistics} |`);
  }
  lines.push('');
  if (summary.bestHaulers && summary.bestTunnel) {
    const pct = (summary.tunnelAdvantage * 100).toFixed(1);
    lines.push(`Best haulers-only: **${summary.bestHaulers.label}** at ${formatTime(summary.bestHaulers.winTime)}.`);
    const faster = summary.tunnelAdvantage >= 0;
    lines.push(`Best tunnel: **${summary.bestTunnel.label}** at ${formatTime(summary.bestTunnel.winTime)} (${Math.abs(summary.tunnelAdvantage * 100).toFixed(1)}% ${faster ? 'faster' : 'slower'}).`);
  } else if (summary.bestHaulers) {
    lines.push(`Best haulers-only: **${summary.bestHaulers.label}** at ${formatTime(summary.bestHaulers.winTime)}. Tunnel did not win.`);
  } else {
    lines.push('No haulers-only win in the time cap.');
  }
  const c = summary.criteria;
  lines.push(`Criteria: tunnel 15–30% ${c.tunnelBeatsHaulers15to30 ? 'yes' : 'no'}; 6–10 min ${c.typicalWin6to10 ? 'yes' : 'no'}; night ${c.nightHappens ? 'yes' : 'no'}; haulers can win ${c.haulersCanWin ? 'yes' : 'no'}.`);
  lines.push('');
  return lines.join('\n');
}

function runBaseline(opts) {
  return runAllStrategies({}, opts);
}

function runSweep(opts) {
  const sets = [
    { id: 'current', name: 'Current Proposed', overrides: {} },
    ...CANDIDATES,
    ...SWEEP_GRID,
  ];
  const seen = new Set();
  const out = [];
  for (const set of sets) {
    const key = JSON.stringify(set.overrides);
    if (seen.has(key)) continue;
    seen.add(key);
    const summary = runAllStrategies(set.overrides, opts);
    summary.id = set.id;
    summary.name = set.name;
    summary.why = set.why || '';
    summary.score = criteriaScore(summary);
    out.push(summary);
    console.error(`[sweep] ${set.id} score=${summary.score} adv=${summary.tunnelAdvantage == null ? '—' : (summary.tunnelAdvantage * 100).toFixed(1) + '%'} typical=${formatTime(summary.typicalWin)}`);
  }
  return out.sort((a, b) => b.score - a.score || Math.abs((a.tunnelAdvantage ?? 9) - 0.22) - Math.abs((b.tunnelAdvantage ?? 9) - 0.22));
}

function main() {
  const args = parseArgs(process.argv);
  const opts = { maxSeconds: args.maxSeconds };

  if (args.strategy) {
    if (!STRATEGY_IDS.includes(args.strategy)) {
      console.error(`Unknown strategy ${args.strategy}. Use: ${STRATEGY_IDS.join(', ')}`);
      process.exit(1);
    }
    const result = runStrategy(args.strategy, args.overrides, opts);
    if (args.json) console.log(JSON.stringify(result, null, 2));
    else {
      console.log(`${result.label}: ${result.winTimeLabel}  night=${result.hitNight}  powerMin=${result.powerMin}  ice=${result.ice}`);
    }
    return;
  }

  if (args.report) {
    writeReport(opts);
    return;
  }

  if (args.delays) {
    const sweep = sweepReactionDelays(args.overrides, opts);
    if (args.json) console.log(JSON.stringify(sweep, null, 2));
    else {
      console.log(`Pinned delay-0: 2-digger ${sweep.tunnelLayout} vs ${sweep.haulersStrategy} ${sweep.haulersLayout}`);
      console.log('| Delay | 2-digger | Best haulers | Lead | GD | Earliest |');
      console.log('|---|---:|---:|---:|---:|---|');
      for (const row of sweep.rows) {
        const lead = row.lead == null ? '—' : `${(row.lead * 100).toFixed(1)}%`;
        const gd = row.gd ? `${row.gd.passCount}/5` : '—';
        console.log(`| ${row.delay} s | ${row.tunnelLabel} (${row.tunnelLayout}) | ${row.haulersLabel} (${row.haulersStrategy} ${row.haulersLayout}) | ${lead} | ${gd} | ${row.earliestLabel} ${row.earliestStrategy} |`);
      }
    }
    return;
  }

  if (args.sweep) {
    const summaries = runSweep(opts);
    writeFileSync(join(HERE, 'sweep-results.json'), JSON.stringify(summaries, null, 2));
    if (args.json) console.log(JSON.stringify(summaries, null, 2));
    else {
      for (const s of summaries) console.log(printSummary(s, s.name));
    }
    return;
  }

  const summary = runAllStrategies(args.overrides, opts);
  if (args.json) console.log(JSON.stringify(summary, null, 2));
  else {
    const title = changedFromDefaults(args.overrides).length ? 'Override set' : 'Current Proposed';
    console.log(printSummary(summary, title));
  }
}

function pct(n) {
  return n == null ? '—' : `${(n * 100).toFixed(1)}%`;
}

function writeReport(opts) {
  const sets = [
    { id: 'current', name: 'Current Proposed', why: 'Unchanged v08/config.js numbers. Included as the baseline the designer already measured (haulers ~1:29, tunnel ~3:30 in live honest runs).', overrides: {} },
    ...CANDIDATES,
  ];
  const summaries = [];
  for (const set of sets) {
    const summary = runAllStrategies(set.overrides, opts);
    summary.id = set.id;
    summary.name = set.name;
    summary.why = set.why || '';
    summary.score = criteriaScore(summary);
    summary.chartName = ({
      current: 'Current',
      'A-goal-180-dig-16': 'A 180 / 16s',
      'B-goal-180-dig-24': 'B 180 / 24s',
      'C-goal-180-spd-08-dig-20': 'C 180 / 0.8 / 20s',
    })[set.id] || set.name;
    summaries.push(summary);
    console.error(`[report] ${set.id} H=${summary.bestHaulers ? formatTime(summary.bestHaulers.winTime) : '—'} T=${summary.bestTunnel ? formatTime(summary.bestTunnel.winTime) : '—'} adv=${pct(summary.tunnelAdvantage)}`);
  }

  writeFileSync(join(HERE, 'results.json'), JSON.stringify(summaries, null, 2));
  writeChartPng(summaries, join(HERE, 'chart.png'));

  const rec = summaries.find((s) => s.id === 'B-goal-180-dig-24') || summaries[2];
  const lines = [];
  lines.push('# Far Rover v0.8 balance report');
  lines.push('');
  lines.push('Headless harness under `v08/balance/`. It imports the real `createGame()` sim and the real scout engine (`v08/engine.js` → `simulation.js`). Strategies issue only player orders: place, build, print, dig, haul, charge, launch scout, land crew. No `setResources`, teleports, or forced completes.');
  lines.push('');
  lines.push('```bash');
  lines.push('node v08/balance/run.js                  # current numbers, all strategies');
  lines.push('node v08/balance/run.js --overrides \'{"goalIceInStorage":180}\'');
  lines.push('node v08/balance/run.js --strategy tunnel-2-diggers --goal-ice-in-storage 180');
  lines.push('node v08/balance/run.js --report         # rewrite this file + chart.png');
  lines.push('```');
  lines.push('');
  lines.push('`config.js` is not edited. Overrides mutate the live `CONFIG` object for one run and restore it after. `startHaulers` is hardcoded to 2 inside `bootstrap()`; the harness applies that override after create, so the documented start-count key still sweeps. Deep Ice distance is `deepIceTilesFromStartStorage`, mapped onto `commandRangeRadius` (the ring the sim actually uses; 22 → 14 keeps today’s placement). Sol length scales day/night 4:2 unless those are set too.');
  lines.push('');
  lines.push('## What the current numbers do');
  lines.push('');
  lines.push('Live honest runs at the current Proposed set: haulers-only ~1:29, tunnel ~3:30, first night at 4:00. The harness (scout launched in parallel, far hub next to Deep Ice) is a bit faster than those clicks, but the shape is the same: **the tube costs more time than it returns before the 60-ice goal, and a win never sees night, so stored power never matters.**');
  lines.push('');
  lines.push(printSummary(summaries[0], summaries[0].name));
  lines.push('The tunnel is 63% *slower* than two starting haulers. Printing extra haulers also loses — the printer is a 60-ice-goal tax. Mixed finishes as haulers-only because 60 ice lands before the bore is worth switching.');
  lines.push('');
  lines.push('## Candidates');
  lines.push('');
  lines.push('Target: best committed tunnel beats best haulers-only by about 15–30%; a typical (safe, haulers-only) win is about 6–10 minutes so at least one night happens; haulers-only can still win. Change as few numbers as possible.');
  lines.push('');
  lines.push('Night starts at 4:00 / sol is 6:00. Power min is habitat stored power during the run — extra haulers charging after dusk are what drive it toward zero.');
  lines.push('');

  for (const s of summaries.slice(1)) {
    lines.push(printSummary(s, s.name));
    lines.push(s.why);
    lines.push('');
    if (s.bestHaulers && s.bestTunnel) {
      lines.push(`Tunnel advantage: **${pct(s.tunnelAdvantage)}**. Haulers-only still wins. Night on a winning route: **${s.criteria.nightHappens ? 'yes' : 'no'}**. Committed 2-digger night: **${s.criteria.tunnelHitsNight ? 'yes' : 'no'}**.`);
      lines.push('');
    }
  }

  lines.push('## Recommendation: set B');
  lines.push('');
  lines.push('Ship **goal 180 ice** and **24 seconds per tunnel tile**. Leave everything else Proposed.');
  lines.push('');
  if (rec?.changes) {
    lines.push('| Key | Current | B | Why |');
    lines.push('|---|---:|---:|---|');
    const explain = {
      goalIceInStorage: '60 ice is two full trips after setup. 180 ice is a logistics contract: the bore’s upfront cost can amortize, and the clock crosses first night.',
      digSecondsPerTilePerRover: 'At 6 s/tile a 2-digger line next to Deep Ice is ~40% faster than walking — too good. 24 s/tile keeps the 15–30% band and pushes the committed win past 4:00.',
      haulerSpeedTilesPerSecond: 'Slows the walk home so extra printed haulers and night charging show up. Used in C only.',
    };
    for (const c of rec.changes) {
      lines.push(`| \`${c.key}\` | ${c.from} | ${c.to} | ${explain[c.key] || 'Swept lever.'} |`);
    }
    lines.push('');
  }
  lines.push('Why B over A: A is the smaller bore nerf (16s) and a bigger tunnel win (~28%), but the 2-digger line still lands *before* night (3:50). B gives up some of that edge (~19%, still in band) so the player who commits to the tube still has to plan a night. Why B over C: C needs a third number (hauler speed 0.8) to put the safe route cleanly inside 6–10 minutes. B gets night + a real tunnel decision with two knobs. C is the right follow-up if playtests say 5:19 still feels short on the hauler path.');
  lines.push('');
  lines.push('Haulers-only remains viable — just slower. Printing extra haulers at these numbers is a night-power decision, not a free speedup: the plus-2 path can drain stored power to 0 and then wait on dawn for the 50-power land-crew floor.');
  lines.push('');
  lines.push('## Chart');
  lines.push('');
  lines.push('![Win time by strategy](chart.png)');
  lines.push('');
  lines.push('Orange bars are hauler-family routes; cyan bars are tunnel-family. The horizontal line is first night (4:00).');
  lines.push('');
  lines.push('## Notes for Game Designer');
  lines.push('');
  lines.push('- Habitat ice cap is 30 and vault ice is 150. A 180 goal fits habitat + vault exactly; hub ice does **not** count for Land Crew, so the last loads have to finish in the vault/habitat/storage.');
  lines.push('- Deep Ice is 200. A goal above ~180 needs a second scoring pad (storage) on the tunnel path, or a vault/habitat cap change.');
  lines.push('- `deepIceTilesFromStartStorage: 22` is documentation today. The node sits on the command-range ring (~14 tiles). The harness maps that field onto `commandRangeRadius` when you sweep it.');
  lines.push('- `startHaulers` is unused by `bootstrap()` (always two). The harness honors the override at kickoff.');
  lines.push('- These runs launch the real Notify-on-ore scout program and wait for the 2s confirm ping. Unlocking Deep Ice by injection is not used.');
  lines.push('');

  writeFileSync(join(HERE, 'REPORT.md'), `${lines.join('\n')}\n`);
  console.log(`wrote ${join(HERE, 'REPORT.md')} and ${join(HERE, 'chart.png')}`);
}

export { printSummary, runBaseline, runSweep, writeReport };

if (resolve(process.argv[1] || '') === fileURLToPath(import.meta.url)) {
  main();
}
