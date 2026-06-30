// Bake-time vegetation sampler: tiered unified-categorical Poisson-disk placement.
//
// Density computation mirrors src/runtimeMap.ts exactly (no Babylon.js dependency).
// The tiered approach:
//   Tier 1 "flowers"     – flowerBlue/White/Yellow/Red, tulip; min spacing 0.45 m
//   Tier 2 "groundcover" – clover, dandelion;                  min spacing 0.30 m
//
// Tier 1 is sampled first. Its placed positions are fed into Tier 2 as pre-occupied
// exclusion zones, preventing ground-cover instances from being placed within the
// Tier 2 min spacing of any flower. Within each tier a single Bridson Poisson-disk
// pass generates positions; type is drawn from the local categorical distribution
// d_i(p)/T(p) for each placed point.

import type { Area, Distribution } from "../src/mapFormat";
import type { BakedInstance } from "../src/bakedMapFormat";
import type { Bounds2 } from "../src/utils/shapes";
import {
  containsPoint,
  signedDistanceToShapeEdge,
  shapeBounds,
} from "../src/utils/shapes";
import { valueNoise } from "../src/utils/noise";
import { encodePNG } from "./png-writer";

// ---------------------------------------------------------------------------
// Seeded PRNG
// ---------------------------------------------------------------------------

/** 32-bit linear congruential generator. Same seed always produces same sequence. */
export class LCG {
  private s: number;
  constructor(seed: number) {
    this.s = (seed ^ 0xdeadbeef) >>> 0;
  }
  /** Float in [0, 1). */
  next(): number {
    this.s = (Math.imul(this.s, 1664525) + 1013904223) >>> 0;
    return this.s / 4294967296;
  }
}

// ---------------------------------------------------------------------------
// Density field — mirrors runtimeMap.ts exactly
// ---------------------------------------------------------------------------

const smoothstep01 = (v: number): number => {
  const t = Math.max(0, Math.min(1, v));
  return t * t * (3 - 2 * t);
};

function distributionAmount(dist: Distribution, x: number, z: number): number {
  if (dist.type === "uniform") return Math.max(0, dist.density);
  const { seed, octaves, threshold, softness, domainWarp } = dist.noise;
  const warp = domainWarp ?? 0;
  let sx = x, sz = z;
  if (warp !== 0) {
    sx += (valueNoise((x * 0.21) + (seed * 0.017), (z * 0.21) - (seed * 0.013)) - 0.5) * warp;
    sz += (valueNoise((x * 0.19) - (seed * 0.011), (z * 0.19) + (seed * 0.019)) - 0.5) * warp;
  }
  let total = 0, norm = 0;
  for (const oct of octaves) {
    const w = Math.max(0, oct.weight);
    total += valueNoise((sx * oct.frequency) + (seed * 0.013), (sz * oct.frequency) - (seed * 0.021)) * w;
    norm += w;
  }
  const noise = norm > 0 ? total / norm : 0;
  const s = Math.max(0.0001, softness);
  const mask = smoothstep01((noise - threshold + s) / (s * 2));
  return Math.max(0, dist.density) * mask;
}

function areaFade(area: Area, x: number, z: number): number {
  if (!containsPoint(area.shape, x, z)) return 0;
  const falloff = Math.max(0, area.edgeFalloff ?? 0);
  if (falloff <= 0) return 1;
  return smoothstep01(signedDistanceToShapeEdge(area.shape, x, z) / falloff);
}

type DensMap = Map<string, number>;

function addDens(a: DensMap, b: DensMap): DensMap {
  const out = new Map(a);
  for (const [k, v] of b) out.set(k, (out.get(k) ?? 0) + v);
  return out;
}

function scaleDens(d: DensMap, f: number): DensMap {
  const out = new Map<string, number>();
  for (const [k, v] of d) out.set(k, v * f);
  return out;
}

function lerpDens(from: DensMap, to: DensMap, t: number): DensMap {
  const out = new Map<string, number>();
  const types = new Set([...from.keys(), ...to.keys()]);
  for (const type of types) {
    out.set(type, ((from.get(type) ?? 0) * (1 - t)) + ((to.get(type) ?? 0) * t));
  }
  return out;
}

