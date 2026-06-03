import { MeshBuilder, ShadowGenerator, StandardMaterial, TransformNode, Vector3 } from "@babylonjs/core";
import type { Scene } from "@babylonjs/core";
import type { Materials } from "./materials";
import type { RockCollider } from "./types";
import { terrainHeightAt } from "./world";

function createTree(
  scene: Scene,
  shadowGenerator: ShadowGenerator,
  trunkMaterial: StandardMaterial,
  leafMaterial: StandardMaterial,
  x: number,
  z: number,
  scale: number,
) {
  const root = new TransformNode("simple-tree", scene);
  const groundY = terrainHeightAt(x, z) - 0.06;
  root.position = new Vector3(x, groundY, z);
  root.rotation.y = Math.random() * Math.PI * 2;

  const trunkHeight = 1.4 * scale;
  const trunk = MeshBuilder.CreateCylinder("tree-trunk", {
    height: trunkHeight,
    diameterTop: 0.24 * scale,
    diameterBottom: 0.36 * scale,
    tessellation: 7,
  }, scene);
  trunk.parent = root;
  trunk.position.y = trunkHeight / 2;
  trunk.rotation.x = (Math.random() - 0.5) * 0.08;
  trunk.rotation.z = (Math.random() - 0.5) * 0.08;
  trunk.material = trunkMaterial;
  shadowGenerator.addShadowCaster(trunk);

  const lowerLeaves = MeshBuilder.CreateSphere("tree-leaves-lower", { diameter: 1.45 * scale, segments: 7 }, scene);
  lowerLeaves.parent = root;
  lowerLeaves.position = new Vector3(0.05 * scale, trunkHeight + (0.32 * scale), 0);
  lowerLeaves.scaling = new Vector3(1.08, 0.86, 1);
  lowerLeaves.material = leafMaterial;
  shadowGenerator.addShadowCaster(lowerLeaves);

  const crown = MeshBuilder.CreateSphere("tree-leaves-crown", { diameter: 1.08 * scale, segments: 7 }, scene);
  crown.parent = root;
  crown.position = new Vector3(-0.12 * scale, trunkHeight + (0.88 * scale), 0.06 * scale);
  crown.scaling = new Vector3(0.92, 1.1, 0.95);
  crown.material = leafMaterial;
  shadowGenerator.addShadowCaster(crown);

  return root;
}

export function createSimpleTrees(scene: Scene, materials: Materials, shadowGenerator: ShadowGenerator) {
  const trees = [
    { x: -52, z: -36, scale: 1.35, material: materials.treeLeafMaterials[0] },
    { x: -43, z: 42, scale: 0.9, material: materials.treeLeafMaterials[1] },
    { x: 34, z: -48, scale: 1.15, material: materials.treeLeafMaterials[2] },
    { x: 58, z: 31, scale: 1.65, material: materials.treeLeafMaterials[0] },
    { x: -22, z: 64, scale: 0.72, material: materials.treeLeafMaterials[1] },
  ];

  for (const tree of trees) {
    createTree(scene, shadowGenerator, materials.treeTrunkMaterial, tree.material, tree.x, tree.z, tree.scale);
  }
}

function createBoulder(
  scene: Scene,
  shadowGenerator: ShadowGenerator,
  colliders: RockCollider[],
  material: StandardMaterial,
  x: number,
  z: number,
  scale: number,
) {
  const rock = MeshBuilder.CreateSphere("boulder", { diameter: 1, segments: 7 }, scene);
  const horizontalScaleX = scale * (1.1 + (Math.random() * 0.35));
  const horizontalScaleZ = scale * (0.8 + (Math.random() * 0.4));
  rock.position = new Vector3(x, terrainHeightAt(x, z) + (0.18 * scale), z);
  rock.scaling = new Vector3(horizontalScaleX, scale * (0.42 + (Math.random() * 0.22)), horizontalScaleZ);
  rock.rotation = new Vector3(Math.random() * 0.22, Math.random() * Math.PI, Math.random() * 0.28);
  rock.material = material;
  shadowGenerator.addShadowCaster(rock);
  colliders.push({ x, z, radius: Math.max(horizontalScaleX, horizontalScaleZ) * 0.56 });
}

export function createSceneryRocks(scene: Scene, materials: Materials, shadowGenerator: ShadowGenerator): RockCollider[] {
  const colliders: RockCollider[] = [];
  const rocks = [
    { x: -39, z: -25, scale: 1.3, material: materials.rockMaterials[2] },
    { x: -47, z: -31, scale: 0.72, material: materials.rockMaterials[0] },
    { x: 24, z: -28, scale: 0.9, material: materials.rockMaterials[1] },
    { x: 39, z: 19, scale: 1.6, material: materials.rockMaterials[0] },
    { x: -18, z: 42, scale: 0.8, material: materials.rockMaterials[2] },
    { x: 55, z: -54, scale: 1.9, material: materials.rockMaterials[1] },
    { x: -64, z: 18, scale: 1.2, material: materials.rockMaterials[0] },
  ];

  for (const rock of rocks) {
    createBoulder(scene, shadowGenerator, colliders, rock.material, rock.x, rock.z, rock.scale);
  }

  return colliders;
}
