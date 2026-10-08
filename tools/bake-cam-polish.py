#!/usr/bin/env python3
"""Bake rover-cam crater + forward lander plates (public-domain NASA stills).

Sources:
  PIA08813  HiRISE fresh crater (NASA/JPL-Caltech/UArizona)
  PIA22876  InSight first selfie (NASA/JPL-Caltech)
  PIA23727  Mastcam-Z grade reference (NASA/JPL-Caltech/ASU/MSSS)
"""
from __future__ import annotations

from pathlib import Path

import cv2
import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'assets' / 'art'
CRATER_SRC = Path('/tmp/crater/PIA08813-orig.jpg')
LANDER_SRC = Path('/tmp/lander/PIA22876.jpg')
MAST = OUT / 'mastcam.jpg'


def grade_to_mastcam(im: Image.Image, mast: Image.Image, punch: float = 0.72) -> Image.Image:
    src = np.asarray(im.convert('RGB'), dtype=np.float32)
    ref = np.asarray(mast.convert('RGB'), dtype=np.float32)
    band = ref[int(ref.shape[0] * 0.48):, :, :]
    sm = src.reshape(-1, 3).mean(axis=0) + 1.0
    rm = band.reshape(-1, 3).mean(axis=0)
    scale = rm / sm
    scale *= np.array([1.02, 0.92, punch], dtype=np.float32)
    out = np.clip(src * scale, 0, 255).astype(np.uint8)
    return Image.fromarray(out, 'RGB')


def bake_crater():
    crater = Image.open(CRATER_SRC).convert('RGB')
    w, h = crater.size
    box = (int(w * 0.16), int(h * 0.08), int(w * 0.84), int(h * 0.72))
    crater = crater.crop(box)
    mast = Image.open(MAST)
    crater = grade_to_mastcam(crater, mast)
    crater = crater.resize((1024, 1024), Image.Resampling.LANCZOS)
    fill = tuple(int(x) for x in np.asarray(crater)[512, 512])

    cw, ch = crater.size
    src_quad = [(0, 0), (cw, 0), (cw, ch), (0, ch)]
    dest_quad = [
        (int(cw * 0.10), int(ch * 0.02)),
        (int(cw * 0.90), int(ch * 0.02)),
        (cw, ch),
        (0, ch),
    ]
    coeffs = _find_coeffs(dest_quad, src_quad)
    warped = crater.transform(
        (cw, ch), Image.Transform.PERSPECTIVE, coeffs, Image.Resampling.BICUBIC,
        fillcolor=fill
    )

    yy, xx = np.mgrid[0:ch, 0:cw]
    cx, cy = cw / 2, ch * 0.58
    rx, ry = cw * 0.44, ch * 0.40
    d = np.sqrt(((xx - cx) / rx) ** 2 + ((yy - cy) / ry) ** 2)
    ap = np.zeros((ch, cw), dtype=np.float32)
    ap[d <= 0.78] = 1.0
    mid = (d > 0.78) & (d < 1.0)
    ap[mid] = np.clip((1.0 - d[mid]) / 0.22, 0, 1) ** 1.45

    rgb = np.asarray(warped, dtype=np.float32)
    lum = rgb.mean(axis=2)
    # Cut the pale ejecta cap above the scalloped far rim so it cannot
    # draw as a translucent dome in the sky.
    rim = np.full(cw, -1, dtype=np.int32)
    for x in range(cw):
        for y in range(ch):
            if ap[y, x] < 0.2:
                continue
            if lum[y, x] < 102 and y > ch * 0.16:
                rim[x] = y
                break
    xs = np.where(rim >= 0)[0]
    if len(xs) > 8:
        good = rim.copy().astype(np.float32)
        missing = rim < 0
        good[missing] = np.interp(np.where(missing)[0], xs, rim[xs])
        good = cv2.GaussianBlur(good.reshape(1, -1), (1, 31), 0).ravel()
        fade = 14.0
        for x in range(cw):
            y_rim = good[x]
            t = (yy[:, x] - (y_rim - 4.0)) / fade
            ap[:, x] *= np.clip(t, 0, 1)

    # Keep the far rim opaque; feather only sides/near lip (already in ellipse).
    alpha = Image.fromarray((np.clip(ap, 0, 1) * 255).astype(np.uint8), 'L')
    rgba = warped.convert('RGBA')
    rgba.putalpha(alpha)
    arr = np.asarray(rgba)
    ys, xs = np.where(arr[:, :, 3] > 12)
    pad = 6
    x0, x1 = max(0, xs.min() - pad), min(arr.shape[1], xs.max() + pad)
    y0, y1 = max(0, ys.min() - pad), min(arr.shape[0], ys.max() + pad)
    crop = arr[y0:y1, x0:x1]
    # Pad to square so the far rim stays at the top of the plate.
    side = max(crop.shape[0], crop.shape[1])
    sq = np.zeros((side, side, 4), dtype=np.uint8)
    oy = 0
    ox = (side - crop.shape[1]) // 2
    sq[oy:oy + crop.shape[0], ox:ox + crop.shape[1]] = crop
    rgba = Image.fromarray(sq, 'RGBA').resize((1024, 1024), Image.Resampling.LANCZOS)
    path = OUT / 'cam-crater.png'
    rgba.save(path, 'PNG', optimize=True)
    print('cam-crater.png', rgba.size, path.stat().st_size)


