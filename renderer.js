// Far Rover Canvas Renderer
// Photo-realistic Mars terrain with perspective projection

const GRID_COLS = 12;
const GRID_ROWS = 12;
const LANDER_COL = 5;
const LANDER_ROW = 12;

// Asset paths
const ASSET_BASE = 'assets/art/';
const ASSET_MANIFEST = {
  tiles: {
    'ground-1': 'tile-ground-1.png',
    'ground-2': 'tile-ground-2.png',
    'ground-3': 'tile-ground-3.png',
    'dust': 'tile-dust.png',
    'ore': 'tile-ore.png',
    'ore-drilled': 'tile-ore-drilled.png',
    'crater': 'tile-crater.png'
  },
  sprites: {
    'rover-n': 'rover-n.png',
    'rover-e': 'rover-e.png',
    'rover-s': 'rover-s.png',
    'rover-w': 'rover-w.png',
    'lander': 'lander.png'
  },
  ui: {
    'bg-horizon': 'bg-horizon.png',
    'icon-battery': 'icon-battery.png',
    'icon-ore': 'icon-ore.png',
    'icon-uplink': 'icon-uplink.png',
    'icon-distance': 'icon-distance.png',
    'icon-dust': 'icon-dust.png',
    'icon-spectral': 'icon-spectral.png',
    'icon-camera': 'icon-camera.png'
  }
};

const loadedAssets = {};
let assetsLoaded = false;

// Ground variant pattern (deterministic based on col,row)
function getGroundVariant(col, row) {
  const hash = (col * 7 + row * 13 + col * row) % 3;
  return hash + 1;
}

export async function loadAssets() {
  const promises = [];
  
  for (const [category, assets] of Object.entries(ASSET_MANIFEST)) {
    for (const [key, filename] of Object.entries(assets)) {
      const id = `${category}:${key}`;
      promises.push(
        new Promise((resolve) => {
          const img = new Image();
          img.onload = () => {
            loadedAssets[id] = img;
            resolve(true);
          };
          img.onerror = () => resolve(false);
          img.src = ASSET_BASE + filename;
        })
      );
    }
  }
  
  await Promise.all(promises);
  assetsLoaded = true;
}

function getAsset(category, key) {
  return loadedAssets[`${category}:${key}`] || null;
}

export function hasRealArt() {
  return getAsset('ui', 'bg-horizon') !== null;
}

export function getBackgroundImage() {
  return getAsset('ui', 'bg-horizon');
}

export function getIcon(name) {
  return getAsset('ui', `icon-${name}`);
}

// Procedural fallback colors
const COLORS = {
  marsSurface: '#b8613a',
  marsDark: '#8b3a1f',
  marsLight: '#d4805c',
  ore: '#f1c40f',
  dust: '#c47a4a',
  crater: '#4a2315',
  hidden: 'rgba(70, 32, 14, 0.18)',
  cameraSeen: 'rgba(40, 70, 110, 0.28)',
  fog: 'rgba(180, 95, 45, 0.12)',
  track: 'rgba(90, 50, 28, 0.28)',
  revealedWash: 'rgba(255, 186, 110, 0.14)',
  minimapCloud: '#8b939c'
};

export const CLOUD_HIDDEN = 1;
export const CLOUD_CAMERA = 0.48;
export const CLOUD_CLEAR = 0;
const CLOUD_TEX_SIZE = 256;

function fract(n) {
  return n - Math.floor(n);
}

function hash2(ix, iy, seed) {
  const n = Math.sin(ix * 127.1 + iy * 311.7 + seed * 19.19) * 43758.5453;
  return fract(n);
}

function fade(t) {
  return t * t * (3 - 2 * t);
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function tileableValueNoise(x, y, cells, seed) {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = fade(x - x0);
  const fy = fade(y - y0);
  const wrap = (n) => ((n % cells) + cells) % cells;
  const v00 = hash2(wrap(x0), wrap(y0), seed);
  const v10 = hash2(wrap(x0 + 1), wrap(y0), seed);
  const v01 = hash2(wrap(x0), wrap(y0 + 1), seed);
  const v11 = hash2(wrap(x0 + 1), wrap(y0 + 1), seed);
  return lerp(lerp(v00, v10, fx), lerp(v01, v11, fx), fy);
}

function createCloudTexture(seed) {
  const size = CLOUD_TEX_SIZE;
  const src = document.createElement('canvas');
  src.width = size;
  src.height = size;
  const sctx = src.getContext('2d');
  const img = sctx.createImageData(size, size);
  const data = img.data;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const n1 = tileableValueNoise((x / size) * 4, (y / size) * 4, 4, seed);
      const n2 = tileableValueNoise((x / size) * 8, (y / size) * 8, 8, seed + 1);
      const n3 = tileableValueNoise((x / size) * 16, (y / size) * 16, 16, seed + 2);
      let n = n1 * 0.5 + n2 * 0.32 + n3 * 0.18;
      n = Math.pow(Math.max(0, n), 1.65);
      const i = (y * size + x) * 4;
      const shade = 168 + n * 72;
      data[i] = shade;
      data[i + 1] = shade + 3;
      data[i + 2] = Math.min(255, shade + 12);
      data[i + 3] = Math.min(255, 70 + n * 185);
    }
  }
  sctx.putImageData(img, 0, 0);
  const out = document.createElement('canvas');
  out.width = size;
  out.height = size;
  const octx = out.getContext('2d');
  octx.filter = 'blur(6px)';
  octx.drawImage(src, 0, 0);
  octx.filter = 'none';
  return out;
}

let cloudTexA = null;
let cloudTexB = null;

function getCloudTextures() {
  if (!cloudTexA) {
    cloudTexA = createCloudTexture(7.3);
    cloudTexB = createCloudTexture(21.9);
  }
  return [cloudTexA, cloudTexB];
}

