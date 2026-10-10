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
import { drawRoverCam, prewarmRoverCam, resolveCamMode, persistCamMode, CAM_MODES } from './rovercam.js';

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

function wrapAngle(a) {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

// Trapezoid speed: accel/decel ramps whose peak is ≤ 1.1 tiles / duration.
function posEase(t, easeIn, easeOut) {
  t = Math.min(1, Math.max(0, t));
  if (!easeIn && !easeOut) return t;
  if (easeIn && easeOut) {
    const k = 0.09;
    const v = 1 / (1 - k);
    if (t < k) return 0.5 * v * t * t / k;
    if (t > 1 - k) {
      const u = 1 - t;
      return 1 - 0.5 * v * u * u / k;
    }
    return 0.5 * v * k + v * (t - k);
  }
  const k = 0.18;
  const v = 1 / (1 - 0.5 * k);
  if (easeIn) {
    if (t < k) return 0.5 * v * t * t / k;
    return 0.5 * v * k + v * (t - k);
  }
  if (t <= 1 - k) return v * t;
  const u = t - (1 - k);
  return v * (1 - k) + v * u - 0.5 * (v / k) * u * u;
}

function camFollow(col, row) {
  const f = 0.54;
  return {
    x: lerp(LANDER_COL + 3.05, col + 2.85, f),
    y: lerp(LANDER_ROW - 0.15, row + 0.35, f)
  };
}

function camDrift(t, reduce) {
  if (reduce) return { x: 0, y: 0 };
  return {
    x: 0.34 * Math.sin(t * 0.11) + 0.14 * Math.sin(t * 0.031),
    y: 0.2 * Math.cos(t * 0.09) + 0.1 * Math.cos(t * 0.047)
  };
}

function camZoomPulse(t, reduce) {
  if (reduce) return 1;
  return 0.97 + 0.045 * smoothstep(0, 1, (Math.sin(t * 0.07) + 1) / 2);
}

function buildCornerPts(x0, y0, x1, y1, inDx, inDy, dx, dy) {
  const il = Math.hypot(inDx, inDy) || 1;
  const ol = Math.hypot(dx, dy) || 1;
  const m = 0.26;
  const p1x = x0 + (inDx / il) * m;
  const p1y = y0 + (inDy / il) * m;
  const p2x = x1 - (dx / ol) * m;
  const p2y = y1 - (dy / ol) * m;
  const n = 20;
  const pts = [];
  let acc = 0;
  let px = x0;
  let py = y0;
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const u = 1 - t;
    const x = u * u * u * x0 + 3 * u * u * t * p1x + 3 * u * t * t * p2x + t * t * t * x1;
    const y = u * u * u * y0 + 3 * u * u * t * p1y + 3 * u * t * t * p2y + t * t * t * y1;
    if (i) acc += Math.hypot(x - px, y - py);
    pts.push({ x, y, d: acc });
    px = x;
    py = y;
  }
  return pts;
}

function sampleCorner(pts, u) {
  if (!pts || !pts.length) return { x: 0, y: 0 };
  const target = Math.min(1, Math.max(0, u)) * pts[pts.length - 1].d;
  if (target <= 0) return { x: pts[0].x, y: pts[0].y };
  for (let i = 1; i < pts.length; i++) {
    if (pts[i].d >= target) {
      const span = pts[i].d - pts[i - 1].d || 1;
      const f = (target - pts[i - 1].d) / span;
      return {
        x: pts[i - 1].x + (pts[i].x - pts[i - 1].x) * f,
        y: pts[i - 1].y + (pts[i].y - pts[i - 1].y) * f
      };
    }
  }
  const last = pts[pts.length - 1];
  return { x: last.x, y: last.y };
}

function headingEase(t, mode) {
  if (mode === 'late') return smoothstep(0.58, 1, t);
  if (mode === 'early') return smoothstep(0, 0.42, t);
  if (mode === 'full') return t * t * (3 - 2 * t);
  return t;
}

function summarizeMotionLog(log) {
  const dts = (log || []).map((s) => s.dt).filter((d) => d > 0 && d < 4000);
  dts.sort((a, b) => a - b);
  const at = (q) => (dts.length ? dts[Math.min(dts.length - 1, Math.floor(q * (dts.length - 1)))] : 0);
  return {
    n: dts.length,
    p50: at(0.5),
    p95: at(0.95),
    max: dts.length ? dts[dts.length - 1] : 0,
    over33: dts.filter((d) => d > 33).length,
    over50: dts.filter((d) => d > 50).length
  };
}

