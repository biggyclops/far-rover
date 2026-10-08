// Far Rover UI Module
// Handles all screen rendering and user interaction

import * as Sim from './simulation.js';
import { GameRenderer, MinimapRenderer, loadAssets, hasRealArt, getBackgroundImage, getIcon } from './renderer.js';
import { shouldUse3D } from './renderer3d.js';
import { OrbitalRenderer } from './orbital.js';
import { resolveCamMode, persistCamMode, CAM_MODES } from './rovercam.js';

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
let tickRaf = 0;
let ticksArmed = false;
let nextTickAt = 0;
let previouslyRevealed = null;
let pendingAutoPause = null;
let pendingStuck = null;
let lastTickResult = null;
let autoPauseMode = loadAutoPauseMode();
let autoPauseKindsSeen = new Set();
let shownReturnCraterWarning = false;

const AUTO_PAUSE_STORAGE = 'far-rover-autopause-mode';

function loadAutoPauseMode() {
  try {
    const v = localStorage.getItem('far-rover-autopause-mode');
    if (v === 'off' || v === 'first' || v === 'always') return v;
  } catch {
    // ignore
  }
  return 'first';
}

function saveAutoPauseMode(mode) {
  autoPauseMode = mode;
  try {
    localStorage.setItem('far-rover-autopause-mode', mode);
  } catch {
    // ignore
  }
}

function hazardKind(h) {
  if (h.sensor === 'Distance sensor') return 'distance-crater';
  if (h.sensor === 'Dust sensor') return 'dust-on-tile';
  if (h.sensor === 'Camera' && h.type === 'dust') return 'camera-dust';
  if (h.sensor === 'Camera') return 'camera-crater';
  return h.type || 'other';
}

function shouldPauseForHazards(autoPause) {
  if (!autoPause) return false;
  if (autoPauseMode === 'off') return false;
  const hazards = autoPause.hazards || [];
  if (autoPauseMode === 'always') return true;
  const newKinds = [];
  for (const h of hazards) {
    const kind = hazardKind(h);
    if (!autoPauseKindsSeen.has(kind)) newKinds.push(kind);
  }
  if (newKinds.length === 0) return false;
  for (const k of newKinds) autoPauseKindsSeen.add(k);
  return true;
}

function displayedBattery() {
  const rec = lastTickResult?.tickRecord;
  if (rec?.batteryAtStart != null) return rec.batteryAtStart;
  if (rec?.readings && rec.readings.battery != null) return rec.readings.battery;
  return gameState?.battery ?? 20;
}

function headingDeg(facing) {
  return { north: 0, east: 90, south: 180, west: 270 }[facing] ?? 0;
}

function trackingText(state) {
  const u = (state?.col ?? 5) + (state?.row ?? 12) * 0.15;
  const lat = (-14.5683 - 0.00002 * u).toFixed(4);
  const lon = (175.2876 + 0.00011 * u).toFixed(4);
  const hdg = headingDeg(state?.facing).toFixed(0).padStart(3, '0');
  return `TRACKING: ROVER-1    LAT ${lat}°   LON ${lon}°   ELEV -2,317 m   HDG ${hdg}°`;
}

function uplinkBlocked() {
  if (!gameState) return true;
  if (gameState.uplink.used) return true;
  if (!isPaused) return true;
  if (gameState.tick < 1) return true;
  if (gameState.outcome) return true;
  if (pendingStuck) return true;
  return false;
}

// Renderer
let renderer = null;

// Build state
let selectedSensors = [];
let rules = [null, null, null, null];

// Log
let log = loadLog();
let currentRun = null;

// === INITIALIZATION ===

export async function init() {
  // Load art assets
  await loadAssets();
  
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
  if (renderer?.dispose) {
    try { renderer.dispose(); } catch { /* ignore */ }
  }
  renderer = null;
  document.getElementById('game-container').innerHTML = '';
}

