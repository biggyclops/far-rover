import { chromium } from 'playwright';

async function main() {
  const baseUrl = 'https://biggyclops.github.io/far-rover/';
  const browser = await chromium.launch({ headless: true });
  
  // First-minute story (Di, Du, Sp -> F8 crater loss on tick 5)
  console.log('Starting first-minute scenario...');
  const lossContext = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const lossPage = await lossContext.newPage();
  await lossPage.goto(baseUrl, { waitUntil: 'networkidle', timeout: 30000 });
  await lossPage.waitForTimeout(2000);
  
  await lossPage.click('#start-btn');
  await lossPage.waitForTimeout(500);
  
  // Select Di, Du, Sp sensors
  await lossPage.click('input[data-sensor="distance"]');
  await lossPage.click('input[data-sensor="dust"]');
  await lossPage.click('input[data-sensor="spectral"]');
  await lossPage.waitForTimeout(300);
  
  // Set rule: Always→Explore (will crash into crater)
  await lossPage.selectOption('.condition-select[data-slot="0"]', 'always');
  await lossPage.selectOption('.action-select[data-slot="0"]', 'explore');
  await lossPage.waitForTimeout(300);
  
  await lossPage.click('#launch-btn');
  await lossPage.waitForTimeout(1000);
  
  // Run until end (tick 5 crash)
  for (let i = 0; i < 10; i++) {
    const endScreen = await lossPage.$('.end-screen');
    if (endScreen) break;
    
    try {
      const stepBtn = await lossPage.$('#step-btn');
      if (stepBtn) {
        await stepBtn.click();
        await lossPage.waitForTimeout(300);
      }
    } catch (e) {}
    
    const resume = await lossPage.$('#resume-btn');
    if (resume) {
      await resume.click();
      await lossPage.waitForTimeout(200);
    }
  }
  
  await lossPage.waitForTimeout(500);
  await lossPage.screenshot({ path: '/opt/cursor/artifacts/screenshots/end-screen-loss-desktop.png' });
  console.log('Loss end screen captured');
  await lossContext.close();
  
  // Mobile viewport 390x844
  console.log('Starting mobile screenshot...');
  const mobileContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const mobilePage = await mobileContext.newPage();
  await mobilePage.goto(baseUrl, { waitUntil: 'networkidle', timeout: 30000 });
  await mobilePage.waitForTimeout(2000);
  
  await mobilePage.click('#start-btn');
  await mobilePage.waitForTimeout(500);
  await mobilePage.click('#starter-preset-btn');
  await mobilePage.waitForTimeout(500);
  await mobilePage.click('#launch-btn');
  await mobilePage.waitForTimeout(1000);
  
  // Step a few times
  for (let i = 0; i < 5; i++) {
    try {
      const stepBtn = await mobilePage.$('#step-btn');
      if (stepBtn) {
        await stepBtn.click();
        await mobilePage.waitForTimeout(200);
      }
    } catch (e) {}
    
    const resume = await mobilePage.$('#resume-btn');
    if (resume) {
      await resume.click();
      await mobilePage.waitForTimeout(200);
    }
  }
  await mobilePage.screenshot({ path: '/opt/cursor/artifacts/screenshots/gameplay-mid-run-mobile-new.png' });
  console.log('Mobile mid-run captured');
  
  await browser.close();
  console.log('All remaining screenshots captured!');
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
