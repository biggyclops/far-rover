import assert from 'node:assert/strict';
import { createGame } from '../v08/game.js';
import { CONFIG as C } from '../v08/config.js';
import { explainScoutResult } from '../v08/scout-explain.js';
import { explainLiveTick } from '../v08/scout-live.js';
import * as Sim from '../v08/engine.js';
import { TUTORIAL_STARTER } from '../v08/tutorial.js';
import { hostedTickAndResume } from '../v08/hosted-tick.js';

function advance(game, seconds) {
  const step = 1 / 60;
  let left = seconds;
  while (left > 0) {
    const dt = Math.min(step, left);
    game.update(dt);
    left -= dt;
  }
}

{
  const g = createGame();
  const haulers = g.state.units.filter((u) => u.kind === 'hauler');
  assert.equal(haulers.length, 2);
  const dist = Math.hypot(haulers[0].x - haulers[1].x, haulers[0].y - haulers[1].y);
  assert.ok(dist > C.tileSize * 2.5, `starting haulers should stand apart (${dist})`);
  const hab = g.habitat();
  for (const u of haulers) {
    const { tx, ty } = g.worldToTile(u.x, u.y);
    const onPad = tx >= hab.tx && tx <= hab.tx + 1 && ty >= hab.ty && ty <= hab.ty + 1;
    assert.equal(onPad, false, 'hauler should not spawn on the habitat pad');
  }
  console.log('ok  r5 starting haulers are spaced off the pad');
}

{
  const g = createGame();
  g.state.buildGhost = { type: 'storage', tx: 22, ty: 21 };
  const a = g.placeBuilding('storage', 22, 21, false);
  assert.ok(a);
  assert.equal(g.state.buildGhost?.type, 'storage', 'tool stays armed after a place');
  const b = g.placeBuilding('storage', 24, 21, false);
  assert.ok(b);
  assert.equal(g.state.buildGhost?.type, 'storage');
  g.state.buildGhost = null;
  console.log('ok  r5 build tool stays armed after placement');
}

{
  const g = createGame();
  g.toastPickBuilding();
  assert.equal(g.state.toast?.text, 'Pick a building first');
  console.log('ok  r5 empty map click copy');
}

{
  const g = createGame();
  const p = g.placeBuilding('printer', 22, 21, false);
  assert.ok(p);
  g.completeBuilding(p.id);
  const before = g.haulerCount();
  assert.equal(g.startPrint(), true);
  advance(g, C.printerHaulerSeconds + 0.5);
  assert.equal(g.haulerCount(), before + 1);
  assert.equal(g.state.toast?.text, 'Hauler printed');
  console.log('ok  r5 hauler count and printed toast');
}

{
  const g = createGame();
  g.unlockDeepIce();
  const home = g.placeBuilding('tunnel-hub', 14, 21, false);
  const far = g.placeBuilding('tunnel-hub', 22, 21, false);
  assert.ok(home && far);
  assert.equal(g.hubsAligned(), true);
  g.completeBuilding(home.id);
  g.completeBuilding(far.id);
  const line = g.startDigLine(home.tx + 2, home.ty, far.tx - 1, far.ty);
  assert.ok(line);
  for (const t of g.state.tunnel.tiles) {
    t.started = true;
    t.progress = 1;
    t.done = true;
  }
  advance(g, 1 / 60);
  assert.ok(g.state.tunnel.tiles.every((t) => t.done));
  assert.equal(g.state.toast?.text, 'Tunnel complete');
  console.log('ok  r5 tunnel complete toast');
}

{
  const g = createGame();
  g.state.time = C.startDaylightRemainingSec + 1;
  assert.equal(g.isDay(), false);
  for (const b of g.state.buildings) {
    if (b.powerCap > 0) b.power = 4;
  }
  const msg = g.powerDeficitMessage();
  assert.match(msg, /need about \d+ more solar or storage/);
  const solar = g.placeBuilding('solar', C.habitatTileX - 4, C.habitatTileY + 4, false);
  assert.ok(solar);
  assert.equal(g.powerDeficitMessage(), null, 'deficit copy hides after the player acts');
  console.log('ok  r5 power deficit names the shortfall and does not repeat');
}

{
  const line = explainScoutResult({
    outcome: 'success-scan',
    iceConfirmed: false,
    col: 5,
    row: 12,
    tick: 46,
    rules: [],
    trace: [],
  });
  assert.match(line, /Trace ice only/);
  assert.match(line, /lower Return threshold/);
  assert.doesNotMatch(line, /Returned with/);
  const lost = explainScoutResult({
    outcome: 'lost-battery',
    iceConfirmed: true,
    col: 5,
    row: 3,
    tick: 40,
    rules: [],
    trace: [{ actionResult: { confirmedIce: true, cell: 'F2' } }],
  });
  assert.match(lost, /found Deep Ice but won't make it back/);
  assert.doesNotMatch(lost, /comes home|Returned with/);
  console.log('ok  r5 fallback copy');
}

{
  const sim = Sim.createInitialState(
    [Sim.SENSORS.DISTANCE, Sim.SENSORS.SPECTRAL, Sim.SENSORS.CAMERA],
    TUTORIAL_STARTER,
  );
  sim.charging = true;
  sim.battery = 11;
  sim.chargeTick = 1;
  const live = explainLiveTick(sim, {
    ruleFired: -1,
    battery: 11,
    batteryAtStart: 11,
    positionAfter: { col: 5, row: 12 },
    facingAfter: 'north',
  });
  assert.equal(live.reason, 'Charging (11/20)');
  assert.equal(live.sensors.charging, '11/20');
  console.log('ok  r5 charging copy');
}

{
  const sim = Sim.createInitialState(
    [Sim.SENSORS.DISTANCE, Sim.SENSORS.SPECTRAL, Sim.SENSORS.CAMERA],
    TUTORIAL_STARTER,
  );
  sim.col = 0;
  sim.row = 0;
  sim.battery = 4;
  sim.facing = 'north';
  const live = explainLiveTick(sim, {
    ruleFired: 4,
    battery: 4,
    positionAfter: { col: 0, row: 0 },
    facingAfter: 'north',
  });
  assert.equal(live.sensors.wontMakeItHome, true);
  assert.equal(live.sensors.facing, 'north');
  assert.ok(live.sensors.next);
  assert.equal(live.toast, "Won't make it home");
  console.log('ok  r5 facing, next tile, and won\'t-make-it-home');
}

{
  const sim = Sim.createInitialState(
    [Sim.SENSORS.DISTANCE, Sim.SENSORS.SPECTRAL, Sim.SENSORS.CAMERA],
    TUTORIAL_STARTER,
  );
  let notifyLive = null;
  let exploreLive = null;
  while (!sim.outcome && sim.tick < 80) {
    const result = hostedTickAndResume(sim);
    const live = explainLiveTick(sim, result.tickRecord);
    if (live.toast && /trace ice/.test(live.toast)) notifyLive = live;
    if (/nothing else true, so exploring/.test(live.reason)) exploreLive = live;
    if (notifyLive && exploreLive && notifyLive !== exploreLive) break;
  }
  assert.ok(notifyLive, 'starter still pings trace ice');
  assert.equal(notifyLive.fired, 3);
  assert.match(notifyLive.reason, /standing on ice/);
  assert.ok(exploreLive);
  assert.equal(exploreLive.fired, 4);
  assert.match(exploreLive.reason, /exploring/);
  assert.notEqual(exploreLive.reason, notifyLive.reason);
  console.log('ok  r5 Notify highlights on the ping tick and clears when Explore takes over');
}

console.log('ok  r5 UI/feedback suite');
