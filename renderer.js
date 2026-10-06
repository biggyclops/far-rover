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
  revealedWash: 'rgba(255, 186, 110, 0.14)'
};

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
    
    // Perspective settings — closer camera, milder tilt so sprites read larger
    this.vanishY = 0.08;
    this.horizonY = 0.04;
    this.boardTop = 0.03;
    this.boardBottom = 0.995;
    this.boardShrink = 0.80; // top row is 80% of bottom (was 55%)
    this.boardFill = 1.0;    // fill the map canvas width
  }
  
  mount() {
    this.container.appendChild(this.canvas);
    this.resize();
    window.addEventListener('resize', () => this.resize());
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
    
    this.render();
  }
  
  updateState(gameState) {
    this.gameState = gameState;
  }
  
  addTireTrack(col, row) {
    this.tireTracks.add(`${col},${row}`);
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
  
  render() {
    if (!this.gameState) return;
    
    const ctx = this.ctx;
    const w = this.width;
    const h = this.height;
    
    ctx.clearRect(0, 0, w, h);
    
    // Draw all tiles (back to front for proper overlap)
    for (let row = 0; row < GRID_ROWS; row++) {
      for (let col = 0; col < GRID_COLS; col++) {
        this.renderTile(ctx, col, row);
      }
    }
    
    // Draw lander row
    this.renderLanderArea(ctx);
    
    // Draw rover
    this.renderRover(ctx);
    
    // Draw grid lines (very faint)
    this.renderGridLines(ctx);
    
    // Draw vignette edges
    this.renderVignette(ctx);
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
    
    // Fog of war overlay — light warm haze so terrain still reads
    if (!isRevealed) {
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(quad[0].x, quad[0].y);
      ctx.lineTo(quad[1].x, quad[1].y);
      ctx.lineTo(quad[2].x, quad[2].y);
      ctx.lineTo(quad[3].x, quad[3].y);
      ctx.closePath();
      
      ctx.fillStyle = isCameraSeen ? COLORS.cameraSeen : COLORS.hidden;
      ctx.fill();
      ctx.restore();
    } else {
      // Warm dusty lift so scanned tiles read bright, not muddy
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
    
    // Crater warning ring (dashed red-orange)
    if (isRevealed && terrain === 'crater') {
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
  
  renderLanderArea(ctx) {
    const row = GRID_ROWS;
    
    // Draw ground texture for lander row
    for (let col = 0; col < GRID_COLS; col++) {
      const quad = this.getTileQuad(col, row);
      const variant = getGroundVariant(col, row);
      const tile = getTile('ground', variant);
      this.drawTexturedQuad(ctx, tile, quad);
      
      // Darken non-lander cells
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
    
    // Draw lander
    const state = this.gameState;
    if (!(state.col === LANDER_COL && state.row === LANDER_ROW)) {
      const lander = getLanderSprite();
      if (lander) {
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
          ctx.fillStyle = '#1a1510';
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
