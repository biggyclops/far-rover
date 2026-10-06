// Headless driver for simulation.js.
// Reads JSON lines: {"prog": [[cond,n,act],...], "combo": ["Di","Sp","Ca"]}
// Writes JSON lines with outcome, ticks, tiles, cargo.
import path from 'path';
import { fileURLToPath } from 'url';
import * as Sim from '../simulation.js';
import readline from 'readline';

const C = [Sim.CONDITIONS.ALWAYS, Sim.CONDITIONS.BATTERY_BELOW, Sim.CONDITIONS.CRATER_IN_FRONT,
  Sim.CONDITIONS.ON_DUST, Sim.CONDITIONS.ORE_NEXT_TO, Sim.CONDITIONS.ON_ORE, Sim.CONDITIONS.GOAL_MET];
const A = [Sim.ACTIONS.EXPLORE, Sim.ACTIONS.RETURN_CHARGE, Sim.ACTIONS.SIDESTEP, Sim.ACTIONS.GO_TO_ORE,
  Sim.ACTIONS.DRILL, Sim.ACTIONS.WAIT];
const S = {Di: 'distance', Du: 'dust', Sp: 'spectral', Ca: 'camera'};
const OUT = {'success-scan': 'WIN', 'success-ore': 'WIN', 'lost-crater': 'CR', 'lost-battery': 'B0',
  'stuck-no-move': 'ST_nomove', 'stuck-charge': 'ST_charge2', 'stuck-loop': 'ST_circle'};

export function runDemo(prog, combo, maxTicks = 500, traceOut = false) {
  const rules = [null, null, null, null];
  prog.forEach((r, i) => {
    const cond = {type: C[r[0]]};
    if (r[0] === 1) cond.n = r[1];
    rules[i] = {condition: cond, action: {type: A[r[2]]}};
  });
  const st = Sim.createInitialState(combo.map(s => S[s]), rules);
  let prev = null;
  while (!st.outcome && st.tick < maxTicks) {
    let r = Sim.runTick(st, prev);
    if (r.autoPause) { prev = null; r = Sim.continueTickFromStep4(st, r.tickRecord, st.readings); }
    prev = r.newlyRevealed;
    if (r.endCondition) { st.outcome = r.endCondition.outcome; break; }
    if (r.stuckCondition) break;
  }
  const res = {outcome: OUT[st.outcome] || (st.outcome ? st.outcome : 'TU'), turns: st.tick, tiles: st.tilesScanned, cargo: st.cargo};
  if (traceOut) res.trace = st.trace.map(t => [t.tick, Sim.formatCell(t.positionAfter.col, t.positionAfter.row), t.facingAfter, t.battery, t.ruleReason]);
  return res;
}

if (path.resolve(process.argv[1] || '') === fileURLToPath(import.meta.url)) {
  const rl = readline.createInterface({input: process.stdin});
  rl.on('line', line => {
    if (!line.trim()) return;
    const j = JSON.parse(line);
    process.stdout.write(JSON.stringify(runDemo(j.prog, j.combo, 500, !!j.trace)) + '\n');
  });
}
