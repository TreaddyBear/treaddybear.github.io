import {
  ArcRotateCamera,
  Color3,
  DynamicTexture,
  Effect,
  Material,
  Mesh,
  MeshBuilder,
  TransformNode,
  VertexData,
  Scene,
  ShaderMaterial,
  StandardMaterial,
  Texture,
  Vector2,
  Vector3,
} from "@babylonjs/core";
import { lawnMaps } from "./config";
import type { FenceSegment, LawnMap } from "./config";
import { valueNoise } from "./utils/noise";
import { createRoadFileTexture, createRoadStripeAtlasTexture, dirtGroundTextureUrl, grassyGroundTextureUrl } from "./textures";

function smoothstep01(value: number) {
  const t = Math.max(0, Math.min(1, value));
  return t * t * (3 - (2 * t));
}

function distanceToMainYardBounds(x: number, z: number) {
  const clampedX = Math.min(9, Math.max(-9, x));
  const clampedZ = Math.min(9, Math.max(-9, z));
  const dx = x - clampedX;
  const dz = z - clampedZ;
  return Math.sqrt((dx * dx) + (dz * dz));
}

export function terrainHeightAt(x: number, z: number) {
  const distanceFade = smoothstep01((distanceToMainYardBounds(x, z) - 10) / 54);
  const roadFade = smoothstep01(Math.max(0, Math.abs(x - 14.5) - 4.2) / 8);
  const broad = valueNoise((x * 0.035) + 12, (z * 0.035) - 8) - 0.5;
  const mid = valueNoise((x * 0.095) - 4, (z * 0.095) + 19) - 0.5;
  const rolling = ((broad * 6.8) + (mid * 1.9)) * distanceFade * roadFade;
  const concealDx = x + 25.5;
  const concealDz = z + 16.5;
  const concealHill = Math.max(0, 1 - (((concealDx * concealDx) / 74) + ((concealDz * concealDz) / 34)));
  return rolling + (concealHill * concealHill * 4.1);
}

function distanceToAnyLawn(x: number, z: number) {
  let closest = Number.POSITIVE_INFINITY;

  for (const map of lawnMaps) {
    for (const segment of map.segments) {
      const clampedX = Math.min(segment.xMax, Math.max(segment.xMin, x));
      const clampedZ = Math.min(segment.zMax, Math.max(segment.zMin, z));
      const dx = x - clampedX;
      const dz = z - clampedZ;
      const inside = x >= segment.xMin && x <= segment.xMax && z >= segment.zMin && z <= segment.zMax;
      const distance = inside ? 0 : Math.sqrt((dx * dx) + (dz * dz));
      closest = Math.min(closest, distance);
    }
  }

  return closest;
}

function grassOverlayAlpha(x: number, z: number, height: number) {
  if (Math.abs(x - 14.5) < 4.1) {
    return 0;
  }

  const distance = distanceToAnyLawn(x, z);
  const distanceMask = 1 - smoothstep01((distance - 1.5) / 18);
  const valleyMask = 1 - smoothstep01((height - 0.35) / 4.8);
  const broadPatch = valueNoise((x * 0.055) + 4, (z * 0.055) - 12);
  const detailPatch = valueNoise((x * 0.18) - 20, (z * 0.18) + 7);
  const patch = Math.max(0, Math.min(1, ((broadPatch - 0.28) / 0.54) * 0.82 + ((detailPatch - 0.45) * 0.28)));
  const nearSolid = 1 - smoothstep01(distance / 3.5);
  return Math.max(0, Math.min(0.96, Math.max(nearSolid, patch) * distanceMask * valleyMask));
}

function tileableNoise(u: number, v: number, frequencyX: number, frequencyZ: number) {
  const x = u * frequencyX;
  const z = v * frequencyZ;
  const blendX = smoothstep01(u);
  const blendZ = smoothstep01(v);
  const a = valueNoise(x, z);
  const b = valueNoise(x - frequencyX, z);
  const c = valueNoise(x, z - frequencyZ);
  const d = valueNoise(x - frequencyX, z - frequencyZ);
  const x1 = a + ((b - a) * blendX);
  const x2 = c + ((d - c) * blendX);
  return x1 + ((x2 - x1) * blendZ);
}

