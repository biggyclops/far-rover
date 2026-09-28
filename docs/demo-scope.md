# Far Rover browser demo: scope and spec (for Arcade)

**Status:** design spec only (no code). Written 2026-09-28, based on the paper prototype in `design.md` v0.5 and the kit clarifications in `paper-test/facilitator-guide.md`. You shouldn't need to open either file. Everything the demo needs is below.

**Why it matches the paper test:** the demo uses the same rules, numbers, and fixed 12 × 12 terrain layout as the printable paper test, so results from the two can be compared. Where the demo differs on purpose, section 15 says so.

## 1. Pitch

Build a tiny rover from three sensors and four if-then rules, launch it onto a hidden alien grid, and watch it live or die by the logic you wrote.

## 2. What the demo is for

It tests one question: **is writing rules and watching the rover run fun enough that players voluntarily tweak and rerun?**

- **Main measure:** voluntary reruns. The paper test's go line is at least 2 of 3 testers each rerunning 3 or more times after changing something. The demo's run log (section 12) records what's needed to count that.
- **Second measure:** readability. After a failure, can the player say why it happened? The end screen's failure trace, and an optional "Why do you think that happened?" note, support this.
- **Not a goal:** content, progression, polish, or balance beyond the paper numbers.

## 3. Scope

**In:**
- One fixed 12 × 12 map, hidden until scanned (fog of war).
- A build screen: pick 3 sensors, write up to 4 rules.
- Launch and an operate view with ticks and speed controls.
- Auto-pause, one uplink edit per run, the goal, and an end screen with a failure trace.
- A rerun button that keeps the build, a run counter, and a local run log you can export.

**Out:** printing, STL import, leveling, materials, mass and power budgets, the colony, multiple rovers, launch windows, the test-yard round, sound, and accounts or backend.

**Art:** placeholder shapes and colors are fine. Any real art or sound belongs to Pixel, if it's ever needed.

**Platform:** a single-page static web app for desktop browsers. It works offline, has no server, and uses no randomness anywhere, so the same build always plays out the same way.

## 4. The world

**Grid:** 12 columns (A to L, left to right) by 12 rows (1 to 12, top to bottom). Row 12 is the bottom edge.

**Lander:** it sits just outside the grid, below F12. Treat it as a special cell at column F, row 13. Its only neighbor is F12 (moving north from the lander enters F12, and moving south from F12 enters the lander). It isn't a tile, has no terrain, and is never scanned. The rover starts every run on the lander, facing north.

**Terrain (fixed, identical every run):** 10 craters, 12 ore, 8 dust, and 114 empty tiles.

| Tile | Count | Squares |
|---|---|---|
| Crater | 10 | F8, C10, J9, D6, I6, G3, K4, B2, E1, L11 |
| Ore | 12 | D11, H10, G9, B7, E7, J7, H5, C4, K8, F2, I2, A12 |
| Dust | 8 | F10, G10, B5, B6, C5, J3, J2, K2 |
| Empty | 114 | every other square |

```
      A B C D E F G H I J K L
   1  . . . . C . . . . . . .
   2  . C . . . O . . O D D .
   3  . . . . . . C . . D . .
   4  . . O . . . . . . . C .
   5  . D D . . . . O . . . .
   6  . D . C . . . . C . . .
   7  . O . . O . . . . O . .
   8  . . . . . C . . . . O .
   9  . . . . . . O . . C . .
  10  . . C . . D D O . . . .
  11  . . . O . . . . . . . C
  12  O . . . . . . . . . . .
                L   <- lander (off-grid, below F12)
```
C = crater, O = ore, D = dust, . = empty.

**Fog of war:** every tile starts hidden. A tile is revealed only by scanning (section 6). Revealed tiles stay revealed for the rest of the run, and every tile is hidden again at the start of each run. Drilled ore shows as drilled.

**Keep it hidden:** don't reveal the whole map on the end screen or anywhere else. Players learn the layout only by scanning, as in the paper test.

## 5. The rover

| Property | Value |
|---|---|
| Battery | 20 points = 100 Wh (1 point = 5 Wh). Starts at 20 every run. It can't go below 0. |
| Move 1 tile | 1 point (5 Wh) |
| Move onto a dust tile | 2 points (10 Wh) instead of 1 |
| Move onto or off the lander | 1 point |
| Drill | 2 points (10 Wh), whether or not there's ore |
| Turn in place, wait, no rule matched | 0 |
| Charge | only on the lander, via the "Return and charge" action. It takes 3 ticks, then the battery is set to 20. |
| Cargo | drilled ore count. No limit. Starts at 0. |
| Movement | one tile per tick, up, down, left, or right, never diagonally |
| Facing | north, east, south, or west. "In front" means the neighboring cell in the facing direction. |

