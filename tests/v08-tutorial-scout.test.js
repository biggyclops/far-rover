import assert from 'node:assert/strict';
import * as Sim from '../v08/engine.js';
import { runProgram } from '../v08/balance/scout-run.js';
import { TUTORIAL_STARTER, TUTORIAL_TRY_THIS } from '../v08/tutorial.js';

const SENSORS = [Sim.SENSORS.DISTANCE, Sim.SENSORS.SPECTRAL];
const CAM = [Sim.SENSORS.DISTANCE, Sim.SENSORS.SPECTRAL, Sim.SENSORS.CAMERA];

function run(rules, opts = {}) {
  return runProgram(opts.sensors || SENSORS, rules, opts.max || 200, {
    resumeHazards: opts.resume !== false,
  });
}

const starter = run(TUTORIAL_STARTER);
assert.equal(starter.confirmed, false, 'starter must not confirm Deep Ice');
assert.equal(starter.outcome, Sim.OUTCOMES.SUCCESS_SCAN);
assert.equal(starter.cell, 'Lander');
console.log(`ok  starter returns trace ice only (tick ${starter.tick}, ${starter.cell})`);

for (const resume of [true, false]) {
  for (const sensors of [SENSORS, CAM]) {
    const r = run(TUTORIAL_TRY_THIS, { resume, sensors });
    assert.equal(r.confirmed, true, `battery 6 must confirm resume=${resume} cam=${sensors.includes('camera')}`);
    console.log(`ok  battery 6 confirms resume=${resume} sensors=${sensors.length} tick=${r.tick} ${r.outcome} ${r.cell}`);
  }
}

const fallback = run(TUTORIAL_TRY_THIS);
assert.equal(fallback.confirmed, true, 'Try this program must confirm Deep Ice');
console.log(`ok  Try this program confirms (${fallback.outcome} at ${fallback.cell})`);
