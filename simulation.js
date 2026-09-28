// Far Rover Simulation Module
// Pure and deterministic - no UI, no randomness, no side effects

// === MAP DATA ===
// Fixed 12x12 terrain, identical every run
// Columns A-L (0-11), Rows 1-12 (0-11)
// Lander is at column F (5), row 13 (special, off-grid)

export const TERRAIN = {
  EMPTY: 'empty',
  CRATER: 'crater',
  ORE: 'ore',
  DUST: 'dust'
};

export const DIRECTIONS = {
  NORTH: 'north',
  EAST: 'east',
  SOUTH: 'south',
  WEST: 'west'
};

// Direction vectors: [col delta, row delta]
export const DIR_VECTORS = {
  [DIRECTIONS.NORTH]: [0, -1],
  [DIRECTIONS.EAST]: [1, 0],
  [DIRECTIONS.SOUTH]: [0, 1],
  [DIRECTIONS.WEST]: [-1, 0]
};

// Turn order for relative directions (right, left, back)
export const RELATIVE_TURNS = {
  [DIRECTIONS.NORTH]: { right: DIRECTIONS.EAST, left: DIRECTIONS.WEST, back: DIRECTIONS.SOUTH },
  [DIRECTIONS.EAST]: { right: DIRECTIONS.SOUTH, left: DIRECTIONS.NORTH, back: DIRECTIONS.WEST },
  [DIRECTIONS.SOUTH]: { right: DIRECTIONS.WEST, left: DIRECTIONS.EAST, back: DIRECTIONS.NORTH },
  [DIRECTIONS.WEST]: { right: DIRECTIONS.NORTH, left: DIRECTIONS.SOUTH, back: DIRECTIONS.EAST }
};

// Fixed terrain data from spec section 4
const CRATERS = ['F8', 'C10', 'J9', 'D6', 'I6', 'G3', 'K4', 'B2', 'E1', 'L11'];
const ORES = ['D11', 'H10', 'G9', 'B7', 'E7', 'J7', 'H5', 'C4', 'K8', 'F2', 'I2', 'A12'];
const DUSTS = ['F10', 'G10', 'B5', 'B6', 'C5', 'J3', 'J2', 'K2'];

// Convert letter+number to [col, row] (0-indexed)
function parseCell(cell) {
  const col = cell.charCodeAt(0) - 'A'.charCodeAt(0);
  const row = parseInt(cell.slice(1)) - 1;
  return [col, row];
}

// Convert [col, row] to letter+number
export function formatCell(col, row) {
  if (row === 12) return 'Lander';
  return String.fromCharCode('A'.charCodeAt(0) + col) + (row + 1);
}

// Create the fixed terrain map
export function createTerrain() {
  const terrain = [];
  for (let row = 0; row < 12; row++) {
    terrain[row] = [];
    for (let col = 0; col < 12; col++) {
      terrain[row][col] = TERRAIN.EMPTY;
    }
  }
  
  for (const cell of CRATERS) {
    const [col, row] = parseCell(cell);
    terrain[row][col] = TERRAIN.CRATER;
  }
  for (const cell of ORES) {
    const [col, row] = parseCell(cell);
    terrain[row][col] = TERRAIN.ORE;
  }
  for (const cell of DUSTS) {
    const [col, row] = parseCell(cell);
    terrain[row][col] = TERRAIN.DUST;
  }
  
  return terrain;
}

// === SENSORS ===
export const SENSORS = {
  DISTANCE: 'distance',
  DUST: 'dust',
  SPECTRAL: 'spectral',
  CAMERA: 'camera',
  BATTERY: 'battery' // Always installed
};

// === CONDITIONS ===
export const CONDITIONS = {
  BATTERY_BELOW: 'battery_below',
  CRATER_IN_FRONT: 'crater_in_front',
  ON_DUST: 'on_dust',
  ORE_NEXT_TO: 'ore_next_to',
  ON_ORE: 'on_ore',
  ALWAYS: 'always'
};

// Which sensor each condition needs
export const CONDITION_SENSORS = {
  [CONDITIONS.BATTERY_BELOW]: null, // Always available
  [CONDITIONS.CRATER_IN_FRONT]: SENSORS.DISTANCE,
  [CONDITIONS.ON_DUST]: SENSORS.DUST,
  [CONDITIONS.ORE_NEXT_TO]: SENSORS.SPECTRAL,
  [CONDITIONS.ON_ORE]: SENSORS.SPECTRAL,
  [CONDITIONS.ALWAYS]: null
};

