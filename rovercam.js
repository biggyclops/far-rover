// Pose-true rover-cam modes: photo parallax, hybrid projection, voxel 3D.
// Visual only. NASA/JPL-Caltech/ASU/MSSS Mastcam-Z & Navcam (public domain).

const LANDER_COL = 5;
const LANDER_ROW = 12;
export const CAM_MODES = ['photo', 'hybrid', '3d'];
export const CAM_STORAGE_KEY = 'far-rover-cam-mode';
export const DEFAULT_CAM_MODE = 'photo';

export function resolveCamMode() {
  try {
    const q = new URLSearchParams(location.search).get('cam');
    const n = (q || '').toLowerCase();
    if (n === 'a' || n === 'photo') return 'photo';
    if (n === 'b' || n === 'hybrid') return 'hybrid';
    if (n === 'c' || n === '3d' || n === 'voxel') return '3d';
    const s = localStorage.getItem(CAM_STORAGE_KEY);
    if (CAM_MODES.includes(s)) return s;
  } catch {
    // ignore
  }
  return DEFAULT_CAM_MODE;
}

export function persistCamMode(mode) {
  if (!CAM_MODES.includes(mode)) return;
  try {
    localStorage.setItem(CAM_STORAGE_KEY, mode);
  } catch {
    // ignore
  }
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function wrap(x, m) {
  return ((x % m) + m) % m;
}

function blitWrap(ctx, img, ox, y, dw, dh) {
  if (!img) return;
  const x = wrap(ox, dw);
  ctx.drawImage(img, x - dw, y, dw, dh);
  ctx.drawImage(img, x, y, dw, dh);
}

function lookAt(renderer, tx, ty) {
  const col = renderer.roverCol + 0.5;
  const row = renderer.roverRow + 0.42;
  const h = renderer.heading;
  const fwdC = Math.cos(h);
  const fwdR = Math.sin(h);
  const rightC = -Math.sin(h);
  const rightR = Math.cos(h);
  const dx = tx - col;
  const dy = ty - row;
  return {
    along: dx * fwdC + dy * fwdR,
    side: dx * rightC + dy * rightR,
    dist: Math.hypot(dx, dy)
  };
}

function lookAheadCrater(renderer) {
  let best = null;
  for (const cr of renderer.craterList || []) {
    const hit = lookAt(renderer, cr.c, cr.r);
    if (hit.along < 0.18 || hit.along > 4.2) continue;
    if (Math.abs(hit.side) > 0.7 + hit.along * 0.35) continue;
    if (!best || hit.along < best.along) best = hit;
  }
  return best;
}

function softwareCheap() {
  return typeof navigator !== 'undefined' && !!(navigator.webdriver);
}

function drawSkyPhoto(ctx, renderer, w, h, pan, bob) {
  const sky = renderer.camSky || renderer.mastcamImg;
  const far = renderer.camFar || renderer.mastcamImg;
  const pano = renderer.camPano;
  if (sky) blitWrap(ctx, sky, -pan * 48, -6 + bob * 0.12, w * 1.45, h * 0.44);
  else {
    const g = ctx.createLinearGradient(0, 0, 0, h * 0.4);
    g.addColorStop(0, '#c9a06a');
    g.addColorStop(1, '#e0b888');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h * 0.4);
  }
  if (far) blitWrap(ctx, far, -pan * 96, h * 0.16 + bob * 0.25, w * 1.55, h * 0.44);
  if (pano) {
    ctx.save();
    ctx.globalAlpha = 0.28;
    blitWrap(ctx, pano, -pan * 120, h * 0.2 + bob * 0.2, w * 1.7, h * 0.36);
    ctx.restore();
  }
}

