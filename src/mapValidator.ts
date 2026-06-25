import type { Area, AreaShape, Distribution, LevelV1, MapPackV1 } from "./mapFormat";
import { foliageRegistry, fullLevelCode } from "./mapFormat";
import { containsPoint } from "./utils/shapes";

// All foliage keys defined in the v1 registry.
const VALID_FOLIAGE_KEYS = new Set<string>(foliageRegistry.map((f) => f.key));

// Density above this threshold is almost certainly a mistake (the spec says
// 1.0 is "tuned target" and > 1.0 is "fine for lusher areas as long as
// performance allows" — 10 is a generous ceiling).
const MAX_SANE_DENSITY = 10;

// Returns a set of representative points on/inside a shape: the centre and
// several boundary samples. Used to approximate containment and overlap checks
// without full polygon intersection. False negatives (missing a real violation)
// are tolerable; false positives (flagging a valid map) are not, which is why
// we sample boundary points rather than interior ones only.
function shapeExtremals(shape: AreaShape): [number, number][] {
  if (shape.type === "circle") {
    const [cx, cz] = shape.center;
    const r = Math.abs(shape.radius);
    const points: [number, number][] = [[cx, cz]];
    for (let i = 0; i < 8; i += 1) {
      const angle = (i / 8) * Math.PI * 2;
      // Slightly inset (×0.98) so a circle that just touches its parent's edge
      // doesn't produce floating-point false-positives.
      points.push([cx + Math.cos(angle) * r * 0.98, cz + Math.sin(angle) * r * 0.98]);
    }
    return points;
  }

  if (shape.type === "rectangle") {
    const [cx, cz] = shape.center;
    const hw = Math.abs(shape.size[0]) / 2;
    const hh = Math.abs(shape.size[1]) / 2;
    const angle = ((shape.rotationDegrees ?? 0) * Math.PI) / 180;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const r = (dx: number, dz: number): [number, number] => [
      cx + (dx * cos) - (dz * sin),
      cz + (dx * sin) + (dz * cos),
    ];
    // Inset corners by 0.5% to absorb floating-point edge cases.
    const f = 0.995;
    return [
      [cx, cz],
      r(-hw * f, -hh * f),
      r(hw * f, -hh * f),
      r(hw * f, hh * f),
      r(-hw * f, hh * f),
    ];
  }

  // Polygon: all vertices. Edge crossings without vertex containment are missed,
  // but polygon-polygon intersection is out of scope for a startup validator.
  return shape.points as [number, number][];
}

function errorsForDistribution(dist: Distribution, path: string): string[] {
  const errors: string[] = [];
  if (dist.density < 0) {
    errors.push(`${path}: density ${dist.density} is negative`);
  }
  if (dist.density > MAX_SANE_DENSITY) {
    errors.push(`${path}: density ${dist.density} is very large (>${MAX_SANE_DENSITY}) — likely a mistake`);
  }
  if (dist.type === "perlin") {
    if (dist.noise.softness <= 0) {
      errors.push(`${path}: perlin softness must be > 0, got ${dist.noise.softness}`);
    }
    if (!dist.noise.octaves || dist.noise.octaves.length === 0) {
      errors.push(`${path}: perlin octaves must not be empty`);
    }
    for (const [i, oct] of (dist.noise.octaves ?? []).entries()) {
      if (oct.frequency <= 0) {
        errors.push(`${path}: octave[${i}] frequency must be > 0`);
      }
    }
  }
  return errors;
}

// Checks one area node: its own properties, containment in its parent shape,
// and recurses into children (also checking sibling overlap among them).
function errorsForArea(area: Area, areaPath: string, parentShape: AreaShape | null): string[] {
  const errors: string[] = [];

  if ((area.edgeFalloff ?? 0) < 0) {
    errors.push(`${areaPath}: edgeFalloff must be >= 0`);
  }

  for (const layer of area.vegetation) {
    const layerPath = `${areaPath}.vegetation[id=${layer.id}]`;
    if (!VALID_FOLIAGE_KEYS.has(layer.type)) {
      errors.push(
        `${layerPath}: unknown foliage type "${layer.type}" — valid types: ${[...VALID_FOLIAGE_KEYS].join(", ")}`,
      );
    }
    errors.push(...errorsForDistribution(layer.distribution, layerPath));
  }

  // Containment: approximate by checking extremal/boundary points of this area
  // against the parent. Top-level areas have no parent constraint (the level
  // itself is unbounded), so parentShape === null skips this check.
  if (parentShape !== null) {
    const points = shapeExtremals(area.shape);
    const outside = points.filter(([x, z]) => !containsPoint(parentShape, x, z));
    if (outside.length > 0) {
      errors.push(
        `${areaPath}: ${outside.length} of ${points.length} boundary samples lie outside ` +
        `parent — child area may extend beyond its parent's shape`,
      );
    }
  }

  const children = area.children ?? [];
  for (const [i, child] of children.entries()) {
    errors.push(...errorsForArea(child, `${areaPath}.children[${i}] (id=${child.id})`, area.shape));
  }
  errors.push(...siblingSiblingErrors(children, `${areaPath}.children`));

  return errors;
}

// Checks each pair of sibling areas for overlap by sampling extremal points of
// one against the other. Additive and replace siblings are both checked —
// the spec forbids all sibling overlap regardless of composition mode.
function siblingSiblingErrors(siblings: Area[], siblingPath: string): string[] {
  const errors: string[] = [];
  for (let i = 0; i < siblings.length - 1; i += 1) {
    for (let j = i + 1; j < siblings.length; j += 1) {
      const a = siblings[i];
      const b = siblings[j];
      const aInB = shapeExtremals(a.shape).some(([x, z]) => containsPoint(b.shape, x, z));
      const bInA = shapeExtremals(b.shape).some(([x, z]) => containsPoint(a.shape, x, z));
      if (aInB || bInA) {
        errors.push(
          `${siblingPath}: areas "${a.id}" and "${b.id}" appear to overlap — ` +
          `sibling areas must have non-overlapping footprints`,
        );
      }
    }
  }
  return errors;
}