// === ACTIONS ===
export const ACTIONS = {
  EXPLORE: 'explore',
  RETURN_CHARGE: 'return_charge',
  SIDESTEP: 'sidestep',
  GO_TO_ORE: 'go_to_ore',
  DRILL: 'drill',
  WAIT: 'wait'
};

// Which sensor each action needs
export const ACTION_SENSORS = {
  [ACTIONS.EXPLORE]: null,
  [ACTIONS.RETURN_CHARGE]: null,
  [ACTIONS.SIDESTEP]: null,
  [ACTIONS.GO_TO_ORE]: SENSORS.SPECTRAL,
  [ACTIONS.DRILL]: null,
  [ACTIONS.WAIT]: null
};

// === GAME STATE ===
export function createInitialState(sensors, rules) {
  return {
    // Rover state
    col: 5, // F column
    row: 12, // Lander (off-grid)
    facing: DIRECTIONS.NORTH,
    battery: 20,
    cargo: 0,
    
    // Map state
    terrain: createTerrain(),
    revealed: Array(12).fill(null).map(() => Array(12).fill(false)),
    drilled: Array(12).fill(null).map(() => Array(12).fill(false)),
    tilesScanned: 0,
    
    // Run state
    tick: 0,
    sensors: sensors,
    rules: rules,
    uplink: { used: false, tick: null, slot: null, before: null, after: null },
    outcome: null,
    endReason: null,
    
    // Charging state
    charging: false,
    chargeTick: 0,
    
    // Stuck detection
    noMoveCount: 0,
    chargeWithoutLeaving: false,
    leftLanderSinceCharge: true,
    loopMemory: [], // [{col, row, facing}] since last progress
    lastProgress: null,
    
    // Auto-pause state
    autoPaused: false,
    autoPauseReason: null,
    hazardsSeen: new Set(), // "crater:F8", "dust:F10"
    
    // Trace for end screen
    trace: [],
    
    // Readings cache
    readings: {}
  };
}

// === HELPER FUNCTIONS ===

function isOnGrid(col, row) {
  return col >= 0 && col < 12 && row >= 0 && row < 12;
}

function isOnLander(col, row) {
  return col === 5 && row === 12;
}

function isValidNeighbor(col, row, fromCol, fromRow) {
  // On-grid cell
  if (isOnGrid(col, row)) return true;
  // Lander when moving south from F12
  if (col === 5 && row === 12 && fromCol === 5 && fromRow === 11) return true;
  // F12 when moving north from lander
  if (col === 5 && row === 11 && fromCol === 5 && fromRow === 12) return true;
  return false;
}

function getNeighbor(col, row, direction) {
  const [dc, dr] = DIR_VECTORS[direction];
  return [col + dc, row + dr];
}

function stepDistance(col1, row1, col2, row2) {
  // Lander counts as F13
  const r1 = row1 === 12 ? 12 : row1;
  const r2 = row2 === 12 ? 12 : row2;
  return Math.abs(col1 - col2) + Math.abs(r1 - r2);
}

function getMoveCost(state, toCol, toRow) {
  if (isOnLander(toCol, toRow)) return 1;
  if (state.terrain[toRow][toCol] === TERRAIN.DUST) return 2;
  return 1;
}

// === SENSOR READINGS ===

