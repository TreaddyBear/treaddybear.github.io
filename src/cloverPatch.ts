import { Matrix, Mesh, MeshBuilder, Scene, VertexData } from "@babylonjs/core";
import { getActiveMap } from "./config";
import { cloverAmountAt } from "./cloverField";
import type { Materials } from "./materials";

export type CloverPatch = ReturnType<typeof createCloverPatch>;

// Dense clover ground cover for a map's `cloverPatches` regions. Each clover is
// a short, slightly tilted stem topped with three circular leaflets spaced 120
// degrees around that axis, each leaflet canted up at its outer edge. Clovers
// vary widely in height. Like the blue flowers, all leaflets/stems are drawn as
// thin instances (one matrix per part) so a patch can hold hundreds cheaply.

// One unit leaflet: a low-poly disc in the XZ plane (radius 1, normal up) with a
// faint cup so it catches light. An instance matrix scales/cants/places it.
function buildLeaflet(scene: Scene): Mesh {
  const segments = 9;
  const positions: number[] = [0, 0.05, 0]; // slightly raised center -> gentle dome
  const indices: number[] = [];

  for (let i = 0; i < segments; i += 1) {
    const angle = (i / segments) * Math.PI * 2;
    positions.push(Math.cos(angle), 0, Math.sin(angle));
  }

  for (let i = 0; i < segments; i += 1) {
    const a = 1 + i;
    const b = 1 + ((i + 1) % segments);
    indices.push(0, a, b);
  }

  const normals: number[] = [];
  VertexData.ComputeNormals(positions, indices, normals);

  const mesh = new Mesh("clover-leaflet", scene);
  const data = new VertexData();
  data.positions = positions;
  data.indices = indices;
  data.normals = normals;
  data.applyToMesh(mesh);
  return mesh;
}

type Clover = {
  x: number;
  z: number;
  height: number;
  tiltX: number;
  tiltZ: number;
  basePhase: number;
};

