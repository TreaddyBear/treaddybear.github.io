import {
  ArcRotateCamera,
  Color3,
  DirectionalLight,
  Engine,
  HemisphericLight,
  Matrix,
  Mesh,
  MeshBuilder,
  PBRMaterial,
  Quaternion,
  Scene,
  ShadowGenerator,
  StandardMaterial,
  TransformNode,
  VertexBuffer,
  VertexData,
  Vector3,
} from "@babylonjs/core";
import "./style.css";
import { createPrototypeAudio } from "./audio";
import {
  bladeCount,
  cellSize,
  mediumGrassCount,
  mowerCutRadius,
  playerBoost,
  playerRadius,
  playerSpeed,
  settings,
  wheatGrassCount,
  yardSegments,
} from "./config";
import type { YardSegment } from "./config";
import { createGroundTexture } from "./textures";
import { color3ToHsl, hexToColor3, hslToColor3, mixColor } from "./utils/color";
import { emptyMatrix, writeColor, writeMatrix } from "./utils/buffers";
import { grassNoiseAt, randomHash } from "./utils/noise";
import { gridKey, isInsideSegments, randomPointInSegments, randomRectPoint } from "./utils/yard";
import { createFence, createNeighborhoodLots, createRoad, updateFollowCamera } from "./world";

const canvasElement = document.querySelector<HTMLCanvasElement>("#renderCanvas");
const scoreElement = document.querySelector<HTMLDivElement>("#score");
const meterFillElement = document.querySelector<HTMLDivElement>("#meterFill");
const settingsElement = document.querySelector<HTMLDetailsElement>("#settings");
const fullscreenButtonElement = document.querySelector<HTMLButtonElement>("#fullscreenButton");
const celebrationElement = document.querySelector<HTMLDivElement>("#celebration");
const celebrationSeedsElement = document.querySelector<HTMLDivElement>("#celebrationSeeds");

if (
  !canvasElement
  || !scoreElement
  || !meterFillElement
  || !settingsElement
  || !fullscreenButtonElement
  || !celebrationElement
  || !celebrationSeedsElement
) {
  throw new Error("Missing canvas, HUD, or settings element.");
}

const canvas = canvasElement;
const scoreEl = scoreElement;
const meterFillEl = meterFillElement;
const settingsEl = settingsElement;
const fullscreenButtonEl = fullscreenButtonElement;
const celebrationEl = celebrationElement;
const celebrationSeedsEl = celebrationSeedsElement;

const engine = new Engine(canvas, true);
const scene = new Scene(engine);
const prototypeAudio = createPrototypeAudio();
let celebrationShown = false;

if (import.meta.env.PROD) {
  settingsEl.hidden = true;
}

const keys = new Set<string>();
const grassGrid = new Map<string, number[]>();
let player: Mesh;
let longGrass: Mesh;
let cutGrass: Mesh;
let mediumGrass: Mesh;
let wheatGrass: Mesh;
let longGrassMatrices: Float32Array;
let cutGrassMatrices: Float32Array;
let mediumGrassMatrices: Float32Array;
let wheatGrassMatrices: Float32Array;
let mediumGrassColors: Float32Array;
let wheatGrassColors: Float32Array;
let longGrassColors: Float32Array;
let cutGrassColors: Float32Array;
let grassX: Float32Array;
let grassZ: Float32Array;
let grassRotation: Float32Array;
let grassScale: Float32Array;
let grassNoise: Float32Array;
let grassPhase: Float32Array;
let grassPressure: Float32Array;
let grassPressureYaw: Float32Array;
let cutTiltX: Float32Array;
let cutTiltZ: Float32Array;
let isMowed: boolean[];
let mowedCount = 0;
let playerYaw = 0;
let turnHoldSeconds = 0;
let lastTurnDirection = 0;
let currentThrottle = 0;
let clippingBurstCooldown = 0;
const windWisps: WindWisp[] = [];
const windMotes: WindMote[] = [];
const dandelions: Dandelion[] = [];
const floatingSeeds: FloatingSeed[] = [];
const fallingPetals: FallingPetal[] = [];

type WindWisp = {
  mesh: Mesh;
  material: StandardMaterial;
  segment: YardSegment;
  positions: Float32Array;
  age: number;
  duration: number;
  length: number;
  x: number;
  z: number;
  y: number;
  bend: number;
  hook: number;
};
type WindMote = {
  mesh: Mesh;
  material: StandardMaterial;
  segment: YardSegment;
  age: number;
  duration: number;
  x: number;
  y: number;
  z: number;
  speed: number;
  drift: number;
  size: number;
};
type Dandelion = {
  root: TransformNode;
  stem: Mesh;
  head: TransformNode;
  pieces: Mesh[];
  detachedPieces: Mesh[];
  x: number;
  z: number;
  kind: "yellow" | "seed";
  cut: boolean;
  popped: boolean;
  headVelocity: Vector3;
  headFalling: boolean;
  headSettled: boolean;
};
type FloatingSeed = {
  mesh: Mesh;
  age: number;
  duration: number;
  velocity: Vector3;
  drift: number;
};
type FallingPetal = {
  mesh: Mesh;
  age: number;
  duration: number;
  velocity: Vector3;
};

scene.clearColor.set(0.66, 0.8, 0.96, 1);
scene.imageProcessingConfiguration.exposure = 1.08;
scene.imageProcessingConfiguration.contrast = 1.12;
//scene.fogMode = Scene.FOGMODE_EXP2;
//scene.fogColor = new Color3(0.62, 0.76, 0.9);
//scene.fogDensity = 0.002;

function makeMaterial(name: string, color: Color3, roughness = 0.65) {
  const material = new PBRMaterial(name, scene);
  material.albedoColor = color;
  material.roughness = roughness;
  material.metallic = 0;
  return material;
}

const playerMaterial = makeMaterial("playerMaterial", new Color3(0.08, 0.36, 0.95), 0.42);
const groundMaterial = makeMaterial("groundMaterial", new Color3(0.42, 0.5, 0.08), 0.9);
const bladeMaterial = makeMaterial("bladeMaterial", Color3.White(), 0.38);
bladeMaterial.backFaceCulling = false;
bladeMaterial.specularIntensity = 0.75;
bladeMaterial.clearCoat.isEnabled = true;
bladeMaterial.clearCoat.intensity = 0.22;
bladeMaterial.clearCoat.roughness = 0.42;
const cutBladeMaterial = makeMaterial("cutBladeMaterial", Color3.White(), 0.58);
cutBladeMaterial.backFaceCulling = false;
cutBladeMaterial.specularIntensity = 0.35;
cutBladeMaterial.clearCoat.isEnabled = true;
cutBladeMaterial.clearCoat.intensity = 0.08;
cutBladeMaterial.clearCoat.roughness = 0.6;

const dandelionStemMaterial = new StandardMaterial("dandelionStemMaterial", scene);
dandelionStemMaterial.diffuseColor = new Color3(0.24, 0.58, 0.16);
dandelionStemMaterial.specularColor = Color3.Black();

const dandelionYellowMaterial = new StandardMaterial("dandelionYellowMaterial", scene);
dandelionYellowMaterial.diffuseColor = new Color3(1, 0.96, 0.02);
dandelionYellowMaterial.emissiveColor = new Color3(0.38, 0.28, 0);
dandelionYellowMaterial.specularColor = Color3.Black();