export function prefersReducedMotion() {
  return typeof window !== 'undefined' &&
    !!window.matchMedia &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function tileCloudTarget(state, col, row) {
  if (state.cameraSeen?.[row]?.[col]) return CLOUD_CAMERA;
  if (!state.revealed?.[row]?.[col]) return CLOUD_HIDDEN;
  if (state.terrain[row][col] === 'crater' &&
      !(state.col === col && state.row === row)) {
    return CLOUD_CAMERA;
  }
  return CLOUD_CLEAR;
}

export function cloudFadeDuration(speed) {
  const s = speed || 1;
  if (s >= 16) return 70;
  if (s >= 4) return 160;
  return 420;
}

// Pre-rendered tile cache
const tileCache = new Map();

function createProceduralTile(type, variant = 1) {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  
  // Base mars texture
  ctx.fillStyle = COLORS.marsSurface;
  ctx.fillRect(0, 0, size, size);
  
  // Add noise
  const imageData = ctx.getImageData(0, 0, size, size);
  const data = imageData.data;
  for (let i = 0; i < data.length; i += 4) {
    const noise = (Math.random() - 0.5) * 30;
    data[i] = Math.max(0, Math.min(255, data[i] + noise));
    data[i + 1] = Math.max(0, Math.min(255, data[i + 1] + noise * 0.8));
    data[i + 2] = Math.max(0, Math.min(255, data[i + 2] + noise * 0.6));
  }
  ctx.putImageData(imageData, 0, 0);
  
  // Type-specific rendering
  if (type === 'crater') {
    const gradient = ctx.createRadialGradient(size/2, size/2, 0, size/2, size/2, size * 0.4);
    gradient.addColorStop(0, COLORS.crater);
    gradient.addColorStop(0.7, COLORS.marsDark);
    gradient.addColorStop(1, COLORS.marsSurface);
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(size/2, size/2, size * 0.4, 0, Math.PI * 2);
    ctx.fill();
  } else if (type === 'ore' || type === 'ore-drilled') {
    ctx.fillStyle = type === 'ore-drilled' ? '#5a4030' : COLORS.ore;
    for (let i = 0; i < 8; i++) {
      const x = 40 + Math.random() * (size - 80);
      const y = 40 + Math.random() * (size - 80);
      const r = 10 + Math.random() * 20;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    }
    if (type === 'ore-drilled') {
      ctx.fillStyle = '#2a1a0f';
      ctx.beginPath();
      ctx.arc(size/2, size/2, 30, 0, Math.PI * 2);
      ctx.fill();
    }
  } else if (type === 'dust') {
    ctx.fillStyle = COLORS.dust;
    ctx.globalAlpha = 0.5;
    ctx.fillRect(0, 0, size, size);
    ctx.globalAlpha = 1;
  }
  
  return canvas;
}

function createProceduralRover(direction) {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  
  ctx.save();
  ctx.translate(size/2, size/2);
  
  const rotations = { north: 0, east: Math.PI/2, south: Math.PI, west: -Math.PI/2 };
  ctx.rotate(rotations[direction] || 0);
  
  // Body
  ctx.fillStyle = '#6b7280';
  ctx.fillRect(-30, -20, 60, 40);
  
  // Solar panel
  ctx.fillStyle = '#1e3a5f';
  ctx.fillRect(-25, -15, 50, 30);
  
  // Wheels
  ctx.fillStyle = '#1f2937';
  [[-35, -25], [-35, 25], [35, -25], [35, 25], [-35, 0], [35, 0]].forEach(([wx, wy]) => {
    ctx.beginPath();
    ctx.ellipse(wx, wy, 10, 6, 0, 0, Math.PI * 2);
    ctx.fill();
  });
  
  // Mast
  ctx.fillStyle = '#9ca3af';
  ctx.fillRect(-3, -40, 6, 20);
  ctx.fillStyle = '#60a5fa';
  ctx.beginPath();
  ctx.arc(0, -45, 6, 0, Math.PI * 2);
  ctx.fill();
  
  // Direction indicator
  ctx.fillStyle = '#22c55e';
  ctx.beginPath();
  ctx.arc(0, -32, 4, 0, Math.PI * 2);
  ctx.fill();
  
  ctx.restore();
  return canvas;
}

function createProceduralLander() {
  const size = 384;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  
  const cx = size / 2;
  const cy = size / 2 + 20;
  
  // Legs
  ctx.strokeStyle = '#6b7280';
  ctx.lineWidth = 6;
  [[0.3], [Math.PI - 0.3], [Math.PI + 0.3], [-0.3]].forEach(([angle]) => {
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(angle) * 35, cy + Math.sin(angle) * 25);
    ctx.lineTo(cx + Math.cos(angle) * 70, cy + Math.sin(angle) * 50 + 25);
    ctx.stroke();
  });
  
  // Body
  ctx.fillStyle = '#9ca3af';
  ctx.beginPath();
  ctx.moveTo(cx - 45, cy);
  ctx.lineTo(cx - 35, cy - 50);
  ctx.lineTo(cx + 35, cy - 50);
  ctx.lineTo(cx + 45, cy);
  ctx.closePath();
  ctx.fill();
  
  // Gold foil
  ctx.fillStyle = '#d4a017';
  ctx.fillRect(cx - 30, cy - 40, 60, 20);
  
  // Dish
  ctx.fillStyle = '#d1d5db';
  ctx.beginPath();
  ctx.ellipse(cx, cy - 70, 30, 10, 0, 0, Math.PI * 2);
  ctx.fill();
  
  return canvas;
}

function getTile(type, variant = 1) {
  const key = `${type}-${variant}`;
  if (tileCache.has(key)) return tileCache.get(key);
  
  let tile = null;
  if (type.startsWith('ground')) {
    tile = getAsset('tiles', `ground-${variant}`);
  } else if (type === 'crater') {
    tile = getAsset('tiles', 'crater');
  } else if (type === 'ore') {
    tile = getAsset('tiles', 'ore');
  } else if (type === 'ore-drilled') {
    tile = getAsset('tiles', 'ore-drilled');
  } else if (type === 'dust') {
    tile = getAsset('tiles', 'dust');
  }
  
  if (!tile) {
    tile = createProceduralTile(type, variant);
  }
  
  tileCache.set(key, tile);
  return tile;
}

function getRoverSprite(direction) {
  const dirMap = { north: 'n', east: 'e', south: 's', west: 'w' };
  const key = `rover-${dirMap[direction] || 'n'}`;
  const sprite = getAsset('sprites', key);
  if (sprite) return sprite;
  
  const cacheKey = `rover-${direction}`;
  if (tileCache.has(cacheKey)) return tileCache.get(cacheKey);
  
  const fallback = createProceduralRover(direction);
  tileCache.set(cacheKey, fallback);
  return fallback;
}

