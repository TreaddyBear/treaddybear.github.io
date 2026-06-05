import { Color3, Mesh, MeshBuilder, ShadowGenerator, StandardMaterial, TransformNode, Vector3, VertexBuffer, VertexData } from "@babylonjs/core";
import type { Scene } from "@babylonjs/core";
import type { Materials } from "./materials";
import type { RockCollider } from "./types";
import { sampledTerrainHeightAt } from "./world";

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
  root.position = new Vector3(x, sampledTerrainHeightAt(x, z) - 0.06, z);
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

// Three boulder-shaping methods we're comparing:
//   A — current: one icosphere (subdiv 3), every vertex displaced along its ray
//       by big directional lobes + per-vertex jitter, then flat-shaded.
//   B — same idea but a denser icosphere (subdiv 5): smoother silhouette, more
//       facets, at the risk of looking lumpy/blobby rather than geologic.
//   C — multi-resolution: start chunky (subdiv 1 = a deformed icosahedron with
//       big planar faces), subdivide AFTER the fact, then roughen only the new
//       finer vertices. Keeps the big geometric planes but adds crag detail.
export type RockMethod = "A" | "B" | "C";

const randomAxis = () => new Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize();

// Per-vertex jitter keyed by quantised direction, so coincident vertices always
// get the same value and no seam can open between facets.
function makeJitter() {
  const eps = 0.01;
  const cache = new Map<string, number>();
  return (nx: number, ny: number, nz: number) => {
    const key = `${Math.round(nx / eps)},${Math.round(ny / eps)},${Math.round(nz / eps)}`;
    let value = cache.get(key);
    if (value === undefined) {
      value = Math.random();
      cache.set(key, value);
    }
    return value;
  };
}

// Shape a (roughly unit) sphere into a rock: each vertex moves along its ray to
// radius = base + lobes·direction + jitter. Always-positive radius keeps it a
// valid non-self-intersecting star shape; squash flattens it a touch.
function displaceField(positions: number[], lobeAmps: number[], jitterAmp: number, squash: number) {
  const lobes = lobeAmps.map((amp) => ({ axis: randomAxis(), amp }));
  const jitter = makeJitter();

  for (let i = 0; i < positions.length; i += 3) {
    const len = Math.hypot(positions[i], positions[i + 1], positions[i + 2]) || 1;
    const nx = positions[i] / len;
    const ny = positions[i + 1] / len;
    const nz = positions[i + 2] / len;

    let radius = 0.5;
    for (const lobe of lobes) {
      radius += ((nx * lobe.axis.x) + (ny * lobe.axis.y) + (nz * lobe.axis.z)) * lobe.amp;
    }
    radius += (jitter(nx, ny, nz) - 0.5) * jitterAmp;
    radius = Math.max(0.16, radius);

    positions[i] = nx * radius;
    positions[i + 1] = ny * radius * squash;
    positions[i + 2] = nz * radius;
  }
}

// Nudge each existing vertex in/out along its own ray — adds craggy detail to a
// shape that already has its big forms (used for method C's second pass).
function roughen(positions: number[], jitterAmp: number) {
  const jitter = makeJitter();

  for (let i = 0; i < positions.length; i += 3) {
    const len = Math.hypot(positions[i], positions[i + 1], positions[i + 2]) || 1;
    const scale = 1 + ((jitter(positions[i] / len, positions[i + 1] / len, positions[i + 2] / len) - 0.5) * jitterAmp);
    positions[i] *= scale;
    positions[i + 1] *= scale;
    positions[i + 2] *= scale;
  }
}

