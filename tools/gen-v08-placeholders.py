#!/usr/bin/env python3
"""Generate Far Rover v0.8 placeholder art at Pixel's exact sizes."""
from __future__ import annotations

import math
import os
import struct
import zlib

ROOT = os.path.join(os.path.dirname(__file__), '..', 'assets', 'v08', 'art')


def _chunk(tag: bytes, data: bytes) -> bytes:
    return struct.pack('>I', len(data)) + tag + data + struct.pack('>I', zlib.crc32(tag + data) & 0xFFFFFFFF)


def write_png(path: str, w: int, h: int, pixels: bytes, rgb: bool = False) -> None:
    channels = 3 if rgb else 4
    assert len(pixels) == w * h * channels, (path, len(pixels), w, h, channels)
    raw = bytearray()
    stride = w * channels
    for y in range(h):
        raw.append(0)
        raw.extend(pixels[y * stride:(y + 1) * stride])
    color_type = 2 if rgb else 6
    ihdr = struct.pack('>IIBBBBB', w, h, 8, color_type, 0, 0, 0)
    png = b'\x89PNG\r\n\x1a\n' + _chunk(b'IHDR', ihdr) + _chunk(b'IDAT', zlib.compress(bytes(raw), 9)) + _chunk(b'IEND', b'')
    os.makedirs(os.path.dirname(path), exist_ok=True)
    if os.path.exists(path):
        return
    with open(path, 'wb') as f:
        f.write(png)


def clamp(v: float) -> int:
    return max(0, min(255, int(v)))


def hash01(x: float, y: float, s: float = 0.0) -> float:
    n = math.sin(x * 127.1 + y * 311.7 + s * 19.19) * 43758.5453
    return n - math.floor(n)


def rgb_buf(w: int, h: int, fn) -> bytes:
    out = bytearray(w * h * 3)
    i = 0
    for y in range(h):
        for x in range(w):
            r, g, b = fn(x, y)
            out[i] = clamp(r)
            out[i + 1] = clamp(g)
            out[i + 2] = clamp(b)
            i += 3
    return bytes(out)


def rgba_buf(w: int, h: int, fn) -> bytes:
    out = bytearray(w * h * 4)
    i = 0
    for y in range(h):
        for x in range(w):
            r, g, b, a = fn(x, y)
            out[i] = clamp(r)
            out[i + 1] = clamp(g)
            out[i + 2] = clamp(b)
            out[i + 3] = clamp(a)
            i += 4
    return bytes(out)


def ground_fn(variant: int):
    tints = [
        (168, 160, 148),
        (176, 166, 150),
        (158, 154, 146),
        (172, 164, 152),
    ]
    base = tints[variant - 1]

    def fn(x, y):
        n = hash01(x, y, variant) * 18 - 6
        # long shadow grain from upper-left
        shade = (x + y) * 0.04
        r = base[0] + n - shade
        g = base[1] + n * 0.9 - shade
        b = base[2] + n * 0.7 - shade * 0.6
        return r, g, b

    return fn


def crater_s_fn(x, y):
    cx, cy = 64, 68
    d = math.hypot(x - cx, y - cy)
    rim = max(0.0, 1.0 - abs(d - 42) / 8)
    bowl = max(0.0, 1.0 - d / 48)
    r = 150 - bowl * 70 + rim * 40
    g = 144 - bowl * 68 + rim * 28
    b = 136 - bowl * 60 + rim * 16
    # upper-left sun: bright NW lip, dark SE
    lit = max(0.0, (cx - x + cy - y) / 90)
    r += lit * 28 - (1 - lit) * bowl * 20
    g += lit * 22 - (1 - lit) * bowl * 18
    b += lit * 16 - (1 - lit) * bowl * 14
    return r, g, b


def ice_fn(mined: bool):
    def fn(x, y):
        n = hash01(x, y, 9 if mined else 3)
        d = math.hypot(x - 64, y - 64) / 80
        if mined:
            r, g, b = 132 + n * 20, 134 + n * 16, 138 + n * 18
            r -= d * 12
            return r, g, b
        r = 188 + n * 28 - d * 20
        g = 210 + n * 20 - d * 10
        b = 224 + n * 18
        # faint sun sparkle
        if hash01(x, y, 21) > 0.97:
            r, g, b = 240, 246, 255
        return r, g, b

    return fn


