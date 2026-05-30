export type RectLike = {
  xMin: number;
  xMax: number;
  zMin: number;
  zMax: number;
};

export function gridKey(cellX: number, cellZ: number) {
  return `${cellX},${cellZ}`;
}

export function isInsideSegments(segments: RectLike[], x: number, z: number) {
  return segments.some((segment) => (
    x >= segment.xMin
    && x <= segment.xMax
    && z >= segment.zMin
    && z <= segment.zMax
  ));
}

export function randomPointInSegments(segments: RectLike[]) {
  let x = 0;
  let z = 0;

  do {
    x = -9 + (18 * Math.random());
    z = -9 + (18 * Math.random());
  } while (!isInsideSegments(segments, x, z));

  return { x, z };
}

export function randomRectPoint(rect: RectLike) {
  return {
    x: rect.xMin + (Math.random() * (rect.xMax - rect.xMin)),
    z: rect.zMin + (Math.random() * (rect.zMax - rect.zMin)),
  };
}
