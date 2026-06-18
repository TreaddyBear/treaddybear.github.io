import {
  Color3,
  DirectionalLight,
  Engine,
  HemisphericLight,
  Matrix,
  Mesh,
  MeshBuilder,
  Quaternion,
  Scene,
  ShadowGenerator,
  StandardMaterial,
  TransformNode,
  Vector3,
} from "@babylonjs/core";
import { SSAO2RenderingPipeline } from "@babylonjs/core/PostProcesses/RenderPipeline/Pipelines/ssao2RenderingPipeline";
import "./style.css";
import { createPrototypeAudio } from "./audio";
import { createInputController } from "./input";
import type { InputMode } from "./input";
import {
  bladeCount,
  applyActiveMap,
  getActiveLevelCode,
  getActiveMap,
  lawnMaps,
  mowerCutRadius,
  normalizeLevelCode,
  playerFenceRadius,
  settings,
  yardSegments,
} from "./config";
import type { YardSegment } from "./config";
import type { RockCollider } from "./types";
import { createGrassyGroundTexture } from "./textures";
import { hexToColor3 } from "./utils/color";
import { createMaterials } from "./materials";
import { createSceneryRocks, createSimpleTrees } from "./scenery";
import { createGunEffects } from "./gunEffects";
import { createTulips } from "./tulips";
import { createWind, windDirection } from "./wind";
import { createDandelions } from "./dandelions";
import { createFenceSystem } from "./fence";
import { createGrass } from "./grass";
import { createHud } from "./hud";
import { createSettingsUi } from "./settingsUi";
import { createCameraRig } from "./cameraRig";
import { createMenu } from "./menu";
import { createMowerControl } from "./mowerControl";
import { renderingGroups } from "./renderOrder";
import { isInsideSegments } from "./utils/yard";
import {
  biomeHomeAmount,
  createBiomeGroundMaterial,
  createFence,
  createMapGrounds,
  createRoad,
  createRoadDirtOverlay,
  createWorldTerrain,
  fenceDirtAmountAt,
  roadVergeDirt,
  flowerBedHeightAt,
  sampledTerrainHeightAt,
  terrainHeightAt,
  updateBiomeGroundMaterialScale,
} from "./world";
import { getLevelBestStars, getMenuPreferences, recordLevelStars, setMenuPreference } from "./localSettings";

const canvasElement = document.querySelector<HTMLCanvasElement>("#renderCanvas");
const scoreElement = document.querySelector<HTMLDivElement>("#score");
const mistakesElement = document.querySelector<HTMLDivElement>("#mistakes");
const quickInputModeElement = document.querySelector<HTMLDivElement>("#quickInputMode");
const settingsElement = document.querySelector<HTMLDetailsElement>("#settings");
const fullscreenButtonElement = document.querySelector<HTMLButtonElement>("#fullscreenButton");
const celebrationElement = document.querySelector<HTMLDivElement>("#celebration");
const celebrationSeedsElement = document.querySelector<HTMLDivElement>("#celebrationSeeds");
const nextLevelButtonElement = document.querySelector<HTMLButtonElement>("#nextLevelButton");
const closeCelebrationButtonElement = document.querySelector<HTMLButtonElement>("#closeCelebrationButton");
const reportCardButtonElement = document.querySelector<HTMLButtonElement>("#reportCardButton");
const finishRunButtonElement = document.querySelector<HTMLButtonElement>("#finishRunButton");
const resultStarsElement = document.querySelector<HTMLDivElement>("#resultStars");
const resultStatsElement = document.querySelector<HTMLDivElement>("#resultStats");
const resultCoachElement = document.querySelector<HTMLDivElement>("#resultCoach");
const touchPadElement = document.querySelector<HTMLDivElement>("#touchPad");
const touchKnobElement = document.querySelector<HTMLDivElement>("#touchKnob");
const timerElement = document.querySelector<HTMLDivElement>("#timer");
const timeupElement = document.querySelector<HTMLDivElement>("#timeup");
const retryButtonElement = document.querySelector<HTMLButtonElement>("#retryButton");
const hintToastElement = document.querySelector<HTMLDivElement>("#hintToast");

if (
  !canvasElement
  || !scoreElement
  || !mistakesElement
  || !quickInputModeElement
  || !settingsElement
  || !fullscreenButtonElement
  || !celebrationElement
  || !celebrationSeedsElement
  || !nextLevelButtonElement
  || !closeCelebrationButtonElement
  || !reportCardButtonElement
  || !finishRunButtonElement
  || !resultStarsElement
  || !resultStatsElement
  || !resultCoachElement
  || !touchPadElement
  || !touchKnobElement
  || !timerElement
  || !timeupElement
  || !retryButtonElement
  || !hintToastElement
) {
  throw new Error("Missing canvas, HUD, or settings element.");
}

const canvas = canvasElement;
const scoreEl = scoreElement;
const timerEl = timerElement;
const timeupEl = timeupElement;
const retryButtonEl = retryButtonElement;
const hintToastEl = hintToastElement;
const mistakesEl = mistakesElement;
const quickInputModeEl = quickInputModeElement;
const settingsEl = settingsElement;
const fullscreenButtonEl = fullscreenButtonElement;
const celebrationEl = celebrationElement;
const celebrationSeedsEl = celebrationSeedsElement;
const nextLevelButtonEl = nextLevelButtonElement;
const closeCelebrationButtonEl = closeCelebrationButtonElement;
const reportCardButtonEl = reportCardButtonElement;
const finishRunButtonEl = finishRunButtonElement;
const resultStarsEl = resultStarsElement;
const resultStatsEl = resultStatsElement;
const resultCoachEl = resultCoachElement;
const cinematicWipeEl = document.createElement("div");
cinematicWipeEl.className = "cinematic-wipe-band";
cinematicWipeEl.hidden = true;
document.body.append(cinematicWipeEl);
const savedMenuPreferences = getMenuPreferences();
settings.inputMode = savedMenuPreferences.inputMode ?? settings.inputMode;
settings.mapId = savedMenuPreferences.lastLevelCode ?? settings.mapId;
settings.masterVolume = savedMenuPreferences.masterVolume ?? settings.masterVolume;
settings.muteOnBlur = savedMenuPreferences.muteOnBlur ?? settings.muteOnBlur;
settings.reverseSteerFlip = savedMenuPreferences.reverseSteerFlip ?? settings.reverseSteerFlip;
settings.showFps = savedMenuPreferences.showFps ?? settings.showFps;
settings.touchSplitControls = savedMenuPreferences.touchSplitControls ?? settings.touchSplitControls;
const analogInput = createInputController(touchPadElement, touchKnobElement);

window.addEventListener("dragstart", (event) => event.preventDefault());

const engine = new Engine(canvas, true);
const scene = new Scene(engine);
scene.setRenderingAutoClearDepthStencil(renderingGroups.transientEffects, false);
const prototypeAudio = createPrototypeAudio();
prototypeAudio.setMasterVolume(settings.masterVolume);
// Pause the game whenever the window loses focus; mute too if that's opted in.
let pausedByBlur = false;
window.addEventListener("blur", () => {
  pausedByBlur = true;
  if (settings.muteOnBlur) {
    prototypeAudio.setSuspended(true);
  }
});
window.addEventListener("focus", () => {
  pausedByBlur = false;
  prototypeAudio.setSuspended(false);
});
const perfEl = document.querySelector<HTMLDivElement>("#perf");
const useMobileRenderProfile = matchMedia("(pointer: coarse)").matches || window.innerWidth < 620;

if (useMobileRenderProfile) {
  settings.dynamicResolution = false;
  settings.targetFps = 30;
  settings.ssaoEnabled = false;
}

if (!import.meta.env.PROD) {
  settingsEl.hidden = false;
  (window as unknown as { __scene: Scene }).__scene = scene;

  if (perfEl) {
    perfEl.hidden = false;
  }
}

// PWA service worker — production only, so the dev server isn't shadowed by a
// cache. Registered at the site root (this is the user-pages root deployment).
if (import.meta.env.PROD && "serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => {});
  });
}

const keys = new Set<string>();
let player: Mesh;
let mapGroundRoot: TransformNode | null = null;
let fenceRoot: TransformNode | null = null;
let secretGunRoot: TransformNode | null = null;
let playerYaw = 0;
const playerRotationTarget = Quaternion.Identity();
let turnHoldSeconds = 0;
let lastTurnDirection = 0;
let currentThrottle = 0;
let driveSpeed = 0;
let bumpCooldown = 0;
let bumpPenaltyCooldown = 0;
let mouseDriveActive = false;
let mouseDrivePointerId = -1;
let mouseDriveOriginX = 0;
let mouseDriveOriginY = 0;
let mouseDriveTurn = 0;
let mouseDriveThrottle = 0;
let mouseDrivePeakDistance = 0;
let mouseDriveStartedAt = 0;
let hasSecretGun = false;
let shootCooldown = 0;
let elapsedRunSeconds = 0;
let fenceMistakeCount = 0;
let lastControllerShoot = false;
let lastCelebrationAdvance = false;
let lastCelebrationDismiss = false;
let dirtKickupDistance = 0;
const loadingEl = document.querySelector<HTMLDivElement>("#loading");
const rockColliders: RockCollider[] = [];
let gameStarted = false;
let sawDriveInput = false;
let hintToastTimer = 0;
let controlsHintTimer = 0;

