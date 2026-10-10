// Far Rover v0.8 — every gameplay number in one place.
// Label: Proposed (Game Designer). Tune after playtests. See DESIGN-NUMBERS.md.

export const CONFIG = {
  // --- Map and camera (M1) ---
  mapWidth: 40, // Proposed (Game Designer)
  mapHeight: 40, // Proposed (Game Designer)
  tileSize: 64, // 64 px per tile at 1x; 128 px sources are @2x
  sourcePixelsPerTile: 128,
  commandRangeRadius: 14, // Proposed (Game Designer) — drawn in M1, cosmetic until M3
  commandRangeCosmetic: true, // M1: ring only; hand-direct everywhere on the home map

  // Habitat footprint is 2x2. Anchor is the north-west tile.
  habitatTileX: 18,
  habitatTileY: 18,
  startSolarTileX: 16,
  startSolarTileY: 14,
  shallowIceTileX: 25,
  shallowIceTileY: 16,

  // --- Starting stock (M1) ---
  startHaulers: 2, // Proposed (Game Designer)
  startRimSolar: 1, // Proposed (Game Designer)
  startRegolith: 80, // Proposed (Game Designer)
  startIce: 20, // Proposed (Game Designer)
  startPower: 100, // Proposed (Game Designer)

  // Habitat stores power and ice (and the starting regolith pad).
  habitatPowerCapacity: 200, // Proposed (Game Designer)
  habitatIceCapacity: 30, // Proposed (Game Designer)
  habitatRegolithCapacity: 200, // Proposed (Game Designer) — holds the starting 80; GD named ice/power only

  // --- Shallow ice (M1) ---
  shallowIceAmount: 25, // Proposed (Game Designer)
  shallowIceRegrows: false, // Proposed (Game Designer)
  // Swap to tile-ice-mined when empty.

  // --- Hauler (M1) ---
  haulerSpeedTilesPerSecond: 1, // Proposed (Game Designer)
  haulerCarry: 10, // Proposed (Game Designer)
  haulerBattery: 100, // Proposed (Game Designer)
  haulerDrainPerTileLoaded: 1, // Proposed (Game Designer)
  haulerDrainPerTileEmpty: 0.5, // Proposed (Game Designer)
  haulerMinePerSecond: 1, // Proposed (Game Designer) — regolith from any plain ground, ice from ice tiles
  haulerChargePerSecond: 10, // Proposed (Game Designer) — at the habitat or next to a solar

  // --- Buildings (M1) ---
  buildingFootprint: 2, // habitat, solar, printer, storage, tunnel-hub: 2x2 (256 px source)
  vaultFootprint: 3, // Proposed (Game Designer) art spec — 3x3, 384 px source (M2)

  rimSolarCostRegolith: 30, // Proposed (Game Designer)
  rimSolarBuildSeconds: 10, // Proposed (Game Designer)
  rimSolarPowerPerSecondDay: 5, // Proposed (Game Designer)
  rimSolarPowerPerSecondNight: 0, // Proposed (Game Designer)

  storageCostRegolith: 30, // Proposed (Game Designer)
  storageBuildSeconds: 10, // Proposed (Game Designer)
  storageIceCapacity: 100, // Proposed (Game Designer)
  storageRegolithCapacity: 200, // Proposed (Game Designer)

  printerCostRegolith: 40, // Proposed (Game Designer)
  printerBuildSeconds: 15, // Proposed (Game Designer)
  printerHaulerCostRegolith: 25, // Proposed (Game Designer)
  printerHaulerCostPower: 10, // Proposed (Game Designer)
  printerHaulerSeconds: 20, // Proposed (Game Designer)

  showBuildSpriteWhileConstructing: true, // Proposed (Game Designer)

  // --- Sol and clock (M1) ---
  solSecondsAt1x: 6 * 60, // Proposed (Game Designer) — 6 minutes at 1x
  daySecondsAt1x: 4 * 60, // Proposed (Game Designer)
  nightSecondsAt1x: 2 * 60, // Proposed (Game Designer)
  speeds: [0, 1, 4, 16], // pause, 1x, 4x, 16x
  nightIsWholeBoardTint: true, // Proposed (Game Designer)

  // --- Visual language (M1) ---
  // Pixel 2026-10-10: one player accent; one reserved warning/notify color.
  playerAccent: '#FF8A1F', // Pixel — tint ring-select.png and player UI
  warningNotify: '#3FD8FF', // Pixel — unconfirmed finds, hazards, Notify ping only
  nightTint: 'rgba(6, 10, 24, 0.52)', // Pixel — whole-board tint; no moving shadows at night
  nightMovingShadows: false, // Pixel
  sunFrom: 'upper-left',
  // Pixel: shadow SPRITE rotates with the unit; offset is screen-space and never rotates.
  shadowOffsetPx: [3, 3], // +3,+3 at 64px game zoom (+6,+6 at 128 source), lower-right
  shadowSpriteRotates: true,
  scoutBeaconMark: true, // Proposed (Game Designer) — small beacon on the scout (M3)
  glowUnitSize: 128, // Pixel — glow-unit.png, additive under units at night
  glowBuildingSize: 256, // Pixel — glow-building.png, additive under buildings at night
  glowUnitIntensity: 0.85, // Pixel night preview
  glowBuildingIntensity: 0.5, // Pixel — 40–60%; full strength washes to white
  nightGlowAdditive: true,
  tunnelCornerJoins: 'east-south', // Pixel — rotate utile-tunnel-corner for the other corners (M2)

  // --- Audio (Pixel batch 1) ---
  audioUnlockOnFirstGesture: true,
  audioMuteToggle: true,
  audioDoNotRenormalize: true,
  sfxSelect: 'select',
  sfxOrder: 'order',
  sfxBuildComplete: 'build-complete',
  sfxNotify: 'notify', // M3
  sfxDigLoop: 'dig-loop', // M2
  digLoopPreferOgg: true, // Pixel — mp3 padding leaves ~25 ms gap
  digLoopUseWebAudioBuffer: true, // Pixel — AudioBufferSourceNode.loop for gapless
  digLoopFadeMs: 80, // Pixel README: 50–100 ms gain fade when Dig ends

  // --- Cuts, confirmed ---
  noTrafficOrCollision: true,
  straightTunnels: true,
  noBorerClass: true, // any rover can Dig (M2)
  noHomePrograms: true,
  scoutUsesDemoBuildScreen: true,

  // --- Tunnel line (M2 — wired only) ---
  tunnelHubCostRegolith: 20, // Proposed (Game Designer)
  tunnelHubBuildSeconds: 10, // Proposed (Game Designer)
  tunnelHubCount: 2,
  digSecondsPerTilePerRover: 6, // Proposed (Game Designer) — rovers stack
  digPowerPerTile: 3, // Proposed (Game Designer)
  digRegolithYieldPerTile: 2, // Proposed (Game Designer)
  tunnelCargoTilesPerSecond: 4, // Proposed (Game Designer) — hub-to-hub, no rover

  // --- Vault (M2 — wired only) ---
  vaultCostRegolith: 40, // Proposed (Game Designer)
  vaultIceCapacity: 150, // Proposed (Game Designer)

  // --- Notify (M3 — wired only) ---
  notifyUsesTick: true, // Proposed (Game Designer)
  notifyRoverHolds: true, // Proposed (Game Designer)
  notifyOncePerNewFind: true, // Proposed (Game Designer)
  notifyRepeatWithNothingNewIsWait: true, // Proposed (Game Designer)
  notifyConditionsFromExistingSensors: true,

  // --- Deep Ice node (M3/M4 — wired only) ---
  deepIceTilesFromStartStorage: 22, // Proposed (Game Designer) — ~22 from start storage
  deepIceAmount: 200, // Proposed (Game Designer)
  // First ice confirm unlocks this node at the edge of command range toward the expedition site.

  // --- Ice confirm (M3 — wired only) ---
  paperMapOreTilesAreIce: true, // Proposed (Game Designer)
  iceConfirmNeedsScoutOnIceAndNotify: true, // no sample/drill
  iceConfirmUnlocksDeepIceNode: true,

  // --- Recall (M3 — wired only) ---
  recallFreePerExpedition: 1, // Proposed (Game Designer)
  recallRefund: false, // Proposed (Game Designer)
  recallScoutDrivesHomeOnOwnEngine: true,
  recallEndsExpedition: true,
  recallConfirmedFindsStay: true,

  // --- Rule patch (M3 — wired only) ---
  patchDelaySeconds: 2, // Proposed (Game Designer)
  patchesPerSol: 1, // Proposed (Game Designer)

  // --- Goal (M4 — wired only) ---
  goalIceInStorage: 60, // Proposed (Game Designer)
  goalPowerInStorage: 50, // Proposed (Game Designer)
  // Both at once → "Land crew" button.
  winScreenShowsTime: true,
  winScreenShowsLogistics: true, // haulers only vs tunnel
  winScreenShowsNotifyCount: true,
  winScreenShowsPatchCount: true,

  // --- Scout / engine (M3 — import only in M1) ---
  scoutPaperMapWidth: 12,
  scoutPaperMapHeight: 12,
};

export default CONFIG;