function getLanderSprite() {
  const sprite = getAsset('sprites', 'lander');
  if (sprite) return sprite;
  
  if (tileCache.has('lander')) return tileCache.get('lander');
  const fallback = createProceduralLander();
  tileCache.set('lander', fallback);
  return fallback;
}

// Main renderer class with perspective projection
export class GameRenderer {
  constructor(container, gameState) {
    this.container = container;
    this.gameState = gameState;
    
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'game-canvas';
    
    // Animation state
    this.roverAnimX = 0;
    this.roverAnimY = 0;
    this.roverTargetX = 0;
    this.roverTargetY = 0;
    this.animationStart = 0;
    this.animationDuration = 120;
    this.isAnimating = false;
    
    // Tire tracks
    this.tireTracks = new Set();

    // Cloud fog of war (visual only)
    this.playbackSpeed = 1;
    this.reduceMotion = prefersReducedMotion();
    this.cloudDisplay = Array(GRID_ROWS).fill(null).map(() => Array(GRID_COLS).fill(CLOUD_HIDDEN));
    this.cloudTarget = Array(GRID_ROWS).fill(null).map(() => Array(GRID_COLS).fill(CLOUD_HIDDEN));
    this.cloudFadeFrom = Array(GRID_ROWS).fill(null).map(() => Array(GRID_COLS).fill(CLOUD_HIDDEN));
    this.cloudFadeStart = 0;
    this.cloudFading = false;
    this.cloudInitialized = false;
    this.cloudTime0 = 0;
    this.cloudRaf = null;
    this.sceneDirty = true;
    this.maskDirty = true;
    this.sceneCanvas = null;
    this.sceneCtx = null;
    this.maskCanvas = null;
    this.maskCtx = null;
    this.cloudScratch = null;
    this.cloudScratchCtx = null;
    this.motionQuery = null;
    
    // Near-nadir orbital framing for the 2D fallback (mild perspective only)
    this.vanishY = 0.03;
    this.horizonY = 0.02;
    this.boardTop = 0.02;
    this.boardBottom = 0.98;
    this.boardShrink = 0.94;
    this.boardFill = 1.0;
    this.sensorLayers = { camera: true, lidar: false, thermal: false, spectral: false };
  }
  
  mount() {
    this.container.appendChild(this.canvas);
    this.resize();
    window.addEventListener('resize', () => this.resize());
    if (typeof window !== 'undefined' && window.matchMedia) {
      this.motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
      this.onMotionChange = () => {
        this.reduceMotion = this.motionQuery.matches;
        this.render();
      };
      this.motionQuery.addEventListener?.('change', this.onMotionChange);
    }
    this.startCloudLoop();
  }
  
  resize() {
    const rect = this.container.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    
    this.width = rect.width;
    this.height = rect.height;
    
    this.canvas.width = this.width * dpr;
    this.canvas.height = this.height * dpr;
    this.canvas.style.width = this.width + 'px';
    this.canvas.style.height = this.height + 'px';
    
    this.ctx = this.canvas.getContext('2d');
    this.ctx.scale(dpr, dpr);

    this.sceneCanvas = document.createElement('canvas');
    this.sceneCanvas.width = this.width;
    this.sceneCanvas.height = this.height;
    this.sceneCtx = this.sceneCanvas.getContext('2d');

    this.maskCanvas = document.createElement('canvas');
    this.maskCanvas.width = this.width;
    this.maskCanvas.height = this.height;
    this.maskCtx = this.maskCanvas.getContext('2d');

    this.cloudLayer = document.createElement('canvas');
    this.cloudLayer.width = this.width;
    this.cloudLayer.height = this.height;
    this.cloudLayerCtx = this.cloudLayer.getContext('2d');

    this.sceneDirty = true;
    this.maskDirty = true;
    
    this.render();
  }

  setPlaybackSpeed(speed) {
    this.playbackSpeed = speed || 1;
  }

  resetView() {}
  setGridForced() {}
  setPausedHint() {}
  dispose() {}
  setSensorLayer(name, on) {
    if (!(name in this.sensorLayers)) return;
    this.sensorLayers[name] = !!on;
    this.sceneDirty = true;
    this.render();
  }
  
  updateState(gameState) {
    this.gameState = gameState;
    this.syncCloudTargets();
    this.sceneDirty = true;
  }
  
  addTireTrack(col, row) {
    this.tireTracks.add(`${col},${row}`);
    this.sceneDirty = true;
  }
  
  startAnimation(fromCol, fromRow, toCol, toRow, duration = 120) {
    this.roverAnimX = fromCol;
    this.roverAnimY = fromRow;
    this.roverTargetX = toCol;
    this.roverTargetY = toRow;
    this.animationStart = performance.now();
    this.animationDuration = duration;
    this.isAnimating = true;
    this.addTireTrack(fromCol, fromRow);
    this.startCloudLoop();
    this.animateFrame();
  }
  
  animateFrame() {
    if (!this.isAnimating) return;
    
    const now = performance.now();
    const elapsed = now - this.animationStart;
    const progress = Math.min(1, elapsed / this.animationDuration);
    const eased = 1 - Math.pow(1 - progress, 2);
    
    this.roverAnimX = this.roverAnimX + (this.roverTargetX - this.roverAnimX) * eased;
    this.roverAnimY = this.roverAnimY + (this.roverTargetY - this.roverAnimY) * eased;
    
    this.render();
    
    if (progress < 1) {
      requestAnimationFrame(() => this.animateFrame());
    } else {
      this.isAnimating = false;
      this.addTireTrack(this.roverTargetX, this.roverTargetY);
    }
  }
  
