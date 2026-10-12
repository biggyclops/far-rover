# /v08 sprites (Pixel v2 layout)

Exported at 2×. Draw at 0.5.

- Buildings and `-build` variants: object / shadow / contact on a 360×360 canvas, pivot (112, 112).
- Units: 16-heading sheets, 176×176 frames, pivot (78, 78). Frame i is i × 22.5° clockwise from north.
  Matching shadow sheets — pick the heading frame; never rotate shadows.
- Draw order: all contacts, then all shadows (multiply), then objects sorted by y.
- Use the `-build` variants while a building is under construction.
- Night: `floodlight-pool` additive on the ground before sprites; `status-light` on completed pads.
- Vault art stays the existing underground `assets/v08/art/vault.png`.
