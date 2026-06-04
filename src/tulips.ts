import { MeshBuilder, Scene, TransformNode, Vector3 } from "@babylonjs/core";
import type { Vector3 as Vector3Type } from "@babylonjs/core";
import { getActiveMap, mowerCutRadius } from "./config";
import type { Materials } from "./materials";
import type { Tulip } from "./types";
import { distanceToShot } from "./utils/geometry";
import { randomRectPoint } from "./utils/yard";

export type Tulips = ReturnType<typeof createTulips>;

// Owns the protected tulips and the mistake count (destroying one is the only
// mistake in the game). The mower position is passed into update(); the gun
// queries damageAlongShot().
export function createTulips(scene: Scene, materials: Materials) {
  const tulips: Tulip[] = [];
  let mistakeCount = 0;

  const clear = () => {
    while (tulips.length > 0) {
      tulips.pop()?.root.dispose(false, true);
    }
  };

  const createTulip = (x: number, z: number) => {
    const root = new TransformNode("tulip", scene);
    root.position = new Vector3(x, 0.09, z);

    const stem = MeshBuilder.CreateCylinder("tulip-stem", { height: 0.58, diameter: 0.035, tessellation: 5 }, scene);
    stem.parent = root;
    stem.position.y = 0.29;
    stem.rotation.x = (Math.random() - 0.5) * 0.18;
    stem.rotation.z = (Math.random() - 0.5) * 0.18;
    stem.material = materials.tulipStemMaterial;

    const head = MeshBuilder.CreateSphere("tulip-head", { diameter: 0.18, segments: 7 }, scene);
    head.parent = root;
    head.position.y = 0.64;
    head.scaling = new Vector3(0.85, 1.25, 0.85);
    head.material = materials.tulipHeadMaterials[Math.floor(Math.random() * materials.tulipHeadMaterials.length)];

    const leaf = MeshBuilder.CreatePlane("tulip-leaf", { width: 0.16, height: 0.34 }, scene);
    leaf.parent = root;
    leaf.position = new Vector3(0.08, 0.28, 0);
    leaf.rotation.z = -0.75;
    leaf.material = materials.tulipStemMaterial;

    tulips.push({ root, head, stem, x, z, destroyed: false });
  };

  const destroy = (tulip: Tulip) => {
    tulip.destroyed = true;
    tulip.head.scaling = new Vector3(1.4, 0.24, 1.4);
    tulip.head.position.y = 0.12;
    tulip.head.rotation.x = 1.4 + (Math.random() * 0.7);
    tulip.stem.scaling.y = 0.18;
    tulip.stem.position.y = 0.05;
    mistakeCount += 1;
  };

  return {
    get mistakeCount() {
      return mistakeCount;
    },

    place() {
      clear();
      mistakeCount = 0;

      for (const bed of getActiveMap().flowerBeds) {
        for (let i = 0; i < bed.count; i += 1) {
          const { x, z } = randomRectPoint(bed);
          createTulip(x, z);
        }
      }
    },

    // Destroys tulips the mower is currently over. Returns true if any changed.
    update(mowerX: number, mowerZ: number) {
      const radiusSquared = (mowerCutRadius * 1.35) ** 2;
      let changed = false;

      for (const tulip of tulips) {
        if (tulip.destroyed) {
          continue;
        }

        const dx = tulip.x - mowerX;
        const dz = tulip.z - mowerZ;

        if ((dx * dx) + (dz * dz) > radiusSquared) {
          continue;
        }

        destroy(tulip);
        changed = true;
      }

      return changed;
    },

    // Destroys tulips along a shot. Returns the positions hit so the caller can
    // spawn impact effects and refresh the HUD.
    damageAlongShot(origin: Vector3Type, direction: Vector3Type, range: number) {
      const hits: Array<{ x: number; z: number }> = [];

      for (const tulip of tulips) {
        if (!tulip.destroyed && distanceToShot(tulip.x, tulip.z, origin, direction, range) < 0.42) {
          destroy(tulip);
          hits.push({ x: tulip.x, z: tulip.z });
        }
      }

      return hits;
    },
  };
}