function grassMaskValue(x: number, z: number, u: number, v: number) {
  if (Math.abs(x - 14.5) < 4.1) {
    return 0;
  }

  const terrainHeight = terrainHeightAt(x, z);
  const distance = distanceToAnyLawn(x, z);
  const nearLawn = 1 - smoothstep01((distance - 0.5) / 18);
  const valley = 1 - smoothstep01((terrainHeight - 0.15) / 5.4);
  const coarse = tileableNoise(u, v, 10, 20);
  const mid = tileableNoise((u + 0.37) % 1, (v + 0.19) % 1, 27, 54);
  const fine = tileableNoise((u + 0.11) % 1, (v + 0.61) % 1, 73, 146);
  const noise = Math.max(0, Math.min(1, (coarse * 0.62) + (mid * 0.28) + (fine * 0.1)));
  const grassBias = Math.max(0, Math.min(1, nearLawn * (0.72 + (valley * 0.3))));
  const threshold = 0.06 + ((1 - grassBias) * 0.92);
  const transition = 0.035;

  return smoothstep01((noise - threshold + transition) / (transition * 2));
}

function biomeMaskNoise(x: number, z: number) {
  const warpX = (valueNoise((x * 0.021) + 17.4, (z * 0.021) - 31.2) - 0.5) * 42;
  const warpZ = (valueNoise((x * 0.019) - 42.7, (z * 0.019) + 8.9) - 0.5) * 42;
  const wx = x + warpX;
  const wz = z + warpZ;
  const continent = valueNoise((wx * 0.018) + 9.5, (wz * 0.018) - 14.8);
  const region = valueNoise(((x - (warpZ * 0.45)) * 0.045) - 61.3, ((z + (warpX * 0.45)) * 0.045) + 23.1);
  const lake = valueNoise((wx * 0.095) + 101.5, (wz * 0.095) - 77.4);
  const island = valueNoise((wx * 0.2) - 18.2, (wz * 0.2) + 52.6);
  const nestedLakes = smoothstep01((0.4 - lake) / 0.22) * 0.2;
  const nestedIslands = smoothstep01((island - 0.56) / 0.24) * 0.22;
  const base = (continent * 0.48) + (region * 0.29) + (lake * 0.15) + (island * 0.08);
  return Math.max(0, Math.min(1, base - nestedLakes + nestedIslands));
}

function biomeHomeAmount(x: number, z: number) {
  const distance = distanceToAnyLawn(x, z);
  const safeDistance = 24;
  const awayDistance = 145;

  if (distance <= safeDistance) {
    return 1;
  }

  if (distance >= awayDistance) {
    return 0;
  }

  const transition = smoothstep01((distance - safeDistance) / (awayDistance - safeDistance));
  const breakupFade = smoothstep01((distance - safeDistance) / 22);
  const noise = biomeMaskNoise(x, z);
  const borderNoise = valueNoise((x * 0.095) + 13.7, (z * 0.095) - 44.1);
  const pocketNoise = valueNoise((x * 0.22) - 90.2, (z * 0.22) + 6.8);
  const patchBreakup = (((borderNoise - 0.5) * 0.22) + ((pocketNoise - 0.5) * 0.13)) * breakupFade;
  const threshold = 0.18 + (transition * 0.8) + patchBreakup;
  const edgeSoftness = 0.028;
  return 1 - smoothstep01((threshold - noise + edgeSoftness) / (edgeSoftness * 2));
}

export function createBiomeDebugMaterial(scene: Scene) {
  const textureWidth = 384;
  const textureHeight = 768;
  const terrainWidth = 300;
  const terrainHeight = 600;
  const home = { r: 255, g: 225, b: 0 };
  const away = { r: 0, g: 82, b: 255 };
  const texture = new DynamicTexture("biomeDebugMask", { width: textureWidth, height: textureHeight }, scene, false, Texture.BILINEAR_SAMPLINGMODE);
  const context = texture.getContext() as CanvasRenderingContext2D;
  const image = context.createImageData(textureWidth, textureHeight);

  for (let y = 0; y < textureHeight; y += 1) {
    const v = y / (textureHeight - 1);
    const z = -(terrainHeight / 2) + (v * terrainHeight);

    for (let x = 0; x < textureWidth; x += 1) {
      const u = x / (textureWidth - 1);
      const worldX = -(terrainWidth / 2) + (u * terrainWidth);
      const homeAmount = biomeHomeAmount(worldX, z);
      const index = ((y * textureWidth) + x) * 4;
      image.data[index] = away.r + ((home.r - away.r) * homeAmount);
      image.data[index + 1] = away.g + ((home.g - away.g) * homeAmount);
      image.data[index + 2] = away.b + ((home.b - away.b) * homeAmount);
      image.data[index + 3] = 255;
    }
  }

  context.putImageData(image, 0, 0);
  texture.update(false);
  texture.wrapU = Texture.CLAMP_ADDRESSMODE;
  texture.wrapV = Texture.CLAMP_ADDRESSMODE;

  const material = new StandardMaterial("biomeDebugMaterial", scene);
  material.diffuseTexture = texture;
  material.emissiveTexture = texture;
  material.diffuseColor = Color3.White();
  material.emissiveColor = Color3.White();
  material.specularColor = Color3.Black();
  material.disableLighting = true;
  return material;
}

