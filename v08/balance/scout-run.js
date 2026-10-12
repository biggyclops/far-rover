#!/usr/bin/env node
// Paper-map scout search through the real hosted v08 tick (Notify option b).

import * as Sim from '../engine.js';
import { runHostedScoutTick } from '../hosted-tick.js';

const SENSORS = [Sim.SENSORS.DISTANCE, Sim.SENSORS.SPECTRAL];

function cellOf(state) {
  return Sim.isOnLander(state.col, state.row) ? 'Lander' : Sim.formatCell(state.col, state.row);
}

function hostedTick(state, { resumeHazards = true } = {}) {
  const result = runHostedScoutTick(state);
  if (resumeHazards && result?.continueFromStep4 && result.autoPause) {
    const saved = state.rules;
    state.rules = (saved || []).filter((r) => r?.action?.type !== Sim.ACTIONS.NOTIFY);
    Sim.continueTickFromStep4(state, result.tickRecord, result.tickRecord.readings || state.readings);
    state.rules = saved;
  }
  return result;
}

export function runProgram(sensors, rules, maxTicks = 200, opts = {}) {
  const state = Sim.createInitialState(sensors, rules);
  while (!state.outcome && state.tick < maxTicks) {
    hostedTick(state, opts);
  }
  return {
    confirmed: !!state.iceConfirmed,
    outcome: state.outcome || (state.tick >= maxTicks ? 'timeout' : null),
    tick: state.tick,
    cell: cellOf(state),
    col: state.col,
    row: state.row,
    notifyCount: state.notifyCount || 0,
    battery: state.battery,
    tiles: state.tilesScanned,
    cargo: state.cargo,
  };
}

function rule(condition, action, n) {
  const c = n != null ? { type: condition, n } : { type: condition };
  return { condition: c, action: { type: action } };
}

// Kit starter with Drill swapped for On ice: Notify (the natural "plus Notify").
const STARTER_PLUS_NOTIFY = [
  rule(Sim.CONDITIONS.CRATER_IN_FRONT, Sim.ACTIONS.SIDESTEP),
  rule(Sim.CONDITIONS.BATTERY_BELOW, Sim.ACTIONS.RETURN_CHARGE, 12),
  rule(Sim.CONDITIONS.ON_ORE, Sim.ACTIONS.NOTIFY),
  rule(Sim.CONDITIONS.ALWAYS, Sim.ACTIONS.EXPLORE),
];

// Kit starter kept, Notify added as an extra On-ice rule in front of Drill.
const STARTER_WITH_NOTIFY_KEPT_DRILL = [
  rule(Sim.CONDITIONS.CRATER_IN_FRONT, Sim.ACTIONS.SIDESTEP),
  rule(Sim.CONDITIONS.BATTERY_BELOW, Sim.ACTIONS.RETURN_CHARGE, 12),
  rule(Sim.CONDITIONS.ON_ORE, Sim.ACTIONS.NOTIFY),
  rule(Sim.CONDITIONS.ON_ORE, Sim.ACTIONS.DRILL),
  rule(Sim.CONDITIONS.ALWAYS, Sim.ACTIONS.EXPLORE),
];

const HOSTED_STARTER = [
  rule(Sim.CONDITIONS.CRATER_IN_FRONT, Sim.ACTIONS.SIDESTEP),
  rule(Sim.CONDITIONS.ON_ORE, Sim.ACTIONS.NOTIFY),
  rule(Sim.CONDITIONS.ORE_NEXT_TO, Sim.ACTIONS.GO_TO_ORE),
  rule(Sim.CONDITIONS.ALWAYS, Sim.ACTIONS.EXPLORE),
];

