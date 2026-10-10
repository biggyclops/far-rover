import { CONFIG } from './config.js';

const MANIFEST_URL = new URL('../assets/v08/manifest.json', import.meta.url);

function resolveRepoPath(rel) {
  return new URL('../' + rel, import.meta.url).href;
}

function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return { canvas: c, ctx: c.getContext('2d') };
}

function placeholderImage(name, w, h) {
  const { canvas, ctx } = makeCanvas(w, h);
  ctx.clearRect(0, 0, w, h);
  if (name.startsWith('tile-ground')) {
    ctx.fillStyle = '#a8a094';
    ctx.fillRect(0, 0, w, h);
  } else if (name === 'tile-ice') {
    ctx.fillStyle = '#c8e4f0';
    ctx.fillRect(0, 0, w, h);
  } else if (name === 'tile-ice-mined') {
    ctx.fillStyle = '#8a8e92';
    ctx.fillRect(0, 0, w, h);
  } else if (name.includes('crater') || name === 'tile-pit') {
    ctx.fillStyle = '#4a4540';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#2a2622';
    ctx.beginPath();
    ctx.arc(w * 0.5, h * 0.55, w * 0.32, 0, Math.PI * 2);
    ctx.fill();
  } else if (name === 'ring-select') {
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.arc(w / 2, h / 2, w * 0.38, 0, Math.PI * 2);
    ctx.stroke();
  } else if (name.startsWith('glow-')) {
    const g = ctx.createRadialGradient(w / 2, h / 2, 2, w / 2, h / 2, w * 0.48);
    g.addColorStop(0, 'rgba(255,186,90,0.85)');
    g.addColorStop(1, 'rgba(255,186,90,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  } else if (name.startsWith('icon-')) {
    ctx.fillStyle = name.includes('notify') ? CONFIG.warningNotify : '#f0e8e0';
    ctx.beginPath();
    ctx.arc(w / 2, h / 2, w * 0.28, 0, Math.PI * 2);
    ctx.fill();
  } else {
    ctx.fillStyle = name.includes('build') ? '#8a7a60' : '#c4c0b8';
    ctx.fillRect(w * 0.15, h * 0.15, w * 0.7, h * 0.7);
  }
  return canvas;
}

async function loadImage(entry, name) {
  const img = new Image();
  img.decoding = 'async';
  const url = resolveRepoPath(entry.file);
  try {
    await new Promise((resolve, reject) => {
      img.onload = resolve;
      img.onerror = reject;
      img.src = url;
    });
    return img;
  } catch {
    return placeholderImage(name, entry.w, entry.h);
  }
}

export async function loadAssets() {
  const res = await fetch(MANIFEST_URL);
  const manifest = await res.json();
  const images = {};
  await Promise.all(Object.entries(manifest.images).map(async ([name, entry]) => {
    images[name] = await loadImage(entry, name);
  }));
  const sfx = {};
  for (const [name, entry] of Object.entries(manifest.sfx)) {
    sfx[name] = {
      ogg: entry.ogg ? resolveRepoPath(entry.ogg) : null,
      mp3: entry.mp3 ? resolveRepoPath(entry.mp3) : null,
    };
  }
  return { images, sfx, manifest };
}

export function getImage(assets, name) {
  return assets.images[name] || null;
}
