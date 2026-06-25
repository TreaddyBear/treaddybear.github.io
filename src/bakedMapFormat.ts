// Types for the pre-baked runtime artifact (map-exports/lawn-maps.baked.json).
//
// BakedRuntimeMap mirrors RuntimeMap exactly, except every Babylon.js Vector3
// is replaced by a plain BakedVec3 object so the artifact is JSON-serializable.
// The engine loads the baked JSON and reconstructs Vector3 instances in a thin
// hydration pass (see loadBakedMapPack in config.ts) before use.
//
// The `source` field (raw LevelV1 data) is intentionally omitted — it is not
// consumed by any game system and would double the JSON file size.

import type { Area, FoliageKey, LevelV1, PathShape } from "./mapFormat";
import type { Bounds2 } from "./utils/shapes";
import type { FlowerVariant } from "./runtimeMap";

export type BakedVec3 = { x: number; y: number; z: number };

export type BakedRuntimeSegment = {
  xMin: number;
  xMax: number;
  zMin: number;
  zMax: number;
  width: number;
  height: number;
  center: BakedVec3;
};

export type BakedFenceSegment = {
  start: BakedVec3;
  end: BakedVec3;
};

export type BakedFlowerBed = BakedRuntimeSegment & {
  count: number;
  sourceArea: Area;
};

export type BakedFlowerField = {
  variant: FlowerVariant;
  area: BakedRuntimeSegment;
  spacing: number;
  sourceArea: Area;
  type: FoliageKey;
};

export type BakedCloverPatch = {
  x: number;
  z: number;
  radius: number;
  spacing?: number;
  grassKeep?: number;
  sourceArea: Area;
};

export type BakedRuntimePathFeature = {
  id: string;
  kind: "road" | "dirtPath" | "fence";
  width: number;
  height?: number;
  postSpacing?: number;
  shape: PathShape;
  points: [number, number][];
  bounds: Bounds2;
};

export type BakedRuntimeMap = {
  packPrefix: string;
  code: string;
  shortCode: string;
  name: string;
  parSeconds: number;
  spawn: BakedVec3;
  spawnHeadingDegrees: number;
  areas: Area[];
  mowableAreas: Area[];
  bedAreas: Area[];
  vegetationAreas: Area[];
  roads: BakedRuntimePathFeature[];
  dirtPaths: BakedRuntimePathFeature[];
  fences: BakedRuntimePathFeature[];
  terrain: LevelV1["terrain"];
  objects: unknown[];
  tags: string[];
  bounds: Bounds2;
  mowableArea: number;
  segments: BakedRuntimeSegment[];
  fenceSegments: BakedFenceSegment[];
  flowerBeds: BakedFlowerBed[];
  dandelionCount: number;
  flowerFields: BakedFlowerField[];
  cloverPatches: BakedCloverPatch[];
};

export type BakedMapPack = {
  bakedVersion: 1;
  defaultLevelCode?: string;
  maps: BakedRuntimeMap[];
};
