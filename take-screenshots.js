const { chromium } = require('playwright');

async function main() {
  const baseUrl = 'https://biggyclops.github.io/far-rover/';
  const browser = await chromium.launch({ headless: true });
  
  // Desktop viewport 1280x800
  const desktopContext = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const desktopPage = await desktopContext.newPage();
  
  console.log('Loading page at', baseUrl);
  await desktopPage.goto(baseUrl, { waitUntil: 'networkidle', timeout: 30000 });
  await desktopPage.waitForTimeout(2000);
  
  // Take title screen screenshot
  await desktopPage.screenshot({ path: '/opt/cursor/artifacts/screenshots/title-screen-desktop.png' });
  console.log('Title screen captured');
  
  // Go to build screen
  await desktopPage.click('#start-btn');
  await desktopPage.waitForTimeout(1000);
  await desktopPage.screenshot({ path: '/opt/cursor/artifacts/screenshots/build-screen-desktop.png' });
  console.log('Build screen captured');
  
  // Setup starter preset (Di, Sp, Ca)
  await desktopPage.click('#starter-preset-btn');
  await desktopPage.waitForTimeout(500);
  await desktopPage.screenshot({ path: '/opt/cursor/artifacts/screenshots/build-starter-desktop.png' });
  console.log('Build with starter preset captured');
  
  // Launch
  await desktopPage.click('#launch-btn');
  await desktopPage.waitForTimeout(1000);
  
  // Step a few times to get some tiles revealed
  for (let i = 0; i < 8; i++) {
    try {
      await desktopPage.click('#step-btn');
      await desktopPage.waitForTimeout(200);
    } catch (e) {
      // May hit auto-pause, click resume
      const resume = await desktopPage.$('#resume-btn');
      if (resume) {
        await resume.click();
        await desktopPage.waitForTimeout(200);
      }
      await desktopPage.click('#step-btn');
      await desktopPage.waitForTimeout(200);
    }
  }
  await desktopPage.screenshot({ path: '/opt/cursor/artifacts/screenshots/gameplay-mid-run-desktop.png' });
  console.log('Mid-run desktop captured');
  
  // Run to completion (tick 46 win)
  await desktopPage.evaluate(() => {
    const speedBtns = document.querySelectorAll('.speed-btn');
    for (const btn of speedBtns) {
      if (btn.dataset.speed === '16') btn.click();
    }
  });
  
  // Wait for outcome
  for (let i = 0; i < 100; i++) {
    const endScreen = await desktopPage.$('.end-screen');
    if (endScreen) break;
    await desktopPage.waitForTimeout(500);
    
    // Handle auto-pause
    const resume = await desktopPage.$('#resume-btn');
    if (resume) {
      await resume.click();
      await desktopPage.waitForTimeout(200);
    }
  }
  await desktopPage.waitForTimeout(1000);
  await desktopPage.screenshot({ path: '/opt/cursor/artifacts/screenshots/end-screen-win-desktop.png' });
  console.log('Win end screen captured');
  
  // Rerun and do first-minute story (Di, Du, Sp -> F8 crater loss)
  await desktopPage.click('#rerun-btn');
  await desktopPage.waitForTimeout(1000);
  
  // Change sensors to Di, Du, Sp
  await desktopPage.click('input[data-sensor="camera"]'); // uncheck camera
  await desktopPage.click('input[data-sensor="dust"]');   // check dust
  await desktopPage.waitForTimeout(500);
  
  // Set rules for first-minute: Always→Explore (crater crash)
  // Just use explore with distance check
  await desktopPage.selectOption('.condition-select[data-slot="0"]', '');
  await desktopPage.selectOption('.action-select[data-slot="0"]', '');
  await desktopPage.selectOption('.condition-select[data-slot="0"]', 'always');
  await desktopPage.selectOption('.action-select[data-slot="0"]', 'explore');
  await desktopPage.selectOption('.condition-select[data-slot="1"]', '');
  await desktopPage.selectOption('.action-select[data-slot="1"]', '');
  await desktopPage.selectOption('.condition-select[data-slot="2"]', '');
  await desktopPage.selectOption('.action-select[data-slot="2"]', '');
  await desktopPage.selectOption('.condition-select[data-slot="3"]', '');
  await desktopPage.selectOption('.action-select[data-slot="3"]', '');
  await desktopPage.waitForTimeout(500);
  
  await desktopPage.click('#launch-btn');
  await desktopPage.waitForTimeout(1000);
  
  // Run to tick 5 crater loss
  for (let i = 0; i < 10; i++) {
    const endScreen = await desktopPage.$('.end-screen');
    if (endScreen) break;
    
    try {
      await desktopPage.click('#step-btn');
      await desktopPage.waitForTimeout(300);
    } catch (e) {
      const resume = await desktopPage.$('#resume-btn');
      if (resume) {
        await resume.click();
        await desktopPage.waitForTimeout(200);
      }
    }
  }
  await desktopPage.waitForTimeout(500);
  await desktopPage.screenshot({ path: '/opt/cursor/artifacts/screenshots/end-screen-loss-desktop.png' });
  console.log('Loss end screen captured');
  
  // Mobile viewport 390x844
  const mobileContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const mobilePage = await mobileContext.newPage();
  await mobilePage.goto(baseUrl, { waitUntil: 'networkidle', timeout: 30000 });
  await mobilePage.waitForTimeout(2000);
  
  await mobilePage.click('#start-btn');
  await mobilePage.waitForTimeout(1000);
  await mobilePage.click('#starter-preset-btn');
  await mobilePage.waitForTimeout(500);
  await mobilePage.click('#launch-btn');
  await mobilePage.waitForTimeout(1000);
  
  // Step a few times
  for (let i = 0; i < 5; i++) {
    try {
      await mobilePage.click('#step-btn');
      await mobilePage.waitForTimeout(200);
    } catch (e) {
      const resume = await mobilePage.$('#resume-btn');
      if (resume) {
        await resume.click();
        await mobilePage.waitForTimeout(200);
      }
      try { await mobilePage.click('#step-btn'); } catch {}
      await mobilePage.waitForTimeout(200);
    }
  }
  await mobilePage.screenshot({ path: '/opt/cursor/artifacts/screenshots/gameplay-mid-run-mobile.png' });
  console.log('Mid-run mobile captured');
  
  await browser.close();
  console.log('All screenshots captured!');
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
