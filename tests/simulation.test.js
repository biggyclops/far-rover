// Far Rover Simulation Tests - v3.2 Rules
// Tests for all acceptance criteria with EXACT spec values from demo-rules-update.md
// Spec reference: demo-rules-update.md (v3.2 kit rules)

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
      
      // Apply uplink if at the right tick, unused, and tick >= 1
      if (uplinkAtTick === state.tick && Sim.canUseUplink(state)) {
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
        cargo: state.cargo,
        goalMet: state.goalMet,
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
      cargo: state.cargo,
      goalMet: state.goalMet,
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
  assertEqual(state.goalMet, false, 'Goal not met at start');
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
  assert(Sim.isConditionLegal(Sim.CONDITIONS.GOAL_MET, []),
    'Goal met is always legal (v3.2)');
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

// === CRITERION 5: Scenario A (v3.2) ===
// v3.2: Distance, Spectral, Camera; rule 1: Always → Explore
// - Ticks 1-4 end at F12, F11, F10, F9 with battery 19, 18, 16, 15 and tiles 1, 2, 3, 4
// - Auto-pauses at start of tick 3 (camera dust F10, G10) and start of tick 5 (crater F8)
// - Tick 5: turns east at F9 (Explore avoids known crater F8)
// - Result: lost (battery) at J11 on tick 25 with 17 tiles scanned
console.log('\n=== Criterion 5: Scenario A (v3.2) ===');
(() => {
  const sensors = ['distance', 'spectral', 'camera'];
  const rules = [
    { condition: { type: Sim.CONDITIONS.ALWAYS }, action: { type: Sim.ACTIONS.EXPLORE } }
  ];
  
  const { state, autoPauses, tickHistory } = runScenarioDetailed(sensors, rules);
  
  // Tick 1: F12, battery 19, tiles 1 (camera reveals but only driven tile counts)
  const t1 = getTick(tickHistory, 1);
  assertEqual(t1?.position, 'F12', 'Tick 1 position F12');
  assertEqual(t1?.battery, 19, 'Tick 1 battery 19');
  assertEqual(t1?.tilesScanned, 1, 'Tick 1 tiles 1 (v3.2: only driven-onto counts)');
  
  // Tick 2: F11, battery 18, tiles 2
  const t2 = getTick(tickHistory, 2);
  assertEqual(t2?.position, 'F11', 'Tick 2 position F11');
  assertEqual(t2?.battery, 18, 'Tick 2 battery 18');
  assertEqual(t2?.tilesScanned, 2, 'Tick 2 tiles 2');
  
  // Auto-pause at start of tick 3 for dust (camera)
  assert(autoPauses.some(p => p.tick === 3 && p.reason.toLowerCase().includes('dust')), 
    'Auto-pause at tick 3 for dust');
  
  // Tick 3: F10, battery 16, tiles 3
  const t3 = getTick(tickHistory, 3);
  assertEqual(t3?.position, 'F10', 'Tick 3 position F10');
  assertEqual(t3?.battery, 16, 'Tick 3 battery 16');
  assertEqual(t3?.tilesScanned, 3, 'Tick 3 tiles 3');
  
  // Tick 4: F9, battery 15, tiles 4
  const t4 = getTick(tickHistory, 4);
  assertEqual(t4?.position, 'F9', 'Tick 4 position F9');
  assertEqual(t4?.battery, 15, 'Tick 4 battery 15');
  assertEqual(t4?.tilesScanned, 4, 'Tick 4 tiles 4');
  
  // Auto-pause at start of tick 5 for crater
  assert(autoPauses.some(p => p.tick === 5 && p.reason.includes('crater')), 
    'Auto-pause at tick 5 for crater');
  
  // Tick 5: F9 turns east (Explore avoids known crater F8)
  const t5 = getTick(tickHistory, 5);
  assertEqual(t5?.position, 'F9', 'Tick 5 position F9 (turn, no move)');
  assertEqual(t5?.facing, Sim.DIRECTIONS.EAST, 'Tick 5 facing east (avoids crater)');
  
  // Final: lost (battery) at J11 on tick 25, 17 tiles
  assertEqual(state.outcome, Sim.OUTCOMES.LOST_BATTERY, 'Lost to battery (v3.2)');
  assertEqual(state.tick, 25, 'Lost on tick 25');
  assertEqual(Sim.formatCell(state.col, state.row), 'J11', 'Final position J11');
  assertEqual(state.tilesScanned, 17, 'Final tiles 17');
})();

// === CRITERION 6: Scenario B (v3.2 - first minute story) ===
// v3.2: Distance, Dust, Spectral; rule 1: Always → Explore
// - Ends at F12, F11, F10, F9, F8 on ticks 1-5. Battery 14, 4 tiles scanned (craters don't count).
// - Auto-pauses at start of tick 4 (dust sensor, F10) and start of tick 5 (crater F8)
// - Result: lost (crater) on tick 5
console.log('\n=== Criterion 6: Scenario B (v3.2 - first minute) ===');
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
  
  // Tick 5: lost (crater) at F8, battery 14, tiles 4 (craters don't count)
  assertEqual(state.outcome, Sim.OUTCOMES.LOST_CRATER, 'Lost to crater');
  assertEqual(state.tick, 5, 'Lost on tick 5');
  assertEqual(state.battery, 14, 'Final battery 14');
  assertEqual(state.tilesScanned, 4, 'Final tiles 4 (v3.2: craters dont count)');
})();

