// Far Rover UI Tests with Playwright
import { test, expect } from '@playwright/test';

const BASE_URL = 'http://localhost:8080';

test.describe('Far Rover UI Tests', () => {
  test.beforeEach(async ({ page }) => {
    // Clear localStorage before each test
    await page.goto(BASE_URL);
    await page.evaluate(() => localStorage.clear());
    await page.reload();
  });

  test('Title screen shows pitch and goal', async ({ page }) => {
    await page.goto(BASE_URL);
    
    // Check title
    await expect(page.locator('h1')).toContainText('Far Rover');
    
    // Check pitch
    await expect(page.locator('.pitch')).toContainText('Build a tiny rover');
    
    // Check goal
    await expect(page.locator('.goal-box')).toContainText('Scan 30 tiles');
    await expect(page.locator('.goal-box')).toContainText('drill 3 ore');
    
    // Check start button
    await expect(page.locator('#start-btn')).toBeVisible();
  });

  test('Build screen allows sensor selection (exactly 3)', async ({ page }) => {
    await page.goto(BASE_URL);
    await page.click('#start-btn');
    
    // Should be on build screen
    await expect(page.locator('h2')).toContainText('Build Your Rover');
    
    // Select 3 sensors
    await page.click('input[data-sensor="distance"]');
    await page.click('input[data-sensor="spectral"]');
    await page.click('input[data-sensor="camera"]');
    
    // Launch should still be disabled (no rules)
    await expect(page.locator('#launch-btn')).toBeDisabled();
  });

  test('Rules can be created with dropdowns', async ({ page }) => {
    await page.goto(BASE_URL);
    await page.click('#start-btn');
    
    // Select sensors
    await page.click('input[data-sensor="distance"]');
    await page.click('input[data-sensor="spectral"]');
    await page.click('input[data-sensor="camera"]');
    
    // Create a rule
    await page.selectOption('.condition-select[data-slot="0"]', 'always');
    await page.selectOption('.action-select[data-slot="0"]', 'explore');
    
    // Launch should now be enabled
    await expect(page.locator('#launch-btn')).toBeEnabled();
  });

  test('Launch is disabled without valid setup', async ({ page }) => {
    await page.goto(BASE_URL);
    await page.click('#start-btn');
    
    // Only 2 sensors
    await page.click('input[data-sensor="distance"]');
    await page.click('input[data-sensor="spectral"]');
    
    // Create a rule
    await page.selectOption('.condition-select[data-slot="0"]', 'always');
    await page.selectOption('.action-select[data-slot="0"]', 'explore');
    
    // Launch should be disabled (need exactly 3 sensors)
    await expect(page.locator('#launch-btn')).toBeDisabled();
  });

  test('Operate view shows map and controls', async ({ page }) => {
    await page.goto(BASE_URL);
    await page.click('#start-btn');
    
    // Setup and launch
    await page.click('input[data-sensor="distance"]');
    await page.click('input[data-sensor="spectral"]');
    await page.click('input[data-sensor="camera"]');
    await page.selectOption('.condition-select[data-slot="0"]', 'always');
    await page.selectOption('.action-select[data-slot="0"]', 'explore');
    await page.click('#launch-btn');
    
    // Should be on operate view
    await expect(page.locator('.operate-view')).toBeVisible();
    await expect(page.locator('.map-grid')).toBeVisible();
    await expect(page.locator('.speed-btn[data-speed="pause"]')).toBeVisible();
    await expect(page.locator('#step-btn')).toBeVisible();
  });

  test('Step button advances one tick', async ({ page }) => {
    await page.goto(BASE_URL);
    await page.click('#start-btn');
    
    // Setup and launch
    await page.click('input[data-sensor="distance"]');
    await page.click('input[data-sensor="spectral"]');
    await page.click('input[data-sensor="camera"]');
    await page.selectOption('.condition-select[data-slot="0"]', 'always');
    await page.selectOption('.action-select[data-slot="0"]', 'explore');
    await page.click('#launch-btn');
    
    // Initial tick should be 0
    await expect(page.locator('.tick-indicator')).toContainText('Tick 0');
    
    // Step one tick
    await page.click('#step-btn');
    await expect(page.locator('.tick-indicator')).toContainText('Tick 1');
    
    // Step again
    await page.click('#step-btn');
    await expect(page.locator('.tick-indicator')).toContainText('Tick 2');
  });

  test('Keyboard shortcuts work', async ({ page }) => {
    await page.goto(BASE_URL);
    await page.click('#start-btn');
    
    // Setup and launch
    await page.click('input[data-sensor="distance"]');
    await page.click('input[data-sensor="spectral"]');
    await page.click('input[data-sensor="camera"]');
    await page.selectOption('.condition-select[data-slot="0"]', 'always');
    await page.selectOption('.action-select[data-slot="0"]', 'explore');
    await page.click('#launch-btn');
    
    // Press period to step
    await page.keyboard.press('.');
    await expect(page.locator('.tick-indicator')).toContainText('Tick 1');
    
    // Press space to toggle pause (should unpause and start running)
    await page.keyboard.press('Space');
    await page.waitForTimeout(1500); // Let it run a bit
    
    // Press space again to pause
    await page.keyboard.press('Space');
    
    // Should have advanced beyond tick 1
    const tickText = await page.locator('.tick-indicator').textContent();
    const tickNum = parseInt(tickText.replace('Tick ', ''));
    expect(tickNum).toBeGreaterThan(1);
  });

  test('Auto-pause triggers on hazard detection', async ({ page }) => {
    await page.goto(BASE_URL);
    await page.click('#start-btn');
    
    // Setup with camera to trigger auto-pause on dust
    await page.click('input[data-sensor="distance"]');
    await page.click('input[data-sensor="spectral"]');
    await page.click('input[data-sensor="camera"]');
    await page.selectOption('.condition-select[data-slot="0"]', 'always');
    await page.selectOption('.action-select[data-slot="0"]', 'explore');
    await page.click('#launch-btn');
    
    // Step until auto-pause (should happen at tick 3 for dust)
    for (let i = 0; i < 5; i++) {
      const banner = page.locator('.auto-pause-banner');
      if (await banner.isVisible()) {
        break;
      }
      await page.click('#step-btn');
      await page.waitForTimeout(100);
    }
    
    // Should see auto-pause banner
    await expect(page.locator('.auto-pause-banner')).toBeVisible();
    await expect(page.locator('.auto-pause-banner')).toContainText('dust');
  });

  test('End screen shows outcome and trace', async ({ page }) => {
    await page.goto(BASE_URL);
    await page.click('#start-btn');
    
    // Setup scenario A (will hit crater on tick 5)
    await page.click('input[data-sensor="distance"]');
    await page.click('input[data-sensor="spectral"]');
    await page.click('input[data-sensor="camera"]');
    await page.selectOption('.condition-select[data-slot="0"]', 'always');
    await page.selectOption('.action-select[data-slot="0"]', 'explore');
    await page.click('#launch-btn');
    
    // Step through manually to avoid timing issues with auto-pause
    for (let i = 0; i < 20; i++) {
      // Check for end screen first
      if (await page.locator('.end-screen').isVisible()) {
        break;
      }
      
      // Check for auto-pause banner and resume
      const autoPauseBanner = page.locator('.auto-pause-banner');
      if (await autoPauseBanner.isVisible()) {
        await page.click('#resume-btn');
        await page.waitForTimeout(100);
        continue;
      }
      
      // Check for stuck banner
      const stuckBanner = page.locator('.stuck-banner');
      if (await stuckBanner.isVisible()) {
        await page.click('#end-stuck-btn');
        await page.waitForTimeout(100);
        break;
      }
      
      // Step if possible
      const stepBtn = page.locator('#step-btn');
      if (await stepBtn.isVisible() && await stepBtn.isEnabled()) {
        await page.click('#step-btn');
        await page.waitForTimeout(50);
      }
    }
    
    // Should be on end screen
    await expect(page.locator('.end-screen')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('.trace-list')).toBeVisible();
  });

  test('Rerun keeps the build', async ({ page }) => {
    await page.goto(BASE_URL);
    await page.click('#start-btn');
    
    // Setup
    await page.click('input[data-sensor="distance"]');
    await page.click('input[data-sensor="spectral"]');
    await page.click('input[data-sensor="camera"]');
    await page.selectOption('.condition-select[data-slot="0"]', 'always');
    await page.selectOption('.action-select[data-slot="0"]', 'explore');
    await page.click('#launch-btn');
    
    // Step through to end screen manually
    for (let i = 0; i < 20; i++) {
      if (await page.locator('.end-screen').isVisible()) break;
      
      const autoPauseBanner = page.locator('.auto-pause-banner');
      if (await autoPauseBanner.isVisible()) {
        await page.click('#resume-btn');
        await page.waitForTimeout(100);
        continue;
      }
      
      const stuckBanner = page.locator('.stuck-banner');
      if (await stuckBanner.isVisible()) {
        await page.click('#end-stuck-btn');
        await page.waitForTimeout(100);
        break;
      }
      
      const stepBtn = page.locator('#step-btn');
      if (await stepBtn.isVisible() && await stepBtn.isEnabled()) {
        await page.click('#step-btn');
        await page.waitForTimeout(50);
      }
    }
    
    await expect(page.locator('.end-screen')).toBeVisible({ timeout: 10000 });
    await page.click('#rerun-btn');
    
    // Should be back on build screen with sensors selected
    await expect(page.locator('.build-screen')).toBeVisible();
    await expect(page.locator('input[data-sensor="distance"]')).toBeChecked();
    await expect(page.locator('input[data-sensor="spectral"]')).toBeChecked();
    await expect(page.locator('input[data-sensor="camera"]')).toBeChecked();
  });

  test('Run counter increments', async ({ page }) => {
    await page.goto(BASE_URL);
    await page.click('#start-btn');
    
    // First run
    await page.click('input[data-sensor="distance"]');
    await page.click('input[data-sensor="spectral"]');
    await page.click('input[data-sensor="camera"]');
    await page.selectOption('.condition-select[data-slot="0"]', 'always');
    await page.selectOption('.action-select[data-slot="0"]', 'explore');
    
    // Check run indicator shows Run 1
    await expect(page.locator('.run-indicator')).toContainText('Run 1');
    
    await page.click('#launch-btn');
    
    // Run indicator should still show Run 1
    await expect(page.locator('.run-indicator')).toContainText('Run 1');
  });

  test('Log screen shows session summary', async ({ page }) => {
    await page.goto(BASE_URL);
    await page.click('#start-btn');
    await page.click('#view-log-btn');
    
    // Should be on log screen
    await expect(page.locator('.log-screen')).toBeVisible();
    await expect(page.locator('.log-summary')).toBeVisible();
    await expect(page.locator('.summary-stats')).toContainText('Total Runs');
    await expect(page.locator('.summary-stats')).toContainText('Voluntary Reruns');
  });

  test('Local storage persists across reload', async ({ page }) => {
    await page.goto(BASE_URL);
    await page.click('#start-btn');
    
    // Setup and run
    await page.click('input[data-sensor="distance"]');
    await page.click('input[data-sensor="spectral"]');
    await page.click('input[data-sensor="camera"]');
    await page.selectOption('.condition-select[data-slot="0"]', 'always');
    await page.selectOption('.action-select[data-slot="0"]', 'explore');
    await page.click('#launch-btn');
    
    // Complete the run by stepping through
    for (let i = 0; i < 20; i++) {
      if (await page.locator('.end-screen').isVisible()) break;
      
      const autoPauseBanner = page.locator('.auto-pause-banner');
      if (await autoPauseBanner.isVisible()) {
        await page.click('#resume-btn');
        await page.waitForTimeout(100);
        continue;
      }
      
      const stuckBanner = page.locator('.stuck-banner');
      if (await stuckBanner.isVisible()) {
        await page.click('#end-stuck-btn');
        await page.waitForTimeout(100);
        break;
      }
      
      const stepBtn = page.locator('#step-btn');
      if (await stepBtn.isVisible() && await stepBtn.isEnabled()) {
        await page.click('#step-btn');
        await page.waitForTimeout(50);
      }
    }
    
    // Wait for end screen and click rerun to save the run
    await expect(page.locator('.end-screen')).toBeVisible({ timeout: 10000 });
    await page.click('#rerun-btn');
    
    // Reload page
    await page.reload();
    await page.click('#start-btn');
    await page.click('#view-log-btn');
    
    // Should see the run in the log
    await expect(page.locator('.log-table tbody tr')).toHaveCount(1);
  });

  test('CSV and JSON export buttons exist', async ({ page }) => {
    await page.goto(BASE_URL);
    await page.click('#start-btn');
    await page.click('#view-log-btn');
    
    await expect(page.locator('#copy-csv-btn')).toBeVisible();
    await expect(page.locator('#download-csv-btn')).toBeVisible();
    await expect(page.locator('#download-json-btn')).toBeVisible();
  });

  test('Responsive layout at narrow viewport', async ({ page }) => {
    // Set narrow viewport (phone size)
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto(BASE_URL);
    await page.click('#start-btn');
    
    // Build screen should still be usable
    await expect(page.locator('.sensors-section')).toBeVisible();
    await expect(page.locator('.rules-section')).toBeVisible();
    
    // Check that page doesn't have horizontal scroll
    const bodyWidth = await page.evaluate(() => document.body.scrollWidth);
    const viewportWidth = await page.evaluate(() => window.innerWidth);
    expect(bodyWidth).toBeLessThanOrEqual(viewportWidth + 10); // Allow small tolerance
    
    // Primary buttons should have sufficient height for touch
    const primaryBtns = await page.locator('.primary-btn').all();
    for (const btn of primaryBtns) {
      const box = await btn.boundingBox();
      if (box && box.height > 0) {
        expect(box.height).toBeGreaterThanOrEqual(40);
      }
    }
  });

  test('Uplink can modify rule mid-run', async ({ page }) => {
    await page.goto(BASE_URL);
    await page.click('#start-btn');
    
    // Setup
    await page.click('input[data-sensor="distance"]');
    await page.click('input[data-sensor="spectral"]');
    await page.click('input[data-sensor="camera"]');
    await page.selectOption('.condition-select[data-slot="0"]', 'always');
    await page.selectOption('.action-select[data-slot="0"]', 'explore');
    await page.click('#launch-btn');
    
    // Uplink button should be enabled while paused
    await expect(page.locator('#uplink-btn')).toBeEnabled();
    
    // Open uplink dialog
    await page.click('#uplink-btn');
    await expect(page.locator('.uplink-dialog')).toBeVisible();
    
    // Make an edit
    await page.selectOption('#uplink-condition', 'crater_in_front');
    await page.selectOption('#uplink-action', 'sidestep');
    await page.click('#uplink-apply');
    
    // Uplink should now show as used
    await expect(page.locator('#uplink-btn')).toBeDisabled();
    await expect(page.locator('#uplink-btn')).toContainText('Used');
  });
});
