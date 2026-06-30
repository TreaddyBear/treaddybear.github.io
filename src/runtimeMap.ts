import { Vector3 } from "@babylonjs/core";
import type {
  Area,
  AreaShape,
  Distribution,
  FoliageKey,
  LevelV1,
  MapPackV1,
  PathShape,
  Point2,
} from "./mapFormat";
import { levelFullCode, resolveLevelCodeReference } from "./mapFormat";
import type { BakedInstance } from "./bakedMapFormat";
import { valueNoise } from "./utils/noise";
import type { Bounds2 } from "./utils/shapes";
import {
  containsPoint,
  distanceToPath,
  pathBounds,
  pathToPolyline,
  randomPointInShape,
  shapeArea,
  shapeBounds,
  shapeCenter,
  signedDistanceToShapeEdge,
} from "./utils/shapes";

export type RuntimeSegment = {
  xMin: number;
  xMax: number;
  zMin: number;
  zMax: number;
  width: number;
  height: number;
  center: Vector3;
};

export type FenceSegment = {
  start: Vector3;
  end: Vector3;
};

export type FlowerVariant = "blue" | "white" | "yellow" | "red";

export type FlowerField = {
  variant: FlowerVariant;
  area: RuntimeSegment;
  spacing: number;
  sourceArea: Area;
  type: FoliageKey;
};

export type FlowerBed = RuntimeSegment & {
  count: number;
  sourceArea: Area;
};

export type CloverPatch = {
  x: number;
  z: number;
  radius: number;
  spacing?: number;
  grassKeep?: number;
  sourceArea: Area;
};

export type RuntimePathFeature = {
  id: string;
  kind: "road" | "dirtPath" | "fence";
  width: number;
  height?: number;
  postSpacing?: number;
  shape: PathShape;
  points: Point2[];
  bounds: Bounds2;
};

export type RuntimeMap = {
  source?: LevelV1;
  packPrefix: string;
  code: string;
  shortCode: string;
  name: string;
  parSeconds: number;
  spawn: Vector3;
  spawnHeadingDegrees: number;
  areas: Area[];
  mowableAreas: Area[];
  bedAreas: Area[];
  vegetationAreas: Area[];
  roads: RuntimePathFeature[];
  dirtPaths: RuntimePathFeature[];
  fences: RuntimePathFeature[];
  terrain: LevelV1["terrain"];
  objects: unknown[];
  tags: string[];
  bounds: Bounds2;
  mowableArea: number;
  segments: RuntimeSegment[];
  fenceSegments: FenceSegment[];
  flowerBeds: FlowerBed[];
  dandelionCount: number;
  flowerFields: FlowerField[];
  cloverPatches: CloverPatch[];
  /** Bake-time tiered vegetation instances. Engine wiring in a future phase. */
  bakedInstances: BakedInstance[];
};

type AreaSample = {
  mowable: boolean;
  surface: "grass" | "dirt";
  role?: "background" | "lawn" | "bed";
  densities: Map<string, number>;
};

const emptyBounds = (): Bounds2 => ({ xMin: 0, xMax: 0, zMin: 0, zMax: 0 });
const emptySample = (): AreaSample => ({ mowable: false, surface: "grass", densities: new Map() });

const flowerTypeToVariant = {
  flowerBlue: "blue",
  flowerWhite: "white",
  flowerYellow: "yellow",
  flowerRed: "red",
} satisfies Partial<Record<FoliageKey, FlowerVariant>>;

const smoothstep01 = (value: number) => {
  const t = Math.max(0, Math.min(1, value));
  return t * t * (3 - (2 * t));
};

function unionBounds(a: Bounds2, b: Bounds2): Bounds2 {
  if (!Number.isFinite(a.xMin)) {
    return { ...b };
  }
  return {
    xMin: Math.min(a.xMin, b.xMin),
    xMax: Math.max(a.xMax, b.xMax),
    zMin: Math.min(a.zMin, b.zMin),
    zMax: Math.max(a.zMax, b.zMax),
  };
}

