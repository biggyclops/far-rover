// Tiny PNG writer (no deps). Grouped bar chart of win times.

import { deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const t = Buffer.from(type);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([t, data])));
  return Buffer.concat([len, t, data, crc]);
}

function encodePng(width, height, rgba) {
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0;
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  return Buffer.concat([
    sig,
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function fill(img, w, x0, y0, x1, y1, r, g, b, a = 255) {
  const xa = Math.max(0, Math.floor(x0));
  const ya = Math.max(0, Math.floor(y0));
  const xb = Math.min(w, Math.ceil(x1));
  const yb = Math.min(img.length / (w * 4), Math.ceil(y1));
  for (let y = ya; y < yb; y++) {
    for (let x = xa; x < xb; x++) {
      const i = (y * w + x) * 4;
      img[i] = r;
      img[i + 1] = g;
      img[i + 2] = b;
      img[i + 3] = a;
    }
  }
}

// 5x7 glyphs for labels. 1 = ink.
const FONT = {
  ' ': [],
  '0': [0b01110, 0b10001, 0b10011, 0b10101, 0b11001, 0b10001, 0b01110],
  '1': [0b00100, 0b01100, 0b00100, 0b00100, 0b00100, 0b00100, 0b01110],
  '2': [0b01110, 0b10001, 0b00001, 0b00010, 0b00100, 0b01000, 0b11111],
  '3': [0b01110, 0b10001, 0b00001, 0b00110, 0b00001, 0b10001, 0b01110],
  '4': [0b00010, 0b00110, 0b01010, 0b10010, 0b11111, 0b00010, 0b00010],
  '5': [0b11111, 0b10000, 0b11110, 0b00001, 0b00001, 0b10001, 0b01110],
  '6': [0b01110, 0b10000, 0b11110, 0b10001, 0b10001, 0b10001, 0b01110],
  '7': [0b11111, 0b00001, 0b00010, 0b00100, 0b01000, 0b01000, 0b01000],
  '8': [0b01110, 0b10001, 0b10001, 0b01110, 0b10001, 0b10001, 0b01110],
  '9': [0b01110, 0b10001, 0b10001, 0b01111, 0b00001, 0b00001, 0b01110],
  ':': [0b00000, 0b00100, 0b00100, 0b00000, 0b00100, 0b00100, 0b00000],
  '.': [0b00000, 0b00000, 0b00000, 0b00000, 0b00000, 0b00100, 0b00100],
  '-': [0b00000, 0b00000, 0b00000, 0b01110, 0b00000, 0b00000, 0b00000],
  '%': [0b11001, 0b11010, 0b00010, 0b00100, 0b01000, 0b01011, 0b10011],
  '+': [0b00000, 0b00100, 0b00100, 0b11111, 0b00100, 0b00100, 0b00000],
  '/': [0b00001, 0b00010, 0b00010, 0b00100, 0b01000, 0b01000, 0b10000],
  '(': [0b00100, 0b01000, 0b01000, 0b01000, 0b01000, 0b01000, 0b00100],
  ')': [0b00100, 0b00010, 0b00010, 0b00010, 0b00010, 0b00010, 0b00100],
  A: [0b01110, 0b10001, 0b10001, 0b11111, 0b10001, 0b10001, 0b10001],
  B: [0b11110, 0b10001, 0b10001, 0b11110, 0b10001, 0b10001, 0b11110],
  C: [0b01110, 0b10001, 0b10000, 0b10000, 0b10000, 0b10001, 0b01110],
  D: [0b11110, 0b10001, 0b10001, 0b10001, 0b10001, 0b10001, 0b11110],
  E: [0b11111, 0b10000, 0b10000, 0b11110, 0b10000, 0b10000, 0b11111],
  F: [0b11111, 0b10000, 0b10000, 0b11110, 0b10000, 0b10000, 0b10000],
  G: [0b01110, 0b10001, 0b10000, 0b10111, 0b10001, 0b10001, 0b01110],
  H: [0b10001, 0b10001, 0b10001, 0b11111, 0b10001, 0b10001, 0b10001],
  I: [0b01110, 0b00100, 0b00100, 0b00100, 0b00100, 0b00100, 0b01110],
  J: [0b00111, 0b00010, 0b00010, 0b00010, 0b00010, 0b10010, 0b01100],
  K: [0b10001, 0b10010, 0b10100, 0b11000, 0b10100, 0b10010, 0b10001],
  L: [0b10000, 0b10000, 0b10000, 0b10000, 0b10000, 0b10000, 0b11111],
  M: [0b10001, 0b11011, 0b10101, 0b10101, 0b10001, 0b10001, 0b10001],
  N: [0b10001, 0b11001, 0b10101, 0b10011, 0b10001, 0b10001, 0b10001],
  O: [0b01110, 0b10001, 0b10001, 0b10001, 0b10001, 0b10001, 0b01110],
  P: [0b11110, 0b10001, 0b10001, 0b11110, 0b10000, 0b10000, 0b10000],
  R: [0b11110, 0b10001, 0b10001, 0b11110, 0b10100, 0b10010, 0b10001],
  S: [0b01110, 0b10001, 0b10000, 0b01110, 0b00001, 0b10001, 0b01110],
  T: [0b11111, 0b00100, 0b00100, 0b00100, 0b00100, 0b00100, 0b00100],
  U: [0b10001, 0b10001, 0b10001, 0b10001, 0b10001, 0b10001, 0b01110],
  V: [0b10001, 0b10001, 0b10001, 0b10001, 0b10001, 0b01010, 0b00100],
  W: [0b10001, 0b10001, 0b10001, 0b10101, 0b10101, 0b10101, 0b01010],
  X: [0b10001, 0b10001, 0b01010, 0b00100, 0b01010, 0b10001, 0b10001],
  Y: [0b10001, 0b10001, 0b01010, 0b00100, 0b00100, 0b00100, 0b00100],
  Q: [0b01110, 0b10001, 0b10001, 0b10001, 0b10101, 0b10010, 0b01101],
};

function drawText(img, w, x, y, text, scale, r, g, b) {
  let cx = x;
  for (const ch of text.toUpperCase()) {
    const glyph = FONT[ch] || FONT[ch.toUpperCase()] || [];
    for (let row = 0; row < 7; row++) {
      const bits = glyph[row] || 0;
      for (let col = 0; col < 5; col++) {
        if (bits & (1 << (4 - col))) {
          fill(img, w, cx + col * scale, y + row * scale, cx + (col + 1) * scale, y + (row + 1) * scale, r, g, b);
        }
      }
    }
    cx += 6 * scale;
  }
}

const PALETTE = [
  [255, 138, 31],
  [232, 168, 72],
  [210, 120, 40],
  [63, 216, 255],
  [40, 160, 200],
  [180, 200, 210],
];

export function renderChart(summaries, { width = 1280, height = 640 } = {}) {
  const img = Buffer.alloc(width * height * 4);
  fill(img, width, 0, 0, width, height, 16, 18, 24);
  const padL = 70;
  const padR = 36;
  const padT = 70;
  const padB = 120;
  const plotW = width - padL - padR;
  const plotH = height - padT - padB;

  drawText(img, width, 24, 18, 'Far Rover v0.8 — win time by strategy', 3, 255, 236, 210);
  drawText(img, width, 24, 44, 'Lower is faster. Night starts at 4:00 on the current sol.', 2, 170, 176, 186);

  const series = summaries[0]?.results?.map((r) => r.label) || [];
  const groups = summaries;
  const maxT = Math.max(10 * 60, ...groups.flatMap((s) => s.results.map((r) => r.winTime || 0)), 1);
  const niceMax = Math.ceil(maxT / 60) * 60;

  const gW = plotW / Math.max(groups.length, 1);
  const barW = Math.max(8, (gW - 28) / Math.max(series.length, 1) - 4);

  for (let i = 0; i <= 5; i++) {
    const y = padT + plotH - (i / 5) * plotH;
    fill(img, width, padL, y, width - padR, y + 1, 42, 48, 58);
    const label = `${Math.round((niceMax * i) / 5 / 60)}m`;
    drawText(img, width, 16, y - 8, label, 2, 140, 148, 158);
  }

  const nightY = padT + plotH - (Math.min(4 * 60, niceMax) / niceMax) * plotH;
  fill(img, width, padL, nightY, width - padR, nightY + 2, 90, 100, 160);
  drawText(img, width, width - padR - 90, nightY - 16, 'night 4:00', 2, 120, 140, 200);

  groups.forEach((s, gi) => {
    const gx = padL + gi * gW;
    s.results.forEach((r, ri) => {
      const t = r.won ? r.winTime : niceMax;
      const h = (t / niceMax) * plotH;
      const x = gx + 14 + ri * (barW + 4);
      const col = PALETTE[ri % PALETTE.length];
      const alphaFade = r.won ? 1 : 0.35;
      fill(
        img, width, x, padT + plotH - h, x + barW, padT + plotH,
        Math.round(col[0] * alphaFade + 16 * (1 - alphaFade)),
        Math.round(col[1] * alphaFade + 18 * (1 - alphaFade)),
        Math.round(col[2] * alphaFade + 24 * (1 - alphaFade)),
      );
    });
    const name = (s.chartName || s.name || s.id || '').replace(/—/g, '-').slice(0, 28);
    drawText(img, width, gx + 8, padT + plotH + 16, name, 2, 220, 214, 200);
  });

  series.forEach((label, i) => {
    const x = 24 + (i % 3) * 400;
    const y = height - 52 + Math.floor(i / 3) * 22;
    const col = PALETTE[i % PALETTE.length];
    fill(img, width, x, y, x + 14, y + 10, col[0], col[1], col[2]);
    drawText(img, width, x + 20, y - 2, label, 2, 210, 210, 214);
  });

  return encodePng(width, height, img);
}

export function writeChartPng(summaries, dest) {
  writeFileSync(dest, renderChart(summaries));
  return dest;
}
