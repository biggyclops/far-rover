import { CONFIG as C } from './config.js';

const BUILDING_KEYS = new Set(['habitat', 'solar', 'printer', 'storage', 'tunnel-hub']);
const BUILDING = { canvas: 360, pivot: 112 };
const UNIT = { frame: 176, pivot: 78, headings: 16, stepDeg: 22.5 };
const DRAW_SCALE = 0.5;
const UNIT_SCALE = 0.64;
const CHUNK = 512;
const TRACK_LIFE = 36;
const TRACK_STEP = 18;
const TURN_DOT = 0.45;

export function createRealism(assets, game, worldToScreen, viewSize) {
  function img(name) {
    return assets.images[name] || null;
  }

  const overlayAlpha = new Map();
  const terrainClass = new Map();
  const CRATER_CLASSES = new Set(['crater_floor', 'psr', 'crater_rim']);
  fetch(new URL('../assets/v08/art/realism/ground/map-data.json', import.meta.url))
    .then((r) => r.json())
    .then((data) => {
      const grid = data.grid || [];
      for (let ty = 0; ty < grid.length; ty++) {
        const row = grid[ty] || [];
        for (let tx = 0; tx < row.length; tx++) {
          const cls = row[tx];
          terrainClass.set(`${tx},${ty}`, cls);
          if (CRATER_CLASSES.has(cls)) overlayAlpha.set(`${tx},${ty}`, 0.28);
        }
      }
    })
    .catch(() => {});

  function loadChunks(kind) {
    const chunks = [];
    for (let r = 0; r < 5; r++) {
      for (let c = 0; c < 5; c++) {
        const canvas = img(`ground-${kind}-${r}-${c}`);
        if (!canvas) continue;
        chunks.push({
          x: c * CHUNK,
          y: r * CHUNK,
          w: canvas.naturalWidth || canvas.width || CHUNK,
          h: canvas.naturalHeight || canvas.height || CHUNK,
          canvas,
        });
      }
    }
    return chunks;
  }

  const dayChunks = loadChunks('day');
  const nightChunks = loadChunks('night');

  const lastPos = new Map();
  const lastFacing = new Map();
  const stamps = [];

  function headingFrame(facing) {
    let deg = (facing || 0) * (180 / Math.PI);
    if (deg < 0) deg += 360;
    return Math.round(deg / UNIT.stepDeg) % UNIT.headings;
  }

  function recordTracks(dt) {
    if (dt <= 0) return;
    for (const u of game.state.units) {
      if (u.kind !== 'hauler') continue;
      const prev = lastPos.get(u.id);
      const prevF = lastFacing.get(u.id);
      if (!prev) {
        lastPos.set(u.id, { x: u.x, y: u.y });
        lastFacing.set(u.id, u.facing || 0);
        continue;
      }
      const dist = Math.hypot(u.x - prev.x, u.y - prev.y);
      if (dist >= TRACK_STEP) {
        let dFace = (u.facing || 0) - (prevF || 0);
        while (dFace > Math.PI) dFace -= Math.PI * 2;
        while (dFace < -Math.PI) dFace += Math.PI * 2;
        stamps.push({
          x: u.x,
          y: u.y,
          facing: u.facing || 0,
          curve: Math.abs(dFace) > TURN_DOT,
          t: TRACK_LIFE,
        });
        lastPos.set(u.id, { x: u.x, y: u.y });
        lastFacing.set(u.id, u.facing || 0);
      }
    }
    for (let i = stamps.length - 1; i >= 0; i--) {
      stamps[i].t -= dt;
      if (stamps[i].t <= 0) stamps.splice(i, 1);
    }
  }

  function drawPlate(ctx, z, night) {
    const chunks = night && nightChunks.length ? nightChunks : dayChunks;
    const { w, h } = viewSize();
    const cam = game.state.camera;
    if (!chunks.length) return false;
    for (const ch of chunks) {
      const sx = (ch.x - cam.x) * z;
      const sy = (ch.y - cam.y) * z;
      const dw = ch.w * z;
      const dh = ch.h * z;
      if (sx + dw < -2 || sy + dh < -2 || sx > w + 2 || sy > h + 2) continue;
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(ch.canvas, sx, sy, dw, dh);
    }
    return true;
  }

  function craterOverlayAlpha(tx, ty, fallback) {
    const hit = overlayAlpha.get(`${tx},${ty}`);
    return hit == null ? fallback : hit;
  }

  function tileClass(tx, ty) {
    return terrainClass.get(`${tx},${ty}`) || null;
  }

  function drawDustApron(ctx, z, night) {
    const apron = img('dust-apron');
    if (!apron || night) return;
    const hab = game.habitat();
    if (!hab) return;
    const wx = (hab.tx + 1) * C.tileSize;
    const wy = (hab.ty + 1) * C.tileSize;
    const s = worldToScreen(wx, wy);
    const size = 768 * DRAW_SCALE * z;
    ctx.save();
    ctx.globalAlpha = 0.82;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(apron, s.x - size / 2, s.y - size / 2, size, size);
    ctx.restore();
  }

  function eastDegMod180(facing) {
    // Clockwise from east, then mod 180 (tracks look the same forwards/back).
    let a = ((facing || 0) * 180) / Math.PI - 90;
    a = ((a % 180) + 180) % 180;
    return a;
  }

  function nearestTrackDecal(a) {
    const variants = [0, 45, 90, 135];
    let best = 0;
    let bestD = 999;
    for (const v of variants) {
      const d = Math.min(Math.abs(a - v), Math.abs(a - v - 180), Math.abs(a - v + 180));
      if (d < bestD) {
        bestD = d;
        best = v;
      }
    }
    return best;
  }

  function drawTracks(ctx, z) {
    if (!stamps.length) return;
    const s0 = DRAW_SCALE * z;
    for (const st of stamps) {
      const s = worldToScreen(st.x, st.y);
      ctx.save();
      ctx.globalAlpha = Math.max(0, Math.min(0.85, st.t / TRACK_LIFE));
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      if (st.curve) {
        const q = ((Math.round((((st.facing || 0) * 180) / Math.PI) / 90) % 4) + 4) % 4;
        const ang = [0, 90, 180, 270][q];
        const curve = img(`track-curve-${ang}`) || img('track-curve');
        if (curve) {
          const size = 256 * s0;
          ctx.drawImage(curve, s.x - size / 2, s.y - size / 2, size, size);
        }
      } else {
        const a = eastDegMod180(st.facing);
        const variant = nearestTrackDecal(a);
        const strip = img(`track-decal-${variant}`) || img('track-decal');
        if (strip) {
          const w = 256 * s0;
          const h = 96 * s0;
          ctx.translate(s.x, s.y);
          ctx.rotate(((a - variant) * Math.PI) / 180);
          ctx.drawImage(strip, -w / 2, -h / 2, w, h);
        }
      }
      ctx.restore();
    }
  }

  function layerDest(sx, sy, pivot, canvas, z) {
    const s = DRAW_SCALE * z;
    return { x: sx - pivot * s, y: sy - pivot * s, size: canvas * s };
  }

  function drawLayer(ctx, image, sx, sy, pivot, canvas, z) {
    if (!image) return;
    const d = layerDest(sx, sy, pivot, canvas, z);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(image, d.x, d.y, d.size, d.size);
  }

  function drawSheetFrame(ctx, sheet, frame, sx, sy, z) {
    if (!sheet) return;
    const s = UNIT_SCALE * z;
    const src = UNIT.frame;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(
      sheet,
      frame * src,
      0,
      src,
      src,
      sx - UNIT.pivot * s,
      sy - UNIT.pivot * s,
      src * s,
      src * s,
    );
  }

  function withNightSprite(ctx, night, draw) {
    ctx.save();
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    if (night) ctx.filter = 'brightness(0.68) saturate(0.94)';
    draw();
    ctx.restore();
  }

  function buildingKey(b, layer) {
    const constructing = !b.complete && C.showBuildSpriteWhileConstructing;
    const base = constructing ? `${b.type}-build` : b.type;
    if (layer === 'object') return base;
    return `${base}-${layer}`;
  }

  function buildingScreen(b) {
    const n = C.buildingFootprint;
    return worldToScreen((b.tx + n / 2) * C.tileSize, (b.ty + n / 2) * C.tileSize);
  }

  function drawBuildingShadow(ctx, b, z, night) {
    if (!BUILDING_KEYS.has(b.type)) return false;
    const s = buildingScreen(b);
    ctx.save();
    ctx.globalCompositeOperation = 'multiply';
    ctx.globalAlpha = night ? 0.55 : 0.9;
    drawLayer(ctx, img(buildingKey(b, 'shadow')), s.x, s.y, BUILDING.pivot, BUILDING.canvas, z);
    ctx.restore();
    return true;
  }

  function drawBuildingContact(ctx, b, z) {
    if (!BUILDING_KEYS.has(b.type)) return;
    const s = buildingScreen(b);
    drawLayer(ctx, img(buildingKey(b, 'contact')), s.x, s.y, BUILDING.pivot, BUILDING.canvas, z);
  }

  function drawBuildingSprite(ctx, b, z, night) {
    if (!BUILDING_KEYS.has(b.type)) return false;
    const s = buildingScreen(b);
    const body = img(buildingKey(b, 'object')) || img(b.type);
    if (!body) return false;
    withNightSprite(ctx, night, () => {
      drawLayer(ctx, body, s.x, s.y, BUILDING.pivot, BUILDING.canvas, z);
    });
    return true;
  }

  function drawBuildingStatus(ctx, b, z, night) {
    if (!night || !b.complete || !BUILDING_KEYS.has(b.type)) return;
    const light = img('status-light');
    if (!light) return;
    const s = buildingScreen(b);
    const size = 32 * DRAW_SCALE * z;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = 0.9;
    ctx.drawImage(light, s.x - size * 0.2, s.y - 20 * z, size, size);
    ctx.restore();
  }

  function unitSheets(u) {
    const loaded = (u.cargo.ice + u.cargo.regolith) > 0.05;
    if (u.kind === 'scout') {
      return {
        body: img('scout'),
        shadow: img('scout-shadow'),
        contact: img('unit-contact'),
        contactScale: 0.8,
      };
    }
    if (loaded) {
      return {
        body: img('hauler-loaded') || img('hauler'),
        shadow: img('hauler-loaded-shadow') || img('hauler-shadow'),
        contact: img('unit-contact'),
        contactScale: 1,
      };
    }
    return {
      body: img('hauler'),
      shadow: img('hauler-shadow'),
      contact: img('unit-contact'),
      contactScale: 1,
    };
  }

  function drawUnitShadow(ctx, u, z, night) {
    const { shadow } = unitSheets(u);
    if (!shadow) return;
    const s = worldToScreen(u.x, u.y);
    ctx.save();
    ctx.globalCompositeOperation = 'multiply';
    ctx.globalAlpha = night ? 0.5 : 0.88;
    drawSheetFrame(ctx, shadow, headingFrame(u.facing), s.x, s.y, z);
    ctx.restore();
  }

  function drawUnitContact(ctx, u, z) {
    const { contact, contactScale } = unitSheets(u);
    if (!contact) return;
    const s = worldToScreen(u.x, u.y);
    const sc = UNIT_SCALE * (contactScale || 1) * z;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(
      contact,
      s.x - UNIT.pivot * sc,
      s.y - UNIT.pivot * sc,
      UNIT.frame * sc,
      UNIT.frame * sc,
    );
  }

  function drawUnitBody(ctx, u, z, night) {
    const { body } = unitSheets(u);
    if (!body) return;
    const s = worldToScreen(u.x, u.y);
    withNightSprite(ctx, night, () => {
      drawSheetFrame(ctx, body, headingFrame(u.facing), s.x, s.y, z);
    });
  }

  function drawFloodlight(ctx, x, y, size, intensity, wideKey) {
    const wide = img(wideKey) || img('glow-building') || img('glow-unit');
    const core = img('floodlight-pool');
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    if (wide) {
      ctx.globalAlpha = intensity;
      ctx.drawImage(wide, x - size / 2, y - size / 2, size, size);
    }
    if (core) {
      ctx.globalAlpha = wide ? Math.min(0.4, intensity * 0.7) : Math.min(0.9, intensity + 0.25);
      const coreSize = wide ? size : size * 2;
      ctx.drawImage(core, x - coreSize / 2, y - coreSize / 2, coreSize, coreSize);
    }
    ctx.restore();
  }

  return {
    hasPlate: dayChunks.length > 0,
    recordTracks,
    drawPlate,
    craterOverlayAlpha,
    drawDustApron,
    drawTracks,
    drawBuildingShadow,
    drawBuildingContact,
    drawBuildingSprite,
    drawBuildingStatus,
    drawUnitShadow,
    drawUnitContact,
    drawUnitBody,
    drawFloodlight,
    headingFrame,
    tileClass,
  };
}