export function computeReadings(state) {
  const readings = {};
  
  // Battery (always)
  readings.battery = state.battery;
  
  // Distance sensor: crater in front?
  if (state.sensors.includes(SENSORS.DISTANCE)) {
    const [fc, fr] = getNeighbor(state.col, state.row, state.facing);
    if (isOnGrid(fc, fr) && state.terrain[fr][fc] === TERRAIN.CRATER) {
      readings.craterInFront = { detected: true, cell: formatCell(fc, fr) };
    } else {
      readings.craterInFront = { detected: false, cell: null };
    }
  }
  
  // Dust sensor: on dust?
  if (state.sensors.includes(SENSORS.DUST)) {
    if (isOnGrid(state.col, state.row) && state.terrain[state.row][state.col] === TERRAIN.DUST) {
      readings.onDust = true;
    } else {
      readings.onDust = false;
    }
  }
  
  // Spectral sensor: ore next to rover? on ore?
  if (state.sensors.includes(SENSORS.SPECTRAL)) {
    readings.oreNextTo = { detected: false, directions: [] };
    for (const dir of [DIRECTIONS.NORTH, DIRECTIONS.EAST, DIRECTIONS.SOUTH, DIRECTIONS.WEST]) {
      const [nc, nr] = getNeighbor(state.col, state.row, dir);
      if (isOnGrid(nc, nr) && state.terrain[nr][nc] === TERRAIN.ORE && !state.drilled[nr][nc]) {
        readings.oreNextTo.detected = true;
        readings.oreNextTo.directions.push(dir);
      }
    }
    
    if (isOnGrid(state.col, state.row) && 
        state.terrain[state.row][state.col] === TERRAIN.ORE && 
        !state.drilled[state.row][state.col]) {
      readings.onOre = true;
    } else {
      readings.onOre = false;
    }
  }
  
  return readings;
}

// === CONDITION EVALUATION ===

export function evaluateCondition(condition, state, readings) {
  switch (condition.type) {
    case CONDITIONS.BATTERY_BELOW:
      return readings.battery < condition.n;
    case CONDITIONS.CRATER_IN_FRONT:
      return readings.craterInFront?.detected || false;
    case CONDITIONS.ON_DUST:
      return readings.onDust || false;
    case CONDITIONS.ORE_NEXT_TO:
      return readings.oreNextTo?.detected || false;
    case CONDITIONS.ON_ORE:
      return readings.onOre || false;
    case CONDITIONS.ALWAYS:
      return true;
    default:
      return false;
  }
}

// === ACTION EXECUTION ===

function findNearestHiddenTile(state) {
  let minDist = Infinity;
  for (let row = 0; row < 12; row++) {
    for (let col = 0; col < 12; col++) {
      if (!state.revealed[row][col]) {
        const dist = stepDistance(state.col, state.row, col, row);
        if (dist < minDist) {
          minDist = dist;
        }
      }
    }
  }
  return minDist === Infinity ? null : minDist;
}

function distanceToNearestHidden(state, col, row) {
  let minDist = Infinity;
  for (let r = 0; r < 12; r++) {
    for (let c = 0; c < 12; c++) {
      if (!state.revealed[r][c]) {
        const dist = stepDistance(col, row, c, r);
        if (dist < minDist) {
          minDist = dist;
        }
      }
    }
  }
  return minDist;
}

function distanceToLander(col, row) {
  return stepDistance(col, row, 5, 12);
}

function executeExplore(state) {
  const currentDist = findNearestHiddenTile(state);
  if (currentDist === null) {
    return { moved: false, turned: false, reason: 'no hidden tiles' };
  }
  
  // Check front first
  const [fc, fr] = getNeighbor(state.col, state.row, state.facing);
  if (isValidNeighbor(fc, fr, state.col, state.row) && isOnGrid(fc, fr)) {
    const frontDist = distanceToNearestHidden(state, fc, fr);
    if (frontDist < currentDist) {
      const cost = getMoveCost(state, fc, fr);
      state.battery = Math.max(0, state.battery - cost);
      const from = formatCell(state.col, state.row);
      const wasOnLander = isOnLander(state.col, state.row);
      state.col = fc;
      state.row = fr;
      if (wasOnLander || !isOnLander(fc, fr)) {
        state.leftLanderSinceCharge = true;
      }
      return { moved: true, turned: false, to: formatCell(fc, fr), from, cost };
    }
  }
  
  // Check right, left, back for turning
  const turns = RELATIVE_TURNS[state.facing];
  for (const rel of ['right', 'left', 'back']) {
    const dir = turns[rel];
    const [nc, nr] = getNeighbor(state.col, state.row, dir);
    if (isValidNeighbor(nc, nr, state.col, state.row)) {
      let neighborDist;
      if (isOnGrid(nc, nr)) {
        neighborDist = distanceToNearestHidden(state, nc, nr);
      } else {
        neighborDist = distanceToNearestHidden(state, nc, nr);
      }
      if (neighborDist < currentDist) {
        state.facing = dir;
        return { moved: false, turned: true, newFacing: dir };
      }
    }
  }
  
  return { moved: false, turned: false, reason: 'no closer path' };
}

