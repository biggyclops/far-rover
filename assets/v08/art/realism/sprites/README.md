# Far Rover v0.8 realism sprites (relit-v2, 0.7x look)

Based on the approved v2 mockup (`art-src/realism-mockup-day-v2.png`) and the relit-v2 **0.7x** set.
Generators: `art-src/make_sprites.py`, `art-src/make_decals.py`, `art-src/sprites_preview.py` (they use `art-src/sprlib.py`, the relit-v2 lighting code).

## @2x
Every file is **@2x**. Draw everything at **scale 0.5**. One tile is 128 px in these files (64 px on screen).
Buildings are about 164 px objects here, so about 82 px on screen, the same size as in the mockup.

## Lighting and draw order
There is one hard, low sun from the upper left. Shadows always fall toward the **lower right** and are baked per asset. Never rotate a shadow.
For each building or unit, draw all three layers at the same pivot:
1. **contact**: normal alpha blend (rgb is black, the darkness is in alpha)
2. **shadow**: multiply, `dst *= 1 - shadow.alpha` (rgb is black)
3. **object**: normal alpha blend (straight, not premultiplied alpha)

Ground decals (dust-apron, tracks, frost-glint) go under all of these. At night, draw floodlight-pool and status-light additively on top.
For y-sorting, draw all contacts and shadows first, then the objects sorted by pivot y. That way a shadow never darkens a neighbouring object.

## Buildings: habitat, solar, storage, printer, tunnel-hub
Files: `<name>.png`, `<name>-shadow.png`, `<name>-contact.png` and the construction variant `<name>-build.png`, `<name>-build-shadow.png`, `<name>-build-contact.png`.

| | value (px @2x) |
|---|---|
| canvas (all 6 files of every building) | 360 x 360 |
| object box in canvas | offset (22,22), size 180 x 180 |
| **pivot** | **(112,112)** = the centre of the 2x2-tile footprint |
| footprint | 2x2 tiles = 256 x 256, centred on the pivot (the 0.7x object covers about 164 px of it) |

Shadow lengths are listed in anchors.json: habitat 145, storage 137, printer 90, solar 67 and tunnel-hub 56 px. The build variants cast about half of that.
Each build variant is about 40% built: the lower front band and the perimeter are solid. The rest is a desaturated ghost at 12% alpha with a pale scaffold lattice, which casts thin shadows. A dashed, muted #FF8A1F outline runs around the footprint box. The variants use the same relit pass (blur and grain) as the built sprites.

## Units: hauler, hauler-loaded, scout
Files: `<unit>-sheet.png` (object) and `<unit>-shadow-sheet.png` (shadow). Each is **16 frames in one row**, 2816 x 176. There is also one shared `unit-contact.png` (176 x 176).

* Frame size: **176 x 176**. Frame i is at x = i*176.
* **Pivot in each frame: (78,78)**. This is the unit's centre. The object sits in a 112 px box at (22,22).
* Heading convention: frame i = heading **i*22.5 deg clockwise from north** (screen up). 0 = north, 4 = east, 8 = south and 12 = west. Pick the frame with `frame = round(heading/22.5) mod 16`. Do not rotate the sprite.
* The shadow frames are lit with the fixed sun, so they always fall toward the lower right. The shadows are about 36 px for the haulers and 52 px for the scout (it is taller).
* `unit-contact.png` is a rotation-averaged blob drawn at the same pivot. Use scale 0.5 for haulers and 0.4 (0.5 x 0.8) for the scout.
* The orange accents are muted paint: the haulers have the cab accent and the scout has its beacon. They stay readable at 0.5.

## Runtime decals (all @2x, normal alpha, grey rgb with the effect in alpha)
| file | size | notes |
|---|---|---|
| `track-decal-0/45/90/135.png` (`track-decal.png` = the -0 version) | 256 x 96, pivot (128,48) | Twin wheel ruts with berms (light on the sun side, dark on the far side). Each **tiles seamlessly along x** with a 256 px period. Each version is pre-lit for its rotation. For a route at angle a (deg clockwise from east, **mod 180**), use the nearest version and rotate it by a. Wobble, depth and patchy fading vary along the length, and the contrast is kept low on purpose. |
| `track-curve-0/90/180/270.png` (`track-curve.png` = the -0 version) | 256 x 256 | A quarter turn with a centreline radius of 128 (1 tile). Each is **pre-rotated and pre-lit: draw it unrotated**. -0 joins the left edge (0,128) to the bottom edge (128,256). Each of the others is that shape turned clockwise by the angle in its name. |
| `dust-apron.png` | 768 x 768, pivot (384,384) | A soft, blotchy, terrain-like scuff field centred under the base, about 6x6 tiles on screen. It has faint rut arcs and boot prints. |
| `frost-glint.png` | 256 x 256, pivot (128,128) | Centre it on an ice tile and mask it to the black floor (luma < 0.05). It is the same art as relit-v2. |

## Night
| file | size | blend |
|---|---|---|
| `floodlight-pool.png` | 512 x 512, pivot (256,256) | **Additive**: `dst += rgb * alpha * k`. The rgb is a constant warm #FFE9C4. Alpha is 1/(1+(r/34)^2), windowed to 0 at r = 256, with a hot core. Draw it at 0.5 under each building (k about 0.9), or smaller under units. |
| `status-light.png` | 32 x 32, pivot (16,16) | Additive. It is an orange #FF8A1F glow with a warm-white core. Draw it at 0.5 at a building or unit accent. |

## UI (unchanged)
The select ring (`ring-select.png`), `ice-marker.png`, `pulse-ring-0..5.png`, `order-marker-*`, `notify-*`, `hint-arrow-*`, `check*`, `step-dot*` and the `icon-*` files are **unchanged**. Keep using them from `art/`.

## Other files
* `anchors.json`: canvas, object offset, pivot, footprint, frames, headings and draw order for each asset (machine readable).
* `preview.png`: the preview is composited at game zoom on a crop of `art/realism/ground/ground-day-2560.png` (crop at 520,860). It shows all buildings, the build variants, each unit at 4 headings, tracks, the apron and frost. A night inset sits below. The night inset only demonstrates the additive lights. It is not a real night pass.
