import { Color3, DynamicTexture, Mesh, MeshBuilder, StandardMaterial, Vector3 } from "@babylonjs/core";
import type { Scene } from "@babylonjs/core";
import { getActiveMap, playerBoost, playerSpeed, settings } from "./config";
import type { FenceDamageState, FenceHealthLabel } from "./types";
import { distanceToSegment } from "./utils/geometry";

export type FenceSystem = ReturnType<typeof createFenceSystem>;

// Roughly how far the dirt overlay reaches from the fence line. Any grass
// (mowable or neighbor) must stay outside this so nothing grows on the bare
// soil border under the fence.
export const fenceDirtClearRadius = 0.6;

// Owns the per-plank damage state and the optional health labels, and answers
// all fence collision/damage queries. Needs the player mesh (for the mower box
// and push-out), a yaw getter, and groundHeightAt to re-seat after a push.
export function createFenceSystem(
  scene: Scene,
  player: Mesh,
  getYaw: () => number,
  groundHeightAt: (x: number, z: number) => number,
) {
  let fenceDamage: FenceDamageState[] = [];
  const fenceHealthLabels: FenceHealthLabel[] = [];

  const createStates = () => {
    const states: FenceDamageState[] = [];
    // Match the visible plank mesh exactly: width 0.34 runs along the fence,
    // depth 0.08 runs across it (see createFencePlanks in world.ts).
    const halfAlong = 0.34 / 2;
    const halfAcross = 0.08 / 2;

    for (const [segmentIndex, segment] of getActiveMap().fenceSegments.entries()) {
      const dx = segment.end.x - segment.start.x;
      const dz = segment.end.z - segment.start.z;
      const length = Math.sqrt((dx * dx) + (dz * dz));
      const steps = Math.floor(length / 0.55);
      const axisX = length > 0 ? dx / length : 1;
      const axisZ = length > 0 ? dz / length : 0;

      for (let pieceIndex = 0; pieceIndex <= steps; pieceIndex += 1) {
        const t = steps === 0 ? 0 : pieceIndex / steps;
        const x = segment.start.x + (dx * t);
        const z = segment.start.z + (dz * t);
        states.push({
          segmentIndex,
          pieceIndex,
          x,
          z,
          axisX,
          axisZ,
          halfAlong,
          halfAcross,
          health: settings.fenceMaxHealth,
          broken: false,
        });
      }
    }

    return states;
  };

  const nearestFencePiece = (x: number, z: number) => {
    let nearest = { index: -1, distance: Number.POSITIVE_INFINITY };

    for (let i = 0; i < fenceDamage.length; i += 1) {
      const piece = fenceDamage[i];

      if (!piece || piece.broken) {
        continue;
      }

      const dx = x - piece.x;
      const dz = z - piece.z;
      const distance = Math.sqrt((dx * dx) + (dz * dz));

      if (distance < nearest.distance) {
        nearest = { index: i, distance };
      }
    }

    return nearest;
  };

  const drawHealthLabel = (index: number) => {
    const state = fenceDamage[index];
    const label = fenceHealthLabels[index];

    if (!state || !label) {
      return;
    }

    label.texture.clear();
    label.texture.drawText(
      state.broken ? "BROKEN" : `${Math.max(0, Math.ceil(state.health))}/${settings.fenceMaxHealth}`,
      null,
      40,
      "bold 26px Arial",
      state.broken ? "#ff8080" : "#ffffff",
      "rgba(0,0,0,0.58)",
      true,
    );
  };

  const updateHealthLabel = (index: number) => {
    const state = fenceDamage[index];
    const label = fenceHealthLabels[index];

    if (!label || !state) {
      return;
    }

    label.mesh.setEnabled(settings.showFenceHealth && !state.broken);
    drawHealthLabel(index);
  };

  const breakPiece = (index: number) => {
    const state = fenceDamage[index];
    const mesh = state ? scene.getMeshByName(`fence-${state.segmentIndex}-plank-${state.pieceIndex}`) : null;
    mesh?.setEnabled(false);
    updateHealthLabel(index);
  };

  const damagePiece = (index: number, impactSpeed: number) => {
    const state = fenceDamage[index];

    if (!state || state.broken) {
      return;
    }

    const speedRatio = Math.min(1, Math.abs(impactSpeed) / (playerSpeed * playerBoost));
    const damage = speedRatio > 0.85 ? 5 : speedRatio > 0.55 ? 3 : 1;
    state.health -= damage;

    if (state.health <= 0) {
      state.broken = true;
      breakPiece(index);
    }

    updateHealthLabel(index);
  };

  const damageAt = (x: number, z: number, impactSpeed: number) => {
    const nearest = nearestFencePiece(x, z);

    if (nearest.index < 0 || nearest.distance > 0.62) {
      return;
    }

    damagePiece(nearest.index, impactSpeed);
  };

  // Minimum push that separates the mower box from one plank box, or null when
  // they don't overlap. A 2D separating-axis test: if any axis separates the
  // projections there is no collision; otherwise the shallowest-overlap axis is
  // the push that slides the mower off the thin face of the fence.
  const mowerPlankPushOut = (
    cx: number, cz: number, sideX: number, sideZ: number, halfSide: number, halfForward: number,
    piece: FenceDamageState,
  ) => {
    const aUx = sideX;
    const aUz = sideZ;
    const aVx = -sideZ;
    const aVz = sideX;
    const bUx = piece.axisX;
    const bUz = piece.axisZ;
    const bVx = -piece.axisZ;
    const bVz = piece.axisX;
    const dx = cx - piece.x;
    const dz = cz - piece.z;
    const axes = [aUx, aUz, aVx, aVz, bUx, bUz, bVx, bVz];
    let bestDepth = Number.POSITIVE_INFINITY;
    let bestX = 0;
    let bestZ = 0;

    for (let i = 0; i < axes.length; i += 2) {
      const lx = axes[i];
      const lz = axes[i + 1];
      const centerProjection = (dx * lx) + (dz * lz);
      const aReach = (halfSide * Math.abs((aUx * lx) + (aUz * lz))) + (halfForward * Math.abs((aVx * lx) + (aVz * lz)));
      const bReach = (piece.halfAlong * Math.abs((bUx * lx) + (bUz * lz))) + (piece.halfAcross * Math.abs((bVx * lx) + (bVz * lz)));
      const overlap = aReach + bReach - Math.abs(centerProjection);

      if (overlap <= 0) {
        return null;
      }

      if (overlap < bestDepth) {
        bestDepth = overlap;
        const sign = centerProjection >= 0 ? 1 : -1;
        bestX = lx * sign;
        bestZ = lz * sign;
      }
    }

    return { x: bestX * bestDepth, z: bestZ * bestDepth };
  };

  const disposeHealthLabels = () => {
    while (fenceHealthLabels.length > 0) {
      const label = fenceHealthLabels.pop();
      label?.texture.dispose();
      label?.material.dispose();
      label?.mesh.dispose();
    }
  };

  return {
    dirtClearRadius: fenceDirtClearRadius,

    rebuildStates() {
      fenceDamage = createStates();
    },

    disposeHealthLabels,

    syncHealthLabels() {
      disposeHealthLabels();

      if (!settings.showFenceHealth) {
        return;
      }

      for (let index = 0; index < fenceDamage.length; index += 1) {
        const state = fenceDamage[index];
        const texture = new DynamicTexture(`fence-health-texture-${index}`, { width: 128, height: 64 }, scene, false);
        texture.hasAlpha = true;
        const material = new StandardMaterial(`fence-health-material-${index}`, scene);
        material.diffuseTexture = texture;
        material.emissiveColor = Color3.White();
        material.opacityTexture = texture;
        material.backFaceCulling = false;

        const mesh = MeshBuilder.CreatePlane(`fence-health-label-${index}`, { width: 0.86, height: 0.34 }, scene);
        mesh.position = new Vector3(state.x, 0.82, state.z);
        mesh.billboardMode = Mesh.BILLBOARDMODE_ALL;
        mesh.material = material;
        fenceHealthLabels[index] = { mesh, material, texture };
        updateHealthLabel(index);
      }
    },

    damagePiece,

    // Damages the plank a forward shot hits first; returns the forward distance
    // to the hit (for the tracer length), or null when nothing is hit.
    shootAlong(origin: Vector3, direction: Vector3, range: number) {
      let best = { index: -1, distanceToRay: Number.POSITIVE_INFINITY, forwardDistance: 0 };

      for (let index = 0; index < fenceDamage.length; index += 1) {
        const piece = fenceDamage[index];

        if (!piece || piece.broken) {
          continue;
        }

        const dx = piece.x - origin.x;
        const dz = piece.z - origin.z;
        const forwardDistance = (dx * direction.x) + (dz * direction.z);

        if (forwardDistance < 0 || forwardDistance > range) {
          continue;
        }

        const sideDistance = Math.abs((dx * direction.z) - (dz * direction.x));

        if (sideDistance < best.distanceToRay) {
          best = { index, distanceToRay: sideDistance, forwardDistance };
        }
      }

      if (best.index >= 0 && best.distanceToRay < 0.42) {
        const hit = origin.add(direction.scale(best.forwardDistance));
        damageAt(hit.x, hit.z, playerSpeed * playerBoost);
        return best.forwardDistance;
      }

      return null;
    },

    // The plank the mower box overlaps at (x, z), or index -1.
    collide(x: number, z: number) {
      if (settings.disableFenceCollision) {
        return { index: -1, distance: Number.POSITIVE_INFINITY };
      }

      const sideX = Math.cos(getYaw());
      const sideZ = -Math.sin(getYaw());
      const halfSide = player.scaling.x / 2;
      const halfForward = player.scaling.z / 2;
      let hit = { index: -1, distance: Number.POSITIVE_INFINITY };

      for (let index = 0; index < fenceDamage.length; index += 1) {
        const piece = fenceDamage[index];

        if (!piece || piece.broken) {
          continue;
        }

        if (!mowerPlankPushOut(x, z, sideX, sideZ, halfSide, halfForward, piece)) {
          continue;
        }

        const dx = x - piece.x;
        const dz = z - piece.z;
        const distance = Math.sqrt((dx * dx) + (dz * dz));

        if (distance < hit.distance) {
          hit = { index, distance };
        }
      }

      return hit;
    },

    // Slides the mower out of any plank it has rotated or drifted into, so it
    // can never wedge inside the wall. Resolving the deepest overlap first and
    // iterating keeps corners stable.
    resolveOverlap() {
      if (settings.disableFenceCollision) {
        return;
      }

      const sideX = Math.cos(getYaw());
      const sideZ = -Math.sin(getYaw());
      const halfSide = player.scaling.x / 2;
      const halfForward = player.scaling.z / 2;

      for (let iteration = 0; iteration < 4; iteration += 1) {
        let pushX = 0;
        let pushZ = 0;
        let deepest = 0;

        for (let index = 0; index < fenceDamage.length; index += 1) {
          const piece = fenceDamage[index];

          if (!piece || piece.broken) {
            continue;
          }

          const push = mowerPlankPushOut(player.position.x, player.position.z, sideX, sideZ, halfSide, halfForward, piece);

          if (!push) {
            continue;
          }

          const depth = (push.x * push.x) + (push.z * push.z);

          if (depth > deepest) {
            deepest = depth;
            pushX = push.x;
            pushZ = push.z;
          }
        }

        if (deepest <= 0) {
          break;
        }

        player.position.x += pushX;
        player.position.z += pushZ;
      }

      player.position.y = groundHeightAt(player.position.x, player.position.z);
    },

    // World distance to the nearest fence segment of the active map.
    distanceTo(x: number, z: number) {
      let distance = Number.POSITIVE_INFINITY;

      for (const segment of getActiveMap().fenceSegments) {
        distance = Math.min(distance, distanceToSegment(x, z, segment.start.x, segment.start.z, segment.end.x, segment.end.z));
      }

      return distance;
    },

    // No grass within ~0.22m of the fence line, then a ramp back to full grass
    // over the next ~0.2m (grass starts ~0.42m in, within mower reach).
    grassFalloff(x: number, z: number) {
      let distance = Number.POSITIVE_INFINITY;

      for (const segment of getActiveMap().fenceSegments) {
        distance = Math.min(distance, distanceToSegment(x, z, segment.start.x, segment.start.z, segment.end.x, segment.end.z));
      }

      if (distance < 0.22) {
        return 0;
      }

      const open = Math.min(1, Math.max(0, (distance - 0.22) / 0.2));
      return open * open * (3 - (2 * open));
    },
  };
}