function boundsToSegment(bounds: Bounds2): RuntimeSegment {
  const xMin = Number(bounds.xMin.toFixed(6));
  const xMax = Number(bounds.xMax.toFixed(6));
  const zMin = Number(bounds.zMin.toFixed(6));
  const zMax = Number(bounds.zMax.toFixed(6));
  const width = xMax - xMin;
  const height = zMax - zMin;
  return {
    xMin,
    xMax,
    zMin,
    zMax,
    width,
    height,
    center: new Vector3((xMin + xMax) / 2, 0, (zMin + zMax) / 2),
  };
}

function roleDefaults(role: Area["role"]): Pick<AreaSample, "mowable" | "surface" | "role"> {
  if (role === "lawn") {
    return { role, mowable: true, surface: "grass" };
  }
  if (role === "bed") {
    return { role, mowable: false, surface: "dirt" };
  }
  return { role, mowable: false, surface: "grass" };
}

function walkAreas(areas: Area[] | undefined, visit: (area: Area) => void) {
  for (const area of areas ?? []) {
    visit(area);
    walkAreas(area.children, visit);
  }
}

function allAreas(areas: Area[] | undefined) {
  const out: Area[] = [];
  walkAreas(areas, (area) => out.push(area));
  return out;
}

function areaHasLayer(area: Area, type: string) {
  return area.vegetation.some((layer) => layer.type === type);
}

function directAreaSample(area: Area, x: number, z: number): AreaSample {
  const defaults = roleDefaults(area.role);
  const sample: AreaSample = {
    role: area.role,
    mowable: area.mowable ?? defaults.mowable,
    surface: area.surface ?? defaults.surface,
    densities: new Map(),
  };

  for (const layer of area.vegetation) {
    const amount = distributionAmount(layer.distribution, x, z);
    sample.densities.set(layer.type, (sample.densities.get(layer.type) ?? 0) + amount);
  }

  return sample;
}

function scaleSample(sample: AreaSample, amount: number): AreaSample {
  const out = { ...sample, densities: new Map<string, number>() };
  for (const [type, density] of sample.densities) {
    out.densities.set(type, density * amount);
  }
  return out;
}

function addSamples(base: AreaSample, addition: AreaSample): AreaSample {
  const out: AreaSample = {
    role: base.role,
    mowable: base.mowable,
    surface: base.surface,
    densities: new Map(base.densities),
  };

  for (const [type, density] of addition.densities) {
    out.densities.set(type, (out.densities.get(type) ?? 0) + density);
  }

  return out;
}

function lerpSamples(from: AreaSample, to: AreaSample, amount: number): AreaSample {
  // role/mowable/surface belong to whichever replace area spatially contains the point.
  // lerpSamples is only called when the point IS inside the area (fade > 0), so the
  // inner area's non-vegetation properties apply throughout the shape including the
  // falloff band. Vegetation alone cross-fades across that band.
  const out: AreaSample = {
    role: to.role,
    mowable: to.mowable,
    surface: to.surface,
    densities: new Map(),
  };
  const types = new Set([...from.densities.keys(), ...to.densities.keys()]);
  for (const type of types) {
    out.densities.set(type, ((from.densities.get(type) ?? 0) * (1 - amount)) + ((to.densities.get(type) ?? 0) * amount));
  }
  return out;
}

function areaFade(area: Area, x: number, z: number) {
  if (!containsPoint(area.shape, x, z)) {
    return 0;
  }
  const falloff = Math.max(0, area.edgeFalloff ?? 0);
  if (falloff <= 0) {
    return 1;
  }
  return smoothstep01(signedDistanceToShapeEdge(area.shape, x, z) / falloff);
}

function resolveArea(area: Area, inherited: AreaSample, x: number, z: number): AreaSample | null {
  const fade = areaFade(area, x, z);
  if (fade <= 0) {
    return null;
  }

  const direct = directAreaSample(area, x, z);
  const composition = area.composition ?? "replace";
  let resolved = composition === "additive"
    ? addSamples(inherited, scaleSample(direct, fade))
    : lerpSamples(inherited, direct, fade);

  for (const child of area.children ?? []) {
    const childResolved = resolveArea(child, resolved, x, z);
    if (childResolved) {
      resolved = childResolved;
    }
  }

  return resolved;
}