def pit_fn(x, y):
    d = math.hypot(x - 64, y - 70) / 70
    k = max(0.0, 1.0 - d)
    r = 28 + (1 - k) * 90
    g = 26 + (1 - k) * 86
    b = 30 + (1 - k) * 80
    return r, g, b


def rock_fn(variant: int):
    def fn(x, y):
        n = hash01(x * 0.7, y * 0.7, variant + 4)
        r = 42 + n * 28 + variant * 4
        g = 40 + n * 22
        b = 44 + n * 20
        return r, g, b

    return fn


def tunnel_fn(kind: str):
    def fn(x, y):
        a = 0
        r = g = b = 0
        cx, cy = 64, 64
        on = False
        if kind == 'h':
            on = abs(y - cy) < 18
        elif kind == 'v':
            on = abs(x - cx) < 18
        else:
            on = (x > 46 and abs(y - cy) < 18) or (y > 46 and abs(x - cx) < 18)
        if on:
            n = hash01(x, y, 7)
            r, g, b, a = 56 + n * 16, 52 + n * 12, 48 + n * 10, 255
        return r, g, b, a

    return fn


def crater_m_fn(x, y):
    cx, cy = 128, 140
    d = math.hypot(x - cx, y - cy)
    rim = max(0.0, 1.0 - abs(d - 88) / 14)
    bowl = max(0.0, 1.0 - d / 100)
    a = 255 if d < 108 else max(0, 255 - int((d - 108) * 12))
    lit = max(0.0, (cx - x + cy - y) / 180)
    r = 140 - bowl * 80 + rim * 50 + lit * 30
    g = 132 - bowl * 76 + rim * 36 + lit * 22
    b = 124 - bowl * 68 + rim * 20 + lit * 14
    return r, g, b, a


def horizon_fn(x, y):
    # Lunar night-side sky, Earth above a pale limb.
    t = y / 1079
    if t < 0.62:
        r = 6 + t * 18
        g = 8 + t * 16
        b = 16 + t * 28
        # Earth
        ex, ey, er = 1480, 220, 70
        d = math.hypot(x - ex, y - ey)
        if d < er:
            k = 1 - d / er
            r = 40 + k * 80
            g = 70 + k * 110
            b = 160 + k * 70
            if x < ex - 8:
                r *= 0.55
                g *= 0.6
                b *= 0.75
        elif d < er + 6:
            r, g, b = 180, 200, 230
        return r, g, b, 255
    # surface limb
    u = (t - 0.62) / 0.38
    r = 118 + u * 40 + hash01(x, y, 1) * 10
    g = 112 + u * 32 + hash01(x, y, 2) * 8
    b = 104 + u * 20
    return r, g, b, 255


def rover_fn(kind: str):
    def fn(x, y):
        # Body centred, facing north (up).
        cx, cy = 64, 66
        lx, ly = x - cx, y - cy
        r = g = b = a = 0
        # chassis
        if abs(lx) < 22 and -28 < ly < 26:
            a = 255
            r, g, b = (92, 90, 88) if kind != 'loaded' else (98, 86, 70)
            if ly < -10:
                r, g, b = 210, 208, 200  # sunlit deck
        # mast / north hint
        if abs(lx) < 5 and -40 < ly < -20:
            a = 255
            r, g, b = 230, 228, 220
        # wheels
        for wx, wy in ((-26, -14), (26, -14), (-26, 16), (26, 16)):
            if math.hypot(lx - wx, ly - wy) < 8:
                a = 255
                r, g, b = 36, 34, 32
        if kind == 'loaded' and abs(lx) < 12 and -6 < ly < 14:
            a = 255
            r, g, b = 70, 150, 190
        if kind == 'scout':
            if abs(lx) < 18 and -24 < ly < 22:
                a = 255
                r, g, b = 80, 82, 86
            if abs(lx) < 4 and -38 < ly < -22:
                a = 255
                r, g, b = 255, 138, 31  # accent beacon
        return r, g, b, a

    return fn


def shadow_fn(x, y):
    d = math.hypot(x - 70, y - 78) / 36
    a = max(0, 110 * (1 - d))
    return 0, 0, 0, a


