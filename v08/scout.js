import * as Sim from './engine.js';
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
  let ready = false;
  let scoutAcc = 0;
  let lastSim = null;

  async function ensureReady() {
    if (ready) return;
    await prepareHostedScout();
    onScoutLaunch((sim) => {
      lastSim = sim;
      game.markExpeditionLaunched();
      hideOverlay();
      hooks.onLaunched?.(sim);
    });
    onScoutTick((result) => handleNotify(result));
    ready = true;
  }

  function hideOverlay() {
    stopOperateTicking();
    if (overlay) overlay.hidden = true;
    document.body.classList.remove('scout-open');
    removeDemoCss();
  }

  function showOverlay() {
    ensureDemoCss();
    if (overlay) overlay.hidden = false;
    document.body.classList.add('scout-open');
  }

  async function openBuild() {
    await ensureReady();
    showOverlay();
    showBuildScreen();
  }

  async function openOperate() {
    if (!lastSim && !getGameState()) return false;
    await ensureReady();
    if (!lastSim) lastSim = getGameState();
    showOverlay();
    showOperateView();
    stopOperateTicking();
    updateOperateView();
    return true;
  }

  function handleNotify(result) {
    const ar = result?.tickRecord?.actionResult;
    if (!ar?.notified || !ar.ping) return;
    const marker = game.state.expedition.marker;
    game.queueNotifyPing({
      tx: marker.tx,
      ty: marker.ty,
      text: ar.confirmedIce ? `Ice confirmed at ${ar.cell}` : `Notify: ice at ${ar.cell}`,
      confirmed: !!ar.confirmedIce,
    });
  }

  function applyIncomingPatch(ev) {
    if (!lastSim || !ev) return false;
    return Sim.applyPatch(lastSim, ev.slot, ev.condition, ev.action);
  }

  function pump(dt) {
    if (!lastSim || game.state.expedition.ended || !game.state.expedition.launched) return;
    if (lastSim.outcome) {
      const operateOpen = overlay && !overlay.hidden;
      if (operateOpen) updateOperateView();
      return;
    }
    const operateOpen = overlay && !overlay.hidden;
    const paused = operateOpen ? isOperatePaused() : false;
    const speed = operateOpen ? (getOperateSpeed() || 1) : 1;
    if (paused) {
      if (operateOpen) updateOperateView();
      return;
    }
    scoutAcc += dt * speed;
    while (scoutAcc >= 1 && lastSim && !lastSim.outcome) {
      scoutAcc -= 1;
      if (operateOpen) {
        runHostedTick();
        if (isOperatePaused() || lastSim.outcome) break;
        continue;
      }
      const result = Sim.runTick(lastSim);
      handleNotify(result);
      if (result.continueFromStep4 && result.autoPause) {
        Sim.continueTickFromStep4(lastSim, result.tickRecord, result.tickRecord.readings || lastSim.readings);
        handleNotify({ tickRecord: lastSim.trace[lastSim.trace.length - 1] });
      }
    }
    if (operateOpen) updateOperateView();
  }

  backBtn?.addEventListener('click', () => {
    hideOverlay();
  });

  overlay?.addEventListener('click', (ev) => {
    if (ev.target === overlay) hideOverlay();
  });

  function launchProgram(sensors, rules) {
    lastSim = Sim.createInitialState(sensors, rules);
    setGameStateForTest(lastSim);
    setSelectedSensorsForTest(sensors);
    setRulesForTest(rules);
    game.markExpeditionLaunched();
    return lastSim;
  }

  function tickScout(n = 1) {
    if (!lastSim) return null;
    let last = null;
    for (let i = 0; i < n; i++) {
      if (lastSim.outcome) break;
      last = Sim.runTick(lastSim);
      handleNotify(last);
      if (last.continueFromStep4 && last.autoPause) {
        last = Sim.continueTickFromStep4(lastSim, last.tickRecord, last.tickRecord.readings || lastSim.readings);
        handleNotify({ tickRecord: lastSim.trace[lastSim.trace.length - 1] });
      }
    }
    return last;
  }

  function confirmOnOre() {
    if (!lastSim) return false;
    const ores = Sim.TERRAIN_DATA.ores;
    const cell = ores[0];
    const col = cell.charCodeAt(0) - 65;
    const row = parseInt(cell.slice(1), 10) - 1;
    lastSim.col = col;
    lastSim.row = row;
    lastSim.rules = [
      { condition: { type: Sim.CONDITIONS.ON_ORE }, action: { type: Sim.ACTIONS.NOTIFY } },
      { condition: { type: Sim.CONDITIONS.ALWAYS }, action: { type: Sim.ACTIONS.WAIT } },
    ];
    const result = tickScout(1);
    return !!(result?.tickRecord?.actionResult?.confirmedIce || lastSim.iceConfirmed);
  }

  return {
    openBuild,
    openOperate,
    hideOverlay,
    pump,
    launchProgram,
    tickScout,
    confirmOnOre,
    applyIncomingPatch,
    handleNotify,
    getSim: () => lastSim,
    isOpen: () => overlay && !overlay.hidden,
  };
}