function executeReturnAndCharge(state) {
  if (isOnLander(state.col, state.row)) {
    state.charging = true;
    state.chargeTick = 1;
    if (!state.leftLanderSinceCharge) {
      state.chargeWithoutLeaving = true;
    }
    state.leftLanderSinceCharge = false;
    return { charging: true, chargeTick: 1 };
  }
  
  // Navigate to lander
  const currentDist = distanceToLander(state.col, state.row);
  
  // Check front first
  const [fc, fr] = getNeighbor(state.col, state.row, state.facing);
  if (isValidNeighbor(fc, fr, state.col, state.row)) {
    const frontDist = distanceToLander(fc, fr);
    if (frontDist < currentDist) {
      const cost = isOnLander(fc, fr) ? 1 : getMoveCost(state, fc, fr);
      state.battery = Math.max(0, state.battery - cost);
      const from = formatCell(state.col, state.row);
      state.col = fc;
      state.row = fr;
      if (!isOnLander(fc, fr)) {
        state.leftLanderSinceCharge = true;
      }
      return { moved: true, turned: false, to: formatCell(fc, fr), from, cost };
    }
  }
  
  // Check right, left, back for turning
  const turns = RELATIVE_TURNS[state.facing];
  for (const rel of ['right', 'left', 'back']) {
    const dir = turns[rel];
    const [nc, nr] = getNeighbor(state.col, state.row, dir);
    if (isValidNeighbor(nc, nr, state.col, state.row)) {
      const neighborDist = distanceToLander(nc, nr);
      if (neighborDist < currentDist) {
        state.facing = dir;
        return { moved: false, turned: true, newFacing: dir };
      }
    }
  }
  
  return { moved: false, turned: false, reason: 'no closer path to lander' };
}

function executeSidestep(state) {
  const turns = RELATIVE_TURNS[state.facing];
  
  // Try right first
  const rightDir = turns.right;
  const [rc, rr] = getNeighbor(state.col, state.row, rightDir);
  if (isValidNeighbor(rc, rr, state.col, state.row) && isOnGrid(rc, rr)) {
    const cost = getMoveCost(state, rc, rr);
    state.battery = Math.max(0, state.battery - cost);
    const from = formatCell(state.col, state.row);
    state.col = rc;
    state.row = rr;
    if (!isOnLander(rc, rr)) {
      state.leftLanderSinceCharge = true;
    }
    return { moved: true, to: formatCell(rc, rr), from, cost, direction: 'right' };
  }
  
  // Try left
  const leftDir = turns.left;
  const [lc, lr] = getNeighbor(state.col, state.row, leftDir);
  if (isValidNeighbor(lc, lr, state.col, state.row) && isOnGrid(lc, lr)) {
    const cost = getMoveCost(state, lc, lr);
    state.battery = Math.max(0, state.battery - cost);
    const from = formatCell(state.col, state.row);
    state.col = lc;
    state.row = lr;
    if (!isOnLander(lc, lr)) {
      state.leftLanderSinceCharge = true;
    }
    return { moved: true, to: formatCell(lc, lr), from, cost, direction: 'left' };
  }
  
  return { moved: false, reason: 'no valid sidestep' };
}

function executeGoToOre(state) {
  // Check front, right, left, back for neighboring undrilled ore
  const dirs = [state.facing, RELATIVE_TURNS[state.facing].right, 
                RELATIVE_TURNS[state.facing].left, RELATIVE_TURNS[state.facing].back];
  
  for (const dir of dirs) {
    const [nc, nr] = getNeighbor(state.col, state.row, dir);
    if (isOnGrid(nc, nr) && 
        state.terrain[nr][nc] === TERRAIN.ORE && 
        !state.drilled[nr][nc]) {
      state.battery = Math.max(0, state.battery - 1);
      const from = formatCell(state.col, state.row);
      state.col = nc;
      state.row = nr;
      state.facing = dir;
      state.leftLanderSinceCharge = true;
      return { moved: true, to: formatCell(nc, nr), from, cost: 1, direction: dir };
    }
  }
  
  return { moved: false, reason: 'no ore nearby' };
}

