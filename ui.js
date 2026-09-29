// Far Rover UI Module
// Handles all screen rendering and user interaction

import * as Sim from './simulation.js';

// === LOCAL STORAGE ===
const STORAGE_KEY = 'far-rover-demo-v1';

function loadLog() {
  try {
    const data = localStorage.getItem(STORAGE_KEY);
    return data ? JSON.parse(data) : { sessions: [], currentSession: null };
  } catch {
    return { sessions: [], currentSession: null };
  }
}

function saveLog(log) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(log));
}

function generateSessionId() {
  return 'S' + Date.now().toString(36).toUpperCase();
}

// === GAME STATE ===
let gameState = null;
let runNumber = 0;
let sessionId = null;
let testerLabel = '';
let runStartTime = null;
let previousRunEndTime = null;
let autoPauseCount = 0;
let currentSpeed = 1;
let isPaused = true;
let tickInterval = null;
let previouslyRevealed = null;
let pendingAutoPause = null;
let pendingStuck = null;
let continueFromStep4Data = null;
let animatingMove = false;
let lastTickResult = null;

// Build state
let selectedSensors = [];
let rules = [null, null, null, null];

// Log
let log = loadLog();
let currentRun = null;

// === INITIALIZATION ===

export function init() {
  // Load existing session or create new
  if (!log.currentSession) {
    startNewSession();
  } else {
    sessionId = log.currentSession.id;
    testerLabel = log.currentSession.label || '';
    runNumber = log.currentSession.runs?.length || 0;
  }
  
  showTitleScreen();
  setupKeyboardShortcuts();
}

function startNewSession(label = '') {
  sessionId = generateSessionId();
  testerLabel = label;
  log.currentSession = { id: sessionId, label, runs: [] };
  log.sessions.push(log.currentSession);
  saveLog(log);
  runNumber = 0;
}

// === SCREEN RENDERING ===

function clearScreen() {
  document.getElementById('game-container').innerHTML = '';
}

export function showTitleScreen() {
  clearScreen();
  stopTicking();
  
  const container = document.getElementById('game-container');
  container.innerHTML = `
    <div class="title-screen">
      <h1>Far Rover</h1>
      <p class="pitch">Build a tiny rover from three sensors and four if-then rules, launch it onto a hidden alien grid, and watch it live or die by the logic you wrote.</p>
      <div class="goal-box">
        <strong>Goal:</strong> Drive onto 25 tiles and return to the lander, or drill 3 ore and return.
      </div>
      <button id="start-btn" class="primary-btn">Start</button>
    </div>
  `;
  
  document.getElementById('start-btn').addEventListener('click', showBuildScreen);
}

export function showBuildScreen() {
  clearScreen();
  stopTicking();
  isPaused = true;
  
  const container = document.getElementById('game-container');
  container.innerHTML = `
    <div class="build-screen">
      <div class="build-header">
        <h2>Build Your Rover</h2>
        <span class="run-indicator">Run ${runNumber + 1}</span>
      </div>
      
      <div class="build-content">
        <div class="sensors-section">
          <h3>Sensors <span class="sensor-count">(Pick exactly 3)</span></h3>
          <div class="sensor-list">
            <div class="sensor-item always-on">
              <span class="sensor-check">✓</span>
              <span class="sensor-name">Battery (INA219)</span>
              <span class="sensor-note">Always installed</span>
            </div>
            <div class="sensor-item always-on">
              <span class="sensor-check">✓</span>
              <span class="sensor-name">Drill</span>
              <span class="sensor-note">Always fitted</span>
            </div>
            <label class="sensor-item selectable">
              <input type="checkbox" data-sensor="distance" ${selectedSensors.includes(Sim.SENSORS.DISTANCE) ? 'checked' : ''}>
              <span class="sensor-name">Distance (HC-SR04)</span>
              <span class="sensor-desc">Detects crater in front</span>
            </label>
            <label class="sensor-item selectable">
              <input type="checkbox" data-sensor="dust" ${selectedSensors.includes(Sim.SENSORS.DUST) ? 'checked' : ''}>
              <span class="sensor-name">Dust (GP2Y1010)</span>
              <span class="sensor-desc">Detects if on dust tile</span>
            </label>
            <label class="sensor-item selectable">
              <input type="checkbox" data-sensor="spectral" ${selectedSensors.includes(Sim.SENSORS.SPECTRAL) ? 'checked' : ''}>
              <span class="sensor-name">Spectral (AS7341)</span>
              <span class="sensor-desc">Detects ore nearby and on tile</span>
            </label>
            <label class="sensor-item selectable">
              <input type="checkbox" data-sensor="camera" ${selectedSensors.includes(Sim.SENSORS.CAMERA) ? 'checked' : ''}>
              <span class="sensor-name">Camera (OV2640)</span>
              <span class="sensor-desc">Scans 3×3 area</span>
            </label>
          </div>
        </div>
        
        <div class="rules-section">
          <h3>Rules <span class="rule-note">(First match wins)</span></h3>
          <button id="load-starter-btn" class="secondary-btn starter-btn">Load Starter Program</button>
          <div class="rules-list" id="rules-list">
            ${renderRuleSlots()}
          </div>
        </div>
        
        <div class="reference-section">
          <h3>Reference</h3>
          <div class="reference-content">
            <div class="reference-col">
              <h4>Conditions</h4>
              <ul>
                <li><strong>Battery below N:</strong> battery points &lt; N</li>
                <li><strong>Goal met:</strong> 25 tiles driven onto or 3 ore (sticky)</li>
                <li><strong>Crater in front:</strong> needs Distance sensor</li>
                <li><strong>On a dust tile:</strong> needs Dust sensor</li>
                <li><strong>Ore next to rover:</strong> needs Spectral sensor</li>
                <li><strong>On an ore tile:</strong> needs Spectral sensor</li>
                <li><strong>Always:</strong> every tick (use as "otherwise")</li>
              </ul>
            </div>
            <div class="reference-col">
              <h4>Actions</h4>
              <ul>
                <li><strong>Explore:</strong> move toward nearest hidden tile (avoids known craters)</li>
                <li><strong>Return and charge:</strong> go to lander and charge (3 ticks)</li>
                <li><strong>Sidestep:</strong> move right or left, keep facing</li>
                <li><strong>Go to ore:</strong> move to adjacent ore and drill (costs 3, needs Spectral)</li>
                <li><strong>Drill:</strong> drill ore on current tile (costs 2)</li>
                <li><strong>Wait:</strong> do nothing this tick</li>
              </ul>
            </div>
          </div>
        </div>
      </div>
      
      <div class="build-footer">
        <button id="launch-btn" class="primary-btn" disabled>Launch</button>
        <button id="view-log-btn" class="secondary-btn">View Log</button>
      </div>
    </div>
  `;
  
  // Wire up sensor checkboxes
  document.querySelectorAll('.sensor-item input[type="checkbox"]').forEach(cb => {
    cb.addEventListener('change', handleSensorChange);
  });
  
  // Wire up rule controls
  wireRuleControls();
  
  // Wire up buttons
  document.getElementById('launch-btn').addEventListener('click', launch);
  document.getElementById('view-log-btn').addEventListener('click', showLogScreen);
  document.getElementById('load-starter-btn').addEventListener('click', loadStarterProgram);
  
  updateLaunchButton();
}