export function createBiomeGroundMaterial(scene: Scene, grassScale = 20, dirtUScale = 42, dirtVScale = 84) {
  const maskWidth = 768;
  const maskHeight = 1536;
  const terrainWidth = 300;
  const terrainHeight = 600;
  const maskTexture = new DynamicTexture("biomeGroundMask", { width: maskWidth, height: maskHeight }, scene, false, Texture.BILINEAR_SAMPLINGMODE);
  const maskContext = maskTexture.getContext() as CanvasRenderingContext2D;
  const maskImage = maskContext.createImageData(maskWidth, maskHeight);

  for (let y = 0; y < maskHeight; y += 1) {
    const v = y / (maskHeight - 1);
    const z = -(terrainHeight / 2) + (v * terrainHeight);

    for (let x = 0; x < maskWidth; x += 1) {
      const u = x / (maskWidth - 1);
      const worldX = -(terrainWidth / 2) + (u * terrainWidth);
      const value = biomeHomeAmount(worldX, z) >= 0.5 ? 255 : 0;
      const index = ((y * maskWidth) + x) * 4;
      maskImage.data[index] = value;
      maskImage.data[index + 1] = value;
      maskImage.data[index + 2] = value;
      maskImage.data[index + 3] = 255;
    }
  }

  maskContext.putImageData(maskImage, 0, 0);
  maskTexture.update(false);
  maskTexture.wrapU = Texture.CLAMP_ADDRESSMODE;
  maskTexture.wrapV = Texture.CLAMP_ADDRESSMODE;

  if (!Effect.ShadersStore.biomeGroundVertexShader) {
    Effect.ShadersStore.biomeGroundVertexShader = `
      precision highp float;
      attribute vec3 position;
      attribute vec2 uv;
      uniform mat4 worldViewProjection;
      varying vec2 vUV;
      varying vec2 vWorldXZ;

      void main(void) {
        vUV = uv;
        vWorldXZ = position.xz;
        gl_Position = worldViewProjection * vec4(position, 1.0);
      }
    `;

    Effect.ShadersStore.biomeGroundFragmentShader = `
      precision highp float;
      varying vec2 vUV;
      varying vec2 vWorldXZ;
      uniform sampler2D grassTexture;
      uniform sampler2D dirtTexture;
      uniform sampler2D maskTexture;
      uniform float grassScale;
      uniform vec2 dirtScale;

      void main(void) {
        vec4 grass = texture2D(grassTexture, vUV * grassScale);
        vec4 dirt = texture2D(dirtTexture, vec2(vUV.x * dirtScale.x, vUV.y * dirtScale.y));
        float mask = step(0.5, texture2D(maskTexture, vUV).r);
        gl_FragColor = mix(dirt, grass, mask);
      }
    `;
  }

  const material = new ShaderMaterial("biomeGroundMaterial", scene, "biomeGround", {
    attributes: ["position", "uv"],
    uniforms: ["worldViewProjection", "grassScale", "dirtScale"],
    samplers: ["grassTexture", "dirtTexture", "maskTexture"],
  });
  const grassTexture = new Texture(grassyGroundTextureUrl, scene, false, false, Texture.TRILINEAR_SAMPLINGMODE);
  const dirtTexture = new Texture(dirtGroundTextureUrl, scene, false, false, Texture.TRILINEAR_SAMPLINGMODE);
  grassTexture.wrapU = Texture.WRAP_ADDRESSMODE;
  grassTexture.wrapV = Texture.WRAP_ADDRESSMODE;
  dirtTexture.wrapU = Texture.WRAP_ADDRESSMODE;
  dirtTexture.wrapV = Texture.WRAP_ADDRESSMODE;
  material.setTexture("grassTexture", grassTexture);
  material.setTexture("dirtTexture", dirtTexture);
  material.setTexture("maskTexture", maskTexture);
  material.setFloat("grassScale", grassScale);
  material.setVector2("dirtScale", new Vector2(dirtUScale, dirtVScale));
  return material;
}