function executeDrill(state) {
  if (isOnGrid(state.col, state.row) && 
      state.terrain[state.row][state.col] === TERRAIN.ORE && 
      !state.drilled[state.row][state.col]) {
    state.drilled[state.row][state.col] = true;
    state.cargo++;
    state.battery = Math.max(0, state.battery - 2);
    return { drilled: true, cost: 2 };
  }
  state.battery = Math.max(0, state.battery - 2);
  return { drilled: false, cost: 2, reason: 'no ore here' };
}

function executeWait() {
  return { waited: true };
}

export function executeAction(action, state) {
  switch (action.type) {
    case ACTIONS.EXPLORE:
      return executeExplore(state);
    case ACTIONS.RETURN_CHARGE:
      return executeReturnAndCharge(state);
    case ACTIONS.SIDESTEP:
      return executeSidestep(state);
    case ACTIONS.GO_TO_ORE:
      return executeGoToOre(state);
    case ACTIONS.DRILL:
      return executeDrill(state);
    case ACTIONS.WAIT:
      return executeWait();
    default:
      return { error: 'unknown action' };
  }
}

// === SCANNING ===

function revealTile(state, col, row) {
  if (isOnGrid(col, row) && !state.revealed[row][col]) {
    state.revealed[row][col] = true;
    state.tilesScanned++;
    return true;
  }
  return false;
}

export function scan(state, previousCol, previousRow) {
  const newlyRevealed = [];
  
  if (isOnLander(state.col, state.row)) {
    return newlyRevealed; // Lander scans nothing
  }
  
  if (state.sensors.includes(SENSORS.CAMERA)) {
    // 3x3 area centered on rover
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        const c = state.col + dc;
        const r = state.row + dr;
        if (revealTile(state, c, r)) {
          newlyRevealed.push({ col: c, row: r, terrain: state.terrain[r][c] });
        }
      }
    }
  } else {
    // Just the current tile
    if (revealTile(state, state.col, state.row)) {
      newlyRevealed.push({ col: state.col, row: state.row, terrain: state.terrain[state.row][state.col] });
    }
  }
  
  return newlyRevealed;
}

// === END CONDITIONS ===

export const OUTCOMES = {
  SUCCESS_SCAN: 'success-scan',
  SUCCESS_ORE: 'success-ore',
  LOST_CRATER: 'lost-crater',
  LOST_BATTERY: 'lost-battery',
  STUCK_NO_MOVE: 'stuck-no-move',
  STUCK_CHARGE: 'stuck-charge',
  STUCK_LOOP: 'stuck-loop',
  ABORTED: 'aborted'
};

export function checkEndConditions(state) {
  // 1. Rover on crater
  if (isOnGrid(state.col, state.row) && state.terrain[state.row][state.col] === TERRAIN.CRATER) {
    return { 
      outcome: OUTCOMES.LOST_CRATER, 
      reason: `drove into a crater at ${formatCell(state.col, state.row)} on tick ${state.tick}` 
    };
  }
  
  // 2. Battery 0 and not on lander
  if (state.battery === 0 && !isOnLander(state.col, state.row)) {
    return { 
      outcome: OUTCOMES.LOST_BATTERY, 
      reason: `battery depleted at ${formatCell(state.col, state.row)} on tick ${state.tick}` 
    };
  }
  
  // 3. Success conditions (on lander with goals met)
  if (isOnLander(state.col, state.row)) {
    if (state.tilesScanned >= 30) {
      return { 
        outcome: OUTCOMES.SUCCESS_SCAN, 
        reason: `returned to lander with ${state.tilesScanned} tiles scanned on tick ${state.tick}` 
      };
    }
    if (state.cargo >= 3) {
      return { 
        outcome: OUTCOMES.SUCCESS_ORE, 
        reason: `returned to lander with ${state.cargo} ore on tick ${state.tick}` 
      };
    }
  }
  
  return null;
}

