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

function showBuilding(b, view) {
  if (b.type === 'tunnel-hub') return true;
  if (b.type === 'vault') return view === 'underground';
  return view === 'surface';
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

  function visibleTileRange() {
    const { w, h } = viewSize();
    const cam = game.state.camera;
    const z = cam.zoom;
    return {
      x0: Math.max(0, Math.floor(cam.x / C.tileSize) - 1),
      y0: Math.max(0, Math.floor(cam.y / C.tileSize) - 1),
      x1: Math.min(C.mapWidth, Math.ceil((cam.x + w / z) / C.tileSize) + 1),
      y1: Math.min(C.mapHeight, Math.ceil((cam.y + h / z) / C.tileSize) + 1),
    };
  }

  function drawSurfaceTiles(z) {
    const { x0, y0, x1, y1 } = visibleTileRange();
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
  }

  function utileRock(tx, ty) {
    const tile = game.tileAt(tx, ty);
    const variant = tile ? tile.variant : 1;
    return img(variant <= 2 ? 'utile-rock-1' : 'utile-rock-2');
  }

  function tunnelTileAt(tx, ty) {
    return game.state.tunnel.tiles.find((t) => t.tx === tx && t.ty === ty) || null;
  }

  function cornerRotation(tx, ty) {
    const n = tunnelTileAt(tx, ty - 1);
    const e = tunnelTileAt(tx + 1, ty);
    const s = tunnelTileAt(tx, ty + 1);
    const w = tunnelTileAt(tx - 1, ty);
    const has = (t) => t && t.done;
    // Pixel: utile-tunnel-corner joins east-south at rotation 0.
    if (has(e) && has(s) && !has(n) && !has(w)) return 0;
    if (has(s) && has(w) && !has(n) && !has(e)) return Math.PI / 2;
    if (has(w) && has(n) && !has(e) && !has(s)) return Math.PI;
    if (has(n) && has(e) && !has(s) && !has(w)) return -Math.PI / 2;
    return null;
  }

  function drawUndergroundTiles(z) {
    const { x0, y0, x1, y1 } = visibleTileRange();
    for (let ty = y0; ty < y1; ty++) {
      for (let tx = x0; tx < x1; tx++) {
        const s = worldToScreen(tx * C.tileSize, ty * C.tileSize);
        drawImg(utileRock(tx, ty), s.x, s.y, C.tileSize * z, C.tileSize * z);
      }
    }
    for (const tile of game.state.tunnel.tiles) {
      if (!tile.done) continue;
      const s = worldToScreen(tile.tx * C.tileSize, tile.ty * C.tileSize);
      const dw = C.tileSize * z;
      const rot = cornerRotation(tile.tx, tile.ty);
      if (rot != null) {
        const im = img('utile-tunnel-corner');
        if (im) {
          ctx.save();
          ctx.translate(s.x + dw / 2, s.y + dw / 2);
          ctx.rotate(rot);
          ctx.drawImage(im, -dw / 2, -dw / 2, dw, dw);
          ctx.restore();
        }
      } else {
        drawImg(img(tile.kind === 'v' ? 'utile-tunnel-v' : 'utile-tunnel-h'), s.x, s.y, dw, dw);
      }
    }
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

  function drawBuildings(z, night, pass, view) {
    for (const b of game.state.buildings) {
      if (!showBuilding(b, view)) continue;
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

  function drawUnitLabel(u, z) {
    const label = game.unitLabel(u);
    if (!label) return;
    const s = worldToScreen(u.x, u.y);
    ctx.save();
    ctx.font = `600 ${Math.max(9, 10 * z)}px "IBM Plex Mono", ui-monospace, monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    const y = s.y - C.tileSize * z * 0.42;
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(8, 8, 10, 0.75)';
    ctx.strokeText(label, s.x, y);
    ctx.fillStyle = u.status === 'blocked' ? C.warningNotify : '#f2f0ec';
    ctx.fillText(label, s.x, y);
    ctx.restore();
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
    ctx.globalAlpha = 0.7;
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
    const n = g.type === 'vault' ? C.vaultFootprint : C.buildingFootprint;
    const s = worldToScreen(g.tx * C.tileSize, g.ty * C.tileSize);
    const dw = n * C.tileSize * z;
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

  function drawTunnelProgress(z) {
    for (const tile of game.state.tunnel.tiles) {
      const s = worldToScreen(tile.tx * C.tileSize, tile.ty * C.tileSize);
      const dw = C.tileSize * z;
      if (!tile.done) {
        ctx.save();
        ctx.globalAlpha = 0.35;
        ctx.strokeStyle = C.playerAccent;
        ctx.lineWidth = 1.5;
        ctx.setLineDash([4, 3]);
        ctx.strokeRect(s.x + 3, s.y + 3, dw - 6, dw - 6);
        ctx.restore();
      }
      if (tile.started && !tile.done) {
        const bw = dw * 0.72;
        const bh = Math.max(4, 5 * z);
        const bx = s.x + (dw - bw) / 2;
        const by = s.y + dw * 0.78;
        ctx.save();
        ctx.fillStyle = 'rgba(8, 8, 10, 0.7)';
        ctx.fillRect(bx - 1, by - 1, bw + 2, bh + 2);
        ctx.fillStyle = C.playerAccent;
        ctx.fillRect(bx, by, bw * Math.max(0, Math.min(1, tile.progress)), bh);
        ctx.restore();
      }
    }
  }

  function drawBoreFx(z) {
    const frame = Math.floor(game.state.time * 10) % 6;
    const im = img(`bore-${frame}`);
    if (!im) return;
    for (const tile of game.state.tunnel.tiles) {
      if (tile.done || !tile.started) continue;
      const s = worldToScreen((tile.tx + 0.5) * C.tileSize, (tile.ty + 0.5) * C.tileSize);
      const size = C.tileSize * z;
      ctx.drawImage(im, s.x - size / 2, s.y - size / 2, size, size);
    }
  }

  function drawPackets(z) {
    const tiles = game.state.tunnel.tiles;
    if (!tiles.length) return;
    for (const p of game.state.tunnel.packets) {
      const t = Math.max(0, Math.min(0.999, p.traveled / p.length));
      const idx = Math.min(tiles.length - 1, Math.floor(t * tiles.length));
      const frac = (t * tiles.length) - idx;
      const a = tiles[idx];
      const b = tiles[Math.min(tiles.length - 1, idx + 1)];
      const x = (a.tx + (b.tx - a.tx) * frac + 0.5) * C.tileSize;
      const y = (a.ty + (b.ty - a.ty) * frac + 0.5) * C.tileSize;
      const s = worldToScreen(x, y);
      ctx.save();
      ctx.fillStyle = '#E8F2F6';
      ctx.strokeStyle = C.playerAccent;
      ctx.lineWidth = Math.max(1, 1.2 * z);
      ctx.beginPath();
      ctx.arc(s.x, s.y, Math.max(3, 4 * z), 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    }
  }

  function drawExpedition(z) {
    const exp = game.state.expedition;
    const m = exp.marker;
    const c = worldToScreen((m.tx + 0.5) * C.tileSize, (m.ty + 0.5) * C.tileSize);
    const size = C.tileSize * z;
    const scoutImg = img('scout');
    if (scoutImg && exp.launched && !exp.ended && !exp.recalling) {
      ctx.save();
      ctx.globalAlpha = 0.95;
      ctx.drawImage(scoutImg, c.x - size / 2, c.y - size / 2, size, size);
      ctx.restore();
    }
    ctx.save();
    ctx.strokeStyle = '#E8F2F6';
    ctx.lineWidth = Math.max(1.5, 2 * z);
    ctx.beginPath();
    ctx.arc(c.x, c.y, size * 0.42, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
    drawEdgeBeacon(m.tx, m.ty, z);
  }

  function drawEdgeBeacon(tx, ty, z) {
    const { w, h } = viewSize();
    const wx = (tx + 0.5) * C.tileSize;
    const wy = (ty + 0.5) * C.tileSize;
    const s = worldToScreen(wx, wy);
    const pad = 18;
    const onScreen = s.x >= pad && s.x <= w - pad && s.y >= pad && s.y <= h - pad;
    let bx = s.x;
    let by = s.y;
    if (!onScreen) {
      bx = Math.max(pad, Math.min(w - pad, s.x));
      by = Math.max(pad, Math.min(h - pad, s.y));
    } else {
      // Keep a small mark on the nearer map edge even when the site is visible.
      const toRight = w - s.x;
      const toBottom = h - s.y;
      const nearest = Math.min(s.x, s.y, toRight, toBottom);
      if (nearest === s.x) bx = pad;
      else if (nearest === toRight) bx = w - pad;
      else if (nearest === s.y) by = pad;
      else by = h - pad;
    }
    const pulse = 0.65 + 0.35 * Math.sin(game.state.time * 4);
    ctx.save();
    ctx.fillStyle = '#E8F2F6';
    ctx.globalAlpha = pulse;
    ctx.beginPath();
    ctx.arc(bx, by, Math.max(4, 5 * z), 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = C.playerAccent;
    ctx.globalAlpha = 1;
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.restore();
  }

  function drawNotifyPings(z) {
    for (const p of game.state.expedition.activePings) {
      const s = worldToScreen((p.tx + 0.5) * C.tileSize, (p.ty + 0.5) * C.tileSize);
      const frame = Math.min(5, Math.max(0, Math.floor((p.age / 1.2) * 6)));
      const im = img(`notify-${frame}`) || img('icon-notify');
      const size = C.tileSize * 1.4 * z;
      if (im) ctx.drawImage(im, s.x - size / 2, s.y - size / 2, size, size);
      else {
        ctx.save();
        ctx.strokeStyle = C.warningNotify;
        ctx.globalAlpha = Math.max(0, 1 - p.age / 1.2);
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(s.x, s.y, (12 + p.age * 28) * z, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }
    }
  }

  function drawDeepIce(z) {
    const d = game.state.deepIce;
    if (!d.unlocked || d.tx == null) return;
    const s = worldToScreen((d.tx + 0.5) * C.tileSize, (d.ty + 0.5) * C.tileSize);
    const size = C.tileSize * z;
    ctx.save();
    ctx.strokeStyle = '#E8F2F6';
    ctx.lineWidth = Math.max(2, 2.4 * z);
    ctx.setLineDash([5, 4]);
    ctx.strokeRect(s.x - size / 2 + 3, s.y - size / 2 + 3, size - 6, size - 6);
    ctx.setLineDash([]);
    ctx.font = `600 ${Math.max(10, 11 * z)}px "IBM Plex Mono", ui-monospace, monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(8, 8, 10, 0.75)';
    ctx.strokeText('Deep Ice', s.x, s.y - size * 0.52);
    ctx.fillStyle = '#E8F2F6';
    ctx.fillText('Deep Ice', s.x, s.y - size * 0.52);
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

  function drawBackdrop(w, h) {
    ctx.fillStyle = '#2c261e';
    ctx.fillRect(0, 0, w, h);
    const sky = img('bg-horizon');
    const strip = Math.max(56, Math.min(110, Math.round(h * 0.12)));
    if (sky) {
      ctx.drawImage(sky, 0, 0, w, strip);
    } else {
      ctx.fillStyle = '#0c1016';
      ctx.fillRect(0, 0, w, strip);
    }
  }

  function draw() {
    const { w, h } = resize();
    ctx.clearRect(0, 0, w, h);
    drawBackdrop(w, h);
    const z = game.state.camera.zoom;
    const night = !game.isDay();
    const view = game.state.view === 'underground' ? 'underground' : 'surface';
    if (view === 'underground') drawUndergroundTiles(z);
    else drawSurfaceTiles(z);
    drawTunnelProgress(z);
    drawBoreFx(z);
    if (view === 'underground') drawPackets(z);
    drawBuildings(z, night, 'sprite', view);
    if (view === 'surface') {
      for (const u of game.state.units) drawUnit(u, z, night, 'sprite');
    }
    if (night) drawNightTint();
    drawBuildings(z, night, 'glow', view);
    if (view === 'surface') {
      for (const u of game.state.units) drawUnit(u, z, night, 'glow');
    }
    if (view === 'surface') drawCommandRange(z);
    if (view === 'surface') {
      for (const u of game.state.units) {
        if (game.state.selectedIds.includes(u.id)) drawSelection(u, z);
      }
      for (const u of game.state.units) drawUnitLabel(u, z);
      drawExpedition(z);
      drawDeepIce(z);
      drawNotifyPings(z);
    }
    drawOrderMarker(z);
    drawGhost(z);
    drawBox();
  }

  return { draw, resize, worldToScreen, screenToWorld, viewSize, centerOnHabitat };
}