export function showTitleScreen() {
  clearScreen();
  stopTicking();
  
  const container = document.getElementById('game-container');
  container.innerHTML = `
    <div class="title-screen">
      <h1>Far Rover</h1>
      <p class="pitch">Build a tiny rover from three sensors and four if-then rules, launch it onto a hidden Mars grid, and watch it live or die by the logic you wrote.</p>
      <div class="goal-box glass-panel">
        <div class="goal-icon">🎯</div>
        <div class="goal-text">
          <strong>Goal:</strong> Drive onto 25 tiles and return to the lander, or drill 3 ore and return.
        </div>
      </div>
      <button id="start-btn" class="primary-btn glow-btn">Start Mission</button>
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
      <div class="build-header glass-panel">
        <h2><span class="header-icon">🛠️</span> Build Your Rover</h2>
        <span class="run-indicator">Run ${runNumber + 1}</span>
      </div>
      
      <div class="build-content">
        <div class="sensors-section glass-panel">
          <h3>Sensors <span class="sensor-count">(Pick 3 of 4 optional sensors)</span></h3>
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
              <span class="sensor-desc">Shows 3×3 (seen, not scanned; dust alerts fire even without Dust)</span>
            </label>
          </div>
        </div>
        
        <div class="rules-section glass-panel">
          <div class="rules-header">
            <h3>Rules <span class="rule-note">(Checked top to bottom; first true wins)</span></h3>
            <button id="starter-preset-btn" class="preset-btn" title="Load starter program">
              ⚡ Starter
            </button>
          </div>
          <div class="rules-list" id="rules-list">
            ${renderRuleSlots()}
          </div>
          <div class="build-warnings" id="build-warnings"></div>
        </div>
        
        <div class="reference-section glass-panel">
          <h3>Reference</h3>
          <div class="reference-content">
            <div class="reference-col">
              <h4>Conditions</h4>
              <ul>
                <li><strong>Battery below N:</strong> battery points &lt; N</li>
                <li><strong>Crater in front:</strong> needs Distance sensor</li>
                <li><strong>On a dust tile:</strong> needs Dust sensor</li>
                <li><strong>Ore next to rover:</strong> needs Spectral sensor</li>
                <li><strong>On an ore tile:</strong> needs Spectral sensor</li>
                <li><strong>Goal met:</strong> 25 tiles scanned or 3 ore drilled</li>
                <li><strong>Always:</strong> every tick (use as "otherwise")</li>
              </ul>
            </div>
            <div class="reference-col">
              <h4>Actions</h4>
              <ul>
                <li><strong>Explore:</strong> move toward nearest hidden tile</li>
                <li><strong>Return and charge:</strong> go to lander and charge (3 ticks)</li>
                <li><strong>Go to ore:</strong> move onto adjacent ore and drill it (costs 3)</li>
                <li><strong>Drill:</strong> drill ore on current tile (costs 2)</li>
                <li><strong>Wait:</strong> do nothing this tick</li>
                <li><strong>Sidestep:</strong> move to the rover's right if valid, otherwise left; facing stays the same</li>
              </ul>
            </div>
          </div>
        </div>
      </div>
      
      <div class="build-footer glass-panel">
        <button id="launch-btn" class="primary-btn glow-btn" disabled>🚀 Launch</button>
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
  document.getElementById('starter-preset-btn').addEventListener('click', loadStarterPreset);
  
  updateLaunchButton();
  refreshBuildWarnings();
}

function loadStarterPreset() {
  // Starter program: Crater→Sidestep, Battery<12→Return, OnOre→Drill, Always→Explore
  selectedSensors = [Sim.SENSORS.DISTANCE, Sim.SENSORS.SPECTRAL, Sim.SENSORS.CAMERA];
  rules = [
    { condition: { type: Sim.CONDITIONS.CRATER_IN_FRONT }, action: { type: Sim.ACTIONS.SIDESTEP } },
    { condition: { type: Sim.CONDITIONS.BATTERY_BELOW, n: 12 }, action: { type: Sim.ACTIONS.RETURN_CHARGE } },
    { condition: { type: Sim.CONDITIONS.ON_ORE }, action: { type: Sim.ACTIONS.DRILL } },
    { condition: { type: Sim.CONDITIONS.ALWAYS }, action: { type: Sim.ACTIONS.EXPLORE } }
  ];
  
  // Re-render
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
    { value: Sim.CONDITIONS.CRATER_IN_FRONT, label: 'Crater in front', sensor: Sim.SENSORS.DISTANCE },
    { value: Sim.CONDITIONS.ON_DUST, label: 'On a dust tile', sensor: Sim.SENSORS.DUST },
    { value: Sim.CONDITIONS.ORE_NEXT_TO, label: 'Ore next to rover', sensor: Sim.SENSORS.SPECTRAL },
    { value: Sim.CONDITIONS.ON_ORE, label: 'On an ore tile', sensor: Sim.SENSORS.SPECTRAL },
    { value: Sim.CONDITIONS.GOAL_MET, label: 'Goal met', sensor: null },
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
  refreshBuildWarnings();
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
  refreshBuildWarnings();
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
  refreshBuildWarnings();
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
    refreshBuildWarnings();
  }
}

function handleMoveDown(e) {
  const slot = parseInt(e.target.dataset.slot);
  if (slot < 3) {
    [rules[slot], rules[slot + 1]] = [rules[slot + 1], rules[slot]];
    document.getElementById('rules-list').innerHTML = renderRuleSlots();
    wireRuleControls();
    refreshBuildWarnings();
  }
}

function refreshBuildWarnings() {
  const el = document.getElementById('build-warnings');
  if (!el) return;
  const warnings = [];

  let lastFilled = -1;
  let alwaysIdx = -1;
  for (let i = 0; i < rules.length; i++) {
    if (rules[i]?.condition && rules[i]?.action) {
      lastFilled = i;
      if (rules[i].condition.type === Sim.CONDITIONS.ALWAYS) alwaysIdx = i;
    }
  }
  if (alwaysIdx >= 0 && alwaysIdx < lastFilled) {
    warnings.push('Always is not last, so rules below it can never fire.');
  }

  const landerReadings = {
    battery: 20,
    goalMet: false,
    craterInFront: { detected: false, cell: null },
    onDust: false,
    oreNextTo: { detected: false, directions: [] },
    onOre: false
  };
  let anyTrueOnPad = false;
  for (const r of rules) {
    if (!r?.condition || !r?.action) continue;
    if (!Sim.isRuleLegal(r, selectedSensors)) continue;
    if (Sim.evaluateCondition(r.condition, { sensors: selectedSensors }, landerReadings)) {
      anyTrueOnPad = true;
      break;
    }
  }
  if (!anyTrueOnPad) {
    warnings.push('No rule is true at full battery on the lander, so the rover will never leave.');
  }

  el.innerHTML = warnings.map(w => `<div class="build-warning">⚠ ${w}</div>`).join('');
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

// Minimap renderer instance
let minimapRenderer = null;

function createBoardRenderer(container, state) {
  const force2d = typeof location !== 'undefined' &&
    new URLSearchParams(location.search).get('renderer') === '2d';
  if (!force2d) {
    try {
      const r = new OrbitalRenderer(container, state);
      r.setPlaybackSpeed(currentSpeed || 1);
      r.setPausedHint?.(isPaused);
      r.onFrame = onRendererFrame;
      r.mount();
      container.dataset.renderer = shouldUse3D() ? '3d' : '2d';
      return r;
    } catch (err) {
      console.warn('Orbital renderer failed, using 2D canvas', err);
    }
  }
  const r = new GameRenderer(container, state);
  r.setPlaybackSpeed(currentSpeed || 1);
  r.mount();
  container.dataset.renderer = '2d';
  return r;
}

function showOperateView() {
  clearScreen();
  sensorLayers = {
    camera: true,
    lidar: false,
    thermal: false,
    spectral: false
  };
  
  const container = document.getElementById('game-container');
  const hdg = headingDeg(gameState.facing);
  const batPct = Math.round(displayedBattery() * 5);
  container.innerHTML = `
    <div class="operate-view orbital-ops">
      <div class="map-container" id="map-container">
        <div class="map-grid" id="map-grid">
          <div class="orbital-grain" aria-hidden="true"></div>
          <div class="orbital-scanlines" aria-hidden="true"></div>
          <div class="orbital-vignette" aria-hidden="true"></div>
          <div class="rover-tag" id="rover-tag" hidden>ROVER-1</div>
        </div>
        <div class="rover-cam" id="rover-cam">
          <div class="rover-cam-head">
            <span>ROVER CAM FORWARD</span>
            <span class="rover-cam-nav">NAVCAM</span>
          </div>
          <canvas id="rover-cam-canvas" width="528" height="297"></canvas>
          <div class="rover-cam-modes" role="radiogroup" aria-label="Rover camera mode">
            <button type="button" class="cam-mode-btn" id="cam-photo" data-cam="photo">PHOTO</button>
            <button type="button" class="cam-mode-btn" id="cam-hybrid" data-cam="hybrid">HYBRID</button>
            <button type="button" class="cam-mode-btn" id="cam-3d" data-cam="3d">3D</button>
          </div>
          <div class="rover-cam-meta">
            <span>FOV 60°</span>
            <span>RES 1024×576</span>
            <span>EXP 12.4 ms</span>
          </div>
        </div>
      </div>

      <div class="hud-bar">
        <div class="hud-left">
          <div class="hud-title-row">
            <span class="hud-brand">FAR ROVER</span>
            <span class="hud-ops">//  ORBITAL OPS</span>
          </div>
          <div class="hud-sat">FR-SAT 1  ·  HiRISE-CLASS  ·  NADIR</div>
        </div>
        <div class="hud-center">
          <span class="tick-indicator" id="hud-tick">Tick ${gameState.tick}</span>
          <div class="hud-playback" id="hud-playback">${isPaused ? 'HOLD' : currentSpeed === 1 ? 'LIVE 1×' : currentSpeed + '×'}</div>
        </div>
        <div class="hud-right">
          <span class="hud-live" id="hud-live"><span class="live-dot"></span>LIVE</span>
          <span class="hud-feed">ORBITAL FEED // PASS 3</span>
          <span class="run-indicator">Run ${runNumber}</span>
        </div>
      </div>

      <div class="orbital-left">
        <div class="sensor-layers-panel" id="sensor-layers-panel">
          <div class="instrument-label">SENSOR LAYERS</div>
          <div class="instrument-stack" id="instrument-stack"></div>
          <div class="telemetry-block">
            <div class="instrument-label">TELEMETRY</div>
            <div class="tel-row"><span>ALTITUDE</span><span>312.4 km</span></div>
            <div class="tel-row"><span>GSD</span><span>0.30 m/px</span></div>
            <div class="tel-row"><span>SUN AZ</span><span>271.6°</span></div>
            <div class="tel-row"><span>ROVER HDG</span><span id="tel-hdg">${hdg.toFixed(1)}°</span></div>
            <div class="tel-row"><span>ROVER SPD</span><span id="tel-spd">0.00 m/s</span></div>
            <div class="tel-row"><span>DRIVE</span><span id="tel-drive">HOLD</span></div>
            <div class="tel-row"><span>BATTERY</span><span id="hud-battery">${batPct}%</span></div>
            <div class="tel-row"><span>DATA RATE</span><span id="tel-datarate">2.11 Mbps</span></div>
            <div class="tel-row tel-game"><span>CARGO</span><span id="hud-ore">${gameState.cargo} (goal 3)</span></div>
            <div class="tel-row tel-game"><span>TILES</span><span id="hud-tiles">${gameState.tilesScanned}/25</span></div>
            <div class="tel-row tel-game"><span>UPLINK</span><span id="hud-uplink">${gameState.uplink.used ? 'Used' : 'Ready'}</span></div>
            <div class="tel-row tel-game"><span>FACING</span><span id="hud-facing">${Sim.FACING_LABELS[gameState.facing] || gameState.facing}</span></div>
          </div>
        </div>
        <div class="rules-panel glass-panel">
          <h3>Rover Rules</h3>
          <div class="rule-display" id="rule-display"></div>
        </div>
      </div>

      <div class="info-panel">
        <div class="sensors-panel glass-panel">
          <h3>Sensor Readings</h3>
          <div class="sensor-readings" id="sensor-readings"></div>
        </div>
        <div class="controls-panel glass-panel">
          <button class="pause-btn" id="pause-btn">${isPaused ? 'Resume' : 'Pause'}</button>
          <div class="speed-controls">
            <button class="speed-btn ${isPaused ? 'active' : ''}" data-speed="pause">⏸</button>
            <button class="speed-btn ${!isPaused && currentSpeed === 1 ? 'active' : ''}" data-speed="1">1×</button>
            <button class="speed-btn ${!isPaused && currentSpeed === 4 ? 'active' : ''}" data-speed="4">4×</button>
            <button class="speed-btn ${!isPaused && currentSpeed === 16 ? 'active' : ''}" data-speed="16">16×</button>
          </div>
          <button class="step-btn ${isPaused ? '' : 'hidden'}" id="step-btn">Step</button>
          <div class="view-tools">
            <button type="button" id="reset-view-btn" class="view-tool-btn">Reset view</button>
            <label class="grid-toggle"><input type="checkbox" id="grid-toggle"> Grid</label>
          </div>
          <button class="uplink-btn ${gameState.uplink.used ? 'used' : ''}" id="uplink-btn" ${uplinkBlocked() ? 'disabled' : ''}>
            ${gameState.uplink.used ? '📡 Uplink Used' : '📡 Uplink'}
          </button>
          <label class="autopause-mode">
            Auto-pause
            <select id="autopause-mode">
              <option value="off" ${autoPauseMode === 'off' ? 'selected' : ''}>Off</option>
              <option value="first" ${autoPauseMode === 'first' ? 'selected' : ''}>First time each kind</option>
              <option value="always" ${autoPauseMode === 'always' ? 'selected' : ''}>Always</option>
            </select>
          </label>
          <button class="end-run-btn" id="end-run-btn">End Run</button>
        </div>
      </div>

      <div class="tracking-strip" id="tracking-strip">${trackingText(gameState)}</div>
      <div class="credits-line">Terrain: NASA/JPL-Caltech/UArizona HiRISE PIA23289 · Rover cam: NASA/JPL-Caltech/ASU/MSSS Mastcam-Z PIA23727, Navcam PIA24422, PIA24543</div>
      <div class="battery-gauge visual-hidden" aria-hidden="true">
        <div class="battery-fill" id="battery-fill" style="width: ${gameState.battery * 5}%"></div>
      </div>

      <div class="minimap glass-panel" id="minimap">
        <div class="minimap-label">Surface map</div>
        <canvas id="minimap-canvas" width="108" height="117"></canvas>
      </div>

      ${pendingAutoPause && !pendingAutoPause.resumed ? renderAutoPauseToast() : ''}
      ${pendingStuck ? renderStuckToast() : ''}
      ${shownReturnCraterWarning ? '<div class="return-crater-note">Return and charge doesn\'t avoid craters.</div>' : ''}
    </div>
  `;
  
  // Initialize renderer
  const mapGrid = document.getElementById('map-grid');
  renderer = createBoardRenderer(mapGrid, gameState);
  
  // Initialize minimap renderer
  const minimapCanvas = document.getElementById('minimap-canvas');
  minimapRenderer = new MinimapRenderer(minimapCanvas, gameState);
  
  renderRuleDisplay();
  renderSensorReadings();
  renderInstrumentStack();
  renderMinimap();
  wireOperateControls();
  wireRoverCamDrag();
  wireCamModeToggle();
}

function wireCamModeToggle() {
  const mode = resolveCamMode();
  renderer?.setCamMode?.(mode);
  const buttons = document.querySelectorAll('.cam-mode-btn');
  const paint = (m) => {
    buttons.forEach((btn) => {
      const on = btn.dataset.cam === m;
      btn.classList.toggle('active', on);
      btn.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
  };
  paint(mode);
  buttons.forEach((btn) => {
    btn.addEventListener('click', () => {
      const m = btn.dataset.cam;
      if (!CAM_MODES.includes(m)) return;
      persistCamMode(m);
      renderer?.setCamMode?.(m);
      paint(m);
    });
  });
}

function renderAutoPauseToast() {
  return `
    <div class="auto-pause-toast">
      <div class="toast-content">
        <span class="toast-icon">⚠️</span>
        <span class="toast-text">${pendingAutoPause.reason}</span>
      </div>
      <div class="toast-actions">
        <button class="resume-btn" id="resume-btn">Resume</button>
        ${!gameState.uplink.used ? '<button class="uplink-toast-btn" id="uplink-banner-btn">Uplink</button>' : ''}
      </div>
    </div>
  `;
}

function renderStuckToast() {
  return `
    <div class="auto-pause-toast stuck">
      <div class="toast-content">
        <span class="toast-icon">🚫</span>
        <span class="toast-text">Stuck: ${pendingStuck.reason}</span>
      </div>
      <div class="toast-actions">
        <button class="end-toast-btn" id="end-stuck-btn">End Run</button>
      </div>
    </div>
  `;
}

function renderMinimap() {
  if (minimapRenderer) {
    minimapRenderer.updateState(gameState);
    minimapRenderer.render();
  }
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
        <span class="rule-indicator">${isFired ? '▶' : ''}</span>
        <span class="rule-text">${condText} : <span class="action-name">${actText}</span></span>
      </div>`;
    }
  }
  display.innerHTML = html || '<div class="no-rules">No rules defined</div>';
}