export function checkStuckConditions(state, didMove) {
  // Update no-move counter
  if (didMove) {
    state.noMoveCount = 0;
  } else {
    state.noMoveCount++;
  }
  
  // 1. No move: 3 ticks without changing cell
  if (state.noMoveCount >= 3) {
    return { 
      outcome: OUTCOMES.STUCK_NO_MOVE, 
      reason: `stuck: no movement for 3 ticks at ${formatCell(state.col, state.row)}` 
    };
  }
  
  // 2. Charge twice without leaving
  if (state.chargeWithoutLeaving) {
    return { 
      outcome: OUTCOMES.STUCK_CHARGE, 
      reason: `stuck: started charging without leaving lander since last charge` 
    };
  }
  
  // 3. Loop detection
  if (didMove) {
    const key = `${state.col},${state.row},${state.facing}`;
    const matches = state.loopMemory.filter(m => 
      m.col === state.col && m.row === state.row && m.facing === state.facing
    );
    if (matches.length >= 2) {
      return { 
        outcome: OUTCOMES.STUCK_LOOP, 
        reason: `stuck: loop detected at ${formatCell(state.col, state.row)} facing ${state.facing}` 
      };
    }
    state.loopMemory.push({ col: state.col, row: state.row, facing: state.facing });
  }
  
  return null;
}

// === HAZARD DETECTION FOR AUTO-PAUSE ===

export function checkHazardAutoPause(state, readings, previouslyRevealed) {
  const hazards = [];
  
  // Distance sensor: crater in front (first time)
  if (state.sensors.includes(SENSORS.DISTANCE) && readings.craterInFront?.detected) {
    const key = `crater:${readings.craterInFront.cell}`;
    if (!state.hazardsSeen.has(key)) {
      state.hazardsSeen.add(key);
      hazards.push({ 
        sensor: 'Distance sensor', 
        type: 'crater in front',
        cell: readings.craterInFront.cell 
      });
    }
  }
  
  // Dust sensor: on dust (first time)
  if (state.sensors.includes(SENSORS.DUST) && readings.onDust) {
    const key = `dust:${formatCell(state.col, state.row)}`;
    if (!state.hazardsSeen.has(key)) {
      state.hazardsSeen.add(key);
      hazards.push({ 
        sensor: 'Dust sensor', 
        type: 'on dust',
        cell: formatCell(state.col, state.row) 
      });
    }
  }
  
  // Camera: revealed crater or dust in previous tick's scan
  if (state.sensors.includes(SENSORS.CAMERA) && previouslyRevealed) {
    const dustCells = [];
    const craterCells = [];
    for (const tile of previouslyRevealed) {
      if (tile.terrain === TERRAIN.CRATER) {
        const key = `crater:${formatCell(tile.col, tile.row)}`;
        if (!state.hazardsSeen.has(key)) {
          state.hazardsSeen.add(key);
          craterCells.push(formatCell(tile.col, tile.row));
        }
      }
      if (tile.terrain === TERRAIN.DUST) {
        const key = `dust:${formatCell(tile.col, tile.row)}`;
        if (!state.hazardsSeen.has(key)) {
          state.hazardsSeen.add(key);
          dustCells.push(formatCell(tile.col, tile.row));
        }
      }
    }
    if (dustCells.length > 0) {
      hazards.push({ 
        sensor: 'Camera', 
        type: 'dust',
        cell: dustCells.join(', ') 
      });
    }
    if (craterCells.length > 0) {
      hazards.push({ 
        sensor: 'Camera', 
        type: 'crater',
        cell: craterCells.join(', ') 
      });
    }
  }
  
  return hazards;
}

// === PROGRESS TRACKING ===

function recordProgress(state, newlyRevealed, actionResult) {
  let madeProgress = false;
  
  if (newlyRevealed && newlyRevealed.length > 0) {
    madeProgress = true;
  }
  if (actionResult && actionResult.drilled) {
    madeProgress = true;
  }
  
  if (madeProgress) {
    state.loopMemory = [];
    state.lastProgress = state.tick;
  }
}

// === MAIN TICK FUNCTION ===