export function createCloverPatch(
  scene: Scene,
  materials: Materials,
  groundHeightAt: (x: number, z: number) => number,
) {
  const leaflet = buildLeaflet(scene);
  leaflet.material = materials.cloverLeafMaterial;
  leaflet.alwaysSelectAsActiveMesh = true;
  leaflet.isPickable = false;

  const stem = MeshBuilder.CreateCylinder("clover-stem", { height: 1, diameter: 1, tessellation: 5 }, scene);
  stem.bakeTransformIntoVertices(Matrix.Translation(0, 0.5, 0));
  stem.material = materials.cloverStemMaterial;
  stem.alwaysSelectAsActiveMesh = true;
  stem.isPickable = false;

  // Hidden until place() gives them instances (a thin-instance source mesh draws
  // once at its unit-sized origin transform otherwise — see fieldFlowers.ts).
  for (const mesh of [leaflet, stem]) {
    mesh.setEnabled(false);
  }

  // Retained buffers + per-clover metadata so mowing can collapse one clover's
  // three leaflets + stem in place. Each clover owns 3 contiguous leaflet
  // instances (leafStart..+3) and one stem instance at the same index.
  const LEAVES_PER_CLOVER = 3;
  type PlantInstance = { x: number; z: number; mowed: boolean; index: number };
  let plants: PlantInstance[] = [];
  let leafBuffer = new Float32Array(0);
  let stemBuffer = new Float32Array(0);

  const showInstances = (mesh: Mesh, buffer: Float32Array) => {
    if (buffer.length === 0) {
      mesh.thinInstanceCount = 0;
      mesh.setEnabled(false);
      return;
    }

    mesh.setEnabled(true);
    mesh.thinInstanceSetBuffer("matrix", buffer, 16, false);
    mesh.thinInstanceRefreshBoundingInfo();
  };

  const collapseInstance = (buffer: Float32Array, instanceIndex: number) => {
    buffer.fill(0, instanceIndex * 16, (instanceIndex * 16) + 16);
  };

  const buildClovers = (): Clover[] => {
    const patches = getActiveMap().cloverPatches;
    if (!patches || patches.length === 0) {
      return [];
    }

    const clovers: Clover[] = [];

    for (const patch of patches) {
      const spacing = patch.spacing ?? 0.22;
      const jitter = spacing * 0.4;
      // Reach past the nominal radius so the noise-wobbled edge bulges are filled.
      const reach = patch.radius * 1.5;

      for (let x = patch.x - reach; x <= patch.x + reach; x += spacing) {
        for (let z = patch.z - reach; z <= patch.z + reach; z += spacing) {
          const cx = x + ((Math.random() - 0.5) * 2 * jitter);
          const cz = z + ((Math.random() - 0.5) * 2 * jitter);

          // Density follows the feathered clover amount, so the patch thins out
          // naturally toward its irregular edge instead of stopping at a circle.
          if (Math.random() > cloverAmountAt([patch], cx, cz)) {
            continue;
          }

          clovers.push({
            x: cx,
            z: cz,
            // Much wider height spread (~2x): some short, some notably tall.
            height: 0.05 + (Math.random() * 0.32),
            tiltX: (Math.random() - 0.5) * 0.24, // slightly canted axis (~+/-7deg)
            tiltZ: (Math.random() - 0.5) * 0.24,
            basePhase: Math.random() * Math.PI * 2,
          });
        }
      }
    }

    return clovers;
  };

  const place = () => {
    const clovers = buildClovers();
    plants = [];
    leafBuffer = new Float32Array(clovers.length * LEAVES_PER_CLOVER * 16);
    stemBuffer = new Float32Array(clovers.length * 16);

    for (let i = 0; i < clovers.length; i += 1) {
      const clover = clovers[i];
      const groundY = groundHeightAt(clover.x, clover.z);
      const world = Matrix.Translation(clover.x, groundY, clover.z);
      const axisTilt = Matrix.RotationX(clover.tiltX).multiply(Matrix.RotationZ(clover.tiltZ));
      const headLift = Matrix.Translation(0, clover.height, 0);

      const stemRadius = 0.01 + (Math.random() * 0.005);
      Matrix.Scaling(stemRadius, clover.height, stemRadius).multiply(axisTilt).multiply(world)
        .copyToArray(stemBuffer, i * 16);

      // One flatness per clover so its three leaflets sit at a consistent (and,
      // overall, much flatter) angle, with only a small leaflet-to-leaflet
      // variation (~half what it was before).
      const baseCant = 0.2 + (Math.random() * 0.18);

      // Three leaflets around the shared stem axis, each canted up at its rim.
      for (let leaf = 0; leaf < LEAVES_PER_CLOVER; leaf += 1) {
        const theta = clover.basePhase + (leaf * ((Math.PI * 2) / 3)) + ((Math.random() - 0.5) * 0.2);
        const cant = baseCant + ((Math.random() - 0.5) * 0.15);
        const leafRadius = (0.05 + (Math.random() * 0.03));
        const radialOffset = leafRadius * 0.85;

        Matrix.Scaling(leafRadius, leafRadius, leafRadius)
          .multiply(Matrix.RotationX(-cant))
          .multiply(Matrix.Translation(0, 0, radialOffset))
          .multiply(Matrix.RotationY(theta))
          .multiply(headLift)
          .multiply(axisTilt)
          .multiply(world)
          .copyToArray(leafBuffer, ((i * LEAVES_PER_CLOVER) + leaf) * 16);
      }

      plants.push({ x: clover.x, z: clover.z, mowed: false, index: i });
    }

    showInstances(leaflet, leafBuffer);
    showInstances(stem, stemBuffer);
  };

  return {
    place,

    // Collapse any clover the mower is over; re-uploads only on a changed frame.
    update(mowerX: number, mowerZ: number, radiusSquared: number) {
      if (plants.length === 0) {
        return;
      }

      let changed = false;

      for (const plant of plants) {
        if (plant.mowed) {
          continue;
        }

        const dx = plant.x - mowerX;
        const dz = plant.z - mowerZ;

        if ((dx * dx) + (dz * dz) > radiusSquared) {
          continue;
        }

        plant.mowed = true;
        for (let leaf = 0; leaf < LEAVES_PER_CLOVER; leaf += 1) {
          collapseInstance(leafBuffer, (plant.index * LEAVES_PER_CLOVER) + leaf);
        }
        collapseInstance(stemBuffer, plant.index);
        changed = true;
      }

      if (changed) {
        leaflet.thinInstanceBufferUpdated("matrix");
        stem.thinInstanceBufferUpdated("matrix");
      }
    },

    dispose() {
      leaflet.dispose();
      stem.dispose();
    },
  };
}