function loadImage(src) {
  return new Promise((resolve) => {
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => {
      if (img.decode) {
        img.decode().then(() => resolve(img)).catch(() => resolve(img));
      } else resolve(img);
    };
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

const ART_BASE = new URL('assets/art/', import.meta.url).href;
const ART_FILES = {
  full: 'hirise-board.jpg',
  seen: 'hirise-seen.jpg',
  fog: 'hirise-fog.jpg',
  rover: 'rover-nadir.png',
  lander: 'lander-insight.png',
  chute: 'chute.png',
  cam: 'mastcam.jpg',
  noise: 'edge-noise.png',
  sky: 'cam-sky.jpg',
  far: 'cam-far.jpg',
  mid: 'cam-mid.jpg',
  near: 'cam-near.jpg',
  alt: 'cam-alt.jpg',
  pano: 'cam-pano.jpg',
  rocks: 'cam-rocks.png',
  landerFwd: 'lander-cam.png',
  oreTile: 'tile-ore.png',
  dustTile: 'tile-dust.png',
  crater: 'cam-crater.png'
};

let artWarmPromise = null;

export function warmupOrbitalArt() {
  if (!artWarmPromise) {
    artWarmPromise = Promise.all(
      Object.values(ART_FILES).map((name) => loadImage(ART_BASE + name))
    ).then((imgs) => {
      const keys = Object.keys(ART_FILES);
      const bundle = {};
      keys.forEach((k, i) => { bundle[k] = imgs[i]; });
      return bundle;
    });
  }
  return artWarmPromise;
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
    this.ownsLoop = true;
    this.onFrame = null;
    this._frozen = false;
    this._clockNow = null;
    this._lastNow = 0;
    this._lastDt = 16;
    this._cruise = null;
    this._motionLogOn = false;
    this._motionLog = [];
    this._grainPat = null;
    this._scanOverlay = null;
    this._camParity = 0;
    const launchCam = camFollow(this.roverCol, this.roverRow);
    const launchDrift = camDrift(0, this.reduceMotion);
    this.camX = launchCam.x + launchDrift.x;
    this.camY = launchCam.y + launchDrift.y;
    this.camZoom = camZoomPulse(0, this.reduceMotion);
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
    this.lidarImg = null;
    this.thermalImg = null;
    this.spectralImg = null;
    this.heightArr = null;
    this.camColor = null;
    this.hW = 320;
    this.hH = 340;
    this.craterList = [];
    this.camBuf = null;
    this.camBufCtx = null;
    this.lastCam = 0;
    this.camMode = resolveCamMode();
    this.camSky = null;
    this.camFar = null;
    this.camMid = null;
    this.camNear = null;
    this.camAlt = null;
    this.camPano = null;
    this.camRocks = null;
    this.landerFwdImg = null;
    this.camCrater = null;

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
    if (typeof window !== 'undefined') {
      window.__orbitalRenderer = this;
      window.__farRoverMotion = this._motionApi();
      try {
        if (new URLSearchParams(location.search).get('motionlog') === '1') this.enableMotionLog(true);
      } catch {
        // ignore
      }
    }
    warmupOrbitalArt();
    this.loadArt().then(() => {
      if (this.disposed) return;
      this.ready = true;
      this.maskDirty = true;
      this._warmGpu();
      this._prewarmCam();
      this.render(this.now(), 16);
      this.loop();
    }).catch((err) => {
      console.warn('Orbital art failed', err);
      if (!this.disposed) this.loop();
    });
  }

  async loadArt() {
    const bundle = await warmupOrbitalArt();
    this.fullImg = bundle.full;
    this.seenImg = bundle.seen;
    this.fogImg = bundle.fog;
    this.roverImg = bundle.rover;
    this.landerImg = bundle.lander;
    this.chuteImg = bundle.chute;
    this.mastcamImg = bundle.cam;
    this.noiseImg = bundle.noise;
    this.camSky = bundle.sky;
    this.camFar = bundle.far;
    this.camMid = bundle.mid;
    this.camNear = bundle.near;
    this.camAlt = bundle.alt;
    this.camPano = bundle.pano;
    this.camRocks = bundle.rocks;
    this.landerFwdImg = bundle.landerFwd;
    this.oreTileImg = bundle.oreTile;
    this.dustTileImg = bundle.dustTile;
    this.camCrater = bundle.crater;
    this.lastCam = 0;
    this._camTexReady = false;
    this._camPoseKey = '';
    try {
      this._buildAuxMaps();
      this._collectCraters();
      this._bakeCratersIntoHeight();
    } catch (err) {
      console.warn('Orbital aux maps failed', err);
    }
    this.maskDirty = true;
    this.rebuildMasks();
  }

  _warmGpu() {
    try {
      const c = document.createElement('canvas');
      c.width = 64;
      c.height = 64;
      const x = c.getContext('2d');
      if (!x) return;
      const imgs = [
        this.fullImg, this.seenImg, this.fogImg, this.roverImg, this.landerImg,
        this.chuteImg, this.mastcamImg, this.camSky, this.camFar, this.camMid,
        this.camNear, this.camAlt, this.camPano, this.camRocks, this.landerFwdImg,
        this.oreTileImg, this.dustTileImg, this.camCrater, this.lidarImg,
        this.thermalImg, this.spectralImg
      ];
      for (const img of imgs) {
        if (img) x.drawImage(img, 0, 0, 64, 64);
      }
    } catch {
      // ignore
    }
  }

  _prewarmCam() {
    this._warming = true;
    try {
      if (this.ctx) {
        this._drawGrain(this.ctx, this.width, this.height, 0);
        this._drawVignette(this.ctx, this.width, this.height);
      }
      this.lastCam = 0;
      prewarmRoverCam(this, this.now());
      this.render(this.now(), 16);
      this.lastCam = 0;
      prewarmRoverCam(this, this.now() + 40);
      this.render(this.now() + 40, 16);
    } catch (err) {
      console.warn('Rover-cam prewarm failed', err);
    } finally {
      this._warming = false;
    }
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    if (typeof window !== 'undefined' && window.__orbitalRenderer === this) {
      window.__orbitalRenderer = null;
      window.__farRoverMotion = null;
    }
    if (this.raf) cancelAnimationFrame(this.raf);
    window.removeEventListener('resize', this.onResize);
    this.motionQuery?.removeEventListener?.('change', this.onMotion);
    this.canvas.remove();
  }

  resize() {
    const rect = this.container.getBoundingClientRect();
    const cheap = typeof navigator !== 'undefined' && navigator.webdriver;
    const dpr = cheap ? 1 : Math.min(2, window.devicePixelRatio || 1);
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
    this.seenBase = document.createElement('canvas');
    this.seenBase.width = mw;
    this.seenBase.height = mh;
    this.seenBaseCtx = this.seenBase.getContext('2d');
    this.fullBase = document.createElement('canvas');
    this.fullBase.width = mw;
    this.fullBase.height = mh;
    this.fullBaseCtx = this.fullBase.getContext('2d');
    this._maskBaseValid = false;
    this._scanOverlay = null;
    this._grainPat = null;
    this._vignette = null;
    this.maskDirty = true;
    this.render();
  }

  setPlaybackSpeed(speed) {
    this.playbackSpeed = speed || 1;
  }

  setPausedHint(paused) {
    const next = !!paused;
    if (next && !this.paused) this.snapPose();
    this.paused = next;
  }

  snapPose() {
    this.anim = null;
    if (!this.gameState) return;
    this.roverCol = this.gameState.col;
    this.roverRow = this.gameState.row;
    this.heading = FACE_RAD[this.gameState.facing] ?? this.heading;
    this._stampTrack(this.roverCol, this.roverRow, this.heading);
  }

  setSensorLayer(name, on) {
    if (!(name in this.sensorLayers)) return;
    this.sensorLayers[name] = !!on;
    if (this.ready) this.render();
  }

  setCamMode(mode) {
    if (!CAM_MODES.includes(mode)) return;
    this.camMode = mode;
    persistCamMode(mode);
    this.lastCam = 0;
    if (this.ready) this.render();
  }

  setGridForced(on) {
    this.gridForced = !!on;
  }

  resetView() {
    const cam = camFollow(this.roverCol ?? LANDER_COL, this.roverRow ?? LANDER_ROW);
    const t = (this.now() - this.t0) / 1000;
    const drift = camDrift(t, this.reduceMotion);
    this.camX = cam.x + drift.x;
    this.camY = cam.y + drift.y;
    this.camZoom = camZoomPulse(t, this.reduceMotion);
  }

  updateState(gameState) {
    this.gameState = gameState;
    this._collectCraters();
    this._bakeCratersIntoHeight();
    if (gameState && !this.anim) {
      this.roverCol = gameState.col;
      this.roverRow = gameState.row;
      this.heading = FACE_RAD[gameState.facing] || this.heading;
    }
    this.syncCloudTargets();
  }

  now() {
    if (this._clockNow != null) return this._clockNow;
    return performance.now();
  }

  startAnimation(fromCol, fromRow, toCol, toRow, duration = 120, now = null, peek = null) {
    const t0 = now != null ? now : this.now();
    const facingH = FACE_RAD[this.gameState?.facing] ?? this.heading;
    let fromC = this.roverCol;
    let fromR = this.roverRow;
    let fromH = this.heading;
    const moving = Math.hypot(toCol - fromCol, toRow - fromRow) > 0.001;
    if (!moving) {
      fromC = toCol;
      fromR = toRow;
      this.roverCol = toCol;
      this.roverRow = toRow;
    }
    let dx = toCol - fromC;
    let dy = toRow - fromR;
    const prev = this._cruise;
    const recent = !!(prev && (this.anim || (t0 - (prev.endedAt || 0)) < 80));
    const sameDir = !!(prev && prev.moving && moving && recent
      && Math.sign(dx || 0) === Math.sign(prev.dx || 0)
      && Math.sign(dy || 0) === Math.sign(prev.dy || 0)
      && Math.abs(wrapAngle(facingH - fromH)) < 0.4);
    const reverseEarly = !!(prev && prev.moving && moving
      && (dx * (prev.dx || 0) + dy * (prev.dy || 0)) < -0.2);
    const continueMotion = !!(prev && prev.moving && moving && recent && !reverseEarly);
    if (continueMotion && this.anim) {
      fromC = this.anim.toCol;
      fromR = this.anim.toRow;
      fromH = this.anim.toH;
      this.roverCol = fromC;
      this.roverRow = fromR;
      this.heading = fromH;
      dx = toCol - fromC;
      dy = toRow - fromR;
    }
    let toH = facingH;
    if (peek?.facing && FACE_RAD[peek.facing] != null) {
      const peekH = FACE_RAD[peek.facing];
      const peekMove = Math.hypot((peek.col ?? toCol) - toCol, (peek.row ?? toRow) - toRow) > 0.01;
      if (!peekMove && Math.abs(wrapAngle(peekH - facingH)) > 0.2) toH = peekH;
    }
    let dh = wrapAngle(toH - fromH);
    toH = fromH + dh;
    const peekDx = peek ? (peek.col ?? toCol) - toCol : 0;
    const peekDy = peek ? (peek.row ?? toRow) - toRow : 0;
    const peekMove = Math.hypot(peekDx, peekDy) > 0.01;
    const turning = Math.abs(dh) > 0.2;
    const reverse = reverseEarly
      || !!(prev && prev.moving && moving
        && (dx * (prev.dx || 0) + dy * (prev.dy || 0)) < -0.2);
    const corner = !!(continueMotion && !sameDir);
    const easeIn = moving && !continueMotion;
    // Carry cruise through a corner; a following drill/turn-in-place
    // is a real stop after the arc, not a mid-corner ease-out.
    const easeOut = moving && !corner && (!peekMove || reverse);
    let headingMode = 'linear';
    if (!moving && turning) headingMode = peekMove ? 'early' : 'full';
    else if (moving && peek && !peekMove && Math.abs(wrapAngle((FACE_RAD[peek.facing] ?? toH) - facingH)) > 0.2) {
      headingMode = 'late';
    } else if (moving && turning) headingMode = 'full';
    if (moving) this.driveU += 1;
    const inDx = prev && prev.moving ? prev.dx : dx;
    const inDy = prev && prev.moving ? prev.dy : dy;
    this.anim = {
      fromCol: fromC,
      fromRow: fromR,
      toCol,
      toRow,
      fromH,
      toH,
      start: t0,
      duration: Math.max(16, duration),
      moving,
      easeIn,
      easeOut,
      headingMode,
      corner,
      pts: corner ? buildCornerPts(fromC, fromR, toCol, toRow, inDx, inDy, dx, dy) : null,
      turnArc: (!moving && turning),
      peekCol: peekMove ? peek.col : toCol,
      peekRow: peekMove ? peek.row : toRow
    };
    this._cruise = {
      moving,
      turnArc: (!moving && turning) || corner,
      dx: moving ? dx : 0,
      dy: moving ? dy : 0,
      heading: toH,
      endedAt: t0 + Math.max(16, duration)
    };
    this._stampTrack(fromC, fromR, fromH);
  }

  _stampTrack(col, row, heading) {
    const last = this.tracks[this.tracks.length - 1];
    if (last && Math.hypot(last.col - col, last.row - row) < 0.06) {
      last.heading = heading;
      last.col = col;
      last.row = row;
      return;
    }
    this.tracks.push({ col, row, heading });
    if (this.tracks.length > 220) this.tracks.shift();
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
      this.cloudFadeStart = this.now();
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
    if (now - (this._lastCloudMask || 0) >= 16 || t >= 1) {
      this.maskDirty = true;
      this._maskBaseValid = false;
      this._lastCloudMask = now;
    }
    if (t >= 1) this.cloudFading = false;
  }

  loop = (rafNow) => {
    if (this.disposed) return;
    this.raf = requestAnimationFrame(this.loop);
    if (this._frozen) return;
    const now = this._clockNow != null ? this._clockNow : rafNow;
    const dt = this._lastNow ? now - this._lastNow : 16;
    this._lastNow = now;
    this._lastDt = dt;
    if (this.onFrame) this.onFrame(now, dt);
    this.render(now, dt);
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

  _collectCraters() {
    const terrain = this.gameState?.terrain;
    if (!terrain) return;
    const list = [];
    for (let r = 0; r < GRID_ROWS; r++) {
      for (let c = 0; c < GRID_COLS; c++) {
        if (terrain[r][c] === 'crater') list.push({ c: c + 0.5, r: r + 0.5 });
      }
    }
    this.craterList = list;
  }

  _buildAuxMaps() {
    const src = this.fullImg;
    if (!src) return;
    const lw = Math.max(2, Math.floor(src.width / 2));
    const lh = Math.max(2, Math.floor(src.height / 2));
    const srcC = document.createElement('canvas');
    srcC.width = lw;
    srcC.height = lh;
    const sctx = srcC.getContext('2d', { willReadFrequently: true });
    sctx.drawImage(src, 0, 0, lw, lh);
    const pix = sctx.getImageData(0, 0, lw, lh);
    const d = pix.data;
    const lidar = sctx.createImageData(lw, lh);
    const therm = sctx.createImageData(lw, lh);
    const spec = sctx.createImageData(lw, lh);
    const ld = lidar.data;
    const td = therm.data;
    const sd = spec.data;
    const lumaAt = (x, y) => {
      const xx = x < 0 ? 0 : x >= lw ? lw - 1 : x;
      const yy = y < 0 ? 0 : y >= lh ? lh - 1 : y;
      const i = (yy * lw + xx) * 4;
      return (d[i] * 0.3 + d[i + 1] * 0.5 + d[i + 2] * 0.2) / 255;
    };
    const heatRGB = (t) => {
      const u = Math.max(0, Math.min(1, t));
      if (u < 0.28) {
        const k = u / 0.28;
        return [18 + 50 * k, 8 + 24 * k, 90 + 110 * k];
      }
      if (u < 0.52) {
        const k = (u - 0.28) / 0.24;
        return [68 + 90 * k, 32 + 20 * k, 200 - 90 * k];
      }
      if (u < 0.76) {
        const k = (u - 0.52) / 0.24;
        return [158 + 70 * k, 52 + 90 * k, 110 - 55 * k];
      }
      const k = (u - 0.76) / 0.24;
      return [228 + 27 * k, 142 + 90 * k, 48 + 10 * k];
    };
    for (let y = 0; y < lh; y++) {
      for (let x = 0; x < lw; x++) {
        const i = (y * lw + x) * 4;
        const L = lumaAt(x, y);
        const dx = lumaAt(x + 1, y) - lumaAt(x - 1, y);
        const dy = lumaAt(x, y + 1) - lumaAt(x, y - 1);
        const nx = -dx * 5;
        const ny = -dy * 5;
        const inv = 1 / Math.hypot(nx, ny, 1);
        const shade = Math.max(0.08, Math.min(1, -nx * inv * 0.62 + ny * inv * 0.18 + inv * 0.78));
        let lr;
        let lg;
        let lb;
        if (L < 0.34) {
          const k = L / 0.34;
          lr = (8 + 24 * k) * shade;
          lg = (36 + 90 * k) * shade;
          lb = (110 + 90 * k) * shade;
        } else if (L < 0.66) {
          const k = (L - 0.34) / 0.32;
          lr = (32 + 100 * k) * shade;
          lg = (126 + 30 * k) * shade;
          lb = (200 - 80 * k) * shade;
        } else {
          const k = (L - 0.66) / 0.34;
          lr = (132 + 90 * k) * shade;
          lg = (156 + 60 * k) * shade;
          lb = (120 + 20 * k) * shade;
        }
        const band = Math.abs((L * 16) % 1);
        if (band < 0.07 || band > 0.93) {
          lr = lr * 0.25 + 160 * 0.75;
          lg = lg * 0.25 + 230 * 0.75;
          lb = lb * 0.25 + 255 * 0.75;
        }
        ld[i] = lr;
        ld[i + 1] = lg;
        ld[i + 2] = lb;
        ld[i + 3] = 255;
        const heat = L * 0.5 + shade * 0.5;
        const [tr, tg, tb] = heatRGB(heat * 0.88 + 0.04);
        td[i] = tr;
        td[i + 1] = tg;
        td[i + 2] = tb;
        td[i + 3] = 255;
        sd[i] = Math.min(255, d[i] * 0.28 + d[i + 1] * 0.95);
        sd[i + 1] = Math.min(255, d[i] * 0.5 + d[i + 2] * 0.55);
        sd[i + 2] = Math.min(255, d[i] * 1.15 + 12);
        sd[i + 3] = 255;
      }
    }
    const toCanvas = (imgData) => {
      const o = document.createElement('canvas');
      o.width = lw;
      o.height = lh;
      o.getContext('2d').putImageData(imgData, 0, 0);
      return o;
    };
    this.lidarImg = toCanvas(lidar);
    this.thermalImg = toCanvas(therm);
    this.spectralImg = toCanvas(spec);

    const hW = this.hW;
    const hH = this.hH;
    this.heightArr = new Float32Array(hW * hH);
    this.camColor = new Uint8ClampedArray(hW * hH * 4);
    const hc = document.createElement('canvas');
    hc.width = hW;
    hc.height = hH;
    const hctx = hc.getContext('2d', { willReadFrequently: true });
    hctx.drawImage(src, 0, 0, hW, hH);
    const hp = hctx.getImageData(0, 0, hW, hH).data;
    for (let y = 0; y < hH; y++) {
      for (let x = 0; x < hW; x++) {
        const i = (y * hW + x) * 4;
        const L = (hp[i] * 0.3 + hp[i + 1] * 0.5 + hp[i + 2] * 0.2) / 255;
        this.heightArr[y * hW + x] = L * 0.2;
        this.camColor[i] = Math.min(255, hp[i] * 1.28 + 20);
        this.camColor[i + 1] = Math.min(255, hp[i + 1] * 0.8 + 10);
        this.camColor[i + 2] = Math.min(255, hp[i + 2] * 0.36 + 4);
        this.camColor[i + 3] = 255;
      }
    }
  }

  _bakeCratersIntoHeight() {
    if (!this.heightArr || !this.craterList.length || this.heightCratersBaked) return;
    const hW = this.hW;
    const hH = this.hH;
    for (const cr of this.craterList) {
      const cx = ((cr.c - MAP.originCol) / MAP.texCols) * (hW - 1);
      const cy = ((cr.r - MAP.originRow) / MAP.texRows) * (hH - 1);
      const rad = (0.78 / MAP.texCols) * hW;
      const r0 = Math.max(0, Math.floor(cy - rad - 2));
      const r1 = Math.min(hH - 1, Math.ceil(cy + rad + 2));
      const c0 = Math.max(0, Math.floor(cx - rad - 2));
      const c1 = Math.min(hW - 1, Math.ceil(cx + rad + 2));
      for (let y = r0; y <= r1; y++) {
        for (let x = c0; x <= c1; x++) {
          const d = Math.hypot(x - cx, y - cy) / rad;
          let add = 0;
          if (d < 1) add -= 0.78 * (1 - d * d);
          add += 0.2 * Math.exp(-(((d - 0.9) / 0.14) ** 2));
          this.heightArr[y * hW + x] += add;
        }
      }
    }
    this.heightCratersBaked = true;
  }

  _sampleBilinear(arr, cols, col, row, stride = 1, offset = 0) {
    const u = ((col - MAP.originCol) / MAP.texCols) * (this.hW - 1);
    const v = ((row - MAP.originRow) / MAP.texRows) * (this.hH - 1);
    const x0 = Math.max(0, Math.min(this.hW - 1, Math.floor(u)));
    const y0 = Math.max(0, Math.min(this.hH - 1, Math.floor(v)));
    const x1 = Math.min(this.hW - 1, x0 + 1);
    const y1 = Math.min(this.hH - 1, y0 + 1);
    const fx = u - x0;
    const fy = v - y0;
    const i00 = (y0 * this.hW + x0) * stride + offset;
    const i10 = (y0 * this.hW + x1) * stride + offset;
    const i01 = (y1 * this.hW + x0) * stride + offset;
    const i11 = (y1 * this.hW + x1) * stride + offset;
    return lerp(lerp(arr[i00], arr[i10], fx), lerp(arr[i01], arr[i11], fx), fy);
  }

  _heightAt(col, row) {
    if (!this.heightArr) return 0;
    return this._sampleBilinear(this.heightArr, this.hW, col, row);
  }

  _camColorAt(col, row, z) {
    if (!this.camColor) return 'rgb(150,110,70)';
    let r = this._sampleBilinear(this.camColor, this.hW, col, row, 4, 0);
    let g = this._sampleBilinear(this.camColor, this.hW, col, row, 4, 1);
    let b = this._sampleBilinear(this.camColor, this.hW, col, row, 4, 2);
    const ht = this._heightAt(col, row);
    const hx = this._heightAt(col + 0.08, row) - this._heightAt(col - 0.08, row);
    const hy = this._heightAt(col, row + 0.08) - this._heightAt(col, row - 0.08);
    const shade = Math.max(0.32, Math.min(1.2, 0.78 - hx * 3.2 + hy * 0.7));
    r *= shade;
    g *= shade;
    b *= shade;
    if (ht < -0.1) {
      const k = Math.min(1, (-ht - 0.1) / 0.55);
      r *= 1 - 0.5 * k;
      g *= 1 - 0.42 * k;
      b *= 1 - 0.22 * k;
    }
    const fog = Math.min(1, Math.max(0, z / 6.4));
    r = r + (210 - r) * fog * 0.58;
    g = g + (168 - g) * fog * 0.58;
    b = b + (110 - b) * fog * 0.58;
    return `rgb(${r | 0},${g | 0},${b | 0})`;
  }

  _maskWorldTransform(ctx) {
    const w = this.seenMask.width;
    const h = this.seenMask.height;
    const sx = w / MAP.texCols;
    const sy = h / MAP.texRows;
    ctx.setTransform(sx, 0, 0, sy, -MAP.originCol * sx, -MAP.originRow * sy);
  }

  _rebuildMaskBase() {
    if (!this.seenBaseCtx || !this.fullBaseCtx) return;
    const seen = this.seenBaseCtx;
    const full = this.fullBaseCtx;
    const w = this.seenBase.width;
    const h = this.seenBase.height;
    seen.setTransform(1, 0, 0, 1, 0, 0);
    seen.clearRect(0, 0, w, h);
    full.setTransform(1, 0, 0, 1, 0, 0);
    full.clearRect(0, 0, w, h);
    this._maskWorldTransform(seen);
    this._maskWorldTransform(full);
    this._stampOrganic(seen, LANDER_COL, LANDER_ROW, 3.15, 1);
    this._stampOrganic(seen, LANDER_COL + 0.8, LANDER_ROW - 0.4, 1.7, 0.85);
    this._stampOrganic(full, LANDER_COL, LANDER_ROW, 1.35, 1);
    this._stampOrganic(full, LANDER_COL + 0.55, LANDER_ROW - 0.15, 0.95, 0.9);
    for (let row = 0; row < GRID_ROWS; row++) {
      for (let col = 0; col < GRID_COLS; col++) {
        const v = this.cloudDisplay[row][col];
        const reveal = Math.max(0, Math.min(1, (CLOUD_HIDDEN - v) / CLOUD_HIDDEN));
        if (reveal < 0.02) continue;
        const camK = Math.max(0, Math.min(1, reveal / (CLOUD_HIDDEN - CLOUD_CAMERA)));
        this._stampOrganic(seen, col, row, 0.55 + 1.0 * camK, Math.max(0.08, camK));
        if (v < CLOUD_CAMERA - 0.01) {
          const clearK = Math.max(0, Math.min(1, (CLOUD_CAMERA - v) / CLOUD_CAMERA));
          this._stampOrganic(full, col, row, 0.45 + 0.63 * clearK, clearK);
        }
      }
    }
    this._maskBaseValid = true;
  }

  _blitMaskRover() {
    if (!this.seenMaskCtx || !this.seenBase) return;
    const w = this.seenMask.width;
    const h = this.seenMask.height;
    this.seenMaskCtx.setTransform(1, 0, 0, 1, 0, 0);
    this.seenMaskCtx.clearRect(0, 0, w, h);
    this.seenMaskCtx.drawImage(this.seenBase, 0, 0);
    this.fullMaskCtx.setTransform(1, 0, 0, 1, 0, 0);
    this.fullMaskCtx.clearRect(0, 0, w, h);
    this.fullMaskCtx.drawImage(this.fullBase, 0, 0);
    this._maskWorldTransform(this.seenMaskCtx);
    this._maskWorldTransform(this.fullMaskCtx);
    if (Number.isFinite(this.roverCol) && Number.isFinite(this.roverRow)) {
      this._stampOrganic(this.seenMaskCtx, this.roverCol, this.roverRow, 1.65, 1);
      this._stampOrganic(this.fullMaskCtx, this.roverCol, this.roverRow, 1.12, 0.95);
      this._maskRoverCol = this.roverCol;
      this._maskRoverRow = this.roverRow;
    }
  }

  rebuildMasks() {
    if (!this.seenMaskCtx) return;
    if (!this._maskBaseValid || this.cloudFading) this._rebuildMaskBase();
    this._blitMaskRover();
    this.maskDirty = false;
  }

  worldToScreen(col, row, scale, tx, ty) {
    return { x: col * scale + tx, y: row * scale + ty };
  }

  stepAnim(now) {
    if (!this.anim) return false;
    const a = this.anim;
    const t = Math.min(1, (now - a.start) / a.duration);
    const e = posEase(t, !!a.easeIn, !!a.easeOut);
    const ht = headingEase(t, a.headingMode || 'linear');
    let col;
    let row;
    if (a.corner && a.pts) {
      const p = sampleCorner(a.pts, e);
      col = p.x;
      row = p.y;
    } else {
      col = lerp(a.fromCol, a.toCol, e);
      row = lerp(a.fromRow, a.toRow, e);
    }
    if (a.turnArc && !a.corner) {
      const dh = a.toH - a.fromH;
      const inset = 0.12 * Math.sin(Math.PI * t);
      const fx = Math.cos(a.fromH);
      const fy = Math.sin(a.fromH);
      const rx = -Math.sin(a.fromH);
      const ry = Math.cos(a.fromH);
      const side = dh >= 0 ? 1 : -1;
      col += rx * inset * side * 0.55 + fx * inset * 0.4;
      row += ry * inset * side * 0.55 + fy * inset * 0.4;
    }
    this.roverCol = col;
    this.roverRow = row;
    this.heading = a.fromH + (a.toH - a.fromH) * ht;
    if (a.moving && (t * 12 | 0) !== (this._trackStep || 0)) {
      this._trackStep = t * 12 | 0;
      this._stampTrack(this.roverCol, this.roverRow, this.heading);
    }
    if (Math.hypot(this.roverCol - (this._maskRoverCol ?? 99), this.roverRow - (this._maskRoverRow ?? 99)) > 0.08) {
      this.maskDirty = true;
    }
    if (t >= 1) {
      this._stampTrack(a.toCol, a.toRow, a.toH);
      this.roverCol = a.toCol;
      this.roverRow = a.toRow;
      this.heading = a.toH;
      if (this._cruise) this._cruise.endedAt = now;
      this.anim = null;
      this.maskDirty = true;
    }
    return true;
  }

  render(now = this.now(), dt = this._lastDt) {
    if (this.disposed || !this.ctx) return;
    this.stepCloudFade(now);
    this.stepAnim(now);
    if (this.maskDirty) this.rebuildMasks();

    const w = this.width;
    const h = this.height;
    const t = (now - this.t0) / 1000;
    const reduce = this.reduceMotion;
    const roverCol = this.roverCol;
    const roverRow = this.roverRow;

    const want = camFollow(roverCol, roverRow);
    const drift = camDrift(t, reduce);
    const zoomPulse = camZoomPulse(t, reduce);
    const tau = 0.7;
    const camDt = Math.min(33, Math.max(dt, 1));
    const camK = reduce ? 1 : (1 - Math.exp(-(camDt / 1000) / tau));
    this.camX = lerp(this.camX, want.x + drift.x, camK);
    this.camY = lerp(this.camY, want.y + drift.y, camK);
    this.camZoom = lerp(this.camZoom, zoomPulse, reduce ? 1 : camK * 0.85);

    const fit = Math.min(w / 16.8, h / 13.4);
    const scale = fit * this.camZoom;
    const tx = w / 2 - this.camX * scale;
    const ty = h / 2 - this.camY * scale;
    this._view = { scale, tx, ty, dpr: this.canvas.width / w, w, h };

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
    if (this.sensorLayers.camera !== false) {
      blitMasked(this.fullImg, this.fullMask);
    }

    const blitLayer = (img, mask, mode, alpha) => {
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
      wctx.save();
      wctx.globalAlpha = alpha;
      wctx.globalCompositeOperation = mode;
      wctx.drawImage(this.tmp, 0, 0);
      wctx.restore();
      wctx.setTransform(dpr * scale, 0, 0, dpr * scale, dpr * tx, dpr * ty);
    };

    if (this.sensorLayers.lidar) blitLayer(this.lidarImg, this.seenMask, 'source-over', 0.88);
    if (this.sensorLayers.thermal) blitLayer(this.thermalImg, this.seenMask, 'source-over', 0.72);
    if (this.sensorLayers.spectral) blitLayer(this.spectralImg, this.seenMask, 'source-over', 0.7);

    this._drawTracks(wctx);
    this._drawPath(wctx, roverCol, roverRow);
    this._drawSensors(wctx);
    this._drawSprites(wctx, roverCol, roverRow, scale);
    if (this.gridForced) this._drawGrid(wctx);

    const ctx = this.ctx;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.drawImage(this.world, 0, 0, w, h);

    this._drawReticle(ctx, roverCol * scale + tx, roverRow * scale + ty);
    this._drawGrain(ctx, w, h, t);
    this._drawVignette(ctx, w, h);
    this._drawRoverCam(now, t);
    this._sampleMotion(now, dt);
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

  _tileKnown(col, row) {
    const state = this.gameState;
    if (!state) return false;
    return !!(state.revealed?.[row]?.[col] || state.cameraSeen?.[row]?.[col]);
  }

  _cellName(col, row) {
    return String.fromCharCode(65 + col) + (row + 1);
  }

  _idBracket(ctx, cx, cy, label) {
    const x0 = cx - 0.3;
    const y0 = cy - 0.26;
    const x1 = cx + 0.3;
    const y1 = cy + 0.26;
    const tick = 0.1;
    ctx.save();
    ctx.strokeStyle = 'rgba(236, 228, 210, 0.88)';
    ctx.lineWidth = 0.035;
    ctx.lineCap = 'square';
    ctx.beginPath();
    ctx.moveTo(x0, y0 + tick); ctx.lineTo(x0, y0); ctx.lineTo(x0 + tick, y0);
    ctx.moveTo(x1, y0 + tick); ctx.lineTo(x1, y0); ctx.lineTo(x1 - tick, y0);
    ctx.moveTo(x0, y1 - tick); ctx.lineTo(x0, y1); ctx.lineTo(x0 + tick, y1);
    ctx.moveTo(x1, y1 - tick); ctx.lineTo(x1, y1); ctx.lineTo(x1 - tick, y1);
    ctx.stroke();
    ctx.fillStyle = 'rgba(236, 228, 210, 0.86)';
    ctx.font = '0.17px "IBM Plex Mono", ui-monospace, monospace';
    ctx.fillText(label, x0 + 0.02, y1 + 0.16);
    ctx.restore();
  }

  _drawOreMark(ctx, col, row, drilled) {
    const cx = col + 0.5;
    const cy = row + 0.5;
    const n = this._noiseAt(col, row);
    if (drilled) {
      ctx.fillStyle = 'rgba(70, 52, 36, 0.4)';
      ctx.beginPath();
      ctx.ellipse(cx, cy, 0.09, 0.07, 0.2, 0, Math.PI * 2);
      ctx.fill();
      this._idBracket(ctx, cx, cy, this._cellName(col, row));
      return;
    }
    ctx.save();
    ctx.fillStyle = 'rgba(255, 236, 196, 0.96)';
    ctx.beginPath();
    ctx.ellipse(cx, cy, 0.12, 0.09, n, 0, Math.PI * 2);
    ctx.fill();
    for (let i = 0; i < 9; i++) {
      const dx = (this._noiseAt(col + i * 1.7, row) - 0.5) * 0.26;
      const dy = (this._noiseAt(col, row + i * 2.1) - 0.5) * 0.2;
      const px = cx + dx;
      const py = cy + dy;
      const r = 0.05 + (i % 3) * 0.028;
      const nearCore = Math.hypot(dx, dy) < 0.1;
      ctx.fillStyle = (nearCore || i % 2 === 0)
        ? 'rgba(248, 236, 210, 0.95)'
        : 'rgba(42, 28, 18, 0.88)';
      ctx.beginPath();
      ctx.ellipse(px, py, r, r * 0.7, n, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
    this._idBracket(ctx, cx, cy, this._cellName(col, row));
  }

  _drawDustMark(ctx, col, row) {
    const cx = col + 0.5;
    const cy = row + 0.5;
    const g = ctx.createRadialGradient(cx, cy, 0.05, cx, cy, 0.4);
    g.addColorStop(0, 'rgba(214, 176, 126, 0.5)');
    g.addColorStop(0.55, 'rgba(186, 142, 96, 0.26)');
    g.addColorStop(1, 'rgba(160, 110, 70, 0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.ellipse(cx, cy + 0.02, 0.38, 0.24, 0.12, 0, Math.PI * 2);
    ctx.fill();
    ctx.save();
    ctx.strokeStyle = 'rgba(224, 188, 140, 0.78)';
    ctx.lineWidth = 0.04;
    ctx.setLineDash([0.04, 0.045]);
    ctx.beginPath();
    ctx.ellipse(cx, cy + 0.02, 0.34, 0.21, 0.12, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  _drawSensors(ctx) {
    const state = this.gameState;
    if (!state?.terrain) return;
    const oreCells = [];
    const dustCells = [];
    ctx.save();
    const showCamera = this.sensorLayers.camera !== false;
    for (let row = 0; row < GRID_ROWS; row++) {
      for (let col = 0; col < GRID_COLS; col++) {
        if (!this._tileKnown(col, row)) continue;
        const t = state.terrain[row][col];
        if (t === 'ore') {
          if (showCamera) this._drawOreMark(ctx, col, row, !!state.drilled?.[row]?.[col]);
          oreCells.push(this._cellName(col, row));
        } else if (t === 'dust') {
          if (showCamera) this._drawDustMark(ctx, col, row);
          dustCells.push(this._cellName(col, row));
        }
      }
    }
    if (this.sensorLayers.spectral) {
      for (let row = 0; row < GRID_ROWS; row++) {
        for (let col = 0; col < GRID_COLS; col++) {
          if (!this._tileKnown(col, row)) continue;
          if (state.terrain[row][col] !== 'ore') continue;
          const cx = col + 0.5;
          const cy = row + 0.5;
          ctx.fillStyle = state.drilled?.[row]?.[col] ? 'rgba(180,170,140,0.28)' : 'rgba(40, 255, 210, 0.42)';
          ctx.beginPath();
          ctx.ellipse(cx, cy, 0.28, 0.2, 0.4, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }
    if (this.sensorLayers.thermal) {
      const glow = (x, y, r) => {
        const g = ctx.createRadialGradient(x, y, 0.04, x, y, r);
        g.addColorStop(0, 'rgba(255, 230, 160, 0.85)');
        g.addColorStop(0.35, 'rgba(255, 120, 40, 0.45)');
        g.addColorStop(1, 'rgba(255, 40, 0, 0)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fill();
      };
      glow(this.roverCol + 0.5, this.roverRow + 0.42, 0.55);
      glow(LANDER_COL + 0.5, LANDER_ROW + 0.72, 0.7);
      for (let row = 0; row < GRID_ROWS; row++) {
        for (let col = 0; col < GRID_COLS; col++) {
          if (!this._tileKnown(col, row)) continue;
          if (state.terrain[row][col] !== 'dust') continue;
          glow(col + 0.5, row + 0.5, 0.42);
        }
      }
    }
    ctx.restore();
    if (this.canvas) {
      this.canvas.dataset.oreMarks = showCamera ? oreCells.join(',') : '';
      this.canvas.dataset.dustMarks = showCamera ? dustCells.join(',') : '';
    }
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
    if (!this._grainPat) this._grainPat = ctx.createPattern(this.grain, 'repeat');
    ctx.save();
    ctx.globalAlpha = 0.11;
    const ox = (t * 18) % 64;
    const oy = (t * 11) % 64;
    ctx.translate(-ox, -oy);
    ctx.fillStyle = this._grainPat;
    ctx.fillRect(ox, oy, w + 64, h + 64);
    ctx.restore();
    if (!this._scanOverlay || this._scanOverlay.width !== Math.ceil(w) || this._scanOverlay.height !== Math.ceil(h)) {
      const c = document.createElement('canvas');
      c.width = Math.max(1, Math.ceil(w));
      c.height = Math.max(1, Math.ceil(h));
      const s = c.getContext('2d');
      s.fillStyle = '#fff';
      for (let y = 0; y < c.height; y += 3) {
        s.globalAlpha = 0.035;
        s.fillRect(0, y, c.width, 1);
      }
      this._scanOverlay = c;
    }
    ctx.save();
    ctx.globalAlpha = 0.7;
    ctx.drawImage(this._scanOverlay, 0, 0);
    ctx.restore();
  }

  _drawVignette(ctx, w, h) {
    if (!this._vignette || this._vignette.w !== w || this._vignette.h !== h) {
      const c = document.createElement('canvas');
      c.width = Math.max(1, Math.ceil(w));
      c.height = Math.max(1, Math.ceil(h));
      const v = c.getContext('2d');
      const g = v.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.25, w / 2, h / 2, Math.max(w, h) * 0.72);
      g.addColorStop(0, 'rgba(0,0,0,0)');
      g.addColorStop(1, 'rgba(6, 7, 8, 0.42)');
      v.fillStyle = g;
      v.fillRect(0, 0, w, h);
      this._vignette = { c, w, h };
    }
    ctx.drawImage(this._vignette.c, 0, 0);
  }

  _drawRoverCam(now, t) {
    this._camParity ^= 1;
    if (this._camParity && this.playbackSpeed < 16 && this.lastCam) return;
    drawRoverCam(this, now, t);
  }

  enableMotionLog(on) {
    this._motionLogOn = !!on;
    if (on) this._motionLog = [];
  }

  _sampleMotion(now, dt) {
    if (!this._motionLogOn || this._warming) return;
    const view = this._view;
    const sx = view ? this.roverCol * view.scale + view.tx : 0;
    const sy = view ? this.roverRow * view.scale + view.ty : 0;
    const prev = this._motionLog[this._motionLog.length - 1];
    let speed = 0;
    if (prev && dt > 0) {
      const tilesPerSec = Math.hypot(this.roverCol - prev.col, this.roverRow - prev.row) / (dt / 1000);
      speed = tilesPerSec;
    }
    this._motionLog.push({
      now,
      dt,
      col: this.roverCol,
      row: this.roverRow,
      heading: this.heading,
      sx,
      sy,
      speed,
      moving: !!(this.anim && this.anim.moving)
    });
  }

  motionStats() {
    return summarizeMotionLog(this._motionLog);
  }

  freezeClock(on = true) {
    this._frozen = !!on;
    if (on && this._clockNow == null) this._clockNow = performance.now();
  }

  setNow(t) {
    this._clockNow = t;
  }

  pump(now, dt = 16) {
    const prev = this._lastNow || now;
    const step = dt || (now - prev) || 16;
    this._clockNow = now;
    this._lastDt = step;
    this._lastNow = now;
    if (this.onFrame) this.onFrame(now, step);
    this.render(now, step);
  }

  _motionApi() {
    const r = this;
    return {
      pose: () => ({ col: r.roverCol, row: r.roverRow, heading: r.heading, dt: r._lastDt }),
      freeze: (on = true) => r.freezeClock(on),
      setNow: (t) => r.setNow(t),
      now: () => r.now(),
      pump: (now, dt) => r.pump(now, dt),
      startLog: () => r.enableMotionLog(true),
      stopLog: () => {
        r.enableMotionLog(false);
        return r._motionLog;
      },
      log: () => r._motionLog,
      stats: () => r.motionStats()
    };
  }
}

export { summarizeMotionLog };

export default OrbitalRenderer;
