import { Color3, Matrix, Mesh, Scene, StandardMaterial, VertexData } from "@babylonjs/core";
import { getActiveMap } from "./config";
import { randomHash, valueNoise } from "./utils/noise";
import { isInsideSegments } from "./utils/yard";

export type FallenLeaves = ReturnType<typeof createFallenLeaves>;

const LEAVES_PER_SQUARE_METER = 0.55;
const MAX_LEAVES = 640;
const TAU = Math.PI * 2;

function makeLeafMaterial(scene: Scene, name: string, color: Color3) {
  const material = new StandardMaterial(name, scene);
  material.diffuseColor = color;
  material.emissiveColor = color.scale(0.045);
  material.specularColor = Color3.Black();
  material.backFaceCulling = false;
  return material;
}

function buildLeafMesh(scene: Scene, name: string, variant: number) {
  const widthCols = 5;
  const lengthRows = 9;
  const positions: number[] = [];
  const indices: number[] = [];

  for (let row = 0; row < lengthRows; row += 1) {
    const v = row / (lengthRows - 1);
    const point = (v - 0.5) * 2;
    const lobe = Math.sin(Math.PI * v);
    const taper = Math.max(0.02, lobe ** (0.5 + (variant * 0.08)));
    const asym = (variant === 1 ? 0.06 : variant === 2 ? -0.05 : 0.02) * Math.sin(v * Math.PI * 1.6);

    for (let col = 0; col < widthCols; col += 1) {
      const u = ((col / (widthCols - 1)) * 2) - 1;
      const serration = 1 + (0.08 * Math.sin((v * 18) + (Math.abs(u) * 3.4) + variant));
      const x = (u * 0.5 * taper * serration) + asym;
      const z = point * 0.5;
      const cup = (0.018 + (variant * 0.006)) * (u * u) * lobe;
      const curl = 0.012 * Math.sin((v * Math.PI * 2.2) + variant) * (1 - Math.abs(u));
      positions.push(x, cup + curl, z);
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

  const mesh = new Mesh(name, scene);
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
  return { x: segment.center.x, z: segment.center.z };
}

function leafCloudAmount(x: number, z: number) {
  const broad = valueNoise((x * 0.12) + 54.1, (z * 0.12) - 12.7);
  const mid = valueNoise((x * 0.36) - 18.3, (z * 0.36) + 29.4);
  const detail = valueNoise((x * 0.9) + 7.2, (z * 0.9) - 41.8);
  return Math.max(0, Math.min(1, (broad * 0.62) + (mid * 0.28) + (detail * 0.1)));
}

function pickLeafPoint() {
  let point = randomMapPoint();

  for (let attempt = 0; attempt < 28; attempt += 1) {
    point = randomMapPoint();
    const cloud = leafCloudAmount(point.x, point.z);
    const roll = randomHash((point.x * 2.7) + attempt + 91, (point.z * 3.3) - 47);

    if (cloud > 0.42 && roll < cloud) {
      return point;
    }
  }

  return point;
}

export function createFallenLeaves(
  scene: Scene,
  groundHeightAt: (x: number, z: number) => number,
) {
  const materials = [
    makeLeafMaterial(scene, "fallenLeafOchreMaterial", new Color3(0.50, 0.32, 0.10)),
    makeLeafMaterial(scene, "fallenLeafTanMaterial", new Color3(0.58, 0.45, 0.20)),
    makeLeafMaterial(scene, "fallenLeafUmberMaterial", new Color3(0.34, 0.20, 0.08)),
  ];
  const leafMeshes = materials.map((material, index) => {
    const mesh = buildLeafMesh(scene, `fallen-leaf-${index}`, index);
    mesh.material = material;
    mesh.alwaysSelectAsActiveMesh = true;
    mesh.isPickable = false;
    mesh.setEnabled(false);
    return mesh;
  });
  let buffers = materials.map(() => new Float32Array(0));
  let active = false;

  const setActive = (value: boolean) => {
    active = value;
    for (let i = 0; i < leafMeshes.length; i += 1) {
      leafMeshes[i].setEnabled(value && leafMeshes[i].thinInstanceCount > 0);
    }
  };

  const place = () => {
    const leafCount = Math.min(MAX_LEAVES, Math.floor(mapArea() * LEAVES_PER_SQUARE_METER));
    const choices = Array.from({ length: leafCount }, () => Math.floor(Math.random() * leafMeshes.length));
    const counts = leafMeshes.map(() => 0);
    for (const choice of choices) {
      counts[choice] += 1;
    }
    buffers = counts.map((count) => new Float32Array(count * 16));
    const cursors = leafMeshes.map(() => 0);

    for (let i = 0; i < leafCount; i += 1) {
      const point = pickLeafPoint();
      if (!isInsideSegments(getActiveMap().segments, point.x, point.z)) {
        continue;
      }

      const choice = choices[i];
      const groundY = groundHeightAt(point.x, point.z) + 0.026 + (Math.random() * 0.006);
      const yaw = Math.random() * TAU;
      const pitch = (Math.random() - 0.5) * 0.08;
      const roll = (Math.random() - 0.5) * 0.12;
      const length = 0.16 + (Math.random() * 0.14);
      const width = length * (0.42 + (Math.random() * 0.18));

      Matrix.Scaling(width, 1, length)
        .multiply(Matrix.RotationX(pitch))
        .multiply(Matrix.RotationZ(roll))
        .multiply(Matrix.RotationY(yaw))
        .multiply(Matrix.Translation(point.x, groundY, point.z))
        .copyToArray(buffers[choice], cursors[choice] * 16);
      cursors[choice] += 1;
    }

    for (let i = 0; i < leafMeshes.length; i += 1) {
      showInstances(leafMeshes[i], buffers[i]);
    }
    setActive(active);
  };

  return {
    place,
    setActive,
  };
}
