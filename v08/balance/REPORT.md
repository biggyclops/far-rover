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
