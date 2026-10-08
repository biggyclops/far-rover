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

function fadeScratch(renderer, dw, dh) {
  const w = Math.max(8, Math.ceil(dw));
  const h = Math.max(8, Math.ceil(dh));
  if (!renderer._fadeOff || renderer._fadeOff.width !== w || renderer._fadeOff.height !== h) {
    renderer._fadeOff = document.createElement('canvas');
    renderer._fadeOff.width = w;
    renderer._fadeOff.height = h;
    renderer._fadeCtx = renderer._fadeOff.getContext('2d');
  }
  return { c: renderer._fadeOff, ctx: renderer._fadeCtx, w, h };
}

function blitWrapFeather(ctx, renderer, img, ox, y, dw, dh, fadeTop, fadeBot) {
  if (!img) return;
  if (!fadeTop && !fadeBot) {
    blitWrap(ctx, img, ox, y, dw, dh);
    return;
  }
  const { c, ctx: o, w, h } = fadeScratch(renderer, dw, dh);
  o.setTransform(1, 0, 0, 1, 0, 0);
  o.clearRect(0, 0, w, h);
  blitWrap(o, img, ox, 0, dw, dh);
  o.globalCompositeOperation = 'destination-in';
  const g = o.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, fadeTop ? 'rgba(255,255,255,0)' : '#fff');
  if (fadeTop) g.addColorStop(Math.min(0.45, fadeTop), '#fff');
  if (fadeBot) g.addColorStop(Math.max(0.55, 1 - fadeBot), '#fff');
  g.addColorStop(1, fadeBot ? 'rgba(255,255,255,0)' : '#fff');
  o.fillStyle = g;
  o.fillRect(0, 0, w, h);
  o.globalCompositeOperation = 'source-over';
  ctx.drawImage(c, 0, y, dw, dh);
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
    if (hit.along < 0.12 || hit.along > 3.7) continue;
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
  if (sky) {
    blitWrapFeather(ctx, renderer, sky, -pan * 52, -6 + bob * 0.12, w * 1.38, h * 0.38, 0, 0.55);
  } else {
    const g = ctx.createLinearGradient(0, 0, 0, h * 0.4);
    g.addColorStop(0, '#d7b07a');
    g.addColorStop(1, '#e4c094');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h * 0.4);
  }
  if (far) {
    ctx.save();
    ctx.globalAlpha = 0.4;
    blitWrapFeather(ctx, renderer, far, -pan * 110, h * 0.08 + bob * 0.25, w * 1.52, h * 0.36, 0.28, 0.48);
    ctx.restore();
  }
  if (pano) {
    ctx.save();
    ctx.globalAlpha = 0.12;
    blitWrapFeather(ctx, renderer, pano, -pan * 140, h * 0.16 + bob * 0.2, w * 1.65, h * 0.28, 0.25, 0.4);
    ctx.restore();
  }
}

function craterScratch(renderer, rw, rh) {
  const w = Math.max(16, Math.ceil(rw * 2 + 4));
  const h = Math.max(16, Math.ceil(rh * 2 + 4));
  if (!renderer._craterOff || renderer._craterOff.width !== w || renderer._craterOff.height !== h) {
    renderer._craterOff = document.createElement('canvas');
    renderer._craterOff.width = w;
    renderer._craterOff.height = h;
    renderer._craterCtx = renderer._craterOff.getContext('2d');
  }
  return { c: renderer._craterOff, ctx: renderer._craterCtx, w, h };
}

function drawEjecta(ctx, renderer, cx, cy, rw, rh, dist) {
  const img = renderer.camRocks;
  if (!img) return;
  const n = 7;
  ctx.save();
  for (let i = 0; i < n; i++) {
    const ang = 0.35 + i * 0.82 + dist * 0.05;
    if (Math.sin(ang) < 0.12) continue;
    const rad = 0.92 + (i % 3) * 0.08;
    const ex = cx + Math.cos(ang) * rw * rad;
    const ey = cy + Math.sin(ang) * rh * (rad + 0.12);
    const chip = (i % 4) * 128;
    const s = (14 + (i % 3) * 7) * Math.min(2.4, 1.85 / dist);
    ctx.globalAlpha = 0.78;
    ctx.drawImage(img, chip, 24, 128, 80, ex - s / 2, ey - s * 0.55, s, s * 0.7);
  }
  ctx.restore();
}

