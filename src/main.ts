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
  VertexBuffer,
  VertexData,
  Vector3,
} from "@babylonjs/core";
import "./style.css";

const canvasElement = document.querySelector<HTMLCanvasElement>("#renderCanvas");
const scoreElement = document.querySelector<HTMLDivElement>("#score");
const meterFillElement = document.querySelector<HTMLDivElement>("#meterFill");
const settingsElement = document.querySelector<HTMLDetailsElement>("#settings");

if (!canvasElement || !scoreElement || !meterFillElement || !settingsElement) {
  throw new Error("Missing canvas, HUD, or settings element.");
}

const canvas = canvasElement;
const scoreEl = scoreElement;
const meterFillEl = meterFillElement;
const settingsEl = settingsElement;

const engine = new Engine(canvas, true);
const scene = new Scene(engine);

const keys = new Set<string>();
const grassGrid = new Map<string, number[]>();
let player: Mesh;
let longGrass: Mesh;
let cutGrass: Mesh;
let longGrassMatrices: Float32Array;
let cutGrassMatrices: Float32Array;
let longGrassColors: Float32Array;
let cutGrassColors: Float32Array;
let grassX: Float32Array;
let grassZ: Float32Array;
let grassRotation: Float32Array;
let grassScale: Float32Array;
let grassNoise: Float32Array;
let grassPhase: Float32Array;
let cutTiltX: Float32Array;
let cutTiltZ: Float32Array;
let isMowed: boolean[];
let mowedCount = 0;
let playerYaw = 0;
let turnHoldSeconds = 0;
let lastTurnDirection = 0;
let currentThrottle = 0;
const windWisps: WindWisp[] = [];
const windMotes: WindMote[] = [];

const playerSpeed = 1.65;
const playerBoost = 1.45;
const turnSpeed = 2.6;
const playerRadius = 0.75;
const bladeCount = 30000;
const cellSize = 1;
const settings = {
  minHeight: 0.38,
  maxHeight: 0.76,
  clumpStrength: 0.55,
  heightRandomness: 0.2,
  windStrength: 0.1,
  bendStrength: 0.18,
  turnBuild: 0.65,
  grassBaseColor: "#2f7d23",
  hueVariance: 0.035,
  satVariance: 0.18,
  lightVariance: 0.16,
  cutGrassColor: "#48a329",
  groundColor: "#6b8014",
};
const yardSegments = [
  { xMin: -9, xMax: 9, zMin: -9, zMax: 2, width: 18, height: 11, center: new Vector3(0, 0, -3.5) },
  { xMin: -9, xMax: 0, zMin: 2, zMax: 9, width: 9, height: 7, center: new Vector3(-4.5, 0, 5.5) },
];

type YardSegment = (typeof yardSegments)[number];
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

scene.clearColor.set(0.62, 0.76, 0.9, 1);
scene.fogMode = Scene.FOGMODE_EXP2;
scene.fogColor = new Color3(0.62, 0.76, 0.9);
scene.fogDensity = 0.002;

function makeMaterial(name: string, color: Color3, roughness = 0.65) {
  const material = new PBRMaterial(name, scene);
  material.albedoColor = color;
  material.roughness = roughness;
  material.metallic = 0;
  return material;
}

const playerMaterial = makeMaterial("playerMaterial", new Color3(0.08, 0.36, 0.95), 0.42);
const groundMaterial = makeMaterial("groundMaterial", new Color3(0.42, 0.5, 0.08), 0.9);
const bladeMaterial = makeMaterial("bladeMaterial", Color3.White(), 0.85);
bladeMaterial.backFaceCulling = false;
const cutBladeMaterial = makeMaterial("cutBladeMaterial", Color3.White(), 0.92);
cutBladeMaterial.backFaceCulling = false;

function hexToColor3(hex: string) {
  const value = hex.replace("#", "");
  const red = Number.parseInt(value.slice(0, 2), 16) / 255;
  const green = Number.parseInt(value.slice(2, 4), 16) / 255;
  const blue = Number.parseInt(value.slice(4, 6), 16) / 255;
  return new Color3(red, green, blue);
}

function mixColor(a: Color3, b: Color3, amount: number) {
  return new Color3(
    a.r + ((b.r - a.r) * amount),
    a.g + ((b.g - a.g) * amount),
    a.b + ((b.b - a.b) * amount),
  );
}

