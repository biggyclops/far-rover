import { CONFIG as C } from './config.js';

function fmt(n) {
  return Math.floor(n + 1e-6).toString();
}

function clockLabel(game) {
  const t = game.solTime();
  const sol = Math.floor(game.state.time / C.solSecondsAt1x) + 1;
  const day = game.isDay();
  const remain = day ? C.daySecondsAt1x - t : C.solSecondsAt1x - t;
  const m = Math.floor(remain / 60);
  const s = Math.floor(remain % 60).toString().padStart(2, '0');
  return { sol, phase: day ? 'Day' : 'Night', remain: `${m}:${s}` };
}

export function bindHud(root, game, hooks = {}) {
  function $(sel) { return root.querySelector(sel); }

  function setArmed(kind) {
    game.state.armedOrder = kind;
    game.state.haulPick = null;
    game.state.buildGhost = null;
    refreshButtons();
  }

  function setBuild(type) {
    game.state.armedOrder = null;
    game.state.haulPick = null;
    game.state.buildGhost = { type, tx: C.habitatTileX + 4, ty: C.habitatTileY };
    refreshButtons();
  }

  $('#speed-pause')?.addEventListener('click', () => { game.state.speed = 0; });
  $('#speed-1')?.addEventListener('click', () => { game.state.speed = 1; });
  $('#speed-4')?.addEventListener('click', () => { game.state.speed = 4; });
  $('#speed-16')?.addEventListener('click', () => { game.state.speed = 16; });
  $('#order-mine')?.addEventListener('click', () => setArmed('mine'));
  $('#order-haul')?.addEventListener('click', () => setArmed('haul'));
  $('#order-charge')?.addEventListener('click', () => setArmed('charge'));
  $('#order-go')?.addEventListener('click', () => setArmed(null));
  $('#build-solar')?.addEventListener('click', () => setBuild('solar'));
  $('#build-storage')?.addEventListener('click', () => setBuild('storage'));
  $('#build-printer')?.addEventListener('click', () => setBuild('printer'));
  $('#print-hauler')?.addEventListener('click', () => { game.startPrint(); });
  $('#mute-btn')?.addEventListener('click', () => {
    game.state.muted = !game.state.muted;
    hooks.onMute?.(game.state.muted);
    refreshButtons();
  });

  function refreshButtons() {
    const speed = game.state.speed;
    for (const [id, val] of [['speed-pause', 0], ['speed-1', 1], ['speed-4', 4], ['speed-16', 16]]) {
      $('#' + id)?.classList.toggle('active', speed === val);
    }
    $('#mute-btn')?.classList.toggle('active', !!game.state.muted);
    $('#mute-btn') && ($('#mute-btn').textContent = game.state.muted ? 'Muted' : 'Mute');
    $('#order-mine')?.classList.toggle('active', game.state.armedOrder === 'mine');
    $('#order-haul')?.classList.toggle('active', game.state.armedOrder === 'haul');
    $('#order-charge')?.classList.toggle('active', game.state.armedOrder === 'charge');
    const ghost = game.state.buildGhost?.type;
    $('#build-solar')?.classList.toggle('active', ghost === 'solar');
    $('#build-storage')?.classList.toggle('active', ghost === 'storage');
    $('#build-printer')?.classList.toggle('active', ghost === 'printer');
  }

  function sync() {
    const tot = game.totals();
    const ice = $('#res-ice');
    const reg = $('#res-regolith');
    const pwr = $('#res-power');
    if (ice) ice.textContent = `${fmt(tot.ice)} / ${fmt(tot.iceCap)}`;
    if (reg) reg.textContent = `${fmt(tot.regolith)} / ${fmt(tot.regolithCap)}`;
    if (pwr) pwr.textContent = `${fmt(tot.power)} / ${fmt(tot.powerCap)}`;
    const clk = clockLabel(game);
    const clock = $('#sol-clock');
    if (clock) clock.textContent = `Sol ${clk.sol}  ${clk.phase}  ${clk.remain}`;
    const dn = $('#day-night');
    if (dn) {
      dn.textContent = clk.phase;
      dn.classList.toggle('night', clk.phase === 'Night');
    }
    const sel = game.selectedUnits();
    const info = $('#sel-info');
    if (info) {
      if (sel.length === 1) {
        const u = sel[0];
        info.textContent = `Hauler  bat ${fmt(u.battery)}  cargo ${fmt(u.cargo.ice + u.cargo.regolith)}/${C.haulerCarry}`;
      } else if (sel.length > 1) {
        info.textContent = `${sel.length} haulers`;
      } else if (game.state.selectedBuildingId) {
        const b = game.buildingById(game.state.selectedBuildingId);
        info.textContent = b ? `${b.type}${b.complete ? '' : `  building ${fmt(b.buildTime)}/${b.buildNeeded}s`}` : '';
      } else {
        info.textContent = 'Click a hauler · drag a box · right-click an order';
      }
    }
    refreshButtons();
  }

  return { sync };
}
