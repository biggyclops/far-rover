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

function softwareCheap() {
  try {
    if (new URLSearchParams(location.search).get('camq') === 'full') return false;
  } catch {
    // ignore
  }
  if (typeof navigator !== 'undefined' && navigator.webdriver) return true;
  if (typeof window !== 'undefined' && window.innerWidth < 700) return true;
  return false;
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
    if (hit.along < 0.12 || hit.along > 5.6) continue;
    if (Math.abs(hit.side) > 0.85 + hit.along * 0.38) continue;
    if (!best || hit.along < best.along) best = hit;
  }
  return best;
}

function pixelsOf(img) {
  if (!img) return null;
  const w = img.naturalWidth || img.width;
  const h = img.naturalHeight || img.height;
  if (!w || !h) return null;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0, w, h);
  return { data: ctx.getImageData(0, 0, w, h).data, w, h };
}

function makeMip(src) {
  const w = Math.max(1, src.w >> 1);
  const h = Math.max(1, src.h >> 1);
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const x0 = Math.min(src.w - 1, x * 2);
      const y0 = Math.min(src.h - 1, y * 2);
      const x1 = Math.min(src.w - 1, x0 + 1);
      const y1 = Math.min(src.h - 1, y0 + 1);
      const i00 = (y0 * src.w + x0) * 4;
      const i10 = (y0 * src.w + x1) * 4;
      const i01 = (y1 * src.w + x0) * 4;
      const i11 = (y1 * src.w + x1) * 4;
      const o = (y * w + x) * 4;
      data[o] = (src.data[i00] + src.data[i10] + src.data[i01] + src.data[i11]) >> 2;
      data[o + 1] = (src.data[i00 + 1] + src.data[i10 + 1] + src.data[i01 + 1] + src.data[i11 + 1]) >> 2;
      data[o + 2] = (src.data[i00 + 2] + src.data[i10 + 2] + src.data[i01 + 2] + src.data[i11 + 2]) >> 2;
      data[o + 3] = 255;
    }
  }
  return { data, w, h };
}

function ensurePhotoTex(renderer) {
  if (renderer._camTexReady) return renderer._camTex;
  const src = pixelsOf(renderer.camNear || renderer.mastcamImg);
  if (!src) return null;
  const mip1 = makeMip(src);
  const mip2 = makeMip(mip1);
  renderer._camTex = [src, mip1, mip2];
  renderer._camTexReady = true;
  return renderer._camTex;
}

function sampleWrap(tex, u, v) {
  const x = wrap(u, tex.w) | 0;
  const y = wrap(v, tex.h) | 0;
  const i = (y * tex.w + x) * 4;
  return [tex.data[i], tex.data[i + 1], tex.data[i + 2]];
}

function camBuf(renderer, bw, bh) {
  if (!renderer._camOff || renderer._camOff.width !== bw || renderer._camOff.height !== bh) {
    renderer._camOff = document.createElement('canvas');
    renderer._camOff.width = bw;
    renderer._camOff.height = bh;
    renderer._camOffCtx = renderer._camOff.getContext('2d', { willReadFrequently: true });
    renderer._camImg = renderer._camOffCtx.createImageData(bw, bh);
  }
  if (!renderer._camImg || renderer._camImg.width !== bw) {
    renderer._camImg = renderer._camOffCtx.createImageData(bw, bh);
  }
  return { canvas: renderer._camOff, ctx: renderer._camOffCtx, img: renderer._camImg, bw, bh };
}

function drawSkyPhoto(ctx, renderer, w, h, pan, bob) {
  const sky = renderer.camSky || renderer.mastcamImg;
  const far = renderer.camFar || renderer.mastcamImg;
  const pano = renderer.camPano;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  if (sky) blitWrap(ctx, sky, -pan * 52, -2 + bob * 0.12, w * 1.35, h * 0.42);
  else {
    const g = ctx.createLinearGradient(0, 0, 0, h * 0.4);
    g.addColorStop(0, '#d7b07a');
    g.addColorStop(1, '#e4c094');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h * 0.4);
  }
  if (far) blitWrap(ctx, far, -pan * 110, h * 0.14 + bob * 0.25, w * 1.5, h * 0.46);
  if (pano) {
    ctx.save();
    ctx.globalAlpha = 0.22;
    blitWrap(ctx, pano, -pan * 140, h * 0.2 + bob * 0.2, w * 1.65, h * 0.34);
    ctx.restore();
  }
}