function formatConditionForDisplay(condition) {
  if (condition.type === Sim.CONDITIONS.BATTERY_BELOW) {
    return `Battery below ${condition.n}`;
  }
  return Sim.CONDITION_NAMES[condition.type] || condition.type;
}

const SENSOR_LAYER_SPEC = [
  { id: 'camera', label: 'Camera', sensor: Sim.SENSORS.CAMERA },
  { id: 'lidar', label: 'Lidar', note: 'Distance', sensor: Sim.SENSORS.DISTANCE },
  { id: 'thermal', label: 'Thermal', note: 'Dust', sensor: Sim.SENSORS.DUST },
  { id: 'spectral', label: 'Spectral', sensor: Sim.SENSORS.SPECTRAL }
];

let sensorLayers = { camera: true, lidar: false, thermal: false, spectral: false };

function renderInstrumentStack() {
  const el = document.getElementById('instrument-stack');
  if (!el || !gameState) return;
  const sensors = gameState.sensors || [];
  const icons = {
    camera: '<span class="layer-ico ico-cam" aria-hidden="true"></span>',
    lidar: '<span class="layer-ico ico-lidar" aria-hidden="true"></span>',
    thermal: '<span class="layer-ico ico-thermal" aria-hidden="true"></span>',
    spectral: '<span class="layer-ico ico-spectral" aria-hidden="true"></span>'
  };
  let html = '';
  for (const spec of SENSOR_LAYER_SPEC) {
    const installed = sensors.includes(spec.sensor);
    const on = !!sensorLayers[spec.id];
    const st = on ? 'ACTIVE' : 'STANDBY';
    const idAttr = (spec.id !== 'thermal' || installed) ? `id="layer-${spec.id}"` : '';
    html += `<button type="button" class="instrument-toggle${on ? ' active' : ''}"
      ${idAttr} data-layer="${spec.id}" aria-pressed="${on}"
      aria-label="${spec.label} layer ${on ? 'active' : 'standby'}">
      ${icons[spec.id] || ''}
      <span class="instrument-dot"></span>
      <span class="instrument-copy">
        <span class="instrument-name">${spec.label.toUpperCase()}</span>
        <span class="instrument-state">${st}</span>
      </span>
    </button>`;
  }
  el.innerHTML = html;
  el.querySelectorAll('.instrument-toggle[data-layer]').forEach(btn => {
    const toggle = () => {
      const id = btn.dataset.layer;
      sensorLayers[id] = !sensorLayers[id];
      renderer?.setSensorLayer?.(id, sensorLayers[id]);
      renderInstrumentStack();
    };
    btn.addEventListener('click', toggle);
  });
  applySensorLayers();
}