function drawCraterOverlay(ctx, renderer, w, h, horizon) {
  const hit = lookAheadCrater(renderer);
  if (!hit) return hit;
  const dist = Math.max(0.22, hit.along);
  const grow = Math.min(2.45, 2.05 / dist);
  const cx = w / 2 + hit.side * (w * 0.5) / dist;
  const farRimY = horizon + h * 0.01;
  const rw = Math.min(w * 1.12, grow * w * 0.50);
  const squash = 0.40 + 0.18 * Math.min(1, 1.15 / dist);
  const rh = Math.min(h - farRimY - 2, Math.min(h * 0.82, rw * squash));
  const cy = farRimY + rh;
  const { c, ctx: o, w: ow, h: oh } = craterScratch(renderer, rw, rh);
  o.setTransform(1, 0, 0, 1, 0, 0);
  o.clearRect(0, 0, ow, oh);
  const ocx = ow / 2;
  const ocy = oh / 2;
  o.save();
  o.beginPath();
  o.ellipse(ocx, ocy, rw, rh, 0, 0, Math.PI * 2);
  o.clip();
  const ground = renderer.camNear || renderer.mastcamImg;
  if (ground) {
    o.drawImage(ground, ocx - rw * 1.25, ocy - rh * 0.08, rw * 2.5, rh * 2.15);
  }
  const plate = renderer.camCrater;
  if (plate) {
    o.drawImage(plate, ocx - rw, ocy - rh, rw * 2, rh * 2);
  }
  const farWall = o.createLinearGradient(ocx, ocy - rh * 0.72, ocx, ocy + rh * 0.1);
  farWall.addColorStop(0, 'rgba(10, 5, 2, 0.38)');
  farWall.addColorStop(0.45, 'rgba(32, 14, 6, 0.12)');
  farWall.addColorStop(1, 'rgba(0, 0, 0, 0)');
  o.fillStyle = farWall;
  o.fillRect(0, 0, ow, oh);
  const nearLit = o.createRadialGradient(ocx - rw * 0.12, ocy + rh * 0.42, rh * 0.04, ocx, ocy + rh * 0.22, rh * 0.85);
  nearLit.addColorStop(0, 'rgba(236, 198, 148, 0.22)');
  nearLit.addColorStop(0.55, 'rgba(180, 120, 70, 0.06)');
  nearLit.addColorStop(1, 'rgba(0, 0, 0, 0)');
  o.fillStyle = nearLit;
  o.fillRect(0, 0, ow, oh);
  o.restore();
  o.save();
  o.globalCompositeOperation = 'destination-in';
  const mask = o.createRadialGradient(
    ocx, ocy + rh * 0.32, Math.min(rw, rh) * 0.18,
    ocx, ocy + rh * 0.16, Math.max(rw, rh) * 1.08
  );
  mask.addColorStop(0, 'rgba(255,255,255,1)');
  mask.addColorStop(0.64, 'rgba(255,255,255,0.96)');
  mask.addColorStop(0.86, 'rgba(255,255,255,0.4)');
  mask.addColorStop(1, 'rgba(255,255,255,0)');
  o.fillStyle = mask;
  o.fillRect(0, 0, ow, oh);
  o.restore();
  o.save();
  o.globalCompositeOperation = 'destination-out';
  const skyCut = o.createLinearGradient(0, 0, 0, Math.max(4, rh * 0.04));
  skyCut.addColorStop(0, 'rgba(0,0,0,0.8)');
  skyCut.addColorStop(1, 'rgba(0,0,0,0)');
  o.fillStyle = skyCut;
  o.fillRect(0, 0, ow, rh * 0.045);
  o.restore();
  ctx.drawImage(c, cx - rw, cy - rh);
  drawEjecta(ctx, renderer, cx, cy, rw, rh, dist);
  return hit;
}

function landerScratch(renderer, dw, dh) {
  const w = Math.max(8, Math.ceil(dw));
  const h = Math.max(8, Math.ceil(dh));
  if (!renderer._landerOff || renderer._landerOff.width !== w || renderer._landerOff.height !== h) {
    renderer._landerOff = document.createElement('canvas');
    renderer._landerOff.width = w;
    renderer._landerOff.height = h;
    renderer._landerCtx = renderer._landerOff.getContext('2d');
  }
  return { c: renderer._landerOff, ctx: renderer._landerCtx, w, h };
}

