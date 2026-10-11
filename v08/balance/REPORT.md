# Far Rover v0.8 balance report

Headless harness under `v08/balance/`. It imports the real `createGame()` sim and the real scout engine (`v08/engine.js` → `simulation.js`). Strategies issue only player orders: place, build, print, dig, haul, charge, launch scout, land crew. No `setResources`, teleports, or forced completes.

```bash
node v08/balance/run.js                  # current numbers, all strategies
node v08/balance/run.js --overrides '{"goalIceInStorage":180}'
node v08/balance/run.js --strategy tunnel-2-diggers --goal-ice-in-storage 180
node v08/balance/run.js --report         # rewrite this file + chart.png
```

`config.js` is not edited. Overrides mutate the live `CONFIG` object for one run and restore it after. `startHaulers` is hardcoded to 2 inside `bootstrap()`; the harness applies that override after create, so the documented start-count key still sweeps. Deep Ice distance is `deepIceTilesFromStartStorage`, mapped onto `commandRangeRadius` (the ring the sim actually uses; 22 → 14 keeps today’s placement). Sol length scales day/night 4:2 unless those are set too.

## What the current numbers do

Live honest runs at the current Proposed set: haulers-only ~1:29, tunnel ~3:30, first night at 4:00. The harness (scout launched in parallel, far hub next to Deep Ice) is a bit faster than those clicks, but the shape is the same: **the tube costs more time than it returns before the 60-ice goal, and a win never sees night, so stored power never matters.**

## Current Proposed
No number changes (current Proposed set).

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
Criteria: tunnel 15–30% no; 6–10 min no; night no; haulers can win yes.

The tunnel is 63% *slower* than two starting haulers. Printing extra haulers also loses — the printer is a 60-ice-goal tax. Mixed finishes as haulers-only because 60 ice lands before the bore is worth switching.

## Candidates

Target: best committed tunnel beats best haulers-only by about 15–30%; a typical (safe, haulers-only) win is about 6–10 minutes so at least one night happens; haulers-only can still win. Change as few numbers as possible.

Night starts at 4:00 / sol is 6:00. Power min is habitat stored power during the run — extra haulers charging after dusk are what drive it toward zero.

## A — goal 180, dig 16s
Changes from current Proposed numbers:
- `goalIceInStorage`: 60 → 180
- `digSecondsPerTilePerRover`: 6 → 16

| Strategy | Win | Night | Power min | Ice | Logistics |
|---|---:|:---:|---:|---:|---|
| Haulers only (2 start) | 5:19 | yes | 92.8 | 180 | haulers only |
| Haulers + print 1 | 6:05 | yes | 26 | 210 | haulers only |
| Haulers + print 2 | 6:54 | yes | 0 | 200.3 | haulers only |
| Tunnel, 1 digger | 4:55 | yes | 100.3 | 180 | tunnel |
| Tunnel, 2 diggers | 3:50 | no | 100.3 | 180 | tunnel |
| Mixed (1 hauls, 1 digs) | 4:57 | yes | 100.3 | 180 | tunnel |

Best haulers-only: **Haulers only (2 start)** at 5:19.
Best tunnel: **Tunnel, 2 diggers** at 3:50 (27.9% faster).
Criteria: tunnel 15–30% yes; 6–10 min no; night yes; haulers can win yes.

Two numbers. A longer ice contract plus a slower bore so the 2-digger commit beats the best hauler route by ~28%, without moving Deep Ice or slowing surface travel.

Tunnel advantage: **27.9%**. Haulers-only still wins. Night on a winning route: **yes**. Committed 2-digger night: **no**.

## B — goal 180, dig 24s
Changes from current Proposed numbers:
- `goalIceInStorage`: 60 → 180
- `digSecondsPerTilePerRover`: 6 → 24

| Strategy | Win | Night | Power min | Ice | Logistics |
|---|---:|:---:|---:|---:|---|
| Haulers only (2 start) | 5:19 | yes | 92.8 | 180 | haulers only |
| Haulers + print 1 | 6:05 | yes | 26 | 210 | haulers only |
| Haulers + print 2 | 6:54 | yes | 0 | 200.3 | haulers only |
| Tunnel, 1 digger | 5:52 | yes | 100.3 | 180 | tunnel |
| Tunnel, 2 diggers | 4:18 | yes | 100.3 | 180 | tunnel |
| Mixed (1 hauls, 1 digs) | 5:50 | yes | 100.3 | 180 | tunnel |

