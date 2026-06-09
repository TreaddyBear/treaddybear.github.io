import { Vector3 } from "@babylonjs/core";
import type { RectLike } from "./utils/yard";

export const playerSpeed = 1.65;
export const playerBoost = 1.45;
export const playerRadius = 0.75;
export const playerFenceRadius = 0.72;
export const mowerCutRadius = 0.42;
export const bladeCount = 30000;
export const mediumGrassCount = 36000;
export const wheatGrassCount = 2200;
export const cellSize = 1;
export const debugBiomeMaskOnly = false;

export const settings = {
  playerSpeed,
  playerBoost,
  minHeight: 0.38,
  maxHeight: 0.76,
  clumpStrength: 0.55,
  heightRandomness: 0.2,
  windStrength: 0.1,
  bendStrength: 0.18,
  mowerAcceleration: 3.4,
  mowerTorqueFade: 0.62,
  mowerMinTorque: 0.34,
  turnMaxSpeed: 2.25,
  turnBuild: 0.77,
  controllerTurnAccelThreshold: 0.7,
  fenceMaxHealth: 100,
  fenceDamageSpeed: 1.5,
  showFenceHealth: false,
  disableFenceCollision: false,
  seedPopRate: 0.001,
  mowerVolume: 0.4,
  breezeVolume: 0.6,
  ambientBreezeVolume: 0.3,
  breezeFacingAmount: 0.7,
  grassCuttingVolume: 0.4,
  grassCuttingAttackDelay: 0.2,
  grassCuttingAttack: 0.03,
  grassCuttingDecay: 0.17,
  flowerPopVolume: 0.17,
  wallBumpVolume: 0.75,
  reverseBeepVolume: 0.04,
  completionFanfareVolume: 0.7,
  completionLoopVolume: 0.35,
  gunShotVolume: 0.35,
  grassRoughness: 0.22,
  grassMetallic: 0,
  grassClearCoat: 0.009,
  cutGrassRoughness: 0.36,
  cutGrassMetallic: 0,
  cutGrassClearCoat: 0.003,
  // Grass LOD (far-field mesh) — tunable live from the "Grass LOD" settings group.
  lodShow: false, // off by default; check to preview the LOD mesh
  lodOpacity: 1, // 0 = fully see the real blades, 1 = fully the LOD mesh
  lodTopColor: "#74c247", // light, for the raised tips
  lodBottomColor: "#16380a", // dark, for the valleys (reads as self-shadow)
  lodHeightTotal: 0.3, // base grass height
  lodBumpAmplitude: 0.06, // +/- surface deviation around the base (tune separately now)
  lodHeightOffset: -0.02, // base offset; negative dips valleys into the terrain
  lodNoiseScale: 1.7, // big-lump (geometry) frequency
  lodNormalStrength: 0.85, // how hard the baked grass normal map tilts the surface
  lodNormalScale: 0.3, // baked-detail tiling (texture repeats per world unit)
  lodSpecular: 0.15, // faint front accent (translucency is the main shine)
  lodRoughness: 0.22, // highlight breadth — match the blade material to match shine
  lodSheen: 1.2, // back-glow (translucency) strength — the main grass shine
  // Grass LOD — vertical SLAT layer (separate from the flat mesh above).
  lodSlatsShow: true, // show the cross-hatched vertical slats (on by default for tuning)
  lodSlatHeight: 0.5, // slat height where uncut
  lodSlatTileScale: 0.6, // baked-detail tiling on the slats
  lodSlatCutoff: 0.3, // alpha-cutout threshold (lower = denser/leafier blades)
  lodSlatWiggle: 0.12, // how far each slat meanders side to side (varies the shine azimuth)
  lodSlatWiggleFreq: 1.6, // how often it meanders along its run
  lodSlatBend: 0.45, // how far each slat bends OVER (the broad face turns up to catch light)
  inputMode: "keyboard",
  grassBaseColor: "#0d2c02",
  hueVariance: 0.035,
  satVariance: 0.18,
  lightVariance: 0.16,
  cutGrassRootColor: "#2d2e00",
  cutGrassTopColorA: "#869325",
  cutGrassTopColorB: "#42a60c",
  groundColor: "#295c00",
  grassyTextureScale: 160,
  dirtTextureUScale: 240,
  dirtTextureVScale: 480,
  dirtNormalStrength: 0.42,
  roadTextureUScale: 1,
  roadTextureVScale: 48,
  skyAmbientIntensity: 0.22,
  skyAmbientColor: "#94bfff",
  ssaoEnabled: true,
  ssaoStrength: 0.55,
  ssaoRadius: 1.15,
  ssaoScale: 0.55,
  ssaoBlurScale: 0.85,
  ssaoSamples: 10,
  dynamicResolution: false,
  autoFinishOnMaxStars: false,
  targetFps: 58,
  fenceBumpTimePenalty: 5,
  portraitFov: 0.78,
  portraitDistance: 5.2,
  portraitHeight: 5.2,
  portraitLookAhead: 2.4,
  mapId: "bgrnEll",
};

