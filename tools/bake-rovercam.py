#!/usr/bin/env python3
"""Slice public-domain Mastcam-Z / Navcam stills for the rover-cam PiP.

Sources (NASA / JPL-Caltech / ASU / MSSS, public domain):
  PIA23727  Perseverance Mastcam-Z  — sky / hills / rocks / near ground
  PIA24543  Perseverance landscape  — alternate heading
  PIA24422  Perseverance Navcam     — wide pan strip
"""
from __future__ import annotations

from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'assets' / 'art'
SRC23727 = Path('/home/ubuntu/.cursor/projects/workspace/uploads/cam_PIA23727_f27c.jpg')
SRC24543 = Path('/tmp/navcam/PIA24543-orig.jpg')
SRC24422 = Path('/tmp/navcam/PIA24422-orig.jpg')
FALLBACK = OUT / 'mastcam.jpg'


def save_jpeg(im: Image.Image, name: str, quality=84):
    path = OUT / name
    im.convert('RGB').save(path, 'JPEG', quality=quality, optimize=True)
    print(name, im.size, path.stat().st_size)


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    def trim_letterbox(im, thresh=14):
        g = im.convert('L')
        w, h = g.size
        pix = g.load()
        step = max(1, w // 80)

        def row_mean(y):
            acc = 0
            n = 0
            for x in range(0, w, step):
                acc += pix[x, y]
                n += 1
            return acc / max(1, n)

        top = 0
        while top < h and row_mean(top) < thresh:
            top += 1
        bot = h - 1
        while bot > top and row_mean(bot) < thresh:
            bot -= 1
        return im.crop((0, top, w, bot + 1)) if bot > top else im

    # Prefer the already-cropped mastcam plate (no PIA letterbox), else the upload.
    src = Image.open(FALLBACK if FALLBACK.exists() else SRC23727).convert('RGB')
    src = trim_letterbox(src)
    w, h = src.size
    # Layered planes from PIA23727 — skip letterbox / black bars.
    save_jpeg(src.crop((0, 0, w, int(h * 0.24))).resize((1600, 280), Image.Resampling.LANCZOS), 'cam-sky.jpg')
    save_jpeg(src.crop((0, int(h * 0.12), w, int(h * 0.50))).resize((1600, 420), Image.Resampling.LANCZOS), 'cam-far.jpg')
    save_jpeg(src.crop((0, int(h * 0.36), w, int(h * 0.80))).resize((1600, 520), Image.Resampling.LANCZOS), 'cam-mid.jpg')
    save_jpeg(src.crop((0, int(h * 0.54), w, int(h * 0.98))).resize((1600, 560), Image.Resampling.LANCZOS), 'cam-near.jpg')
    if SRC24543.exists():
        alt = Image.open(SRC24543).convert('RGB')
        aw, ah = alt.size
        # Left/center landscape, drop most of the rover on the right
        crop = alt.crop((0, 0, int(aw * 0.62), int(ah * 0.92)))
        save_jpeg(crop.resize((1400, 900), Image.Resampling.LANCZOS), 'cam-alt.jpg', quality=82)

    if SRC24422.exists():
        pano = Image.open(SRC24422).convert('RGB')
        pw, ph = pano.size
        # Center terrain, skip rover hardware on the sides and bottom
        crop = pano.crop((int(pw * 0.28), int(ph * 0.04), int(pw * 0.72), int(ph * 0.72)))
        save_jpeg(crop.resize((1600, 520), Image.Resampling.LANCZOS), 'cam-pano.jpg', quality=82)

    # Rock chips from the Mastcam near field (readable stones for billboards)
    rocks = Image.new('RGBA', (512, 128), (0, 0, 0, 0))
    chips = [
        (620, 980, 220, 140),
        (1180, 920, 200, 130),
        (240, 1040, 180, 120),
        (1540, 860, 190, 125),
    ]
    mast = Image.open(OUT / 'mastcam.jpg').convert('RGBA')
    mw, mh = mast.size
    x0 = 0
    for (sx, sy, sw, sh) in chips:
        box = (max(0, sx), max(0, sy), min(mw, sx + sw), min(mh, sy + sh))
        chip = mast.crop(box).resize((128, 80), Image.Resampling.LANCZOS)
        rocks.paste(chip, (x0, 24))
        x0 += 128
    rocks.save(OUT / 'cam-rocks.png', 'PNG', optimize=True)
    print('cam-rocks.png', rocks.size, (OUT / 'cam-rocks.png').stat().st_size)


if __name__ == '__main__':
    main()