export function sampleMapArea(map: RuntimeMap, x: number, z: number, fallback?: RuntimeMap): AreaSample {
  let sample = emptySample();
  let hasReplace = false;

  for (const area of map.areas) {
    const resolved = resolveArea(area, emptySample(), x, z);
    if (resolved) {
      if (area.composition === "additive") {
        sample = addSamples(sample, resolved);
      } else {
        sample = resolved;
        hasReplace = true;
      }
    }
  }

  // No replace area in the active level covers this point — use the fallback (background
  // level) as the base and layer any additive contributions from this map on top.
  if (!hasReplace && fallback) {
    return addSamples(sampleMapArea(fallback, x, z), sample);
  }

  return sample;
}

export function foliageDensityAt(map: RuntimeMap, type: string, x: number, z: number, fallback?: RuntimeMap) {
  return sampleMapArea(map, x, z, fallback).densities.get(type) ?? 0;
}

export function containsMowablePoint(map: RuntimeMap, x: number, z: number) {
  // Intentionally no fallback: background areas are not mowable.
  return sampleMapArea(map, x, z).mowable;
}

export function surfaceAt(map: RuntimeMap, x: number, z: number, fallback?: RuntimeMap) {
  return sampleMapArea(map, x, z, fallback).surface;
}

export function signedDistanceToMowable(map: RuntimeMap, x: number, z: number) {
  let best = Number.NEGATIVE_INFINITY;
  for (const area of map.mowableAreas) {
    best = Math.max(best, signedDistanceToShapeEdge(area.shape, x, z));
  }
  return Number.isFinite(best) ? best : Number.NEGATIVE_INFINITY;
}

export function distanceToBed(map: RuntimeMap, x: number, z: number) {
  let closest = Number.POSITIVE_INFINITY;
  for (const area of map.bedAreas) {
    const signed = signedDistanceToShapeEdge(area.shape, x, z);
    closest = Math.min(closest, -signed);
  }
  return closest;
}

export function randomMowablePoint(map: RuntimeMap, random = Math.random) {
  if (map.mowableAreas.length === 0) {
    return { x: map.spawn.x, z: map.spawn.z };
  }

  const weighted = map.mowableAreas.map((area) => ({ area, weight: Math.max(0.0001, shapeArea(area.shape)) }));
  const total = weighted.reduce((sum, entry) => sum + entry.weight, 0);

  for (let attempt = 0; attempt < 512; attempt += 1) {
    let pick = random() * total;
    let selected = weighted[0].area;
    for (const entry of weighted) {
      pick -= entry.weight;
      if (pick <= 0) {
        selected = entry.area;
        break;
      }
    }
    const [x, z] = randomPointInShape(selected.shape, random);
    if (containsMowablePoint(map, x, z)) {
      return { x, z };
    }
  }

  const [x, z] = randomPointInShape(weighted[0].area.shape, random);
  return { x, z };
}

export function randomPointInArea(area: Area, random = Math.random) {
  const [x, z] = randomPointInShape(area.shape, random);
  return { x, z };
}

function distributionAmount(distribution: Distribution, x: number, z: number) {
  if (distribution.type === "uniform") {
    return Math.max(0, distribution.density);
  }

  const seed = distribution.noise.seed;
  const warp = distribution.noise.domainWarp ?? 0;
  let sx = x;
  let sz = z;

  if (warp !== 0) {
    sx += (valueNoise((x * 0.21) + (seed * 0.017), (z * 0.21) - (seed * 0.013)) - 0.5) * warp;
    sz += (valueNoise((x * 0.19) - (seed * 0.011), (z * 0.19) + (seed * 0.019)) - 0.5) * warp;
  }

  let total = 0;
  let norm = 0;
  for (const octave of distribution.noise.octaves) {
    const weight = Math.max(0, octave.weight);
    total += valueNoise(
      (sx * octave.frequency) + (seed * 0.013),
      (sz * octave.frequency) - (seed * 0.021),
    ) * weight;
    norm += weight;
  }

  const noise = norm > 0 ? total / norm : 0;
  const softness = Math.max(0.0001, distribution.noise.softness);
  const mask = smoothstep01((noise - distribution.noise.threshold + softness) / (softness * 2));
  return Math.max(0, distribution.density) * mask;
}

