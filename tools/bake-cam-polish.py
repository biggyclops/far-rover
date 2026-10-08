#!/usr/bin/env python3
"""Bake rover-cam crater + forward lander plates (public-domain NASA stills).

Sources:
  PIA08813  HiRISE fresh crater (NASA/JPL-Caltech/UArizona)
  PIA23727  Mastcam-Z grade reference (NASA/JPL-Caltech/ASU/MSSS)
  lander.png  existing 3/4 lander, shadow stripped for the PiP
"""
from __future__ import annotations

from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'assets' / 'art'
SRC = Path('/tmp/crater/PIA08813-orig.jpg')
MAST = OUT / 'mastcam.jpg'
LANDER = OUT / 'lander.png'


def grade_to_mastcam(im: Image.Image, mast: Image.Image) -> Image.Image:
    src = np.asarray(im.convert('RGB'), dtype=np.float32)
    ref = np.asarray(mast.convert('RGB'), dtype=np.float32)
    # Match the lower/ground band of the Mastcam plate.
    band = ref[int(ref.shape[0] * 0.48):, :, :]
    sm = src.reshape(-1, 3).mean(axis=0) + 1.0
    rm = band.reshape(-1, 3).mean(axis=0)
    scale = rm / sm
    # Pull slightly darker so the bowl sits below the sunlit ground.
    scale *= np.array([1.02, 0.92, 0.72], dtype=np.float32)
    out = np.clip(src * scale, 0, 255).astype(np.uint8)
    return Image.fromarray(out, 'RGB')


def bake_crater():
    crater = Image.open(SRC).convert('RGB')
    w, h = crater.size
    # Tight crop of the scalloped bowl plus a little ejecta.
    box = (int(w * 0.16), int(h * 0.08), int(w * 0.84), int(h * 0.72))
    crater = crater.crop(box)
    mast = Image.open(MAST)
    crater = grade_to_mastcam(crater, mast)
    crater = crater.resize((1024, 1024), Image.Resampling.LANCZOS)
    fill = tuple(int(x) for x in np.asarray(crater)[512, 512])

    # Mild foreshorten: far rim a bit narrower, near rim wide — rover-eye bowl.
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

    # Soft elliptical alpha so no hard rim.
    alpha = Image.new('L', (cw, ch), 0)
    ap = np.zeros((ch, cw), dtype=np.float32)
    yy, xx = np.mgrid[0:ch, 0:cw]
    cx, cy = cw / 2, ch * 0.52
    rx, ry = cw * 0.42, ch * 0.38
    d = np.sqrt(((xx - cx) / rx) ** 2 + ((yy - cy) / ry) ** 2)
    ap[d <= 0.72] = 1.0
    mid = (d > 0.72) & (d < 1.02)
    ap[mid] = np.clip((1.02 - d[mid]) / 0.30, 0, 1) ** 1.35
    alpha = Image.fromarray((ap * 255).astype(np.uint8), 'L')
    rgba = warped.convert('RGBA')
    rgba.putalpha(alpha)
    path = OUT / 'cam-crater.png'
    rgba.save(path, 'PNG', optimize=True)
    print('cam-crater.png', rgba.size, path.stat().st_size)


def bake_lander():
    im = Image.open(LANDER).convert('RGBA')
    arr = np.asarray(im).copy()
    r, g, b, a = arr[:, :, 0], arr[:, :, 1], arr[:, :, 2], arr[:, :, 3]
    black = (r < 22) & (g < 22) & (b < 22)
    # Baked contact blob: dull brown, not the gold legs / pale dish.
    brown = (r < 125) & (g < 88) & (b < 62) & (g < r * 0.82) & (b < g * 0.9)
    keep = (r > 148) | ((r > 118) & (g > 92)) | ((r > 100) & (g > 100) & (b > 90))
    a = a.astype(np.float32)
    a[black] = 0
    a[brown & ~keep] *= 0.0
    out = arr.copy()
    out[:, :, 3] = np.clip(a, 0, 255).astype(np.uint8)
    out[out[:, :, 3] == 0] = 0
    rgba = Image.fromarray(out, 'RGBA')
    path = OUT / 'lander-cam.png'
    rgba.save(path, 'PNG', optimize=True)
    print('lander-cam.png', rgba.size, path.stat().st_size)


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