function drawLanderBillboard(ctx, renderer, w, h, horizon) {
  const hit = lookAt(renderer, LANDER_COL + 0.5, LANDER_ROW + 0.72);
  if (hit.along < 0.55 || hit.along > 5.6 || hit.dist < 0.8) return;
  if (Math.abs(hit.side) > 1.05 + hit.along * 0.38) return;
  const img = renderer.landerFwdImg || renderer.landerImg;
  if (!img) return;
  const z = hit.along;
  const natW = img.naturalWidth || img.width || 1;
  const natH = img.naturalHeight || img.height || 1;
  const aspect = natH / natW;
  const bw = Math.min(w * 0.58, (1.15 / z) * w * 0.40);
  const bh = bw * aspect;
  const x = w / 2 + (hit.side / z) * w * 0.52 - bw / 2;
  const groundY = horizon + (0.46 / z) * h + h * 0.14;
  const y = groundY - bh * 0.90;
  const fog = Math.min(0.34, Math.max(0, (z - 1.05) / 7.2));
  ctx.save();
  ctx.fillStyle = `rgba(10, 5, 2, ${0.58 * (1 - fog * 0.45)})`;
  ctx.beginPath();
  ctx.ellipse(x + bw * 0.5, y + bh * 0.9, bw * 0.34, Math.max(4, bh * 0.08), 0.08, 0, Math.PI * 2);
  ctx.fill();
  const { c, ctx: o } = landerScratch(renderer, bw, bh);
  o.setTransform(1, 0, 0, 1, 0, 0);
  o.clearRect(0, 0, bw, bh);
  o.imageSmoothingEnabled = true;
  o.imageSmoothingQuality = 'high';
  o.drawImage(img, 0, 0, bw, bh);
  if (fog > 0.02) {
    o.globalCompositeOperation = 'source-atop';
    o.fillStyle = `rgba(210, 168, 118, ${fog})`;
    o.fillRect(0, 0, bw, bh);
    o.globalCompositeOperation = 'source-over';
  }
  ctx.drawImage(c, x, y, bw, bh);
  ctx.restore();
}