function color3ToHsl(color: Color3) {
  const max = Math.max(color.r, color.g, color.b);
  const min = Math.min(color.r, color.g, color.b);
  const lightness = (max + min) / 2;

  if (max === min) {
    return { h: 0, s: 0, l: lightness };
  }

  const delta = max - min;
  const saturation = lightness > 0.5 ? delta / (2 - max - min) : delta / (max + min);
  let hue = 0;

  if (max === color.r) {
    hue = ((color.g - color.b) / delta) + (color.g < color.b ? 6 : 0);
  } else if (max === color.g) {
    hue = ((color.b - color.r) / delta) + 2;
  } else {
    hue = ((color.r - color.g) / delta) + 4;
  }

  return { h: hue / 6, s: saturation, l: lightness };
}

function hslToColor3(hue: number, saturation: number, lightness: number) {
  const h = ((hue % 1) + 1) % 1;
  const s = Math.min(1, Math.max(0, saturation));
  const l = Math.min(1, Math.max(0, lightness));

  if (s === 0) {
    return new Color3(l, l, l);
  }

  const q = l < 0.5 ? l * (1 + s) : l + s - (l * s);
  const p = (2 * l) - q;
  const toRgb = (t: number) => {
    const wrapped = ((t % 1) + 1) % 1;

    if (wrapped < 1 / 6) return p + ((q - p) * 6 * wrapped);
    if (wrapped < 1 / 2) return q;
    if (wrapped < 2 / 3) return p + ((q - p) * ((2 / 3) - wrapped) * 6);
    return p;
  };

  return new Color3(toRgb(h + (1 / 3)), toRgb(h), toRgb(h - (1 / 3)));
}

function randomHash(x: number, z: number) {
  const value = Math.sin((x * 127.1) + (z * 311.7)) * 43758.5453123;
  return value - Math.floor(value);
}

function smoothstep(value: number) {
  return value * value * (3 - (2 * value));
}

function valueNoise(x: number, z: number) {
  const x0 = Math.floor(x);
  const z0 = Math.floor(z);
  const tx = smoothstep(x - x0);
  const tz = smoothstep(z - z0);
  const a = randomHash(x0, z0);
  const b = randomHash(x0 + 1, z0);
  const c = randomHash(x0, z0 + 1);
  const d = randomHash(x0 + 1, z0 + 1);
  const top = a + ((b - a) * tx);
  const bottom = c + ((d - c) * tx);
  return top + ((bottom - top) * tz);
}

function grassNoiseAt(x: number, z: number) {
  const broad = valueNoise(x * 0.18, z * 0.18);
  const detail = valueNoise((x * 0.9) + 31, (z * 0.9) - 17);
  return Math.min(1, Math.max(0, (broad * 0.78) + (detail * 0.22)));
}

