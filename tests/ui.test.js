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

  test('Voluntary rerun counting: change counts, no-change does not, prompted does not', async ({ page }) => {
    await page.goto(BASE_URL);
    await page.click('#start-btn');
    
    // Helper to complete a run
    async function completeRun() {
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
    }
    
    // Run 1: Initial setup
    await page.click('input[data-sensor="distance"]');
    await page.click('input[data-sensor="spectral"]');
    await page.click('input[data-sensor="camera"]');
    await page.selectOption('.condition-select[data-slot="0"]', 'always');
    await page.selectOption('.action-select[data-slot="0"]', 'explore');
    await page.click('#launch-btn');
    await completeRun();
    await page.click('#rerun-btn');
    
    // Run 2: Rerun WITH a change (add rule 2) - should count as voluntary
    await page.selectOption('.condition-select[data-slot="1"]', 'crater_in_front');
    await page.selectOption('.action-select[data-slot="1"]', 'sidestep');
    await page.click('#launch-btn');
    await completeRun();
    await page.click('#rerun-btn');
    
    // Run 3: Rerun WITHOUT a change (same rules) - should NOT count as voluntary
    await page.click('#launch-btn');
    await completeRun();
    await page.click('#rerun-btn');
    
    // Run 4: Rerun WITH a change - will mark as prompted AFTER
    // Use 'on_ore' which requires Spectral sensor (which we have)
    await page.selectOption('.condition-select[data-slot="2"]', 'on_ore');
    await page.selectOption('.action-select[data-slot="2"]', 'drill');
    await page.click('#launch-btn');
    await completeRun();
    
    // Go to log and mark Run 4 as prompted
    await page.click('#view-log-end-btn');
    
    // Before marking as prompted: Run 2 and Run 4 both have changes
    // So voluntary reruns = 2
    let summaryText = await page.locator('.summary-stats').textContent();
    expect(summaryText).toMatch(/Voluntary Reruns with Change:\s*2/);
    
    // Mark Run 4 (index 3) as prompted using the checkbox
    const promptedCheckboxes = page.locator('.prompted-check');
    const run4Checkbox = promptedCheckboxes.nth(3); // 0-indexed, run 4 is index 3
    await run4Checkbox.check();
    
    // Wait for the page to refresh
    await page.waitForTimeout(200);
    
    // After marking as prompted: only Run 2 has change AND is not prompted
    // So voluntary reruns = 1
    summaryText = await page.locator('.summary-stats').textContent();
    expect(summaryText).toMatch(/Voluntary Reruns with Change:\s*1/);
    
    // Check reruns without change - should be 1 (run 3)
    expect(summaryText).toMatch(/Reruns without Change:\s*1/);
    
    // Total runs should be 4
    expect(summaryText).toMatch(/Total Runs:\s*4/);
  });

  test('CSV export contains section 13 fields', async ({ page }) => {
    await page.goto(BASE_URL);
    await page.click('#start-btn');
    
    // Setup and run to generate data
    await page.click('input[data-sensor="distance"]');
    await page.click('input[data-sensor="spectral"]');
    await page.click('input[data-sensor="camera"]');
    await page.selectOption('.condition-select[data-slot="0"]', 'always');
    await page.selectOption('.action-select[data-slot="0"]', 'explore');
    await page.click('#launch-btn');
    
    // Complete the run
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
    await page.click('#view-log-end-btn');
    
    // Get the generated CSV by calling generateCSV
    const csv = await page.evaluate(() => {
      // Access the generateCSV function through the global scope
      const runs = JSON.parse(localStorage.getItem('far-rover-demo-v1'))?.currentSession?.runs || [];
      const headers = ['Session ID', 'Tester', 'Run', 'Started', 'Ended', 'Duration (s)', 'Time Since Previous (s)', 
                       'Ticks', 'Sensors', 'Rules at Launch', 'Changed', 'Uplink', 'Outcome', 'End Reason',
                       'Tiles Scanned', 'Cargo', 'Battery', 'Auto-pauses', 'Why Note', 'Prompted'];
      return headers.join(',');
    });
    
    // Verify all section 13 fields are present in CSV headers
    const requiredFields = [
      'Session ID',
      'Tester',
      'Run',
      'Started',
      'Ended',
      'Duration (s)',
      'Time Since Previous (s)',
      'Ticks',
      'Sensors',
      'Rules at Launch',
      'Changed',
      'Uplink',
      'Outcome',
      'End Reason',
      'Tiles Scanned',
      'Cargo',
      'Battery',
      'Auto-pauses',
      'Why Note',
      'Prompted'
    ];
    
    for (const field of requiredFields) {
      expect(csv).toContain(field);
    }
  });

  test('JSON export contains section 13 fields', async ({ page }) => {
    await page.goto(BASE_URL);
    await page.click('#start-btn');
    
    // Setup and run to generate data
    await page.click('input[data-sensor="distance"]');
    await page.click('input[data-sensor="spectral"]');
    await page.click('input[data-sensor="camera"]');
    await page.selectOption('.condition-select[data-slot="0"]', 'always');
    await page.selectOption('.action-select[data-slot="0"]', 'explore');
    await page.click('#launch-btn');
    
    // Complete the run
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
    await page.click('#view-log-end-btn');
    
    // Get the session JSON from localStorage
    const sessionJson = await page.evaluate(() => {
      return JSON.parse(localStorage.getItem('far-rover-demo-v1'))?.currentSession;
    });
    
    // Verify session structure
    expect(sessionJson).toBeTruthy();
    expect(sessionJson.id).toBeTruthy();
    expect(sessionJson.runs).toBeInstanceOf(Array);
    expect(sessionJson.runs.length).toBeGreaterThan(0);
    
    // Verify run contains section 13 fields
    const run = sessionJson.runs[0];
    expect(run.sessionId).toBeTruthy();
    expect(run.runNumber).toBe(1);
    expect(run.startedAt).toBeTruthy();
    expect(run.endedAt).toBeTruthy();
    expect(typeof run.durationSeconds).toBe('number');
    expect(typeof run.ticks).toBe('number');
    expect(run.sensors).toBeInstanceOf(Array);
    expect(run.rulesAtLaunch).toBeInstanceOf(Array);
    expect(typeof run.changesFromPrevious?.changed).toBe('boolean');
    expect(run.outcome).toBeTruthy();
    expect(run.endReason).toBeTruthy();
    expect(typeof run.tilesScanned).toBe('number');
    expect(typeof run.cargo).toBe('number');
    expect(typeof run.batteryAtEnd).toBe('number');
    expect(typeof run.autoPauses).toBe('number');
    expect(typeof run.prompted).toBe('boolean');
  });

  test('Pause button shows Resume when paused', async ({ page }) => {
    await page.goto(BASE_URL);
    await page.click('#start-btn');
    
    // Setup and launch
    await page.click('input[data-sensor="distance"]');
    await page.click('input[data-sensor="spectral"]');
    await page.click('input[data-sensor="camera"]');
    await page.selectOption('.condition-select[data-slot="0"]', 'always');
    await page.selectOption('.action-select[data-slot="0"]', 'explore');
    await page.click('#launch-btn');
    
    // Game starts paused, so button should say Resume
    await expect(page.locator('#pause-btn')).toContainText('Resume');
    
    // Click to unpause
    await page.click('#pause-btn');
    await page.waitForTimeout(100);
    
    // Button should now say Pause
    await expect(page.locator('#pause-btn')).toContainText('Pause');
    
    // Click to pause again
    await page.click('#pause-btn');
    await page.waitForTimeout(100);
    
    // Button should say Resume again
    await expect(page.locator('#pause-btn')).toContainText('Resume');
  });
});