function applySensorLayers() {
  if (!renderer?.setSensorLayer) return;
  for (const spec of SENSOR_LAYER_SPEC) {
    renderer.setSensorLayer(spec.id, !!sensorLayers[spec.id]);
  }
  const grid = document.getElementById('map-grid');
  if (grid) grid.classList.toggle('optical-on', !!sensorLayers.camera);
}

function wireRoverCamDrag() {
  const el = document.getElementById('rover-cam');
  if (!el) return;
  let drag = null;
  el.addEventListener('pointerdown', (e) => {
    if (e.target.closest('button')) return;
    const rect = el.getBoundingClientRect();
    drag = { ox: e.clientX - rect.left, oy: e.clientY - rect.top };
    el.classList.add('dragging');
    el.setPointerCapture(e.pointerId);
  });
  el.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const parent = el.parentElement?.getBoundingClientRect();
    if (!parent) return;
    const x = e.clientX - parent.left - drag.ox;
    const y = e.clientY - parent.top - drag.oy;
    el.style.left = Math.max(6, Math.min(parent.width - el.offsetWidth - 6, x)) + 'px';
    el.style.top = Math.max(6, Math.min(parent.height - el.offsetHeight - 6, y)) + 'px';
    el.style.right = 'auto';
    el.style.bottom = 'auto';
  });
  const end = () => { drag = null; el.classList.remove('dragging'); };
  el.addEventListener('pointerup', end);
  el.addEventListener('pointercancel', end);
}