**If the battery is short:** if an action costs more than what's left, it still happens and the battery becomes 0.

**Paper numbers on purpose:** the full game design uses different energy numbers. This demo deliberately uses the paper test's numbers above. Don't change them.

## 6. Sensors and scanning

The player picks **exactly 3 of these 4 sensors** for each run. The **battery sensor is always installed** and doesn't count toward the 3. (The rover also always carries a drill, which is why there are only 3 picks.)

| Sensor | Game part | Reading each tick | Allows |
|---|---|---|---|
| Distance | HC-SR04 | "Crater in front": is the cell in front a crater? (Off-map or the lander counts as no.) Works on hidden tiles. | Condition "Crater in front" |
| Dust | GP2Y1010 | "On dust": is the rover's own tile dust? | Condition "On a dust tile" |
| Spectral | AS7341 | "Ore next to rover": does any of the 4 neighboring tiles hold undrilled ore? (Say which direction.) "On ore": is the rover's own tile undrilled ore? Works on hidden tiles. | Conditions "Ore next to rover" and "On an ore tile", and the action "Go to ore" |
| Camera | OV2640 | No reading. It changes scanning. | Nothing in the rule editor |
| Battery (always) | INA219 | The battery points (show Wh too) | Condition "Battery below N" |

**Scanning:**
- Every time the rover ends a move on a grid tile, that tile is revealed.
- With the camera, the 3 × 3 area centred on the rover is revealed instead (clipped at the map edges).
- Moving onto the lander scans nothing. Scanning is free.
- **Tiles scanned** = the number of revealed grid tiles, including craters and dust.

**Sensors, not eyes:** rules can only use installed sensors. A crater the camera has revealed doesn't stop the rover unless a rule with the distance sensor does. No action avoids craters on its own.

## 7. Rules

**Format:** there are 4 rule slots, numbered 1 to 4. Each rule is **one condition** and **one action**, with no AND and no nesting. Empty slots are skipped.

**First match:** every tick (unless charging), the rules are checked from slot 1 down, and the first rule whose condition is true runs its action. If none is true, the rover does nothing that tick.

**Legality:**
- A condition or action that needs a sensor can only be used if that sensor is installed.
- The editor only offers legal choices.
- If a sensor change between runs makes a rule illegal, mark that rule and disable Launch until it's fixed.

### Conditions

| Condition | Needs | True when |
|---|---|---|
| Battery below N (N = a whole number, 1 to 20) | always available | battery points < N |
| Crater in front | Distance | the cell in front is a crater |
| On a dust tile | Dust | the rover's tile is dust |
| Ore next to rover | Spectral | any of the 4 neighboring tiles is undrilled ore |
| On an ore tile | Spectral | the rover's tile is undrilled ore |
| Always | none | every tick (use it as "otherwise") |

### Actions

"Closer" uses step distance: |column difference| + |row difference|. The lander counts as column F, row 13, and is reachable only through F12. A **valid neighbor** is an on-grid cell, or the lander when moving south from F12 (and F12 when moving north from the lander).