function drawCraterOverlay(ctx, renderer, w, h, horizon) {
  const hit = lookAheadCrater(renderer);
  if (!hit) return hit;
  const dist = Math.max(0.32, hit.along);
  const cx = w / 2 + hit.side * (w * 0.48) / dist;
  const cy = horizon + h * (0.08 + 0.34 / dist);
  const rw = Math.min(w * 0.98, (1.55 / dist) * w * 0.48);
  const rh = Math.min(h * 0.78, (1.25 / dist) * h * 0.42);
  ctx.save();
  ctx.beginPath();
  ctx.ellipse(cx, cy, rw, rh, 0, 0, Math.PI * 2);
  ctx.clip();
  const near = renderer.camNear || renderer.mastcamImg;
  if (near) {
    ctx.drawImage(near, cx - rw * 1.15, cy - rh * 0.85, rw * 2.3, rh * 2.1);
  }
  const bowl = ctx.createRadialGradient(cx, cy + rh * 0.12, rh * 0.08, cx, cy, rh);
  bowl.addColorStop(0, 'rgba(28, 12, 6, 0.72)');
  bowl.addColorStop(0.45, 'rgba(70, 32, 14, 0.38)');
  bowl.addColorStop(0.78, 'rgba(40, 18, 8, 0.18)');
  bowl.addColorStop(1, 'rgba(0, 0, 0, 0)');
  ctx.fillStyle = bowl;
  ctx.fillRect(cx - rw, cy - rh, rw * 2, rh * 2);
  const farWall = ctx.createLinearGradient(cx, cy - rh, cx, cy);
  farWall.addColorStop(0, 'rgba(12, 6, 4, 0.78)');
  farWall.addColorStop(0.55, 'rgba(30, 14, 8, 0.35)');
  farWall.addColorStop(1, 'rgba(0, 0, 0, 0)');
  ctx.fillStyle = farWall;
  ctx.fillRect(cx - rw, cy - rh, rw * 2, rh);
  ctx.restore();
  ctx.save();
  ctx.strokeStyle = 'rgba(210, 170, 130, 0.55)';
  ctx.lineWidth = Math.max(2, 7 / dist);
  ctx.beginPath();
  ctx.ellipse(cx, cy, rw, rh, 0, 0.15, Math.PI - 0.15);
  ctx.stroke();
  ctx.strokeStyle = 'rgba(20, 10, 6, 0.45)';
  ctx.beginPath();
  ctx.ellipse(cx, cy, rw, rh, 0, Math.PI + 0.2, Math.PI * 2 - 0.2);
  ctx.stroke();
  ctx.restore();
  return hit;
}

function drawLanderBillboard(ctx, renderer, w, h, horizon) {
  const hit = lookAt(renderer, LANDER_COL + 0.5, LANDER_ROW + 0.72);
  if (hit.along < 0.35 || hit.along > 5.5) return;
  if (Math.abs(hit.side) > 1.1 + hit.along * 0.4) return;
  const img = renderer.landerFwdImg || renderer.landerImg;
  if (!img) return;
  const z = hit.along;
  const bw = Math.min(w * 0.7, (1.35 / z) * w * 0.42);
  const bh = bw * 1.05;
  const x = w / 2 + (hit.side / z) * w * 0.52 - bw / 2;
  const y = horizon + (0.22 / z) * h - bh * 0.15;
  ctx.save();
  ctx.globalAlpha = 0.96;
  ctx.drawImage(img, x, y, bw, bh);
  ctx.restore();
}

function drawRockBillboards(ctx, renderer, w, h, horizon, craterHit) {
  const img = renderer.camRocks;
  if (!img) return;
  const col = renderer.roverCol;
  const row = renderer.roverRow;
  const hdg = renderer.heading;
  const fwdC = Math.cos(hdg);
  const fwdR = Math.sin(hdg);
  const rightC = -Math.sin(hdg);
  const rightR = Math.cos(hdg);
  for (let i = 0; i < 10; i++) {
    const z = 0.55 + i * 0.42;
    if (craterHit && Math.abs(z - craterHit.along) < 0.55) continue;
    const n = renderer._noiseAt(col * 3.1 + i * 7.2, row * 2.7 + i);
    if (n < 0.28) continue;
    const side = (n - 0.62) * 1.6;
    const wx = col + 0.5 + fwdC * z + rightC * side;
    const wy = row + 0.42 + fwdR * z + rightR * side;
    const sx = w / 2 + side * (w * 0.5) / z;
    const sy = horizon + (0.16 / z) * h + 8;
    const chip = (Math.floor(n * 12) % 4) * 128;
    const rw = (38 + n * 28) / z;
    const rh = rw * 0.72;
    ctx.drawImage(img, chip, 24, 128, 80, sx - rw / 2, sy - rh, rw, rh);
  }
}

