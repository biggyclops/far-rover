# Far Rover v0.8 art, batch 1 (terrain, units, buildings)

Made from generated photo sources (art-src/photo/), processed by the scripts in art-src/
(terrain.py, key.py, units.py, buildings.py). Everything is straight top-down.

## Lighting
Harsh white sun from the UPPER LEFT. Shadows are pure black and fall to the LOWER RIGHT.
Regolith is neutral grey (ground tiles have a mean of 118/255, R=G=B). The ground source was mirrored so its
rock shadows match this. Crater, pit and ice sources already matched.

## Colour rules
- Player accent: orange #FF8A1F, used on everything the player owns. Kept from the sources' own small orange
  accents (hauler cab light bar, scout rear hitch, building fittings). No other team colours were added.
  The scout's beacon and the dashed construction outline use exactly #FF8A1F.
- Reserved neutral/warning colour for UNOWNED things (unconfirmed finds, hazards, Notify): cyan #3FD8FF.
  Not used in this batch. Keep it free of player art.

## Terrain (128x128, RGB, drawn at 64px on screen)
Every tile shares the same outer border band (the outer 5px are identical within 2/255, then a blend over
5-24px), so ANY terrain tile can sit next to ANY other with no seam.
| file | size | use |
|---|---|---|
| tile-ground-1.png ... tile-ground-4.png | 128x128 RGB | plain regolith variants; pick at random per cell |
| tile-crater-s.png | 128x128 RGB | small 1-tile crater (decor / blocking) |
| tile-pit.png | 128x128 RGB | shadowed pit (tunnel/vault entrance candidate) |
| tile-ice.png | 128x128 RGB | ice deposit: black shadowed floor with blue-white frost |
| tile-ice-mined.png | 128x128 RGB | same tile once mined: frost scraped off, dig scars and tread marks; border and rim identical to tile-ice |
| crater-m.png | 256x256 RGBA | 2x2 crater overlay. Outer edge feathered to transparent; draw it ON TOP of ground tiles |
| bg-horizon.png | 1920x1080 RGB | backdrop with Earth upper left (Lanczos upscale plus light unsharp mask) |

## Units (128x128 RGBA, front points NORTH/up, pivot = image centre)
| file | size | use |
|---|---|---|
| hauler.png | 128x128 RGBA | empty hauler, about 112px long, about 8px margin. Lifted for readability at 64px (midtones and local contrast raised, plus a 1-2px light rim on the upper-left edges) |
| hauler-loaded.png | 128x128 RGBA | loaded hauler, pixel-aligned with hauler.png (same scale and offset, same lift), so you can swap them |
| scout.png | 128x128 RGBA | scout, about 84px long (75% of the hauler). Orange #FF8A1F beacon on the mast head at the front, about (64,28) |
| hauler-shadow.png | 128x128 RGBA | soft black silhouette of the hauler at about 55% opacity, not offset |
| scout-shadow.png | 128x128 RGBA | soft black silhouette of the scout at about 55% opacity, not offset |

Shadow drawing: draw the shadow first, offset by **+6, +6 px at 128 scale** (+3, +3 at the 64px game zoom)
toward the lower right. The offset is in SCREEN space and never rotates. Rotate the shadow SPRITE with the unit
so its outline matches the vehicle. Then draw the unit on top at the unoffset position.

## Buildings (256x256 RGBA = 2x2 tile footprint, drawn at 128px on screen)
Each building is about 234px across, shifted about 4px up and left of centre, so the baked shadow fits inside the canvas.
The shadow is baked in: black at about 60% opacity, offset +11, +11 px (at 256 scale) toward the lower right.
| file | size | use |
|---|---|---|
| habitat.png | 256x256 RGBA | habitat dome (roughly round, airlock tube at the bottom) |
| solar.png | 256x256 RGBA | rim solar array |
| printer.png | 256x256 RGBA | regolith printer |
| storage.png | 256x256 RGBA | storage tanks |
| habitat-build.png, solar-build.png, printer-build.png, storage-build.png | 256x256 RGBA | under construction (about 40%): desaturated; only the lower 40% and the outer ring are solid; the rest is a 12% ghost under a light-grey scaffold grid; dashed orange #FF8A1F footprint outline |

## Notes
- The sources were actually 1280x720, not 1024x576.
- Previews: art-src/preview-board.png (game zoom) and art-src/preview-sprites.png (full size on a checkerboard).

