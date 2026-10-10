// Canonical 5 / 46 / 45 live-tick guard, run through the /v08/ import path.
// Scenario G loses on tick 5. Starter + camera wins on 46. Starter + dust wins on 45.
import * as Sim from './engine.js';

function runScenario(sensors, rules, uplinkAtTick = null, uplinkSlot = null, uplinkCondition = null, uplinkAction = null) {
  const state = Sim.createInitialState(sensors, rules);
  let previouslyRevealed = null;

  while (!state.outcome && state.tick < 500) {
    const result = Sim.runTick(state, previouslyRevealed);

    if (result.autoPause && result.continueFromStep4) {
      if (uplinkAtTick === state.tick && Sim.canUseUplink(state)) {
        Sim.applyUplink(state, uplinkSlot, uplinkCondition, uplinkAction);
      }
      const contResult = Sim.continueTickFromStep4(state, result.tickRecord, state.readings);
      previouslyRevealed = contResult.newlyRevealed;
      if (contResult.endCondition) {
        state.outcome = contResult.endCondition.outcome;
        state.endReason = contResult.endCondition.reason;
        break;
      }
      if (contResult.stuckCondition) {
        state.outcome = contResult.stuckCondition.outcome;
        state.endReason = contResult.stuckCondition.reason;
        break;
      }
      continue;
    }

    if (result.stuckCondition) {
      state.outcome = result.stuckCondition.outcome;
      state.endReason = result.stuckCondition.reason;
      break;
    }

    previouslyRevealed = result.newlyRevealed;
  }

  return { outcome: state.outcome, tick: state.tick, tiles: state.tilesScanned, cargo: state.cargo, battery: state.battery };
}

export function runLiveTickGuard() {
  const starter = Sim.STARTER_PROGRAM;

  const scenarioG = runScenario(
    ['distance', 'dust', 'spectral'],
    [
      { condition: { type: Sim.CONDITIONS.ALWAYS }, action: { type: Sim.ACTIONS.EXPLORE } },
      { condition: { type: Sim.CONDITIONS.ALWAYS }, action: { type: Sim.ACTIONS.WAIT } },
    ],
    5,
    1,
    { type: Sim.CONDITIONS.CRATER_IN_FRONT },
    { type: Sim.ACTIONS.SIDESTEP },
  );

  const starterCamera = runScenario(['distance', 'spectral', 'camera'], starter);
  const starterDust = runScenario(['distance', 'dust', 'spectral'], starter);

  return {
    scenarioG,
    starterCamera,
    starterDust,
    expected: {
      scenarioG: { outcome: Sim.OUTCOMES.LOST_CRATER, tick: 5 },
      starterCamera: { outcome: Sim.OUTCOMES.SUCCESS_SCAN, tick: 46, tiles: 25, cargo: 1, battery: 4 },
      starterDust: { outcome: Sim.OUTCOMES.SUCCESS_SCAN, tick: 45, tiles: 25, cargo: 1 },
    },
  };
}

export function assertLiveTicksUnchanged(results = runLiveTickGuard()) {
  const { scenarioG, starterCamera, starterDust, expected } = results;
  const failures = [];

  if (scenarioG.tick !== expected.scenarioG.tick || scenarioG.outcome !== expected.scenarioG.outcome) {
    failures.push(`Scenario G: expected tick ${expected.scenarioG.tick} ${expected.scenarioG.outcome}, got ${scenarioG.tick} ${scenarioG.outcome}`);
  }
  if (
    starterCamera.tick !== expected.starterCamera.tick
    || starterCamera.outcome !== expected.starterCamera.outcome
    || starterCamera.tiles !== expected.starterCamera.tiles
    || starterCamera.cargo !== expected.starterCamera.cargo
    || starterCamera.battery !== expected.starterCamera.battery
  ) {
    failures.push(`Starter+camera: expected 46 success-scan 25/1/4, got ${starterCamera.tick} ${starterCamera.outcome} ${starterCamera.tiles}/${starterCamera.cargo}/${starterCamera.battery}`);
  }
  if (
    starterDust.tick !== expected.starterDust.tick
    || starterDust.outcome !== expected.starterDust.outcome
    || starterDust.tiles !== expected.starterDust.tiles
    || starterDust.cargo !== expected.starterDust.cargo
  ) {
    failures.push(`Starter+dust: expected 45 success-scan 25/1, got ${starterDust.tick} ${starterDust.outcome} ${starterDust.tiles}/${starterDust.cargo}`);
  }

  return { ok: failures.length === 0, failures, results };
}