function drawHud(ctx, renderer, w, h) {
  ctx.save();
  ctx.strokeStyle = 'rgba(240,244,246,0.55)';
  ctx.lineWidth = 1;
  const cx = w / 2;
  const cy = h / 2;
  ctx.beginPath();
  ctx.moveTo(cx - 12, cy);
  ctx.lineTo(cx - 4, cy);
  ctx.moveTo(cx + 4, cy);
  ctx.lineTo(cx + 12, cy);
  ctx.moveTo(cx, cy - 12);
  ctx.lineTo(cx, cy - 4);
  ctx.moveTo(cx, cy + 4);
  ctx.lineTo(cx, cy + 12);
  ctx.stroke();
  ctx.font = '9px "IBM Plex Mono", ui-monospace, monospace';
  ctx.fillStyle = 'rgba(236, 240, 242, 0.82)';
  const facing = renderer.gameState?.facing || 'north';
  const mode = (renderer.camMode || 'photo').toUpperCase();
  ctx.fillText(`NAVCAM  ${facing.toUpperCase()}  ${mode}`, 8, 14);
  ctx.fillText('SOL 0  14:02:11', 8, h - 8);
  ctx.restore();
}

function drawGrain(ctx, renderer, w, h, t) {
  if (!renderer.grain) return;
  ctx.save();
  ctx.globalAlpha = 0.13;
  const ox = (t * 18) % 64;
  const oy = (t * 11) % 64;
  const pat = ctx.createPattern(renderer.grain, 'repeat');
  ctx.translate(-ox, -oy);
  ctx.fillStyle = pat;
  ctx.fillRect(ox, oy, w + 64, h + 64);
  ctx.restore();
}

function drawPhoto(ctx, renderer, w, h, t) {
  const heading = renderer.heading;
  const pan = heading + Math.PI / 2;
  const moving = !!(renderer.anim && renderer.anim.moving);
  const bob = (moving && !renderer.reduceMotion ? Math.sin(t * 16) * 3.2 : Math.sin(t * 2.1) * 0.8);
  const drive = (renderer.driveU || 0) * 0.12
    + Math.hypot(renderer.roverCol - LANDER_COL, renderer.roverRow - LANDER_ROW) * 0.1;
  ctx.fillStyle = '#2a1c12';
  ctx.fillRect(0, 0, w, h);
  drawSkyPhoto(ctx, renderer, w, h, pan, bob);
  const mid = renderer.camMid || renderer.mastcamImg;
  const near = renderer.camNear || renderer.mastcamImg;
  const alt = renderer.camAlt;
  if (mid) {
    const sc = 1 + Math.min(0.18, drive * 0.04);
    blitWrap(ctx, mid, -pan * 170 - drive * 10, h * 0.34 + bob * 0.55, w * 1.65 * sc, h * 0.5 * sc);
  }
  if (alt) {
    const k = Math.max(0, Math.cos(heading)) * 0.42;
    if (k > 0.04) {
      ctx.save();
      ctx.globalAlpha = k;
      blitWrap(ctx, alt, -pan * 190 - drive * 6, h * 0.22 + bob * 0.4, w * 1.5, h * 0.78);
      ctx.restore();
    }
  }
  if (near) {
    const sc = 1.05 + Math.min(0.28, drive * 0.06);
    blitWrap(ctx, near, -pan * 260 - drive * 22, h * 0.5 + bob * 0.9, w * 1.85 * sc, h * 0.62 * sc);
  }
  const horizon = h * 0.36 + bob * 0.2;
  const craterHit = drawCraterOverlay(ctx, renderer, w, h, horizon);
  drawRockBillboards(ctx, renderer, w, h, horizon, craterHit);
  drawLanderBillboard(ctx, renderer, w, h, horizon);
}

