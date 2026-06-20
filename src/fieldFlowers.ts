import { Matrix, Mesh, MeshBuilder, Scene, VertexData } from "@babylonjs/core";
import { getActiveLevelCode, getActiveMap, showcaseLevelCode } from "./config";
import type { FlowerVariant } from "./config";
import { cloverAmountAt } from "./cloverField";
import type { Materials } from "./materials";
import { valueNoise } from "./utils/noise";

export type FieldFlowers = ReturnType<typeof createFieldFlowers>;

// The saddle-petal field flower in several colours, scattered across a map's
// `flowerFields`. Each flower is a short stem, a pale centre dot, and 5-8 low-poly
// saddle petals. A field can hold well over a thousand, so the parts are drawn as
// thin instances: one petal mesh PER COLOUR (its own material), plus a single
// shared stem mesh and centre mesh across every colour. Flowers mow away under
// the mower by collapsing their instance matrices in place.

const VARIANTS: FlowerVariant[] = ["blue", "white", "yellow", "red"];

// Builds one low-poly petal as a hyperbolic-paraboloid (saddle): the long side
// edges curl up while the base and tip droop. Local space: length along +Z (0
// base, 1 tip), width along X, pinched at both ends. Unit-sized.
function buildSaddlePetal(scene: Scene): Mesh {
  const widthCols = 3;
  const lengthRows = 4;
  const baseHalfWidth = 0.5;
  const cupAmount = 0.28;
  const curlAmount = 0.2;

  const widthProfile = (v: number) => Math.max(0.04, Math.sin(Math.PI * Math.min(1, 0.12 + (v * 0.92))));

  const positions: number[] = [];
  const indices: number[] = [];

  for (let row = 0; row < lengthRows; row += 1) {
    const v = row / (lengthRows - 1);
    const halfWidth = baseHalfWidth * widthProfile(v);

    for (let col = 0; col < widthCols; col += 1) {
      const ux = ((col / (widthCols - 1)) * 2) - 1;
      const x = ux * halfWidth;
      const z = v;
      const y = (cupAmount * ux * ux * widthProfile(v)) - (curlAmount * ((2 * v) - 1) ** 2);
      positions.push(x, y, z);
    }
  }

  for (let row = 0; row < lengthRows - 1; row += 1) {
    for (let col = 0; col < widthCols - 1; col += 1) {
      const a = (row * widthCols) + col;
      const b = a + 1;
      const c = a + widthCols;
      const d = c + 1;
      indices.push(a, c, b, b, c, d);
    }
  }

  const normals: number[] = [];
  VertexData.ComputeNormals(positions, indices, normals);

  const mesh = new Mesh("field-flower-petal", scene);
  const data = new VertexData();
  data.positions = positions;
  data.indices = indices;
  data.normals = normals;
  data.applyToMesh(mesh);
  return mesh;
}

type Flower = {
  x: number;
  z: number;
  variant: FlowerVariant;
  yaw: number;
  height: number;
  petalCount: number;
};

type PlantInstance = {
  x: number;
  z: number;
  mowed: boolean;
  variant: FlowerVariant;
  petalStart: number; // within its variant's petal buffer
  petalCount: number;
  index: number; // shared stem + centre instance index
};