def building_fn(kind: str, constructing: bool):
    def fn(x, y):
        # 256 canvas, 2x2 footprint.
        a = 0
        r = g = b = 0
        # baked shadow blob (down-right, sun upper-left)
        sx, sy = x - 18, y - 22
        if 40 < sx < 210 and 50 < sy < 220:
            d = max(abs(sx - 125) / 90, abs(sy - 140) / 80)
            if d < 1:
                a = max(a, 70 * (1 - d))
                r = g = b = 8
        # pad
        if 36 < x < 220 and 48 < y < 214:
            a = 255
            n = hash01(x, y, 5)
            r, g, b = 150 + n * 12, 144 + n * 10, 136 + n * 8
            if constructing:
                r, g, b = 120, 110, 96
        if kind == 'habitat' and 70 < x < 186 and 70 < y < 190:
            a = 255
            r, g, b = (210, 206, 198) if not constructing else (160, 140, 110)
            if 110 < x < 146 and 78 < y < 118:
                r, g, b = 40, 70, 90  # viewport
        if kind == 'solar':
            if 50 < x < 206 and 60 < y < 200:
                a = 255
                panel = (x + y) % 14 < 7
                r, g, b = (28, 42, 70) if panel else (20, 30, 52)
                if constructing:
                    r, g, b = 70, 72, 78
        if kind == 'printer' and 64 < x < 192 and 72 < y < 200:
            a = 255
            r, g, b = (180, 150, 110) if not constructing else (130, 112, 88)
            if 100 < x < 156 and 100 < y < 150:
                r, g, b = 255, 138, 31
        if kind == 'storage' and 60 < x < 196 and 80 < y < 200:
            a = 255
            r, g, b = (168, 172, 176) if not constructing else (120, 118, 112)
        if kind == 'tunnel-hub' and 72 < x < 184 and 80 < y < 196:
            a = 255
            r, g, b = 64, 66, 70
            if abs(x - 128) < 16 or abs(y - 138) < 16:
                r, g, b = 40, 38, 36
        if constructing and 20 < x < 236 and ((x + y) % 22 < 3):
            r = min(255, r + 40)
            g = min(255, g + 20)
        return r, g, b, a

    return fn


def vault_fn(x, y):
    a = 0
    r = g = b = 0
    if 40 < x < 344 and 50 < y < 340:
        d = max(abs(x - 192) / 160, abs(y - 200) / 150)
        if d < 1:
            a = 255
            r, g, b = 48 + (1 - d) * 20, 46, 50
    return r, g, b, a


def ring_fn(x, y):
    d = abs(math.hypot(x - 64, y - 64) - 48)
    a = max(0, 255 - d * 28) if d < 10 else 0
    return 255, 255, 255, a


def marker_fn(frame: int):
    def fn(x, y):
        cx, cy = 32, 28 + frame
        d = math.hypot(x - cx, y - cy)
        a = 0
        if d < 10:
            a = 230
        # chevron
        if 18 < y < 40 and abs(x - 32) < (40 - y) * 0.7:
            a = max(a, 200)
        return 255, 255, 255, a

    return fn


def icon_fn(kind: str):
    def fn(x, y):
        a = 0
        r = g = b = 255
        if kind == 'ice':
            if math.hypot(x - 32, y - 34) < 18:
                a = 255
                r, g, b = 180, 220, 240
        elif kind == 'regolith':
            if 16 < x < 48 and 18 < y < 50:
                a = 255
                r, g, b = 168, 150, 120
        elif kind == 'power':
            # bolt
            if 22 < x < 42 and 12 < y < 52:
                a = 255
                r, g, b = 255, 200, 60
        else:
            if math.hypot(x - 32, y - 32) < 16:
                a = 255
                r, g, b = 63, 216, 255
        return r, g, b, a

    return fn


def bore_fn(frame: int):
    def fn(x, y):
        ang = math.atan2(y - 64, x - 64) + frame * 0.7
        d = math.hypot(x - 64, y - 64)
        a = 0
        r = g = b = 0
        if 10 < d < 40 + frame * 2:
            if (ang * 3) % (math.pi * 2) < 0.8:
                a = 180
                r, g, b = 255, 180, 80
        return r, g, b, a

    return fn


def notify_fn(frame: int):
    def fn(x, y):
        rad = 12 + frame * 8
        d = abs(math.hypot(x - 64, y - 64) - rad)
        a = max(0, 200 - d * 16 - frame * 20)
        return 63, 216, 255, a

    return fn


def glow_fn(w: int):
    cx = cy = w / 2

    def fn(x, y):
        d = math.hypot(x - cx, y - cy) / (w * 0.48)
        k = max(0.0, 1.0 - d)
        k *= k
        return 255, 186, 90, 200 * k

    return fn


