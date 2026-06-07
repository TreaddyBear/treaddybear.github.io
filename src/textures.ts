import { Color3, DynamicTexture, Scene, Texture } from "@babylonjs/core";
import { settings } from "./config";
import { clamp01, color3ToHsl, hexToColor3, hslToColor3 } from "./utils/color";
import { valueNoise } from "./utils/noise";
import grassyGroundUrl from "./assets/textures/ground-grassy.png?url";
import dirtGroundUrl from "./assets/textures/Dirt_02.png?url";
import dirtNormalUrl from "./assets/textures/Dirt_02_Nrm.png?url";
import roadPatternUrl from "./assets/textures/road-pattern.png?url";
import roadStripeAtlasUrl from "./assets/textures/road-stripes-atlas.png?url";

export const grassyGroundTextureUrl = grassyGroundUrl;
export const dirtGroundTextureUrl = dirtGroundUrl;

function createTiledTexture(
  name: string,
  url: string,
  scene: Scene,
  uScale: number,
  vScale: number,
  samplingMode = Texture.NEAREST_SAMPLINGMODE,
) {
  const texture = new Texture(url, scene, false, false, samplingMode);
  texture.name = name;
  texture.uScale = uScale;
  texture.vScale = vScale;
  texture.anisotropicFilteringLevel = samplingMode === Texture.NEAREST_SAMPLINGMODE ? 1 : 8;
  return texture;
}

export function createGrassyGroundTexture(scene: Scene) {
  return createTiledTexture(
    "groundGrassyFile",
    grassyGroundUrl,
    scene,
    settings.grassyTextureScale,
    settings.grassyTextureScale,
  );
}

export function createDirtGroundTexture(scene: Scene) {
  return createTiledTexture(
    "groundDirtFile",
    dirtGroundUrl,
    scene,
    settings.dirtTextureUScale,
    settings.dirtTextureVScale,
  );
}

export function createDirtNormalTexture(scene: Scene) {
  const texture = createTiledTexture(
    "groundDirtNormalFile",
    dirtNormalUrl,
    scene,
    settings.dirtTextureUScale,
    settings.dirtTextureVScale,
  );
  texture.level = settings.dirtNormalStrength;
  return texture;
}

export function createRoadFileTexture(scene: Scene) {
  return createTiledTexture(
    "roadPatternFile",
    roadPatternUrl,
    scene,
    settings.roadTextureUScale,
    settings.roadTextureVScale,
    Texture.TRILINEAR_SAMPLINGMODE,
  );
}

export function createRoadStripeAtlasTexture(scene: Scene) {
  return createTiledTexture(
    "roadStripeAtlasFile",
    roadStripeAtlasUrl,
    scene,
    1,
    1,
    Texture.TRILINEAR_SAMPLINGMODE,
  );
}

export function createGroundTexture(scene: Scene) {
  const texture = new DynamicTexture("groundNoise", { width: 128, height: 128 }, scene);
  const context = texture.getContext() as CanvasRenderingContext2D;
  const image = context.createImageData(128, 128);
  const base = hexToColor3(settings.groundColor);

  for(let pixelY = 0; pixelY < 128; pixelY += 1) {
    for(let pixelX = 0; pixelX < 128; pixelX += 1) {
      const noise = (valueNoise(pixelX * 0.12, pixelY * 0.12) - 0.5) * 0.24;
      const pixelIndex = ((pixelY * 128) + pixelX) * 4;

      image.data[pixelIndex] = clamp01(base.r + noise) * 255;
      image.data[pixelIndex + 1] = clamp01(base.g + noise) * 255;
      image.data[pixelIndex + 2] = clamp01(base.b + noise) * 255;
      image.data[pixelIndex + 3] = 255;
    }
  }

  context.putImageData(image, 0, 0);
  texture.update();
  return texture;
}

export function createRoadTexture(scene: Scene, baseColor = new Color3(0.42, 0.41, 0.38)) {
  const width = 128;
  const height = 1024;
  const texture = new DynamicTexture("roadNoise", { width, height }, scene);
  const context = texture.getContext() as CanvasRenderingContext2D;
  const image = context.createImageData(width, height);
  const base = color3ToHsl(baseColor);
  const softBand = (distance: number, radius: number) => {
    const bandAmount = clamp01(distance / radius);
    return 1 - (bandAmount * bandAmount * (3 - (2 * bandAmount)));
  };

  for(let pixelY = 0; pixelY < height; pixelY += 1) {
    for(let pixelX = 0; pixelX < width; pixelX += 1) {
      const uCoord = pixelX / (width - 1);
      const vCoord = pixelY / (height - 1);
      const large = (valueNoise((uCoord * 5.5) + 11, (vCoord * 30) - 9) - 0.5) * 0.075;
      const fine = (valueNoise((uCoord * 82) + 91, (vCoord * 620) - 17) - 0.5) * 0.26;
      const edgeMask = softBand(Math.min(uCoord, 1 - uCoord), 0.06);
      const centerMask = softBand(Math.abs(uCoord - 0.5), 0.028);
      const darkBand = Math.max(edgeMask, centerMask) * 0.18;
      const lightness = clamp01((base.l * (1 + large + (fine * 0.22))) * (1 - darkBand));
      const color = hslToColor3(base.h + (large * 0.01), base.s * (1 + (fine * 0.05)), lightness);
      const pixelIndex = ((pixelY * width) + pixelX) * 4;

      image.data[pixelIndex] = color.r * 255;
      image.data[pixelIndex + 1] = color.g * 255;
      image.data[pixelIndex + 2] = color.b * 255;
      image.data[pixelIndex + 3] = 255;
    }
  }

  context.putImageData(image, 0, 0);
  texture.update();
  texture.uScale = 1;
  texture.vScale = 1;
  return texture;
}
