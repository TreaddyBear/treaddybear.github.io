import {
  ArcRotateCamera,
  Camera,
  Color3,
  DirectionalLight,
  DynamicTexture,
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
import { createInputController, InputMode } from "./input";
import {
  bladeCount,
  cellSize,
  applyActiveMap,
  getActiveMap,
  mediumGrassCount,
  mowerCutRadius,
  playerBoost,
  playerFenceRadius,
  playerSpeed,
  settings,
  wheatGrassCount,
  yardSegments,
} from "./config";
import type { YardSegment } from "./config";
import { createDirtGroundTexture, createDirtNormalTexture, createGrassyGroundTexture } from "./textures";
import { color3ToHsl, hexToColor3, hslToColor3, mixColor } from "./utils/color";
import { emptyMatrix, writeColor, writeMatrix } from "./utils/buffers";
import { grassNoiseAt, randomHash } from "./utils/noise";
import { gridKey, isInsideSegments, randomPointInSegments, randomRectPoint } from "./utils/yard";
import { createBiomeGroundMaterial, createFence, createMapGrounds, createRoad, createWorldTerrain, terrainHeightAt, updateBiomeGroundMaterialScale, updateFollowCamera } from "./world";

const canvasElement = document.querySelector<HTMLCanvasElement>("#renderCanvas");
const scoreElement = document.querySelector<HTMLDivElement>("#score");
const meterFillElement = document.querySelector<HTMLDivElement>("#meterFill");
const mistakesElement = document.querySelector<HTMLDivElement>("#mistakes");
const mistakeMeterFillElement = document.querySelector<HTMLDivElement>("#mistakeMeterFill");
const quickInputModeElement = document.querySelector<HTMLDivElement>("#quickInputMode");
const settingsElement = document.querySelector<HTMLDetailsElement>("#settings");
const fullscreenButtonElement = document.querySelector<HTMLButtonElement>("#fullscreenButton");
const celebrationElement = document.querySelector<HTMLDivElement>("#celebration");
const celebrationSeedsElement = document.querySelector<HTMLDivElement>("#celebrationSeeds");
const nextLevelButtonElement = document.querySelector<HTMLButtonElement>("#nextLevelButton");
const closeCelebrationButtonElement = document.querySelector<HTMLButtonElement>("#closeCelebrationButton");
const touchPadElement = document.querySelector<HTMLDivElement>("#touchPad");
const touchKnobElement = document.querySelector<HTMLDivElement>("#touchKnob");

if (
  !canvasElement
  || !scoreElement
  || !meterFillElement
  || !mistakesElement
  || !mistakeMeterFillElement
  || !quickInputModeElement
  || !settingsElement
  || !fullscreenButtonElement
  || !celebrationElement
  || !celebrationSeedsElement
  || !nextLevelButtonElement
  || !closeCelebrationButtonElement
  || !touchPadElement
  || !touchKnobElement
) {
  throw new Error("Missing canvas, HUD, or settings element.");
}

const canvas = canvasElement;
const scoreEl = scoreElement;
const meterFillEl = meterFillElement;
const mistakesEl = mistakesElement;
const mistakeMeterFillEl = mistakeMeterFillElement;
const quickInputModeEl = quickInputModeElement;
const settingsEl = settingsElement;
const fullscreenButtonEl = fullscreenButtonElement;
const celebrationEl = celebrationElement;
const celebrationSeedsEl = celebrationSeedsElement;
const nextLevelButtonEl = nextLevelButtonElement;
const closeCelebrationButtonEl = closeCelebrationButtonElement;
const analogInput = createInputController(touchPadElement, touchKnobElement);

const engine = new Engine(canvas, true);
const scene = new Scene(engine);
const prototypeAudio = createPrototypeAudio();
const perfEl = document.querySelector<HTMLDivElement>("#perf");
let celebrationShown = false;
let celebrationHideTimer = 0;

if (!import.meta.env.PROD) {
  settingsEl.hidden = false;
  (window as unknown as { __scene: Scene }).__scene = scene;

  if (perfEl) {
    perfEl.hidden = false;
  }
}

const keys = new Set<string>();
const grassGrid = new Map<string, number[]>();
let player: Mesh;
let mapGroundRoot: TransformNode | null = null;
let fenceRoot: TransformNode | null = null;
let secretGunRoot: TransformNode | null = null;
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
let mistakeCount = 0;
let playerYaw = 0;
let turnHoldSeconds = 0;
let lastTurnDirection = 0;
let currentThrottle = 0;
let driveSpeed = 0;
let clippingBurstCooldown = 0;
let bumpCooldown = 0;
let grassCuttingAudioTimer = 0;
let mouseTurn = 0;
let mouseSteeringActive = false;
let mouseSteeringPointer = false;
let cameraOrbitYaw = 0;
let cameraOrbitHeight = 0;
let cameraDistanceOffset = 0;
let cameraAdjustmentCount = 0;
let cameraAdjustmentCooldown = 0;
let cameraReturnDelay = 0;
let cameraReturning = false;
let hasSecretGun = false;
let shootCooldown = 0;
let lastControllerShoot = false;
let lastCelebrationAdvance = false;
let lastCelebrationDismiss = false;
// The concrete device currently pushed into analogInput. Starts as "auto" (a
// value effectiveInputMode never returns) so the first resolve always applies.
let lastAppliedInputMode: InputMode = "auto";
// Seconds (performance.now based) of the last blade cut, and whether the
// "find the last strands" highlight is currently pulsing.
let lastMowSeconds = 0;
let remainingHighlightActive = false;
const loadingEl = document.querySelector<HTMLDivElement>("#loading");
// Adaptive-resolution state: seconds since last FPS sample and the current
// engine hardware-scaling level (1 = native; higher = render at lower res).
let perfSampleTime = 0;
let currentHardwareScale = 1;
const cameraDrag = {
  active: false,
  pointerId: -1,
  lastX: 0,
  lastY: 0,
};
const windWisps: WindWisp[] = [];
const windMotes: WindMote[] = [];
const dandelions: Dandelion[] = [];
const floatingSeeds: FloatingSeed[] = [];
const fallingPetals: FallingPetal[] = [];
const tulips: Tulip[] = [];
const gunTracers: GunTracer[] = [];
const gunParticles: GunParticle[] = [];
let fenceDamage: FenceDamageState[] = [];
const fenceHealthLabels: FenceHealthLabel[] = [];
const rockColliders: RockCollider[] = [];

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
  settled: boolean;
};
type Tulip = {
  root: TransformNode;
  head: Mesh;
  stem: Mesh;
  x: number;
  z: number;
  destroyed: boolean;
};
type FenceDamageState = {
  segmentIndex: number;
  pieceIndex: number;
  x: number;
  z: number;
  axisX: number;
  axisZ: number;
  halfAlong: number;
  halfAcross: number;
  health: number;
  broken: boolean;
};
type FenceHealthLabel = {
  mesh: Mesh;
  material: StandardMaterial;
  texture: DynamicTexture;
};
type RockCollider = {
  x: number;
  z: number;
  radius: number;
};
type GunTracer = {
  mesh: Mesh;
  material: StandardMaterial;
  age: number;
  duration: number;
};
type GunParticle = {
  mesh: Mesh;
  material: StandardMaterial;
  velocity: Vector3;
  age: number;
  duration: number;
  spin: number;
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
bladeMaterial.clearCoat.isEnabled = true;
const cutBladeMaterial = makeMaterial("cutBladeMaterial", Color3.White(), 0.58);
cutBladeMaterial.backFaceCulling = false;
cutBladeMaterial.clearCoat.isEnabled = true;

function refreshGrassMaterial() {
  bladeMaterial.roughness = settings.grassRoughness;
  bladeMaterial.metallic = settings.grassMetallic;
  bladeMaterial.specularIntensity = 0.18;
  bladeMaterial.clearCoat.intensity = settings.grassClearCoat;
  bladeMaterial.clearCoat.roughness = Math.max(0.018, settings.grassRoughness * 0.12);

  cutBladeMaterial.roughness = settings.cutGrassRoughness;
  cutBladeMaterial.metallic = settings.cutGrassMetallic;
  cutBladeMaterial.specularIntensity = 0.11;
  cutBladeMaterial.clearCoat.intensity = settings.cutGrassClearCoat;
  cutBladeMaterial.clearCoat.roughness = Math.max(0.035, settings.cutGrassRoughness * 0.14);
}

refreshGrassMaterial();

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

const tulipStemMaterial = new StandardMaterial("tulipStemMaterial", scene);
tulipStemMaterial.diffuseColor = new Color3(0.12, 0.42, 0.08);
tulipStemMaterial.specularColor = Color3.Black();

const tulipHeadMaterials = [
  new Color3(0.95, 0.08, 0.12),
  new Color3(1, 0.58, 0.12),
  new Color3(0.95, 0.18, 0.62),
  new Color3(0.78, 0.12, 0.92),
].map((color, index) => {
  const material = new StandardMaterial(`tulipHeadMaterial-${index}`, scene);
  material.diffuseColor = color;
  material.emissiveColor = color.scale(0.08);
  material.specularColor = new Color3(0.12, 0.08, 0.04);
  return material;
});

const roadMaterial = new StandardMaterial("roadMaterial", scene);
roadMaterial.diffuseColor = new Color3(0.34, 0.34, 0.33);
roadMaterial.specularColor = Color3.Black();

const stripeMaterial = new StandardMaterial("stripeMaterial", scene);
stripeMaterial.diffuseColor = new Color3(0.93, 0.67, 0.16);
stripeMaterial.emissiveColor = new Color3(0.04, 0.025, 0);
stripeMaterial.specularColor = Color3.Black();

const fenceMaterial = new StandardMaterial("fenceMaterial", scene);
fenceMaterial.diffuseColor = new Color3(0.92, 0.9, 0.84);
fenceMaterial.specularColor = Color3.Black();

const worldGroundMaterial = new StandardMaterial("worldGroundMaterial", scene);
worldGroundMaterial.diffuseColor = Color3.White();
worldGroundMaterial.specularColor = Color3.Black();
worldGroundMaterial.diffuseTexture = createDirtGroundTexture(scene);
worldGroundMaterial.bumpTexture = createDirtNormalTexture(scene);

const secretGunMaterial = new StandardMaterial("secretGunMaterial", scene);
secretGunMaterial.diffuseColor = new Color3(0.035, 0.038, 0.04);
secretGunMaterial.specularColor = new Color3(0.08, 0.08, 0.075);

const secretGunGripMaterial = new StandardMaterial("secretGunGripMaterial", scene);
secretGunGripMaterial.diffuseColor = new Color3(0.11, 0.075, 0.045);
secretGunGripMaterial.specularColor = Color3.Black();

const treeTrunkMaterial = new StandardMaterial("treeTrunkMaterial", scene);
treeTrunkMaterial.diffuseColor = new Color3(0.23, 0.13, 0.055);
treeTrunkMaterial.specularColor = Color3.Black();

const treeLeafMaterials = [
  new Color3(0.08, 0.24, 0.055),
  new Color3(0.12, 0.33, 0.08),
  new Color3(0.18, 0.3, 0.08),
].map((color, index) => {
  const material = new StandardMaterial(`treeLeafMaterial-${index}`, scene);
  material.diffuseColor = color;
  material.specularColor = Color3.Black();
  return material;
});

const rockMaterials = [
  new Color3(0.28, 0.28, 0.25),
  new Color3(0.43, 0.4, 0.34),
  new Color3(0.18, 0.3, 0.12),
].map((color, index) => {
  const material = new StandardMaterial(`rockMaterial-${index}`, scene);
  material.diffuseColor = color;
  material.specularColor = new Color3(0.03, 0.035, 0.03);
  return material;
});

function makeLongBladeMesh(name = "longGrass") {
  const mesh = new Mesh(name, scene);
  const positions = [
    -0.055, 0, 0,
    0.055, 0, 0,
    -0.035, 0.5, 0.025,
    0.035, 0.5, 0.025,
    -0.038, 0.5, 0.035,
    0.038, 0.5, 0.035,
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
  const normals = [
    0, 0.62, -0.78,
    0, 0.62, -0.78,
    0, 0.7, -0.71,
    0, 0.7, -0.71,
    0, 0.78, -0.63,
    0, 0.78, -0.63,
    0, 0.86, -0.5,
    0, 0.58, -0.82,
    0, 0.72, -0.69,
    0, 0.86, -0.5,
  ];

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
  vertexData.colors = cutBladeVertexColors();
  vertexData.applyToMesh(mesh);
  mesh.material = cutBladeMaterial;
  return mesh;
}

function cutBladeVertexColors() {
  const root = hexToColor3(settings.cutGrassRootColor);
  const topA = hexToColor3(settings.cutGrassTopColorA);
  const topB = hexToColor3(settings.cutGrassTopColorB);

  return [
    root.r, root.g, root.b, 1,
    root.r, root.g, root.b, 1,
    topA.r, topA.g, topA.b, 1,
    topB.r, topB.g, topB.b, 1,
  ];
}

function refreshCutBladeVertexColors() {
  cutGrass.setVerticesData(VertexBuffer.ColorKind, cutBladeVertexColors(), true);
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

function createHiddenGunProp() {
  const root = new TransformNode("hidden-gun-cache", scene);
  const x = -33.5;
  const z = -21.5;
  root.position = new Vector3(x, terrainHeightAt(x, z) - 0.03, z);
  root.rotation.y = -0.78;

  const divot = MeshBuilder.CreateCylinder("secret-gun-divot", { diameter: 0.9, height: 0.018, tessellation: 16 }, scene);
  divot.parent = root;
  divot.position.y = -0.012;
  divot.scaling = new Vector3(1.1, 1, 0.64);
  divot.material = worldGroundMaterial;

  const barrel = MeshBuilder.CreateCylinder("secret-gun-barrel", { height: 0.86, diameter: 0.08, tessellation: 8 }, scene);
  barrel.parent = root;
  barrel.position = new Vector3(0.06, 0.055, 0);
  barrel.rotation.z = Math.PI / 2;
  barrel.material = secretGunMaterial;

  const body = MeshBuilder.CreateBox("secret-gun-body", { width: 0.46, height: 0.16, depth: 0.22 }, scene);
  body.parent = root;
  body.position = new Vector3(-0.28, 0.055, 0);
  body.material = secretGunMaterial;

  const grip = MeshBuilder.CreateBox("secret-gun-grip", { width: 0.13, height: 0.36, depth: 0.15 }, scene);
  grip.parent = root;
  grip.position = new Vector3(-0.42, -0.11, 0.02);
  grip.rotation.z = -0.38;
  grip.material = secretGunGripMaterial;

  const sight = MeshBuilder.CreateBox("secret-gun-sight", { width: 0.14, height: 0.045, depth: 0.07 }, scene);
  sight.parent = root;
  sight.position = new Vector3(-0.18, 0.165, 0);
  sight.material = secretGunMaterial;

  return root;
}

function createTree(x: number, z: number, scale: number, leafMaterial: StandardMaterial) {
  const root = new TransformNode("simple-tree", scene);
  const groundY = terrainHeightAt(x, z) - 0.06;
  root.position = new Vector3(x, groundY, z);
  root.rotation.y = Math.random() * Math.PI * 2;

  const trunkHeight = 1.4 * scale;
  const trunk = MeshBuilder.CreateCylinder("tree-trunk", {
    height: trunkHeight,
    diameterTop: 0.24 * scale,
    diameterBottom: 0.36 * scale,
    tessellation: 7,
  }, scene);
  trunk.parent = root;
  trunk.position.y = trunkHeight / 2;
  trunk.rotation.x = (Math.random() - 0.5) * 0.08;
  trunk.rotation.z = (Math.random() - 0.5) * 0.08;
  trunk.material = treeTrunkMaterial;
  shadowGenerator.addShadowCaster(trunk);

  const lowerLeaves = MeshBuilder.CreateSphere("tree-leaves-lower", { diameter: 1.45 * scale, segments: 7 }, scene);
  lowerLeaves.parent = root;
  lowerLeaves.position = new Vector3(0.05 * scale, trunkHeight + (0.32 * scale), 0);
  lowerLeaves.scaling = new Vector3(1.08, 0.86, 1);
  lowerLeaves.material = leafMaterial;
  shadowGenerator.addShadowCaster(lowerLeaves);

  const crown = MeshBuilder.CreateSphere("tree-leaves-crown", { diameter: 1.08 * scale, segments: 7 }, scene);
  crown.parent = root;
  crown.position = new Vector3(-0.12 * scale, trunkHeight + (0.88 * scale), 0.06 * scale);
  crown.scaling = new Vector3(0.92, 1.1, 0.95);
  crown.material = leafMaterial;
  shadowGenerator.addShadowCaster(crown);

  return root;
}

function createSimpleTrees() {
  const trees = [
    { x: -52, z: -36, scale: 1.35, material: treeLeafMaterials[0] },
    { x: -43, z: 42, scale: 0.9, material: treeLeafMaterials[1] },
    { x: 34, z: -48, scale: 1.15, material: treeLeafMaterials[2] },
    { x: 58, z: 31, scale: 1.65, material: treeLeafMaterials[0] },
    { x: -22, z: 64, scale: 0.72, material: treeLeafMaterials[1] },
  ];

  for (const tree of trees) {
    createTree(tree.x, tree.z, tree.scale, tree.material);
  }
}

function createBoulder(x: number, z: number, scale: number, material: StandardMaterial) {
  const rock = MeshBuilder.CreateSphere("boulder", { diameter: 1, segments: 7 }, scene);
  const horizontalScaleX = scale * (1.1 + (Math.random() * 0.35));
  const horizontalScaleZ = scale * (0.8 + (Math.random() * 0.4));
  rock.position = new Vector3(x, terrainHeightAt(x, z) + (0.18 * scale), z);
  rock.scaling = new Vector3(horizontalScaleX, scale * (0.42 + (Math.random() * 0.22)), horizontalScaleZ);
  rock.rotation = new Vector3(Math.random() * 0.22, Math.random() * Math.PI, Math.random() * 0.28);
  rock.material = material;
  shadowGenerator.addShadowCaster(rock);
  rockColliders.push({ x, z, radius: Math.max(horizontalScaleX, horizontalScaleZ) * 0.56 });
  return rock;
}

function createSceneryRocks() {
  const rocks = [
    { x: -39, z: -25, scale: 1.3, material: rockMaterials[2] },
    { x: -47, z: -31, scale: 0.72, material: rockMaterials[0] },
    { x: 24, z: -28, scale: 0.9, material: rockMaterials[1] },
    { x: 39, z: 19, scale: 1.6, material: rockMaterials[0] },
    { x: -18, z: 42, scale: 0.8, material: rockMaterials[2] },
    { x: 55, z: -54, scale: 1.9, material: rockMaterials[1] },
    { x: -64, z: 18, scale: 1.2, material: rockMaterials[0] },
  ];

  for (const rock of rocks) {
    createBoulder(rock.x, rock.z, rock.scale, rock.material);
  }
}

function updateSecretGunPickup() {
  if (hasSecretGun || !secretGunRoot || !secretGunRoot.isEnabled()) {
    return;
  }

  const dx = player.position.x - secretGunRoot.position.x;
  const dz = player.position.z - secretGunRoot.position.z;

  if ((dx * dx) + (dz * dz) > 1.1 * 1.1) {
    return;
  }

  hasSecretGun = true;
  secretGunRoot.setEnabled(false);
  updateHud();
}

function updateHud() {
  const percentage = mowedCount === bladeCount ? 100 : Math.floor((mowedCount / bladeCount) * 100);
  scoreEl.textContent = `Mowed: ${percentage}%`;
  if (hasSecretGun) {
    scoreEl.textContent += " | Armed";
  }
  meterFillEl.style.width = `${(mowedCount / bladeCount) * 100}%`;
  mistakesEl.textContent = `Mistakes: ${mistakeCount}`;
  mistakeMeterFillEl.style.width = `${Math.min(100, mistakeCount * 12)}%`;

  if (percentage === 100 && !celebrationShown) {
    showCelebration();
  }
}

function showCelebration() {
  celebrationShown = true;
  window.clearTimeout(celebrationHideTimer);
  celebrationSeedsEl.replaceChildren();
  prototypeAudio.playCompletionFanfare(settings.completionFanfareVolume);
  prototypeAudio.setCompletionLoopActive(true, settings);

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
  nextLevelButtonEl.focus();
}

function resetCelebration() {
  window.clearTimeout(celebrationHideTimer);
  celebrationShown = false;
  celebrationEl.hidden = true;
  celebrationSeedsEl.replaceChildren();
  prototypeAudio.setCompletionLoopActive(false, settings);
}

function closeCelebration() {
  celebrationEl.hidden = true;
  prototypeAudio.setCompletionLoopActive(false, settings);
}

function goToNextLevel() {
  const nextMap = settings.mapId === "main" ? "flower-court" : "main";
  settings.mapId = nextMap;
  const mapControl = settingsEl.querySelector<HTMLSelectElement>("#mapId");

  if (mapControl) {
    mapControl.value = nextMap;
  }

  // Building the next lawn (30k blades + dirt mask) blocks for a beat, which on
  // mobile looked like a dead button. Show a spinner and let it paint before the
  // synchronous regen runs.
  if (loadingEl) {
    loadingEl.hidden = false;
    requestAnimationFrame(() => requestAnimationFrame(() => {
      resetGame();
      loadingEl.hidden = true;
    }));
    return;
  }

  resetGame();
}

function isInsideYard(x: number, z: number) {
  return isInsideSegments(yardSegments, x, z);
}

function randomYardPoint() {
  return randomPointInSegments(yardSegments);
}

function distanceToFlowerBed(x: number, z: number) {
  let closest = Number.POSITIVE_INFINITY;

  for (const bed of getActiveMap().flowerBeds) {
    const clampedX = Math.min(bed.xMax, Math.max(bed.xMin, x));
    const clampedZ = Math.min(bed.zMax, Math.max(bed.zMin, z));
    const dx = x - clampedX;
    const dz = z - clampedZ;
    const inside = x >= bed.xMin && x <= bed.xMax && z >= bed.zMin && z <= bed.zMax;
    const distance = inside ? -Math.min(x - bed.xMin, bed.xMax - x, z - bed.zMin, bed.zMax - z) : Math.sqrt((dx * dx) + (dz * dz));
    closest = Math.min(closest, distance);
  }

  return closest;
}

function shouldPlaceGrassNearFlowerBed(x: number, z: number) {
  const distance = distanceToFlowerBed(x, z);

  if (!Number.isFinite(distance)) {
    return true;
  }

  if (distance < -0.1) {
    return false;
  }

  if (distance < 0.34) {
    return Math.random() < 0.06;
  }

  if (distance < 0.62) {
    return Math.random() < 0.26;
  }

  return true;
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

function groundHeightAt(x: number, z: number) {
  if (isInsideYard(x, z)) {
    return 0;
  }

  if (isOnRoad(x)) {
    return 0.006;
  }

  return terrainHeightAt(x, z) - 0.08;
}

function snapPlayerToGround() {
  player.position.y = groundHeightAt(player.position.x, player.position.z);
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

function nearestFenceSegment(x: number, z: number) {
  let nearest = { index: -1, distance: Number.POSITIVE_INFINITY };

  for (const [index, segment] of getActiveMap().fenceSegments.entries()) {
    const distance = distanceToSegment(x, z, segment.start.x, segment.start.z, segment.end.x, segment.end.z);

    if (distance < nearest.distance) {
      nearest = { index, distance };
    }
  }

  return nearest;
}

function createFenceDamageStates() {
  const states: FenceDamageState[] = [];
  // Match the visible plank mesh exactly: width 0.34 runs along the fence,
  // depth 0.08 runs across it (see createFencePlanks in world.ts).
  const halfAlong = 0.34 / 2;
  const halfAcross = 0.08 / 2;

  for (const [segmentIndex, segment] of getActiveMap().fenceSegments.entries()) {
    const dx = segment.end.x - segment.start.x;
    const dz = segment.end.z - segment.start.z;
    const length = Math.sqrt((dx * dx) + (dz * dz));
    const steps = Math.floor(length / 0.55);
    const axisX = length > 0 ? dx / length : 1;
    const axisZ = length > 0 ? dz / length : 0;

    for (let pieceIndex = 0; pieceIndex <= steps; pieceIndex += 1) {
      const t = steps === 0 ? 0 : pieceIndex / steps;
      const x = segment.start.x + (dx * t);
      const z = segment.start.z + (dz * t);
      states.push({
        segmentIndex,
        pieceIndex,
        x,
        z,
        axisX,
        axisZ,
        halfAlong,
        halfAcross,
        health: settings.fenceMaxHealth,
        broken: false,
      });
    }
  }

  return states;
}

function nearestFencePiece(x: number, z: number) {
  let nearest = { index: -1, distance: Number.POSITIVE_INFINITY };

  for (let i = 0; i < fenceDamage.length; i += 1) {
    const piece = fenceDamage[i];

    if (!piece || piece.broken) {
      continue;
    }

    const dx = x - piece.x;
    const dz = z - piece.z;
    const distance = Math.sqrt((dx * dx) + (dz * dz));

    if (distance < nearest.distance) {
      nearest = { index: i, distance };
    }
  }

  return nearest;
}

function breakFencePiece(index: number) {
  const state = fenceDamage[index];
  const mesh = state ? scene.getMeshByName(`fence-${state.segmentIndex}-plank-${state.pieceIndex}`) : null;
  mesh?.setEnabled(false);
  updateFenceHealthLabel(index);
}

function disposeFenceHealthLabels() {
  while (fenceHealthLabels.length > 0) {
    const label = fenceHealthLabels.pop();
    label?.texture.dispose();
    label?.material.dispose();
    label?.mesh.dispose();
  }
}

function drawFenceHealthLabel(index: number) {
  const state = fenceDamage[index];
  const label = fenceHealthLabels[index];

  if (!state || !label) {
    return;
  }

  label.texture.clear();
  label.texture.drawText(
    state.broken ? "BROKEN" : `${Math.max(0, Math.ceil(state.health))}/${settings.fenceMaxHealth}`,
    null,
    40,
    "bold 26px Arial",
    state.broken ? "#ff8080" : "#ffffff",
    "rgba(0,0,0,0.58)",
    true,
  );
}

function updateFenceHealthLabel(index: number) {
  const state = fenceDamage[index];
  const label = fenceHealthLabels[index];

  if (!label || !state) {
    return;
  }

  label.mesh.setEnabled(settings.showFenceHealth && !state.broken);
  drawFenceHealthLabel(index);
}

function syncFenceHealthLabels() {
  disposeFenceHealthLabels();

  if (!settings.showFenceHealth) {
    return;
  }

  for (let index = 0; index < fenceDamage.length; index += 1) {
    const state = fenceDamage[index];
    const texture = new DynamicTexture(`fence-health-texture-${index}`, { width: 128, height: 64 }, scene, false);
    texture.hasAlpha = true;
    const material = new StandardMaterial(`fence-health-material-${index}`, scene);
    material.diffuseTexture = texture;
    material.emissiveColor = Color3.White();
    material.opacityTexture = texture;
    material.backFaceCulling = false;

    const mesh = MeshBuilder.CreatePlane(`fence-health-label-${index}`, { width: 0.86, height: 0.34 }, scene);
    mesh.position = new Vector3(state.x, 0.82, state.z);
    mesh.billboardMode = Mesh.BILLBOARDMODE_ALL;
    mesh.material = material;
    fenceHealthLabels[index] = { mesh, material, texture };
    updateFenceHealthLabel(index);
  }
}

function damageFencePiece(index: number, impactSpeed: number) {
  const state = fenceDamage[index];

  if (!state || state.broken) {
    return;
  }

  const speedRatio = Math.min(1, Math.abs(impactSpeed) / (playerSpeed * playerBoost));
  const damage = speedRatio > 0.85 ? 5 : speedRatio > 0.55 ? 3 : 1;
  state.health -= damage;

  if (state.health <= 0) {
    state.broken = true;
    breakFencePiece(index);
  }

  updateFenceHealthLabel(index);
}

function damageFenceAt(x: number, z: number, impactSpeed: number) {
  const nearest = nearestFencePiece(x, z);

  if (nearest.index < 0 || nearest.distance > 0.62) {
    return;
  }

  damageFencePiece(nearest.index, impactSpeed);
}

function shootFenceAlongRay(origin: Vector3, direction: Vector3, range: number) {
  let best = { index: -1, distanceToRay: Number.POSITIVE_INFINITY, forwardDistance: 0 };

  for (let index = 0; index < fenceDamage.length; index += 1) {
    const piece = fenceDamage[index];

    if (!piece || piece.broken) {
      continue;
    }

    const dx = piece.x - origin.x;
    const dz = piece.z - origin.z;
    const forwardDistance = (dx * direction.x) + (dz * direction.z);

    if (forwardDistance < 0 || forwardDistance > range) {
      continue;
    }

    const sideDistance = Math.abs((dx * direction.z) - (dz * direction.x));

    if (sideDistance < best.distanceToRay) {
      best = { index, distanceToRay: sideDistance, forwardDistance };
    }
  }

  if (best.index >= 0 && best.distanceToRay < 0.42) {
    const hit = origin.add(direction.scale(best.forwardDistance));
    damageFenceAt(hit.x, hit.z, playerSpeed * playerBoost);
    return best.forwardDistance;
  }

  return null;
}

function disposeGunTracer(tracer: GunTracer) {
  tracer.mesh.dispose();
  tracer.material.dispose();
}

function disposeGunParticle(particle: GunParticle) {
  particle.mesh.dispose();
  particle.material.dispose();
}

function createGunEffectMaterial(name: string, color: Color3, alpha: number) {
  const material = new StandardMaterial(name, scene);
  material.diffuseColor = color;
  material.emissiveColor = color.scale(0.22);
  material.specularColor = Color3.Black();
  material.alpha = alpha;
  return material;
}

function spawnGunTracer(origin: Vector3, direction: Vector3, length: number) {
  const safeLength = Math.max(0.1, length);
  const material = createGunEffectMaterial("gun-tracer-material", new Color3(1, 0.92, 0.58), 0.52);
  const mesh = MeshBuilder.CreateBox("gun-tracer", { width: 0.035, height: 0.028, depth: safeLength }, scene);

  mesh.position = origin.add(direction.scale(safeLength * 0.5));
  mesh.position.y = Math.max(mesh.position.y + 0.42, terrainHeightAt(mesh.position.x, mesh.position.z) + 0.38);
  mesh.rotation.y = Math.atan2(direction.x, direction.z);
  mesh.material = material;
  gunTracers.push({ mesh, material, age: 0, duration: 0.11 });
}

function pushGunParticle(particle: GunParticle) {
  gunParticles.push(particle);

  while (gunParticles.length > 180) {
    const oldParticle = gunParticles.shift();
    if (oldParticle) {
      disposeGunParticle(oldParticle);
    }
  }
}

function spawnGunParticle(
  name: string,
  x: number,
  z: number,
  color: Color3,
  velocity: Vector3,
  size: number,
  duration: number,
  alpha = 0.78,
) {
  const material = createGunEffectMaterial(`${name}-material`, color, alpha);
  const mesh = MeshBuilder.CreateSphere(name, { diameter: size, segments: 4 }, scene);

  mesh.position = new Vector3(x, terrainHeightAt(x, z) + 0.08 + (Math.random() * 0.06), z);
  mesh.material = material;
  pushGunParticle({
    mesh,
    material,
    velocity,
    age: 0,
    duration,
    spin: (Math.random() - 0.5) * 8,
  });
}

function spawnGunImpactDust(x: number, z: number, strength = 1) {
  const count = 5 + Math.floor(Math.random() * 5 * strength);

  for (let i = 0; i < count; i += 1) {
    const angle = Math.random() * Math.PI * 2;
    const speed = 0.25 + (Math.random() * 0.75 * strength);
    spawnGunParticle(
      "gun-impact-dust",
      x + ((Math.random() - 0.5) * 0.16),
      z + ((Math.random() - 0.5) * 0.16),
      new Color3(0.62 + (Math.random() * 0.12), 0.54 + (Math.random() * 0.1), 0.38 + (Math.random() * 0.08)),
      new Vector3(Math.cos(angle) * speed, 0.35 + (Math.random() * 0.55 * strength), Math.sin(angle) * speed),
      0.035 + (Math.random() * 0.055),
      0.38 + (Math.random() * 0.28),
      0.58,
    );
  }
}

function spawnGunGrassFleck(x: number, z: number, direction: Vector3) {
  const side = new Vector3(direction.z, 0, -direction.x);
  const sideAmount = (Math.random() - 0.5) * 1.1;
  const forwardAmount = 0.25 + (Math.random() * 0.45);
  const color = Math.random() > 0.35
    ? new Color3(0.24, 0.62 + (Math.random() * 0.14), 0.1)
    : new Color3(0.42, 0.5, 0.14);

  spawnGunParticle(
    "gun-grass-fleck",
    x,
    z,
    color,
    new Vector3(
      (direction.x * forwardAmount) + (side.x * sideAmount),
      0.45 + (Math.random() * 0.45),
      (direction.z * forwardAmount) + (side.z * sideAmount),
    ),
    0.025 + (Math.random() * 0.035),
    0.28 + (Math.random() * 0.22),
    0.72,
  );
}

function updateGunEffects(deltaSeconds: number) {
  for (let i = gunTracers.length - 1; i >= 0; i -= 1) {
    const tracer = gunTracers[i];
    tracer.age += deltaSeconds;
    const life = 1 - (tracer.age / tracer.duration);

    if (life <= 0) {
      gunTracers.splice(i, 1);
      disposeGunTracer(tracer);
      continue;
    }

    tracer.material.alpha = 0.52 * life;
    tracer.mesh.scaling.x = 0.65 + (life * 0.35);
    tracer.mesh.scaling.y = 0.65 + (life * 0.35);
  }

  for (let i = gunParticles.length - 1; i >= 0; i -= 1) {
    const particle = gunParticles[i];
    particle.age += deltaSeconds;
    const life = 1 - (particle.age / particle.duration);

    if (life <= 0) {
      gunParticles.splice(i, 1);
      disposeGunParticle(particle);
      continue;
    }

    particle.velocity.y -= 2.4 * deltaSeconds;
    particle.mesh.position.addInPlace(particle.velocity.scale(deltaSeconds));
    particle.mesh.rotation.x += particle.spin * deltaSeconds;
    particle.mesh.rotation.z += particle.spin * 0.6 * deltaSeconds;
    particle.mesh.scaling.setAll(0.35 + (life * 0.65));
    particle.material.alpha = 0.72 * life;
  }
}

// Minimum push that separates the mower box from one plank box, or null when
// they don't overlap. A 2D separating-axis test: if any axis separates the
// projections there is no collision; otherwise the shallowest-overlap axis is
// the push that slides the mower off the thin face of the fence.
function mowerPlankPushOut(
  cx: number, cz: number, sideX: number, sideZ: number, halfSide: number, halfForward: number,
  piece: FenceDamageState,
) {
  const aUx = sideX;
  const aUz = sideZ;
  const aVx = -sideZ;
  const aVz = sideX;
  const bUx = piece.axisX;
  const bUz = piece.axisZ;
  const bVx = -piece.axisZ;
  const bVz = piece.axisX;
  const dx = cx - piece.x;
  const dz = cz - piece.z;
  const axes = [aUx, aUz, aVx, aVz, bUx, bUz, bVx, bVz];
  let bestDepth = Number.POSITIVE_INFINITY;
  let bestX = 0;
  let bestZ = 0;

  for (let i = 0; i < axes.length; i += 2) {
    const lx = axes[i];
    const lz = axes[i + 1];
    const centerProjection = (dx * lx) + (dz * lz);
    const aReach = (halfSide * Math.abs((aUx * lx) + (aUz * lz))) + (halfForward * Math.abs((aVx * lx) + (aVz * lz)));
    const bReach = (piece.halfAlong * Math.abs((bUx * lx) + (bUz * lz))) + (piece.halfAcross * Math.abs((bVx * lx) + (bVz * lz)));
    const overlap = aReach + bReach - Math.abs(centerProjection);

    if (overlap <= 0) {
      return null;
    }

    if (overlap < bestDepth) {
      bestDepth = overlap;
      const sign = centerProjection >= 0 ? 1 : -1;
      bestX = lx * sign;
      bestZ = lz * sign;
    }
  }

  return { x: bestX * bestDepth, z: bestZ * bestDepth };
}

function collidingFencePiece(x: number, z: number) {
  if (settings.disableFenceCollision) {
    return { index: -1, distance: Number.POSITIVE_INFINITY };
  }

  // Mower oriented box, sized to the visible player mesh: local X (side) is the
  // primary axis, local Z (forward) is the perpendicular.
  const sideX = Math.cos(playerYaw);
  const sideZ = -Math.sin(playerYaw);
  const halfSide = player.scaling.x / 2;
  const halfForward = player.scaling.z / 2;
  let hit = { index: -1, distance: Number.POSITIVE_INFINITY };

  for (let index = 0; index < fenceDamage.length; index += 1) {
    const piece = fenceDamage[index];

    if (!piece || piece.broken) {
      continue;
    }

    if (!mowerPlankPushOut(x, z, sideX, sideZ, halfSide, halfForward, piece)) {
      continue;
    }

    const dx = x - piece.x;
    const dz = z - piece.z;
    const distance = Math.sqrt((dx * dx) + (dz * dz));

    if (distance < hit.distance) {
      hit = { index, distance };
    }
  }

  return hit;
}

// Slides the mower out of any plank it has rotated or drifted into, so it can
// never wedge inside the wall. Turning against a fence now nudges the mower
// away instead of trapping it. Resolving the deepest overlap first and
// iterating keeps corners stable.
function resolveFenceOverlap() {
  if (settings.disableFenceCollision) {
    return;
  }

  const sideX = Math.cos(playerYaw);
  const sideZ = -Math.sin(playerYaw);
  const halfSide = player.scaling.x / 2;
  const halfForward = player.scaling.z / 2;

  for (let iteration = 0; iteration < 4; iteration += 1) {
    let pushX = 0;
    let pushZ = 0;
    let deepest = 0;

    for (let index = 0; index < fenceDamage.length; index += 1) {
      const piece = fenceDamage[index];

      if (!piece || piece.broken) {
        continue;
      }

      const push = mowerPlankPushOut(player.position.x, player.position.z, sideX, sideZ, halfSide, halfForward, piece);

      if (!push) {
        continue;
      }

      const depth = (push.x * push.x) + (push.z * push.z);

      if (depth > deepest) {
        deepest = depth;
        pushX = push.x;
        pushZ = push.z;
      }
    }

    if (deepest <= 0) {
      break;
    }

    player.position.x += pushX;
    player.position.z += pushZ;
  }

  player.position.y = groundHeightAt(player.position.x, player.position.z);
}

function collidingRock(x: number, z: number) {
  if (settings.disableFenceCollision) {
    return { index: -1, distance: Number.POSITIVE_INFINITY };
  }

  let hit = { index: -1, distance: Number.POSITIVE_INFINITY };

  for (let index = 0; index < rockColliders.length; index += 1) {
    const rock = rockColliders[index];
    const dx = x - rock.x;
    const dz = z - rock.z;
    const distance = Math.sqrt((dx * dx) + (dz * dz));
    const combinedRadius = rock.radius + playerFenceRadius;

    if (distance < combinedRadius && distance < hit.distance) {
      hit = { index, distance };
    }
  }

  return hit;
}

// World distance to the nearest fence segment of the active map.
function distanceToFence(x: number, z: number) {
  let distance = Number.POSITIVE_INFINITY;

  for (const segment of getActiveMap().fenceSegments) {
    distance = Math.min(distance, distanceToSegment(x, z, segment.start.x, segment.start.z, segment.end.x, segment.end.z));
  }

  return distance;
}

// Roughly how far the dirt overlay reaches from the fence line. Any grass
// (mowable or neighbor) must stay outside this so nothing grows on the bare
// soil border under the fence.
const fenceDirtClearRadius = 0.6;

function grassFenceFalloff(x: number, z: number) {
  const distance = distanceToFence(x, z);

  // Keep a clear dirt margin against the fence: no grass within ~0.22m of the
  // fence line, then ramp back to full grass over the next ~0.2m. Grass ends up
  // starting ~0.42m in, well within the mower's reach from the fence.
  if (distance < 0.22) {
    return 0;
  }

  const open = Math.min(1, Math.max(0, (distance - 0.22) / 0.2));
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
  const perBladeNoise = randomHash(index, index * 0.37) - 0.5;
  const colorNoise = Math.min(1, Math.max(0, grassNoise[index] + (perBladeNoise * 0.12)));

  if (cut) {
    const shade = 0.9 + (colorNoise * 0.16) + (perBladeNoise * 0.05);
    return [shade, shade, shade, 1];
  }

  const hue = base.h + ((colorNoise - 0.5) * settings.hueVariance);
  const saturation = base.s + ((colorNoise - 0.5) * settings.satVariance);
  const lightness = base.l + ((colorNoise - 0.5) * settings.lightVariance);
  const longColor = hslToColor3(hue, saturation, lightness);

  return [longColor.r, longColor.g, longColor.b, 1];
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
    let bedOpen = shouldPlaceGrassNearFlowerBed(x, z);

    for (let attempt = 0; attempt < 90 && (fenceFalloff < 0.98 || !bedOpen); attempt += 1) {
      ({ x, z } = randomYardPoint());
      fenceFalloff = grassFenceFalloff(x, z);
      bedOpen = shouldPlaceGrassNearFlowerBed(x, z);
    }

    // If no legal spot was found, retire this blade instead of dropping it in
    // the fence margin or a flower bed where the mower can never reach it.
    // Count it as already mowed and hide it so it can't block 100% completion.
    if (fenceFalloff < 0.98 || !bedOpen) {
      isMowed[i] = true;
      mowedCount += 1;
      writeMatrix(longGrassMatrices, i, hiddenMatrix);
      writeMatrix(cutGrassMatrices, i, hiddenMatrix);
      writeColor(longGrassColors, i, [0, 0, 0, 0]);
      writeColor(cutGrassColors, i, [0, 0, 0, 0]);
      continue;
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
  const smooth01 = (value: number) => {
    const t = Math.max(0, Math.min(1, value));
    return t * t * (3 - (2 * t));
  };

  for (let i = 0; i < mediumGrassCount; i += 1) {
    let x = 0;
    let z = 0;
    let distance = 0;
    let density = 0;
    let placed = false;

    for (let attempt = 0; attempt < 100; attempt += 1) {
      x = -66 + (Math.random() * 132);
      z = -60 + (Math.random() * 120);

      distance = distanceToMainYard(x, z);
      const nearFade = 1 - smooth01(distance / 30);
      const farFade = 1 - smooth01((distance - 18) / 42);
      const broadPatch = grassNoiseAt((x * 0.075) + 6, (z * 0.075) - 3);
      const tightPatch = grassNoiseAt((x * 0.23) - 11, (z * 0.23) + 17);
      const clump = Math.max(0, ((broadPatch * 0.78) + (tightPatch * 0.22) - 0.34) / 0.66);
      density = Math.min(0.98, Math.max(0, (nearFade * 0.5) + (farFade * clump * 0.62) + (nearFade * clump * 0.28)));

      if (!isInsideYard(x, z) && !isOnRoad(x) && distanceToFence(x, z) > fenceDirtClearRadius && Math.random() < density) {
        placed = true;
        break;
      }
    }

    if (!placed) {
      writeMatrix(mediumGrassMatrices, i, emptyMatrix());
      writeColor(mediumGrassColors, i, [0, 0, 0, 0]);
      continue;
    }

    const rotation = Quaternion.FromEulerAngles(0, Math.random() * Math.PI, (Math.random() - 0.5) * 0.08);
    const distanceFade = Math.max(0.16, 1 - (distance * 0.02));
    const patchNoise = grassNoiseAt(x, z);
    const broadPatch = grassNoiseAt((x * 0.075) + 6, (z * 0.075) - 3);
    const edgeBoost = 1 - smooth01(distance / 24);
    const clumpHeight = Math.max(0, (broadPatch - 0.35) / 0.65);
    const scale = new Vector3(
      0.82 + (clumpHeight * 0.22) + (edgeBoost * 0.1),
      (0.18 + (0.22 * patchNoise) + (0.16 * clumpHeight) + (edgeBoost * 0.06) + (Math.random() * 0.12)) * distanceFade,
      0.82 + (clumpHeight * 0.22) + (edgeBoost * 0.1),
    );
    const matrix = Matrix.Compose(scale, rotation, new Vector3(x, groundHeightAt(x, z), z));
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
  const clumps = Array.from({ length: 52 }, () => ({
    x: -72 + (Math.random() * 154),
    z: -70 + (Math.random() * 140),
    radius: 2.8 + (Math.random() * 9.5),
    strength: 0.35 + (Math.random() * 0.8),
  })).filter((clump) => !isInsideYard(clump.x, clump.z) && !isOnRoad(clump.x) && distanceToMainYard(clump.x, clump.z) > 14);

  for (let i = 0; i < wheatGrassCount; i += 1) {
    let x = 0;
    let z = 0;
    let patchNoise = 0;
    let clumpWeight = 0;
    let distance = 0;

    for (let attempt = 0; attempt < 120; attempt += 1) {
      const useClump = clumps.length > 0 && Math.random() < 0.86;
      const clump = clumps[Math.floor(Math.random() * clumps.length)];
      const angle = Math.random() * Math.PI * 2;
      const radius = useClump ? Math.sqrt(Math.random()) * clump.radius : 0;

      x = useClump ? clump.x + (Math.cos(angle) * radius) : -72 + (Math.random() * 154);
      z = useClump ? clump.z + (Math.sin(angle) * radius) : -70 + (Math.random() * 140);
      patchNoise = grassNoiseAt(x * 0.24, z * 0.24);
      clumpWeight = useClump ? Math.max(0, 1 - (radius / clump.radius)) * clump.strength : 0;
      distance = distanceToMainYard(x, z);

      const brokenPatch = grassNoiseAt((x * 0.075) + 15, (z * 0.075) - 4);
      const transition = Math.min(1, Math.max(0, (distance - 13) / 36));
      const edgePatch = Math.max(0, 1 - Math.abs(distance - 17) / 8) * 0.22;
      const density = Math.min(1, (patchNoise * 0.26) + (clumpWeight * 0.9) + (brokenPatch * 0.2) + edgePatch);

      if (!isInsideYard(x, z) && !isOnRoad(x) && distance > 12 && Math.random() < density * (0.22 + (transition * 0.78))) {
        break;
      }
    }

    const wilderness = Math.min(1, Math.max(0, (distance - 14) / 42));
    const rotation = Quaternion.FromEulerAngles((Math.random() - 0.5) * 0.28, Math.random() * Math.PI, (Math.random() - 0.5) * 0.55);
    const height = 0.28 + (patchNoise * (0.45 + (wilderness * 0.55))) + (clumpWeight * (0.45 + (wilderness * 0.8))) + (Math.random() * (0.18 + (clumpWeight * 0.6)));
    const width = 0.45 + (clumpWeight * 0.45) + (Math.random() * 0.3);
    const matrix = Matrix.Compose(new Vector3(width, height, width), rotation, new Vector3(x, groundHeightAt(x, z), z));
    const edgeGreen = mixColor(hexToColor3(settings.grassBaseColor), new Color3(0.46, 0.46, 0.28), 0.38 + (patchNoise * 0.2));
    const wheatColor = mixColor(new Color3(0.42, 0.4, 0.28), new Color3(0.9, 0.82, 0.52), Math.min(1, patchNoise + (clumpWeight * 0.28)));
    const color = mixColor(edgeGreen, wheatColor, wilderness);
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

  for (let i = 0; i < getActiveMap().dandelionCount; i += 1) {
    const { x, z } = randomYardPoint();
    const kind = i % 3 === 0 ? "seed" : "yellow";

    if ((x * x) + (z * z) > 1.4) {
      createDandelion(x, z, kind);
    }
  }
}

function clearTulips() {
  while (tulips.length > 0) {
    const tulip = tulips.pop();
    tulip?.root.dispose(false, true);
  }
}

function createTulip(x: number, z: number) {
  const root = new TransformNode("tulip", scene);
  root.position = new Vector3(x, 0.09, z);

  const stem = MeshBuilder.CreateCylinder("tulip-stem", { height: 0.58, diameter: 0.035, tessellation: 5 }, scene);
  stem.parent = root;
  stem.position.y = 0.29;
  stem.rotation.x = (Math.random() - 0.5) * 0.18;
  stem.rotation.z = (Math.random() - 0.5) * 0.18;
  stem.material = tulipStemMaterial;

  const head = MeshBuilder.CreateSphere("tulip-head", { diameter: 0.18, segments: 7 }, scene);
  head.parent = root;
  head.position.y = 0.64;
  head.scaling = new Vector3(0.85, 1.25, 0.85);
  head.material = tulipHeadMaterials[Math.floor(Math.random() * tulipHeadMaterials.length)];

  const leaf = MeshBuilder.CreatePlane("tulip-leaf", { width: 0.16, height: 0.34 }, scene);
  leaf.parent = root;
  leaf.position = new Vector3(0.08, 0.28, 0);
  leaf.rotation.z = -0.75;
  leaf.material = tulipStemMaterial;

  tulips.push({ root, head, stem, x, z, destroyed: false });
}

function placeTulips() {
  clearTulips();

  for (const bed of getActiveMap().flowerBeds) {
    for (let i = 0; i < bed.count; i += 1) {
      const { x, z } = randomRectPoint(bed);
      createTulip(x, z);
    }
  }
}

function damageProtectedTulips() {
  const radiusSquared = (mowerCutRadius * 1.35) ** 2;
  let changed = false;

  for (const tulip of tulips) {
    if (tulip.destroyed) {
      continue;
    }

    const dx = tulip.x - player.position.x;
    const dz = tulip.z - player.position.z;

    if ((dx * dx) + (dz * dz) > radiusSquared) {
      continue;
    }

    destroyTulip(tulip);
    changed = true;
  }

  if (changed) {
    updateHud();
  }
}

function destroyTulip(tulip: Tulip) {
  tulip.destroyed = true;
  tulip.head.scaling = new Vector3(1.4, 0.24, 1.4);
  tulip.head.position.y = 0.12;
  tulip.head.rotation.x = 1.4 + (Math.random() * 0.7);
  tulip.stem.scaling.y = 0.18;
  tulip.stem.position.y = 0.05;
  mistakeCount += 1;
}

function resetGame() {
  applyActiveMap();
  resetCelebration();
  mapGroundRoot?.dispose(false, true);
  fenceRoot?.dispose(false, true);
  disposeFenceHealthLabels();
  mapGroundRoot = createMapGrounds(scene, getActiveMap(), groundMaterial);
  fenceRoot = createFence(scene, fenceMaterial, getActiveMap().fenceSegments);
  fenceDamage = createFenceDamageStates();
  syncFenceHealthLabels();
  player.position = getActiveMap().spawn.clone();
  snapPlayerToGround();
  playerYaw = 0;
  player.rotation.y = playerYaw;
  cameraOrbitYaw = 0;
  cameraOrbitHeight = 0;
  cameraDistanceOffset = 0;
  cameraAdjustmentCount = 0;
  cameraAdjustmentCooldown = 0;
  cameraReturnDelay = 0;
  cameraReturning = false;
  mistakeCount = 0;
  hasSecretGun = false;
  shootCooldown = 0;
  lastMowSeconds = performance.now() / 1000;
  remainingHighlightActive = false;
  secretGunRoot?.setEnabled(true);
  placeMediumGrass();
  placeWheatGrass();
  placeGrass();
  placeDandelions();
  placeTulips();
  mowTouchedGrass();
  syncMistakesVisibility();
  updateHud();
}

// The mistakes meter only makes sense where mistakes are possible (maps with
// protected flowers). On a plain mow-only map it is just confusing, so hide it.
function syncMistakesVisibility() {
  const show = getActiveMap().flowerBeds.length > 0;
  mistakesEl.style.display = show ? "" : "none";
  const meter = document.querySelector<HTMLDivElement>("#mistakeMeter");

  if (meter) {
    meter.style.display = show ? "" : "none";
  }
}

function moveWithinYard(nextPosition: Vector3, movement: Vector3, impactSpeed: number) {
  if (settings.disableFenceCollision) {
    nextPosition.y = groundHeightAt(nextPosition.x, nextPosition.z);
    player.position.copyFrom(nextPosition);
    return -1;
  }

  const fenceHit = collidingFencePiece(nextPosition.x, nextPosition.z);
  const rockHit = collidingRock(nextPosition.x, nextPosition.z);
  const currentGround = groundHeightAt(player.position.x, player.position.z);
  const nextGround = groundHeightAt(nextPosition.x, nextPosition.z);
  const horizontalDistance = Math.sqrt((movement.x * movement.x) + (movement.z * movement.z));
  const slope = horizontalDistance > 0.0001 ? Math.abs(nextGround - currentGround) / horizontalDistance : 0;
  const steepTerrainHit = !isInsideYard(nextPosition.x, nextPosition.z) && !isOnRoad(nextPosition.x) && slope > 0.72;

  if (fenceHit.index < 0 && rockHit.index < 0 && !steepTerrainHit) {
    nextPosition.y = nextGround;
    player.position.copyFrom(nextPosition);
    return -1;
  }

  const bumpDirection = movement.lengthSquared() > 0.000001 ? movement.normalize() : new Vector3(Math.sin(playerYaw), 0, Math.cos(playerYaw));
  const maxImpactSpeed = playerSpeed * playerBoost;
  const speedRatio = Math.min(1, Math.abs(impactSpeed) / maxImpactSpeed);
  const bumpRatio = speedRatio <= 0.08 ? 0 : (speedRatio - 0.08) / 0.92;
  player.position.subtractInPlace(bumpDirection.scale(0.1 * bumpRatio));

  return fenceHit.index >= 0 ? fenceHit.index : -2;
}

function movePlayer(deltaSeconds: number) {
  const activeInputMode = effectiveInputMode();
  const useKeyboard = activeInputMode === "keyboard" || activeInputMode === "mouse";
  // Mouse steering only when the player actually means it: explicit mouse mode,
  // or auto that resolved to keyboard on a desktop. A present controller/touch
  // resolves away from keyboard, so it no longer fights the mouse cursor.
  const useMouseSteering = (settings.inputMode === "mouse" || (settings.inputMode === "auto" && activeInputMode === "keyboard"))
    && mouseSteeringActive && mouseSteeringPointer && document.hasFocus() && !cameraDrag.active;
  const keyboardTurn = useKeyboard ? (keys.has("d") ? 1 : 0) - (keys.has("a") ? 1 : 0) : 0;
  const controllerTurn = analogInput.controllerTurn;
  const touchTurn = analogInput.touchTurn;
  const analogTurn = Math.max(-1, Math.min(1, controllerTurn + touchTurn + (useMouseSteering ? mouseTurn * 0.72 : 0)));
  const turnDirection = Math.max(-1, Math.min(1, keyboardTurn + analogTurn));
  const turnSign = Math.sign(turnDirection);
  const shouldAccelerateTurn = keyboardTurn !== 0
    || Math.abs(controllerTurn) >= settings.controllerTurnAccelThreshold
    || Math.abs(touchTurn) >= settings.controllerTurnAccelThreshold;

  if (turnSign !== 0) {
    if (turnSign !== lastTurnDirection) {
      turnHoldSeconds = 0;
    }

    if (shouldAccelerateTurn) {
      turnHoldSeconds += deltaSeconds;
    }

    lastTurnDirection = turnSign;
    const build = Math.min(1, turnHoldSeconds / settings.turnBuild);
    const keyboardScale = keyboardTurn === 0 ? 0 : 0.14 + (build * build * 0.86);
    const analogScale = shouldAccelerateTurn ? 1 + (build * build * 0.72) : 1;
    const scaledTurn = Math.max(-1, Math.min(1, (keyboardTurn * keyboardScale) + (analogTurn * analogScale)));
    playerYaw += scaledTurn * settings.turnMaxSpeed * deltaSeconds;
  } else {
    turnHoldSeconds = 0;
    lastTurnDirection = 0;
  }

  player.rotation.y = playerYaw;

  currentThrottle = 0;

  if (useKeyboard && keys.has("w")) {
    currentThrottle += 1;
  }

  if (useKeyboard && keys.has("s")) {
    currentThrottle -= 0.45;
  }

  currentThrottle = Math.max(-0.45, Math.min(1, currentThrottle + analogInput.throttle));

  const targetSpeed = currentThrottle === 0
    ? 0
    : playerSpeed * ((useKeyboard && keys.has(" ")) || analogInput.boost ? playerBoost : 1) * currentThrottle;
  const ramp = currentThrottle === 0 ? 7 : 2.8;
  driveSpeed += (targetSpeed - driveSpeed) * Math.min(1, deltaSeconds * ramp);

  if (Math.abs(driveSpeed) < 0.01) {
    driveSpeed = 0;
    snapPlayerToGround();
    return;
  }

  const direction = new Vector3(Math.sin(playerYaw), 0, Math.cos(playerYaw));
  direction.scaleInPlace(driveSpeed * deltaSeconds);

  const nextPosition = player.position.add(direction);

  const hitFenceIndex = moveWithinYard(nextPosition, direction, driveSpeed);

  if (hitFenceIndex !== -1) {
    const impactSpeed = driveSpeed;
    driveSpeed = 0;

    if (bumpCooldown <= 0) {
      if (hitFenceIndex >= 0) {
        damageFencePiece(hitFenceIndex, impactSpeed);
      }

      prototypeAudio.playWallBump(settings.wallBumpVolume);
      bumpCooldown = 0.35;
    }
  }
}

function markCameraAdjusted() {
  if (cameraAdjustmentCooldown <= 0) {
    cameraAdjustmentCount += 1;
  }

  cameraAdjustmentCooldown = 0.45;
  cameraReturnDelay = Math.min(18, Math.max(2.5, cameraAdjustmentCount * 2.5));
  cameraReturning = false;
}

function updateCameraInput(deltaSeconds: number) {
  let adjusted = false;
  const controllerCameraTurn = analogInput.cameraTurn;
  const controllerCameraPitch = analogInput.cameraPitch;

  if (Math.abs(controllerCameraTurn) > 0 || Math.abs(controllerCameraPitch) > 0) {
    cameraOrbitYaw += controllerCameraTurn * deltaSeconds * 2.2;
    cameraOrbitHeight -= controllerCameraPitch * deltaSeconds * 2.4;
    adjusted = true;
  }

  if (effectiveInputMode() === "keyboard") {
    const arrowTurn = (keys.has("arrowright") ? 1 : 0) - (keys.has("arrowleft") ? 1 : 0);
    const arrowPitch = (keys.has("arrowdown") ? 1 : 0) - (keys.has("arrowup") ? 1 : 0);

    if (arrowTurn !== 0 || arrowPitch !== 0) {
      cameraOrbitYaw += arrowTurn * deltaSeconds * 2.4;
      cameraOrbitHeight += arrowPitch * deltaSeconds * 3.1;
      adjusted = true;
    }
  }

  if (adjusted) {
    markCameraAdjusted();
  } else {
    cameraAdjustmentCooldown = Math.max(0, cameraAdjustmentCooldown - deltaSeconds);

    if (cameraAdjustmentCount < 7 && (Math.abs(cameraOrbitYaw) > 0.001 || Math.abs(cameraOrbitHeight) > 0.001 || Math.abs(cameraDistanceOffset) > 0.001)) {
      cameraReturnDelay -= deltaSeconds;

      if (cameraReturnDelay <= 0) {
        cameraReturning = true;
      }
    }
  }

  if (cameraReturning) {
    const returnAmount = Math.min(1, deltaSeconds / 7);
    cameraOrbitYaw += (0 - cameraOrbitYaw) * returnAmount;
    cameraOrbitHeight += (0 - cameraOrbitHeight) * returnAmount;
    cameraDistanceOffset += (0 - cameraDistanceOffset) * returnAmount;

    if (Math.abs(cameraOrbitYaw) < 0.004 && Math.abs(cameraOrbitHeight) < 0.004 && Math.abs(cameraDistanceOffset) < 0.004) {
      cameraOrbitYaw = 0;
      cameraOrbitHeight = 0;
      cameraDistanceOffset = 0;
      cameraReturning = false;
      cameraAdjustmentCount = 0;
    }
  }

  cameraOrbitHeight = Math.max(-1.7, Math.min(4.8, cameraOrbitHeight));
  cameraDistanceOffset = Math.max(-3.2, Math.min(7.5, cameraDistanceOffset));
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
    lastMowSeconds = performance.now() / 1000;
    grassCuttingAudioTimer = 0.16;
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

  prototypeAudio.playFlowerPop(settings.flowerPopVolume);

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

function distanceToShot(x: number, z: number, origin: Vector3, direction: Vector3, range: number) {
  const dx = x - origin.x;
  const dz = z - origin.z;
  const forwardDistance = (dx * direction.x) + (dz * direction.z);

  if (forwardDistance < 0 || forwardDistance > range) {
    return Number.POSITIVE_INFINITY;
  }

  return Math.abs((dx * direction.z) - (dz * direction.x));
}

function shootSecretGun() {
  if (!hasSecretGun || shootCooldown > 0) {
    return;
  }

  shootCooldown = 0.22;
  prototypeAudio.playGunShot(settings.gunShotVolume);
  const origin = player.position.add(new Vector3(Math.sin(playerYaw) * 0.8, 0, Math.cos(playerYaw) * 0.8));
  const direction = new Vector3(Math.sin(playerYaw), 0, Math.cos(playerYaw));
  const range = 18;
  const shotWidth = 0.28;
  let changedGrass = false;
  let grassFleckCount = 0;

  for (let distance = 0; distance <= range; distance += 0.45) {
    const x = origin.x + (direction.x * distance);
    const z = origin.z + (direction.z * distance);
    const cellX = Math.floor(x / cellSize);
    const cellZ = Math.floor(z / cellSize);

    for (let offsetX = -1; offsetX <= 1; offsetX += 1) {
      for (let offsetZ = -1; offsetZ <= 1; offsetZ += 1) {
        const cell = grassGrid.get(gridKey(cellX + offsetX, cellZ + offsetZ));

        if (!cell) {
          continue;
        }

        for (const index of cell) {
          if (isMowed[index] || distanceToShot(grassX[index], grassZ[index], origin, direction, range) > shotWidth) {
            continue;
          }

          isMowed[index] = true;
          mowedCount += 1;
          writeMatrix(longGrassMatrices, index, emptyMatrix());
          writeMatrix(cutGrassMatrices, index, matrixForBlade(index, true));
          changedGrass = true;

          if (grassFleckCount < 28 && Math.random() < 0.065) {
            spawnGunGrassFleck(grassX[index], grassZ[index], direction);
            grassFleckCount += 1;
          }
        }
      }
    }
  }

  if (changedGrass) {
    longGrass.thinInstanceBufferUpdated("matrix");
    cutGrass.thinInstanceBufferUpdated("matrix");
    updateHud();
  }

  for (const dandelion of dandelions) {
    const position = dandelion.head.getAbsolutePosition();
    const x = dandelion.kind === "yellow" && dandelion.cut ? position.x : dandelion.x;
    const z = dandelion.kind === "yellow" && dandelion.cut ? position.z : dandelion.z;

    if (distanceToShot(x, z, origin, direction, range) < 0.42) {
      mowDandelion(dandelion);
      spawnGunImpactDust(x, z, 0.75);
    }
  }

  let hitTulip = false;
  for (const tulip of tulips) {
    if (!tulip.destroyed && distanceToShot(tulip.x, tulip.z, origin, direction, range) < 0.42) {
      destroyTulip(tulip);
      spawnGunImpactDust(tulip.x, tulip.z, 0.9);
      hitTulip = true;
    }
  }

  if (hitTulip) {
    updateHud();
  }

  const fenceHitDistance = shootFenceAlongRay(origin, direction, range);
  const tracerLength = fenceHitDistance ?? range;
  const impact = origin.add(direction.scale(tracerLength));
  spawnGunTracer(origin, direction, tracerLength);
  spawnGunImpactDust(impact.x, impact.z, fenceHitDistance === null ? 0.65 : 1.15);
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
    const burst = 0.6 + (Math.random() * 0.85);
    fallingPetals.push({
      mesh: piece,
      age: 0,
      duration: 2.6 + (Math.random() * 1.4),
      velocity: new Vector3(
        Math.cos(angle) * burst + 0.2,
        1.1 + (Math.random() * 0.7),
        Math.sin(angle) * burst,
      ),
      settled: false,
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
      dandelion.headVelocity.y -= 4.4 * deltaSeconds;
      dandelion.head.position.addInPlace(dandelion.headVelocity.scale(deltaSeconds));
      dandelion.head.rotation.x += deltaSeconds * 2.1;
      dandelion.head.rotation.z += deltaSeconds * 1.4;

      if (dandelion.head.position.y <= 0.08 && dandelion.headVelocity.y < 0) {
        dandelion.head.position.y = 0.08;

        if (dandelion.headVelocity.y < -0.6) {
          // Bounce off the ground a few times before coming to rest.
          dandelion.headVelocity.y = -dandelion.headVelocity.y * 0.42;
          dandelion.headVelocity.x *= 0.55;
          dandelion.headVelocity.z *= 0.55;
        } else {
          dandelion.headVelocity.set(0, 0, 0);
          dandelion.headFalling = false;
          dandelion.headSettled = true;
        }
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
  const groundY = 0.03;

  for (let i = fallingPetals.length - 1; i >= 0; i -= 1) {
    const petal = fallingPetals[i];
    petal.age += deltaSeconds;

    if (!petal.settled) {
      petal.velocity.y -= 4.2 * deltaSeconds;
      petal.mesh.position.addInPlace(petal.velocity.scale(deltaSeconds));
      petal.mesh.rotation.y += deltaSeconds * 3.2;
      petal.mesh.rotation.z += deltaSeconds * 2.1;

      if (petal.mesh.position.y <= groundY && petal.velocity.y < 0) {
        petal.mesh.position.y = groundY;

        if (petal.velocity.y < -0.55) {
          // Bounce: reflect upward with damping, scrub sideways speed.
          petal.velocity.y = -petal.velocity.y * 0.45;
          petal.velocity.x *= 0.6;
          petal.velocity.z *= 0.6;
        } else {
          // Too slow to bounce again: settle on the ground, then fade.
          petal.velocity.setAll(0);
          petal.settled = true;
        }
      }
    }

    // Stay fully visible while it pops and bounces; only fade over the last
    // third of its life so it never vanishes mid-air.
    const t = petal.age / petal.duration;
    const material = petal.mesh.material;
    if (material instanceof StandardMaterial) {
      material.alpha = Math.max(0, Math.min(1, (1 - t) / 0.34));
    }

    if (t >= 1) {
      petal.mesh.dispose();
      fallingPetals.splice(i, 1);
    }
  }
}

// When almost the whole lawn is cut and the player has gone a while without
// finding the last blades, gently pulse the survivors so they are easy to spot.
function updateRemainingHighlight(timeSeconds: number) {
  const remaining = bladeCount - mowedCount;
  const threshold = Math.max(1, Math.ceil(bladeCount * 0.01));
  const shouldHighlight = remaining > 0 && remaining <= threshold && (timeSeconds - lastMowSeconds) > 30;

  if (shouldHighlight) {
    const pulse = 0.5 + (0.5 * Math.sin(timeSeconds * 3.2));
    const amount = 0.4 + (pulse * 0.45);

    for (let i = 0; i < bladeCount; i += 1) {
      if (isMowed[i]) {
        continue;
      }

      const base = colorForBlade(i, false);
      writeColor(longGrassColors, i, [
        base[0] + ((1 - base[0]) * amount),
        base[1] + ((1 - base[1]) * amount),
        base[2] + ((0.55 - base[2]) * amount),
        1,
      ]);
    }

    longGrass.thinInstanceBufferUpdated("color");
    remainingHighlightActive = true;
  } else if (remainingHighlightActive) {
    refreshGrassColors();
    remainingHighlightActive = false;
  }
}

function updateCloudShadows(timeSeconds: number) {
  const broad = 0.5 + (Math.sin((timeSeconds * 0.035) + 0.8) * 0.5);
  const detail = 0.5 + (Math.sin((timeSeconds * 0.083) - 1.7) * 0.5);
  const cloud = Math.max(0, ((broad * 0.75) + (detail * 0.25)) - 0.42) / 0.58;
  const shade = 1 - (cloud * 0.18);
  sun.intensity = baseSunIntensity * shade;
  sun.specular = baseSunSpecular.scale(1 - (cloud * 0.32));
}

function refreshGrassColors() {
  if (!longGrassColors || !cutGrassColors) {
    return;
  }

  refreshCutBladeVertexColors();

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
  groundMaterial.albedoTexture = createGrassyGroundTexture(scene);
}

function setTextureScale(texture: unknown, uScale: number, vScale: number, level?: number) {
  if (!texture) {
    return;
  }

  const tiledTexture = texture as { uScale: number; vScale: number; level?: number };
  tiledTexture.uScale = uScale;
  tiledTexture.vScale = vScale;

  if (level !== undefined) {
    tiledTexture.level = level;
  }
}

function refreshTextureScales() {
  setTextureScale(groundMaterial.albedoTexture, settings.grassyTextureScale, settings.grassyTextureScale);
  setTextureScale(worldGroundMaterial.diffuseTexture, settings.dirtTextureUScale, settings.dirtTextureVScale);
  setTextureScale(worldGroundMaterial.bumpTexture, settings.dirtTextureUScale, settings.dirtTextureVScale, settings.dirtNormalStrength);
  setTextureScale(roadMaterial.diffuseTexture, settings.roadTextureUScale, settings.roadTextureVScale);
  updateBiomeGroundMaterialScale(biomeGroundMaterial, settings.grassyTextureScale, settings.dirtTextureUScale, settings.dirtTextureVScale);
}

function hasTouchInput() {
  return navigator.maxTouchPoints > 0 || matchMedia("(pointer: coarse)").matches;
}

function hasControllerInput() {
  return Boolean(navigator.getGamepads().find(Boolean));
}

function isTouchPrimaryDevice() {
  // A genuine touch-first device (phone/tablet): a coarse pointer and no mouse.
  // This deliberately excludes touchscreen laptops so they stay on keyboard/mouse.
  return matchMedia("(pointer: coarse)").matches && !matchMedia("(pointer: fine)").matches;
}

// Resolves the user's preference into the concrete device that actually drives
// the game. In "auto", presence wins in priority order: controller, then touch,
// then keyboard. Explicitly forced modes are returned unchanged.
function effectiveInputMode(): InputMode {
  if (settings.inputMode !== "auto") {
    return settings.inputMode as InputMode;
  }

  if (hasControllerInput()) {
    return "controller";
  }

  if (isTouchPrimaryDevice()) {
    return "touch";
  }

  return "keyboard";
}

// One-time startup pick: a controller or a genuine touch device that is already
// present wins, otherwise keyboard. A keyboard-only machine stays on keyboard,
// not a generic "auto".
function detectInitialInputMode(): InputMode {
  if (hasControllerInput()) {
    return "controller";
  }

  if (isTouchPrimaryDevice()) {
    return "touch";
  }

  return "keyboard";
}

// Pushes the resolved device into analogInput, but only when it changes, so a
// connected controller or a touch device engages automatically and we never
// reset touch state every frame.
function applyActiveInputMode() {
  const resolved = effectiveInputMode();

  if (resolved !== lastAppliedInputMode) {
    analogInput.setMode(resolved);
    lastAppliedInputMode = resolved;
  }
}

function setInputMode(mode: InputMode) {
  settings.inputMode = mode;
  applyActiveInputMode();
  const inputModeControl = settingsEl.querySelector<HTMLSelectElement>("#inputMode");

  if (inputModeControl) {
    inputModeControl.value = mode;
  }

  syncQuickInputSelection();
}

function syncQuickInputSelection() {
  for (const button of quickInputModeEl.querySelectorAll<HTMLButtonElement>(".quick-input-button")) {
    button.setAttribute("aria-pressed", String(button.dataset.mode === settings.inputMode));
  }
}

function syncQuickInputModes() {
  const modes: Array<{ value: InputMode; icon: string; label: string; available: boolean }> = [
    { value: "auto", icon: "A", label: "Auto input", available: true },
    { value: "keyboard", icon: "K", label: "Keyboard", available: true },
    { value: "mouse", icon: "M", label: "Mouse", available: matchMedia("(pointer: fine)").matches },
    { value: "controller", icon: "G", label: "Controller", available: hasControllerInput() },
    { value: "touch", icon: "T", label: "Touchpad", available: hasTouchInput() },
  ];
  quickInputModeEl.replaceChildren();

  for (const mode of modes) {
    if (!mode.available) {
      continue;
    }

    const button = document.createElement("button");
    button.type = "button";
    button.className = "quick-input-button";
    button.dataset.mode = mode.value;
    button.textContent = mode.icon;
    button.title = mode.label;
    button.setAttribute("aria-label", mode.label);
    button.addEventListener("click", () => {
      setInputMode(mode.value);
    });
    quickInputModeEl.append(button);
  }

  if (!quickInputModeEl.querySelector(`[data-mode="${settings.inputMode}"]`)) {
    setInputMode("auto");
    return;
  }

  syncQuickInputSelection();
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
    "controllerTurnAccelThreshold",
    "fenceMaxHealth",
    "seedPopRate",
    "mowerVolume",
    "breezeVolume",
    "ambientBreezeVolume",
    "breezeFacingAmount",
    "grassCuttingVolume",
    "grassCuttingAttackDelay",
    "grassCuttingAttack",
    "grassCuttingDecay",
    "flowerPopVolume",
    "wallBumpVolume",
    "reverseBeepVolume",
    "completionFanfareVolume",
    "completionLoopVolume",
    "gunShotVolume",
    "grassRoughness",
    "grassMetallic",
    "grassClearCoat",
    "cutGrassRoughness",
    "cutGrassMetallic",
    "cutGrassClearCoat",
    "hueVariance",
    "satVariance",
    "lightVariance",
    "grassyTextureScale",
    "dirtTextureUScale",
    "dirtTextureVScale",
    "dirtNormalStrength",
    "roadTextureUScale",
    "roadTextureVScale",
    "targetFps",
  ] as const;
  const colorControls = [
    "grassBaseColor",
    "cutGrassRootColor",
    "cutGrassTopColorA",
    "cutGrassTopColorB",
    "groundColor",
  ] as const;
  const checkboxControls = [
    "showFenceHealth",
    "disableFenceCollision",
    "dynamicResolution",
  ] as const;
  const inputModeControl = settingsEl.querySelector<HTMLSelectElement>("#inputMode");
  const mapControl = settingsEl.querySelector<HTMLSelectElement>("#mapId");
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
      } else if (id === "fenceMaxHealth") {
        scheduleRegenerate();
      } else if (["hueVariance", "satVariance", "lightVariance"].includes(id)) {
        refreshGrassColors();
      } else if ([
        "grassRoughness",
        "grassMetallic",
        "grassClearCoat",
        "cutGrassRoughness",
        "cutGrassMetallic",
        "cutGrassClearCoat",
      ].includes(id)) {
        refreshGrassMaterial();
      } else if ([
        "grassyTextureScale",
        "dirtTextureUScale",
        "dirtTextureVScale",
        "dirtNormalStrength",
        "roadTextureUScale",
        "roadTextureVScale",
      ].includes(id)) {
        refreshTextureScales();
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

  for (const id of checkboxControls) {
    const input = settingsEl.querySelector<HTMLInputElement>(`#${id}`);

    if (input) {
      input.checked = Boolean(settings[id]);
    }

    input?.addEventListener("input", () => {
      settings[id] = input.checked;

      if (id === "showFenceHealth") {
        syncFenceHealthLabels();
      }
    });
  }

  if (inputModeControl) {
    inputModeControl.value = settings.inputMode;
    applyActiveInputMode();
    inputModeControl.addEventListener("input", () => {
      setInputMode(inputModeControl.value as InputMode);
    });
  }

  syncQuickInputModes();
  window.addEventListener("gamepadconnected", syncQuickInputModes);
  window.addEventListener("gamepaddisconnected", syncQuickInputModes);

  if (mapControl) {
    mapControl.value = settings.mapId;
    mapControl.addEventListener("input", () => {
      settings.mapId = mapControl.value;
      resetGame();
    });
  }
}

const ambientLight = new HemisphericLight("ambientLight", new Vector3(0, 1, 0), scene);
ambientLight.intensity = 0.42;
ambientLight.diffuse = new Color3(0.66, 0.78, 1);
ambientLight.groundColor = new Color3(0.34, 0.58, 0.26);

const sun = new DirectionalLight("sun", new Vector3(-0.45, -1, 0.24), scene);
sun.position = new Vector3(10, 15, -7);
sun.intensity = 1.2;
sun.diffuse = new Color3(1, 0.88, 0.62);
sun.specular = new Color3(1, 0.88, 0.66);
const baseSunIntensity = sun.intensity;
const baseSunSpecular = sun.specular.clone();

const shadowGenerator = new ShadowGenerator(1024, sun);
shadowGenerator.useBlurExponentialShadowMap = true;
shadowGenerator.blurKernel = 24;

const camera = new ArcRotateCamera("camera", -Math.PI / 2, Math.PI / 3, 16, Vector3.Zero(), scene);
camera.detachControl();
camera.lowerRadiusLimit = 8;
camera.upperRadiusLimit = 24;

function updateCameraProjection() {
  const aspect = engine.getRenderWidth() / Math.max(1, engine.getRenderHeight());

  if (aspect < 1) {
    // Portrait (phones): fix the HORIZONTAL field of view so left/right stay
    // visible. With the default vertical-fixed FOV a tall, narrow window
    // squeezes the horizontal view down to a slit, which felt claustrophobic.
    camera.fovMode = Camera.FOVMODE_HORIZONTAL_FIXED;
    camera.fov = 1;
  } else {
    camera.fovMode = Camera.FOVMODE_VERTICAL_FIXED;
    camera.fov = 0.8;
  }
}

// Optional adaptive resolution: sample FPS twice a second and nudge the engine
// hardware-scaling level so a struggling device renders at lower resolution
// (smoother) and a comfortable one returns toward native. Off by default.
function updateAdaptiveResolution(deltaSeconds: number) {
  perfSampleTime += deltaSeconds;

  if (perfSampleTime < 0.5) {
    return;
  }

  perfSampleTime = 0;
  const fps = engine.getFps();

  if (settings.dynamicResolution) {
    if (fps < settings.targetFps - 4 && currentHardwareScale < 2.5) {
      currentHardwareScale = Math.min(2.5, currentHardwareScale + 0.15);
      engine.setHardwareScalingLevel(currentHardwareScale);
    } else if (fps > settings.targetFps + 6 && currentHardwareScale > 1) {
      currentHardwareScale = Math.max(1, currentHardwareScale - 0.1);
      engine.setHardwareScalingLevel(currentHardwareScale);
    }
  } else if (currentHardwareScale !== 1) {
    currentHardwareScale = 1;
    engine.setHardwareScalingLevel(1);
  }

  if (perfEl && !perfEl.hidden) {
    perfEl.textContent = `${Math.round(fps)} fps · ${currentHardwareScale.toFixed(2)}x`;
  }
}

updateCameraProjection();

const biomeGroundMaterial = createBiomeGroundMaterial(scene, settings.grassyTextureScale, settings.dirtTextureUScale, settings.dirtTextureVScale);
createWorldTerrain(scene, biomeGroundMaterial);
createSimpleTrees();
createSceneryRocks();

createRoad(scene, roadMaterial, stripeMaterial);
secretGunRoot = createHiddenGunProp();
createWindWisps();
createWindMotes();

longGrass = makeLongBladeMesh();
cutGrass = makeCutBladeMesh();
mediumGrass = makeLongBladeMesh("mediumGrass");
wheatGrass = makeWheatBladeMesh();

player = MeshBuilder.CreateBox("player", { size: 1 }, scene);
player.material = playerMaterial;
player.scaling = new Vector3(0.85, 0.28, 1.1);
shadowGenerator.addShadowCaster(player);

setupSettings();
setInputMode(detectInitialInputMode());
refreshGroundColor();
refreshTextureScales();
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

closeCelebrationButtonEl.addEventListener("click", closeCelebration);
nextLevelButtonEl.addEventListener("click", goToNextLevel);

canvas.addEventListener("contextmenu", (event) => {
  event.preventDefault();
});

canvas.addEventListener("pointerenter", () => {
  mouseSteeringActive = true;
});

canvas.addEventListener("pointerleave", () => {
  mouseSteeringActive = false;
  mouseSteeringPointer = false;
  mouseTurn = 0;
});

canvas.addEventListener("pointermove", (event) => {
  if (cameraDrag.active && event.pointerId === cameraDrag.pointerId) {
    cameraOrbitYaw -= (event.clientX - cameraDrag.lastX) * 0.006;
    cameraOrbitHeight += (event.clientY - cameraDrag.lastY) * 0.012;
    cameraOrbitHeight = Math.max(-1.7, Math.min(4.8, cameraOrbitHeight));
    markCameraAdjusted();
    cameraDrag.lastX = event.clientX;
    cameraDrag.lastY = event.clientY;
    return;
  }

  mouseSteeringPointer = event.pointerType === "mouse";

  if (settings.inputMode === "touch" || event.pointerType !== "mouse") {
    mouseTurn = 0;
    return;
  }

  const normalizedX = (event.clientX / Math.max(1, window.innerWidth)) - 0.5;
  mouseTurn = Math.max(-1, Math.min(1, normalizedX * 2.2));
});

canvas.addEventListener("pointerdown", (event) => {
  mouseSteeringActive = true;
  mouseSteeringPointer = event.pointerType === "mouse";

  if (event.button === 0) {
    shootSecretGun();
  }

  if (event.button !== 2) {
    return;
  }

  event.preventDefault();
  cameraDrag.active = true;
  cameraDrag.pointerId = event.pointerId;
  cameraDrag.lastX = event.clientX;
  cameraDrag.lastY = event.clientY;
  canvas.setPointerCapture(event.pointerId);
});

const endCameraDrag = (event: PointerEvent) => {
  if (event.pointerId !== cameraDrag.pointerId) {
    return;
  }

  cameraDrag.active = false;
  cameraDrag.pointerId = -1;
};

canvas.addEventListener("pointerup", endCameraDrag);
canvas.addEventListener("pointercancel", endCameraDrag);

canvas.addEventListener("wheel", (event) => {
  if (settings.inputMode === "touch") {
    return;
  }

  event.preventDefault();
  cameraDistanceOffset += event.deltaY * 0.008;
  cameraDistanceOffset = Math.max(-3.2, Math.min(7.5, cameraDistanceOffset));
  markCameraAdjusted();
}, { passive: false });

document.addEventListener("fullscreenchange", () => {
  fullscreenButtonEl.textContent = document.fullscreenElement ? "Exit full screen" : "Full screen";
  engine.resize();
  updateCameraProjection();
});

window.addEventListener("keydown", (event) => {
  const key = event.key.toLowerCase();

  // The completion card is a modal: let the keyboard advance or dismiss it
  // before any key falls through to mower driving.
  if (!celebrationEl.hidden) {
    if (key === "enter" || key === " ") {
      event.preventDefault();
      goToNextLevel();
    } else if (key === "escape") {
      event.preventDefault();
      closeCelebration();
    }

    return;
  }

  // Don't swallow keys (especially Space) while a focusable control is in
  // focus, or activating buttons/selects with the keyboard would break.
  const active = document.activeElement;
  const onControl = active instanceof HTMLButtonElement
    || active instanceof HTMLSelectElement
    || active instanceof HTMLInputElement;

  if (!onControl && ["w", "a", "s", "d", " ", "arrowleft", "arrowright", "arrowup", "arrowdown"].includes(key)) {
    event.preventDefault();
    keys.add(key);
  }

  if (key === "r") {
    resetGame();
  }

  if (key === "e") {
    shootSecretGun();
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
  updateCameraProjection();
});

engine.runRenderLoop(() => {
  const deltaSeconds = engine.getDeltaTime() / 1000;
  const timeSeconds = performance.now() / 1000;

  clippingBurstCooldown = Math.max(0, clippingBurstCooldown - deltaSeconds);
  bumpCooldown = Math.max(0, bumpCooldown - deltaSeconds);
  grassCuttingAudioTimer = Math.max(0, grassCuttingAudioTimer - deltaSeconds);
  shootCooldown = Math.max(0, shootCooldown - deltaSeconds);
  updateAdaptiveResolution(deltaSeconds);
  applyActiveInputMode();

  const gamepad = navigator.getGamepads().find(Boolean);

  // The completion card is DOM, which a gamepad can't focus, so drive it
  // directly: A advances to the next level, B closes. Edge-triggered so a held
  // button doesn't skip through screens.
  if (!celebrationEl.hidden) {
    const advance = Boolean(gamepad?.buttons[0]?.pressed);
    const dismiss = Boolean(gamepad?.buttons[1]?.pressed);

    if (advance && !lastCelebrationAdvance) {
      goToNextLevel();
    } else if (dismiss && !lastCelebrationDismiss) {
      closeCelebration();
    }

    lastCelebrationAdvance = advance;
    lastCelebrationDismiss = dismiss;
  } else {
    lastCelebrationAdvance = Boolean(gamepad?.buttons[0]?.pressed);
    lastCelebrationDismiss = Boolean(gamepad?.buttons[1]?.pressed);
  }

  const controllerShoot = Boolean(gamepad?.buttons[2]?.pressed);
  if (controllerShoot && !lastControllerShoot) {
    shootSecretGun();
  }
  lastControllerShoot = controllerShoot;
  updateCameraInput(deltaSeconds);
  movePlayer(deltaSeconds);
  resolveFenceOverlap();
  updateFollowCamera(camera, player.position, playerYaw, deltaSeconds, cameraOrbitYaw, cameraOrbitHeight, cameraDistanceOffset);
  updateGrassMotion(timeSeconds);
  updateWindWisps(deltaSeconds);
  updateWindMotes(deltaSeconds);
  updateGunEffects(deltaSeconds);
  updateDandelions(deltaSeconds);
  updateFloatingSeeds(deltaSeconds);
  updateFallingPetals(deltaSeconds);
  updateCloudShadows(timeSeconds);
  mowTouchedGrass();
  updateRemainingHighlight(timeSeconds);
  damageProtectedTulips();
  updateSecretGunPickup();
  prototypeAudio.setCuttingActive(grassCuttingAudioTimer > 0);
  prototypeAudio.setReversingActive(driveSpeed < -0.01 || currentThrottle < -0.05);
  prototypeAudio.update(camera, settings);
  scene.render();
});
