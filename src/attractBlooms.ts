import { Matrix, Mesh, MeshBuilder, Scene, VertexData, Vector3 } from "@babylonjs/core";
import type { FlowerVariant } from "./config";
import { getActiveMap } from "./config";
import type { Materials } from "./materials";
import { randomHash, valueNoise } from "./utils/noise";
import { isInsideSegments } from "./utils/yard";

export type AttractBlooms = ReturnType<typeof createAttractBlooms>;

const FLOWER_VARIANTS: FlowerVariant[] = ["blue", "white", "yellow", "red"];
const FLOWERS_PER_SQUARE_METER = 1.75;
const CLOVERS_PER_SQUARE_METER = 2.6;
const TULIPS_PER_SQUARE_METER = 0.12;
const DANDELIONS_PER_SQUARE_METER = 0.22;

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
  return getActiveMap().segments.reduce((sum, segment) => sum + ((segment.xMax - segment.xMin) * (segment.zMax - segment.zMin)), 0);
}

function randomMapPoint() {
  const map = getActiveMap();
  const total = mapArea();
  let pick = Math.random() * total;

  for (const segment of map.segments) {
    const area = (segment.xMax - segment.xMin) * (segment.zMax - segment.zMin);
    if (pick > area) {
      pick -= area;
      continue;
    }

    return {
      x: segment.xMin + (Math.random() * (segment.xMax - segment.xMin)),
      z: segment.zMin + (Math.random() * (segment.zMax - segment.zMin)),
    };
  }

  const segment = map.segments[0];
  return {
    x: segment.center.x,
    z: segment.center.z,
  };
}

function cloudyAmount(x: number, z: number, seed: number) {
  const broad = valueNoise((x * 0.16) + seed, (z * 0.16) - seed);
  const mid = valueNoise((x * 0.42) - (seed * 0.7), (z * 0.42) + (seed * 0.9));
  const detail = valueNoise((x * 1.15) + (seed * 2.1), (z * 1.15) - (seed * 1.6));
  return Math.max(0, Math.min(1, (broad * 0.62) + (mid * 0.28) + (detail * 0.1)));
}

function pickCloudPoint(seed: number, threshold: number) {
  let point = randomMapPoint();

  for (let attempt = 0; attempt < 32; attempt += 1) {
    point = randomMapPoint();
    const cloud = cloudyAmount(point.x, point.z, seed);
    const roll = randomHash((point.x * 3.1) + attempt + seed, (point.z * 2.7) - seed);

    if (cloud > threshold && roll < cloud) {
      return point;
    }
  }

  return point;
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
    const flowerCount = Math.min(950, Math.floor(area * FLOWERS_PER_SQUARE_METER));
    const cloverCount = Math.min(1400, Math.floor(area * CLOVERS_PER_SQUARE_METER));
    const tulipCount = Math.min(80, Math.floor(area * TULIPS_PER_SQUARE_METER));
    const dandelionCount = Math.min(140, Math.floor(area * DANDELIONS_PER_SQUARE_METER));
    const petalTotals = {} as Record<FlowerVariant, number>;

    for (const variant of FLOWER_VARIANTS) {
      petalTotals[variant] = 0;
    }

    const flowers = Array.from({ length: flowerCount }, (_, index) => {
      const point = pickCloudPoint(10 + (index % 4), 0.38);
      const cloud = cloudyAmount(point.x, point.z, 10 + (index % 4));
      const variant = FLOWER_VARIANTS[Math.min(FLOWER_VARIANTS.length - 1, Math.floor(cloud * FLOWER_VARIANTS.length))];
      const petalCount = 5 + Math.floor(Math.random() * 4);
      petalTotals[variant] += petalCount;
      return { ...point, variant, petalCount };
    });

    for (const variant of FLOWER_VARIANTS) {
      flowerPetalBuffers[variant] = new Float32Array(petalTotals[variant] * 16);
    }
    flowerStemBuffer = new Float32Array(flowerCount * 16);
    flowerCenterBuffer = new Float32Array(flowerCount * 16);
    cloverLeafBuffer = new Float32Array(cloverCount * 3 * 16);
    cloverStemBuffer = new Float32Array(cloverCount * 16);
    tulipStemBuffer = new Float32Array(tulipCount * 16);
    const tulipHeadChoices = Array.from({ length: tulipCount }, () => Math.floor(Math.random() * materials.tulipHeadMaterials.length));
    const tulipHeadCounts = materials.tulipHeadMaterials.map(() => 0);
    for (const materialIndex of tulipHeadChoices) {
      tulipHeadCounts[materialIndex] += 1;
    }
    tulipHeadBuffers = tulipHeadCounts.map((count) => new Float32Array(count * 16));
    dandelionStemBuffer = new Float32Array(dandelionCount * 16);
    dandelionHeadBuffer = new Float32Array(dandelionCount * 16);
    seedHeadBuffer = new Float32Array(dandelionCount * 16);

    const petalCursor = {} as Record<FlowerVariant, number>;
    for (const variant of FLOWER_VARIANTS) {
      petalCursor[variant] = 0;
    }

    for (let i = 0; i < flowers.length; i += 1) {
      const flower = flowers[i];
      if (!isInsideSegments(getActiveMap().segments, flower.x, flower.z)) {
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

    for (let i = 0; i < cloverCount; i += 1) {
      const point = pickCloudPoint(22, 0.34);
      const groundY = groundHeightAt(point.x, point.z) + 0.008;
      const height = 0.045 + (Math.random() * 0.18);
      const world = Matrix.Translation(point.x, groundY, point.z);
      const tilt = Matrix.RotationX((Math.random() - 0.5) * 0.22).multiply(Matrix.RotationZ((Math.random() - 0.5) * 0.22));
      const phase = Math.random() * Math.PI * 2;

      writeMatrix(cloverStemBuffer, i, Matrix.Scaling(0.008, height, 0.008).multiply(tilt).multiply(world));
      for (let leaf = 0; leaf < 3; leaf += 1) {
        const theta = phase + (leaf * Math.PI * 2 / 3);
        const radius = 0.042 + (Math.random() * 0.027);
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
    for (let i = 0; i < tulipCount; i += 1) {
      const point = pickCloudPoint(33, 0.52);
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
    for (let i = 0; i < dandelionCount; i += 1) {
      const point = pickCloudPoint(44, 0.44);
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
