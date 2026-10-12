import { test, expect } from '@playwright/test';

const PLAY = 'http://localhost:8080/v08/?debug';
const TUTORIAL = 'http://localhost:8080/v08/?debug&tutorial=1';
const CHOOSER = 'http://localhost:8080/v08/?debug&intro=1';

const STEP_TEXT = {
  1: "You're commanding a new base at the Moon's south pole",
  2: 'Drag a box around your two haulers',
  3: 'Right-click the ice',
  4: 'Press 4x to speed things up',
  5: 'Click Storage, then click near the habitat',
  6: 'Select a hauler and right-click the frame',
  7: 'Buildings cost regolith',
  8: 'Click Build Scout',
  9: 'Your scout follows a list of rules',
  10: 'Launch it and watch what happens',
  11: 'It came home with only trace ice',
  12: "Change 'Battery below 12' to 'Battery below 6'",
  13: 'Deep Ice found!',
  14: 'Place a Tunnel hub at the edge of your range',
  15: 'Select both haulers, click Dig',
  16: 'send haulers to mine Deep Ice',
  17: "You've got it, commander",
};

const ACTION_STEPS = [2, 3, 4, 5, 6, 8, 10, 12, 14, 15, 16];

async function ready(page, url) {
  await page.goto(url);
  await page.waitForFunction(() => window.__v08Test && window.__v08Test.ready);
}

async function waitStep(page, n) {
  await page.waitForFunction((step) => window.__v08Test.tutorial.step() >= step, n, { timeout: 30000 });
}