const dandelionSeedMaterial = new StandardMaterial("dandelionSeedMaterial", scene);
dandelionSeedMaterial.diffuseColor = new Color3(0.95, 0.96, 0.88);
dandelionSeedMaterial.emissiveColor = new Color3(0.18, 0.2, 0.16);
dandelionSeedMaterial.specularColor = Color3.Black();
dandelionSeedMaterial.alpha = 0.72;

const dandelionCenterMaterial = new StandardMaterial("dandelionCenterMaterial", scene);
dandelionCenterMaterial.diffuseColor = new Color3(0.82, 0.58, 0.04);
dandelionCenterMaterial.emissiveColor = new Color3(0.1, 0.07, 0);
dandelionCenterMaterial.specularColor = Color3.Black();

const roadMaterial = new StandardMaterial("roadMaterial", scene);
roadMaterial.diffuseColor = new Color3(0.34, 0.34, 0.33);
roadMaterial.specularColor = Color3.Black();

const stripeMaterial = new StandardMaterial("stripeMaterial", scene);
stripeMaterial.diffuseColor = new Color3(0.95, 0.82, 0.2);
stripeMaterial.emissiveColor = new Color3(0.08, 0.06, 0);
stripeMaterial.specularColor = Color3.Black();

const fenceMaterial = new StandardMaterial("fenceMaterial", scene);
fenceMaterial.diffuseColor = new Color3(0.92, 0.9, 0.84);
fenceMaterial.specularColor = Color3.Black();

const worldGroundMaterial = new StandardMaterial("worldGroundMaterial", scene);
worldGroundMaterial.diffuseColor = new Color3(0.08, 0.16, 0.03);
worldGroundMaterial.specularColor = Color3.Black();

function makeLongBladeMesh(name = "longGrass") {
  const mesh = new Mesh(name, scene);
  const positions = [
    -0.055, 0, 0,
    0.055, 0, 0,
    -0.035, 0.5, 0.025,
    0.035, 0.5, 0.025,
    -0.085, 0.5, 0.035,
    0.085, 0.5, 0.035,
    0, 0.86, 0.14,
    0, 0, -0.035,
    0, 0.45, 0.005,
    0, 0.8, 0.11,
  ];
  const indices = [
    0, 1, 2,
    1, 3, 2,
    4, 5, 6,
    7, 8, 0,
    8, 2, 0,
    8, 9, 2,
    9, 6, 2,
  ];
  const normals: number[] = [];
  VertexData.ComputeNormals(positions, indices, normals);

  const vertexData = new VertexData();
  vertexData.positions = positions;
  vertexData.indices = indices;
  vertexData.normals = normals;
  vertexData.applyToMesh(mesh);
  mesh.material = bladeMaterial;
  return mesh;
}

function makeCutBladeMesh() {
  const mesh = new Mesh("cutGrass", scene);
  const positions = [
    -0.055, 0, 0,
    0.055, 0, 0,
    -0.04, 1, 0.01,
    0.04, 1, -0.005,
  ];
  const indices = [
    0, 1, 2,
    1, 3, 2,
  ];
  const normals: number[] = [];
  VertexData.ComputeNormals(positions, indices, normals);

  const vertexData = new VertexData();
  vertexData.positions = positions;
  vertexData.indices = indices;
  vertexData.normals = normals;
  vertexData.applyToMesh(mesh);
  mesh.material = cutBladeMaterial;
  return mesh;
}

function makeWheatBladeMesh() {
  const mesh = new Mesh("wheatGrass", scene);
  const positions = [
    -0.018, 0, 0,
    0.018, 0, 0,
    -0.012, 0.75, 0.02,
    0.012, 0.75, 0.02,
    -0.055, 0.72, 0.025,
    0.055, 0.72, 0.025,
    0, 1.05, 0.055,
  ];
  const indices = [
    0, 1, 2,
    1, 3, 2,
    4, 5, 6,
  ];
  const normals: number[] = [];
  VertexData.ComputeNormals(positions, indices, normals);

  const vertexData = new VertexData();
  vertexData.positions = positions;
  vertexData.indices = indices;
  vertexData.normals = normals;
  vertexData.applyToMesh(mesh);
  mesh.material = bladeMaterial;
  return mesh;
}

function updateHud() {
  const percentage = mowedCount === bladeCount ? 100 : Math.floor((mowedCount / bladeCount) * 100);
  scoreEl.textContent = `Mowed: ${percentage}%`;
  meterFillEl.style.width = `${(mowedCount / bladeCount) * 100}%`;

  if (percentage === 100 && !celebrationShown) {
    showCelebration();
  }
}

function showCelebration() {
  celebrationShown = true;
  celebrationSeedsEl.replaceChildren();

  for (let i = 0; i < 96; i += 1) {
    const seed = document.createElement("span");
    const angle = Math.random() * Math.PI * 2;
    const distance = 110 + (Math.random() * 420);
    const verticalLift = 40 + (Math.random() * 220);

    seed.className = "celebration-seed";
    seed.style.setProperty("--seed-x", `${Math.cos(angle) * distance}px`);
    seed.style.setProperty("--seed-y", `${(Math.sin(angle) * distance) - verticalLift}px`);
    seed.style.setProperty("--seed-delay", `${Math.random() * 0.7}s`);
    seed.style.setProperty("--seed-size", `${4 + (Math.random() * 9)}px`);
    seed.style.setProperty("--seed-hue", `${Math.floor(Math.random() * 360)}`);
    celebrationSeedsEl.append(seed);
  }

  celebrationEl.hidden = false;
  window.setTimeout(() => {
    celebrationEl.hidden = true;
  }, 5200);
}

function resetCelebration() {
  celebrationShown = false;
  celebrationEl.hidden = true;
  celebrationSeedsEl.replaceChildren();
}

function isInsideYard(x: number, z: number) {
  return isInsideSegments(yardSegments, x, z);
}

function randomYardPoint() {
  return randomPointInSegments(yardSegments);
}

function distanceToMainYard(x: number, z: number) {
  let closest = Number.POSITIVE_INFINITY;

  for (const segment of yardSegments) {
    const clampedX = Math.min(segment.xMax, Math.max(segment.xMin, x));
    const clampedZ = Math.min(segment.zMax, Math.max(segment.zMin, z));
    const dx = x - clampedX;
    const dz = z - clampedZ;
    closest = Math.min(closest, Math.sqrt((dx * dx) + (dz * dz)));
  }

  return closest;
}

function isOnRoad(x: number) {
  return x > 11.8 && x < 17.2;
}

function distanceToSegment(x: number, z: number, startX: number, startZ: number, endX: number, endZ: number) {
  const dx = endX - startX;
  const dz = endZ - startZ;
  const lengthSquared = (dx * dx) + (dz * dz);
  const t = lengthSquared === 0
    ? 0
    : Math.min(1, Math.max(0, (((x - startX) * dx) + ((z - startZ) * dz)) / lengthSquared));
  const closestX = startX + (dx * t);
  const closestZ = startZ + (dz * t);
  const offsetX = x - closestX;
  const offsetZ = z - closestZ;
  return Math.sqrt((offsetX * offsetX) + (offsetZ * offsetZ));
}