// === CRITERION 7: Scenario C ===
// Unchanged: Distance, Dust, Spectral; rule 1: Crater in front → Sidestep; rule 2: Always → Explore
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
// Unchanged: Distance, Dust, Spectral; rule 1: Battery below 20 → Return and charge; rule 2: Always → Explore
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

// === CRITERION 9: Scenario E (v3.2 - NEW) ===
// v3.2: Distance, Spectral, Camera; Battery below 8 → Return | Goal met → Return | Ore next to → Go to ore | Always → Explore
// - Go to ore fires on ticks 5 (G9), 7 (H10), 23 (D11)
// - Charge on ticks 15-17
// - Result: success (ore) on tick 29, battery 10, 14 tiles, 3 ore
console.log('\n=== Criterion 9: Scenario E (v3.2 - ore program) ===');
(() => {
  const sensors = ['distance', 'spectral', 'camera'];
  const rules = [
    { condition: { type: Sim.CONDITIONS.BATTERY_BELOW, n: 8 }, action: { type: Sim.ACTIONS.RETURN_CHARGE } },
    { condition: { type: Sim.CONDITIONS.GOAL_MET }, action: { type: Sim.ACTIONS.RETURN_CHARGE } },
    { condition: { type: Sim.CONDITIONS.ORE_NEXT_TO }, action: { type: Sim.ACTIONS.GO_TO_ORE } },
    { condition: { type: Sim.CONDITIONS.ALWAYS }, action: { type: Sim.ACTIONS.EXPLORE } }
  ];
  
  const { state, tickHistory } = runScenarioDetailed(sensors, rules);
  
  // Check Go to ore fires on tick 5 at G9
  const t5 = getTick(tickHistory, 5);
  assertEqual(t5?.position, 'G9', 'Tick 5 position G9 (Go to ore)');
  assertEqual(t5?.cargo, 1, 'Tick 5 cargo 1');
  
  // Result: success (ore) on tick 29
  assertEqual(state.outcome, Sim.OUTCOMES.SUCCESS_ORE, 'Success by ore (v3.2)');
  assertEqual(state.tick, 29, 'Success on tick 29');
  assertEqual(state.battery, 10, 'Final battery 10');
  assertEqual(state.tilesScanned, 14, 'Final tiles 14');
  assertEqual(state.cargo, 3, 'Final cargo 3');
  assert(state.goalMet, 'Goal met is true');
})();

// === CRITERION 10: Scenario F ===
// Unchanged: Scenario B, but at tick-5 auto-pause the uplink rewrites rule 1 to "Crater in front → Sidestep"
// - tick 5 moves to G9
// - ticks 6-8 match no rule
// - run pauses as stuck (no move) on tick 8
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
// Unchanged: Scenario B plus rule 2: Always → Wait; at tick-5 pause uplink rewrites rule 2 to "Crater in front → Sidestep"
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

