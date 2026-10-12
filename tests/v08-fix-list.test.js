// Headless coverage for the M1 fix-list + Player 2 v2 bugs.
import assert from 'node:assert/strict';
import { createGame, TILE } from '../v08/game.js';
import { CONFIG as C } from '../v08/config.js';
import * as Sim from '../v08/engine.js';
import {
  runHostedScoutTick,
  hostedNotifyMovementEqualsStripped,
} from '../v08/hosted-tick.js';
import { explainScoutResult } from '../v08/scout-explain.js';
import { runStrategy } from '../v08/balance/harness.js';
import { nearestLegalDrop } from '../v08/balance/placements.js';

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
  assert.equal(g.canPlace('storage', 2, 2), false);
  const near = g.placeBuilding('storage', 21, 18);
  assert.ok(near);
  g.completeBuilding(near.id);
  assert.equal(g.buildingInCommandRange(near), true);
  console.log('ok  storage-beside-ice exploit: out-of-range storage cannot be placed');
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
    { condition: { type: Sim.CONDITIONS.BATTERY_BELOW, n: 12 }, action: { type: Sim.ACTIONS.RETURN_CHARGE } },
    { condition: { type: Sim.CONDITIONS.ON_ORE }, action: { type: Sim.ACTIONS.NOTIFY } },
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
  assert.match(last.text, /Trace ice only/);
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
  assert.equal(C.haulerUpkeepPowerPerSec, 0.3);
  assert.equal(C.noRegolithMineRadiusTiles, 4);
  assert.equal(C.strandedCrawlTilesPerSecond, 0.25);
  assert.deepEqual(C.confirmDepositTiles, ['F2', 'I2']);
  assert.equal(C.startDaylightRemainingSec, 90);
  assert.equal(C.tunnelHubMinSeparationTiles, 6);
  assert.equal(C.deepIceTilesFromStartStorage, 22);
  console.log('ok  new config keys keep economy defaults');
}

function setupHomeTunnel(game) {
  game.selectUnits([game.state.units[0].id]);
  const home = game.placeBuilding('tunnel-hub', 14, 21);
  const far = game.placeBuilding('tunnel-hub', 22, 21);
  const vault = game.placeBuilding('vault', 11, 21);
  assert.ok(home && far && vault, 'tunnel buildings place');
  game.completeBuilding(home.id);
  game.completeBuilding(far.id);
  game.completeBuilding(vault.id);
  const tiles = game.startDigCorridor();
  assert.ok(tiles && tiles.length, 'corridor exists');
  game.markTunnelDone();
  assert.equal(game.tunnelReady(), true);
  return { home, far, vault, hab: game.habitat() };
}

{
  const g = createGame();
  const { home, vault, hab } = setupHomeTunnel(g);
  vault.ice = vault.iceCap;
  hab.ice = 20;
  home.ice = 0;
  home.outboundIce = 20;
  advance(g, 2);
  assert.equal(vault.ice, vault.iceCap);
  assert.ok(Math.abs(g.storedForGoal().ice - 170) < 1e-6, `vault stayed full, goal ${g.storedForGoal().ice}`);
  assert.ok((home.outboundIce || 0) < 1e-6, 'home hub does not keep outbound ice');
  console.log('ok  full vault is not pulled back into the home hub');
}

{
  const g = createGame();
  const { far, vault, hab } = setupHomeTunnel(g);
  vault.ice = vault.iceCap;
  hab.ice = 20;
  g.depositToBuilding(far.id, { ice: 20 });
  advance(g, 8);
  assert.equal(vault.ice, vault.iceCap);
  assert.ok(hab.ice + 1e-6 >= hab.iceCap, `overflow reached habitat ${hab.ice}/${hab.iceCap}`);
  assert.ok(g.storedForGoal().ice + 1e-6 >= C.goalIceInStorage, `goal ${g.storedForGoal().ice}`);
  console.log('ok  packet into a full vault overflows into habitat and scores 180');
}

{
  const g = createGame();
  assert.equal(g.isDay(), true);
  advance(g, 89);
  assert.equal(g.isDay(), true);
  advance(g, 2);
  assert.equal(g.isDay(), false);
  console.log('ok  Sol 1 starts with 90s of daylight');
}

{
  const g = createGame();
  g.selectUnits([g.state.units[0].id]);
  const first = g.placeBuilding('tunnel-hub', 14, 21);
  assert.ok(first);
  g.completeBuilding(first.id);
  assert.equal(g.canPlace('tunnel-hub', 17, 21), false);
  assert.equal(g.canPlace('tunnel-hub', 22, 21), true);
  console.log('ok  hubs need 6 tiles of separation');
}

