// Far Rover Simulation Tests
// Tests for all 15 acceptance criteria

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

function runScenario(sensors, rules, uplinkAtTick = null, uplinkSlot = null, uplinkCondition = null, uplinkAction = null) {
  const state = Sim.createInitialState(sensors, rules);
  let previouslyRevealed = null;
  let autoPauseCount = 0;
  
  while (!state.outcome && state.tick < 500) {
    const result = Sim.runTick(state, previouslyRevealed);
    
    // Handle auto-pause continuation
    if (result.autoPause && result.continueFromStep4) {
      autoPauseCount++;
      
      // Apply uplink if at the right tick and unused
      if (uplinkAtTick === state.tick && !state.uplink.used) {
        Sim.applyUplink(state, uplinkSlot, uplinkCondition, uplinkAction);
      }
      
      // Continue from step 4
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
  
  return { state, autoPauseCount };
}

// === CRITERION 1: Map matches section 4 exactly ===
console.log('\n=== Criterion 1: Map structure ===');
(() => {
  const terrain = Sim.createTerrain();
  
  // Count terrain types
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
  
  // Check specific locations from spec
  const checkTerrain = (cell, expected) => {
    const col = cell.charCodeAt(0) - 'A'.charCodeAt(0);
    const row = parseInt(cell.slice(1)) - 1;
    return terrain[row][col] === expected;
  };
  
  assert(checkTerrain('F8', Sim.TERRAIN.CRATER), 'F8 is crater');
  assert(checkTerrain('D11', Sim.TERRAIN.ORE), 'D11 is ore');
  assert(checkTerrain('F10', Sim.TERRAIN.DUST), 'F10 is dust');
  assert(checkTerrain('A1', Sim.TERRAIN.EMPTY), 'A1 is empty');
  
  // Check all tiles start hidden
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
  // Sensor conditions
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
console.log('\n=== Criterion 5: Scenario A ===');
(() => {
  const sensors = ['distance', 'spectral', 'camera'];
  const rules = [
    { condition: { type: Sim.CONDITIONS.ALWAYS }, action: { type: Sim.ACTIONS.EXPLORE } }
  ];
  
  const state = Sim.createInitialState(sensors, rules);
  let previouslyRevealed = null;
  let autoPauses = [];
  
  // Run tick by tick to verify exact behavior
  const tickData = [];
  
  for (let i = 0; i < 10 && !state.outcome; i++) {
    const result = Sim.runTick(state, previouslyRevealed);
    
    if (result.autoPause && result.continueFromStep4) {
      autoPauses.push({ tick: state.tick, reason: result.autoPause.reason });
      const contResult = Sim.continueTickFromStep4(state, result.tickRecord, state.readings);
      previouslyRevealed = contResult.newlyRevealed;
      
      tickData.push({
        tick: state.tick,
        col: state.col,
        row: state.row,
        battery: state.battery,
        tilesScanned: state.tilesScanned
      });
      
      if (contResult.endCondition) {
        state.outcome = contResult.endCondition.outcome;
        break;
      }
      continue;
    }
    
    tickData.push({
      tick: state.tick,
      col: state.col,
      row: state.row,
      battery: state.battery,
      tilesScanned: state.tilesScanned
    });
    
    previouslyRevealed = result.newlyRevealed;
  }
  
  // Check tick 1: F12, battery 19, 6 tiles (3x3 minus 3 off-grid)
  const t1 = tickData[0];
  assertEqual(t1.col, 5, 'Tick 1 at F (col 5)');
  assertEqual(t1.row, 11, 'Tick 1 at row 12');
  assertEqual(t1.battery, 19, 'Tick 1 battery 19');
  
  // Check tick 2: F11, battery 18, 9 tiles
  const t2 = tickData[1];
  assertEqual(t2.col, 5, 'Tick 2 at F');
  assertEqual(t2.row, 10, 'Tick 2 at row 11');
  assertEqual(t2.battery, 18, 'Tick 2 battery 18');
  
  // Check tick 3 auto-pause for dust (happens at start of tick 3)
  assert(autoPauses.some(p => p.tick === 3 && p.reason.includes('dust')), 
    'Auto-pause at tick 3 for dust');
  
  // Tick 3: F10, battery 16 (dust costs 2)
  const t3 = tickData[2];
  assertEqual(t3.col, 5, 'Tick 3 at F');
  assertEqual(t3.row, 9, 'Tick 3 at row 10 (F10)');
  assertEqual(t3.battery, 16, 'Tick 3 battery 16 (dust cost)');
  
  // Tick 4: F9, battery 15
  const t4 = tickData[3];
  assertEqual(t4.row, 8, 'Tick 4 at row 9 (F9)');
  assertEqual(t4.battery, 15, 'Tick 4 battery 15');
  
  // Check auto-pause at tick 5 for crater F8
  assert(autoPauses.some(p => p.tick === 5 && p.reason.includes('crater')), 
    'Auto-pause at tick 5 for crater');
  
  // Tick 5: lost at F8
  assertEqual(state.outcome, Sim.OUTCOMES.LOST_CRATER, 'Lost to crater');
  assertEqual(state.battery, 14, 'Final battery 14');
  assertEqual(state.tilesScanned, 18, 'Final tiles scanned 18');
})();

// === CRITERION 6: Scenario B ===
console.log('\n=== Criterion 6: Scenario B ===');
(() => {
  const sensors = ['distance', 'dust', 'spectral'];
  const rules = [
    { condition: { type: Sim.CONDITIONS.ALWAYS }, action: { type: Sim.ACTIONS.EXPLORE } }
  ];
  
  const { state, autoPauseCount } = runScenario(sensors, rules);
  
  assertEqual(state.outcome, Sim.OUTCOMES.LOST_CRATER, 'Lost to crater');
  assertEqual(state.tick, 5, 'Lost on tick 5');
  assertEqual(state.battery, 14, 'Battery 14');
  assertEqual(state.tilesScanned, 5, '5 tiles scanned (no camera)');
})();

// === CRITERION 7: Scenario C ===
console.log('\n=== Criterion 7: Scenario C ===');
(() => {
  const sensors = ['distance', 'dust', 'spectral'];
  const rules = [
    { condition: { type: Sim.CONDITIONS.CRATER_IN_FRONT }, action: { type: Sim.ACTIONS.SIDESTEP } },
    { condition: { type: Sim.CONDITIONS.ALWAYS }, action: { type: Sim.ACTIONS.EXPLORE } }
  ];
  
  const { state } = runScenario(sensors, rules);
  
  assertEqual(state.outcome, Sim.OUTCOMES.LOST_BATTERY, 'Lost to battery');
  assertEqual(state.tilesScanned, 19, '19 tiles scanned');
  assert(state.tick >= 20, 'At least tick 20');
})();

// === CRITERION 8: Scenario D ===
console.log('\n=== Criterion 8: Scenario D ===');
(() => {
  const sensors = ['distance', 'dust', 'spectral'];
  const rules = [
    { condition: { type: Sim.CONDITIONS.BATTERY_BELOW, n: 20 }, action: { type: Sim.ACTIONS.RETURN_CHARGE } },
    { condition: { type: Sim.CONDITIONS.ALWAYS }, action: { type: Sim.ACTIONS.EXPLORE } }
  ];
  
  const { state } = runScenario(sensors, rules);
  
  assertEqual(state.outcome, Sim.OUTCOMES.STUCK_LOOP, 'Stuck in loop');
  assert(state.tick <= 20, 'Stuck before tick 20');
})();

// === CRITERION 9: Scenario E ===
console.log('\n=== Criterion 9: Scenario E ===');
(() => {
  const sensors = ['distance', 'spectral', 'camera'];
  const rules = [
    { condition: { type: Sim.CONDITIONS.BATTERY_BELOW, n: 8 }, action: { type: Sim.ACTIONS.RETURN_CHARGE } },
    { condition: { type: Sim.CONDITIONS.CRATER_IN_FRONT }, action: { type: Sim.ACTIONS.SIDESTEP } },
    { condition: { type: Sim.CONDITIONS.ORE_NEXT_TO }, action: { type: Sim.ACTIONS.GO_TO_ORE } },
    { condition: { type: Sim.CONDITIONS.ALWAYS }, action: { type: Sim.ACTIONS.EXPLORE } }
  ];
  
  const { state } = runScenario(sensors, rules);
  
  assertEqual(state.outcome, Sim.OUTCOMES.SUCCESS_SCAN, 'Success by scan');
  assertEqual(state.tick, 23, 'Success on tick 23');
  assert(state.tilesScanned >= 30, 'At least 30 tiles scanned');
  assertEqual(state.cargo, 0, 'Cargo 0');
  assertEqual(state.col, 5, 'On lander (col F)');
  assertEqual(state.row, 12, 'On lander (row 13)');
})();

// === CRITERION 10: Scenario F ===
console.log('\n=== Criterion 10: Scenario F (uplink) ===');
(() => {
  const sensors = ['distance', 'dust', 'spectral'];
  const rules = [
    { condition: { type: Sim.CONDITIONS.ALWAYS }, action: { type: Sim.ACTIONS.EXPLORE } }
  ];
  
  // Run scenario B but use uplink at tick 5 to change rule 1 to "Crater in front → Sidestep"
  const { state } = runScenario(
    sensors, 
    rules,
    5, // uplinkAtTick
    0, // slot (rule 1)
    { type: Sim.CONDITIONS.CRATER_IN_FRONT },
    { type: Sim.ACTIONS.SIDESTEP }
  );
  
  // After uplink, tick 5 should sidestep to G9, but then ticks 6-8 no rule matches
  // Actually the uplink changes rule 1, so "Crater in front" will only be true when facing crater
  // Since rover moved away, the condition becomes false and no rule matches
  assertEqual(state.outcome, Sim.OUTCOMES.STUCK_NO_MOVE, 'Stuck (no move) after uplink');
  assert(state.uplink.used, 'Uplink was used');
})();

// === CRITERION 11: Scenario G ===
console.log('\n=== Criterion 11: Scenario G (first-match) ===');
(() => {
  const sensors = ['distance', 'dust', 'spectral'];
  const rules = [
    { condition: { type: Sim.CONDITIONS.ALWAYS }, action: { type: Sim.ACTIONS.EXPLORE } },
    { condition: { type: Sim.CONDITIONS.ALWAYS }, action: { type: Sim.ACTIONS.WAIT } }
  ];
  
  // Use uplink at tick 5 to change rule 2 to "Crater in front → Sidestep"
  // But rule 1 still fires first, so rover still drives into crater
  const { state } = runScenario(
    sensors,
    rules,
    5,
    1, // slot 2
    { type: Sim.CONDITIONS.CRATER_IN_FRONT },
    { type: Sim.ACTIONS.SIDESTEP }
  );
  
  assertEqual(state.outcome, Sim.OUTCOMES.LOST_CRATER, 'Lost to crater (first-match)');
  assertEqual(state.tick, 5, 'Lost on tick 5');
})();

// === CRITERION 12: Uplink constraints ===
console.log('\n=== Criterion 12: Uplink constraints ===');
(() => {
  const state = Sim.createInitialState(['distance', 'spectral', 'camera'], [
    { condition: { type: Sim.CONDITIONS.ALWAYS }, action: { type: Sim.ACTIONS.WAIT } }
  ]);
  
  // First uplink should work
  const success1 = Sim.applyUplink(state, 0, 
    { type: Sim.CONDITIONS.ALWAYS }, 
    { type: Sim.ACTIONS.EXPLORE }
  );
  assert(success1, 'First uplink succeeds');
  assert(state.uplink.used, 'Uplink marked as used');
  
  // Second uplink should fail
  const success2 = Sim.applyUplink(state, 0,
    { type: Sim.CONDITIONS.ALWAYS },
    { type: Sim.ACTIONS.WAIT }
  );
  assert(!success2, 'Second uplink fails');
})();

// === CRITERION 13: End screen and rerun ===
console.log('\n=== Criterion 13: Trace and state preservation ===');
(() => {
  const { state } = runScenario(['distance', 'spectral', 'camera'], [
    { condition: { type: Sim.CONDITIONS.ALWAYS }, action: { type: Sim.ACTIONS.EXPLORE } }
  ]);
  
  assert(state.trace.length >= 5, 'At least 5 ticks in trace');
  
  // Check trace has required fields
  const lastTick = state.trace[state.trace.length - 1];
  assert('tick' in lastTick, 'Trace has tick number');
  assert('positionAfter' in lastTick, 'Trace has position');
  assert('battery' in lastTick, 'Trace has battery');
  assert('ruleReason' in lastTick, 'Trace has rule reason');
})();

// === CRITERION 14: Run counter and log ===
console.log('\n=== Criterion 14: Run logging ===');
(() => {
  // This is a UI feature, but we can verify state supports it
  const state1 = Sim.createInitialState(['distance', 'spectral', 'camera'], []);
  const state2 = Sim.createInitialState(['distance', 'dust', 'spectral'], []);
  
  // States are independent
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
  
  // Run same scenario twice
  const { state: run1 } = runScenario(sensors, rules);
  const { state: run2 } = runScenario(sensors, rules);
  
  assertEqual(run1.outcome, run2.outcome, 'Same outcome');
  assertEqual(run1.tick, run2.tick, 'Same tick count');
  assertEqual(run1.tilesScanned, run2.tilesScanned, 'Same tiles scanned');
  assertEqual(run1.battery, run2.battery, 'Same battery');
  assertEqual(run1.col, run2.col, 'Same final column');
  assertEqual(run1.row, run2.row, 'Same final row');
  
  // Compare traces
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