function makeLongBladeMesh() {
  const mesh = new Mesh("longGrass", scene);
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

function updateHud() {
  const percentage = mowedCount === bladeCount ? 100 : Math.floor((mowedCount / bladeCount) * 100);
  scoreEl.textContent = `Mowed: ${percentage}%`;
  meterFillEl.style.width = `${(mowedCount / bladeCount) * 100}%`;
}

function gridKey(cellX: number, cellZ: number) {
  return `${cellX},${cellZ}`;
}

function isInsideYard(x: number, z: number) {
  return yardSegments.some((segment) => (
    x >= segment.xMin
    && x <= segment.xMax
    && z >= segment.zMin
    && z <= segment.zMax
  ));
}

function randomYardPoint() {
  let x = 0;
  let z = 0;

  do {
    x = -9 + (18 * Math.random());
    z = -9 + (18 * Math.random());
  } while (!isInsideYard(x, z));

  return { x, z };
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

function writeMatrix(buffer: Float32Array, index: number, matrix: Matrix) {
  matrix.copyToArray(buffer, index * 16);
}

function writeColor(buffer: Float32Array, index: number, color: number[]) {
  buffer.set(color, index * 4);
}

function emptyMatrix() {
  return Matrix.Zero();
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
  cutTiltX = new Float32Array(bladeCount);
  cutTiltZ = new Float32Array(bladeCount);
  isMowed = Array.from({ length: bladeCount }, () => false);
  longGrassMatrices = new Float32Array(bladeCount * 16);
  cutGrassMatrices = new Float32Array(bladeCount * 16);
  longGrassColors = new Float32Array(bladeCount * 4);
  cutGrassColors = new Float32Array(bladeCount * 4);
  const hiddenMatrix = emptyMatrix();

  for (let i = 0; i < bladeCount; i += 1) {
    const { x, z } = randomYardPoint();
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

function resetGame() {
  player.position = new Vector3(0, 0.18, 0);
  playerYaw = 0;
  player.rotation.y = playerYaw;
  placeGrass();
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
    const turnScale = 0.18 + (build * build * 1.05);
    playerYaw += turnDirection * turnSpeed * turnScale * deltaSeconds;
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
  const mowRadiusSquared = playerRadius * playerRadius;
  const minCellX = Math.floor((player.position.x - playerRadius) / cellSize);
  const maxCellX = Math.floor((player.position.x + playerRadius) / cellSize);
  const minCellZ = Math.floor((player.position.z - playerRadius) / cellSize);
  const maxCellZ = Math.floor((player.position.z + playerRadius) / cellSize);
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
  }
}

function updateGrassMotion(timeSeconds: number) {
  const bendRadius = playerRadius * 2.1;
  const bendRadiusSquared = bendRadius * bendRadius;
  const forwardX = Math.sin(playerYaw);
  const forwardZ = Math.cos(playerYaw);
  let changed = false;

  for (let i = 0; i < bladeCount; i += 1) {
    if (isMowed[i]) {
      continue;
    }

    const dx = grassX[i] - player.position.x;
    const dz = grassZ[i] - player.position.z;
    const distanceSquared = (dx * dx) + (dz * dz);
    const wind = Math.sin((timeSeconds * 1.7) + grassPhase[i] + (grassX[i] * 0.45)) * settings.windStrength;
    let yaw = grassRotation[i];
    let sway = wind;

    if (currentThrottle !== 0 && distanceSquared > 0.0001 && distanceSquared < bendRadiusSquared) {
      const distance = Math.sqrt(distanceSquared);
      const bladeDirectionX = dx / distance;
      const bladeDirectionZ = dz / distance;
      const forwardDistance = ((forwardX * dx) + (forwardZ * dz)) * Math.sign(currentThrottle);
      const sideDistance = Math.abs((-forwardZ * dx) + (forwardX * dz));
      const frontAmount = (forwardX * bladeDirectionX) + (forwardZ * bladeDirectionZ);
      const activeFront = currentThrottle > 0 ? frontAmount : -frontAmount;
      const mowerEffectLength = 0.65;
      const mowerEffectHalfWidth = 0.45;

      if (forwardDistance > 0 && forwardDistance < mowerEffectLength && sideDistance < mowerEffectHalfWidth && activeFront > 0.6) {
        const lengthFalloff = 1 - (forwardDistance / mowerEffectLength);
        const sideFalloff = 1 - (sideDistance / mowerEffectHalfWidth);
        const bend = lengthFalloff * sideFalloff * settings.bendStrength;
        yaw = Math.atan2(dx, dz);
        sway += bend;
      }
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
  const positions = new Float32Array((10 + 1) * 2 * 3);
  const indices: number[] = [];
  const segments = 10;

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
  const segments = 10;
  const viewUp = camera.getDirection(Vector3.Up()).normalize();
  const t = Math.min(1, Math.max(0, wisp.age / wisp.duration));
  const appear = Math.min(1, t / 0.32);
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
    const centerX = wisp.x + x;
    const centerY = wisp.y + (Math.sin(Math.PI * u) * 0.04 * curveAmount);
    const centerZ = wisp.z + firstCurve + hook;
    const lift = Math.sin(Math.PI * u) * 0.04 * curveAmount;
    const offset = i * 6;

    wisp.positions[offset] = centerX + (viewUp.x * localWidth);
    wisp.positions[offset + 1] = centerY + lift + (viewUp.y * localWidth);
    wisp.positions[offset + 2] = centerZ + (viewUp.z * localWidth);
    wisp.positions[offset + 3] = centerX - (viewUp.x * localWidth);
    wisp.positions[offset + 4] = centerY + lift - (viewUp.y * localWidth);
    wisp.positions[offset + 5] = centerZ - (viewUp.z * localWidth);
  }

  wisp.mesh.updateVerticesData(VertexBuffer.PositionKind, wisp.positions, false, false);
  wisp.material.alpha = visibility * 0.42;
}

function createWindWisps() {
  for (let i = 0; i < 4; i += 1) {
    const material = new StandardMaterial(`windWispMaterial-${i}`, scene);
    material.diffuseColor = new Color3(1, 1, 1);
    material.emissiveColor = new Color3(0.9, 1, 0.92);
    material.alpha = 0;
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
  mote.segment = yardSegments[Math.floor(Math.random() * yardSegments.length)];
  mote.age = -(Math.random() * 4);
  mote.duration = 5 + (Math.random() * 5);
  mote.x = mote.segment.xMin - 1 + (Math.random() * 2);
  mote.z = mote.segment.zMin + (Math.random() * (mote.segment.zMax - mote.segment.zMin));
  mote.y = 0.45 + (Math.random() * 1.2);
  mote.speed = 0.55 + (Math.random() * 0.75);
  mote.drift = (Math.random() - 0.5) * 0.5;
  mote.size = 0.018 + (Math.random() * 0.035);
}

function createWindMotes() {
  for (let i = 0; i < 34; i += 1) {
    const material = new StandardMaterial(`windMoteMaterial-${i}`, scene);
    const isWarm = Math.random() < 0.18;
    material.diffuseColor = isWarm ? new Color3(1, 0.92, 0.34) : new Color3(0.95, 1, 0.9);
    material.emissiveColor = material.diffuseColor;
    material.alpha = 0;
    material.disableLighting = true;

    const mesh = MeshBuilder.CreatePlane(`windMote-${i}`, { size: 1 }, scene);
    mesh.material = material;
    mesh.billboardMode = Mesh.BILLBOARDMODE_ALL;
    mesh.isPickable = false;

    const mote: WindMote = {
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

    resetWindMote(mote);
    windMotes.push(mote);
  }
}

function updateWindMotes(deltaSeconds: number) {
  for (const mote of windMotes) {
    mote.age += deltaSeconds;

    if (mote.age > mote.duration || mote.x > mote.segment.xMax + 1) {
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
}

function setupSettings() {
  const numberControls = [
    "minHeight",
    "maxHeight",
    "clumpStrength",
    "heightRandomness",
    "windStrength",
    "bendStrength",
    "turnBuild",
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
ambientLight.intensity = 0.05;
ambientLight.groundColor = new Color3(0.18, 0.22, 0.2);

const sun = new DirectionalLight("sun", new Vector3(-0.55, -1, 0.35), scene);
sun.position = new Vector3(8, 12, -8);
sun.intensity = 0.77;

const shadowGenerator = new ShadowGenerator(1024, sun);
shadowGenerator.useBlurExponentialShadowMap = true;
shadowGenerator.blurKernel = 24;

const camera = new ArcRotateCamera("camera", -Math.PI / 2, Math.PI / 3, 16, Vector3.Zero(), scene);
camera.attachControl(canvas, true);
camera.lowerRadiusLimit = 8;
camera.upperRadiusLimit = 24;

for (const [index, segment] of yardSegments.entries()) {
  const ground = MeshBuilder.CreateGround(`ground-${index}`, { width: segment.width, height: segment.height }, scene);
  ground.position = segment.center;
  ground.material = groundMaterial;
  ground.receiveShadows = true;
}

createWindWisps();
createWindMotes();

longGrass = makeLongBladeMesh();
cutGrass = makeCutBladeMesh();

player = MeshBuilder.CreateBox("player", { size: 1 }, scene);
player.material = playerMaterial;
player.scaling = new Vector3(0.85, 0.28, 1.1);
shadowGenerator.addShadowCaster(player);

setupSettings();
refreshGroundColor();
resetGame();

window.addEventListener("keydown", (event) => {
  const key = event.key.toLowerCase();

  if (["w", "a", "s", "d", " "].includes(key)) {
    keys.add(key);
  }

  if (key === "r") {
    resetGame();
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

  movePlayer(deltaSeconds);
  updateGrassMotion(timeSeconds);
  updateWindWisps(deltaSeconds);
  updateWindMotes(deltaSeconds);
  mowTouchedGrass();
  scene.render();
});
