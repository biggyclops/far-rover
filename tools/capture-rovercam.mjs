import { chromium } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const BASE = 'http://localhost:8080';
const OUT = '/tmp/rovercam-shots';
fs.mkdirSync(OUT, { recursive: true });

async function dismissAutoPause(page) {
  const autoPauseToast = page.locator('.auto-pause-toast:not(.stuck)');
  if (!(await autoPauseToast.isVisible({ timeout: 0 }))) return false;
  const stepBtn = page.locator('#step-btn');
  if (await stepBtn.isVisible({ timeout: 0 }) && await stepBtn.isEnabled()) {
    await stepBtn.click({ force: true });
    return true;
  }
  return false;
}

async function launch(page, cam) {
  await page.goto(`${BASE}/?cam=${cam}&camq=full`);
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.click('#start-btn');
  await page.click('input[data-sensor="distance"]');
  await page.click('input[data-sensor="spectral"]');
  await page.click('input[data-sensor="camera"]');
  await page.selectOption('.condition-select[data-slot="0"]', 'always');
  await page.selectOption('.action-select[data-slot="0"]', 'explore');
  await page.click('#launch-btn');
  await page.waitForFunction(() => {
    const c = document.getElementById('rover-cam-canvas');
    if (!c) return false;
    const d = c.getContext('2d').getImageData(80, 80, 4, 4).data;
    return d[0] + d[1] + d[2] > 80 && window.__orbitalRenderer;
  });
  const auto = page.locator('#autopause-mode');
  if (await auto.count()) {
    try { await auto.selectOption('off'); } catch { /* ignore */ }
  }
}

async function pose(page, col, row, facing) {
  await page.evaluate(({ col, row, facing }) => {
    const renderer = window.__orbitalRenderer;
    if (!renderer) throw new Error('no renderer');
    renderer.anim = null;
    renderer.roverCol = col;
    renderer.roverRow = row;
    const FACE_RAD = { north: -Math.PI / 2, east: 0, south: Math.PI / 2, west: Math.PI };
    renderer.heading = FACE_RAD[facing];
    if (renderer.gameState) {
      renderer.gameState.col = Math.max(0, Math.min(11, Math.round(col)));
      renderer.gameState.row = Math.max(0, Math.min(11, Math.round(row)));
      renderer.gameState.facing = facing;
    }
    renderer.lastCam = 0;
    renderer._camPoseKey = '';
    renderer.render();
  }, { col, row, facing });
  await page.waitForTimeout(140);
}

async function shot(page, name) {
  const buf = await page.locator('#rover-cam-canvas').screenshot({ type: 'png' });
  fs.writeFileSync(path.join(OUT, name), buf);
  console.log('wrote', name);
}

const poses = [
  { file: 'start', col: 5, row: 12, facing: 'north' },
  { file: 'mid', col: 5, row: 10.4, facing: 'north' },
  { file: 'before_f8', col: 5, row: 8.35, facing: 'north' },
  { file: 'lander', col: 5, row: 10.6, facing: 'south' }
];

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 920 } });

for (const cam of ['photo', 'hybrid', '3d']) {
  await launch(page, cam);
  await page.waitForTimeout(280);
  for (const p of poses) {
    await pose(page, p.col, p.row, p.facing);
    await shot(page, `${cam}_${p.file}.png`);
  }
}

await launch(page, 'photo');
await page.waitForTimeout(200);
for (let i = 0; i < 14; i++) {
  const dust = await page.locator('.game-canvas').getAttribute('data-dust-marks');
  const ore = await page.locator('.game-canvas').getAttribute('data-ore-marks');
  if ((dust || '').includes('G10') && (ore || '').includes('G9')) break;
  await dismissAutoPause(page);
  const step = page.locator('#step-btn');
  if (await step.isVisible() && await step.isEnabled()) await step.click({ force: true });
  await page.waitForTimeout(90);
}
await page.waitForTimeout(200);
const board = await page.locator('#map-grid').screenshot({ type: 'png' });
fs.writeFileSync(path.join(OUT, 'orbital_board_ore_dust_markers.png'), board);
console.log('wrote orbital_board_ore_dust_markers.png');
const marks = await page.evaluate(() => {
  const c = document.querySelector('.game-canvas');
  return { ore: c?.dataset?.oreMarks, dust: c?.dataset?.dustMarks };
});
console.log('marks', marks);

await browser.close();
console.log('done', fs.readdirSync(OUT));
