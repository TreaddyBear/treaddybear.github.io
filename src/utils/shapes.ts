import type { AreaShape, PathShape, Point2 } from "../mapFormat";
import { distanceToSegment } from "./geometry";

export type Bounds2 = {
  xMin: number;
  xMax: number;
  zMin: number;
  zMax: number;
};

const emptyBounds = (): Bounds2 => ({ xMin: 0, xMax: 0, zMin: 0, zMax: 0 });

function radians(degrees = 0) {
  return (degrees * Math.PI) / 180;
}

function rotatePoint(x: number, z: number, angle: number): Point2 {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return [(x * c) - (z * s), (x * s) + (z * c)];
}

function boundsFromPoints(points: Point2[]): Bounds2 {
  if (points.length === 0) {
    return emptyBounds();
  }

  let xMin = Infinity;
  let xMax = -Infinity;
  let zMin = Infinity;
  let zMax = -Infinity;

  for (const [x, z] of points) {
    xMin = Math.min(xMin, x);
    xMax = Math.max(xMax, x);
    zMin = Math.min(zMin, z);
    zMax = Math.max(zMax, z);
  }

  return { xMin, xMax, zMin, zMax };
}

function rectangleCorners(shape: Extract<AreaShape, { type: "rectangle" }>): Point2[] {
  const [cx, cz] = shape.center;
  const [width, depth] = shape.size;
  const halfW = Math.abs(width) / 2;
  const halfD = Math.abs(depth) / 2;
  const angle = radians(shape.rotationDegrees);
  return [
    [-halfW, -halfD],
    [halfW, -halfD],
    [halfW, halfD],
    [-halfW, halfD],
  ].map(([x, z]) => {
    const [rx, rz] = rotatePoint(x, z, angle);
    return [cx + rx, cz + rz];
  });
}

export function shapeBounds(shape: AreaShape): Bounds2 {
  if (shape.type === "circle") {
    const radius = Math.abs(shape.radius);
    return {
      xMin: shape.center[0] - radius,
      xMax: shape.center[0] + radius,
      zMin: shape.center[1] - radius,
      zMax: shape.center[1] + radius,
    };
  }

  if (shape.type === "rectangle") {
    return boundsFromPoints(rectangleCorners(shape));
  }

  return boundsFromPoints(shape.points);
}

export function shapeArea(shape: AreaShape): number {
  if (shape.type === "circle") {
    return Math.PI * Math.abs(shape.radius) * Math.abs(shape.radius);
  }

  if (shape.type === "rectangle") {
    return Math.abs(shape.size[0] * shape.size[1]);
  }

  let sum = 0;
  for (let index = 0; index < shape.points.length; index += 1) {
    const [x1, z1] = shape.points[index];
    const [x2, z2] = shape.points[(index + 1) % shape.points.length];
    sum += (x1 * z2) - (x2 * z1);
  }
  return Math.abs(sum) / 2;
}

export function containsPoint(shape: AreaShape, x: number, z: number): boolean {
  if (shape.type === "circle") {
    const dx = x - shape.center[0];
    const dz = z - shape.center[1];
    return (dx * dx) + (dz * dz) <= shape.radius * shape.radius;
  }

  if (shape.type === "rectangle") {
    const angle = -radians(shape.rotationDegrees);
    const [localX, localZ] = rotatePoint(x - shape.center[0], z - shape.center[1], angle);
    return Math.abs(localX) <= Math.abs(shape.size[0]) / 2
      && Math.abs(localZ) <= Math.abs(shape.size[1]) / 2;
  }

  let inside = false;
  for (let index = 0, previous = shape.points.length - 1; index < shape.points.length; previous = index, index += 1) {
    const [xi, zi] = shape.points[index];
    const [xj, zj] = shape.points[previous];
    const intersects = ((zi > z) !== (zj > z))
      && x < (((xj - xi) * (z - zi)) / ((zj - zi) || Number.EPSILON)) + xi;
    if (intersects) {
      inside = !inside;
    }
  }
  return inside;
}

