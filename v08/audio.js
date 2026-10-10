import { CONFIG } from './config.js';

export function createAudio(sfxUrls) {
  const audio = {
    ctx: null,
    unlocked: false,
    muted: false,
    buffers: Object.create(null),
    urls: sfxUrls,
    digSource: null,
    digGain: null,
    pending: [],
  };

  async function ensureCtx() {
    if (!audio.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      audio.ctx = new AC();
    }
    if (audio.ctx.state === 'suspended') {
      try { await audio.ctx.resume(); } catch { /* autoplay lock */ }
    }
    return audio.ctx;
  }

  async function decodeNamed(name) {
    if (audio.buffers[name]) return audio.buffers[name];
    const urls = audio.urls[name];
    if (!urls) return null;
    const ctx = await ensureCtx();
    if (!ctx) return null;
    const preferOgg = name === CONFIG.sfxDigLoop && CONFIG.digLoopPreferOgg;
    const order = preferOgg ? [urls.ogg, urls.mp3] : [urls.ogg, urls.mp3];
    for (const url of order) {
      if (!url) continue;
      try {
        const res = await fetch(url);
        if (!res.ok) continue;
        const arr = await res.arrayBuffer();
        const buf = await ctx.decodeAudioData(arr.slice(0));
        audio.buffers[name] = buf;
        return buf;
      } catch {
        // try the next container
      }
    }
    return null;
  }

  async function unlock() {
    if (audio.unlocked) return;
    const ctx = await ensureCtx();
    if (!ctx) return;
    audio.unlocked = true;
    await Promise.all(Object.keys(audio.urls).map((name) => decodeNamed(name)));
    for (const name of audio.pending) play(name);
    audio.pending.length = 0;
  }

  function play(name) {
    if (audio.muted) return;
    if (!audio.unlocked) {
      audio.pending.push(name);
      return;
    }
    const buf = audio.buffers[name];
    if (!buf || !audio.ctx) return;
    // Pixel set the levels — connect straight to the destination, no extra gain.
    const src = audio.ctx.createBufferSource();
    src.buffer = buf;
    src.connect(audio.ctx.destination);
    src.start();
  }

  function setDigLoop(active) {
    // M2: gapless boring loop. Wired now; M1 never passes true.
    if (!CONFIG.digLoopUseWebAudioBuffer) return;
    if (!active) {
      if (audio.digSource) {
        const gain = audio.digGain;
        const src = audio.digSource;
        audio.digSource = null;
        audio.digGain = null;
        if (gain && audio.ctx) {
          const now = audio.ctx.currentTime;
          gain.gain.setValueAtTime(gain.gain.value, now);
          gain.gain.linearRampToValueAtTime(0, now + CONFIG.digLoopFadeMs / 1000);
          src.stop(now + CONFIG.digLoopFadeMs / 1000 + 0.02);
        } else if (src) {
          try { src.stop(); } catch { /* already stopped */ }
        }
      }
      return;
    }
    if (audio.muted || !audio.unlocked || audio.digSource) return;
    const buf = audio.buffers[CONFIG.sfxDigLoop];
    if (!buf || !audio.ctx) return;
    const src = audio.ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    const gain = audio.ctx.createGain();
    gain.gain.value = 1;
    src.connect(gain);
    gain.connect(audio.ctx.destination);
    src.start();
    audio.digSource = src;
    audio.digGain = gain;
  }

  function setMuted(muted) {
    audio.muted = !!muted;
    if (audio.muted) setDigLoop(false);
  }

  function bindGestures(el) {
    const once = () => { unlock(); };
    el.addEventListener('pointerdown', once, { once: true });
    el.addEventListener('keydown', once, { once: true });
  }

  return { unlock, play, setDigLoop, setMuted, bindGestures, get unlocked() { return audio.unlocked; }, get muted() { return audio.muted; } };
}