const FOUR_RULE_CANDIDATES = [
  {
    name: 'sidestep / battery 8 return / on-ore notify / explore',
    rules: [
      rule(Sim.CONDITIONS.CRATER_IN_FRONT, Sim.ACTIONS.SIDESTEP),
      rule(Sim.CONDITIONS.BATTERY_BELOW, Sim.ACTIONS.RETURN_CHARGE, 8),
      rule(Sim.CONDITIONS.ON_ORE, Sim.ACTIONS.NOTIFY),
      rule(Sim.CONDITIONS.ALWAYS, Sim.ACTIONS.EXPLORE),
    ],
  },
  {
    name: 'sidestep / battery 5 return / on-ore notify / explore',
    rules: [
      rule(Sim.CONDITIONS.CRATER_IN_FRONT, Sim.ACTIONS.SIDESTEP),
      rule(Sim.CONDITIONS.BATTERY_BELOW, Sim.ACTIONS.RETURN_CHARGE, 5),
      rule(Sim.CONDITIONS.ON_ORE, Sim.ACTIONS.NOTIFY),
      rule(Sim.CONDITIONS.ALWAYS, Sim.ACTIONS.EXPLORE),
    ],
  },
  {
    name: 'sidestep / battery 6 return / on-ore notify / explore',
    rules: [
      rule(Sim.CONDITIONS.CRATER_IN_FRONT, Sim.ACTIONS.SIDESTEP),
      rule(Sim.CONDITIONS.BATTERY_BELOW, Sim.ACTIONS.RETURN_CHARGE, 6),
      rule(Sim.CONDITIONS.ON_ORE, Sim.ACTIONS.NOTIFY),
      rule(Sim.CONDITIONS.ALWAYS, Sim.ACTIONS.EXPLORE),
    ],
  },
  {
    name: 'sidestep / battery 7 return / on-ore notify / explore',
    rules: [
      rule(Sim.CONDITIONS.CRATER_IN_FRONT, Sim.ACTIONS.SIDESTEP),
      rule(Sim.CONDITIONS.BATTERY_BELOW, Sim.ACTIONS.RETURN_CHARGE, 7),
      rule(Sim.CONDITIONS.ON_ORE, Sim.ACTIONS.NOTIFY),
      rule(Sim.CONDITIONS.ALWAYS, Sim.ACTIONS.EXPLORE),
    ],
  },
  {
    name: 'sidestep / battery 20 return / on-ore notify / explore',
    rules: [
      rule(Sim.CONDITIONS.CRATER_IN_FRONT, Sim.ACTIONS.SIDESTEP),
      rule(Sim.CONDITIONS.BATTERY_BELOW, Sim.ACTIONS.RETURN_CHARGE, 20),
      rule(Sim.CONDITIONS.ON_ORE, Sim.ACTIONS.NOTIFY),
      rule(Sim.CONDITIONS.ALWAYS, Sim.ACTIONS.EXPLORE),
    ],
  },
  {
    name: 'sidestep / battery 8 return / go-to-ore / on-ore notify',
    rules: [
      rule(Sim.CONDITIONS.CRATER_IN_FRONT, Sim.ACTIONS.SIDESTEP),
      rule(Sim.CONDITIONS.BATTERY_BELOW, Sim.ACTIONS.RETURN_CHARGE, 8),
      rule(Sim.CONDITIONS.ORE_NEXT_TO, Sim.ACTIONS.GO_TO_ORE),
      rule(Sim.CONDITIONS.ON_ORE, Sim.ACTIONS.NOTIFY),
    ],
  },
  {
    name: 'sidestep / battery 20 return / on-ore notify / go-to-ore',
    rules: [
      rule(Sim.CONDITIONS.CRATER_IN_FRONT, Sim.ACTIONS.SIDESTEP),
      rule(Sim.CONDITIONS.BATTERY_BELOW, Sim.ACTIONS.RETURN_CHARGE, 20),
      rule(Sim.CONDITIONS.ON_ORE, Sim.ACTIONS.NOTIFY),
      rule(Sim.CONDITIONS.ORE_NEXT_TO, Sim.ACTIONS.GO_TO_ORE),
    ],
  },
  {
    name: 'sidestep / battery 20 return / go-to-ore / explore',
    rules: [
      rule(Sim.CONDITIONS.CRATER_IN_FRONT, Sim.ACTIONS.SIDESTEP),
      rule(Sim.CONDITIONS.BATTERY_BELOW, Sim.ACTIONS.RETURN_CHARGE, 20),
      rule(Sim.CONDITIONS.ORE_NEXT_TO, Sim.ACTIONS.GO_TO_ORE),
      rule(Sim.CONDITIONS.ALWAYS, Sim.ACTIONS.EXPLORE),
    ],
  },
  {
    name: 'sidestep / battery 20 return / ore-next go-to-ore / on-ore notify',
    rules: [
      rule(Sim.CONDITIONS.CRATER_IN_FRONT, Sim.ACTIONS.SIDESTEP),
      rule(Sim.CONDITIONS.BATTERY_BELOW, Sim.ACTIONS.RETURN_CHARGE, 20),
      rule(Sim.CONDITIONS.ORE_NEXT_TO, Sim.ACTIONS.GO_TO_ORE),
      rule(Sim.CONDITIONS.ON_ORE, Sim.ACTIONS.NOTIFY),
    ],
  },
  {
    name: 'sidestep / ore-next go-to-ore / on-ore notify / battery 20 return',
    rules: [
      rule(Sim.CONDITIONS.CRATER_IN_FRONT, Sim.ACTIONS.SIDESTEP),
      rule(Sim.CONDITIONS.ORE_NEXT_TO, Sim.ACTIONS.GO_TO_ORE),
      rule(Sim.CONDITIONS.ON_ORE, Sim.ACTIONS.NOTIFY),
      rule(Sim.CONDITIONS.BATTERY_BELOW, Sim.ACTIONS.RETURN_CHARGE, 20),
    ],
  },
  {
    name: 'sidestep / battery 20 return / on-ore notify / ore-next go-to-ore / explore',
    rules: [
      rule(Sim.CONDITIONS.CRATER_IN_FRONT, Sim.ACTIONS.SIDESTEP),
      rule(Sim.CONDITIONS.BATTERY_BELOW, Sim.ACTIONS.RETURN_CHARGE, 20),
      rule(Sim.CONDITIONS.ON_ORE, Sim.ACTIONS.NOTIFY),
      rule(Sim.CONDITIONS.ORE_NEXT_TO, Sim.ACTIONS.GO_TO_ORE),
      rule(Sim.CONDITIONS.ALWAYS, Sim.ACTIONS.EXPLORE),
    ],
  },
  {
    name: 'sidestep / battery 20 return / ore-next go-to-ore / explore',
    rules: [
      rule(Sim.CONDITIONS.CRATER_IN_FRONT, Sim.ACTIONS.SIDESTEP),
      rule(Sim.CONDITIONS.BATTERY_BELOW, Sim.ACTIONS.RETURN_CHARGE, 20),
      rule(Sim.CONDITIONS.ORE_NEXT_TO, Sim.ACTIONS.GO_TO_ORE),
      rule(Sim.CONDITIONS.ALWAYS, Sim.ACTIONS.EXPLORE),
    ],
  },
];

