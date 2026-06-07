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
  let mediumGrassMatrices = new Float32Array(0);
  let mediumGrassColors = new Float32Array(0);
  let longGrassColors = new Float32Array(0);
  // The wild/wheat grass is now multi-stalk clumps in a few stalk-count
  // variants, indexed the same compact way as the cut blades below.
  let wheatVariant = new Uint8Array(0);
  let wheatLocalIndex = new Int32Array(0);
  let wheatVariantMatrices: Float32Array[] = [];
  let wheatVariantColors: Float32Array[] = [];
  // Cut blades come in four top-edge shapes (flat / point / sawtooth / V), one
  // thin-instance mesh each, so a blade lives in its variant mesh at a local
  // index and the per-variant buffers stay compact.
  let cutVariant = new Uint8Array(0);
  let cutLocalIndex = new Int32Array(0);
  let cutVariantMatrices: Float32Array[] = [];
  let cutVariantColors: Float32Array[] = [];
  let grassX = new Float32Array(0);
  let grassZ = new Float32Array(0);
  let grassRotation = new Float32Array(0);
  let grassScale = new Float32Array(0);
  let grassNoise = new Float32Array(0);
  let grassPhase = new Float32Array(0);
  let grassPressure = new Float32Array(0);
  let grassPressureYaw = new Float32Array(0);
  let lastMotionSeconds = performance.now() / 1000;
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
  // Match the road influence zone world.ts uses (|x-14.5| < 4.1) plus a hair of
  // margin, so blades never spawn on the road — even after the road was widened.
  const isOnRoad = (x: number) => Math.abs(x - 14.5) < 4.3;
  const randomYardPoint = () => randomPointInSegments(yardSegments);

  // Four cut-blade silhouettes. backFaceCulling is off on the cut material, so
  // winding doesn't matter. y runs 0 (base) to 1 (tip), scaled tiny when drawn.
  const cutBladeShapes: Array<{ positions: number[]; indices: number[] }> = [
    // flat across the top
    { positions: [-0.055, 0, 0, 0.055, 0, 0, -0.04, 1, 0.01, 0.04, 1, -0.005], indices: [0, 1, 2, 1, 3, 2] },
    // a point: high in the middle, sloping steeply down at the sides
    { positions: [-0.055, 0, 0, 0.055, 0, 0, -0.05, 0.32, 0.01, 0, 1.08, 0, 0.05, 0.32, -0.01], indices: [0, 1, 3, 1, 4, 3, 0, 3, 2] },
    // a sawtooth: angle up, sharp down, angle up, sharp down — deep notches
    { positions: [-0.055, 0, 0, 0.055, 0, 0, -0.055, 0.26, 0.01, -0.01, 1.02, 0.005, -0.01, 0.3, 0.005, 0.035, 1.02, -0.005, 0.055, 0.3, -0.01], indices: [0, 1, 6, 0, 6, 5, 0, 5, 4, 0, 4, 3, 0, 3, 2] },
    // a V: high on each side, dropping deep in the middle
    { positions: [-0.055, 0, 0, 0.055, 0, 0, -0.05, 1.08, 0.01, 0, 0.26, 0, 0.05, 1.08, -0.005], indices: [0, 1, 3, 0, 3, 2, 1, 4, 3] },
  ];

  // Shape mix: 1/5 flat, 2/5 point, 1/5 sawtooth, 1/5 V.
  const pickCutVariant = () => {
    const r = Math.random();
    if (r < 0.2) {
      return 0;
    }
    if (r < 0.6) {
      return 1;
    }
    if (r < 0.8) {
      return 2;
    }
    return 3;
  };

  // Per-vertex gradient: root colour at the base, top colours at the tip,
  // interpolated by height so any silhouette gets a consistent fade.
  const cutBladeVertexColors = (positions: number[]) => {
    const root = hexToColor3(settings.cutGrassRootColor);
    const topA = hexToColor3(settings.cutGrassTopColorA);
    const topB = hexToColor3(settings.cutGrassTopColorB);
    const colors: number[] = [];

    for (let i = 0; i < positions.length; i += 3) {
      const y = Math.max(0, Math.min(1, positions[i + 1]));
      const top = positions[i] < 0 ? topA : topB;
      colors.push(
        root.r + ((top.r - root.r) * y),
        root.g + ((top.g - root.g) * y),
        root.b + ((top.b - root.b) * y),
        1,
      );
    }

    return colors;
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

  const makeCutBladeMesh = (variant: number, name: string) => {
    const shape = cutBladeShapes[variant];
    const mesh = new Mesh(name, scene);
    const normals: number[] = [];
    VertexData.ComputeNormals(shape.positions, shape.indices, normals);

    const vertexData = new VertexData();
    vertexData.positions = shape.positions;
    vertexData.indices = shape.indices;
    vertexData.normals = normals;
    vertexData.colors = cutBladeVertexColors(shape.positions);
    vertexData.applyToMesh(mesh);
    mesh.material = materials.cutBladeMaterial;
    return mesh;
  };

  // A short accessory blade: a narrow tapered strip rooted near the clump centre
  // that curves over to one side as it rises. These are the bendy filler pieces
  // around the taller seed stalks.
  const appendCurvyBlade = (
    positions: number[],
    indices: number[],
    baseX: number,
    baseZ: number,
    dirX: number,
    dirZ: number,
    height: number,
    bend: number,
    width: number,
  ) => {
    const segments = 4;
    const start = positions.length / 3;
    const perpX = -dirZ;
    const perpZ = dirX;

    for (let s = 0; s <= segments; s += 1) {
      const t = s / segments;
      const y = t * height;
      const drift = bend * t * t; // sideways curve grows toward the tip
      const cx = baseX + (dirX * drift);
      const cz = baseZ + (dirZ * drift);
      const w = width * (1 - (t * 0.82)); // taper toward a fine tip
      positions.push(cx - (perpX * w), y, cz - (perpZ * w));
      positions.push(cx + (perpX * w), y, cz + (perpZ * w));
    }

    for (let s = 0; s < segments; s += 1) {
      const a = start + (s * 2);
      indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
  };

  // A tall, near-straight stalk topped with a wheat seed head: a thin stem that
  // flares into a diamond-shaped ear and tapers back to a point at the tip.
  const appendSeededStalk = (
    positions: number[],
    indices: number[],
    baseX: number,
    baseZ: number,
    faceAngle: number,
    tiltX: number,
    tiltZ: number,
    height: number,
  ) => {
    const start = positions.length / 3;
    const px = Math.cos(faceAngle); // the flat blade faces this way
    const pz = Math.sin(faceAngle);
    const stalkW = 0.012;
    const neckY = height * 0.55; // where the stem meets the seed head
    const bulgeY = height * 0.78; // widest part of the ear
    const headW = 0.05;
    const cx = (y: number) => baseX + (tiltX * y); // straight lean, no curve
    const cz = (y: number) => baseZ + (tiltZ * y);

    positions.push(cx(0) - (px * stalkW), 0, cz(0) - (pz * stalkW)); // 0 base
    positions.push(cx(0) + (px * stalkW), 0, cz(0) + (pz * stalkW)); // 1
    positions.push(cx(neckY) - (px * stalkW * 0.7), neckY, cz(neckY) - (pz * stalkW * 0.7)); // 2 neck
    positions.push(cx(neckY) + (px * stalkW * 0.7), neckY, cz(neckY) + (pz * stalkW * 0.7)); // 3
    positions.push(cx(bulgeY) - (px * headW), bulgeY, cz(bulgeY) - (pz * headW)); // 4 ear bulge
    positions.push(cx(bulgeY) + (px * headW), bulgeY, cz(bulgeY) + (pz * headW)); // 5
    positions.push(cx(height), height, cz(height)); // 6 tip

    const a = start;
    indices.push(
      a, a + 1, a + 2, a + 1, a + 3, a + 2, // thin stem
      a + 2, a + 3, a + 5, a + 2, a + 5, a + 4, // ear widening out of the neck
      a + 4, a + 5, a + 6, // ear tapering to the tip
    );
  };

  // Number of tall seed stalks per clump variant (1 wisp up to a full 6-ear tuft).
  const wheatTallCounts = [1, 2, 4, 6];

  const makeWheatClumpMesh = (variant: number, name: string) => {
    const positions: number[] = [];
    const indices: number[] = [];
    const tallCount = wheatTallCounts[variant];

    // The tall, straight, seed-headed stalks: the main feature of the clump.
    for (let k = 0; k < tallCount; k += 1) {
      const spreadAngle = Math.random() * Math.PI * 2;
      const baseRadius = Math.random() * 0.04;
      const baseX = Math.cos(spreadAngle) * baseRadius;
      const baseZ = Math.sin(spreadAngle) * baseRadius;
      const faceAngle = Math.random() * Math.PI * 2;
      const tiltDir = Math.random() * Math.PI * 2;
      const tiltMag = 0.05 + (Math.random() * 0.09); // only a slight lean — these stand up
      const height = 0.82 + (Math.random() * 0.32);
      appendSeededStalk(positions, indices, baseX, baseZ, faceAngle, Math.cos(tiltDir) * tiltMag, Math.sin(tiltDir) * tiltMag, height);
    }

    // The shorter, curvier accessory blades filling in around the base.
    const shortCount = 3 + Math.floor(Math.random() * 4);
    for (let k = 0; k < shortCount; k += 1) {
      const spreadAngle = Math.random() * Math.PI * 2;
      const baseRadius = Math.random() * 0.06;
      const baseX = Math.cos(spreadAngle) * baseRadius;
      const baseZ = Math.sin(spreadAngle) * baseRadius;
      const leanAngle = Math.random() * Math.PI * 2;
      const height = 0.36 + (Math.random() * 0.3); // clearly shorter than the seed stalks
      const bend = 0.32 + (Math.random() * 0.42); // and clearly curvier
      const width = 0.018 + (Math.random() * 0.016);
      appendCurvyBlade(positions, indices, baseX, baseZ, Math.cos(leanAngle), Math.sin(leanAngle), height, bend, width);
    }

    const mesh = new Mesh(name, scene);
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

  // Mix of clump sizes, weighted toward the mid-size tufts.
  const pickWheatVariant = () => {
    const r = Math.random();
    if (r < 0.15) {
      return 0;
    }
    if (r < 0.5) {
      return 1;
    }
    if (r < 0.85) {
      return 2;
    }
    return 3;
  };

  const longGrass = makeLongBladeMesh();
  const cutGrassMeshes = cutBladeShapes.map((_, variant) => makeCutBladeMesh(variant, `cutGrass-${variant}`));
  const mediumGrass = makeLongBladeMesh("mediumGrass");
  const wheatGrassMeshes = wheatTallCounts.map((_, variant) => makeWheatClumpMesh(variant, `wheatGrass-${variant}`));

  // The blades are PBR, so they can receive the directional light's shadows
  // (the lawn's flat ground shader cannot). This is what makes the fence/rock/
  // tree shadows actually land on something the player sees.
  for (const mesh of [longGrass, mediumGrass, ...cutGrassMeshes, ...wheatGrassMeshes]) {
    mesh.receiveShadows = true;
  }

  const refreshCutBladeVertexColors = () => {
    for (let v = 0; v < cutGrassMeshes.length; v += 1) {
      cutGrassMeshes[v].setVerticesData(VertexBuffer.ColorKind, cutBladeVertexColors(cutBladeShapes[v].positions), true);
    }
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
    const height = cut ? 0.085 : grassScale[index];
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
    longGrassColors = new Float32Array(bladeCount * 4);
    const hiddenMatrix = emptyMatrix();

    cutVariant = new Uint8Array(bladeCount);
    cutLocalIndex = new Int32Array(bladeCount);
    const cutCounts = [0, 0, 0, 0];
    for (let i = 0; i < bladeCount; i += 1) {
      const v = pickCutVariant();
      cutVariant[i] = v;
      cutLocalIndex[i] = cutCounts[v];
      cutCounts[v] += 1;
    }
    cutVariantMatrices = cutCounts.map((count) => new Float32Array(count * 16));
    cutVariantColors = cutCounts.map((count) => new Float32Array(count * 4));

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
        writeMatrix(cutVariantMatrices[cutVariant[i]], cutLocalIndex[i], hiddenMatrix);
        writeColor(longGrassColors, i, [0, 0, 0, 0]);
        writeColor(cutVariantColors[cutVariant[i]], cutLocalIndex[i], [0, 0, 0, 0]);
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
      // The one main bend in a cut blade, varied per blade: most stay close to
      // upright (a 180-degree "bend"), a few fold right over toward the ground
      // (down to ~15 degrees). pow() biases the fold strongly toward upright.
      const foldDir = Math.random() * Math.PI * 2;
      const fold = (Math.random() ** 2.2) * 1.45;
      cutTiltX[i] = Math.cos(foldDir) * fold;
      cutTiltZ[i] = Math.sin(foldDir) * fold;

      writeMatrix(longGrassMatrices, i, matrixForBlade(i, false));
      writeMatrix(cutVariantMatrices[cutVariant[i]], cutLocalIndex[i], hiddenMatrix);
      writeColor(longGrassColors, i, colorForBlade(i, false));
      writeColor(cutVariantColors[cutVariant[i]], cutLocalIndex[i], colorForBlade(i, true));

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
    for (let v = 0; v < cutGrassMeshes.length; v += 1) {
      cutGrassMeshes[v].thinInstanceSetBuffer("matrix", cutVariantMatrices[v], 16, false);
      cutGrassMeshes[v].thinInstanceSetBuffer("color", cutVariantColors[v], 4, false);
    }
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
    wheatVariant = new Uint8Array(wheatGrassCount);
    wheatLocalIndex = new Int32Array(wheatGrassCount);
    const variantCounts = [0, 0, 0, 0];
    for (let i = 0; i < wheatGrassCount; i += 1) {
      const v = pickWheatVariant();
      wheatVariant[i] = v;
      wheatLocalIndex[i] = variantCounts[v];
      variantCounts[v] += 1;
    }
    wheatVariantMatrices = variantCounts.map((count) => new Float32Array(count * 16));
    wheatVariantColors = variantCounts.map((count) => new Float32Array(count * 4));

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

      const variant = wheatVariant[i];
      const localIndex = wheatLocalIndex[i];
      writeMatrix(wheatVariantMatrices[variant], localIndex, matrix);
      writeColor(wheatVariantColors[variant], localIndex, [pale.r, pale.g, pale.b, 1]);
    }

    for (let v = 0; v < wheatGrassMeshes.length; v += 1) {
      wheatGrassMeshes[v].thinInstanceSetBuffer("matrix", wheatVariantMatrices[v], 16, true);
      wheatGrassMeshes[v].thinInstanceSetBuffer("color", wheatVariantColors[v], 4, true);
    }
  };

  const refreshColors = () => {
    if (!longGrassColors.length) {
      return;
    }

    refreshCutBladeVertexColors();

    for (let i = 0; i < bladeCount; i += 1) {
      writeColor(longGrassColors, i, colorForBlade(i, false));
      writeColor(cutVariantColors[cutVariant[i]], cutLocalIndex[i], colorForBlade(i, true));
    }

    longGrass.thinInstanceBufferUpdated("color");
    for (let v = 0; v < cutGrassMeshes.length; v += 1) {
      cutGrassMeshes[v].thinInstanceBufferUpdated("color");
    }
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
      const cutDirty = [false, false, false, false];

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
              writeMatrix(cutVariantMatrices[cutVariant[index]], cutLocalIndex[index], matrixForBlade(index, true));
              cutDirty[cutVariant[index]] = true;
              mowedThisFrame = true;
            }
          }
        }
      }

      if (mowedThisFrame) {
        lastMowSeconds = performance.now() / 1000;
        grassCuttingAudioTimer = 0.16;
        longGrass.thinInstanceBufferUpdated("matrix");
        for (let v = 0; v < cutGrassMeshes.length; v += 1) {
          if (cutDirty[v]) {
            cutGrassMeshes[v].thinInstanceBufferUpdated("matrix");
          }
        }
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
      const cutDirty = [false, false, false, false];

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
              writeMatrix(cutVariantMatrices[cutVariant[index]], cutLocalIndex[index], matrixForBlade(index, true));
              cutDirty[cutVariant[index]] = true;
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
        for (let v = 0; v < cutGrassMeshes.length; v += 1) {
          if (cutDirty[v]) {
            cutGrassMeshes[v].thinInstanceBufferUpdated("matrix");
          }
        }
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
      const nowSeconds = performance.now() / 1000;
      const motionDelta = Math.min(0.05, Math.max(0, nowSeconds - lastMotionSeconds));
      lastMotionSeconds = nowSeconds;
      // A blade only relaxes once the mower is this far away; closer than this it
      // holds its bend so it can never spring back up through the mower body.
      const nearRadiusSq = 1.7 * 1.7;
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

          // Bend at least as hard as the strongest press so far, but ALWAYS
          // re-aim the lean away from the mower's CURRENT position. Without the
          // re-aim, a blade bent on a first pass keeps leaning the old way and
          // pokes straight through the mower on a second pass from a new angle.
          grassPressure[i] = Math.max(grassPressure[i], targetPressure);
          grassPressureYaw[i] = Math.atan2(dx, dz);
        } else if (grassPressure[i] > 0 && ((dx * dx) + (dz * dz)) > nearRadiusSq) {
          // Only relax once the mower has clearly moved on — never while it is
          // still alongside the blade, which is what flicked the blade up through
          // the mower. And relax slowly, so a pressed blade reads as bent into
          // place rather than snapping upright the instant the mower passes.
          grassPressure[i] = Math.max(0, grassPressure[i] - (motionDelta * 0.28));
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
