import { test, expect } from '@playwright/test';

const V08 = 'http://localhost:8080/v08/';

async function ready(page) {
  await page.goto(V08);
  await page.waitForFunction(() => window.__v08Test && window.__v08Test.ready);
}

test.describe('Far Rover v0.8 M1', () => {
  test('loads the base with starting stock', async ({ page }) => {
    await ready(page);
    const s = await page.evaluate(() => window.__v08Test.getState());
    expect(Math.floor(s.ice)).toBe(20);
    expect(Math.floor(s.regolith)).toBe(80);
    expect(Math.floor(s.power)).toBe(100);
    expect(s.unitCount).toBe(2);
    expect(s.isDay).toBe(true);
    await expect(page.locator('#res-ice')).toContainText('20');
    await expect(page.locator('#res-regolith')).toContainText('80');
    await expect(page.locator('#res-power')).toContainText('100');
  });

  test('click selects a hauler', async ({ page }) => {
    await ready(page);
    const pos = await page.evaluate(() => {
      const s = window.__v08Test.getState();
      return window.__v08Test.unitClientPos(s.units[0].id);
    });
    await page.mouse.click(pos.x, pos.y);
    const s = await page.evaluate(() => window.__v08Test.getState());
    expect(s.selectedIds.length).toBe(1);
  });

  test('drag-select selects both haulers', async ({ page }) => {
    await ready(page);
    const box = await page.evaluate(() => {
      const s = window.__v08Test.getState();
      const a = window.__v08Test.unitClientPos(s.units[0].id);
      const b = window.__v08Test.unitClientPos(s.units[1].id);
      return {
        x0: Math.min(a.x, b.x) - 30,
        y0: Math.min(a.y, b.y) - 30,
        x1: Math.max(a.x, b.x) + 30,
        y1: Math.max(a.y, b.y) + 30,
      };
    });
    await page.mouse.move(box.x0, box.y0);
    await page.mouse.down();
    await page.mouse.move(box.x1, box.y1, { steps: 8 });
    await page.mouse.up();
    const s = await page.evaluate(() => window.__v08Test.getState());
    expect(s.selectedIds.length).toBe(2);
  });

  test('shift-click adds to the selection', async ({ page }) => {
    await ready(page);
    const ids = await page.evaluate(() => window.__v08Test.getState().units.map((u) => u.id));
    await page.evaluate((id) => window.__v08Test.selectUnits([id]), ids[0]);
    const pos = await page.evaluate((id) => window.__v08Test.unitClientPos(id), ids[1]);
    await page.keyboard.down('Shift');
    await page.mouse.click(pos.x, pos.y);
    await page.keyboard.up('Shift');
    const s = await page.evaluate(() => window.__v08Test.getState());
    expect(s.selectedIds.length).toBe(2);
  });

  test('Go order moves a hauler', async ({ page }) => {
    await ready(page);
    const before = await page.evaluate(() => {
      const s = window.__v08Test.getState();
      window.__v08Test.selectUnits([s.units[0].id]);
      const dest = window.__v08Test.config.tileSize * 22;
      window.__v08Test.issueOrder({ type: 'go', x: dest, y: dest });
      return { x: s.units[0].x, y: s.units[0].y };
    });
    await page.evaluate(() => window.__v08Test.advance(4));
    const after = await page.evaluate(() => window.__v08Test.getState().units[0]);
    expect(Math.hypot(after.x - before.x, after.y - before.y)).toBeGreaterThan(40);
  });

  test('Mine order fills ice cargo', async ({ page }) => {
    await ready(page);
    await page.evaluate(() => {
      const s = window.__v08Test.getState();
      const C = window.__v08Test.config;
      window.__v08Test.selectUnits([s.units[0].id]);
      window.__v08Test.issueOrder({ type: 'mine', tx: C.shallowIceTileX, ty: C.shallowIceTileY });
      window.__v08Test.advance(20);
    });
    const s = await page.evaluate(() => window.__v08Test.getState());
    expect(s.units[0].cargo.ice).toBeGreaterThan(0);
  });

  test('Build order constructs storage and plays the -build path', async ({ page }) => {
    await ready(page);
    const result = await page.evaluate(() => {
      const s = window.__v08Test.getState();
      window.__v08Test.selectUnits([s.units[0].id]);
      const b = window.__v08Test.placeBuilding('storage', 21, 18);
      window.__v08Test.advance(16);
      const after = window.__v08Test.getState();
      const built = after.buildings.find((x) => x.id === b.id);
      return { placed: !!b, complete: built.complete, type: built.type };
    });
    expect(result.placed).toBe(true);
    expect(result.complete).toBe(true);
    expect(result.type).toBe('storage');
  });

  test('Haul order loops ice to the habitat', async ({ page }) => {
    await ready(page);
    const result = await page.evaluate(() => {
      const s0 = window.__v08Test.getState();
      const C = window.__v08Test.config;
      const hab = s0.buildings.find((b) => b.type === 'habitat');
      window.__v08Test.selectUnits([s0.units[0].id]);
      window.__v08Test.issueOrder({
        type: 'haul',
        sourceTx: C.shallowIceTileX,
        sourceTy: C.shallowIceTileY,
        destBuildingId: hab.id,
        phase: 'toSource',
      });
      window.__v08Test.advance(40);
      const mid = window.__v08Test.getState();
      window.__v08Test.advance(30);
      const end = window.__v08Test.getState();
      return {
        iceAfter: end.ice,
        iceStart: s0.ice,
        last: end.units[0].lastOrder,
        phase: end.units[0].phase,
        cargoMid: mid.units[0].cargo.ice,
      };
    });
    expect(result.iceAfter).toBeGreaterThan(result.iceStart);
    expect(result.last).toBe('haul');
  });

  test('repeat-last-order keeps the haul loop running', async ({ page }) => {
    await ready(page);
    const result = await page.evaluate(() => {
      const s0 = window.__v08Test.getState();
      const C = window.__v08Test.config;
      const hab = s0.buildings.find((b) => b.type === 'habitat');
      window.__v08Test.selectUnits([s0.units[0].id]);
      window.__v08Test.issueOrder({
        type: 'haul',
        sourceTx: C.shallowIceTileX,
        sourceTy: C.shallowIceTileY,
        destBuildingId: hab.id,
      });
      window.__v08Test.advance(80);
      const end = window.__v08Test.getState();
      return { last: end.units[0].lastOrder, order: end.units[0].order, ice: end.ice };
    });
    expect(result.last).toBe('haul');
    expect(result.order).toBe('haul');
    expect(result.ice).toBeGreaterThan(20);
  });

  test('Return/Charge restores battery at the habitat', async ({ page }) => {
    await ready(page);
    const result = await page.evaluate(() => {
      const s = window.__v08Test.getState();
      const hab = s.buildings.find((b) => b.type === 'habitat');
      window.__v08Test.setBattery(s.units[0].id, 20);
      window.__v08Test.selectUnits([s.units[0].id]);
      window.__v08Test.issueOrder({ type: 'charge', buildingId: hab.id });
      window.__v08Test.advance(12);
      return window.__v08Test.getState().units[0].battery;
    });
    expect(result).toBeGreaterThan(40);
  });

  test('solar output drops to 0 at night', async ({ page }) => {
    await ready(page);
    const result = await page.evaluate(() => {
      window.__v08Test.setResources({ power: 50 });
      window.__v08Test.setTime(window.__v08Test.config.daySecondsAt1x + 1);
      const night = window.__v08Test.getState();
      window.__v08Test.advance(2);
      const afterNight = window.__v08Test.getState();
      window.__v08Test.setTime(10);
      window.__v08Test.setResources({ power: 50 });
      const day = window.__v08Test.getState();
      window.__v08Test.advance(2);
      const afterDay = window.__v08Test.getState();
      return {
        nightOut: night.solarOutput,
        isNight: night.isNight,
        powerNight: afterNight.power,
        dayOut: day.solarOutput,
        powerDay: afterDay.power,
      };
    });
    expect(result.isNight).toBe(true);
    expect(result.nightOut).toBe(0);
    expect(result.powerNight).toBeCloseTo(50, 0);
    expect(result.dayOut).toBe(5);
    expect(result.powerDay).toBeGreaterThan(55);
  });

  test('importing the engine through /v08 leaves 5/46/45 unchanged', async ({ page }) => {
    await ready(page);
    const check = await page.evaluate(async () => {
      const { assertLiveTicksUnchanged } = await import('./engine-check.js');
      return assertLiveTicksUnchanged();
    });
    expect(check.ok).toBe(true);
    expect(check.results.scenarioG.tick).toBe(5);
    expect(check.results.starterCamera.tick).toBe(46);
    expect(check.results.starterDust.tick).toBe(45);
  });

  test('mute toggle is present', async ({ page }) => {
    await ready(page);
    await page.click('#mute-btn');
    const muted = await page.evaluate(() => window.__v08Test.getState().muted);
    expect(muted).toBe(true);
  });
});