// Star scoring. Internal points only (never shown raw to the player): the meter
// and the end-of-level verdict are derived from these. Per-level par lives in
// `lawnLevels.settings.parSeconds` below and is driven by dev settings sliders.
export const scoring = {
  timePerSecond: 5, // points per second under par (and lost per second over)
  grassPerPercent: 100, // points per % of the lawn mowed (max 10000 at 100%)
  mistakeBase: 1000, // first mistake's penalty
  mistakeFalloff: 0.7, // each later mistake is this fraction of the previous
  normal: {
    partialPercent: 80, // enough grass to begin considering stars without full cleanup
    nearCompletePercent: 95,
    completePercent: 99.5, // strays/rounding forgiveness; still "the whole lawn" in normal mode
    threeStarTimeMultiplier: 1.2, // normal 3-star time is looser than master/par
    twoStarTimeMultiplier: 1.55,
    oneStarTimeMultiplier: 2.25,
    oneMistakeLimit: 4,
    twoMistakeLimit: 1,
  },
  master: {
    fourStarTimeMultiplier: 1.1,
    fiveStarTimeMultiplier: 1,
    completePercent: 99.5,
    perfectPercent: 100,
  },
  thresholds: {
    3: [4000, 7000, 10000],
    5: [4000, 6000, 8000, 9000, 10000],
  } as Record<number, number[]>,
};

export type FenceSegment = {
  start: Vector3;
  end: Vector3;
};

export type FlowerBed = RectLike & {
  count: number;
};

// Level codes are durable save/tuning keys. Display names can change freely.
// `bgrn` is the temporary Beta Green prefix while the first green-level roster
// is still being shaped.
export const levelCodes = ["bgrnEll", "bgrnBed"] as const;
export type LevelCode = (typeof levelCodes)[number];

type LawnLevelSettings = {
  parSeconds: Record<LevelCode, number>;
};

export type LawnMap = {
  code: LevelCode;
  name: string;
  spawn: Vector3;
  segments: Array<RectLike & { width: number; height: number; center: Vector3 }>;
  fenceSegments: FenceSegment[];
  flowerBeds: FlowerBed[];
  dandelionCount: number;
};

type LawnLevels = {
  settings: LawnLevelSettings;
} & Record<LevelCode, LawnMap>;

const betaGreenEllSegments = [
  { xMin: -9, xMax: 9, zMin: -9, zMax: 2, width: 18, height: 11, center: new Vector3(0, 0, -3.5) },
  { xMin: -9, xMax: 0, zMin: 2, zMax: 9, width: 9, height: 7, center: new Vector3(-4.5, 0, 5.5) },
];

