import { Matrix, Mesh, Scene, VertexData } from "@babylonjs/core";
import { getActiveMap } from "./config";
import { cloverAmountAt } from "./cloverField";
import type { Materials } from "./materials";

export type CloverPatch = ReturnType<typeof createCloverPatch>;

// Clover ground cover in two tiers, drawn as thin instances:
//
//  - SMALL clovers (the carpet, ~300/m2, ~0.5 cm): a pentagon fanned from one
//    "main" corner vertex into THREE triangles, gently folded (non-planar) so the
//    speck catches light instead of reading as a flat dot. Sit right on the ground
//    at subtly varied heights.
//  - LARGE clovers (sparse, ~70/m2, ~1-2.5 cm): a small fan disc with a 3-lobe
//    rim and a gentle spherical dome (~5-10 triangles). They live in a higher
//    "air space" (~3-5 cm up) at random heights so they hover above the carpet.
//
// Both tiers feather/clump with the irregular `cloverAmountAt` shape, and any
// clover under the mower collapses (mowable).

const TAU = Math.PI * 2;
const SMALL_PER_SQM = 300;
const LARGE_PER_SQM = 70;

function meshFrom(scene: Scene, name: string, positions: number[], indices: number[]): Mesh {
  const normals: number[] = [];
  VertexData.ComputeNormals(positions, indices, normals);
  const mesh = new Mesh(name, scene);
  const data = new VertexData();
  data.positions = positions;
  data.indices = indices;
  data.normals = normals;
  data.applyToMesh(mesh);
  return mesh;
}

// Pentagon (unit radius) fanned from vertex 0 = 3 triangles. Vertex 0 (the "main"
// vertex where the faces converge, with four edges to the other four) is raised a
// little, so the three faces are slightly non-planar.
function buildSmallClover(scene: Scene): Mesh {
  const positions: number[] = [];
  for (let k = 0; k < 5; k += 1) {
    const a = (k / 5) * TAU;
    positions.push(Math.cos(a), k === 0 ? 0.08 : 0, Math.sin(a));
  }
  return meshFrom(scene, "clover-small", positions, [0, 1, 2, 0, 2, 3, 0, 3, 4]);
}

// Larger clover: a centre vertex (domed up ~10 deg of a sphere) fanned to a 7-point
// rim that's gently 3-lobed, so it reads as a rounded clover leaf.
function buildLargeClover(scene: Scene): Mesh {
  const rim = 7;
  const positions: number[] = [0, 0.09, 0];
  const indices: number[] = [];
  for (let k = 0; k < rim; k += 1) {
    const a = (k / rim) * TAU;
    const r = 1 + (0.12 * Math.sin(3 * a));
    positions.push(Math.cos(a) * r, 0, Math.sin(a) * r);
  }
  for (let k = 0; k < rim; k += 1) {
    indices.push(0, 1 + k, 1 + ((k + 1) % rim));
  }
  return meshFrom(scene, "clover-large", positions, indices);
}

type Plant = { x: number; z: number; mowed: boolean; large: boolean; index: number };

export function createCloverPatch(
  scene: Scene,
  materials: Materials,
  groundHeightAt: (x: number, z: number) => number,
) {
  const small = buildSmallClover(scene);
  const large = buildLargeClover(scene);
  for (const mesh of [small, large]) {
    mesh.material = materials.cloverLeafMaterial;
    mesh.alwaysSelectAsActiveMesh = true;
    mesh.isPickable = false;
    mesh.setEnabled(false); // until place() gives it instances
  }

  let plants: Plant[] = [];
  let smallBuffer = new Float32Array(0);
  let largeBuffer = new Float32Array(0);

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

  const place = () => {
    plants = [];
    const patches = getActiveMap().cloverPatches;
    const smallMatrices: Matrix[] = [];
    const largeMatrices: Matrix[] = [];

    const sampleTier = (perSqm: number, isLarge: boolean, out: Matrix[]) => {
      if (!patches) {
        return;
      }
      const spacing = 1 / Math.sqrt(perSqm);
      const jitter = spacing * 0.5;
      for (const patch of patches) {
        const reach = patch.radius * 1.5; // covers the noise-wobbled bulges
        for (let x = patch.x - reach; x <= patch.x + reach; x += spacing) {
          for (let z = patch.z - reach; z <= patch.z + reach; z += spacing) {
            const cx = x + ((Math.random() - 0.5) * 2 * jitter);
            const cz = z + ((Math.random() - 0.5) * 2 * jitter);
            if (Math.random() > cloverAmountAt([patch], cx, cz)) {
              continue;
            }

            const groundY = groundHeightAt(cx, cz);
            // Small: hug the ground at subtly different heights. Large: a separate
            // higher air space (~3.5-5.5 cm) at random heights within it.
            const y = groundY + (isLarge ? 0.035 + (Math.random() * 0.02) : Math.random() * 0.015);
            const radius = isLarge ? 0.007 + (Math.random() * 0.006) : 0.004 + (Math.random() * 0.004);
            const yaw = Math.random() * TAU;
            const tiltX = (Math.random() - 0.5) * 0.3;
            const tiltZ = (Math.random() - 0.5) * 0.3;

            const index = out.length;
            out.push(
              Matrix.Scaling(radius, radius, radius)
                .multiply(Matrix.RotationY(yaw))
                .multiply(Matrix.RotationX(tiltX))
                .multiply(Matrix.RotationZ(tiltZ))
                .multiply(Matrix.Translation(cx, y, cz)),
            );
            plants.push({ x: cx, z: cz, mowed: false, large: isLarge, index });
          }
        }
      }
    };

    sampleTier(SMALL_PER_SQM, false, smallMatrices);
    sampleTier(LARGE_PER_SQM, true, largeMatrices);

    const flatten = (mats: Matrix[]) => {
      const buffer = new Float32Array(mats.length * 16);
      for (let i = 0; i < mats.length; i += 1) {
        mats[i].copyToArray(buffer, i * 16);
      }
      return buffer;
    };

    smallBuffer = flatten(smallMatrices);
    largeBuffer = flatten(largeMatrices);
    showInstances(small, smallBuffer);
    showInstances(large, largeBuffer);
  };

  return {
    place,

    update(mowerX: number, mowerZ: number, radiusSquared: number) {
      if (plants.length === 0) {
        return;
      }
      let smallChanged = false;
      let largeChanged = false;
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
        if (plant.large) {
          collapseInstance(largeBuffer, plant.index);
          largeChanged = true;
        } else {
          collapseInstance(smallBuffer, plant.index);
          smallChanged = true;
        }
      }
      if (smallChanged) {
        small.thinInstanceBufferUpdated("matrix");
      }
      if (largeChanged) {
        large.thinInstanceBufferUpdated("matrix");
      }
    },

    dispose() {
      small.dispose();
      large.dispose();
    },
  };
}
