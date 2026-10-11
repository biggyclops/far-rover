// First-search candidate sets, written against the original 60-ice / 6 s-dig
// Proposed values. Shipped defaults are now Set B + haulerCarry 15; these
// overrides are kept so `--report` can still replay the historical tables.

export const CANDIDATES = [
  {
    id: 'A-goal-180-dig-16',
    name: 'A — goal 180, dig 16s',
    why: 'Two numbers. A longer ice contract plus a slower bore so the 2-digger commit beats the best hauler route by ~28%, without moving Deep Ice or slowing surface travel.',
    overrides: { goalIceInStorage: 180, digSecondsPerTilePerRover: 16 },
  },
  {
    id: 'B-goal-180-dig-24',
    name: 'B — goal 180, dig 24s',
    why: 'Two numbers. Same goal as A, slower bore. The committed tunnel still wins, but it now crosses first night, and the gap shrinks to ~19% — inside the 15–30% band with more night pressure.',
    overrides: { goalIceInStorage: 180, digSecondsPerTilePerRover: 24 },
  },
  {
    id: 'C-goal-180-spd-08-dig-20',
    name: 'C — goal 180, speed 0.8, dig 20s',
    why: 'Three numbers. Slower haulers stretch the safe route into a 6–7 minute win so extra printed haulers and night charging actually show up, while a 20s bore keeps the tunnel ~29% ahead.',
    overrides: {
      goalIceInStorage: 180,
      haulerSpeedTilesPerSecond: 0.8,
      digSecondsPerTilePerRover: 20,
    },
  },
];

export const SWEEP_GRID = [
  { id: 'goal-180', name: 'goal 180 only', overrides: { goalIceInStorage: 180 } },
  { id: 'goal-200', name: 'goal 200 only', overrides: { goalIceInStorage: 200 } },
  { id: 'goal-180-range-18', name: 'goal 180, range 18', overrides: { goalIceInStorage: 180, commandRangeRadius: 18 } },
  { id: 'goal-180-dig-16', name: 'goal 180, dig 16s', overrides: { goalIceInStorage: 180, digSecondsPerTilePerRover: 16 } },
  { id: 'goal-180-dig-24', name: 'goal 180, dig 24s', overrides: { goalIceInStorage: 180, digSecondsPerTilePerRover: 24 } },
];