export const lawnLevels: LawnLevels = {
  settings: {
    parSeconds: {
      bgrnEll: 360,
      bgrnBed: 360,
    },
  },
  bgrnEll: {
    code: "bgrnEll",
    name: "Main",
    spawn: new Vector3(0, 0.18, 0),
    segments: betaGreenEllSegments,
    fenceSegments: [
      { start: new Vector3(-9.25, 0, -9.25), end: new Vector3(9.25, 0, -9.25) },
      { start: new Vector3(9.25, 0, -9.25), end: new Vector3(9.25, 0, 2.25) },
      { start: new Vector3(9.25, 0, 2.25), end: new Vector3(0.25, 0, 2.25) },
      { start: new Vector3(0.25, 0, 2.25), end: new Vector3(0.25, 0, 9.25) },
      { start: new Vector3(0.25, 0, 9.25), end: new Vector3(-9.25, 0, 9.25) },
      { start: new Vector3(-9.25, 0, 9.25), end: new Vector3(-9.25, 0, -9.25) },
    ],
    flowerBeds: [],
    dandelionCount: 18,
  },
  bgrnBed: {
    code: "bgrnBed",
    name: "Flower Bed",
    spawn: new Vector3(0, 0.18, -7),
    segments: [
      { xMin: -10, xMax: 10, zMin: -10, zMax: 10, width: 20, height: 20, center: new Vector3(0, 0, 0) },
      { xMin: -15, xMax: -10, zMin: -4, zMax: 4, width: 5, height: 8, center: new Vector3(-12.5, 0, 0) },
      { xMin: 10, xMax: 15, zMin: -4, zMax: 4, width: 5, height: 8, center: new Vector3(12.5, 0, 0) },
    ],
    fenceSegments: [
      { start: new Vector3(-10.25, 0, -10.25), end: new Vector3(10.25, 0, -10.25) },
      { start: new Vector3(10.25, 0, -10.25), end: new Vector3(10.25, 0, -4.25) },
      { start: new Vector3(10.25, 0, -4.25), end: new Vector3(15.25, 0, -4.25) },
      { start: new Vector3(15.25, 0, -4.25), end: new Vector3(15.25, 0, 4.25) },
      { start: new Vector3(15.25, 0, 4.25), end: new Vector3(10.25, 0, 4.25) },
      { start: new Vector3(10.25, 0, 4.25), end: new Vector3(10.25, 0, 10.25) },
      { start: new Vector3(10.25, 0, 10.25), end: new Vector3(-10.25, 0, 10.25) },
      { start: new Vector3(-10.25, 0, 10.25), end: new Vector3(-10.25, 0, 4.25) },
      { start: new Vector3(-10.25, 0, 4.25), end: new Vector3(-15.25, 0, 4.25) },
      { start: new Vector3(-15.25, 0, 4.25), end: new Vector3(-15.25, 0, -4.25) },
      { start: new Vector3(-15.25, 0, -4.25), end: new Vector3(-10.25, 0, -4.25) },
      { start: new Vector3(-10.25, 0, -4.25), end: new Vector3(-10.25, 0, -10.25) },
    ],
    flowerBeds: [
      { xMin: -3.8, xMax: 3.8, zMin: -2.2, zMax: 2.2, count: 52 },
    ],
    dandelionCount: 12,
  },
};

export const lawnMaps = levelCodes.map((code) => lawnLevels[code]);

const legacyLevelCodes: Record<string, LevelCode> = {
  main: "bgrnEll",
  "flower-court": "bgrnBed",
};

export function normalizeLevelCode(code: string): LevelCode {
  if ((levelCodes as readonly string[]).includes(code)) {
    return code as LevelCode;
  }

  return legacyLevelCodes[code] ?? "bgrnEll";
}

export function getActiveLevelCode() {
  const levelCode = normalizeLevelCode(settings.mapId);
  settings.mapId = levelCode;
  return levelCode;
}

export function getNextLevelCode(levelCode = getActiveLevelCode()) {
  const index = levelCodes.indexOf(levelCode);
  return levelCodes[(index + 1) % levelCodes.length];
}

export function getActiveMap() {
  return lawnLevels[getActiveLevelCode()];
}

export const yardSegments = [...betaGreenEllSegments];

export function applyActiveMap() {
  const activeMap = getActiveMap();
  yardSegments.splice(0, yardSegments.length, ...activeMap.segments);
}

export type YardSegment = (typeof yardSegments)[number];
