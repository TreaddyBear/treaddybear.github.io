# LaMow Editor Features

Status: working feature list for the editor pipeline.

## Product Shape

LaMow Editor replaces the narrower "LaMow Map Editor" framing. It should have a main map page,
plus asset pages for project-global definitions used by all maps.

Global assets are the default. Maps reference asset IDs; they do not embed species definitions,
mesh data, generated flower shapes, or LOD color rules. Pack-local custom assets can be added
later, but the first target is a clean project-global asset library.

## Pages

### Maps

- Edit and preview map areas, roads, fences, terrain, spawn, level identity, and vegetation
  density placement.
- Preview the baked map result using the same runtime map loader as the game.
- Keep final `bgrn` levels clearly separated from debug/demo/test levels.

### Vegetation Species

- Edit simple flowers, clover, and tulips first.
- Dandelions stay out of the first editor UI pass unless they are needed to prove the tall-flower
  behavior model.
- Grass is tabled as a species asset until its color, terrain, mowing, and far-LOD responsibilities
  are considered as one ground-system design.
- Each species is a global definition in `assets/species/*.json`.
- Import/export uses the contract in `docs/VEGETATION_ASSET_FORMAT.md`.
- Species definitions describe procedural shape, material colors, randomized per-instance
  ranges, and far-LOD behavior. Each species is its own customizable asset even when it
  shares a primitive with another species.
- Field-flower color editing must support authored albedo per vertex. Hex, RGB, and HSL
  inputs are acceptable editor controls; the stored asset format supports all three.
- Emissive color and strength can be authored, including per vertex where supported, but
  emissive should be an optional accent rather than the default visibility strategy.
- The editor preview must show both a single large inspectable plant and a population preview.

### Vegetation LOD Preview

- Provide a viewer specifically for LOD slat coloring and other far-vegetation impostors.
- The viewer must support low-lying vegetation like clover and small field flowers, where
  far-LOD can easily turn into an unreadable color smear.
- It should compare near geometry, transition range, and far LOD in the same view.
- It should expose species-level controls for far-LOD color, contribution strength, and whether
  the species uses grass-slat tinting, separate colored slats, a billboard/impostor, or no far
  representation.
- It should preview mixed vegetation patches, not only one species in isolation.

### Mesh And Module Assets

- Imported static meshes belong in a global asset library.
- The editor should preview imported meshes with the real engine materials and lighting.
- Mesh import is for hero/static assets and reusable structural modules, not for editing raw
  flower geometry vertex-by-vertex.

## Vegetation Definition Model

The first engine/editor model should be broad enough for yard vegetation, but implemented with
simple flowers and clover first.

### Species

A species is a reusable global asset:

```ts
type VegetationSpeciesDefinition = {
  id: string;
  displayName: string;
  category: "fieldFlower" | "tallFlower" | "groundcover" | "shrub" | "tree" | "decorative";
  generator: "monolithicPlant";
  parts: VegetationPartDefinition[];
  materials: Record<string, VegetationMaterialDefinition>;
  instanceRanges: VegetationInstanceRanges;
  lod: VegetationLodDefinition;
};
```

### Monolithic Shape

For now, use one monolithic plant shape per vegetation type, represented as an array of one
part. This avoids overfitting the engine to complex branching structures too early while still
leaving room for richer definitions.

```ts
type VegetationPartDefinition = {
  id: string;
  kind: "monolith" | "stem" | "leaf" | "bud" | "petalCluster" | "groundMat";
  shape: VegetationShapeDefinition;
  materialId: string;
  transform?: VegetationTransformRanges;
};
```

Simple flowers can later split the monolith into stem + bud/petal cluster if useful. Tulips and
dandelions should use a tall-flower shape with shared stem/leaf ranges and specialized head
behavior. Clover can start as a low ground mat/leaf cluster monolith. Trees remain a peripheral
design pressure: the taxonomy should not prevent future trunk/branch/leaf clusters, but the first
implementation should not get stuck trying to solve trees.

### Shape Primitives

```ts
type VegetationShapeDefinition =
  | { type: "fieldFlower"; petalSurface: "saddle"; petalCount: RangeI; petalLength: RangeF; petalWidth: RangeF; cup: RangeF; curl: RangeF }
  | { type: "tallFlower"; stemHeight: RangeF; stemRadius: RangeF; stemLean: RangeF; head: TallFlowerHeadDefinition; leaves?: TallFlowerLeafDefinition }
  | { type: "cloverCluster"; leafCount: RangeI; leafRadius: RangeF; clusterRadius: RangeF; lift: RangeF }
  | { type: "billboard"; width: RangeF; height: RangeF; pivot: "base" | "center" }
  | { type: "importedMesh"; assetId: string };
```

### Materials And LOD

Species material definitions should own the hue decisions. LOD coloring should read from these
definitions instead of hardcoded game shader channels.

```ts
type VegetationLodDefinition = {
  nearGeometry: "procedural" | "importedMesh";
  farRepresentation: "none" | "grassSlatTint" | "coloredSlats" | "billboard";
  farColor?: string;
  farStrength?: number;
  maxRenderDistance?: number;
};
```

## Engine Pipeline

1. Editor writes global species definitions.
2. Bake reads map vegetation layers plus species definitions.
3. Bake writes positions plus definition IDs and optional per-instance visual samples.
4. Runtime resolves `definitionId` to a species definition.
5. Runtime renders the simple flower/clover definitions using shared generator code.
6. Editor preview calls the same generator code.

The first runtime target is simple flowers, clover, and tulips. Dandelions should follow through
the same tall-flower path after the tulip shape/interaction split is proven.