  // Convert grid position to screen position with perspective
  gridToScreen(col, row) {
    const w = this.width;
    const h = this.height;
    
    // Normalize row (0-12 for tiles, 12 for lander row)
    const rowNorm = row / 13;
    
    // Y position with perspective (rows closer = lower on screen)
    const topY = h * this.boardTop;
    const bottomY = h * this.boardBottom;
    const y = topY + rowNorm * (bottomY - topY);
    
    // X position with perspective (shrinks toward top)
    const perspectiveFactor = 1 - (1 - rowNorm) * (1 - this.boardShrink);
    const centerX = w / 2;
    const rowWidth = w * this.boardFill * perspectiveFactor;
    const leftX = centerX - rowWidth / 2;
    const tileWidth = rowWidth / GRID_COLS;
    const x = leftX + col * tileWidth;
    
    return { x, y, tileWidth, tileHeight: (bottomY - topY) / 13 * perspectiveFactor };
  }
  
  // Get quad corners for a tile
  getTileQuad(col, row) {
    const p1 = this.gridToScreen(col, row);
    const p2 = this.gridToScreen(col + 1, row);
    const p3 = this.gridToScreen(col + 1, row + 1);
    const p4 = this.gridToScreen(col, row + 1);
    
    return [
      { x: p1.x, y: p1.y },
      { x: p2.x, y: p2.y },
      { x: p3.x, y: p3.y },
      { x: p4.x, y: p4.y }
    ];
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
      this.startCloudLoop();
    }
  }

  stepCloudFade(now) {
    if (!this.cloudFading) return false;
    const dur = cloudFadeDuration(this.playbackSpeed);
    const t = Math.min(1, (now - this.cloudFadeStart) / dur);
    const eased = t * t * (3 - 2 * t);
    for (let row = 0; row < GRID_ROWS; row++) {
      for (let col = 0; col < GRID_COLS; col++) {
        this.cloudDisplay[row][col] = lerp(
          this.cloudFadeFrom[row][col],
          this.cloudTarget[row][col],
          eased
        );
      }
    }
    this.maskDirty = true;
    if (t >= 1) this.cloudFading = false;
    return true;
  }

  startCloudLoop() {
    if (this.cloudRaf) return;
    if (!this.cloudTime0) this.cloudTime0 = performance.now();
    let lastPaint = 0;
    const tick = (now) => {
      if (!this.canvas.isConnected) {
        this.cloudRaf = null;
        return;
      }
      this.cloudRaf = requestAnimationFrame(tick);
      const fading = this.stepCloudFade(now);
      const drifting = !this.reduceMotion;
      if (!fading && !drifting && !this.isAnimating) return;
      if (!fading && !this.isAnimating && now - lastPaint < 50) return;
      lastPaint = now;
      if (!this.isAnimating) this.render();
    };
    this.cloudRaf = requestAnimationFrame(tick);
  }

  render() {
    if (!this.gameState || !this.ctx) return;
    this.syncCloudTargets();
    
    const ctx = this.ctx;
    const w = this.width;
    const h = this.height;
    
    ctx.clearRect(0, 0, w, h);

    if (this.sceneDirty || !this.sceneCanvas) {
      this.rebuildScene();
      this.sceneDirty = false;
    }
    ctx.drawImage(this.sceneCanvas, 0, 0, w, h);

    this.renderCloudOverlay(ctx);

    this.renderLanderSprite(ctx);
    this.renderRover(ctx);
    this.renderReticle(ctx);
    this.renderSensorOverlays(ctx);
    this.renderVignette(ctx);
    this.renderRoverCam2D();
  }

  rebuildScene() {
    const ctx = this.sceneCtx;
    const w = this.width;
    const h = this.height;
    ctx.clearRect(0, 0, w, h);
    for (let row = 0; row < GRID_ROWS; row++) {
      for (let col = 0; col < GRID_COLS; col++) {
        this.renderTile(ctx, col, row);
      }
    }
    this.renderLanderGround(ctx);
    this.renderGridLines(ctx);
  }
  
  renderTile(ctx, col, row) {
    const state = this.gameState;
    const isRevealed = state.revealed[row]?.[col];
    const terrain = state.terrain[row]?.[col];
    const isDrilled = state.drilled[row]?.[col];
    const isCameraSeen = state.cameraSeen?.[row]?.[col];
    
    const quad = this.getTileQuad(col, row);
    let variant = getGroundVariant(col, row);
    
    // Always draw base terrain texture (ground) first - even for hidden tiles
    const baseTile = getTile('ground', variant);
    this.drawTexturedQuad(ctx, baseTile, quad);

    if (!isRevealed && !isCameraSeen) {
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(quad[0].x, quad[0].y);
      ctx.lineTo(quad[1].x, quad[1].y);
      ctx.lineTo(quad[2].x, quad[2].y);
      ctx.lineTo(quad[3].x, quad[3].y);
      ctx.closePath();
      ctx.fillStyle = 'rgba(10, 6, 4, 0.78)';
      ctx.fill();
      ctx.restore();
    } else if (isCameraSeen) {
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(quad[0].x, quad[0].y);
      ctx.lineTo(quad[1].x, quad[1].y);
      ctx.lineTo(quad[2].x, quad[2].y);
      ctx.lineTo(quad[3].x, quad[3].y);
      ctx.closePath();
      ctx.fillStyle = 'rgba(28, 16, 10, 0.38)';
      ctx.fill();
      ctx.restore();
    }
    
    // Draw special terrain on top if revealed OR camera-seen (seen but unscanned)
    if (isRevealed || isCameraSeen) {
      let tileType = null;
      switch (terrain) {
        case 'crater': tileType = 'crater'; break;
        case 'ore': tileType = isDrilled ? 'ore-drilled' : 'ore'; break;
        case 'dust': tileType = 'dust'; break;
      }
      if (tileType) {
        const specialTile = getTile(tileType, variant);
        this.drawTexturedQuad(ctx, specialTile, quad);
      }
    }
    
    if (isRevealed && !isCameraSeen) {
      // Warm dusty lift so driven-onto tiles read bright, not muddy
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(quad[0].x, quad[0].y);
      ctx.lineTo(quad[1].x, quad[1].y);
      ctx.lineTo(quad[2].x, quad[2].y);
      ctx.lineTo(quad[3].x, quad[3].y);
      ctx.closePath();
      ctx.fillStyle = COLORS.revealedWash;
      ctx.fill();
      ctx.restore();
    }
    
    // Tire tracks
    if (this.tireTracks.has(`${col},${row}`) && isRevealed) {
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(quad[0].x, quad[0].y);
      ctx.lineTo(quad[1].x, quad[1].y);
      ctx.lineTo(quad[2].x, quad[2].y);
      ctx.lineTo(quad[3].x, quad[3].y);
      ctx.closePath();
      ctx.clip();
      
      const cx = (quad[0].x + quad[2].x) / 2;
      const cy = (quad[0].y + quad[2].y) / 2;
      const tw = (quad[1].x - quad[0].x) * 0.15;
      const th = (quad[3].y - quad[0].y) * 0.8;
      
      ctx.fillStyle = COLORS.track;
      ctx.fillRect(cx - tw * 2, cy - th / 2, tw, th);
      ctx.fillRect(cx + tw, cy - th / 2, tw, th);
      ctx.restore();
    }
    
    // Crater warning ring (dashed red-orange), lidar replaces this when on
    if (isRevealed && terrain === 'crater' && !this.sensorLayers.lidar) {
      ctx.save();
      const cx = (quad[0].x + quad[2].x) / 2;
      const cy = (quad[0].y + quad[2].y) / 2;
      const rx = (quad[1].x - quad[0].x) * 0.4;
      const ry = (quad[3].y - quad[0].y) * 0.35;
      
      ctx.strokeStyle = '#e55a30';
      ctx.lineWidth = 2;
      ctx.setLineDash([6, 4]);
      ctx.beginPath();
      ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.restore();
    }
  }
  
  drawTexturedQuad(ctx, texture, quad) {
    if (!texture) return;
    
    ctx.save();
    
    // Create clipping path for the quad
    ctx.beginPath();
    ctx.moveTo(quad[0].x, quad[0].y);
    ctx.lineTo(quad[1].x, quad[1].y);
    ctx.lineTo(quad[2].x, quad[2].y);
    ctx.lineTo(quad[3].x, quad[3].y);
    ctx.closePath();
    ctx.clip();
    
    // Calculate bounding box
    const minX = Math.min(quad[0].x, quad[1].x, quad[2].x, quad[3].x);
    const maxX = Math.max(quad[0].x, quad[1].x, quad[2].x, quad[3].x);
    const minY = Math.min(quad[0].y, quad[1].y, quad[2].y, quad[3].y);
    const maxY = Math.max(quad[0].y, quad[1].y, quad[2].y, quad[3].y);
    
    // Draw texture stretched to bounding box (approximation for perspective)
    ctx.filter = 'brightness(1.16) saturate(1.12) contrast(1.04)';
    ctx.drawImage(texture, minX, minY, maxX - minX, maxY - minY);
    ctx.filter = 'none';
    
    ctx.restore();
  }
  
  renderLanderGround(ctx) {
    const row = GRID_ROWS;
    for (let col = 0; col < GRID_COLS; col++) {
      const quad = this.getTileQuad(col, row);
      const variant = getGroundVariant(col, row);
      const tile = getTile('ground', variant);
      this.drawTexturedQuad(ctx, tile, quad);
      if (col !== LANDER_COL) {
        ctx.save();
        ctx.beginPath();
        ctx.moveTo(quad[0].x, quad[0].y);
        ctx.lineTo(quad[1].x, quad[1].y);
        ctx.lineTo(quad[2].x, quad[2].y);
        ctx.lineTo(quad[3].x, quad[3].y);
        ctx.closePath();
        ctx.fillStyle = 'rgba(28, 14, 8, 0.22)';
        ctx.fill();
        ctx.restore();
      }
    }
  }

  renderLanderSprite(ctx) {
    const state = this.gameState;
    if (state.col === LANDER_COL && state.row === LANDER_ROW) return;
    const lander = getLanderSprite();
    if (!lander) return;
    const pos = this.gridToScreen(LANDER_COL + 0.5, LANDER_ROW + 0.5);
    const landerSize = pos.tileWidth * 1.4;
    ctx.drawImage(
      lander,
      pos.x - landerSize / 2,
      pos.y - landerSize * 0.7,
      landerSize,
      landerSize
    );
  }

  screenToGrid(x, y) {
    const w = this.width;
    const h = this.height;
    const topY = h * this.boardTop;
    const bottomY = h * this.boardBottom;
    const rowNorm = (y - topY) / (bottomY - topY);
    const perspectiveFactor = 1 - (1 - rowNorm) * (1 - this.boardShrink);
    const rowWidth = w * this.boardFill * perspectiveFactor;
    const leftX = w / 2 - rowWidth / 2;
    const col = rowWidth > 1 ? (x - leftX) / (rowWidth / GRID_COLS) : -1;
    const row = rowNorm * 13;
    const inside = rowNorm >= -0.02 && rowNorm <= 1.02 && col >= -0.08 && col <= GRID_COLS + 0.08;
    return { col, row, inside };
  }

  sampleCloudCoverage(col, row) {
    if (row >= GRID_ROWS || row < 0 || col < 0 || col >= GRID_COLS) return CLOUD_HIDDEN;
    return this.cloudDisplay[Math.min(GRID_ROWS - 1, Math.floor(row))][Math.min(GRID_COLS - 1, Math.floor(col))];
  }

  rebuildCloudMask() {
    const w = this.width;
    const h = this.height;
    const step = 3;
    const mw = Math.max(1, Math.ceil(w / step));
    const mh = Math.max(1, Math.ceil(h / step));
    if (!this.cloudScratch || this.cloudScratch.width !== mw || this.cloudScratch.height !== mh) {
      this.cloudScratch = document.createElement('canvas');
      this.cloudScratch.width = mw;
      this.cloudScratch.height = mh;
      this.cloudScratchCtx = this.cloudScratch.getContext('2d');
    }
    const img = this.cloudScratchCtx.createImageData(mw, mh);
    const data = img.data;
    for (let y = 0; y < mh; y++) {
      for (let x = 0; x < mw; x++) {
        const { col, row, inside } = this.screenToGrid((x + 0.5) * step, (y + 0.5) * step);
        let a = 1;
        if (inside) {
          const c0 = Math.floor(col);
          const r0 = Math.floor(row);
          const fx = col - c0;
          const fy = row - r0;
          const v00 = this.sampleCloudCoverage(c0, r0);
          const v10 = this.sampleCloudCoverage(c0 + 1, r0);
          const v01 = this.sampleCloudCoverage(c0, r0 + 1);
          const v11 = this.sampleCloudCoverage(c0 + 1, r0 + 1);
          let base = lerp(lerp(v00, v10, fx), lerp(v01, v11, fy), fy);
          const edge = Math.max(v00, v10, v01, v11) - Math.min(v00, v10, v01, v11);
          const n = tileableValueNoise(col * 1.4, row * 1.4, 24, 9.4);
          const n2 = tileableValueNoise(col * 3.1, row * 3.1, 48, 2.2);
          base += (n - 0.5) * edge * 1.15 + (n2 - 0.5) * edge * 0.5;
          a = Math.max(0, Math.min(1, base));
        }
        const i = (y * mw + x) * 4;
        data[i] = 255;
        data[i + 1] = 255;
        data[i + 2] = 255;
        data[i + 3] = Math.round(a * 255);
      }
    }
    this.cloudScratchCtx.putImageData(img, 0, 0);
    const ctx = this.maskCtx;
    ctx.clearRect(0, 0, w, h);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(this.cloudScratch, 0, 0, w, h);
    ctx.globalCompositeOperation = 'destination-out';
    const lander = this.gridToScreen(LANDER_COL + 0.5, LANDER_ROW + 0.55);
    const lr = Math.max(lander.tileWidth * 1.05, 18);
    const n1 = hash2(LANDER_COL, LANDER_ROW, 4.2);
    const lg = ctx.createRadialGradient(lander.x, lander.y, lr * 0.15, lander.x, lander.y, lr * (1.15 + n1 * 0.2));
    lg.addColorStop(0, 'rgba(255,255,255,1)');
    lg.addColorStop(0.55, 'rgba(255,255,255,0.75)');
    lg.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = lg;
    ctx.beginPath();
    ctx.ellipse(lander.x, lander.y, lr * 1.15, lr * 0.85, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalCompositeOperation = 'source-over';
    this.maskDirty = false;
  }

  renderCloudOverlay(ctx) {
    if (this.maskDirty) this.rebuildCloudMask();
    const w = this.width;
    const h = this.height;
    const [texA, texB] = getCloudTextures();
    const layer = this.cloudLayerCtx;
    layer.clearRect(0, 0, w, h);
    layer.globalCompositeOperation = 'source-over';
    layer.fillStyle = 'rgb(22, 12, 8)';
    layer.fillRect(0, 0, w, h);

    const now = performance.now();
    const t = this.reduceMotion ? 0 : (now - (this.cloudTime0 || now)) / 1000;
    const scale = Math.max(w, h) / CLOUD_TEX_SIZE * 1.45;

    layer.globalCompositeOperation = 'source-over';
    layer.globalAlpha = 0.28;
    this.tileCloud(layer, texA, t * 16, t * 7, w, h, scale);
    layer.globalAlpha = 0.16;
    this.tileCloud(layer, texB, -t * 10, t * 13, w, h, scale * 0.78);
    layer.globalAlpha = 1;
    layer.globalCompositeOperation = 'destination-in';
    layer.drawImage(this.maskCanvas, 0, 0, w, h);
    layer.globalCompositeOperation = 'source-over';

    ctx.drawImage(this.cloudLayer, 0, 0, w, h);
  }

  tileCloud(ctx, tex, ox, oy, w, h, scale) {
    const tw = CLOUD_TEX_SIZE * scale;
    const th = CLOUD_TEX_SIZE * scale;
    const startX = ((ox % tw) + tw) % tw - tw;
    const startY = ((oy % th) + th) % th - th;
    for (let y = startY; y < h + th; y += th) {
      for (let x = startX; x < w + tw; x += tw) {
        ctx.drawImage(tex, x, y, tw, th);
      }
    }
  }
  
  renderRover(ctx) {
    const state = this.gameState;
    
    let roverCol, roverRow;
    if (this.isAnimating) {
      roverCol = this.roverAnimX;
      roverRow = this.roverAnimY;
    } else {
      roverCol = state.col;
      roverRow = state.row;
    }
    
    const rover = getRoverSprite(state.facing);
    if (!rover) return;
    
    const pos = this.gridToScreen(roverCol + 0.5, roverRow + 0.5);
    const roverSize = pos.tileWidth * 0.8;
    
    // Draw rover (upright, not tilted with perspective)
    ctx.drawImage(
      rover,
      pos.x - roverSize / 2,
      pos.y - roverSize * 0.6,
      roverSize,
      roverSize
    );
    
    // Charging glow
    if (state.charging) {
      ctx.save();
      ctx.fillStyle = 'rgba(100, 200, 255, 0.3)';
      ctx.beginPath();
      ctx.arc(pos.x, pos.y - roverSize * 0.1, roverSize * 0.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }
  
  renderGridLines(ctx) {
    ctx.save();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.04)';
    ctx.lineWidth = 1;
    
    // Horizontal lines
    for (let row = 0; row <= GRID_ROWS + 1; row++) {
      const left = this.gridToScreen(0, row);
      const right = this.gridToScreen(GRID_COLS, row);
      ctx.beginPath();
      ctx.moveTo(left.x, left.y);
      ctx.lineTo(right.x, right.y);
      ctx.stroke();
    }
    
    // Vertical lines
    for (let col = 0; col <= GRID_COLS; col++) {
      const top = this.gridToScreen(col, 0);
      const bottom = this.gridToScreen(col, GRID_ROWS + 1);
      ctx.beginPath();
      ctx.moveTo(top.x, top.y);
      ctx.lineTo(bottom.x, bottom.y);
      ctx.stroke();
    }
    
    ctx.restore();
  }
  
  renderVignette(ctx) {
    const w = this.width;
    const h = this.height;
    
    // Soft horizon blend only — keep the board bright
    const topGrad = ctx.createLinearGradient(0, 0, 0, h * 0.08);
    topGrad.addColorStop(0, 'rgba(0, 0, 0, 0.12)');
    topGrad.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = topGrad;
    ctx.fillRect(0, 0, w, h * 0.08);
    
    const leftGrad = ctx.createLinearGradient(0, 0, w * 0.06, 0);
    leftGrad.addColorStop(0, 'rgba(0, 0, 0, 0.08)');
    leftGrad.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = leftGrad;
    ctx.fillRect(0, 0, w * 0.06, h);
    
    const rightGrad = ctx.createLinearGradient(w, 0, w * 0.94, 0);
    rightGrad.addColorStop(0, 'rgba(0, 0, 0, 0.08)');
    rightGrad.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = rightGrad;
    ctx.fillRect(w * 0.94, 0, w * 0.06, h);
  }

  _aheadCell() {
    const cell = this.gameState?.readings?.craterInFront;
    if (!cell?.detected || !cell.cell || cell.cell === 'Lander') return null;
    const col = cell.cell.charCodeAt(0) - 65;
    const row = parseInt(cell.cell.slice(1), 10) - 1;
    if (col < 0 || col > 11 || row < 0 || row > 11 || Number.isNaN(row)) return null;
    return { col, row };
  }

  renderReticle(ctx) {
    const state = this.gameState;
    if (!state || state.row < 0 || state.row > 11) return;
    const col = this.isAnimating ? this.roverAnimX : state.col;
    const row = this.isAnimating ? this.roverAnimY : state.row;
    if (row > 11) return;
    const quad = this.getTileQuad(col, row);
    const inset = 6;
    const len = 12;
    ctx.save();
    ctx.strokeStyle = 'rgba(232, 228, 220, 0.85)';
    ctx.lineWidth = 1.4;
    const corners = [
      [quad[0].x + inset, quad[0].y + inset, 1, 1],
      [quad[1].x - inset, quad[1].y + inset, -1, 1],
      [quad[3].x + inset, quad[3].y - inset, 1, -1],
      [quad[2].x - inset, quad[2].y - inset, -1, -1]
    ];
    corners.forEach(([x, y, sx, sy]) => {
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + len * sx, y);
      ctx.moveTo(x, y);
      ctx.lineTo(x, y + len * sy);
      ctx.stroke();
    });
    ctx.restore();
  }

  renderSensorOverlays(ctx) {
    const state = this.gameState;
    if (!state) return;
    const ahead = this._aheadCell();
    for (let row = 0; row < GRID_ROWS; row++) {
      for (let col = 0; col < GRID_COLS; col++) {
        const known = !!(state.revealed?.[row]?.[col] || state.cameraSeen?.[row]?.[col]);
        const terrain = state.terrain[row][col];
        const quad = this.getTileQuad(col, row);
        const cx = (quad[0].x + quad[2].x) / 2;
        const cy = (quad[0].y + quad[2].y) / 2;
        const rx = (quad[1].x - quad[0].x) * 0.4;
        const ry = (quad[3].y - quad[0].y) * 0.35;

        if (this.sensorLayers.thermal && state.sensors?.includes('dust') && known && terrain === 'dust') {
          ctx.save();
          ctx.beginPath();
          ctx.moveTo(quad[0].x, quad[0].y);
          ctx.lineTo(quad[1].x, quad[1].y);
          ctx.lineTo(quad[2].x, quad[2].y);
          ctx.lineTo(quad[3].x, quad[3].y);
          ctx.closePath();
          ctx.fillStyle = 'rgba(255, 96, 36, 0.28)';
          ctx.fill();
          ctx.restore();
        }

        if (this.sensorLayers.spectral && state.sensors?.includes('spectral') && known && terrain === 'ore' && !state.drilled?.[row]?.[col]) {
          ctx.save();
          ctx.beginPath();
          ctx.moveTo(quad[0].x, quad[0].y);
          ctx.lineTo(quad[1].x, quad[1].y);
          ctx.lineTo(quad[2].x, quad[2].y);
          ctx.lineTo(quad[3].x, quad[3].y);
          ctx.closePath();
          ctx.fillStyle = 'rgba(30, 230, 196, 0.26)';
          ctx.fill();
          ctx.restore();
        }

        const craterKnown = terrain === 'crater' && (known || (ahead && ahead.col === col && ahead.row === row));
        if (this.sensorLayers.lidar && state.sensors?.includes('distance') && craterKnown) {
          ctx.save();
          ctx.strokeStyle = ahead && ahead.col === col && ahead.row === row ? '#9ff6ff' : '#4be4ff';
          ctx.lineWidth = 1.6;
          ctx.beginPath();
          ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
          ctx.stroke();
          ctx.globalAlpha = 0.55;
          ctx.beginPath();
          ctx.ellipse(cx, cy, rx * 0.7, ry * 0.7, 0, 0, Math.PI * 2);
          ctx.stroke();
          ctx.restore();
        }
      }
    }
  }

  renderRoverCam2D() {
    const canvas = document.getElementById('rover-cam-canvas');
    if (!canvas || !this.gameState) return;
    const ctx = canvas.getContext('2d');
    const w = canvas.width;
    const h = canvas.height;
    const state = this.gameState;
    const facing = state.facing || 'north';
    const vec = { north: [0, -1], east: [1, 0], south: [0, 1], west: [-1, 0] };
    const [dx, dy] = vec[facing] || [0, -1];
    const fc = state.col + dx;
    const fr = state.row + dy;
    const onGrid = fc >= 0 && fc < 12 && fr >= 0 && fr < 12;
    const known = onGrid && !!(state.revealed?.[fr]?.[fc] || state.cameraSeen?.[fr]?.[fc]);
    const terrain = onGrid ? state.terrain[fr][fc] : null;
    const ahead = this._aheadCell();
    const craterAhead = !!(ahead && ahead.col === fc && ahead.row === fr);

    ctx.fillStyle = '#d08958';
    ctx.fillRect(0, 0, w, h);
    const sky = ctx.createLinearGradient(0, 0, 0, h * 0.42);
    sky.addColorStop(0, '#e8c4a0');
    sky.addColorStop(0.55, '#d48a58');
    sky.addColorStop(1, '#c07040');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, w, h * 0.42);
    const ground = ctx.createLinearGradient(0, h * 0.42, 0, h);
    ground.addColorStop(0, '#8a4a2c');
    ground.addColorStop(1, '#c4683a');
    ctx.fillStyle = ground;
    ctx.beginPath();
    ctx.moveTo(0, h * 0.42);
    ctx.lineTo(w, h * 0.42);
    ctx.lineTo(w, h);
    ctx.lineTo(0, h);
    ctx.fill();
    const gnd = getTile('ground', 1);
    if (gnd) {
      ctx.globalAlpha = 0.85;
      ctx.drawImage(gnd, 0, h * 0.42, w, h * 0.58);
      ctx.globalAlpha = 1;
    }
    ctx.fillStyle = 'rgba(40, 18, 10, 0.22)';
    for (let i = 0; i < 8; i++) {
      const rx = (i * 47 + 13) % w;
      const ry = h * 0.52 + (i * 31) % (h * 0.4);
      const rw = 6 + (i % 4) * 3;
      ctx.beginPath();
      ctx.ellipse(rx, ry, rw, rw * 0.45, 0, 0, Math.PI * 2);
      ctx.fill();
    }

    const drawBillboard = (img, x, y, tw, th) => {
      if (!img) return;
      ctx.drawImage(img, x, y, tw, th);
    };
    if (onGrid) {
      let tile = getTile('ground', 1);
      if ((known || craterAhead) && terrain === 'crater') tile = getTile('crater', 1);
      else if (known && terrain === 'dust') tile = getTile('dust', 1);
      else if (known && terrain === 'ore') tile = getTile('ore', 1);
      drawBillboard(tile, w * 0.08, h * 0.40, w * 0.84, h * 0.52);
    }

    if (craterAhead || (known && terrain === 'crater')) {
      ctx.fillStyle = 'rgba(22, 8, 4, 0.72)';
      ctx.beginPath();
      ctx.ellipse(w * 0.5, h * 0.70, w * 0.28, h * 0.12, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = this.sensorLayers.lidar ? '#4be4ff' : 'rgba(180, 80, 40, 0.5)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.ellipse(w * 0.5, h * 0.70, w * 0.28, h * 0.12, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
    if (this.sensorLayers.thermal && known && terrain === 'dust') {
      ctx.fillStyle = 'rgba(255, 90, 30, 0.28)';
      ctx.fillRect(w * 0.12, h * 0.5, w * 0.76, h * 0.4);
    }
    if (this.sensorLayers.spectral && known && terrain === 'ore') {
      ctx.fillStyle = 'rgba(30, 230, 196, 0.28)';
      ctx.fillRect(w * 0.3, h * 0.55, w * 0.4, h * 0.2);
    }

    ctx.strokeStyle = 'rgba(232, 228, 220, 0.22)';
    ctx.beginPath();
    ctx.moveTo(w * 0.5, h * 0.22);
    ctx.lineTo(w * 0.5, h * 0.78);
    ctx.moveTo(w * 0.24, h * 0.52);
    ctx.lineTo(w * 0.76, h * 0.52);
    ctx.stroke();
  }
  
  // Get cell from click position
  getCellFromClick(clientX, clientY) {
    const rect = this.canvas.getBoundingClientRect();
    const x = clientX - rect.left;
    const y = clientY - rect.top;
    
    // Search all cells to find which contains the click
    for (let row = 0; row <= GRID_ROWS; row++) {
      for (let col = 0; col < GRID_COLS; col++) {
        const quad = this.getTileQuad(col, row);
        if (this.pointInQuad(x, y, quad)) {
          return { col, row };
        }
      }
    }
    return null;
  }
  
  pointInQuad(x, y, quad) {
    // Simple polygon containment test
    let inside = false;
    const n = quad.length;
    for (let i = 0, j = n - 1; i < n; j = i++) {
      const xi = quad[i].x, yi = quad[i].y;
      const xj = quad[j].x, yj = quad[j].y;
      if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) {
        inside = !inside;
      }
    }
    return inside;
  }
}