function grassFenceFalloff(x: number, z: number) {
  const fenceSegments = [
    [-9, -9, 9, -9],
    [9, -9, 9, 2],
    [9, 2, 0, 2],
    [0, 2, 0, 9],
    [0, 9, -9, 9],
    [-9, 9, -9, -9],
  ];
  let distance = Number.POSITIVE_INFINITY;

  for (const [startX, startZ, endX, endZ] of fenceSegments) {
    distance = Math.min(distance, distanceToSegment(x, z, startX, startZ, endX, endZ));
  }

  if (distance < 0.09) {
    return 0;
  }

  const open = Math.min(1, Math.max(0, (distance - 0.09) / 0.2));
  return open * open * (3 - (2 * open));
}

function matrixForBlade(index: number, cut: boolean, yawOverride = grassRotation[index], sway = 0) {
  const pitch = cut ? cutTiltX[index] : sway * 0.28;
  const roll = cut ? cutTiltZ[index] : sway;
  const rotation = Quaternion.FromEulerAngles(pitch, yawOverride, roll);
  const height = cut ? 0.065 : grassScale[index];
  const width = cut ? 1.15 : 1;
  const scale = new Vector3(width, height, width);
  const position = new Vector3(grassX[index], 0, grassZ[index]);

  return Matrix.Compose(scale, rotation, position);
}

function colorForBlade(index: number, cut: boolean) {
  const base = color3ToHsl(hexToColor3(settings.grassBaseColor));
  const cutColor = hexToColor3(settings.cutGrassColor);
  const perBladeNoise = randomHash(index, index * 0.37) - 0.5;
  const colorNoise = Math.min(1, Math.max(0, grassNoise[index] + (perBladeNoise * 0.12)));
  const hue = base.h + ((colorNoise - 0.5) * settings.hueVariance);
  const saturation = base.s + ((colorNoise - 0.5) * settings.satVariance);
  const lightness = base.l + ((colorNoise - 0.5) * settings.lightVariance);
  const longColor = hslToColor3(hue, saturation, lightness);
  const color = cut ? mixColor(cutColor, longColor, 0.16) : longColor;

  return [color.r, color.g, color.b, 1];
}

function placeGrass() {
  grassGrid.clear();
  mowedCount = 0;
  grassX = new Float32Array(bladeCount);
  grassZ = new Float32Array(bladeCount);
  grassRotation = new Float32Array(bladeCount);
  grassScale = new Float32Array(bladeCount);
  grassNoise = new Float32Array(bladeCount);
  grassPhase = new Float32Array(bladeCount);
  grassPressure = new Float32Array(bladeCount);
  grassPressureYaw = new Float32Array(bladeCount);
  cutTiltX = new Float32Array(bladeCount);
  cutTiltZ = new Float32Array(bladeCount);
  isMowed = Array.from({ length: bladeCount }, () => false);
  longGrassMatrices = new Float32Array(bladeCount * 16);
  cutGrassMatrices = new Float32Array(bladeCount * 16);
  longGrassColors = new Float32Array(bladeCount * 4);
  cutGrassColors = new Float32Array(bladeCount * 4);
  const hiddenMatrix = emptyMatrix();

  for (let i = 0; i < bladeCount; i += 1) {
    let { x, z } = randomYardPoint();
    let fenceFalloff = grassFenceFalloff(x, z);

    for (let attempt = 0; attempt < 70 && fenceFalloff < 0.98; attempt += 1) {
      ({ x, z } = randomYardPoint());
      fenceFalloff = grassFenceFalloff(x, z);
    }

    const clumpNoise = grassNoiseAt(x, z);
    const randomHeight = Math.random();
    const mixedHeight = (clumpNoise * settings.clumpStrength) + (randomHeight * settings.heightRandomness);
    const normalizedHeight = Math.min(1, Math.max(0, mixedHeight / Math.max(0.01, settings.clumpStrength + settings.heightRandomness)));

    grassX[i] = x;
    grassZ[i] = z;
    grassRotation[i] = Math.random() * Math.PI;
    grassNoise[i] = clumpNoise;
    grassScale[i] = settings.minHeight + ((settings.maxHeight - settings.minHeight) * normalizedHeight);
    grassPhase[i] = Math.random() * Math.PI * 2;
    cutTiltX[i] = (Math.random() - 0.5) * 0.16;
    cutTiltZ[i] = (Math.random() - 0.5) * 0.16;

    writeMatrix(longGrassMatrices, i, matrixForBlade(i, false));
    writeMatrix(cutGrassMatrices, i, hiddenMatrix);
    writeColor(longGrassColors, i, colorForBlade(i, false));
    writeColor(cutGrassColors, i, colorForBlade(i, true));

    const cellX = Math.floor(x / cellSize);
    const cellZ = Math.floor(z / cellSize);
    const key = gridKey(cellX, cellZ);
    const cell = grassGrid.get(key);

    if (cell) {
      cell.push(i);
    } else {
      grassGrid.set(key, [i]);
    }
  }

  longGrass.thinInstanceSetBuffer("matrix", longGrassMatrices, 16, false);
  longGrass.thinInstanceSetBuffer("color", longGrassColors, 4, false);
  cutGrass.thinInstanceSetBuffer("matrix", cutGrassMatrices, 16, false);
  cutGrass.thinInstanceSetBuffer("color", cutGrassColors, 4, false);
}

function placeMediumGrass() {
  mediumGrassMatrices = new Float32Array(mediumGrassCount * 16);
  mediumGrassColors = new Float32Array(mediumGrassCount * 4);
  const base = hexToColor3(settings.grassBaseColor);

  for (let i = 0; i < mediumGrassCount; i += 1) {
    let x = 0;
    let z = 0;
    let distance = 0;
    let density = 0;

    for (let attempt = 0; attempt < 80; attempt += 1) {
      x = -34 + (Math.random() * 68);
      z = -29 + (Math.random() * 58);
      distance = distanceToMainYard(x, z);
      density = Math.max(0, 1 - (distance / 28));

      if (!isInsideYard(x, z) && !isOnRoad(x) && Math.random() < Math.max(0.08, density)) {
        break;
      }
    }

    const rotation = Quaternion.FromEulerAngles(0, Math.random() * Math.PI, (Math.random() - 0.5) * 0.08);
    const distanceFade = Math.max(0.28, 1 - (distance * 0.026));
    const patchNoise = grassNoiseAt(x, z);
    const scale = new Vector3(1, (0.22 + (0.34 * patchNoise) + (Math.random() * 0.16)) * distanceFade, 1);
    const matrix = Matrix.Compose(scale, rotation, new Vector3(x, 0, z));
    const shade = 0.8 + (patchNoise * 0.22) + (Math.random() * 0.12);
    writeMatrix(mediumGrassMatrices, i, matrix);
    writeColor(mediumGrassColors, i, [
      Math.min(1, base.r * shade),
      Math.min(1, base.g * shade),
      Math.min(1, base.b * shade),
      1,
    ]);
  }

  mediumGrass.thinInstanceSetBuffer("matrix", mediumGrassMatrices, 16, true);
  mediumGrass.thinInstanceSetBuffer("color", mediumGrassColors, 4, true);
}

