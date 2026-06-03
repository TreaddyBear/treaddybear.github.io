import type { Vector3 } from "@babylonjs/core";

// Shortest distance from point (x, z) to the segment (ax, az)-(bx, bz) in the XZ plane.
export function distanceToSegment(x: number, z: number, ax: number, az: number, bx: number, bz: number) {
  const dx = bx - ax;
  const dz = bz - az;
  const lengthSquared = (dx * dx) + (dz * dz);
  const t = lengthSquared === 0
    ? 0
    : Math.min(1, Math.max(0, (((x - ax) * dx) + ((z - az) * dz)) / lengthSquared));
  const closestX = ax + (dx * t);
  const closestZ = az + (dz * t);
  const offsetX = x - closestX;
  const offsetZ = z - closestZ;
  return Math.sqrt((offsetX * offsetX) + (offsetZ * offsetZ));
}

// Perpendicular distance from (x, z) to a forward ray, or +Infinity when the
// point is behind the origin or beyond `range`. Used for hit-scan shots.
export function distanceToShot(x: number, z: number, origin: Vector3, direction: Vector3, range: number) {
  const dx = x - origin.x;
  const dz = z - origin.z;
  const forwardDistance = (dx * direction.x) + (dz * direction.z);

  if (forwardDistance < 0 || forwardDistance > range) {
    return Number.POSITIVE_INFINITY;
  }

  return Math.abs((dx * direction.z) - (dz * direction.x));
}
