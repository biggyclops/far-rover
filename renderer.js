// Far Rover Canvas Renderer
// Handles Mars terrain, rover, lander with procedural fallbacks and PNG loading

const TILE_SIZE = 48;
const GRID_COLS = 12;
const GRID_ROWS = 13; // 12 + lander row

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

// Loaded assets cache
const loadedAssets = {};
let assetsLoaded = false;

// Pre-rendered tile cache
const tileCache = {};

// Seeded random for consistent procedural generation
class SeededRandom {
  constructor(seed) {
    this.seed = seed;
  }
  next() {
    this.seed = (this.seed * 16807) % 2147483647;
    return (this.seed - 1) / 2147483646;
  }
}

// Try to load PNG assets, silently fail to procedural fallbacks
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
  initTileCache();
}

function getAsset(category, key) {
  return loadedAssets[`${category}:${key}`] || null;
}

export function hasRealArt() {
  return Object.keys(loadedAssets).length > 0;
}

// Color palette for Mars theme
const COLORS = {
  marsSurface: '#c4663c',
  marsDark: '#8b3a1f',
  marsLight: '#d4805c',
  marsOrange: '#e67e22',
  dust: '#b87333',
  dustDark: '#8b5a2b',
  ore: '#f1c40f',
  oreDark: '#d4ac0d',
  craterShadow: '#4a2315',
  craterRim: '#a55a3c',
  hidden: '#2d2d3d',
  hiddenGrid: '#3d3d4d',
  cameraSeen: '#4a4a5a',
  roverGreen: '#4ade80',
  roverBody: '#6b7280',
  landerSilver: '#9ca3af',
  landerDish: '#d1d5db',
  trackColor: 'rgba(60, 40, 30, 0.3)'
};

// Procedural noise for terrain texture
function createNoiseTexture(width, height, seed, baseColor, variance) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  
  const rng = new SeededRandom(seed);
  const imageData = ctx.createImageData(width, height);
  const data = imageData.data;
  
  const base = hexToRgb(baseColor);
  
  for (let i = 0; i < data.length; i += 4) {
    const noise = (rng.next() - 0.5) * variance;
    data[i] = Math.max(0, Math.min(255, base.r + noise));
    data[i + 1] = Math.max(0, Math.min(255, base.g + noise * 0.8));
    data[i + 2] = Math.max(0, Math.min(255, base.b + noise * 0.6));
    data[i + 3] = 255;
  }
  
  ctx.putImageData(imageData, 0, 0);
  return canvas;
}

function hexToRgb(hex) {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result ? {
    r: parseInt(result[1], 16),
    g: parseInt(result[2], 16),
    b: parseInt(result[3], 16)
  } : { r: 0, g: 0, b: 0 };
}

