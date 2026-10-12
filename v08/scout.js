import * as Sim from './engine.js';
import { CONFIG as C } from './config.js';
import { runHostedScoutTick } from './hosted-tick.js';
import { explainScoutResult, renderTraceItems } from './scout-explain.js';
import {
  showBuildScreen,
  prepareHostedScout,
  onScoutLaunch,
  onScoutTick,
  setSelectedSensorsForTest,
  setRulesForTest,
  showOperateView,
  updateOperateView,
  getGameState,
  setGameStateForTest,
  isOperatePaused,
  getOperateSpeed,
  stopOperateTicking,
  runHostedTick,
  recordHostedRunIfNeeded,
} from '../ui.js';

function ensureDemoCss() {
  if (document.getElementById('demo-operate-css')) return;
  const link = document.createElement('link');
  link.id = 'demo-operate-css';
  link.rel = 'stylesheet';
  link.href = new URL('../styles.css', import.meta.url).href;
  document.head.appendChild(link);
}

function removeDemoCss() {
  document.getElementById('demo-operate-css')?.remove();
}

export function bindScout(root, game, hooks = {}) {
  const overlay = root.querySelector('#scout-overlay');
  const backBtn = root.querySelector('#scout-back');
  const traceRoot = root.querySelector('#scout-trace');
  const hostRoot = root.querySelector('#game-container');
  let ready = false;
  let scoutAcc = 0;
  let lastSim = null;
  let savedBaseSpeed = null;

  async function ensureReady() {
    if (ready) return;
    await prepareHostedScout();
    onScoutLaunch((sim) => {
      lastSim = sim;
      game.markExpeditionLaunched({ hasNotifyRule: rulesHaveNotify(sim?.rules) });
      hideOverlay();
      hooks.onLaunched?.(sim);
    });
    onScoutTick((result) => handleNotify(result));
    ready = true;
  }

  function pauseBase() {
    if (savedBaseSpeed == null) savedBaseSpeed = game.state.speed;
    game.state.speed = 0;
  }

  function resumeBase() {
    if (savedBaseSpeed != null) {
      game.state.speed = savedBaseSpeed;
      savedBaseSpeed = null;
    }
  }

  function hideOverlay() {
    stopOperateTicking();
    if (overlay) overlay.hidden = true;
    if (traceRoot) traceRoot.hidden = true;
    document.body.classList.remove('scout-open');
    removeDemoCss();
    resumeBase();
  }

  function setOverlayTitle(text) {
    const el = overlay?.querySelector('#scout-overlay-title');
    if (el) el.textContent = text;
  }

  function retitleProgramPanel() {
    setOverlayTitle('Scout program');
    const h2 = hostRoot?.querySelector('.build-header h2');
    if (h2) h2.replaceChildren(document.createTextNode('Scout program'));
    const run = hostRoot?.querySelector('.run-indicator');
    if (run) run.hidden = true;
  }

  function showOverlay() {
    ensureDemoCss();
    if (overlay) overlay.hidden = false;
    document.body.classList.add('scout-open');
    pauseBase();
  }

  function showHosted() {
    if (traceRoot) traceRoot.hidden = true;
    if (hostRoot) hostRoot.hidden = false;
  }

  function paintTrace(sim) {
    if (!traceRoot) return;
    const line = explainScoutResult(sim) || resultLineFor(sim) || game.state.expedition.resultLine || 'Scout';
    const items = renderTraceItems(sim);
    const rows = items.length
      ? items.map((t) => `<li class="trace-item"><span class="trace-tick">Tick ${t.tick}</span><span class="trace-pos">${t.cell}${t.facing ? ` facing ${t.facing}` : ''}</span><span class="trace-battery">Battery: ${t.battery ?? ''}</span><span class="trace-reason"></span></li>`).join('')
      : '<li class="trace-item">No ticks recorded.</li>';
    traceRoot.innerHTML = `<div class="scout-trace-card"><h2></h2><ol class="trace-list" data-expanded="true">${rows}</ol><button type="button" id="relaunch-scout" class="relaunch-scout">Relaunch scout</button></div>`;
    const h2 = traceRoot.querySelector('h2');
    if (h2) h2.textContent = line;
    const reasons = traceRoot.querySelectorAll('.trace-reason');
    items.forEach((t, i) => {
      if (reasons[i]) reasons[i].textContent = t.reason || '';
    });
    traceRoot.querySelector('#relaunch-scout')?.addEventListener('click', (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      openBuild();
    });
    traceRoot.hidden = false;
    if (hostRoot) hostRoot.hidden = true;
  }

  function openTrace() {
    // Paper trace only — never the demo end/log screens (those mint a
    // new session ID and can look like a full base reset).
    if (!lastSim && getGameState()) lastSim = getGameState();
    showOverlay();
    setOverlayTitle('Scout expedition: trace');
    paintTrace(lastSim);
    stopOperateTicking();
    return true;
  }

  async function viewTrace() {
    if ((lastSim && lastSim.outcome) || game.state.expedition.ended) {
      return openTrace();
    }
    return openOperate();
  }

  async function openBuild() {
    await ensureReady();
    showOverlay();
    showHosted();
    showBuildScreen();
    retitleProgramPanel();
  }

  async function openOperate() {
    if (!lastSim && !getGameState()) return false;
    await ensureReady();
    if (!lastSim) lastSim = getGameState();
    if (lastSim?.outcome || game.state.expedition.ended) {
      return openTrace();
    }
    showOverlay();
    setOverlayTitle('Scout expedition: trace');
    showHosted();
    showOperateView();
    stopOperateTicking();
    updateOperateView();
    return true;
  }

  function handleNotify(result) {
    const pings = result?.hostedPings?.length
      ? result.hostedPings
      : (result?.tickRecord?.actionResult?.ping ? [result.tickRecord.actionResult] : []);
    if (!pings.length) return;
    const marker = game.state.expedition.marker;
    for (const ar of pings) {
      if (!ar?.notified || !ar.ping) continue;
      const label = ar.label || (ar.confirmedIce ? 'Ice deposit confirmed' : 'Trace ice');
      game.queueNotifyPing({
        tx: marker.tx,
        ty: marker.ty,
        text: `${label} at ${ar.cell}`,
        confirmed: !!ar.confirmedIce,
        kind: ar.kind || (ar.confirmedIce ? 'ice-confirm' : 'trace-ice'),
        label,
      });
    }
  }

  function applyIncomingPatch(ev) {
    if (!lastSim || !ev) return false;
    return Sim.applyPatch(lastSim, ev.slot, ev.condition, ev.action);
  }

  function paperSnapshot(sim, status) {
    if (!sim) return null;
    const path = (sim.trace || []).map((t) => ({
      col: t.col,
      row: t.row,
      tick: t.tick,
    }));
    const revealed = [];
    if (sim.revealed) {
      for (let r = 0; r < sim.revealed.length; r++) {
        for (let c = 0; c < (sim.revealed[r] || []).length; c++) {
          if (sim.revealed[r][c]) revealed.push({ col: c, row: r });
        }
      }
    }
    const pings = (sim.trace || [])
      .filter((t) => t.actionResult?.ping || t.actionResult?.notified)
      .map((t) => ({
        col: t.col,
        row: t.row,
        label: t.actionResult?.label || null,
        kind: t.actionResult?.kind || null,
      }));
    return { path, revealed, pings, tick: sim.tick || 0, status };
  }

  function resultLineFor(sim) {
    if (!sim?.outcome) return null;
    return explainScoutResult(sim);
  }

  function statusFor(sim) {
    if (!sim) return null;
    if (!sim.outcome) return 'running';
    if (sim.iceConfirmed) return 'returned';
    if (sim.outcome === Sim.OUTCOMES.LOST_CRATER || sim.outcome === Sim.OUTCOMES.LOST_BATTERY) return 'lost';
    if (String(sim.outcome).startsWith('stuck')) return 'stuck';
    return 'returned';
  }

  function finishIfNeeded() {
    if (!lastSim?.outcome || game.state.expedition.ended) {
      if (game.state.expedition.ended) recordHostedRunIfNeeded(lastSim);
      return;
    }
    const status = statusFor(lastSim);
    const line = resultLineFor(lastSim);
    game.updateScoutPaper(paperSnapshot(lastSim, status));
    game.endExpedition({ line, status, paper: paperSnapshot(lastSim, status) });
    recordHostedRunIfNeeded(lastSim);
  }

  function pump(dt) {
    if (!lastSim || game.state.expedition.ended || !game.state.expedition.launched) return;
    if (lastSim.outcome) {
      finishIfNeeded();
      const operateOpen = overlay && !overlay.hidden;
      if (operateOpen) openTrace();
      return;
    }
    const operateOpen = overlay && !overlay.hidden;
    scoutAcc += dt;
    while (scoutAcc >= 1 && lastSim && !lastSim.outcome) {
      scoutAcc -= 1;
      const result = runHostedScoutTick(lastSim);
      handleNotify(result);
      lastSim = getGameState() || lastSim;
      game.updateScoutPaper(paperSnapshot(lastSim, statusFor(lastSim)));
    }
    if (lastSim?.outcome) finishIfNeeded();
    if (operateOpen) updateOperateView();
  }

  backBtn?.addEventListener('click', () => {
    hideOverlay();
  });

  overlay?.addEventListener('click', (ev) => {
    if (ev.target === overlay) hideOverlay();
  });

  function rulesHaveNotify(list) {
    return (list || []).some((r) => (r?.action?.type || '') === 'notify');
  }

  function launchProgram(sensors, rules) {
    lastSim = Sim.createInitialState(sensors, rules);
    setGameStateForTest(lastSim);
    setSelectedSensorsForTest(sensors);
    setRulesForTest(rules);
    game.markExpeditionLaunched({ hasNotifyRule: rulesHaveNotify(rules) });
    return lastSim;
  }

  function tickScout(n = 1) {
    if (!lastSim) return null;
    let last = null;
    for (let i = 0; i < n; i++) {
      if (lastSim.outcome) break;
      last = runHostedScoutTick(lastSim);
      handleNotify(last);
    }
    if (lastSim?.outcome) finishIfNeeded();
    return last;
  }

  function playConfirmedThenLost() {
    if (!lastSim) {
      lastSim = Sim.createInitialState([Sim.SENSORS.SPECTRAL, Sim.SENSORS.DISTANCE], [
        { condition: { type: Sim.CONDITIONS.ON_ORE }, action: { type: Sim.ACTIONS.NOTIFY } },
        { condition: { type: Sim.CONDITIONS.ALWAYS }, action: { type: Sim.ACTIONS.EXPLORE } },
      ]);
      setGameStateForTest(lastSim);
      setSelectedSensorsForTest([Sim.SENSORS.SPECTRAL, Sim.SENSORS.DISTANCE]);
      setRulesForTest(lastSim.rules);
      game.markExpeditionLaunched({ hasNotifyRule: true });
    }
    pingOreCell('F2');
    lastSim.iceConfirmed = true;
    lastSim.col = 5;
    lastSim.row = 3;
    lastSim.outcome = Sim.OUTCOMES.LOST_BATTERY;
    lastSim.trace = lastSim.trace || [];
    const hasConfirm = lastSim.trace.some((t) => t?.actionResult?.confirmedIce);
    if (!hasConfirm) {
      lastSim.trace.push({ actionResult: { confirmedIce: true, cell: 'F2' } });
    }
    lastSim.lastNotify = { confirmedIce: true, cell: 'F2' };
    if (game.state.expedition.ended) game.state.expedition.ended = false;
    finishIfNeeded();
    openTrace();
    return { line: resultLineFor(lastSim), status: statusFor(lastSim) };
  }

  function playTraceOnlyReturn() {
    if (!lastSim) {
      lastSim = Sim.createInitialState([Sim.SENSORS.SPECTRAL, Sim.SENSORS.DISTANCE], [
        { condition: { type: Sim.CONDITIONS.ON_ORE }, action: { type: Sim.ACTIONS.NOTIFY } },
        { condition: { type: Sim.CONDITIONS.ALWAYS }, action: { type: Sim.ACTIONS.EXPLORE } },
      ]);
      setGameStateForTest(lastSim);
      setSelectedSensorsForTest([Sim.SENSORS.SPECTRAL, Sim.SENSORS.DISTANCE]);
      setRulesForTest(lastSim.rules);
      game.markExpeditionLaunched({ hasNotifyRule: true });
    }
    pingOreCell('D11');
    lastSim.iceConfirmed = false;
    lastSim.goalMet = true;
    lastSim.col = 5;
    lastSim.row = 12;
    lastSim.outcome = Sim.OUTCOMES.SUCCESS_SCAN;
    finishIfNeeded();
    return { line: resultLineFor(lastSim), status: statusFor(lastSim) };
  }

  function confirmOnOre() {
    return !!pingOreCell((C.confirmDepositTiles && C.confirmDepositTiles[0]) || 'F2').confirmed;
  }

  function pingOreCell(cell) {
    if (!lastSim) {
      lastSim = Sim.createInitialState([Sim.SENSORS.SPECTRAL, Sim.SENSORS.DISTANCE], [
        { condition: { type: Sim.CONDITIONS.ON_ORE }, action: { type: Sim.ACTIONS.NOTIFY } },
        { condition: { type: Sim.CONDITIONS.ALWAYS }, action: { type: Sim.ACTIONS.EXPLORE } },
      ]);
      setGameStateForTest(lastSim);
      setSelectedSensorsForTest([Sim.SENSORS.SPECTRAL, Sim.SENSORS.DISTANCE]);
      setRulesForTest(lastSim.rules);
      game.markExpeditionLaunched({ hasNotifyRule: true });
    }
    const col = cell.charCodeAt(0) - 65;
    const row = parseInt(cell.slice(1), 10) - 1;
    lastSim.col = col;
    lastSim.row = row;
    lastSim.notifySeen = lastSim.notifySeen || {};
    delete lastSim.notifySeen[`${col},${row}`];
    const hasNotify = (lastSim.rules || []).some((r) => r?.action?.type === Sim.ACTIONS.NOTIFY);
    if (!hasNotify) {
      lastSim.rules = [
        { condition: { type: Sim.CONDITIONS.ON_ORE }, action: { type: Sim.ACTIONS.NOTIFY } },
        { condition: { type: Sim.CONDITIONS.ALWAYS }, action: { type: Sim.ACTIONS.EXPLORE } },
      ];
    }
    const result = tickScout(1);
    if (lastSim?.outcome) finishIfNeeded();
    const ar = result?.tickRecord?.actionResult || {};
    return {
      confirmed: !!(ar.confirmedIce || lastSim.iceConfirmed),
      label: ar.label || null,
      cell: ar.cell || cell,
      ping: !!ar.ping,
      outcome: lastSim.outcome,
    };
  }

  return {
    openBuild,
    openOperate,
    openTrace,
    viewTrace,
    hideOverlay,
    playTraceOnlyReturn,
    playConfirmedThenLost,
    explainResult: (sim) => explainScoutResult(sim || lastSim),
    pump,
    launchProgram,
    tickScout,
    confirmOnOre,
    pingOreCell,
    applyIncomingPatch,
    handleNotify,
    getSim: () => lastSim,
    isOpen: () => overlay && !overlay.hidden,
  };
}