const SIMPLE_CONDITIONS = [
  { type: Sim.CONDITIONS.ALWAYS },
  { type: Sim.CONDITIONS.ON_ORE },
  { type: Sim.CONDITIONS.ORE_NEXT_TO },
  { type: Sim.CONDITIONS.CRATER_IN_FRONT },
  { type: Sim.CONDITIONS.ON_DUST },
  { type: Sim.CONDITIONS.BATTERY_BELOW, n: 20 },
  { type: Sim.CONDITIONS.GOAL_MET },
];

const SIMPLE_ACTIONS = [
  Sim.ACTIONS.EXPLORE,
  Sim.ACTIONS.RETURN_CHARGE,
  Sim.ACTIONS.SIDESTEP,
  Sim.ACTIONS.GO_TO_ORE,
  Sim.ACTIONS.DRILL,
  Sim.ACTIONS.WAIT,
  Sim.ACTIONS.NOTIFY,
];

function sensorsFor(rules) {
  const need = new Set([Sim.SENSORS.DISTANCE, Sim.SENSORS.SPECTRAL]);
  for (const r of rules) {
    if (r.condition.type === Sim.CONDITIONS.ON_DUST) need.add(Sim.SENSORS.DUST);
  }
  return [...need];
}

function enumerateSimple(len) {
  const out = [];
  function rec(cur) {
    if (cur.length === len) {
      out.push(cur.map((x) => ({ condition: { ...x.condition }, action: { type: x.action } })));
      return;
    }
    for (const condition of SIMPLE_CONDITIONS) {
      for (const action of SIMPLE_ACTIONS) {
        rec([...cur, { condition, action }]);
      }
    }
  }
  rec([]);
  return out;
}