function fillGroundScan(renderer, img, w, h, horizon, eyeH, cheap) {
  if (!renderer.camColor || !img) return;
  const data = img.data;
  const col = renderer.roverCol + 0.5;
  const row = renderer.roverRow + 0.42;
  const heading = renderer.heading;
  const fwdC = Math.cos(heading);
  const fwdR = Math.sin(heading);
  const rightC = -Math.sin(heading);
  const rightR = Math.cos(heading);
  const fov = 1.18;
  const stepX = cheap ? 2 : 1;
  for (let sy = Math.floor(horizon); sy < h; sy += 1) {
    const z = (eyeH * h * 0.78) / Math.max(1.2, sy - horizon);
    if (z > 7.5) continue;
    const mip = z > 3.2 ? 2 : z > 1.6 ? 1 : 0;
    for (let sx = 0; sx < w; sx += stepX) {
      const camX = (sx / w - 0.5) * fov;
      const wx = col + fwdC * z + rightC * camX * z;
      const wy = row + fwdR * z + rightR * camX * z;
      const ht = renderer._heightAt(wx, wy);
      const shade = Math.max(0.45, Math.min(1.15, 0.82 + ht * 0.7));
      let r = renderer._sampleBilinear(renderer.camColor, renderer.hW, wx, wy, 4, 0) * shade;
      let g = renderer._sampleBilinear(renderer.camColor, renderer.hW, wx, wy, 4, 1) * shade;
      let b = renderer._sampleBilinear(renderer.camColor, renderer.hW, wx, wy, 4, 2) * shade;
      if (ht < -0.12) {
        const k = Math.min(1, (-ht - 0.12) / 0.55);
        r *= 1 - 0.55 * k;
        g *= 1 - 0.45 * k;
        b *= 1 - 0.25 * k;
      }
      const fog = Math.min(1, z / 6.5);
      r = r + (210 - r) * fog * 0.5;
      g = g + (168 - g) * fog * 0.5;
      b = b + (110 - b) * fog * 0.5;
      const i = (sy * w + sx) * 4;
      data[i] = r;
      data[i + 1] = g;
      data[i + 2] = b;
      data[i + 3] = 255;
      if (stepX === 2 && sx + 1 < w) {
        data[i + 4] = r;
        data[i + 5] = g;
        data[i + 6] = b;
        data[i + 7] = 255;
      }
    }
  }
}

function drawHybrid(ctx, renderer, w, h, t) {
  const heading = renderer.heading;
  const pan = heading + Math.PI / 2;
  const moving = !!(renderer.anim && renderer.anim.moving);
  const bob = (moving && !renderer.reduceMotion ? Math.sin(t * 16) * 2.4 : 0.5);
  const eyeH = 0.17 + (moving ? Math.sin(t * 16) * 0.01 : 0);
  const horizon = h * 0.36 + bob * 0.15;
  ctx.fillStyle = '#2a1c12';
  ctx.fillRect(0, 0, w, h);
  drawSkyPhoto(ctx, renderer, w, h, pan, bob);
  const frame = ctx.getImageData(0, 0, w, h);
  fillGroundScan(renderer, frame, w, h, horizon, eyeH, softwareCheap());
  ctx.putImageData(frame, 0, 0);
  const craterHit = drawCraterOverlay(ctx, renderer, w, h, horizon);
  drawRockBillboards(ctx, renderer, w, h, horizon, craterHit);
  drawLanderBillboard(ctx, renderer, w, h, horizon);
}

