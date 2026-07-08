import {
  Color3,
  CubeTexture,
  Mesh,
  MeshBuilder,
  Scene,
  StandardMaterial,
  Texture,
} from "@babylonjs/core";
import "@babylonjs/core/Materials/Textures/Loaders/envTextureLoader";
import { renderingGroups } from "./renderOrder";

const publicAsset = (path: string) => `${import.meta.env.BASE_URL}${path}`;

export const skyTextureSources = {
  simple: publicAsset("sky/skybox-simple.webp"),
  orientation: publicAsset("sky/skybox-debug-orientation.png"),
  magenta: publicAsset("sky/skybox-debug-magenta.png"),
} as const;

export type SkyTextureKey = keyof typeof skyTextureSources;

export type SkyEnvironment = ReturnType<typeof createSkyEnvironment>;

export function createSkyEnvironment(scene: Scene) {
  scene.environmentTexture = CubeTexture.CreateFromPrefilteredData(publicAsset("env/skybox-simple.env"), scene);
  scene.environmentIntensity = 0.42;

  let currentTexture: Texture | null = null;
  let verticalOffset = 0;
  let flipped = false;

  const material = new StandardMaterial("skyboxSimpleMaterial", scene);
  material.diffuseColor = Color3.Black();
  material.emissiveColor = Color3.White();
  material.specularColor = Color3.Black();
  material.disableLighting = true;
  material.disableDepthWrite = true;
  material.backFaceCulling = false;

  const dome = MeshBuilder.CreateSphere("skybox-simple", {
    diameter: 900,
    segments: 32,
    sideOrientation: Mesh.BACKSIDE,
  }, scene);
  dome.material = material;
  dome.isPickable = false;
  dome.infiniteDistance = true;
  dome.renderingGroupId = renderingGroups.world;

  const applyTransform = () => {
    if (!currentTexture) {
      return;
    }

    currentTexture.vScale = flipped ? -1 : 1;
    currentTexture.vOffset = flipped ? 1 + verticalOffset : verticalOffset;
  };

  const setTexture = (key: SkyTextureKey) => {
    const next = new Texture(skyTextureSources[key], scene, false, true, Texture.TRILINEAR_SAMPLINGMODE);
    next.wrapU = Texture.WRAP_ADDRESSMODE;
    next.wrapV = Texture.CLAMP_ADDRESSMODE;
    currentTexture?.dispose();
    currentTexture = next;
    applyTransform();
    material.emissiveTexture = next;
  };

  const setVerticalOffset = (value: number) => {
    verticalOffset = value;
    applyTransform();
  };

  const setFlipped = (value: boolean) => {
    flipped = value;
    applyTransform();
  };

  setTexture("simple");

  return {
    dome,
    material,
    setTexture,
    setVerticalOffset,
    setFlipped,
  };
}
