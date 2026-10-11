// Headless scout expedition using the real v08 engine import (simulation.js).
// Mirrors v08/scout.js launch + pump + Notify → queueNotifyPing. No DOM.

import * as Sim from '../engine.js';

export const ICE_NOTIFY_PROGRAM = {
  sensors: ['distance', 'spectral'],
  rules: [
    { condition: { type: 'crater_in_front' }, action: { type: 'sidestep' } },
    { condition: { type: 'on_ore' }, action: { type: 'notify' } },
    { condition: { type: 'ore_next_to' }, action: { type: 'go_to_ore' } },
    { condition: { type: 'always' }, action: { type: 'explore' } },
  ],
};

function handleNotify(game, result) {
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

export function attachScout(game, program = ICE_NOTIFY_PROGRAM) {
  let sim = null;
  let acc = 0;

  return {
    launched: () => !!sim,
    getSim: () => sim,
    launch() {
      if (sim) return sim;
      sim = Sim.createInitialState(program.sensors, program.rules);
      game.markExpeditionLaunched();
      return sim;
    },
    pump(dt) {
      if (!sim || game.state.expedition.ended || !game.state.expedition.launched) return;
      if (sim.outcome) return;
      acc += dt;
      while (acc >= 1 && sim && !sim.outcome) {
        acc -= 1;
        let result = Sim.runTick(sim);
        handleNotify(game, result);
        if (result.continueFromStep4 && result.autoPause) {
          Sim.continueTickFromStep4(sim, result.tickRecord, result.tickRecord.readings || sim.readings);
          handleNotify(game, { tickRecord: sim.trace[sim.trace.length - 1] });
        }
      }
    },
  };
}