{
  const g = createGame();
  const hab = g.habitat();
  hab.power = 0;
  const u = g.state.units[0];
  u.battery = 80;
  const before = { x: u.x, y: u.y };
  g.assignOrder([u], { type: 'go', x: u.x + C.tileSize * 3, y: u.y });
  advance(g, 2);
  const dist = Math.hypot(u.x - before.x, u.y - before.y);
  assert.ok(dist > C.tileSize, `hauler still drives at 0 power, moved ${dist.toFixed(1)}`);
  console.log('ok  0 power does not freeze haulers');
}

{
  const g = createGame();
  const shallow = g.tileAt(C.shallowIceTileX, C.shallowIceTileY);
  shallow.type = TILE.ICE_MINED;
  shallow.iceRemaining = 0;
  assert.match(g.goalBanner(), /DEEP ice deposit/);
  g.queueNotifyPing({ confirmed: false, kind: 'trace-ice', text: 'x' });
  advance(g, 2.1);
  const steps = g.objectiveProgress();
  assert.equal(steps.buildScout, false);
  assert.equal(g.state.deepIce.unlocked, false);
  assert.match(g.goalBanner(), /DEEP ice deposit/);
  g.unlockDeepIce();
  assert.equal(g.objectiveProgress().buildScout, true);
  assert.match(g.goalBanner(), /Haul Deep Ice home/);
  console.log('ok  Deep Ice goal ticks only on unlock, not trace ice');
}

{
  const g = createGame();
  const u = g.state.units[0];
  u._emptyAfterDrop = true;
  g.assignOrder([u], {
    type: 'haul',
    sourceTx: C.shallowIceTileX,
    sourceTy: C.shallowIceTileY,
    destBuildingId: g.habitat().id,
  });
  assert.equal(!!u._emptyAfterDrop, false);
  console.log('ok  assignOrder clears _emptyAfterDrop');
}

{
  const g = createGame();
  const ice = g.tileCenter(C.shallowIceTileX, C.shallowIceTileY);
  g.selectUnits(g.state.units.filter((u) => u.kind === 'hauler').map((u) => u.id));
  const ok = g.issueContextual(ice.x, ice.y);
  assert.equal(ok, true);
  const hauling = g.state.units.filter((u) => u.kind === 'hauler' && u.order?.type === 'haul');
  assert.equal(hauling.length, 2);
  console.log('ok  right-click orders every selected hauler');
}

{
  const g = createGame();
  const u = g.state.units[0];
  g.selectUnits([u.id]);
  const ice = g.tileCenter(C.shallowIceTileX, C.shallowIceTileY);
  assert.equal(g.issueContextual(ice.x, ice.y), true);
  assert.equal(u.order?.type, 'haul');
  const solar = g.placeBuilding('solar', C.habitatTileX - 4, C.habitatTileY + 4, true);
  assert.ok(solar, 'solar places for construction resume');
  assert.equal(u.order?.type, 'build');
  assert.equal(u.resumeOrder?.type, 'haul');
  assert.notEqual(g.unitTask(u), 'idle');
  g.completeBuilding(solar.id);
  advance(g, 1);
  assert.equal(u.order?.type, 'haul', 'hauler resumes the haul loop after the build');
  assert.notEqual(g.unitCard(u).task, 'idle');
  console.log('ok  hauler resumes haul after construction and card is not idle');
}

{
  const g = createGame();
  g.markExpeditionLaunched({ hasNotifyRule: true });
  g.endExpedition({ line: 'trace only', status: 'returned' });
  assert.equal(g.state.toast?.kind, 'scout-result');
  assert.match(g.state.toast.text, /trace only/);
  g.markExpeditionLaunched({ hasNotifyRule: true });
  assert.equal(g.state.toast, null, 'new launch does not replay the stale result toast');
  assert.equal(g.state.expedition.pendingPings.length, 0);
  assert.equal(g.state.expedition.scoutStatus, 'running');
  console.log('ok  new expedition clears the stale scout-result toast');
}

