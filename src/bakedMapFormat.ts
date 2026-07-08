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
import type { VegetationPartDefinition } from "./vegetationDefinitions";

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
  /** Bake-time tiered vegetation instances. Parallel to existing runtime placement
   *  (which is unchanged). Engine wiring in a future phase. */
  bakedInstances: BakedInstance[];
};

/** One vegetation instance produced by the bake-time tiered sampler. */
export type BakedInstance = {
  x: number;
  z: number;
  type: string;
  index: number;  // stable identifier for save data (unique within a level)
  definitionId?: string;
  parts?: BakedVegetationPart[];
};

export type BakedVegetationPart = {
  definition: VegetationPartDefinition["id"];
  materialId: string;
  seed: number;
};

export type CompactBakedInstance = [x: number, z: number, typeIndex: number];

export type CompactBakedRuntimeMap = Omit<BakedRuntimeMap, "bakedInstances"> & {
  bakedInstanceTypes: string[];
  bakedInstances: CompactBakedInstance[];
};

export type LegacyBakedMapPack = {
  bakedVersion: 1;
  sourceHash: string;
  defaultLevelCode?: string;
  maps: BakedRuntimeMap[];
};

export type BakedMapPack = {
  bakedVersion: 2;
  // FNV-1a hash of JSON.stringify(parsed authored source) at bake time.
  // Compared at dev startup to detect edits to lawn-maps.json without a rebake.
  sourceHash: string;
  defaultLevelCode?: string;
  maps: CompactBakedRuntimeMap[];
};

export type AnyBakedMapPack = BakedMapPack | LegacyBakedMapPack;
export type AnyBakedRuntimeMap = BakedRuntimeMap | CompactBakedRuntimeMap;

export function compactBakedInstances(instances: BakedInstance[]) {
  const typeToIndex = new Map<string, number>();
  const bakedInstanceTypes: string[] = [];
  const bakedInstances: CompactBakedInstance[] = instances.map((inst) => {
    let typeIndex = typeToIndex.get(inst.type);
    if (typeIndex === undefined) {
      typeIndex = bakedInstanceTypes.length;
      typeToIndex.set(inst.type, typeIndex);
      bakedInstanceTypes.push(inst.type);
    }

    return [inst.x, inst.z, typeIndex];
  });

  return { bakedInstanceTypes, bakedInstances };
}

export function expandBakedInstances(map: AnyBakedRuntimeMap): BakedInstance[] {
  const instances = map.bakedInstances;
  if (instances.length === 0) {
    return [];
  }

  const first = instances[0];
  if (!Array.isArray(first)) {
    return instances as BakedInstance[];
  }

  const types = "bakedInstanceTypes" in map ? map.bakedInstanceTypes : [];
  return (instances as CompactBakedInstance[]).map(([x, z, typeIndex], index): BakedInstance => ({
    x,
    z,
    type: types[typeIndex] ?? "unknown",
    index,
  }));
}
