// Far Rover orbital-ops board (canvas 2D).
// Visual only: reads sim state, never writes rules or ticks.
// Terrain: NASA/JPL-Caltech/UArizona HiRISE PIA23289.
// Rover cam: NASA/JPL-Caltech/ASU/MSSS Mastcam-Z PIA23727.

import {
  tileCloudTarget,
  cloudFadeDuration,
  prefersReducedMotion,
  CLOUD_HIDDEN,
  CLOUD_CAMERA,
  CLOUD_CLEAR
} from './renderer.js';

const GRID_COLS = 12;
const GRID_ROWS = 12;
const LANDER_COL = 5;
const LANDER_ROW = 12;

const MAP = {
  tilePx: 80,
  originCol: -2,
  originRow: -2,
  texCols: 16,
  texRows: 17,
  width: 1280,
  height: 1360,
  chuteCol: 3.438,
  chuteRow: 13.615
};

const FACE_RAD = { north: -Math.PI / 2, east: 0, south: Math.PI / 2, west: Math.PI };
const FACE_DEG = { north: 0, east: 90, south: 180, west: 270 };
const DIR = { north: [0, -1], east: [1, 0], south: [0, 1], west: [-1, 0] };

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function smoothstep(e0, e1, x) {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

function loadImage(src) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

function makeGrain(size = 128) {
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(size, size);
  for (let i = 0; i < img.data.length; i += 4) {
    const n = 128 + (Math.random() - 0.5) * 90;
    img.data[i] = img.data[i + 1] = img.data[i + 2] = n;
    img.data[i + 3] = 28;
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

export class OrbitalRenderer {
  constructor(container, gameState) {
    this.container = container;
    this.gameState = gameState;
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'game-canvas';
    this.canvas.dataset.engine = 'orbital';
    this.ctx = null;

    this.playbackSpeed = 1;
    this.paused = false;
    this.reduceMotion = prefersReducedMotion();
    this.sensorLayers = { camera: true, lidar: false, thermal: false, spectral: false };
    this.gridForced = false;
    this.disposed = false;

    this.cloudDisplay = Array(GRID_ROWS).fill(null).map(() => Array(GRID_COLS).fill(CLOUD_HIDDEN));
    this.cloudTarget = Array(GRID_ROWS).fill(null).map(() => Array(GRID_COLS).fill(CLOUD_HIDDEN));
    this.cloudFadeFrom = Array(GRID_ROWS).fill(null).map(() => Array(GRID_COLS).fill(CLOUD_HIDDEN));
    this.cloudFadeStart = 0;
    this.cloudFading = false;
    this.cloudInitialized = false;
    this.maskDirty = true;

    this.roverCol = gameState?.col ?? LANDER_COL;
    this.roverRow = gameState?.row ?? LANDER_ROW;
    this.heading = FACE_RAD[gameState?.facing] || FACE_RAD.north;
    this.anim = null;
    this.tracks = [];
    this.driveU = 0;
    this.t0 = performance.now();
    this.raf = 0;
    this.camX = LANDER_COL + 3.1;
    this.camY = LANDER_ROW - 0.15;
    this.camZoom = 1;
    this.ready = false;

    this.fullImg = null;
    this.seenImg = null;
    this.fogImg = null;
    this.roverImg = null;
    this.landerImg = null;
    this.chuteImg = null;
    this.mastcamImg = null;
    this.noiseImg = null;
    this.grain = makeGrain();

    this.seenMask = null;
    this.fullMask = null;
    this.world = null;
    this.tmp = null;
  }

  mount() {
    this.container.appendChild(this.canvas);
    this.resize();
    this.onResize = () => this.resize();
    window.addEventListener('resize', this.onResize);
    if (window.matchMedia) {
      this.motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
      this.onMotion = () => {
        this.reduceMotion = this.motionQuery.matches;
      };
      this.motionQuery.addEventListener?.('change', this.onMotion);
    }
    this.syncCloudTargets();
    this.loadArt().then(() => {
      if (this.disposed) return;
      this.ready = true;
      this.maskDirty = true;
      this.render();
    });
    this.loop();
  }

  async loadArt() {
    const base = 'assets/art/';
    const [full, seen, fog, rover, lander, chute, cam, noise] = await Promise.all([
      loadImage(base + 'hirise-board.jpg'),
      loadImage(base + 'hirise-seen.jpg'),
      loadImage(base + 'hirise-fog.jpg'),
      loadImage(base + 'rover-nadir.png'),
      loadImage(base + 'lander-insight.png'),
      loadImage(base + 'chute.png'),
      loadImage(base + 'mastcam.jpg'),
      loadImage(base + 'edge-noise.png')
    ]);
    this.fullImg = full;
    this.seenImg = seen;
    this.fogImg = fog;
    this.roverImg = rover;
    this.landerImg = lander;
    this.chuteImg = chute;
    this.mastcamImg = cam;
    this.noiseImg = noise;
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    if (this.raf) cancelAnimationFrame(this.raf);
    window.removeEventListener('resize', this.onResize);
    this.motionQuery?.removeEventListener?.('change', this.onMotion);
    this.canvas.remove();
  }

  resize() {
    const rect = this.container.getBoundingClientRect();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    this.width = Math.max(1, rect.width);
    this.height = Math.max(1, rect.height);
    this.canvas.width = Math.round(this.width * dpr);
    this.canvas.height = Math.round(this.height * dpr);
    this.canvas.style.width = this.width + 'px';
    this.canvas.style.height = this.height + 'px';
    this.ctx = this.canvas.getContext('2d');
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.world = document.createElement('canvas');
    this.world.width = this.canvas.width;
    this.world.height = this.canvas.height;
    this.worldCtx = this.world.getContext('2d');
    this.tmp = document.createElement('canvas');
    this.tmp.width = this.canvas.width;
    this.tmp.height = this.canvas.height;
    this.tmpCtx = this.tmp.getContext('2d');
    const mw = 320;
    const mh = Math.round(mw * MAP.height / MAP.width);
    this.seenMask = document.createElement('canvas');
    this.seenMask.width = mw;
    this.seenMask.height = mh;
    this.seenMaskCtx = this.seenMask.getContext('2d');
    this.fullMask = document.createElement('canvas');
    this.fullMask.width = mw;
    this.fullMask.height = mh;
    this.fullMaskCtx = this.fullMask.getContext('2d');
    this.maskDirty = true;
    this.render();
  }

  setPlaybackSpeed(speed) {
    this.playbackSpeed = speed || 1;
  }

  setPausedHint(paused) {
    this.paused = !!paused;
  }

  setSensorLayer(name, on) {
    if (!(name in this.sensorLayers)) return;
    this.sensorLayers[name] = !!on;
  }

  setGridForced(on) {
    this.gridForced = !!on;
  }

  resetView() {
    this.camX = (this.roverCol ?? LANDER_COL) + 3.1;
    this.camY = (this.roverRow ?? LANDER_ROW) - 0.15;
    this.camZoom = 1;
  }

  updateState(gameState) {
    this.gameState = gameState;
    if (gameState && !this.anim) {
      this.roverCol = gameState.col;
      this.roverRow = gameState.row;
      this.heading = FACE_RAD[gameState.facing] || this.heading;
    }
    this.syncCloudTargets();
  }

  startAnimation(fromCol, fromRow, toCol, toRow, duration = 120) {
    const fromH = this.heading;
    const toH = FACE_RAD[this.gameState?.facing] ?? fromH;
    this.anim = {
      fromCol, fromRow, toCol, toRow,
      fromH, toH,
      start: performance.now(),
      duration: Math.max(1, duration)
    };
    this._stampTrack(fromCol, fromRow, fromH);
    this.driveU += 1;
  }

  _stampTrack(col, row, heading) {
    const last = this.tracks[this.tracks.length - 1];
    if (last && Math.hypot(last.col - col, last.row - row) < 0.02) {
      last.heading = heading;
      return;
    }
    this.tracks.push({ col, row, heading });
    if (this.tracks.length > 80) this.tracks.shift();
  }

  syncCloudTargets() {
    const state = this.gameState;
    if (!state) return;
    let changed = false;
    for (let row = 0; row < GRID_ROWS; row++) {
      for (let col = 0; col < GRID_COLS; col++) {
        const next = tileCloudTarget(state, col, row);
        if (this.cloudTarget[row][col] !== next) {
          this.cloudTarget[row][col] = next;
          changed = true;
        }
      }
    }
    if (!this.cloudInitialized) {
      for (let row = 0; row < GRID_ROWS; row++) {
        for (let col = 0; col < GRID_COLS; col++) {
          this.cloudDisplay[row][col] = this.cloudTarget[row][col];
          this.cloudFadeFrom[row][col] = this.cloudTarget[row][col];
        }
      }
      this.cloudInitialized = true;
      this.cloudFading = false;
      this.maskDirty = true;
      return;
    }
    if (changed) {
      for (let row = 0; row < GRID_ROWS; row++) {
        for (let col = 0; col < GRID_COLS; col++) {
          this.cloudFadeFrom[row][col] = this.cloudDisplay[row][col];
        }
      }
      this.cloudFadeStart = performance.now();
      this.cloudFading = true;
    }
  }

  stepCloudFade(now) {
    if (!this.cloudFading) return;
    const dur = cloudFadeDuration(this.playbackSpeed);
    const t = Math.min(1, (now - this.cloudFadeStart) / dur);
    const e = t * t * (3 - 2 * t);
    for (let row = 0; row < GRID_ROWS; row++) {
      for (let col = 0; col < GRID_COLS; col++) {
        this.cloudDisplay[row][col] = lerp(this.cloudFadeFrom[row][col], this.cloudTarget[row][col], e);
      }
    }
    this.maskDirty = true;
    if (t >= 1) this.cloudFading = false;
  }

  loop = () => {
    if (this.disposed) return;
    this.render();
    this.raf = requestAnimationFrame(this.loop);
  };

  _stampOrganic(ctx, col, row, radius, alpha) {
    const n = this._noiseAt(col, row);
    const n2 = this._noiseAt(col + 8.1, row - 3.4);
    const r = radius * (0.82 + 0.38 * n);
    const x = col + 0.5 + (n - 0.5) * 0.35;
    const y = row + 0.5 + (n2 - 0.5) * 0.35;
    const g = ctx.createRadialGradient(x, y, r * 0.15, x, y, r);
    g.addColorStop(0, `rgba(255,255,255,${alpha})`);
    g.addColorStop(0.55, `rgba(255,255,255,${alpha * 0.85})`);
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
    // extra lobes so the edge is not a circle
    ctx.beginPath();
    ctx.arc(x + (n - 0.5) * 0.55, y - (n2 - 0.5) * 0.5, r * 0.62, 0, Math.PI * 2);
    ctx.fill();
  }

  _noiseAt(x, y) {
    const s = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453;
    return s - Math.floor(s);
  }

  rebuildMasks() {
    const seen = this.seenMaskCtx;
    const full = this.fullMaskCtx;
    const w = this.seenMask.width;
    const h = this.seenMask.height;
    const sx = w / MAP.texCols;
    const sy = h / MAP.texRows;
    const apply = (ctx) => {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, w, h);
      ctx.setTransform(sx, 0, 0, sy, -MAP.originCol * sx, -MAP.originRow * sy);
    };
    apply(seen);
    apply(full);

    this._stampOrganic(seen, LANDER_COL, LANDER_ROW, 3.15, 1);
    this._stampOrganic(seen, LANDER_COL + 0.8, LANDER_ROW - 0.4, 1.7, 0.85);
    this._stampOrganic(full, LANDER_COL, LANDER_ROW, 1.35, 1);
    this._stampOrganic(full, LANDER_COL + 0.55, LANDER_ROW - 0.15, 0.95, 0.9);

    for (let row = 0; row < GRID_ROWS; row++) {
      for (let col = 0; col < GRID_COLS; col++) {
        const v = this.cloudDisplay[row][col];
        if (v >= 0.97) continue;
        if (v <= CLOUD_CLEAR + 0.04) {
          this._stampOrganic(seen, col, row, 1.55, 1);
          this._stampOrganic(full, col, row, 1.08, 1);
        } else {
          const k = Math.max(0, Math.min(1, (CLOUD_HIDDEN - v) / (CLOUD_HIDDEN - CLOUD_CAMERA)));
          this._stampOrganic(seen, col, row, 1.45, Math.max(0.4, k));
        }
      }
    }
    this.maskDirty = false;
  }

  worldToScreen(col, row, scale, tx, ty) {
    return { x: col * scale + tx, y: row * scale + ty };
  }

  stepAnim(now) {
    if (!this.anim) return false;
    const a = this.anim;
    const t = Math.min(1, (now - a.start) / a.duration);
    const e = t * t * t * (t * (t * 6 - 15) + 10);
    this.roverCol = lerp(a.fromCol, a.toCol, e);
    this.roverRow = lerp(a.fromRow, a.toRow, e);
    let dh = a.toH - a.fromH;
    while (dh > Math.PI) dh -= Math.PI * 2;
    while (dh < -Math.PI) dh += Math.PI * 2;
    this.heading = a.fromH + dh * e;
    if (t >= 1) {
      this._stampTrack(a.toCol, a.toRow, a.toH);
      this.roverCol = a.toCol;
      this.roverRow = a.toRow;
      this.heading = a.toH;
      this.anim = null;
    }
    return true;
  }

  render() {
    if (this.disposed || !this.ctx) return;
    const now = performance.now();
    this.stepCloudFade(now);
    this.stepAnim(now);
    if (this.maskDirty) this.rebuildMasks();

    const w = this.width;
    const h = this.height;
    const t = (now - this.t0) / 1000;
    const reduce = this.reduceMotion;
    const roverCol = this.roverCol;
    const roverRow = this.roverRow;

    const follow = 0.32;
    const wantX = lerp(LANDER_COL + 3.05, roverCol + 2.85, follow + 0.22);
    const wantY = lerp(LANDER_ROW - 0.15, roverRow + 0.35, follow + 0.22);
    const driftX = reduce ? 0 : 0.34 * Math.sin(t * 0.11) + 0.14 * Math.sin(t * 0.031);
    const driftY = reduce ? 0 : 0.2 * Math.cos(t * 0.09) + 0.1 * Math.cos(t * 0.047);
    const zoomPulse = reduce ? 1 : 0.97 + 0.045 * smoothstep(0, 1, (Math.sin(t * 0.07) + 1) / 2);
    this.camX = lerp(this.camX, wantX + driftX, reduce ? 1 : 0.04);
    this.camY = lerp(this.camY, wantY + driftY, reduce ? 1 : 0.04);
    this.camZoom = lerp(this.camZoom, zoomPulse, reduce ? 1 : 0.035);

    const fit = Math.min(w / 16.8, h / 13.4);
    const scale = fit * this.camZoom;
    const tx = w / 2 - this.camX * scale;
    const ty = h / 2 - this.camY * scale;

    const dpr = this.canvas.width / w;
    const wctx = this.worldCtx;
    wctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    wctx.fillStyle = '#141516';
    wctx.fillRect(0, 0, w, h);
    wctx.setTransform(dpr * scale, 0, 0, dpr * scale, dpr * tx, dpr * ty);

    const drawWorld = (img) => {
      if (!img) return;
      wctx.drawImage(img, MAP.originCol, MAP.originRow, MAP.texCols, MAP.texRows);
    };

    drawWorld(this.fogImg || this.fullImg);

    if (this.noiseImg) {
      wctx.save();
      wctx.globalAlpha = 0.16;
      const ox = reduce ? 0 : (t * 0.22) % 8;
      const oy = reduce ? 0 : (t * -0.09) % 8;
      wctx.drawImage(this.noiseImg, MAP.originCol + ox, MAP.originRow + oy, MAP.texCols * 1.4, MAP.texRows * 1.4);
      wctx.restore();
    }

    const blitMasked = (img, mask) => {
      if (!img || !mask) return;
      const tctx = this.tmpCtx;
      tctx.setTransform(1, 0, 0, 1, 0, 0);
      tctx.clearRect(0, 0, this.tmp.width, this.tmp.height);
      tctx.setTransform(dpr * scale, 0, 0, dpr * scale, dpr * tx, dpr * ty);
      tctx.drawImage(img, MAP.originCol, MAP.originRow, MAP.texCols, MAP.texRows);
      tctx.globalCompositeOperation = 'destination-in';
      tctx.drawImage(mask, MAP.originCol, MAP.originRow, MAP.texCols, MAP.texRows);
      tctx.globalCompositeOperation = 'source-over';
      wctx.setTransform(1, 0, 0, 1, 0, 0);
      wctx.drawImage(this.tmp, 0, 0);
      wctx.setTransform(dpr * scale, 0, 0, dpr * scale, dpr * tx, dpr * ty);
    };

    blitMasked(this.seenImg || this.fullImg, this.seenMask);
    blitMasked(this.fullImg, this.fullMask);

    this._drawTracks(wctx);
    this._drawPath(wctx, roverCol, roverRow);
    this._drawSprites(wctx, roverCol, roverRow, scale);
    this._drawSensors(wctx);
    if (this.gridForced) this._drawGrid(wctx);

    const ctx = this.ctx;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.drawImage(this.world, 0, 0, w, h);

    this._drawReticle(ctx, roverCol * scale + tx, roverRow * scale + ty);
    this._drawGrain(ctx, w, h, t);
    this._drawVignette(ctx, w, h);
    this._drawRoverCam(now, t);
  }

  _drawTracks(ctx) {
    if (this.tracks.length < 2) return;
    ctx.save();
    ctx.strokeStyle = 'rgba(28, 24, 20, 0.42)';
    ctx.lineWidth = 0.07;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (const sign of [-1, 1]) {
      ctx.beginPath();
      let started = false;
      for (const p of this.tracks) {
        const ox = -Math.sin(p.heading) * 0.13 * sign;
        const oy = Math.cos(p.heading) * 0.13 * sign;
        const x = p.col + 0.5 + ox;
        const y = p.row + 0.5 + oy;
        if (!started) {
          ctx.moveTo(x, y);
          started = true;
        } else ctx.lineTo(x, y);
      }
      const h = this.heading;
      ctx.lineTo(this.roverCol + 0.5 - Math.sin(h) * 0.13 * sign, this.roverRow + 0.5 + Math.cos(h) * 0.13 * sign);
      ctx.stroke();
    }
    ctx.restore();
  }

  _drawPath(ctx, col, row) {
    const facing = this.gameState?.facing || 'north';
    const [dx, dy] = DIR[facing] || DIR.north;
    ctx.save();
    ctx.strokeStyle = 'rgba(125, 212, 255, 0.55)';
    ctx.lineWidth = 0.035;
    ctx.setLineDash([0.18, 0.16]);
    ctx.beginPath();
    const x0 = col + 0.5 + dx * 0.55;
    const y0 = row + 0.5 + dy * 0.55;
    ctx.moveTo(x0, y0);
    ctx.lineTo(col + 0.5 + dx * 2.6, row + 0.5 + dy * 2.6);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();
  }

  _drawSprites(ctx, col, row, scale) {
    const stamp = (img, x, y, rot, tiles, shadow) => {
      if (!img) return;
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(rot);
      const s = tiles;
      ctx.fillStyle = 'rgba(0,0,0,0.45)';
      ctx.beginPath();
      ctx.ellipse(0.12 * shadow, 0.08 * shadow, s * 0.42, s * 0.22, 0.3, 0, Math.PI * 2);
      ctx.fill();
      ctx.drawImage(img, -s / 2, -s / 2, s, s);
      ctx.restore();
    };
    ctx.save();
    ctx.globalAlpha = 0.72;
    stamp(this.chuteImg, MAP.chuteCol + 0.5, MAP.chuteRow + 0.55, 0.4, 0.55, 0.35);
    ctx.restore();
    stamp(this.landerImg, LANDER_COL + 0.5, LANDER_ROW + 0.72, 0.18, 0.78, 0.55);
    stamp(this.roverImg, col + 0.5, row + 0.42, this.heading, 0.5, 0.5);
  }

  _drawSensors(ctx) {
    const state = this.gameState;
    if (!state?.terrain) return;
    ctx.save();
    for (let row = 0; row < GRID_ROWS; row++) {
      for (let col = 0; col < GRID_COLS; col++) {
        const known = !!(state.revealed?.[row]?.[col] || state.cameraSeen?.[row]?.[col]);
        if (!known) continue;
        const t = state.terrain[row][col];
        const cx = col + 0.5;
        const cy = row + 0.5;
        if (this.sensorLayers.lidar && t === 'crater') {
          ctx.strokeStyle = 'rgba(80, 220, 255, 0.7)';
          ctx.lineWidth = 0.05;
          ctx.beginPath();
          ctx.arc(cx, cy, 0.38, 0, Math.PI * 2);
          ctx.stroke();
        }
        if (this.sensorLayers.spectral && t === 'ore') {
          ctx.fillStyle = state.drilled?.[row]?.[col] ? 'rgba(160,160,150,0.25)' : 'rgba(80, 210, 255, 0.22)';
          ctx.beginPath();
          ctx.arc(cx, cy, 0.22, 0, Math.PI * 2);
          ctx.fill();
        }
        if (this.sensorLayers.thermal && t === 'dust') {
          ctx.fillStyle = 'rgba(255, 140, 70, 0.22)';
          ctx.beginPath();
          ctx.arc(cx, cy, 0.28, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }
    ctx.restore();
  }

  _drawGrid(ctx) {
    ctx.save();
    ctx.strokeStyle = 'rgba(220, 230, 235, 0.12)';
    ctx.lineWidth = 0.02;
    for (let c = 0; c <= GRID_COLS; c++) {
      ctx.beginPath();
      ctx.moveTo(c, 0);
      ctx.lineTo(c, GRID_ROWS);
      ctx.stroke();
    }
    for (let r = 0; r <= GRID_ROWS; r++) {
      ctx.beginPath();
      ctx.moveTo(0, r);
      ctx.lineTo(GRID_COLS, r);
      ctx.stroke();
    }
    ctx.restore();
  }

  _drawReticle(ctx, x, y) {
    const b = 26;
    const L = 8;
    ctx.save();
    ctx.strokeStyle = 'rgba(240, 244, 246, 0.82)';
    ctx.lineWidth = 1.5;
    for (const sx of [-1, 1]) {
      for (const sy of [-1, 1]) {
        const cx = x + sx * b;
        const cy = y + sy * b;
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.lineTo(cx - sx * L, cy);
        ctx.moveTo(cx, cy);
        ctx.lineTo(cx, cy - sy * L);
        ctx.stroke();
      }
    }
    ctx.font = '12px "IBM Plex Mono", ui-monospace, monospace';
    ctx.fillStyle = 'rgba(236, 240, 242, 0.86)';
    ctx.fillText('ROVER-1', x - b, y - b - 8);
    ctx.restore();
  }

  _drawGrain(ctx, w, h, t) {
    if (!this.grain) return;
    ctx.save();
    ctx.globalAlpha = 0.11;
    const ox = (t * 18) % 64;
    const oy = (t * 11) % 64;
    const pat = ctx.createPattern(this.grain, 'repeat');
    ctx.translate(-ox, -oy);
    ctx.fillStyle = pat;
    ctx.fillRect(ox, oy, w + 64, h + 64);
    ctx.restore();
    ctx.save();
    ctx.globalAlpha = 0.045;
    ctx.fillStyle = '#fff';
    for (let y = 0; y < h; y += 3) {
      const a = 0.5 + 0.5 * Math.sin(y * 0.9 + t * 2.4);
      ctx.globalAlpha = 0.02 + 0.03 * a;
      ctx.fillRect(0, y, w, 1);
    }
    ctx.restore();
  }

  _drawVignette(ctx, w, h) {
    const g = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.25, w / 2, h / 2, Math.max(w, h) * 0.72);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(1, 'rgba(6, 7, 8, 0.42)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  }

  _drawRoverCam(now, t) {
    const canvas = document.getElementById('rover-cam-canvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const w = canvas.width;
    const h = canvas.height;
    const img = this.mastcamImg;
    if (!img) {
      ctx.fillStyle = '#3a2418';
      ctx.fillRect(0, 0, w, h);
      return;
    }
    const moving = !!this.anim;
    const bob = (moving ? 6.2 * Math.sin(t * 13) : 0) + 3.2 * Math.sin(t * 2.3);
    const pan = Math.sin(this.heading) * 18;
    const creep = Math.min(80, this.driveU * 7 + (moving ? 10 : 0));
    const srcW = img.width * 0.62;
    const srcH = srcW * (h / w);
    const sx = Math.max(0, Math.min(img.width - srcW, (img.width - srcW) / 2 + pan));
    const sy = Math.max(0, Math.min(img.height - srcH, img.height * 0.22 + bob + creep * 0.35));
    ctx.save();
    ctx.drawImage(img, sx, sy, srcW, srcH, 0, 0, w, h);
    ctx.fillStyle = 'rgba(40, 18, 8, 0.08)';
    ctx.fillRect(0, 0, w, h);
    const vg = ctx.createRadialGradient(w / 2, h / 2, h * 0.2, w / 2, h / 2, h * 0.75);
    vg.addColorStop(0, 'rgba(0,0,0,0)');
    vg.addColorStop(1, 'rgba(0,0,0,0.28)');
    ctx.fillStyle = vg;
    ctx.fillRect(0, 0, w, h);
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
    ctx.restore();
  }
}

export default OrbitalRenderer;