function drawVoxel(ctx, renderer, w, h, t) {
  const cheap = softwareCheap();
  const cw = w;
  const ch = h;
  const moving = !!(renderer.anim && renderer.anim.moving);
  const bob = (moving && !renderer.reduceMotion) ? Math.sin(t * 17) * 0.012 : 0;
  const eyeH = 0.18 + bob;
  const horizon = ch * 0.36;
  const zNear = 0.08;
  const zFar = 6.6;
  const steps = cheap ? 42 : 88;
  const fov = 1.2;
  const col = renderer.roverCol + 0.5;
  const row = renderer.roverRow + 0.42;
  const heading = renderer.heading;
  const fwdC = Math.cos(heading);
  const fwdR = Math.sin(heading);
  const rightC = -Math.sin(heading);
  const rightR = Math.cos(heading);
  const sky = ctx.createLinearGradient(0, 0, 0, ch);
  sky.addColorStop(0, '#c4a070');
  sky.addColorStop(0.45, '#e0b888');
  sky.addColorStop(1, '#c99664');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, cw, ch);
  if (renderer.camSky) {
    ctx.save();
    ctx.globalAlpha = 0.55;
    blitWrap(ctx, renderer.camSky, -(heading + Math.PI / 2) * 50, -4, cw * 1.4, ch * 0.4);
    ctx.restore();
  }
  const img = ctx.getImageData(0, 0, cw, ch);
  const data = img.data;
  const ybuf = new Int16Array(cw);
  ybuf.fill(ch);
  for (let i = 0; i < steps; i++) {
    const u = i / (steps - 1);
    const z = zNear + (zFar - zNear) * u * u;
    for (let x = 0; x < cw; x++) {
      const camX = (x / cw - 0.5) * fov;
      const wx = col + fwdC * z + rightC * camX * z;
      const wy = row + fwdR * z + rightR * camX * z;
      const ht = renderer._heightAt(wx, wy);
      const sy = horizon - ((ht - eyeH) / z) * ch * 0.95;
      const y0 = sy < 0 ? 0 : sy > ch ? ch : (sy | 0);
      if (y0 >= ybuf[x]) continue;
      let r = renderer._sampleBilinear(renderer.camColor, renderer.hW, wx, wy, 4, 0);
      let g = renderer._sampleBilinear(renderer.camColor, renderer.hW, wx, wy, 4, 1);
      let b = renderer._sampleBilinear(renderer.camColor, renderer.hW, wx, wy, 4, 2);
      const hx = renderer._heightAt(wx + 0.06, wy) - renderer._heightAt(wx - 0.06, wy);
      const shade = Math.max(0.35, Math.min(1.2, 0.78 - hx * 3.4));
      r *= shade;
      g *= shade;
      b *= shade;
      if (ht < -0.1) {
        const k = Math.min(1, (-ht - 0.1) / 0.55);
        r *= 1 - 0.52 * k;
        g *= 1 - 0.42 * k;
        b *= 1 - 0.22 * k;
      }
      const fog = Math.min(1, z / 6.4);
      r = r + (210 - r) * fog * 0.5;
      g = g + (168 - g) * fog * 0.5;
      b = b + (110 - b) * fog * 0.5;
      const ir = r | 0;
      const ig = g | 0;
      const ib = b | 0;
      for (let y = y0; y < ybuf[x]; y++) {
        const p = (y * cw + x) * 4;
        data[p] = ir;
        data[p + 1] = ig;
        data[p + 2] = ib;
        data[p + 3] = 255;
      }
      ybuf[x] = y0;
    }
  }
  ctx.putImageData(img, 0, 0);
  const craterHit = lookAheadCrater(renderer);
  drawRockBillboards(ctx, renderer, w, h, horizon, craterHit);
  drawLanderBillboard(ctx, renderer, w, h, horizon);
}

export function drawRoverCam(renderer, now, t) {
  const canvas = document.getElementById('rover-cam-canvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const w = canvas.width;
  const h = canvas.height;
  const mode = renderer.camMode || DEFAULT_CAM_MODE;
  const cheap = softwareCheap();
  const minDt = cheap ? 70 : ((renderer.playbackSpeed || 1) >= 16 ? 40 : 28);
  if (now - (renderer.lastCam || 0) < minDt && renderer.lastCam) {
    return;
  }
  renderer.lastCam = now;
  ctx.save();
  if (mode === 'hybrid') drawHybrid(ctx, renderer, w, h, t);
  else if (mode === '3d') drawVoxel(ctx, renderer, w, h, t);
  else drawPhoto(ctx, renderer, w, h, t);
  ctx.globalAlpha = 0.1;
  const vg = ctx.createLinearGradient(0, 0, 0, h);
  vg.addColorStop(0, '#000');
  vg.addColorStop(0.4, 'transparent');
  vg.addColorStop(1, '#1a1008');
  ctx.fillStyle = vg;
  ctx.fillRect(0, 0, w, h);
  ctx.globalAlpha = 1;
  drawGrain(ctx, renderer, w, h, t);
  drawHud(ctx, renderer, w, h);
  ctx.restore();
}

export default { drawRoverCam, resolveCamMode, persistCamMode, CAM_MODES, DEFAULT_CAM_MODE };