function resolveAreaDens(area: Area, inherited: DensMap, x: number, z: number): DensMap | null {
  const fade = areaFade(area, x, z);
  if (fade <= 0) return null;

  const own = new Map<string, number>();
  for (const layer of area.vegetation) {
    const d = distributionAmount(layer.distribution, x, z);
    own.set(layer.type, (own.get(layer.type) ?? 0) + d);
  }

  const comp = area.composition ?? "replace";
  let resolved: DensMap = comp === "additive"
    ? addDens(inherited, scaleDens(own, fade))
    : lerpDens(inherited, own, fade);

  for (const child of area.children ?? []) {
    const r = resolveAreaDens(child, resolved, x, z);
    if (r !== null) resolved = r;
  }
  return resolved;
}

/**
 * Compute vegetation densities at (x, z). Mirrors runtimeMap.ts#sampleMapArea.
 * Returns a Map<type → density>.
 */
export function sampleDensitiesAt(areas: Area[], x: number, z: number): DensMap {
  let result: DensMap = new Map();
  for (const area of areas) {
    const resolved = resolveAreaDens(area, new Map(), x, z);
    if (resolved !== null) {
      const comp = area.composition ?? "replace";
      result = comp === "additive" ? addDens(result, resolved) : resolved;
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// Tier definitions
// ---------------------------------------------------------------------------

export const TIERS = [
  // Coarse tier: flowers — sampled first; positions become exclusion zones for Tier 2
  { id: "flowers",     types: ["flowerBlue", "flowerWhite", "flowerYellow", "flowerRed", "tulip"], minSpacing: 0.45 },
  // Fine tier: ground cover — clover and dandelion
  { id: "groundcover", types: ["clover", "dandelion"], minSpacing: 0.30 },
] as const;

export type TierDef = (typeof TIERS)[number];
export type BakeProgressEvent = {
  levelCode: string;
  tierId: TierDef["id"];
  areaId: string;
  attempts: number;
  accepted: number;
  active: number;
  elapsedMs: number;
};
export type BakeDiagnostic = {
  levelCode: string;
  tierId: TierDef["id"];
  areaId: string;
  reason: string;
  attempts: number;
  accepted: number;
  elapsedMs: number;
  image: Buffer;
};
export type BakeControl = {
  onProgress?: (event: BakeProgressEvent) => void;
  onDiagnostic?: (diagnostic: BakeDiagnostic) => void;
  shouldAbort?: () => boolean;
};

class VegetationBakeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "VegetationBakeError";
  }
}

const FIELD_FLOWER_DENSITY_SCALE = 5;
const SPARSE_COLOR_FLOWER_DENSITY_SCALE = FIELD_FLOWER_DENSITY_SCALE * 2;

function speciesPlacementScale(type: string): number {
  if (type === "flowerBlue" || type === "flowerRed") {
    return SPARSE_COLOR_FLOWER_DENSITY_SCALE;
  }

  return (
    type === "flowerWhite"
    || type === "flowerYellow"
  ) ? FIELD_FLOWER_DENSITY_SCALE : 1;
}

// Authored density semantics for placement:
//   1.0 = full target density, with breathing room
//   2.0 = lush/crowded maximum pressure
//
// The raw density map is still used for categorical type weights and debug
// heatmaps. This remap only controls Poisson spacing/counts, so authors get
// headroom above the normal "100%" value instead of density=1 already being
// the top of the useful range.
const PLACEMENT_DENSITY_HEADROOM = 2;
const MIN_PLACEMENT_DENSITY = 0.001;

function placementDensity(rawTotalDensity: number): number {
  return Math.max(0, Math.min(rawTotalDensity, PLACEMENT_DENSITY_HEADROOM)) / PLACEMENT_DENSITY_HEADROOM;
}

function calibratedPlacementDensity(type: string, rawDensity: number): number {
  return placementDensity(rawDensity) * speciesPlacementScale(type);
}

// ---------------------------------------------------------------------------
// Bridson Poisson-disk sampler (variable radius)
// ---------------------------------------------------------------------------

/**
 * Generate blue-noise positions within `bounds` where `totalDensity > 0`.
 * Local spacing ∝ minSpacing / √(totalDensity), capped at 8× density.
 * `preOccupied` positions act as exclusion zones (from a previous tier).
 * Returns only the newly placed positions (not preOccupied entries).
 */
function bridsonSample(opts: {
  levelCode: string;
  tierId: TierDef["id"];
  areaId: string;
  bounds: Bounds2;
  totalDensity: (x: number, z: number) => number;
  minSpacing: number;
  rng: LCG;
  k?: number;
  preOccupied?: [number, number][];
  control?: BakeControl;
}): [number, number][] {
  const { levelCode, tierId, areaId, bounds, totalDensity, minSpacing, rng, k = 30, preOccupied = [], control } = opts;
  const { xMin, xMax, zMin, zMax } = bounds;
  const startedAt = Date.now();
  let attempts = 0;
  let accepted = 0;
  let lastProgressAt = startedAt;
  let attemptsSinceAccepted = 0;
  const maxAttempts = Math.max(120_000, Math.ceil(((xMax - xMin) * (zMax - zMin)) / Math.max(0.0001, minSpacing * minSpacing)) * 600);
  const maxAttemptsSinceAccepted = Math.max(18_000, Math.ceil(maxAttempts * 0.12));

  // r(x,z) = minSpacing / sqrt(clamp(density, 0, 8))
  // Absolute minimum radius = minSpacing / sqrt(8) → cell size = that / sqrt(2) = minSpacing / 4
  const cellSize = minSpacing / 4;
  const gridW = Math.ceil((xMax - xMin) / cellSize) + 2;
  const gridH = Math.ceil((zMax - zMin) / cellSize) + 2;

  // Sparse grid of accepted point indices. A cell can hold multiple points when
  // a denser earlier tier is used as pre-occupied exclusion for a coarser tier.
  const grid = new Map<number, number[]>();

  // All accepted positions: [preOccupied…, newly placed…]
  const pts: [number, number][] = [];
  const active: number[] = [];  // indices into pts[] — only newly placed are active

  const cellOf = (x: number, z: number): [number, number] => [
    Math.max(0, Math.min(gridW - 1, Math.floor((x - xMin) / cellSize))),
    Math.max(0, Math.min(gridH - 1, Math.floor((z - zMin) / cellSize))),
  ];

  const cellKey = (cx: number, cz: number) => (cz * gridW) + cx;

  const inBounds = (x: number, z: number) =>
    x >= xMin && x <= xMax && z >= zMin && z <= zMax;

  const densityAt = (x: number, z: number) => {
    const density = totalDensity(x, z);
    return density >= MIN_PLACEMENT_DENSITY ? density : 0;
  };

  const emitProgress = (force = false) => {
    const now = Date.now();
    if (!force && attempts % 100_000 !== 0 && now - lastProgressAt < 1_000) {
      return;
    }
    lastProgressAt = now;
    control?.onProgress?.({
      levelCode,
      tierId,
      areaId,
      attempts,
      accepted,
      active: active.length,
      elapsedMs: now - startedAt,
    });
  };

  const diagnosticImage = (reason: string) => {
    const width = 128;
    const height = 128;
    const rgba = new Uint8Array(width * height * 4);
    for (let py = 0; py < height; py += 1) {
      const z = zMax - ((py / Math.max(1, height - 1)) * (zMax - zMin));
      for (let px = 0; px < width; px += 1) {
        const x = xMin + ((px / Math.max(1, width - 1)) * (xMax - xMin));
        const density = Math.max(0, Math.min(1, totalDensity(x, z) / 5));
        const offset = ((py * width) + px) * 4;
        const shade = Math.round(28 + (density * 170));
        rgba[offset] = shade;
        rgba[offset + 1] = shade;
        rgba[offset + 2] = shade;
        rgba[offset + 3] = 255;
      }
    }
    for (const [x, z] of pts) {
      const px = Math.round(((x - xMin) / Math.max(0.0001, xMax - xMin)) * (width - 1));
      const py = Math.round(((zMax - z) / Math.max(0.0001, zMax - zMin)) * (height - 1));
      for (let oy = -1; oy <= 1; oy += 1) {
        for (let ox = -1; ox <= 1; ox += 1) {
          const ix = px + ox;
          const iy = py + oy;
          if (ix < 0 || ix >= width || iy < 0 || iy >= height) continue;
          const offset = ((iy * width) + ix) * 4;
          rgba[offset] = 255;
          rgba[offset + 1] = 120;
          rgba[offset + 2] = 32;
          rgba[offset + 3] = 255;
        }
      }
    }
    control?.onDiagnostic?.({
      levelCode,
      tierId,
      areaId,
      reason,
      attempts,
      accepted,
      elapsedMs: Date.now() - startedAt,
      image: encodePNG(width, height, rgba),
    });
  };

  const fail = (reason: string): never => {
    emitProgress(true);
    diagnosticImage(reason);
    throw new VegetationBakeError(`${levelCode}/${tierId}/${areaId}: ${reason} after ${attempts} attempts, ${accepted} accepted`);
  };

  const tickAttempt = () => {
    attempts += 1;
    attemptsSinceAccepted += 1;
    emitProgress();
    if (control?.shouldAbort?.()) {
      fail("aborted");
    }
    if (attempts > maxAttempts) {
      fail("maxAttempts");
    }
    if (accepted > 0 && attemptsSinceAccepted > maxAttemptsSinceAccepted) {
      fail("noProgress");
    }
  };

  const localR = (x: number, z: number): number => {
    const d = densityAt(x, z);
    if (d <= 0) return minSpacing * 8;  // sentinel — no placement here
    return Math.min(minSpacing * 8, minSpacing / Math.sqrt(Math.min(d, 8)));
  };

  // Add a point to the grid (makeActive=false for preOccupied points)
  const addPoint = (x: number, z: number, makeActive: boolean) => {
    const idx = pts.length;
    const [cx, cz] = cellOf(x, z);
    const key = cellKey(cx, cz);
    const bucket = grid.get(key);
    if (bucket) {
      bucket.push(idx);
    } else {
      grid.set(key, [idx]);
    }
    pts.push([x, z]);
    if (makeActive) active.push(idx);
  };

  // Is point (x,z) too close to any accepted point, given the candidate's radius r?
  const tooClose = (x: number, z: number, r: number): boolean => {
    const [cx, cz] = cellOf(x, z);
    const sr = Math.ceil(r / cellSize) + 1;
    for (let dz = -sr; dz <= sr; dz++) {
      for (let dx = -sr; dx <= sr; dx++) {
        const nx = cx + dx, nz = cz + dz;
        if (nx < 0 || nx >= gridW || nz < 0 || nz >= gridH) continue;
        const bucket = grid.get(cellKey(nx, nz));
        if (!bucket) continue;
        for (const idx of bucket) {
          const [px, pz] = pts[idx]!;
          if ((px - x) ** 2 + (pz - z) ** 2 < r * r) return true;
        }
      }
    }
    return false;
  };

  // Register preOccupied points (not active — they act as fixed obstacles)
  for (const pos of preOccupied) addPoint(pos[0], pos[1], false);
  const preOccupiedCount = pts.length;

  // Find a starting point where density > 0
  let foundStart = false;
  for (let attempt = 0; attempt < 3000; attempt++) {
    tickAttempt();
    const x = xMin + rng.next() * (xMax - xMin);
    const z = zMin + rng.next() * (zMax - zMin);
    if (densityAt(x, z) > 0 && !tooClose(x, z, localR(x, z))) {
      addPoint(x, z, true);
      accepted += 1;
      attemptsSinceAccepted = 0;
      foundStart = true;
      break;
    }
  }
  if (!foundStart) return [];

  while (active.length > 0) {
    // Pick a random active point
    const ai = Math.floor(rng.next() * active.length);
    const pi = active[ai]!;
    const [px, pz] = pts[pi]!;
    const r0 = localR(px, pz);

    let placed = false;
    for (let attempt = 0; attempt < k; attempt++) {
      tickAttempt();
      const angle = rng.next() * Math.PI * 2;
      const dist = r0 * (1 + rng.next());  // annulus [r0, 2r0]
      const x = px + Math.cos(angle) * dist;
      const z = pz + Math.sin(angle) * dist;
      if (!inBounds(x, z)) continue;
      if (densityAt(x, z) <= 0) continue;
      const r = localR(x, z);
      if (!tooClose(x, z, r)) {
        addPoint(x, z, true);
        accepted += 1;
        attemptsSinceAccepted = 0;
        placed = true;
        break;
      }
    }

    if (!placed) {
      active[ai] = active[active.length - 1]!;
      active.pop();
    }
  }

  emitProgress(true);
  // Return only the newly placed points (not preOccupied)
  return pts.slice(preOccupiedCount);
}

// ---------------------------------------------------------------------------
// Tier sampler
// ---------------------------------------------------------------------------

/** Recursively find all areas that directly carry at least one type from typeSet. */
function findContributingAreas(areas: Area[], typeSet: Set<string>): Area[] {
  const result: Area[] = [];
  const visit = (area: Area) => {
    if (area.vegetation.some((v) => typeSet.has(v.type))) result.push(area);
    for (const child of area.children ?? []) visit(child);
  };
  for (const area of areas) visit(area);
  return result;
}

/**
 * Sample one tier using the unified-categorical approach.
 *
 * Bridson's algorithm is local (expands from a seed point via an active list).
 * It cannot jump across large zero-density gaps between disconnected patches.
 * To handle levels with multiple separate patches (e.g., three flower squares in
 * showcase), we run one Bridson pass PER contributing area and share the occupied
 * list across passes. The RNG state threads through all passes, so the output is
 * still deterministic from the seed.
 *
 * `suppressedPositions`: positions from higher-priority tiers (exclusion zones).
 */
function sampleOneTier(
  areas: Area[],
  tier: TierDef,
  seed: number,
  suppressedPositions: [number, number][],
  levelCode: string,
  control?: BakeControl,
): BakedInstance[] {
  const { types, minSpacing } = tier;
  const typeSet = new Set(types);
  const rng = new LCG(seed);

  const totalDensityAt = (x: number, z: number): number => {
    const d = sampleDensitiesAt(areas, x, z);
    let total = 0;
    for (const type of types) total += calibratedPlacementDensity(type, d.get(type) ?? 0);
    return total;
  };

  // Collect contributing areas; deduplicate by id to avoid double-sampling
  // areas that appear multiple times (e.g., two children at the same bounds).
  const contributing = findContributingAreas(areas, typeSet);
  const seen = new Set<string>();
  const uniqueContributing = contributing.filter((a) => {
    if (seen.has(a.id)) return false;
    seen.add(a.id);
    return true;
  });

  if (uniqueContributing.length === 0) return [];

  const instances: BakedInstance[] = [];
  // `occupied` accumulates all placed positions: suppressions + newly placed.
  // Each Bridson pass extends this list so later passes respect earlier ones.
  const occupied: [number, number][] = [...suppressedPositions];

  for (const area of uniqueContributing) {
    const b = shapeBounds(area.shape);
    const margin = Math.max(0.5, area.edgeFalloff ?? 0);
    const areaBounds: Bounds2 = {
      xMin: b.xMin - margin, xMax: b.xMax + margin,
      zMin: b.zMin - margin, zMax: b.zMax + margin,
    };

    const newPositions = bridsonSample({
      levelCode,
      tierId: tier.id,
      areaId: area.id,
      bounds: areaBounds,
      totalDensity: totalDensityAt,
      minSpacing,
      rng,
      k: 30,
      preOccupied: occupied,
      control,
    });

    for (const [x, z] of newPositions) {
      // Categorical type draw from local d_i / T
      const d = sampleDensitiesAt(areas, x, z);
      const dArr = types.map((t) => Math.max(0, calibratedPlacementDensity(t, d.get(t) ?? 0)));
      const total = dArr.reduce((a, b) => a + b, 0);

      let type: string = types[0]!;
      if (total > 0) {
        let r = rng.next() * total;
        for (let j = 0; j < types.length; j++) {
          r -= dArr[j]!;
          if (r <= 0) { type = types[j]!; break; }
        }
      }

      const inst: BakedInstance = {
        x: Math.round(x * 1000) / 1000,
        z: Math.round(z * 1000) / 1000,
        type,
        index: 0,
      };
      instances.push(inst);
      occupied.push([x, z]);
    }
  }

  return instances;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Compute the union of shape bounds for all areas (recursively) in a level.
 */
export function levelBounds(areas: Area[]): Bounds2 {
  let xMin = Infinity, xMax = -Infinity, zMin = Infinity, zMax = -Infinity;
  const visit = (area: Area) => {
    const b = shapeBounds(area.shape);
    xMin = Math.min(xMin, b.xMin); xMax = Math.max(xMax, b.xMax);
    zMin = Math.min(zMin, b.zMin); zMax = Math.max(zMax, b.zMax);
    for (const child of area.children ?? []) visit(child);
  };
  for (const area of areas) visit(area);
  return { xMin, xMax, zMin, zMax };
}

/**
 * Compute tight bounds covering only areas that contain any of the given types.
 * Falls back to full level bounds if no relevant areas found.
 */
export function tierBounds(areas: Area[], types: readonly string[]): Bounds2 | null {
  const typeSet = new Set(types);
  let xMin = Infinity, xMax = -Infinity, zMin = Infinity, zMax = -Infinity;
  let found = false;

  const check = (area: Area) => {
    const hasType = area.vegetation.some((v) => typeSet.has(v.type));
    if (hasType) {
      const b = shapeBounds(area.shape);
      xMin = Math.min(xMin, b.xMin); xMax = Math.max(xMax, b.xMax);
      zMin = Math.min(zMin, b.zMin); zMax = Math.max(zMax, b.zMax);
      found = true;
    }
    for (const child of area.children ?? []) check(child);
  };
  for (const area of areas) check(area);

  if (!found) return null;
  // 2 m margin on each side so edge-falloff instances near the border are captured
  return { xMin: xMin - 2, xMax: xMax + 2, zMin: zMin - 2, zMax: zMax + 2 };
}

/**
 * Derive a deterministic per-level, per-tier seed from the level code.
 */
function makeSeed(levelCode: string, tierIdx: number): number {
  let h = (0x4c614d6f ^ tierIdx) >>> 0;  // "LaMo" XOR tier index
  for (const c of levelCode) h = (Math.imul(h, 31) + c.charCodeAt(0)) >>> 0;
  return h;
}

/**
 * Run the full tiered sampler for one level. Returns all placed instances with
 * globally unique, stable indices.
 *
 * Skips very large bounding areas (> 4 km²) to avoid runaway on the background level.
 */
export function computeAllTierInstances(
  areas: Area[],
  levelCode: string,
  control?: BakeControl,
): BakedInstance[] {
  // Skip levels with enormous bounds (e.g., the 600×700m background level).
  const bounds = levelBounds(areas);
  const bboxArea = (bounds.xMax - bounds.xMin) * (bounds.zMax - bounds.zMin);
  if (bboxArea > 4_000_000) return [];

  const allInstances: BakedInstance[] = [];
  const suppressedPositions: [number, number][] = [];
  let globalIndex = 0;

  for (let ti = 0; ti < TIERS.length; ti++) {
    const tier = TIERS[ti]!;
    const seed = makeSeed(levelCode, ti);
    const instances = sampleOneTier(areas, tier, seed, suppressedPositions, levelCode, control);

    for (const inst of instances) {
      inst.index = globalIndex++;
      allInstances.push(inst);
    }
    // Feed placed positions as exclusion zones for the next (finer) tier
    suppressedPositions.push(...instances.map((i): [number, number] => [i.x, i.z]));
  }

  return allInstances;
}
