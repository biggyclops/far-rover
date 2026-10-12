# Far Rover v0.8 realism ground

Real lunar south-pole terrain for the 40x40 map (64 px tiles, 2560x2560 world px), graded to match the approved v2 realism mockup.

## Source and credit
- Imagery: **NASA/GSFC/Arizona State University** (LROC). Public domain. In-game credit line: `Imagery: NASA/GSFC/Arizona State University (LROC NAC)`.
- Product ID: **NAC_POLE_SOUTH_CM_345_P892S1350**. This is the LROC South Pole Controlled NAC Subsolar Longitude 340-350 deg mosaic, 1 m/px polar stereographic, tile centred 89.2S 135.0E.
  - Product page: https://wms.lroc.asu.edu/lroc/view_rdr_product/NAC_POLE_SOUTH_CM_345_P892S1350
  - Data read: the browse pyramid `.../EXTRAS/BROWSE/NAC_POLE/NAC_POLE_SOUTH_CM_345/NAC_POLE_SOUTH_CM_345_P892S1350.PYR.TIF` (PDS LRO-L-LROC-5-RDR-V1.0, LROLRC_2001), using HTTP range reads.
  - Citation: Wagner, Speyerer, Robinson and LROC Team (2015), *New Mosaicked Data Products from the LROC Team*, LPSC 46, #1473.
- Placement: the source window is full-res mosaic px x 15920-21680, y 520-6280. It was rotated 30 deg CCW so the sun comes from the upper left (shadows fall to the lower right) and resampled at 1.0 m/px. The map's world (0,0) is rotated-frame pixel (1542, 610), which is mosaic px about (18842, 1011). The map centre is about mosaic px (19311, 2760), on the cratered plain about 10-13 km from the pole near the Shackleton connecting ridge.
- No-data: 5,725 px (0.09%) in the top-right corner (world x 2473-2559, y 0-130). It was filled with a feathered donor patch of real terrain from 150 m south under the same lighting. No black wedge remains.
- Scripts: `art-src/realism/search_map.py` (placement search), `make_ground_assets.py`, `export_ground.py`, `make_map_data.py`.

## Scale
- 1 world px = 1.0 m. 1 tile = 64 m. The map is 2.56 x 2.56 km.
- The sun is about 1-2 deg high from the upper left. The shadows are real, and PSR / shadowed floors are true black.

## Files
| file | size | use |
|---|---|---|
| ground-day-2560.png | 2560x2560 RGB | full map, day. v2 grading plus the unified photo pass (0.3 px optical blur, mild unsharp, S tone curve, fixed-seed grain, faint pushbroom column pattern). No vignette, no sprites, no tracks, no dust apron. Includes a faint frost glint on the shallow-ice PSR floor only. |
| ground-day-r{row}-c{col}.png | 25 x 512x512 | the same image in chunks (see below) |
| ground-day-1280.png | 1280x1280 | half res, for low-end or zoomed-out use (draw at 2x) |
| minimap-256.png | 256x256 | minimap (1 px = 10 m) |
| ground-night-2560.png | 2560x2560 RGB | the same layout at night: Earthshine blue-grey fill, open ground median about 11% display, deep/black floors about 3%. **No floodlights baked in** (the game draws light pools at runtime). The relief is a soft photoclinometric proxy that keeps only strong features, with the low-amplitude ripple field removed. |
| ground-night-r{row}-c{col}.png | 25 x 512x512 | night chunks |
| ground-night-1280.png | 1280x1280 | half-res night |
| map-data.json | | gameplay data (schema below) |
| map-data-preview.png | 1280x1280 | the ground with grid classes tinted, detected craters circled, and config features marked (green = suggested move) |

## Chunk scheme
- Each chunk is 512x512 px = 8x8 tiles. There are 5 rows x 5 columns. `r` = row (y), `c` = column (x), both 0-based.
- Chunk (r,c) covers world px x `[c*512, c*512+512)`, y `[r*512, r*512+512)`, and tiles x `8c .. 8c+7`, y `8r .. 8r+7`.
- The chunks are exact crops of the 2560 image, so they are seamless. Draw each at world `(c*512, r*512)`.

| | c0 (tiles x 0-7) | c1 (8-15) | c2 (16-23) | c3 (24-31) | c4 (32-39) |
|---|---|---|---|---|---|
| r0 (tiles y 0-7) | r0-c0 | r0-c1 | r0-c2 | r0-c3 | r0-c4 (deep ice 37,7) |
| r1 (8-15) | r1-c0 | r1-c1 | r1-c2 (solar 16,14) | r1-c3 | r1-c4 |
| r2 (16-23) | r2-c0 | r2-c1 | r2-c2 (habitat 18,18; haulers row 21) | r2-c3 (shallow ice 25,16) | r2-c4 |
| r3 (24-31) | r3-c0 | r3-c1 | r3-c2 | r3-c3 | r3-c4 (crater-m 33,24) |
| r4 (32-39) | r4-c0 | r4-c1 | r4-c2 | r4-c3 | r4-c4 |

