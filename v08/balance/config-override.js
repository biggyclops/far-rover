// Apply gameplay-number overrides to the live CONFIG object, then restore.
// game.js reads CONFIG at runtime, so this is the only way to sweep numbers
// without editing v08/config.js.

import { CONFIG } from '../config.js';

export const DEFAULTS = JSON.parse(JSON.stringify(CONFIG));

const SWEEP_KEYS = [
  'goalIceInStorage',
  'deepIceTilesFromStartStorage',
  'commandRangeRadius',
  'haulerSpeedTilesPerSecond',
  'haulerOffRoadSpeedMult',
  'haulerCarry',
  'startHaulers',
  'digSecondsPerTilePerRover',
  'tunnelCargoTilesPerSecond',
  'tunnelHubCostRegolith',
  'vaultCostRegolith',
  'printerHaulerCostRegolith',
  'printerHaulerCostRegolithStep',
  'printerHaulerCostPower',
  'printerHaulerSeconds',
  'haulerUpkeepPowerPerSec',
  'haulerMinePerSecond',
  'digPowerPerTile',
  'habitatPowerCapacity',
  'rimSolarPowerPerSecondDay',
  'solSecondsAt1x',
  'daySecondsAt1x',
  'nightSecondsAt1x',
  'deepIceAmount',
  'goalPowerInStorage',
];

export function expandOverrides(overrides = {}) {
  const o = { ...overrides };
  if (o.solSecondsAt1x != null) {
    const sol = o.solSecondsAt1x;
    if (o.daySecondsAt1x == null) {
      o.daySecondsAt1x = sol * (DEFAULTS.daySecondsAt1x / DEFAULTS.solSecondsAt1x);
    }
    if (o.nightSecondsAt1x == null) {
      o.nightSecondsAt1x = sol * (DEFAULTS.nightSecondsAt1x / DEFAULTS.solSecondsAt1x);
    }
  }
  return o;
}

export function applyOverrides(overrides = {}) {
  const expanded = expandOverrides(overrides);
  const applied = {};
  for (const [key, value] of Object.entries(expanded)) {
    if (!(key in CONFIG)) continue;
    CONFIG[key] = value;
    applied[key] = value;
  }
  return applied;
}

export function restoreConfig() {
  Object.assign(CONFIG, JSON.parse(JSON.stringify(DEFAULTS)));
}

export function changedFromDefaults(overrides = {}) {
  const applied = expandOverrides(overrides);
  const changes = [];
  for (const key of new Set([...SWEEP_KEYS, ...Object.keys(applied)])) {
    if (applied[key] == null) continue;
    if (applied[key] !== DEFAULTS[key]) {
      changes.push({ key, from: DEFAULTS[key], to: applied[key] });
    }
  }
  return changes;
}

export { CONFIG, SWEEP_KEYS };