export function runTick(state, previouslyRevealed = null) {
  state.tick++;
  
  const tickRecord = {
    tick: state.tick,
    positionBefore: { col: state.col, row: state.row },
    facingBefore: state.facing,
    positionAfter: null,
    facingAfter: null,
    readings: null,
    ruleFired: null,
    ruleReason: null,
    actionResult: null,
    battery: null,
    tilesScanned: null,
    cargo: null
  };
  
  // Step 1: Charging?
  if (state.charging) {
    state.chargeTick++;
    if (state.chargeTick >= 3) {
      state.battery = 20;
      state.charging = false;
      state.chargeTick = 0;
      tickRecord.ruleFired = -1;
      tickRecord.ruleReason = 'Charging (3 of 3): battery restored to 20';
    } else {
      tickRecord.ruleFired = -1;
      tickRecord.ruleReason = `Charging (${state.chargeTick} of 3)`;
    }
    tickRecord.positionAfter = { col: state.col, row: state.row };
    tickRecord.facingAfter = state.facing;
    tickRecord.battery = state.battery;
    tickRecord.tilesScanned = state.tilesScanned;
    tickRecord.cargo = state.cargo;
    state.trace.push(tickRecord);
    return { 
      tickRecord, 
      autoPause: null, 
      endCondition: null, 
      stuckCondition: null,
      newlyRevealed: null
    };
  }
  
  // Step 2: Sense
  const readings = computeReadings(state);
  state.readings = readings;
  tickRecord.readings = { ...readings };
  
  // Step 3: Hazard auto-pause check
  const hazards = checkHazardAutoPause(state, readings, previouslyRevealed);
  if (hazards.length > 0) {
    const reason = hazards.map(h => `${h.sensor}: ${h.type} at ${h.cell}`).join('; ');
    tickRecord.positionAfter = { col: state.col, row: state.row };
    tickRecord.facingAfter = state.facing;
    tickRecord.battery = state.battery;
    tickRecord.tilesScanned = state.tilesScanned;
    tickRecord.cargo = state.cargo;
    return { 
      tickRecord, 
      autoPause: { reason, hazards }, 
      endCondition: null, 
      stuckCondition: null,
      newlyRevealed: null,
      continueFromStep4: true
    };
  }
  
  // Continue from step 4
  return continueTickFromStep4(state, tickRecord, readings);
}

export function continueTickFromStep4(state, tickRecord, readings) {
  // Step 4: Rules - find first matching rule
  let matchedRule = null;
  let matchedIndex = -1;
  
  for (let i = 0; i < state.rules.length; i++) {
    const rule = state.rules[i];
    if (!rule || !rule.condition || !rule.action) continue;
    
    if (evaluateCondition(rule.condition, state, readings)) {
      matchedRule = rule;
      matchedIndex = i;
      break;
    }
  }
  
  // Step 5: Act
  let actionResult = null;
  let didMove = false;
  
  if (matchedRule) {
    tickRecord.ruleFired = matchedIndex + 1;
    actionResult = executeAction(matchedRule.action, state);
    didMove = actionResult.moved || false;
    
    // Build reason string
    const condStr = formatCondition(matchedRule.condition, readings);
    const actStr = formatActionResult(matchedRule.action, actionResult);
    tickRecord.ruleReason = `Rule ${matchedIndex + 1}: ${condStr} → ${actStr}`;
  } else {
    tickRecord.ruleFired = 0;
    tickRecord.ruleReason = 'No rule matched: rover did nothing';
  }
  
  tickRecord.actionResult = actionResult;
  tickRecord.positionAfter = { col: state.col, row: state.row };
  tickRecord.facingAfter = state.facing;
  
  // Step 6: Scan
  let newlyRevealed = null;
  if (didMove) {
    newlyRevealed = scan(state, tickRecord.positionBefore.col, tickRecord.positionBefore.row);
  }
  
  tickRecord.battery = state.battery;
  tickRecord.tilesScanned = state.tilesScanned;
  tickRecord.cargo = state.cargo;
  
  // Record progress
  recordProgress(state, newlyRevealed, actionResult);
  
  // Step 7: End checks
  const endCondition = checkEndConditions(state);
  if (endCondition) {
    state.outcome = endCondition.outcome;
    state.endReason = endCondition.reason;
    state.trace.push(tickRecord);
    return { 
      tickRecord, 
      autoPause: null, 
      endCondition, 
      stuckCondition: null,
      newlyRevealed
    };
  }
  
  // Stuck checks (ignore charging ticks)
  const stuckCondition = checkStuckConditions(state, didMove);
  
  // Step 8: Record
  state.trace.push(tickRecord);
  
  return { 
    tickRecord, 
    autoPause: null, 
    endCondition: null, 
    stuckCondition,
    newlyRevealed
  };
}

// === FORMATTING HELPERS ===