function densityToSpacing(density: number, fallback = 0.6) {
  if (density <= 0) {
    return fallback;
  }
  return Math.max(0.18, Number((0.5 / Math.sqrt(Math.max(0.01, density))).toFixed(3)));
}

const fieldFlowerDensityScale = 5;
const sparseColorFlowerDensityScale = fieldFlowerDensityScale * 2;

function flowerDensityToSpacing(type: string, density: number, fallback = 0.6) {
  const scale = type === "flowerBlue" || type === "flowerRed"
    ? sparseColorFlowerDensityScale
    : fieldFlowerDensityScale;
  return densityToSpacing(density * scale, fallback);
}

function pathFeatureBounds(shape: PathShape, width: number): Bounds2 {
  const bounds = pathBounds(shape);
  const margin = Math.max(0, width / 2);
  return {
    xMin: bounds.xMin - margin,
    xMax: bounds.xMax + margin,
    zMin: bounds.zMin - margin,
    zMax: bounds.zMax + margin,
  };
}

function toRuntimePath(feature: { id: string; kind: "road" | "dirtPath" | "fence"; width?: number; height?: number; postSpacing?: number; shape: PathShape }): RuntimePathFeature {
  const width = feature.kind === "fence" ? 0.08 : Math.max(0.01, feature.width ?? 1);
  return {
    id: feature.id,
    kind: feature.kind,
    width,
    height: feature.height,
    postSpacing: feature.postSpacing,
    shape: feature.shape,
    points: pathToPolyline(feature.shape, 24),
    bounds: pathFeatureBounds(feature.shape, width),
  };
}

function fenceSegmentsFromFeature(feature: RuntimePathFeature): FenceSegment[] {
  const segments: FenceSegment[] = [];
  for (let index = 0; index < feature.points.length - 1; index += 1) {
    const [x1, z1] = feature.points[index];
    const [x2, z2] = feature.points[index + 1];
    segments.push({ start: new Vector3(x1, 0, z1), end: new Vector3(x2, 0, z2) });
  }
  return segments;
}

function featureDistanceToEdge(feature: RuntimePathFeature, x: number, z: number) {
  return distanceToPath(feature.shape, x, z, 24) - (feature.width / 2);
}

export function pathSurfaceAmount(features: RuntimePathFeature[], x: number, z: number) {
  let amount = 0;
  for (const feature of features) {
    amount = Math.max(amount, 1 - smoothstep01(featureDistanceToEdge(feature, x, z) / 0.08));
  }
  return amount;
}

export function roadSurfaceAmount(map: RuntimeMap, x: number, z: number) {
  return pathSurfaceAmount(map.roads, x, z);
}

export function dirtPathSurfaceAmount(map: RuntimeMap, x: number, z: number) {
  return pathSurfaceAmount(map.dirtPaths, x, z);
}

export function pathGrassAmount(map: RuntimeMap, x: number, z: number, inset = 0) {
  let amount = 1;
  for (const feature of [...map.roads, ...map.dirtPaths]) {
    const verge = feature.kind === "road" ? 0.35 : 0.12;
    amount = Math.min(amount, smoothstep01((featureDistanceToEdge(feature, x, z) - verge - inset) / 0.08));
  }
  return amount;
}

export function roadVergeDirtAmount(map: RuntimeMap, x: number, z: number, vergeWidth: number) {
  let amount = dirtPathSurfaceAmount(map, x, z);
  for (const road of map.roads) {
    const edge = featureDistanceToEdge(road, x, z);
    const inner = smoothstep01(edge / 0.06);
    const outer = 1 - smoothstep01((edge - vergeWidth) / 0.08);
    amount = Math.max(amount, inner * outer);
  }
  return amount;
}

export function terrainFeatureHeightAt(map: RuntimeMap, x: number, z: number) {
  let height = 0;

  for (const feature of map.terrain.heightFeatures) {
    if (!containsPoint(feature.shape, x, z)) {
      continue;
    }

    const edge = signedDistanceToShapeEdge(feature.shape, x, z);
    const falloff = Math.max(0.0001, feature.falloff);
    const amount = smoothstep01(edge / falloff);
    height = Math.max(height, feature.height * amount);
  }

  return height;
}

