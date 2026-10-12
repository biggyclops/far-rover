// Plain-words scout end lines, built from the paper trace.
// Does not change rule behavior — only the toast / View-trace copy.

import * as Sim from './engine.js';

const ACTION_LABEL = {
  [Sim.ACTIONS.EXPLORE]: 'Explore',
  [Sim.ACTIONS.RETURN_CHARGE]: 'Return and charge',
  [Sim.ACTIONS.SIDESTEP]: 'Sidestep',
  [Sim.ACTIONS.GO_TO_ORE]: 'Go to ore',
  [Sim.ACTIONS.DRILL]: 'Drill',
  [Sim.ACTIONS.WAIT]: 'Wait',
  [Sim.ACTIONS.NOTIFY]: 'Notify',
};

function tilesFromLander(col, row) {
  if (col == null || row == null) return 0;
  if (Sim.isOnLander(col, row)) return 0;
  return Math.abs(col - 5) + Math.abs(row - 12);
}

function lastActed(sim) {
  const trace = sim?.trace || [];
  for (let i = trace.length - 1; i >= 0; i--) {
    const tick = trace[i];
    if (tick?.ruleFired > 0) {
      const rule = (sim.rules || [])[tick.ruleFired - 1] || null;
      return { tick, rule, index: tick.ruleFired };
    }
  }
  return { tick: trace[trace.length - 1] || null, rule: null, index: 0 };
}

function actionLabel(rule, tick) {
  const type = rule?.action?.type;
  if (type && ACTION_LABEL[type]) return ACTION_LABEL[type];
  const reason = tick?.ruleReason || '';
  for (const label of Object.values(ACTION_LABEL)) {
    if (reason.includes(label)) return label;
  }
  return type || 'the top rule';
}

function goToOreMissed(rule, tick) {
  const type = rule?.action?.type;
  const ar = tick?.actionResult;
  if (type === Sim.ACTIONS.GO_TO_ORE && ar && !ar.moved && !ar.drilled) return true;
  if (ar?.reason === 'no ore nearby') return true;
  return /Go to ore: no ore nearby/i.test(tick?.ruleReason || '');
}

function rulesBelow(sim, index) {
  if (!index) return 0;
  let n = 0;
  for (let i = index; i < (sim.rules || []).length; i++) {
    const r = sim.rules[i];
    if (r?.condition && r?.action) n++;
  }
  return n;
}

function cellLabel(sim) {
  if (!sim) return 'a tile';
  if (Sim.isOnLander(sim.col, sim.row)) return 'the lander';
  return Sim.formatCell(sim.col, sim.row);
}

export function explainScoutResult(sim) {
  if (!sim?.outcome) return null;
  const last = lastActed(sim);
  const label = actionLabel(last.rule, last.tick);
  const cell = cellLabel(sim);
  const below = rulesBelow(sim, last.index);

  if (sim.outcome === Sim.OUTCOMES.LOST_CRATER) {
    const viaReturn = last.rule?.action?.type === Sim.ACTIONS.RETURN_CHARGE
      || /Return and charge/i.test(last.tick?.ruleReason || '');
    const extra = viaReturn
      ? ' Return and charge does not steer around craters. Try Crater in front + Sidestep before you drive.'
      : ' Try Crater in front + Sidestep before you drive.';
    return `Lost: drove into a crater at ${cell}.${extra}`;
  }

  if (sim.outcome === Sim.OUTCOMES.LOST_BATTERY) {
    const n = tilesFromLander(sim.col, sim.row);
    const where = n === 1
      ? '1 tile from the lander'
      : `${n} tiles from the lander`;
    return `Lost: battery ran out ${where}. Try a higher Return threshold.`;
  }

  if (sim.outcome === Sim.OUTCOMES.STUCK_CHARGE) {
    return 'Stuck: Return and charge fired without leaving the lander, so the rover charged in place. Try a condition that sends it out before Return.';
  }

  if (sim.outcome === Sim.OUTCOMES.STUCK_LOOP) {
    return `Stuck: the rover looped at ${cell}. Try a rule that makes new progress (Explore, or Notify only on ore), or move a Wait / Go to ore that keeps matching.`;
  }

  if (sim.outcome === Sim.OUTCOMES.STUCK_NO_MOVE || String(sim.outcome).startsWith('stuck')) {
    if (goToOreMissed(last.rule, last.tick)) {
      const tail = below > 0
        ? ' so the rules below it never got a turn. Try a condition that is only true near ore, or move it lower.'
        : ' so nothing else got a turn. Try a condition that is only true near ore, or move it lower.';
      return `Stuck: Go to ore fired but no ore was next to the rover,${tail}`;
    }
    if (!last.rule || last.index === 0 || /No rule matched/i.test(last.tick?.ruleReason || '')) {
      return 'Stuck: no rule was true, so the rover never moved. Try Always at the bottom so something always fires.';
    }
    if (last.rule?.action?.type === Sim.ACTIONS.WAIT || /Wait/i.test(last.tick?.ruleReason || '')) {
      return `Stuck: ${label} kept matching, so the rover never moved. Try a condition that is only true sometimes, or move it lower.`;
    }
    return `Stuck: ${label} kept matching at ${cell} and the rover never moved. Try a condition that is only true sometimes, or move it lower.`;
  }

  if (sim.outcome === Sim.OUTCOMES.ABORTED) {
    return `The run was ended early at ${cell}.`;
  }

  if (sim.outcome === Sim.OUTCOMES.SUCCESS_SCAN || sim.outcome === Sim.OUTCOMES.SUCCESS_ORE) {
    return sim.iceConfirmed ? 'Deep Ice confirmed' : 'trace only';
  }

  return `Returned at ${cell}, turn ${sim.tick}`;
}

export function renderTraceItems(sim) {
  const trace = sim?.trace || [];
  return trace.map((t) => {
    const cell = t.positionAfter
      ? (Sim.isOnLander(t.positionAfter.col, t.positionAfter.row)
        ? 'Lander'
        : Sim.formatCell(t.positionAfter.col, t.positionAfter.row))
      : '';
    const facing = t.facingAfter || '';
    const bat = t.batteryAtStart ?? t.readings?.battery ?? t.battery;
    return {
      tick: t.tick,
      cell,
      facing,
      battery: bat,
      reason: t.ruleReason || '',
    };
  });
}