// v3.2: Load the printed starter program preset
function loadStarterProgram() {
  // Starter program needs Distance and Spectral
  const requiredSensors = [Sim.SENSORS.DISTANCE, Sim.SENSORS.SPECTRAL];
  
  // Ensure required sensors are selected
  for (const sensor of requiredSensors) {
    if (!selectedSensors.includes(sensor)) {
      // Remove a non-required sensor if we're at max
      if (selectedSensors.length >= 3) {
        // Keep Camera if selected, otherwise remove the first non-required
        const toRemove = selectedSensors.find(s => !requiredSensors.includes(s) && s !== Sim.SENSORS.CAMERA);
        if (toRemove) {
          selectedSensors = selectedSensors.filter(s => s !== toRemove);
        } else {
          selectedSensors = selectedSensors.filter(s => requiredSensors.includes(s));
        }
      }
      selectedSensors.push(sensor);
    }
  }
  
  // If we still need a third sensor, add Camera (or Dust if Camera not available)
  if (selectedSensors.length < 3) {
    if (!selectedSensors.includes(Sim.SENSORS.CAMERA)) {
      selectedSensors.push(Sim.SENSORS.CAMERA);
    } else if (!selectedSensors.includes(Sim.SENSORS.DUST)) {
      selectedSensors.push(Sim.SENSORS.DUST);
    }
  }
  
  // Load the starter program rules
  rules = Sim.STARTER_PROGRAM.map(r => ({
    condition: { ...r.condition },
    action: { ...r.action }
  }));
  
  // Re-render the build screen
  showBuildScreen();
}

function renderRuleSlots() {
  let html = '';
  for (let i = 0; i < 4; i++) {
    const rule = rules[i];
    const isLegal = !rule || Sim.isRuleLegal(rule, selectedSensors);
    html += `
      <div class="rule-slot ${!isLegal ? 'illegal' : ''}" data-slot="${i}">
        <div class="rule-number">${i + 1}</div>
        <div class="rule-content">
          <select class="condition-select" data-slot="${i}">
            ${renderConditionOptions(rule?.condition)}
          </select>
          ${rule?.condition?.type === Sim.CONDITIONS.BATTERY_BELOW ? 
            `<input type="number" class="battery-n" data-slot="${i}" min="1" max="20" value="${rule.condition.n || 8}">` : ''}
          <span class="rule-arrow">→</span>
          <select class="action-select" data-slot="${i}">
            ${renderActionOptions(rule?.action)}
          </select>
        </div>
        <div class="rule-controls">
          <button class="rule-move-up" data-slot="${i}" ${i === 0 ? 'disabled' : ''}>↑</button>
          <button class="rule-move-down" data-slot="${i}" ${i === 3 ? 'disabled' : ''}>↓</button>
        </div>
        ${!isLegal ? '<div class="rule-warning">⚠ Requires missing sensor</div>' : ''}
      </div>
    `;
  }
  return html;
}

function renderConditionOptions(selected) {
  const options = [
    { value: '', label: '-- Select condition --' },
    { value: Sim.CONDITIONS.BATTERY_BELOW, label: 'Battery below N', sensor: null },
    { value: Sim.CONDITIONS.GOAL_MET, label: 'Goal met', sensor: null },
    { value: Sim.CONDITIONS.CRATER_IN_FRONT, label: 'Crater in front', sensor: Sim.SENSORS.DISTANCE },
    { value: Sim.CONDITIONS.ON_DUST, label: 'On a dust tile', sensor: Sim.SENSORS.DUST },
    { value: Sim.CONDITIONS.ORE_NEXT_TO, label: 'Ore next to rover', sensor: Sim.SENSORS.SPECTRAL },
    { value: Sim.CONDITIONS.ON_ORE, label: 'On an ore tile', sensor: Sim.SENSORS.SPECTRAL },
    { value: Sim.CONDITIONS.ALWAYS, label: 'Always', sensor: null }
  ];
  
  return options.map(opt => {
    const isDisabled = opt.sensor && !selectedSensors.includes(opt.sensor);
    const isSelected = selected?.type === opt.value;
    return `<option value="${opt.value}" ${isSelected ? 'selected' : ''} ${isDisabled ? 'disabled' : ''}>${opt.label}${isDisabled ? ' (needs sensor)' : ''}</option>`;
  }).join('');
}

function renderActionOptions(selected) {
  const options = [
    { value: '', label: '-- Select action --' },
    { value: Sim.ACTIONS.EXPLORE, label: 'Explore', sensor: null },
    { value: Sim.ACTIONS.RETURN_CHARGE, label: 'Return and charge', sensor: null },
    { value: Sim.ACTIONS.SIDESTEP, label: 'Sidestep', sensor: null },
    { value: Sim.ACTIONS.GO_TO_ORE, label: 'Go to ore', sensor: Sim.SENSORS.SPECTRAL },
    { value: Sim.ACTIONS.DRILL, label: 'Drill', sensor: null },
    { value: Sim.ACTIONS.WAIT, label: 'Wait', sensor: null }
  ];
  
  return options.map(opt => {
    const isDisabled = opt.sensor && !selectedSensors.includes(opt.sensor);
    const isSelected = selected?.type === opt.value;
    return `<option value="${opt.value}" ${isSelected ? 'selected' : ''} ${isDisabled ? 'disabled' : ''}>${opt.label}${isDisabled ? ' (needs sensor)' : ''}</option>`;
  }).join('');
}

function wireRuleControls() {
  document.querySelectorAll('.condition-select').forEach(sel => {
    sel.addEventListener('change', handleConditionChange);
  });
  document.querySelectorAll('.action-select').forEach(sel => {
    sel.addEventListener('change', handleActionChange);
  });
  document.querySelectorAll('.battery-n').forEach(input => {
    input.addEventListener('change', handleBatteryNChange);
  });
  document.querySelectorAll('.rule-move-up').forEach(btn => {
    btn.addEventListener('click', handleMoveUp);
  });
  document.querySelectorAll('.rule-move-down').forEach(btn => {
    btn.addEventListener('click', handleMoveDown);
  });
}

