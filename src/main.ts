import {
  ArcRotateCamera,
  Camera,
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
import "./style.css";
import { createPrototypeAudio } from "./audio";
import { createInputController, InputMode } from "./input";
import {
  bladeCount,
  applyActiveMap,
  getActiveMap,
  mowerCutRadius,
  playerBoost,
  playerFenceRadius,
  playerSpeed,
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
import { createWind } from "./wind";
import { createDandelions } from "./dandelions";
import { createFenceSystem } from "./fence";
import { createGrass } from "./grass";
import { isInsideSegments } from "./utils/yard";
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
let player: Mesh;
let mapGroundRoot: TransformNode | null = null;
let fenceRoot: TransformNode | null = null;
let secretGunRoot: TransformNode | null = null;
let playerYaw = 0;
let turnHoldSeconds = 0;
let lastTurnDirection = 0;
let currentThrottle = 0;
let driveSpeed = 0;
let bumpCooldown = 0;
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
const loadingEl = document.querySelector<HTMLDivElement>("#loading");
// Adaptive-resolution state: seconds since last FPS sample and the current
// engine hardware-scaling level (1 = native; higher = render at lower res).
let perfSampleTime = 0;
let currentHardwareScale = 1;
// True when the viewport is taller than wide (phones in portrait), which uses a
// tighter, steeper, mower-forward camera framing. Landscape is left untouched.
let isPortrait = false;
const cameraDrag = {
  active: false,
  pointerId: -1,
  lastX: 0,
  lastY: 0,
};
const rockColliders: RockCollider[] = [];

scene.clearColor.set(0.66, 0.8, 0.96, 1);
scene.imageProcessingConfiguration.exposure = 1.08;
scene.imageProcessingConfiguration.contrast = 1.12;
//scene.fogMode = Scene.FOGMODE_EXP2;
//scene.fogColor = new Color3(0.62, 0.76, 0.9);
//scene.fogDensity = 0.002;

const materials = createMaterials(scene);
const {
  playerMaterial,
  groundMaterial,
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
const tulips = createTulips(scene, materials);

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
  const percentage = grass.mowedCount === bladeCount ? 100 : Math.floor((grass.mowedCount / bladeCount) * 100);
  scoreEl.textContent = `Mowed: ${percentage}%`;
  if (hasSecretGun) {
    scoreEl.textContent += " | Armed";
  }
  meterFillEl.style.width = `${(grass.mowedCount / bladeCount) * 100}%`;
  mistakesEl.textContent = `Mistakes: ${tulips.mistakeCount}`;
  mistakeMeterFillEl.style.width = `${Math.min(100, tulips.mistakeCount * 12)}%`;

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
  resetCelebration();
  mapGroundRoot?.dispose(false, true);
  fenceRoot?.dispose(false, true);
  fence.disposeHealthLabels();
  mapGroundRoot = createMapGrounds(scene, getActiveMap(), groundMaterial);
  fenceRoot = createFence(scene, fenceMaterial, getActiveMap().fenceSegments);
  fence.rebuildStates();
  fence.syncHealthLabels();
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
  hasSecretGun = false;
  shootCooldown = 0;
  secretGunRoot?.setEnabled(true);
  grass.generate();
  dandelions.place();
  tulips.place();
  grass.mowUnderMower(0);
  dandelions.mowAt(player.position.x, player.position.z, mowerCutRadius * mowerCutRadius);
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

  const fenceHit = fence.collide(nextPosition.x, nextPosition.z);
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
        fence.damagePiece(hitFenceIndex, impactSpeed);
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
    updateHud();
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
    "portraitFov",
    "portraitDistance",
    "portraitHeight",
    "portraitLookAhead",
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
        grass.refreshColors();
      } else if ([
        "grassRoughness",
        "grassMetallic",
        "grassClearCoat",
        "cutGrassRoughness",
        "cutGrassMetallic",
        "cutGrassClearCoat",
      ].includes(id)) {
        grass.refreshMaterial();
      } else if ([
        "grassyTextureScale",
        "dirtTextureUScale",
        "dirtTextureVScale",
        "dirtNormalStrength",
        "roadTextureUScale",
        "roadTextureVScale",
      ].includes(id)) {
        refreshTextureScales();
      } else if (id === "portraitFov") {
        updateCameraProjection();
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
        grass.refreshColors();
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
        fence.syncHealthLabels();
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
  isPortrait = aspect < 1;

  if (isPortrait) {
    // Portrait (phones): fix the HORIZONTAL field of view so left/right stay
    // visible without the slit you get from a vertical-fixed FOV on a tall
    // window. The framing (zoom/angle) is handled by the follow camera.
    camera.fovMode = Camera.FOVMODE_HORIZONTAL_FIXED;
    camera.fov = settings.portraitFov;
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
createSimpleTrees(scene, materials, shadowGenerator);
rockColliders.push(...createSceneryRocks(scene, materials, shadowGenerator));

createRoad(scene, roadMaterial, stripeMaterial);
secretGunRoot = createHiddenGunProp();

player = MeshBuilder.CreateBox("player", { size: 1 }, scene);
player.material = playerMaterial;
player.scaling = new Vector3(0.85, 0.28, 1.1);
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
  onMowProgress: updateHud,
});
grass.refreshMaterial();

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

  bumpCooldown = Math.max(0, bumpCooldown - deltaSeconds);
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
  fence.resolveOverlap();
  const baseDistance = isPortrait ? settings.portraitDistance : 7.2;
  const baseHeight = isPortrait ? settings.portraitHeight : 4.2;
  const lookAhead = isPortrait ? settings.portraitLookAhead : 0;
  updateFollowCamera(camera, player.position, playerYaw, deltaSeconds, cameraOrbitYaw, cameraOrbitHeight, cameraDistanceOffset, baseDistance, baseHeight, lookAhead);
  grass.updateMotion(timeSeconds);
  wind.update(deltaSeconds);
  gunEffects.update(deltaSeconds);
  dandelions.update(deltaSeconds);
  updateCloudShadows(timeSeconds);
  grass.mowUnderMower(deltaSeconds);
  dandelions.mowAt(player.position.x, player.position.z, mowerCutRadius * mowerCutRadius);
  grass.updateHighlight(timeSeconds);

  if (tulips.update(player.position.x, player.position.z)) {
    updateHud();
  }

  updateSecretGunPickup();
  prototypeAudio.setCuttingActive(grass.isCutting());
  prototypeAudio.setReversingActive(driveSpeed < -0.01 || currentThrottle < -0.05);
  prototypeAudio.update(camera, settings);
  scene.render();
});