// Imperative drive-the-mower layer (and a classic-AI hook later). Reads live
// vehicle state; its per-frame turn/throttle is folded into movePlayer below.
const mowerControl = createMowerControl({
  getState: () => ({ x: player.position.x, z: player.position.z, heading: playerYaw, speed: driveSpeed }),
});

// Dev/scripting hook. Intentionally exposed even in production: a determined
// desktop user could script the car from devtools anyway, and it gives us a
// clean handle for testing. Mobile players effectively can't reach it.
(window as unknown as { mower: unknown }).mower = {
  rotateBy: mowerControl.rotateBy,
  turnToHeading: mowerControl.turnToHeading,
  driveDistance: mowerControl.driveDistance,
  driveTo: mowerControl.driveTo,
  stop: mowerControl.stop,
  state: () => mowerControl.getState(),
};

scene.clearColor.set(0.66, 0.8, 0.96, 1);
scene.ambientColor = new Color3(0.05, 0.09, 0.16);
scene.imageProcessingConfiguration.exposure = 1.13;
scene.imageProcessingConfiguration.contrast = 1.12;
//scene.fogMode = Scene.FOGMODE_EXP2;
//scene.fogColor = new Color3(0.62, 0.76, 0.9);
//scene.fogDensity = 0.002;

const materials = createMaterials(scene);
const {
  playerMaterial,
  groundMaterial,
  bladeMaterial,
  cutBladeMaterial,
  dandelionStemMaterial,
  dandelionYellowMaterial,
  dandelionSeedMaterial,
  dandelionCenterMaterial,
  roadMaterial,
  stripeMaterial,
  fenceMaterial,
  worldGroundMaterial,
  secretGunMaterial,
  secretGunGripMaterial,
} = materials;

const gunEffects = createGunEffects(scene);
const tulips = createTulips(scene, materials, groundHeightAt);

function createHiddenGunProp() {
  const root = new TransformNode("hidden-gun-cache", scene);
  const x = -33.5;
  const z = -21.5;
  root.position = new Vector3(x, sampledTerrainHeightAt(x, z) - 0.03, z);
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
  hud.update();
}

function isInsideYard(x: number, z: number) {
  return isInsideSegments(yardSegments, x, z);
}

function isOnRoad(x: number) {
  return x > 11.8 && x < 17.2;
}

// Pop a big red-orange "x" (matching the accident HUD marks) at the world point
// of an accident, then fade it out. Projected to the screen each time it fires.
function showMistakeMark(world: Vector3) {
  const projected = Vector3.Project(
    world,
    Matrix.Identity(),
    scene.getTransformMatrix(),
    camera.viewport.toGlobal(canvas.clientWidth, canvas.clientHeight),
  );

  if (projected.z < 0 || projected.z > 1) {
    return; // behind the camera / outside the view
  }

  // Scatter the mark on a ring around the impact: a triangular spread over
  // 0..20% of the viewport, peaking near 10% (rarely right on the point or out at
  // the 20% edge).
  const angle = Math.random() * Math.PI * 2;
  const spread = ((Math.random() + Math.random()) / 2) * 0.2 * Math.min(window.innerWidth, window.innerHeight);

  const mark = document.createElement("div");
  mark.className = "mistake-x";
  mark.textContent = "×";
  mark.style.left = `${projected.x + (Math.cos(angle) * spread)}px`;
  mark.style.top = `${projected.y + (Math.sin(angle) * spread)}px`;
  document.body.appendChild(mark);
  mark.addEventListener("animationend", () => mark.remove(), { once: true });
}

function showHintToast(message: string, duration = 3200) {
  window.clearTimeout(hintToastTimer);
  hintToastEl.textContent = message;
  hintToastEl.hidden = false;
  hintToastTimer = window.setTimeout(() => {
    hintToastEl.hidden = true;
  }, duration);
}

function markDriveInput() {
  sawDriveInput = true;
  window.clearTimeout(controlsHintTimer);
  hintToastEl.hidden = true;
}

function showIntroHints() {
  const touchPrimary = matchMedia("(pointer: coarse)").matches && !matchMedia("(pointer: fine)").matches;
  showHintToast(touchPrimary ? "Menu lives in the top-right button" : "Esc opens the menu");
  controlsHintTimer = window.setTimeout(() => {
    if (sawDriveInput) {
      return;
    }

    showHintToast(touchPrimary ? "Use the thumbpad to mow" : "WASD to mow");
  }, 3600);
}

function flowerBedDirtAmountAt(x: number, z: number) {
  for (const bed of getActiveMap().flowerBeds) {
    if (x >= bed.xMin && x <= bed.xMax && z >= bed.zMin && z <= bed.zMax) {
      return 1;
    }
  }

  return 0;
}

function dirtAmountAt(x: number, z: number) {
  if (isOnRoad(x)) {
    return 0;
  }

  const biomeDirt = 1 - biomeHomeAmount(x, z);
  const fenceDirt = fenceDirtAmountAt(x, z, getActiveMap().fenceSegments);
  const flowerBedDirt = flowerBedDirtAmountAt(x, z);
  const roadDirt = roadVergeDirt(x, z); // the ~30 cm dirt band beside the road
  return Math.max(biomeDirt, fenceDirt, flowerBedDirt, roadDirt);
}

type DirtDustSensor = {
  x: number;
  z: number;
  outwardX: number;
  outwardZ: number;
  dirt: number;
};

function chooseDirtDustSensor(sensors: DirtDustSensor[]) {
  const total = sensors.reduce((sum, sensor) => sum + sensor.dirt, 0);
  let pick = Math.random() * total;

  for (const sensor of sensors) {
    pick -= sensor.dirt;

    if (pick <= 0) {
      return sensor;
    }
  }

  return sensors[sensors.length - 1];
}

function dirtDustCoverageUnderMower() {
  const forwardX = Math.sin(playerYaw);
  const forwardZ = Math.cos(playerYaw);
  const sideX = Math.cos(playerYaw);
  const sideZ = -Math.sin(playerYaw);
  const halfSide = player.scaling.x / 2;
  const halfForward = player.scaling.z / 2;
  const sampleSteps = 4;
  let totalDirt = 0;
  let sampleCount = 0;
  const sensors: DirtDustSensor[] = [];

  for (let forwardIndex = 0; forwardIndex <= sampleSteps; forwardIndex += 1) {
    const forwardT = (forwardIndex / sampleSteps) - 0.5;
    const localForward = forwardT * halfForward * 2;

    for (let sideIndex = 0; sideIndex <= sampleSteps; sideIndex += 1) {
      const sideT = (sideIndex / sampleSteps) - 0.5;
      const localSide = sideT * halfSide * 2;
      const x = player.position.x + (forwardX * localForward) + (sideX * localSide);
      const z = player.position.z + (forwardZ * localForward) + (sideZ * localSide);
      const dirt = dirtAmountAt(x, z);

      totalDirt += dirt;
      sampleCount += 1;
    }
  }

  const sensorCount = 16;
  let sensorDirtTotal = 0;

  for (let index = 0; index < sensorCount; index += 1) {
    const angle = (index / sensorCount) * Math.PI * 2;
    const localSide = Math.cos(angle) * halfSide * 0.92;
    const localForward = Math.sin(angle) * halfForward * 0.92;
    const outwardWorldX = (sideX * localSide) + (forwardX * localForward);
    const outwardWorldZ = (sideZ * localSide) + (forwardZ * localForward);
    const outwardLength = Math.sqrt((outwardWorldX * outwardWorldX) + (outwardWorldZ * outwardWorldZ));

    if (outwardLength < 0.0001) {
      continue;
    }

    const outwardX = outwardWorldX / outwardLength;
    const outwardZ = outwardWorldZ / outwardLength;
    const tangentX = -outwardZ;
    const tangentZ = outwardX;
    const x = player.position.x + outwardWorldX;
    const z = player.position.z + outwardWorldZ;
    const dirt = (dirtAmountAt(x, z) * 0.5)
      + (dirtAmountAt(x + (outwardX * 0.18), z + (outwardZ * 0.18)) * 0.25)
      + (dirtAmountAt(x - (outwardX * 0.12), z - (outwardZ * 0.12)) * 0.15)
      + (dirtAmountAt(x + (tangentX * 0.16), z + (tangentZ * 0.16)) * 0.05)
      + (dirtAmountAt(x - (tangentX * 0.16), z - (tangentZ * 0.16)) * 0.05);

    sensorDirtTotal += dirt;

    if (dirt > 0.025) {
      sensors.push({ x, z, outwardX, outwardZ, dirt });
    }
  }

  const averageBodyDirt = totalDirt / sampleCount;
  const averageSensorDirt = sensorDirtTotal / sensorCount;

  return {
    amount: Math.max(averageBodyDirt, averageSensorDirt * 0.9),
    sensors,
  };
}