test.describe('Far Rover v0.8 tutorial', () => {
  test('first screen offers Tutorial and Play', async ({ page }) => {
    await ready(page, CHOOSER);
    await expect(page.locator('#tutorial-chooser')).toBeVisible();
    await expect(page.locator('#chooser-tutorial')).toContainText('Tutorial');
    await expect(page.locator('#chooser-tutorial')).toContainText('recommended for first time');
    await expect(page.locator('#chooser-play')).toHaveText('Play');
    await page.screenshot({ path: '/opt/cursor/artifacts/screenshots/tutorial-first-screen.png', fullPage: true });
  });

  test('Tutorial starts the guided game and remembers the choice', async ({ page }) => {
    await ready(page, CHOOSER);
    await page.click('#chooser-tutorial');
    await expect(page.locator('#tutorial-card')).toBeVisible();
    await expect(page.locator('#tutorial-text')).toContainText(STEP_TEXT[1]);
    await expect(page.locator('#tutorial-skip')).toHaveText('Skip tutorial');
    const stored = await page.evaluate(() => localStorage.getItem('far-rover-v08-intro'));
    expect(stored).toBe('tutorial');
  });

  test('Play skips the tutorial and pulses Build Scout after the haul goal', async ({ page }) => {
    await ready(page, CHOOSER);
    await page.click('#chooser-play');
    await expect(page.locator('#tutorial-chooser')).toBeHidden();
    await expect(page.locator('#tutorial-card')).toBeHidden();
    await expect(page.locator('#goal-banner')).toBeVisible();
    await page.evaluate(() => {
      const t = window.__v08Test;
      t.selectUnits(t.getState().units.map((u) => u.id));
      const C = t.config;
      t.commandHaul(C.shallowIceTileX, C.shallowIceTileY);
      t.advance(40);
      t.syncHud();
    });
    await expect(page.locator('#btn-build-scout')).toHaveClass(/hint-pulse/);
  });

  test('Skip tutorial on every step leaves a valid free-play game', async ({ page }) => {
    test.setTimeout(60000);
    for (let step = 1; step <= 17; step++) {
      await ready(page, TUTORIAL);
      await page.evaluate((n) => window.__v08Test.tutorial.jump(n), step);
      await expect(page.locator('#tutorial-card')).toBeVisible();
      await expect(page.locator('#tutorial-skip')).toBeVisible();
      await page.click('#tutorial-skip');
      await expect(page.locator('#tutorial-card')).toBeHidden();
      const s = await page.evaluate(() => {
        const t = window.__v08Test;
        t.syncHud();
        const st = t.getState();
        return {
          mode: t.tutorial.mode(),
          units: st.unitCount,
          ice: st.ice,
          banner: st.goalBanner,
        };
      });
      expect(s.mode).toBe('play');
      expect(s.units).toBe(2);
      expect(s.ice).toBeGreaterThan(0);
      expect(s.banner).toBeTruthy();
      await expect(page.locator('#goal-banner')).toBeVisible();
    }
  });

  test('Show me works at every action step', async ({ page }) => {
    test.setTimeout(90000);
    for (const step of ACTION_STEPS) {
      await ready(page, TUTORIAL);
      await page.evaluate((n) => {
        const t = window.__v08Test;
        if (n === 6) t.placeBuilding('storage', 22, 21, false);
        if (n === 14 || n === 15 || n === 16) t.unlockDeepIce();
        if (n === 15 || n === 16) {
          t.placeBuilding('tunnel-hub', 22, 9, false);
          t.placeBuilding('tunnel-hub', 34, 8, false);
        }
        if (n === 3) t.selectUnits(t.getState().units.map((u) => u.id));
        t.tutorial.jump(n);
      }, step);
      await expect(page.locator('#tutorial-show')).toBeVisible();
      await page.click('#tutorial-show');
      if (step === 8 || step === 10 || step === 12) {
        await page.waitForTimeout(500);
      }
      const after = await page.evaluate(() => {
        const t = window.__v08Test;
        const st = t.getState();
        return {
          step: t.tutorial.step(),
          selected: st.selectedIds.length,
          speed: st.speed,
          storages: st.buildings.filter((b) => b.type === 'storage').length,
          hubs: st.buildings.filter((b) => b.type === 'tunnel-hub').length,
          scoutOpen: st.scoutOpen,
          launched: st.expedition.launched,
          digging: st.digging,
          digOrder: st.units.filter((u) => u.order === 'dig').length,
          tunnelTiles: st.tunnel.tiles.length,
          haul: st.units.filter((u) => u.order === 'haul').length,
          building: st.units.filter((u) => u.order === 'build').length,
        };
      });
      if (step === 2) expect(after.selected, `step ${step}`).toBe(2);
      if (step === 3) expect(after.haul, `step ${step}`).toBeGreaterThanOrEqual(2);
      if (step === 4) expect(after.speed, `step ${step}`).toBeGreaterThanOrEqual(4);
      if (step === 5) expect(after.storages, `step ${step}`).toBeGreaterThan(0);
      if (step === 6) expect(after.building + after.selected, `step ${step}`).toBeGreaterThan(0);
      if (step === 8) expect(after.scoutOpen, `step ${step}`).toBe(true);
      if (step === 10 || step === 12) expect(after.launched, `step ${step}`).toBe(true);
      if (step === 14) expect(after.hubs, `step ${step}`).toBeGreaterThanOrEqual(2);
      if (step === 15) expect(after.digOrder > 0 || after.tunnelTiles > 0, `step ${step} ${JSON.stringify(after)}`).toBe(true);
    }
  });

  test('full tutorial path through the real UI reaches hand-off', async ({ page }) => {
    test.setTimeout(120000);
    await ready(page, TUTORIAL);
    await expect(page.locator('#tutorial-text')).toContainText(STEP_TEXT[1]);
    await page.screenshot({ path: '/opt/cursor/artifacts/screenshots/tutorial-welcome.png', fullPage: true });

    await page.click('#tutorial-next');
    await waitStep(page, 2);
    await page.click('#tutorial-show');
    await waitStep(page, 3);
    await page.click('#tutorial-show');
    await page.evaluate(() => {
      window.__v08Test.advance(45);
    });
    await waitStep(page, 4);
    await page.click('#tutorial-show');
    await waitStep(page, 5);
    await page.click('#tutorial-show');
    await waitStep(page, 6);
    await page.click('#tutorial-show');
    await page.evaluate(() => window.__v08Test.advance(12));
    await waitStep(page, 7);
    await expect(page.locator('#tutorial-text')).toContainText(STEP_TEXT[7]);
    await page.click('#tutorial-next');
    await waitStep(page, 8);
    await page.click('#tutorial-show');
    await waitStep(page, 9);
    await expect(page.locator('#tutorial-text')).toContainText(STEP_TEXT[9]);
    await page.screenshot({ path: '/opt/cursor/artifacts/screenshots/tutorial-program.png', fullPage: true });
    await page.click('#tutorial-next');
    await waitStep(page, 10);
    await page.click('#tutorial-show');
    await page.waitForTimeout(300);
    await page.evaluate(() => {
      for (let i = 0; i < 80; i++) {
        window.__v08Test.tickScout(1);
        if (window.__v08Test.getState().scoutOutcome) break;
      }
      window.__v08Test.advance(2.2);
    });
    await waitStep(page, 11);
    await expect(page.locator('#tutorial-text')).toContainText(STEP_TEXT[11]);
    await expect(page.locator('.trace-item.tutorial-trace-on')).toBeVisible();
    await expect(page.locator('.trace-item.tutorial-trace-on .trace-reason'))
      .toContainText(/Battery below|Return and charge/i);
    await page.screenshot({ path: '/opt/cursor/artifacts/screenshots/tutorial-read-trace.png', fullPage: true });
    await page.click('#tutorial-next');
    await waitStep(page, 12);
    await expect(page.locator('#tutorial-text')).toContainText(STEP_TEXT[12]);
    await page.screenshot({ path: '/opt/cursor/artifacts/screenshots/tutorial-relaunch.png', fullPage: true });
    await page.click('#tutorial-show');
    await page.waitForTimeout(300);
    await page.evaluate(() => {
      for (let i = 0; i < 80; i++) {
        window.__v08Test.tickScout(1);
        const s = window.__v08Test.getState();
        if (s.iceConfirmed || s.deepIce.unlocked) break;
      }
      window.__v08Test.advance(2.5);
    });
    await waitStep(page, 13);
    await expect(page.locator('#tutorial-text')).toContainText(STEP_TEXT[13]);
    await page.click('#tutorial-next');
    await waitStep(page, 14);
    await page.click('#tutorial-show');
    await waitStep(page, 15);
    await page.click('#tutorial-show');
    await waitStep(page, 16);
    await page.click('#tutorial-show');
    await page.evaluate(() => {
      window.__v08Test.setSpeed(16);
      window.__v08Test.advance(40);
    });
    await waitStep(page, 17);
    await expect(page.locator('#tutorial-text')).toContainText(STEP_TEXT[17]);
    await page.screenshot({ path: '/opt/cursor/artifacts/screenshots/tutorial-handoff.png', fullPage: true });
    await page.click('#tutorial-next');
    await expect(page.locator('#tutorial-card')).toBeHidden();
    await expect(page.locator('#goal-banner')).toBeVisible();
    const end = await page.evaluate(() => window.__v08Test.getState());
    expect(end.tutorialMode).toBe('play');
    expect(end.deepIce.unlocked).toBe(true);
  });

  test('live panel highlights the firing rule, matches the starter trace, and narrates events', async ({ page }) => {
    test.setTimeout(60000);
    await ready(page, TUTORIAL);
    await page.evaluate(() => window.__v08Test.tutorial.jump(10));
    await page.click('#tutorial-show');
    await expect(page.locator('.operate-view')).toBeVisible({ timeout: 15000 });
    await expect(page.locator('.speed-btn[data-speed="1"]')).toHaveClass(/active/);
    await page.click('.speed-btn[data-speed="pause"]');
    await expect(page.locator('#rover-cam')).toBeVisible();
    await expect(page.locator('#live-sensors')).toBeVisible();
    await expect(page.locator('#live-battery')).toBeVisible();
    await expect(page.locator('#rule-display')).toBeVisible();
    await expect(page.locator('#minimap-canvas')).toBeVisible();

    const seen = { reasons: [], toasts: [] };
    let frames = 0;
    for (let i = 0; i < 90; i++) {
      const snap = await page.evaluate(() => {
        window.__v08Test.tickScout(1);
        window.__v08Test.syncHud();
        const live = window.__v08Test.getLive();
        const fired = document.querySelector('.rule-line.fired');
        return {
          reason: document.querySelector('#live-rule-reason')?.textContent || '',
          firedRule: fired?.getAttribute('data-rule') || null,
          toast: window.__v08Test.getState().toast,
          live,
          outcome: window.__v08Test.getState().scoutOutcome,
        };
      });
      if (snap.reason) seen.reasons.push(snap.reason);
      if (snap.toast) seen.toasts.push(snap.toast);
      if (snap.live?.fired > 0) {
        expect(snap.firedRule, `tick highlight ${snap.reason}`).toBe(String(snap.live.fired));
        expect(snap.reason, 'panel reason matches live trace').toBe(snap.live.reason);
      }
      if (/so exploring/.test(snap.reason) && frames === 0) {
        await page.screenshot({ path: '/opt/cursor/artifacts/screenshots/live-panel-explore.png', fullPage: true });
        frames = 1;
      } else if (/sidestepping/.test(snap.reason) && frames < 2) {
        await page.screenshot({ path: '/opt/cursor/artifacts/screenshots/live-panel-sidestep.png', fullPage: true });
        frames = 2;
      } else if (/heading home to charge/.test(snap.reason) && frames < 3) {
        await page.screenshot({ path: '/opt/cursor/artifacts/screenshots/live-panel-home.png', fullPage: true });
        frames = 3;
      }
      if (snap.outcome) break;
    }
    expect(seen.reasons.some((r) => /Rule 4: nothing else true, so exploring/.test(r))).toBe(true);
    expect(seen.reasons.some((r) => /Rule 2: Battery \d+ is below 12, so heading home to charge/.test(r))).toBe(true);
    expect(seen.toasts.some((t) => t === 'Scout: battery low, heading home')).toBe(true);
    expect(seen.toasts.some((t) => /Scout: trace ice at [A-L]\d+, continuing/.test(t))).toBe(true);
    expect(seen.toasts.some((t) => t === 'Scout: crater ahead, sidestepping')).toBe(true);
    expect(frames).toBeGreaterThanOrEqual(3);
  });
});
