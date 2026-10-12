// Live scout presentation. Does not change rule behavior — reasons, toasts,
// and sensor copy are derived from the existing paper trace.

import * as Sim from './engine.js';

export function liveFromTrace(sim) {
  const trace = sim?.trace || [];
  return explainLiveTick(sim, trace[trace.length - 1] || null);
}

export function explainLiveTick(sim, tick) {
  if (!sim) {
    return emptyLive();
  }
  const rec = tick || null;
  const fired = rec?.ruleFired ?? 0;
  const sensors = sensorsFrom(sim, rec);
  const dimmed = dimmedIndices(sim, rec);
  const reason = reasonFor(sim, rec);
  const narr = toastFor(sim, rec);
  return {
    fired,
    reason,
    dimmed,
    sensors,
    toast: narr?.toast || null,
    toastKey: narr?.toastKey || null,
    iceCell: narr?.iceCell || null,
    pose: {
      col: rec?.positionAfter?.col ?? sim.col,
      row: rec?.positionAfter?.row ?? sim.row,
      facing: rec?.facingAfter || sim.facing,
    },
  };
}

function setHas(set, value) {
  if (!value || !set) return false;
  if (typeof set.has === 'function') return set.has(value);
  if (Array.isArray(set)) return set.includes(value);
  return false;
}

export function shouldNarrate(prev, live) {
  if (!live?.toast || !live.toastKey) return false;
  if (live.iceCell) return !setHas(prev?.iceCells, live.iceCell);
  return !setHas(prev?.keys, live.toastKey);
}

function emptyLive() {
  return {
    fired: 0,
    reason: '',
    dimmed: [],
    sensors: { battery: null, inFront: '—', oreNearby: 'no', facing: '' },
    toast: null,
    toastKey: null,
    iceCell: null,
    pose: null,
  };
}

function sensorsFrom(sim, tick) {
  const readings = tick?.readings || sim?.readings || {};
  const battery = tick?.batteryAtStart ?? readings.battery ?? sim?.battery ?? null;
  return {
    battery,
    inFront: frontLabel(sim, tick),
    oreNearby: readings.oreNextTo?.detected ? 'yes' : 'no',
    facing: tick?.facingBefore || sim?.facing || '',
  };
}

function frontLabel(sim, tick) {
  const readings = tick?.readings || sim?.readings || {};
  if (readings.craterInFront?.detected) {
    return `crater (${readings.craterInFront.cell})`;
  }
  const facing = tick?.facingBefore || sim?.facing;
  const col = tick?.positionBefore?.col ?? sim?.col;
  const row = tick?.positionBefore?.row ?? sim?.row;
  if (col == null || row == null || !facing) return '—';
  const vec = Sim.DIR_VECTORS[facing];
  if (!vec) return '—';
  const fc = col + vec[0];
  const fr = row + vec[1];
  if (Sim.isOnLander(fc, fr) || fr === 12) return 'lander';
  if (fc < 0 || fc > 11 || fr < 0 || fr > 11) return 'map edge';
  const cell = Sim.formatCell(fc, fr);
  const terrain = sim?.terrain?.[fr]?.[fc];
  if (terrain === Sim.TERRAIN.CRATER) return `crater (${cell})`;
  if (terrain === Sim.TERRAIN.ORE) return `ice (${cell})`;
  if (terrain === Sim.TERRAIN.DUST) return `dust (${cell})`;
  return `open ground (${cell})`;
}

function dimmedIndices(sim, tick) {
  const fired = tick?.ruleFired;
  if (!(fired > 0)) return [];
  const readings = tick?.readings || sim?.readings || {};
  const dimmed = [];
  for (let i = 0; i < fired - 1; i++) {
    const rule = (sim.rules || [])[i];
    if (!rule?.condition || !rule?.action) continue;
    const truthy = Sim.evaluateCondition(rule.condition, sim, readings);
    if (!truthy) dimmed.push(i);
  }
  return dimmed;
}