function placeWheatGrass() {
  wheatGrassMatrices = new Float32Array(wheatGrassCount * 16);
  wheatGrassColors = new Float32Array(wheatGrassCount * 4);

  for (let i = 0; i < wheatGrassCount; i += 1) {
    let x = 0;
    let z = 0;
    let patchNoise = 0;

    for (let attempt = 0; attempt < 90; attempt += 1) {
      x = -55 + (Math.random() * 120);
      z = -55 + (Math.random() * 110);
      patchNoise = grassNoiseAt(x * 0.45, z * 0.45);

      if (!isInsideYard(x, z) && !isOnRoad(x) && distanceToMainYard(x, z) > 24 && Math.random() < patchNoise * 0.7) {
        break;
      }
    }

    const rotation = Quaternion.FromEulerAngles((Math.random() - 0.5) * 0.18, Math.random() * Math.PI, (Math.random() - 0.5) * 0.32);
    const height = 0.7 + (patchNoise * 1.25) + (Math.random() * 0.45);
    const matrix = Matrix.Compose(new Vector3(0.85, height, 0.85), rotation, new Vector3(x, 0, z));
    const color = mixColor(new Color3(0.48, 0.45, 0.31), new Color3(0.86, 0.8, 0.56), patchNoise);
    const pale = mixColor(color, new Color3(0.82, 0.84, 0.78), Math.random() * 0.3);

    writeMatrix(wheatGrassMatrices, i, matrix);
    writeColor(wheatGrassColors, i, [pale.r, pale.g, pale.b, 1]);
  }

  wheatGrass.thinInstanceSetBuffer("matrix", wheatGrassMatrices, 16, true);
  wheatGrass.thinInstanceSetBuffer("color", wheatGrassColors, 4, true);
}

function clearDandelions() {
  while (dandelions.length > 0) {
    const dandelion = dandelions.pop();
    dandelion?.root.dispose(false, true);
  }
}

function createDandelion(x: number, z: number, kind: Dandelion["kind"]) {
  const root = new TransformNode(`dandelion-${kind}`, scene);
  root.position = new Vector3(x, 0, z);
  const pieces: Mesh[] = [];

  const height = kind === "seed" ? 0.95 : 0.72;
  const stem = MeshBuilder.CreateCylinder(`${kind}-stem`, {
    height,
    diameter: 0.025,
    tessellation: 5,
  }, scene);
  stem.parent = root;
  stem.position.y = height / 2;
  stem.rotation.x = (Math.random() - 0.5) * 0.25;
  stem.rotation.z = (Math.random() - 0.5) * 0.25;
  stem.material = dandelionStemMaterial;

  const head = new TransformNode(`${kind}-head`, scene);
  head.parent = root;
  head.position.y = height + 0.02;

  if (kind === "yellow") {
    const center = MeshBuilder.CreateSphere("yellow-center", { diameter: 0.13, segments: 6 }, scene);
    center.parent = head;
    center.material = dandelionCenterMaterial;
    pieces.push(center);

    for (let i = 0; i < 22; i += 1) {
      const angle = (i / 22) * Math.PI * 2;
      const petal = MeshBuilder.CreateSphere(`yellow-petal-${i}`, { diameter: 0.085, segments: 5 }, scene);
      petal.parent = head;
      petal.position = new Vector3(Math.cos(angle) * 0.085, Math.sin(angle * 3) * 0.018, Math.sin(angle) * 0.085);
      petal.scaling = new Vector3(1.6, 0.45, 0.65);
      petal.rotation.y = -angle;
      petal.material = dandelionYellowMaterial;
      pieces.push(petal);
    }
  } else {
    const core = MeshBuilder.CreateSphere("seed-core", { diameter: 0.06, segments: 5 }, scene);
    core.parent = head;
    core.material = dandelionStemMaterial;
    pieces.push(core);

    const fuzzCount = 120 + Math.floor(Math.random() * 58);

    for (let i = 0; i < fuzzCount; i += 1) {
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos((Math.random() * 2) - 1);
      const radius = 0.14 + (Math.random() * 0.07);
      const fuzz = MeshBuilder.CreateSphere(`seed-fuzz-${i}`, { diameter: 0.018 + (Math.random() * 0.014), segments: 4 }, scene);
      fuzz.parent = head;
      fuzz.position = new Vector3(
        Math.sin(phi) * Math.cos(theta) * radius,
        Math.cos(phi) * radius,
        Math.sin(phi) * Math.sin(theta) * radius,
      );
      fuzz.scaling = new Vector3(1, 0.55, 1);
      fuzz.billboardMode = Mesh.BILLBOARDMODE_ALL;
      fuzz.material = dandelionSeedMaterial;
      pieces.push(fuzz);
    }
  }

  dandelions.push({
    root,
    stem,
    head,
    pieces,
    detachedPieces: [],
    x,
    z,
    kind,
    cut: false,
    popped: false,
    headVelocity: Vector3.Zero(),
    headFalling: false,
    headSettled: false,
  });
}

function placeDandelions() {
  clearDandelions();

  for (let i = 0; i < 30; i += 1) {
    const { x, z } = randomYardPoint();
    const kind = i % 3 === 0 ? "seed" : "yellow";

    if ((x * x) + (z * z) > 1.4) {
      createDandelion(x, z, kind);
    }
  }
}

function resetGame() {
  resetCelebration();
  player.position = new Vector3(0, 0.18, 0);
  playerYaw = 0;
  player.rotation.y = playerYaw;
  placeGrass();
  placeDandelions();
  mowTouchedGrass();
  updateHud();
}

function moveWithinYard(nextPosition: Vector3) {
  if (isInsideYard(nextPosition.x, nextPosition.z)) {
    player.position.copyFrom(nextPosition);
    return;
  }

  if (isInsideYard(nextPosition.x, player.position.z)) {
    player.position.x = nextPosition.x;
  }

  if (isInsideYard(player.position.x, nextPosition.z)) {
    player.position.z = nextPosition.z;
  }
}

function movePlayer(deltaSeconds: number) {
  const turnDirection = (keys.has("d") ? 1 : 0) - (keys.has("a") ? 1 : 0);

  if (turnDirection !== 0) {
    turnHoldSeconds = turnDirection === lastTurnDirection ? turnHoldSeconds + deltaSeconds : 0;
    lastTurnDirection = turnDirection;
    const build = Math.min(1, turnHoldSeconds / settings.turnBuild);
    const turnScale = 0.14 + (build * build * 0.86);
    playerYaw += turnDirection * settings.turnMaxSpeed * turnScale * deltaSeconds;
  } else {
    turnHoldSeconds = 0;
    lastTurnDirection = 0;
  }

  player.rotation.y = playerYaw;

  currentThrottle = 0;

  if (keys.has("w")) {
    currentThrottle += 1;
  }

  if (keys.has("s")) {
    currentThrottle -= 0.45;
  }

  if (currentThrottle === 0) {
    return;
  }

  const boost = keys.has(" ") ? playerBoost : 1;
  const direction = new Vector3(Math.sin(playerYaw), 0, Math.cos(playerYaw));
  direction.scaleInPlace(playerSpeed * boost * currentThrottle * deltaSeconds);
  moveWithinYard(player.position.add(direction));
}

