// Headless coverage for the M1 fix-list + Player 2 v2 bugs.
import assert from 'node:assert/strict';
import { createGame, TILE } from '../v08/game.js';
import { CONFIG as C } from '../v08/config.js';
import * as Sim from '../v08/engine.js';
import {
  runHostedScoutTick,
  hostedNotifyMovementEqualsStripped,
} from '../v08/hosted-tick.js';

function advance(game, seconds, step = 1 / 60) {
  let left = seconds;
  while (left > 0) {
    const dt = Math.min(step, left);
    game.update(dt);
    left -= dt;
  }
}

function iceTile(game) {
  return game.tileAt(C.shallowIceTileX, C.shallowIceTileY);
}

function scriptedHaul(game) {
  const u = game.state.units[0];
  const hab = game.habitat();
  game.assignOrder([u], {
    type: 'haul',
    sourceTx: C.shallowIceTileX,
    sourceTy: C.shallowIceTileY,
    destBuildingId: hab.id,
    phase: 'toSource',
  });
}

{
  const a = createGame();
  const b = createGame();
  scriptedHaul(a);
  scriptedHaul(b);
  const T = 36;
  advance(a, T, 1 / 60);
  advance(b, T, 16 / 60);
  const iceA = a.storedForGoal().ice;
  const iceB = b.storedForGoal().ice;
  const remA = iceTile(a).iceRemaining;
  const remB = iceTile(b).iceRemaining;
  const minedA = C.shallowIceAmount - remA;
  const minedB = C.shallowIceAmount - remB;
  assert.ok(Math.abs(a.state.time - b.state.time) < 1e-6, 'same simulated time');
  assert.ok(
    Math.abs(minedA - minedB) <= Math.max(0.25, minedA * 0.01),
    `1x vs 16x mined ice drifted: ${minedA.toFixed(3)} vs ${minedB.toFixed(3)}`,
  );
  assert.ok(
    Math.abs(iceA - iceB) <= Math.max(0.25, iceA * 0.01),
    `1x vs 16x stored ice drifted: ${iceA.toFixed(3)} vs ${iceB.toFixed(3)}`,
  );
  console.log(`ok  1x vs 16x haul (${minedA.toFixed(2)} mined, ${iceA.toFixed(2)} stored)`);
}

{
  const g = createGame();
  const u = g.state.units[0];
  g.setUnitPos = null;
  u.x = (C.shallowIceTileX + 0.5) * C.tileSize;
  u.y = (C.shallowIceTileY + 0.5) * C.tileSize;
  u.battery = 0;
  g.assignOrder([u], { type: 'charge', buildingId: g.habitat().id });
  const before = { x: u.x, y: u.y };
  advance(g, 2, 1 / 60);
  const dist = Math.hypot(u.x - before.x, u.y - before.y) / C.tileSize;
  assert.ok(dist > 0.2, `stranded hauler should crawl, moved ${dist.toFixed(3)} tiles`);
  assert.equal(u.blockedReason, 'Hauler stranded');
  assert.match(g.state.toast?.text || '', /Hauler stranded/);
  console.log('ok  0-battery crawl + Hauler stranded');
}

{
  const g = createGame();
  const t = g.tileAt(C.shallowIceTileX, C.shallowIceTileY);
  t.type = TILE.ICE_MINED;
  t.iceRemaining = 0;
  g.selectUnits([g.state.units[0].id]);
  const ok = g.issueContextual(
    (C.shallowIceTileX + 0.5) * C.tileSize,
    (C.shallowIceTileY + 0.5) * C.tileSize,
  );
  assert.equal(ok, false);
  assert.match(g.state.toast?.text || '', /Source empty/);
  console.log('ok  empty source ends the loop');
}

{
  const g = createGame();
  const hab = g.habitat();
  hab.ice = hab.iceCap;
  const u = g.state.units[0];
  u.cargo.ice = 8;
  u.order = {
    type: 'haul',
    sourceTx: C.shallowIceTileX,
    sourceTy: C.shallowIceTileY,
    destBuildingId: hab.id,
    phase: 'unload',
  };
  u.lastOrder = { ...u.order, phase: 'toSource' };
  u.x = (hab.tx + 1) * C.tileSize;
  u.y = (hab.ty + 2) * C.tileSize;
  const pos = { x: u.x, y: u.y };
  advance(g, 3, 1 / 60);
  assert.match(u.blockedReason || '', /full/i);
  const wandered = Math.hypot(u.x - pos.x, u.y - pos.y);
  assert.ok(wandered < C.tileSize * 0.6, `full dest should pause, wandered ${wandered.toFixed(1)}`);
  console.log('ok  full destination pauses');
}