{
  const state = Sim.createInitialState(
    [Sim.SENSORS.SPECTRAL, Sim.SENSORS.DISTANCE],
    [
      { condition: { type: Sim.CONDITIONS.ORE_NEXT_TO }, action: { type: Sim.ACTIONS.GO_TO_ORE } },
      { condition: { type: Sim.CONDITIONS.ON_ORE }, action: { type: Sim.ACTIONS.NOTIFY } },
      { condition: { type: Sim.CONDITIONS.ALWAYS }, action: { type: Sim.ACTIONS.WAIT } },
    ],
  );
  state.col = 8;
  state.row = 2;
  state.facing = Sim.DIRECTIONS.NORTH;
  const first = runHostedScoutTick(state);
  assert.equal(first.tickRecord.actionResult?.drilled, true);
  assert.equal(state.iceConfirmed, false);
  assert.equal(state.drilled[1][8], false, 'I2 stays ore after the sample');
  const second = runHostedScoutTick(state);
  assert.equal(state.iceConfirmed, true);
  assert.equal(second.tickRecord.actionResult?.confirmedIce, true);
  console.log('ok  Go to ore drills I2 then Notify confirms on a later tick');
}

function runUntilOutcome(sensors, rules, place) {
  const state = Sim.createInitialState(sensors, rules);
  if (place) place(state);
  let guard = 0;
  while (!state.outcome && guard++ < 80) {
    Sim.runTick(state);
  }
  return state;
}

{
  const state = runUntilOutcome(
    [Sim.SENSORS.SPECTRAL],
    [
      { condition: { type: Sim.CONDITIONS.ALWAYS }, action: { type: Sim.ACTIONS.GO_TO_ORE } },
      { condition: { type: Sim.CONDITIONS.ALWAYS }, action: { type: Sim.ACTIONS.EXPLORE } },
    ],
    (s) => { s.col = 5; s.row = 11; s.facing = Sim.DIRECTIONS.NORTH; },
  );
  assert.equal(state.outcome, Sim.OUTCOMES.STUCK_NO_MOVE);
  const line = explainScoutResult(state);
  assert.match(line, /^Stuck: Go to ore fired but no ore was next to the rover/);
  assert.match(line, /rules below it never got a turn/);
  assert.match(line, /only true near ore|move it lower/);
  console.log('ok  stuck reason: Go to ore with no adjacent ore');
}

{
  const state = runUntilOutcome(
    [Sim.SENSORS.DISTANCE],
    [{ condition: { type: Sim.CONDITIONS.ALWAYS }, action: { type: Sim.ACTIONS.WAIT } }],
    (s) => { s.battery = 0; s.col = 5; s.row = 9; },
  );
  assert.equal(state.outcome, Sim.OUTCOMES.LOST_BATTERY);
  const line = explainScoutResult(state);
  assert.match(line, /^Lost: battery ran out \d+ tiles? from the lander/);
  assert.match(line, /higher Return threshold/);
  console.log('ok  lost reason: battery empty');
}

{
  const state = runUntilOutcome(
    [Sim.SENSORS.DISTANCE],
    [{ condition: { type: Sim.CONDITIONS.ALWAYS }, action: { type: Sim.ACTIONS.EXPLORE } }],
    (s) => { s.col = 5; s.row = 7; },
  );
  assert.equal(state.outcome, Sim.OUTCOMES.LOST_CRATER);
  const line = explainScoutResult(state);
  assert.match(line, /^Lost: drove into a crater/);
  assert.match(line, /Crater in front|Sidestep/);
  console.log('ok  lost reason: crater');
}

{
  const state = Sim.createInitialState(
    [Sim.SENSORS.DISTANCE],
    [{ condition: { type: Sim.CONDITIONS.ALWAYS }, action: { type: Sim.ACTIONS.RETURN_CHARGE } }],
  );
  state.col = 5;
  state.row = 12;
  state.leftLanderSinceCharge = false;
  state.chargeWithoutLeaving = true;
  const stuck = Sim.checkStuckConditions(state, false, false, false, {});
  state.outcome = stuck.outcome;
  state.endReason = stuck.reason;
  const line = explainScoutResult(state);
  assert.equal(state.outcome, Sim.OUTCOMES.STUCK_CHARGE);
  assert.match(line, /^Stuck: Return and charge fired without leaving the lander/);
  console.log('ok  stuck reason: charged without leaving');
}

{
  const state = {
    outcome: Sim.OUTCOMES.STUCK_LOOP,
    col: 2,
    row: 4,
    tick: 12,
    rules: [{ condition: { type: Sim.CONDITIONS.ALWAYS }, action: { type: Sim.ACTIONS.WAIT } }],
    trace: [{ tick: 12, ruleFired: 1, ruleReason: 'Rule 1: always → Wait: waiting', actionResult: { waited: true } }],
  };
  const line = explainScoutResult(state);
  assert.match(line, /^Stuck: the rover looped/);
  console.log('ok  stuck reason: loop');
}