test.describe('Far Rover v0.8 M2', () => {
  test('default zoom makes a hauler easy to click', async ({ page }) => {
    await ready(page);
    const info = await page.evaluate(() => {
      const s = window.__v08Test.getState();
      const C = window.__v08Test.config;
      const pos = window.__v08Test.unitClientPos(s.units[0].id);
      return {
        zoom: s.zoom,
        spritePx: C.tileSize * s.zoom,
        clickPx: C.unitClickRadius * s.zoom,
        pos,
      };
    });
    expect(info.zoom).toBeGreaterThanOrEqual(1);
    expect(info.spritePx).toBeGreaterThanOrEqual(64);
    expect(info.clickPx).toBeGreaterThanOrEqual(32);
  });

  test('tunnel hub builds for 20 regolith in 10 s', async ({ page }) => {
    await ready(page);
    const result = await page.evaluate(() => {
      const s0 = window.__v08Test.getState();
      window.__v08Test.selectUnits([s0.units[0].id]);
      const b = window.__v08Test.placeBuilding('tunnel-hub', 14, 21);
      window.__v08Test.advance(16);
      const after = window.__v08Test.getState();
      const built = after.buildings.find((x) => x.id === b.id);
      return {
        placed: !!b,
        complete: built.complete,
        type: built.type,
        regSpent: s0.regolith - after.regolith,
        buildNeeded: window.__v08Test.config.tunnelHubBuildSeconds,
      };
    });
    expect(result.placed).toBe(true);
    expect(result.complete).toBe(true);
    expect(result.type).toBe('tunnel-hub');
    expect(result.regSpent).toBe(20);
    expect(result.buildNeeded).toBe(10);
  });

  test('one rover digs a tile in 6 s; two dig twice as fast', async ({ page }) => {
    await ready(page);
    const result = await page.evaluate(() => {
      const C = window.__v08Test.config;
      const s0 = window.__v08Test.getState();
      const center = (tx, ty) => ({
        x: (tx + 0.5) * C.tileSize,
        y: (ty + 0.5) * C.tileSize,
      });
      const spot = center(10, 10);

      window.__v08Test.startDigLine(10, 10, 10, 10);
      window.__v08Test.setUnitPos(s0.units[0].id, spot.x, spot.y);
      window.__v08Test.selectUnits([s0.units[0].id]);
      window.__v08Test.issueOrder({ type: 'dig' });
      window.__v08Test.advance(5.5);
      const oneEarly = window.__v08Test.getState().tunnel.tiles[0];
      window.__v08Test.advance(0.7);
      const oneDone = window.__v08Test.getState().tunnel.tiles[0];

      window.__v08Test.startDigLine(11, 10, 11, 10);
      const spot2 = center(11, 10);
      window.__v08Test.setUnitPos(s0.units[0].id, spot2.x, spot2.y);
      window.__v08Test.setUnitPos(s0.units[1].id, spot2.x, spot2.y);
      window.__v08Test.selectUnits([s0.units[0].id, s0.units[1].id]);
      window.__v08Test.issueOrder({ type: 'dig' });
      window.__v08Test.advance(2.8);
      const twoEarly = window.__v08Test.getState().tunnel.tiles[0];
      window.__v08Test.advance(0.5);
      const twoDone = window.__v08Test.getState().tunnel.tiles[0];

      return {
        oneEarly: oneEarly.done,
        oneEarlyProgress: oneEarly.progress,
        oneDone: oneDone.done,
        twoEarly: twoEarly.done,
        twoEarlyProgress: twoEarly.progress,
        twoDone: twoDone.done,
      };
    });
    expect(result.oneEarly).toBe(false);
    expect(result.oneEarlyProgress).toBeGreaterThan(0.8);
    expect(result.oneDone).toBe(true);
    expect(result.twoEarly).toBe(false);
    expect(result.twoEarlyProgress).toBeGreaterThan(0.8);
    expect(result.twoDone).toBe(true);
  });

  test('cargo travels hub to hub at 4 tiles/s', async ({ page }) => {
    await ready(page);
    const result = await page.evaluate(() => {
      const s0 = window.__v08Test.getState();
      window.__v08Test.selectUnits([s0.units[0].id]);
      const a = window.__v08Test.placeBuilding('tunnel-hub', 14, 21);
      const b = window.__v08Test.placeBuilding('tunnel-hub', 22, 21);
      window.__v08Test.completeBuilding(a.id);
      window.__v08Test.completeBuilding(b.id);
      const tiles = window.__v08Test.startDigCorridor();
      window.__v08Test.markTunnelDone();
      window.__v08Test.depositToBuilding(a.id, { ice: 8 });
      window.__v08Test.advance(0.05);
      const spawned = window.__v08Test.getState();
      const n = tiles.length;
      const transit = n / window.__v08Test.config.tunnelCargoTilesPerSecond;
      window.__v08Test.advance(transit - 0.35);
      const mid = window.__v08Test.getState();
      window.__v08Test.advance(0.6);
      const end = window.__v08Test.getState();
      const dest = end.buildings.find((x) => x.id === b.id);
      return {
        n,
        transit,
        packetsMid: mid.tunnel.packets.length,
        destIce: dest.ice,
        usedTunnel: end.stats.usedTunnel,
        ready: spawned.tunnel.ready,
      };
    });
    expect(result.n).toBeGreaterThanOrEqual(4);
    expect(result.ready).toBe(true);
    expect(result.packetsMid).toBeGreaterThan(0);
    expect(result.destIce).toBeGreaterThanOrEqual(8);
    expect(result.usedTunnel).toBe(true);
  });

  test('vault holds 150 ice and no more', async ({ page }) => {
    await ready(page);
    const result = await page.evaluate(() => {
      const s0 = window.__v08Test.getState();
      window.__v08Test.selectUnits([s0.units[0].id]);
      const hub = window.__v08Test.placeBuilding('tunnel-hub', 14, 21);
      window.__v08Test.completeBuilding(hub.id);
      const vault = window.__v08Test.placeBuilding('vault', 11, 21);
      window.__v08Test.completeBuilding(vault.id);
      const placed = window.__v08Test.getState().buildings.find((x) => x.id === vault.id);
      window.__v08Test.depositToBuilding(vault.id, { ice: 200 });
      const filled = window.__v08Test.getState().buildings.find((x) => x.id === vault.id);
      window.__v08Test.depositToBuilding(hub.id, { ice: 20 });
      window.__v08Test.advance(0.2);
      const afterHub = window.__v08Test.getState();
      const vaultAfter = afterHub.buildings.find((x) => x.id === vault.id);
      const hubAfter = afterHub.buildings.find((x) => x.id === hub.id);
      return {
        placed: !!vault,
        iceCap: placed.iceCap,
        filled: filled.ice,
        vaultAfter: vaultAfter.ice,
        hubAfter: hubAfter.ice,
      };
    });
    expect(result.placed).toBe(true);
    expect(result.iceCap).toBe(150);
    expect(result.filled).toBe(150);
    expect(result.vaultAfter).toBe(150);
    expect(result.hubAfter).toBe(20);
  });

  test('full ice storage shows a warning and a blocked label', async ({ page }) => {
    await ready(page);
    const result = await page.evaluate(() => {
      const s0 = window.__v08Test.getState();
      const C = window.__v08Test.config;
      const hab = s0.buildings.find((b) => b.type === 'habitat');
      window.__v08Test.setResources({ ice: C.habitatIceCapacity });
      window.__v08Test.selectUnits([s0.units[0].id]);
      window.__v08Test.issueOrder({
        type: 'haul',
        sourceTx: C.shallowIceTileX,
        sourceTy: C.shallowIceTileY,
        destBuildingId: hab.id,
      });
      let seenToast = null;
      for (let i = 0; i < 50; i++) {
        window.__v08Test.advance(1);
        const snap = window.__v08Test.getState();
        if (snap.toast === 'Ice storage full') seenToast = snap.toast;
        if (snap.units[0].status === 'blocked') {
          return {
            toast: seenToast || snap.toast,
            status: snap.units[0].status,
            label: snap.units[0].label,
          };
        }
      }
      const end = window.__v08Test.getState();
      return {
        toast: seenToast || end.toast,
        status: end.units[0].status,
        label: end.units[0].label,
      };
    });
    expect(result.toast).toBe('Ice storage full');
    expect(result.status).toBe('blocked');
    expect(result.label).toBe('Ice storage full');
  });
});

