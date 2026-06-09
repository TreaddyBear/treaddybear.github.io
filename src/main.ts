import {
  Color3,
  DirectionalLight,
  Engine,
  HemisphericLight,
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
import {
  bladeCount,
  applyActiveMap,
  getActiveMap,
  mowerCutRadius,
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
import { createWind } from "./wind";
import { createDandelions } from "./dandelions";
import { createFenceSystem } from "./fence";
import { createGrass } from "./grass";
import { createHud } from "./hud";
import { createSettingsUi } from "./settingsUi";
import { createCameraRig } from "./cameraRig";
import { createMowerControl } from "./mowerControl";
import { isInsideSegments } from "./utils/yard";
import { createBiomeGroundMaterial, createFence, createMapGrounds, createRoad, createWorldTerrain, flowerBedHeightAt, sampledTerrainHeightAt, terrainHeightAt, updateBiomeGroundMaterialScale } from "./world";

const canvasElement = document.querySelector<HTMLCanvasElement>("#renderCanvas");
const scoreElement = document.querySelector<HTMLDivElement>("#score");
const mistakesElement = document.querySelector<HTMLDivElement>("#mistakes");
const mistakeMeterFillElement = document.querySelector<HTMLDivElement>("#mistakeMeterFill");
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

if (
  !canvasElement
  || !scoreElement
  || !mistakesElement
  || !mistakeMeterFillElement
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
) {
  throw new Error("Missing canvas, HUD, or settings element.");
}

const canvas = canvasElement;
const scoreEl = scoreElement;
const timerEl = timerElement;
const timeupEl = timeupElement;
const retryButtonEl = retryButtonElement;
const mistakesEl = mistakesElement;
const mistakeMeterFillEl = mistakeMeterFillElement;
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
const analogInput = createInputController(touchPadElement, touchKnobElement);

const engine = new Engine(canvas, true);
const scene = new Scene(engine);
const prototypeAudio = createPrototypeAudio();
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
let mouseTurn = 0;
let mouseSteeringActive = false;
let mouseSteeringPointer = false;
let hasSecretGun = false;
let shootCooldown = 0;
let elapsedRunSeconds = 0;
let fenceMistakeCount = 0;
let lastControllerShoot = false;
let lastCelebrationAdvance = false;
let lastCelebrationDismiss = false;
const loadingEl = document.querySelector<HTMLDivElement>("#loading");
const rockColliders: RockCollider[] = [];

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
  grass.mowUnderMower(0);
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
  const steepTerrainHit = !isInsideYard(nextPosition.x, nextPosition.z) && !isOnRoad(nextPosition.x) && slope > 0.72;

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
  const useKeyboard = activeInputMode === "keyboard" || activeInputMode === "mouse";
  // Mouse steering only when the player actually means it: explicit mouse mode,
  // or auto that resolved to keyboard on a desktop. A present controller/touch
  // resolves away from keyboard, so it no longer fights the mouse cursor.
  const useMouseSteering = (settings.inputMode === "mouse" || (settings.inputMode === "auto" && activeInputMode === "keyboard"))
    && mouseSteeringActive && mouseSteeringPointer && document.hasFocus() && !cameraRig.isDragging();
  // Scripted/AI control (window.mower, and a future bot): produces the same
  // turn/throttle a stick would, folded into the normal input below.
  const scripted = mowerControl.update(deltaSeconds);
  const keyboardTurn = useKeyboard ? (keys.has("d") ? 1 : 0) - (keys.has("a") ? 1 : 0) : 0;
  const controllerTurn = analogInput.controllerTurn;
  const touchTurn = analogInput.touchTurn;
  const analogTurn = Math.max(-1, Math.min(1, controllerTurn + touchTurn + scripted.turn + (useMouseSteering ? mouseTurn * 0.72 : 0)));
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
    playerYaw += scaledTurn * settings.turnMaxSpeed * deltaSeconds;
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

  currentThrottle = Math.max(-0.45, Math.min(1, currentThrottle + analogInput.throttle + scripted.throttle));

  const throttleActive = Math.abs(currentThrottle) > 0.05;
  const isBoosting = (useKeyboard && keys.has(" ")) || analogInput.boost;
  const targetSpeed = !throttleActive
    ? 0
    : settings.playerSpeed * (isBoosting ? settings.playerBoost : 1) * currentThrottle;

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
        }
      }

      prototypeAudio.playFenceBump(settings.wallBumpVolume, severity);
      bumpCooldown = 0.35;
    }
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
  mistakeMeterFill: mistakeMeterFillEl,
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
  updateCameraProjection: cameraRig.updateProjection,
  syncFenceHealth: () => fence.syncHealthLabels(),
});

settingsUi.setup();
settingsUi.setInputMode(settingsUi.detectInitialInputMode());
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

canvas.addEventListener("pointerenter", () => {
  mouseSteeringActive = true;
});

canvas.addEventListener("pointerleave", () => {
  mouseSteeringActive = false;
  mouseSteeringPointer = false;
  mouseTurn = 0;
});

canvas.addEventListener("pointermove", (event) => {
  if (cameraRig.dragTo(event.pointerId, event.clientX, event.clientY)) {
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
  cameraRig.beginDrag(event.pointerId, event.clientX, event.clientY);
  canvas.setPointerCapture(event.pointerId);
});

const endCameraDrag = (event: PointerEvent) => {
  cameraRig.endDrag(event.pointerId);
};

canvas.addEventListener("pointerup", endCameraDrag);
canvas.addEventListener("pointercancel", endCameraDrag);

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
  cameraRig.updateInput(deltaSeconds);
  movePlayer(deltaSeconds);
  fence.resolveOverlap();
  updatePlayerGroundPose(deltaSeconds);
  cameraRig.follow(deltaSeconds);
  grass.updateMotion(timeSeconds);
  wind.update(deltaSeconds);
  gunEffects.update(deltaSeconds);
  dandelions.update(deltaSeconds);
  updateCloudShadows(timeSeconds);
  grass.mowUnderMower(deltaSeconds);
  dandelions.mowAt(player.position.x, player.position.z, mowerCutRadius * mowerCutRadius);
  grass.updateHighlight(timeSeconds, deltaSeconds);

  if (tulips.update(player.position.x, player.position.z)) {
    hud.update();
  }

  updateSecretGunPickup();

  // Count elapsed play time only while the level is active. There is no hard
  // time-up fail state; time only affects the stars.
  if (!hud.isCelebrationVisible() && !hud.isTimeUpVisible()) {
    elapsedRunSeconds += deltaSeconds;
    hud.setTime(elapsedRunSeconds);
    hud.update();
  }

  prototypeAudio.setCuttingActive(grass.isCutting());
  prototypeAudio.setReversingActive(driveSpeed < -0.01 || currentThrottle < -0.05);
  prototypeAudio.update(camera, settings);
  scene.render();
});