---
# Batch 3: underground and logistics

Underground tiles share their own border band (the bedrock border; the outer 4px are identical across every
underground tile except at the tunnel mouths), so any underground tile can sit next to any other. Surface and
underground tiles are not meant to sit side by side.

| file | size | use |
|---|---|---|
| tunnel-hub.png | 256x256 RGBA | surface tunnel hub, 2x2 footprint. Keyed and fitted like the buildings (about 234px), with the black shaft in the centre and the same baked shadow (black at about 60% opacity, +11,+11 at 256 scale, lower right) |
| vault.png | 384x384 RGBA | underground vault cutaway (3x3 tiles), about 370px wide. No cast shadow; the rocky outer rim is kept. Its entrance tunnel is at the bottom centre |
| utile-rock-1.png, utile-rock-2.png | 128x128 RGB | seamless dark charcoal bedrock (mean about 50/255) |
| utile-tunnel-h.png | 128x128 RGB | straight bored tunnel, west to east |
| utile-tunnel-v.png | 128x128 RGB | straight bored tunnel, north to south |
| utile-tunnel-corner.png | 128x128 RGB | corner connecting the EAST and SOUTH edges. **The code rotates it for the other corners** (90 deg CW = south-west, 180 = west-north, 90 deg CCW = north-east) |
| bore-0.png ... bore-5.png | 128x128 RGBA | 6-frame looping tunnel-boring effect, top-down: a 6-spoke cutter head about 62px across (fits the 56px tunnel) with disc cutters, plus a ring of dust and rock chips and a faint warm glow. Turns 10 deg per frame (1/6 of its 60 deg symmetry), so frame 5 leads straight back into frame 0 |
| bore-sheet.png | 768x128 RGBA | the 6 bore frames as a horizontal strip, frame 0 on the left |

Tunnel construction: about 56px wide, with concrete-lined walls (joints every 32px), a smooth concrete floor, and a centred
conveyor (dark belt with rollers between two light rails). Warm wall lights sit on both walls at 32 and 96 px
along the tunnel. The tunnel profile is the same at every mouth (centred, 56px), so h, v and the corner in any
rotation chain together.

# Batch 4: UI and FX (drawn in code at 4x, then downsampled)

Colour rules: player accent orange #FF8A1F; neutral/warning cyan #3FD8FF for unowned things (unconfirmed finds,
hazards, Notify). The white assets are pure white (RGB 255 everywhere) with the shape in the alpha channel, so
multiply-tinting gives exactly the tint colour.

| file | size | use |
|---|---|---|
| ring-select.png | 128x128 RGBA | WHITE selection ring (the code tints it orange): a circle of radius 54 with 4 tick gaps at N/E/S/W plus small tick marks and a soft outer glow. Draw it centred on the unit at the unit's scale |
| order-marker-0.png ... order-marker-3.png | 64x64 RGBA | WHITE (the code tints it) 4-frame ground marker: a chevron in a ring, with an outer pulse ring that expands and fades. Frame 3 to frame 0 restarts the pulse. Suggested 8-10 fps |
| icon-ice.png, icon-regolith.png, icon-power.png | 64x64 RGBA | WHITE flat glyphs (droplet with crystal, rock pile, lightning bolt) with the same 4.5px stroke; readable at 32px |
| icon-ice-orange.png, icon-regolith-orange.png, icon-power-orange.png | 64x64 RGBA | the same glyphs pre-tinted #FF8A1F |
| notify-0.png ... notify-5.png | 128x128 RGBA | CYAN #3FD8FF map ping: a centre diamond beacon (gently pulsing) plus 3 phase-offset rings that expand and fade; loops seamlessly |
| icon-notify.png | 64x64 RGBA | CYAN Notify icon (diamond beacon in rings) |
| glow-unit.png | 128x128 RGBA | warm-white #FFE9C4 floodlight. Colour is constant; the falloff is all in the alpha channel (peak about 0.9, reaching 0 at the edge). Draw additively, centred under the unit, at night |
| glow-building.png | 256x256 RGBA | the same, centred under a 2x2 building. Scale its intensity in code if it is too strong |

Additive use: dest += rgb * alpha * intensity. The night preview used intensity 0.85 over a scene darkened to about 25%.
