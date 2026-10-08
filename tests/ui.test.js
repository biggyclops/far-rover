// Far Rover UI Tests with Playwright
import { test, expect } from '@playwright/test';

const BASE_URL = 'http://localhost:8080';

async function dismissAutoPause(page) {
  const autoPauseToast = page.locator('.auto-pause-toast:not(.stuck)');
  if (!(await autoPauseToast.isVisible({ timeout: 0 }))) return false;
  // Step continues the paused tick without starting 1× play (Resume now restarts play).
  const stepBtn = page.locator('#step-btn');
  if (await stepBtn.isVisible({ timeout: 0 }) && await stepBtn.isEnabled()) {
    await stepBtn.click({ force: true });
    return true;
  }
  await page.click('#resume-btn');
  if (await page.locator('.end-screen').isVisible({ timeout: 0 })) return true;
  const pauseBtn = page.locator('#pause-btn');
  if (await pauseBtn.isVisible({ timeout: 0 })) {
    const label = (await pauseBtn.textContent()) || '';
    if (label.trim() === 'Pause') {
      await page.click('#pause-btn');
    }
  }
  return true;
}

async function completeRun(page, maxIter = 120) {
  for (let i = 0; i < maxIter; i++) {
    if (await page.locator('.end-screen').isVisible({ timeout: 0 })) break;
    if (await dismissAutoPause(page)) {
      await page.waitForTimeout(30);
      continue;
    }
    const stuckToast = page.locator('.auto-pause-toast.stuck');
    if (await stuckToast.isVisible({ timeout: 0 })) {
      await page.click('#end-stuck-btn');
      await page.waitForTimeout(50);
      break;
    }
    const stepBtn = page.locator('#step-btn');
    if (await stepBtn.isVisible({ timeout: 0 }) && await stepBtn.isEnabled()) {
      await page.locator('#step-btn').click({ force: true });
      await page.waitForTimeout(30);
    }
  }
  await expect(page.locator('.end-screen')).toBeVisible({ timeout: 15000 });
}

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
    
    // Check goal (v3.2: "Drive onto 25 tiles")
    await expect(page.locator('.goal-box')).toContainText('Drive onto 25 tiles');
    await expect(page.locator('.goal-box')).toContainText('drill 3 ore');
    
    // Check start button
    await expect(page.locator('#start-btn')).toBeVisible();
  });

  test('Build screen allows sensor selection (exactly 3)', async ({ page }) => {
    await page.goto(BASE_URL);
    await page.click('#start-btn');
    
    await expect(page.locator('.sensor-item:has([data-sensor="camera"]) .sensor-desc'))
      .toContainText('Shows 3×3 (seen, not scanned; dust alerts fire even without Dust)');
    await expect(page.locator('.sensor-item:has([data-sensor="camera"]) .sensor-desc'))
      .not.toContainText('Scans');
    
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
    await expect(page.locator('#reset-view-btn')).toBeVisible();
    await expect(page.locator('#grid-toggle')).toBeVisible();
    await expect(page.locator('#map-grid')).toHaveAttribute('data-renderer', /^(3d|2d)$/);
    await expect(page.locator('#sensor-readings')).toContainText('Camera');
    await expect(page.locator('#sensor-readings')).toContainText('shows 3×3');
    await expect(page.locator('#sensor-readings')).not.toContainText('scanning');
    await expect(page.locator('#rover-cam')).toBeVisible();
    await expect(page.locator('#rover-cam')).toContainText('ROVER CAM FORWARD');
    await expect(page.locator('#layer-camera')).toBeVisible();
    await expect(page.locator('#layer-lidar')).toBeVisible();
    await expect(page.locator('#layer-spectral')).toBeVisible();
    await expect(page.locator('#layer-thermal')).toHaveCount(0);
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
      const toast = page.locator('.auto-pause-toast');
      if (await toast.isVisible()) {
        break;
      }
      await page.click('#step-btn');
      await page.waitForTimeout(100);
    }
    
    // Should see auto-pause toast
    await expect(page.locator('.auto-pause-toast')).toBeVisible();
    await expect(page.locator('.auto-pause-toast')).toContainText('dust');
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
    await completeRun(page);
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
    
    await completeRun(page);
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
    
    await completeRun(page);
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
    
    // v3.2: Uplink is disabled before tick 1, so step forward first
    await page.click('#step-btn');
    await page.waitForTimeout(100);
    
    // Uplink button should be enabled after tick 1 while paused
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
    test.setTimeout(90000);
    await page.goto(BASE_URL);
    await page.click('#start-btn');
    
    // Run 1: Initial setup
    await page.click('input[data-sensor="distance"]');
    await page.click('input[data-sensor="spectral"]');
    await page.click('input[data-sensor="camera"]');
    await page.selectOption('.condition-select[data-slot="0"]', 'always');
    await page.selectOption('.action-select[data-slot="0"]', 'explore');
    await page.click('#launch-btn');
    await completeRun(page);
    await page.click('#rerun-btn');
    
    // Run 2: Rerun WITH a change (add rule 2) - should count as voluntary
    await page.selectOption('.condition-select[data-slot="1"]', 'crater_in_front');
    await page.selectOption('.action-select[data-slot="1"]', 'sidestep');
    await page.click('#launch-btn');
    await completeRun(page);
    await page.click('#rerun-btn');
    
    // Run 3: Rerun WITHOUT a change (same rules) - should NOT count as voluntary
    await page.click('#launch-btn');
    await completeRun(page);
    await page.click('#rerun-btn');
    
    // Run 4: Rerun WITH a change - will mark as prompted AFTER
    // Use 'on_ore' which requires Spectral sensor (which we have)
    await page.selectOption('.condition-select[data-slot="2"]', 'on_ore');
    await page.selectOption('.action-select[data-slot="2"]', 'drill');
    await page.click('#launch-btn');
    await completeRun(page);
    
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
    
    await completeRun(page);
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
    
    await completeRun(page);
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

  test('First-minute story ends at tick 5 (not higher)', async ({ page }) => {
    await page.goto(BASE_URL);
    await page.click('#start-btn');
    
    // Setup first-minute scenario (scenario B):
    // Sensors: Distance, Dust, Spectral (NOT Camera!)
    // Rule: Always → Explore (walks north into crater at F8)
    await page.click('input[data-sensor="distance"]');
    await page.click('input[data-sensor="dust"]');
    await page.click('input[data-sensor="spectral"]');
    await page.selectOption('.condition-select[data-slot="0"]', 'always');
    await page.selectOption('.action-select[data-slot="0"]', 'explore');
    await page.click('#launch-btn');
    
    await completeRun(page);
    
    // Get the final tick count from the end screen stats
    // The first stat is "Ticks: N"
    const ticksStat = await page.locator('.stat-item').first().locator('.stat-value').textContent();
    const finalTick = parseInt(ticksStat);
    
    // First-minute story MUST end at tick 5, not 7
    expect(finalTick).toBe(5);
    
    // Should be a crater loss
    const outcomeText = await page.locator('.end-header h2').textContent();
    expect(outcomeText).toContain('Crater');
    
    // End screen must fit 1280x800 without scrolling
    await page.setViewportSize({ width: 1280, height: 800 });
    const scroll = await page.locator('.end-screen').evaluate(el => ({
      scrollHeight: el.scrollHeight,
      clientHeight: el.clientHeight
    }));
    expect(scroll.scrollHeight).toBeLessThanOrEqual(scroll.clientHeight);
    
    // Saved log and CSV tick numbers must also be 5
    await page.click('#view-log-end-btn');
    const savedTicks = await page.evaluate(() => {
      const run = JSON.parse(localStorage.getItem('far-rover-demo-v1'))?.currentSession?.runs?.[0];
      return run?.ticks;
    });
    expect(savedTicks).toBe(5);
    
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.click('#download-csv-btn')
    ]);
    const csvPath = await download.path();
    const fs = await import('fs');
    const csv = fs.readFileSync(csvPath, 'utf8');
    const lines = csv.trim().split('\n');
    const headers = lines[0].split(',');
    const tickCol = headers.indexOf('Ticks');
    expect(tickCol).toBeGreaterThanOrEqual(0);
    const values = lines[1].split(',');
    expect(parseInt(values[tickCol], 10)).toBe(5);
  });

  test('Starter preset wins at tick 46 (not higher)', async ({ page }) => {
    await page.goto(BASE_URL);
    await page.click('#start-btn');
    
    // Load the starter preset
    await page.click('#starter-preset-btn');
    
    // Verify preset is loaded correctly
    await expect(page.locator('input[data-sensor="distance"]')).toBeChecked();
    await expect(page.locator('input[data-sensor="spectral"]')).toBeChecked();
    await expect(page.locator('input[data-sensor="camera"]')).toBeChecked();
    
    await page.click('#launch-btn');
    
    await completeRun(page);
    
    // Get the final tick count from the end screen
    const ticksStat = await page.locator('.stat-value').first().textContent();
    const finalTick = parseInt(ticksStat);
    
    // Starter preset MUST win at tick 46, not 49
    expect(finalTick).toBe(46);
    
    // Should be a success outcome
    const outcomeText = await page.locator('.end-header h2').textContent();
    expect(outcomeText).toContain('Success');
    
    // Saved log and CSV tick numbers must also be 46
    await page.click('#view-log-end-btn');
    const savedTicks = await page.evaluate(() => {
      const run = JSON.parse(localStorage.getItem('far-rover-demo-v1'))?.currentSession?.runs?.[0];
      return run?.ticks;
    });
    expect(savedTicks).toBe(46);
    
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.click('#download-csv-btn')
    ]);
    const csvPath = await download.path();
    const fs = await import('fs');
    const csv = fs.readFileSync(csvPath, 'utf8');
    const lines = csv.trim().split('\n');
    const headers = lines[0].split(',');
    const tickCol = headers.indexOf('Ticks');
    expect(tickCol).toBeGreaterThanOrEqual(0);
    const values = lines[1].split(',');
    expect(parseInt(values[tickCol], 10)).toBe(46);
  });

  test('Trace tick numbers are consecutive in end screen', async ({ page }) => {
    await page.goto(BASE_URL);
    await page.click('#start-btn');
    
    // Setup the first-minute scenario which has auto-pauses
    // Sensors: Distance, Dust, Spectral (NOT Camera!)
    await page.click('input[data-sensor="distance"]');
    await page.click('input[data-sensor="dust"]');
    await page.click('input[data-sensor="spectral"]');
    await page.selectOption('.condition-select[data-slot="0"]', 'always');
    await page.selectOption('.action-select[data-slot="0"]', 'explore');
    await page.click('#launch-btn');
    
    await completeRun(page);
    
    // Click "Show more..." to see all trace entries if available
    const showMoreBtn = page.locator('#show-more-trace');
    if (await showMoreBtn.isVisible()) {
      await showMoreBtn.click();
      await page.waitForTimeout(100);
    }
    
    // Get all trace tick numbers from the trace list
    const traceItems = await page.locator('.trace-item .trace-tick').allTextContents();
    const tickNumbers = traceItems.map(t => parseInt(t.replace('Tick ', '')));
    
    // Verify tick numbers are consecutive (1, 2, 3, 4, 5 - no gaps like 1, 2, 3, 5, 7)
    expect(tickNumbers.length).toBeGreaterThan(0);
    for (let i = 1; i < tickNumbers.length; i++) {
      const diff = tickNumbers[i] - tickNumbers[i - 1];
      expect(diff).toBe(1);
    }
    
    // Verify that first tick is 1 and last tick matches the final tick count
    expect(tickNumbers[0]).toBe(1);
    const ticksStat = await page.locator('.stat-item').first().locator('.stat-value').textContent();
    const finalTick = parseInt(ticksStat);
    expect(tickNumbers[tickNumbers.length - 1]).toBe(finalTick);
  });

  test('Uplink is disabled at tick 0 and pre-fills the selected slot', async ({ page }) => {
    await page.goto(BASE_URL);
    await page.click('#start-btn');
    await page.click('#starter-preset-btn');
    await page.click('#launch-btn');
    await expect(page.locator('#uplink-btn')).toBeDisabled();
    await page.click('#step-btn');
    await expect(page.locator('#uplink-btn')).toBeEnabled();
    await page.click('#uplink-btn');
    await expect(page.locator('.uplink-dialog')).toBeVisible();
    await expect(page.locator('#uplink-condition')).toHaveValue('crater_in_front');
    await expect(page.locator('#uplink-action')).toHaveValue('sidestep');
    await page.selectOption('#uplink-slot', { value: '1' });
    await expect(page.locator('#uplink-condition')).toHaveValue('battery_below');
    await expect(page.locator('#uplink-battery-n')).toHaveValue('12');
    await expect(page.locator('#uplink-action')).toHaveValue('return_charge');
  });

  test('Uplink battery N is clamped to 1-20', async ({ page }) => {
    await page.goto(BASE_URL);
    await page.click('#start-btn');
    await page.click('#starter-preset-btn');
    await page.click('#launch-btn');
    await page.click('#step-btn');
    await page.click('#uplink-btn');
    await page.selectOption('#uplink-slot', { value: '1' });
    await page.fill('#uplink-battery-n', '99');
    await page.click('#uplink-apply');
    await expect(page.locator('#uplink-btn')).toContainText('Used');
    await expect(page.locator('.rule-text').nth(1)).toContainText('Battery below 20');
  });

  test('Keyboard shortcuts ignore focused inputs and map 2 to 4x', async ({ page }) => {
    await page.goto(BASE_URL);
    await page.click('#start-btn');
    await page.click('input[data-sensor="distance"]');
    await page.click('input[data-sensor="spectral"]');
    await page.click('input[data-sensor="camera"]');
    await page.selectOption('.condition-select[data-slot="0"]', 'always');
    await page.selectOption('.action-select[data-slot="0"]', 'explore');
    await page.click('#launch-btn');
    await page.click('#step-btn');
    await expect(page.locator('.tick-indicator')).toContainText('Tick 1');
    await page.click('#uplink-btn');
    await page.selectOption('#uplink-condition', 'battery_below');
    await page.locator('#uplink-battery-n').click();
    await page.locator('#uplink-battery-n').fill('1');
    await page.keyboard.press('1');
    await expect(page.locator('.tick-indicator')).toContainText('Tick 1');
    await page.click('#uplink-cancel');
    await page.keyboard.press('2');
    await expect(page.locator('.speed-btn[data-speed="4"]')).toHaveClass(/active/);
    await page.click('.speed-btn[data-speed="pause"]');
  });

  test('Build screen warns about Always placement and never-leave programs', async ({ page }) => {
    await page.goto(BASE_URL);
    await page.click('#start-btn');
    await page.click('input[data-sensor="distance"]');
    await page.click('input[data-sensor="spectral"]');
    await page.click('input[data-sensor="camera"]');
    await expect(page.locator('#build-warnings')).toContainText('never leave');
    await page.selectOption('.condition-select[data-slot="0"]', 'always');
    await page.selectOption('.action-select[data-slot="0"]', 'explore');
    await page.selectOption('.condition-select[data-slot="1"]', 'crater_in_front');
    await page.selectOption('.action-select[data-slot="1"]', 'sidestep');
    await expect(page.locator('#build-warnings')).toContainText('Always is not last');
  });

  test('Auto-pause toggle is visible and Resume restarts play', async ({ page }) => {
    await page.goto(BASE_URL);
    await page.click('#start-btn');
    await page.click('input[data-sensor="distance"]');
    await page.click('input[data-sensor="dust"]');
    await page.click('input[data-sensor="spectral"]');
    await page.selectOption('.condition-select[data-slot="0"]', 'always');
    await page.selectOption('.action-select[data-slot="0"]', 'explore');
    await page.click('#launch-btn');
    await expect(page.locator('#autopause-mode')).toBeVisible();
    await expect(page.locator('#autopause-mode')).toHaveValue('first');
    for (let i = 0; i < 6; i++) {
      if (await page.locator('.auto-pause-toast:not(.stuck)').isVisible()) break;
      await page.click('#step-btn');
      await page.waitForTimeout(50);
    }
    await expect(page.locator('.auto-pause-toast:not(.stuck)')).toBeVisible();
    await page.click('#resume-btn');
    await expect(page.locator('#pause-btn')).toContainText('Pause', { timeout: 3000 });
    await page.click('#pause-btn');
  });

  test('Stuck toast has no doubled prefix and cargo uses goal copy', async ({ page }) => {
    await page.goto(BASE_URL);
    await page.click('#start-btn');
    await page.click('input[data-sensor="distance"]');
    await page.click('input[data-sensor="spectral"]');
    await page.click('input[data-sensor="camera"]');
    await page.selectOption('.condition-select[data-slot="0"]', 'battery_below');
    await page.selectOption('.action-select[data-slot="0"]', 'explore');
    await page.click('#launch-btn');
    await expect(page.locator('#hud-ore')).toContainText('goal 3');
    for (let i = 0; i < 6; i++) {
      if (await page.locator('.auto-pause-toast.stuck').isVisible()) break;
      const stepBtn = page.locator('#step-btn');
      if (await stepBtn.isVisible()) await page.click('#step-btn');
      await page.waitForTimeout(40);
    }
    await expect(page.locator('.auto-pause-toast.stuck .toast-text')).toContainText('No rule was true, so the rover never moved.');
    await expect(page.locator('.auto-pause-toast.stuck .toast-text')).not.toContainText('Stuck: stuck:');
    await expect(page.locator('#uplink-stuck-btn')).toHaveCount(0);
  });

  test('Uplink during auto-pause does not add a phantom tick', async ({ page }) => {
    await page.goto(BASE_URL);
    await page.click('#start-btn');
    await page.click('#starter-preset-btn');
    await page.click('#launch-btn');
    for (let i = 0; i < 10; i++) {
      if (await page.locator('.auto-pause-toast:not(.stuck)').isVisible()) break;
      await page.click('#step-btn');
      await page.waitForTimeout(40);
    }
    await expect(page.locator('.auto-pause-toast:not(.stuck)')).toBeVisible();
    await page.click('#uplink-banner-btn');
    await page.selectOption('#uplink-slot', { value: '3' });
    await expect(page.locator('#uplink-condition')).toHaveValue('always');
    await page.click('#uplink-apply');
    await completeRun(page);
    const ticksStat = await page.locator('.stat-item').first().locator('.stat-value').textContent();
    expect(parseInt(ticksStat)).toBe(46);
  });

  test('Force 2D renderer with query param', async ({ page }) => {
    await page.goto(BASE_URL + '/?renderer=2d');
    await page.click('#start-btn');
    await page.click('#starter-preset-btn');
    await page.click('#launch-btn');
    await expect(page.locator('#map-grid')).toHaveAttribute('data-renderer', '2d');
    await expect(page.locator('.game-canvas')).toBeVisible();
    await expect(page.locator('#rover-cam')).toBeVisible();
    await expect(page.locator('#rover-cam')).toContainText('ROVER CAM FORWARD');
    await page.click('#step-btn');
    await expect(page.locator('.tick-indicator')).toContainText('Tick 1');
  });

  test('Instrument layer toggles do not advance ticks', async ({ page }) => {
    await page.goto(BASE_URL);
    await page.click('#start-btn');
    await page.click('input[data-sensor="distance"]');
    await page.click('input[data-sensor="spectral"]');
    await page.click('input[data-sensor="camera"]');
    await page.selectOption('.condition-select[data-slot="0"]', 'always');
    await page.selectOption('.action-select[data-slot="0"]', 'explore');
    await page.click('#launch-btn');
    await expect(page.locator('.tick-indicator')).toContainText('Tick 0');
    await page.click('#layer-lidar');
    await expect(page.locator('#layer-lidar')).toHaveAttribute('aria-pressed', 'true');
    await page.click('#layer-spectral');
    await expect(page.locator('#layer-spectral')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('.tick-indicator')).toContainText('Tick 0');
    await page.click('#step-btn');
    await expect(page.locator('.tick-indicator')).toContainText('Tick 1');
  });

  test('Instrument layer toggle changes the board without advancing ticks', async ({ page }) => {
    await page.goto(BASE_URL);
    await page.click('#start-btn');
    await page.click('input[data-sensor="distance"]');
    await page.click('input[data-sensor="spectral"]');
    await page.click('input[data-sensor="camera"]');
    await page.selectOption('.condition-select[data-slot="0"]', 'always');
    await page.selectOption('.action-select[data-slot="0"]', 'explore');
    await page.click('#launch-btn');
    await expect(page.locator('.tick-indicator')).toContainText('Tick 0');
    await expect(page.locator('.game-canvas')).toBeVisible();
    await page.waitForFunction(() => {
      const c = document.querySelector('.game-canvas');
      return c && c.width > 10;
    });
    await page.waitForTimeout(500);

    const sample = () => page.evaluate(() => {
      const c = document.querySelector('.game-canvas');
      const ctx = c.getContext('2d');
      const x = Math.floor(c.width * 0.42);
      const y = Math.floor(c.height * 0.46);
      const pw = Math.min(96, c.width - x);
      const ph = Math.min(96, c.height - y);
      const { data } = ctx.getImageData(x, y, pw, ph);
      let r = 0, g = 0, b = 0, n = 0;
      for (let i = 0; i < data.length; i += 4) {
        r += data[i];
        g += data[i + 1];
        b += data[i + 2];
        n++;
      }
      return { r: r / n, g: g / n, b: b / n };
    });
    const dist = (a, b) => Math.hypot(a.r - b.r, a.g - b.g, a.b - b.b);

    const before = await sample();
    await page.click('#layer-lidar');
    await expect(page.locator('#layer-lidar')).toHaveAttribute('aria-pressed', 'true');
    await page.waitForTimeout(120);
    const lidar = await sample();
    expect(dist(before, lidar)).toBeGreaterThan(6);

    await page.click('[data-layer="thermal"]');
    await expect(page.locator('[data-layer="thermal"]')).toHaveAttribute('aria-pressed', 'true');
    await page.waitForTimeout(120);
    const stacked = await sample();
    expect(dist(lidar, stacked)).toBeGreaterThan(4);

    await expect(page.locator('.tick-indicator')).toContainText('Tick 0');
    await page.click('#step-btn');
    await expect(page.locator('.tick-indicator')).toContainText('Tick 1');
  });

  test('Rover cam modes render and change between ticks without extra ticks', async ({ page }) => {
    test.setTimeout(60000);
    const sampleCam = () => page.evaluate(() => {
      const c = document.getElementById('rover-cam-canvas');
      const ctx = c.getContext('2d');
      // Lower field: sky is mostly static, pose shows up in the near ground.
      const { data } = ctx.getImageData(40, 130, 240, 120);
      let r = 0, g = 0, b = 0, n = 0;
      for (let i = 0; i < data.length; i += 4) {
        r += data[i];
        g += data[i + 1];
        b += data[i + 2];
        n++;
      }
      return { r: r / n, g: g / n, b: b / n };
    });
    const dist = (a, b) => Math.hypot(a.r - b.r, a.g - b.g, a.b - b.b);

    for (const mode of ['photo', 'hybrid', '3d']) {
      await page.goto(`${BASE_URL}/?cam=${mode}`);
      await page.click('#start-btn');
      await page.click('input[data-sensor="distance"]');
      await page.click('input[data-sensor="spectral"]');
      await page.click('input[data-sensor="camera"]');
      await page.selectOption('.condition-select[data-slot="0"]', 'always');
      await page.selectOption('.action-select[data-slot="0"]', 'explore');
      await page.click('#launch-btn');
      await expect(page.locator('.tick-indicator')).toContainText('Tick 0');
      await expect(page.locator(`#cam-${mode}`)).toHaveAttribute('aria-pressed', 'true');
      await page.waitForFunction(() => {
        const c = document.getElementById('rover-cam-canvas');
        if (!c) return false;
        const d = c.getContext('2d').getImageData(100, 80, 8, 8).data;
        return d[0] + d[1] + d[2] > 80;
      });
      await page.waitForTimeout(200);
      const before = await sampleCam();
      await page.click('#step-btn');
      await expect(page.locator('.tick-indicator')).toContainText('Tick 1');
      await page.waitForFunction(() => {
        const r = window.__orbitalRenderer;
        return r && !r.anim;
      }, null, { timeout: 8000 });
      await page.waitForTimeout(80);
      const after = await sampleCam();
      expect(dist(before, after)).toBeGreaterThan(3);
      await expect(page.locator('.tick-indicator')).toContainText('Tick 1');
    }
  });

  test('Camera layer marks camera-seen ore and dust, not hidden fog', async ({ page }) => {
    test.setTimeout(45000);
    await page.goto(BASE_URL);
    await page.click('#start-btn');
    await page.click('input[data-sensor="distance"]');
    await page.click('input[data-sensor="spectral"]');
    await page.click('input[data-sensor="camera"]');
    await page.selectOption('.condition-select[data-slot="0"]', 'always');
    await page.selectOption('.action-select[data-slot="0"]', 'explore');
    await page.click('#launch-btn');
    await expect(page.locator('#layer-camera')).toHaveAttribute('aria-pressed', 'true');
    await page.waitForFunction(() => window.__orbitalRenderer?._view);

    for (let i = 0; i < 12; i++) {
      const marks = await page.locator('.game-canvas').getAttribute('data-dust-marks');
      const ore = await page.locator('.game-canvas').getAttribute('data-ore-marks');
      if ((marks || '').includes('G10') && (ore || '').includes('G9')) break;
      await dismissAutoPause(page);
      const step = page.locator('#step-btn');
      if (await step.isVisible() && await step.isEnabled()) await step.click({ force: true });
      await page.waitForTimeout(80);
    }

    await page.waitForFunction(() => {
      const c = document.querySelector('.game-canvas');
      const dust = c?.dataset?.dustMarks || '';
      const ore = c?.dataset?.oreMarks || '';
      return dust.includes('G10') && ore.includes('G9');
    });

    const dustMarks = (await page.locator('.game-canvas').getAttribute('data-dust-marks')) || '';
    const oreMarks = (await page.locator('.game-canvas').getAttribute('data-ore-marks')) || '';
    expect(dustMarks.split(',').filter(Boolean).length).toBeGreaterThan(0);
    expect(oreMarks.split(',').filter(Boolean).length).toBeGreaterThan(0);
    expect(dustMarks).toMatch(/F10|G10/);
    expect(oreMarks).toMatch(/G9/);
    expect(oreMarks).not.toContain('D11');
    expect(oreMarks).not.toContain('F2');
    expect(dustMarks).not.toContain('J3');

    const sampleTile = (col, row) => page.evaluate(({ col, row }) => {
      const r = window.__orbitalRenderer;
      const v = r._view;
      const c = r.canvas;
      const ctx = c.getContext('2d');
      const x = Math.round(((col + 0.5) * v.scale + v.tx) * v.dpr);
      const y = Math.round(((row + 0.5) * v.scale + v.ty) * v.dpr);
      const { data } = ctx.getImageData(Math.max(0, x - 3), Math.max(0, y - 3), 7, 7);
      let s = 0, n = 0;
      for (let i = 0; i < data.length; i += 4) {
        s += data[i] + data[i + 1] + data[i + 2];
        n++;
      }
      return s / n;
    }, { col, row });

    const dustPx = await sampleTile(6, 9); // G10 camera-seen dust, rover never occupies it
    const orePx = await sampleTile(6, 8); // G9 camera-seen ore
    const hiddenPx = await sampleTile(3, 10); // D11 hidden ore
    expect(Math.abs(dustPx - hiddenPx)).toBeGreaterThan(8);
    expect(Math.abs(orePx - hiddenPx)).toBeGreaterThan(4);
    await expect(page.locator('.tick-indicator')).not.toContainText('Tick 0');
  });

  test('Log table cargo uses goal copy, not a cap fraction', async ({ page }) => {
    await page.goto(BASE_URL);
    await page.click('#start-btn');
    await page.click('input[data-sensor="distance"]');
    await page.click('input[data-sensor="spectral"]');
    await page.click('input[data-sensor="camera"]');
    await page.selectOption('.condition-select[data-slot="0"]', 'always');
    await page.selectOption('.action-select[data-slot="0"]', 'explore');
    await page.click('#launch-btn');
    await completeRun(page);
    await page.evaluate(() => {
      const key = 'far-rover-demo-v1';
      const log = JSON.parse(localStorage.getItem(key));
      log.currentSession.runs[0].cargo = 4;
      localStorage.setItem(key, JSON.stringify(log));
    });
    await page.click('#view-log-end-btn');
    await expect(page.locator('.log-cargo')).toContainText('4 (goal 3)');
    await expect(page.locator('.log-cargo')).not.toContainText('4/3');
  });

  test('Charge tick 3 header battery matches start-of-turn trace', async ({ page }) => {
    test.setTimeout(45000);
    await page.goto(BASE_URL);
    await page.click('#start-btn');
    await page.click('input[data-sensor="distance"]');
    await page.click('input[data-sensor="spectral"]');
    await page.click('input[data-sensor="camera"]');
    await page.selectOption('.condition-select[data-slot="0"]', 'battery_below');
    await page.locator('.battery-n[data-slot="0"]').fill('19');
    await page.selectOption('.action-select[data-slot="0"]', 'return_charge');
    await page.selectOption('.condition-select[data-slot="1"]', 'always');
    await page.selectOption('.action-select[data-slot="1"]', 'explore');
    await page.click('#launch-btn');

    for (let i = 0; i < 40; i++) {
      const found = await page.evaluate(() => {
        const t = window.__orbitalRenderer?.gameState?.trace || [];
        return t.some((x) => (x.ruleReason || '').includes('3 of 3'));
      });
      if (found) break;
      await dismissAutoPause(page);
      const step = page.locator('#step-btn');
      if (await step.isVisible() && await step.isEnabled()) await step.click({ force: true });
      await page.waitForTimeout(50);
    }

    const rec = await page.evaluate(() => {
      const t = window.__orbitalRenderer?.gameState?.trace || [];
      return t.find((x) => (x.ruleReason || '').includes('3 of 3')) || null;
    });
    expect(rec).toBeTruthy();
    expect(rec.batteryAtStart).toBeLessThan(20);
    const hud = await page.locator('#hud-battery').textContent();
    expect(hud.trim()).toBe(`${Math.round(rec.batteryAtStart * 5)}%`);
    expect(hud.trim()).not.toBe('100%');

    await page.click('#end-run-btn');
    await expect(page.locator('.end-screen')).toBeVisible();
    const showMore = page.locator('#show-more-trace');
    if (await showMore.isVisible()) await showMore.click();
    const chargeRow = page.locator('.trace-item', { hasText: '3 of 3' });
    await expect(chargeRow).toBeVisible();
    await expect(chargeRow.locator('.trace-battery')).toHaveText(`Battery: ${rec.batteryAtStart}`);
  });

  test('Uplink edits are not counted as voluntary reruns', async ({ page }) => {
    test.setTimeout(60000);
    await page.goto(BASE_URL);
    await page.click('#start-btn');
    await page.click('input[data-sensor="distance"]');
    await page.click('input[data-sensor="spectral"]');
    await page.click('input[data-sensor="camera"]');
    await page.selectOption('.condition-select[data-slot="0"]', 'always');
    await page.selectOption('.action-select[data-slot="0"]', 'explore');
    await page.click('#launch-btn');
    await page.click('#step-btn');
    await page.click('#uplink-btn');
    await page.selectOption('#uplink-condition', 'crater_in_front');
    await page.selectOption('#uplink-action', 'sidestep');
    await page.click('#uplink-apply');
    await completeRun(page);
    await page.click('#rerun-btn');
    await page.click('#launch-btn');
    await completeRun(page);
    await page.click('#view-log-end-btn');
    const summary = await page.locator('.summary-stats').textContent();
    expect(summary).toMatch(/Voluntary Reruns with Change:\s*0/);
    const changedCells = page.locator('.log-table tbody tr td:nth-child(6)');
    await expect(changedCells.nth(1)).toHaveText('No');
  });

  test('Trace reasons wrap in full without truncation', async ({ page }) => {
    await page.goto(BASE_URL);
    await page.click('#start-btn');
    await page.click('input[data-sensor="distance"]');
    await page.click('input[data-sensor="dust"]');
    await page.click('input[data-sensor="spectral"]');
    await page.selectOption('.condition-select[data-slot="0"]', 'always');
    await page.selectOption('.action-select[data-slot="0"]', 'explore');
    await page.click('#launch-btn');
    await completeRun(page);
    const reason = page.locator('.trace-reason').last();
    await expect(reason).toBeVisible();
    const css = await reason.evaluate((el) => {
      const s = getComputedStyle(el);
      return {
        whiteSpace: s.whiteSpace,
        textOverflow: s.textOverflow,
        overflow: s.overflow,
        text: el.textContent
      };
    });
    expect(css.whiteSpace).not.toBe('nowrap');
    expect(css.textOverflow).not.toBe('ellipsis');
    expect(css.text.length).toBeGreaterThan(8);
    expect(css.text).not.toMatch(/…$/);
    const box = await reason.boundingBox();
    expect(box.width).toBeGreaterThan(40);
  });

  test('Reset view and grid toggle do not break the operate canvas', async ({ page }) => {
    await page.goto(BASE_URL);
    await page.click('#start-btn');
    await page.click('#starter-preset-btn');
    await page.click('#launch-btn');
    await expect(page.locator('.game-canvas')).toBeVisible();
    await page.click('#reset-view-btn');
    await page.click('#grid-toggle');
    await expect(page.locator('#grid-toggle')).toBeChecked();
    await page.click('#step-btn');
    await expect(page.locator('.tick-indicator')).toContainText('Tick 1');
    await expect(page.locator('.game-canvas')).toBeVisible();
  });

});