{
  const g = createGame();
  const hx = C.habitatTileX;
  const hy = C.habitatTileY;
  assert.equal(g.inNoMineZone(hx, hy), true);
  assert.equal(g.inNoMineZone(hx + 3, hy), true);
  assert.equal(g.inNoMineZone(hx + 6, hy), false);
  const u = g.state.units[0];
  u.x = (hx + 0.5) * C.tileSize;
  u.y = (hy + 3.5) * C.tileSize;
  g.assignOrder([u], { type: 'mine', tx: hx, ty: hy + 1 });
  const before = u.cargo.regolith;
  advance(g, 2, 1 / 60);
  assert.equal(u.cargo.regolith, before);
  console.log('ok  no-regolith-mine radius');
}

{
  const g = createGame();
  const u = g.state.units[0];
  g.selectUnits([u.id]);
  let hits = 0;
  for (let i = 0; i < 11; i++) {
    g.state.armedOrder = 'mine';
    g.state.haulPick = null;
    const ox = (i % 3) * 10 - 10;
    const oy = Math.floor(i / 3) * 8 - 24;
    const ok = g.issueContextual(
      (C.shallowIceTileX + 0.5) * C.tileSize + ox,
      (C.shallowIceTileY + 0.5) * C.tileSize + oy,
    );
    if (ok) hits += 1;
    g.state.armedOrder = null;
  }
  assert.ok(hits >= 10, `armed first click succeeded ${hits}/11`);
  console.log(`ok  armed first click ${hits}/11`);
}

{
  const g = createGame();
  g.markExpeditionLaunched({ hasNotifyRule: false });
  g.endExpedition();
  assert.equal(g.canBuildScout(), true);
  assert.equal(g.canRecall(), false);
  const before = g.state.units.length;
  const rec = g.startRecall();
  assert.equal(rec, null);
  assert.equal(g.state.units.length, before);
  g.markExpeditionLaunched({ hasNotifyRule: true });
  const rec2 = g.startRecall();
  assert.equal(rec2?.recalled, true);
  assert.equal(g.state.units.length, before);
  assert.equal(g.canRecall(), false);
  console.log('ok  Build Scout relaunch + Recall does not spawn');
}

{
  const g = createGame();
  g.selectUnits([g.state.units[0].id]);
  const far = g.placeBuilding('storage', 2, 2);
  assert.ok(far);
  g.completeBuilding(far.id);
  far.ice = 80;
  assert.equal(g.buildingInCommandRange(far), false);
  assert.ok(g.storedForGoal().ice < 80);
  assert.equal(g.storedForGoal().ice, g.habitat().ice);
  console.log('ok  goal ice ignores out-of-range storage');
}

{
  const g = createGame();
  g.selectUnits([g.state.units[0].id]);
  const hub = g.placeBuilding('tunnel-hub', 14, 21);
  g.completeBuilding(hub.id);
  g.depositToBuilding(hub.id, { ice: 12 });
  const tot = g.totals();
  const goal = g.storedForGoal();
  const transit = g.transitIce();
  assert.ok(tot.ice > goal.ice);
  assert.ok(transit.ice >= 12 - 1e-6);
  console.log('ok  HUD goal ice excludes hub transit');
}

