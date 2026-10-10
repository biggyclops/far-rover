import { CONFIG as C } from './config.js';
import { TILE } from './game.js';

function tintCanvas(img, color) {
  const c = document.createElement('canvas');
  c.width = img.width || img.naturalWidth || 128;
  c.height = img.height || img.naturalHeight || 128;
  const ctx = c.getContext('2d');
  ctx.drawImage(img, 0, 0);
  ctx.globalCompositeOperation = 'source-in';
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, c.width, c.height);
  return c;
}

export function createRenderer(canvas, assets, game) {
  const ctx = canvas.getContext('2d');
  const ringTinted = assets.images['ring-select']
    ? tintCanvas(assets.images['ring-select'], C.playerAccent)
    : null;
  const markerTinted = [0, 1, 2, 3].map((i) => (
    assets.images[`order-marker-${i}`]
      ? tintCanvas(assets.images[`order-marker-${i}`], C.playerAccent)
      : null
  ));

  function resize() {
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    canvas.width = Math.max(1, Math.floor(w * dpr));
    canvas.height = Math.max(1, Math.floor(h * dpr));
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { w, h, dpr };
  }

  function viewSize() {
    return { w: canvas.clientWidth, h: canvas.clientHeight };
  }

  function worldToScreen(wx, wy) {
    const cam = game.state.camera;
    return { x: (wx - cam.x) * cam.zoom, y: (wy - cam.y) * cam.zoom };
  }

  function screenToWorld(sx, sy) {
    const cam = game.state.camera;
    return { x: sx / cam.zoom + cam.x, y: sy / cam.zoom + cam.y };
  }

  function img(name) {
    return assets.images[name] || null;
  }

  function drawImg(image, x, y, w, h) {
    if (!image) return;
    ctx.drawImage(image, x, y, w, h);
  }

  function tileSprite(tile) {
    if (tile.type === TILE.ICE) return img('tile-ice');
    if (tile.type === TILE.ICE_MINED) return img('tile-ice-mined');
    if (tile.type === TILE.CRATER_S) return img('tile-crater-s');
    if (tile.type === TILE.PIT) return img('tile-pit');
    return img(`tile-ground-${tile.variant}`);
  }

  function drawTiles(ts, night) {
    const { w, h } = viewSize();
    const cam = game.state.camera;
    const z = cam.zoom;
    const x0 = Math.max(0, Math.floor(cam.x / C.tileSize) - 1);
    const y0 = Math.max(0, Math.floor(cam.y / C.tileSize) - 1);
    const x1 = Math.min(C.mapWidth, Math.ceil((cam.x + w / z) / C.tileSize) + 1);
    const y1 = Math.min(C.mapHeight, Math.ceil((cam.y + h / z) / C.tileSize) + 1);
    for (let ty = y0; ty < y1; ty++) {
      for (let tx = x0; tx < x1; tx++) {
        const tile = game.tileAt(tx, ty);
        const s = worldToScreen(tx * C.tileSize, ty * C.tileSize);
        drawImg(tileSprite(tile), s.x, s.y, C.tileSize * z, C.tileSize * z);
      }
    }
    for (let ty = 0; ty < C.mapHeight; ty++) {
      for (let tx = 0; tx < C.mapWidth; tx++) {
        const tile = game.tileAt(tx, ty);
        if (!tile.craterMAnchor) continue;
        const s = worldToScreen(tx * C.tileSize, ty * C.tileSize);
        drawImg(img('crater-m'), s.x, s.y, C.tileSize * 2 * z, C.tileSize * 2 * z);
      }
    }
    void night;
  }

  function drawGlow(x, y, size, name, intensity) {
    const g = img(name);
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = intensity;
    if (g) {
      ctx.drawImage(g, x - size / 2, y - size / 2, size, size);
    } else {
      const grd = ctx.createRadialGradient(x, y, 2, x, y, size / 2);
      grd.addColorStop(0, 'rgba(255,233,196,0.9)');
      grd.addColorStop(1, 'rgba(255,233,196,0)');
      ctx.fillStyle = grd;
      ctx.beginPath();
      ctx.arc(x, y, size / 2, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  function drawBuildings(z, night, pass) {
    for (const b of game.state.buildings) {
      const n = b.type === 'vault' ? C.vaultFootprint : C.buildingFootprint;
      const wx = b.tx * C.tileSize;
      const wy = b.ty * C.tileSize;
      const s = worldToScreen(wx, wy);
      const dw = n * C.tileSize * z;
      if (pass === 'glow' && night && C.nightGlowAdditive) {
        const c = worldToScreen(wx + n * C.tileSize / 2, wy + n * C.tileSize / 2);
        drawGlow(c.x, c.y, dw * 1.15, 'glow-building', C.glowBuildingIntensity);
      }
      if (pass === 'sprite') {
        const key = (!b.complete && C.showBuildSpriteWhileConstructing) ? `${b.type}-build` : b.type;
        drawImg(img(key) || img(b.type), s.x, s.y, dw, dw);
      }
    }
  }

  function drawUnit(u, z, night, pass) {
    const s = worldToScreen(u.x, u.y);
    const loaded = (u.cargo.ice + u.cargo.regolith) > 0.05;
    const body = u.kind === 'scout'
      ? img('scout')
      : (loaded ? img('hauler-loaded') : img('hauler'));
    const sh = u.kind === 'scout' ? img('scout-shadow') : img('hauler-shadow');
    const size = C.tileSize * z;
    if (pass === 'glow') {
      if (night && C.nightGlowAdditive) drawGlow(s.x, s.y, size * 1.2, 'glow-unit', C.glowUnitIntensity);
      return;
    }
    // Shadow rotates with the unit; offset stays screen-space so the light never moves.
    if (sh && !(night && !C.nightMovingShadows)) {
      ctx.save();
      ctx.translate(s.x + C.shadowOffsetPx[0] * z, s.y + C.shadowOffsetPx[1] * z);
      if (C.shadowSpriteRotates) ctx.rotate(u.facing);
      ctx.drawImage(sh, -size / 2, -size / 2, size, size);
      ctx.restore();
    }
    if (body) {
      ctx.save();
      ctx.translate(s.x, s.y);
      ctx.rotate(u.facing);
      ctx.drawImage(body, -size / 2, -size / 2, size, size);
      ctx.restore();
    }
  }

  function drawSelection(u, z) {
    const s = worldToScreen(u.x, u.y);
    const size = C.tileSize * z;
    const ring = ringTinted || img('ring-select');
    if (ring) ctx.drawImage(ring, s.x - size / 2, s.y - size / 2, size, size);
    else {
      ctx.strokeStyle = C.playerAccent;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(s.x, s.y, size * 0.42, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  function drawCommandRange(z) {
    const h = game.habitat();
    if (!h) return;
    const c = worldToScreen((h.tx + 1) * C.tileSize, (h.ty + 1) * C.tileSize);
    ctx.save();
    ctx.strokeStyle = C.playerAccent;
    ctx.globalAlpha = 0.45;
    ctx.lineWidth = 1.5;
    ctx.setLineDash([7, 6]);
    ctx.beginPath();
    ctx.arc(c.x, c.y, C.commandRangeRadius * C.tileSize * z, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  function drawOrderMarker(z) {
    const m = game.state.orderMarker;
    if (!m) return;
    const frame = Math.floor(m.t * 8) % 4;
    const s = worldToScreen(m.x, m.y);
    const size = 32 * z;
    const im = markerTinted[frame] || img(`order-marker-${frame}`);
    if (im) ctx.drawImage(im, s.x - size / 2, s.y - size / 2, size, size);
    else {
      ctx.fillStyle = C.playerAccent;
      ctx.beginPath();
      ctx.arc(s.x, s.y, 5 * z, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function drawGhost(z) {
    const g = game.state.buildGhost;
    if (!g) return;
    const ok = game.canPlace(g.type, g.tx, g.ty);
    const s = worldToScreen(g.tx * C.tileSize, g.ty * C.tileSize);
    const dw = C.buildingFootprint * C.tileSize * z;
    ctx.save();
    ctx.globalAlpha = 0.45;
    drawImg(img(`${g.type}-build`) || img(g.type), s.x, s.y, dw, dw);
    ctx.globalAlpha = 1;
    ctx.strokeStyle = ok ? C.playerAccent : '#c04040';
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 4]);
    ctx.strokeRect(s.x, s.y, dw, dw);
    ctx.restore();
  }

  function drawBox() {
    const box = game.state.boxSelect;
    if (!box) return;
    const x = Math.min(box.x0, box.x1);
    const y = Math.min(box.y0, box.y1);
    const w = Math.abs(box.x1 - box.x0);
    const h = Math.abs(box.y1 - box.y0);
    ctx.save();
    ctx.strokeStyle = C.playerAccent;
    ctx.fillStyle = 'rgba(255,138,31,0.12)';
    ctx.lineWidth = 1;
    ctx.fillRect(x, y, w, h);
    ctx.strokeRect(x, y, w, h);
    ctx.restore();
  }

  function drawNightTint() {
    const { w, h } = viewSize();
    ctx.fillStyle = C.nightTint;
    ctx.fillRect(0, 0, w, h);
  }

  function centerOnHabitat() {
    const { w, h } = viewSize();
    const hab = game.habitat();
    const cx = (hab.tx + 1) * C.tileSize;
    const cy = (hab.ty + 1) * C.tileSize;
    game.state.camera.x = cx - (w / game.state.camera.zoom) / 2;
    game.state.camera.y = cy - (h / game.state.camera.zoom) / 2;
  }

  function draw() {
    const { w, h } = resize();
    ctx.clearRect(0, 0, w, h);
    const z = game.state.camera.zoom;
    const night = !game.isDay();
    drawTiles(C.tileSize * z, night);
    drawBuildings(z, night, 'sprite');
    for (const u of game.state.units) drawUnit(u, z, night, 'sprite');
    if (night) drawNightTint();
    drawBuildings(z, night, 'glow');
    for (const u of game.state.units) drawUnit(u, z, night, 'glow');
    drawCommandRange(z);
    for (const u of game.state.units) {
      if (game.state.selectedIds.includes(u.id)) drawSelection(u, z);
    }
    drawOrderMarker(z);
    drawGhost(z);
    drawBox();
  }

  return { draw, resize, worldToScreen, screenToWorld, viewSize, centerOnHabitat };
}
