// Far Rover Simulation Module
// Pure and deterministic - no UI, no randomness, no side effects
// v3.2 kit rules (paper-test kit v3.2, design.md v0.6.7)

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
  GOAL_MET: 'goal_met',           // v3.2: new always-available condition
  CRATER_IN_FRONT: 'crater_in_front',
  ON_DUST: 'on_dust',
  ORE_NEXT_TO: 'ore_next_to',
  ON_ORE: 'on_ore',
  ALWAYS: 'always'
};

// Which sensor each condition needs
export const CONDITION_SENSORS = {
  [CONDITIONS.BATTERY_BELOW]: null,    // Always available
  [CONDITIONS.GOAL_MET]: null,         // Always available (v3.2)
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

// === CONSTANTS ===
export const GOAL_TILES = 25;     // v3.2: goal is 25 tiles (driven onto only)
export const GOAL_ORE = 3;

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
    revealed: Array(12).fill(null).map(() => Array(12).fill(false)),   // All known tiles (driven + camera craters)
    cameraSeen: Array(12).fill(null).map(() => Array(12).fill(false)), // Camera-seen but not driven onto
    drilled: Array(12).fill(null).map(() => Array(12).fill(false)),
    tilesScanned: 0,     // v3.2: only tiles rover has driven onto (not craters, not camera)
    
    // Goal state (v3.2)
    goalMet: false,      // Sticky: once true, stays true for rest of run
    
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
    
    // Stuck detection (v3.2: exact rules)
    noMoveCount: 0,
    chargeWithoutLeaving: false,
    leftLanderSinceCharge: true,
    // v3.2: circling tracks (tile, facing) since last scan of new tile or drill
    circlingMemory: [],  // [{col, row, facing}]
    
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

// v3.2: Lander's only neighbor is F12
function isValidNeighbor(col, row, fromCol, fromRow) {
  // On-grid cell
  if (isOnGrid(col, row)) return true;
  // Lander when moving south from F12
  if (col === 5 && row === 12 && fromCol === 5 && fromRow === 11) return true;
  // F12 when moving north from lander
  if (col === 5 && row === 11 && fromCol === 5 && fromRow === 12) return true;
  return false;
}

// v3.2: For Sidestep, lander counts as off-map
function isValidSidestepTarget(col, row, fromCol, fromRow) {
  // Only on-grid cells are valid for Sidestep
  return isOnGrid(col, row);
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

// v3.2: Dust costs 2 regardless of Dust sensor
function getMoveCost(state, toCol, toRow) {
  if (isOnLander(toCol, toRow)) return 1;
  if (state.terrain[toRow][toCol] === TERRAIN.DUST) return 2;
  return 1;
}

// v3.2: Check if a cell is a known (face-up) crater
function isKnownCrater(state, col, row) {
  if (!isOnGrid(col, row)) return false;
  return state.revealed[row][col] && state.terrain[row][col] === TERRAIN.CRATER;
}

// === SENSOR READINGS ===

export function computeReadings(state) {
  const readings = {};
  
  // Battery (always)
  readings.battery = state.battery;
  
  // Goal met (v3.2: sticky condition)
  readings.goalMet = state.goalMet;
  
  // Distance sensor: crater in front?
  if (state.sensors.includes(SENSORS.DISTANCE)) {
    const [fc, fr] = getNeighbor(state.col, state.row, state.facing);
    // v3.2: false when facing lander or map edge
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
    case CONDITIONS.GOAL_MET:
      return readings.goalMet || false;
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

// v3.2: Explore targets "face-down" tiles, which includes camera-seen non-crater tiles
function isTileHiddenForExplore(state, col, row) {
  // A tile is "hidden for Explore" if not revealed OR if camera-seen but not driven onto
  // But actually in v3.2, camera-seen tiles stay "face-down" for Explore targeting
  // Only tiles the rover has driven onto are "face-up"
  // Camera-revealed craters ARE face-up (known) but other camera tiles are just "seen"
  if (!isOnGrid(col, row)) return false;
  
  // If it's a crater that's been revealed (by camera), it's face-up (known)
  if (state.terrain[row][col] === TERRAIN.CRATER && state.revealed[row][col]) {
    return false; // Known crater is NOT hidden
  }
  
  // For non-craters: only driven-onto tiles are "face-up"
  // Camera-seen tiles are still targetable by Explore
  // We need to track which tiles were DRIVEN onto vs just camera-seen
  // The tilesScanned count tells us driven-onto count
  // We'll use a separate check: was this tile revealed by driving onto it?
  
  // A tile is hidden for Explore if:
  // - Not revealed at all, OR
  // - Camera-seen but not driven onto (for non-craters)
  
  // Actually, simpler: check if cameraSeen is true but the tile wasn't driven onto
  // We can determine driven onto by: revealed AND (not cameraSeen OR is crater)
  // But this is complex. Let me use the clearer approach:
  
  // The revealed array marks ALL revealed tiles (driven + camera craters)
  // The cameraSeen array marks tiles seen by camera that are NOT craters
  // For Explore targeting:
  // - Known craters (revealed AND is crater) are NOT targets
  // - Camera-seen non-craters (cameraSeen) ARE still targets
  // - Completely unrevealed tiles ARE targets
  
  if (state.cameraSeen[row][col]) {
    return true; // Camera-seen non-crater is still targetable
  }
  if (!state.revealed[row][col]) {
    return true; // Not revealed at all
  }
  return false; // Driven onto (revealed but not just camera-seen)
}

function findNearestHiddenTileForExplore(state) {
  let minDist = Infinity;
  for (let row = 0; row < 12; row++) {
    for (let col = 0; col < 12; col++) {
      if (isTileHiddenForExplore(state, col, row)) {
        const dist = stepDistance(state.col, state.row, col, row);
        if (dist < minDist) {
          minDist = dist;
        }
      }
    }
  }
  return minDist === Infinity ? null : minDist;
}

function distanceToNearestHiddenForExplore(state, col, row) {
  let minDist = Infinity;
  for (let r = 0; r < 12; r++) {
    for (let c = 0; c < 12; c++) {
      if (isTileHiddenForExplore(state, c, r)) {
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

// v3.2: Explore never steps onto a known (face-up) crater
function executeExplore(state) {
  const currentDist = findNearestHiddenTileForExplore(state);
  if (currentDist === null) {
    return { moved: false, turned: false, reason: 'no hidden tiles' };
  }
  
  // Check front first - but not if it's a known crater
  const [fc, fr] = getNeighbor(state.col, state.row, state.facing);
  if (isValidNeighbor(fc, fr, state.col, state.row) && isOnGrid(fc, fr) && !isKnownCrater(state, fc, fr)) {
    const frontDist = distanceToNearestHiddenForExplore(state, fc, fr);
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
  
  // Check right, left, back for turning - exclude known craters
  const turns = RELATIVE_TURNS[state.facing];
  for (const rel of ['right', 'left', 'back']) {
    const dir = turns[rel];
    const [nc, nr] = getNeighbor(state.col, state.row, dir);
    if (isValidNeighbor(nc, nr, state.col, state.row) && !isKnownCrater(state, nc, nr)) {
      let neighborDist;
      if (isOnGrid(nc, nr)) {
        neighborDist = distanceToNearestHiddenForExplore(state, nc, nr);
      } else {
        neighborDist = distanceToNearestHiddenForExplore(state, nc, nr);
      }
      if (neighborDist < currentDist) {
        state.facing = dir;
        return { moved: false, turned: true, newFacing: dir };
      }
    }
  }
  
  return { moved: false, turned: false, reason: 'no closer path' };
}

// v3.2: Return and charge does NOT avoid known craters, starts charge even at full battery
function executeReturnAndCharge(state) {
  if (isOnLander(state.col, state.row)) {
    // v3.2: starts charge even at full battery
    state.charging = true;
    state.chargeTick = 1;
    if (!state.leftLanderSinceCharge) {
      state.chargeWithoutLeaving = true;
    }
    state.leftLanderSinceCharge = false;
    return { charging: true, chargeTick: 1 };
  }
  
  // Navigate to lander - v3.2: does NOT avoid known craters
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

// v3.2: Sidestep treats lander as off-map, does nothing on lander
function executeSidestep(state) {
  // v3.2: On the lander, Sidestep does nothing
  if (isOnLander(state.col, state.row)) {
    return { moved: false, reason: 'on lander' };
  }
  
  const turns = RELATIVE_TURNS[state.facing];
  
  // Try right first - v3.2: lander counts as off-map
  const rightDir = turns.right;
  const [rc, rr] = getNeighbor(state.col, state.row, rightDir);
  if (isValidSidestepTarget(rc, rr, state.col, state.row)) {
    const cost = getMoveCost(state, rc, rr);
    state.battery = Math.max(0, state.battery - cost);
    const from = formatCell(state.col, state.row);
    state.col = rc;
    state.row = rr;
    state.leftLanderSinceCharge = true;
    return { moved: true, to: formatCell(rc, rr), from, cost, direction: 'right' };
  }
  
  // Try left - v3.2: lander counts as off-map
  const leftDir = turns.left;
  const [lc, lr] = getNeighbor(state.col, state.row, leftDir);
  if (isValidSidestepTarget(lc, lr, state.col, state.row)) {
    const cost = getMoveCost(state, lc, lr);
    state.battery = Math.max(0, state.battery - cost);
    const from = formatCell(state.col, state.row);
    state.col = lc;
    state.row = lr;
    state.leftLanderSinceCharge = true;
    return { moved: true, to: formatCell(lc, lr), from, cost, direction: 'left' };
  }
  
  return { moved: false, reason: 'no valid sidestep' };
}

// v3.2: Go to ore costs 3 (1 move + 2 drill), drills in same tick
function executeGoToOre(state) {
  // Check front, right, left, back for neighboring undrilled ore
  const dirs = [state.facing, RELATIVE_TURNS[state.facing].right, 
                RELATIVE_TURNS[state.facing].left, RELATIVE_TURNS[state.facing].back];
  
  for (const dir of dirs) {
    const [nc, nr] = getNeighbor(state.col, state.row, dir);
    if (isOnGrid(nc, nr) && 
        state.terrain[nr][nc] === TERRAIN.ORE && 
        !state.drilled[nr][nc]) {
      // v3.2: Move and drill in same tick, cost 3 (1 move + 2 drill)
      const moveCost = getMoveCost(state, nc, nr);
      state.battery = Math.max(0, state.battery - moveCost - 2); // Total cost 3 (or 4 onto dust)
      const from = formatCell(state.col, state.row);
      state.col = nc;
      state.row = nr;
      state.facing = dir;
      state.leftLanderSinceCharge = true;
      // Drill the ore
      state.drilled[nr][nc] = true;
      state.cargo++;
      return { moved: true, drilled: true, to: formatCell(nc, nr), from, cost: moveCost + 2, direction: dir };
    }
  }
  
  // v3.2: If no adjacent ore, costs 0
  return { moved: false, drilled: false, reason: 'no ore nearby', cost: 0 };
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
// v3.2: Only tiles the rover drives onto count toward the goal.
// Camera-revealed tiles don't count. Craters never count.

function revealTileByDriving(state, col, row) {
  if (!isOnGrid(col, row)) return false;
  
  const wasRevealed = state.revealed[row][col];
  const wasCameraSeen = state.cameraSeen[row][col];
  
  state.revealed[row][col] = true;
  state.cameraSeen[row][col] = false; // No longer just camera-seen
  
  // v3.2: Only count non-craters that weren't already driven onto
  if (!wasRevealed || wasCameraSeen) {
    if (state.terrain[row][col] !== TERRAIN.CRATER) {
      state.tilesScanned++;
      return true; // Progress made
    }
  }
  return !wasRevealed; // Return true if newly revealed for terrain info
}

function revealTileByCamera(state, col, row) {
  if (!isOnGrid(col, row)) return { revealed: false, isCrater: false };
  
  if (state.revealed[row][col] && !state.cameraSeen[row][col]) {
    // Already driven onto, camera doesn't change anything
    return { revealed: false, isCrater: false };
  }
  
  const isCrater = state.terrain[row][col] === TERRAIN.CRATER;
  
  if (isCrater) {
    // Craters become known (face-up) when camera sees them
    state.revealed[row][col] = true;
    state.cameraSeen[row][col] = false;
    return { revealed: true, isCrater: true, terrain: state.terrain[row][col] };
  } else {
    // Non-craters are "seen" but not "scanned"
    state.cameraSeen[row][col] = true;
    return { revealed: true, isCrater: false, terrain: state.terrain[row][col] };
  }
}

export function scan(state, didMove, actionResult) {
  const newlyRevealed = [];
  
  if (isOnLander(state.col, state.row)) {
    return newlyRevealed; // Lander scans nothing
  }
  
  if (!didMove) {
    return newlyRevealed; // No move, no scan
  }
  
  // First, reveal the tile the rover drove onto
  const droveOnto = revealTileByDriving(state, state.col, state.row);
  if (droveOnto || state.terrain[state.row][state.col] === TERRAIN.CRATER) {
    newlyRevealed.push({ 
      col: state.col, 
      row: state.row, 
      terrain: state.terrain[state.row][state.col],
      drivenOnto: true
    });
  }
  
  // With camera, reveal the 3x3 area
  if (state.sensors.includes(SENSORS.CAMERA)) {
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        if (dr === 0 && dc === 0) continue; // Skip center (already handled)
        const c = state.col + dc;
        const r = state.row + dr;
        const result = revealTileByCamera(state, c, r);
        if (result.revealed) {
          newlyRevealed.push({ 
            col: c, 
            row: r, 
            terrain: result.terrain,
            drivenOnto: false,
            isCrater: result.isCrater
          });
        }
      }
    }
  }
  
  return newlyRevealed;
}

// === GOAL CHECK ===
// v3.2: Goal is 25 tiles driven onto OR 3 ore. Sticky once met.

function updateGoalStatus(state) {
  if (state.goalMet) return; // Already met, stays met
  
  if (state.tilesScanned >= GOAL_TILES || state.cargo >= GOAL_ORE) {
    state.goalMet = true;
  }
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
  
  // 3. Success: on lander with goal met
  if (isOnLander(state.col, state.row) && state.goalMet) {
    if (state.cargo >= GOAL_ORE) {
      return { 
        outcome: OUTCOMES.SUCCESS_ORE, 
        reason: `returned to lander with ${state.cargo} ore on tick ${state.tick}` 
      };
    }
    return { 
      outcome: OUTCOMES.SUCCESS_SCAN, 
      reason: `returned to lander with ${state.tilesScanned} tiles scanned on tick ${state.tick}` 
    };
  }
  
  return null;
}

// v3.2: Exact stuck rules
export function checkStuckConditions(state, didMove, didTurn, madeProgress) {
  // Update no-move counter
  // v3.2: Turning in place counts as not moving
  if (didMove) {
    state.noMoveCount = 0;
  } else {
    state.noMoveCount++;
  }
  
  // 1. Idle: 3 turns without moving (turning in place counts as not moving)
  if (state.noMoveCount >= 3) {
    return { 
      outcome: OUTCOMES.STUCK_NO_MOVE, 
      reason: `stuck: no movement for 3 ticks at ${formatCell(state.col, state.row)}` 
    };
  }
  
  // 2. Double charge: charging twice without leaving lander
  if (state.chargeWithoutLeaving) {
    return { 
      outcome: OUTCOMES.STUCK_CHARGE, 
      reason: `stuck: started charging without leaving lander since last charge` 
    };
  }
  
  // 3. Circling: same (tile, facing) for 3rd time since last progress
  // v3.2: Progress = newly scanned tile (driven onto) or drilled ore
  // v3.2: Turns in place count for circling detection
  if (madeProgress) {
    state.circlingMemory = [];
  }
  
  if (didMove || didTurn) {
    const key = { col: state.col, row: state.row, facing: state.facing };
    const matches = state.circlingMemory.filter(m => 
      m.col === state.col && m.row === state.row && m.facing === state.facing
    );
    if (matches.length >= 2) {
      return { 
        outcome: OUTCOMES.STUCK_LOOP, 
        reason: `stuck: loop detected at ${formatCell(state.col, state.row)} facing ${state.facing}` 
      };
    }
    state.circlingMemory.push(key);
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
  let didTurn = false;
  let didDrill = false;
  
  if (matchedRule) {
    tickRecord.ruleFired = matchedIndex + 1;
    actionResult = executeAction(matchedRule.action, state);
    didMove = actionResult.moved || false;
    didTurn = actionResult.turned || false;
    didDrill = actionResult.drilled || false;
    
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
  let madeProgress = false;
  
  if (didMove) {
    const tilesBeforeScan = state.tilesScanned;
    newlyRevealed = scan(state, didMove, actionResult);
    // Progress if we scanned a new tile (driven onto, not crater)
    if (state.tilesScanned > tilesBeforeScan) {
      madeProgress = true;
    }
  }
  
  // Progress also happens on drill
  if (didDrill) {
    madeProgress = true;
  }
  
  // Update goal status
  updateGoalStatus(state);
  
  tickRecord.battery = state.battery;
  tickRecord.tilesScanned = state.tilesScanned;
  tickRecord.cargo = state.cargo;
  
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
  const stuckCondition = checkStuckConditions(state, didMove, didTurn, madeProgress);
  if (stuckCondition) {
    state.outcome = stuckCondition.outcome;
    state.endReason = stuckCondition.reason;
  }
  
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
    case CONDITIONS.GOAL_MET:
      return `goal met = ${readings.goalMet ? 'yes' : 'no'}`;
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
  
  if (result.moved && result.drilled) {
    return `${name}: moved to ${result.to} and drilled ore`;
  }
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
// v3.2: Can't be used before the first tick (between turns, not before first turn)

export function canUseUplink(state) {
  if (state.uplink.used) return false;
  if (state.tick < 1) return false; // v3.2: not before first tick
  return true;
}

export function applyUplink(state, slot, newCondition, newAction) {
  if (!canUseUplink(state)) return false;
  
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
  state.circlingMemory = [];
  
  return true;
}

// === CONDITION AND ACTION DISPLAY NAMES ===

export const CONDITION_NAMES = {
  [CONDITIONS.BATTERY_BELOW]: 'Battery below N',
  [CONDITIONS.GOAL_MET]: 'Goal met',
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

// === STARTER PROGRAM PRESET ===
// v3.2: Printed starter program from the kit
export const STARTER_PROGRAM = [
  { condition: { type: CONDITIONS.CRATER_IN_FRONT }, action: { type: ACTIONS.SIDESTEP } },
  { condition: { type: CONDITIONS.BATTERY_BELOW, n: 12 }, action: { type: ACTIONS.RETURN_CHARGE } },
  { condition: { type: CONDITIONS.ON_ORE }, action: { type: ACTIONS.DRILL } },
  { condition: { type: CONDITIONS.ALWAYS }, action: { type: ACTIONS.EXPLORE } }
];

// Sensors needed for starter program: Distance and Spectral
export const STARTER_REQUIRED_SENSORS = [SENSORS.DISTANCE, SENSORS.SPECTRAL];
