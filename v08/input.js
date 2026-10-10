import { CONFIG as C } from './config.js';

export function bindInput(canvas, game, renderer, hooks = {}) {
  const keys = new Set();
  let dragging = false;
  let box = false;
  let start = null;
  let panning = false;
  let panLast = null;

  function cssPos(ev) {
    const r = canvas.getBoundingClientRect();
    return { x: ev.clientX - r.left, y: ev.clientY - r.top };
  }

  function worldPos(ev) {
    const p = cssPos(ev);
    return renderer.screenToWorld(p.x, p.y);
  }

  canvas.addEventListener('contextmenu', (e) => e.preventDefault());

  canvas.addEventListener('pointerdown', (ev) => {
    canvas.setPointerCapture(ev.pointerId);
    const p = cssPos(ev);
    if (ev.button === 1 || ev.button === 2 && ev.altKey) {
      panning = true;
      panLast = p;
      return;
    }
    if (ev.button === 2) {
      const w = worldPos(ev);
      game.issueContextual(w.x, w.y);
      hooks.onOrder?.();
      return;
    }
    if (ev.button !== 0) return;
    if (game.state.buildGhost) {
      const w = worldPos(ev);
      const { tx, ty } = game.worldToTile(w.x, w.y);
      const b = game.placeBuilding(game.state.buildGhost.type, tx, ty, true);
      if (b) hooks.onOrder?.();
      return;
    }
    dragging = true;
    box = false;
    start = p;
  });

  canvas.addEventListener('pointermove', (ev) => {
    const p = cssPos(ev);
    if (panning && panLast) {
      const cam = game.state.camera;
      cam.x -= (p.x - panLast.x) / cam.zoom;
      cam.y -= (p.y - panLast.y) / cam.zoom;
      panLast = p;
      return;
    }
    if (game.state.buildGhost) {
      const w = renderer.screenToWorld(p.x, p.y);
      const t = game.worldToTile(w.x, w.y);
      game.state.buildGhost.tx = t.tx;
      game.state.buildGhost.ty = t.ty;
    }
    if (!dragging || !start) return;
    if (!box && Math.hypot(p.x - start.x, p.y - start.y) > 6) {
      box = true;
      game.state.boxSelect = { x0: start.x, y0: start.y, x1: p.x, y1: p.y };
    }
    if (box) {
      game.state.boxSelect.x1 = p.x;
      game.state.boxSelect.y1 = p.y;
    }
  });

  function finishSelect(ev) {
    const p = cssPos(ev);
    const additive = ev.shiftKey;
    if (box && game.state.boxSelect) {
      const b = game.state.boxSelect;
      const x0 = Math.min(b.x0, b.x1);
      const y0 = Math.min(b.y0, b.y1);
      const x1 = Math.max(b.x0, b.x1);
      const y1 = Math.max(b.y0, b.y1);
      const ids = [];
      for (const u of game.state.units) {
        const s = renderer.worldToScreen(u.x, u.y);
        if (s.x >= x0 && s.x <= x1 && s.y >= y0 && s.y <= y1) ids.push(u.id);
      }
      game.selectUnits(ids, additive);
      if (ids.length) hooks.onSelect?.();
      game.state.boxSelect = null;
    } else {
      const w = renderer.screenToWorld(p.x, p.y);
      const unit = game.unitAtWorld(w.x, w.y, C.unitClickRadius);
      if (unit) {
        game.selectUnits([unit.id], additive);
        hooks.onSelect?.();
      } else {
        const t = game.worldToTile(w.x, w.y);
        const bld = game.buildingAtTile(t.tx, t.ty);
        if (bld) game.selectBuilding(bld.id);
        else if (!additive) {
          game.selectUnits([]);
          game.selectBuilding(null);
        }
      }
    }
    dragging = false;
    box = false;
    start = null;
  }

  canvas.addEventListener('pointerup', (ev) => {
    if (panning && ev.button === 1) {
      panning = false;
      panLast = null;
      return;
    }
    if (ev.button === 0 && dragging) finishSelect(ev);
    panning = false;
    panLast = null;
  });

  canvas.addEventListener('wheel', (ev) => {
    ev.preventDefault();
    const cam = game.state.camera;
    const p = cssPos(ev);
    const before = renderer.screenToWorld(p.x, p.y);
    cam.zoom = Math.max(C.minZoom, Math.min(C.maxZoom, cam.zoom * (ev.deltaY > 0 ? 0.92 : 1.08)));
    const after = renderer.screenToWorld(p.x, p.y);
    cam.x += before.x - after.x;
    cam.y += before.y - after.y;
  }, { passive: false });

  window.addEventListener('keydown', (ev) => {
    keys.add(ev.key.toLowerCase());
    if (ev.code === 'Space') {
      ev.preventDefault();
      game.state.speed = game.state.speed === 0 ? 1 : 0;
    }
    if (ev.key === '1') game.state.speed = 1;
    if (ev.key === '4') game.state.speed = 4;
    if (ev.key === '6') game.state.speed = 16;
    if (ev.key === 'Tab') {
      ev.preventDefault();
      game.toggleView();
    }
    if (ev.key === 'Escape') {
      game.state.buildGhost = null;
      game.state.armedOrder = null;
      game.state.haulPick = null;
      game.state.digPick = null;
    }
  });
  window.addEventListener('keyup', (ev) => keys.delete(ev.key.toLowerCase()));

  function pumpPan(dt) {
    const cam = game.state.camera;
    const sp = 420 * dt / cam.zoom;
    if (keys.has('w') || keys.has('arrowup')) cam.y -= sp;
    if (keys.has('s') || keys.has('arrowdown')) cam.y += sp;
    if (keys.has('a') || keys.has('arrowleft')) cam.x -= sp;
    if (keys.has('d') || keys.has('arrowright')) cam.x += sp;
    const maxX = C.mapWidth * C.tileSize - 40;
    const maxY = C.mapHeight * C.tileSize - 40;
    cam.x = Math.max(-40, Math.min(maxX, cam.x));
    cam.y = Math.max(-40, Math.min(maxY, cam.y));
  }

  return { pumpPan };
}
