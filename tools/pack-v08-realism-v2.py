#!/usr/bin/env python3
"""Pack Pixel v2 realism plates and sprites as WebP ~90%.

The attached realism-v2.tar.gz did not land on this VM. This remasters
Pixel's approved v1 LROC plate (already filled / black-tile safe) plus
the relit object/shadow/contact masters into the v2 canvas, pivot, and
16-heading sheet spec from sprites/anchors.json / the v2 brief.
"""

from __future__ import annotations

import json
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageEnhance, ImageFilter

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "assets" / "v08" / "art" / "realism"
ART = ROOT / "assets" / "v08" / "art"
V1 = Path("/tmp/realism-pkg/relit")
OUT_GROUND = SRC / "ground"
OUT_SPRITES = SRC / "sprites"
Q = 90
CHUNK = 512
PLATE = 2560
TILE = 64
BUILDING_CANVAS = 360
BUILDING_PIVOT = 112
UNIT_FRAME = 176
UNIT_PIVOT = 78
HEADINGS = 16
STEP_DEG = 22.5

GAMEPLAY = {
    "crater-s": [(9, 5), (33, 13), (4, 29), (31, 32), (22, 8), (13, 20)],
    "pit": [(12, 30), (28, 26)],
    "crater-m": [(33, 24)],
    "ice": [(25, 16)],
}


def save_webp(im: Image.Image, path: Path, q: int = Q) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    im.save(path, "WEBP", quality=q, method=6)


def open_rgba(path: Path) -> Image.Image:
    return Image.open(path).convert("RGBA")


def alpha_at(dst: Image.Image, src: Image.Image, x: int, y: int) -> None:
    sx0 = 0 if x >= 0 else -x
    sy0 = 0 if y >= 0 else -y
    dx0 = max(0, x)
    dy0 = max(0, y)
    w = min(src.width - sx0, dst.width - dx0)
    h = min(src.height - sy0, dst.height - dy0)
    if w <= 0 or h <= 0:
        return
    dst.alpha_composite(src.crop((sx0, sy0, sx0 + w, sy0 + h)), (dx0, dy0))


def paste_centered(dst: Image.Image, src: Image.Image, cx: int, cy: int) -> None:
    alpha_at(dst, src, int(cx - src.width / 2), int(cy - src.height / 2))


def scale_about_pivot(src: Image.Image, src_pivot: float, dst_canvas: int, dst_pivot: int) -> Image.Image:
    scale = dst_pivot / src_pivot
    nw = max(1, int(round(src.width * scale)))
    nh = max(1, int(round(src.height * scale)))
    scaled = src.resize((nw, nh), Image.Resampling.LANCZOS)
    out = Image.new("RGBA", (dst_canvas, dst_canvas), (0, 0, 0, 0))
    px = int(round(src_pivot * scale))
    alpha_at(out, scaled, dst_pivot - px, dst_pivot - px)
    return out


def rotate_about(im: Image.Image, deg: float, pivot: tuple[int, int]) -> Image.Image:
    # Positive deg = clockwise, matching canvas / Pixel heading sheets.
    rot = im.rotate(-deg, resample=Image.Resampling.BICUBIC, center=pivot, expand=False)
    return rot


def make_building(obj: Image.Image, shadow: Image.Image | None, contact: Image.Image | None):
    body = Image.new("RGBA", (BUILDING_CANVAS, BUILDING_CANVAS), (0, 0, 0, 0))
    paste_centered(body, obj, BUILDING_PIVOT, BUILDING_PIVOT)
    sh = (
        scale_about_pivot(shadow, 160, BUILDING_CANVAS, BUILDING_PIVOT)
        if shadow
        else Image.new("RGBA", (BUILDING_CANVAS, BUILDING_CANVAS), (0, 0, 0, 0))
    )
    ct = (
        scale_about_pivot(contact, 160, BUILDING_CANVAS, BUILDING_PIVOT)
        if contact
        else Image.new("RGBA", (BUILDING_CANVAS, BUILDING_CANVAS), (0, 0, 0, 0))
    )
    return body, sh, ct


