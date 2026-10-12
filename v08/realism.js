import { CONFIG as C } from './config.js';

const BUILDING_KEYS = new Set(['habitat', 'solar', 'printer', 'storage', 'tunnel-hub']);
const UNIT_ANCHOR = { obj: 128, canvas: 256, pivot: 96 };
const BUILDING_ANCHOR = { obj: 256, canvas: 512, pivot: 160 };
const CHUNK = 512;
const TRACK_LIFE = 36;
const TRACK_STEP = 18;

export function createRealism(assets, game, worldToScreen, viewSize) {
  function img(name) {
    return assets.images[name] || null;
  }

  const plate = img('ground-map');
  const chunks = [];
  if (plate) {
    const pw = plate.naturalWidth || plate.width || 2560;
    const ph = plate.naturalHeight || plate.height || 2560;
    for (let y = 0; y < ph; y += CHUNK) {
      for (let x = 0; x < pw; x += CHUNK) {
        const cw = Math.min(CHUNK, pw - x);
        const ch = Math.min(CHUNK, ph - y);
        const c = document.createElement('canvas');
        c.width = cw;
        c.height = ch;
        c.getContext('2d').drawImage(plate, x, y, cw, ch, 0, 0, cw, ch);
        chunks.push({ x, y, w: cw, h: ch, canvas: c });
      }
    }
  }

  const lastPos = new Map();
  const stamps = [];

  function recordTracks(dt) {
    if (dt <= 0) return;
    for (const u of game.state.units) {
      if (u.kind !== 'hauler') continue;
      const prev = lastPos.get(u.id);
      if (!prev) {
        lastPos.set(u.id, { x: u.x, y: u.y });
        continue;
      }
      const dist = Math.hypot(u.x - prev.x, u.y - prev.y);
      if (dist >= TRACK_STEP) {
        stamps.push({ x: u.x, y: u.y, facing: u.facing || 0, t: TRACK_LIFE });
        lastPos.set(u.id, { x: u.x, y: u.y });
      }
    }
    for (let i = stamps.length - 1; i >= 0; i--) {
      stamps[i].t -= dt;
      if (stamps[i].t <= 0) stamps.splice(i, 1);
    }
  }

  function drawPlate(ctx, z) {
    const { w, h } = viewSize();
    const cam = game.state.camera;
    if (!chunks.length) return false;
    for (const ch of chunks) {
      const sx = (ch.x - cam.x) * z;
      const sy = (ch.y - cam.y) * z;
      const dw = ch.w * z;
      const dh = ch.h * z;
      if (sx + dw < -2 || sy + dh < -2 || sx > w + 2 || sy > h + 2) continue;
      ctx.drawImage(ch.canvas, sx, sy, dw, dh);
    }
    return true;
  }

  function drawDustApron(ctx, z) {
    const apron = img('dust-apron');
    if (!apron) return;
    const hab = game.habitat();
    if (!hab) return;
    const wx = (hab.tx + 1) * C.tileSize;
    const wy = (hab.ty + 1) * C.tileSize;
    const s = worldToScreen(wx, wy);
    const size = 768 * 0.55 * z;
    ctx.save();
    ctx.globalAlpha = 0.82;
    ctx.drawImage(apron, s.x - size / 2, s.y - size / 2, size, size);
    ctx.restore();
  }

  function drawTracks(ctx, z) {
    const strip = img('haul-tracks');
    if (!strip || !stamps.length) return;
    const w = 96 * z;
    const h = 24 * z;
    for (const st of stamps) {
      const s = worldToScreen(st.x, st.y);
      ctx.save();
      ctx.globalAlpha = Math.max(0, Math.min(0.85, st.t / TRACK_LIFE));
      ctx.translate(s.x, s.y);
      ctx.rotate(st.facing || 0);
      ctx.drawImage(strip, -w / 2, -h / 2, w, h);
      ctx.restore();
    }
  }

  function drawRelitLayer(ctx, image, sx, sy, scale, pivot, canvas) {
    if (!image) return;
    const size = canvas * scale;
    ctx.drawImage(image, sx - pivot * scale, sy - pivot * scale, size, size);
  }

  function buildingScale(n, z) {
    return (n * C.tileSize * z) / BUILDING_ANCHOR.obj;
  }

  function unitScale(z) {
    return (C.tileSize * z) / UNIT_ANCHOR.obj;
  }

  function drawBuildingShadow(ctx, b, z, night) {
    if (!BUILDING_KEYS.has(b.type)) return false;
    const n = C.buildingFootprint;
    const s = worldToScreen((b.tx + n / 2) * C.tileSize, (b.ty + n / 2) * C.tileSize);
    const scale = buildingScale(n, z);
    ctx.save();
    ctx.globalAlpha = night ? 0.42 : 1;
    drawRelitLayer(ctx, img(`${b.type}-shadow`), s.x, s.y, scale, BUILDING_ANCHOR.pivot, BUILDING_ANCHOR.canvas);
    ctx.restore();
    return true;
  }

  function drawBuildingContact(ctx, b, z) {
    if (!BUILDING_KEYS.has(b.type)) return;
    const n = C.buildingFootprint;
    const s = worldToScreen((b.tx + n / 2) * C.tileSize, (b.ty + n / 2) * C.tileSize);
    const scale = buildingScale(n, z);
    drawRelitLayer(ctx, img(`${b.type}-contact`), s.x, s.y, scale, BUILDING_ANCHOR.pivot, BUILDING_ANCHOR.canvas);
  }

  function drawBuildingSprite(ctx, b, z) {
    if (!BUILDING_KEYS.has(b.type)) return false;
    const n = C.buildingFootprint;
    const s = worldToScreen((b.tx + n / 2) * C.tileSize, (b.ty + n / 2) * C.tileSize);
    const dest = n * C.tileSize * z;
    const key = (!b.complete && C.showBuildSpriteWhileConstructing) ? `${b.type}-build` : b.type;
    const body = img(key) || img(b.type);
    if (!body) return false;
    ctx.drawImage(body, s.x - dest / 2, s.y - dest / 2, dest, dest);
    return true;
  }

  function drawUnitShadow(ctx, u, z, night) {
    const loaded = (u.cargo.ice + u.cargo.regolith) > 0.05;
    const sh = u.kind === 'scout'
      ? img('scout-shadow')
      : (loaded ? (img('hauler-loaded-shadow') || img('hauler-shadow')) : img('hauler-shadow'));
    if (!sh) return;
    const s = worldToScreen(u.x, u.y);
    const scale = unitScale(z);
    ctx.save();
    ctx.globalAlpha = night ? 0.4 : 1;
    drawRelitLayer(ctx, sh, s.x, s.y, scale, UNIT_ANCHOR.pivot, UNIT_ANCHOR.canvas);
    ctx.restore();
  }

  function drawUnitContact(ctx, u, z) {
    const loaded = (u.cargo.ice + u.cargo.regolith) > 0.05;
    const c = u.kind === 'scout'
      ? img('scout-contact')
      : (loaded ? (img('hauler-loaded-contact') || img('hauler-contact')) : img('hauler-contact'));
    if (!c) return;
    const s = worldToScreen(u.x, u.y);
    const scale = unitScale(z);
    drawRelitLayer(ctx, c, s.x, s.y, scale, UNIT_ANCHOR.pivot, UNIT_ANCHOR.canvas);
  }

  function drawUnitBody(ctx, u, z) {
    const loaded = (u.cargo.ice + u.cargo.regolith) > 0.05;
    const body = u.kind === 'scout' ? img('scout') : (loaded ? img('hauler-loaded') : img('hauler'));
    if (!body) return;
    const s = worldToScreen(u.x, u.y);
    const dest = C.tileSize * z;
    ctx.save();
    ctx.translate(s.x, s.y);
    ctx.rotate(u.facing || 0);
    ctx.drawImage(body, -dest / 2, -dest / 2, dest, dest);
    ctx.restore();
  }

  return {
    hasPlate: !!plate,
    recordTracks,
    drawPlate,
    drawDustApron,
    drawTracks,
    drawBuildingShadow,
    drawBuildingContact,
    drawBuildingSprite,
    drawUnitShadow,
    drawUnitContact,
    drawUnitBody,
  };
}