function formatCondition(condition, readings) {
  switch (condition.type) {
    case CONDITIONS.BATTERY_BELOW:
      return `battery ${readings.battery} < ${condition.n}`;
    case CONDITIONS.CRATER_IN_FRONT:
      const craterCell = readings.craterInFront?.cell || '?';
      return `crater in front (${craterCell}) = ${readings.craterInFront?.detected ? 'yes' : 'no'}`;
    case CONDITIONS.ON_DUST:
      return `on dust = ${readings.onDust ? 'yes' : 'no'}`;
    case CONDITIONS.ORE_NEXT_TO:
      const dirs = readings.oreNextTo?.directions?.join(', ') || 'none';
      return `ore next to rover = ${readings.oreNextTo?.detected ? `yes (${dirs})` : 'no'}`;
    case CONDITIONS.ON_ORE:
      return `on ore = ${readings.onOre ? 'yes' : 'no'}`;
    case CONDITIONS.ALWAYS:
      return 'always';
    default:
      return condition.type;
  }
}

function formatActionResult(action, result) {
  const actionNames = {
    [ACTIONS.EXPLORE]: 'Explore',
    [ACTIONS.RETURN_CHARGE]: 'Return and charge',
    [ACTIONS.SIDESTEP]: 'Sidestep',
    [ACTIONS.GO_TO_ORE]: 'Go to ore',
    [ACTIONS.DRILL]: 'Drill',
    [ACTIONS.WAIT]: 'Wait'
  };
  
  const name = actionNames[action.type] || action.type;
  
  if (result.moved) {
    return `${name}: moved to ${result.to}`;
  }
  if (result.turned) {
    return `${name}: turned ${result.newFacing}`;
  }
  if (result.charging) {
    return `${name}: started charging (tick 1 of 3)`;
  }
  if (result.drilled) {
    return `${name}: drilled ore`;
  }
  if (result.waited) {
    return `${name}: waiting`;
  }
  if (result.reason) {
    return `${name}: ${result.reason}`;
  }
  return name;
}

// === RULE VALIDATION ===

export function isConditionLegal(conditionType, sensors) {
  const needed = CONDITION_SENSORS[conditionType];
  return needed === null || sensors.includes(needed);
}

export function isActionLegal(actionType, sensors) {
  const needed = ACTION_SENSORS[actionType];
  return needed === null || sensors.includes(needed);
}

export function isRuleLegal(rule, sensors) {
  if (!rule || !rule.condition || !rule.action) return true; // Empty rule is okay
  return isConditionLegal(rule.condition.type, sensors) && 
         isActionLegal(rule.action.type, sensors);
}

// === UPLINK ===

export function applyUplink(state, slot, newCondition, newAction) {
  if (state.uplink.used) return false;
  
  const oldRule = state.rules[slot] ? { ...state.rules[slot] } : null;
  
  state.uplink.used = true;
  state.uplink.tick = state.tick;
  state.uplink.slot = slot;
  state.uplink.before = oldRule;
  state.uplink.after = { condition: newCondition, action: newAction };
  
  state.rules[slot] = { condition: newCondition, action: newAction };
  
  // Clear stuck counters
  state.noMoveCount = 0;
  state.chargeWithoutLeaving = false;
  state.loopMemory = [];
  
  return true;
}

// === CONDITION AND ACTION DISPLAY NAMES ===

export const CONDITION_NAMES = {
  [CONDITIONS.BATTERY_BELOW]: 'Battery below N',
  [CONDITIONS.CRATER_IN_FRONT]: 'Crater in front',
  [CONDITIONS.ON_DUST]: 'On a dust tile',
  [CONDITIONS.ORE_NEXT_TO]: 'Ore next to rover',
  [CONDITIONS.ON_ORE]: 'On an ore tile',
  [CONDITIONS.ALWAYS]: 'Always'
};

export const ACTION_NAMES = {
  [ACTIONS.EXPLORE]: 'Explore',
  [ACTIONS.RETURN_CHARGE]: 'Return and charge',
  [ACTIONS.SIDESTEP]: 'Sidestep',
  [ACTIONS.GO_TO_ORE]: 'Go to ore',
  [ACTIONS.DRILL]: 'Drill',
  [ACTIONS.WAIT]: 'Wait'
};

// Export terrain constants for map verification
export const TERRAIN_DATA = {
  craters: CRATERS,
  ores: ORES,
  dusts: DUSTS
};