export function signedDistanceToShapeEdge(shape: AreaShape, x: number, z: number): number {
  if (shape.type === "circle") {
    return Math.abs(shape.radius) - Math.hypot(x - shape.center[0], z - shape.center[1]);
  }

  if (shape.type === "rectangle") {
    const angle = -radians(shape.rotationDegrees);
    const [localX, localZ] = rotatePoint(x - shape.center[0], z - shape.center[1], angle);
    const halfW = Math.abs(shape.size[0]) / 2;
    const halfD = Math.abs(shape.size[1]) / 2;
    const outsideX = Math.max(Math.abs(localX) - halfW, 0);
    const outsideZ = Math.max(Math.abs(localZ) - halfD, 0);

    if (outsideX > 0 || outsideZ > 0) {
      return -Math.hypot(outsideX, outsideZ);
    }
    return Math.min(halfW - Math.abs(localX), halfD - Math.abs(localZ));
  }

  if (shape.points.length < 2) {
    return 0;
  }

  let distance = Infinity;
  for (let index = 0; index < shape.points.length; index += 1) {
    const [ax, az] = shape.points[index];
    const [bx, bz] = shape.points[(index + 1) % shape.points.length];
    distance = Math.min(distance, distanceToSegment(x, z, ax, az, bx, bz));
  }
  return containsPoint(shape, x, z) ? distance : -distance;
}

export function randomPointInShape(shape: AreaShape, random = Math.random): Point2 {
  if (shape.type === "circle") {
    const radius = Math.sqrt(random()) * Math.abs(shape.radius);
    const angle = random() * Math.PI * 2;
    return [
      shape.center[0] + (Math.cos(angle) * radius),
      shape.center[1] + (Math.sin(angle) * radius),
    ];
  }

  if (shape.type === "rectangle") {
    const localX = (random() - 0.5) * Math.abs(shape.size[0]);
    const localZ = (random() - 0.5) * Math.abs(shape.size[1]);
    const [rx, rz] = rotatePoint(localX, localZ, radians(shape.rotationDegrees));
    return [shape.center[0] + rx, shape.center[1] + rz];
  }

  const bounds = shapeBounds(shape);
  for (let attempt = 0; attempt < 1024; attempt += 1) {
    const x = bounds.xMin + ((bounds.xMax - bounds.xMin) * random());
    const z = bounds.zMin + ((bounds.zMax - bounds.zMin) * random());
    if (containsPoint(shape, x, z)) {
      return [x, z];
    }
  }

  return [
    shape.points.reduce((sum, [x]) => sum + x, 0) / Math.max(1, shape.points.length),
    shape.points.reduce((sum, [, z]) => sum + z, 0) / Math.max(1, shape.points.length),
  ];
}

function cubicBezier(start: Point2, c1: Point2, c2: Point2, end: Point2, t: number): Point2 {
  const mt = 1 - t;
  const a = mt * mt * mt;
  const b = 3 * mt * mt * t;
  const c = 3 * mt * t * t;
  const d = t * t * t;
  return [
    (start[0] * a) + (c1[0] * b) + (c2[0] * c) + (end[0] * d),
    (start[1] * a) + (c1[1] * b) + (c2[1] * c) + (end[1] * d),
  ];
}

export function pathToPolyline(shape: PathShape, curveSteps = 16): Point2[] {
  if (shape.type === "line") {
    return [shape.start, shape.end];
  }

  if (shape.type === "polyline") {
    return shape.points;
  }

  const points: Point2[] = [shape.start];
  let start = shape.start;
  for (const curve of shape.curves) {
    for (let step = 1; step <= curveSteps; step += 1) {
      points.push(cubicBezier(start, curve.c1, curve.c2, curve.end, step / curveSteps));
    }
    start = curve.end;
  }
  return points;
}

export function pathBounds(shape: PathShape, curveSteps = 16): Bounds2 {
  return boundsFromPoints(pathToPolyline(shape, curveSteps));
}

// Returns the geometric centre of a shape: the exact centre for circles and
// rectangles, the vertex average for polygons (a centroid approximation that
// is exact for regular polygons and good enough for convex authoring shapes).
export function shapeCenter(shape: AreaShape): { x: number; z: number } {
  if (shape.type === "circle" || shape.type === "rectangle") {
    return { x: shape.center[0], z: shape.center[1] };
  }
  const points = shape.points.length > 0 ? shape.points : ([[0, 0]] as Point2[]);
  return {
    x: points.reduce((sum, [px]) => sum + px, 0) / points.length,
    z: points.reduce((sum, [, pz]) => sum + pz, 0) / points.length,
  };
}

export function distanceToPath(shape: PathShape, x: number, z: number, curveSteps = 16): number {
  const points = pathToPolyline(shape, curveSteps);
  if (points.length < 2) {
    return Number.POSITIVE_INFINITY;
  }

  let distance = Number.POSITIVE_INFINITY;
  for (let index = 0; index < points.length - 1; index += 1) {
    const [ax, az] = points[index];
    const [bx, bz] = points[index + 1];
    distance = Math.min(distance, distanceToSegment(x, z, ax, az, bx, bz));
  }
  return distance;
}
