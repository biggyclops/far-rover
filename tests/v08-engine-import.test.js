// Importing the demo engine through /v08 must leave the live 5 / 46 / 45 runs unchanged.
import { assertLiveTicksUnchanged } from '../v08/engine-check.js';

const { ok, failures, results } = assertLiveTicksUnchanged();

if (!ok) {
  console.error('v08 engine import drifted the demo ticks:');
  for (const f of failures) console.error('  -', f);
  process.exit(1);
}

console.log('v08 engine import: 5 / 46 / 45 unchanged');
console.log(`  Scenario G: tick ${results.scenarioG.tick} ${results.scenarioG.outcome}`);
console.log(`  Starter+camera: tick ${results.starterCamera.tick} ${results.starterCamera.outcome}`);
console.log(`  Starter+dust: tick ${results.starterDust.tick} ${results.starterDust.outcome}`);