export function terrainHeightFromMaps(maps: RuntimeMap[], x: number, z: number) {
  let height = 0;
  for (const map of maps) {
    height = Math.max(height, terrainFeatureHeightAt(map, x, z));
  }
  return height;
}

function estimatedMowableArea(areas: Area[], parentMowable = false): number {
  // Each replace area contributes (isMowable - parentIsMowable) * ownArea, so child
  // beds nested inside a mowable lawn subtract their footprint rather than adding to it.
  // Additive areas don't change mowability, so they pass the parent's flag through.
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

function normalizeLevel(pack: MapPackV1["pack"], level: LevelV1): RuntimeMap {
  const code = levelFullCode(pack.prefix, level);
  const areas = level.areas ?? [];
  const flatAreas = allAreas(areas);
  const mowableAreas = flatAreas.filter((area) => {
    const defaults = roleDefaults(area.role);
    return area.mowable ?? defaults.mowable;
  });
  const bedAreas = flatAreas.filter((area) => {
    const defaults = roleDefaults(area.role);
    return area.role === "bed" || (area.surface ?? defaults.surface) === "dirt";
  });
  const vegetationAreas = flatAreas.filter((area) => area.vegetation.length > 0);
  const roads = (level.roads ?? []).map(toRuntimePath);
  const dirtPaths = (level.dirtPaths ?? []).map(toRuntimePath);
  const fences = (level.fences ?? []).map(toRuntimePath);
  const fenceSegments = fences.flatMap(fenceSegmentsFromFeature);
  const segments = mowableAreas.map((area) => boundsToSegment(shapeBounds(area.shape)));
  const flowerBeds: FlowerBed[] = [];
  const flowerFields: FlowerField[] = [];
  const cloverPatches: CloverPatch[] = [];
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
        flowerFields.push({
          variant: flowerTypeToVariant[type],
          area: bounds,
          spacing: flowerDensityToSpacing(type, density),
          sourceArea: area,
          type,
        });
      } else if (layer.type === "clover") {
        // grassKeep: how much grass remains inside this clover area. In v1 terms that is
        // the area's own grass-layer density (0 = all clover, 1 = full grass underneath).
        // This matches the legacy CloverPatch.grassKeep semantics when the parent lawn
        // has density 1.0, which is the common case for all current levels.
        const grassKeep = area.vegetation.find((entry) => entry.type === "grass")?.distribution.density ?? 0;
        const center = shapeCenter(area.shape);
        if (area.shape.type === "circle") {
          cloverPatches.push({
            x: center.x,
            z: center.z,
            radius: area.shape.radius,
            grassKeep,
            sourceArea: area,
          });
        } else {
          // Non-circle: use an area-equivalent circle so instance count is preserved.
          // The clover renderer still draws a circle shape, but at least the area budget
          // (and therefore the number of instances) matches the authored footprint.
          const equivalentRadius = Math.sqrt(Math.max(0, shapeArea(area.shape)) / Math.PI);
          cloverPatches.push({
            x: center.x,
            z: center.z,
            radius: Math.max(0.1, equivalentRadius),
            grassKeep,
            sourceArea: area,
          });
        }
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

  return {
    source: level,
    packPrefix: pack.prefix,
    code,
    shortCode: level.code,
    name: level.name,
    parSeconds: level.parSeconds,
    spawn: new Vector3(level.spawn.position[0], 0, level.spawn.position[1]),
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
    bakedInstances: [],  // normalizeLevel is dev-path only; instances baked by pnpm bake
  };
}

export function normalizeMapPack(pack: MapPackV1) {
  const maps = pack.levels.map((level) => normalizeLevel(pack.pack, level));
  const byCode = Object.fromEntries(maps.map((map) => [map.code, map])) as Record<string, RuntimeMap>;
  const parSeconds = Object.fromEntries(maps.map((map) => [map.code, map.parSeconds])) as Record<string, number>;
  const codes = maps.map((map) => map.code);
  const defaultCode = pack.defaultLevelCode ? resolveLevelCodeReference(pack.pack.prefix, pack.levels, pack.defaultLevelCode) : undefined;
  const defaultMap = defaultCode ? byCode[defaultCode] : undefined;
  return { maps, byCode, parSeconds, codes, defaultMap };
}

