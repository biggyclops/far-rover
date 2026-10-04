# Far Rover photo-real art set (reskin)

Target look: `reskin/gameplay-mockup-v2-realism.png`. All PNGs are final. Source scripts and intermediates are in `/workspace/far-rover/art-src/`.

## Lighting (applies to every file)
One sun, **from the upper left of the screen** (world north-west), **40° elevation**, warm white (about 1.0 / 0.86 / 0.70) plus a dim butterscotch sky fill.
**Shadows fall to the lower right** on the tiles, the sprites, and the backdrop. The tiles are shaded top-down. The sprites are rendered with a
fixed camera at a 50° downward pitch (3/4 top-down) looking north, and the same sun. Only the model is rotated between facings,
so the lighting never rotates with the rover.

## Files

| File | Size | Mode | Use |
|---|---|---|---|
| tile-ground-1.png | 256×256 | RGB | Plain regolith, variant 1 (scattered pebbles) |
| tile-ground-2.png | 256×256 | RGB | Plain regolith, variant 2 (fewer pebbles, faint wind ripples) |
| tile-ground-3.png | 256×256 | RGB | Plain regolith, variant 3 (pebblier, light ripples) |
| tile-dust.png | 256×256 | RGB | Dust tile. A soft, fine, lighter dust drift fades in toward the centre; the edges are plain ground. |
| tile-ore.png | 256×256 | RGB | Ore tile: a dark, fractured, crystalline outcrop with specular glints and loose dark fragments |
| tile-ore-drilled.png | 256×256 | RGB | The same tile after drilling: ore removed, a circular bore hole, and a ring of grey drill tailings. Byte-identical to tile-ore outside the outcrop (the 24 px border band is identical). |
| tile-crater.png | 256×256 | RGB | Sunken crater bowl (about 190 px across). The upper-left inner wall is in shadow and the lower-right inner wall is lit. |
| rover-n.png / rover-e.png / rover-s.png / rover-w.png | 256×256 | RGBA | One six-wheel rover (rocker-bogie, solar deck, mast camera, stowed drill) facing N/E/S/W. Transparent, with a soft, semi-transparent warm contact shadow toward the lower right that fades out before the frame edge. Centre it on the tile. |
| lander.png | 384×384 | RGBA | Four-legged lander with a dish. Same camera, sun, and shadow treatment. Spans about 1.5 tiles; place it below F12. |
| bg-horizon.png | 1920×1080 | RGB | Backdrop behind and around the board: hazy butterscotch sky, a low sun at the upper left, soft hazy ridgelines with the horizon at y≈300, and a calm perspective plain in the centre |
| icon-battery.png | 64×64 | RGBA | HUD: battery (orange outline, white charge bars) |
| icon-ore.png | 64×64 | RGBA | HUD: ore / cargo (crystal pair) |
| icon-uplink.png | 64×64 | RGBA | HUD: uplink (mast and radio arcs) |
| icon-distance.png | 64×64 | RGBA | Sensor: distance (HC-SR04) |
| icon-dust.png | 64×64 | RGBA | Sensor: dust (GP2Y1010) |
| icon-spectral.png | 64×64 | RGBA | Sensor: spectral (AS7341), a prism |
| icon-camera.png | 64×64 | RGBA | Sensor: camera (OV2640) |

## Tiling notes
* Every tile is periodic by construction, and all 7 tiles share one common border band (about 14 to 58 px in from each edge, blended),
  so **any tile can sit next to any other tile with no seam**. Shadows are computed with wrap-around, so the lighting is continuous across edges too.
* For empty squares, mix ground-1/2/3 with a fixed per-cell pattern (no randomness is needed). One tile repeated alone shows its pattern.
* The tiles are straight top-down. Apply the board tilt in the game (for example a CSS 3D transform). Sprites are pre-rendered at 3/4 view and should not be tilted.

## Icons
Drawn in code at 4× (256 px) and downsampled to 64 px. One stroke weight (about 3.75 px at 64). Orange #F0782A, white #FFFFFF, no background.

## Scale
Rover sprites are about 125 px/m and the lander about 115 px/m. The rover reads at about 0.6 of a tile, and the lander body at about 1.3 tiles with its legs.
