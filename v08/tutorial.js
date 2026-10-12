import { CONFIG as C } from './config.js';

export const INTRO_KEY = 'far-rover-v08-intro';

export const TUTORIAL_STARTER = [
  { condition: { type: 'crater_in_front' }, action: { type: 'sidestep' } },
  { condition: { type: 'battery_below', n: 12 }, action: { type: 'return_charge' } },
  { condition: { type: 'on_ore' }, action: { type: 'notify' } },
  { condition: { type: 'always' }, action: { type: 'explore' } },
];

export const TUTORIAL_TRY_THIS = [
  { condition: { type: 'crater_in_front' }, action: { type: 'sidestep' } },
  { condition: { type: 'battery_below', n: 6 }, action: { type: 'return_charge' } },
  { condition: { type: 'on_ore' }, action: { type: 'notify' } },
  { condition: { type: 'always' }, action: { type: 'explore' } },
];

const STEP_TEXT = {
  1: "You're commanding a new base at the Moon's south pole. Your goal: land your first new crew member. That takes 180 ice and 50 power in storage.",
  2: 'Drag a box around your two haulers to select them.',
  3: 'Right-click the ice. Your haulers will mine it and carry it home on their own, over and over.',
  4: 'Time moves slowly up here. Press 4x to speed things up. You can pause any time with Space.',
  5: 'Your habitat only holds 30 ice. Click Storage, then click near the habitat to place it.',
  6: "New buildings need a hauler to build them. Select a hauler and right-click the frame. It'll go back to hauling when it's done.",
  7: 'Buildings cost regolith (the grey number up top). When you run low, right-click open ground away from your buildings to mine more. Digging tunnels gives you regolith too.',
  8: "The ice near your base is shallow and won't be enough. Somewhere beyond your range is a big deposit. You can't drive out there yourself, so you send a scout that runs a program. Click Build Scout.",
  9: "Your scout follows a list of rules. Every turn it checks them top to bottom and does the first one that's true. This starter program dodges craters, heads home to charge when the battery is low, pings you when it's standing on ice, and otherwise explores.",
  10: 'Launch it and watch what happens.',
  11: "It came home with only trace ice. Look at the trace: it turned back when the battery fell below 12, before it reached the big deposits up top. That's the threshold to change.",
  12: "Change 'Battery below 12' to 'Battery below 6' so it goes farther, then Relaunch.",
  13: "Deep Ice found! It's far out on rough ground, where haulers drive at half speed. You can haul it the long way, or dig a tunnel.",
  14: 'Place a Tunnel hub at the edge of your range facing the ice, and a second hub next to the ice. They must line up in a straight row or column.',
  15: 'Select both haulers, click Dig, then click the two hubs. Two diggers go twice as fast, and every tile gives regolith.',
  16: "When the tunnel's done, send haulers to mine Deep Ice and drop it at the far hub. It reaches home 4x faster than driving.",
  17: "You've got it, commander. Finish the job: 180 ice and 50 power, then Land crew. Tip: build solar before night, and print more haulers when you can afford them.",
};

const ACTION_STEPS = new Set([2, 3, 4, 5, 6, 8, 10, 12, 14, 15, 16]);
const PAUSED_STEPS = new Set([1, 7, 9, 11, 13, 17]);

function haulers(game) {
  return game.state.units.filter((u) => u.kind === 'hauler');
}

function selectedHaulers(game) {
  const ids = new Set(game.state.selectedIds);
  return haulers(game).filter((u) => ids.has(u.id));
}

function storages(game) {
  return game.state.buildings.filter((b) => b.type === 'storage');
}

function hubs(game) {
  return game.state.buildings.filter((b) => b.type === 'tunnel-hub');
}

function inHaulLoop(unit) {
  return unit.order?.type === 'haul' || unit.lastOrder?.type === 'haul' || unit.resumeOrder?.type === 'haul';
}