function drawRockBillboards(ctx, renderer, w, h, horizon, craterHit) {
  if ((renderer.camMode || 'photo') === 'photo') return;
  const img = renderer.camRocks;
  if (!img) return;
  const col = renderer.roverCol;
  const row = renderer.roverRow;
  const hdg = renderer.heading;
  const fwdC = Math.cos(hdg);
  const fwdR = Math.sin(hdg);
  const rightC = -Math.sin(hdg);
  const rightR = Math.cos(hdg);
  for (let i = 0; i < 6; i++) {
    const z = 0.7 + i * 0.55;
    if (craterHit && Math.abs(z - craterHit.along) < 0.5) continue;
    const n = renderer._noiseAt(col * 3.1 + i * 7.2, row * 2.7 + i);
    if (n < 0.42) continue;
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
    blitWrapFeather(ctx, renderer, mid, -pan * 180 - drive * 36, h * 0.30 + bob * 0.55, w * 1.62 * sc, h * 0.54 * sc, 0.24, 0);
  }
  if (alt) {
    const k = Math.max(0, Math.cos(heading)) * 0.4;
    if (k > 0.04) {
      ctx.save();
      ctx.globalAlpha = k;
      blitWrapFeather(ctx, renderer, alt, -pan * 200 - drive * 10, h * 0.2 + bob * 0.4, w * 1.48, h * 0.8, 0.12, 0);
      ctx.restore();
    }
  }
  if (near) {
    const sc = 1.06 + Math.min(0.32, drive * 0.07);
    blitWrapFeather(ctx, renderer, near, -pan * 280 - drive * 88, h * 0.44 + bob * 0.95 - drive * 7, w * 1.88 * sc, h * 0.66 * sc, 0.14, 0);
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

function perspScratch(renderer, dw, dh) {
  const w = Math.max(8, Math.ceil(dw));
  const h = Math.max(8, Math.ceil(dh));
  if (!renderer._perspOff || renderer._perspOff.width !== w || renderer._perspOff.height !== h) {
    renderer._perspOff = document.createElement('canvas');
    renderer._perspOff.width = w;
    renderer._perspOff.height = h;
    renderer._perspCtx = renderer._perspOff.getContext('2d');
  }
  return { c: renderer._perspOff, ctx: renderer._perspCtx, w, h };
}

function drawPerspGround(ctx, renderer, img, w, h, horizon, pan, drive, squish, extraY) {
  if (!img) return;
  const { c, ctx: o } = perspScratch(renderer, w, h);
  o.setTransform(1, 0, 0, 1, 0, 0);
  o.clearRect(0, 0, w, h);
  o.imageSmoothingEnabled = true;
  o.imageSmoothingQuality = 'high';
  o.save();
  o.translate(w / 2, h);
  o.transform(1 + Math.min(0.2, drive * 0.04), 0, 0, squish, 0, 0);
  o.translate(-w / 2, -(h * 0.7) + extraY);
  blitWrap(o, img, -pan * 230 - drive * 72, 0, w * 1.75, h * 0.92);
  o.restore();
  o.globalCompositeOperation = 'destination-in';
  const g = o.createLinearGradient(0, Math.max(0, horizon - 22), 0, horizon + h * 0.18);
  g.addColorStop(0, 'rgba(255,255,255,0)');
  g.addColorStop(1, '#fff');
  o.fillStyle = g;
  o.fillRect(0, 0, w, h);
  o.globalCompositeOperation = 'source-over';
  ctx.drawImage(c, 0, 0);
}

function drawHybrid(ctx, renderer, w, h, t) {
  const heading = renderer.heading;
  const pan = heading + Math.PI / 2;
  const moving = !!(renderer.anim && renderer.anim.moving);
  const bob = (moving && !renderer.reduceMotion ? Math.sin(t * 16) * 2.4 : 0.5);
  const drive = driveAmt(renderer);
  const horizon = h * 0.34 + bob * 0.15;
  ctx.fillStyle = '#d0ae82';
  ctx.fillRect(0, 0, w, h);
  drawSkyPhoto(ctx, renderer, w, h, pan + drive * 0.08, bob);
  const mid = renderer.camMid || renderer.mastcamImg;
  const near = renderer.camNear || renderer.mastcamImg;
  if (mid) {
    const sc = 1 + Math.min(0.18, drive * 0.04);
    blitWrapFeather(ctx, renderer, mid, -pan * 180 - drive * 36, h * 0.28 + bob * 0.4, w * 1.62 * sc, h * 0.5 * sc, 0.3, 0.08);
  }
  drawPerspGround(ctx, renderer, near, w, h, horizon + 12, pan, drive, 0.5, 8);
  drawCraterOverlay(ctx, renderer, w, h, horizon);
  drawLanderBillboard(ctx, renderer, w, h, horizon);
}

function drawVoxel(ctx, renderer, w, h, t) {
  const heading = renderer.heading;
  const pan = heading + Math.PI / 2;
  const moving = !!(renderer.anim && renderer.anim.moving);
  const bob = (moving && !renderer.reduceMotion ? Math.sin(t * 17) * 2.2 : 0.4);
  const drive = driveAmt(renderer);
  const horizon = h * 0.34 + bob * 0.12;
  ctx.fillStyle = '#d4b48a';
  ctx.fillRect(0, 0, w, h);
  drawSkyPhoto(ctx, renderer, w, h, pan, bob);
  const near = renderer.camNear || renderer.mastcamImg;
  const mid = renderer.camMid || renderer.mastcamImg;
  if (mid) {
    blitWrapFeather(ctx, renderer, mid, -pan * 160 - drive * 28, h * 0.26 + bob * 0.3, w * 1.55, h * 0.48, 0.32, 0.1);
  }
  drawPerspGround(ctx, renderer, near, w, h, horizon + 10, pan, drive, 0.46, 10);
  drawCraterOverlay(ctx, renderer, w, h, horizon);
  drawLanderBillboard(ctx, renderer, w, h, horizon);
}

export function prewarmRoverCam(renderer, now = 0) {
  if (!renderer) return;
  renderer.lastCam = 0;
  renderer._camPoseKey = '';
  renderer._camTexReady = false;
  ensurePhotoTex(renderer);
  const canvas = document.getElementById('rover-cam-canvas');
  if (canvas && !canvas._frCtx) canvas._frCtx = canvas.getContext('2d', { willReadFrequently: true });
  drawRoverCam(renderer, now, 0);
  renderer.lastCam = 0;
  drawRoverCam(renderer, now + 40, 0);
}

export function drawRoverCam(renderer, now, t) {
  const canvas = document.getElementById('rover-cam-canvas');
  if (!canvas) return;
  if (!canvas._frCtx) canvas._frCtx = canvas.getContext('2d', { willReadFrequently: true });
  const ctx = canvas._frCtx;
  const w = canvas.width;
  const h = canvas.height;
  const mode = renderer.camMode || DEFAULT_CAM_MODE;
  const cheap = softwareCheap();
  const poseKey = `${mode}|${renderer.roverCol.toFixed(2)}|${renderer.roverRow.toFixed(2)}|${renderer.heading.toFixed(3)}|${(renderer.driveU || 0).toFixed(2)}`;
  const minDt = cheap ? 50 : ((renderer.playbackSpeed || 1) >= 16 ? 40 : 33);
  if (renderer.lastCam && now - renderer.lastCam < minDt) {
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

export default { drawRoverCam, prewarmRoverCam, resolveCamMode, persistCamMode, CAM_MODES, DEFAULT_CAM_MODE };
