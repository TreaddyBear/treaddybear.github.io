export type Point2 = [x: number, z: number];
export type Point3 = [x: number, y: number, z: number];

export type CoordinateMetadata = {
  axes: { x: "east"; y: "up"; z: "north" };
  point2: ["x", "z"];
  point3: ["x", "y", "z"];
  angles: {
    unit: "degrees";
    zero: "+x (east)";
    positive: string;
    direction: string;
  };
};

export const defaultCoordinateMetadata: CoordinateMetadata = {
  axes: { x: "east", y: "up", z: "north" },
  point2: ["x", "z"],
  point3: ["x", "y", "z"],
  angles: {
    unit: "degrees",
    zero: "+x (east)",
    positive: "counter-clockwise in the XZ plane, from +x toward +z",
    direction: "heading T maps to ground vector (x, z) = (cos T, sin T)",
  },
};

export type PackInfo = {
  prefix: string;
  name: string;
};

export type AuthoredItem = {
  id: string;
  name?: string;
  tags?: string[];
  editor?: {
    locked?: boolean;
    layer?: string;
  };
};

export type UniformDistribution = {
  type: "uniform";
  density: number;
};

export type PerlinDistribution = {
  type: "perlin";
  density: number;
  noise: {
    seed: number;
    octaves: Array<{ frequency: number; weight: number }>;
    domainWarp?: number;
    threshold: number;
    softness: number;
  };
};

export type Distribution = UniformDistribution | PerlinDistribution;

export type AreaShape =
  | { type: "rectangle"; center: Point2; size: Point2; rotationDegrees?: number }
  | { type: "circle"; center: Point2; radius: number }
  | { type: "polygon"; points: Point2[] };

export type PathShape =
  | { type: "line"; start: Point2; end: Point2 }
  | { type: "polyline"; points: Point2[] }
  | { type: "cubicBezierPath"; start: Point2; curves: Array<{ c1: Point2; c2: Point2; end: Point2 }> };

export type VegetationLayer = {
  id: string;
  type: string;
  distribution: Distribution;
};

export type Area = AuthoredItem & {
  kind: "area";
  composition?: "replace" | "additive";
  role?: "background" | "lawn" | "bed";
  mowable?: boolean;
  surface?: "grass" | "dirt";
  shape: AreaShape;
  edgeFalloff?: number;
  vegetation: VegetationLayer[];
  children?: Area[];
};

export type Road = AuthoredItem & {
  kind: "road";
  width: number;
  shape: PathShape;
};

export type DirtPath = AuthoredItem & {
  kind: "dirtPath";
  width: number;
  shape: PathShape;
};

export type Fence = AuthoredItem & {
  kind: "fence";
  height: number;
  postSpacing?: number;
  shape: PathShape;
};

export type HeightFeature = AuthoredItem & {
  type: "hill";
  shape: AreaShape;
  height: number;
  falloff: number;
};

export type Terrain = {
  heightFeatures: HeightFeature[];
};

export type Spawn = {
  position: Point2;
  headingDegrees: number;
};

export type LevelV1 = {
  code: string;
  fullCode?: string;
  name: string;
  parSeconds: number;
  spawn: Spawn;
  areas: Area[];
  roads: Road[];
  dirtPaths: DirtPath[];
  fences: Fence[];
  terrain: Terrain;
  objects: unknown[];
  tags?: string[];
};

export type MapPackV1 = {
  version: 1;
  units: "meters";
  coordinates?: CoordinateMetadata;
  pack: PackInfo;
  levels: LevelV1[];
  defaultLevelCode?: string;
};

export const foliageRegistry = [
  { key: "grass", displayName: "Grass", category: "groundcover" },
  { key: "clover", displayName: "Clover", category: "groundcover" },
  { key: "leaf", displayName: "Leaf", category: "decor" },
  { key: "dandelion", displayName: "Dandelion", category: "wildflower" },
  { key: "flowerBlue", displayName: "Blue Flower", category: "wildflower" },
  { key: "flowerWhite", displayName: "White Flower", category: "wildflower" },
  { key: "flowerYellow", displayName: "Yellow Flower", category: "wildflower" },
  { key: "flowerRed", displayName: "Red Flower", category: "wildflower" },
  { key: "tulip", displayName: "Tulip", category: "prizeFlower" },
] as const;

export type FoliageKey = (typeof foliageRegistry)[number]["key"];

export function fullLevelCode(prefix: string, code: string) {
  if (!code) {
    return prefix;
  }
  return `${prefix}${code[0].toUpperCase()}${code.slice(1)}`;
}

export function levelFullCode(prefix: string, level: Pick<LevelV1, "code" | "fullCode">) {
  return level.fullCode ?? fullLevelCode(prefix, level.code);
}

export function resolveLevelCodeReference(prefix: string, levels: Array<Pick<LevelV1, "code" | "fullCode">>, ref: string) {
  const level = levels.find((candidate) => candidate.fullCode === ref || candidate.code === ref);
  return level ? levelFullCode(prefix, level) : fullLevelCode(prefix, ref);
}