// === CRITERION H: Printed Starter Program (v3.2) ===
// v3.2: Kit starter program: Crater in front → Sidestep | Battery below 12 → Return | On ore → Drill | Always → Explore
// - Distance + Spectral + Camera: success tick 46, 25 tiles, 1 ore, battery 4
// - Distance + Dust + Spectral: success tick 45, 25 tiles, 1 ore
console.log('\n=== Criterion H: Scenario H (starter program) ===');
(() => {
  const starterRules = [
    { condition: { type: Sim.CONDITIONS.CRATER_IN_FRONT }, action: { type: Sim.ACTIONS.SIDESTEP } },
    { condition: { type: Sim.CONDITIONS.BATTERY_BELOW, n: 12 }, action: { type: Sim.ACTIONS.RETURN_CHARGE } },
    { condition: { type: Sim.CONDITIONS.ON_ORE }, action: { type: Sim.ACTIONS.DRILL } },
    { condition: { type: Sim.CONDITIONS.ALWAYS }, action: { type: Sim.ACTIONS.EXPLORE } }
  ];
  
  // With camera: success tick 46
  const cameraSensors = ['distance', 'spectral', 'camera'];
  const { state: cameraState, tickHistory: cameraHistory } = runScenarioDetailed(cameraSensors, starterRules);
  
  assertEqual(cameraState.outcome, Sim.OUTCOMES.SUCCESS_SCAN, 'Camera build: success (scan)');
  assertEqual(cameraState.tick, 46, 'Camera build: tick 46');
  assertEqual(cameraState.tilesScanned, 25, 'Camera build: 25 tiles');
  assertEqual(cameraState.cargo, 1, 'Camera build: 1 ore');
  assertEqual(cameraState.battery, 4, 'Camera build: battery 4');
  
  // Goal met on tick 42
  const t42 = getTick(cameraHistory, 42);
  assert(t42?.goalMet, 'Camera build: goal met on tick 42');
  
  // With dust sensor: success tick 45
  const dustSensors = ['distance', 'dust', 'spectral'];
  const { state: dustState } = runScenarioDetailed(dustSensors, starterRules);
  
  assertEqual(dustState.outcome, Sim.OUTCOMES.SUCCESS_SCAN, 'Dust build: success (scan)');
  assertEqual(dustState.tick, 45, 'Dust build: tick 45');
  assertEqual(dustState.tilesScanned, 25, 'Dust build: 25 tiles');
  assertEqual(dustState.cargo, 1, 'Dust build: 1 ore');
})();

// === CRITERION I: Camera is map knowledge only (v3.2) ===
// v3.2: Distance, Spectral, Camera; Battery below 11 → Return | Always → Explore
// - Goal met on tick 39 (25 tiles)
// - Tick 40: Return drives from E8 into known crater F8: lost (crater)
console.log('\n=== Criterion I: Scenario I (camera map knowledge only) ===');
(() => {
  const sensors = ['distance', 'spectral', 'camera'];
  const rules = [
    { condition: { type: Sim.CONDITIONS.BATTERY_BELOW, n: 11 }, action: { type: Sim.ACTIONS.RETURN_CHARGE } },
    { condition: { type: Sim.CONDITIONS.ALWAYS }, action: { type: Sim.ACTIONS.EXPLORE } }
  ];
  
  const { state, tickHistory } = runScenarioDetailed(sensors, rules);
  
  // Goal met on tick 39
  const t39 = getTick(tickHistory, 39);
  assertEqual(t39?.tilesScanned, 25, 'Tick 39: 25 tiles');
  assert(t39?.goalMet, 'Tick 39: goal met');
  
  // Lost on tick 40 at F8 (Return drives into known crater)
  assertEqual(state.outcome, Sim.OUTCOMES.LOST_CRATER, 'Lost to crater (Return into known crater)');
  assertEqual(state.tick, 40, 'Lost on tick 40');
  assertEqual(Sim.formatCell(state.col, state.row), 'F8', 'Final position F8');
  assertEqual(state.battery, 5, 'Final battery 5');
})();