function handleSensorChange(e) {
  const sensor = e.target.dataset.sensor;
  if (e.target.checked) {
    if (selectedSensors.length < 3) {
      selectedSensors.push(sensor);
    } else {
      e.target.checked = false;
      return;
    }
  } else {
    selectedSensors = selectedSensors.filter(s => s !== sensor);
  }
  
  // Re-render rules to update legality
  document.getElementById('rules-list').innerHTML = renderRuleSlots();
  wireRuleControls();
  updateLaunchButton();
}

function handleConditionChange(e) {
  const slot = parseInt(e.target.dataset.slot);
  const value = e.target.value;
  
  if (!value) {
    if (rules[slot]) {
      rules[slot].condition = null;
    }
  } else {
    if (!rules[slot]) rules[slot] = { condition: null, action: null };
    rules[slot].condition = { type: value };
    if (value === Sim.CONDITIONS.BATTERY_BELOW) {
      rules[slot].condition.n = 8; // Default
    }
  }
  
  // Re-render to show battery input if needed
  document.getElementById('rules-list').innerHTML = renderRuleSlots();
  wireRuleControls();
  updateLaunchButton();
}

function handleActionChange(e) {
  const slot = parseInt(e.target.dataset.slot);
  const value = e.target.value;
  
  if (!value) {
    if (rules[slot]) {
      rules[slot].action = null;
    }
  } else {
    if (!rules[slot]) rules[slot] = { condition: null, action: null };
    rules[slot].action = { type: value };
  }
  
  updateLaunchButton();
}

function handleBatteryNChange(e) {
  const slot = parseInt(e.target.dataset.slot);
  const value = parseInt(e.target.value) || 8;
  if (rules[slot] && rules[slot].condition) {
    rules[slot].condition.n = Math.max(1, Math.min(20, value));
  }
}

function handleMoveUp(e) {
  const slot = parseInt(e.target.dataset.slot);
  if (slot > 0) {
    [rules[slot - 1], rules[slot]] = [rules[slot], rules[slot - 1]];
    document.getElementById('rules-list').innerHTML = renderRuleSlots();
    wireRuleControls();
  }
}

function handleMoveDown(e) {
  const slot = parseInt(e.target.dataset.slot);
  if (slot < 3) {
    [rules[slot], rules[slot + 1]] = [rules[slot + 1], rules[slot]];
    document.getElementById('rules-list').innerHTML = renderRuleSlots();
    wireRuleControls();
  }
}

function updateLaunchButton() {
  const btn = document.getElementById('launch-btn');
  if (!btn) return;
  
  // Check: exactly 3 sensors
  const sensorsOk = selectedSensors.length === 3;
  
  // Check: at least 1 complete rule
  const hasRule = rules.some(r => r && r.condition && r.action);
  
  // Check: all rules are legal
  const allLegal = rules.every(r => Sim.isRuleLegal(r, selectedSensors));
  
  btn.disabled = !(sensorsOk && hasRule && allLegal);
}

// === OPERATE VIEW ===

function showOperateView() {
  clearScreen();
  
  const container = document.getElementById('game-container');
  container.innerHTML = `
    <div class="operate-view">
      <div class="operate-main">
        <div class="map-container">
          <div class="map-header">
            <span class="run-indicator">Run ${runNumber}</span>
            <span class="tick-indicator">Tick ${gameState.tick}</span>
          </div>
          <div class="map-grid" id="map-grid"></div>
          <div class="map-legend">
            <span class="legend-item"><span class="legend-color hidden"></span> Hidden</span>
            <span class="legend-item"><span class="legend-color empty"></span> Empty</span>
            <span class="legend-item"><span class="legend-color crater"></span> Crater</span>
            <span class="legend-item"><span class="legend-color ore"></span> Ore</span>
            <span class="legend-item"><span class="legend-color dust"></span> Dust</span>
          </div>
        </div>
        
        <div class="info-panel">
          <div class="rules-panel">
            <h3>Rules</h3>
            <div class="rule-display" id="rule-display"></div>
            <div class="rule-reason" id="rule-reason"></div>
          </div>
          
          <div class="sensors-panel">
            <h3>Sensor Readings</h3>
            <div class="sensor-readings" id="sensor-readings"></div>
          </div>
          
          <div class="status-panel">
            <div class="battery-display" id="battery-display">
              <span class="battery-icon">🔋</span>
              <span class="battery-value">${gameState.battery} pts (${gameState.battery * 5} Wh)</span>
              <div class="battery-bar"><div class="battery-fill" style="width: ${gameState.battery * 5}%"></div></div>
            </div>
            <div class="stats-row">
              <span>Tiles: ${gameState.tilesScanned}/${Sim.GOAL_TILES}</span>
              <span>Cargo: ${gameState.cargo}/3</span>
            </div>
          </div>
          
          <div class="controls-panel">
            <div class="speed-controls">
              <button class="speed-btn ${isPaused ? 'active' : ''}" data-speed="pause" id="pause-btn">${isPaused ? '▶ Resume' : '⏸ Pause'}</button>
              <button class="speed-btn ${!isPaused && currentSpeed === 1 ? 'active' : ''}" data-speed="1">1×</button>
              <button class="speed-btn ${!isPaused && currentSpeed === 4 ? 'active' : ''}" data-speed="4">4×</button>
              <button class="speed-btn ${!isPaused && currentSpeed === 16 ? 'active' : ''}" data-speed="16">16×</button>
            </div>
            <button class="step-btn ${isPaused ? '' : 'hidden'}" id="step-btn">Step 1 Tick</button>
            <div class="uplink-control">
              <button class="uplink-btn ${gameState.uplink.used ? 'used' : ''}" id="uplink-btn" ${!Sim.canUseUplink(gameState) || !isPaused ? 'disabled' : ''}>
                ${gameState.uplink.used ? '📡 Uplink Used' : '📡 Use Uplink'}
              </button>
            </div>
            <button class="end-run-btn" id="end-run-btn">End Run</button>
          </div>
        </div>
      </div>
      
      ${pendingAutoPause ? renderAutoPauseBanner() : ''}
      ${pendingStuck ? renderStuckBanner() : ''}
    </div>
  `;
  
  renderMap();
  renderRuleDisplay();
  renderSensorReadings();
  wireOperateControls();
}

function renderAutoPauseBanner() {
  return `
    <div class="auto-pause-banner">
      <div class="banner-content">
        <span class="banner-icon">⚠️</span>
        <span class="banner-text">${pendingAutoPause.reason}</span>
      </div>
      <div class="banner-actions">
        <button class="resume-btn" id="resume-btn">Resume</button>
        ${Sim.canUseUplink(gameState) ? '<button class="uplink-banner-btn" id="uplink-banner-btn">Use Uplink</button>' : ''}
      </div>
    </div>
  `;
}