function mowTouchedGrass() {
  const mowRadiusSquared = mowerCutRadius * mowerCutRadius;
  const minCellX = Math.floor((player.position.x - mowerCutRadius) / cellSize);
  const maxCellX = Math.floor((player.position.x + mowerCutRadius) / cellSize);
  const minCellZ = Math.floor((player.position.z - mowerCutRadius) / cellSize);
  const maxCellZ = Math.floor((player.position.z + mowerCutRadius) / cellSize);
  let mowedThisFrame = false;

  for (let cellX = minCellX; cellX <= maxCellX; cellX += 1) {
    for (let cellZ = minCellZ; cellZ <= maxCellZ; cellZ += 1) {
      const cell = grassGrid.get(gridKey(cellX, cellZ));

      if (!cell) {
        continue;
      }

      for (const index of cell) {
        if (isMowed[index]) {
          continue;
        }

        const dx = player.position.x - grassX[index];
        const dz = player.position.z - grassZ[index];

        if ((dx * dx) + (dz * dz) <= mowRadiusSquared) {
          isMowed[index] = true;
          mowedCount += 1;
          writeMatrix(longGrassMatrices, index, emptyMatrix());
          writeMatrix(cutGrassMatrices, index, matrixForBlade(index, true));
          mowedThisFrame = true;
        }
      }
    }
  }

  if (mowedThisFrame) {
    longGrass.thinInstanceBufferUpdated("matrix");
    cutGrass.thinInstanceBufferUpdated("matrix");
    updateHud();

    if (clippingBurstCooldown <= 0) {
      burstMowerClippings(false);
      clippingBurstCooldown = 0.35;
    }
  }

  for (const dandelion of dandelions) {
    const headPosition = dandelion.head.getAbsolutePosition();
    const targetX = dandelion.kind === "yellow" && dandelion.cut ? headPosition.x : dandelion.x;
    const targetZ = dandelion.kind === "yellow" && dandelion.cut ? headPosition.z : dandelion.z;
    const dx = player.position.x - targetX;
    const dz = player.position.z - targetZ;

    if ((dx * dx) + (dz * dz) <= mowRadiusSquared) {
      mowDandelion(dandelion);
    }
  }
}

function mowDandelion(dandelion: Dandelion) {
  if (dandelion.kind === "yellow" && dandelion.cut && !dandelion.popped) {
    if (dandelion.headSettled) {
      releaseYellowPetals(dandelion);
      burstMowerClippings(true);
    }

    return;
  }

  if (dandelion.cut) {
    return;
  }

  dandelion.cut = true;
  dandelion.stem.scaling.y = 0.18;
  dandelion.stem.position.y = 0.07;
  burstMowerClippings(dandelion.kind === "yellow");

  if (dandelion.kind === "seed") {
    releaseDandelionSeeds(dandelion, dandelion.pieces.length, true);
    return;
  }

  const worldPosition = dandelion.head.getAbsolutePosition().clone();
  dandelion.head.parent = null;
  dandelion.head.position.copyFrom(worldPosition);
  dandelion.headVelocity = new Vector3(
    Math.sin(playerYaw) * 2.2,
    1.65,
    Math.cos(playerYaw) * 2.2,
  );
  dandelion.headFalling = true;
}

function updateGrassMotion(timeSeconds: number) {
  const forwardX = Math.sin(playerYaw);
  const forwardZ = Math.cos(playerYaw);
  const sideX = Math.cos(playerYaw);
  const sideZ = -Math.sin(playerYaw);
  let changed = false;

  for (let i = 0; i < bladeCount; i += 1) {
    if (isMowed[i]) {
      continue;
    }

    const dx = grassX[i] - player.position.x;
    const dz = grassZ[i] - player.position.z;
    const localForward = (forwardX * dx) + (forwardZ * dz);
    const localSide = (sideX * dx) + (sideZ * dz);
    const halfWidth = 0.58;
    const halfLength = 0.78;
    const feather = 0.24;
    const outsideSide = Math.max(0, Math.abs(localSide) - halfWidth);
    const outsideForward = Math.max(0, Math.abs(localForward) - halfLength);
    const outsideDistance = Math.sqrt((outsideSide * outsideSide) + (outsideForward * outsideForward));
    const insideMower = Math.abs(localSide) <= halfWidth && Math.abs(localForward) <= halfLength;

    if (currentThrottle !== 0 && (insideMower || outsideDistance < feather)) {
      const edgeFalloff = insideMower ? 1 : 1 - (outsideDistance / feather);
      const movementBias = Math.max(0, 1 - (Math.max(0, localForward * Math.sign(currentThrottle)) / (halfLength + feather)));
      const targetPressure = Math.min(1, edgeFalloff * (0.35 + (movementBias * 0.65)));

      if (targetPressure > grassPressure[i]) {
        grassPressure[i] = targetPressure;
        grassPressureYaw[i] = Math.atan2(dx, dz);
      }
    }

    const pressure = grassPressure[i];
    const wind = Math.sin((timeSeconds * 1.7) + grassPhase[i] + (grassX[i] * 0.45)) * settings.windStrength * (1 - (pressure * 0.9));
    let yaw = grassRotation[i];
    let sway = wind + (pressure * settings.bendStrength * 1.45);

    if (pressure > 0.02) {
      const blend = Math.min(1, pressure * 1.2);
      yaw = (grassRotation[i] * (1 - blend)) + (grassPressureYaw[i] * blend);
    }

    writeMatrix(longGrassMatrices, i, matrixForBlade(i, false, yaw, sway));
    changed = true;
  }

  if (changed) {
    longGrass.thinInstanceBufferUpdated("matrix");
  }
}

function createWindWispMesh(name: string) {
  const mesh = new Mesh(name, scene);
  const segments = 80;
  const positions = new Float32Array((segments + 1) * 2 * 3);
  const indices: number[] = [];

  for (let i = 0; i <= segments; i += 1) {
    if (i < segments) {
      const base = i * 2;
      indices.push(base, base + 1, base + 2);
      indices.push(base + 1, base + 3, base + 2);
    }
  }

  const normals: number[] = [];
  VertexData.ComputeNormals(positions, indices, normals);

  const vertexData = new VertexData();
  vertexData.positions = positions;
  vertexData.indices = indices;
  vertexData.normals = normals;
  vertexData.applyToMesh(mesh, true);
  mesh.alwaysSelectAsActiveMesh = true;
  mesh.doNotSyncBoundingInfo = true;

  return { mesh, positions };
}

function resetWindWisp(wisp: WindWisp) {
  wisp.segment = yardSegments[Math.floor(Math.random() * yardSegments.length)];
  wisp.age = -(Math.random() * 3);
  wisp.duration = 9 + (Math.random() * 5);
  wisp.length = 4 + (Math.random() * 2.5);
  wisp.x = wisp.segment.xMin + (Math.random() * Math.max(1, (wisp.segment.xMax - wisp.segment.xMin - wisp.length - 1)));
  wisp.z = wisp.segment.zMin + (Math.random() * (wisp.segment.zMax - wisp.segment.zMin));
  wisp.y = 0.75 + (Math.random() * 0.8);
  wisp.bend = (Math.random() < 0.5 ? -1 : 1) * (0.45 + (Math.random() * 0.28));
  wisp.hook = -wisp.bend * (0.95 + (Math.random() * 0.45));
}

