#!/usr/bin/env python3
"""Bake orbital-ops art from NASA public-domain photos.

Terrain: NASA/JPL-Caltech/UArizona HiRISE PIA23289.
Rover cam: NASA/JPL-Caltech/ASU/MSSS Mastcam-Z PIA23727.

Processing matches make_concept.py (denoise, percentile stretch, local
contrast, tan tint, landing blast, boulder dots) then warps the photo
so game crater tiles sit on real HiRISE bowls.
"""
from __future__ import annotations

import json
import math
from pathlib import Path

import cv2
import numpy as np
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[1]
SRC_HIRISE = Path('/home/ubuntu/.cursor/projects/workspace/uploads/PIA23289_c793.jpg')
SRC_CAM = Path('/home/ubuntu/.cursor/projects/workspace/uploads/cam_PIA23727_f27c.jpg')
OUT = ROOT / 'assets' / 'art'
OUT.mkdir(parents=True, exist_ok=True)

TILE_PX = 80
ORIGIN_COL, ORIGIN_ROW = -2.0, -2.0
TEX_COLS, TEX_ROWS = 16, 17
LANDER_COL, LANDER_ROW = 5.0, 12.0
PHOTO_LANDER = np.array([620.0, 1180.0], np.float64)
PHOTO_TILE = 96.0

# Game crater tiles -> HiRISE bowl centres (photo px) from make_concept.py
CRATER_WARP = {
    'F8': (5, 7, 544.0, 660.0),
    'C10': (2, 9, 350.0, 912.0),
}

SUN = np.array([1.0, 0.35], np.float64)
SUN /= np.linalg.norm(SUN)
rng = np.random.default_rng(7)


def fractal(h, w, base, octaves=5, persist=0.55, seed=0):
    r = np.random.default_rng(seed)
    acc = np.zeros((h, w), np.float32)
    amp = 1.0
    tot = 0.0
    for o in range(octaves):
        cell = max(2, base / (2 ** o))
        gh, gw = int(h / cell) + 3, int(w / cell) + 3
        g = r.standard_normal((gh, gw)).astype(np.float32)
        up = cv2.resize(g, (int(gw * cell), int(gh * cell)), interpolation=cv2.INTER_CUBIC)[:h, :w]
        acc += amp * up
        tot += amp
        amp *= persist
    acc /= tot
    acc /= (acc.std() + 1e-6)
    return acc


