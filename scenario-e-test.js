// Test Scenario E on live URL and take screenshot
import { chromium } from 'playwright';

const BASE_URL = 'https://biggyclops.github.io/far-rover/';
const ARTIFACTS_DIR = '/opt/cursor/artifacts';

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function runScenarioE() {
  console.log('Starting Scenario E test on live URL...');
  
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  
  await page.goto(BASE_URL);
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  
  // Start
  await page.click('#start-btn');
  await sleep(500);
  
  // Select sensors: Distance, Spectral, Camera
  await page.click('input[data-sensor="distance"]');
  await page.click('input[data-sensor="spectral"]');
  await page.click('input[data-sensor="camera"]');
  
  // Rule 1: Battery below 8 → Return and charge
  await page.selectOption('.condition-select[data-slot="0"]', 'battery_below');
  await page.fill('.battery-n[data-slot="0"]', '8');
  await page.selectOption('.action-select[data-slot="0"]', 'return_charge');
  
  // Rule 2: Crater in front → Sidestep
  await page.selectOption('.condition-select[data-slot="1"]', 'crater_in_front');
  await page.selectOption('.action-select[data-slot="1"]', 'sidestep');
  
  // Rule 3: Ore next to rover → Go to ore
  await page.selectOption('.condition-select[data-slot="2"]', 'ore_next_to');
  await page.selectOption('.action-select[data-slot="2"]', 'go_to_ore');
  
  // Rule 4: Always → Explore
  await page.selectOption('.condition-select[data-slot="3"]', 'always');
  await page.selectOption('.action-select[data-slot="3"]', 'explore');
  
  console.log('Rules configured, launching...');
  await page.click('#launch-btn');
  await sleep(500);
  
  // Run at 16x speed
  await page.click('.speed-btn[data-speed="16"]');
  
  // Run until end, resuming from auto-pauses
  let lastTick = 0;
  for (let i = 0; i < 200; i++) {
    await sleep(150);
    
    // Check current tick
    const tickIndicator = page.locator('.tick-indicator');
    if (await tickIndicator.isVisible()) {
      const tickText = await tickIndicator.textContent();
      const tick = parseInt(tickText.replace('Tick ', ''));
      if (tick !== lastTick) {
        lastTick = tick;
        if (tick % 5 === 0) console.log(`Tick ${tick}...`);
      }
    }
    
    const autoPauseBanner = page.locator('.auto-pause-banner');
    if (await autoPauseBanner.isVisible()) {
      const reason = await page.locator('.banner-text').textContent();
      console.log(`Auto-pause at tick ${lastTick}: ${reason}`);
      await page.click('#resume-btn');
      await sleep(200);
      // Re-click speed to make sure we're running
      await page.click('.speed-btn[data-speed="16"]');
      await sleep(100);
      continue;
    }
    
    const stuckBanner = page.locator('.stuck-banner');
    if (await stuckBanner.isVisible()) {
      const reason = await page.locator('.stuck-banner .banner-text').textContent();
      console.log(`Stuck at tick ${lastTick}: ${reason}`);
      await page.screenshot({ path: `${ARTIFACTS_DIR}/scenario-e-stuck.png` });
      await page.click('#end-stuck-btn');
      break;
    }
    
    if (await page.locator('.end-screen').isVisible()) {
      console.log(`End screen reached at tick ${lastTick}`);
      break;
    }
  }
  
  await sleep(500);
  
  // Check if we reached success
  const endScreen = page.locator('.end-screen');
  if (await endScreen.isVisible()) {
    // Take screenshot
    await page.screenshot({ path: `${ARTIFACTS_DIR}/scenario-e-success.png` });
    
    // Extract the values
    const headerText = await page.locator('.end-header h2').textContent();
    const statsText = await page.locator('.end-stats').textContent();
    
    console.log('\n=== SCENARIO E RESULTS ===');
    console.log('Header:', headerText);
    console.log('Stats:', statsText);
    
    // Parse individual stat values
    const statItems = await page.locator('.stat-item').all();
    for (const item of statItems) {
      const label = await item.locator('.stat-label').textContent();
      const value = await item.locator('.stat-value').textContent();
      console.log(`${label} ${value}`);
    }
    
    console.log('\nScreenshot saved to:', `${ARTIFACTS_DIR}/scenario-e-success.png`);
  } else {
    console.log('End screen not visible');
  }
  
  await browser.close();
}

runScenarioE().catch(console.error);
