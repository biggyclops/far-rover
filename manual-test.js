// Manual test script for Far Rover demo
// Takes screenshots at key moments per the spec's "first minute of play"

import { chromium } from 'playwright';

const BASE_URL = 'http://localhost:8080';
const ARTIFACTS_DIR = '/opt/cursor/artifacts/screenshots';

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function runManualTest() {
  console.log('Starting manual test...');
  
  const browser = await chromium.launch({ 
    headless: true,
    args: ['--no-sandbox']
  });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    recordVideo: { dir: '/opt/cursor/artifacts/' }
  });
  const page = await context.newPage();
  
  // Clear localStorage
  await page.goto(BASE_URL);
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  
  console.log('1. Title screen');
  await page.screenshot({ path: `${ARTIFACTS_DIR}/01-title-screen.png` });
  
  // Start
  await page.click('#start-btn');
  await sleep(500);
  
  console.log('2. Build screen - selecting sensors');
  // Select Distance, Spectral, Camera as per spec section 14
  await page.click('input[data-sensor="distance"]');
  await page.click('input[data-sensor="spectral"]');
  await page.click('input[data-sensor="camera"]');
  
  console.log('3. Build screen - writing rules');
  // First rule: Always → Explore
  await page.selectOption('.condition-select[data-slot="0"]', 'always');
  await page.selectOption('.action-select[data-slot="0"]', 'explore');
  
  await page.screenshot({ path: `${ARTIFACTS_DIR}/02-build-screen-with-rules.png` });
  
  console.log('4. Launch!');
  await page.click('#launch-btn');
  await sleep(500);
  
  console.log('5. Operate view - stepping through first minute');
  // Step through ticks, taking screenshots at key moments
  
  // Tick 1
  await page.click('#step-btn');
  await sleep(300);
  console.log('   Tick 1 - moved to F12');
  
  // Tick 2
  await page.click('#step-btn');
  await sleep(300);
  console.log('   Tick 2 - moved to F11');
  
  // Tick 3 - should auto-pause for dust
  await page.click('#step-btn');
  await sleep(500);
  
  const autoPauseBanner = page.locator('.auto-pause-banner');
  if (await autoPauseBanner.isVisible()) {
    console.log('   Tick 3 - Auto-pause for dust detected!');
    await page.screenshot({ path: `${ARTIFACTS_DIR}/03-auto-pause-dust.png` });
    await page.click('#resume-btn');
    await sleep(300);
  }
  console.log('   Tick 3 - moved to F10 (dust)');
  
  // Tick 4
  await page.click('#step-btn');
  await sleep(300);
  console.log('   Tick 4 - moved to F9');
  
  // Tick 5 - should auto-pause for crater
  await page.click('#step-btn');
  await sleep(800);
  
  // Check for auto-pause banner
  let craterAutoPause = await autoPauseBanner.isVisible();
  if (craterAutoPause) {
    console.log('   Tick 5 - Auto-pause for crater detected!');
    await page.screenshot({ path: `${ARTIFACTS_DIR}/04-auto-pause-crater.png` });
    
    // This is the moment of tension - let's use the uplink
    console.log('6. Using uplink to add sidestep rule');
    await page.click('#uplink-banner-btn');
    await sleep(500);
    
    // Add rule: Crater in front → Sidestep at slot 0
    await page.selectOption('#uplink-slot', '0');
    await page.selectOption('#uplink-condition', 'crater_in_front');
    await page.selectOption('#uplink-action', 'sidestep');
    
    await page.screenshot({ path: `${ARTIFACTS_DIR}/05-uplink-dialog.png` });
    await page.click('#uplink-apply');
    await sleep(500);
    
    await page.screenshot({ path: `${ARTIFACTS_DIR}/06-operate-after-uplink.png` });
  } else {
    // Check if we went straight to end screen (crater hit)
    if (await page.locator('.end-screen').isVisible()) {
      console.log('   Tick 5 - Rover hit crater (no auto-pause visible)');
      await page.screenshot({ path: `${ARTIFACTS_DIR}/04-end-screen-crater.png` });
    }
  }
  
  console.log('7. Running at 4x speed');
  await page.click('.speed-btn[data-speed="4"]');
  
  // Let it run and handle auto-pauses
  for (let i = 0; i < 50; i++) {
    await sleep(400);
    
    // Check for auto-pause
    const banner = page.locator('.auto-pause-banner');
    if (await banner.isVisible()) {
      await page.click('#resume-btn');
      continue;
    }
    
    // Check for stuck
    const stuckBanner = page.locator('.stuck-banner');
    if (await stuckBanner.isVisible()) {
      console.log('   Stuck detected!');
      await page.screenshot({ path: `${ARTIFACTS_DIR}/07-stuck-banner.png` });
      await page.click('#end-stuck-btn');
      break;
    }
    
    // Check for end screen
    if (await page.locator('.end-screen').isVisible()) {
      break;
    }
    
    // Take a mid-run screenshot
    if (i === 5) {
      await page.screenshot({ path: `${ARTIFACTS_DIR}/08-operate-mid-run.png` });
    }
  }
  
  console.log('8. End screen');
  await sleep(500);
  await page.screenshot({ path: `${ARTIFACTS_DIR}/09-end-screen.png` });
  
  // Enter a why note
  const whyInput = page.locator('#why-note');
  if (await whyInput.isVisible()) {
    await whyInput.fill('The uplink saved us from the crater but we got stuck');
  }
  
  // Click rerun
  console.log('9. Rerun with changes');
  await page.click('#rerun-btn');
  await sleep(500);
  
  // Add the sidestep rule BEFORE the explore rule
  await page.selectOption('.condition-select[data-slot="0"]', 'crater_in_front');
  await page.selectOption('.action-select[data-slot="0"]', 'sidestep');
  await page.selectOption('.condition-select[data-slot="1"]', 'always');
  await page.selectOption('.action-select[data-slot="1"]', 'explore');
  
  await page.screenshot({ path: `${ARTIFACTS_DIR}/10-build-run2.png` });
  
  // Launch run 2
  await page.click('#launch-btn');
  await sleep(500);
  
  // Run at 16x speed
  await page.click('.speed-btn[data-speed="16"]');
  
  for (let i = 0; i < 100; i++) {
    await sleep(200);
    
    const banner = page.locator('.auto-pause-banner');
    if (await banner.isVisible()) {
      await page.click('#resume-btn');
      continue;
    }
    
    const stuckBanner = page.locator('.stuck-banner');
    if (await stuckBanner.isVisible()) {
      await page.click('#end-stuck-btn');
      break;
    }
    
    if (await page.locator('.end-screen').isVisible()) {
      break;
    }
  }
  
  console.log('10. End screen run 2');
  await sleep(500);
  await page.screenshot({ path: `${ARTIFACTS_DIR}/11-end-screen-run2.png` });
  
  // View log
  console.log('11. View log');
  await page.click('#view-log-end-btn');
  await sleep(500);
  await page.screenshot({ path: `${ARTIFACTS_DIR}/12-run-log.png` });
  
  // Export CSV
  console.log('12. Export CSV');
  const csvContent = await page.evaluate(() => {
    const runs = JSON.parse(localStorage.getItem('far-rover-demo-v1'))?.currentSession?.runs || [];
    const headers = ['Run', 'Outcome', 'Ticks', 'Tiles', 'Cargo', 'Changed'];
    const rows = runs.map(r => [r.runNumber, r.outcome, r.ticks, r.tilesScanned, r.cargo, r.changesFromPrevious?.changed ? 'Yes' : 'No']);
    return [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
  });
  console.log('CSV Export:');
  console.log(csvContent);
  
  // Export JSON
  console.log('13. Export JSON');
  const jsonContent = await page.evaluate(() => {
    return localStorage.getItem('far-rover-demo-v1');
  });
  const parsed = JSON.parse(jsonContent);
  console.log('JSON Export (session summary):');
  console.log(JSON.stringify({
    sessionId: parsed.currentSession?.id,
    totalRuns: parsed.currentSession?.runs?.length,
    runs: parsed.currentSession?.runs?.map(r => ({
      run: r.runNumber,
      outcome: r.outcome,
      ticks: r.ticks,
      tiles: r.tilesScanned,
      changed: r.changesFromPrevious?.changed
    }))
  }, null, 2));
  
  // Test phone viewport
  console.log('14. Testing phone viewport');
  await page.setViewportSize({ width: 375, height: 667 });
  await page.click('#back-to-build-btn');
  await sleep(500);
  await page.screenshot({ path: `${ARTIFACTS_DIR}/13-phone-build-screen.png` });
  
  console.log('\nManual test complete!');
  console.log('Screenshots saved to:', ARTIFACTS_DIR);
  
  // Save video
  await context.close();
  await browser.close();
  
  console.log('Video saved to /opt/cursor/artifacts/');
}

runManualTest().catch(console.error);