const NOTIFY_PROGRAM = {
  sensors: ['distance', 'spectral'],
  rules: [
    { condition: { type: 'crater_in_front' }, action: { type: 'sidestep' } },
    { condition: { type: 'on_ore' }, action: { type: 'notify' } },
    { condition: { type: 'ore_next_to' }, action: { type: 'go_to_ore' } },
    { condition: { type: 'always' }, action: { type: 'explore' } },
  ],
};

test.describe('Far Rover v0.8 M3/M4 unit (seeded state)', () => {
  test('Build Scout opens the imported build screen', async ({ page }) => {
    await ready(page);
    await page.click('#btn-build-scout');
    await expect(page.locator('#scout-overlay')).toBeVisible({ timeout: 15000 });
    await expect(page.locator('.build-screen')).toBeVisible();
    await expect(page.locator('.action-select').first()).toHaveValue('');
    const notify = page.locator('.action-select').first().locator('option[value="notify"]');
    await expect(notify).toHaveCount(1);
  });

  test('unit: setResources cannot put ice above the habitat cap', async ({ page }) => {
    await ready(page);
    const result = await page.evaluate(() => {
      window.__v08Test.setResources({ ice: 60, power: 50 });
      window.__v08Test.syncHud();
      return window.__v08Test.getState();
    });
    expect(result.stored.ice).toBeLessThanOrEqual(result.stored.iceCap);
    expect(result.stored.ice).toBe(30);
    expect(result.ice).toBe(30);
    expect(result.canLandCrew).toBe(false);
    await expect(page.locator('#res-ice')).toContainText('30 / 30');
    await expect(page.locator('#btn-land-crew')).toBeHidden();
  });

  test('unit: scout confirm unlocks Deep Ice', async ({ page }) => {
    await ready(page);
    await expect(page.locator('#objectives')).toContainText('Build a scout and confirm ice');
    await expect(page.locator('#objectives')).toContainText('Bring 60 ice and 50 power home');
    const result = await page.evaluate(() => {
      window.__v08Test.launchProgram(['spectral'], [
        { condition: { type: 'on_ore' }, action: { type: 'notify' } },
        { condition: { type: 'always' }, action: { type: 'wait' } },
      ]);
      const confirmed = window.__v08Test.confirmOnOre();
      const before = window.__v08Test.getState();
      window.__v08Test.advance(2.1);
      const after = window.__v08Test.getState();
      return { confirmed, before, after };
    });
    expect(result.confirmed).toBe(true);
    expect(result.before.deepIce.unlocked).toBe(false);
    expect(result.after.deepIce.unlocked).toBe(true);
    expect(result.after.deepIceTile.type).toBe('ice');
    expect(result.after.deepIceTile.remaining).toBe(200);
    expect(result.after.stats.notifies).toBeGreaterThanOrEqual(1);
    expect(result.after.toast).toMatch(/Ice confirmed|Notify/);
    expect(result.after.canLandCrew).toBe(false);
  });

  test('operate view is the imported demo view', async ({ page }) => {
    await ready(page);
    await page.evaluate(() => {
      window.__v08Test.launchProgram(['spectral', 'distance'], [
        { condition: { type: 'always' }, action: { type: 'wait' } },
      ]);
    });
    await page.evaluate(() => window.__v08Test.openOperate());
    await expect(page.locator('.operate-view')).toBeVisible({ timeout: 15000 });
    await expect(page.locator('#pause-btn')).toBeVisible();
    await expect(page.locator('.speed-btn[data-speed="1"]')).toBeVisible();
    await expect(page.locator('.speed-btn[data-speed="4"]')).toBeVisible();
    await expect(page.locator('.speed-btn[data-speed="16"]')).toBeVisible();
    await expect(page.locator('#rule-display')).toBeVisible();
    await expect(page.locator('#map-grid canvas, .game-canvas')).toBeVisible();
    await page.click('#scout-back');
    await expect(page.locator('#scout-overlay')).toBeHidden();
  });

  test('unit: one free Recall drives the scout home and disables the button', async ({ page }) => {
    await ready(page);
    const result = await page.evaluate(() => {
      window.__v08Test.launchProgram(['spectral'], [
        { condition: { type: 'always' }, action: { type: 'wait' } },
      ]);
      window.__v08Test.confirmOnOre();
      window.__v08Test.advance(2.1);
      const unlocked = window.__v08Test.getState().deepIce.unlocked;
      window.__v08Test.syncHud();
      const scout = window.__v08Test.startRecall();
      const second = window.__v08Test.startRecall();
      window.__v08Test.advance(30);
      window.__v08Test.syncHud();
      const end = window.__v08Test.getState();
      return {
        unlocked,
        scoutId: scout && scout.id,
        second,
        ended: end.expedition.ended,
        recallUsed: end.expedition.recallUsed,
        stillUnlocked: end.deepIce.unlocked,
        kind: end.units.find((u) => u.id === (scout && scout.id))?.kind,
      };
    });
    expect(result.unlocked).toBe(true);
    expect(result.scoutId).toBeTruthy();
    expect(result.second).toBeNull();
    expect(result.ended).toBe(true);
    expect(result.recallUsed).toBe(true);
    expect(result.stillUnlocked).toBe(true);
    expect(result.kind).toBe('scout');
    await expect(page.locator('#btn-recall')).toBeVisible();
    await expect(page.locator('#btn-recall')).toBeDisabled();
    await expect(page.locator('#patches-left')).toContainText('Patches left:');
  });

  test('unit: one rule patch per sol with a 2s link delay', async ({ page }) => {
    await ready(page);
    const result = await page.evaluate(() => {
      window.__v08Test.launchProgram(['spectral'], [
        { condition: { type: 'always' }, action: { type: 'explore' } },
      ]);
      const queued = window.__v08Test.queuePatch(0, { type: 'always' }, { type: 'wait' });
      const mid = window.__v08Test.getState();
      window.__v08Test.advance(1.0);
      const linking = window.__v08Test.getState();
      const during = window.__v08Test.queuePatch(1, { type: 'always' }, { type: 'wait' });
      window.__v08Test.advance(1.2);
      const applied = window.__v08Test.getState();
      const sameSol = window.__v08Test.queuePatch(1, { type: 'always' }, { type: 'notify' });
      window.__v08Test.setTime(window.__v08Test.config.solSecondsAt1x + 1);
      const nextSol = window.__v08Test.queuePatch(1, { type: 'always' }, { type: 'notify' });
      return {
        queued,
        pendingMid: mid.expedition.pendingPatch,
        pendingLinking: linking.expedition.pendingPatch,
        during,
        patches: applied.stats.patches,
        pendingAfter: applied.expedition.pendingPatch,
        sameSol,
        nextSol,
        leftAfter: applied.patchesLeft,
      };
    });
    expect(result.queued).toBe(true);
    expect(result.pendingMid).toBe(true);
    expect(result.pendingLinking).toBe(true);
    expect(result.during).toBe(false);
    expect(result.patches).toBe(1);
    expect(result.pendingAfter).toBe(false);
    expect(result.sameSol).toBe(false);
    expect(result.nextSol).toBe(true);
  });
});

