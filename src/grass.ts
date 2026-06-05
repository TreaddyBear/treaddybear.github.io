import { Color3, Matrix, Mesh, Quaternion, Vector3, VertexBuffer, VertexData } from "@babylonjs/core";
import type { Scene } from "@babylonjs/core";
import {
  bladeCount,
  cellSize,
  getActiveMap,
  mediumGrassCount,
  mowerCutRadius,
  settings,
  wheatGrassCount,
  yardSegments,
} from "./config";
import type { FenceSystem } from "./fence";
import type { Materials } from "./materials";
import type { Wind } from "./wind";
import { emptyMatrix, writeColor, writeMatrix } from "./utils/buffers";
import { color3ToHsl, hexToColor3, hslToColor3, mixColor } from "./utils/color";
import { grassNoiseAt, randomHash } from "./utils/noise";
import { gridKey, isInsideSegments, randomPointInSegments } from "./utils/yard";

export type Grass = ReturnType<typeof createGrass>;

export type GrassDeps = {
  scene: Scene;
  materials: Materials;
  player: Mesh;
  getYaw: () => number;
  getThrottle: () => number;
  groundHeightAt: (x: number, z: number) => number;
  fence: FenceSystem;
  wind: Wind;
  onMowProgress: () => void;
};

// The lawn: the main mowable blades, the neighbor/medium grass, and the far
// wheat, plus mowing, wind motion, the last-strand highlight, and colors. Owns
// all the per-blade buffers. The shot logic in main calls cutAlongShot().
export function createGrass(deps: GrassDeps) {
  const { scene, materials, player, getYaw, getThrottle, groundHeightAt, fence, wind, onMowProgress } = deps;

  const grassGrid = new Map<string, number[]>();
  let longGrassMatrices = new Float32Array(0);
  let cutGrassMatrices = new Float32Array(0);
  let mediumGrassMatrices = new Float32Array(0);
  let wheatGrassMatrices = new Float32Array(0);
  let mediumGrassColors = new Float32Array(0);
  let wheatGrassColors = new Float32Array(0);
  let longGrassColors = new Float32Array(0);
  let cutGrassColors = new Float32Array(0);
  let grassX = new Float32Array(0);
  let grassZ = new Float32Array(0);
  let grassRotation = new Float32Array(0);
  let grassScale = new Float32Array(0);
  let grassNoise = new Float32Array(0);
  let grassPhase = new Float32Array(0);
  let grassPressure = new Float32Array(0);
  let grassPressureYaw = new Float32Array(0);
  let cutTiltX = new Float32Array(0);
  let cutTiltZ = new Float32Array(0);
  let isMowed: boolean[] = [];
  let mowedCount = 0;
  let lastMowSeconds = 0;
  let remainingHighlightActive = false;
  // 0..1 eased strength of the find-the-last-strands glow, so it fades in and
  // (when a blade is cut) fades back out instead of snapping on/off.
  let highlightStrength = 0;
  // Whether the glow has appeared yet this level (it kicks in faster after the
  // first time, since the player is clearly hunting).
  let highlightHasShown = false;
  let clippingBurstCooldown = 0;
  let grassCuttingAudioTimer = 0;
  // Seconds of "stuck near the end" before the survivors glow: longer the first
  // time, then shorter on every later stall.
  const highlightFirstDelay = 10;
  const highlightRepeatDelay = 5;

  const isInsideYard = (x: number, z: number) => isInsideSegments(yardSegments, x, z);
  const isOnRoad = (x: number) => x > 11.8 && x < 17.2;
  const randomYardPoint = () => randomPointInSegments(yardSegments);

  const cutBladeVertexColors = () => {
    const root = hexToColor3(settings.cutGrassRootColor);
    const topA = hexToColor3(settings.cutGrassTopColorA);
    const topB = hexToColor3(settings.cutGrassTopColorB);

    return [
      root.r, root.g, root.b, 1,
      root.r, root.g, root.b, 1,
      topA.r, topA.g, topA.b, 1,
      topB.r, topB.g, topB.b, 1,
    ];
  };

  const makeLongBladeMesh = (name = "longGrass") => {
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
    mesh.material = materials.bladeMaterial;
    return mesh;
  };

  const makeCutBladeMesh = () => {
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
    mesh.material = materials.cutBladeMaterial;
    return mesh;
  };

  const makeWheatBladeMesh = () => {
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
    mesh.material = materials.bladeMaterial;
    return mesh;
  };

  const longGrass = makeLongBladeMesh();
  const cutGrass = makeCutBladeMesh();
  const mediumGrass = makeLongBladeMesh("mediumGrass");
  const wheatGrass = makeWheatBladeMesh();

  const refreshCutBladeVertexColors = () => {
    cutGrass.setVerticesData(VertexBuffer.ColorKind, cutBladeVertexColors(), true);
  };

  const distanceToFlowerBed = (x: number, z: number) => {
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
  };

  const shouldPlaceGrassNearFlowerBed = (x: number, z: number) => {
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
  };

  const distanceToMainYard = (x: number, z: number) => {
    let closest = Number.POSITIVE_INFINITY;

    for (const segment of yardSegments) {
      const clampedX = Math.min(segment.xMax, Math.max(segment.xMin, x));
      const clampedZ = Math.min(segment.zMax, Math.max(segment.zMin, z));
      const dx = x - clampedX;
      const dz = z - clampedZ;
      closest = Math.min(closest, Math.sqrt((dx * dx) + (dz * dz)));
    }

    return closest;
  };

  const matrixForBlade = (index: number, cut: boolean, yawOverride = grassRotation[index], sway = 0) => {
    const pitch = cut ? cutTiltX[index] : sway * 0.28;
    const roll = cut ? cutTiltZ[index] : sway;
    const rotation = Quaternion.FromEulerAngles(pitch, yawOverride, roll);
    const height = cut ? 0.065 : grassScale[index];
    const width = cut ? 1.15 : 1;
    const scale = new Vector3(width, height, width);
    const position = new Vector3(grassX[index], 0, grassZ[index]);

    return Matrix.Compose(scale, rotation, position);
  };

  const colorForBlade = (index: number, cut: boolean) => {
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
  };

  const placeGrass = () => {
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
      let fenceFalloff = fence.grassFalloff(x, z);
      let bedOpen = shouldPlaceGrassNearFlowerBed(x, z);

      for (let attempt = 0; attempt < 90 && (fenceFalloff < 0.98 || !bedOpen); attempt += 1) {
        ({ x, z } = randomYardPoint());
        fenceFalloff = fence.grassFalloff(x, z);
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
  };

  const placeMediumGrass = () => {
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

        if (!isInsideYard(x, z) && !isOnRoad(x) && fence.distanceTo(x, z) > fence.dirtClearRadius && Math.random() < density) {
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
  };

  const placeWheatGrass = () => {
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
  };

  const refreshColors = () => {
    if (!longGrassColors.length || !cutGrassColors.length) {
      return;
    }

    refreshCutBladeVertexColors();

    for (let i = 0; i < bladeCount; i += 1) {
      writeColor(longGrassColors, i, colorForBlade(i, false));
      writeColor(cutGrassColors, i, colorForBlade(i, true));
    }

    longGrass.thinInstanceBufferUpdated("color");
    cutGrass.thinInstanceBufferUpdated("color");
  };

  return {
    get mowedCount() {
      return mowedCount;
    },

    isCutting() {
      return grassCuttingAudioTimer > 0;
    },

    refreshColors,

    refreshMaterial() {
      materials.bladeMaterial.roughness = settings.grassRoughness;
      materials.bladeMaterial.metallic = settings.grassMetallic;
      materials.bladeMaterial.specularIntensity = 0.18;
      materials.bladeMaterial.clearCoat.intensity = settings.grassClearCoat;
      materials.bladeMaterial.clearCoat.roughness = Math.max(0.018, settings.grassRoughness * 0.12);

      materials.cutBladeMaterial.roughness = settings.cutGrassRoughness;
      materials.cutBladeMaterial.metallic = settings.cutGrassMetallic;
      materials.cutBladeMaterial.specularIntensity = 0.11;
      materials.cutBladeMaterial.clearCoat.intensity = settings.cutGrassClearCoat;
      materials.cutBladeMaterial.clearCoat.roughness = Math.max(0.035, settings.cutGrassRoughness * 0.14);
    },

    generate() {
      lastMowSeconds = performance.now() / 1000;
      remainingHighlightActive = false;
      highlightStrength = 0;
      highlightHasShown = false;
      placeMediumGrass();
      placeWheatGrass();
      placeGrass();
    },

    mowUnderMower(deltaSeconds: number) {
      clippingBurstCooldown = Math.max(0, clippingBurstCooldown - deltaSeconds);
      grassCuttingAudioTimer = Math.max(0, grassCuttingAudioTimer - deltaSeconds);

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
        onMowProgress();

        if (clippingBurstCooldown <= 0) {
          wind.burstMowerClippings(false);
          clippingBurstCooldown = 0.35;
        }
      }
    },

    // Cuts grass along a shot. Calls onFleck for the occasional thrown clipping
    // (capped) and onMowProgress if anything changed.
    cutAlongShot(origin: Vector3, direction: Vector3, range: number, onFleck: (x: number, z: number) => void) {
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
              const gx = grassX[index];
              const gz = grassZ[index];
              const fx = gx - origin.x;
              const fz = gz - origin.z;
              const forward = (fx * direction.x) + (fz * direction.z);
              const side = Math.abs((fx * direction.z) - (fz * direction.x));

              if (isMowed[index] || forward < 0 || forward > range || side > shotWidth) {
                continue;
              }

              isMowed[index] = true;
              mowedCount += 1;
              writeMatrix(longGrassMatrices, index, emptyMatrix());
              writeMatrix(cutGrassMatrices, index, matrixForBlade(index, true));
              changedGrass = true;

              if (grassFleckCount < 28 && Math.random() < 0.065) {
                onFleck(gx, gz);
                grassFleckCount += 1;
              }
            }
          }
        }
      }

      if (changedGrass) {
        longGrass.thinInstanceBufferUpdated("matrix");
        cutGrass.thinInstanceBufferUpdated("matrix");
        onMowProgress();
      }
    },

    updateMotion(timeSeconds: number) {
      const yaw = getYaw();
      const throttle = getThrottle();
      const forwardX = Math.sin(yaw);
      const forwardZ = Math.cos(yaw);
      const sideX = Math.cos(yaw);
      const sideZ = -Math.sin(yaw);
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

        if (throttle !== 0 && (insideMower || outsideDistance < feather)) {
          const edgeFalloff = insideMower ? 1 : 1 - (outsideDistance / feather);
          const movementBias = Math.max(0, 1 - (Math.max(0, localForward * Math.sign(throttle)) / (halfLength + feather)));
          const targetPressure = Math.min(1, edgeFalloff * (0.35 + (movementBias * 0.65)));

          if (targetPressure > grassPressure[i]) {
            grassPressure[i] = targetPressure;
            grassPressureYaw[i] = Math.atan2(dx, dz);
          }
        }

        const pressure = grassPressure[i];
        const windSway = Math.sin((timeSeconds * 1.7) + grassPhase[i] + (grassX[i] * 0.45)) * settings.windStrength * (1 - (pressure * 0.9));
        let yawValue = grassRotation[i];
        const sway = windSway + (pressure * settings.bendStrength * 1.45);

        if (pressure > 0.02) {
          const blend = Math.min(1, pressure * 1.2);
          yawValue = (grassRotation[i] * (1 - blend)) + (grassPressureYaw[i] * blend);
        }

        writeMatrix(longGrassMatrices, i, matrixForBlade(i, false, yawValue, sway));
        changed = true;
      }

      if (changed) {
        longGrass.thinInstanceBufferUpdated("matrix");
      }
    },

    // When almost the whole lawn is cut and the player has gone a while without
    // finding the last blades, glow the survivors gold so they stand out. The
    // glow eases in, and eases back out when a blade is cut, rather than blinking.
    updateHighlight(timeSeconds: number, deltaSeconds: number) {
      const remaining = bladeCount - mowedCount;
      const threshold = Math.max(1, Math.ceil(bladeCount * 0.01));
      const delay = highlightHasShown ? highlightRepeatDelay : highlightFirstDelay;
      const shouldHighlight = remaining > 0 && remaining <= threshold && (timeSeconds - lastMowSeconds) > delay;

      if (shouldHighlight) {
        highlightHasShown = true;
      }

      // Ease toward on/off: a touch quicker in, gentler out so cutting a strand
      // visibly relaxes the glow.
      const target = shouldHighlight ? 1 : 0;
      const rate = target > highlightStrength ? 5 : 2.4;
      highlightStrength += (target - highlightStrength) * Math.min(1, deltaSeconds * rate);

      if (highlightStrength > 0.004) {
        const pulse = 0.5 + (0.5 * Math.sin(timeSeconds * 4.5));
        const amount = highlightStrength * (0.55 + (pulse * 0.45));

        for (let i = 0; i < bladeCount; i += 1) {
          if (isMowed[i]) {
            continue;
          }

          const base = colorForBlade(i, false);
          writeColor(longGrassColors, i, [
            base[0] + ((1 - base[0]) * amount),
            base[1] + ((0.92 - base[1]) * amount),
            base[2] + ((0.2 - base[2]) * amount),
            1,
          ]);
        }

        longGrass.thinInstanceBufferUpdated("color");
        remainingHighlightActive = true;
      } else if (remainingHighlightActive) {
        refreshColors();
        remainingHighlightActive = false;
      }
    },
  };
}