export function updateBiomeGroundMaterialScale(material: Material, grassScale: number, dirtUScale: number, dirtVScale: number) {
  if (material instanceof ShaderMaterial) {
    material.setFloat("grassScale", grassScale);
    material.setVector2("dirtScale", new Vector2(dirtUScale, dirtVScale));
  }
}

function createGrassOverlayMask(scene: Scene) {
  const width = 1024;
  const height = 2048;
  const texture = new DynamicTexture("worldGrassMask", { width, height }, scene, false, Texture.NEAREST_SAMPLINGMODE);
  const context = texture.getContext() as CanvasRenderingContext2D;
  const image = context.createImageData(width, height);

  for (let y = 0; y < height; y += 1) {
    const v = y / (height - 1);
    const z = -300 + (v * 600);

    for (let x = 0; x < width; x += 1) {
      const u = x / (width - 1);
      const worldX = -150 + (u * 300);
      const mask = grassMaskValue(worldX, z, u, v);
      const value = mask * 255;
      const index = ((y * width) + x) * 4;
      image.data[index] = value;
      image.data[index + 1] = value;
      image.data[index + 2] = value;
      image.data[index + 3] = value;
    }
  }

  context.putImageData(image, 0, 0);
  texture.update();
  texture.wrapU = Texture.CLAMP_ADDRESSMODE;
  texture.wrapV = Texture.CLAMP_ADDRESSMODE;
  return texture;
}

export function createWorldTerrain(scene: Scene, material: Material) {
  const width = 300;
  const height = 600;
  const subdivisionsX = 80;
  const subdivisionsZ = 132;
  const positions: number[] = [];
  const indices: number[] = [];
  const uvs: number[] = [];

  for (let zIndex = 0; zIndex <= subdivisionsZ; zIndex += 1) {
    const z = -height / 2 + ((zIndex / subdivisionsZ) * height);

    for (let xIndex = 0; xIndex <= subdivisionsX; xIndex += 1) {
      const x = -width / 2 + ((xIndex / subdivisionsX) * width);
      positions.push(x, terrainHeightAt(x, z) - 0.08, z);
      uvs.push(xIndex / subdivisionsX, zIndex / subdivisionsZ);
    }
  }

  const row = subdivisionsX + 1;

  for (let zIndex = 0; zIndex < subdivisionsZ; zIndex += 1) {
    for (let xIndex = 0; xIndex < subdivisionsX; xIndex += 1) {
      const base = (zIndex * row) + xIndex;
      indices.push(base, base + 1, base + row);
      indices.push(base + 1, base + row + 1, base + row);
    }
  }

  const normals: number[] = [];
  VertexData.ComputeNormals(positions, indices, normals);

  const mesh = new Mesh("world-terrain", scene);
  const vertexData = new VertexData();
  vertexData.positions = positions;
  vertexData.indices = indices;
  vertexData.normals = normals;
  vertexData.uvs = uvs;
  vertexData.applyToMesh(mesh);
  mesh.material = material;
  mesh.receiveShadows = true;
  return mesh;
}