function groundHeightAt(x: number, z: number) {
  const flowerBedHeight = flowerBedHeightAt(getActiveMap(), x, z);

  if (flowerBedHeight > 0) {
    return flowerBedHeight;
  }

  if (isInsideYard(x, z)) {
    return 0;
  }

  if (isOnRoad(x)) {
    return 0.006;
  }

  // Sit on the actual (coarse, linearly-interpolated) terrain mesh surface, not
  // the smooth analytic curve, so the mower and grass don't float on slopes.
  return sampledTerrainHeightAt(x, z) - 0.08;
}

type CinematicShot = {
  position: Vector3;
  target: Vector3;
  fov: number;
};

type CinematicFrame = {
  primary: CinematicShot;
  secondary: CinematicShot;
  mask: number;
  direction: number;
};

type ActiveMapBounds = {
  center: Vector3;
  radius: number;
  xMin: number;
  xMax: number;
  zMin: number;
  zMax: number;
};

type CinematicCarrier = {
  routeIndex: number;
  position: Vector3;
  positionVelocity: Vector3;
  positionForce: Vector3;
  target: Vector3;
  targetVelocity: Vector3;
  targetForce: Vector3;
  fov: number;
  fovVelocity: number;
  fovForce: number;
};

type CinematicIntent = {
  position: Vector3;
  forward: Vector3;
  lookDistance: number;
  lookLift: number;
  fov: number;
  clearance: number;
  positionMass: number;
  positionDrag: number;
  positionStiffness: number;
  positionMaxForce: number;
  gazeMass: number;
  gazeDrag: number;
  gazeStiffness: number;
  gazeMaxForce: number;
};

const CINEMATIC_FORCE_RESPONSE_SECONDS = 0.5;

function clamp01(value: number) {
  return Math.max(0, Math.min(1, value));
}

function mixNumber(a: number, b: number, amount: number) {
  return a + ((b - a) * amount);
}