// Minimap renderer
export class MinimapRenderer {
  constructor(canvas, gameState) {
    this.canvas = canvas;
    this.gameState = gameState;
    this.cellSize = 9;
    this.ctx = canvas.getContext('2d');
  }
  
  updateState(gameState) {
    this.gameState = gameState;
  }
  
  render() {
    const ctx = this.ctx;
    const cs = this.cellSize;
    const state = this.gameState;
    
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    
    // Draw grid
    for (let row = 0; row < GRID_ROWS; row++) {
      for (let col = 0; col < GRID_COLS; col++) {
        const x = col * cs;
        const y = row * cs;
        
        const isRevealed = state.revealed[row]?.[col];
        const isCameraSeen = state.cameraSeen?.[row]?.[col];
        const terrain = state.terrain[row]?.[col];
        
        if (isRevealed) {
          switch (terrain) {
            case 'crater': ctx.fillStyle = '#6b2010'; break;
            case 'ore': ctx.fillStyle = state.drilled[row]?.[col] ? '#5a3810' : '#d4a020'; break;
            case 'dust': ctx.fillStyle = '#8a5530'; break;
            default: ctx.fillStyle = '#785038'; break;
          }
        } else if (isCameraSeen) {
          switch (terrain) {
            case 'ore': ctx.fillStyle = '#8a7020'; break;
            case 'dust': ctx.fillStyle = '#5a4030'; break;
            default: ctx.fillStyle = '#4a3828'; break;
          }
        } else {
          ctx.fillStyle = COLORS.minimapCloud;
        }
        ctx.fillRect(x, y, cs - 1, cs - 1);
      }
    }
    
    // Lander
    ctx.fillStyle = '#40a0c0';
    ctx.fillRect(LANDER_COL * cs, GRID_ROWS * cs, cs - 1, cs - 1);
    
    // Rover
    ctx.fillStyle = '#40e070';
    ctx.beginPath();
    ctx.arc(
      state.col * cs + cs / 2,
      state.row * cs + cs / 2,
      cs * 0.4,
      0,
      Math.PI * 2
    );
    ctx.fill();
    
    // Facing indicator
    const fc = { north: [0, -1], east: [1, 0], south: [0, 1], west: [-1, 0] };
    const [dx, dy] = fc[state.facing] || [0, -1];
    ctx.beginPath();
    ctx.moveTo(state.col * cs + cs / 2, state.row * cs + cs / 2);
    ctx.lineTo(state.col * cs + cs / 2 + dx * cs * 0.6, state.row * cs + cs / 2 + dy * cs * 0.6);
    ctx.strokeStyle = '#40e070';
    ctx.lineWidth = 2;
    ctx.stroke();
  }
}

// Initialize on module load
if (typeof window !== 'undefined') {
  loadAssets().catch(() => {});
}