// One level of midpoint (1->4) triangle subdivision on an indexed mesh, with
// shared edge midpoints de-duplicated so the surface stays watertight.
function subdivideOnce(positions: number[], indices: number[]) {
  const out = positions.slice();
  const newIndices: number[] = [];
  const midCache = new Map<string, number>();

  const midpoint = (a: number, b: number) => {
    const key = a < b ? `${a}_${b}` : `${b}_${a}`;
    let m = midCache.get(key);
    if (m === undefined) {
      m = out.length / 3;
      out.push(
        (positions[a * 3] + positions[b * 3]) / 2,
        (positions[(a * 3) + 1] + positions[(b * 3) + 1]) / 2,
        (positions[(a * 3) + 2] + positions[(b * 3) + 2]) / 2,
      );
      midCache.set(key, m);
    }
    return m;
  };

  for (let f = 0; f < indices.length; f += 3) {
    const a = indices[f];
    const b = indices[f + 1];
    const c = indices[f + 2];
    const ab = midpoint(a, b);
    const bc = midpoint(b, c);
    const ca = midpoint(c, a);
    newIndices.push(a, ab, ca, ab, b, bc, ca, bc, c, ab, bc, ca);
  }

  return { positions: out, indices: newIndices };
}

function buildBoulderGeometry(scene: Scene, method: RockMethod) {
  const subdivisions = method === "C" ? 1 : (method === "B" ? 5 : 3);
  const sphere = MeshBuilder.CreateIcoSphere("boulder-src", { radius: 0.5, subdivisions, flat: false }, scene);
  let positions = Array.from(sphere.getVerticesData(VertexBuffer.PositionKind) ?? []);
  let indices = Array.from(sphere.getIndices() ?? []);
  sphere.dispose();

  if (method === "C") {
    displaceField(positions, [0.26, 0.2, 0.14], 0, 0.78); // chunky, big planar forms
    ({ positions, indices } = subdivideOnce(positions, indices));
    ({ positions, indices } = subdivideOnce(positions, indices));
    roughen(positions, 0.14); // crag detail on the new fine vertices
  } else {
    displaceField(positions, [0.22, 0.16, 0.11, 0.08], method === "B" ? 0.13 : 0.18, 0.74);
  }

  return { positions, indices };
}

// Moss as extra geometry: a patchy green shell sitting just above the rock's
// upper faces (offset along the face normal so it never floats), with per-vertex
// colours noisy in lightness across various greens. Returns the moss mesh.
function addMoss(scene: Scene, rock: Mesh, material: StandardMaterial) {
  const positions = rock.getVerticesData(VertexBuffer.PositionKind);
  const normals = rock.getVerticesData(VertexBuffer.NormalKind);
  const indices = rock.getIndices();
  if (!positions || !normals || !indices) {
    return null;
  }

  const mossPositions: number[] = [];
  const mossIndices: number[] = [];
  const mossColors: number[] = [];

  for (let f = 0; f < indices.length; f += 3) {
    const ia = indices[f];
    const ib = indices[f + 1];
    const ic = indices[f + 2];
    // Flat-shaded, so the three vertex normals are the face normal.
    const ny = (normals[ia * 3 + 1] + normals[ib * 3 + 1] + normals[ic * 3 + 1]) / 3;

    // Moss likes the tops and shaded north faces; skip undersides, and leave
    // bare patches so it reads as growth rather than paint.
    if (ny < 0.12 || Math.random() > 0.62) {
      continue;
    }

    const nx = (normals[ia * 3] + normals[ib * 3] + normals[ic * 3]) / 3;
    const nz = (normals[ia * 3 + 2] + normals[ib * 3 + 2] + normals[ic * 3 + 2]) / 3;
    const nl = Math.hypot(nx, ny, nz) || 1;
    const offset = 0.02 + (Math.random() * 0.03);
    const cx = (positions[ia * 3] + positions[ib * 3] + positions[ic * 3]) / 3;
    const cy = (positions[ia * 3 + 1] + positions[ib * 3 + 1] + positions[ic * 3 + 1]) / 3;
    const cz = (positions[ia * 3 + 2] + positions[ib * 3 + 2] + positions[ic * 3 + 2]) / 3;
    const base = mossPositions.length / 3;

    for (const v of [ia, ib, ic]) {
      // Shrink the patch toward its centre a touch (ragged edges) and lift it off
      // the rock along the normal so the moss hugs the surface without floating.
      const px = (positions[v * 3] * 0.84) + (cx * 0.16) + ((nx / nl) * offset);
      const py = (positions[v * 3 + 1] * 0.84) + (cy * 0.16) + ((ny / nl) * offset);
      const pz = (positions[v * 3 + 2] * 0.84) + (cz * 0.16) + ((nz / nl) * offset);
      mossPositions.push(px, py, pz);

      const shade = 0.4 + (Math.random() * 0.85); // strong lightness noise
      const warm = (Math.random() - 0.5) * 0.08;
      mossColors.push(
        Math.min(1, (0.2 + warm) * shade),
        Math.min(1, 0.52 * shade),
        Math.min(1, (0.14 + warm) * shade),
        1,
      );
    }

    mossIndices.push(base, base + 1, base + 2);
  }

  if (mossIndices.length === 0) {
    return null;
  }

  const mossNormals: number[] = [];
  VertexData.ComputeNormals(mossPositions, mossIndices, mossNormals);
  const moss = new Mesh("boulder-moss", scene);
  const data = new VertexData();
  data.positions = mossPositions;
  data.indices = mossIndices;
  data.normals = mossNormals;
  data.colors = mossColors;
  data.applyToMesh(moss);
  moss.material = material;
  moss.parent = rock;
  return moss;
}

