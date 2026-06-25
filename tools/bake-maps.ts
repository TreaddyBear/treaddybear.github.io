// Bake tool: validates the authored map source and emits a pre-normalized
// baked artifact that the engine loads directly.
//
// Run with: pnpm bake   (or: npx tsx tools/bake-maps.ts)
//
// Exits 1 if validation fails. Produces no output on partial failure.
//
// This file intentionally does NOT import from src/runtimeMap.ts because that
// module depends on Babylon.js Vector3, which is a browser runtime library.
// The normalization logic here (bakeLevel) mirrors normalizeLevel in runtimeMap.ts
// but produces BakedRuntimeMap (plain objects) instead of RuntimeMap (Vector3).
// Keep the two in sync when normalizeLevel changes.

import { readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import type { Area, FoliageKey, LevelV1, MapPackV1, PathShape } from "../src/mapFormat";
import { foliageRegistry, fullLevelCode } from "../src/mapFormat";
import { assertMapPackValid } from "../src/mapValidator";
import {
  containsPoint,
  distanceToPath,
  pathBounds,
  pathToPolyline,
  shapeArea,
  shapeBounds,
  shapeCenter,
  signedDistanceToShapeEdge,
} from "../src/utils/shapes";
import { valueNoise } from "../src/utils/noise";

import type {
  BakedCloverPatch,
  BakedFenceSegment,
  BakedFlowerBed,
  BakedFlowerField,
  BakedMapPack,
  BakedRuntimeMap,
  BakedRuntimePathFeature,
  BakedRuntimeSegment,
  BakedVec3,
} from "../src/bakedMapFormat";
import { computeAllTierInstances } from "./vegetation-sampler";
import type { Bounds2 } from "../src/utils/shapes";

// ---------------------------------------------------------------------------
// Mirror of runtimeMap.ts private helpers (no Babylon.js dependency)
// ---------------------------------------------------------------------------

type Point2 = [number, number];

const smoothstep01 = (v: number) => {
  const t = Math.max(0, Math.min(1, v));
  return t * t * (3 - 2 * t);
};

function unionBounds(a: Bounds2, b: Bounds2): Bounds2 {
  if (!Number.isFinite(a.xMin)) return { ...b };
  return {
    xMin: Math.min(a.xMin, b.xMin),
    xMax: Math.max(a.xMax, b.xMax),
    zMin: Math.min(a.zMin, b.zMin),
    zMax: Math.max(a.zMax, b.zMax),
  };
}

function boundsToSegment(bounds: Bounds2): BakedRuntimeSegment {
  const xMin = Number(bounds.xMin.toFixed(6));
  const xMax = Number(bounds.xMax.toFixed(6));
  const zMin = Number(bounds.zMin.toFixed(6));
  const zMax = Number(bounds.zMax.toFixed(6));
  const width = xMax - xMin;
  const height = zMax - zMin;
  return {
    xMin, xMax, zMin, zMax, width, height,
    // BakedVec3 instead of new Vector3(...)
    center: { x: (xMin + xMax) / 2, y: 0, z: (zMin + zMax) / 2 },
  };
}

type RoleDefaults = { mowable: boolean; surface: "grass" | "dirt"; role: Area["role"] };
function roleDefaults(role: Area["role"]): RoleDefaults {
  if (role === "lawn") return { role, mowable: true, surface: "grass" };
  if (role === "bed")  return { role, mowable: false, surface: "dirt" };
  return { role, mowable: false, surface: "grass" };
}

function walkAreas(areas: Area[] | undefined, visit: (area: Area) => void) {
  for (const area of areas ?? []) {
    visit(area);
    walkAreas(area.children, visit);
  }
}

function allAreas(areas: Area[] | undefined): Area[] {
  const out: Area[] = [];
  walkAreas(areas, (a) => out.push(a));
  return out;
}

type Distribution = MapPackV1["levels"][number]["areas"][number]["vegetation"][number]["distribution"];

function distributionAmount(distribution: Distribution, x: number, z: number): number {
  if (distribution.type === "uniform") {
    return Math.max(0, distribution.density);
  }
  const seed = distribution.noise.seed;
  const warp = distribution.noise.domainWarp ?? 0;
  let sx = x, sz = z;
  if (warp !== 0) {
    sx += (valueNoise((x * 0.21) + (seed * 0.017), (z * 0.21) - (seed * 0.013)) - 0.5) * warp;
    sz += (valueNoise((x * 0.19) - (seed * 0.011), (z * 0.19) + (seed * 0.019)) - 0.5) * warp;
  }
  let total = 0, norm = 0;
  for (const oct of distribution.noise.octaves) {
    const w = Math.max(0, oct.weight);
    total += valueNoise((sx * oct.frequency) + (seed * 0.013), (sz * oct.frequency) - (seed * 0.021)) * w;
    norm += w;
  }
  const noise = norm > 0 ? total / norm : 0;
  const softness = Math.max(0.0001, distribution.noise.softness);
  const mask = smoothstep01((noise - distribution.noise.threshold + softness) / (softness * 2));
  return Math.max(0, distribution.density) * mask;
}

function densityToSpacing(density: number, fallback = 0.6): number {
  if (density <= 0) return fallback;
  return Math.max(0.18, Number((0.5 / Math.sqrt(Math.max(0.01, density))).toFixed(3)));
}

function pathFeatureBounds(shape: PathShape, width: number): Bounds2 {
  const b = pathBounds(shape);
  const m = Math.max(0, width / 2);
  return { xMin: b.xMin - m, xMax: b.xMax + m, zMin: b.zMin - m, zMax: b.zMax + m };
}

function toRuntimePath(feature: {
  id: string;
  kind: "road" | "dirtPath" | "fence";
  width?: number;
  height?: number;
  postSpacing?: number;
  shape: PathShape;
}): BakedRuntimePathFeature {
  const width = feature.kind === "fence" ? 0.08 : Math.max(0.01, feature.width ?? 1);
  return {
    id: feature.id,
    kind: feature.kind,
    width,
    height: feature.height,
    postSpacing: feature.postSpacing,
    shape: feature.shape,
    points: pathToPolyline(feature.shape, 24) as Point2[],
    bounds: pathFeatureBounds(feature.shape, width),
  };
}

function fenceSegmentsFromFeature(feature: BakedRuntimePathFeature): BakedFenceSegment[] {
  const segs: BakedFenceSegment[] = [];
  for (let i = 0; i < feature.points.length - 1; i++) {
    const [x1, z1] = feature.points[i];
    const [x2, z2] = feature.points[i + 1];
    // BakedVec3 instead of new Vector3(...)
    segs.push({ start: { x: x1, y: 0, z: z1 }, end: { x: x2, y: 0, z: z2 } });
  }
  return segs;
}

function estimatedMowableArea(areas: Area[], parentMowable = false): number {
  let total = 0;
  for (const area of areas) {
    const defaults = roleDefaults(area.role);
    const mowable = area.mowable ?? defaults.mowable;
    const isReplace = (area.composition ?? "replace") === "replace";
    if (isReplace) {
      total += ((mowable ? 1 : 0) - (parentMowable ? 1 : 0)) * shapeArea(area.shape);
      total += estimatedMowableArea(area.children ?? [], mowable);
    } else {
      total += estimatedMowableArea(area.children ?? [], parentMowable);
    }
  }
  return total;
}

const flowerTypeToVariant: Partial<Record<FoliageKey, "blue" | "white" | "yellow" | "red">> = {
  flowerBlue: "blue",
  flowerWhite: "white",
  flowerYellow: "yellow",
  flowerRed: "red",
};

// ---------------------------------------------------------------------------
// Core bake function — mirrors normalizeLevel but outputs BakedRuntimeMap
// ---------------------------------------------------------------------------

function bakeLevel(pack: MapPackV1["pack"], level: LevelV1): BakedRuntimeMap {
  const code = fullLevelCode(pack.prefix, level.code);
  const areas = level.areas ?? [];
  const flatAreas = allAreas(areas);

  const mowableAreas = flatAreas.filter((a) => {
    const d = roleDefaults(a.role);
    return a.mowable ?? d.mowable;
  });
  const bedAreas = flatAreas.filter((a) => {
    const d = roleDefaults(a.role);
    return a.role === "bed" || (a.surface ?? d.surface) === "dirt";
  });
  const vegetationAreas = flatAreas.filter((a) => a.vegetation.length > 0);

  const roads      = (level.roads      ?? []).map((r) => toRuntimePath({ ...r, kind: "road" }));
  const dirtPaths  = (level.dirtPaths  ?? []).map((p) => toRuntimePath({ ...p, kind: "dirtPath" }));
  const fences     = (level.fences     ?? []).map((f) => toRuntimePath({ ...f, kind: "fence" }));
  const fenceSegments = fences.flatMap(fenceSegmentsFromFeature);
  const segments   = mowableAreas.map((a) => boundsToSegment(shapeBounds(a.shape)));

  const flowerBeds: BakedFlowerBed[] = [];
  const flowerFields: BakedFlowerField[] = [];
  const cloverPatches: BakedCloverPatch[] = [];
  let dandelionCount = 0;

  for (const area of vegetationAreas) {
    const bounds = boundsToSegment(shapeBounds(area.shape));
    const areaSize = Math.max(0, shapeArea(area.shape));

    for (const layer of area.vegetation) {
      const density = Math.max(0, layer.distribution.density);
      if (layer.type === "tulip") {
        flowerBeds.push({ ...bounds, count: Math.max(1, Math.round(areaSize * density * 4)), sourceArea: area });
      } else if (layer.type === "dandelion") {
        dandelionCount += Math.round(areaSize * density);
      } else if (layer.type in flowerTypeToVariant) {
        const type = layer.type as keyof typeof flowerTypeToVariant;
        const variant = flowerTypeToVariant[type]!;
        flowerFields.push({ variant, area: bounds, spacing: densityToSpacing(density), sourceArea: area, type });
      } else if (layer.type === "clover") {
        const grassKeep = area.vegetation.find((e) => e.type === "grass")?.distribution.density ?? 0;
        const center = shapeCenter(area.shape);
        const radius = area.shape.type === "circle"
          ? area.shape.radius
          : Math.max(0.1, Math.sqrt(Math.max(0, shapeArea(area.shape)) / Math.PI));
        cloverPatches.push({ x: center.x, z: center.z, radius, grassKeep, sourceArea: area });
      }
    }
  }

  let bounds: Bounds2 = { xMin: Infinity, xMax: -Infinity, zMin: Infinity, zMax: -Infinity };
  for (const area of flatAreas) {
    bounds = unionBounds(bounds, shapeBounds(area.shape));
  }
  for (const feature of [...roads, ...dirtPaths, ...fences]) {
    bounds = unionBounds(bounds, feature.bounds);
  }
  if (!Number.isFinite(bounds.xMin)) {
    const [x, z] = level.spawn.position;
    bounds = { xMin: x - 8, xMax: x + 8, zMin: z - 8, zMax: z + 8 };
  }

  const bakedInstances = computeAllTierInstances(areas, fullLevelCode(pack.prefix, level.code));

  return {
    packPrefix: pack.prefix,
    code,
    shortCode: level.code,
    name: level.name,
    parSeconds: level.parSeconds,
    // BakedVec3 instead of new Vector3(...)
    spawn: { x: level.spawn.position[0], y: 0, z: level.spawn.position[1] },
    spawnHeadingDegrees: level.spawn.headingDegrees,
    areas,
    mowableAreas,
    bedAreas,
    vegetationAreas,
    roads,
    dirtPaths,
    fences,
    terrain: level.terrain ?? { heightFeatures: [] },
    objects: level.objects ?? [],
    tags: level.tags ?? [],
    bounds,
    mowableArea: estimatedMowableArea(areas),
    segments,
    fenceSegments,
    flowerBeds,
    dandelionCount,
    flowerFields,
    cloverPatches,
    bakedInstances,
  };
}

// FNV-1a 32-bit hash — fast, dependency-free, deterministic across V8
// (Node.js and browser). Used to detect stale baked artifacts at dev startup.
// Same implementation must be used in src/devMapStaleCheck.ts.
function fnv1a(str: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < str.length; i += 1) {
    hash = ((hash ^ str.charCodeAt(i)) * 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

function bakeMapPack(pack: MapPackV1, sourceHash: string): BakedMapPack {
  const maps = pack.levels.map((level) => bakeLevel(pack.pack, level));
  const defaultCode = pack.defaultLevelCode
    ? fullLevelCode(pack.pack.prefix, pack.defaultLevelCode)
    : undefined;
  return {
    bakedVersion: 1,
    sourceHash,
    defaultLevelCode: defaultCode,
    maps,
  };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const __dirname = dirname(fileURLToPath(import.meta.url));
const sourcePath = resolve(__dirname, "../map-exports/lawn-maps.json");
const outputPath = resolve(__dirname, "../map-exports/lawn-maps.baked.json");

const raw = JSON.parse(readFileSync(sourcePath, "utf-8")) as MapPackV1;

// Hash the parsed source (JSON.stringify normalises whitespace/formatting)
// so the dev-time staleness check can detect edits without re-baking.
const sourceHash = fnv1a(JSON.stringify(raw));

// Validate — exits loudly if the source is malformed.
assertMapPackValid(raw);

const baked = bakeMapPack(raw, sourceHash);

writeFileSync(outputPath, JSON.stringify(baked, null, 2), "utf-8");

const mapCount = baked.maps.length;
const totalAreas = baked.maps.reduce((n, m) => n + allAreas(m.areas).length, 0);
const totalSegments = baked.maps.reduce((n, m) => n + m.segments.length, 0);
console.log(`Baked ${mapCount} levels — ${totalAreas} areas, ${totalSegments} mowable segments → ${outputPath}`);