function clampNumber(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function smootherstep01(value: number) {
  const t = clamp01(value);
  return t * t * t * (t * ((t * 6) - 15) + 10);
}

function seededUnit(seed: number) {
  const value = Math.sin(seed * 127.1) * 43758.5453123;
  return value - Math.floor(value);
}

function seededRange(seed: number, min: number, max: number) {
  return mixNumber(min, max, seededUnit(seed));
}

function angleVector(angle: number) {
  return { x: Math.cos(angle), z: Math.sin(angle) };
}

function flatDirection(x: number, z: number, fallback: Vector3) {
  const length = Math.hypot(x, z);
  if (length > 0.0001) {
    return new Vector3(x / length, 0, z / length);
  }
  const fallbackLength = Math.max(0.0001, Math.hypot(fallback.x, fallback.z));
  return new Vector3(fallback.x / fallbackLength, 0, fallback.z / fallbackLength);
}

function activeMapBounds(): ActiveMapBounds {
  const map = getActiveMap();
  let xMin = Infinity;
  let xMax = -Infinity;
  let zMin = Infinity;
  let zMax = -Infinity;

  for (const segment of map.segments) {
    xMin = Math.min(xMin, segment.xMin);
    xMax = Math.max(xMax, segment.xMax);
    zMin = Math.min(zMin, segment.zMin);
    zMax = Math.max(zMax, segment.zMax);
  }

  if (!Number.isFinite(xMin) || !Number.isFinite(xMax) || !Number.isFinite(zMin) || !Number.isFinite(zMax)) {
    return {
      center: map.spawn.clone(),
      radius: 16,
      xMin: map.spawn.x - 8,
      xMax: map.spawn.x + 8,
      zMin: map.spawn.z - 8,
      zMax: map.spawn.z + 8,
    };
  }

  const centerX = (xMin + xMax) / 2;
  const centerZ = (zMin + zMax) / 2;
  const width = Math.max(1, xMax - xMin);
  const depth = Math.max(1, zMax - zMin);
  const radius = Math.sqrt((width * width) + (depth * depth)) * 0.62;

  return { center: new Vector3(centerX, 0.55, centerZ), radius, xMin, xMax, zMin, zMax };
}

function vectorLength(vector: Vector3) {
  return Math.hypot(vector.x, vector.y, vector.z);
}

function clampVectorLength(vector: Vector3, maxLength: number) {
  const length = vectorLength(vector);
  if (length <= maxLength || length <= 0.000001) {
    return vector;
  }
  return vector.scale(maxLength / length);
}

function smoothCycle(progress: number) {
  return smootherstep01((1 - Math.cos(progress * Math.PI)) * 0.5);
}

function softWallForce(distance: number, range: number, strength: number) {
  if (distance >= range) {
    return 0;
  }
  const pressure = 1 - (distance / range);
  return pressure * pressure * strength;
}

function cinematicSafetyForce(position: Vector3, bounds: ActiveMapBounds, clearance: number) {
  const range = Math.max(3, Math.min(7, bounds.radius * 0.18));
  const force = Vector3.Zero();
  const groundClearance = position.y - (groundHeightAt(position.x, position.z) + clearance);

  force.x += softWallForce(position.x - bounds.xMin, range, 30);
  force.x -= softWallForce(bounds.xMax - position.x, range, 30);
  force.z += softWallForce(position.z - bounds.zMin, range, 30);
  force.z -= softWallForce(bounds.zMax - position.z, range, 30);
  force.y += softWallForce(groundClearance, range * 0.7, 48);

  return force;
}

function cinematicIntent(index: number, bounds: ActiveMapBounds, progress: number): CinematicIntent {
  const kind = index % 6;
  const seed = index + 1;
  const angle = seededRange(seed, 0, Math.PI * 2);
  const eased = smoothCycle(progress);
  const dir = angleVector(angle);
  const side = angleVector(angle + (Math.PI / 2));
  const center = bounds.center;

  if (kind === 1) {
    const orbit = Math.max(5, Math.min(bounds.radius * 0.52, (bounds.xMax - bounds.xMin) * 0.36, (bounds.zMax - bounds.zMin) * 0.36));
    const panAngle = angle + (eased * seededRange(seed + 20, 0.32, 0.48));
    const y = Math.max(11, bounds.radius * 0.72);
    return {
      position: new Vector3(center.x + (Math.cos(panAngle) * orbit), y, center.z + (Math.sin(panAngle) * orbit)),
      forward: flatDirection(-Math.sin(panAngle), Math.cos(panAngle), new Vector3(-dir.z, 0, dir.x)),
      lookDistance: 8.5,
      lookLift: -3.2,
      fov: 0.72,
      clearance: 7,
      positionMass: 4.8,
      positionDrag: 7.4,
      positionStiffness: 17,
      positionMaxForce: 44,
      gazeMass: 7.5,
      gazeDrag: 11.5,
      gazeStiffness: 5.8,
      gazeMaxForce: 10,
    };
  }

  if (kind === 2) {
    const height = Math.max(17, bounds.radius * 1.08);
    const pan = Math.min(5.2, bounds.radius * 0.26, (bounds.xMax - bounds.xMin) * 0.24, (bounds.zMax - bounds.zMin) * 0.24);
    const drift = mixNumber(-pan, pan, eased);
    return {
      position: new Vector3(center.x + (side.x * drift), height, center.z + (side.z * drift)),
      forward: flatDirection(side.x, side.z, new Vector3(side.x, 0, side.z)),
      lookDistance: 10,
      lookLift: -7.5,
      fov: 0.62,
      clearance: 12,
      positionMass: 5.6,
      positionDrag: 8.2,
      positionStiffness: 15,
      positionMaxForce: 38,
      gazeMass: 8.4,
      gazeDrag: 12.8,
      gazeStiffness: 4.6,
      gazeMaxForce: 8,
    };
  }

  if (kind === 3) {
    const height = Math.max(8, bounds.radius * 0.48);
    const orbit = Math.max(4.5, Math.min(bounds.radius * 0.34, (bounds.xMax - bounds.xMin) * 0.28, (bounds.zMax - bounds.zMin) * 0.28));
    const panAngle = angle + (eased * seededRange(seed + 30, 0.22, 0.36));
    return {
      position: new Vector3(center.x + (Math.cos(panAngle) * orbit), height, center.z + (Math.sin(panAngle) * orbit)),
      forward: flatDirection(-Math.sin(panAngle), Math.cos(panAngle), new Vector3(-dir.z, 0, dir.x)),
      lookDistance: 7.5,
      lookLift: -2.4,
      fov: 0.78,
      clearance: 5.4,
      positionMass: 5,
      positionDrag: 7.9,
      positionStiffness: 14,
      positionMaxForce: 34,
      gazeMass: 7.2,
      gazeDrag: 11.8,
      gazeStiffness: 5.4,
      gazeMaxForce: 9,
    };
  }

  if (kind === 4) {
    const height = Math.max(6.5, bounds.radius * 0.38);
    const travel = Math.max(4.5, Math.min(bounds.radius * 0.42, (bounds.xMax - bounds.xMin) * 0.3, (bounds.zMax - bounds.zMin) * 0.3));
    const lift = Math.sin(eased * Math.PI) * Math.max(1.2, bounds.radius * 0.08);
    const track = mixNumber(-travel, travel, eased);
    return {
      position: new Vector3(center.x + (side.x * track), height + lift, center.z + (side.z * track)),
      forward: flatDirection(side.x, side.z, new Vector3(side.x, 0, side.z)),
      lookDistance: 9,
      lookLift: -2.8,
      fov: 0.7,
      clearance: 5,
      positionMass: 6.4,
      positionDrag: 9.2,
      positionStiffness: 13,
      positionMaxForce: 32,
      gazeMass: 8.2,
      gazeDrag: 12.6,
      gazeStiffness: 4.8,
      gazeMaxForce: 8,
    };
  }

  if (kind === 5) {
    const height = Math.max(14, bounds.radius * 0.86);
    const orbit = Math.max(4.5, Math.min(bounds.radius * 0.24, (bounds.xMax - bounds.xMin) * 0.22, (bounds.zMax - bounds.zMin) * 0.22));
    const panAngle = angle + (Math.sin(eased * Math.PI * 0.5) * seededRange(seed + 50, 0.18, 0.28));
    return {
      position: new Vector3(center.x + (Math.cos(panAngle) * orbit), height, center.z + (Math.sin(panAngle) * orbit)),
      forward: flatDirection(-Math.sin(panAngle), Math.cos(panAngle), new Vector3(-dir.z, 0, dir.x)),
      lookDistance: 11,
      lookLift: -6.2,
      fov: 0.66,
      clearance: 10,
      positionMass: 6.2,
      positionDrag: 9,
      positionStiffness: 12,
      positionMaxForce: 30,
      gazeMass: 9,
      gazeDrag: 13.6,
      gazeStiffness: 4.2,
      gazeMaxForce: 7,
    };
  }

  const travel = Math.max(4, Math.min(bounds.radius * seededRange(seed + 10, 0.34, 0.52), (bounds.xMax - bounds.xMin) * 0.32, (bounds.zMax - bounds.zMin) * 0.32));
  const drift = Math.max(1.8, Math.min(bounds.radius * seededRange(seed + 20, 0.16, 0.28), (bounds.xMax - bounds.xMin) * 0.18, (bounds.zMax - bounds.zMin) * 0.18));
  const y = Math.max(3.4, bounds.radius * 0.25);
  const track = mixNumber(-travel, travel, eased);
  const sway = Math.sin(eased * Math.PI) * drift;
  const position = new Vector3(
    center.x + (dir.x * track) + (side.x * sway),
    y,
    center.z + (dir.z * track) + (side.z * sway),
  );
  return {
    position,
    forward: flatDirection(dir.x, dir.z, new Vector3(dir.x, 0, dir.z)),
    lookDistance: 8,
    lookLift: -0.6,
    fov: 0.72,
    clearance: 3.4,
    positionMass: 6,
    positionDrag: 8.6,
    positionStiffness: 16,
    positionMaxForce: 42,
    gazeMass: 7.8,
    gazeDrag: 12,
    gazeStiffness: 5.2,
    gazeMaxForce: 9,
  };
}

function createCinematicCarrier(routeIndex: number, bounds: ActiveMapBounds, progress: number): CinematicCarrier {
  const intent = cinematicIntent(routeIndex, bounds, progress);
  const initialTarget = intent.position.add(intent.forward.scale(intent.lookDistance)).add(new Vector3(0, intent.lookLift, 0));
  return {
    routeIndex,
    position: intent.position.clone(),
    positionVelocity: Vector3.Zero(),
    positionForce: Vector3.Zero(),
    target: initialTarget,
    targetVelocity: Vector3.Zero(),
    targetForce: Vector3.Zero(),
    fov: intent.fov,
    fovVelocity: 0,
    fovForce: 0,
  };
}

function moveForceToward(current: Vector3, desired: Vector3, maxChange: number) {
  const delta = desired.subtract(current);
  return current.add(clampVectorLength(delta, maxChange));
}

function moveForceNumberToward(current: number, desired: number, maxChange: number) {
  return current + clampNumber(desired - current, -maxChange, maxChange);
}

function forceStepVector(
  current: Vector3,
  velocity: Vector3,
  currentForce: Vector3,
  goal: Vector3,
  externalForce: Vector3,
  deltaSeconds: number,
  mass: number,
  drag: number,
  stiffness: number,
  maxForce: number,
) {
  const pull = goal.subtract(current).scale(stiffness);
  const resistance = velocity.scale(drag);
  const desiredForce = clampVectorLength(pull.subtract(resistance).add(externalForce), maxForce);
  const maxForceChange = (maxForce / CINEMATIC_FORCE_RESPONSE_SECONDS) * deltaSeconds;
  const force = moveForceToward(currentForce, desiredForce, maxForceChange);
  const acceleration = force.scale(1 / mass);
  const nextVelocity = velocity.add(acceleration.scale(deltaSeconds));
  return {
    value: current.add(nextVelocity.scale(deltaSeconds)),
    velocity: nextVelocity,
    force,
  };
}

function forceStepNumber(current: number, velocity: number, currentForce: number, goal: number, deltaSeconds: number) {
  const desiredForce = clampNumber(((goal - current) * 10) - (velocity * 5.8), -9, 9);
  const maxForceChange = (9 / CINEMATIC_FORCE_RESPONSE_SECONDS) * deltaSeconds;
  const force = moveForceNumberToward(currentForce, desiredForce, maxForceChange);
  const nextVelocity = velocity + (force * deltaSeconds);
  return {
    value: current + (nextVelocity * deltaSeconds),
    velocity: nextVelocity,
    force,
  };
}

function updateCinematicCarrier(carrier: CinematicCarrier, bounds: ActiveMapBounds, progress: number, deltaSeconds: number): CinematicShot {
  const intent = cinematicIntent(carrier.routeIndex, bounds, progress);
  const dt = Math.min(0.05, Math.max(0.001, deltaSeconds));
  const nextPosition = forceStepVector(
    carrier.position,
    carrier.positionVelocity,
    carrier.positionForce,
    intent.position,
    cinematicSafetyForce(carrier.position, bounds, intent.clearance),
    dt,
    intent.positionMass,
    intent.positionDrag,
    intent.positionStiffness,
    intent.positionMaxForce,
  );
  carrier.position = nextPosition.value;
  carrier.positionVelocity = nextPosition.velocity;
  carrier.positionForce = nextPosition.force;

  const motionDirection = flatDirection(
    carrier.positionVelocity.x + (intent.forward.x * 0.45),
    carrier.positionVelocity.z + (intent.forward.z * 0.45),
    intent.forward,
  );
  const gazeGoal = carrier.position
    .add(motionDirection.scale(intent.lookDistance))
    .add(new Vector3(0, intent.lookLift, 0));
  const nextTarget = forceStepVector(
    carrier.target,
    carrier.targetVelocity,
    carrier.targetForce,
    gazeGoal,
    Vector3.Zero(),
    dt,
    intent.gazeMass,
    intent.gazeDrag,
    intent.gazeStiffness,
    intent.gazeMaxForce,
  );
  carrier.target = nextTarget.value;
  carrier.targetVelocity = nextTarget.velocity;
  carrier.targetForce = nextTarget.force;

  const nextFov = forceStepNumber(carrier.fov, carrier.fovVelocity, carrier.fovForce, intent.fov, dt);
  carrier.fov = nextFov.value;
  carrier.fovVelocity = nextFov.velocity;
  carrier.fovForce = nextFov.force;

  return {
    position: carrier.position,
    target: carrier.target,
    fov: carrier.fov,
  };
}

let cinematicCurrentCarrier: CinematicCarrier | null = null;
let cinematicNextCarrier: CinematicCarrier | null = null;
let cinematicLastSegmentIndex = -1;
let cinematicLastLevelCode = "";

function activeMapCinematicFrame(timeSeconds: number, deltaSeconds: number): CinematicFrame {
  const bounds = activeMapBounds();
  const shotDuration = 13;
  const transitionDuration = 2.25;
  const preRoll = 0.5;
  const segmentDuration = shotDuration + transitionDuration;
  const segmentIndex = Math.floor(timeSeconds / segmentDuration);
  const segmentTime = timeSeconds - (segmentIndex * segmentDuration);
  const levelCode = getActiveLevelCode();
  const routeDuration = segmentDuration + preRoll;
  const currentProgress = (segmentTime + preRoll + transitionDuration) / routeDuration;
  const nextProgress = Math.max(0, (segmentTime - shotDuration + preRoll) / routeDuration);

  if (cinematicLastLevelCode !== levelCode) {
    cinematicCurrentCarrier = null;
    cinematicNextCarrier = null;
    cinematicLastSegmentIndex = -1;
    cinematicLastLevelCode = levelCode;
  }

  if (segmentIndex !== cinematicLastSegmentIndex) {
    if (cinematicNextCarrier?.routeIndex === segmentIndex) {
      cinematicCurrentCarrier = cinematicNextCarrier;
    } else {
      cinematicCurrentCarrier = null;
    }
    cinematicNextCarrier = null;
    cinematicLastSegmentIndex = segmentIndex;
  }

  cinematicCurrentCarrier ??= createCinematicCarrier(segmentIndex, bounds, currentProgress);
  if (cinematicCurrentCarrier.routeIndex !== segmentIndex) {
    cinematicCurrentCarrier = createCinematicCarrier(segmentIndex, bounds, currentProgress);
  }

  cinematicNextCarrier ??= createCinematicCarrier(segmentIndex + 1, bounds, nextProgress);
  if (cinematicNextCarrier.routeIndex !== segmentIndex + 1) {
    cinematicNextCarrier = createCinematicCarrier(segmentIndex + 1, bounds, nextProgress);
  }

  const primary = updateCinematicCarrier(cinematicCurrentCarrier, bounds, currentProgress, deltaSeconds);
  const secondary = updateCinematicCarrier(cinematicNextCarrier, bounds, nextProgress, deltaSeconds);

  if (segmentTime < shotDuration) {
    return {
      primary,
      secondary,
      mask: 1.2,
      direction: 1,
    };
  }

  const transitionProgress = smootherstep01((segmentTime - shotDuration) / transitionDuration);

  return {
    primary,
    secondary,
    mask: 1 - transitionProgress,
    direction: 1,
  };
}

function syncCinematicWipe(active: boolean, progress = 1) {
  cinematicWipeEl.hidden = false;
  cinematicWipeEl.style.setProperty("--wipe-x", `${Math.round(clamp01(progress) * window.innerWidth)}px`);
  cinematicWipeEl.classList.toggle("is-active", active);

  if (!active) {
    window.setTimeout(() => {
      if (!cinematicWipeEl.classList.contains("is-active")) {
        cinematicWipeEl.hidden = true;
      }
    }, 220);
  }
}

function snapPlayerToGround() {
  player.position.y = groundHeightAt(player.position.x, player.position.z);
}

function terrainNormalAt(x: number, z: number) {
  const sample = 0.42;
  const left = groundHeightAt(x - sample, z);
  const right = groundHeightAt(x + sample, z);
  const down = groundHeightAt(x, z - sample);
  const up = groundHeightAt(x, z + sample);
  return new Vector3(left - right, sample * 2, down - up).normalize();
}

function updatePlayerGroundPose(deltaSeconds: number, immediate = false) {
  if (!player.rotationQuaternion) {
    player.rotationQuaternion = Quaternion.Identity();
  }

  const normal = terrainNormalAt(player.position.x, player.position.z);
  const yawForward = new Vector3(Math.sin(playerYaw), 0, Math.cos(playerYaw));
  const forward = yawForward.subtract(normal.scale(Vector3.Dot(yawForward, normal)));

  if (forward.lengthSquared() < 0.0001) {
    forward.copyFrom(yawForward);
  }

  forward.normalize();
  Quaternion.FromLookDirectionLHToRef(forward, normal, playerRotationTarget);

  if (immediate) {
    player.rotationQuaternion.copyFrom(playerRotationTarget);
    return;
  }

  Quaternion.SlerpToRef(
    player.rotationQuaternion,
    playerRotationTarget,
    1 - Math.exp(-deltaSeconds * 7),
    player.rotationQuaternion,
  );
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


function resetGame() {
  applyActiveMap();
  hud.resetCelebration();
  mapGroundRoot?.dispose(false, true);
  fenceRoot?.dispose(false, true);
  fence.disposeHealthLabels();
  mapGroundRoot = createMapGrounds(scene, getActiveMap(), groundMaterial);
  fenceRoot = createFence(scene, fenceMaterial, getActiveMap().fenceSegments);
  // Fence planks + posts cast shadows (the flat dirt overlay does not).
  for (const mesh of scene.meshes) {
    if (mesh.name.includes("-plank-") || mesh.name.startsWith("fence-post")) {
      shadowGenerator.addShadowCaster(mesh);
    }
  }
  fence.rebuildStates();
  fence.syncHealthLabels();
  player.position = getActiveMap().spawn.clone();
  snapPlayerToGround();
  playerYaw = 0;
  updatePlayerGroundPose(0, true);
  cameraRig.reset();
  hasSecretGun = false;
  shootCooldown = 0;
  elapsedRunSeconds = 0;
  fenceMistakeCount = 0;
  hud.hideTimeUp();
  hud.setTime(elapsedRunSeconds);
  secretGunRoot?.setEnabled(true);
  grass.generate();
  dandelions.place();
  tulips.place();
  analogInput.cancelThrottle(); // a fresh level starts stopped, never at a held throttle
  grass.mowUnderMower(0);
  // Prime the per-frame grass motion once so the blades are already in their
  // wind/rest pose for the first render, instead of snapping from upright into
  // the swayed pose the moment the loop (or the mower) first moves.
  grass.updateMotion(0);
  dandelions.mowAt(player.position.x, player.position.z, mowerCutRadius * mowerCutRadius);
  hud.syncMistakesVisibility();
  hud.update();
}

// Mistakes stay visible in the star-scoring HUD even on maps where the count is
// usually zero, so the top UI keeps the same shape between levels.
function moveWithinYard(nextPosition: Vector3, movement: Vector3, impactSpeed: number) {
  if (settings.disableFenceCollision) {
    nextPosition.y = groundHeightAt(nextPosition.x, nextPosition.z);
    player.position.copyFrom(nextPosition);
    return -1;
  }

  const fenceHit = fence.collide(nextPosition.x, nextPosition.z);
  const rockHit = collidingRock(nextPosition.x, nextPosition.z);
  const currentGround = groundHeightAt(player.position.x, player.position.z);
  const nextGround = groundHeightAt(nextPosition.x, nextPosition.z);
  const horizontalDistance = Math.sqrt((movement.x * movement.x) + (movement.z * movement.z));
  const slope = horizontalDistance > 0.0001 ? Math.abs(nextGround - currentGround) / horizontalDistance : 0;
  const crossingBrokenOpening = fence.isNearBrokenOpening(player.position.x, player.position.z)
    || fence.isNearBrokenOpening(nextPosition.x, nextPosition.z);
  const steepTerrainHit = !crossingBrokenOpening
    && !isInsideYard(nextPosition.x, nextPosition.z)
    && !isOnRoad(nextPosition.x)
    && slope > 0.72;

  if (fenceHit.index < 0 && rockHit.index < 0 && !steepTerrainHit) {
    nextPosition.y = nextGround;
    player.position.copyFrom(nextPosition);
    return -1;
  }

  const bumpDirection = movement.lengthSquared() > 0.000001 ? movement.normalize() : new Vector3(Math.sin(playerYaw), 0, Math.cos(playerYaw));
  const maxImpactSpeed = settings.playerSpeed * settings.playerBoost;
  const speedRatio = Math.min(1, Math.abs(impactSpeed) / maxImpactSpeed);
  const bumpRatio = speedRatio <= 0.08 ? 0 : (speedRatio - 0.08) / 0.92;
  player.position.subtractInPlace(bumpDirection.scale(0.1 * bumpRatio));

  return fenceHit.index >= 0 ? fenceHit.index : -2;
}

function movePlayer(deltaSeconds: number) {
  const activeInputMode = settingsUi.effectiveInputMode();
  const useKeyboard = settings.inputMode === "auto" || activeInputMode === "keyboard" || activeInputMode === "mouse";
  // Mouse drive is opt-in per gesture: only a held left-drag on the canvas
  // contributes steering/throttle. Hovering the cursor never drives the mower.
  const useMouseDrive = (settings.inputMode === "auto" || settings.inputMode === "mouse")
    && mouseDriveActive && document.hasFocus() && !cameraRig.isDragging();
  // Scripted/AI control (window.mower, and a future bot): produces the same
  // turn/throttle a stick would, folded into the normal input below.
  const scripted = mowerControl.update(deltaSeconds);
  const keyboardTurn = useKeyboard ? (keys.has("d") ? 1 : 0) - (keys.has("a") ? 1 : 0) : 0;
  const controllerTurn = analogInput.controllerTurn;
  const touchTurn = analogInput.touchTurn;
  const analogTurn = Math.max(-1, Math.min(1, controllerTurn + touchTurn + scripted.turn + (useMouseDrive ? mouseDriveTurn * 0.72 : 0)));
  const turnDirection = Math.max(-1, Math.min(1, keyboardTurn + analogTurn));
  const turnSign = Math.sign(turnDirection);
  const shouldAccelerateTurn = keyboardTurn !== 0
    || Math.abs(controllerTurn) >= settings.controllerTurnAccelThreshold
    || Math.abs(touchTurn) >= settings.controllerTurnAccelThreshold
    || Math.abs(scripted.turn) >= 0.05;

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
    // Mirror steering when backing up so it behaves like a real steering wheel
    // (hold left while reversing -> the mower's rear tracks left), instead of the
    // turn feeling inverted in reverse. Based on actual travel, so a turn-in-place
    // at a standstill stays normal. The "flip" toggle restores the old un-mirrored
    // feel for players who prefer it.
    const reverseSteer = driveSpeed < -0.02 ? (settings.reverseSteerFlip ? 1 : -1) : 1;
    playerYaw += scaledTurn * settings.turnMaxSpeed * deltaSeconds * reverseSteer;
  } else {
    turnHoldSeconds = 0;
    lastTurnDirection = 0;
  }

  currentThrottle = 0;

  if (useKeyboard && keys.has("w")) {
    currentThrottle += 1;
  }

  if (useKeyboard && keys.has("s")) {
    currentThrottle -= 0.45;
  }

  currentThrottle = Math.max(-0.45, Math.min(1, currentThrottle + analogInput.throttle + scripted.throttle + (useMouseDrive ? mouseDriveThrottle : 0)));

  const throttleActive = Math.abs(currentThrottle) > 0.05;
  const isBoosting = (useKeyboard && keys.has(" ")) || analogInput.boost;
  const targetSpeed = !throttleActive
    ? 0
    : settings.playerSpeed * (isBoosting ? settings.playerBoost : 1) * currentThrottle;

  if (throttleActive || turnSign !== 0) {
    markDriveInput();
  }

  if (!throttleActive) {
    driveSpeed += (targetSpeed - driveSpeed) * Math.min(1, deltaSeconds * 7);
  } else {
    const targetMagnitude = Math.max(0.01, Math.abs(targetSpeed));
    const sameDirectionSpeed = Math.max(0, Math.sign(targetSpeed) * driveSpeed);
    const speedRatio = Math.min(1, sameDirectionSpeed / targetMagnitude);
    const torque = Math.max(settings.mowerMinTorque, 1 - (speedRatio * settings.mowerTorqueFade));
    const speedDelta = targetSpeed - driveSpeed;
    const speedStep = Math.sign(speedDelta) * settings.mowerAcceleration * torque * deltaSeconds;

    driveSpeed = Math.abs(speedStep) >= Math.abs(speedDelta) ? targetSpeed : driveSpeed + speedStep;
  }

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
      let severity: "soft" | "medium" | "hard" = "soft";
      if (hitFenceIndex >= 0) {
        const impact = fence.damagePiece(hitFenceIndex, impactSpeed);
        severity = impact.severity;

        // Only mistake-level crashes damage the fence. Slow and medium contacts
        // stop the mower and play feedback, but leave plank health untouched.
        if (impact.mistake && bumpPenaltyCooldown <= 0) {
          fenceMistakeCount += 1;
          elapsedRunSeconds += settings.fenceBumpTimePenalty;
          hud.setTime(elapsedRunSeconds);
          hud.update();
          bumpPenaltyCooldown = 1.5;
          // Big fading "x" right where the mower hit.
          const forward = new Vector3(Math.sin(playerYaw), 0, Math.cos(playerYaw));
          showMistakeMark(player.position.add(new Vector3(forward.x * 0.6, 0.5, forward.z * 0.6)));
        }
      }

      prototypeAudio.playFenceBump(settings.wallBumpVolume, severity);
      bumpCooldown = 0.35;
    }
  }
}

