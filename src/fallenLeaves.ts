import { Color3, Matrix, Mesh, Scene, StandardMaterial, VertexData } from "@babylonjs/core";
import { getActiveMap } from "./config";
import { randomHash, valueNoise } from "./utils/noise";
import { isInsideSegments } from "./utils/yard";

export type FallenLeaves = ReturnType<typeof createFallenLeaves>;

const LEAVES_PER_SQUARE_METER = 0.08;
const MAX_LEAVES = 820;
const TAU = Math.PI * 2;

function makeLeafMaterial(scene: Scene, name: string, color: Color3) {
  const material = new StandardMaterial(name, scene);
  material.diffuseColor = color;
  material.emissiveColor = color;
  material.specularColor = Color3.Black();
  material.backFaceCulling = false;
  return material;
}

function buildLeafMesh(scene: Scene, name: string, variant: number) {
  const widthCols = 7;
  const lengthRows = 11;
  const positions: number[] = [];
  const indices: number[] = [];

  for (let row = 0; row < lengthRows; row += 1) {
    const v = row / (lengthRows - 1);
    const point = (v - 0.5) * 2;
    const lobe = Math.sin(Math.PI * v);
    const shoulder = variant === 0
      ? 1 + (0.22 * Math.sin(v * Math.PI * 5))
      : variant === 1
        ? 1 + (0.16 * Math.sin((v * Math.PI * 7) + 0.8))
        : 1 + (0.12 * Math.sin((v * Math.PI * 4) - 0.6));
    const taper = Math.max(0.025, (lobe ** (0.34 + (variant * 0.04))) * shoulder);
    const asym = (variant === 1 ? 0.08 : variant === 2 ? -0.06 : 0.03) * Math.sin(v * Math.PI * 1.6);

    for (let col = 0; col < widthCols; col += 1) {
      const u = ((col / (widthCols - 1)) * 2) - 1;
      const edge = Math.abs(u);
      const serration = 1 + ((0.10 + (variant * 0.025)) * Math.sin((v * 28) + (edge * 4.8) + variant));
      const x = (u * 0.5 * taper * serration) + (asym * edge);
      const z = point * 0.5;
      const cup = (0.032 + (variant * 0.009)) * (u * u) * lobe;
      const curl = 0.026 * Math.sin((v * Math.PI * 2.2) + variant) * (1 - edge);
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

function buildVeinMesh(scene: Scene) {
  const positions = [
    -0.018, 0.018, -0.42,
    0.018, 0.018, -0.42,
    -0.012, 0.026, 0.42,
    0.012, 0.026, 0.42,
  ];
  const indices = [0, 2, 1, 1, 2, 3];
  const normals: number[] = [];
  VertexData.ComputeNormals(positions, indices, normals);

  const mesh = new Mesh("fallen-leaf-vein", scene);
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

function edgeAmount(x: number, z: number) {
  const map = getActiveMap();
  let nearest = 99;
  for (const segment of map.segments) {
    if (x < segment.xMin || x > segment.xMax || z < segment.zMin || z > segment.zMax) {
      continue;
    }
    nearest = Math.min(
      nearest,
      x - segment.xMin,
      segment.xMax - x,
      z - segment.zMin,
      segment.zMax - z,
    );
  }

  return Math.max(0, Math.min(1, (16 - nearest) / 16));
}

function pickLeafPoint() {
  let point = randomMapPoint();
  let bestPoint = point;
  let bestEdge = -1;

  for (let attempt = 0; attempt < 42; attempt += 1) {
    point = randomMapPoint();
    const cloud = leafCloudAmount(point.x, point.z);
    const edge = edgeAmount(point.x, point.z);
    const roll = randomHash((point.x * 2.7) + attempt + 91, (point.z * 3.3) - 47);
    const centerSpeckle = roll < 0.008 && cloud > 0.68;

    if (edge > bestEdge) {
      bestEdge = edge;
      bestPoint = point;
    }

    if ((edge > 0.14 && roll < edge * cloud * 1.34) || centerSpeckle) {
      return point;
    }
  }

  return bestPoint;
}

export function createFallenLeaves(
  scene: Scene,
  groundHeightAt: (x: number, z: number) => number,
) {
  const materials = [
    makeLeafMaterial(scene, "fallenLeafBrownMaterial", new Color3(0.88, 0.56, 0.22)),
    makeLeafMaterial(scene, "fallenLeafOrangeMaterial", new Color3(1.00, 0.56, 0.14)),
    makeLeafMaterial(scene, "fallenLeafRedMaterial", new Color3(0.95, 0.26, 0.12)),
    makeLeafMaterial(scene, "fallenLeafGoldMaterial", new Color3(1.00, 0.78, 0.24)),
  ];
  const leafMeshes = materials.map((material, index) => {
    const mesh = buildLeafMesh(scene, `fallen-leaf-${index}`, index);
    mesh.material = material;
    mesh.alwaysSelectAsActiveMesh = true;
    mesh.isPickable = false;
    mesh.setEnabled(false);
    return mesh;
  });
  const veinMaterial = makeLeafMaterial(scene, "fallenLeafVeinMaterial", new Color3(0.42, 0.22, 0.06));
  veinMaterial.emissiveColor = new Color3(0.38, 0.18, 0.045);
  const veinMesh = buildVeinMesh(scene);
  veinMesh.material = veinMaterial;
  veinMesh.alwaysSelectAsActiveMesh = true;
  veinMesh.isPickable = false;
  veinMesh.setEnabled(false);
  let buffers = materials.map(() => new Float32Array(0));
  let veinBuffer = new Float32Array(0);
  let active = false;

  const setActive = (value: boolean) => {
    active = value;
    for (let i = 0; i < leafMeshes.length; i += 1) {
      leafMeshes[i].setEnabled(value && leafMeshes[i].thinInstanceCount > 0);
    }
    veinMesh.setEnabled(value && veinMesh.thinInstanceCount > 0);
  };

  const place = () => {
    const leafCount = Math.min(MAX_LEAVES, Math.floor(mapArea() * LEAVES_PER_SQUARE_METER));
    const choices = Array.from({ length: leafCount }, () => Math.floor(Math.random() * leafMeshes.length));
    const counts = leafMeshes.map(() => 0);
    for (const choice of choices) {
      counts[choice] += 1;
    }
    buffers = counts.map((count) => new Float32Array(count * 16));
    veinBuffer = new Float32Array(leafCount * 16);
    const cursors = leafMeshes.map(() => 0);
    let veinCursor = 0;

    for (let i = 0; i < leafCount; i += 1) {
      const point = pickLeafPoint();
      if (!isInsideSegments(getActiveMap().segments, point.x, point.z)) {
        continue;
      }

      const choice = choices[i];
      const trapped = Math.random() < 0.48;
      const yaw = Math.random() * TAU;
      const length = 0.42 + (Math.random() * 0.34);
      const width = length * (0.52 + (Math.random() * 0.18));
      const groundY = groundHeightAt(point.x, point.z)
        + (trapped ? 0.28 + (length * 0.22) + (Math.random() * 0.16) : 0.56 + (Math.random() * 0.18));
      const pitchSign = Math.random() < 0.5 ? -1 : 1;
      const pitch = trapped
        ? pitchSign * (0.84 + (Math.random() * 0.42))
        : (Math.random() - 0.5) * 0.12;
      const roll = trapped
        ? (Math.random() - 0.5) * 0.34
        : (Math.random() - 0.5) * 0.16;

      const matrix = Matrix.Scaling(width, 1, length)
        .multiply(Matrix.RotationX(pitch))
        .multiply(Matrix.RotationZ(roll))
        .multiply(Matrix.RotationY(yaw))
        .multiply(Matrix.Translation(point.x, groundY, point.z));
      matrix.copyToArray(buffers[choice], cursors[choice] * 16);
      matrix.copyToArray(veinBuffer, veinCursor * 16);
      cursors[choice] += 1;
      veinCursor += 1;
    }

    for (let i = 0; i < leafMeshes.length; i += 1) {
      showInstances(leafMeshes[i], buffers[i]);
    }
    showInstances(veinMesh, veinBuffer);
    setActive(active);
  };

  return {
    place,
    setActive,
  };
}
