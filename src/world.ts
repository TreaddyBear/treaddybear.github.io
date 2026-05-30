import {
  ArcRotateCamera,
  Material,
  MeshBuilder,
  Scene,
  StandardMaterial,
  Vector3,
} from "@babylonjs/core";
import { createRoadTexture } from "./textures";

export function createRoad(scene: Scene, roadMaterial: StandardMaterial, stripeMaterial: StandardMaterial) {
  roadMaterial.diffuseColor.set(1, 1, 1);
  roadMaterial.diffuseTexture?.dispose();
  roadMaterial.diffuseTexture = createRoadTexture(scene);

  const road = MeshBuilder.CreateGround("road", { width: 5.2, height: 180 }, scene);
  road.position = new Vector3(14.5, 0.006, 0);
  road.material = roadMaterial;

  for (let z = -82; z <= 82; z += 10) {
    const stripe = MeshBuilder.CreateBox("road-stripe", { width: 0.18, height: 0.035, depth: 3.8 }, scene);
    stripe.position = new Vector3(14.5, 0.04, z);
    stripe.material = stripeMaterial;
  }
}

function createFencePost(scene: Scene, material: StandardMaterial, position: Vector3, scaling: Vector3) {
  const post = MeshBuilder.CreateBox("fence-post", { size: 1 }, scene);
  post.position = position;
  post.scaling = scaling;
  post.material = material;
}

function createFencePlanks(scene: Scene, material: StandardMaterial, name: string, start: Vector3, end: Vector3) {
  const dx = end.x - start.x;
  const dz = end.z - start.z;
  const length = Math.sqrt((dx * dx) + (dz * dz));
  const steps = Math.floor(length / 0.55);
  const yaw = Math.atan2(dx, dz);

  for (let i = 0; i <= steps; i += 1) {
    const t = steps === 0 ? 0 : i / steps;
    const x = start.x + (dx * t);
    const z = start.z + (dz * t);
    const plank = MeshBuilder.CreateBox(`${name}-plank`, { width: 0.34, height: 0.46, depth: 0.08 }, scene);
    plank.position = new Vector3(x, 0.28, z);
    plank.rotation.y = yaw;
    plank.material = material;
  }
}

export function createFence(scene: Scene, fenceMaterial: StandardMaterial) {
  createFencePlanks(scene, fenceMaterial, "fence-bottom", new Vector3(-9.25, 0, -9.25), new Vector3(9.25, 0, -9.25));
  createFencePlanks(scene, fenceMaterial, "fence-right", new Vector3(9.25, 0, -9.25), new Vector3(9.25, 0, 2.25));
  createFencePlanks(scene, fenceMaterial, "fence-notch-top", new Vector3(9.25, 0, 2.25), new Vector3(0.25, 0, 2.25));
  createFencePlanks(scene, fenceMaterial, "fence-notch-side", new Vector3(0.25, 0, 2.25), new Vector3(0.25, 0, 9.25));
  createFencePlanks(scene, fenceMaterial, "fence-upper-top", new Vector3(0.25, 0, 9.25), new Vector3(-9.25, 0, 9.25));
  createFencePlanks(scene, fenceMaterial, "fence-left", new Vector3(-9.25, 0, 9.25), new Vector3(-9.25, 0, -9.25));

  for (const position of [
    new Vector3(-9.25, 0.35, -9.25),
    new Vector3(9.25, 0.35, -9.25),
    new Vector3(9.25, 0.35, 2.25),
    new Vector3(0.25, 0.35, 2.25),
    new Vector3(0.25, 0.35, 9.25),
    new Vector3(-9.25, 0.35, 9.25),
  ]) {
    createFencePost(scene, fenceMaterial, position, new Vector3(0.18, 0.7, 0.18));
  }
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
    ground.position.y = -0.008;
    ground.material = groundMaterial;
    ground.receiveShadows = true;
  }
}

export function updateFollowCamera(camera: ArcRotateCamera, playerPosition: Vector3, playerYaw: number, deltaSeconds: number) {
  const forward = new Vector3(Math.sin(playerYaw), 0, Math.cos(playerYaw));
  const desiredTarget = playerPosition.add(new Vector3(0, 0.35, 0));
  const desiredPosition = playerPosition
    .subtract(forward.scale(7.2))
    .add(new Vector3(0, 4.2, 0));
  const follow = 1 - Math.exp(-deltaSeconds * 3.5);

  camera.target = Vector3.Lerp(camera.target, desiredTarget, follow);
  camera.position = Vector3.Lerp(camera.position, desiredPosition, follow);
}