function updateWindWispShape(wisp: WindWisp) {
  const segments = 80;
  const t = Math.min(1, Math.max(0, wisp.age / wisp.duration));
  const appear = Math.min(1, t / 0.48);
  const fadeOut = Math.min(1, (1 - t) / 0.42);
  const visibility = appear * fadeOut;
  const growEase = 1 - Math.pow(1 - Math.min(1, t / 0.62), 3);
  const growEnd = Math.max(0.04, growEase);
  const trimStart = t < 0.68 ? 0 : ((t - 0.68) / 0.32) * 0.92;
  const curveAmount = Math.min(1, t / 0.45);
  const hookAmount = Math.max(0, (t - 0.48) / 0.4);
  const baseWidth = 0.075 * visibility;

  for (let i = 0; i <= segments; i += 1) {
    const local = i / segments;
    const u = trimStart + ((growEnd - trimStart) * local);
    const localWidth = Math.sin(Math.PI * local) * baseWidth;
    const x = u * wisp.length;
    const firstCurve = Math.sin(Math.PI * Math.min(1, u * 0.92)) * wisp.bend * curveAmount;
    const hookT = Math.max(0, (u - 0.58) / 0.42);
    const hook = Math.sin(Math.PI * hookT * 0.9) * wisp.hook * hookAmount;
    const tangentZ = (Math.cos(Math.PI * Math.min(1, u * 0.92)) * Math.PI * 0.92 * wisp.bend * curveAmount)
      + (hookT > 0 ? Math.cos(Math.PI * hookT * 0.9) * Math.PI * 0.9 * wisp.hook * hookAmount / 0.42 : 0);
    const tangent = new Vector3(1, 0, tangentZ).normalize();
    const centerX = wisp.x + x;
    const centerY = wisp.y + (Math.sin(Math.PI * u) * 0.04 * curveAmount);
    const centerZ = wisp.z + firstCurve + hook;
    const lift = Math.sin(Math.PI * u) * 0.04 * curveAmount;
    const cameraDirection = camera.position.subtract(new Vector3(centerX, centerY, centerZ)).normalize();
    const widthDirection = Vector3.Cross(tangent, cameraDirection).normalize();
    const offset = i * 6;

    wisp.positions[offset] = centerX + (widthDirection.x * localWidth);
    wisp.positions[offset + 1] = centerY + lift + (widthDirection.y * localWidth);
    wisp.positions[offset + 2] = centerZ + (widthDirection.z * localWidth);
    wisp.positions[offset + 3] = centerX - (widthDirection.x * localWidth);
    wisp.positions[offset + 4] = centerY + lift - (widthDirection.y * localWidth);
    wisp.positions[offset + 5] = centerZ - (widthDirection.z * localWidth);
  }

  wisp.mesh.updateVerticesData(VertexBuffer.PositionKind, wisp.positions, true, false);
  wisp.material.alpha = visibility * 0.34;
}

function createWindWisps() {
  for (let i = 0; i < 4; i += 1) {
    const material = new StandardMaterial(`windWispMaterial-${i}`, scene);
    material.diffuseColor = new Color3(1, 1, 1);
    material.emissiveColor = new Color3(0.9, 1, 0.92);
    material.alpha = 0.4;
    material.backFaceCulling = false;
    material.disableLighting = true;

    const { mesh, positions } = createWindWispMesh(`windWisp-${i}`);
    mesh.material = material;
    mesh.isPickable = false;

    const wisp: WindWisp = {
      mesh,
      material,
      segment: yardSegments[0],
      positions,
      age: 0,
      duration: 5,
      length: 1,
      x: 0,
      z: 0,
      y: 1,
      bend: 0,
      hook: 0,
    };

    resetWindWisp(wisp);
    wisp.age = i === 0 ? wisp.duration * 0.12 : -(2 + (i * 2.7) + (Math.random() * 1.3));
    updateWindWispShape(wisp);
    windWisps.push(wisp);
  }
}

function updateWindWisps(deltaSeconds: number) {
  for (const wisp of windWisps) {
    wisp.age += deltaSeconds;

    if (wisp.age < 0) {
      wisp.material.alpha = 0;
      continue;
    }

    if (wisp.age > wisp.duration) {
      resetWindWisp(wisp);
    }

    wisp.mesh.position.set(0, 0, 0);
    wisp.mesh.rotation.set(0, 0, 0);
    wisp.mesh.scaling.set(1, 1, 1);
    updateWindWispShape(wisp);
  }
}

function resetWindMote(mote: WindMote) {
  mote.segment = { ...yardSegments[0], xMin: -34, xMax: 39, zMin: -24, zMax: 30, width: 73, height: 54, center: Vector3.Zero() };
  mote.age = -(Math.random() * 18);
  mote.duration = 48 + (Math.random() * 18);
  mote.x = -34 + (Math.random() * 3);
  mote.z = -24 + (Math.random() * 54);
  mote.y = 0.45 + (Math.random() * 1.2);
  mote.speed = 1.25 + (Math.random() * 0.35);
  mote.drift = (Math.random() - 0.5) * 0.5;
  mote.size = 0.018 + (Math.random() * 0.035);
}

function createWindMotes() {
  for (let i = 0; i < 1; i += 1) {
    const mote = createWindMote(Math.random() < 0.18 ? new Color3(1, 0.92, 0.34) : undefined);
    resetWindMote(mote);
    windMotes.push(mote);
  }
}

function createWindMote(color?: Color3) {
  const material = new StandardMaterial(`windMoteMaterial-${windMotes.length}`, scene);
  material.diffuseColor = color ?? new Color3(0.95, 1, 0.9);
  material.emissiveColor = material.diffuseColor;
  material.alpha = 0;
  material.disableLighting = true;

  const mesh = MeshBuilder.CreatePlane(`windMote-${windMotes.length}`, { size: 1 }, scene);
  mesh.material = material;
  mesh.billboardMode = Mesh.BILLBOARDMODE_ALL;
  mesh.isPickable = false;

  return {
    mesh,
    material,
    segment: yardSegments[0],
    age: 0,
    duration: 6,
    x: 0,
    y: 0,
    z: 0,
    speed: 1,
    drift: 0,
    size: 0.02,
  };
}

function burstDandelionSeeds(x: number, z: number, y: number) {
  for (let i = 0; i < 32; i += 1) {
    const mote = createWindMote();
    mote.segment = yardSegments.find((segment) => (
      x >= segment.xMin
      && x <= segment.xMax
      && z >= segment.zMin
      && z <= segment.zMax
    )) ?? yardSegments[0];
    mote.age = Math.random() * 0.3;
    mote.duration = 4 + (Math.random() * 3.5);
    mote.x = x + ((Math.random() - 0.5) * 0.25);
    mote.y = y + ((Math.random() - 0.5) * 0.18);
    mote.z = z + ((Math.random() - 0.5) * 0.25);
    mote.speed = 0.7 + (Math.random() * 1.1);
    mote.drift = (Math.random() - 0.5) * 0.9;
    mote.size = 0.018 + (Math.random() * 0.025);
    windMotes.push(mote);
  }
}

