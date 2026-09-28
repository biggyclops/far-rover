// Far Rover Simulation Tests
// Tests for all 15 acceptance criteria with EXACT spec values
// Spec reference: docs/demo-scope.md section 16

import * as Sim from '../simulation.js';

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    passed++;
    console.log(`  ✓ ${message}`);
  } else {
    failed++;
    console.log(`  ✗ ${message}`);
  }
}

function assertEqual(actual, expected, message) {
  if (actual === expected) {
    passed++;
    console.log(`  ✓ ${message}`);
  } else {
    failed++;
    console.log(`  ✗ ${message}: expected ${expected}, got ${actual}`);
  }
}

// Run scenario tick-by-tick with detailed tracking
function runScenarioDetailed(sensors, rules, uplinkAtTick = null, uplinkSlot = null, uplinkCondition = null, uplinkAction = null) {
  const state = Sim.createInitialState(sensors, rules);
  let previouslyRevealed = null;
  const autoPauses = [];
  const tickHistory = [];
  
  while (!state.outcome && state.tick < 500) {
    const result = Sim.runTick(state, previouslyRevealed);
    
    if (result.autoPause && result.continueFromStep4) {
      autoPauses.push({ tick: state.tick, reason: result.autoPause.reason });
      
      // Apply uplink if at the right tick and unused
      if (uplinkAtTick === state.tick && !state.uplink.used) {
        Sim.applyUplink(state, uplinkSlot, uplinkCondition, uplinkAction);
      }
      
      const contResult = Sim.continueTickFromStep4(state, result.tickRecord, state.readings);
      previouslyRevealed = contResult.newlyRevealed;
      
      tickHistory.push({
        tick: state.tick,
        position: Sim.formatCell(state.col, state.row),
        col: state.col,
        row: state.row,
        facing: state.facing,
        battery: state.battery,
        tilesScanned: state.tilesScanned,
        autoPause: true
      });
      
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
    
    tickHistory.push({
      tick: state.tick,
      position: Sim.formatCell(state.col, state.row),
      col: state.col,
      row: state.row,
      facing: state.facing,
      battery: state.battery,
      tilesScanned: state.tilesScanned,
      autoPause: false
    });
    
    if (result.stuckCondition) {
      state.outcome = result.stuckCondition.outcome;
      state.endReason = result.stuckCondition.reason;
      break;
    }
    
    previouslyRevealed = result.newlyRevealed;
  }
  
  return { state, autoPauses, tickHistory };
}

// Helper to get tick data
function getTick(history, tickNum) {
  return history.find(h => h.tick === tickNum);
}

// === CRITERION 1: Map matches section 4 exactly ===
console.log('\n=== Criterion 1: Map structure ===');
(() => {
  const terrain = Sim.createTerrain();
  
  let craters = 0, ores = 0, dusts = 0, empties = 0;
  for (let r = 0; r < 12; r++) {
    for (let c = 0; c < 12; c++) {
      switch (terrain[r][c]) {
        case Sim.TERRAIN.CRATER: craters++; break;
        case Sim.TERRAIN.ORE: ores++; break;
        case Sim.TERRAIN.DUST: dusts++; break;
        case Sim.TERRAIN.EMPTY: empties++; break;
      }
    }
  }
  
  assertEqual(craters, 10, '10 crater tiles');
  assertEqual(ores, 12, '12 ore tiles');
  assertEqual(dusts, 8, '8 dust tiles');
  assertEqual(empties, 114, '114 empty tiles');
  
  const checkTerrain = (cell, expected) => {
    const col = cell.charCodeAt(0) - 'A'.charCodeAt(0);
    const row = parseInt(cell.slice(1)) - 1;
    return terrain[row][col] === expected;
  };
  
  assert(checkTerrain('F8', Sim.TERRAIN.CRATER), 'F8 is crater');
  assert(checkTerrain('D11', Sim.TERRAIN.ORE), 'D11 is ore');
  assert(checkTerrain('F10', Sim.TERRAIN.DUST), 'F10 is dust');
  assert(checkTerrain('A1', Sim.TERRAIN.EMPTY), 'A1 is empty');
  
  const state = Sim.createInitialState(['distance', 'spectral', 'camera'], []);
  let allHidden = true;
  for (let r = 0; r < 12; r++) {
    for (let c = 0; c < 12; c++) {
      if (state.revealed[r][c]) allHidden = false;
    }
  }
  assert(allHidden, 'All tiles hidden at start');
})();

// === CRITERION 2: Rover starts correctly ===
console.log('\n=== Criterion 2: Rover initial state ===');
(() => {
  const state = Sim.createInitialState(['distance', 'spectral', 'camera'], []);
  
  assertEqual(state.col, 5, 'Rover starts at column F (5)');
  assertEqual(state.row, 12, 'Rover starts at row 13 (lander)');
  assertEqual(state.facing, Sim.DIRECTIONS.NORTH, 'Rover faces north');
  assertEqual(state.battery, 20, 'Battery is 20');
  assertEqual(state.cargo, 0, 'Cargo is 0');
  assertEqual(state.tilesScanned, 0, '0 tiles scanned');
  assertEqual(state.uplink.used, false, 'Uplink unused');
})();

// === CRITERION 3: Launch conditions ===
console.log('\n=== Criterion 3: Launch validation ===');
(() => {
  assert(!Sim.isConditionLegal(Sim.CONDITIONS.CRATER_IN_FRONT, ['dust', 'spectral', 'camera']), 
    'Crater in front needs Distance');
  assert(Sim.isConditionLegal(Sim.CONDITIONS.CRATER_IN_FRONT, ['distance', 'spectral', 'camera']), 
    'Crater in front works with Distance');
  
  assert(!Sim.isConditionLegal(Sim.CONDITIONS.ON_DUST, ['distance', 'spectral', 'camera']), 
    'On dust needs Dust sensor');
  assert(Sim.isConditionLegal(Sim.CONDITIONS.ON_DUST, ['distance', 'dust', 'camera']), 
    'On dust works with Dust sensor');
  
  assert(!Sim.isConditionLegal(Sim.CONDITIONS.ORE_NEXT_TO, ['distance', 'dust', 'camera']), 
    'Ore next to needs Spectral');
  assert(!Sim.isConditionLegal(Sim.CONDITIONS.ON_ORE, ['distance', 'dust', 'camera']), 
    'On ore needs Spectral');
  assert(!Sim.isActionLegal(Sim.ACTIONS.GO_TO_ORE, ['distance', 'dust', 'camera']), 
    'Go to ore needs Spectral');
  
  assert(Sim.isConditionLegal(Sim.CONDITIONS.ALWAYS, []), 
    'Always is always legal');
  assert(Sim.isConditionLegal(Sim.CONDITIONS.BATTERY_BELOW, []), 
    'Battery below is always legal');
})();

// === CRITERION 4: First-match rule order ===
console.log('\n=== Criterion 4: First-match rule order ===');
(() => {
  const sensors = ['distance', 'dust', 'spectral'];
  const rules = [
    { condition: { type: Sim.CONDITIONS.ALWAYS }, action: { type: Sim.ACTIONS.WAIT } },
    { condition: { type: Sim.CONDITIONS.ALWAYS }, action: { type: Sim.ACTIONS.EXPLORE } }
  ];
  const state = Sim.createInitialState(sensors, rules);
  const result = Sim.runTick(state, null);
  
  assertEqual(result.tickRecord.ruleFired, 1, 'First matching rule fires (slot 1)');
  assert(result.tickRecord.actionResult.waited, 'Wait action executed');
})();

// === CRITERION 5: Scenario A ===
// Spec: Distance, Spectral, Camera; rule 1: Always → Explore
// - Ticks 1-4 end at F12, F11, F10, F9 with battery 19, 18, 16, 15 and tiles 6, 9, 12, 15
// - Auto-pauses at start of tick 3 (dust F10, G10) and start of tick 5 (crater F8)
// - Tick 5: lost (crater) at F8, battery 14, 18 tiles scanned
console.log('\n=== Criterion 5: Scenario A ===');
(() => {
  const sensors = ['distance', 'spectral', 'camera'];
  const rules = [
    { condition: { type: Sim.CONDITIONS.ALWAYS }, action: { type: Sim.ACTIONS.EXPLORE } }
  ];
  
  const { state, autoPauses, tickHistory } = runScenarioDetailed(sensors, rules);
  
  // Tick 1: F12, battery 19, tiles 6
  const t1 = getTick(tickHistory, 1);
  assertEqual(t1?.position, 'F12', 'Tick 1 position F12');
  assertEqual(t1?.battery, 19, 'Tick 1 battery 19');
  assertEqual(t1?.tilesScanned, 6, 'Tick 1 tiles 6');
  
  // Tick 2: F11, battery 18, tiles 9
  const t2 = getTick(tickHistory, 2);
  assertEqual(t2?.position, 'F11', 'Tick 2 position F11');
  assertEqual(t2?.battery, 18, 'Tick 2 battery 18');
  assertEqual(t2?.tilesScanned, 9, 'Tick 2 tiles 9');
  
  // Auto-pause at start of tick 3 for dust
  assert(autoPauses.some(p => p.tick === 3 && p.reason.includes('dust')), 
    'Auto-pause at tick 3 for dust');
  
  // Tick 3: F10, battery 16, tiles 12
  const t3 = getTick(tickHistory, 3);
  assertEqual(t3?.position, 'F10', 'Tick 3 position F10');
  assertEqual(t3?.battery, 16, 'Tick 3 battery 16');
  assertEqual(t3?.tilesScanned, 12, 'Tick 3 tiles 12');
  
  // Tick 4: F9, battery 15, tiles 15
  const t4 = getTick(tickHistory, 4);
  assertEqual(t4?.position, 'F9', 'Tick 4 position F9');
  assertEqual(t4?.battery, 15, 'Tick 4 battery 15');
  assertEqual(t4?.tilesScanned, 15, 'Tick 4 tiles 15');
  
  // Auto-pause at start of tick 5 for crater
  assert(autoPauses.some(p => p.tick === 5 && p.reason.includes('crater')), 
    'Auto-pause at tick 5 for crater');
  
  // Tick 5: F8, battery 14, tiles 18, lost (crater)
  assertEqual(state.outcome, Sim.OUTCOMES.LOST_CRATER, 'Lost to crater');
  assertEqual(state.tick, 5, 'Lost on tick 5');
  assertEqual(state.battery, 14, 'Final battery 14');
  assertEqual(state.tilesScanned, 18, 'Final tiles 18');
})();

// === CRITERION 6: Scenario B ===
// Spec: Distance, Dust, Spectral; rule 1: Always → Explore
// - Ends at F12, F11, F10, F9, F8 on ticks 1-5. Battery 14, 5 tiles scanned.
// - Auto-pauses at start of tick 4 (dust sensor, F10) and start of tick 5 (crater F8)
// - Result: lost (crater) on tick 5
console.log('\n=== Criterion 6: Scenario B ===');
(() => {
  const sensors = ['distance', 'dust', 'spectral'];
  const rules = [
    { condition: { type: Sim.CONDITIONS.ALWAYS }, action: { type: Sim.ACTIONS.EXPLORE } }
  ];
  
  const { state, autoPauses, tickHistory } = runScenarioDetailed(sensors, rules);
  
  // Tick 1: F12, battery 19, tiles 1
  const t1 = getTick(tickHistory, 1);
  assertEqual(t1?.position, 'F12', 'Tick 1 position F12');
  assertEqual(t1?.battery, 19, 'Tick 1 battery 19');
  assertEqual(t1?.tilesScanned, 1, 'Tick 1 tiles 1');
  
  // Tick 2: F11, battery 18, tiles 2
  const t2 = getTick(tickHistory, 2);
  assertEqual(t2?.position, 'F11', 'Tick 2 position F11');
  assertEqual(t2?.battery, 18, 'Tick 2 battery 18');
  assertEqual(t2?.tilesScanned, 2, 'Tick 2 tiles 2');
  
  // Tick 3: F10, battery 16, tiles 3
  const t3 = getTick(tickHistory, 3);
  assertEqual(t3?.position, 'F10', 'Tick 3 position F10');
  assertEqual(t3?.battery, 16, 'Tick 3 battery 16');
  assertEqual(t3?.tilesScanned, 3, 'Tick 3 tiles 3');
  
  // Auto-pause at start of tick 4 (dust sensor on F10)
  assert(autoPauses.some(p => p.tick === 4 && p.reason.toLowerCase().includes('dust')), 
    'Auto-pause at tick 4 for dust');
  
  // Tick 4: F9, battery 15, tiles 4
  const t4 = getTick(tickHistory, 4);
  assertEqual(t4?.position, 'F9', 'Tick 4 position F9');
  assertEqual(t4?.battery, 15, 'Tick 4 battery 15');
  assertEqual(t4?.tilesScanned, 4, 'Tick 4 tiles 4');
  
  // Auto-pause at start of tick 5 for crater
  assert(autoPauses.some(p => p.tick === 5 && p.reason.includes('crater')), 
    'Auto-pause at tick 5 for crater');
  
  // Tick 5: lost (crater), battery 14, tiles 5
  assertEqual(state.outcome, Sim.OUTCOMES.LOST_CRATER, 'Lost to crater');
  assertEqual(state.tick, 5, 'Lost on tick 5');
  assertEqual(state.battery, 14, 'Final battery 14');
  assertEqual(state.tilesScanned, 5, 'Final tiles 5');
})();

// === CRITERION 7: Scenario C ===
// Spec: Distance, Dust, Spectral; rule 1: Crater in front → Sidestep; rule 2: Always → Explore
// - Tick 5 sidesteps from F9 to G9 (battery 14)
// - Tick 11 sidesteps from G4 to H4 at crater G3
// - Result: lost (battery) on tick 21 at L2, with 19 tiles scanned
console.log('\n=== Criterion 7: Scenario C ===');
(() => {
  const sensors = ['distance', 'dust', 'spectral'];
  const rules = [
    { condition: { type: Sim.CONDITIONS.CRATER_IN_FRONT }, action: { type: Sim.ACTIONS.SIDESTEP } },
    { condition: { type: Sim.CONDITIONS.ALWAYS }, action: { type: Sim.ACTIONS.EXPLORE } }
  ];
  
  const { state, tickHistory } = runScenarioDetailed(sensors, rules);
  
  // Tick 5: sidestep F9 to G9, battery 14
  const t5 = getTick(tickHistory, 5);
  assertEqual(t5?.position, 'G9', 'Tick 5 position G9 (sidestep from F9)');
  assertEqual(t5?.battery, 14, 'Tick 5 battery 14');
  
  // Tick 11: sidestep G4 to H4 at crater G3
  const t11 = getTick(tickHistory, 11);
  assertEqual(t11?.position, 'H4', 'Tick 11 position H4 (sidestep from G4)');
  
  // Final: lost (battery) on tick 21 at L2, 19 tiles
  assertEqual(state.outcome, Sim.OUTCOMES.LOST_BATTERY, 'Lost to battery');
  assertEqual(state.tick, 21, 'Lost on tick 21');
  assertEqual(Sim.formatCell(state.col, state.row), 'L2', 'Final position L2');
  assertEqual(state.tilesScanned, 19, 'Final tiles 19');
})();

// === CRITERION 8: Scenario D ===
// Spec: Distance, Dust, Spectral; rule 1: Battery below 20 → Return and charge; rule 2: Always → Explore
// - Tick 2 turns south at F12 without moving
// - Tick 3 moves onto lander (battery 18)
// - Ticks 4-6 charge, battery 20 after tick 6
// - Result: stuck (loop) on tick 15 at F12, facing north
console.log('\n=== Criterion 8: Scenario D ===');
(() => {
  const sensors = ['distance', 'dust', 'spectral'];
  const rules = [
    { condition: { type: Sim.CONDITIONS.BATTERY_BELOW, n: 20 }, action: { type: Sim.ACTIONS.RETURN_CHARGE } },
    { condition: { type: Sim.CONDITIONS.ALWAYS }, action: { type: Sim.ACTIONS.EXPLORE } }
  ];
  
  const { state, tickHistory } = runScenarioDetailed(sensors, rules);
  
  // Tick 1: move to F12
  const t1 = getTick(tickHistory, 1);
  assertEqual(t1?.position, 'F12', 'Tick 1 position F12');
  
  // Tick 2: turn south at F12 (no move, so still at F12)
  const t2 = getTick(tickHistory, 2);
  assertEqual(t2?.position, 'F12', 'Tick 2 position F12 (turn)');
  assertEqual(t2?.facing, Sim.DIRECTIONS.SOUTH, 'Tick 2 facing south');
  
  // Tick 3: move to lander, battery 18
  const t3 = getTick(tickHistory, 3);
  assertEqual(t3?.position, 'Lander', 'Tick 3 position Lander');
  assertEqual(t3?.battery, 18, 'Tick 3 battery 18');
  
  // After tick 6: battery should be 20 (charged)
  const t6 = getTick(tickHistory, 6);
  assertEqual(t6?.battery, 20, 'Tick 6 battery 20 (charged)');
  
  // Result: stuck (loop) on tick 15 at F12 facing north
  assertEqual(state.outcome, Sim.OUTCOMES.STUCK_LOOP, 'Stuck in loop');
  assertEqual(state.tick, 15, 'Stuck on tick 15');
  assertEqual(Sim.formatCell(state.col, state.row), 'F12', 'Final position F12');
  assertEqual(state.facing, Sim.DIRECTIONS.NORTH, 'Final facing north');
})();

// === CRITERION 9: Scenario E ===
// Spec: Distance, Spectral, Camera; rules: Battery below 8 → Return and charge; 
//       Crater in front → Sidestep; Ore next to rover → Go to ore; Always → Explore
// - success (scan) on tick 23, on lander with battery 1, 32 tiles scanned, cargo 0
console.log('\n=== Criterion 9: Scenario E ===');
(() => {
  const sensors = ['distance', 'spectral', 'camera'];
  const rules = [
    { condition: { type: Sim.CONDITIONS.BATTERY_BELOW, n: 8 }, action: { type: Sim.ACTIONS.RETURN_CHARGE } },
    { condition: { type: Sim.CONDITIONS.CRATER_IN_FRONT }, action: { type: Sim.ACTIONS.SIDESTEP } },
    { condition: { type: Sim.CONDITIONS.ORE_NEXT_TO }, action: { type: Sim.ACTIONS.GO_TO_ORE } },
    { condition: { type: Sim.CONDITIONS.ALWAYS }, action: { type: Sim.ACTIONS.EXPLORE } }
  ];
  
  const { state } = runScenarioDetailed(sensors, rules);
  
  assertEqual(state.outcome, Sim.OUTCOMES.SUCCESS_SCAN, 'Success by scan');
  assertEqual(state.tick, 23, 'Success on tick 23');
  assertEqual(state.battery, 1, 'Final battery 1');
  assertEqual(state.tilesScanned, 32, 'Final tiles 32');
  assertEqual(state.cargo, 0, 'Final cargo 0');
  assertEqual(state.col, 5, 'On lander (col F)');
  assertEqual(state.row, 12, 'On lander (row 13)');
})();

// === CRITERION 10: Scenario F ===
// Spec: Scenario B, but at tick-5 auto-pause the uplink rewrites rule 1 to "Crater in front → Sidestep"
// - tick 5 moves to G9
// - ticks 6-8 match no rule
// - run pauses as stuck (no move) on tick 8
// - Uplink is now used, so only option is End run
console.log('\n=== Criterion 10: Scenario F ===');
(() => {
  const sensors = ['distance', 'dust', 'spectral'];
  const rules = [
    { condition: { type: Sim.CONDITIONS.ALWAYS }, action: { type: Sim.ACTIONS.EXPLORE } }
  ];
  
  const { state, tickHistory } = runScenarioDetailed(
    sensors, rules,
    5, 0,
    { type: Sim.CONDITIONS.CRATER_IN_FRONT },
    { type: Sim.ACTIONS.SIDESTEP }
  );
  
  // Tick 5: moves to G9 (sidestep)
  const t5 = getTick(tickHistory, 5);
  assertEqual(t5?.position, 'G9', 'Tick 5 position G9 (sidestep)');
  
  // Result: stuck (no move) on tick 8
  assertEqual(state.outcome, Sim.OUTCOMES.STUCK_NO_MOVE, 'Stuck (no move)');
  assertEqual(state.tick, 8, 'Stuck on tick 8');
  assert(state.uplink.used, 'Uplink was used');
})();

// === CRITERION 11: Scenario G ===
// Spec: Scenario B plus rule 2: Always → Wait; at tick-5 pause uplink rewrites rule 2 to "Crater in front → Sidestep"
// - lost (crater) on tick 5, because rule 1 still fires first
console.log('\n=== Criterion 11: Scenario G ===');
(() => {
  const sensors = ['distance', 'dust', 'spectral'];
  const rules = [
    { condition: { type: Sim.CONDITIONS.ALWAYS }, action: { type: Sim.ACTIONS.EXPLORE } },
    { condition: { type: Sim.CONDITIONS.ALWAYS }, action: { type: Sim.ACTIONS.WAIT } }
  ];
  
  const { state } = runScenarioDetailed(
    sensors, rules,
    5, 1,
    { type: Sim.CONDITIONS.CRATER_IN_FRONT },
    { type: Sim.ACTIONS.SIDESTEP }
  );
  
  assertEqual(state.outcome, Sim.OUTCOMES.LOST_CRATER, 'Lost to crater');
  assertEqual(state.tick, 5, 'Lost on tick 5');
})();

// === CRITERION 12: Uplink constraints ===
console.log('\n=== Criterion 12: Uplink constraints ===');
(() => {
  const state = Sim.createInitialState(['distance', 'spectral', 'camera'], [
    { condition: { type: Sim.CONDITIONS.ALWAYS }, action: { type: Sim.ACTIONS.WAIT } }
  ]);
  
  const success1 = Sim.applyUplink(state, 0, 
    { type: Sim.CONDITIONS.ALWAYS }, 
    { type: Sim.ACTIONS.EXPLORE }
  );
  assert(success1, 'First uplink succeeds');
  assert(state.uplink.used, 'Uplink marked as used');
  
  const success2 = Sim.applyUplink(state, 0,
    { type: Sim.CONDITIONS.ALWAYS },
    { type: Sim.ACTIONS.WAIT }
  );
  assert(!success2, 'Second uplink fails');
})();

// === CRITERION 13: End screen and rerun ===
console.log('\n=== Criterion 13: Trace and state preservation ===');
(() => {
  const { state } = runScenarioDetailed(['distance', 'spectral', 'camera'], [
    { condition: { type: Sim.CONDITIONS.ALWAYS }, action: { type: Sim.ACTIONS.EXPLORE } }
  ]);
  
  assert(state.trace.length >= 5, 'At least 5 ticks in trace');
  
  const lastTick = state.trace[state.trace.length - 1];
  assert('tick' in lastTick, 'Trace has tick number');
  assert('positionAfter' in lastTick, 'Trace has position');
  assert('battery' in lastTick, 'Trace has battery');
  assert('ruleReason' in lastTick, 'Trace has rule reason');
})();

// === CRITERION 14: Run counter and log ===
console.log('\n=== Criterion 14: Run logging ===');
(() => {
  const state1 = Sim.createInitialState(['distance', 'spectral', 'camera'], []);
  const state2 = Sim.createInitialState(['distance', 'dust', 'spectral'], []);
  
  assert(state1.sensors !== state2.sensors, 'States have independent sensors');
  assert(state1.revealed !== state2.revealed, 'States have independent revealed arrays');
})();

// === CRITERION 15: Determinism ===
console.log('\n=== Criterion 15: Determinism ===');
(() => {
  const sensors = ['distance', 'spectral', 'camera'];
  const rules = [
    { condition: { type: Sim.CONDITIONS.BATTERY_BELOW, n: 8 }, action: { type: Sim.ACTIONS.RETURN_CHARGE } },
    { condition: { type: Sim.CONDITIONS.CRATER_IN_FRONT }, action: { type: Sim.ACTIONS.SIDESTEP } },
    { condition: { type: Sim.CONDITIONS.ALWAYS }, action: { type: Sim.ACTIONS.EXPLORE } }
  ];
  
  const { state: run1 } = runScenarioDetailed(sensors, rules);
  const { state: run2 } = runScenarioDetailed(sensors, rules);
  
  assertEqual(run1.outcome, run2.outcome, 'Same outcome');
  assertEqual(run1.tick, run2.tick, 'Same tick count');
  assertEqual(run1.tilesScanned, run2.tilesScanned, 'Same tiles scanned');
  assertEqual(run1.battery, run2.battery, 'Same battery');
  assertEqual(run1.col, run2.col, 'Same final column');
  assertEqual(run1.row, run2.row, 'Same final row');
  
  let tracesMatch = run1.trace.length === run2.trace.length;
  if (tracesMatch) {
    for (let i = 0; i < run1.trace.length; i++) {
      if (run1.trace[i].tick !== run2.trace[i].tick ||
          run1.trace[i].positionAfter.col !== run2.trace[i].positionAfter.col ||
          run1.trace[i].positionAfter.row !== run2.trace[i].positionAfter.row) {
        tracesMatch = false;
        break;
      }
    }
  }
  assert(tracesMatch, 'Traces match exactly');
})();

// === SUMMARY ===
console.log('\n=== SUMMARY ===');
console.log(`Passed: ${passed}`);
console.log(`Failed: ${failed}`);

if (failed > 0) {
  process.exit(1);
}
