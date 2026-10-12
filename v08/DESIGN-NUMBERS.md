# Game Designer answers, 2026-10-10 (all "Proposed", tune after playtests)
Approved: milestones, /v08/, direct engine import with no-drift test, all cuts (no traffic, straight tunnels, no borer class, no home programs, demo build screen for scout).
Art: realistic painted, sun upper-left long shadows, night = whole-board tint, one player accent color, one neutral/warning color for unconfirmed finds/hazards/Notify ping, scout has small beacon mark.
1 Notify: action, uses the tick, rover holds; pings once per new find; repeat with nothing new = Wait; conditions from existing sensors.
2 Ice: paper-map ore tiles = ice. Confirm = scout on ice tile and Notify fires (no sample/drill). First confirm unlocks Deep Ice node on the base map ~22 tiles from start storage (8 past the command ring). Drill on F2/I2 only samples.
3 Numbers: map 40x40; command range radius 14 from habitat; Deep Ice ~22 tiles from start storage, 200 ice. Start: habitat (stores 120 power, 30 ice), 2 haulers, 1 rim solar, 80 regolith, 20 ice, 100 power. Shallow ice patch 25, no regrow.
Hauler: 1 tile/s, carries 10, battery 100, drain 1/tile loaded 0.5 empty, mines 1/s (regolith any plain ground, ice on ice tiles), charges 10/s at habitat or adjacent solar. Each hauler draws 0.3 power/s upkeep; at 0 stored power printers and charging pause, but haulers keep driving on their own batteries.
Rim solar 30 reg, 10s, +5 power/s day, 0 night. Storage 30 reg, 10s, holds 100 ice + 200 reg. Printer 40 reg, 15s; prints hauler 25 reg + 10 power, 30s.
Tunnel: hub 20 reg, 10s each, ≥6 tiles apart; a hub may sit next to Deep Ice after unlock. Dig 20 s/tile per rover (rovers stack), 3 power/tile, yields 2 reg/tile; cargo hub-to-hub at 4 tiles/s, no rover. Vault 40 reg, holds 150 ice underground.
Goal: 180 ice + 50 power in storage at once -> "Land crew" button. Win screen: time, logistics (haulers only vs tunnel), #Notifies, #patches.
Approved 2026-10-11: Set B (goal 180, dig 24 s/tile) plus haulerCarry 15.
Approved 2026-10-11 (post-#28 retune): `haulerUpkeepPowerPerSec` 0.3, `habitatPowerCapacity` 120, `printerHaulerSeconds` 30.
Approved 2026-10-11 (post-#32 r2 retune): `haulerCarry` 15 → 10, `digSecondsPerTilePerRover` 24 → 20. Smallest two-knob set that meets all five GD criteria after Deep Ice moved 8 past the ring. Extra printed haulers were too good on the 22-tile walk (print-2 at 4:58, tunnel only 2.7% faster). Carry 10 + dig 20: print-1 7:28 beats two starters 7:52; 2-digger tunnel 5:45 is 22.9% faster than the best hauler route. First night is at 1:30 (`startDaylightRemainingSec` 90). Deep Ice distance left at 22 — farther nodes made the far hub / corridor fail.
Patch delay 2 s, 1 patch per sol. Recall: scout drives home on own engine, ends expedition, no refund, confirmed finds stay.
4 Sol: 6 min at 1x = 4 min day + 2 min night. Sol 1 starts with 90 s of daylight.

## Pixel, 2026-10-10
- Player accent: `#FF8A1F` (tint `ring-select.png`, player UI).
- Neutral/warning: `#3FD8FF` — only for unconfirmed finds, hazards, and the Notify ping.
- Night is a whole-board tint with no moving shadows.
- Unit shadows: `hauler-shadow` / `scout-shadow` rotate with the rover; the offset stays screen-space at +6,+6 (128 px) / +3,+3 (64 px game zoom) so the light never moves. Building shadows are baked in.
- Full art set (57 files): use `ring-select` and `order-marker-0..3` tinted `#FF8A1F`; HUD icons `icon-ice/regolith/power` (white, plus `-orange` copies); night glows additive (`glow-building` at ~50% alpha). M2/M3 files are in the manifest: tunnel-hub, vault, utile-*, bore-0..5 + bore-sheet, notify-0..5, icon-notify.
- SFX batch 1 lives in `assets/v08/sfx/`. Do not renormalize. Start audio after the first gesture; mute toggle on the HUD. Prefer `.ogg` for `dig-loop` and play it on a Web Audio `AudioBufferSourceNode` with `loop = true` (M2).
