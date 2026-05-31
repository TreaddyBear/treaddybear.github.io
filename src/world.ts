import {
  ArcRotateCamera,
  Color3,
  Material,
  Mesh,
  MeshBuilder,
  TransformNode,
  VertexData,
  Scene,
  StandardMaterial,
  Vector3,
} from "@babylonjs/core";
import type { FenceSegment, LawnMap } from "./config";
import { valueNoise } from "./utils/noise";
import { createRoadTexture } from "./textures";

function createRoadStripe(scene: Scene, material: StandardMaterial, z: number) {
  const mesh = new Mesh("road-stripe", scene);
  const steps = 8;
  const halfWidth = 0.07;
  const halfLength = 1.86;
  const positions: number[] = [];
  const indices: number[] = [];

  for (let i = 0; i <= steps; i += 1) {
    const t = i / steps;
    const localZ = -halfLength + (t * halfLength * 2);
    const leftNoise = (valueNoise(40 + (z * 0.13), i * 1.7) - 0.5) * 0.045;
    const rightNoise = (valueNoise(80 + (z * 0.11), i * 1.9) - 0.5) * 0.045;
    positions.push(-halfWidth + leftNoise, 0, localZ);
    positions.push(halfWidth + rightNoise, 0, localZ);

    if (i < steps) {
      const offset = i * 2;
      indices.push(offset, offset + 1, offset + 2, offset + 1, offset + 3, offset + 2);
    }
  }

  const normals: number[] = [];
  VertexData.ComputeNormals(positions, indices, normals);

  const vertexData = new VertexData();
  vertexData.positions = positions;
  vertexData.indices = indices;
  vertexData.normals = normals;
  vertexData.applyToMesh(mesh);
  mesh.position = new Vector3(14.5, 0.018, z);
  mesh.material = material;
}

export function createRoad(scene: Scene, roadMaterial: StandardMaterial, stripeMaterial: StandardMaterial) {
  roadMaterial.diffuseColor.set(1, 1, 1);
  roadMaterial.diffuseTexture?.dispose();
  roadMaterial.diffuseTexture = createRoadTexture(scene);

  const road = MeshBuilder.CreateGround("road", { width: 5.2, height: 180 }, scene);
  road.position = new Vector3(14.5, 0.006, 0);
  road.material = roadMaterial;

  for (let z = -82; z <= 82; z += 10) {
    createRoadStripe(scene, stripeMaterial, z);
  }
}

function createFencePost(scene: Scene, material: StandardMaterial, position: Vector3, scaling: Vector3) {
  const post = MeshBuilder.CreateBox("fence-post", { size: 1 }, scene);
  post.position = position;
  post.scaling = scaling;
  post.material = material;
}

function createFencePlanks(scene: Scene, material: StandardMaterial, segmentIndex: number, start: Vector3, end: Vector3) {
  const dx = end.x - start.x;
  const dz = end.z - start.z;
  const length = Math.sqrt((dx * dx) + (dz * dz));
  const steps = Math.floor(length / 0.55);
  const yaw = Math.atan2(dx, dz);

  for (let i = 0; i <= steps; i += 1) {
    const t = steps === 0 ? 0 : i / steps;
    const x = start.x + (dx * t);
    const z = start.z + (dz * t);
    const plank = MeshBuilder.CreateBox(`fence-${segmentIndex}-plank-${i}`, { width: 0.34, height: 0.46, depth: 0.08 }, scene);
    plank.position = new Vector3(x, 0.28, z);
    plank.rotation.y = yaw;
    plank.material = material;
  }
}

export function createFence(scene: Scene, fenceMaterial: StandardMaterial, segments: FenceSegment[]) {
  const root = new TransformNode("fence-root", scene);

  for (const [index, segment] of segments.entries()) {
    createFencePlanks(scene, fenceMaterial, index, segment.start, segment.end);

    for (const position of [segment.start, segment.end]) {
      createFencePost(scene, fenceMaterial, new Vector3(position.x, 0.35, position.z), new Vector3(0.18, 0.7, 0.18));
    }
  }

  for (const mesh of scene.meshes.filter((mesh) => mesh.name.startsWith("fence-"))) {
    mesh.parent = root;
  }

  return root;
}

export function createMapGrounds(scene: Scene, map: LawnMap, groundMaterial: Material) {
  const root = new TransformNode("map-ground-root", scene);
  const bedMaterial = new StandardMaterial("flowerBedMaterial", scene);
  bedMaterial.diffuseColor = new Color3(0.27, 0.15, 0.07);
  bedMaterial.specularColor = new Color3(0.03, 0.02, 0.01);

  for (const [index, segment] of map.segments.entries()) {
    const ground = MeshBuilder.CreateGround(`ground-${index}`, { width: segment.width, height: segment.height }, scene);
    ground.position = segment.center;
    ground.material = groundMaterial;
    ground.receiveShadows = true;
    ground.parent = root;
  }

  for (const [index, bed] of map.flowerBeds.entries()) {
    const width = bed.xMax - bed.xMin;
    const height = bed.zMax - bed.zMin;
    const bedMesh = MeshBuilder.CreateBox(`flower-bed-${index}`, { width, height: 0.12, depth: height }, scene);
    bedMesh.position = new Vector3((bed.xMin + bed.xMax) / 2, 0.035, (bed.zMin + bed.zMax) / 2);
    bedMesh.material = bedMaterial;
    bedMesh.parent = root;
  }

  return root;
}

export function createNeighborhoodLots(scene: Scene, groundMaterial: Material) {
  const lots = [
    { width: 21, height: 24, center: new Vector3(-19.5, 0, 0) },
    { width: 3, height: 24, center: new Vector3(10.6, 0, 0) },
    { width: 19, height: 28, center: new Vector3(26.5, 0, 0) },
    { width: 20, height: 19, center: new Vector3(0, 0, 18.5) },
    { width: 9, height: 7, center: new Vector3(4.6, 0, 5.6) },
  ];

  for (const [index, lot] of lots.entries()) {
    const ground = MeshBuilder.CreateGround(`neighbor-lot-${index}`, { width: lot.width, height: lot.height }, scene);
    ground.position = lot.center;
    ground.position.y = -0.014 - (index * 0.0015);
    ground.material = groundMaterial;
    ground.receiveShadows = true;
  }
}

export function updateFollowCamera(
  camera: ArcRotateCamera,
  playerPosition: Vector3,
  playerYaw: number,
  deltaSeconds: number,
  orbitYaw = 0,
  orbitHeight = 0,
  distanceOffset = 0,
) {
  const cameraYaw = playerYaw + orbitYaw;
  const forward = new Vector3(Math.sin(cameraYaw), 0, Math.cos(cameraYaw));
  const distance = 7.2 + distanceOffset;
  const height = 4.2 + orbitHeight;
  const desiredTarget = playerPosition.add(new Vector3(0, 0.35, 0));
  const desiredPosition = playerPosition
    .subtract(forward.scale(distance))
    .add(new Vector3(0, height, 0));
  const follow = 1 - Math.exp(-deltaSeconds * 3.5);

  camera.target = Vector3.Lerp(camera.target, desiredTarget, follow);
  camera.position = Vector3.Lerp(camera.position, desiredPosition, follow);
}