// === CRITERION 12: Uplink constraints (v3.2) ===
console.log('\n=== Criterion 12: Uplink constraints (v3.2) ===');
(() => {
  const state = Sim.createInitialState(['distance', 'spectral', 'camera'], [
    { condition: { type: Sim.CONDITIONS.ALWAYS }, action: { type: Sim.ACTIONS.WAIT } }
  ]);
  
  // v3.2: Uplink can't be used before tick 1
  assert(!Sim.canUseUplink(state), 'Uplink disabled before tick 1 (v3.2)');
  
  // Run tick 1
  Sim.runTick(state, null);
  assert(Sim.canUseUplink(state), 'Uplink enabled after tick 1');
  
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

// === CRITERION 13: Trace and state ===
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

// === CRITERION 14: Run logging ===
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

// === v3.2 UNIT TESTS ===

console.log('\n=== v3.2 Unit Tests: Goal met condition ===');
(() => {
  // Goal met is sticky
  const state = Sim.createInitialState(['distance', 'spectral', 'camera'], [
    { condition: { type: Sim.CONDITIONS.ALWAYS }, action: { type: Sim.ACTIONS.EXPLORE } }
  ]);
  
  // Manually set to goal met condition
  state.tilesScanned = 25;
  state.goalMet = false;
  
  // Run a tick to trigger goal check
  Sim.runTick(state, null);
  assert(state.goalMet, 'Goal met becomes true at 25 tiles');
  
  // Clear tiles but goal should stay met (sticky)
  const savedGoalMet = state.goalMet;
  state.tilesScanned = 10;
  const readings = Sim.computeReadings(state);
  assert(readings.goalMet, 'Goal met reading stays true (sticky)');
})();

console.log('\n=== v3.2 Unit Tests: Camera tiles dont count ===');
(() => {
  const state = Sim.createInitialState(['distance', 'spectral', 'camera'], []);
  state.col = 5;
  state.row = 11; // F12
  
  // Simulate driving onto F12 with camera
  Sim.scan(state, true, { moved: true });
  
  // Should have 1 tile (F12 only, not the camera-revealed tiles)
  assertEqual(state.tilesScanned, 1, 'Only driven-onto tile counts (not camera)');
})();

console.log('\n=== v3.2 Unit Tests: Explore avoids known craters ===');
(() => {
  const state = Sim.createInitialState(['distance', 'spectral', 'camera'], [
    { condition: { type: Sim.CONDITIONS.ALWAYS }, action: { type: Sim.ACTIONS.EXPLORE } }
  ]);
  
  // Move to F9 facing north (toward crater F8)
  state.col = 5;
  state.row = 8; // F9
  state.facing = Sim.DIRECTIONS.NORTH;
  state.revealed[7][5] = true; // Reveal F8 (crater)
  state.tilesScanned = 1; // Simulate having scanned one tile
  
  const result = Sim.runTick(state, null);
  
  // Should not be on the crater
  assert(Sim.formatCell(state.col, state.row) !== 'F8', 
    'Explore avoids known crater');
})();

console.log('\n=== v3.2 Unit Tests: Return can drive into known crater ===');
(() => {
  const state = Sim.createInitialState(['distance', 'spectral', 'camera'], [
    { condition: { type: Sim.CONDITIONS.ALWAYS }, action: { type: Sim.ACTIONS.RETURN_CHARGE } }
  ]);
  
  // Position at E8, facing east toward F8 (crater), with F8 known
  state.col = 4; // E
  state.row = 7; // 8
  state.facing = Sim.DIRECTIONS.EAST;
  state.revealed[7][5] = true; // Reveal F8 (crater)
  state.battery = 10;
  // Mark crater as already seen to avoid auto-pause
  state.hazardsSeen.add('crater:F8');
  
  const result = Sim.runTick(state, null);
  
  // Return should move into the crater (it doesn't avoid known craters)
  assertEqual(state.col, 5, 'Return moved to F8 (into known crater)');
  assertEqual(state.row, 7, 'Return moved to row 8');
  assertEqual(state.outcome, Sim.OUTCOMES.LOST_CRATER, 'Lost to crater');
})();

console.log('\n=== v3.2 Unit Tests: Sidestep does nothing on lander ===');
(() => {
  const state = Sim.createInitialState(['distance', 'spectral', 'camera'], [
    { condition: { type: Sim.CONDITIONS.ALWAYS }, action: { type: Sim.ACTIONS.SIDESTEP } }
  ]);
  
  // Start on lander
  assertEqual(state.col, 5, 'Starts on lander col');
  assertEqual(state.row, 12, 'Starts on lander row');
  
  const result = Sim.runTick(state, null);
  
  // Should still be on lander
  assertEqual(state.col, 5, 'Still on lander col');
  assertEqual(state.row, 12, 'Still on lander row');
  assert(!result.tickRecord.actionResult.moved, 'Sidestep did not move');
})();

console.log('\n=== v3.2 Unit Tests: Charge at full battery on lander ===');
(() => {
  const state = Sim.createInitialState(['distance', 'spectral', 'camera'], [
    { condition: { type: Sim.CONDITIONS.ALWAYS }, action: { type: Sim.ACTIONS.RETURN_CHARGE } }
  ]);
  
  // Battery is already 20 on lander
  assertEqual(state.battery, 20, 'Battery starts at 20');
  
  const result = Sim.runTick(state, null);
  
  // Should start charging even at full battery
  assert(result.tickRecord.actionResult.charging, 'Starts charging at full battery');
  assert(state.charging, 'State shows charging');
})();

console.log('\n=== v3.2 Unit Tests: Go to ore costs 3 and drills ===');
(() => {
  const state = Sim.createInitialState(['distance', 'spectral', 'camera'], [
    { condition: { type: Sim.CONDITIONS.ORE_NEXT_TO }, action: { type: Sim.ACTIONS.GO_TO_ORE } }
  ]);
  
  // Position next to ore at G9
  state.col = 5; // F
  state.row = 8; // 9
  state.facing = Sim.DIRECTIONS.NORTH;
  state.battery = 10;
  // Mark crater as already seen to avoid auto-pause (F8 is crater in front)
  state.hazardsSeen.add('crater:F8');
  
  const result = Sim.runTick(state, null);
  
  // Should move to G9 and drill in same tick, cost 3
  assertEqual(result.tickRecord.actionResult.moved, true, 'Go to ore moved');
  assertEqual(result.tickRecord.actionResult.drilled, true, 'Go to ore drilled');
  assertEqual(state.battery, 7, 'Battery reduced by 3 (1 move + 2 drill)');
  assertEqual(state.cargo, 1, 'Cargo increased');
})();

console.log('\n=== v3.2 Unit Tests: Go to ore costs 0 with no adjacent ore ===');
(() => {
  const state = Sim.createInitialState(['distance', 'spectral', 'camera'], [
    { condition: { type: Sim.CONDITIONS.ALWAYS }, action: { type: Sim.ACTIONS.GO_TO_ORE } }
  ]);
  
  // Position not next to any ore (on lander)
  state.battery = 10;
  
  const result = Sim.runTick(state, null);
  
  // Should do nothing, cost 0
  assert(!result.tickRecord.actionResult.moved, 'Go to ore did not move');
  assertEqual(state.battery, 10, 'Battery unchanged (no adjacent ore = cost 0)');
})();

console.log('\n=== v3.2 Unit Tests: Dust costs 2 without Dust sensor ===');
(() => {
  // No Dust sensor
  const state = Sim.createInitialState(['distance', 'spectral', 'camera'], [
    { condition: { type: Sim.CONDITIONS.ALWAYS }, action: { type: Sim.ACTIONS.EXPLORE } }
  ]);
  
  // Manually move to just before dust
  state.col = 5;
  state.row = 10; // F11
  state.battery = 10;
  state.facing = Sim.DIRECTIONS.NORTH;
  // Mark current tile and path from lander as revealed (driven onto)
  state.revealed[10][5] = true; // F11
  state.revealed[11][5] = true; // F12
  state.tilesScanned = 2;
  
  // Next move will be to F10 (dust)
  const result = Sim.runTick(state, null);
  
  // Should cost 2 for dust even without sensor
  assertEqual(state.battery, 8, 'Dust costs 2 even without Dust sensor');
})();

console.log('\n=== v3.2 Unit Tests: Double charge stuck ===');
(() => {
  const state = Sim.createInitialState(['distance', 'spectral', 'camera'], [
    { condition: { type: Sim.CONDITIONS.ALWAYS }, action: { type: Sim.ACTIONS.RETURN_CHARGE } }
  ]);
  
  // Run through first charge (3 ticks) + start second = 4 ticks
  for (let i = 0; i < 4 && !state.outcome; i++) {
    Sim.runTick(state, null);
  }
  
  assertEqual(state.outcome, Sim.OUTCOMES.STUCK_CHARGE, 'Stuck after double charge');
})();

console.log('\n=== v3.2 Unit Tests: Circling includes turns in place ===');
(() => {
  const state = Sim.createInitialState(['distance', 'spectral', 'camera'], [
    { condition: { type: Sim.CONDITIONS.ALWAYS }, action: { type: Sim.ACTIONS.EXPLORE } }
  ]);
  
  // Move to a position then manually create circling with turns
  state.col = 10; // K
  state.row = 0; // 1
  state.facing = Sim.DIRECTIONS.NORTH;
  
  // Reveal all tiles so Explore has nowhere to go and turns in place
  for (let r = 0; r < 12; r++) {
    for (let c = 0; c < 12; c++) {
      state.revealed[r][c] = true;
    }
  }
  
  // Should get stuck in circling (no move, keeps turning)
  for (let i = 0; i < 10 && !state.outcome; i++) {
    Sim.runTick(state, null);
  }
  
  // Should be stuck (either no move or circling depending on Explore behavior)
  assert(state.outcome === Sim.OUTCOMES.STUCK_NO_MOVE || state.outcome === Sim.OUTCOMES.STUCK_LOOP,
    'Stuck from circling or no move');
})();

// === PLAYTEST FIXES ===

console.log('\n=== Playtest: charge-start does not count as idle (Player 2 bug 1) ===');
(() => {
  const sensors = ['distance', 'spectral', 'camera'];
  const rules = [
    { condition: { type: Sim.CONDITIONS.BATTERY_BELOW, n: 13 }, action: { type: Sim.ACTIONS.RETURN_CHARGE } },
    { condition: { type: Sim.CONDITIONS.BATTERY_BELOW, n: 20 }, action: { type: Sim.ACTIONS.EXPLORE } },
    { condition: { type: Sim.CONDITIONS.ALWAYS }, action: { type: Sim.ACTIONS.DRILL } }
  ];
  const { state } = runScenarioDetailed(sensors, rules);
  assertEqual(state.outcome, Sim.OUTCOMES.SUCCESS_SCAN, 'Player 2 repro: success (scan)');
  assertEqual(state.tick, 116, 'Player 2 repro: tick 116');
  assertEqual(state.tilesScanned, 26, 'Player 2 repro: 26 tiles');
})();

console.log('\n=== Playtest: charge-start leaves idle counter unchanged ===');
(() => {
  const state = Sim.createInitialState(['distance', 'spectral', 'camera'], [
    { condition: { type: Sim.CONDITIONS.ALWAYS }, action: { type: Sim.ACTIONS.RETURN_CHARGE } }
  ]);
  Sim.runTick(state, null);
  assert(state.charging, 'Charge started');
  assertEqual(state.noMoveCount, 0, 'Charge-start turn does not increment idle');
  assertEqual(state.outcome, null, 'Not stuck after charge start');
})();

console.log('\n=== Playtest: lander idle copy when no rule matches ===');
(() => {
  const { state } = runScenarioDetailed(['distance', 'spectral', 'camera'], [
    { condition: { type: Sim.CONDITIONS.BATTERY_BELOW, n: 5 }, action: { type: Sim.ACTIONS.EXPLORE } }
  ]);
  assertEqual(state.outcome, Sim.OUTCOMES.STUCK_NO_MOVE, 'Stuck idle on lander');
  assertEqual(state.endReason, 'No rule was true, so the rover never moved.', 'Lander idle copy');
})();

console.log('\n=== Playtest: uplink does not reset stuck counters ===');
(() => {
  const state = Sim.createInitialState(['distance', 'spectral', 'camera'], [
    { condition: { type: Sim.CONDITIONS.ALWAYS }, action: { type: Sim.ACTIONS.WAIT } }
  ]);
  Sim.runTick(state, null);
  assertEqual(state.noMoveCount, 1, 'Idle 1 after wait');
  const ok = Sim.applyUplink(state, 0,
    { type: Sim.CONDITIONS.ALWAYS },
    { type: Sim.ACTIONS.WAIT }
  );
  assert(ok, 'Uplink applied');
  assertEqual(state.noMoveCount, 1, 'Idle counter survives uplink');
  Sim.runTick(state, null);
  Sim.runTick(state, null);
  assertEqual(state.outcome, Sim.OUTCOMES.STUCK_NO_MOVE, 'Stuck after 3 waits across uplink');
})();

console.log('\n=== Playtest: uplink clamps battery N and is blocked after outcome ===');
(() => {
  const state = Sim.createInitialState(['distance', 'spectral', 'camera'], [
    { condition: { type: Sim.CONDITIONS.ALWAYS }, action: { type: Sim.ACTIONS.EXPLORE } }
  ]);
  Sim.runTick(state, null);
  const ok = Sim.applyUplink(state, 0,
    { type: Sim.CONDITIONS.BATTERY_BELOW, n: 99 },
    { type: Sim.ACTIONS.RETURN_CHARGE }
  );
  assert(ok, 'Uplink with out-of-range N applies');
  assertEqual(state.rules[0].condition.n, 20, 'N clamped to 20');

  const stuck = Sim.createInitialState(['distance', 'spectral', 'camera'], [
    { condition: { type: Sim.CONDITIONS.ALWAYS }, action: { type: Sim.ACTIONS.WAIT } }
  ]);
  for (let i = 0; i < 3 && !stuck.outcome; i++) Sim.runTick(stuck, null);
  assert(stuck.outcome, 'Wait program ends stuck');
  assert(!Sim.canUseUplink(stuck), 'Uplink disabled after run ended');
  assert(!Sim.applyUplink(stuck, 0, { type: Sim.CONDITIONS.ALWAYS }, { type: Sim.ACTIONS.EXPLORE }),
    'Uplink apply fails after outcome');
})();

console.log('\n=== Playtest: uplink during auto-pause does not add a phantom tick ===');
(() => {
  const sensors = ['distance', 'spectral', 'camera'];
  const starter = [
    { condition: { type: Sim.CONDITIONS.CRATER_IN_FRONT }, action: { type: Sim.ACTIONS.SIDESTEP } },
    { condition: { type: Sim.CONDITIONS.BATTERY_BELOW, n: 12 }, action: { type: Sim.ACTIONS.RETURN_CHARGE } },
    { condition: { type: Sim.CONDITIONS.ON_ORE }, action: { type: Sim.ACTIONS.DRILL } },
    { condition: { type: Sim.CONDITIONS.ALWAYS }, action: { type: Sim.ACTIONS.EXPLORE } }
  ];
  const state = Sim.createInitialState(sensors, starter);
  let prev = null;
  let pending = null;
  let didUplink = false;
  while (!state.outcome && state.tick < 200) {
    let r;
    if (pending) {
      const tr = pending;
      pending = null;
      r = Sim.continueTickFromStep4(state, tr, state.readings);
    } else {
      r = Sim.runTick(state, prev);
    }
    prev = r.newlyRevealed;
    if (r.autoPause) {
      pending = r.tickRecord;
      if (!didUplink) {
        didUplink = true;
        Sim.applyUplink(state, 3, { type: Sim.CONDITIONS.ALWAYS }, { type: Sim.ACTIONS.EXPLORE });
        // Keep pending — clearing it would start a new tick (phantom)
      }
      continue;
    }
    if (r.endCondition) {
      state.outcome = r.endCondition.outcome;
      break;
    }
    if (r.stuckCondition) break;
  }
  assert(didUplink, 'Uplink fired at first auto-pause');
  assertEqual(state.outcome, Sim.OUTCOMES.SUCCESS_SCAN, 'Starter still succeeds after pause-uplink');
  assertEqual(state.tick, 46, 'No phantom tick: still ends on 46');
  assertEqual(state.trace.length, state.tick, 'Trace ticks match tick counter');
})();

console.log('\n=== Playtest: Return into known crater explains itself ===');
(() => {
  const state = Sim.createInitialState(['distance', 'spectral', 'camera'], [
    { condition: { type: Sim.CONDITIONS.ALWAYS }, action: { type: Sim.ACTIONS.RETURN_CHARGE } }
  ]);
  state.col = 4;
  state.row = 7;
  state.facing = Sim.DIRECTIONS.EAST;
  state.revealed[7][5] = true;
  state.battery = 10;
  state.hazardsSeen.add('crater:F8');
  Sim.runTick(state, null);
  assertEqual(state.outcome, Sim.OUTCOMES.LOST_CRATER, 'Lost to crater');
  assert(state.endReason.includes("Return and charge doesn't avoid craters."),
    'End reason names Return crater behavior');
})();

console.log('\n=== Playtest: HUD battery-at-start is recorded on the tick ===');
(() => {
  const state = Sim.createInitialState(['distance', 'dust', 'spectral'], [
    { condition: { type: Sim.CONDITIONS.ALWAYS }, action: { type: Sim.ACTIONS.EXPLORE } }
  ]);
  const r = Sim.runTick(state, null);
  assertEqual(r.tickRecord.batteryAtStart, 20, 'Tick 1 battery-at-start is 20');
  assertEqual(r.tickRecord.battery, 19, 'Tick 1 battery after move is 19');
  assertEqual(r.tickRecord.readings.battery, 20, 'Readings battery is start-of-turn');
})();

console.log('\n=== Notify: hold like Wait; ping once per new ice ===');
(() => {
  function pathFor(actionType) {
    const state = Sim.createInitialState(['distance', 'spectral'], [
      { condition: { type: Sim.CONDITIONS.ON_ORE }, action: { type: actionType } },
      { condition: { type: Sim.CONDITIONS.ALWAYS }, action: { type: Sim.ACTIONS.EXPLORE } },
    ]);
    const path = [];
    let prev = null;
    while (!state.outcome && state.tick < 20) {
      const r = Sim.runTick(state, prev);
      if (r.autoPause && r.continueFromStep4) {
        Sim.continueTickFromStep4(state, r.tickRecord, state.readings);
      }
      prev = r.newlyRevealed;
      path.push(`${state.col},${state.row},${state.facing}`);
      if (r.endCondition || r.stuckCondition) break;
    }
    return path.join('|');
  }
  assertEqual(
    pathFor(Sim.ACTIONS.NOTIFY),
    pathFor(Sim.ACTIONS.WAIT),
    'On-ore Notify matches On-ore Wait for movement'
  );

  const holdWait = Sim.createInitialState(['distance'], [
    { condition: { type: Sim.CONDITIONS.ALWAYS }, action: { type: Sim.ACTIONS.WAIT } },
  ]);
  const holdNotify = Sim.createInitialState(['distance'], [
    { condition: { type: Sim.CONDITIONS.ALWAYS }, action: { type: Sim.ACTIONS.NOTIFY } },
  ]);
  for (let i = 0; i < 8; i++) {
    Sim.runTick(holdWait);
    Sim.runTick(holdNotify);
  }
  assertEqual(holdNotify.col, holdWait.col, 'Always Notify holds column like Wait');
  assertEqual(holdNotify.row, holdWait.row, 'Always Notify holds row like Wait');
  assertEqual(holdNotify.facing, holdWait.facing, 'Always Notify holds facing like Wait');

  const ores = Sim.TERRAIN_DATA.ores;
  const cell = ores[0];
  const col = cell.charCodeAt(0) - 65;
  const row = parseInt(cell.slice(1), 10) - 1;
  const state = Sim.createInitialState(['spectral'], [
    { condition: { type: Sim.CONDITIONS.ON_ORE }, action: { type: Sim.ACTIONS.NOTIFY } },
    { condition: { type: Sim.CONDITIONS.ALWAYS }, action: { type: Sim.ACTIONS.WAIT } },
  ]);
  state.col = col;
  state.row = row;
  const first = Sim.runTick(state);
  assert(first.tickRecord.actionResult.waited, 'Notify holds still');
  assert(first.tickRecord.actionResult.ping, 'First Notify on ore pings');
  assert(first.tickRecord.actionResult.confirmedIce, 'First ice Notify confirms');
  assert(state.iceConfirmed, 'State records iceConfirmed');
  const second = Sim.runTick(state);
  assert(second.tickRecord.actionResult.waited, 'Repeat Notify still holds');
  assert(!second.tickRecord.actionResult.ping, 'Repeat Notify with nothing new does not ping');
})();

// === SUMMARY ===
console.log('\n=== SUMMARY ===');
console.log(`Passed: ${passed}`);
console.log(`Failed: ${failed}`);

if (failed > 0) {
  process.exit(1);
}
