# Far Rover v0.8 balance report

Headless harness under `v08/balance/`. It imports the real `createGame()` sim and the real scout engine (`v08/engine.js` → `simulation.js`). Strategies issue only player orders: place, build, print, dig, haul, charge, launch scout, land crew. No `setResources`, teleports, or forced completes.

```bash
node v08/balance/run.js                  # current numbers, all strategies
node v08/balance/run.js --overrides '{"goalIceInStorage":180}'
node v08/balance/run.js --strategy tunnel-2-diggers --goal-ice-in-storage 180
node v08/balance/run.js --report         # rewrite this file + chart.png
```

Overrides mutate the live `CONFIG` object for one run and restore it after. `startHaulers` is hardcoded to 2 inside `bootstrap()`; the harness applies that override after create, so the documented start-count key still sweeps. Deep Ice distance is `deepIceTilesFromStartStorage`, mapped onto `commandRangeRadius` (the ring the sim actually uses; 22 → 14 keeps today’s placement). Sol length scales day/night 4:2 unless those are set too.

## Harness is 1x only

The live page integrates at `dt = 1/60` (`v08/main.js` `advance`). Player 2 measured the same scripted route at **44.8 s (1x), 45.4 s (4x), and 47.2 s (16x)** — speed changes the result. The harness therefore defaults to a fixed 1x step (`dt = 1/60`) and must not be run at 4x or 16x when the numbers are meant to match a 1x playtest. Every table in the Set B follow-up below was produced at that step.

The first-search A/B/C tables farther down were recorded at `dt = 1/20` before that lock. Shape and ranking match the 1x rerun; exact seconds differ by a couple of ticks.

## Shipped set (2026-10-11, post-#28): upkeep 0.3 + habitat 120 + print 30s

Fix-list #28 added haul instincts, a 4-tile no-mine radius, 1x/16x determinism, `haulerUpkeepPowerPerSec` (default 0), hosted Notify option (b), and `confirmDepositTiles: ['F2','I2']`. This pass updates harness strategies for that loop and retunes on top of live B + carry 15.