export function createWorldGrassOverlay(scene: Scene, material: StandardMaterial) {
  const width = 300;
  const height = 600;
  const subdivisionsX = 80;
  const subdivisionsZ = 132;
  const positions: number[] = [];
  const indices: number[] = [];
  const uvs: number[] = [];

  for (let zIndex = 0; zIndex <= subdivisionsZ; zIndex += 1) {
    const z = -height / 2 + ((zIndex / subdivisionsZ) * height);

    for (let xIndex = 0; xIndex <= subdivisionsX; xIndex += 1) {
      const x = -width / 2 + ((xIndex / subdivisionsX) * width);
      const y = terrainHeightAt(x, z) - 0.066;
      positions.push(x, y, z);
      uvs.push(xIndex / subdivisionsX, zIndex / subdivisionsZ);
    }
  }

  const row = subdivisionsX + 1;

  for (let zIndex = 0; zIndex < subdivisionsZ; zIndex += 1) {
    for (let xIndex = 0; xIndex < subdivisionsX; xIndex += 1) {
      const base = (zIndex * row) + xIndex;
      indices.push(base, base + 1, base + row);
      indices.push(base + 1, base + row + 1, base + row);
    }
  }

  const normals: number[] = [];
  VertexData.ComputeNormals(positions, indices, normals);

  const mesh = new Mesh("world-grass-overlay", scene);
  const vertexData = new VertexData();
  vertexData.positions = positions;
  vertexData.indices = indices;
  vertexData.normals = normals;
  vertexData.uvs = uvs;
  vertexData.applyToMesh(mesh);
  material.opacityTexture?.dispose();
  material.opacityTexture = createGrassOverlayMask(scene);
  (material.opacityTexture as { getAlphaFromRGB?: boolean }).getAlphaFromRGB = true;
  mesh.material = material;
  return mesh;
}

