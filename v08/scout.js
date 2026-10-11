import * as Sim from './engine.js';
import { CONFIG as C } from './config.js';
import { runHostedScoutTick } from './hosted-tick.js';
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
  let ready = false;
  let scoutAcc = 0;
  let lastSim = null;

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
    const cell = Sim.isOnLander(sim.col, sim.row) ? 'Lander' : Sim.formatCell(sim.col, sim.row);
    const turn = sim.tick;
    if (sim.hostedResultLine) return sim.hostedResultLine;
    if (sim.outcome === Sim.OUTCOMES.LOST_CRATER) {
      return `Lost at ${cell}, turn ${turn}: drove into a crater`;
    }
    if (sim.outcome === Sim.OUTCOMES.LOST_BATTERY) {
      return `Lost at ${cell}, turn ${turn}: battery empty`;
    }
    if (sim.outcome === Sim.OUTCOMES.STUCK_LOOP || sim.outcome === Sim.OUTCOMES.STUCK_CHARGE || sim.outcome === Sim.OUTCOMES.STUCK_NO_MOVE) {
      return 'Stuck';
    }
    if (sim.outcome === Sim.OUTCOMES.SUCCESS_SCAN || sim.outcome === Sim.OUTCOMES.SUCCESS_ORE) {
      return sim.iceConfirmed ? 'Returned' : 'Returned, trace ice only';
    }
    return `Returned at ${cell}, turn ${turn}`;
  }

  function statusFor(sim) {
    if (!sim) return null;
    if (!sim.outcome) return 'running';
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
      if (operateOpen) updateOperateView();
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
    hideOverlay,
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