function main() {
  console.log('## starter + On ice: Notify (no hazard resume, live page)');
  console.log(JSON.stringify(runProgram(SENSORS, STARTER_PLUS_NOTIFY, 200, { resumeHazards: false }), null, 2));

  console.log('## starter + On ice: Notify (player Resume on hazards)');
  console.log(JSON.stringify(runProgram(SENSORS, STARTER_PLUS_NOTIFY, 200, { resumeHazards: true }), null, 2));

  console.log('## starter kept + extra On ice Notify (player Resume)');
  console.log(JSON.stringify(runProgram(SENSORS, STARTER_WITH_NOTIFY_KEPT_DRILL, 200, { resumeHazards: true }), null, 2));

  console.log('## hosted starter sidestep/notify/go-to-ore/explore (no resume)');
  console.log(JSON.stringify(runProgram(SENSORS, HOSTED_STARTER, 80, { resumeHazards: false }), null, 2));

  console.log('## hosted starter (player Resume)');
  console.log(JSON.stringify(runProgram(SENSORS, HOSTED_STARTER, 200, { resumeHazards: true }), null, 2));

  console.log('## 4-rule candidates (player Resume)');
  const fours = [];
  for (const c of FOUR_RULE_CANDIDATES) {
    const r = runProgram(sensorsFor(c.rules), c.rules, 200, { resumeHazards: true });
    fours.push({ name: c.name, ...r });
    console.log(`${c.name}: confirmed=${r.confirmed} tick=${r.tick} cell=${r.cell} outcome=${r.outcome}`);
  }

  const winners = fours.filter((f) => f.confirmed).sort((a, b) => a.tick - b.tick);
  console.log('## best 4-rule that confirms', winners[0] || 'none');

  function countWins(programs, label) {
    let ok = 0;
    const hits = [];
    for (const rules of programs) {
      const r = runProgram(sensorsFor(rules), rules, 120, { resumeHazards: true });
      if (r.confirmed) {
        ok += 1;
        if (hits.length < 16) {
          hits.push({
            rules: rules.map((x) => `${x.condition.type}${x.condition.n != null ? ` ${x.condition.n}` : ''} → ${x.action.type}`),
            tick: r.tick,
            cell: r.cell,
            outcome: r.outcome,
          });
        }
      }
    }
    console.log(`## ${label}: ${ok} / ${programs.length} confirm F2/I2`);
    for (const h of hits) console.log('  ', JSON.stringify(h));
    return { ok, total: programs.length, hits };
  }

  const one = countWins(enumerateSimple(1), '1-rule');
  const two = countWins(enumerateSimple(2), '2-rule');

  return { fours, winners, one, two };
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('scout-run.js')) {
  main();
}

export { hostedTick, STARTER_PLUS_NOTIFY, HOSTED_STARTER };
