#!/usr/bin/env python3
"""Fill v0.8 LROC plate no-data wedges and lift driveable shadow floors.

The NASA crop has a sharp black triangle on the east edge (beside Deep Ice)
and several PSR crater floors that read as holes even though haulers can
drive them. Gameplay crater-s / pit / crater-m tiles stay black.
"""
from collections import deque
from pathlib import Path

import cv2
import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
SRC = Path('/tmp/plate-pre-fill.png')
if not SRC.exists():
    SRC = ROOT / 'assets/v08/art/realism/ground-map.png'
OUT = ROOT / 'assets/v08/art/realism/ground-map.png'

TILE = 64
MAP = 40
DARK = 8
FLOOR = 38

# From v08/game.js bootstrap()
CRATER_S = {(8, 8), (32, 10), (6, 28), (30, 32), (22, 8), (10, 22)}
PITS = {(12, 30), (28, 28)}
CRATER_M = {(33 + x, 24 + y) for x in range(2) for y in range(2)}
OBSTACLE = CRATER_S | PITS | CRATER_M


def flood_from(im, seeds, thresh):
    h, w = im.shape
    vis = np.zeros((h, w), dtype=bool)
    q = deque()
    for y, x in seeds:
        if 0 <= y < h and 0 <= x < w and im[y, x] <= thresh and not vis[y, x]:
            vis[y, x] = True
            q.append((y, x))
    while q:
        y, x = q.popleft()
        for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            ny, nx = y + dy, x + dx
            if 0 <= ny < h and 0 <= nx < w and not vis[ny, nx] and im[ny, nx] <= thresh:
                vis[ny, nx] = True
                q.append((ny, nx))
    return vis


def right_edge_black(im, thresh):
    h, w = im.shape
    seeds = [(y, w - 1) for y in range(h) if im[y, w - 1] <= thresh]
    seeds += [(0, w - 1), (0, w - 2), (1, w - 1)]
    return flood_from(im, seeds, thresh)


def flood_bright(im, seeds, thresh):
    h, w = im.shape
    vis = np.zeros((h, w), dtype=bool)
    q = deque()
    for y, x in seeds:
        if 0 <= y < h and 0 <= x < w and im[y, x] >= thresh and not vis[y, x]:
            vis[y, x] = True
            q.append((y, x))
    while q:
        y, x = q.popleft()
        for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            ny, nx = y + dy, x + dx
            if 0 <= ny < h and 0 <= nx < w and not vis[ny, nx] and im[ny, nx] >= thresh:
                vis[ny, nx] = True
                q.append((ny, nx))
    return vis


def no_data_wedge(im, thresh=6):
    """Geometric east triangle + top-right sliver only — not real PSR."""
    raw = right_edge_black(im, thresh)
    h, w = im.shape
    yy, xx = np.indices((h, w))
    triangle = raw & (yy >= 400) & (yy <= 1100) & (xx >= 2150)
    tr_black = raw & (yy <= 200) & (xx >= 2350)
    seeds = [(y, x) for y in range(min(160, h)) for x in range(w - 80, w) if im[y, x] >= 220]
    tr_white = flood_bright(im, seeds, 220) & (yy <= 200) & (xx >= 2440)
    return triangle | tr_black | tr_white


def sample(img, xs, ys):
    h, w = img.shape
    xs = np.clip(xs, 0, w - 1.001)
    ys = np.clip(ys, 0, h - 1.001)
    x0 = np.floor(xs).astype(np.int32)
    y0 = np.floor(ys).astype(np.int32)
    x1 = np.clip(x0 + 1, 0, w - 1)
    y1 = np.clip(y0 + 1, 0, h - 1)
    tx = xs - x0
    ty = ys - y0
    a = img[y0, x0]
    b = img[y0, x1]
    c = img[y1, x0]
    d = img[y1, x1]
    return (a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty


def _clone_patch(dst, src, mask):
    """Poisson-blend src into dst over mask. Pad so the cut can touch the plate edge."""
    if not mask.any():
        return dst
    pad = 24
    src_p = cv2.copyMakeBorder(src, pad, pad, pad, pad, cv2.BORDER_REFLECT)
    dst_p = cv2.copyMakeBorder(dst, pad, pad, pad, pad, cv2.BORDER_REFLECT)
    m_p = cv2.copyMakeBorder(mask.astype(np.uint8) * 255, pad, pad, pad, pad, cv2.BORDER_CONSTANT, value=0)
    ys, xs = np.where(mask)
    cx = int((int(xs.min()) + int(xs.max())) / 2) + pad
    cy = int((int(ys.min()) + int(ys.max())) / 2) + pad
    src_bgr = cv2.cvtColor(src_p, cv2.COLOR_GRAY2BGR)
    dst_bgr = cv2.cvtColor(dst_p, cv2.COLOR_GRAY2BGR)
    out = cv2.seamlessClone(src_bgr, dst_bgr, m_p, (cx, cy), cv2.NORMAL_CLONE)
    return cv2.cvtColor(out, cv2.COLOR_BGR2GRAY)[pad:-pad, pad:-pad]


def fill_wedge(im, mask):
    """Tile mid-tone ground from above the cut, then Poisson-blend it in."""
    h, w = im.shape
    yy, xx = np.indices((h, w))
    grow = cv2.dilate(
        mask.astype(np.uint8) * 255,
        cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (13, 13)),
    ) > 0

    # Good cratered terrain sits in y=90..420 on these same columns.
    y0, y1 = 90, 420
    period = float(y1 - y0)
    local = yy.astype(np.float32) - 453.0
    sy = y0 + np.mod(local * 0.93 + (xx - 2200) * 0.11, period)
    sx = xx.astype(np.float32) - 10.0 + 18.0 * np.sin(yy * 0.012)
    sy2 = y0 + np.mod(local * 0.81 + 140.0 + (xx - 2100) * 0.07, period)
    sx2 = xx.astype(np.float32) - 28.0 + 11.0 * np.cos(yy * 0.009)
    src_bad = ((sy < 200) & (sx > 2400)) | grow[
        np.clip(sy.astype(np.int32), 0, h - 1),
        np.clip(sx.astype(np.int32), 0, w - 1),
    ]
    sx = np.where(src_bad, sx - 180, sx)
    src_bad2 = ((sy2 < 200) & (sx2 > 2400)) | grow[
        np.clip(sy2.astype(np.int32), 0, h - 1),
        np.clip(sx2.astype(np.int32), 0, w - 1),
    ]
    sx2 = np.where(src_bad2, sx2 - 200, sx2)

    a = sample(im.astype(np.float32), sx, sy)
    b = sample(im.astype(np.float32), sx2, sy2)
    mix = 0.5 + 0.5 * np.sin(xx * 0.013) * np.cos(yy * 0.008)
    filled = a * mix + b * (1.0 - mix)
    rng = np.random.default_rng(1350)
    filled = np.clip(filled + rng.normal(0, 1.3, (h, w)), 0, 255).astype(np.uint8)

    # Clone the triangle and the top-right sliver separately so each has a local center.
    triangle = grow & (yy >= 300)
    tr = grow & (yy < 300)
    out = _clone_patch(im, filled, triangle)
    out = _clone_patch(out, filled, tr)
    return out