function drawCraterOverlay(ctx, renderer, w, h, horizon) {
  const hit = lookAheadCrater(renderer);
  if (!hit) return hit;
  const dist = Math.max(0.28, hit.along);
  const grow = Math.min(1, 1.7 / dist);
  const cx = w / 2 + hit.side * (w * 0.5) / dist;
  const cy = horizon + h * (0.05 + 0.38 / dist);
  const rw = Math.min(w * 1.02, grow * w * 0.52);
  const rh = Math.min(h * 0.82, grow * h * 0.44);
  ctx.save();
  ctx.beginPath();
  ctx.ellipse(cx, cy, rw, rh, 0, 0, Math.PI * 2);
  ctx.clip();
  const near = renderer.camNear || renderer.mastcamImg;
  if (near) {
    ctx.drawImage(near, cx - rw * 1.2, cy - rh * 0.9, rw * 2.4, rh * 2.2);
  }
  const bowl = ctx.createRadialGradient(cx, cy + rh * 0.18, rh * 0.06, cx, cy, rh);
  bowl.addColorStop(0, 'rgba(18, 8, 4, 0.82)');
  bowl.addColorStop(0.42, 'rgba(58, 26, 12, 0.46)');
  bowl.addColorStop(0.76, 'rgba(36, 16, 8, 0.2)');
  bowl.addColorStop(1, 'rgba(0, 0, 0, 0)');
  ctx.fillStyle = bowl;
  ctx.fillRect(cx - rw, cy - rh, rw * 2, rh * 2);
  const farWall = ctx.createLinearGradient(cx, cy - rh, cx, cy + rh * 0.1);
  farWall.addColorStop(0, 'rgba(8, 4, 2, 0.88)');
  farWall.addColorStop(0.45, 'rgba(28, 12, 6, 0.5)');
  farWall.addColorStop(1, 'rgba(0, 0, 0, 0)');
  ctx.fillStyle = farWall;
  ctx.fillRect(cx - rw, cy - rh, rw * 2, rh * 1.05);
  ctx.restore();
  ctx.save();
  ctx.strokeStyle = 'rgba(214, 176, 136, 0.6)';
  ctx.lineWidth = Math.max(2, 8 / dist);
  ctx.beginPath();
  ctx.ellipse(cx, cy, rw, rh, 0, 0.12, Math.PI - 0.12);
  ctx.stroke();
  ctx.strokeStyle = 'rgba(16, 8, 4, 0.55)';
  ctx.beginPath();
  ctx.ellipse(cx, cy, rw, rh, 0, Math.PI + 0.18, Math.PI * 2 - 0.18);
  ctx.stroke();
  ctx.restore();
  return hit;
}