function createRoadStripe(scene: Scene, material: StandardMaterial, z: number) {
  const mesh = new Mesh("road-stripe", scene);
  const steps = 8;
  const halfWidth = 0.07;
  const halfLength = 1.86;
  const sectionCount = 8;
  const section = Math.floor(Math.abs(valueNoise((z * 0.071) + 22, 6.5) * sectionCount)) % sectionCount;
  const uMin = section / sectionCount;
  const uMax = (section + 1) / sectionCount;
  const positions: number[] = [];
  const indices: number[] = [];
  const uvs: number[] = [];

  for (let i = 0; i <= steps; i += 1) {
    const t = i / steps;
    const localZ = -halfLength + (t * halfLength * 2);
    const leftNoise = (valueNoise(40 + (z * 0.13), i * 1.7) - 0.5) * 0.045;
    const rightNoise = (valueNoise(80 + (z * 0.11), i * 1.9) - 0.5) * 0.045;
    positions.push(-halfWidth + leftNoise, 0, localZ);
    positions.push(halfWidth + rightNoise, 0, localZ);
    uvs.push(uMin, t);
    uvs.push(uMax, t);

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
  vertexData.uvs = uvs;
  vertexData.applyToMesh(mesh);
  mesh.position = new Vector3(14.5, 0.018, z);
  mesh.material = material;
}

export function createRoad(scene: Scene, roadMaterial: StandardMaterial, stripeMaterial: StandardMaterial) {
  roadMaterial.diffuseColor.set(1, 1, 1);
  roadMaterial.diffuseTexture?.dispose();
  roadMaterial.diffuseTexture = createRoadFileTexture(scene);
  stripeMaterial.diffuseColor.set(1, 1, 1);
  stripeMaterial.diffuseTexture?.dispose();
  stripeMaterial.diffuseTexture = createRoadStripeAtlasTexture(scene);
  stripeMaterial.opacityTexture?.dispose();
  stripeMaterial.opacityTexture = stripeMaterial.diffuseTexture;
  stripeMaterial.useAlphaFromDiffuseTexture = false;
  stripeMaterial.backFaceCulling = false;
  stripeMaterial.transparencyMode = Material.MATERIAL_ALPHABLEND;
  (stripeMaterial.opacityTexture as { getAlphaFromRGB?: boolean }).getAlphaFromRGB = true;

  const road = MeshBuilder.CreateGround("road", { width: 5.2, height: 540 }, scene);
  road.position = new Vector3(14.5, 0.006, 0);
  road.material = roadMaterial;

  for (let z = -262; z <= 262; z += 10) {
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

function distanceToSegment2D(x: number, z: number, ax: number, az: number, bx: number, bz: number) {
  const dx = bx - ax;
  const dz = bz - az;
  const lengthSquared = (dx * dx) + (dz * dz);
  const t = lengthSquared === 0 ? 0 : Math.max(0, Math.min(1, (((x - ax) * dx) + ((z - az) * dz)) / lengthSquared));
  const cx = ax + (dx * t);
  const cz = az + (dz * t);
  const ox = x - cx;
  const oz = z - cz;
  return Math.sqrt((ox * ox) + (oz * oz));
}

// A single ground-level overlay of the real dirt texture, made opaque only
// within a noise-perturbed band of the fence *segments* (distance based, so it
// is orientation-free and cannot land rotated), and transparent over grass so
// the lawn shows through. This is the grass -> dirt texture swap, with
// randomized, blended edges rather than straight strips.
function createFenceDirtOverlay(scene: Scene, segments: FenceSegment[]) {
  let xMin = Number.POSITIVE_INFINITY;
  let xMax = Number.NEGATIVE_INFINITY;
  let zMin = Number.POSITIVE_INFINITY;
  let zMax = Number.NEGATIVE_INFINITY;

  for (const segment of segments) {
    for (const point of [segment.start, segment.end]) {
      xMin = Math.min(xMin, point.x);
      xMax = Math.max(xMax, point.x);
      zMin = Math.min(zMin, point.z);
      zMax = Math.max(zMax, point.z);
    }
  }

  const margin = 1.2;
  xMin -= margin;
  xMax += margin;
  zMin -= margin;
  zMax += margin;
  const width = xMax - xMin;
  const depth = zMax - zMin;

  const texelsPerUnit = 28;
  const maskWidth = Math.min(2048, Math.round(width * texelsPerUnit));
  const maskHeight = Math.min(2048, Math.round(depth * texelsPerUnit));
  const mask = new DynamicTexture("fenceDirtMask", { width: maskWidth, height: maskHeight }, scene, false, Texture.BILINEAR_SAMPLINGMODE);
  mask.hasAlpha = true;
  const context = mask.getContext() as CanvasRenderingContext2D;
  const image = context.createImageData(maskWidth, maskHeight);

  for (let j = 0; j < maskHeight; j += 1) {
    const worldZ = zMin + ((j / (maskHeight - 1)) * depth);

    for (let i = 0; i < maskWidth; i += 1) {
      const worldX = xMin + ((i / (maskWidth - 1)) * width);
      let distance = Number.POSITIVE_INFINITY;

      for (const segment of segments) {
        distance = Math.min(distance, distanceToSegment2D(worldX, worldZ, segment.start.x, segment.start.z, segment.end.x, segment.end.z));
      }

      // Wobble the band edge with two octaves of noise so the soil border reads
      // as a natural ragged edge instead of a clean offset line.
      const edge = (((valueNoise((worldX * 1.3) + 5, (worldZ * 1.3) - 9) - 0.5) * 0.17))
        + (((valueNoise((worldX * 3.7) - 2, (worldZ * 3.7) + 4) - 0.5) * 0.08));
      const band = 0.3 + edge;
      const dirtAmount = 1 - smoothstep01((distance - band) / 0.22);
      const index = ((j * maskWidth) + i) * 4;
      image.data[index] = 255;
      image.data[index + 1] = 255;
      image.data[index + 2] = 255;
      image.data[index + 3] = Math.round(dirtAmount * 255);
    }
  }

  context.putImageData(image, 0, 0);
  mask.update();
  mask.wrapU = Texture.CLAMP_ADDRESSMODE;
  mask.wrapV = Texture.CLAMP_ADDRESSMODE;

  const dirtTexture = new Texture(dirtGroundTextureUrl, scene);
  dirtTexture.uScale = width * 0.5;
  dirtTexture.vScale = depth * 0.5;

  const material = new StandardMaterial("fenceDirtMaterial", scene);
  material.diffuseTexture = dirtTexture;
  material.opacityTexture = mask;
  material.specularColor = Color3.Black();
  material.transparencyMode = Material.MATERIAL_ALPHABLEND;
  material.backFaceCulling = false;

  const overlay = MeshBuilder.CreateGround("fence-dirt-overlay", { width, height: depth }, scene);
  overlay.position = new Vector3((xMin + xMax) / 2, -0.072, (zMin + zMax) / 2);
  overlay.material = material;
  overlay.isPickable = false;
  overlay.receiveShadows = true;
  return overlay;
}

export function createFence(scene: Scene, fenceMaterial: StandardMaterial, segments: FenceSegment[]) {
  const root = new TransformNode("fence-root", scene);

  for (const [index, segment] of segments.entries()) {
    createFencePlanks(scene, fenceMaterial, index, segment.start, segment.end);

    for (const position of [segment.start, segment.end]) {
      createFencePost(scene, fenceMaterial, new Vector3(position.x, 0.35, position.z), new Vector3(0.18, 0.7, 0.18));
    }
  }

  createFenceDirtOverlay(scene, segments);

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

  void groundMaterial;

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