| Action | Needs | Cost | Exact behavior |
|---|---|---|---|
| **Explore** | none | 1 per move (2 onto dust); 0 to turn | Target: the nearest hidden grid tile (smallest step distance; ties don't matter, only the distance does). Let D = the rover's current distance to the nearest hidden tile. (1) If the cell in front is a valid neighbor and its distance to the nearest hidden tile is less than D, move forward. (2) Otherwise, check right, then left, then back (relative to facing), and turn to face the first valid neighbor that's closer. Don't move this tick. (3) If there are no hidden tiles left, do nothing. |
| **Return and charge** | none | 1 per move (2 onto dust); 0 to turn or charge | If the rover is on the lander, start charging. This tick is charge tick 1, the next two ticks are charge ticks 2 and 3, rules aren't checked while charging, and at the end of charge tick 3 the battery is set to 20. Otherwise, use the same forward, right, left, back stepping as Explore, with the lander as the target. |
| **Sidestep** | none | 1 (2 onto dust) | Move to the neighbor on the rover's right. If that isn't valid, move to the one on its left. Facing doesn't change. If neither is valid, do nothing. The distance sensor doesn't check this cell. |
| **Go to ore** | Spectral | 1 | Check front, right, left, back for a neighboring undrilled ore tile. Move onto the first one found and face that way. If there's none, do nothing. |
| **Drill** | none | 2 | If the rover's tile is undrilled ore, mark it drilled and add 1 to cargo. Otherwise nothing happens, but the 2 points are still spent. |
| **Wait** | none | 0 | Do nothing this tick. |

**Rule highlight reason strings** (one line per tick), for example:
- "Rule 1: battery 5 < 8 → Return and charge: moved to G12"
- "Rule 2: crater in front (F8) = yes → Sidestep: moved to G9"
- "Rule 3: ore next to rover = yes (east) → Go to ore: moved to H10"
- "Rule 4: always → Explore: turned east"
- "No rule matched: rover did nothing"
- "Charging (2 of 3)"

## 8. Tick order

Each tick runs these steps in order:

1. **Charging?** If the rover is charging, advance the charge tick (end of tick 3: battery = 20, charging ends), log it, and skip to the next tick. Charging ticks don't count toward the stuck rules.
2. **Sense:** compute the readings of every installed sensor (section 6) and update the live readouts.
3. **Hazard auto-pause check:** if an installed sensor detects a crater or dust tile for the first time this run, auto-pause *before* the rules run (section 10). When play resumes, continue this same tick at step 4. Any uplink edit made during the pause applies at step 4.
4. **Rules:** find the first matching rule and show the highlight line.
5. **Act:** do the action and subtract its cost from the battery (floor 0).
6. **Scan:** if the rover moved onto a grid tile, reveal the tile, or the 3 × 3 area with the camera.
7. **End checks, in this order:**
   1. The rover is on a crater: **lost (crater)**.
   2. The battery is 0 and the rover isn't on the lander: **lost (battery)**.
   3. The rover is on the lander and (tiles scanned ≥ 30 or cargo ≥ 3): **success**.
   4. The stuck rules (section 9).
8. **Record:** add the tick to the trace: tick number, position, facing, readings, rule fired and reason, action result, battery, tiles scanned, and cargo.

**Speed:** 1× = 1 tick per second, 4× = 4 per second, 16× = 16 per second, or pause. Auto-pause stops play at any speed, and resuming returns to the previous speed.

## 9. How a run ends

- **Success:** the rover is on the lander with 30 or more tiles scanned, or with 3 or more drilled ore in cargo. There's no "goal met" condition, so the rover only comes home if a rule sends it.
- **Lost (crater):** the rover moved onto a crater, known or hidden.
- **Lost (battery):** the battery hit 0 while the rover was off the lander. A rover on the lander with 0 battery isn't lost, but moving off with 0 loses it.
- **Stuck** (all three are checked every tick after the end checks; charging ticks are ignored):
  - **No move:** 3 ticks in a row without the rover changing cell. Turning, waiting, drilling, no rule matching, and actions with no valid move all count. Any move resets the count.
  - **Charge twice:** a new charge starts while the rover hasn't left the lander since the previous charge started.
  - **Loop:** since the last *progress* (a newly revealed tile or a drilled ore), the rover has moved into the same cell with the same facing for the 3rd time. Only ticks where the rover actually moved count. Progress clears the loop memory.
- **On stuck:** auto-pause with a "Stuck" banner that names which stuck rule fired. If the uplink is still unused, the player may use it (section 11). That clears the stuck counters, and the run continues. Otherwise, or if the player chooses **End run**, the run ends as stuck.
- **Abort:** the player may end any run early with **End run**. It's logged as aborted.

## 10. Auto-pause

Play pauses automatically, at any speed, when:
1. **A hazard first comes into sensor view.** This is checked at step 3 of each tick, and each hazard tile triggers only once per run. It counts as coming into view when:
   - The distance sensor reads a crater in front.
   - The dust sensor reads that the rover is on dust.
   - The camera revealed a crater or dust tile during the previous tick's scan.

   The banner names the sensor and tile, for example "Distance sensor: crater in front (F8)". A still-hidden detected tile may be outlined during the pause, but it stays hidden.
2. **Stuck** (section 9).

While paused, the player can resume, change speed, or use the uplink.

## 11. Uplink

- One edit per run, only while paused (manual pause or auto-pause).
- The edit changes **one rule slot**: its condition, its action (and N), or both, or it fills an empty slot. The player can't reorder rules, clear a slot, or change sensors mid-run.
- The edit takes effect at the next rule check. After an auto-pause, that's the same tick.
- Once used, the uplink shows as used until the next run. Log the tick, slot, and before → after.

## 12. Screens and flow

1. **Title:** the pitch, the goal ("Scan 30 tiles and return to the lander, or drill 3 ore and return"), and a Start button.
2. **Build screen:**
   - **Sensors:** 4 sensor toggles (exactly 3 must be on). Battery is shown as always installed, and the drill as always fitted.
   - **Rules:** 4 rule slots with a condition dropdown (including N) and an action dropdown.
   - **Reference:** one line per condition and action, taken from the section 7 tables.
   - **Launch:** a button, enabled when exactly 3 sensors are picked, at least 1 rule exists, and all rules are legal.
   - **First run:** the slots start empty and sensors unpicked (like the paper test).
   - **Later runs:** the build screen opens with the last build.
3. **Operate view:**
   - **Map:** fog of war, the rover with a facing arrow, the lander, and the current run number.
   - **Rule list:** the fired rule highlighted, plus the reason line.
   - **Live sensor readouts:** installed sensors show values; uninstalled ones show a greyed "?".
   - **Status:** a battery meter showing points and Wh, tiles scanned out of 30, and cargo out of 3.
   - **Controls:** pause, 1×, 4×, 16×; the uplink control (enabled only while paused and unused); and End run.
4. **End screen:**
   - **Result:** the outcome headline and reason, for example "Lost: drove into a crater at F8 on tick 5".
   - **Stats:** ticks, tiles scanned, cargo, battery, and whether the uplink was used.
   - **Failure trace:** the last 5 ticks from step 8 (rule fired with reason, readings, action result, battery).
   - **Note:** an optional one-line "Why do you think that happened?" field, saved to the log.
   - **Buttons:** **Rerun** returns to the build screen with the same sensors and the rules as they ended, including any uplink edit, ready to tweak and relaunch. **View log** opens the log.
5. **Run counter:** the operate and end screens show "Run N" for the current session.

## 13. Run log (local, exportable)

Save every run to browser local storage automatically, so the log survives a reload.

**Per run:**
- Session ID, optional tester label, and run number within the session.
- Started and ended (local date and time), real duration in seconds, and seconds since the previous run ended.
- Ticks, sensors picked, and the rules at launch (text).
- **Changes from the previous run:** sensors added or removed, and rule slots changed (before → after). Include a changed yes/no flag.
- Uplink: tick, slot, and before → after, or "none".
- Outcome: success-scan, success-ore, lost-crater, lost-battery, stuck-no-move, stuck-charge, stuck-loop, or aborted. Also the end reason text.
- Tiles scanned, cargo, battery at end, the number of auto-pauses, and the optional "why" note.
- A **prompted** yes/no toggle, off by default. The observer can switch it on if they suggested the rerun.

**Log panel:**
- The table of runs.
- A session summary: total runs, **voluntary reruns with a change** (runs 2 and later with changed = yes and prompted = no), reruns with no change, and a "3 or more voluntary reruns: yes or no" line.
- Buttons: **Copy as CSV**, **Download CSV**, **Download JSON**, **New tester** (starts a new session with a new ID and optional label), and **Clear log** (asks for confirmation).

## 14. First minute of play

1. The player opens the demo, reads the one-line pitch and goal, and presses Start.
2. On the build screen, they pick Distance, Spectral, and Camera, then write one rule: "Always → Explore". They press Launch.
3. Run 1 starts on the lander, facing north. At 1×:
   - **Tick 1:** "Rule 1: always → Explore: moved to F12". The camera reveals the 3 × 3 area around F12, and the battery is 19.
   - **Tick 2:** the rover moves to F11 (battery 18). The camera reveals dust at F10 and G10.
   - **Start of tick 3:** auto-pause, "Camera: dust at F10, G10". The player resumes, and the rover moves onto F10, paying 2 for dust (battery 16).
   - **Tick 4:** F9 (battery 15). The camera reveals a crater at F8.
   - **Start of tick 5:** auto-pause, "Distance sensor: crater in front (F8)". This is the moment of tension.
4. If the player resumes without using the uplink, the rover drives into F8: "Lost: drove into a crater at F8 on tick 5". The failure trace shows "crater in front = yes" on the last tick, with rule 1 (Always → Explore) firing anyway.
5. The player presses Rerun, adds "Crater in front → Sidestep" **above** the Explore rule, and launches Run 2. The whole loop takes about a minute.

## 15. Intentional differences from the paper test

1. **Readouts:** live readouts show every installed sensor every tick. On paper, the rover player announces only the readings a rule checked.
2. **Auto-pause:** the demo auto-pauses on hazards and on stuck. On paper, stuck simply ends the run. In the demo, the player gets one chance to use an unused uplink.
3. **Loop rule:** the "going in circles" rule is exact (section 9) instead of the facilitator's judgement.
4. **No test yard:** there's no test-yard round, and no 40-minute session limit.
5. **Measurement:** reruns are counted per tester session. There's no facilitator by default, so a rerun counts as voluntary unless the observer toggles prompted.

## 16. Acceptance criteria

Arcade can check each item. The expected results in A to G come from the rules above. Positions are after the tick's action.

**Setup and build:**
1. The map matches the section 4 table exactly (10 craters, 12 ore, 8 dust, 114 empty), and every tile is hidden at the start of each run.
2. The rover starts every run on the lander (below F12), facing north, with battery 20, cargo 0, 0 tiles scanned, and the uplink unused.
3. Launch is disabled unless exactly 3 sensors are picked, at least 1 rule exists, and every rule is legal. "Crater in front" needs Distance, "On a dust tile" needs Dust, and "Ore next to rover", "On an ore tile" and "Go to ore" need Spectral.
4. The rules are first-match from slot 1, and a tick with no match does nothing.

**Scenarios:**
5. **Scenario A** (Distance, Spectral, Camera; rule 1: Always → Explore):
   - Ticks 1 to 4 end at F12, F11, F10, F9, with battery 19, 18, 16, 15 and tiles scanned 6, 9, 12, 15.
   - Auto-pauses happen at the start of tick 3 (dust F10, G10) and the start of tick 5 (crater F8).
   - Tick 5: lost (crater) at F8, battery 14, 18 tiles scanned.
6. **Scenario B** (Distance, Dust, Spectral; rule 1: Always → Explore):
   - It ends at F12, F11, F10, F9, then F8 on ticks 1 to 5. The battery ends at 14 and 5 tiles are scanned.
   - Auto-pauses happen at the start of tick 4 (dust sensor, F10) and the start of tick 5 (crater F8).
   - Result: lost (crater) on tick 5.
7. **Scenario C** (Distance, Dust, Spectral; rule 1: Crater in front → Sidestep; rule 2: Always → Explore):
   - Tick 5 sidesteps from F9 to G9 (battery 14), and tick 11 sidesteps from G4 to H4 at crater G3.
   - Result: lost (battery) on tick 21 at L2, with 19 tiles scanned.
8. **Scenario D** (Distance, Dust, Spectral; rule 1: Battery below 20 → Return and charge; rule 2: Always → Explore):
   - Tick 2 turns south at F12 without moving, and tick 3 moves onto the lander (battery 18).
   - Ticks 4 to 6 charge, and the battery is 20 after tick 6.
   - Result: stuck (loop) on tick 15 at F12, facing north.
9. **Scenario E** (Distance, Spectral, Camera; rule 1: Battery below 8 → Return and charge; rule 2: Crater in front → Sidestep; rule 3: Ore next to rover → Go to ore; rule 4: Always → Explore): success (scan) on tick 23, on the lander with battery 1, 32 tiles scanned, and cargo 0.
10. **Scenario F** (Scenario B, but at the tick-5 auto-pause the uplink rewrites rule 1 to "Crater in front → Sidestep"): tick 5 moves to G9, ticks 6 to 8 match no rule, and the run pauses as stuck (no move) on tick 8. The uplink is now used, so the only option is End run.
11. **Scenario G** (Scenario B plus rule 2: Always → Wait; at the tick-5 pause the uplink rewrites rule 2 to "Crater in front → Sidestep"): lost (crater) on tick 5, because rule 1 still fires first. This checks first-match.

**Uplink, trace, rerun, log:**
12. The uplink allows exactly one edit per run, only while paused, can't reorder rules or change sensors, and is available again on the next run.
13. The end screen shows the outcome and the last 5 ticks of trace. Rerun opens the build screen with the same sensors and the rules as they ended.
14. The run counter increments on each launch. The log records every field in section 13, survives a page reload, and exports to CSV and JSON. The session summary counts voluntary reruns with a change correctly: a rerun with no change, or one marked prompted, isn't counted.
15. The game is deterministic: the same build and the same uplink edit at the same tick give the same result every time, at every speed.

## 17. Questions Arcade may decide

- Layout of the build and operate screens, and whether the map and rule list sit side by side or stacked.
- Controls: dropdowns or drag-and-drop for rules, and keyboard shortcuts (for example, space to pause).
- Whether to add a "step one tick" button while paused. It would help readability.
- How the rover moves between ticks (a snap or a short slide), and how to show turns and charging.
- Placeholder visuals: colors and shapes for hidden and revealed tiles, the rover, the lander, and the outline for a detected hidden tile.
- How the failure trace looks (a table or a list), and whether earlier ticks can be expanded.
- Framework, file structure, and the local storage key name.
- Whether the "why" note appears on every end screen or only after losses.