def process_photo(src_bgr):
    print('process HiRISE', src_bgr.shape, flush=True)
    WH, WW = src_bgr.shape[:2]
    L = cv2.cvtColor(src_bgr, cv2.COLOR_BGR2GRAY)
    L = cv2.fastNlMeansDenoising(L, None, h=6, templateWindowSize=7, searchWindowSize=21)
    L = L.astype(np.float32) / 255
    lo, hi = np.percentile(L, [0.2, 99.85])
    L = np.clip((L - lo) / (hi - lo), 0, 1)
    base = cv2.GaussianBlur(L, (0, 0), 40)
    L = np.clip(base + (L - base) * 1.35, 0, 1)
    L = cv2.GaussianBlur(L, (0, 0), 0.55)
    L = 0.10 + 0.84 * L ** 1.05

    yy, xx = np.mgrid[0:WH, 0:WW].astype(np.float32)
    r = np.hypot(xx - PHOTO_LANDER[0], yy - PHOTO_LANDER[1])
    ang = np.arctan2(yy - PHOTO_LANDER[1], xx - PHOTO_LANDER[0])
    streak = 0.6 + 0.4 * np.sin(ang * 23 + 1.3) * np.sin(ang * 9 + 0.4)
    bn = fractal(WH, WW, 40, 4, seed=3)
    blast = np.exp(-(r / (95 + 25 * bn)) ** 2) * (0.7 + 0.3 * streak)
    L = L * (1 - 0.22 * blast)

    craters = [
        (350, 912, 110), (1158, 1281, 60), (1825, 1193, 55), (842, 1474, 55),
        (790, 1677, 60), (316, 1712, 55), (1712, 1502, 50), (1474, 814, 45),
        (790, 642, 40), (544, 660, 35),
    ]
    dens = np.full((WH // 8 + 1, WW // 8 + 1), 0.15, np.float32)
    gy, gx = np.mgrid[0:dens.shape[0], 0:dens.shape[1]] * 8
    for cx, cy, cr in craters:
        rr = np.hypot(gx - cx, gy - cy)
        dens += 2.2 * np.exp(-((rr - cr * 1.25) / (cr * 0.55)) ** 2)
    dens *= np.clip(
        1 + 0.6 * cv2.resize(
            fractal(WH // 8 + 1, WW // 8 + 1, 12, 3, seed=11),
            (dens.shape[1], dens.shape[0]),
        ),
        0.2, 2,
    )
    p = (dens / dens.sum()).ravel()
    nb = 1100
    idx = rng.choice(p.size, nb, p=p)
    by = (idx // dens.shape[1]) * 8 + rng.uniform(0, 8, nb)
    bx = (idx % dens.shape[1]) * 8 + rng.uniform(0, 8, nb)
    bs = np.clip(rng.lognormal(-0.1, 0.45, nb), 0.6, 3.2)
    shade = np.zeros((WH, WW), np.float32)
    lit = np.zeros_like(shade)
    sh = 16
    for x, y, s in zip(bx, by, bs):
        cv2.ellipse(
            shade,
            (int((x + SUN[0] * s * 0.9) * sh), int((y + SUN[1] * s * 0.9) * sh)),
            (int(s * 1.2 * sh), int(s * 0.75 * sh)),
            math.degrees(math.atan2(SUN[1], SUN[0])),
            0, 360, 1.0, -1, cv2.LINE_AA, 4,
        )
        cv2.circle(
            lit,
            (int((x - 0.25 * s) * sh), int((y - 0.1 * s) * sh)),
            int(s * 0.55 * sh), 1.0, -1, cv2.LINE_AA, 4,
        )
    shade = cv2.GaussianBlur(shade, (0, 0), 0.6)
    lit = cv2.GaussianBlur(lit, (0, 0), 0.5)
    L = L * (1 - 0.38 * np.clip(shade, 0, 1)) + 0.14 * np.clip(lit, 0, 1) * (1 - L * 0.5)
    L = np.clip(L, 0, 1)
    return L


def tint(lum):
    r_ = lum ** 0.92 * 0.98 + 0.02
    g_ = lum ** 1.0 * 0.86 + 0.015
    b_ = lum ** 1.10 * 0.74 + 0.01
    t_ = np.dstack([b_, g_, r_])
    g3 = np.dstack([lum, lum, lum]) * 0.93
    return (g3 * 0.35 + t_ * 0.65).astype(np.float32)


def affine_photo(col, row):
    return np.array([
        PHOTO_LANDER[0] + (col - LANDER_COL) * PHOTO_TILE,
        PHOTO_LANDER[1] + (row - LANDER_ROW) * PHOTO_TILE,
    ], np.float64)


def warp_maps(h, w):
    """Output pixel -> photo px, pulling crater tiles onto real bowls."""
    xs = (np.arange(w, dtype=np.float64) + 0.5) / TILE_PX + ORIGIN_COL
    ys = (np.arange(h, dtype=np.float64) + 0.5) / TILE_PX + ORIGIN_ROW
    col, row = np.meshgrid(xs, ys)
    px = PHOTO_LANDER[0] + (col - LANDER_COL) * PHOTO_TILE
    py = PHOTO_LANDER[1] + (row - LANDER_ROW) * PHOTO_TILE
    sigma = 1.35
    for _name, (c, r, tx, ty) in CRATER_WARP.items():
        src = affine_photo(c, r)
        dx = tx - src[0]
        dy = ty - src[1]
        d2 = (col - c) ** 2 + (row - r) ** 2
        wt = np.exp(-d2 / (2 * sigma * sigma))
        px += dx * wt
        py += dy * wt
    return px.astype(np.float32), py.astype(np.float32)


def remap_bgr(img, mx, my):
    return cv2.remap(img, mx, my, interpolation=cv2.INTER_CUBIC, borderMode=cv2.BORDER_REFLECT)


def make_rover(px=46):
    S = 12
    w = h = int(px * 1.5 * S)
    im = Image.new('RGBA', (w, h), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    cx, cy = w / 2, h / 2
    Lr = px * S * 0.92
    Wd = px * S * 0.62
    wl, ww = Lr * 0.17, Wd * 0.17
    for fx in (-0.36, 0.0, 0.36):
        for sy in (-1, 1):
            x0 = cx + fx * Lr - wl / 2
            y0 = cy + sy * (Wd / 2 + ww * 0.15) - ww / 2
            d.rounded_rectangle([x0, y0, x0 + wl, y0 + ww], radius=ww * 0.35, fill=(38, 36, 34, 255))
    for sy in (-1, 1):
        d.line(
            [cx - 0.36 * Lr, cy + sy * Wd * 0.47, cx + 0.36 * Lr, cy + sy * Wd * 0.47],
            fill=(150, 145, 135, 255), width=int(S * 1.2),
        )
    d.rounded_rectangle(
        [cx - Lr * 0.38, cy - Wd * 0.36, cx + Lr * 0.34, cy + Wd * 0.36],
        radius=S * 2, fill=(222, 220, 212, 255),
    )
    d.rectangle([cx - Lr * 0.30, cy - Wd * 0.26, cx + Lr * 0.05, cy + Wd * 0.05], fill=(196, 192, 184, 255))
    d.rectangle([cx - Lr * 0.05, cy + Wd * 0.08, cx + Lr * 0.24, cy + Wd * 0.28], fill=(176, 170, 160, 255))
    d.polygon(
        [
            (cx - Lr * 0.38, cy - Wd * 0.13),
            (cx - Lr * 0.55, cy - Wd * 0.09),
            (cx - Lr * 0.55, cy + Wd * 0.09),
            (cx - Lr * 0.38, cy + Wd * 0.13),
        ],
        fill=(70, 66, 62, 255),
    )
    d.ellipse(
        [cx - Lr * 0.24, cy + Wd * 0.06, cx - Lr * 0.08, cy + Wd * 0.24],
        fill=(240, 238, 232, 255), outline=(120, 118, 112, 255), width=S,
    )
    d.rectangle([cx + Lr * 0.22, cy - Wd * 0.30, cx + Lr * 0.31, cy - Wd * 0.18], fill=(90, 88, 84, 255))
    d.rectangle([cx + Lr * 0.19, cy - Wd * 0.36, cx + Lr * 0.34, cy - Wd * 0.28], fill=(245, 243, 238, 255))
    d.line(
        [cx + Lr * 0.34, cy + Wd * 0.25, cx + Lr * 0.45, cy + Wd * 0.05, cx + Lr * 0.45, cy - Wd * 0.15],
        fill=(120, 116, 110, 255), width=int(S * 1.6),
    )
    a = np.asarray(im)
    out = cv2.resize(a, (w // 4, h // 4), interpolation=cv2.INTER_AREA)
    return Image.fromarray(out)


def make_lander(px=74):
    S = 12
    w = h = int(px * 1.3 * S)
    im = Image.new('RGBA', (w, h), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    cx, cy = w / 2, h / 2
    R = px * S / 2
    for sx in (-1, 1):
        pc = (cx + sx * R * 0.62, cy)
        pr = R * 0.38
        pts = [
            (pc[0] + pr * math.cos(a), pc[1] + pr * math.sin(a))
            for a in np.linspace(0, 2 * math.pi, 11)[:-1] + 0.31
        ]
        d.polygon(pts, fill=(54, 58, 66, 255), outline=(150, 150, 150, 255))
        for a in np.linspace(0, 2 * math.pi, 11)[:-1] + 0.31:
            d.line([pc, (pc[0] + pr * math.cos(a), pc[1] + pr * math.sin(a))], fill=(105, 108, 112, 255), width=S)
        d.ellipse([pc[0] - pr * 0.18, pc[1] - pr * 0.18, pc[0] + pr * 0.18, pc[1] + pr * 0.18], fill=(150, 145, 130, 255))
    hr = R * 0.30
    hexp = [(cx + hr * math.cos(a), cy + hr * math.sin(a)) for a in np.linspace(0, 2 * math.pi, 7)[:-1]]
    d.polygon(hexp, fill=(200, 182, 140, 255), outline=(120, 105, 80, 255))
    d.rectangle([cx - hr * 0.35, cy - hr * 0.55, cx + hr * 0.25, cy - hr * 0.05], fill=(225, 222, 214, 255))
    d.ellipse([cx + hr * 0.05, cy + hr * 0.1, cx + hr * 0.5, cy + hr * 0.55], fill=(235, 232, 225, 255))
    d.ellipse([cx - hr * 0.3, cy + R * 0.42, cx + hr * 0.25, cy + R * 0.42 + hr * 0.55], fill=(238, 236, 230, 255))
    a = np.asarray(im)
    out = cv2.resize(a, (w // 4, h // 4), interpolation=cv2.INTER_AREA)
    return Image.fromarray(out)


def make_chute():
    S = 3
    w, h = 60 * S, 46 * S
    im = Image.new('RGBA', (w, h), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    d.ellipse([6 * S, 10 * S, 40 * S, 30 * S], fill=(236, 232, 222, 235))
    d.ellipse([18 * S, 6 * S, 44 * S, 24 * S], fill=(242, 238, 230, 220))
    for i in range(5):
        d.line([(10 * S + i * 6 * S, 12 * S), (14 * S + i * 5 * S, 28 * S)], fill=(205, 200, 188, 255), width=S)
    d.ellipse([46 * S, 20 * S, 56 * S, 30 * S], fill=(225, 222, 214, 255))
    a = np.asarray(im).astype(np.float32)
    a = cv2.GaussianBlur(a, (0, 0), 1.0)
    return Image.fromarray(np.clip(a, 0, 255).astype(np.uint8))


def save_jpeg(path, bgr, quality=82):
    rgb = cv2.cvtColor(np.clip(bgr * 255, 0, 255).astype(np.uint8), cv2.COLOR_BGR2RGB)
    Image.fromarray(rgb).save(path, 'JPEG', quality=quality, optimize=True, progressive=True)
    print('wrote', path, Path(path).stat().st_size, flush=True)


def main():
    src = cv2.imread(str(SRC_HIRISE if SRC_HIRISE.exists() else ROOT / 'assets' / 'art' / 'PIA23289.jpg'))
    if src is None:
        raise SystemExit(f'missing HiRISE source {SRC_HIRISE}')
    L = process_photo(src)
    photo = tint(L)
    Lb = cv2.GaussianBlur(L, (0, 0), 0.9)
    seen = tint(Lb) * 0.74 + 0.02
    gray = seen.mean(2, keepdims=True)
    seen = (seen * 0.7 + gray * 0.3).astype(np.float32)
    Lf = cv2.GaussianBlur(L, (0, 0), 2.6)
    fog = np.dstack([Lf * 0.30 + 0.045, Lf * 0.295 + 0.043, Lf * 0.29 + 0.041]).astype(np.float32)

    tw, th = TEX_COLS * TILE_PX, TEX_ROWS * TILE_PX
    print('warp', tw, th, flush=True)
    mx, my = warp_maps(th, tw)
    full = remap_bgr(photo, mx, my)
    seen_b = remap_bgr(seen, mx, my)
    fog_b = remap_bgr(fog, mx, my)

    save_jpeg(OUT / 'hirise-board.jpg', full, 84)
    save_jpeg(OUT / 'hirise-seen.jpg', seen_b, 80)
    save_jpeg(OUT / 'hirise-fog.jpg', fog_b, 78)

    make_rover().save(OUT / 'rover-nadir.png', 'PNG')
    make_lander().save(OUT / 'lander-insight.png', 'PNG')
    make_chute().save(OUT / 'chute.png', 'PNG')
    print('sprites', flush=True)

    cam = Image.open(SRC_CAM).convert('RGB')
    # Crop used by make_concept rovercam (CX0,CY0,CW,CH)
    cam.crop((250, 200, 250 + 2000, 200 + 1125)).save(OUT / 'mastcam.jpg', 'JPEG', quality=82, optimize=True)
    print('mastcam', (OUT / 'mastcam.jpg').stat().st_size, flush=True)

    noise = fractal(512, 512, 45, 5, 0.6, seed=31)
    n8 = np.clip((noise * 0.5 + 0.5) * 255, 0, 255).astype(np.uint8)
    Image.fromarray(n8).save(OUT / 'edge-noise.png')

    chute_photo = np.array([470.0, 1335.0])
    chute_col = LANDER_COL + (chute_photo[0] - PHOTO_LANDER[0]) / PHOTO_TILE
    chute_row = LANDER_ROW + (chute_photo[1] - PHOTO_LANDER[1]) / PHOTO_TILE
    meta = {
        'tilePx': TILE_PX,
        'originCol': ORIGIN_COL,
        'originRow': ORIGIN_ROW,
        'texCols': TEX_COLS,
        'texRows': TEX_ROWS,
        'width': tw,
        'height': th,
        'landerCol': LANDER_COL,
        'landerRow': LANDER_ROW,
        'chuteCol': round(float(chute_col), 3),
        'chuteRow': round(float(chute_row), 3),
        'creditTerrain': 'NASA/JPL-Caltech/UArizona HiRISE PIA23289',
        'creditCam': 'NASA/JPL-Caltech/ASU/MSSS Mastcam-Z PIA23727',
    }
    (OUT / 'orbital-map.json').write_text(json.dumps(meta, indent=2) + '\n')
    print('done', meta)


if __name__ == '__main__':
    main()