{
  const sensors = [Sim.SENSORS.DISTANCE, Sim.SENSORS.SPECTRAL, Sim.SENSORS.CAMERA];
  const hostedStarter = [
    { condition: { type: Sim.CONDITIONS.CRATER_IN_FRONT }, action: { type: Sim.ACTIONS.SIDESTEP } },
    { condition: { type: Sim.CONDITIONS.ON_ORE }, action: { type: Sim.ACTIONS.NOTIFY } },
    { condition: { type: Sim.CONDITIONS.ORE_NEXT_TO }, action: { type: Sim.ACTIONS.GO_TO_ORE } },
    { condition: { type: Sim.CONDITIONS.ALWAYS }, action: { type: Sim.ACTIONS.EXPLORE } },
  ];
  const moved = hostedNotifyMovementEqualsStripped(sensors, hostedStarter, 40);
  assert.equal(moved.fullCol, moved.strippedCol);
  assert.equal(moved.fullRow, moved.strippedRow);
  assert.equal(moved.fullOutcome, moved.strippedOutcome);
  console.log('ok  hosted Notify movement matches stripped rules');

  const starter = Sim.createInitialState(sensors, hostedStarter);
  let stuck = false;
  for (let i = 0; i < 80 && !starter.outcome; i++) {
    const r = runHostedScoutTick(starter);
    if (starter.outcome === Sim.OUTCOMES.STUCK_NO_MOVE) stuck = true;
    if (r?.tickRecord?.actionResult?.confirmedIce && !['F2', 'I2'].includes(r.tickRecord.actionResult.cell)) {
      assert.fail('starter Notify confirmed off the deposit tiles');
    }
  }
  assert.equal(stuck, false);
  assert.equal(!!starter.iceConfirmed, false);
  console.log('ok  starter Notify does not unlock Deep Ice and is never stuck');
}

{
  function notifyAt(cell) {
    const col = cell.charCodeAt(0) - 65;
    const row = parseInt(cell.slice(1), 10) - 1;
    const state = Sim.createInitialState([Sim.SENSORS.SPECTRAL], [
      { condition: { type: Sim.CONDITIONS.ON_ORE }, action: { type: Sim.ACTIONS.NOTIFY } },
      { condition: { type: Sim.CONDITIONS.ALWAYS }, action: { type: Sim.ACTIONS.WAIT } },
    ]);
    state.col = col;
    state.row = row;
    const r = runHostedScoutTick(state);
    return {
      confirmed: !!state.iceConfirmed,
      label: r.tickRecord.actionResult?.label,
      outcome: state.outcome,
    };
  }
  const trace = notifyAt('D11');
  assert.equal(trace.confirmed, false);
  assert.equal(trace.label, 'Trace ice');
  assert.notEqual(trace.outcome, Sim.OUTCOMES.STUCK_NO_MOVE);
  const hit = notifyAt('F2');
  assert.equal(hit.confirmed, true);
  assert.equal(hit.label, 'Ice deposit confirmed');
  assert.notEqual(hit.outcome, Sim.OUTCOMES.STUCK_NO_MOVE);
  console.log('ok  F2 confirms, D11 is trace ice, Notify never stuck');
}

{
  const g = createGame();
  g.queueNotifyPing({
    text: 'Trace ice at D11',
    confirmed: false,
    kind: 'trace-ice',
    label: 'Trace ice',
  });
  advance(g, 2.1);
  const last = g.state.expedition.log[g.state.expedition.log.length - 1];
  assert.equal(last.text, 'Trace ice at D11');
  assert.equal(last.kind, 'trace-ice');
  assert.equal(last.label, 'Trace ice');
  assert.equal(g.state.deepIce.unlocked, false);
  assert.match(g.state.toast?.text || '', /Trace ice/);
  assert.equal(g.state.toast?.kind, 'trace-ice');

  g.queueNotifyPing({
    text: 'Ice deposit confirmed at F2',
    confirmed: true,
    kind: 'ice-confirm',
    label: 'Ice deposit confirmed',
  });
  advance(g, 2.1);
  const hit = g.state.expedition.log[g.state.expedition.log.length - 1];
  assert.equal(hit.text, 'Ice deposit confirmed at F2');
  assert.equal(hit.kind, 'ice-confirm');
  assert.equal(g.state.deepIce.unlocked, true);
  console.log('ok  base log distinguishes Trace ice vs Ice deposit confirmed');
}

{
  const g = createGame();
  assert.match(g.goalBanner(), /Select haulers/);
  g.unlockDeepIce();
  assert.match(g.goalBanner(), new RegExp(`Haul Deep Ice home: \\d+ / ${C.goalIceInStorage}`));
  console.log('ok  goal banner follows the Deep Ice haul step');
}

{
  assert.equal(C.haulerUpkeepPowerPerSec, 0);
  assert.equal(C.noRegolithMineRadiusTiles, 4);
  assert.equal(C.strandedCrawlTilesPerSecond, 0.25);
  assert.deepEqual(C.confirmDepositTiles, ['F2', 'I2']);
  console.log('ok  new config keys keep economy defaults');
}

console.log('v08 fix-list node tests passed');
