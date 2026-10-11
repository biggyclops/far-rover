// Headless scout expedition using the real hosted v08 tick (Notify option b).
// Mirrors v08/scout.js pump: runHostedScoutTick + queueNotifyPing. No DOM.
// Hazard auto-pauses are resumed here so an unattended run can reach F2/I2
// (the live page waits for the player to click Resume).

import * as Sim from '../engine.js';
import { runHostedScoutTick } from '../hosted-tick.js';

// Paper-map search: N=20 loops at F12 (start/restore battery is 20).
// N=5..8 confirm F2/I2; 8 is the highest. Confirms F2 on tick 17.
export const ICE_NOTIFY_PROGRAM = {
  sensors: ['distance', 'spectral'],
  rules: [
    { condition: { type: 'crater_in_front' }, action: { type: 'sidestep' } },
    { condition: { type: 'battery_below', n: 8 }, action: { type: 'return_charge' } },
    { condition: { type: 'on_ore' }, action: { type: 'notify' } },
    { condition: { type: 'always' }, action: { type: 'explore' } },
  ],
};

function handleNotify(game, result) {
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

export function attachScout(game, program = ICE_NOTIFY_PROGRAM) {
  let sim = null;
  let acc = 0;

  return {
    launched: () => !!sim,
    getSim: () => sim,
    launch() {
      if (sim) return sim;
      sim = Sim.createInitialState(program.sensors, program.rules);
      game.markExpeditionLaunched({ hasNotifyRule: true });
      return sim;
    },
    pump(dt) {
      if (!sim || game.state.expedition.ended || !game.state.expedition.launched) return;
      if (sim.outcome) return;
      acc += dt;
      while (acc >= 1 && sim && !sim.outcome) {
        acc -= 1;
        const result = runHostedScoutTick(sim);
        handleNotify(game, result);
        // Unattended resume: hosted Notify is a side effect, so keep
        // movement on the stripped rules after an auto-pause.
        if (result?.continueFromStep4 && result.autoPause) {
          const saved = sim.rules;
          sim.rules = (saved || []).filter((r) => r?.action?.type !== Sim.ACTIONS.NOTIFY);
          Sim.continueTickFromStep4(sim, result.tickRecord, result.tickRecord.readings || sim.readings);
          sim.rules = saved;
        }
      }
    },
  };
}
