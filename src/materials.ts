import { Color3, PBRMaterial, Scene, StandardMaterial } from "@babylonjs/core";
import { createDirtGroundTexture, createDirtNormalTexture } from "./textures";

export type Materials = ReturnType<typeof createMaterials>;

// Creates every shared material once. Returned by their existing names so
// callers can destructure and keep referring to e.g. `bladeMaterial` directly.
export function createMaterials(scene: Scene) {
  const makeMaterial = (name: string, color: Color3, roughness = 0.65) => {
    const material = new PBRMaterial(name, scene);
    material.albedoColor = color;
    material.roughness = roughness;
    material.metallic = 0;
    return material;
  };

  const playerMaterial = makeMaterial("playerMaterial", new Color3(0.08, 0.36, 0.95), 0.42);
  const groundMaterial = makeMaterial("groundMaterial", new Color3(0.42, 0.5, 0.08), 0.9);

  const bladeMaterial = makeMaterial("bladeMaterial", Color3.White(), 0.38);
  bladeMaterial.backFaceCulling = false;
  bladeMaterial.clearCoat.isEnabled = true;

  const cutBladeMaterial = makeMaterial("cutBladeMaterial", Color3.White(), 0.58);
  cutBladeMaterial.backFaceCulling = false;
  cutBladeMaterial.clearCoat.isEnabled = true;

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

  return {
    playerMaterial,
    groundMaterial,
    bladeMaterial,
    cutBladeMaterial,
    dandelionStemMaterial,
    dandelionYellowMaterial,
    dandelionSeedMaterial,
    dandelionCenterMaterial,
    tulipStemMaterial,
    tulipHeadMaterials,
    roadMaterial,
    stripeMaterial,
    fenceMaterial,
    worldGroundMaterial,
    secretGunMaterial,
    secretGunGripMaterial,
    treeTrunkMaterial,
    treeLeafMaterials,
    rockMaterials,
  };
}