{
  const state = {
    outcome: Sim.OUTCOMES.STUCK_NO_MOVE,
    col: 5,
    row: 12,
    tick: 3,
    rules: [],
    endReason: 'No rule was true, so the rover never moved.',
    trace: [{ tick: 3, ruleFired: 0, ruleReason: 'No rule matched: rover did nothing' }],
  };
  assert.match(explainScoutResult(state), /^Stuck: no rule was true/);
  console.log('ok  stuck reason: no rule true');
}

{
  const state = {
    outcome: Sim.OUTCOMES.ABORTED,
    col: 4,
    row: 4,
    tick: 8,
    rules: [],
    trace: [],
  };
  assert.match(explainScoutResult(state), /ended early/);
  console.log('ok  aborted reason string');
}

{
  const g = createGame();
  g.unlockDeepIce();
  const deep = g.state.deepIce;
  const hx = C.habitatTileX + 1;
  const hy = C.habitatTileY + 1;
  const euclid = Math.hypot(deep.tx - hx, deep.ty - hy);
  assert.ok(Math.abs(euclid - C.deepIceTilesFromStartStorage) < 1.25, `deep ice ${euclid.toFixed(2)} tiles from storage, config ${C.deepIceTilesFromStartStorage}`);
  assert.equal(g.tunnelSpeedMultiple(), 4);
  assert.match(g.tunnelPayoffText(), /4x faster than haulers/);
  assert.match(g.hubPayoffText(), /4x faster than haulers/);
  assert.match(g.iceHoverText(deep.tx, deep.ty), /4x faster than haulers/);
  console.log(`ok  Deep Ice at (${deep.tx},${deep.ty}) is ${euclid.toFixed(2)} tiles from storage; tunnel ${g.tunnelSpeedMultiple()}x`);
}

{
  const r = runStrategy('tunnel-1-digger', {}, { maxSeconds: 20 * 60, searchPlacements: false });
  assert.equal(r.won, true, `1-digger should win, ice=${r.ice} t=${r.time}`);
  assert.ok(r.ice + 1e-6 >= 180, `1-digger ice ${r.ice}`);
  assert.equal(r.logistics, 'tunnel');
  console.log(`ok  1-digger tunnel wins at ${r.winTimeLabel} (${r.ice} ice)`);
}

{
  const drop = nearestLegalDrop();
  assert.ok(Number.isFinite(drop.distance), 'expected a legal in-range storage or hub');
  assert.ok(drop.distance >= 10, `nearest legal drop is ${drop.distance.toFixed(2)} tiles from Deep Ice (need >= 10)`);
  console.log(`ok  nearest legal ${drop.type} at (${drop.at.tx},${drop.at.ty}) is ${drop.distance.toFixed(2)} tiles from Deep Ice`);
}

{
  const g = createGame();
  assert.equal(g.powerDeficit(), false, 'day start should not flag a deficit');
  g.state.time = C.startDaylightRemainingSec + 1;
  assert.equal(g.isDay(), false);
  assert.equal(g.powerDeficit(), false, 'a full night stock must not alert');
  for (const b of g.state.buildings) {
    if (b.powerCap > 0) b.power = 4;
  }
  assert.equal(g.powerDeficit(), true, 'falling stock that hits 0 before dawn should alert');
  for (const b of g.state.buildings) {
    if (b.powerCap > 0) b.power = 0;
  }
  assert.equal(g.powerDeficit(), true, 'zero stored power should alert');
  console.log('ok  power deficit only when falling-to-zero-before-dawn or at 0');
}

{
  const g = createGame();
  g.unlockDeepIce();
  const far = g.placeBuilding('tunnel-hub', C.expeditionTileX - 2, C.expeditionTileY, false)
    || g.placeBuilding('tunnel-hub', 35, 8, false);
  assert.ok(far, 'far hub places beside Deep Ice');
  g.completeBuilding(far.id);
  far.ice = 12;
  assert.equal(g.storedForGoal().ice, C.startIce, 'hub ice is not goal ice');
  assert.equal(g.transitIce().ice, 12);
  assert.ok(g.totals().ice >= C.startIce + 12);
  const success = { outcome: 'success-scan', iceConfirmed: true, col: 5, row: 1, tick: 20, rules: [], trace: [] };
  const trace = { outcome: 'success-scan', iceConfirmed: false, col: 5, row: 12, tick: 46, rules: [], trace: [] };
  assert.equal(explainScoutResult(success), 'Deep Ice confirmed');
  assert.equal(explainScoutResult(trace), 'trace only');
  console.log('ok  HUD ice matches the goal counter; hub ice is in transit');
}

console.log('v08 fix-list node tests passed');