def bake_lander():
    src = np.asarray(Image.open(LANDER_SRC).convert('RGB'))
    h, w = src.shape[:2]
    work_w = 1800
    scale = work_w / w
    small = cv2.resize(src, (work_w, int(h * scale)), interpolation=cv2.INTER_AREA)
    sh, sw = small.shape[:2]
    bgr = cv2.cvtColor(small, cv2.COLOR_RGB2BGR)
    mask = np.full((sh, sw), cv2.GC_PR_BGD, np.uint8)
    lum = small.mean(axis=2)
    yy, xx = np.mgrid[0:sh, 0:sw]
    edge = (yy < 48) | (yy > sh - 48) | (xx < 36) | (xx > sw - 36)
    mask[edge] = cv2.GC_BGD
    mask[edge & (lum < 22)] = cv2.GC_BGD
    rect = (int(sw * 0.07), int(sh * 0.05), int(sw * 0.86), int(sh * 0.92))
    bgd = np.zeros((1, 65), np.float64)
    fgd = np.zeros((1, 65), np.float64)
    cv2.grabCut(bgr, mask, rect, bgd, fgd, 7, cv2.GC_INIT_WITH_RECT)
    fg = np.where((mask == cv2.GC_FGD) | (mask == cv2.GC_PR_FGD), 255, 0).astype(np.uint8)
    k = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5))
    fg = cv2.morphologyEx(fg, cv2.MORPH_CLOSE, k, iterations=2)
    fg = cv2.morphologyEx(fg, cv2.MORPH_OPEN, k, iterations=1)

    r, g, b = small[:, :, 0], small[:, :, 1], small[:, :, 2]
    soil = (
        (r > 88) & (r < 205) & (g > 48) & (g < 145) & (b < 95)
        & (r > g + 12) & (g > b) & (r.astype(np.int16) - b > 40)
        & (lum > 55) & (lum < 175)
    )
    gold = (r > 145) & (g > 78) & (r > g + 18) & (g > b + 12)
    panel = (r < 88) & (g < 88) & (b < 100) & (lum < 90)
    white = (r > 150) & (g > 145) & (b > 140)
    fg[(soil & ~gold & ~panel & ~white) & (fg > 0)] = 0
    hole = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (41, 41))
    closed = cv2.morphologyEx(fg, cv2.MORPH_CLOSE, hole, iterations=2)
    inpaint_m = ((closed > 128) & (fg < 40)).astype(np.uint8) * 255
    if inpaint_m.any():
        small = cv2.inpaint(small, inpaint_m, 7, cv2.INPAINT_TELEA)
    fg = closed
    fg = cv2.morphologyEx(fg, cv2.MORPH_OPEN, k, iterations=1)
    fg = cv2.GaussianBlur(fg, (3, 3), 0)

    full_a = cv2.resize(fg, (w, h), interpolation=cv2.INTER_LINEAR)
    full_rgb = cv2.resize(small, (w, h), interpolation=cv2.INTER_LINEAR)
    rgba = np.dstack([full_rgb, full_a])
    ys, xs = np.where(full_a > 12)
    pad = 12
    x0, x1 = max(0, xs.min() - pad), min(w, xs.max() + pad)
    y0, y1 = max(0, ys.min() - pad), min(h, ys.max() + pad)
    rgba = rgba[y0:y1, x0:x1]
    rgba[rgba[:, :, 3] < 10] = 0

    # Slight Mastcam warmth without washing out midtones.
    rgb = rgba[:, :, :3].astype(np.float32)
    a = rgba[:, :, 3:4].astype(np.float32) / 255.0
    mast = np.asarray(Image.open(MAST).convert('RGB'), dtype=np.float32)
    band = mast[int(mast.shape[0] * 0.55):, :, :].reshape(-1, 3).mean(axis=0)
    keep = a[:, :, 0] > 0.12
    if keep.any():
        sm = rgb[keep].mean(axis=0) + 1.0
        scale = np.clip(band / sm, 0.78, 1.18)
        scale *= np.array([1.04, 0.90, 0.70], dtype=np.float32)
        rgb = np.clip(rgb * scale, 0, 255)
        # Left-lit: shade the right side to match Mastcam sun.
        ww = rgb.shape[1]
        xx = np.linspace(0, 1, ww, dtype=np.float32)[None, :, None]
        shade = 1.0 - 0.22 * np.clip((xx - 0.42) / 0.58, 0, 1)
        rgb *= shade
        # Dust on the lower third (legs / panel undersides).
        hh = rgb.shape[0]
        yy = np.linspace(0, 1, hh, dtype=np.float32)[:, None, None]
        dust = np.clip((yy - 0.62) / 0.38, 0, 1)
        dust_col = np.array([168, 118, 72], dtype=np.float32)
        rgb = rgb * (1 - 0.22 * dust) + dust_col * (0.22 * dust)
        rgb = np.clip(rgb, 0, 255)
    rgba[:, :, :3] = rgb.astype(np.uint8)
    rgba[:, :, 3] = np.clip(rgba[:, :, 3], 0, 255)
    rgba[rgba[:, :, 3] < 10] = 0

    out = Image.fromarray(rgba, 'RGBA')
    out = out.resize((1400, int(1400 * out.size[1] / out.size[0])), Image.Resampling.LANCZOS)
    path = OUT / 'lander-cam.png'
    out.save(path, 'PNG', optimize=True)
    print('lander-cam.png', out.size, path.stat().st_size)


def _find_coeffs(dest, src):
    matrix = []
    for (dx, dy), (sx, sy) in zip(dest, src):
        matrix.append([dx, dy, 1, 0, 0, 0, -sx * dx, -sx * dy])
        matrix.append([0, 0, 0, dx, dy, 1, -sy * dx, -sy * dy])
    A = np.array(matrix, dtype=np.float64)
    B = np.array([p for s in src for p in s], dtype=np.float64)
    return np.linalg.lstsq(A, B, rcond=None)[0].tolist()


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    bake_crater()
    bake_lander()


if __name__ == '__main__':
    main()