| Key | Was (live after #27) | Shipped | Why |
|---|---:|---:|---|
| `haulerUpkeepPowerPerSec` | 0 | 0.3 | Main lever for criterion 4. Top of the 0.05–0.3 band. |
| `habitatPowerCapacity` | 200 | 120 | Floor of GD’s 120–200 range. With 0.3 upkeep, the 1-digger tunnel dips to 48. |
| `printerHaulerSeconds` | 20 | 30 | Section 5 print *time* only. Keeps print-1 after first night so it still beats two starters without a sub-4:00 win. |

Two knobs never hit 5/5: print-30s alone misses 4 (and the 20% band); upkeep 0.3 + cap 120 alone leaves print-1 at 3:45 (fails 3 and 5). Section 5’s 50-reg / 20-power print loses criterion 1 once night upkeep is on. `haulerMinePerSecond` 0.25 stretches every route past 8 minutes and is not shipped.

### 1x route table (dt = 1/60)

| Strategy | Win | Night | Power min | Ice |
|---|---:|:---:|---:|---:|
| Haulers only (2 start) | 6:45 | yes | 0 | 185 |
| Haulers + print 1 | 6:12 | yes | 0 | 203.1 |
| Haulers + print 2 | 6:55 | yes | 0 | 200 |
| Tunnel, 1 digger | timeout | yes | 48 | 170 |
| Tunnel, 2 diggers | 4:26 | yes | 100.1 | 180 |
| Mixed (1 hauls, 1 digs) | 5:19 | yes | 69.4 | 180 |

Best haulers-only: **Haulers + print 1** at 6:12.
Best tunnel: **Tunnel, 2 diggers** at 4:26 (**28.4% faster**).

### Five criteria

| # | Criterion | Result |
|---|---|---|
| 1 | Haulers + print 1 beats haulers only | **Pass.** 6:12 vs 6:45. |
| 2 | Tunnel with 2 diggers is 20–35% faster than the best haulers-only route including prints | **Pass.** 28.4% (4:26 vs 6:12). |
| 3 | Every winning route crosses at least one night | **Pass.** |
| 4 | Power drops below 50 on at least one tunnel route | **Pass.** 1-digger tunnel `powerMin` 48 (timeout at 170 ice; home hub still pulls a full vault). Mixed dips to 69.4; 2-digger wins at 4:26 so it never sees a long night. |
| 5 | No route wins under 4:00 | **Pass.** Earliest win is 4:26. |

### Printer spam (10 min)

Keep-printing run at the shipped knobs: power hits 0, printers pause while starved, hauler count caps at **16** (solar 5/s ÷ upkeep 0.3). Not unbounded.

### Scout (hosted tick, Notify option b)

Paper map through `runHostedScoutTick`. Hazard auto-pauses waste one tick then continue (same as a player hitting Resume).

- **Starter + On ice: Notify** does **not** unlock Deep Ice. Ends `success-scan` at **Lander on tick 46** (resume) / **tick 48** (live page, no resume). Two trace-ice pings (G9, E7). Never stands on F2 or I2.
- **4-rule that confirms:** crater → sidestep; battery below **8** → return/charge; on ore → notify; always → explore. **F2 on tick 16, confirmed tick 17** (under GD’s ~60). Battery-below-20 loops at F12 because start/restore battery is 20 (`battery < 20` after one tile). Highest N that confirms is 8 (N=5..8 work).
- **Simple programs:** **0 / 49** one-rule and **0 / 2401** two-rule programs confirm F2/I2. You need sidestep + notify + explore, and the battery-return *turn* at H3 is what steers onto F2.

## Shipped set (2026-10-11): B + `haulerCarry` 15

Game Designer approved Set B (`goalIceInStorage` 180, `digSecondsPerTilePerRover` 24) and asked for the smallest extra change that meets five criteria. **No set met all five.** Per GD: ship B plus the single knob that meets the most. That knob is `haulerCarry` 10 → 15 (3 of 5).

| Key | Was (pre-#25 Proposed) | Shipped | Why |
|---|---:|---:|---|
| `goalIceInStorage` | 60 | 180 | Set B. 60 ice is two trips; 180 is a logistics contract that crosses first night. |
| `digSecondsPerTilePerRover` | 6 | 24 | Set B. Keeps the committed 2-digger line in the 20–35% band and past 4:00. |
| `haulerCarry` | 10 | 15 | Single extra knob. Makes the 2-digger tunnel 29.2% faster than the best haulers-only route (two starters). |

Everything else stays Proposed (Game Designer). Comments on those keys are unchanged.

### 1x route table (dt = 1/60)

| Strategy | Win | Night | Power min | Ice |
|---|---:|:---:|---:|---:|
| Haulers only (2 start) | 6:02 | yes | 37.3 | 220 |
| Haulers + print 1 | 6:04 | yes | 30.8 | 220 |
| Haulers + print 2 | 6:06 | yes | 19 | 215 |
| Tunnel, 1 digger | 5:49 | yes | 100.1 | 180 |
| Tunnel, 2 diggers | 4:16 | yes | 100.1 | 180 |
| Mixed (1 hauls, 1 digs) | 5:31 | yes | 100.1 | 180 |

Best haulers-only: **Haulers only (2 start)** at 6:02.
Best tunnel: **Tunnel, 2 diggers** at 4:16 (**29.2% faster**).

### Five criteria

| # | Criterion | Result |
|---|---|---|
| 1 | Haulers + print 1 beats haulers only | **Fail.** Print-1 is 6:04 vs two starters at 6:02. The printer building (40 reg / 15 s) plus idle-during-build dominates the extra carry. Cheaper/faster print knobs in the allowed range do not flip this. |
| 2 | Tunnel with 2 diggers is 20–35% faster than the best haulers-only route including prints | **Pass.** 29.2% (4:16 vs 6:02). Carry 11–14 shrinks or wrecks the gap (carry 12 makes plus-2 the best hauler route and drops advantage to ~5%). |
| 3 | Every winning route crosses at least one night | **Pass.** Night starts at 4:00. Earliest win is 4:16. |
| 4 | Power drops below 50 on at least one tunnel route | **Fail.** Tunnel `powerMin` stays 100.1. Player 2 confirmed the base has **no idle power draw**. Dig spend (3–6 / tile) is small and happens in day, so solar replaces it. **Criterion 4 needs a power-draw mechanic** (`haulerUpkeepPowerPerSec` or equivalent). It is not reachable with Set B plus one of the allowed knobs. |
| 5 | No route wins under 4:00 | **Pass.** Earliest win is 4:16. |

Ship misses 1 and 4. Do not retune section 5 (regolith 0.25/s, print cost, upkeep) in this pass — that wait is for the upcoming delivery / upkeep / no-mining-radius merge.

## Follow-up search on Set B

Allowed extra knobs: print cost 15–25 regolith and 10–20 s; `haulerCarry` 10–15; `digPowerPerTile` 3–6; `habitatPowerCapacity` 120–200; solar output 4–5/s. Fewest knobs, then smallest deltas. All runs at 1x (`dt = 1/60`).

| Set | Pass | 1 | 2 (T%) | 3 (night) | 4 (pwr) | 5 (≥4:00) | Notes |
|---|:---:|:---:|:---:|:---:|:---:|:---:|---|
| B exact (carry 10) | 2/5 | no | 19.8% (out of 20–35) | yes | no | yes | H2 5:20, P1 6:04, T2 4:16 |
| B + print 15 / 10 s | 2/5 | no | — | yes | no | yes | Printer *building* cost still dominates. P1 does not beat H2. |
| B + print 15 or 20, or print time 10–15 | 2/5 | no | — | yes | no | yes | Same. |
| B + carry 11–14 | 2/5 | no | shrinks / wrecks | yes | no | yes | Carry 12: plus-2 becomes best hauler (4:37), T% ~5%. |
| B + carry 15 | **3/5** | no | **29.2%** | yes | no | yes | Best single knob. |
| B + dig power 4 or 6 | 2/5 | no | ~20% | yes | no | yes | Times unchanged; tunnel `pmin` stays ~100. |
| B + habitat cap 120 or 160 | 2/5 | no | ~20% | yes | no | yes | Times and tunnel `pmin` unchanged. |
| B + solar 4/s | 2/5 | no | ~20% | yes | no | yes | Tunnel `pmin` still ~100. |

Print-1 cannot beat two starters inside the allowed print-cost band: the printer itself is 40 regolith and 15 s, and the extra hauler sits idle while that building goes up. Dig power, solar, and habitat cap do not create a tunnel power dip without idle draw.

## Chart

![Win time by strategy](chart.png)

Orange bars are hauler-family routes; cyan bars are tunnel-family. The horizontal line is first night (4:00). Chart is the shipped set at 1x.

## First search (historical)

Target then: best committed tunnel beats best haulers-only by about 15–30%; a typical (safe, haulers-only) win is about 6–10 minutes so at least one night happens; haulers-only can still win. Recorded at `dt = 1/20` against the original 60-ice / 6 s-dig Proposed set. Live honest runs at those numbers: haulers-only ~1:29, tunnel ~3:30, first night at 4:00.

### Current Proposed (then)

No number changes (then-current Proposed set).

| Strategy | Win | Night | Power min | Ice | Logistics |
|---|---:|:---:|---:|---:|---|
| Haulers only (2 start) | 1:15 | no | 100.3 | 60 | haulers only |
| Haulers + print 1 | 2:29 | no | 100.3 | 70 | haulers only |
| Haulers + print 2 | 2:46 | no | 100.3 | 70.7 | haulers only |
| Tunnel, 1 digger | 2:34 | no | 100.3 | 60 | tunnel |
| Tunnel, 2 diggers | 2:03 | no | 100.3 | 60 | tunnel |
| Mixed (1 hauls, 1 digs) | 2:25 | no | 100.3 | 60 | haulers only |

Best haulers-only: **Haulers only (2 start)** at 1:15.
Best tunnel: **Tunnel, 2 diggers** at 2:03 (63.5% slower).
The tunnel is 63% *slower* than two starting haulers. Printing extra haulers also loses — the printer is a 60-ice-goal tax.

### A — goal 180, dig 16s

| Strategy | Win | Night | Power min | Ice | Logistics |
|---|---:|:---:|---:|---:|---|
| Haulers only (2 start) | 5:19 | yes | 92.8 | 180 | haulers only |
| Haulers + print 1 | 6:05 | yes | 26 | 210 | haulers only |
| Haulers + print 2 | 6:54 | yes | 0 | 200.3 | haulers only |
| Tunnel, 1 digger | 4:55 | yes | 100.3 | 180 | tunnel |
| Tunnel, 2 diggers | 3:50 | no | 100.3 | 180 | tunnel |
| Mixed (1 hauls, 1 digs) | 4:57 | yes | 100.3 | 180 | tunnel |

Tunnel advantage **27.9%**. 2-digger line lands *before* night (3:50).

### B — goal 180, dig 24s

| Strategy | Win | Night | Power min | Ice | Logistics |
|---|---:|:---:|---:|---:|---|
| Haulers only (2 start) | 5:19 | yes | 92.8 | 180 | haulers only |
| Haulers + print 1 | 6:05 | yes | 26 | 210 | haulers only |
| Haulers + print 2 | 6:54 | yes | 0 | 200.3 | haulers only |
| Tunnel, 1 digger | 5:52 | yes | 100.3 | 180 | tunnel |
| Tunnel, 2 diggers | 4:18 | yes | 100.3 | 180 | tunnel |
| Mixed (1 hauls, 1 digs) | 5:50 | yes | 100.3 | 180 | tunnel |

Tunnel advantage **19.1%**. All winning routes hit night. Approved as the new baseline, then this follow-up added carry 15.

### C — goal 180, speed 0.8, dig 20s

| Strategy | Win | Night | Power min | Ice | Logistics |
|---|---:|:---:|---:|---:|---|
| Haulers only (2 start) | 6:11 | yes | 34 | 180 | haulers only |
| Haulers + print 1 | 6:45 | yes | 25.5 | 180 | haulers only |
| Haulers + print 2 | 6:04 | yes | 28.5 | 183.2 | haulers only |
| Tunnel, 1 digger | 5:29 | yes | 100.3 | 180 | tunnel |
| Tunnel, 2 diggers | 4:17 | yes | 100.3 | 180 | tunnel |
| Mixed (1 hauls, 1 digs) | 5:39 | yes | 100.3 | 180 | tunnel |

Tunnel advantage **29.4%**. Needs a third number (hauler speed). Not shipped.

## Notes for Game Designer

- Habitat ice cap is 30 and vault ice is 150. A 180 goal fits habitat + vault exactly; hub ice does **not** count for Land Crew, so the last loads have to finish in the vault/habitat/storage.
- The home hub pulls ice back out of a full vault (`pullVaultsTo` when the hub is empty). Dedicated tunnel routes stall around 170 ice unless the last loads go to habitat/storage.
- Deep Ice is 200. A goal above ~180 needs a second scoring pad (storage) on the tunnel path, or a vault/habitat cap change.
- `deepIceTilesFromStartStorage: 22` is documentation today. The node sits on the command-range ring (~14 tiles). The harness maps that field onto `commandRangeRadius` when you sweep it.
- `startHaulers` is unused by `bootstrap()` (always two). The harness honors the override at kickoff.
- These runs launch the real Notify-on-ore scout program and wait for the 2s confirm ping. Unlocking Deep Ice by injection is not used.
- **Criterion 4 is a mechanics gap, not a tuning miss.** The base has no idle power draw, so tunnel stored-power never drops below 50 on Set B plus any one allowed knob. The upcoming `haulerUpkeepPowerPerSec` (default 0) is the hook; retune section 5 (regolith 0.25/s, print cost, upkeep) only where the five criteria still hold after that merge.
