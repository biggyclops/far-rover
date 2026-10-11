import * as Sim from './engine.js';
import { CONFIG as C } from './config.js';

function cellOf(state) {
  return Sim.isOnLander(state.col, state.row) ? 'Lander' : Sim.formatCell(state.col, state.row);
}

function onOre(state) {
  const row = state.terrain[state.row];
  return !!(row && row[state.col] === Sim.TERRAIN.ORE);
}

function isConfirmDeposit(cell) {
  return (C.confirmDepositTiles || []).includes(cell);
}

function applyNotifySideEffects(state) {
  const readings = Sim.computeReadings(state);
  const pings = [];
  (state.rules || []).forEach((rule, i) => {
    if (!rule?.condition || !rule?.action || rule.action.type !== Sim.ACTIONS.NOTIFY) return;
    if (!Sim.evaluateCondition(rule.condition, state, readings)) return;
    if (!onOre(state)) return;
    const key = `${state.col},${state.row}`;
    if (state.notifySeen[key]) return;
    state.notifySeen[key] = true;
    state.notifyCount = (state.notifyCount || 0) + 1;
    const cell = cellOf(state);
    const confirm = isConfirmDeposit(cell);
    if (confirm) state.iceConfirmed = true;
    pings.push({
      notified: true,
      ping: true,
      confirmedIce: confirm,
      cell,
      label: confirm ? 'Ice deposit confirmed' : 'Trace ice',
      kind: confirm ? 'ice-confirm' : 'trace-ice',
      slot: i + 1,
    });
  });
  return pings;
}

function stripNotifyRules(rules) {
  return (rules || []).map((r) => (
    r?.action?.type === Sim.ACTIONS.NOTIFY ? null : r
  ));
}

export function runHostedScoutTick(state, previouslyRevealed = null) {
  const pings = applyNotifySideEffects(state);
  const saved = state.rules;
  state.rules = stripNotifyRules(saved);
  const result = Sim.runTick(state, previouslyRevealed);
  state.rules = saved;
  if (pings.length) {
    const ping = pings[0];
    result.hostedPings = pings;
    result.tickRecord.actionResult = {
      ...(result.tickRecord.actionResult || {}),
      ...ping,
    };
    if (result.tickRecord.ruleReason && !result.tickRecord.ruleReason.includes('Notify')) {
      result.tickRecord.ruleReason += ` · ${ping.label} at ${ping.cell}`;
    }
  }
  return result;
}

export function hostedNotifyMovementEqualsStripped(sensors, rules, ticks = 20) {
  const full = Sim.createInitialState(sensors, rules);
  const stripped = Sim.createInitialState(sensors, stripNotifyRules(rules));
  let a = null;
  let b = null;
  for (let i = 0; i < ticks; i++) {
    if (!full.outcome) a = runHostedScoutTick(full);
    if (!stripped.outcome) b = Sim.runTick(stripped);
  }
  return {
    fullCol: full.col,
    fullRow: full.row,
    strippedCol: stripped.col,
    strippedRow: stripped.row,
    fullOutcome: full.outcome,
    strippedOutcome: stripped.outcome,
    lastFull: a,
    lastStripped: b,
  };
}