## map-data.json schema
- `version`, `map_tiles` [40,40], `tile_px` 64, `world_px` [2560,2560], `meters_per_px` 1.0, `sun`
- `classes`: description of each tile class
- `grid`: 40 rows (y) x 40 cols (x) of class strings, indexed `grid[ty][tx]`. Classes:
  - `open`: flat-ish sunlit regolith (buildable/drivable)
  - `crater_rim`: the rim/wall band (0.6-1.2 r) of a real crater with r >= 0.5 tile
  - `crater_floor`: inside a real crater, not mostly black
  - `psr`: more than 50% of the tile is black (permanently shadowed) floor
  - `steep`: the top 8% of local relief, or partly shadowed slopes
  - Priority when overlapping: psr > crater_floor > crater_rim > steep > open
- `grid_rows`: the same grid as 40 strings, with legend in `grid_legend` (`.` open, `r` rim, `f` floor, `P` psr, `s` steep)
- `class_counts`
- `craters[]`: `id`, `center_tile` [tx,ty] (fractional tile index; `round()` gives the tile), `center_px`, `radius_tiles`, `radius_px`, `shadow_frac` (black share of the disc), `psr_floor` (bool, black floor), `touches_map_edge`. These are detected from the real shadows: under a low upper-left sun, the shadow width across the sun axis = the crater diameter. Sorted largest first.
- `config_features[]`: `feature`, `kind` (building/unit/ice/crater_s/pit/crater_m), `config_tile`, `footprint`, `source` (config key or game.js line), `terrain_here` (classes under the footprint), `black_fraction`, `lines_up` (buildings/units: all open; ice/craters/pits: any psr or crater_floor), and when relevant `real_crater`, `crater_center_tile`, `crater_radius_tiles`, `suggested_tile`, `blackest_neighbour_tile`.
- `recommended_config_moves[]`: `feature`, `from_tile`, `to_tile`, `real_crater`
- `recommended_config_tweaks[]`: config value changes (deep ice)
- `notes`, `placement`

## Placement results
- habitat (start) (18, 18): open/steep, black 1%, does NOT line up
- solar (start) (16, 14): open, black 1%, lines up
- hauler start A (18, 21): open, black 0%, lines up
- hauler start B (20, 21): open, black 0%, lines up
- shallow ice (25, 16): psr, black 63%, lines up; real crater C19 at (25.5, 16.4), r 0.81 tiles
- deep ice (scout target) (37, 7): crater_floor, black 43%, lines up; real crater C11 at (36.9, 7.0), r 1.09 tiles
- crater-s (8,8) (8, 8): open, black 0%, does NOT line up; real crater C32 at (9.2, 4.6), r 0.66 tiles -> suggest (9, 5)
- crater-s (32,10) (32, 10): open, black 0%, does NOT line up; real crater C44 at (32.9, 12.6), r 0.49 tiles -> suggest (33, 13)
- crater-s (6,28) (6, 28): open, black 0%, does NOT line up; real crater C50 at (4.3, 29.3), r 0.42 tiles -> suggest (4, 29)
- crater-s (30,32) (30, 32): open, black 0%, does NOT line up; real crater C61 at (31.4, 31.6), r 0.35 tiles -> suggest (31, 32)
- crater-s (22,8) (22, 8): psr, black 77%, lines up; real crater C24 at (22.1, 8.0), r 0.76 tiles
- crater-s (10,22) (10, 22): open, black 0%, does NOT line up; real crater C38 at (12.9, 19.9), r 0.56 tiles -> suggest (13, 20)
- pit (12,30) (12, 30): crater_floor, black 9%, lines up; real crater C92 at (12.3, 29.8), r 0.22 tiles
- pit (28,28) (28, 28): open, black 0%, does NOT line up; real crater C46 at (27.9, 25.8), r 0.46 tiles -> suggest (28, 26)
- crater-m (33,24) (33, 24): crater_floor/crater_rim/psr, black 26%, lines up; real crater C30 at (34.3, 24.8), r 0.69 tiles
- Recommended tweak: config.deepIceTilesFromStartStorage 22 -> 21 puts the deep ice on (36,7), 75% black floor of C11.
- Note: the habitat flag comes from one 'steep' tile (19,18), which is rough relief only (1% black). The pad is flat, sunlit plain, and no move is needed.
