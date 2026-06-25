import { Matrix, Mesh, MeshBuilder, Scene, VertexData, Vector3 } from "@babylonjs/core";
import type { FlowerVariant } from "./config";
import { getActiveMap } from "./config";
import type { Materials } from "./materials";
import { randomHash, smoothstep, valueNoise } from "./utils/noise";
import { containsMowablePoint, randomMowablePoint } from "./runtimeMap";

export type AttractBlooms = ReturnType<typeof createAttractBlooms>;

const FLOWER_VARIANTS: FlowerVariant[] = ["blue", "white", "yellow", "red"];
const WARM_FLOWERS_PER_SQUARE_METER = 0.34;
const BLUE_FLOWERS_PER_SQUARE_METER = 0.26;
const CLOVERS_PER_SQUARE_METER = 0.18;
const TULIPS_PER_SQUARE_METER = 0.12;
const DANDELIONS_PER_SQUARE_METER = 0.07;
const clamp01 = (value: number) => Math.max(0, Math.min(1, value));

type MaskedPoint = {
  x: number;
  z: number;
  amount: number;
};

type FlowerPlacement = MaskedPoint & {
  variant: FlowerVariant;
  petalCount: number;
};

function buildSaddlePetal(scene: Scene): Mesh {
  const widthCols = 3;
  const lengthRows = 4;
  const positions: number[] = [];
  const indices: number[] = [];

  for (let row = 0; row < lengthRows; row += 1) {
    const v = row / (lengthRows - 1);
    const halfWidth = 0.5 * Math.max(0.05, Math.sin(Math.PI * Math.min(1, 0.12 + (v * 0.92))));

    for (let col = 0; col < widthCols; col += 1) {
      const ux = ((col / (widthCols - 1)) * 2) - 1;
      positions.push(ux * halfWidth, (0.24 * ux * ux) - (0.16 * ((2 * v) - 1) ** 2), v);
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

  const mesh = new Mesh("attract-flower-petal", scene);
  const data = new VertexData();
  data.positions = positions;
  data.indices = indices;
  data.normals = normals;
  data.applyToMesh(mesh);
  return mesh;
}

function buildLeaflet(scene: Scene): Mesh {
  const segments = 8;
  const positions: number[] = [0, 0.045, 0];
  const indices: number[] = [];

  for (let i = 0; i < segments; i += 1) {
    const angle = (i / segments) * Math.PI * 2;
    positions.push(Math.cos(angle), 0, Math.sin(angle));
  }

  for (let i = 0; i < segments; i += 1) {
    indices.push(0, 1 + i, 1 + ((i + 1) % segments));
  }

  const normals: number[] = [];
  VertexData.ComputeNormals(positions, indices, normals);

  const mesh = new Mesh("attract-clover-leaflet", scene);
  const data = new VertexData();
  data.positions = positions;
  data.indices = indices;
  data.normals = normals;
  data.applyToMesh(mesh);
  return mesh;
}

function showInstances(mesh: Mesh, buffer: Float32Array) {
  if (buffer.length === 0) {
    mesh.thinInstanceCount = 0;
    mesh.setEnabled(false);
    return;
  }

  mesh.thinInstanceSetBuffer("matrix", buffer, 16, false);
  mesh.thinInstanceRefreshBoundingInfo();
}

function mapArea() {
  return getActiveMap().mowableArea;
}

function randomMapPoint() {
  return randomMowablePoint(getActiveMap());
}

function fbm(x: number, z: number, seed: number) {
  let sum = 0;
  let amplitude = 0.5;
  let frequency = 1;
  let norm = 0;

  for (let octave = 0; octave < 4; octave += 1) {
    sum += valueNoise((x * frequency) + (seed * 7.13), (z * frequency) - (seed * 5.31)) * amplitude;
    norm += amplitude;
    amplitude *= 0.5;
    frequency *= 2.03;
  }

  return sum / norm;
}

function focalLawnAmount(x: number, z: number) {
  const radius = Math.hypot(x, z);
  return 1 - smoothstep(clamp01((radius - 42) / 22));
}

function rampedNoiseAmount(x: number, z: number, seed: number, cutoff: number, power: number) {
  const broad = fbm(x * 0.052, z * 0.052, seed);
  const mid = fbm(x * 0.13, z * 0.13, seed + 19.7);
  const veinRaw = valueNoise((x * 0.31) + (seed * 2.1), (z * 0.31) - (seed * 1.7));
  const vein = 1 - (Math.abs(veinRaw - 0.5) * 2);
  const composed = Math.max(
    (broad * 0.82) + (mid * 0.18),
    (broad * 0.55) + (mid * 0.1) + (vein * 0.35),
  );
  const ramp = smoothstep(clamp01((composed - cutoff) / (1 - cutoff)));
  return (ramp ** power) * focalLawnAmount(x, z);
}

function warmFlowerAmount(x: number, z: number) {
  return rampedNoiseAmount(x, z, 12.7, 0.6, 1.45);
}

function blueFlowerAmount(x: number, z: number) {
  return rampedNoiseAmount(x, z, 31.2, 0.61, 1.5);
}

function dandelionAmount(x: number, z: number) {
  return rampedNoiseAmount(x, z, 46.9, 0.66, 1.35);
}

function cloverAttractAmount(x: number, z: number) {
  const flowerPressure = Math.max(warmFlowerAmount(x, z), blueFlowerAmount(x, z), dandelionAmount(x, z) * 0.8);
  const leftover = clamp01(1 - (flowerPressure * 1.35));
  const cloverNoise = rampedNoiseAmount(x, z, 72.4, 0.5, 1.9);
  return (leftover ** 1.35) * cloverNoise;
}

function pickMaskedPoint(mask: (x: number, z: number) => number, seed: number, attempts = 96): MaskedPoint {
  let best = randomMapPoint();
  let bestAmount = mask(best.x, best.z);

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const point = randomMapPoint();
    const amount = mask(point.x, point.z);
    if (amount > bestAmount) {
      best = point;
      bestAmount = amount;
    }

    const roll = randomHash((point.x * 3.1) + attempt + seed, (point.z * 2.7) - seed);
    if (amount > 0.035 && roll < amount) {
      return { ...point, amount };
    }
  }

  return { ...best, amount: bestAmount };
}

function writeMatrix(buffer: Float32Array, index: number, matrix: Matrix) {
  matrix.copyToArray(buffer, index * 16);
}

export function createAttractBlooms(
  scene: Scene,
  materials: Materials,
  groundHeightAt: (x: number, z: number) => number,
) {
  const flowerPetalMeshes = {} as Record<FlowerVariant, Mesh>;
  const flowerPetalBuffers = {} as Record<FlowerVariant, Float32Array>;
  const flowerPetalMaterials = {
    blue: materials.blueFlowerPetalMaterial,
    white: materials.whiteFlowerPetalMaterial,
    yellow: materials.yellowFlowerPetalMaterial,
    red: materials.redFlowerPetalMaterial,
  };

  for (const variant of FLOWER_VARIANTS) {
    const mesh = buildSaddlePetal(scene);
    mesh.material = flowerPetalMaterials[variant];
    mesh.alwaysSelectAsActiveMesh = true;
    mesh.isPickable = false;
    flowerPetalMeshes[variant] = mesh;
    flowerPetalBuffers[variant] = new Float32Array(0);
  }

  const flowerStem = MeshBuilder.CreateCylinder("attract-flower-stem", { height: 1, diameter: 1, tessellation: 5 }, scene);
  flowerStem.bakeTransformIntoVertices(Matrix.Translation(0, 0.5, 0));
  flowerStem.material = materials.blueFlowerStemMaterial;

  const flowerCenter = MeshBuilder.CreateSphere("attract-flower-center", { diameter: 1, segments: 6 }, scene);
  flowerCenter.material = materials.blueFlowerCenterMaterial;

  const cloverLeaf = buildLeaflet(scene);
  cloverLeaf.material = materials.cloverLeafMaterial;
  const cloverStem = MeshBuilder.CreateCylinder("attract-clover-stem", { height: 1, diameter: 1, tessellation: 5 }, scene);
  cloverStem.bakeTransformIntoVertices(Matrix.Translation(0, 0.5, 0));
  cloverStem.material = materials.cloverStemMaterial;

  const tulipStem = MeshBuilder.CreateCylinder("attract-tulip-stem", { height: 1, diameter: 1, tessellation: 5 }, scene);
  tulipStem.bakeTransformIntoVertices(Matrix.Translation(0, 0.5, 0));
  tulipStem.material = materials.tulipStemMaterial;
  const tulipHeadMeshes = materials.tulipHeadMaterials.map((material, index) => {
    const mesh = MeshBuilder.CreateSphere(`attract-tulip-head-${index}`, { diameter: 1, segments: 7 }, scene);
    mesh.material = material;
    return mesh;
  });

  const dandelionStem = MeshBuilder.CreateCylinder("attract-dandelion-stem", { height: 1, diameter: 1, tessellation: 5 }, scene);
  dandelionStem.bakeTransformIntoVertices(Matrix.Translation(0, 0.5, 0));
  dandelionStem.material = materials.dandelionStemMaterial;
  const dandelionHead = MeshBuilder.CreateSphere("attract-dandelion-head", { diameter: 1, segments: 7 }, scene);
  dandelionHead.material = materials.dandelionYellowMaterial;
  const seedHead = MeshBuilder.CreateSphere("attract-seed-head", { diameter: 1, segments: 8 }, scene);
  seedHead.material = materials.dandelionSeedMaterial;

  const meshes = [
    ...FLOWER_VARIANTS.map((variant) => flowerPetalMeshes[variant]),
    flowerStem,
    flowerCenter,
    cloverLeaf,
    cloverStem,
    tulipStem,
    ...tulipHeadMeshes,
    dandelionStem,
    dandelionHead,
    seedHead,
  ];

  for (const mesh of meshes) {
    mesh.setEnabled(false);
    mesh.alwaysSelectAsActiveMesh = true;
    mesh.isPickable = false;
  }

  let flowerStemBuffer = new Float32Array(0);
  let flowerCenterBuffer = new Float32Array(0);
  let cloverLeafBuffer = new Float32Array(0);
  let cloverStemBuffer = new Float32Array(0);
  let tulipStemBuffer = new Float32Array(0);
  let tulipHeadBuffers = materials.tulipHeadMaterials.map(() => new Float32Array(0));
  let dandelionStemBuffer = new Float32Array(0);
  let dandelionHeadBuffer = new Float32Array(0);
  let seedHeadBuffer = new Float32Array(0);
  let active = false;

  const setRoadVisible = (visible: boolean) => {
    for (const mesh of scene.meshes) {
      if (mesh.name === "road" || mesh.name.startsWith("road-")) {
        mesh.setEnabled(visible);
      }
    }
  };

  const setActive = (value: boolean) => {
    active = value;
    setRoadVisible(!value);
    for (const mesh of meshes) {
      mesh.setEnabled(value && (mesh.thinInstanceCount > 0));
    }
  };

  const place = () => {
    const area = mapArea();
    const warmFlowerCount = Math.min(5200, Math.floor(area * WARM_FLOWERS_PER_SQUARE_METER));
    const blueFlowerCount = Math.min(3900, Math.floor(area * BLUE_FLOWERS_PER_SQUARE_METER));
    const cloverCount = Math.min(2800, Math.floor(area * CLOVERS_PER_SQUARE_METER));
    const tulipCount = Math.min(90, Math.floor(area * TULIPS_PER_SQUARE_METER));
    const dandelionCount = Math.min(920, Math.floor(area * DANDELIONS_PER_SQUARE_METER));
    const petalTotals = {} as Record<FlowerVariant, number>;

    for (const variant of FLOWER_VARIANTS) {
      petalTotals[variant] = 0;
    }

    const flowers: FlowerPlacement[] = [];
    const addFlowerBatch = (
      count: number,
      mask: (x: number, z: number) => number,
      pickVariant: (point: MaskedPoint, index: number) => FlowerVariant,
      seed: number,
    ) => {
      for (let index = 0; index < count; index += 1) {
        const point = pickMaskedPoint(mask, seed + (index % 31));
        if (point.amount < 0.04) {
          continue;
        }
        const variant = pickVariant(point, index);
        const petalCount = 5 + Math.floor(randomHash((point.x * 1.9) + index, (point.z * 1.7) - seed) * 4);
        flowers.push({ ...point, variant, petalCount });
        petalTotals[variant] += petalCount;
      }
    };

    addFlowerBatch(
      warmFlowerCount,
      warmFlowerAmount,
      (point, index) => (randomHash((point.x * 0.7) + index, (point.z * 0.9) - 18.3) < 0.64 ? "yellow" : "red"),
      101,
    );
    addFlowerBatch(blueFlowerCount, blueFlowerAmount, () => "blue", 202);

    const clovers = Array.from({ length: cloverCount }, (_, index) => pickMaskedPoint(cloverAttractAmount, 303 + (index % 37), 80))
      .filter((point) => point.amount > 0.035);
    const tulips = Array.from({ length: tulipCount }, (_, index) => pickMaskedPoint(warmFlowerAmount, 404 + (index % 11), 80))
      .filter((point) => point.amount > 0.08);
    const dandelions = Array.from({ length: dandelionCount }, (_, index) => pickMaskedPoint(dandelionAmount, 505 + (index % 23), 88))
      .filter((point) => point.amount > 0.045);

    for (const variant of FLOWER_VARIANTS) {
      flowerPetalBuffers[variant] = new Float32Array(petalTotals[variant] * 16);
    }
    flowerStemBuffer = new Float32Array(flowers.length * 16);
    flowerCenterBuffer = new Float32Array(flowers.length * 16);
    cloverLeafBuffer = new Float32Array(clovers.length * 3 * 16);
    cloverStemBuffer = new Float32Array(clovers.length * 16);
    tulipStemBuffer = new Float32Array(tulips.length * 16);
    const tulipHeadChoices = Array.from({ length: tulips.length }, () => Math.floor(Math.random() * materials.tulipHeadMaterials.length));
    const tulipHeadCounts = materials.tulipHeadMaterials.map(() => 0);
    for (const materialIndex of tulipHeadChoices) {
      tulipHeadCounts[materialIndex] += 1;
    }
    tulipHeadBuffers = tulipHeadCounts.map((count) => new Float32Array(count * 16));
    dandelionStemBuffer = new Float32Array(dandelions.length * 16);
    dandelionHeadBuffer = new Float32Array(dandelions.length * 16);
    seedHeadBuffer = new Float32Array(dandelions.length * 16);

    const petalCursor = {} as Record<FlowerVariant, number>;
    for (const variant of FLOWER_VARIANTS) {
      petalCursor[variant] = 0;
    }

    for (let i = 0; i < flowers.length; i += 1) {
      const flower = flowers[i];
      if (!containsMowablePoint(getActiveMap(), flower.x, flower.z)) {
        continue;
      }
      const groundY = groundHeightAt(flower.x, flower.z) + 0.012;
      const yaw = Math.random() * Math.PI * 2;
      const world = Matrix.Translation(flower.x, groundY, flower.z);
      const headLift = Matrix.Translation(0, 0.09 + (Math.random() * 0.08), 0);
      const facing = Matrix.RotationY(yaw);
      const stemRadius = 0.009 + (Math.random() * 0.006);
      const stemHeight = 0.09 + (Math.random() * 0.08);

      writeMatrix(flowerStemBuffer, i, Matrix.Scaling(stemRadius, stemHeight, stemRadius).multiply(world));
      writeMatrix(flowerCenterBuffer, i, Matrix.Scaling(0.035, 0.02, 0.035).multiply(headLift).multiply(world));

      for (let p = 0; p < flower.petalCount; p += 1) {
        const theta = ((p / flower.petalCount) * Math.PI * 2) + ((Math.random() - 0.5) * 0.18);
        writeMatrix(
          flowerPetalBuffers[flower.variant],
          petalCursor[flower.variant],
          Matrix.Scaling(0.045 + (Math.random() * 0.02), 0.075 + (Math.random() * 0.03), 0.075 + (Math.random() * 0.03))
            .multiply(Matrix.Translation(0, 0, 0.015))
            .multiply(Matrix.RotationX(-(0.52 + (Math.random() * 0.34))))
            .multiply(Matrix.RotationY(theta))
            .multiply(headLift)
            .multiply(facing)
            .multiply(world),
        );
        petalCursor[flower.variant] += 1;
      }
    }

    for (let i = 0; i < clovers.length; i += 1) {
      const point = clovers[i];
      const groundY = groundHeightAt(point.x, point.z) + 0.008;
      const cloverDensity = smoothstep(clamp01(point.amount));
      const height = 0.035 + (Math.random() * (0.08 + (cloverDensity * 0.1)));
      const world = Matrix.Translation(point.x, groundY, point.z);
      const tilt = Matrix.RotationX((Math.random() - 0.5) * 0.22).multiply(Matrix.RotationZ((Math.random() - 0.5) * 0.22));
      const phase = Math.random() * Math.PI * 2;

      writeMatrix(cloverStemBuffer, i, Matrix.Scaling(0.008, height, 0.008).multiply(tilt).multiply(world));
      for (let leaf = 0; leaf < 3; leaf += 1) {
        const theta = phase + (leaf * Math.PI * 2 / 3);
        const radius = (0.034 + (Math.random() * 0.023)) * (0.72 + (cloverDensity * 0.42));
        writeMatrix(
          cloverLeafBuffer,
          (i * 3) + leaf,
          Matrix.Scaling(radius, radius, radius)
            .multiply(Matrix.RotationX(-(0.16 + (Math.random() * 0.16))))
            .multiply(Matrix.Translation(0, height, radius * 0.85))
            .multiply(Matrix.RotationY(theta))
            .multiply(tilt)
            .multiply(world),
        );
      }
    }

    const tulipHeadCursor = materials.tulipHeadMaterials.map(() => 0);
    for (let i = 0; i < tulips.length; i += 1) {
      const point = tulips[i];
      const groundY = groundHeightAt(point.x, point.z) + 0.02;
      const height = 0.32 + (Math.random() * 0.22);
      const world = Matrix.Translation(point.x, groundY, point.z);
      const tilt = Matrix.RotationX((Math.random() - 0.5) * 0.16).multiply(Matrix.RotationZ((Math.random() - 0.5) * 0.16));
      const materialIndex = tulipHeadChoices[i];

      writeMatrix(tulipStemBuffer, i, Matrix.Scaling(0.018, height, 0.018).multiply(tilt).multiply(world));
      writeMatrix(
        tulipHeadBuffers[materialIndex],
        tulipHeadCursor[materialIndex],
        Matrix.Scaling(0.075, 0.115, 0.075).multiply(Matrix.Translation(0, height + 0.055, 0)).multiply(tilt).multiply(world),
      );
      tulipHeadCursor[materialIndex] += 1;
    }

    let yellowCursor = 0;
    let seedCursor = 0;
    for (let i = 0; i < dandelions.length; i += 1) {
      const point = dandelions[i];
      const groundY = groundHeightAt(point.x, point.z) + 0.018;
      const height = 0.35 + (Math.random() * 0.42);
      const world = Matrix.Translation(point.x, groundY, point.z);
      const tilt = Matrix.RotationX((Math.random() - 0.5) * 0.22).multiply(Matrix.RotationZ((Math.random() - 0.5) * 0.22));
      const seed = Math.random() < 0.42;

      writeMatrix(dandelionStemBuffer, i, Matrix.Scaling(0.015, height, 0.015).multiply(tilt).multiply(world));
      if (seed) {
        writeMatrix(seedHeadBuffer, seedCursor, Matrix.Scaling(0.11, 0.11, 0.11).multiply(Matrix.Translation(0, height + 0.06, 0)).multiply(tilt).multiply(world));
        seedCursor += 1;
      } else {
        writeMatrix(dandelionHeadBuffer, yellowCursor, Matrix.Scaling(0.095, 0.045, 0.095).multiply(Matrix.Translation(0, height + 0.045, 0)).multiply(tilt).multiply(world));
        yellowCursor += 1;
      }
    }

    for (const variant of FLOWER_VARIANTS) {
      showInstances(flowerPetalMeshes[variant], flowerPetalBuffers[variant]);
    }
    showInstances(flowerStem, flowerStemBuffer);
    showInstances(flowerCenter, flowerCenterBuffer);
    showInstances(cloverLeaf, cloverLeafBuffer);
    showInstances(cloverStem, cloverStemBuffer);
    showInstances(tulipStem, tulipStemBuffer);
    for (let i = 0; i < tulipHeadMeshes.length; i += 1) {
      showInstances(tulipHeadMeshes[i], tulipHeadBuffers[i]);
    }
    showInstances(dandelionStem, dandelionStemBuffer);
    showInstances(dandelionHead, dandelionHeadBuffer);
    showInstances(seedHead, seedHeadBuffer);
    setActive(active);
  };

  return {
    place,
    setActive,
  };
}