Best haulers-only: **Haulers only (2 start)** at 5:19.
Best tunnel: **Tunnel, 2 diggers** at 4:18 (19.1% faster).
Criteria: tunnel 15–30% yes; 6–10 min no; night yes; haulers can win yes.

Two numbers. Same goal as A, slower bore. The committed tunnel still wins, but it now crosses first night, and the gap shrinks to ~19% — inside the 15–30% band with more night pressure.

Tunnel advantage: **19.1%**. Haulers-only still wins. Night on a winning route: **yes**. Committed 2-digger night: **yes**.

## C — goal 180, speed 0.8, dig 20s
Changes from current Proposed numbers:
- `goalIceInStorage`: 60 → 180
- `haulerSpeedTilesPerSecond`: 1 → 0.8
- `digSecondsPerTilePerRover`: 6 → 20

| Strategy | Win | Night | Power min | Ice | Logistics |
|---|---:|:---:|---:|---:|---|
| Haulers only (2 start) | 6:11 | yes | 34 | 180 | haulers only |
| Haulers + print 1 | 6:45 | yes | 25.5 | 180 | haulers only |
| Haulers + print 2 | 6:04 | yes | 28.5 | 183.2 | haulers only |
| Tunnel, 1 digger | 5:29 | yes | 100.3 | 180 | tunnel |
| Tunnel, 2 diggers | 4:17 | yes | 100.3 | 180 | tunnel |
| Mixed (1 hauls, 1 digs) | 5:39 | yes | 100.3 | 180 | tunnel |

Best haulers-only: **Haulers + print 2** at 6:04.
Best tunnel: **Tunnel, 2 diggers** at 4:17 (29.4% faster).
Criteria: tunnel 15–30% yes; 6–10 min yes; night yes; haulers can win yes.

Three numbers. Slower haulers stretch the safe route into a 6–7 minute win so extra printed haulers and night charging actually show up, while a 20s bore keeps the tunnel ~29% ahead.

Tunnel advantage: **29.4%**. Haulers-only still wins. Night on a winning route: **yes**. Committed 2-digger night: **yes**.

## Recommendation: set B

Ship **goal 180 ice** and **24 seconds per tunnel tile**. Leave everything else Proposed.

| Key | Current | B | Why |
|---|---:|---:|---|
| `goalIceInStorage` | 60 | 180 | 60 ice is two full trips after setup. 180 ice is a logistics contract: the bore’s upfront cost can amortize, and the clock crosses first night. |
| `digSecondsPerTilePerRover` | 6 | 24 | At 6 s/tile a 2-digger line next to Deep Ice is ~40% faster than walking — too good. 24 s/tile keeps the 15–30% band and pushes the committed win past 4:00. |

Why B over A: A is the smaller bore nerf (16s) and a bigger tunnel win (~28%), but the 2-digger line still lands *before* night (3:50). B gives up some of that edge (~19%, still in band) so the player who commits to the tube still has to plan a night. Why B over C: C needs a third number (hauler speed 0.8) to put the safe route cleanly inside 6–10 minutes. B gets night + a real tunnel decision with two knobs. C is the right follow-up if playtests say 5:19 still feels short on the hauler path.

Haulers-only remains viable — just slower. Printing extra haulers at these numbers is a night-power decision, not a free speedup: the plus-2 path can drain stored power to 0 and then wait on dawn for the 50-power land-crew floor.

## Chart

![Win time by strategy](chart.png)

Orange bars are hauler-family routes; cyan bars are tunnel-family. The horizontal line is first night (4:00).

## Notes for Game Designer

- Habitat ice cap is 30 and vault ice is 150. A 180 goal fits habitat + vault exactly; hub ice does **not** count for Land Crew, so the last loads have to finish in the vault/habitat/storage.
- Deep Ice is 200. A goal above ~180 needs a second scoring pad (storage) on the tunnel path, or a vault/habitat cap change.
- `deepIceTilesFromStartStorage: 22` is documentation today. The node sits on the command-range ring (~14 tiles). The harness maps that field onto `commandRangeRadius` when you sweep it.
- `startHaulers` is unused by `bootstrap()` (always two). The harness honors the override at kickoff.
- These runs launch the real Notify-on-ore scout program and wait for the 2s confirm ping. Unlocking Deep Ice by injection is not used.