function updateMowerDirtKickup(deltaSeconds: number) {
  const speed = Math.abs(driveSpeed);
  const dustEmissionScale = Math.max(0, settings.dustEmissionScale);

  if (speed < 0.16 || dustEmissionScale <= 0) {
    dirtKickupDistance = 0;
    return;
  }

  const dirtCoverage = dirtDustCoverageUnderMower();

  if (dirtCoverage.amount < 0.018 || dirtCoverage.sensors.length === 0) {
    dirtKickupDistance = 0;
    return;
  }

  const maxSpeed = settings.playerSpeed * settings.playerBoost;
  const speedAmount = Math.min(1, speed / Math.max(0.01, maxSpeed));
  const burstDistance = 0.16;
  dirtKickupDistance += deltaSeconds * speed * dirtCoverage.amount * 2.25;
  let burstCount = 0;

  while (dirtKickupDistance >= burstDistance && burstCount < 2) {
    dirtKickupDistance -= burstDistance;
    burstCount += 1;
    const sensor = chooseDirtDustSensor(dirtCoverage.sensors);
    const strength = (0.24 + (sensor.dirt * 1.35)) * (0.5 + (speedAmount * 0.95));
    gunEffects.spawnMowerDirtDust(
      sensor.x,
      sensor.z,
      groundHeightAt(sensor.x, sensor.z),
      playerYaw,
      driveSpeed,
      strength,
      windDirection,
      new Vector3(sensor.outwardX, 0, sensor.outwardZ),
      dustEmissionScale,
    );
  }
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

  grass.cutAlongShot(origin, direction, range, (x, z) => gunEffects.spawnGrassFleck(x, z, direction));

  for (const hit of dandelions.damageAlongShot(origin, direction, range)) {
    gunEffects.spawnImpactDust(hit.x, hit.z, 0.75);
  }

  const tulipHits = tulips.damageAlongShot(origin, direction, range);
  for (const hit of tulipHits) {
    gunEffects.spawnImpactDust(hit.x, hit.z, 0.9);
  }

  if (tulipHits.length > 0) {
    hud.update();
  }

  const fenceHitDistance = fence.shootAlong(origin, direction, range);
  const tracerLength = fenceHitDistance ?? range;
  const impact = origin.add(direction.scale(tracerLength));
  gunEffects.spawnTracer(origin, direction, tracerLength);
  gunEffects.spawnImpactDust(impact.x, impact.z, fenceHitDistance === null ? 0.65 : 1.15);
}