def obstacle_mask(h, w):
    m = np.zeros((h, w), dtype=bool)
    for tx, ty in OBSTACLE:
        m[ty * TILE:(ty + 1) * TILE, tx * TILE:(tx + 1) * TILE] = True
    return m


def lift_driveable_floors(im, obstacle):
    """Raise PSR / crater floors on tiles haulers can drive so they read as ground."""
    dark = (im <= 16) & ~obstacle
    if not dark.any():
        return im
    h, w = im.shape
    # Local "not-dark" neighborhood median via blur of valid pixels
    valid = (~dark).astype(np.float32)
    val = im.astype(np.float32) * valid
    k = 31
    num = cv2.blur(val, (k, k))
    den = cv2.blur(valid, (k, k))
    local = np.divide(num, np.maximum(den, 1e-4))
    local = np.clip(local, 28, 72)
    # Where the neighborhood is also dark (big floors), use a shadowed-regolith floor
    local = np.where(den < 0.15, FLOOR, local * 0.55 + FLOOR * 0.45)

    rng = np.random.default_rng(892)
    yy, xx = np.indices((h, w))
    tex = sample(im.astype(np.float32), (xx * 1.17 + 41) % w, (yy * 1.09 + 17) % h)
    tex = (tex - np.median(tex)) * 0.12
    grain = rng.normal(0, 2.4, (h, w)).astype(np.float32)
    lifted = np.clip(local + tex + grain, 26, 70)

    out = im.astype(np.float32)
    # Soften the lift at the rim so bowls keep a lip
    dark_u8 = dark.astype(np.uint8) * 255
    dist = cv2.distanceTransform(dark_u8, cv2.DIST_L2, 5)
    alpha = np.clip(dist / 6.0, 0, 1)
    mix = dark.astype(np.float32) * (0.72 + 0.28 * alpha)
    out = out * (1 - mix) + lifted * mix
    out[obstacle] = im[obstacle]
    return np.clip(np.rint(out), 0, 255).astype(np.uint8)


def main():
    im = np.array(Image.open(SRC).convert('L'))
    h, w = im.shape
    wedge = no_data_wedge(im, thresh=6)
    print('wedge px', int(wedge.sum()), f'{100 * wedge.mean():.2f}%')
    filled = fill_wedge(im, wedge)
    obs = obstacle_mask(h, w)
    out = lift_driveable_floors(filled, obs)

    # Report
    bad = 0
    for ty in range(MAP):
        for tx in range(MAP):
            tile = out[ty * TILE:(ty + 1) * TILE, tx * TILE:(tx + 1) * TILE]
            frac = float((tile <= DARK).mean())
            if frac > 0.60 and (tx, ty) not in OBSTACLE:
                bad += 1
                print(f'  still-dark tile {tx},{ty} {frac:.2f}')
    print('driveable tiles still >60% black', bad)
    print('mean', out.mean(), 'black<=8', float((out <= DARK).mean()))
    Image.fromarray(out, mode='L').save(OUT, optimize=True)
    Image.fromarray(out[0:900, 2100:]).save('/tmp/east-after.png')
    Image.fromarray(out[400:1100, 1400:2100]).save('/tmp/center-after.png')
    print('wrote', OUT, OUT.stat().st_size)


if __name__ == '__main__':
    main()
