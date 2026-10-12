import { CONFIG as C } from './config.js';
import { TILE } from './game.js';
import { createRealism } from './realism.js';

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
  let realism = null;
  let autoCenterUntil = (typeof performance !== 'undefined' ? performance.now() : 0) + 600;

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

  realism = createRealism(assets, game, worldToScreen, viewSize);

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
    const usedPlate = realism?.drawPlate(ctx, z);
    const { x0, y0, x1, y1 } = visibleTileRange();
    for (let ty = y0; ty < y1; ty++) {
      for (let tx = x0; tx < x1; tx++) {
        const tile = game.tileAt(tx, ty);
        const s = worldToScreen(tx * C.tileSize, ty * C.tileSize);
        const dw = C.tileSize * z;
        if (!usedPlate) {
          drawImg(tileSprite(tile), s.x, s.y, dw, dw);
          continue;
        }
        if (tile.type === TILE.CRATER_S || tile.type === TILE.PIT) {
          ctx.save();
          ctx.globalAlpha = 0.55;
          drawImg(tileSprite(tile), s.x, s.y, dw, dw);
          ctx.restore();
        } else if (tile.type === TILE.ICE || tile.type === TILE.ICE_MINED) {
          ctx.save();
          ctx.fillStyle = tile.type === TILE.ICE ? 'rgba(6, 10, 16, 0.55)' : 'rgba(18, 16, 14, 0.4)';
          ctx.beginPath();
          ctx.arc(s.x + dw / 2, s.y + dw / 2, dw * 0.42, 0, Math.PI * 2);
          ctx.fill();
          ctx.restore();
          const glint = img('frost-glint');
          if (glint && tile.type === TILE.ICE) {
            ctx.save();
            ctx.globalAlpha = 0.9;
            ctx.drawImage(glint, s.x, s.y, dw, dw);
            ctx.restore();
          }
        }
      }
    }
    for (let ty = 0; ty < C.mapHeight; ty++) {
      for (let tx = 0; tx < C.mapWidth; tx++) {
        const tile = game.tileAt(tx, ty);
        if (!tile.craterMAnchor) continue;
        const s = worldToScreen(tx * C.tileSize, ty * C.tileSize);
        ctx.save();
        ctx.globalAlpha = usedPlate ? 0.5 : 1;
        drawImg(img('crater-m'), s.x, s.y, C.tileSize * 2 * z, C.tileSize * 2 * z);
        ctx.restore();
      }
    }
    if (usedPlate) {
      realism.drawDustApron(ctx, z);
      realism.drawTracks(ctx, z);
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
      if (pass === 'shadow') {
        realism?.drawBuildingShadow(ctx, b, z, night);
        continue;
      }
      if (pass === 'contact') {
        realism?.drawBuildingContact(ctx, b, z);
        continue;
      }
      if (pass === 'sprite') {
        if (realism?.drawBuildingSprite(ctx, b, z)) {
          /* relit, centred */
        } else {
          const key = (!b.complete && C.showBuildSpriteWhileConstructing) ? `${b.type}-build` : b.type;
          drawImg(img(key) || img(b.type), s.x, s.y, dw, dw);
        }
        if (!b.complete) {
          ctx.save();
          ctx.font = `600 ${Math.max(9, 10 * z)}px "IBM Plex Mono", ui-monospace, monospace`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'top';
          const label = 'Needs a hauler to build';
          const lx = s.x + dw / 2;
          const ly = s.y + dw + 2;
          ctx.lineWidth = 3;
          ctx.strokeStyle = 'rgba(8, 8, 10, 0.75)';
          ctx.strokeText(label, lx, ly);
          ctx.fillStyle = '#f2f0ec';
          ctx.fillText(label, lx, ly);
          ctx.restore();
        } else if ((b.type === 'storage' || b.type === 'vault') && game.buildingInCommandRange && !game.buildingInCommandRange(b)) {
          ctx.save();
          ctx.font = `600 ${Math.max(9, 10 * z)}px "IBM Plex Mono", ui-monospace, monospace`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'top';
          const label = "Out of range: doesn't count";
          const lx = s.x + dw / 2;
          const ly = s.y + dw + 2;
          ctx.lineWidth = 3;
          ctx.strokeStyle = 'rgba(8, 8, 10, 0.75)';
          ctx.strokeText(label, lx, ly);
          ctx.fillStyle = C.warningNotify;
          ctx.fillText(label, lx, ly);
          ctx.restore();
        }
      }
    }
  }

  function drawUnit(u, z, night, pass) {
    const s = worldToScreen(u.x, u.y);
    const size = C.tileSize * z;
    if (pass === 'glow') {
      if (night && C.nightGlowAdditive) drawGlow(s.x, s.y, size * 1.2, 'glow-unit', C.glowUnitIntensity);
      return;
    }
    if (pass === 'shadow') {
      realism?.drawUnitShadow(ctx, u, z, night);
      return;
    }
    if (pass === 'contact') {
      realism?.drawUnitContact(ctx, u, z);
      return;
    }
    if (realism) {
      realism.drawUnitBody(ctx, u, z);
      return;
    }
    const loaded = (u.cargo.ice + u.cargo.regolith) > 0.05;
    const body = u.kind === 'scout'
      ? img('scout')
      : (loaded ? img('hauler-loaded') : img('hauler'));
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
    const s = worldToScreen(u.x, u.y);
    if (label) {
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
    const low = u.kind === 'hauler' && u.battery <= C.haulerBattery * 0.2 + 1e-6;
    if (low) {
      const icon = img(u.battery <= 0 ? 'icon-power' : 'icon-power-orange') || img('icon-power');
      const size = 16 * Math.max(1, z);
      if (icon) ctx.drawImage(icon, s.x + C.tileSize * z * 0.16, s.y - C.tileSize * z * 0.52, size, size);
    }
  }

  function drawHaulRoutes(z) {
    ctx.save();
    ctx.strokeStyle = C.playerAccent;
    ctx.lineWidth = Math.max(1.5, 2 * z);
    ctx.setLineDash([7 * z, 5 * z]);
    ctx.globalAlpha = 0.88;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (const u of game.state.units) {
      if (u.kind !== 'hauler') continue;
      const o = (u.order && u.order.type === 'haul')
        ? u.order
        : (u.resumeOrder && u.resumeOrder.type === 'haul')
          ? u.resumeOrder
          : (u.lastOrder && u.lastOrder.type === 'haul' && u.order?.type === 'charge')
            ? u.lastOrder
            : null;
      if (!o || o.sourceTx == null) continue;
      const from = worldToScreen(u.x, u.y);
      const src = worldToScreen((o.sourceTx + 0.5) * C.tileSize, (o.sourceTy + 0.5) * C.tileSize);
      const dest = o.destBuildingId ? game.buildingById(o.destBuildingId) : null;
      ctx.beginPath();
      ctx.moveTo(from.x, from.y);
      ctx.lineTo(src.x, src.y);
      if (dest) {
        const n = dest.type === 'vault' ? 3 : 2;
        const ds = worldToScreen((dest.tx + n / 2) * C.tileSize, (dest.ty + n / 2) * C.tileSize);
        ctx.lineTo(ds.x, ds.y);
      }
      ctx.stroke();
    }
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
    const hab = game.habitat();
    if (!hab) return;
    const { w, h } = viewSize();
    const c = worldToScreen((hab.tx + 1) * C.tileSize, (hab.ty + 1) * C.tileSize);
    const r = C.commandRangeRadius * C.tileSize * z;
    const maxCorner = Math.hypot(Math.max(c.x, w - c.x), Math.max(c.y, h - c.y));
    ctx.save();
    ctx.strokeStyle = C.playerAccent;
    ctx.globalAlpha = 0.7;
    ctx.lineWidth = 1.5;
    ctx.setLineDash([7, 6]);
    ctx.beginPath();
    ctx.arc(c.x, c.y, r, 0, Math.PI * 2);
    ctx.stroke();
    if (r > maxCorner + 2) {
      const pad = 10;
      ctx.globalAlpha = 0.85;
      ctx.setLineDash([5, 5]);
      ctx.beginPath();
      ctx.moveTo(pad, pad);
      ctx.lineTo(w - pad, pad);
      ctx.lineTo(w - pad, h - pad);
      ctx.lineTo(pad, h - pad);
      ctx.closePath();
      ctx.stroke();
    }
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
    ctx.globalAlpha = 0.38;
    drawImg(img(`${g.type}-build`) || img(g.type), s.x, s.y, dw, dw);
    ctx.globalAlpha = 0.28;
    ctx.fillStyle = ok ? 'rgba(70, 190, 90, 0.55)' : 'rgba(200, 48, 48, 0.55)';
    ctx.fillRect(s.x, s.y, dw, dw);
    ctx.globalAlpha = 1;
    ctx.strokeStyle = ok ? '#3ecf64' : '#e04848';
    ctx.lineWidth = 3;
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
    if (scoutImg && exp.launched && !exp.recalling) {
      ctx.save();
      ctx.globalAlpha = exp.ended ? 0.7 : 0.95;
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
    if (exp.launched) {
      const label = exp.scoutStatus === 'lost'
        ? 'Scout: Lost'
        : exp.scoutStatus === 'returned' || exp.scoutStatus === 'stuck'
          ? 'Scout: Returned'
          : 'Scout: Running';
      ctx.save();
      ctx.fillStyle = '#E8F2F6';
      ctx.font = `${Math.max(10, 11 * z)}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.fillText(label, c.x, c.y + size * 0.62);
      ctx.restore();
    }
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

  function drawIceMarkers() {
    const steps = game.objectiveProgress();
    const hintOn = game.showIceHint();
    const d = game.state.deepIce;
    const pulseFrame = Math.floor((game.state.time * 10) % 6);
    const ring = img(`pulse-ring-${pulseFrame}`);
    const marker = img('ice-marker');
    const marks = [
      { tx: C.shallowIceTileX, ty: C.shallowIceTileY, pulse: hintOn || !steps.mineShallow },
    ];
    if (d.unlocked && d.tx != null) {
      const age = d.foundAt == null ? 99 : game.state.time - d.foundAt;
      marks.push({ tx: d.tx, ty: d.ty, pulse: age < 6 || !steps.haulDeep, deep: true });
    }
    for (const m of marks) {
      const tile = game.tileAt(m.tx, m.ty);
      if (!tile || (tile.type !== TILE.ICE && tile.type !== TILE.ICE_MINED)) continue;
      const s = worldToScreen((m.tx + 0.5) * C.tileSize, (m.ty + 0.5) * C.tileSize);
      if (m.pulse && ring) ctx.drawImage(ring, s.x - 64, s.y - 64, 128, 128);
      if (marker) ctx.drawImage(marker, s.x - 32, s.y - 62, 64, 64);
      if (m.deep) {
        ctx.save();
        ctx.font = '600 11px "IBM Plex Mono", ui-monospace, monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'bottom';
        ctx.lineWidth = 3;
        ctx.strokeStyle = 'rgba(8, 8, 10, 0.75)';
        ctx.strokeText('Deep Ice', s.x, s.y - 64);
        ctx.fillStyle = '#E8F2F6';
        ctx.fillText('Deep Ice', s.x, s.y - 64);
        ctx.restore();
      }
    }
  }

  function hudSafeInsets() {
    const { w, h } = viewSize();
    return {
      left: Math.min(380, Math.max(24, w * 0.28)),
      right: 28,
      top: Math.min(140, Math.max(96, h * 0.16)),
      bottom: 86,
    };
  }

  function cameraDestForTile(tx, ty) {
    const { w, h } = viewSize();
    const z = game.state.camera.zoom || 1;
    const pad = hudSafeInsets();
    const playW = Math.max(160, w - pad.left - pad.right);
    const playH = Math.max(160, h - pad.top - pad.bottom);
    const wx = (tx + 0.5) * C.tileSize;
    const wy = (ty + 0.5) * C.tileSize;
    return {
      x: wx - (pad.left + playW / 2) / z,
      y: wy - (pad.top + playH / 2) / z,
    };
  }

  function focusTile(tx, ty) {
    const dest = cameraDestForTile(tx, ty);
    game.state.camera.x = dest.x;
    game.state.camera.y = dest.y;
    game.state.camera.userMoved = true;
    game.state.camPan = { tx, ty, t: 1.2 };
    return dest;
  }

  function tickCamPan(dt) {
    const pan = game.state.camPan;
    if (!pan || dt <= 0) return;
    const dest = cameraDestForTile(pan.tx, pan.ty);
    const k = 1 - Math.exp(-dt * 4);
    game.state.camera.x += (dest.x - game.state.camera.x) * k;
    game.state.camera.y += (dest.y - game.state.camera.y) * k;
    pan.t -= dt;
    if (pan.t <= 0) {
      game.state.camera.x = dest.x;
      game.state.camera.y = dest.y;
      game.state.camPan = null;
    }
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
    if (w < 8 || h < 8) return;
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
    const now = typeof performance !== 'undefined' ? performance.now() : 0;
    if (now < autoCenterUntil && !game.state.camera.userMoved && !game.state.camPan) centerOnHabitat();
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
    if (view === 'surface') {
      drawBuildings(z, night, 'shadow', view);
      for (const u of game.state.units) drawUnit(u, z, night, 'shadow');
      drawBuildings(z, night, 'contact', view);
      for (const u of game.state.units) drawUnit(u, z, night, 'contact');
    }
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
      drawHaulRoutes(z);
      for (const u of game.state.units) drawUnitLabel(u, z);
      drawExpedition(z);
      drawIceMarkers();
      drawNotifyPings(z);
    }
    drawOrderMarker(z);
    drawGhost(z);
    drawBox();
  }

    return {
    draw,
    recordTracks: (dt) => realism?.recordTracks(dt),
    resize,
    worldToScreen,
    screenToWorld,
    viewSize,
    centerOnHabitat,
    tickCamPan,
    focusTile,
    cameraDestForTile,
    hudSafeInsets,
  };
}
