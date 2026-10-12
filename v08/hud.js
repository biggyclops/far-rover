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
    game.state.digPick = null;
    game.state.buildGhost = null;
    refreshButtons();
  }

  function setBuild(type) {
    game.state.armedOrder = null;
    game.state.haulPick = null;
    game.state.digPick = null;
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
  $('#order-dig')?.addEventListener('click', () => setArmed('dig'));
  $('#order-go')?.addEventListener('click', () => setArmed(null));
  $('#build-solar')?.addEventListener('click', () => setBuild('solar'));
  $('#build-storage')?.addEventListener('click', () => setBuild('storage'));
  $('#build-printer')?.addEventListener('click', () => setBuild('printer'));
  $('#build-hub')?.addEventListener('click', () => setBuild('tunnel-hub'));
  $('#build-vault')?.addEventListener('click', () => setBuild('vault'));
  $('#print-hauler')?.addEventListener('click', () => { game.startPrint(); });

  function costLabel(type) {
    const spec = game.buildCost(type);
    if (!spec) return '';
    const bits = [];
    if (spec.reg) bits.push(`${spec.reg} reg`);
    if (spec.power) bits.push(`${spec.power} pwr`);
    if (spec.time) bits.push(`${spec.time}s`);
    return bits.join(' · ');
  }

  function applyCostLabels() {
    const map = [
      ['#build-solar', 'Rim solar', 'solar'],
      ['#build-storage', 'Storage', 'storage'],
      ['#build-printer', 'Printer', 'printer'],
      ['#build-hub', 'Tunnel hub', 'tunnel-hub'],
      ['#build-vault', 'Vault', 'vault'],
      ['#print-hauler', 'Print hauler', 'hauler'],
    ];
    for (const [sel, title, type] of map) {
      const el = $(sel);
      if (!el) continue;
      el.innerHTML = `${title} <small>${costLabel(type)}</small>`;
    }
  }
  applyCostLabels();
  $('#view-toggle')?.addEventListener('click', () => { game.toggleView(); refreshButtons(); });
  $('#mute-btn')?.addEventListener('click', () => {
    game.state.muted = !game.state.muted;
    hooks.onMute?.(game.state.muted);
    refreshButtons();
  });
  $('#btn-build-scout')?.addEventListener('click', () => { hooks.onBuildScout?.(); });
  $('#btn-recall')?.addEventListener('click', () => { hooks.onRecall?.(); });
  $('#btn-land-crew')?.addEventListener('click', () => { hooks.onLandCrew?.(); });
  $('#btn-play-again')?.addEventListener('click', () => { window.location.reload(); });
  $('#exp-view-trace')?.addEventListener('click', () => { hooks.onViewTrace?.(); });
  const aboutBtn = $('#about-btn');
  const aboutPanel = $('#about-panel');
  aboutBtn?.addEventListener('click', () => {
    if (aboutPanel) aboutPanel.hidden = !aboutPanel.hidden;
  });
  $('#about-close')?.addEventListener('click', () => {
    if (aboutPanel) aboutPanel.hidden = true;
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
    $('#order-dig')?.classList.toggle('active', game.state.armedOrder === 'dig');
    const ghost = game.state.buildGhost?.type;
    $('#build-solar')?.classList.toggle('active', ghost === 'solar');
    $('#build-storage')?.classList.toggle('active', ghost === 'storage');
    $('#build-printer')?.classList.toggle('active', ghost === 'printer');
    $('#build-hub')?.classList.toggle('active', ghost === 'tunnel-hub');
    $('#build-vault')?.classList.toggle('active', ghost === 'vault');
    const viewBtn = $('#view-toggle');
    if (viewBtn) {
      const under = game.state.view === 'underground';
      viewBtn.classList.toggle('active', under);
      viewBtn.textContent = under ? 'Surface' : 'Underground';
    }
  }

  function syncAfford() {
    const map = [
      ['#build-solar', 'solar'],
      ['#build-storage', 'storage'],
      ['#build-printer', 'printer'],
      ['#build-hub', 'tunnel-hub'],
      ['#build-vault', 'vault'],
      ['#print-hauler', 'hauler'],
    ];
    for (const [sel, type] of map) {
      const el = $(sel);
      if (!el) continue;
      const reason = game.affordReason(type);
      el.classList.toggle('unaffordable', !!reason);
      el.title = reason || '';
      el.disabled = type === 'hauler' && reason === 'Need an idle printer';
    }
  }

  function sync() {
    const tot = game.totals();
    const goal = game.storedForGoal();
    const transit = game.transitIce();
    const ice = $('#res-ice');
    const reg = $('#res-regolith');
    const pwr = $('#res-power');
    if (ice) ice.textContent = `${fmt(goal.ice)} / ${fmt(goal.iceCap)}`;
    if (reg) reg.textContent = `${fmt(tot.regolith)} / ${fmt(tot.regolithCap)}`;
    if (pwr) pwr.textContent = `${fmt(tot.power)} / ${fmt(tot.powerCap)}`;
    const tr = $('#res-transit');
    if (tr) tr.textContent = `Hubs + transit ${fmt(transit.ice)}`;
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
    const card = $('#unit-card');
    const prompt = game.state.orderPrompt || (
      game.state.armedOrder === 'haul' ? 'Armed Haul — click a resource'
        : game.state.armedOrder === 'mine' ? 'Armed Mine — click a resource'
          : game.state.armedOrder === 'dig' ? 'Armed Dig — click the tunnel'
            : game.state.armedOrder === 'charge' ? 'Armed Charge — click a charger'
              : ''
    );
    if (info) {
      if (prompt) {
        info.textContent = prompt;
      } else if (sel.length === 1) {
        const u = sel[0];
        const kind = u.kind === 'scout' ? 'Scout' : 'Hauler';
        info.textContent = `${kind}  bat ${fmt(u.battery)}  cargo ${fmt(u.cargo.ice + u.cargo.regolith)}/${C.haulerCarry}`;
      } else if (sel.length > 1) {
        info.textContent = `${sel.length} haulers`;
      } else if (game.state.selectedBuildingId) {
        const b = game.buildingById(game.state.selectedBuildingId);
        info.textContent = b ? `${b.type}${b.complete ? '' : `  building ${fmt(b.buildTime)}/${b.buildNeeded}s`}` : '';
      } else {
        info.textContent = 'Click a hauler · drag a box · right-click an order · Tab toggles underground';
      }
    }
    const shown = sel[0] || (game.state.hoverUnitId ? game.unitById(game.state.hoverUnitId) : null);
    if (card) {
      const data = shown ? game.unitCard(shown) : null;
      card.hidden = !data;
      if (data) {
        card.innerHTML = `<strong>${data.kind}</strong> · bat ${fmt(data.battery)} · cargo ${fmt(data.cargo)}/${data.carry} · ${data.task}`;
      }
    }
    const toast = $('#toast');
    const toastOn = !!(game.state.toast?.text);
    if (toast) {
      const msg = game.state.toast?.text || '';
      const kind = game.state.toast?.kind || '';
      const key = `${kind}|${msg}`;
      if (toast.dataset.key !== key) {
        toast.dataset.key = key;
        toast.replaceChildren();
        if (msg) toast.append(document.createTextNode(msg));
        if (kind === 'scout-result') {
          const btn = document.createElement('button');
          btn.type = 'button';
          btn.textContent = 'View trace';
          btn.addEventListener('click', () => hooks.onViewTrace?.());
          toast.append(btn);
        }
      }
      toast.classList.toggle('show', toastOn);
      toast.classList.toggle('ice-confirm', kind === 'ice-confirm');
      toast.classList.toggle('trace-ice', kind === 'trace-ice');
      toast.classList.toggle('has-action', kind === 'scout-result');
    }
    const banner = $('#goal-banner');
    if (banner) {
      banner.textContent = game.goalBanner();
      banner.hidden = toastOn && game.state.toast?.kind !== 'scout-result';
    }
    const deficit = $('#power-alert');
    if (deficit) {
      const on = game.powerDeficit();
      deficit.hidden = !on;
      deficit.textContent = 'Power deficit: build solar';
    }
    syncExpeditionPanel();
    syncAfford();
    const exp = game.state.expedition;
    const buildScout = $('#btn-build-scout');
    const hintOn = game.showIceHint();
    const scoutHint = game.showScoutHint();
    if (buildScout) {
      const show = game.canBuildScout();
      buildScout.hidden = !show;
      buildScout.classList.toggle('hint-pulse', scoutHint && show);
    }
    const iceHint = $('#ice-hint');
    if (iceHint) {
      const text = game.iceHintText();
      const bannerDup = banner && !banner.hidden && banner.textContent === text;
      iceHint.hidden = !hintOn || bannerDup;
      iceHint.textContent = text;
    }
    const arrow = $('#scout-hint-arrow');
    if (arrow) {
      arrow.hidden = !scoutHint || !buildScout || buildScout.hidden;
      if (!arrow.hidden && buildScout) {
        const frame = Math.floor((game.state.time * 7) % 4);
        const next = `../assets/v08/art/hint-arrow-${frame}.png`;
        if (arrow.getAttribute('src') !== next) arrow.src = next;
        const r = buildScout.getBoundingClientRect();
        arrow.style.left = `${r.left + r.width / 2 - 32}px`;
        arrow.style.top = `${r.top - 55}px`;
      }
    }
    const tip = $('#ice-tooltip');
    const hover = game.state.hoverTile;
    const tipText = hover ? game.iceHoverText(hover.tx, hover.ty) : '';
    if (tip) {
      tip.hidden = !tipText;
      tip.textContent = tipText;
      if (tipText && hover) {
        tip.style.left = `${hover.sx + 14}px`;
        tip.style.top = `${hover.sy + 12}px`;
      }
    }
    const steps = game.objectiveProgress();
    const order = ['mineShallow', 'buildScout', 'haulDeep', 'landCrew'];
    let current = order.find((key) => !steps[key]) || null;
    for (const key of order) {
      const li = root.querySelector(`#objectives [data-step="${key}"]`);
      if (!li) continue;
      const done = !!steps[key];
      li.classList.toggle('done', done);
      li.classList.toggle('active', key === current);
      const icon = li.querySelector('.step-icon');
      if (icon) {
        const name = done ? 'check' : key === current ? 'step-dot-active' : 'step-dot';
        const src = `../assets/v08/art/${name}.png`;
        if (icon.getAttribute('src') !== src) icon.src = src;
      }
    }
    const recall = $('#btn-recall');
    if (recall) {
      const ok = game.canRecall();
      recall.hidden = !ok;
      recall.disabled = !ok;
    }
    const land = $('#btn-land-crew');
    if (land) land.hidden = !game.canLandCrew();
    const badge = $('#patch-badge');
    if (badge) badge.hidden = !exp.pendingPatch;
    const left = $('#patches-left');
    if (left) left.textContent = game.patchesLabel();
    const log = $('#expedition-log');
    if (log) {
      const last = exp.log[exp.log.length - 1];
      log.textContent = last ? last.text : '';
      log.classList.toggle('ice-confirm', last?.kind === 'ice-confirm');
      log.classList.toggle('trace-ice', last?.kind === 'trace-ice');
    }
    const win = $('#win-overlay');
    if (win) {
      win.hidden = !game.state.won;
      if (game.state.won && game.state.win) {
        const w = game.state.win;
        const m = Math.floor(w.time / 60);
        const s = Math.floor(w.time % 60).toString().padStart(2, '0');
        const timeEl = $('#win-time');
        const logi = $('#win-logistics');
        const notes = $('#win-notifies');
        const patches = $('#win-patches');
        if (timeEl) timeEl.textContent = `Time  ${m}:${s}`;
        if (logi) logi.textContent = `Logistics  ${w.logistics}`;
        if (notes) notes.textContent = `Notifies  ${w.notifies}`;
        if (patches) patches.textContent = w.patchesLabel || game.patchesLabel();
        const iceEl = $('#win-ice');
        const pwrEl = $('#win-power');
        if (iceEl) iceEl.textContent = `Ice  ${Math.floor(w.ice + 1e-6)} / ${Math.floor((w.iceCap || 0) + 1e-6)}`;
        if (pwrEl) pwrEl.textContent = `Power  ${Math.floor(w.power + 1e-6)} / ${Math.floor((w.powerCap || 0) + 1e-6)}`;
      }
    }
    refreshButtons();
  }

  function statusLabel(status) {
    if (status === 'lost') return 'Lost';
    if (status === 'stuck') return 'Stuck';
    if (status === 'returned') return 'Returned';
    if (status === 'running') return 'Running';
    return 'Scout';
  }

  function syncExpeditionPanel() {
    const panel = $('#expedition-panel');
    if (!panel) return;
    const exp = game.state.expedition;
    const show = !!(exp.launched);
    panel.hidden = !show;
    if (!show) return;
    const status = $('#exp-status');
    if (status) status.textContent = `Scout: ${statusLabel(exp.scoutStatus)}`;
    const log = $('#exp-log');
    if (log) {
      const lines = (exp.log || []).slice(-10);
      log.replaceChildren();
      for (const row of lines) {
        const li = document.createElement('li');
        li.textContent = row.text;
        if (row.kind) li.dataset.kind = row.kind;
        log.append(li);
      }
    }
    drawExpeditionMini(exp.paper);
  }

  function drawExpeditionMini(paper) {
    const canvas = $('#exp-minimap');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const w = canvas.width;
    const h = canvas.height;
    ctx.fillStyle = '#101216';
    ctx.fillRect(0, 0, w, h);
    const cols = 12;
    const rows = 13;
    const tw = w / cols;
    const th = h / rows;
    const revealed = new Set((paper?.revealed || []).map((p) => `${p.col},${p.row}`));
    ctx.fillStyle = '#2a3038';
    for (const key of revealed) {
      const [c, r] = key.split(',').map(Number);
      ctx.fillRect(c * tw, r * th, tw - 1, th - 1);
    }
    ctx.strokeStyle = C.playerAccent;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    const path = paper?.path || [];
    path.forEach((p, i) => {
      const x = (p.col + 0.5) * tw;
      const y = (p.row + 0.5) * th;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    if (path.length) ctx.stroke();
    ctx.fillStyle = C.warningNotify;
    for (const p of paper?.pings || []) {
      ctx.beginPath();
      ctx.arc((p.col + 0.5) * tw, (p.row + 0.5) * th, 3, 0, Math.PI * 2);
      ctx.fill();
    }
    if (path.length) {
      const last = path[path.length - 1];
      ctx.fillStyle = '#E8F2F6';
      ctx.beginPath();
      ctx.arc((last.col + 0.5) * tw, (last.row + 0.5) * th, 3.5, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  return { sync };
}