function reasonFor(sim, tick) {
  if (!tick) return 'Waiting for the first turn.';
  const fired = tick.ruleFired;
  if (fired === -1) {
    return tick.ruleReason || 'Charging at the lander.';
  }
  if (!fired) {
    return tick.ruleReason || 'No rule was true, so the rover waited.';
  }
  const rule = (sim.rules || [])[fired - 1];
  if (!rule) return tick.ruleReason || `Rule ${fired} fired.`;
  const n = fired;
  const cond = rule.condition || {};
  const act = rule.action?.type;
  const readings = tick.readings || {};
  const battery = tick.batteryAtStart ?? readings.battery;

  if (cond.type === Sim.CONDITIONS.BATTERY_BELOW && act === Sim.ACTIONS.RETURN_CHARGE) {
    return `Rule ${n}: Battery ${battery} is below ${cond.n}, so heading home to charge.`;
  }
  if (cond.type === Sim.CONDITIONS.ALWAYS && act === Sim.ACTIONS.EXPLORE) {
    return `Rule ${n}: nothing else true, so exploring.`;
  }
  if (cond.type === Sim.CONDITIONS.CRATER_IN_FRONT && act === Sim.ACTIONS.SIDESTEP) {
    const cell = readings.craterInFront?.cell;
    return cell
      ? `Rule ${n}: crater ahead at ${cell}, so sidestepping.`
      : `Rule ${n}: crater ahead, so sidestepping.`;
  }
  if (cond.type === Sim.CONDITIONS.ALWAYS) {
    return `Rule ${n}: nothing else true, so ${plainAction(act)}.`;
  }
  if (cond.type === Sim.CONDITIONS.ON_ORE && act === Sim.ACTIONS.NOTIFY) {
    const cell = tick.actionResult?.cell;
    return cell
      ? `Rule ${n}: standing on ice at ${cell}, so notifying.`
      : `Rule ${n}: standing on ice, so notifying.`;
  }
  return tick.ruleReason || `Rule ${n} fired.`;
}

function plainAction(type) {
  if (type === Sim.ACTIONS.EXPLORE) return 'exploring';
  if (type === Sim.ACTIONS.SIDESTEP) return 'sidestepping';
  if (type === Sim.ACTIONS.RETURN_CHARGE) return 'heading home to charge';
  if (type === Sim.ACTIONS.WAIT) return 'waiting';
  if (type === Sim.ACTIONS.GO_TO_ORE) return 'going to ore';
  if (type === Sim.ACTIONS.DRILL) return 'drilling';
  if (type === Sim.ACTIONS.NOTIFY) return 'notifying';
  return type || 'acting';
}

function toastFor(sim, tick) {
  if (!tick) return null;
  const ping = tick.actionResult;
  if (ping?.ping && ping.cell && !ping.confirmedIce) {
    return {
      toast: `Scout: trace ice at ${ping.cell}, continuing`,
      toastKey: `trace-ice:${ping.cell}`,
      iceCell: ping.cell,
    };
  }
  if (ping?.ping && ping.cell && ping.confirmedIce) {
    return {
      toast: `Scout: ice confirmed at ${ping.cell}`,
      toastKey: `ice-confirm:${ping.cell}`,
      iceCell: ping.cell,
    };
  }
  const fired = tick.ruleFired;
  const rule = fired > 0 ? (sim.rules || [])[fired - 1] : null;
  const act = rule?.action?.type;
  if (act === Sim.ACTIONS.RETURN_CHARGE && ping?.charging) return null;
  if (act === Sim.ACTIONS.RETURN_CHARGE) {
    return { toast: 'Scout: battery low, heading home', toastKey: 'battery-home' };
  }
  if (act === Sim.ACTIONS.SIDESTEP) {
    const cell = tick.readings?.craterInFront?.cell || String(tick.tick);
    return { toast: 'Scout: crater ahead, sidestepping', toastKey: `sidestep:${cell}` };
  }
  return null;
}
