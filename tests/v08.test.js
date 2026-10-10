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
    expect(s.ice).toBe(20);
    expect(s.regolith).toBe(80);
    expect(s.power).toBe(100);
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