function renderStuckBanner() {
  return `
    <div class="stuck-banner">
      <div class="banner-content">
        <span class="banner-icon">🚫</span>
        <span class="banner-text">Stuck: ${pendingStuck.reason}</span>
      </div>
      <div class="banner-actions">
        ${Sim.canUseUplink(gameState) ? '<button class="uplink-banner-btn" id="uplink-stuck-btn">Use Uplink</button>' : ''}
        <button class="end-stuck-btn" id="end-stuck-btn">End Run</button>
      </div>
    </div>
  `;
}

function renderMap() {
  const grid = document.getElementById('map-grid');
  if (!grid) return;
  
  let html = '<div class="column-labels"><span></span>';
  for (let c = 0; c < 12; c++) {
    html += `<span>${String.fromCharCode('A'.charCodeAt(0) + c)}</span>`;
  }
  html += '</div>';
  
  for (let r = 0; r < 12; r++) {
    html += `<div class="map-row"><span class="row-label">${r + 1}</span>`;
    for (let c = 0; c < 12; c++) {
      const isRevealed = gameState.revealed[r][c];
      const isCameraSeen = gameState.cameraSeen?.[r]?.[c] || false;
      const terrain = gameState.terrain[r][c];
      const isDrilled = gameState.drilled[r][c];
      const isRover = gameState.col === c && gameState.row === r;
      
      // Check if detected but not revealed
      let detected = false;
      if (!isRevealed && !isCameraSeen) {
        if (gameState.sensors.includes(Sim.SENSORS.DISTANCE)) {
          const [fc, fr] = [gameState.col + Sim.DIR_VECTORS[gameState.facing][0], 
                           gameState.row + Sim.DIR_VECTORS[gameState.facing][1]];
          if (c === fc && r === fr && terrain === Sim.TERRAIN.CRATER) {
            detected = true;
          }
        }
      }
      
      let cellClass = 'map-cell';
      if (isCameraSeen && !isRevealed) {
        // v3.2: Camera-seen but not driven onto - show terrain but faded
        cellClass += ` ${terrain} camera-seen`;
        if (isDrilled) cellClass += ' drilled';
      } else if (!isRevealed) {
        cellClass += ' hidden';
        if (detected) cellClass += ' detected';
      } else {
        cellClass += ` ${terrain}`;
        if (isDrilled) cellClass += ' drilled';
      }
      if (isRover) cellClass += ' rover';
      
      let cellContent = '';
      if (isRover) {
        const rotations = { north: 0, east: 90, south: 180, west: 270 };
        cellContent = `<div class="rover-icon ${gameState.charging ? 'charging' : ''}" style="transform: rotate(${rotations[gameState.facing]}deg)">▲</div>`;
      }
      
      html += `<div class="${cellClass}" data-col="${c}" data-row="${r}">${cellContent}</div>`;
    }
    html += '</div>';
  }
  
  // Add lander row
  html += '<div class="map-row lander-row"><span class="row-label">L</span>';
  for (let c = 0; c < 12; c++) {
    let cellClass = 'map-cell lander-area';
    let cellContent = '';
    if (c === 5) {
      cellClass += ' lander';
      const isRover = gameState.col === 5 && gameState.row === 12;
      if (isRover) {
        cellClass += ' rover';
        const rotations = { north: 0, east: 90, south: 180, west: 270 };
        cellContent = `<div class="rover-icon ${gameState.charging ? 'charging' : ''}" style="transform: rotate(${rotations[gameState.facing]}deg)">▲</div>`;
      } else {
        cellContent = '<div class="lander-icon">🛬</div>';
      }
    }
    html += `<div class="${cellClass}">${cellContent}</div>`;
  }
  html += '</div>';
  
  grid.innerHTML = html;
}

function renderRuleDisplay() {
  const display = document.getElementById('rule-display');
  if (!display) return;
  
  let html = '';
  for (let i = 0; i < 4; i++) {
    const rule = gameState.rules[i];
    const isFired = lastTickResult?.tickRecord?.ruleFired === i + 1;
    
    if (rule && rule.condition && rule.action) {
      const condText = formatConditionForDisplay(rule.condition);
      const actText = Sim.ACTION_NAMES[rule.action.type] || rule.action.type;
      html += `<div class="rule-line ${isFired ? 'fired' : ''}">
        <span class="rule-num">${i + 1}.</span>
        <span class="rule-text">${condText} → ${actText}</span>
      </div>`;
    }
  }
  display.innerHTML = html || '<div class="no-rules">No rules defined</div>';
  
  // Update reason
  const reasonEl = document.getElementById('rule-reason');
  if (reasonEl && lastTickResult?.tickRecord?.ruleReason) {
    reasonEl.textContent = lastTickResult.tickRecord.ruleReason;
  }
}

function formatConditionForDisplay(condition) {
  if (condition.type === Sim.CONDITIONS.BATTERY_BELOW) {
    return `Battery below ${condition.n}`;
  }
  return Sim.CONDITION_NAMES[condition.type] || condition.type;
}

function renderSensorReadings() {
  const panel = document.getElementById('sensor-readings');
  if (!panel) return;
  
  const readings = gameState.readings || {};
  let html = '';
  
  // Battery (always)
  html += `<div class="sensor-reading">
    <span class="sensor-label">Battery:</span>
    <span class="sensor-value">${readings.battery ?? gameState.battery} pts</span>
  </div>`;
  
  // Distance
  if (gameState.sensors.includes(Sim.SENSORS.DISTANCE)) {
    const crater = readings.craterInFront;
    html += `<div class="sensor-reading">
      <span class="sensor-label">Crater in front:</span>
      <span class="sensor-value ${crater?.detected ? 'warning' : ''}">${crater?.detected ? `Yes (${crater.cell})` : 'No'}</span>
    </div>`;
  } else {
    html += `<div class="sensor-reading disabled">
      <span class="sensor-label">Distance:</span>
      <span class="sensor-value">?</span>
    </div>`;
  }
  
  // Dust
  if (gameState.sensors.includes(Sim.SENSORS.DUST)) {
    html += `<div class="sensor-reading">
      <span class="sensor-label">On dust:</span>
      <span class="sensor-value ${readings.onDust ? 'warning' : ''}">${readings.onDust ? 'Yes' : 'No'}</span>
    </div>`;
  } else {
    html += `<div class="sensor-reading disabled">
      <span class="sensor-label">Dust:</span>
      <span class="sensor-value">?</span>
    </div>`;
  }
  
  // Spectral
  if (gameState.sensors.includes(Sim.SENSORS.SPECTRAL)) {
    const oreNext = readings.oreNextTo;
    html += `<div class="sensor-reading">
      <span class="sensor-label">Ore nearby:</span>
      <span class="sensor-value">${oreNext?.detected ? `Yes (${oreNext.directions.join(', ')})` : 'No'}</span>
    </div>`;
    html += `<div class="sensor-reading">
      <span class="sensor-label">On ore:</span>
      <span class="sensor-value">${readings.onOre ? 'Yes' : 'No'}</span>
    </div>`;
  } else {
    html += `<div class="sensor-reading disabled">
      <span class="sensor-label">Spectral:</span>
      <span class="sensor-value">?</span>
    </div>`;
  }
  
  // Camera
  if (gameState.sensors.includes(Sim.SENSORS.CAMERA)) {
    html += `<div class="sensor-reading">
      <span class="sensor-label">Camera:</span>
      <span class="sensor-value">3×3 scanning</span>
    </div>`;
  } else {
    html += `<div class="sensor-reading disabled">
      <span class="sensor-label">Camera:</span>
      <span class="sensor-value">?</span>
    </div>`;
  }
  
  panel.innerHTML = html;
}