def main() -> None:
    os.makedirs(ROOT, exist_ok=True)
    for i in range(1, 5):
        write_png(os.path.join(ROOT, f'tile-ground-{i}.png'), 128, 128, rgb_buf(128, 128, ground_fn(i)), rgb=True)
    write_png(os.path.join(ROOT, 'tile-crater-s.png'), 128, 128, rgb_buf(128, 128, crater_s_fn), rgb=True)
    write_png(os.path.join(ROOT, 'crater-m.png'), 256, 256, rgba_buf(256, 256, crater_m_fn))
    write_png(os.path.join(ROOT, 'tile-pit.png'), 128, 128, rgb_buf(128, 128, pit_fn), rgb=True)
    write_png(os.path.join(ROOT, 'tile-ice.png'), 128, 128, rgb_buf(128, 128, ice_fn(False)), rgb=True)
    write_png(os.path.join(ROOT, 'tile-ice-mined.png'), 128, 128, rgb_buf(128, 128, ice_fn(True)), rgb=True)
    write_png(os.path.join(ROOT, 'utile-rock-1.png'), 128, 128, rgb_buf(128, 128, rock_fn(1)), rgb=True)
    write_png(os.path.join(ROOT, 'utile-rock-2.png'), 128, 128, rgb_buf(128, 128, rock_fn(2)), rgb=True)
    write_png(os.path.join(ROOT, 'utile-tunnel-h.png'), 128, 128, rgba_buf(128, 128, tunnel_fn('h')))
    write_png(os.path.join(ROOT, 'utile-tunnel-v.png'), 128, 128, rgba_buf(128, 128, tunnel_fn('v')))
    write_png(os.path.join(ROOT, 'utile-tunnel-corner.png'), 128, 128, rgba_buf(128, 128, tunnel_fn('c')))
    write_png(os.path.join(ROOT, 'bg-horizon.png'), 1920, 1080, rgba_buf(1920, 1080, horizon_fn))

    write_png(os.path.join(ROOT, 'hauler.png'), 128, 128, rgba_buf(128, 128, rover_fn('hauler')))
    write_png(os.path.join(ROOT, 'hauler-loaded.png'), 128, 128, rgba_buf(128, 128, rover_fn('loaded')))
    write_png(os.path.join(ROOT, 'scout.png'), 128, 128, rgba_buf(128, 128, rover_fn('scout')))
    write_png(os.path.join(ROOT, 'hauler-shadow.png'), 128, 128, rgba_buf(128, 128, shadow_fn))
    write_png(os.path.join(ROOT, 'scout-shadow.png'), 128, 128, rgba_buf(128, 128, shadow_fn))

    for kind in ('habitat', 'solar', 'printer', 'storage'):
        write_png(os.path.join(ROOT, f'{kind}.png'), 256, 256, rgba_buf(256, 256, building_fn(kind, False)))
        write_png(os.path.join(ROOT, f'{kind}-build.png'), 256, 256, rgba_buf(256, 256, building_fn(kind, True)))
    write_png(os.path.join(ROOT, 'tunnel-hub.png'), 256, 256, rgba_buf(256, 256, building_fn('tunnel-hub', False)))
    write_png(os.path.join(ROOT, 'vault.png'), 384, 384, rgba_buf(384, 384, vault_fn))

    for i in range(6):
        write_png(os.path.join(ROOT, f'bore-{i}.png'), 128, 128, rgba_buf(128, 128, bore_fn(i)))
        write_png(os.path.join(ROOT, f'notify-{i}.png'), 128, 128, rgba_buf(128, 128, notify_fn(i)))
    write_png(os.path.join(ROOT, 'ring-select.png'), 128, 128, rgba_buf(128, 128, ring_fn))
    for i in range(4):
        write_png(os.path.join(ROOT, f'order-marker-{i}.png'), 64, 64, rgba_buf(64, 64, marker_fn(i)))
    for kind in ('ice', 'regolith', 'power', 'notify'):
        write_png(os.path.join(ROOT, f'icon-{kind}.png'), 64, 64, rgba_buf(64, 64, icon_fn(kind)))
    write_png(os.path.join(ROOT, 'glow-unit.png'), 128, 128, rgba_buf(128, 128, glow_fn(128)))
    write_png(os.path.join(ROOT, 'glow-building.png'), 256, 256, rgba_buf(256, 256, glow_fn(256)))
    print('wrote placeholders to', os.path.abspath(ROOT))


if __name__ == '__main__':
    main()