function releaseDandelionSeeds(dandelion: Dandelion, requestedCount = dandelion.pieces.length, hitPop = false) {
  if (dandelion.popped || dandelion.kind !== "seed") {
    return;
  }

  let released = 0;

  for (const piece of dandelion.pieces) {
    if (released >= requestedCount) {
      break;
    }

    if (piece.name === "seed-core") {
      continue;
    }

    if (!piece.isEnabled() || piece.parent === null) {
      continue;
    }

    const worldPosition = piece.getAbsolutePosition().clone();
    piece.parent = null;
    piece.position.copyFrom(worldPosition);
    piece.billboardMode = Mesh.BILLBOARDMODE_ALL;
    piece.material = piece.material?.clone(`${piece.name}-floating-material`) ?? null;
    dandelion.detachedPieces.push(piece);
    floatingSeeds.push({
      mesh: piece,
      age: 0,
      duration: 4 + (Math.random() * 3),
      velocity: new Vector3(
        0.45 + (Math.random() * 0.8),
        (hitPop ? 0.28 : 0.04) + (Math.random() * (hitPop ? 0.34 : 0.16)),
        (Math.random() - 0.5) * 0.42,
      ),
      drift: (Math.random() - 0.5) * 0.9,
    });
    released += 1;
  }

  const remaining = dandelion.pieces.some((piece) => piece.name !== "seed-core" && piece.isEnabled() && piece.parent !== null);
  dandelion.popped = !remaining;

  if (dandelion.popped) {
    dandelion.head.setEnabled(false);
  }
}

function releaseYellowPetals(dandelion: Dandelion) {
  if (dandelion.popped || dandelion.kind !== "yellow") {
    return;
  }

  dandelion.popped = true;

  for (const piece of dandelion.pieces) {
    const worldPosition = piece.getAbsolutePosition().clone();
    piece.parent = null;
    piece.position.copyFrom(worldPosition);
    piece.billboardMode = Mesh.BILLBOARDMODE_ALL;
    piece.material = piece.material?.clone(`${piece.name}-falling-material`) ?? null;
    dandelion.detachedPieces.push(piece);

    const angle = Math.random() * Math.PI * 2;
    const burst = 0.45 + (Math.random() * 0.65);
    fallingPetals.push({
      mesh: piece,
      age: 0,
      duration: 1.2 + (Math.random() * 0.9),
      velocity: new Vector3(
        Math.cos(angle) * burst + 0.2,
        0.55 + (Math.random() * 0.5),
        Math.sin(angle) * burst,
      ),
    });
  }
}

function burstMowerClippings(includeYellow = false) {
  const forwardX = Math.sin(playerYaw);
  const forwardZ = Math.cos(playerYaw);
  const sideSign = Math.random() < 0.5 ? -1 : 1;
  const sideX = Math.cos(playerYaw) * sideSign;
  const sideZ = -Math.sin(playerYaw) * sideSign;
  const originX = player.position.x - (forwardX * 0.35) + (sideX * 0.52);
  const originZ = player.position.z - (forwardZ * 0.35) + (sideZ * 0.52);
  const count = includeYellow ? 5 : 1;

  for (let i = 0; i < count; i += 1) {
    const color = includeYellow && i < 5
      ? new Color3(1, 0.94, 0.02)
      : new Color3(0.42 + (Math.random() * 0.2), 0.74 + (Math.random() * 0.18), 0.12);
    const mote = createWindMote(color);
    mote.segment = yardSegments.find((segment) => (
      player.position.x >= segment.xMin
      && player.position.x <= segment.xMax
      && player.position.z >= segment.zMin
      && player.position.z <= segment.zMax
    )) ?? yardSegments[0];
    mote.age = Math.random() * 0.15;
    mote.duration = 1.3 + (Math.random() * 1.5);
    mote.x = originX + ((Math.random() - 0.5) * 0.38);
    mote.y = 0.18 + (Math.random() * 0.32);
    mote.z = originZ + ((Math.random() - 0.5) * 0.38);
    mote.speed = 0.25 + (Math.random() * 0.45);
    mote.drift = (sideSign * 0.75) + ((Math.random() - 0.5) * 0.35);
    mote.size = 0.014 + (Math.random() * 0.03);
    windMotes.push(mote);
  }
}

function updateWindMotes(deltaSeconds: number) {
  for (const mote of windMotes) {
    mote.age += deltaSeconds;

    const currentX = mote.x + (Math.max(0, mote.age) * mote.speed);
    if (mote.age > mote.duration || currentX > 42) {
      resetWindMote(mote);
    }

    if (mote.age < 0) {
      mote.material.alpha = 0;
      continue;
    }

    const t = mote.age / mote.duration;
    const fade = Math.sin(Math.PI * t);
    const x = mote.x + (mote.age * mote.speed);
    const y = mote.y + (Math.sin((t * Math.PI * 2) + mote.drift) * 0.08);
    const z = mote.z + (Math.sin(t * Math.PI) * mote.drift);

    mote.mesh.position.set(x, y, z);
    mote.mesh.scaling.set(mote.size, mote.size, mote.size);
    mote.material.alpha = fade * 0.28;
  }
}

function updateDandelions(deltaSeconds: number) {
  for (const dandelion of dandelions) {
    if (dandelion.headFalling) {
      dandelion.headVelocity.y -= 2.6 * deltaSeconds;
      dandelion.head.position.addInPlace(dandelion.headVelocity.scale(deltaSeconds));
      dandelion.head.rotation.x += deltaSeconds * 2.1;
      dandelion.head.rotation.z += deltaSeconds * 1.4;

      if (dandelion.head.position.y <= 0.08) {
        dandelion.head.position.y = 0.08;
        dandelion.headVelocity.set(0, 0, 0);
        dandelion.headFalling = false;
        dandelion.headSettled = true;
      }
    }

    if (dandelion.cut || dandelion.kind !== "seed") {
      continue;
    }

    if (Math.random() < settings.seedPopRate * deltaSeconds) {
      releaseDandelionSeeds(dandelion, 1 + Math.floor(Math.random() * 5), false);
    }
  }
}

function updateFloatingSeeds(deltaSeconds: number) {
  for (let i = floatingSeeds.length - 1; i >= 0; i -= 1) {
    const seed = floatingSeeds[i];
    seed.age += deltaSeconds;

    const t = seed.age / seed.duration;
    seed.mesh.position.addInPlace(seed.velocity.scale(deltaSeconds));
    seed.mesh.position.z += Math.sin(t * Math.PI * 2) * seed.drift * deltaSeconds * 0.18;
    seed.mesh.scaling.scaleInPlace(1 - (deltaSeconds * 0.08));

    const material = seed.mesh.material;
    if (material instanceof StandardMaterial) {
      material.alpha = Math.max(0, (1 - t) * 0.8);
    }

    if (t >= 1) {
      seed.mesh.dispose();
      floatingSeeds.splice(i, 1);
    }
  }
}