export function bindTutorial(root, ctx) {
  const { game, scout, renderer, canvas } = ctx;
  const chooser = root.querySelector('#tutorial-chooser');
  const card = root.querySelector('#tutorial-card');
  const textEl = root.querySelector('#tutorial-text');
  const nextBtn = root.querySelector('#tutorial-next');
  const showBtn = root.querySelector('#tutorial-show');
  const tryBtn = root.querySelector('#tutorial-try');
  const skipBtn = root.querySelector('#tutorial-skip');
  const rings = root.querySelector('#tutorial-rings');
  const failEl = root.querySelector('#tutorial-fail');

  let mode = 'boot';
  let step = 1;
  let nextClicked = new Set();
  let delivered = false;
  let packetHome = false;
  let relaunchFails = 0;
  let rulePulse = 0;
  let glowEls = [];

  function remember(choice) {
    try { localStorage.setItem(INTRO_KEY, choice); } catch { /* ignore */ }
  }

  function active() {
    return mode === 'tutorial';
  }

  function clearGlow() {
    for (const el of glowEls) el.classList.remove('tutorial-glow', 'hint-pulse');
    glowEls = [];
    root.querySelectorAll('.tutorial-rule-on').forEach((el) => el.classList.remove('tutorial-rule-on'));
    root.querySelectorAll('.tutorial-trace-on').forEach((el) => el.classList.remove('tutorial-trace-on'));
  }

  function glow(el, pulse = true) {
    if (!el) return;
    el.classList.add('tutorial-glow');
    if (pulse) el.classList.add('hint-pulse');
    glowEls.push(el);
  }

  function suggestStorage() {
    const hx = C.habitatTileX;
    const hy = C.habitatTileY;
    const spots = [
      { tx: hx + 3, ty: hy },
      { tx: hx + 2, ty: hy + 2 },
      { tx: hx - 2, ty: hy },
      { tx: hx, ty: hy + 3 },
      { tx: 22, ty: 21 },
      { tx: 21, ty: 18 },
    ];
    for (let r = 1; r <= 8; r++) {
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
          spots.push({ tx: hx + dx, ty: hy + dy });
        }
      }
    }
    return spots.find((p) => game.canPlace('storage', p.tx, p.ty)) || null;
  }

  function suggestHubs() {
    const ice = game.state.deepIce;
    const presets = [
      { home: { tx: 22, ty: 9 }, far: { tx: 34, ty: 8 } },
      { home: { tx: 22, ty: 8 }, far: { tx: 34, ty: 8 } },
      { home: { tx: 21, ty: 9 }, far: { tx: 35, ty: 8 } },
      { home: { tx: 23, ty: 9 }, far: { tx: 34, ty: 9 } },
    ];
    for (const p of presets) {
      if (game.canPlace('tunnel-hub', p.home.tx, p.home.ty) && game.canPlace('tunnel-hub', p.far.tx, p.far.ty)) {
        return p;
      }
    }
    if (!ice?.unlocked) return presets[0];
    for (let hy = 0; hy < C.mapHeight - 1; hy++) {
      for (let hx = 0; hx < C.mapWidth - 1; hx++) {
        if (!game.canPlace('tunnel-hub', hx, hy)) continue;
        if (!game.inCommandRange(hx + 1, hy + 1)) continue;
        const far = [
          { tx: ice.tx - 2, ty: hy },
          { tx: ice.tx - 2, ty: ice.ty + 1 },
          { tx: ice.tx - 2, ty: ice.ty },
        ];
        for (const f of far) {
          if (f.tx === hx) continue;
          if (game.canPlace('tunnel-hub', f.tx, hy) || game.canPlace('tunnel-hub', f.tx, f.ty)) {
            const fy = game.canPlace('tunnel-hub', f.tx, hy) ? hy : f.ty;
            if (game.canPlace('tunnel-hub', f.tx, fy)) return { home: { tx: hx, ty: hy }, far: { tx: f.tx, ty: fy } };
          }
        }
      }
    }
    return presets[0];
  }

  function screenOf(wx, wy) {
    const s = renderer.worldToScreen(wx, wy);
    const r = canvas.getBoundingClientRect();
    return { x: r.left + s.x, y: r.top + s.y };
  }

  function tileScreen(tx, ty) {
    const c = game.tileCenter(tx, ty);
    return screenOf(c.x, c.y);
  }

  function stepDone(n) {
    if (n === 1) return nextClicked.has(1);
    if (n === 2) return selectedHaulers(game).length >= 2;
    if (n === 3) {
      const loops = haulers(game).filter(inHaulLoop);
      return loops.length >= 2 && delivered;
    }
    if (n === 4) return game.state.speed >= 4 || nextClicked.has(4);
    if (n === 5) return storages(game).length > 0;
    if (n === 6) return storages(game).some((b) => b.complete);
    if (n === 7) return nextClicked.has(7);
    if (n === 8) return !!(scout.isOpen() && root.querySelector('.build-screen'));
    if (n === 9) return nextClicked.has(9);
    if (n === 10) return !!game.state.expedition.ended;
    if (n === 11) return nextClicked.has(11);
    if (n === 12) return !!(game.state.deepIce.unlocked || scout.getSim()?.iceConfirmed);
    if (n === 13) return nextClicked.has(13);
    if (n === 14) return hubs(game).length >= 2;
    if (n === 15) return !!(game.isDigging() || game.state.tunnel.tiles.some((t) => t.started || t.done || t.progress > 0));
    if (n === 16) return !!(packetHome || game.state.stats.usedTunnel);
    if (n === 17) return nextClicked.has(17);
    return false;
  }

  function laterActionDone(from) {
    for (let i = from + 1; i <= 16; i++) {
      if (ACTION_STEPS.has(i) && stepDone(i)) return true;
    }
    return false;
  }

  function maybeAdvance() {
    if (mode !== 'tutorial') return;
    let guard = 0;
    while (step <= 17 && guard++ < 20) {
      if (stepDone(step) || (PAUSED_STEPS.has(step) && laterActionDone(step))) {
        if (step === 17 && nextClicked.has(17)) {
          finish();
          return;
        }
        step += 1;
        onEnterStep();
        continue;
      }
      break;
    }
    renderCard();
  }

  function onEnterStep() {
    clearGlow();
    if (mode !== 'tutorial') return;
    if (PAUSED_STEPS.has(step)) game.state.speed = 0;
    else if (game.state.speed < 1) game.state.speed = 1;

    if (step === 9) {
      scout.openBuild();
      rulePulse = 0;
    }
    if (step === 10) {
      scout.openBuild();
    }
    if (step === 11) {
      scout.openTrace();
      queueMicrotask(() => scout.highlightFirstBatteryTick());
    }
    if (step === 12) {
      scout.openBuild();
    }
    if (step === 13) {
      const ice = game.state.deepIce;
      if (ice?.unlocked) renderer.focusTile(ice.tx, ice.ty);
    }
    if (step === 17) {
      game.state.speed = 1;
    }
  }

  function applyHighlights() {
    clearGlow();
    if (mode !== 'tutorial') return;
    if (step === 3) { /* ice ring */ }
    if (step === 4) glow(root.querySelector('#speed-4'));
    if (step === 5) glow(root.querySelector('#build-storage'));
    if (step === 8) glow(root.querySelector('#btn-build-scout'));
    if (step === 9) {
      const slots = root.querySelectorAll('.rule-slot');
      const i = Math.floor(rulePulse / 1.15) % Math.max(slots.length, 1);
      slots[i]?.classList.add('tutorial-rule-on');
    }
    if (step === 10) glow(root.querySelector('#launch-btn'));
    if (step === 12) glow(root.querySelector('.battery-n'));
    if (step === 14) glow(root.querySelector('#build-hub'));
    if (step === 15) glow(root.querySelector('#order-dig'));
    if (step === 11) scout.highlightFirstBatteryTick();
  }

  function paintRings() {
    if (!rings) return;
    rings.replaceChildren();
    if (mode !== 'tutorial') return;
    const add = (pos, cls = '') => {
      if (!pos) return;
      const d = document.createElement('div');
      d.className = `tutorial-ring ${cls}`.trim();
      d.style.left = `${pos.x}px`;
      d.style.top = `${pos.y}px`;
      rings.append(d);
    };
    if (step === 2) {
      for (const u of haulers(game)) add(screenOf(u.x, u.y), 'on-unit');
    }
    if (step === 3) add(tileScreen(C.shallowIceTileX, C.shallowIceTileY), 'on-ice');
    if (step === 5) {
      const spot = suggestStorage();
      if (spot) add(tileScreen(spot.tx, spot.ty), 'on-spot');
    }
    if (step === 6) {
      const frame = storages(game).find((b) => !b.complete) || storages(game)[0];
      if (frame) add(tileScreen(frame.tx, frame.ty), 'on-spot');
    }
    if (step === 13 || step === 16) {
      const ice = game.state.deepIce;
      if (ice?.unlocked) add(tileScreen(ice.tx, ice.ty), 'on-ice');
    }
    if (step === 14) {
      const plan = suggestHubs();
      if (plan) {
        add(tileScreen(plan.home.tx, plan.home.ty), 'on-spot');
        add(tileScreen(plan.far.tx, plan.far.ty), 'on-spot');
      }
    }
    if (step === 15) {
      for (const h of hubs(game)) add(tileScreen(h.tx, h.ty), 'on-spot');
    }
  }

  function renderCard() {
    if (!card) return;
    const showChooser = mode === 'chooser';
    if (chooser) chooser.hidden = !showChooser;
    const on = mode === 'tutorial' && step >= 1 && step <= 17;
    card.hidden = !on;
    card.dataset.step = String(step);
    if (!on) {
      clearGlow();
      if (rings) rings.replaceChildren();
      return;
    }
    if (textEl) textEl.textContent = STEP_TEXT[step] || '';
    const isText = PAUSED_STEPS.has(step);
    const isAction = ACTION_STEPS.has(step);
    if (nextBtn) {
      nextBtn.hidden = !(isText || step === 4);
      nextBtn.textContent = step === 17 ? 'Close' : 'Next';
    }
    if (showBtn) showBtn.hidden = !isAction;
    const showTry = step === 12 && relaunchFails >= 2 && !stepDone(12);
    if (tryBtn) tryBtn.hidden = !showTry;
    if (failEl) {
      failEl.hidden = !(step === 12 && relaunchFails > 0 && !stepDone(12));
      if (!failEl.hidden) {
        failEl.textContent = game.state.expedition.resultLine || scout.explainResult(scout.getSim()) || '';
      }
    }
    applyHighlights();
    paintRings();
  }

  function startPlay() {
    mode = 'play';
    step = 0;
    game.state.speed = 1;
    scout.hideOverlay();
    renderCard();
  }

  function startTutorial() {
    mode = 'tutorial';
    step = 1;
    nextClicked = new Set();
    delivered = false;
    packetHome = false;
    relaunchFails = 0;
    game.state.speed = 0;
    onEnterStep();
    renderCard();
  }

  function finish() {
    mode = 'play';
    step = 0;
    if (game.state.speed === 0) game.state.speed = 1;
    scout.hideOverlay();
    clearGlow();
    renderCard();
  }

  function skip() {
    remember('play');
    finish();
  }

  function clickNext() {
    if (mode !== 'tutorial') return;
    nextClicked.add(step);
    if (step === 17) {
      finish();
      return;
    }
    maybeAdvance();
  }

  function launchProgram(rules) {
    scout.loadProgram(rules);
    const btn = root.querySelector('#launch-btn');
    if (btn) btn.click();
    else scout.launchProgram(['distance', 'spectral', 'camera'], rules);
  }

  function afterBuild(fn) {
    Promise.resolve(scout.openBuild()).then(() => {
      fn();
      maybeAdvance();
    });
  }

  function showMe() {
    if (mode !== 'tutorial') return;
    if (step === 2) {
      game.selectUnits(haulers(game).map((u) => u.id));
    } else if (step === 3) {
      const units = selectedHaulers(game).length >= 2 ? selectedHaulers(game) : haulers(game);
      game.selectUnits(units.map((u) => u.id));
      game.commandHaulTile(units, C.shallowIceTileX, C.shallowIceTileY);
    } else if (step === 4) {
      game.state.speed = 4;
    } else if (step === 5) {
      const spot = suggestStorage();
      if (spot) game.placeBuilding('storage', spot.tx, spot.ty, false);
    } else if (step === 6) {
      const frame = storages(game).find((b) => !b.complete) || storages(game)[0];
      const unit = haulers(game)[0];
      if (frame && unit) {
        game.selectUnits([unit.id]);
        game.assignOrder([unit], { type: 'build', buildingId: frame.id }, game.tileCenter(frame.tx, frame.ty));
      }
    } else if (step === 8) {
      afterBuild(() => {});
      return;
    } else if (step === 10) {
      afterBuild(() => launchProgram(TUTORIAL_STARTER));
      return;
    } else if (step === 12) {
      afterBuild(() => launchProgram(TUTORIAL_TRY_THIS));
      return;
    } else if (step === 14) {
      const plan = suggestHubs();
      if (plan) {
        if (hubs(game).length < 1) game.placeBuilding('tunnel-hub', plan.home.tx, plan.home.ty, false);
        if (hubs(game).length < 2) game.placeBuilding('tunnel-hub', plan.far.tx, plan.far.ty, false);
      }
    } else if (step === 15) {
      const pair = hubs(game);
      game.selectUnits(haulers(game).map((u) => u.id));
      game.state.armedOrder = 'dig';
      if (pair.length >= 2) {
        const a = game.tileCenter(pair[0].tx, pair[0].ty);
        game.issueContextual(a.x, a.y);
      } else {
        game.startDigCorridor();
      }
    } else if (step === 16) {
      for (const h of hubs(game)) {
        if (!h.complete) game.completeBuilding(h.id);
      }
      if (!game.tunnelReady()) game.markTunnelDone();
      const ice = game.state.deepIce;
      if (ice?.unlocked) {
        const units = haulers(game);
        game.selectUnits(units.map((u) => u.id));
        game.commandHaulTile(units, ice.tx, ice.ty);
      }
    }
    maybeAdvance();
  }

  function tryThis() {
    afterBuild(() => launchProgram(TUTORIAL_TRY_THIS));
  }

  function onEvent(ev) {
    if (mode !== 'tutorial') return;
    if (ev.type === 'delivery' && ev.ice > 0) delivered = true;
    if (ev.type === 'packet-home' && ev.ice > 0) packetHome = true;
    if (ev.type === 'expedition-ended' && step === 12 && !stepDone(12)) {
      relaunchFails += 1;
    }
    maybeAdvance();
  }

  function tick(dt) {
    if (mode !== 'tutorial') return;
    if (step === 9) {
      rulePulse += dt;
      applyHighlights();
    }
    paintRings();
    if (ACTION_STEPS.has(step)) maybeAdvance();
  }

  function sync() {
    renderCard();
  }

  nextBtn?.addEventListener('click', (ev) => { ev.preventDefault(); clickNext(); });
  showBtn?.addEventListener('click', (ev) => { ev.preventDefault(); showMe(); });
  tryBtn?.addEventListener('click', (ev) => { ev.preventDefault(); tryThis(); });
  skipBtn?.addEventListener('click', (ev) => { ev.preventDefault(); skip(); });
  root.querySelector('#chooser-tutorial')?.addEventListener('click', () => {
    remember('tutorial');
    startTutorial();
  });
  root.querySelector('#chooser-play')?.addEventListener('click', () => {
    remember('play');
    startPlay();
  });
  root.querySelector('#btn-tutorial')?.addEventListener('click', () => {
    startTutorial();
  });

  function boot() {
    const params = new URLSearchParams(location.search);
    const forceTutorial = params.has('tutorial');
    const forceChooser = params.has('intro');
    const debug = params.has('debug');
    let seen = null;
    try { seen = localStorage.getItem(INTRO_KEY); } catch { seen = null; }
    if (forceTutorial) {
      startTutorial();
      return;
    }
    if (forceChooser || (!debug && !seen)) {
      mode = 'chooser';
      game.state.speed = 0;
      renderCard();
      return;
    }
    startPlay();
  }

  boot();

  return {
    active,
    getStep: () => (mode === 'tutorial' ? step : 0),
    getMode: () => mode,
    startTutorial,
    startPlay,
    skip,
    showMe,
    tryThis,
    clickNext,
    onEvent,
    tick,
    sync,
    stepDone,
    suggestStorage,
    suggestHubs,
    jump(n) {
      mode = 'tutorial';
      step = n;
      onEnterStep();
      renderCard();
    },
  };
}