function createBoulder(
  scene: Scene,
  shadowGenerator: ShadowGenerator,
  colliders: RockCollider[],
  material: StandardMaterial,
  x: number,
  z: number,
  scale: number,
  method: RockMethod = "A",
  mossMaterial?: StandardMaterial,
) {
  const { positions, indices } = buildBoulderGeometry(scene, method);
  const normals: number[] = [];
  VertexData.ComputeNormals(positions, indices, normals);

  const rock = new Mesh("boulder", scene);
  const data = new VertexData();
  data.positions = positions;
  data.indices = indices;
  data.normals = normals;
  data.applyToMesh(rock);
  rock.convertToFlatShadedMesh();

  const scaleX = scale * (1.1 + (Math.random() * 0.5));
  const scaleY = scale * (0.7 + (Math.random() * 0.35));
  const scaleZ = scale * (0.95 + (Math.random() * 0.45));
  rock.scaling = new Vector3(scaleX, scaleY, scaleZ);
  rock.rotation = new Vector3(0, Math.random() * Math.PI, 0);
  // Sink the lower third into the ground: the terrain cuts a clean flat line
  // across it, so it reads as flat-bottomed without any degenerate base geometry.
  rock.position = new Vector3(x, sampledTerrainHeightAt(x, z) + (0.1 * scaleY), z);
  rock.material = material;
  shadowGenerator.addShadowCaster(rock);

  if (mossMaterial) {
    const moss = addMoss(scene, rock, mossMaterial);
    if (moss) {
      shadowGenerator.addShadowCaster(moss);
    }
  }

  colliders.push({ x, z, radius: Math.max(scaleX, scaleZ) * 0.5 });
}

export function createSceneryRocks(scene: Scene, materials: Materials, shadowGenerator: ShadowGenerator): RockCollider[] {
  const colliders: RockCollider[] = [];

  // Moss material: white base so the per-vertex green shades show through.
  const mossMaterial = new StandardMaterial("mossMaterial", scene);
  mossMaterial.diffuseColor = new Color3(1, 1, 1);
  mossMaterial.specularColor = new Color3(0.04, 0.05, 0.03);

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

  // TEMP comparison row in the open part of the main-map yard, just ahead of the
  // spawn (player looks +z), so all four are visible on load. Left -> right:
  // A, B, C, and A-with-moss. Remove once a method is chosen.
  const cmpMaterial = materials.rockMaterials[0];
  createBoulder(scene, shadowGenerator, colliders, cmpMaterial, -6, 1.2, 1.0, "A");
  createBoulder(scene, shadowGenerator, colliders, cmpMaterial, -2, 1.2, 1.0, "B");
  createBoulder(scene, shadowGenerator, colliders, cmpMaterial, 2, 1.2, 1.0, "C");
  createBoulder(scene, shadowGenerator, colliders, cmpMaterial, 6, 1.2, 1.0, "A", mossMaterial);

  return colliders;
}