export function createFieldFlowers(
  scene: Scene,
  materials: Materials,
  groundHeightAt: (x: number, z: number) => number,
) {
  const petalMaterialFor = {
    blue: materials.blueFlowerPetalMaterial,
    white: materials.whiteFlowerPetalMaterial,
    yellow: materials.yellowFlowerPetalMaterial,
    red: materials.redFlowerPetalMaterial,
  } satisfies Record<FlowerVariant, unknown>;

  // One petal mesh per colour; stem + centre shared across all colours.
  const petalMesh = {} as Record<FlowerVariant, Mesh>;
  for (const variant of VARIANTS) {
    const mesh = buildSaddlePetal(scene);
    mesh.material = petalMaterialFor[variant];
    mesh.alwaysSelectAsActiveMesh = true;
    mesh.isPickable = false;
    petalMesh[variant] = mesh;
  }

  const stem = MeshBuilder.CreateCylinder("field-flower-stem", { height: 1, diameter: 1, tessellation: 5 }, scene);
  stem.bakeTransformIntoVertices(Matrix.Translation(0, 0.5, 0));
  stem.material = materials.blueFlowerStemMaterial;
  stem.alwaysSelectAsActiveMesh = true;
  stem.isPickable = false;

  const center = MeshBuilder.CreateSphere("field-flower-center", { diameter: 1, segments: 6 }, scene);
  center.material = materials.blueFlowerCenterMaterial;
  center.alwaysSelectAsActiveMesh = true;
  center.isPickable = false;

  const allMeshes = [...VARIANTS.map((v) => petalMesh[v]), stem, center];
  for (const mesh of allMeshes) {
    mesh.setEnabled(false);
  }

  // Retained buffers (one petal buffer per colour; shared stem + centre buffers).
  const petalBuffer = {} as Record<FlowerVariant, Float32Array>;
  for (const variant of VARIANTS) {
    petalBuffer[variant] = new Float32Array(0);
  }
  let stemBuffer = new Float32Array(0);
  let centerBuffer = new Float32Array(0);
  let plants: PlantInstance[] = [];

  const showInstances = (mesh: Mesh, buffer: Float32Array) => {
    if (buffer.length === 0) {
      // A thin-instance source mesh still draws once at its unit-sized origin
      // transform with no instances — disable it so it never shows there.
      mesh.thinInstanceCount = 0;
      mesh.setEnabled(false);
      return;
    }

    mesh.setEnabled(true);
    mesh.thinInstanceSetBuffer("matrix", buffer, 16, false);
    mesh.thinInstanceRefreshBoundingInfo();
  };

  // Zero an instance's matrix: its triangles collapse to a point (zero area) and
  // nothing rasterizes — the mowed look.
  const collapseInstance = (buffer: Float32Array, instanceIndex: number) => {
    buffer.fill(0, instanceIndex * 16, (instanceIndex * 16) + 16);
  };

  const buildFlowers = (): Flower[] => {
    if (getActiveLevelCode() === showcaseLevelCode) {
      return [];
    }

    const map = getActiveMap();
    const fields = map.flowerFields;
    const cloverPatches = map.cloverPatches;
    const flowers: Flower[] = [];

    for (const field of fields ?? []) {
      const { area, spacing, variant } = field;
      const jitter = spacing * 0.34;
      // Density falls off over the outer `feather` metres of the field, so the
      // patch dissolves into the grass instead of stopping at a hard rectangle.
      const feather = 1.6;

      for (let x = area.xMin + (spacing / 2); x <= area.xMax; x += spacing) {
        for (let z = area.zMin + (spacing / 2); z <= area.zMax; z += spacing) {
          const fx = x + ((Math.random() - 0.5) * 2 * jitter);
          const fz = z + ((Math.random() - 0.5) * 2 * jitter);

          if (fx < area.xMin || fx > area.xMax || fz < area.zMin || fz > area.zMax) {
            continue;
          }

          // Distance to the nearest field edge -> keep probability (smooth ramp).
          const edgeDist = Math.min(fx - area.xMin, area.xMax - fx, fz - area.zMin, area.zMax - fz);
          const edge = Math.max(0, Math.min(1, edgeDist / feather));
          const edgeKeep = edge * edge * (3 - (2 * edge));
          // Low-frequency noise gathers the flowers into soft clumps with thinner
          // gaps between (a cloudy distribution), instead of an even carpet. A
          // floor keeps the gaps from going fully bare.
          const clump = valueNoise((fx * 0.55) + area.xMin, (fz * 0.55) + area.zMin);
          const c = Math.max(0, Math.min(1, (clump - 0.34) / 0.4));
          const clumpKeep = 0.32 + (0.68 * (c * c * (3 - (2 * c))));
          if (Math.random() > (edgeKeep * clumpKeep)) {
            continue;
          }

          // Keep the colored fields OUT of the clover — clover patches hold only
          // their own little white bunches (added below).
          if (cloverAmountAt(cloverPatches, fx, fz) > 0.3) {
            continue;
          }

          flowers.push({
            x: fx,
            z: fz,
            variant,
            yaw: Math.random() * Math.PI * 2,
            height: 0.1 + (Math.random() * 0.08),
            petalCount: 5 + Math.floor(Math.random() * 4), // 5..8
          });
        }
      }
    }

    // Little white "clover flower" bunches scattered through the clover patches.
    addCloverFlowerBunches(cloverPatches, flowers);

    return flowers;
  };

  // A few tight clumps of white flowers per clover patch — they read as clover
  // blossoms dotted through the patch (the only flowers allowed in the clover).
  const addCloverFlowerBunches = (patches: ReturnType<typeof getActiveMap>["cloverPatches"], out: Flower[]) => {
    if (!patches) {
      return;
    }
    const TAU = Math.PI * 2;
    for (const patch of patches) {
      const bunches = 5 + Math.floor(Math.random() * 5); // 5..9, spread across the patch
      for (let b = 0; b < bunches; b += 1) {
        // Find a bunch centre anywhere in the clover (area-weighted, so they don't
        // pile up in the middle).
        let cx = patch.x;
        let cz = patch.z;
        let found = false;
        for (let tries = 0; tries < 14; tries += 1) {
          const a = Math.random() * TAU;
          const r = Math.sqrt(Math.random()) * patch.radius * 1.5;
          const px = patch.x + (Math.cos(a) * r);
          const pz = patch.z + (Math.sin(a) * r);
          if (cloverAmountAt([patch], px, pz) > 0.45) {
            cx = px;
            cz = pz;
            found = true;
            break;
          }
        }
        if (!found) {
          continue;
        }
        const count = 3 + Math.floor(Math.random() * 4); // 3..6, small bunches
        for (let i = 0; i < count; i += 1) {
          const a = Math.random() * TAU;
          const r = Math.sqrt(Math.random()) * 0.18; // tight little clump
          out.push({
            x: cx + (Math.cos(a) * r),
            z: cz + (Math.sin(a) * r),
            variant: "white",
            yaw: Math.random() * TAU,
            height: 0.08 + (Math.random() * 0.06), // short, like clover blossoms
            petalCount: 5 + Math.floor(Math.random() * 4),
          });
        }
      }
    }
  };

  const place = () => {
    const flowers = buildFlowers();
    plants = [];

    const petalTotals = {} as Record<FlowerVariant, number>;
    for (const variant of VARIANTS) {
      petalTotals[variant] = 0;
    }
    for (const flower of flowers) {
      petalTotals[flower.variant] += flower.petalCount;
    }

    for (const variant of VARIANTS) {
      petalBuffer[variant] = new Float32Array(petalTotals[variant] * 16);
    }
    stemBuffer = new Float32Array(flowers.length * 16);
    centerBuffer = new Float32Array(flowers.length * 16);

    const petalCursor = {} as Record<FlowerVariant, number>;
    for (const variant of VARIANTS) {
      petalCursor[variant] = 0;
    }

    for (let i = 0; i < flowers.length; i += 1) {
      const flower = flowers[i];
      const groundY = groundHeightAt(flower.x, flower.z);
      const world = Matrix.Translation(flower.x, groundY, flower.z);
      const facing = Matrix.RotationY(flower.yaw);
      const headLift = Matrix.Translation(0, flower.height, 0);

      // Stem: unit cylinder scaled to a thin stalk, with a faint random lean.
      const stemRadius = 0.012 + (Math.random() * 0.006);
      const lean = Matrix.RotationX((Math.random() - 0.5) * 0.16)
        .multiply(Matrix.RotationZ((Math.random() - 0.5) * 0.16));
      Matrix.Scaling(stemRadius, flower.height, stemRadius).multiply(lean).multiply(world)
        .copyToArray(stemBuffer, i * 16);

      // Centre dot.
      const centerSize = 0.04 + (Math.random() * 0.02);
      Matrix.Scaling(centerSize, centerSize * 0.55, centerSize)
        .multiply(headLift)
        .multiply(facing)
        .multiply(world)
        .copyToArray(centerBuffer, i * 16);

      // Petals: splayed around the stem, tipped up, ringed around the centre.
      const petalLength = 0.085 + (Math.random() * 0.03);
      const petalWidth = 0.05 + (Math.random() * 0.022);
      const radialOffset = 0.014 + (Math.random() * 0.006);
      const openTilt = 0.55 + (Math.random() * 0.32);
      const variantBuffer = petalBuffer[flower.variant];
      const petalStart = petalCursor[flower.variant];

      for (let p = 0; p < flower.petalCount; p += 1) {
        const theta = ((p / flower.petalCount) * Math.PI * 2) + ((Math.random() - 0.5) * 0.12);
        const lengthScale = petalLength * (0.88 + (Math.random() * 0.26));

        Matrix.Scaling(petalWidth, lengthScale, lengthScale)
          .multiply(Matrix.Translation(0, 0, radialOffset))
          .multiply(Matrix.RotationX(-openTilt))
          .multiply(Matrix.RotationY(theta))
          .multiply(headLift)
          .multiply(facing)
          .multiply(world)
          .copyToArray(variantBuffer, petalCursor[flower.variant] * 16);
        petalCursor[flower.variant] += 1;
      }

      plants.push({
        x: flower.x,
        z: flower.z,
        mowed: false,
        variant: flower.variant,
        petalStart,
        petalCount: flower.petalCount,
        index: i,
      });
    }

    for (const variant of VARIANTS) {
      showInstances(petalMesh[variant], petalBuffer[variant]);
    }
    showInstances(stem, stemBuffer);
    showInstances(center, centerBuffer);
  };

  return {
    place,

    // Collapse any flower the mower is over; re-uploads only changed buffers.
    update(mowerX: number, mowerZ: number, radiusSquared: number) {
      if (plants.length === 0) {
        return;
      }

      const dirtyVariants = new Set<FlowerVariant>();

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
        const variantBuffer = petalBuffer[plant.variant];
        for (let k = 0; k < plant.petalCount; k += 1) {
          collapseInstance(variantBuffer, plant.petalStart + k);
        }
        collapseInstance(stemBuffer, plant.index);
        collapseInstance(centerBuffer, plant.index);
        dirtyVariants.add(plant.variant);
      }

      if (dirtyVariants.size > 0) {
        for (const variant of dirtyVariants) {
          petalMesh[variant].thinInstanceBufferUpdated("matrix");
        }
        stem.thinInstanceBufferUpdated("matrix");
        center.thinInstanceBufferUpdated("matrix");
      }
    },

    dispose() {
      for (const mesh of allMeshes) {
        mesh.dispose();
      }
    },
  };
}