function wireOperateControls() {
  document.querySelectorAll('.speed-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const speed = e.target.dataset.speed;
      if (speed === 'pause') {
        // Toggle: if paused, resume; if running, pause
        if (isPaused) {
          setSpeed(currentSpeed || 1);
        } else {
          pause();
        }
      } else {
        setSpeed(parseInt(speed));
      }
    });
  });
  
  document.getElementById('step-btn')?.addEventListener('click', stepOneTick);
  document.getElementById('uplink-btn')?.addEventListener('click', showUplinkDialog);
  document.getElementById('uplink-banner-btn')?.addEventListener('click', showUplinkDialog);
  document.getElementById('uplink-stuck-btn')?.addEventListener('click', showUplinkDialog);
  document.getElementById('end-run-btn')?.addEventListener('click', abortRun);
  document.getElementById('resume-btn')?.addEventListener('click', resumeFromAutoPause);
  document.getElementById('end-stuck-btn')?.addEventListener('click', endFromStuck);
}

function updateOperateView() {
  // Update tick and run indicators
  const tickIndicator = document.querySelector('.tick-indicator');
  if (tickIndicator) tickIndicator.textContent = `Tick ${gameState.tick}`;
  
  // Update battery
  const batteryDisplay = document.getElementById('battery-display');
  if (batteryDisplay) {
    batteryDisplay.innerHTML = `
      <span class="battery-icon ${gameState.charging ? 'charging' : ''}">🔋</span>
      <span class="battery-value">${gameState.battery} pts (${gameState.battery * 5} Wh)</span>
      <div class="battery-bar"><div class="battery-fill" style="width: ${gameState.battery * 5}%"></div></div>
    `;
  }
  
  // Update stats
  const statsRow = document.querySelector('.stats-row');
  if (statsRow) {
    statsRow.innerHTML = `
      <span>Tiles: ${gameState.tilesScanned}/${Sim.GOAL_TILES}</span>
      <span>Cargo: ${gameState.cargo}/3</span>
    `;
  }
  
  // Update button states
  document.querySelectorAll('.speed-btn').forEach(btn => {
    const speed = btn.dataset.speed;
    btn.classList.toggle('active', 
      (speed === 'pause' && isPaused) || 
      (speed !== 'pause' && !isPaused && currentSpeed === parseInt(speed))
    );
  });
  
  // Update Pause/Resume button text
  const pauseBtn = document.getElementById('pause-btn');
  if (pauseBtn) {
    pauseBtn.textContent = isPaused ? '▶ Resume' : '⏸ Pause';
  }
  
  const stepBtn = document.getElementById('step-btn');
  if (stepBtn) stepBtn.classList.toggle('hidden', !isPaused);
  
  const uplinkBtn = document.getElementById('uplink-btn');
  if (uplinkBtn) {
    uplinkBtn.disabled = !Sim.canUseUplink(gameState) || !isPaused;
    uplinkBtn.textContent = gameState.uplink.used ? '📡 Uplink Used' : '📡 Use Uplink';
    uplinkBtn.classList.toggle('used', gameState.uplink.used);
  }
  
  renderMap();
  renderRuleDisplay();
  renderSensorReadings();
}

// === UPLINK DIALOG ===

function showUplinkDialog() {
  if (!Sim.canUseUplink(gameState)) return;
  
  const dialog = document.createElement('div');
  dialog.className = 'uplink-dialog-overlay';
  dialog.innerHTML = `
    <div class="uplink-dialog">
      <h3>📡 Uplink Edit</h3>
      <p>Change one rule slot. This is your only edit this run.</p>
      
      <div class="uplink-slot-select">
        <label>Rule slot:</label>
        <select id="uplink-slot">
          <option value="0">1</option>
          <option value="1">2</option>
          <option value="2">3</option>
          <option value="3">4</option>
        </select>
      </div>
      
      <div class="uplink-rule-edit">
        <label>Condition:</label>
        <select id="uplink-condition">
          ${renderConditionOptions(null)}
        </select>
        <input type="number" id="uplink-battery-n" class="battery-n hidden" min="1" max="20" value="8">
        
        <label>Action:</label>
        <select id="uplink-action">
          ${renderActionOptions(null)}
        </select>
      </div>
      
      <div class="uplink-actions">
        <button id="uplink-cancel" class="secondary-btn">Cancel</button>
        <button id="uplink-apply" class="primary-btn">Apply</button>
      </div>
    </div>
  `;
  
  document.body.appendChild(dialog);
  
  // Pre-fill with current rule
  const slotSelect = document.getElementById('uplink-slot');
  slotSelect.addEventListener('change', () => {
    const slot = parseInt(slotSelect.value);
    const rule = gameState.rules[slot];
    document.getElementById('uplink-condition').value = rule?.condition?.type || '';
    document.getElementById('uplink-action').value = rule?.action?.type || '';
    if (rule?.condition?.type === Sim.CONDITIONS.BATTERY_BELOW) {
      document.getElementById('uplink-battery-n').value = rule.condition.n || 8;
      document.getElementById('uplink-battery-n').classList.remove('hidden');
    } else {
      document.getElementById('uplink-battery-n').classList.add('hidden');
    }
  });
  
  document.getElementById('uplink-condition').addEventListener('change', (e) => {
    const batteryInput = document.getElementById('uplink-battery-n');
    if (e.target.value === Sim.CONDITIONS.BATTERY_BELOW) {
      batteryInput.classList.remove('hidden');
    } else {
      batteryInput.classList.add('hidden');
    }
  });
  
  document.getElementById('uplink-cancel').addEventListener('click', () => {
    dialog.remove();
  });
  
  document.getElementById('uplink-apply').addEventListener('click', () => {
    const slot = parseInt(document.getElementById('uplink-slot').value);
    const condType = document.getElementById('uplink-condition').value;
    const actType = document.getElementById('uplink-action').value;
    
    if (!condType || !actType) {
      alert('Please select both a condition and an action');
      return;
    }
    
    let condition = { type: condType };
    if (condType === Sim.CONDITIONS.BATTERY_BELOW) {
      condition.n = parseInt(document.getElementById('uplink-battery-n').value) || 8;
    }
    const action = { type: actType };
    
    if (!Sim.isConditionLegal(condType, gameState.sensors) || 
        !Sim.isActionLegal(actType, gameState.sensors)) {
      alert('That rule requires a sensor you don\'t have installed');
      return;
    }
    
    Sim.applyUplink(gameState, slot, condition, action);
    rules[slot] = { condition, action };
    
    dialog.remove();
    pendingAutoPause = null;
    pendingStuck = null;
    showOperateView();
  });
}

