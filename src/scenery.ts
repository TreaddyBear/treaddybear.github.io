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

// Moss as a rounded, conforming cushion rather than per-face flecks: each patch
// grows over an AREA of the rock (several faces), bulging up in the middle and
// tapering to a thin rounded rim, wrapping over the rock's edges because every
// moss vertex is anchored to a rock vertex and pushed out along the (smooth)
// surface normal. Built from the rock's pre-flat-shade SHARED geometry so the
// cushion is continuous, then smooth-shaded for a soft look. Takes the shared
// positions/indices (local space) since the rock mesh itself is flat-shaded.
function addMoss(scene: Scene, rock: Mesh, rockPositions: number[], rockIndices: number[], material: StandardMaterial) {
  const vertexCount = rockPositions.length / 3;
  const smoothNormals: number[] = [];
  VertexData.ComputeNormals(rockPositions, rockIndices, smoothNormals);

  // Seed a few patches on the upper/side surfaces.
  const seeds: { x: number; y: number; z: number; radius: number; height: number }[] = [];
  const seedTarget = 2 + Math.floor(Math.random() * 2); // 2-3 cushions
  for (let attempt = 0; attempt < 40 && seeds.length < seedTarget; attempt += 1) {
    const v = Math.floor(Math.random() * vertexCount);
    if (smoothNormals[(v * 3) + 1] < 0.15) {
      continue; // not on undersides
    }
    seeds.push({
      x: rockPositions[v * 3],
      y: rockPositions[(v * 3) + 1],
      z: rockPositions[(v * 3) + 2],
      radius: 0.26 + (Math.random() * 0.18),
      height: 0.06 + (Math.random() * 0.05),
    });
  }

  if (seeds.length === 0) {
    return null;
  }

  // Per rock vertex: the tallest dome over it from any seed. dome(d) =
  // height * sqrt(1 - (d/R)^2) — round-topped, tapering to zero at radius R.
  const thickness = new Float32Array(vertexCount);
  const covered: boolean[] = new Array(vertexCount).fill(false);
  for (let v = 0; v < vertexCount; v += 1) {
    const px = rockPositions[v * 3];
    const py = rockPositions[(v * 3) + 1];
    const pz = rockPositions[(v * 3) + 2];
    let best = 0;

    for (const seed of seeds) {
      const dx = px - seed.x;
      const dy = py - seed.y;
      const dz = pz - seed.z;
      const d = Math.sqrt((dx * dx) + (dy * dy) + (dz * dz));
      if (d < seed.radius) {
        const dome = seed.height * Math.sqrt(1 - ((d / seed.radius) * (d / seed.radius)));
        best = Math.max(best, dome);
      }
    }

    if (best > 0) {
      covered[v] = true;
      thickness[v] = best;
    }
  }

  // A face joins the moss if any vertex is covered. Covered vertices ride the
  // dome; the skirt vertices just outside sit a hair above the rock so the rim
  // rounds down onto the surface (a minimum-radius edge) instead of a cliff.
  const skirt = 0.01;
  const remap = new Map<number, number>();
  const mossPositions: number[] = [];
  const mossColors: number[] = [];
  const mossIndices: number[] = [];

  const mossVertex = (v: number) => {
    let m = remap.get(v);
    if (m === undefined) {
      const lift = (covered[v] ? thickness[v] : 0) + skirt;
      m = mossPositions.length / 3;
      mossPositions.push(
        rockPositions[v * 3] + (smoothNormals[v * 3] * lift),
        rockPositions[(v * 3) + 1] + (smoothNormals[(v * 3) + 1] * lift),
        rockPositions[(v * 3) + 2] + (smoothNormals[(v * 3) + 2] * lift),
      );
      const shade = 0.45 + (Math.random() * 0.8); // strong lightness noise
      const warm = (Math.random() - 0.5) * 0.07;
      mossColors.push(
        Math.min(1, (0.21 + warm) * shade),
        Math.min(1, 0.5 * shade),
        Math.min(1, (0.13 + warm) * shade),
        1,
      );
      remap.set(v, m);
    }
    return m;
  };

  for (let f = 0; f < rockIndices.length; f += 3) {
    const a = rockIndices[f];
    const b = rockIndices[f + 1];
    const c = rockIndices[f + 2];
    if (!covered[a] && !covered[b] && !covered[c]) {
      continue;
    }
    mossIndices.push(mossVertex(a), mossVertex(b), mossVertex(c));
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
    const moss = addMoss(scene, rock, positions, indices, mossMaterial);
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
