import assert from 'node:assert/strict';
import * as Sim from '../v08/engine.js';
import { hostedTickAndResume } from '../v08/hosted-tick.js';
import { TUTORIAL_STARTER } from '../v08/tutorial.js';
import { explainLiveTick, liveFromTrace, shouldNarrate } from '../v08/scout-live.js';

const SENSORS = [Sim.SENSORS.DISTANCE, Sim.SENSORS.SPECTRAL, Sim.SENSORS.CAMERA];

function runStarter() {
  const state = Sim.createInitialState(SENSORS, TUTORIAL_STARTER);
  const lives = [];
  while (!state.outcome && state.tick < 200) {
    const result = hostedTickAndResume(state);
    lives.push(explainLiveTick(state, result.tickRecord));
  }
  return { state, lives };
}

const { state, lives } = runStarter();
assert.equal(state.outcome, Sim.OUTCOMES.SUCCESS_SCAN, 'starter still returns with trace ice only');
assert.equal(!!state.iceConfirmed, false, 'starter must not confirm Deep Ice');

const explore = lives.find((l) => /nothing else true, so exploring/.test(l.reason));
assert.ok(explore, 'starter must show the Always-explore reason');
assert.equal(explore.fired, 4);
assert.ok(explore.dimmed.includes(0) && explore.dimmed.includes(1), 'rules 1–2 were checked and false');

const home = lives.find((l) => /Battery \d+ is below 12, so heading home to charge/.test(l.reason));
assert.ok(home, 'starter must show the Battery-below-12 reason');
assert.equal(home.fired, 2);
assert.equal(home.toast, 'Scout: battery low, heading home');
assert.match(home.reason, /^Rule 2: Battery 11 is below 12, so heading home to charge\.$/);

const sidestep = lives.find((l) => l.toast === 'Scout: crater ahead, sidestepping');
assert.ok(sidestep, 'starter must sidestep a crater');
assert.equal(sidestep.fired, 1);
assert.match(sidestep.reason, /Rule 1: crater ahead/);

const ice = lives.find((l) => l.toast && /Scout: trace ice at [A-L]\d+, continuing/.test(l.toast));
assert.ok(ice, 'starter must ping trace ice');
assert.match(ice.toast, /Scout: trace ice at G9, continuing|Scout: trace ice at [A-L]\d+, continuing/);
assert.equal(ice.fired, 3, 'Notify slot lights on the ping tick');
assert.match(ice.reason, /standing on ice/);

const last = liveFromTrace(state);
assert.ok(last.reason, 'liveFromTrace reads the last tick');

let prev = { key: null, iceCells: new Set(), keys: new Set() };
const toasts = [];
for (const live of lives) {
  if (/so exploring/.test(live.reason || '')) prev.keys.delete('battery-home');
  if (shouldNarrate(prev, live)) {
    toasts.push(live.toast);
    if (live.iceCell) prev.iceCells.add(live.iceCell);
    prev.keys.add(live.toastKey);
    prev.key = live.toastKey;
  }
}
assert.ok(toasts.includes('Scout: battery low, heading home'));
assert.ok(toasts.some((t) => /Scout: trace ice at [A-L]\d+, continuing/.test(t)));
assert.ok(toasts.includes('Scout: crater ahead, sidestepping'));
const homeToasts = toasts.filter((t) => t === 'Scout: battery low, heading home');
assert.ok(homeToasts.length >= 1 && homeToasts.length <= 2, 'battery-home toast is throttled across a trip');

console.log(`ok  live reasons match starter trace (tick ${state.tick}, toasts ${toasts.length})`);