// === GAME CONTROL ===

function launch() {
  runNumber++;
  autoPauseCount = 0;
  runStartTime = Date.now();
  previouslyRevealed = null;
  pendingAutoPause = null;
  pendingStuck = null;
  lastTickResult = null;
  
  // Deep copy rules
  const rulesCopy = rules.map(r => r ? { 
    condition: r.condition ? { ...r.condition } : null, 
    action: r.action ? { ...r.action } : null 
  } : null);
  
  gameState = Sim.createInitialState([...selectedSensors], rulesCopy);
  
  // Initialize current run log
  currentRun = {
    sessionId,
    testerLabel,
    runNumber,
    startedAt: new Date().toISOString(),
    endedAt: null,
    durationSeconds: 0,
    secondsSincePreviousRun: previousRunEndTime ? Math.round((runStartTime - previousRunEndTime) / 1000) : null,
    ticks: 0,
    sensors: [...selectedSensors],
    rulesAtLaunch: rulesCopy.map(r => formatRuleForLog(r)),
    changesFromPrevious: computeChanges(),
    uplink: null,
    outcome: null,
    endReason: null,
    tilesScanned: 0,
    cargo: 0,
    batteryAtEnd: 20,
    autoPauses: 0,
    whyNote: '',
    prompted: false
  };
  
  isPaused = true;
  currentSpeed = 1;
  
  showOperateView();
}

function computeChanges() {
  if (runNumber <= 1) return { changed: false, sensors: [], rules: [] };
  
  const prevRun = log.currentSession?.runs?.[log.currentSession.runs.length - 1];
  if (!prevRun) return { changed: false, sensors: [], rules: [] };
  
  const sensorChanges = [];
  const prevSensors = prevRun.sensors || [];
  for (const s of selectedSensors) {
    if (!prevSensors.includes(s)) sensorChanges.push({ sensor: s, change: 'added' });
  }
  for (const s of prevSensors) {
    if (!selectedSensors.includes(s)) sensorChanges.push({ sensor: s, change: 'removed' });
  }
  
  const ruleChanges = [];
  const prevRules = prevRun.rulesAtLaunch || [];
  for (let i = 0; i < 4; i++) {
    const prev = prevRules[i];
    const curr = formatRuleForLog(rules[i]);
    if (prev !== curr) {
      ruleChanges.push({ slot: i + 1, before: prev, after: curr });
    }
  }
  
  return {
    changed: sensorChanges.length > 0 || ruleChanges.length > 0,
    sensors: sensorChanges,
    rules: ruleChanges
  };
}

function formatRuleForLog(rule) {
  if (!rule || !rule.condition || !rule.action) return null;
  let cond = Sim.CONDITION_NAMES[rule.condition.type] || rule.condition.type;
  if (rule.condition.type === Sim.CONDITIONS.BATTERY_BELOW) {
    cond = `Battery below ${rule.condition.n}`;
  }
  const act = Sim.ACTION_NAMES[rule.action.type] || rule.action.type;
  return `${cond} → ${act}`;
}

function pause() {
  isPaused = true;
  stopTicking();
  updateOperateView();
}

function setSpeed(speed) {
  currentSpeed = speed;
  isPaused = false;
  startTicking();
  updateOperateView();
}

function startTicking() {
  stopTicking();
  const interval = currentSpeed === 1 ? 1000 : currentSpeed === 4 ? 250 : 62.5;
  tickInterval = setInterval(doTick, interval);
}

function stopTicking() {
  if (tickInterval) {
    clearInterval(tickInterval);
    tickInterval = null;
  }
}

function stepOneTick() {
  if (!isPaused) return;
  doTick();
}

function doTick() {
  if (animatingMove) return;
  if (gameState.outcome) return;
  
  // If we need to continue from step 4 after an auto-pause resume
  let result;
  if (continueFromStep4Data) {
    const { tickRecord, readings } = continueFromStep4Data;
    continueFromStep4Data = null;
    result = Sim.continueTickFromStep4(gameState, tickRecord, readings);
  } else {
    result = Sim.runTick(gameState, previouslyRevealed);
  }
  
  lastTickResult = result;
  previouslyRevealed = result.newlyRevealed;
  
  // Handle auto-pause
  if (result.autoPause) {
    autoPauseCount++;
    pendingAutoPause = { ...result.autoPause };
    if (result.continueFromStep4) {
      continueFromStep4Data = { tickRecord: result.tickRecord, readings: gameState.readings };
    }
    isPaused = true;
    stopTicking();
    showOperateView();
    return;
  }
  
  // Handle stuck condition
  if (result.stuckCondition) {
    pendingStuck = result.stuckCondition;
    isPaused = true;
    stopTicking();
    showOperateView();
    return;
  }
  
  // Handle end condition
  if (result.endCondition) {
    gameState.outcome = result.endCondition.outcome;
    gameState.endReason = result.endCondition.reason;
    stopTicking();
    endRun();
    return;
  }
  
  // Animate movement if needed
  const shouldAnimate = currentSpeed <= 4 && result.tickRecord?.actionResult?.moved;
  if (shouldAnimate) {
    animatingMove = true;
    const duration = currentSpeed === 1 ? 120 : currentSpeed === 4 ? 30 : 0;
    setTimeout(() => {
      animatingMove = false;
      updateOperateView();
    }, duration);
  } else {
    updateOperateView();
  }
}

function resumeFromAutoPause() {
  pendingAutoPause = null;
  showOperateView();
  if (!isPaused) {
    startTicking();
  } else {
    // If we're stepping manually, continue the tick now
    if (continueFromStep4Data) {
      doTick();
    }
  }
}

function endFromStuck() {
  gameState.outcome = pendingStuck.outcome;
  gameState.endReason = pendingStuck.reason;
  pendingStuck = null;
  endRun();
}