function renderSensorReadings() {
  const panel = document.getElementById('sensor-readings');
  if (!panel) return;
  
  const readings = gameState.readings || {};
  let html = '';
  
  // Battery (always)
  html += `<div class="sensor-reading">
    <span class="sensor-label">Battery:</span>
    <span class="sensor-value">${displayedBattery()} pts</span>
  </div>`;
  html += `<div class="sensor-reading">
    <span class="sensor-label">Facing:</span>
    <span class="sensor-value">${Sim.FACING_LABELS[gameState.facing] || gameState.facing}</span>
  </div>`;
  const sides = Sim.sidestepDirections(gameState.facing);
  html += `<div class="sensor-reading">
    <span class="sensor-label">Sidestep:</span>
    <span class="sensor-value">right → ${Sim.FACING_LABELS[sides.right]}, else left → ${Sim.FACING_LABELS[sides.left]}</span>
  </div>`;
  
  // Distance
  if (gameState.sensors.includes(Sim.SENSORS.DISTANCE)) {
    const crater = readings.craterInFront;
    html += `<div class="sensor-reading">
      <span class="sensor-label">Crater ahead:</span>
      <span class="sensor-value ${crater?.detected ? 'warning' : ''}">${crater?.detected ? `Yes (${crater.cell})` : 'No'}</span>
    </div>`;
  }
  
  // Dust
  if (gameState.sensors.includes(Sim.SENSORS.DUST)) {
    html += `<div class="sensor-reading">
      <span class="sensor-label">On dust:</span>
      <span class="sensor-value ${readings.onDust ? 'warning' : ''}">${readings.onDust ? 'Yes' : 'No'}</span>
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
  }
  
  // Camera
  if (gameState.sensors.includes(Sim.SENSORS.CAMERA)) {
    html += `<div class="sensor-reading">
      <span class="sensor-label">Camera:</span>
      <span class="sensor-value">shows 3×3</span>
    </div>`;
  }
  
  panel.innerHTML = html;
}

function wireOperateControls() {
  document.querySelectorAll('.speed-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const speed = e.target.dataset.speed;
      if (speed === 'pause') {
        pause();
      } else {
        setSpeed(parseInt(speed));
      }
    });
  });
  
  document.getElementById('step-btn')?.addEventListener('click', stepOneTick);
  document.getElementById('pause-btn')?.addEventListener('click', togglePause);
  document.getElementById('uplink-btn')?.addEventListener('click', showUplinkDialog);
  document.getElementById('uplink-banner-btn')?.addEventListener('click', showUplinkDialog);
  document.getElementById('end-run-btn')?.addEventListener('click', abortRun);
  document.getElementById('resume-btn')?.addEventListener('click', resumeFromAutoPause);
  document.getElementById('end-stuck-btn')?.addEventListener('click', endFromStuck);
  document.getElementById('reset-view-btn')?.addEventListener('click', () => renderer?.resetView?.());
  document.getElementById('grid-toggle')?.addEventListener('change', (e) => {
    renderer?.setGridForced?.(e.target.checked);
  });
  document.getElementById('autopause-mode')?.addEventListener('change', (e) => {
    saveAutoPauseMode(e.target.value);
  });
}

function updateOperateView() {
  // Update HUD
  const hudTick = document.getElementById('hud-tick');
  if (hudTick) hudTick.textContent = `Tick ${gameState.tick}`;

  const hudPlayback = document.getElementById('hud-playback');
  if (hudPlayback) {
    hudPlayback.textContent = isPaused ? 'HOLD' : (currentSpeed === 1 ? 'LIVE 1×' : `${currentSpeed}×`);
  }

  const moving = !!(renderer?.anim);
  const hdg = headingDeg(gameState.facing);
  const telHdg = document.getElementById('tel-hdg');
  if (telHdg) telHdg.textContent = `${hdg.toFixed(1)}°`;
  const telSpd = document.getElementById('tel-spd');
  if (telSpd) telSpd.textContent = moving ? '0.12 m/s' : '0.00 m/s';
  const telDrive = document.getElementById('tel-drive');
  if (telDrive) telDrive.textContent = moving && !isPaused ? 'ACTIVE' : 'HOLD';
  const telRate = document.getElementById('tel-datarate');
  if (telRate) telRate.textContent = `${(2.11 + 0.03 * Math.sin((gameState.tick || 0) * 1.7)).toFixed(2)} Mbps`;
  const track = document.getElementById('tracking-strip');
  if (track) track.textContent = trackingText(gameState);
  
  const hudBattery = document.getElementById('hud-battery');
  if (hudBattery) hudBattery.textContent = `${Math.round(displayedBattery() * 5)}%`;
  
  const batteryFill = document.getElementById('battery-fill');
  if (batteryFill) batteryFill.style.width = `${displayedBattery() * 5}%`;
  
  const hudOre = document.getElementById('hud-ore');
  if (hudOre) hudOre.textContent = `${gameState.cargo} (goal 3)`;
  
  const hudTiles = document.getElementById('hud-tiles');
  if (hudTiles) hudTiles.textContent = `${gameState.tilesScanned}/25`;
  
  const hudUplink = document.getElementById('hud-uplink');
  if (hudUplink) hudUplink.textContent = gameState.uplink.used ? 'Used' : 'Ready';

  const hudFacing = document.getElementById('hud-facing');
  if (hudFacing) hudFacing.textContent = Sim.FACING_LABELS[gameState.facing] || gameState.facing;
  
  // Update button states
  document.querySelectorAll('.speed-btn').forEach(btn => {
    const speed = btn.dataset.speed;
    btn.classList.toggle('active', 
      (speed === 'pause' && isPaused) || 
      (speed !== 'pause' && !isPaused && currentSpeed === parseInt(speed))
    );
  });
  
  const stepBtn = document.getElementById('step-btn');
  if (stepBtn) stepBtn.classList.toggle('hidden', !isPaused);
  
  const pauseBtn = document.getElementById('pause-btn');
  if (pauseBtn) pauseBtn.textContent = isPaused ? 'Resume' : 'Pause';
  
  const uplinkBtn = document.getElementById('uplink-btn');
  if (uplinkBtn) {
    uplinkBtn.disabled = uplinkBlocked();
    uplinkBtn.classList.toggle('used', gameState.uplink.used);
    uplinkBtn.textContent = gameState.uplink.used ? '📡 Uplink Used' : '📡 Uplink';
  }
  
  // Update renderer
  if (renderer) {
    renderer.updateState(gameState);
    renderer.setPausedHint?.(isPaused);
    if (!renderer.ownsLoop) renderer.render();
  }
  
  renderRuleDisplay();
  renderSensorReadings();
  renderMinimap();
  syncOperateNotices();
}

function syncOperateNotices() {
  const operate = document.querySelector('.operate-view');
  if (!operate) return;

  const existingPause = operate.querySelector('.auto-pause-toast:not(.stuck)');
  const existingStuck = operate.querySelector('.auto-pause-toast.stuck');
  const wantPause = pendingAutoPause && !pendingAutoPause.resumed;
  const pauseText = wantPause ? pendingAutoPause.reason : '';

  if (!wantPause) {
    existingPause?.remove();
  } else if (!existingPause || existingPause.querySelector('.toast-text')?.textContent !== pauseText) {
    existingPause?.remove();
    operate.insertAdjacentHTML('beforeend', renderAutoPauseToast());
    document.getElementById('resume-btn')?.addEventListener('click', resumeFromAutoPause);
    document.getElementById('uplink-banner-btn')?.addEventListener('click', showUplinkDialog);
  }

  if (!pendingStuck) {
    existingStuck?.remove();
  } else if (!existingStuck) {
    operate.insertAdjacentHTML('beforeend', renderStuckToast());
    document.getElementById('end-stuck-btn')?.addEventListener('click', endFromStuck);
  }

  if (shownReturnCraterWarning && !operate.querySelector('.return-crater-note')) {
    const note = document.createElement('div');
    note.className = 'return-crater-note';
    note.textContent = "Return and charge doesn't avoid craters.";
    operate.appendChild(note);
  }
}

// === UPLINK DIALOG ===

function fillUplinkFromSlot(slot) {
  const rule = gameState.rules[slot];
  const condEl = document.getElementById('uplink-condition');
  const actEl = document.getElementById('uplink-action');
  const nEl = document.getElementById('uplink-battery-n');
  if (!condEl || !actEl || !nEl) return;
  condEl.value = rule?.condition?.type || '';
  actEl.value = rule?.action?.type || '';
  if (rule?.condition?.type === Sim.CONDITIONS.BATTERY_BELOW) {
    nEl.value = Sim.clampBatteryN(rule.condition.n);
    nEl.classList.remove('hidden');
  } else {
    nEl.classList.add('hidden');
  }
}

function showUplinkDialog() {
  if (gameState.uplink.used || gameState.outcome || pendingStuck) return;
  if (gameState.tick < 1) {
    alert('Uplink is available after the first turn.');
    return;
  }
  if (!Sim.canUseUplink(gameState)) return;
  
  const dialog = document.createElement('div');
  dialog.className = 'uplink-dialog-overlay';
  dialog.innerHTML = `
    <div class="uplink-dialog glass-panel">
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
          ${renderConditionOptions(gameState.rules[0]?.condition)}
        </select>
        <input type="number" id="uplink-battery-n" class="battery-n ${gameState.rules[0]?.condition?.type === Sim.CONDITIONS.BATTERY_BELOW ? '' : 'hidden'}" min="1" max="20" value="${Sim.clampBatteryN(gameState.rules[0]?.condition?.n || 8)}">
        
        <label>Action:</label>
        <select id="uplink-action">
          ${renderActionOptions(gameState.rules[0]?.action)}
        </select>
      </div>
      
      <div class="uplink-actions">
        <button id="uplink-cancel" class="secondary-btn">Cancel</button>
        <button id="uplink-apply" class="primary-btn">Apply</button>
      </div>
    </div>
  `;
  
  document.body.appendChild(dialog);
  
  const slotSelect = document.getElementById('uplink-slot');
  fillUplinkFromSlot(0);
  slotSelect.addEventListener('change', () => {
    fillUplinkFromSlot(parseInt(slotSelect.value));
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
      condition.n = Sim.clampBatteryN(document.getElementById('uplink-battery-n').value);
    }
    const action = { type: actType };
    
    if (!Sim.isConditionLegal(condType, gameState.sensors) || 
        !Sim.isActionLegal(actType, gameState.sensors)) {
      alert('That rule requires a sensor you don\'t have installed');
      return;
    }
    
    if (!Sim.applyUplink(gameState, slot, condition, action)) {
      alert('Uplink is not available right now.');
      return;
    }
    
    dialog.remove();
    // Keep pendingAutoPause so the current tick continues (no phantom tick).
    if (pendingAutoPause) {
      pendingAutoPause.resumed = true;
    }
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
  autoPauseKindsSeen = new Set();
  shownReturnCraterWarning = false;
  
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
  if (renderer) renderer.setPlaybackSpeed(speed);
  startTicking();
  updateOperateView();
}

function togglePause() {
  if (isPaused) {
    setSpeed(currentSpeed || 1);
  } else {
    pause();
  }
}

function tickPeriodMs() {
  if (currentSpeed === 1) return 1000;
  if (currentSpeed === 4) return 250;
  return 62.5;
}

function onRendererFrame(now) {
  if (!ticksArmed || isPaused || !gameState || gameState.outcome) return;
  const period = tickPeriodMs();
  if (!nextTickAt) nextTickAt = now + period;
  let n = 0;
  while (now + 0.05 >= nextTickAt && n < 3) {
    doTick(now);
    nextTickAt += period;
    n += 1;
    if (isPaused || gameState?.outcome) break;
  }
}

function startTicking() {
  stopTicking();
  ticksArmed = true;
  nextTickAt = 0;
  if (renderer) renderer.onFrame = onRendererFrame;
  if (!renderer?.ownsLoop) {
    const pump = (now) => {
      tickRaf = requestAnimationFrame(pump);
      onRendererFrame(now);
    };
    tickRaf = requestAnimationFrame(pump);
  }
}

function stopTicking() {
  ticksArmed = false;
  nextTickAt = 0;
  if (tickRaf) {
    cancelAnimationFrame(tickRaf);
    tickRaf = 0;
  }
  if (tickInterval) {
    clearInterval(tickInterval);
    tickInterval = null;
  }
}

function stepOneTick() {
  if (!isPaused) return;
  doTick(renderer?.now?.() ?? performance.now());
}

function tickAnimDuration() {
  if (isPaused) return 200;
  return tickPeriodMs();
}

function peekNextPose() {
  if (!gameState || gameState.outcome) return null;
  try {
    const clone = typeof structuredClone === 'function'
      ? structuredClone(gameState)
      : JSON.parse(JSON.stringify(gameState));
    const result = Sim.runTick(clone, previouslyRevealed);
    if (result?.continueFromStep4 && result.tickRecord) {
      Sim.continueTickFromStep4(
        clone,
        result.tickRecord,
        clone.readings || result.tickRecord.readings
      );
    }
    return { col: clone.col, row: clone.row, facing: clone.facing };
  } catch {
    return null;
  }
}

function playPoseAnimation(prevCol, prevRow, now) {
  if (!renderer?.startAnimation || !gameState) return;
  renderer.startAnimation(
    prevCol,
    prevRow,
    gameState.col,
    gameState.row,
    tickAnimDuration(),
    now,
    peekNextPose()
  );
}

function doTick(now) {
  if (gameState.outcome) return;
  
  const prevCol = gameState.col;
  const prevRow = gameState.row;
  
  let result;
  if (pendingAutoPause && pendingAutoPause.continueFromStep4) {
    const tickRecord = pendingAutoPause.tickRecord;
    const readings = gameState.readings;
    pendingAutoPause = null;
    result = Sim.continueTickFromStep4(gameState, tickRecord, readings);
  } else {
    result = Sim.runTick(gameState, previouslyRevealed);
  }
  
  lastTickResult = result;
  previouslyRevealed = result.newlyRevealed ?? previouslyRevealed;
  
  // Auto-pause may be skipped based on mode (off / first kind / always)
  if (result.autoPause && result.continueFromStep4) {
    if (shouldPauseForHazards(result.autoPause)) {
      autoPauseCount++;
      pendingAutoPause = { ...result.autoPause, continueFromStep4: result.continueFromStep4, tickRecord: result.tickRecord };
      isPaused = true;
      stopTicking();
      updateOperateView();
      return;
    }
    result = Sim.continueTickFromStep4(gameState, result.tickRecord, gameState.readings);
    lastTickResult = result;
    previouslyRevealed = result.newlyRevealed ?? previouslyRevealed;
  }
  
  if (result.tickRecord?.returnCraterWarning) {
    shownReturnCraterWarning = true;
  }
  
  if (result.stuckCondition) {
    pendingStuck = result.stuckCondition;
    isPaused = true;
    stopTicking();
    updateOperateView();
    return;
  }
  
  if (result.endCondition) {
    gameState.outcome = result.endCondition.outcome;
    gameState.endReason = result.endCondition.reason;
    stopTicking();
    if (renderer) {
      playPoseAnimation(prevCol, prevRow, now);
      renderer.updateState(gameState);
      renderer.render(now);
    }
    const delay = (gameState.outcome === Sim.OUTCOMES.LOST_CRATER || gameState.outcome === 'lost-crater') ? 1300
      : (gameState.outcome === Sim.OUTCOMES.LOST_BATTERY || gameState.outcome === 'lost-battery') ? 700
      : 0;
    if (delay && !navigator.webdriver) {
      setTimeout(() => endRun(), delay);
    } else {
      endRun();
    }
    return;
  }

  if (renderer) {
    playPoseAnimation(prevCol, prevRow, now);
    renderer.updateState(gameState);
  }
  updateOperateView();
}

function resumeFromAutoPause() {
  if (pendingAutoPause) {
    pendingAutoPause.resumed = true;
  }
  isPaused = false;
  doTick(renderer?.now?.() ?? performance.now());
  if (!gameState?.outcome && !pendingStuck && !(pendingAutoPause && !pendingAutoPause.resumed)) {
    startTicking();
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
  if (typeof window !== 'undefined' && renderer?._motionLog?.length) {
    const stats = renderer.motionStats();
    window.__farRoverMotionStats = stats;
    window.__farRoverMotionLog = renderer._motionLog;
    console.log('MOTION_STATS', JSON.stringify(stats));
  }
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
      <div class="end-header glass-panel">
        <h2>${outcomeText[outcome] || outcome}</h2>
        <p class="end-reason">${gameState.endReason}</p>
      </div>
      
      <div class="end-stats">
        <div class="stat-item glass-panel">
          <span class="stat-label">Ticks:</span>
          <span class="stat-value">${gameState.tick}</span>
        </div>
        <div class="stat-item glass-panel">
          <span class="stat-label">Tiles Scanned:</span>
          <span class="stat-value">${gameState.tilesScanned}/25</span>
        </div>
        <div class="stat-item glass-panel">
          <span class="stat-label">Cargo:</span>
          <span class="stat-value">${gameState.cargo} (goal 3)</span>
        </div>
        <div class="stat-item glass-panel">
          <span class="stat-label">Battery:</span>
          <span class="stat-value">${gameState.battery} pts</span>
        </div>
        <div class="stat-item glass-panel">
          <span class="stat-label">Uplink:</span>
          <span class="stat-value">${gameState.uplink.used ? 'Used' : 'Not used'}</span>
        </div>
      </div>
      
      <div class="end-trace glass-panel">
        <h3>Trace (Last 5 Ticks)</h3>
        <div class="trace-list" id="trace-list">
          ${renderTrace()}
        </div>
        ${gameState.trace.length > 5 ? '<button id="show-more-trace" class="secondary-btn">Show more...</button>' : ''}
      </div>
      
      <div class="end-why glass-panel">
        <label for="why-note">Why do you think that happened?</label>
        <input type="text" id="why-note" placeholder="Optional note..." maxlength="200">
      </div>
      
      <div class="end-actions">
        <button id="rerun-btn" class="primary-btn glow-btn">Rerun</button>
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
      <span class="trace-battery">Battery: ${t.batteryAtStart ?? t.readings?.battery ?? t.battery}</span>
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
      <div class="log-header glass-panel">
        <h2>Run Log</h2>
        <span class="session-id">Session: ${session?.id || 'None'} ${session?.label ? `(${session.label})` : ''}</span>
      </div>
      
      <div class="log-summary glass-panel">
        <h3>Session Summary</h3>
        <div class="summary-stats">
          <div class="summary-item"><span>Total Runs:</span> <span>${runs.length}</span></div>
          <div class="summary-item"><span>Voluntary Reruns with Change:</span> <span>${voluntaryReruns}</span></div>
          <div class="summary-item"><span>Reruns without Change:</span> <span>${rerunsNoChange}</span></div>
          <div class="summary-item highlight"><span>3+ Voluntary Reruns:</span> <span>${voluntaryReruns >= 3 ? 'Yes ✓' : 'No'}</span></div>
        </div>
      </div>
      
      <div class="log-table-container glass-panel">
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
                <td>${r.tilesScanned}/25</td>
                <td class="log-cargo">${r.cargo} (goal 3)</td>
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
    if (!gameState || gameState.outcome) return;
    const tag = (e.target && e.target.tagName) || '';
    if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA' || e.target?.isContentEditable) {
      return;
    }
    
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
        setSpeed(4);
        break;
      case '3':
        e.preventDefault();
        setSpeed(16);
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