function drawLanderBillboard(ctx, renderer, w, h, horizon) {
  const hit = lookAt(renderer, LANDER_COL + 0.5, LANDER_ROW + 0.72);
  if (hit.along < 0.55 || hit.along > 5.6 || hit.dist < 0.8) return;
  if (Math.abs(hit.side) > 1.05 + hit.along * 0.38) return;
  const img = renderer.landerFwdImg || renderer.landerImg;
  if (!img) return;
  const z = hit.along;
  const bw = Math.min(w * 0.72, (1.4 / z) * w * 0.44);
  const bh = bw * 1.05;
  const x = w / 2 + (hit.side / z) * w * 0.52 - bw / 2;
  const y = horizon + (0.2 / z) * h - bh * 0.12;
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
    const z = 0.5 + i * 0.4;
    if (craterHit && Math.abs(z - craterHit.along) < 0.5) continue;
    const n = renderer._noiseAt(col * 3.1 + i * 7.2, row * 2.7 + i);
    if (n < 0.28) continue;
    const side = (n - 0.62) * 1.55;
    const sx = w / 2 + side * (w * 0.5) / z;
    const sy = horizon + (0.15 / z) * h + 8;
    const chip = (Math.floor(n * 12) % 4) * 128;
    const rw = (40 + n * 30) / z;
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

function driveAmt(renderer) {
  return (renderer.driveU || 0)
    + Math.hypot(renderer.roverCol - LANDER_COL, renderer.roverRow - LANDER_ROW);
}

function drawPhoto(ctx, renderer, w, h, t) {
  const heading = renderer.heading;
  const pan = heading + Math.PI / 2;
  const moving = !!(renderer.anim && renderer.anim.moving);
  const bob = (moving && !renderer.reduceMotion ? Math.sin(t * 16) * 3.2 : Math.sin(t * 2.1) * 0.8);
  const drive = driveAmt(renderer);
  ctx.fillStyle = '#2a1c12';
  ctx.fillRect(0, 0, w, h);
  drawSkyPhoto(ctx, renderer, w, h, pan, bob);
  const mid = renderer.camMid || renderer.mastcamImg;
  const near = renderer.camNear || renderer.mastcamImg;
  const alt = renderer.camAlt;
  if (mid) {
    const sc = 1 + Math.min(0.22, drive * 0.045);
    blitWrap(ctx, mid, -pan * 180 - drive * 36, h * 0.32 + bob * 0.55, w * 1.62 * sc, h * 0.52 * sc);
  }
  if (alt) {
    const k = Math.max(0, Math.cos(heading)) * 0.4;
    if (k > 0.04) {
      ctx.save();
      ctx.globalAlpha = k;
      blitWrap(ctx, alt, -pan * 200 - drive * 10, h * 0.2 + bob * 0.4, w * 1.48, h * 0.8);
      ctx.restore();
    }
  }
  if (near) {
    const sc = 1.06 + Math.min(0.32, drive * 0.07);
    blitWrap(ctx, near, -pan * 280 - drive * 88, h * 0.46 + bob * 0.95 - drive * 7, w * 1.88 * sc, h * 0.64 * sc);
  }
  const horizon = h * 0.34 + bob * 0.2;
  const craterHit = drawCraterOverlay(ctx, renderer, w, h, horizon);
  drawRockBillboards(ctx, renderer, w, h, horizon, craterHit);
  drawLanderBillboard(ctx, renderer, w, h, horizon);
}

function shadeGround(renderer, wx, wy, fwdC, fwdR, r, g, b, z) {
  if (!renderer.heightArr) {
    const fog = Math.min(1, z / 6.4);
    return [
      r + (210 - r) * fog * 0.42,
      g + (168 - g) * fog * 0.42,
      b + (110 - b) * fog * 0.42
    ];
  }
  const ht = renderer._heightAt(wx, wy);
  const htF = renderer._heightAt(wx + fwdC * 0.1, wy + fwdR * 0.1);
  const hx = renderer._heightAt(wx + 0.06, wy) - renderer._heightAt(wx - 0.06, wy);
  let shade = Math.max(0.38, Math.min(1.18, 0.8 - hx * 3.1));
  if (ht < -0.08) {
    const k = Math.min(1, (-ht - 0.08) / 0.55);
    shade *= 1 - 0.48 * k;
    if (htF > ht + 0.012) shade *= 0.55;
  }
  r *= shade;
  g *= shade;
  b *= shade;
  const fog = Math.min(1, z / 6.4);
  r = r + (210 - r) * fog * 0.45;
  g = g + (168 - g) * fog * 0.45;
  b = b + (110 - b) * fog * 0.45;
  return [r, g, b];
}

function floorCast(renderer, img, bw, bh, horizonY, eyeH, cheap) {
  const mips = ensurePhotoTex(renderer);
  if (!mips) return false;
  const data = img.data;
  data.fill(0);
  const col = renderer.roverCol + 0.5;
  const row = renderer.roverRow + 0.42;
  const heading = renderer.heading;
  const fwdC = Math.cos(heading);
  const fwdR = Math.sin(heading);
  const rightC = -Math.sin(heading);
  const rightR = Math.cos(heading);
  const fov = 1.16;
  const stepX = cheap ? 2 : 1;
  const y0 = Math.max(0, Math.floor(horizonY));
  for (let sy = 0; sy < bh; sy++) {
    if (sy < y0) {
      for (let sx = 0; sx < bw; sx++) {
        const i = (sy * bw + sx) * 4;
        data[i + 3] = 0;
      }
      continue;
    }
    const z = (eyeH * bh * 0.82) / Math.max(1.15, sy - horizonY);
    if (z > 7.4) continue;
    const mip = z > 3.1 ? 2 : z > 1.55 ? 1 : 0;
    const tex = mips[cheap ? Math.min(2, mip + 1) : mip];
    for (let sx = 0; sx < bw; sx += stepX) {
      const camX = (sx / bw - 0.5) * fov;
      const wx = col + fwdC * z + rightC * camX * z;
      const wy = row + fwdR * z + rightR * camX * z;
      const u = wx * 118 + heading * 70;
      const v = wy * 92 + 40;
      let [r, g, b] = sampleWrap(tex, u, v);
      [r, g, b] = shadeGround(renderer, wx, wy, fwdC, fwdR, r, g, b, z);
      const i = (sy * bw + sx) * 4;
      data[i] = r;
      data[i + 1] = g;
      data[i + 2] = b;
      data[i + 3] = 255;
      if (stepX === 2 && sx + 1 < bw) {
        data[i + 4] = r;
        data[i + 5] = g;
        data[i + 6] = b;
        data[i + 7] = 255;
      }
    }
  }
  return true;
}

function drawHybrid(ctx, renderer, w, h, t) {
  const cheap = softwareCheap();
  const heading = renderer.heading;
  const pan = heading + Math.PI / 2;
  const moving = !!(renderer.anim && renderer.anim.moving);
  const bob = (moving && !renderer.reduceMotion ? Math.sin(t * 16) * 2.4 : 0.5);
  const drive = driveAmt(renderer);
  const eyeH = 0.17 + (moving ? Math.sin(t * 16) * 0.01 : 0);
  const horizon = h * 0.34 + bob * 0.15;
  ctx.fillStyle = '#2a1c12';
  ctx.fillRect(0, 0, w, h);
  drawSkyPhoto(ctx, renderer, w, h, pan + drive * 0.08, bob);
  const scale = cheap ? 4 : 2;
  const bw = Math.max(120, Math.round(w / scale));
  const bh = Math.max(68, Math.round(h / scale));
  const buf = camBuf(renderer, bw, bh);
  const hz = horizon * (bh / h);
  if (floorCast(renderer, buf.img, bw, bh, hz, eyeH, cheap)) {
    buf.ctx.putImageData(buf.img, 0, 0);
    ctx.save();
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = cheap ? 'medium' : 'high';
    ctx.drawImage(buf.canvas, 0, 0, w, h);
    ctx.restore();
  } else {
    const near = renderer.camNear || renderer.mastcamImg;
    if (near) blitWrap(ctx, near, -pan * 220 - drive * 55, h * 0.48 + bob, w * 1.7, h * 0.58);
  }
  const craterHit = drawCraterOverlay(ctx, renderer, w, h, horizon);
  drawRockBillboards(ctx, renderer, w, h, horizon, craterHit);
  drawLanderBillboard(ctx, renderer, w, h, horizon);
}

function drawVoxel(ctx, renderer, w, h, t) {
  const cheap = softwareCheap();
  const scale = cheap ? 3 : 1;
  const cw = Math.max(160, Math.round(w / scale));
  const ch = Math.max(90, Math.round(h / scale));
  const moving = !!(renderer.anim && renderer.anim.moving);
  const bob = (moving && !renderer.reduceMotion) ? Math.sin(t * 17) * 0.012 : 0;
  const eyeH = 0.18 + bob;
  const horizon = ch * 0.34;
  const zNear = 0.08;
  const zFar = 6.6;
  const steps = cheap ? 28 : 88;
  const fov = 1.2;
  const col = renderer.roverCol + 0.5;
  const row = renderer.roverRow + 0.42;
  const heading = renderer.heading;
  const fwdC = Math.cos(heading);
  const fwdR = Math.sin(heading);
  const rightC = -Math.sin(heading);
  const rightR = Math.cos(heading);
  const pan = heading + Math.PI / 2;
  ctx.fillStyle = '#c9a070';
  ctx.fillRect(0, 0, w, h);
  drawSkyPhoto(ctx, renderer, w, h, pan, bob * 40);
  const buf = camBuf(renderer, cw, ch);
  const img = buf.img;
  const data = img.data;
  data.fill(0);
  const mips = ensurePhotoTex(renderer);
  const ybuf = new Int16Array(cw);
  ybuf.fill(ch);
  for (let i = 0; i < steps; i++) {
    const u = i / (steps - 1);
    const z = zNear + (zFar - zNear) * u * u;
    const mip = z > 3.1 ? 2 : z > 1.55 ? 1 : 0;
    const tex = mips ? mips[cheap ? Math.min(2, mip + 1) : mip] : null;
    for (let x = 0; x < cw; x++) {
      const camX = (x / cw - 0.5) * fov;
      const wx = col + fwdC * z + rightC * camX * z;
      const wy = row + fwdR * z + rightR * camX * z;
      const ht = renderer._heightAt(wx, wy);
      const sy = horizon - ((ht - eyeH) / z) * ch * 0.95;
      const y0 = sy < 0 ? 0 : sy > ch ? ch : (sy | 0);
      if (y0 >= ybuf[x]) continue;
      let r;
      let g;
      let b;
      if (tex) {
        [r, g, b] = sampleWrap(tex, wx * 118 + heading * 70, wy * 92 + 40);
      } else if (renderer.camColor) {
        r = renderer._sampleBilinear(renderer.camColor, renderer.hW, wx, wy, 4, 0);
        g = renderer._sampleBilinear(renderer.camColor, renderer.hW, wx, wy, 4, 1);
        b = renderer._sampleBilinear(renderer.camColor, renderer.hW, wx, wy, 4, 2);
      } else {
        r = 168; g = 118; b = 72;
      }
      [r, g, b] = shadeGround(renderer, wx, wy, fwdC, fwdR, r, g, b, z);
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
  buf.ctx.putImageData(img, 0, 0);
  ctx.save();
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = cheap ? 'medium' : 'high';
  ctx.drawImage(buf.canvas, 0, 0, w, h);
  ctx.restore();
  const craterHit = lookAheadCrater(renderer);
  drawCraterOverlay(ctx, renderer, w, h, h * 0.34);
  drawRockBillboards(ctx, renderer, w, h, h * 0.34, craterHit);
  drawLanderBillboard(ctx, renderer, w, h, h * 0.34);
}

export function drawRoverCam(renderer, now, t) {
  const canvas = document.getElementById('rover-cam-canvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const w = canvas.width;
  const h = canvas.height;
  const mode = renderer.camMode || DEFAULT_CAM_MODE;
  const cheap = softwareCheap();
  const poseKey = `${mode}|${renderer.roverCol.toFixed(2)}|${renderer.roverRow.toFixed(2)}|${renderer.heading.toFixed(3)}|${(renderer.driveU || 0).toFixed(2)}`;
  const poseChanged = poseKey !== renderer._camPoseKey;
  const minDt = cheap ? 48 : ((renderer.playbackSpeed || 1) >= 16 ? 40 : 28);
  if (!poseChanged && now - (renderer.lastCam || 0) < minDt && renderer.lastCam) {
    return;
  }
  renderer.lastCam = now;
  renderer._camPoseKey = poseKey;
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