function abortRun() {
  if (confirm('End this run early?')) {
    gameState.outcome = Sim.OUTCOMES.ABORTED;
    gameState.endReason = `Run aborted by player on tick ${gameState.tick}`;
    endRun();
  }
}

function endRun() {
  stopTicking();
  previousRunEndTime = Date.now();
  
  // Save run to log
  currentRun.endedAt = new Date().toISOString();
  currentRun.durationSeconds = Math.round((previousRunEndTime - runStartTime) / 1000);
  currentRun.ticks = gameState.tick;
  currentRun.outcome = gameState.outcome;
  currentRun.endReason = gameState.endReason;
  currentRun.tilesScanned = gameState.tilesScanned;
  currentRun.cargo = gameState.cargo;
  currentRun.batteryAtEnd = gameState.battery;
  currentRun.autoPauses = autoPauseCount;
  
  if (gameState.uplink.used) {
    currentRun.uplink = {
      tick: gameState.uplink.tick,
      slot: gameState.uplink.slot + 1,
      before: formatRuleForLog(gameState.uplink.before),
      after: formatRuleForLog(gameState.uplink.after)
    };
  }
  
  showEndScreen();
}

// === END SCREEN ===

function showEndScreen() {
  clearScreen();
  
  const outcome = gameState.outcome;
  const isSuccess = outcome === Sim.OUTCOMES.SUCCESS_SCAN || outcome === Sim.OUTCOMES.SUCCESS_ORE;
  
  const outcomeText = {
    [Sim.OUTCOMES.SUCCESS_SCAN]: '🎉 Success! Mission Complete (Scan)',
    [Sim.OUTCOMES.SUCCESS_ORE]: '🎉 Success! Mission Complete (Ore)',
    [Sim.OUTCOMES.LOST_CRATER]: '💥 Lost: Crater Collision',
    [Sim.OUTCOMES.LOST_BATTERY]: '🔋 Lost: Battery Depleted',
    [Sim.OUTCOMES.STUCK_NO_MOVE]: '🚫 Stuck: No Movement',
    [Sim.OUTCOMES.STUCK_CHARGE]: '🚫 Stuck: Charged Without Leaving',
    [Sim.OUTCOMES.STUCK_LOOP]: '🚫 Stuck: Loop Detected',
    [Sim.OUTCOMES.ABORTED]: '⏹ Run Aborted'
  };
  
  const container = document.getElementById('game-container');
  container.innerHTML = `
    <div class="end-screen ${isSuccess ? 'success' : 'failure'}">
      <div class="end-header">
        <h2>${outcomeText[outcome] || outcome}</h2>
        <p class="end-reason">${gameState.endReason}</p>
      </div>
      
      <div class="end-stats">
        <div class="stat-item"><span class="stat-label">Ticks:</span> <span class="stat-value">${gameState.tick}</span></div>
        <div class="stat-item"><span class="stat-label">Tiles Scanned:</span> <span class="stat-value">${gameState.tilesScanned}/${Sim.GOAL_TILES}</span></div>
        <div class="stat-item"><span class="stat-label">Cargo:</span> <span class="stat-value">${gameState.cargo}/3</span></div>
        <div class="stat-item"><span class="stat-label">Battery:</span> <span class="stat-value">${gameState.battery} pts</span></div>
        <div class="stat-item"><span class="stat-label">Uplink:</span> <span class="stat-value">${gameState.uplink.used ? 'Used' : 'Not used'}</span></div>
      </div>
      
      <div class="end-trace">
        <h3>Trace (Last 5 Ticks)</h3>
        <div class="trace-list" id="trace-list">
          ${renderTrace()}
        </div>
        ${gameState.trace.length > 5 ? '<button id="show-more-trace" class="secondary-btn">Show more...</button>' : ''}
      </div>
      
      <div class="end-why">
        <label for="why-note">Why do you think that happened?</label>
        <input type="text" id="why-note" placeholder="Optional note..." maxlength="200">
      </div>
      
      <div class="end-actions">
        <button id="rerun-btn" class="primary-btn">Rerun</button>
        <button id="view-log-end-btn" class="secondary-btn">View Log</button>
      </div>
    </div>
  `;
  
  document.getElementById('show-more-trace')?.addEventListener('click', showFullTrace);
  document.getElementById('why-note')?.addEventListener('change', (e) => {
    currentRun.whyNote = e.target.value;
  });
  document.getElementById('rerun-btn').addEventListener('click', () => {
    saveCurrentRun();
    showBuildScreen();
  });
  document.getElementById('view-log-end-btn').addEventListener('click', () => {
    saveCurrentRun();
    showLogScreen();
  });
}

function renderTrace(showAll = false) {
  const trace = gameState.trace;
  const toShow = showAll ? trace : trace.slice(-5);
  
  return toShow.map(t => `
    <div class="trace-item">
      <span class="trace-tick">Tick ${t.tick}</span>
      <span class="trace-pos">${Sim.formatCell(t.positionAfter.col, t.positionAfter.row)} facing ${t.facingAfter}</span>
      <span class="trace-battery">Battery: ${t.battery}</span>
      <span class="trace-reason">${t.ruleReason || ''}</span>
    </div>
  `).join('');
}

function showFullTrace() {
  document.getElementById('trace-list').innerHTML = renderTrace(true);
  document.getElementById('show-more-trace')?.remove();
}

function saveCurrentRun() {
  if (!currentRun) return;
  
  // Update why note
  const whyInput = document.getElementById('why-note');
  if (whyInput) {
    currentRun.whyNote = whyInput.value;
  }
  
  log.currentSession.runs.push(currentRun);
  saveLog(log);
  currentRun = null;
}

// === LOG SCREEN ===

