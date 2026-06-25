// Loads and hydrates the pre-baked map pack artifact for normal engine use.
// Called once at startup by config.ts.
//
// The baked artifact stores positions as plain {x,y,z} objects (BakedVec3)
// for JSON serialisability. This module reconstructs Babylon.js Vector3
// instances from those values before the maps are used by game systems.

import { Vector3 } from "@babylonjs/core";
import rawBaked from "../map-exports/lawn-maps.baked.json";

import type {
  BakedFenceSegment,
  BakedFlowerBed,
  BakedFlowerField,
  BakedMapPack,
  BakedRuntimeMap,
  BakedRuntimeSegment,
  BakedVec3,
} from "./bakedMapFormat";
import type {
  FenceSegment,
  FlowerBed,
  FlowerField,
  RuntimeMap,
  RuntimeSegment,
} from "./runtimeMap";

function vec3(v: BakedVec3): Vector3 {
  return new Vector3(v.x, v.y, v.z);
}

function hydrateSegment(s: BakedRuntimeSegment): RuntimeSegment {
  return { ...s, center: vec3(s.center) };
}

function hydrateMap(baked: BakedRuntimeMap): RuntimeMap {
  return {
    ...baked,
    spawn: vec3(baked.spawn),
    segments: baked.segments.map(hydrateSegment),
    fenceSegments: baked.fenceSegments.map((s: BakedFenceSegment): FenceSegment => ({
      start: vec3(s.start),
      end: vec3(s.end),
    })),
    flowerBeds: baked.flowerBeds.map((b: BakedFlowerBed): FlowerBed => ({
      ...b,
      center: vec3(b.center),
    })),
    flowerFields: baked.flowerFields.map((f: BakedFlowerField): FlowerField => ({
      ...f,
      area: hydrateSegment(f.area),
    })),
    bakedInstances: baked.bakedInstances,
  };
}

// Returns the same shape as normalizeMapPack() — maps, byCode, parSeconds,
// codes, defaultMap — so config.ts can stay structurally unchanged.
export function loadBakedMapPack() {
  const baked = rawBaked as unknown as BakedMapPack;

  // Fire-and-forget dev staleness check. The dynamic import is inside the DEV
  // guard so Vite tree-shakes the entire devMapStaleCheck module from prod builds.
  if (import.meta.env.DEV) {
    import("./devMapStaleCheck").then(({ checkBakedStaleness }) => {
      checkBakedStaleness(baked);
    });
  }

  const maps = baked.maps.map(hydrateMap);
  const byCode = Object.fromEntries(maps.map((m) => [m.code, m])) as Record<string, RuntimeMap>;
  const parSeconds = Object.fromEntries(maps.map((m) => [m.code, m.parSeconds])) as Record<string, number>;
  const codes = maps.map((m) => m.code);
  const defaultMap = baked.defaultLevelCode ? byCode[baked.defaultLevelCode] : undefined;
  return { maps, byCode, parSeconds, codes, defaultMap };
}