function errorsForLevel(pack: MapPackV1["pack"], level: LevelV1): string[] {
  const code = fullLevelCode(pack.prefix, level.code);
  const P = `level(${code})`;
  const errors: string[] = [];

  // Area ID uniqueness across the entire level tree. Vegetation layer IDs need
  // only be unique within their own area (the spec's "within that level" is
  // interpreted as within the item's type-scope for practical authoring).
  const areaIds = new Set<string>();
  const checkAreaId = (id: string, path: string) => {
    if (!id) {
      errors.push(`${path}: id is missing or empty`);
      return;
    }
    if (areaIds.has(id)) {
      errors.push(`${path}: duplicate area id "${id}" — all ids must be unique within the level`);
    }
    areaIds.add(id);
  };

  const walkAreaIds = (areas: Area[], prefix: string) => {
    for (const [i, area] of areas.entries()) {
      checkAreaId(area.id, `${prefix}[${i}]`);
      // Vegetation layer IDs must be unique within their own area.
      const layerIds = new Set<string>();
      for (const layer of area.vegetation) {
        if (layerIds.has(layer.id)) {
          errors.push(`${prefix}[${i}] (id=${area.id}).vegetation: duplicate layer id "${layer.id}"`);
        }
        layerIds.add(layer.id);
      }
      walkAreaIds(area.children ?? [], `${prefix}[${i}].children`);
    }
  };
  walkAreaIds(level.areas, `${P}.areas`);

  // Check area tree: containment, overlap, foliage keys, distributions.
  for (const [i, area] of (level.areas ?? []).entries()) {
    errors.push(...errorsForArea(area, `${P}.areas[${i}] (id=${area.id})`, null));
  }
  // Sibling overlap at the top level.
  errors.push(...siblingSiblingErrors(level.areas ?? [], `${P}.areas`));

  // Path-feature ID uniqueness (all roads + paths + fences share one namespace).
  const pathIds = new Set<string>();
  const checkPathId = (id: string, kind: string) => {
    if (!id) {
      errors.push(`${P}: ${kind} has missing id`);
      return;
    }
    if (pathIds.has(id)) {
      errors.push(`${P}: duplicate ${kind} id "${id}"`);
    }
    pathIds.add(id);
  };
  for (const road of level.roads ?? []) {
    checkPathId(road.id, "road");
    if (road.width <= 0) {
      errors.push(`${P}.road(${road.id}): width must be > 0`);
    }
  }
  for (const path of level.dirtPaths ?? []) {
    checkPathId(path.id, "dirtPath");
    if (path.width <= 0) {
      errors.push(`${P}.dirtPath(${path.id}): width must be > 0`);
    }
  }
  for (const fence of level.fences ?? []) {
    checkPathId(fence.id, "fence");
    if (fence.height <= 0) {
      errors.push(`${P}.fence(${fence.id}): height must be > 0`);
    }
  }

  // Height feature ID uniqueness and sanity.
  const featureIds = new Set<string>();
  for (const feature of level.terrain?.heightFeatures ?? []) {
    if (!feature.id) {
      errors.push(`${P}: heightFeature has missing id`);
    } else if (featureIds.has(feature.id)) {
      errors.push(`${P}: duplicate heightFeature id "${feature.id}"`);
    }
    featureIds.add(feature.id);
    if (feature.falloff <= 0) {
      errors.push(`${P}.heightFeature(${feature.id}): falloff must be > 0, got ${feature.falloff}`);
    }
    if (feature.height < 0) {
      errors.push(`${P}.heightFeature(${feature.id}): height must be >= 0`);
    }
  }

  return errors;
}

// Returns a list of validation error messages, one per problem. An empty list
// means the pack is valid. Geometric checks (containment, sibling overlap) use
// boundary-point sampling — they have false negatives (can miss edge crossings)
// but are designed to avoid false positives.
export function validateMapPack(pack: MapPackV1): string[] {
  const errors: string[] = [];

  if (pack.version !== 1) {
    errors.push(`pack: expected version 1, got ${pack.version}`);
  }
  if (!pack.pack?.prefix) {
    errors.push("pack.pack: prefix is required");
  }

  const levelCodes = new Set<string>();
  for (const level of pack.levels ?? []) {
    const code = fullLevelCode(pack.pack?.prefix ?? "", level.code);
    if (levelCodes.has(code)) {
      errors.push(`pack.levels: duplicate level code "${code}"`);
    }
    levelCodes.add(code);
    errors.push(...errorsForLevel(pack.pack, level));
  }

  if (pack.defaultLevelCode) {
    const defaultCode = fullLevelCode(pack.pack?.prefix ?? "", pack.defaultLevelCode);
    if (!levelCodes.has(defaultCode)) {
      errors.push(
        `pack.defaultLevelCode: "${pack.defaultLevelCode}" resolves to "${defaultCode}" ` +
        `which does not match any level in this pack`,
      );
    }
  }

  return errors;
}

// Throws an Error with all validation messages if any errors are found.
// Call this at startup to fail fast on malformed map data.
export function assertMapPackValid(pack: MapPackV1): void {
  const errors = validateMapPack(pack);
  if (errors.length > 0) {
    throw new Error(
      `Map pack validation failed (${errors.length} error${errors.length > 1 ? "s" : ""}):\n` +
      errors.map((e) => `  • ${e}`).join("\n"),
    );
  }
}