function showLogScreen() {
  clearScreen();
  stopTicking();
  
  const session = log.currentSession;
  const runs = session?.runs || [];
  
  // Calculate voluntary reruns
  let voluntaryReruns = 0;
  let rerunsNoChange = 0;
  for (let i = 1; i < runs.length; i++) {
    if (runs[i].changesFromPrevious?.changed && !runs[i].prompted) {
      voluntaryReruns++;
    } else if (!runs[i].changesFromPrevious?.changed) {
      rerunsNoChange++;
    }
  }
  
  const container = document.getElementById('game-container');
  container.innerHTML = `
    <div class="log-screen">
      <div class="log-header">
        <h2>Run Log</h2>
        <span class="session-id">Session: ${session?.id || 'None'} ${session?.label ? `(${session.label})` : ''}</span>
      </div>
      
      <div class="log-summary">
        <h3>Session Summary</h3>
        <div class="summary-stats">
          <div class="summary-item"><span>Total Runs:</span> <span>${runs.length}</span></div>
          <div class="summary-item"><span>Voluntary Reruns with Change:</span> <span>${voluntaryReruns}</span></div>
          <div class="summary-item"><span>Reruns without Change:</span> <span>${rerunsNoChange}</span></div>
          <div class="summary-item highlight"><span>3+ Voluntary Reruns:</span> <span>${voluntaryReruns >= 3 ? 'Yes ✓' : 'No'}</span></div>
        </div>
      </div>
      
      <div class="log-table-container">
        <table class="log-table">
          <thead>
            <tr>
              <th>Run</th>
              <th>Outcome</th>
              <th>Ticks</th>
              <th>Tiles</th>
              <th>Cargo</th>
              <th>Changed</th>
              <th>Prompted</th>
              <th>Duration</th>
            </tr>
          </thead>
          <tbody>
            ${runs.map((r, i) => `
              <tr>
                <td>${r.runNumber}</td>
                <td class="${r.outcome?.startsWith('success') ? 'success' : 'failure'}">${r.outcome || '?'}</td>
                <td>${r.ticks}</td>
                <td>${r.tilesScanned}/${Sim.GOAL_TILES}</td>
                <td>${r.cargo}/3</td>
                <td>${r.changesFromPrevious?.changed ? 'Yes' : (i === 0 ? '-' : 'No')}</td>
                <td><input type="checkbox" data-run="${i}" ${r.prompted ? 'checked' : ''} class="prompted-check"></td>
                <td>${r.durationSeconds}s</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
      
      <div class="log-actions">
        <button id="copy-csv-btn" class="secondary-btn">Copy as CSV</button>
        <button id="download-csv-btn" class="secondary-btn">Download CSV</button>
        <button id="download-json-btn" class="secondary-btn">Download JSON</button>
        <button id="new-tester-btn" class="secondary-btn">New Tester</button>
        <button id="clear-log-btn" class="secondary-btn danger">Clear Log</button>
      </div>
      
      <div class="log-footer">
        <button id="back-to-build-btn" class="primary-btn">Back to Build</button>
      </div>
    </div>
  `;
  
  // Wire up controls
  document.querySelectorAll('.prompted-check').forEach(cb => {
    cb.addEventListener('change', (e) => {
      const runIdx = parseInt(e.target.dataset.run);
      if (log.currentSession.runs[runIdx]) {
        log.currentSession.runs[runIdx].prompted = e.target.checked;
        saveLog(log);
        showLogScreen(); // Refresh to update summary
      }
    });
  });
  
  document.getElementById('copy-csv-btn').addEventListener('click', copyAsCSV);
  document.getElementById('download-csv-btn').addEventListener('click', downloadCSV);
  document.getElementById('download-json-btn').addEventListener('click', downloadJSON);
  document.getElementById('new-tester-btn').addEventListener('click', () => {
    const label = prompt('Enter tester label (optional):') || '';
    startNewSession(label);
    showBuildScreen();
  });
  document.getElementById('clear-log-btn').addEventListener('click', () => {
    if (confirm('Clear all run data? This cannot be undone.')) {
      localStorage.removeItem(STORAGE_KEY);
      log = { sessions: [], currentSession: null };
      startNewSession();
      showLogScreen();
    }
  });
  document.getElementById('back-to-build-btn').addEventListener('click', showBuildScreen);
}

function generateCSV() {
  const runs = log.currentSession?.runs || [];
  const headers = ['Session ID', 'Tester', 'Run', 'Started', 'Ended', 'Duration (s)', 'Time Since Previous (s)', 
                   'Ticks', 'Sensors', 'Rules at Launch', 'Changed', 'Uplink', 'Outcome', 'End Reason',
                   'Tiles Scanned', 'Cargo', 'Battery', 'Auto-pauses', 'Why Note', 'Prompted'];
  
  const rows = runs.map(r => [
    r.sessionId,
    r.testerLabel || '',
    r.runNumber,
    r.startedAt,
    r.endedAt,
    r.durationSeconds,
    r.secondsSincePreviousRun ?? '',
    r.ticks,
    (r.sensors || []).join('; '),
    (r.rulesAtLaunch || []).filter(x => x).join('; '),
    r.changesFromPrevious?.changed ? 'Yes' : 'No',
    r.uplink ? `Tick ${r.uplink.tick}, Slot ${r.uplink.slot}: ${r.uplink.before || 'empty'} → ${r.uplink.after}` : 'None',
    r.outcome,
    r.endReason,
    r.tilesScanned,
    r.cargo,
    r.batteryAtEnd,
    r.autoPauses,
    r.whyNote || '',
    r.prompted ? 'Yes' : 'No'
  ]);
  
  const escape = (val) => {
    const str = String(val ?? '');
    if (str.includes(',') || str.includes('"') || str.includes('\n')) {
      return '"' + str.replace(/"/g, '""') + '"';
    }
    return str;
  };
  
  return [headers.join(','), ...rows.map(r => r.map(escape).join(','))].join('\n');
}

function copyAsCSV() {
  const csv = generateCSV();
  navigator.clipboard.writeText(csv).then(() => {
    alert('CSV copied to clipboard!');
  }).catch(() => {
    alert('Failed to copy to clipboard');
  });
}

function downloadCSV() {
  const csv = generateCSV();
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `far-rover-log-${log.currentSession?.id || 'unknown'}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

function downloadJSON() {
  const json = JSON.stringify(log.currentSession, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `far-rover-log-${log.currentSession?.id || 'unknown'}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

// === KEYBOARD SHORTCUTS ===

function setupKeyboardShortcuts() {
  document.addEventListener('keydown', (e) => {
    // Only in operate view
    if (!gameState || gameState.outcome) return;
    
    switch (e.key) {
      case ' ':
        e.preventDefault();
        if (isPaused) {
          setSpeed(currentSpeed || 1);
        } else {
          pause();
        }
        break;
      case '1':
        e.preventDefault();
        setSpeed(1);
        break;
      case '2':
        e.preventDefault();
        setSpeed(1);
        break;
      case '3':
        e.preventDefault();
        setSpeed(4);
        break;
      case '4':
        e.preventDefault();
        setSpeed(16);
        break;
      case '.':
        e.preventDefault();
        if (isPaused) stepOneTick();
        break;
    }
  });
}

// Export for testing
export function getGameState() {
  return gameState;
}

export function setGameStateForTest(state) {
  gameState = state;
}

export function getRules() {
  return rules;
}

export function setRulesForTest(r) {
  rules = r;
}

export function getSelectedSensors() {
  return selectedSensors;
}

export function setSelectedSensorsForTest(s) {
  selectedSensors = s;
}

export function getLog() {
  return log;
}

export function resetForTest() {
  gameState = null;
  runNumber = 0;
  selectedSensors = [];
  rules = [null, null, null, null];
  log = { sessions: [], currentSession: null };
  startNewSession();
}