// Generate procedural ground tile
function generateGroundTile(variant = 1) {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  
  // Base texture
  const noise = createNoiseTexture(size, size, 1000 + variant * 100, COLORS.marsSurface, 40);
  ctx.drawImage(noise, 0, 0);
  
  // Add some rocks/pebbles
  const rng = new SeededRandom(2000 + variant * 50);
  ctx.fillStyle = COLORS.marsDark;
  for (let i = 0; i < 8; i++) {
    const x = rng.next() * size;
    const y = rng.next() * size;
    const r = 2 + rng.next() * 6;
    ctx.beginPath();
    ctx.ellipse(x, y, r, r * 0.7, rng.next() * Math.PI, 0, Math.PI * 2);
    ctx.fill();
  }
  
  // Subtle shadow gradient for depth
  const gradient = ctx.createLinearGradient(0, 0, 0, size);
  gradient.addColorStop(0, 'rgba(0,0,0,0)');
  gradient.addColorStop(1, 'rgba(0,0,0,0.15)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);
  
  return canvas;
}

// Generate procedural dust tile
function generateDustTile() {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  
  // Dusty base
  const noise = createNoiseTexture(size, size, 3000, COLORS.dust, 30);
  ctx.drawImage(noise, 0, 0);
  
  // Swirly dust pattern
  const rng = new SeededRandom(3001);
  ctx.strokeStyle = COLORS.dustDark;
  ctx.lineWidth = 2;
  ctx.globalAlpha = 0.3;
  for (let i = 0; i < 5; i++) {
    ctx.beginPath();
    const startX = rng.next() * size;
    const startY = rng.next() * size;
    ctx.moveTo(startX, startY);
    for (let j = 0; j < 20; j++) {
      ctx.lineTo(startX + (rng.next() - 0.5) * 100, startY + j * 12);
    }
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
  
  // Dust warning indicator
  ctx.fillStyle = 'rgba(255, 180, 100, 0.2)';
  ctx.fillRect(0, 0, size, size);
  
  return canvas;
}

// Generate procedural ore tile
function generateOreTile(drilled = false) {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  
  // Base rock
  const noise = createNoiseTexture(size, size, 4000, COLORS.marsDark, 25);
  ctx.drawImage(noise, 0, 0);
  
  // Ore veins/nuggets
  const rng = new SeededRandom(4001);
  const oreColor = drilled ? '#8b7355' : COLORS.ore;
  
  if (!drilled) {
    ctx.fillStyle = oreColor;
    ctx.shadowColor = '#ffd700';
    ctx.shadowBlur = 8;
    for (let i = 0; i < 12; i++) {
      const x = 30 + rng.next() * (size - 60);
      const y = 30 + rng.next() * (size - 60);
      const r = 8 + rng.next() * 15;
      ctx.beginPath();
      ctx.ellipse(x, y, r, r * 0.8, rng.next() * Math.PI, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.shadowBlur = 0;
  } else {
    // Drilled - show hole
    ctx.fillStyle = '#3d2817';
    ctx.beginPath();
    ctx.ellipse(size/2, size/2, 40, 35, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#2a1a0f';
    ctx.lineWidth = 3;
    ctx.stroke();
  }
  
  return canvas;
}

// Generate procedural crater tile
function generateCraterTile() {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  
  // Outer rim
  const gradient = ctx.createRadialGradient(
    size/2, size/2, size * 0.15,
    size/2, size/2, size * 0.48
  );
  gradient.addColorStop(0, COLORS.craterShadow);
  gradient.addColorStop(0.5, COLORS.marsDark);
  gradient.addColorStop(0.8, COLORS.craterRim);
  gradient.addColorStop(1, COLORS.marsSurface);
  
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);
  
  // Inner shadow for depth
  const innerGradient = ctx.createRadialGradient(
    size/2 - 15, size/2 - 15, 0,
    size/2, size/2, size * 0.35
  );
  innerGradient.addColorStop(0, 'rgba(0,0,0,0.6)');
  innerGradient.addColorStop(0.7, 'rgba(0,0,0,0.3)');
  innerGradient.addColorStop(1, 'rgba(0,0,0,0)');
  
  ctx.fillStyle = innerGradient;
  ctx.beginPath();
  ctx.arc(size/2, size/2, size * 0.35, 0, Math.PI * 2);
  ctx.fill();
  
  // Rim highlight
  ctx.strokeStyle = 'rgba(255,200,150,0.3)';
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.arc(size/2, size/2, size * 0.38, -Math.PI * 0.7, -Math.PI * 0.2);
  ctx.stroke();
  
  return canvas;
}

// Generate hidden tile
function generateHiddenTile() {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  
  ctx.fillStyle = COLORS.hidden;
  ctx.fillRect(0, 0, size, size);
  
  // Subtle grid pattern
  ctx.strokeStyle = COLORS.hiddenGrid;
  ctx.lineWidth = 1;
  ctx.setLineDash([4, 4]);
  ctx.strokeRect(4, 4, size - 8, size - 8);
  ctx.setLineDash([]);
  
  // Question mark
  ctx.fillStyle = 'rgba(255,255,255,0.15)';
  ctx.font = 'bold 48px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('?', size/2, size/2);
  
  return canvas;
}

// Generate camera-seen but not scanned tile
function generateCameraSeenTile() {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  
  ctx.fillStyle = COLORS.cameraSeen;
  ctx.fillRect(0, 0, size, size);
  
  // Camera icon hint
  ctx.fillStyle = 'rgba(100,200,255,0.2)';
  ctx.beginPath();
  ctx.moveTo(size/2 - 25, size/2 - 15);
  ctx.lineTo(size/2 + 25, size/2 - 15);
  ctx.lineTo(size/2 + 25, size/2 + 15);
  ctx.lineTo(size/2 - 25, size/2 + 15);
  ctx.closePath();
  ctx.fill();
  
  // Lens
  ctx.beginPath();
  ctx.arc(size/2 + 10, size/2, 12, 0, Math.PI * 2);
  ctx.fill();
  
  return canvas;
}

// Generate procedural rover sprite
function generateRoverSprite(direction) {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  
  ctx.save();
  ctx.translate(size/2, size/2);
  
  // Rotate based on direction
  const rotations = { north: 0, east: Math.PI/2, south: Math.PI, west: -Math.PI/2 };
  ctx.rotate(rotations[direction] || 0);
  
  // Body
  ctx.fillStyle = COLORS.roverBody;
  ctx.fillRect(-35, -25, 70, 50);
  
  // Body detail
  ctx.fillStyle = '#4b5563';
  ctx.fillRect(-30, -20, 60, 40);
  
  // Solar panel
  ctx.fillStyle = '#1e3a5f';
  ctx.fillRect(-25, -15, 50, 30);
  ctx.strokeStyle = '#60a5fa';
  ctx.lineWidth = 1;
  for (let i = 0; i < 5; i++) {
    ctx.beginPath();
    ctx.moveTo(-25 + i * 12.5, -15);
    ctx.lineTo(-25 + i * 12.5, 15);
    ctx.stroke();
  }
  
  // Wheels (6 total)
  ctx.fillStyle = '#1f2937';
  const wheelPositions = [
    [-38, -28], [-38, 0], [-38, 28],
    [38, -28], [38, 0], [38, 28]
  ];
  for (const [wx, wy] of wheelPositions) {
    ctx.beginPath();
    ctx.ellipse(wx, wy, 12, 8, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#374151';
    ctx.lineWidth = 2;
    ctx.stroke();
  }
  
  // Camera mast (front)
  ctx.fillStyle = '#9ca3af';
  ctx.fillRect(-3, -45, 6, 20);
  ctx.fillStyle = '#60a5fa';
  ctx.beginPath();
  ctx.arc(0, -50, 8, 0, Math.PI * 2);
  ctx.fill();
  
  // Direction indicator (green glow at front)
  ctx.fillStyle = COLORS.roverGreen;
  ctx.shadowColor = COLORS.roverGreen;
  ctx.shadowBlur = 10;
  ctx.beginPath();
  ctx.arc(0, -35, 5, 0, Math.PI * 2);
  ctx.fill();
  ctx.shadowBlur = 0;
  
  ctx.restore();
  return canvas;
}

// Generate procedural lander sprite
function generateLanderSprite() {
  const size = 384;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  
  const cx = size / 2;
  const cy = size / 2 + 30;
  
  // Landing legs
  ctx.strokeStyle = '#6b7280';
  ctx.lineWidth = 8;
  ctx.lineCap = 'round';
  const legAngles = [0.3, Math.PI - 0.3, Math.PI + 0.3, -0.3];
  for (const angle of legAngles) {
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(angle) * 40, cy + Math.sin(angle) * 30);
    ctx.lineTo(cx + Math.cos(angle) * 80, cy + Math.sin(angle) * 60 + 30);
    ctx.stroke();
    // Foot pad
    ctx.fillStyle = '#4b5563';
    ctx.beginPath();
    ctx.ellipse(
      cx + Math.cos(angle) * 80,
      cy + Math.sin(angle) * 60 + 35,
      12, 4, 0, 0, Math.PI * 2
    );
    ctx.fill();
  }
  
  // Main body
  ctx.fillStyle = COLORS.landerSilver;
  ctx.beginPath();
  ctx.moveTo(cx - 50, cy);
  ctx.lineTo(cx - 40, cy - 60);
  ctx.lineTo(cx + 40, cy - 60);
  ctx.lineTo(cx + 50, cy);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = '#6b7280';
  ctx.lineWidth = 2;
  ctx.stroke();
  
  // Gold foil section
  ctx.fillStyle = '#d4a017';
  ctx.fillRect(cx - 35, cy - 45, 70, 25);
  
  // Dish (satellite dish on top)
  ctx.fillStyle = COLORS.landerDish;
  ctx.beginPath();
  ctx.ellipse(cx, cy - 80, 35, 12, 0, 0, Math.PI * 2);
  ctx.fill();
  
  // Dish arm
  ctx.strokeStyle = '#9ca3af';
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(cx, cy - 60);
  ctx.lineTo(cx, cy - 75);
  ctx.stroke();
  
  // Dish receiver
  ctx.fillStyle = '#1e40af';
  ctx.beginPath();
  ctx.arc(cx, cy - 85, 6, 0, Math.PI * 2);
  ctx.fill();
  
  // Status lights
  ctx.fillStyle = '#22c55e';
  ctx.shadowColor = '#22c55e';
  ctx.shadowBlur = 8;
  ctx.beginPath();
  ctx.arc(cx - 20, cy - 35, 4, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(cx + 20, cy - 35, 4, 0, Math.PI * 2);
  ctx.fill();
  ctx.shadowBlur = 0;
  
  return canvas;
}

// Initialize tile cache with pre-rendered tiles
function initTileCache() {
  // Ground variants
  for (let i = 1; i <= 3; i++) {
    const asset = getAsset('tiles', `ground-${i}`);
    tileCache[`ground-${i}`] = asset || generateGroundTile(i);
  }
  
  // Special tiles
  tileCache['dust'] = getAsset('tiles', 'dust') || generateDustTile();
  tileCache['ore'] = getAsset('tiles', 'ore') || generateOreTile(false);
  tileCache['ore-drilled'] = getAsset('tiles', 'ore-drilled') || generateOreTile(true);
  tileCache['crater'] = getAsset('tiles', 'crater') || generateCraterTile();
  tileCache['hidden'] = generateHiddenTile();
  tileCache['camera-seen'] = generateCameraSeenTile();
  
  // Rover sprites
  for (const dir of ['north', 'east', 'south', 'west']) {
    const asset = getAsset('sprites', `rover-${dir[0]}`);
    tileCache[`rover-${dir}`] = asset || generateRoverSprite(dir);
  }
  
  // Lander
  tileCache['lander'] = getAsset('sprites', 'lander') || generateLanderSprite();
}

// Get cached tile
export function getTile(type, variant = 1) {
  if (type === 'ground' || type === 'empty') {
    return tileCache[`ground-${((variant - 1) % 3) + 1}`];
  }
  return tileCache[type] || tileCache['ground-1'];
}

export function getRoverSprite(direction) {
  return tileCache[`rover-${direction}`] || tileCache['rover-north'];
}

export function getLanderSprite() {
  return tileCache['lander'];
}

// Main game canvas renderer
export class GameRenderer {
  constructor(container, gameState) {
    this.container = container;
    this.gameState = gameState;
    
    // Create canvases
    this.bgCanvas = document.createElement('canvas');
    this.bgCanvas.className = 'game-canvas bg-canvas';
    
    this.mainCanvas = document.createElement('canvas');
    this.mainCanvas.className = 'game-canvas main-canvas';
    
    this.uiCanvas = document.createElement('canvas');
    this.uiCanvas.className = 'game-canvas ui-canvas';
    
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
    
    // Perspective settings
    this.perspective = {
      tiltAngle: 0.15,
      scale: 1.0
    };
    
    this.tileSize = TILE_SIZE;
    this.gridWidth = GRID_COLS * this.tileSize;
    this.gridHeight = GRID_ROWS * this.tileSize;
  }
  
  mount() {
    const wrapper = document.createElement('div');
    wrapper.className = 'canvas-wrapper';
    wrapper.appendChild(this.bgCanvas);
    wrapper.appendChild(this.mainCanvas);
    wrapper.appendChild(this.uiCanvas);
    this.container.appendChild(wrapper);
    
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }
  
  resize() {
    const rect = this.container.getBoundingClientRect();
    const width = Math.min(rect.width - 40, 800);
    const height = width * (GRID_ROWS / GRID_COLS);
    
    for (const canvas of [this.bgCanvas, this.mainCanvas, this.uiCanvas]) {
      canvas.width = width;
      canvas.height = height;
      canvas.style.width = width + 'px';
      canvas.style.height = height + 'px';
    }
    
    this.tileSize = width / GRID_COLS;
    this.gridWidth = GRID_COLS * this.tileSize;
    this.gridHeight = GRID_ROWS * this.tileSize;
    
    this.renderBackground();
    this.render();
  }
  
  updateState(gameState) {
    this.gameState = gameState;
  }
  
  // Add tire track at position
  addTireTrack(col, row) {
    this.tireTracks.add(`${col},${row}`);
  }
  
  // Start rover animation
  startAnimation(fromCol, fromRow, toCol, toRow, duration = 120) {
    this.roverAnimX = fromCol;
    this.roverAnimY = fromRow;
    this.roverTargetX = toCol;
    this.roverTargetY = toRow;
    this.animationStart = performance.now();
    this.animationDuration = duration;
    this.isAnimating = true;
    
    // Add tire track at source
    this.addTireTrack(fromCol, fromRow);
    
    this.animateFrame();
  }
  
  animateFrame() {
    if (!this.isAnimating) return;
    
    const now = performance.now();
    const elapsed = now - this.animationStart;
    const progress = Math.min(1, elapsed / this.animationDuration);
    
    // Ease out
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
  
  renderBackground() {
    const ctx = this.bgCanvas.getContext('2d');
    const w = this.bgCanvas.width;
    const h = this.bgCanvas.height;
    
    // Mars horizon gradient
    const bgAsset = getAsset('ui', 'bg-horizon');
    if (bgAsset) {
      ctx.drawImage(bgAsset, 0, 0, w, h);
    } else {
      const gradient = ctx.createLinearGradient(0, 0, 0, h);
      gradient.addColorStop(0, '#1a0f0a');
      gradient.addColorStop(0.3, '#3d1f14');
      gradient.addColorStop(0.6, '#5c2e1a');
      gradient.addColorStop(1, '#8b4726');
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, w, h);
      
      // Dusty vignette
      const vignette = ctx.createRadialGradient(w/2, h/2, h * 0.3, w/2, h/2, h * 0.8);
      vignette.addColorStop(0, 'rgba(0,0,0,0)');
      vignette.addColorStop(1, 'rgba(0,0,0,0.5)');
      ctx.fillStyle = vignette;
      ctx.fillRect(0, 0, w, h);
    }
  }
  
  render() {
    if (!this.gameState) return;
    
    const ctx = this.mainCanvas.getContext('2d');
    const w = this.mainCanvas.width;
    const h = this.mainCanvas.height;
    const ts = this.tileSize;
    
    ctx.clearRect(0, 0, w, h);
    
    // Apply subtle perspective transform
    ctx.save();
    
    // Render tiles
    for (let row = 0; row < 12; row++) {
      for (let col = 0; col < 12; col++) {
        const x = col * ts;
        const y = row * ts;
        
        this.renderTile(ctx, col, row, x, y, ts);
      }
    }
    
    // Render lander row
    this.renderLanderRow(ctx, ts);
    
    // Render rover (with animation)
    this.renderRover(ctx, ts);
    
    ctx.restore();
  }
  
  renderTile(ctx, col, row, x, y, ts) {
    const state = this.gameState;
    const isRevealed = state.revealed[row][col];
    const terrain = state.terrain[row][col];
    const isDrilled = state.drilled[row][col];
    
    // Determine tile type
    let tileType = 'hidden';
    let variant = ((col + row) % 3) + 1;
    
    if (isRevealed) {
      switch (terrain) {
        case 'crater': tileType = 'crater'; break;
        case 'ore': tileType = isDrilled ? 'ore-drilled' : 'ore'; break;
        case 'dust': tileType = 'dust'; break;
        default: tileType = 'ground'; break;
      }
    }
    
    // Get cached tile
    const tile = getTile(tileType, variant);
    
    if (tile) {
      ctx.drawImage(tile, x, y, ts, ts);
    }
    
    // Tire tracks overlay
    if (this.tireTracks.has(`${col},${row}`) && isRevealed) {
      ctx.fillStyle = COLORS.trackColor;
      ctx.fillRect(x + ts * 0.2, y + ts * 0.1, ts * 0.15, ts * 0.8);
      ctx.fillRect(x + ts * 0.65, y + ts * 0.1, ts * 0.15, ts * 0.8);
    }
    
    // Grid lines (subtle)
    ctx.strokeStyle = 'rgba(255,255,255,0.08)';
    ctx.lineWidth = 1;
    ctx.strokeRect(x, y, ts, ts);
    
    // Column/row labels at edges
    if (row === 0) {
      ctx.fillStyle = 'rgba(255,255,255,0.5)';
      ctx.font = `${ts * 0.2}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.fillText(String.fromCharCode('A'.charCodeAt(0) + col), x + ts/2, ts * 0.15);
    }
    if (col === 0) {
      ctx.fillStyle = 'rgba(255,255,255,0.5)';
      ctx.font = `${ts * 0.2}px sans-serif`;
      ctx.textAlign = 'left';
      ctx.fillText(String(row + 1), ts * 0.05, y + ts/2);
    }
  }
  
  renderLanderRow(ctx, ts) {
    const y = 12 * ts;
    
    // Dark area for non-lander cells
    ctx.fillStyle = 'rgba(20,15,10,0.8)';
    for (let col = 0; col < 12; col++) {
      if (col !== 5) {
        ctx.fillRect(col * ts, y, ts, ts);
      }
    }
    
    // Lander cell
    const lx = 5 * ts;
    ctx.fillStyle = 'rgba(40,60,80,0.6)';
    ctx.fillRect(lx, y, ts, ts);
    
    // Lander sprite (if rover not on it)
    if (!(this.gameState.col === 5 && this.gameState.row === 12)) {
      const lander = getLanderSprite();
      if (lander) {
        ctx.drawImage(lander, lx - ts * 0.25, y - ts * 0.4, ts * 1.5, ts * 1.5);
      }
    }
    
    // Label
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    ctx.font = `${ts * 0.2}px sans-serif`;
    ctx.textAlign = 'left';
    ctx.fillText('L', ts * 0.05, y + ts/2);
  }
  
  renderRover(ctx, ts) {
    const state = this.gameState;
    
    let roverCol, roverRow;
    if (this.isAnimating) {
      roverCol = this.roverAnimX;
      roverRow = this.roverAnimY;
    } else {
      roverCol = state.col;
      roverRow = state.row;
    }
    
    const x = roverCol * ts;
    const y = roverRow * ts;
    
    const roverSprite = getRoverSprite(state.facing);
    if (roverSprite) {
      // Draw rover centered on tile
      const roverSize = ts * 0.9;
      const offset = (ts - roverSize) / 2;
      ctx.drawImage(roverSprite, x + offset, y + offset, roverSize, roverSize);
      
      // Charging glow
      if (state.charging) {
        ctx.fillStyle = 'rgba(100,200,255,0.3)';
        ctx.beginPath();
        ctx.arc(x + ts/2, y + ts/2, ts * 0.5, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }
}

// Initialize on module load
if (typeof window !== 'undefined') {
  loadAssets().catch(() => {});
}
