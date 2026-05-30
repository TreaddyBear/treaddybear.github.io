import { Vector3 } from "@babylonjs/core";

export const playerSpeed = 1.65;
export const playerBoost = 1.45;
export const playerRadius = 0.75;
export const mowerCutRadius = 0.42;
export const bladeCount = 30000;
export const mediumGrassCount = 24000;
export const wheatGrassCount = 7000;
export const cellSize = 1;

export const settings = {
  minHeight: 0.38,
  maxHeight: 0.76,
  clumpStrength: 0.55,
  heightRandomness: 0.2,
  windStrength: 0.1,
  bendStrength: 0.18,
  turnMaxSpeed: 2.25,
  turnBuild: 0.77,
  seedPopRate: 0.001,
  mowerVolume: 0.1,
  breezeVolume: 1,
  breezeFacingAmount: 0.7,
  grassBaseColor: "#0A2E05",
  hueVariance: 0.035,
  satVariance: 0.18,
  lightVariance: 0.16,
  cutGrassColor: "#051E03",
  groundColor: "#295c00",
};

export const yardSegments = [
  { xMin: -9, xMax: 9, zMin: -9, zMax: 2, width: 18, height: 11, center: new Vector3(0, 0, -3.5) },
  { xMin: -9, xMax: 0, zMin: 2, zMax: 9, width: 9, height: 7, center: new Vector3(-4.5, 0, 5.5) },
];

export type YardSegment = (typeof yardSegments)[number];
