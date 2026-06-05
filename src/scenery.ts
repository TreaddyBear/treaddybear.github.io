import { Color3, MeshBuilder, ShadowGenerator, StandardMaterial, TransformNode, Vector3, VertexBuffer } from "@babylonjs/core";
import type { Mesh, Scene } from "@babylonjs/core";
import type { Materials } from "./materials";
import type { RockCollider } from "./types";
import { terrainHeightAt } from "./world";

// A leafy clump: a low-poly flat-shaded icosphere, irregularly squashed so the
// canopy reads as organic foliage rather than a perfect sphere.
function createFoliageBlob(scene: Scene, material: StandardMaterial, diameter: number) {
  const blob = MeshBuilder.CreateIcoSphere("tree-foliage", { radius: diameter / 2, subdivisions: 2, flat: true }, scene);
  const positions = blob.getVerticesData(VertexBuffer.PositionKind);

  if (positions) {
    for (let i = 0; i < positions.length; i += 3) {
      const jitter = 0.82 + (Math.random() * 0.36);
      positions[i] *= jitter;
      positions[i + 1] *= jitter;
      positions[i + 2] *= jitter;
    }

    blob.setVerticesData(VertexBuffer.PositionKind, positions);
    blob.convertToFlatShadedMesh();
  }

  blob.material = material;
  return blob;
}

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
  root.position = new Vector3(x, terrainHeightAt(x, z) - 0.06, z);
  root.rotation.y = Math.random() * Math.PI * 2;

  // Tapered, slightly leaning trunk.
  const trunkHeight = 1.8 * scale;
  const lean = (Math.random() - 0.5) * 0.12;
  const leanDir = Math.random() * Math.PI * 2;
  const trunk = MeshBuilder.CreateCylinder("tree-trunk", {
    height: trunkHeight,
    diameterTop: 0.14 * scale,
    diameterBottom: 0.42 * scale,
    tessellation: 8,
  }, scene);
  trunk.parent = root;
  trunk.position.y = trunkHeight / 2;
  trunk.rotation.x = Math.cos(leanDir) * lean;
  trunk.rotation.z = Math.sin(leanDir) * lean;
  trunk.material = trunkMaterial;
  shadowGenerator.addShadowCaster(trunk);

  // A few branches angling up into the canopy.
  const branchCount = 3 + Math.floor(Math.random() * 2);
  for (let b = 0; b < branchCount; b += 1) {
    const angle = (b / branchCount) * Math.PI * 2 + (Math.random() * 0.8);
    const branchHeight = (0.7 + (Math.random() * 0.35)) * scale;
    const branch = MeshBuilder.CreateCylinder("tree-branch", {
      height: branchHeight,
      diameterTop: 0.03 * scale,
      diameterBottom: 0.13 * scale,
      tessellation: 5,
    }, scene);
    branch.parent = root;
    branch.position = new Vector3(0, trunkHeight * (0.62 + (Math.random() * 0.2)), 0);
    branch.rotation = new Vector3(Math.cos(angle) * 0.9, -angle, Math.sin(angle) * 0.9);
    branch.material = trunkMaterial;
    shadowGenerator.addShadowCaster(branch);
  }

  // Canopy: a cluster of irregular foliage clumps, lighter on top and darker
  // underneath, drooping a little at the edges — not a smooth ball.
  const underMaterial = leafMaterial.clone(`${leafMaterial.name}-under`);
  underMaterial.diffuseColor = leafMaterial.diffuseColor.scale(0.62);
  const canopyBase = trunkHeight + (0.15 * scale);
  const canopyHeight = 1.25 * scale;
  const blobCount = 9;

  for (let i = 0; i < blobCount; i += 1) {
    const heightFrac = i === 0 ? 1 : Math.random();
    const angle = i * 2.39996323;
    const spread = (0.32 + (Math.random() * 0.5)) * (1.05 - (heightFrac * 0.55)) * scale;
    const blobDiameter = (0.62 + (Math.random() * 0.55)) * scale;
    const blob = createFoliageBlob(scene, heightFrac > 0.4 ? leafMaterial : underMaterial, blobDiameter);
    blob.parent = root;
    blob.position = new Vector3(
      Math.cos(angle) * spread,
      canopyBase + (heightFrac * canopyHeight),
      Math.sin(angle) * spread,
    );
    blob.scaling = new Vector3(1.08, 0.82 + (Math.random() * 0.2), 1.08);
    shadowGenerator.addShadowCaster(blob);
  }

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
  // Faceted boulder carved from a single smooth (flat: false) icosphere so the
  // vertices are shared and the rock stays one watertight lump; we flat-shade at
  // the very end to get the angular facets back.
  const rock = MeshBuilder.CreateIcoSphere("boulder", { radius: 0.5, subdivisions: 2, flat: false, updatable: true }, scene);
  const positions = rock.getVerticesData(VertexBuffer.PositionKind);

  if (positions) {
    // Displace each vertex ALONG ITS OWN RAY by a smooth, low-frequency amount
    // (a sum of a few directional lobes). Because the radius is a smooth, always
    // positive function of direction, neighbouring vertices keep similar radii,
    // so the surface stays star-convex and physically cannot fold through itself
    // into spikes. High-frequency per-vertex noise on this coarse a sphere is
    // exactly what tore the old rock apart, so there is deliberately none here.
    const randomAxis = () => new Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize();
    const lobes = [
      { axis: randomAxis(), amp: 0.17 },
      { axis: randomAxis(), amp: 0.12 },
      { axis: randomAxis(), amp: 0.08 },
    ];

    for (let i = 0; i < positions.length; i += 3) {
      const len = Math.hypot(positions[i], positions[i + 1], positions[i + 2]) || 1;
      const nx = positions[i] / len;
      const ny = positions[i + 1] / len;
      const nz = positions[i + 2] / len;

      let radius = 0.5;
      for (const lobe of lobes) {
        radius += ((nx * lobe.axis.x) + (ny * lobe.axis.y) + (nz * lobe.axis.z)) * lobe.amp;
      }

      positions[i] = nx * radius;
      positions[i + 1] = ny * radius * 0.76; // squash a little so it reads as a rock, not a ball
      positions[i + 2] = nz * radius;
    }

    rock.setVerticesData(VertexBuffer.PositionKind, positions);
    rock.convertToFlatShadedMesh();
  }

  const scaleX = scale * (1.1 + (Math.random() * 0.5));
  const scaleY = scale * (0.7 + (Math.random() * 0.35));
  const scaleZ = scale * (0.95 + (Math.random() * 0.45));
  rock.scaling = new Vector3(scaleX, scaleY, scaleZ);
  rock.rotation = new Vector3(0, Math.random() * Math.PI, 0);
  // Sink the lower third into the ground: the terrain cuts a clean flat line
  // across it, so it reads as flat-bottomed without any degenerate base geometry.
  rock.position = new Vector3(x, terrainHeightAt(x, z) + (0.1 * scaleY), z);
  rock.material = material;
  shadowGenerator.addShadowCaster(rock);
  colliders.push({ x, z, radius: Math.max(scaleX, scaleZ) * 0.5 });
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