test.describe('Far Rover v0.8 M3/M4 honest play', () => {
  test('map canvas fills the viewport at 1280×800 and 1920×1080', async ({ page }) => {
    for (const size of [{ w: 1280, h: 800 }, { w: 1920, h: 1080 }]) {
      await page.setViewportSize({ width: size.w, height: size.h });
      await ready(page);
      const box = await page.evaluate(() => {
        const canvas = document.getElementById('board');
        const app = document.getElementById('app');
        const top = document.getElementById('hud-top').getBoundingClientRect();
        const bot = document.getElementById('hud-bottom').getBoundingClientRect();
        const r = canvas.getBoundingClientRect();
        return {
          canvasW: r.width,
          canvasH: r.height,
          appW: app.getBoundingClientRect().width,
          viewW: window.innerWidth,
          viewH: window.innerHeight,
          topBottom: top.bottom,
          botTop: bot.top,
          canvasTop: r.top,
          canvasBottom: r.bottom,
        };
      });
      expect(box.canvasW).toBeGreaterThan(size.w - 4);
      expect(box.canvasW).toBeLessThanOrEqual(size.w + 2);
      expect(box.canvasTop).toBeGreaterThanOrEqual(box.topBottom - 2);
      expect(box.canvasBottom).toBeLessThanOrEqual(box.botTop + 2);
      expect(box.canvasH).toBeGreaterThan(size.h * 0.45);
    }
  });

  test('honest hauler route lands the crew', async ({ page }) => {
    test.setTimeout(120000);
    await ready(page);
    const result = await page.evaluate((prog) => {
      const t = window.__v08Test;
      const s0 = t.getState();
      t.selectUnits(s0.units.map((u) => u.id));
      const storage = t.placeBuilding('storage', 22, 21);
      if (!storage) return { error: 'storage place failed' };
      t.advance(11);
      t.launchProgram(prog.sensors, prog.rules);
      let unlocked = false;
      for (let i = 0; i < 80; i++) {
        t.advance(1);
        if (t.getState().deepIce.unlocked) { unlocked = true; break; }
      }
      const deep = t.getState().deepIce;
      t.selectUnits(t.getState().units.filter((u) => u.kind === 'hauler').map((u) => u.id));
      t.issueOrder({
        type: 'haul',
        sourceTx: deep.tx,
        sourceTy: deep.ty,
        destBuildingId: storage.id,
      });
      let landed = null;
      for (let i = 0; i < 500; i++) {
        t.advance(1);
        const snap = t.getState();
        if (snap.canLandCrew) {
          landed = t.landCrew();
          break;
        }
      }
      const end = t.getState();
      return {
        unlocked,
        win: end.win,
        stored: end.stored,
        time: end.time,
        iceCap: end.iceCap,
        ice: end.ice,
        usedTunnel: end.stats.usedTunnel,
      };
    }, NOTIFY_PROGRAM);
    expect(result.error).toBeUndefined();
    expect(result.unlocked).toBe(true);
    expect(result.win).toBeTruthy();
    expect(result.win.logistics).toBe('haulers only');
    expect(result.stored.ice).toBeGreaterThanOrEqual(60);
    expect(result.stored.ice).toBeLessThanOrEqual(result.stored.iceCap);
    expect(result.stored.power).toBeGreaterThanOrEqual(50);
    expect(result.win.time).toBeGreaterThan(60);
    expect(result.usedTunnel).toBe(false);
    await page.evaluate(() => window.__v08Test.syncHud());
    await expect(page.locator('#win-overlay')).toBeVisible();
    await expect(page.locator('#win-logistics')).toContainText('haulers only');
    await expect(page.locator('#win-ice')).toContainText('/');
  });

  test('honest tunnel route lands the crew', async ({ page }) => {
    test.setTimeout(120000);
    await ready(page);
    const result = await page.evaluate((prog) => {
      const t = window.__v08Test;
      const s0 = t.getState();
      t.selectUnits(s0.units.map((u) => u.id));
      const homeHub = t.placeBuilding('tunnel-hub', 14, 21);
      if (!homeHub) return { error: 'home hub place failed' };
      t.advance(11);
      const farHub = t.placeBuilding('tunnel-hub', 28, 21);
      if (!farHub) return { error: 'far hub place failed' };
      t.advance(11);
      const vault = t.placeBuilding('vault', 11, 21);
      if (!vault) return { error: 'vault place failed' };
      t.advance(11);
      const tiles = t.startDigCorridor();
      t.issueOrder({ type: 'dig' });
      for (let i = 0; i < 120; i++) {
        t.advance(1);
        if (t.getState().tunnel.ready) break;
      }
      t.launchProgram(prog.sensors, prog.rules);
      for (let i = 0; i < 80; i++) {
        t.advance(1);
        if (t.getState().deepIce.unlocked) break;
      }
      const deep = t.getState().deepIce;
      if (!deep.unlocked) return { error: 'no deep ice', time: t.getState().time };
      t.selectUnits(t.getState().units.filter((u) => u.kind === 'hauler').map((u) => u.id));
      t.issueOrder({
        type: 'haul',
        sourceTx: deep.tx,
        sourceTy: deep.ty,
        destBuildingId: farHub.id,
      });
      for (let i = 0; i < 500; i++) {
        t.advance(1);
        if (t.getState().canLandCrew) {
          t.landCrew();
          break;
        }
      }
      const end = t.getState();
      return {
        win: end.win,
        stored: end.stored,
        time: end.time,
        usedTunnel: end.stats.usedTunnel,
        tunnelReady: end.tunnel.ready,
        tiles: tiles && tiles.length,
      };
    }, NOTIFY_PROGRAM);
    expect(result.error).toBeUndefined();
    expect(result.tunnelReady).toBe(true);
    expect(result.usedTunnel).toBe(true);
    expect(result.win).toBeTruthy();
    expect(result.win.logistics).toBe('tunnel');
    expect(result.stored.ice).toBeGreaterThanOrEqual(60);
    expect(result.stored.ice).toBeLessThanOrEqual(result.stored.iceCap);
    expect(result.win.time).toBeGreaterThan(60);
    await page.evaluate(() => window.__v08Test.syncHud());
    await expect(page.locator('#win-overlay')).toBeVisible();
    await expect(page.locator('#win-logistics')).toContainText('tunnel');
  });
});