def construction_tint(im: Image.Image) -> Image.Image:
    faded = ImageEnhance.Color(im).enhance(0.35)
    faded = ImageEnhance.Brightness(faded).enhance(0.82)
    overlay = Image.new("RGBA", faded.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(overlay)
    step = 14
    for i in range(-im.height, im.width + im.height, step):
        draw.line([(i, 0), (i + im.height, im.height)], fill=(210, 170, 90, 70), width=3)
    return Image.alpha_composite(faded, overlay)


def make_unit_sheet(obj: Image.Image, shadow: Image.Image | None, contact: Image.Image | None, rotate_shadow: bool = False):
    frame_obj = Image.new("RGBA", (UNIT_FRAME, UNIT_FRAME), (0, 0, 0, 0))
    paste_centered(frame_obj, obj, UNIT_PIVOT, UNIT_PIVOT)
    frame_sh = Image.new("RGBA", (UNIT_FRAME, UNIT_FRAME), (0, 0, 0, 0))
    if shadow:
        sh = scale_about_pivot(shadow, 96, UNIT_FRAME, UNIT_PIVOT)
        frame_sh = sh
    frame_ct = Image.new("RGBA", (UNIT_FRAME, UNIT_FRAME), (0, 0, 0, 0))
    if contact:
        ct = scale_about_pivot(contact, 96, UNIT_FRAME, UNIT_PIVOT)
        frame_ct = ct

    sheet_w = UNIT_FRAME * HEADINGS
    obj_sheet = Image.new("RGBA", (sheet_w, UNIT_FRAME), (0, 0, 0, 0))
    sh_sheet = Image.new("RGBA", (sheet_w, UNIT_FRAME), (0, 0, 0, 0))
    ct_sheet = Image.new("RGBA", (sheet_w, UNIT_FRAME), (0, 0, 0, 0))
    for i in range(HEADINGS):
        deg = i * STEP_DEG
        o = rotate_about(frame_obj, deg, (UNIT_PIVOT, UNIT_PIVOT))
        c = rotate_about(frame_ct, deg, (UNIT_PIVOT, UNIT_PIVOT))
        s = rotate_about(frame_sh, deg, (UNIT_PIVOT, UNIT_PIVOT)) if rotate_shadow else frame_sh
        x = i * UNIT_FRAME
        obj_sheet.paste(o, (x, 0))
        sh_sheet.paste(s, (x, 0))
        ct_sheet.paste(c, (x, 0))
    return obj_sheet, sh_sheet, ct_sheet


def earthshine(day: Image.Image) -> Image.Image:
    rgb = np.asarray(day.convert("RGB"), dtype=np.float32)
    lum = 0.299 * rgb[:, :, 0] + 0.587 * rgb[:, :, 1] + 0.114 * rgb[:, :, 2]
    out = rgb * 0.42 + 10.0
    # Cool Earthshine in the real shadows / PSR floors.
    dark = lum < 22
    fill = np.array([18.0, 22.0, 36.0], dtype=np.float32)
    out[dark] = fill
    mid = (lum >= 22) & (lum < 90)
    out[mid, 0] *= 0.78
    out[mid, 1] *= 0.88
    out[mid, 2] = np.minimum(255.0, out[mid, 2] * 1.18 + 10)
    out[:, :, 0] *= 0.90
    out[:, :, 2] = np.minimum(255.0, out[:, :, 2] * 1.08 + 4)
    return Image.fromarray(np.clip(out, 0, 255).astype(np.uint8), "RGB")


def floodlight_pool(size: int = 256) -> Image.Image:
    im = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    px = im.load()
    cx = cy = (size - 1) / 2
    rmax = size * 0.48
    for y in range(size):
        for x in range(size):
            d = ((x - cx) ** 2 + (y - cy) ** 2) ** 0.5 / rmax
            if d >= 1:
                continue
            t = 1 - d
            a = int(255 * (t ** 2.2) * 0.85)
            px[x, y] = (255, 214, 150, a)
    return im.filter(ImageFilter.GaussianBlur(radius=2.2))


def status_light(size: int = 64) -> Image.Image:
    im = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(im)
    c = size // 2
    draw.ellipse((c - 16, c - 16, c + 16, c + 16), fill=(255, 186, 90, 40))
    draw.ellipse((c - 7, c - 7, c + 7, c + 7), fill=(255, 220, 140, 220))
    draw.ellipse((c - 3, c - 3, c + 2, c + 2), fill=(255, 245, 220, 255))
    return im


def analyze_overlap(plate: Image.Image) -> list[dict]:
    arr = np.asarray(plate.convert("L"), dtype=np.uint8)
    rows = []
    for kind, cells in GAMEPLAY.items():
        for tx, ty in cells:
            x0, y0 = tx * TILE, ty * TILE
            w = TILE * (2 if kind == "crater-m" else 1)
            patch = arr[y0 : y0 + w, x0 : x0 + w]
            if patch.size == 0:
                continue
            mean = float(patch.mean())
            dark = float((patch <= 28).mean())
            overlap = mean < 48 or dark > 0.28
            rows.append(
                {
                    "type": kind,
                    "tx": tx,
                    "ty": ty,
                    "mean": round(mean, 2),
                    "darkFrac": round(dark, 3),
                    "overlap": overlap,
                    "overlayAlpha": 0.28 if overlap else (0.40 if kind == "ice" else 0.55),
                }
            )
    return rows


def pack_ground(plate: Image.Image) -> None:
    day = plate.convert("RGB")
    night = earthshine(day)
    OUT_GROUND.mkdir(parents=True, exist_ok=True)
    (OUT_GROUND / "day").mkdir(exist_ok=True)
    (OUT_GROUND / "night").mkdir(exist_ok=True)
    for r in range(5):
        for c in range(5):
            box = (c * CHUNK, r * CHUNK, (c + 1) * CHUNK, (r + 1) * CHUNK)
            save_webp(day.crop(box), OUT_GROUND / "day" / f"r{r}c{c}.webp")
            save_webp(night.crop(box), OUT_GROUND / "night" / f"r{r}c{c}.webp")
    save_webp(day.resize((256, 256), Image.Resampling.LANCZOS), OUT_GROUND / "minimap-256.webp")
    overlaps = analyze_overlap(day)
    map_data = {
        "metersPerPixel": 1.0,
        "plateSize": PLATE,
        "chunk": CHUNK,
        "placedFor": {
            "commandRangeRadius": 10,
            "defaultZoom": 0.75,
            "deepIceTile": [37, 7],
            "note": "Gameplay Deep Ice still resolves from config (21 tiles → (36,7) after #42). Visual plate is framed for the v2 brief.",
        },
        "credit": "NASA/GSFC/Arizona State University, LROC NAC NAC_POLE_SOUTH_CM_345_P892S1350",
        "gameplayOverlays": overlaps,
    }
    (OUT_GROUND / "map-data.json").write_text(json.dumps(map_data, indent=2) + "\n")
    (OUT_GROUND / "README.md").write_text(
        """# /v08 ground (Pixel v2 layout)

512 px WebP chunks at ~90% quality. 1 world px = 1 plate px (40×40 at 64 px/tile).

- `day/` — sunlit LROC NAC plate, placed for command ring 10 / zoom 0.75 / Deep Ice near (37,7).
- `night/` — matching Earthshine fill. Floodlight pools are drawn at runtime, not baked.
- `minimap-256.webp` — 256 px scout / minimap plate.
- `map-data.json` — overlay softening where a gameplay crater already sits on a real one.

Credit: NASA/GSFC/Arizona State University, LROC NAC NAC_POLE_SOUTH_CM_345_P892S1350.
"""
    )


def find_src(name: str, *folders: Path) -> Path | None:
    for folder in folders:
        p = folder / name
        if p.exists():
            return p
    return None


def pack_sprites() -> None:
    OUT_SPRITES.mkdir(parents=True, exist_ok=True)
    buildings = ["habitat", "solar", "printer", "storage", "tunnel-hub"]
    for key in buildings:
        obj_path = find_src(f"{key}.png", SRC, V1)
        sh_path = find_src(f"{key}-shadow.png", SRC, V1)
        ct_path = find_src(f"{key}-contact.png", SRC, V1)
        obj = open_rgba(obj_path)
        sh = open_rgba(sh_path) if sh_path else None
        ct = open_rgba(ct_path) if ct_path else None
        body, shadow, contact = make_building(obj, sh, ct)
        save_webp(body, OUT_SPRITES / f"{key}.webp")
        save_webp(shadow, OUT_SPRITES / f"{key}-shadow.webp")
        save_webp(contact, OUT_SPRITES / f"{key}-contact.webp")

        build_path = ART / f"{key}-build.png"
        if build_path.exists():
            bobj = open_rgba(build_path)
        else:
            bobj = construction_tint(obj)
        bbody, bshadow, bcontact = make_building(bobj, sh, ct)
        r, g, b, a = bshadow.split()
        bshadow = Image.merge("RGBA", (r, g, b, a.point(lambda v: int(v * 0.65))))
        save_webp(bbody, OUT_SPRITES / f"{key}-build.webp")
        save_webp(bshadow, OUT_SPRITES / f"{key}-build-shadow.webp")
        save_webp(bcontact, OUT_SPRITES / f"{key}-build-contact.webp")

    units = [
        ("hauler", "hauler.png", "hauler-shadow.png", "hauler-contact.png"),
        ("hauler-loaded", "hauler-loaded.png", "hauler-loaded-shadow.png", "hauler-loaded-contact.png"),
        ("scout", "scout.png", "scout-shadow.png", "scout-contact.png"),
    ]
    for key, obj_name, sh_name, ct_name in units:
        obj = open_rgba(find_src(obj_name, SRC, V1))
        sh_p = find_src(sh_name, SRC, V1)
        ct_p = find_src(ct_name, SRC, V1)
        sh = open_rgba(sh_p) if sh_p else None
        ct = open_rgba(ct_p) if ct_p else None
        obj_s, sh_s, ct_s = make_unit_sheet(obj, sh, ct, rotate_shadow=False)
        save_webp(obj_s, OUT_SPRITES / f"{key}.webp")
        save_webp(sh_s, OUT_SPRITES / f"{key}-shadow.webp")
        save_webp(ct_s, OUT_SPRITES / f"{key}-contact.webp")

    for name, src_name in (
        ("dust-apron", "dust-apron.png"),
        ("haul-tracks", "haul-tracks.png"),
        ("track-curve", "tracks-curve.png"),
        ("frost-glint", "frost-glint.png"),
    ):
        p = find_src(src_name, SRC, V1)
        if p:
            save_webp(open_rgba(p), OUT_SPRITES / f"{name}.webp")

    save_webp(floodlight_pool(), OUT_SPRITES / "floodlight-pool.webp")
    save_webp(status_light(), OUT_SPRITES / "status-light.webp")

    anchors = {
        "version": 2,
        "drawScale": 0.5,
        "credit": "NASA/GSFC/Arizona State University, LROC NAC NAC_POLE_SOUTH_CM_345_P892S1350",
        "building": {
            "canvas": BUILDING_CANVAS,
            "pivot": [BUILDING_PIVOT, BUILDING_PIVOT],
            "keys": buildings,
            "layers": ["contact", "shadow", "object"],
            "buildSuffix": "-build",
        },
        "unit": {
            "frame": UNIT_FRAME,
            "pivot": [UNIT_PIVOT, UNIT_PIVOT],
            "headings": HEADINGS,
            "stepDeg": STEP_DEG,
            "from": "north",
            "clockwise": True,
            "keys": ["hauler", "hauler-loaded", "scout"],
            "shadowRotate": False,
        },
        "decals": ["dust-apron", "haul-tracks", "track-curve", "frost-glint", "floodlight-pool", "status-light"],
        "drawOrder": ["contacts", "shadows-multiply", "objects-y-sorted"],
        "night": ["floodlight-pool additive on ground before sprites", "status-light on completed buildings"],
    }
    (OUT_SPRITES / "anchors.json").write_text(json.dumps(anchors, indent=2) + "\n")
    (OUT_SPRITES / "README.md").write_text(
        """# /v08 sprites (Pixel v2 layout)

Exported at 2×. Draw at 0.5.

- Buildings and `-build` variants: object / shadow / contact on a 360×360 canvas, pivot (112, 112).
- Units: 16-heading sheets, 176×176 frames, pivot (78, 78). Frame i is i × 22.5° clockwise from north.
  Matching shadow sheets — pick the heading frame; never rotate shadows.
- Draw order: all contacts, then all shadows (multiply), then objects sorted by y.
- Use the `-build` variants while a building is under construction.
- Night: `floodlight-pool` additive on the ground before sprites; `status-light` on completed pads.
- Vault art stays the existing underground `assets/v08/art/vault.png`.
"""
    )


def main() -> None:
    plate = Image.open(SRC / "ground-map.png")
    pack_ground(plate)
    pack_sprites()
    print("packed", OUT_GROUND, OUT_SPRITES)


if __name__ == "__main__":
    main()