function updateFallingPetals(deltaSeconds: number) {
  for (let i = fallingPetals.length - 1; i >= 0; i -= 1) {
    const petal = fallingPetals[i];
    petal.age += deltaSeconds;
    petal.velocity.y -= 1.8 * deltaSeconds;
    petal.velocity.x += 0.08 * deltaSeconds;
    petal.mesh.position.addInPlace(petal.velocity.scale(deltaSeconds));
    petal.mesh.rotation.y += deltaSeconds * 2.5;
    petal.mesh.rotation.z += deltaSeconds * 1.7;

    const t = petal.age / petal.duration;
    const nearGround = Math.max(0, Math.min(1, petal.mesh.position.y / 0.35));
    const material = petal.mesh.material;
    if (material instanceof StandardMaterial) {
      material.alpha = Math.max(0, (1 - t) * nearGround);
    }

    if (t >= 1 || petal.mesh.position.y <= 0.02) {
      petal.mesh.dispose();
      fallingPetals.splice(i, 1);
    }
  }
}

function refreshGrassColors() {
  if (!longGrassColors || !cutGrassColors) {
    return;
  }

  for (let i = 0; i < bladeCount; i += 1) {
    writeColor(longGrassColors, i, colorForBlade(i, false));
    writeColor(cutGrassColors, i, colorForBlade(i, true));
  }

  longGrass.thinInstanceBufferUpdated("color");
  cutGrass.thinInstanceBufferUpdated("color");
}

function refreshGroundColor() {
  groundMaterial.albedoColor = hexToColor3(settings.groundColor);
  groundMaterial.albedoTexture?.dispose();
  groundMaterial.albedoTexture = createGroundTexture(scene);
}

function setupSettings() {
  const numberControls = [
    "minHeight",
    "maxHeight",
    "clumpStrength",
    "heightRandomness",
    "windStrength",
    "bendStrength",
    "turnMaxSpeed",
    "turnBuild",
    "seedPopRate",
    "mowerVolume",
    "breezeVolume",
    "breezeFacingAmount",
    "hueVariance",
    "satVariance",
    "lightVariance",
  ] as const;
  const colorControls = [
    "grassBaseColor",
    "cutGrassColor",
    "groundColor",
  ] as const;
  let regenerateTimer = 0;

  const scheduleRegenerate = () => {
    window.clearTimeout(regenerateTimer);
    regenerateTimer = window.setTimeout(() => {
      resetGame();
    }, 140);
  };

  for (const id of numberControls) {
    const input = settingsEl.querySelector<HTMLInputElement>(`#${id}`);
    const valueEl = settingsEl.querySelector<HTMLSpanElement>(`[data-value-for="${id}"]`);

    if (valueEl && input) {
      valueEl.textContent = input.value;
    }

    input?.addEventListener("input", () => {
      settings[id] = Number(input.value);
      if (valueEl) {
        valueEl.textContent = input.value;
      }

      if (["minHeight", "maxHeight", "clumpStrength", "heightRandomness"].includes(id)) {
        if (settings.minHeight > settings.maxHeight) {
          settings.maxHeight = settings.minHeight;
        }

        scheduleRegenerate();
      } else if (["hueVariance", "satVariance", "lightVariance"].includes(id)) {
        refreshGrassColors();
      }
    });
  }

  for (const id of colorControls) {
    const input = settingsEl.querySelector<HTMLInputElement>(`#${id}`);

    input?.addEventListener("input", () => {
      settings[id] = input.value;

      if (id === "groundColor") {
        refreshGroundColor();
      } else {
        refreshGrassColors();
      }
    });
  }
}

const ambientLight = new HemisphericLight("ambientLight", new Vector3(0, 1, 0), scene);
ambientLight.intensity = 0.38;
ambientLight.diffuse = new Color3(0.78, 0.9, 1);
ambientLight.groundColor = new Color3(0.5, 0.78, 0.34);

const sun = new DirectionalLight("sun", new Vector3(-0.45, -1, 0.24), scene);
sun.position = new Vector3(10, 15, -7);
sun.intensity = 1.18;
sun.diffuse = new Color3(1, 0.94, 0.78);
sun.specular = new Color3(1, 0.96, 0.82);

const shadowGenerator = new ShadowGenerator(1024, sun);
shadowGenerator.useBlurExponentialShadowMap = true;
shadowGenerator.blurKernel = 24;

const camera = new ArcRotateCamera("camera", -Math.PI / 2, Math.PI / 3, 16, Vector3.Zero(), scene);
camera.detachControl();
camera.lowerRadiusLimit = 8;
camera.upperRadiusLimit = 24;

const worldGround = MeshBuilder.CreateGround("world-ground", { width: 100, height: 200 }, scene);
worldGround.position.y = -0.02;
worldGround.material = worldGroundMaterial;

for (const [index, segment] of yardSegments.entries()) {
  const ground = MeshBuilder.CreateGround(`ground-${index}`, { width: segment.width, height: segment.height }, scene);
  ground.position = segment.center;
  ground.material = groundMaterial;
  ground.receiveShadows = true;
}

createRoad(scene, roadMaterial, stripeMaterial);
createNeighborhoodLots(scene, groundMaterial);
createFence(scene, fenceMaterial);
createWindWisps();
createWindMotes();

longGrass = makeLongBladeMesh();
cutGrass = makeCutBladeMesh();
mediumGrass = makeLongBladeMesh("mediumGrass");
wheatGrass = makeWheatBladeMesh();
placeMediumGrass();
placeWheatGrass();

player = MeshBuilder.CreateBox("player", { size: 1 }, scene);
player.material = playerMaterial;
player.scaling = new Vector3(0.85, 0.28, 1.1);
shadowGenerator.addShadowCaster(player);

setupSettings();
refreshGroundColor();
resetGame();

fullscreenButtonEl.addEventListener("click", () => {
  if (document.fullscreenElement) {
    document.exitFullscreen().catch(() => {});
  } else {
    document.documentElement.requestFullscreen().catch(() => {});
  }

  fullscreenButtonEl.blur();
});

fullscreenButtonEl.addEventListener("keydown", (event) => {
  if (event.key === " " || event.key === "Spacebar") {
    event.preventDefault();
  }
});

document.addEventListener("fullscreenchange", () => {
  fullscreenButtonEl.textContent = document.fullscreenElement ? "Exit full screen" : "Full screen";
  engine.resize();
});

window.addEventListener("keydown", (event) => {
  const key = event.key.toLowerCase();

  if (["w", "a", "s", "d", " "].includes(key)) {
    event.preventDefault();
    keys.add(key);
  }

  if (key === "r") {
    resetGame();
  }

  if (key === "f") {
    fullscreenButtonEl.click();
  }
});

window.addEventListener("keyup", (event) => {
  keys.delete(event.key.toLowerCase());
});

window.addEventListener("resize", () => {
  engine.resize();
});

engine.runRenderLoop(() => {
  const deltaSeconds = engine.getDeltaTime() / 1000;
  const timeSeconds = performance.now() / 1000;

  clippingBurstCooldown = Math.max(0, clippingBurstCooldown - deltaSeconds);
  movePlayer(deltaSeconds);
  updateFollowCamera(camera, player.position, playerYaw, deltaSeconds);
  updateGrassMotion(timeSeconds);
  updateWindWisps(deltaSeconds);
  updateWindMotes(deltaSeconds);
  updateDandelions(deltaSeconds);
  updateFloatingSeeds(deltaSeconds);
  updateFallingPetals(deltaSeconds);
  mowTouchedGrass();
  prototypeAudio.update(camera, settings);
  scene.render();
});
