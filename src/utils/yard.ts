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
  const xMin = Math.min(...segments.map((segment) => segment.xMin));
  const xMax = Math.max(...segments.map((segment) => segment.xMax));
  const zMin = Math.min(...segments.map((segment) => segment.zMin));
  const zMax = Math.max(...segments.map((segment) => segment.zMax));
  let x = 0;
  let z = 0;

  do {
    x = xMin + ((xMax - xMin) * Math.random());
    z = zMin + ((zMax - zMin) * Math.random());
  } while (!isInsideSegments(segments, x, z));

  return { x, z };
}

export function randomRectPoint(rect: RectLike) {
  return {
    x: rect.xMin + (Math.random() * (rect.xMax - rect.xMin)),
    z: rect.zMin + (Math.random() * (rect.zMax - rect.zMin)),
  };
}
