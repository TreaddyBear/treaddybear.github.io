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
  minHeight: 0.38,
  maxHeight: 0.76,
  clumpStrength: 0.55,
  heightRandomness: 0.2,
  windStrength: 0.1,
  bendStrength: 0.18,
  turnMaxSpeed: 2.25,
  turnBuild: 0.77,
  controllerTurnAccelThreshold: 0.7,
  fenceMaxHealth: 100,
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
  dynamicResolution: false,
  targetFps: 58,
  timeLimitSeconds: 720,
  fenceBumpTimePenalty: 5,
  portraitFov: 0.78,
  portraitDistance: 5.2,
  portraitHeight: 5.2,
  portraitLookAhead: 2.4,
  mapId: "main",
};

// Star scoring. Internal points only (never shown raw to the player): the meter
// and the end-of-level verdict are derived from these. Tunable here.
export const scoring = {
  parSeconds: 360, // target time; finishing under par adds points, over subtracts
  timePerSecond: 5, // points per second under par (and lost per second over)
  grassPerPercent: 100, // points per % of the lawn mowed (max 10000 at 100%)
  mistakeBase: 1000, // first mistake's penalty
  mistakeFalloff: 0.7, // each later mistake is this fraction of the previous
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

export type LawnMap = {
  id: string;
  name: string;
  spawn: Vector3;
  segments: Array<RectLike & { width: number; height: number; center: Vector3 }>;
  fenceSegments: FenceSegment[];
  flowerBeds: FlowerBed[];
  dandelionCount: number;
};

const mainSegments = [
  { xMin: -9, xMax: 9, zMin: -9, zMax: 2, width: 18, height: 11, center: new Vector3(0, 0, -3.5) },
  { xMin: -9, xMax: 0, zMin: 2, zMax: 9, width: 9, height: 7, center: new Vector3(-4.5, 0, 5.5) },
];

export const lawnMaps: LawnMap[] = [
  {
    id: "main",
    name: "Main",
    spawn: new Vector3(0, 0.18, 0),
    segments: mainSegments,
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
  {
    id: "flower-court",
    name: "Flower Court",
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
];

export function getActiveMap() {
  return lawnMaps.find((map) => map.id === settings.mapId) ?? lawnMaps[0];
}

export const yardSegments = [...mainSegments];

export function applyActiveMap() {
  const activeMap = getActiveMap();
  yardSegments.splice(0, yardSegments.length, ...activeMap.segments);
}

export type YardSegment = (typeof yardSegments)[number];