function updateCloudShadows(timeSeconds: number) {
  const broad = 0.5 + (Math.sin((timeSeconds * 0.035) + 0.8) * 0.5);
  const detail = 0.5 + (Math.sin((timeSeconds * 0.083) - 1.7) * 0.5);
  const cloud = Math.max(0, ((broad * 0.75) + (detail * 0.25)) - 0.42) / 0.58;
  const shade = 1 - (cloud * 0.18);
  sun.intensity = baseSunIntensity * shade;
  sun.specular = baseSunSpecular.scale(1 - (cloud * 0.32));
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

// Softer, less dominant sky fill so the scene reads as direct sun rather than an
// overcast wash. Keeping it lower-intensity raises contrast (a sunny look).
const ambientLight = new HemisphericLight("ambientLight", new Vector3(0, 1, 0), scene);
ambientLight.intensity = settings.skyAmbientIntensity;
ambientLight.diffuse = new Color3(0.5, 0.68, 1);
ambientLight.groundColor = new Color3(0.22, 0.33, 0.5);

// A brighter, distinctly warm/yellow sun so highlights on the grass go golden
// instead of white.
const sun = new DirectionalLight("sun", new Vector3(-0.45, -1, 0.24), scene);
sun.position = new Vector3(10, 15, -7);
sun.intensity = 1.72;
sun.diffuse = new Color3(1, 0.95, 0.74);
sun.specular = new Color3(1, 0.91, 0.66);
const baseSunIntensity = sun.intensity;
const baseSunSpecular = sun.specular.clone();

const shadowMapSize = Math.min(useMobileRenderProfile ? 2048 : 8192, engine.getCaps().maxTextureSize);
const shadowGenerator = new ShadowGenerator(shadowMapSize, sun);
shadowGenerator.usePercentageCloserFiltering = true;
shadowGenerator.filteringQuality = ShadowGenerator.QUALITY_LOW;
shadowGenerator.bias = 0.00001;
shadowGenerator.normalBias = 0.001;
shadowGenerator.setDarkness(0.34);

const cameraRig = createCameraRig({
  scene,
  engine,
  keys,
  analogInput,
  getYaw: () => playerYaw,
  getPlayerPosition: () => player.position,
  getInputMode: () => settingsUi.effectiveInputMode(),
  perfEl,
});
const camera = cameraRig.camera;
let ssaoPipeline: SSAO2RenderingPipeline | null = null;
let ssaoPipelineScale = 0;
let ssaoPipelineBlurScale = 0;
let ssaoUnsupportedWarned = false;

function syncSsaoExcludedMaterials() {
  const excludedMaterials = scene.prePassRenderer?.excludedMaterials;

  if (!excludedMaterials) {
    return;
  }

  for (const material of [bladeMaterial, cutBladeMaterial]) {
    if (!excludedMaterials.includes(material)) {
      excludedMaterials.push(material);
    }
  }
}

function refreshLighting() {
  const skyColor = hexToColor3(settings.skyAmbientColor);
  ambientLight.intensity = settings.skyAmbientIntensity;
  ambientLight.diffuse = skyColor;
  ambientLight.groundColor = new Color3(
    0.1 + (skyColor.r * 0.22),
    0.13 + (skyColor.g * 0.26),
    0.08 + (skyColor.b * 0.34),
  );
  scene.ambientColor = new Color3(
    skyColor.r * settings.skyAmbientIntensity * 0.3,
    skyColor.g * settings.skyAmbientIntensity * 0.34,
    skyColor.b * settings.skyAmbientIntensity * 0.46,
  );

  if (!settings.ssaoEnabled) {
    ssaoPipeline?.dispose(false);
    ssaoPipeline = null;
    return;
  }

  if (!SSAO2RenderingPipeline.IsSupported) {
    if (!ssaoUnsupportedWarned) {
      console.warn("SSAO2RenderingPipeline is not supported by this browser/GPU.");
      ssaoUnsupportedWarned = true;
    }
    ssaoPipeline?.dispose(false);
    ssaoPipeline = null;
    return;
  }

  const ssaoScale = Math.max(0.25, Math.min(1, settings.ssaoScale));
  const blurScale = Math.max(0.25, Math.min(1, settings.ssaoBlurScale));

  if (!ssaoPipeline || ssaoPipelineScale !== ssaoScale || ssaoPipelineBlurScale !== blurScale) {
    ssaoPipeline?.dispose(false);
    ssaoPipeline = new SSAO2RenderingPipeline("ssao", scene, { ssaoRatio: ssaoScale, blurRatio: blurScale }, [camera]);
    ssaoPipelineScale = ssaoScale;
    ssaoPipelineBlurScale = blurScale;
  }

  syncSsaoExcludedMaterials();
  ssaoPipeline.totalStrength = settings.ssaoStrength;
  ssaoPipeline.radius = settings.ssaoRadius;
  ssaoPipeline.samples = Math.max(4, Math.min(24, Math.round(settings.ssaoSamples)));
  ssaoPipeline.maxZ = 70;
  ssaoPipeline.minZAspect = 0.22;
  ssaoPipeline.epsilon = 0.025;
  ssaoPipeline.expensiveBlur = true;
  ssaoPipeline.bilateralSamples = 12;
  ssaoPipeline.bilateralSoften = 0.55;
  ssaoPipeline.bilateralTolerance = 0.28;
  ssaoPipeline.textureSamples = 1;
}

refreshLighting();

const biomeGroundMaterial = createBiomeGroundMaterial(scene, settings.grassyTextureScale, settings.dirtTextureUScale, settings.dirtTextureVScale);
const worldTerrain = createWorldTerrain(scene, biomeGroundMaterial);

createSimpleTrees(scene, materials, shadowGenerator);
rockColliders.push(...createSceneryRocks(scene, materials, shadowGenerator));

createRoad(scene, roadMaterial, stripeMaterial);
const roadDirt = createRoadDirtOverlay(scene);
secretGunRoot = createHiddenGunProp();

player = MeshBuilder.CreateBox("player", { size: 1 }, scene);
player.material = playerMaterial;
player.scaling = new Vector3(0.85, 0.28, 1.1);
player.rotationQuaternion = Quaternion.Identity();
shadowGenerator.addShadowCaster(player);

const wind = createWind(scene, camera, player, () => playerYaw);
const dandelions = createDandelions(scene, materials, wind, () => playerYaw, () => prototypeAudio.playFlowerPop(settings.flowerPopVolume));
const fence = createFenceSystem(scene, player, () => playerYaw, groundHeightAt);
const grass = createGrass({
  scene,
  materials,
  player,
  getYaw: () => playerYaw,
  getThrottle: () => currentThrottle,
  groundHeightAt,
  fence,
  wind,
  onMowProgress: () => hud.update(),
});
grass.refreshMaterial();

const hud = createHud({
  score: scoreEl,
  timer: timerEl,
  mistakes: mistakesEl,
  celebration: celebrationEl,
  celebrationSeeds: celebrationSeedsEl,
  nextLevelButton: nextLevelButtonEl,
  closeCelebrationButton: closeCelebrationButtonEl,
  reportCardButton: reportCardButtonEl,
  finishRunButton: finishRunButtonEl,
  resultStars: resultStarsEl,
  resultStats: resultStatsEl,
  resultCoach: resultCoachEl,
  timeup: timeupEl,
  retryButton: retryButtonEl,
  loading: loadingEl,
  settingsRoot: settingsEl,
  getMowed: () => grass.mowedCount,
  getMistakes: () => tulips.mistakeCount + fenceMistakeCount,
  getFlowerMistakes: () => tulips.mistakeCount,
  getFenceMistakes: () => fenceMistakeCount,
  getElapsedSeconds: () => elapsedRunSeconds,
  isArmed: () => hasSecretGun,
  playFanfare: () => prototypeAudio.playCompletionFanfare(settings.completionFanfareVolume),
  setCompletionLoop: (active) => prototypeAudio.setCompletionLoopActive(active, settings),
  clearIsolatedGrass: () => grass.clearIsolatedBlades(),
  onRequestHelp: () => grass.requestHelp(),
  onRequestReset: resetGame,
  onRunComplete: ({ stars }) => {
    recordLevelStars(getActiveLevelCode(), stars);
  },
});

const settingsUi = createSettingsUi({
  settingsRoot: settingsEl,
  quickInput: quickInputModeEl,
  analogInput,
  onRegenerate: resetGame,
  refreshGrassColors: () => grass.refreshColors(),
  refreshGrassMaterial: () => grass.refreshMaterial(),
  refreshTextureScales,
  refreshGroundColor,
  refreshLighting,
  refreshLod: () => grass.refreshLod(),
  refreshRoadVerge: () => {
    roadDirt.rebuild();
    grass.rebuildSlatCover();
  },
  updateCameraProjection: cameraRig.updateProjection,
  syncFenceHealth: () => fence.syncHealthLabels(),
});

settingsUi.setup();
settingsUi.setInputMode(settings.inputMode as InputMode);
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

closeCelebrationButtonEl.addEventListener("click", () => hud.closeResultAction());
nextLevelButtonEl.addEventListener("click", () => hud.goToNextLevel());
reportCardButtonEl.addEventListener("click", () => hud.activateAssistAction());
finishRunButtonEl.addEventListener("click", () => hud.finishRun());
retryButtonEl.addEventListener("click", () => hud.retry());

canvas.addEventListener("contextmenu", (event) => {
  event.preventDefault();
});

function shapeMouseAxis(value: number) {
  const magnitude = Math.abs(value);

  if (magnitude < 0.08) {
    return 0;
  }

  const normalized = (magnitude - 0.08) / 0.92;
  return Math.sign(value) * Math.pow(normalized, 1.22);
}

function updateMouseDrive(event: PointerEvent) {
  const radius = 96;
  const dx = Math.max(-radius, Math.min(radius, event.clientX - mouseDriveOriginX));
  const dy = Math.max(-radius, Math.min(radius, event.clientY - mouseDriveOriginY));
  mouseDrivePeakDistance = Math.max(mouseDrivePeakDistance, Math.sqrt((dx * dx) + (dy * dy)));
  mouseDriveTurn = shapeMouseAxis(dx / radius);
  mouseDriveThrottle = Math.max(-0.45, Math.min(1, -dy / radius));
}

function endMouseDrive(event: PointerEvent, allowClickAction = true) {
  if (!mouseDriveActive || event.pointerId !== mouseDrivePointerId) {
    return false;
  }

  const clickDuration = performance.now() - mouseDriveStartedAt;
  const wasClick = mouseDrivePeakDistance < 5 && clickDuration < 260;
  mouseDriveActive = false;
  mouseDrivePointerId = -1;
  mouseDriveTurn = 0;
  mouseDriveThrottle = 0;

  if (canvas.hasPointerCapture(event.pointerId)) {
    canvas.releasePointerCapture(event.pointerId);
  }

  if (allowClickAction && wasClick) {
    shootSecretGun();
  }

  return true;
}

canvas.addEventListener("pointermove", (event) => {
  if (cameraRig.dragTo(event.pointerId, event.clientX, event.clientY)) {
    return;
  }

  if (!mouseDriveActive || event.pointerId !== mouseDrivePointerId || event.pointerType !== "mouse") {
    return;
  }

  updateMouseDrive(event);
});

canvas.addEventListener("pointerdown", (event) => {
  if (
    event.button === 0
    && event.pointerType === "mouse"
    && (settings.inputMode === "auto" || settings.inputMode === "mouse")
  ) {
    event.preventDefault();
    mouseDriveActive = true;
    mouseDrivePointerId = event.pointerId;
    mouseDriveOriginX = event.clientX;
    mouseDriveOriginY = event.clientY;
    mouseDriveTurn = 0;
    mouseDriveThrottle = 0;
    mouseDrivePeakDistance = 0;
    mouseDriveStartedAt = performance.now();
    canvas.setPointerCapture(event.pointerId);
    markDriveInput();
    return;
  }

  if (event.button !== 2) {
    return;
  }

  event.preventDefault();
  cameraRig.beginDrag(event.pointerId, event.clientX, event.clientY);
  canvas.setPointerCapture(event.pointerId);
});

const endCameraDrag = (event: PointerEvent) => {
  if (endMouseDrive(event)) {
    return;
  }

  cameraRig.endDrag(event.pointerId);
};

canvas.addEventListener("pointerup", endCameraDrag);
canvas.addEventListener("pointercancel", (event) => {
  if (endMouseDrive(event, false)) {
    return;
  }

  cameraRig.endDrag(event.pointerId);
});

canvas.addEventListener("wheel", (event) => {
  if (settings.inputMode === "touch") {
    return;
  }

  event.preventDefault();
  cameraRig.zoom(event.deltaY);
}, { passive: false });

document.addEventListener("fullscreenchange", () => {
  fullscreenButtonEl.textContent = document.fullscreenElement ? "Exit full screen" : "Full screen";
  engine.resize();
  cameraRig.updateProjection();
});

// Pause/start menu. Esc toggles it on desktop; on touch a hamburger button
// (shown by createMenu) opens it. Opening pauses the sim (render loop checks
// menu.isOpen) and clears held keys so the mower doesn't drift on resume.
const isTouchPrimary = matchMedia("(pointer: coarse)").matches && !matchMedia("(pointer: fine)").matches;
let syncGameplayInputVisibility = () => analogInput.setGameplayActive(false);
const loadSelectedLevel = (code: string) => {
  const levelCode = normalizeLevelCode(code);
  settings.mapId = levelCode;
  setMenuPreference("lastLevelCode", levelCode);
  const mapControl = settingsEl.querySelector<HTMLSelectElement>("#mapId");

  if (mapControl) {
    mapControl.value = levelCode;
  }

  resetGame();
};

const menu = createMenu({
  toggleFullscreen: () => fullscreenButtonEl.click(),
  getInputMode: () => settings.inputMode as InputMode,
  setInputMode: (mode) => settingsUi.setInputMode(mode),
  getLevels: () => lawnMaps.map((map) => ({
    code: map.code,
    name: map.name,
    bestStars: getLevelBestStars(map.code),
  })).filter((level, index, levels) => (
    index === 0 || levels[index - 1].bestStars > 0
  )),
  getCurrentLevelCode: () => getActiveLevelCode(),
  onPreviewLevel: (code) => {
    if (!gameStarted) {
      loadSelectedLevel(code);
    }
  },
  onSelectLevel: (code) => {
    loadSelectedLevel(code);
  },
  isTouch: isTouchPrimary,
  onTouchControlsChange: () => analogInput.syncTouchControls(),
  onMasterVolume: (value) => prototypeAudio.setMasterVolume(value),
  onOpen: () => {
    keys.clear();
    analogInput.cancelThrottle();
    analogInput.setGameplayActive(false);
    prototypeAudio.setMenuDucked(true);
  },
  onClose: () => {
    prototypeAudio.setMenuDucked(false);

    if (gameStarted) {
      syncGameplayInputVisibility();
      return;
    }

    gameStarted = true;
    menu.setStartMode(false);
    syncGameplayInputVisibility();
    showIntroHints();
  },
});
syncGameplayInputVisibility = () => {
  analogInput.setGameplayActive(
    gameStarted
    && !menu.isOpen()
    && !hud.isCelebrationVisible()
    && !hud.isTimeUpVisible(),
  );
  document.body.classList.toggle("cinematic-menu-mode", menu.isOpen() && !gameStarted);
};
menu.setStartMode(true);
menu.open();
syncGameplayInputVisibility();

window.addEventListener("keydown", (event) => {
  const key = event.key.toLowerCase();

  // The completion / time-up cards are modal: let the keyboard act on them
  // before any key falls through to mower driving.
  if (hud.isTimeUpVisible()) {
    if (key === "enter" || key === " ") {
      event.preventDefault();
      hud.retry();
    }

    return;
  }

  if (hud.isCelebrationVisible()) {
    if (key === "enter" || key === " ") {
      event.preventDefault();
      hud.activatePrimaryAction();
    } else if (key === "escape") {
      event.preventDefault();
      hud.closeResultAction();
    }

    return;
  }

  if (key === "escape") {
    event.preventDefault();
    menu.toggle();
    return;
  }

  // While the menu is open it owns the keyboard; don't drive the mower.
  if (menu.isOpen()) {
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
  cameraRig.updateProjection();
});

engine.runRenderLoop(() => {
  const deltaSeconds = engine.getDeltaTime() / 1000;
  const timeSeconds = performance.now() / 1000;
  syncGameplayInputVisibility();

  bumpCooldown = Math.max(0, bumpCooldown - deltaSeconds);
  bumpPenaltyCooldown = Math.max(0, bumpPenaltyCooldown - deltaSeconds);
  shootCooldown = Math.max(0, shootCooldown - deltaSeconds);
  cameraRig.updateAdaptiveResolution(deltaSeconds);
  settingsUi.applyActiveInputMode();

  const gamepad = navigator.getGamepads().find(Boolean);

  // The completion / time-up cards are DOM, which a gamepad can't focus, so
  // drive them directly: A advances/retries, B closes the win card.
  // Edge-triggered so a held button doesn't skip through screens.
  if (hud.isTimeUpVisible()) {
    const retry = Boolean(gamepad?.buttons[0]?.pressed);

    if (retry && !lastCelebrationAdvance) {
      hud.retry();
    }

    lastCelebrationAdvance = retry;
    lastCelebrationDismiss = Boolean(gamepad?.buttons[1]?.pressed);
  } else if (hud.isCelebrationVisible()) {
    const advance = Boolean(gamepad?.buttons[0]?.pressed);
    const dismiss = Boolean(gamepad?.buttons[1]?.pressed);

    if (advance && !lastCelebrationAdvance) {
      hud.activatePrimaryAction();
    } else if (dismiss && !lastCelebrationDismiss) {
      hud.closeResultAction();
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

  // Paused: render the frozen frame behind the menu, run no simulation — but keep
  // the grass swaying in the wind so it doesn't snap to a new wind phase the
  // instant the menu closes (timeSeconds keeps advancing while paused).
  if (menu.isOpen() || pausedByBlur) {
    grass.updateMotion(timeSeconds);
    if (menu.isOpen() && !gameStarted) {
      const frame = activeMapCinematicFrame(timeSeconds, deltaSeconds);
      cameraRig.renderCinematicComposite(frame.primary, frame.secondary, frame.mask, frame.direction);
      syncCinematicWipe(false);
      return;
    } else {
      syncCinematicWipe(false);
    }
    scene.render();
    return;
  }
  syncCinematicWipe(false);

  cameraRig.updateInput(deltaSeconds);
  movePlayer(deltaSeconds);
  fence.resolveOverlap();
  updatePlayerGroundPose(deltaSeconds);
  updateMowerDirtKickup(deltaSeconds);
  cameraRig.follow(deltaSeconds);
  grass.updateMotion(timeSeconds);
  wind.update(deltaSeconds);
  gunEffects.update(deltaSeconds);
  dandelions.update(deltaSeconds);
  updateCloudShadows(timeSeconds);
  grass.mowUnderMower(deltaSeconds);
  dandelions.mowAt(player.position.x, player.position.z, mowerCutRadius * mowerCutRadius);
  grass.updateHighlight(timeSeconds, deltaSeconds);

  const flowerMistakesBefore = tulips.mistakeCount;
  if (tulips.update(player.position.x, player.position.z)) {
    hud.update();
  }
  if (tulips.mistakeCount > flowerMistakesBefore) {
    // Mowed a flower — same big fading "x" as a fence bump, at the mower.
    showMistakeMark(new Vector3(player.position.x, player.position.y + 0.5, player.position.z));
  }

  updateSecretGunPickup();

  // Count elapsed play time only while the level is active. There is no hard
  // time-up fail state; time only affects the stars.
  if (!hud.isCelebrationVisible() && !hud.isTimeUpVisible()) {
    elapsedRunSeconds += deltaSeconds;
    hud.setTime(elapsedRunSeconds);
    hud.update();
  } else {
    analogInput.cancelThrottle(); // end card up: drop any held throttle so the mower stops
  }
  syncGameplayInputVisibility();

  prototypeAudio.setCuttingActive(grass.isCutting());
  prototypeAudio.setReversingActive(driveSpeed < -0.01 || currentThrottle < -0.05);
  prototypeAudio.update(camera, settings);
  scene.render();
});
