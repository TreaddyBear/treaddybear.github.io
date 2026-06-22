# LaMow Map Format v1 Draft

## Purpose

This document defines the first supported LaMow map file format. The current
map editor format is a prototype and should be changed freely until it emits
this v1 shape.

This document defines v1 only. It does not promise that future versions are
supersets of v1, and it does not document future compatibility. When a later
version is drafted, that versioning work is responsible for creating a migration
plan from exactly one prior supported version, normally the immediately previous
version. That migration plan should document automatic conversions, deprecated
fields, manual review needs, and any possible loss.

A future version that only adds optional fields may simply be a superset that
newer engines and editors read directly with no conversion. That is allowed and
preferred when it fits, but it is not promised in advance. The aim is fewer
versions without constrictive thinking, not a forward-compatibility guarantee.

v1 has no required migration from older map files.

Because v1 is the first supported version, this document also records the
versioning policy used to draft it. Later releases may split process/versioning
guidance from the schema document itself.

## Scope and Non-Goals

This document defines a LEVEL FILE: the data an editor emits and an importer
reads to build one playable level. That is all it defines.

It deliberately does NOT define, and reviewers should not expand it to cover:

- The world beyond the authored level: skyboxes, distant terrain, mountains,
  scenery, traffic, or what a road, fence, or path does once it leaves the level.
- Rendering, art, themes, seasons, or color. The game decides how anything looks.
  The grass could be red; this format does not care.
- What `1.0` coverage renders as (instance counts, meshes, density tuning).
- The level editor's UI, tooling internals, or runtime engine behavior, except
  the few places this document explicitly calls out an editor or engine duty.

When a question is about the game world or how things look, it is out of scope by
design, not a hole in this spec.

## Coordinates

All distances are meters. Most authored positions are 2D ground-plane points.
3D points are only for objects that intentionally need height.

```json
{
  "version": 1,
  "units": "meters",
  "coordinates": {
    "axes": { "x": "east", "y": "up", "z": "north" },
    "point2": ["x", "z"],
    "point3": ["x", "y", "z"],
    "angles": {
      "unit": "degrees",
      "zero": "+x (east)",
      "positive": "counter-clockwise in the XZ plane, from +x toward +z",
      "direction": "heading T maps to ground vector (x, z) = (cos T, sin T)"
    }
  }
}
```

`Point2` values are numeric tuples like `[12, -4]`.
`Point3` values are numeric tuples like `[12, 2.5, -4]`.

Angles are mathematical, not compass:

- `0deg` is +x/east.
- `90deg` is +z/north.
- Increasing angles rotate counter-clockwise in the XZ plane.
- A heading `T` maps exactly to `(x, z) = (cos T, sin T)`.

`rectangle.rotationDegrees` and `spawn.headingDegrees` both use this convention.
Importers convert this file convention into whatever yaw convention the engine
uses internally.

## Canonical Type Sketch

This sketch is the canonical v1 shape. Examples later in the document are
illustrative, but this section is the source of truth for field names.

```ts
type Point2 = [x: number, z: number];
type Point3 = [x: number, y: number, z: number];

type MapPackV1 = {
  version: 1;
  units: "meters";
  coordinates?: CoordinateMetadata;
  pack: PackInfo;
  levels: LevelV1[];
};

type CoordinateMetadata = {
  axes: { x: "east"; y: "up"; z: "north" };
  point2: ["x", "z"];
  point3: ["x", "y", "z"];
  angles: {
    unit: "degrees";
    zero: "+x (east)";
    positive: string;
    direction: string;
  };
};

type PackInfo = {
  prefix: string;
  name: string;
};

type LevelV1 = {
  code: string;
  name: string;
  parSeconds: number;
  spawn: Spawn;
  areas: Area[];
  roads: Road[];
  dirtPaths: DirtPath[];
  fences: Fence[];
  terrain: Terrain;
  objects: unknown[];
  tags?: string[];
};

type Spawn = {
  position: Point2;
  headingDegrees: number;
};

type AuthoredItem = {
  id: string;
  name?: string;
  tags?: string[];
  editor?: {
    locked?: boolean;
    layer?: string;
  };
};
```

`editor` fields are editor hints only. They are not gameplay state. Do not add
editor visibility fields until the exact behavior is known, because `visible` is
too ambiguous: tree visibility, viewport visibility, runtime rendering, and
gameplay visibility are different concepts.

`editor.locked` means "locked in editor tooling" only. It is saved authoring
state, not a runtime promise that the game can never move, hide, alter, or
destroy the thing represented by the item.

## IDs and Level Codes

Every authored item in a level - areas, vegetation layers, roads, dirt paths,
fences, height features - has an `id` that is unique within that level. Stable
IDs matter for editor selection, diffs, migrations, targeted changes, and future
tooling.

Pack prefixes are globally reserved forever once used. The only reserved prefix
at the start of v1 is `bgrn`, for the beta green pack. Prefix collision checks
are case-insensitive.

Level codes are unique within their pack/context. If two imported levels have
the same pack prefix and level code after case-insensitive comparison, they are
treated as the same level identity rather than two different levels. Display
names are not identifiers; uniqueness of names is an editor preference, not a
format requirement.

Prefixes, level codes, and item ids must start with a simple US English/Latin
alphabetic character so derived capitalization is unambiguous. Prefer camelCase
after that. v1 does not otherwise pin these strings to a formal regex.

Level codes are globally unique by construction and stored as one source of
truth:

- Each pack has a unique `prefix`, for example `bgrn`.
- Each level has a short `code`, unique within its pack, for example `ell`.
- The full global level code is derived: `prefix + Capitalize(code)`, for
  example `bgrnEll`. `Capitalize` upper-cases the first character only.

An item's authored `id` is the short local form, for example `fence01`. Its
global identity is derived by combining the full level code with the id, for
example `bgrnEllFence01`, or `{fullLevelCode}:{itemId}`, for diffing and
cross-level identity. Neither the full level code nor the combined global id is
hand-authored in the level data. Moving an item to another level may force a
rename if its id already exists there. Whether ids are author-chosen or
editor-assigned is open; they only must end up unique within the level.

## Files, Packs, and Patching

A normal v1 map file is canonical pack state. It describes the pack contents
directly.

```json
{
  "version": 1,
  "units": "meters",
  "pack": { "prefix": "bgrn", "name": "Beta Green" },
  "levels": []
}
```

Inline patch operations such as `op: "merge"` or `op: "remove"` are not part of
normal v1 map data.

Patch files may be designed later as a separate document shape. If patch files
are introduced, they should include target identity and ideally a base hash so
tools can tell whether the patch is being applied to the same source state it
was created from. Destructive patching should produce a diff and require user
confirmation in editor tooling.

Migration between schema versions is also separate from v1 map data. A future
v2 migration document should describe how to migrate from v1 to v2 and what, if
anything, is deprecated or lossy.

## Foliage Registry

Foliage `type` keys are shared by the editor and game. A designer chooses from
human-readable registry entries instead of guessing engine-private names. Adding
registry entries is data growth and does not, by itself, require a map format
version bump.

v1 registry:

| key | display name | category |
| --- | --- | --- |
| `grass` | Grass | groundcover |
| `clover` | Clover | groundcover |
| `leaf` | Leaf | decor |
| `dandelion` | Dandelion | wildflower |
| `flowerBlue` | Blue Flower | wildflower |
| `flowerWhite` | White Flower | wildflower |
| `flowerYellow` | Yellow Flower | wildflower |
| `flowerRed` | Red Flower | wildflower |
| `tulip` | Tulip | prizeFlower |

Each registry entry owns its mesh and behavior on the engine side. The map file
only references the registry key. Flower colors are distinct entries rather than
a `flower` plus `variant` pair, because not every flower is a simple color swap.

Category sets intent by where the foliage is placed, not a per-foliage score:

- `groundcover` and `wildflower` belong in mowable `lawn` areas. The player mows
  everything in the lawn that is not explicitly special - grass, clover,
  dandelions, and the small wildflowers (blue/white/yellow/red) all count.
  These are the weeds and wildflowers of the lawn.
- `prizeFlower` belongs in `bed` areas, which are dirt and not mowable. Prize
  flowers are large, beautiful, and admired, not mowed. Mowing one is a mistake.
  Tulips are the first; more will be added.
- `decor` is decorative scatter (leaf drifts and similar), not a mow target and
  not required for completion. Usually placed as `additive` cover.

The differentiation is enforced by level-design convention, not by scoring
fields: wildflowers/weeds go in the lawn, prize flowers go in beds, and the two
are not mixed. v1 does not encode per-foliage scoring; completion is "mow the
lawn's vegetation", scored against `parSeconds`.

## Distribution

A distribution describes how dense a vegetation layer is across its shape.

```ts
type Distribution = UniformDistribution | PerlinDistribution;

type UniformDistribution = {
  type: "uniform";
  density: number;
};

type PerlinDistribution = {
  type: "perlin";
  density: number;
  noise: {
    seed: number;
    octaves: { frequency: number; weight: number }[];
    domainWarp?: number;
    threshold: number;
    softness: number;
  };
};
```

`density` is a desired coverage, not a capacity or budget. `1.0` means the
tuned, desirable amount of that foliage: the point at which the bare lawn texture
beneath no longer draws the eye, with just barely enough above it to not read as
a lone game asset. Nothing competes for or subtracts from a `1.0` total.

- Aim for `1.0` almost everywhere; it is the tuned target and keeps things simple.
- Above `1.0` is fine for lusher areas as long as performance allows.
- Below about `0.75` should be rare: sparse decorative cover, or a foliage whose
  `1.0` is not tuned yet.

Each foliage type is tuned on the engine side so that `1.0` is good, desirable
coverage. What `1.0` renders as, such as instance counts per square meter, is
owned by the engine and may change with the art; it is not part of the file
format and does not require a version bump.

Distributions do not own edge falloff. Edge falloff belongs to the area, because
falloff is part of how an area replaces or adds to its parent. The distribution
mask and the area falloff combine multiplicatively at the area level, each in
`[0, 1]`: the distribution makes coverage organic, and the area falloff trims
that contribution near the area edge. Exact falloff math is provisional until
validated in-engine. Runtime/editor may clamp impossible falloffs instead of
doing heavy validation geometry.

### Uniform Distribution

```json
{
  "type": "uniform",
  "density": 1.0
}
```

### Perlin Distribution

Perlin distribution supports organic, blobby cover such as clover patches,
flower clumps, and leaf drifts.

```json
{
  "type": "perlin",
  "density": 0.9,
  "noise": {
    "seed": 1337,
    "octaves": [
      { "frequency": 0.35, "weight": 1.0 },
      { "frequency": 0.8, "weight": 0.45 },
      { "frequency": 1.7, "weight": 0.2 }
    ],
    "domainWarp": 0.3,
    "threshold": 0.45,
    "softness": 0.12
  }
}
```

- `seed` controls deterministic variation.
- `octaves` are weighted Perlin layers. Frequency is cycles per meter.
- `domainWarp` distorts sample coordinates so blobs are less circular.
- `threshold` controls how much of the area is covered. Higher values make
  smaller, sparser islands.
- `softness` feathers the blob edge in noise units.

## Shapes

Filled area shapes are used for lawns, beds, dirt patches, vegetation zones,
background ground, and terrain height features.

```ts
type AreaShape =
  | { type: "rectangle"; center: Point2; size: Point2; rotationDegrees?: number }
  | { type: "circle"; center: Point2; radius: number }
  | { type: "polygon"; points: Point2[] };
```

Path shapes are used by roads, dirt paths, and fences.

```ts
type PathShape =
  | { type: "line"; start: Point2; end: Point2 }
  | { type: "polyline"; points: Point2[] }
  | { type: "cubicBezierPath"; start: Point2; curves: { c1: Point2; c2: Point2; end: Point2 }[] };
```

Prefer the simplest shape that fits. A straight road, dirt path, or fence should
use `line` or `polyline`, not a near-zero-curvature Bezier.

### Polygon Rules

Polygons must be simple, non-self-intersecting, implicitly closed shapes with at
least three points.

- The final edge is from the last point back to the first point.
- The first point should not be repeated as the final point in file data.
- Importers may tolerate a repeated final point and remove it with a warning.
- Edges may not cross other non-adjacent edges.
- Holes are not represented inside polygon data.
- Winding has no semantic meaning in v1. Tools should preserve authored point
  order when practical, but importers may normalize winding internally.

Holes or cutouts are represented with child `replace` areas, not polygon holes.
The inner area is its own authored area with its own contents; it does not
magically inherit later changes from the outer area.

## Areas

Areas are the heart of a level. They form a tree. Each child area composes with
the resolved result of its immediate parent.

```ts
type Area = AuthoredItem & {
  kind: "area";
  composition?: "replace" | "additive"; // default "replace"
  role?: "background" | "lawn" | "bed";
  mowable?: boolean;
  surface?: "grass" | "dirt";
  shape: AreaShape;
  edgeFalloff?: number; // meters; for replace, cross-fades with the parent at the
                        // edge; for additive, fades this area's added contribution
  vegetation: VegetationLayer[];
  children?: Area[];
};

type VegetationLayer = {
  id: string;
  type: string;
  distribution: Distribution;
};
```

There is no `priority` and no coverage budget; see Coverage below.

One area has exactly one shape. v1 does not support boolean/composite area
shapes made from multiple overlapping shapes. If the authored shape needs to be
complex, use a polygon.

### Containment and Overlap

Every area must be fully contained within its parent. No part of a child's shape
may extend outside its parent. Top-level areas are contained by the level.

Sibling areas sharing the same parent must not overlap each other, regardless of
whether they are `replace` or `additive`. Their spatial relationship must be
unambiguous. To put multiple vegetation types over the same footprint, use
multiple vegetation layers in one area rather than overlapping sibling areas. To
layer one area on top of another - for example an `additive` flower scatter over a
`replace` clover patch - nest it as a child of that area, not as an overlapping
sibling.

The game engine trusts authored maps and does not validate containment at
runtime. The editor enforces it:

- Checking one item against its single parent is cheap and may run in real time
  while dragging.
- Checking an item against its children must be throttled and asynchronous. A
  parent may have thousands of children with complex boundaries; a naive
  every-item-against-every-item pass is worst-case quadratic and can stall or
  crash the editor. Never run the full check synchronously on every edit.
- A full validation must run before save.

A violating area should not raise stacking modal errors. Mark it inline instead:
a tasteful red outline with red diagonal hatching and a faint red glow so the
author sees exactly which area is wrong without being interrupted.

### Composition

`composition` is local to the immediate parent. A grandchild composes with its
parent, not directly with the grandparent.

Area trees resolve locally and bottom-up. If an area has children, those
children first modify that area's resolved result. That resolved area result
then composes upward into its own parent. An `additive` child inside a `replace`
area adds to the replace area; it does not skip upward and add directly to the
grandparent.

- `replace`: inside this shape, this area's surface, role, mowability, and
  vegetation replace the parent's resolved result. Across the area's
  `edgeFalloff` band, inset from the shape edge, the two cross-fade: this area's
  vegetation ramps from full in the interior to zero at the edge while the
  parent's vegetation ramps back from zero to full. So a clover field that
  replaces grass shows grass returning along its edges instead of a hard cut.
  Exact falloff math is provisional until validated in-engine.
- `additive`: inside this shape, this area's vegetation is added on top of the
  parent's resolved result. It does not change the parent's surface, role, or
  mowability.

Role defaults:

| role | mowable | surface | scored toward completion |
| --- | --- | --- | --- |
| `background` | no | grass | no |
| `lawn` | yes | grass | yes |
| `bed` | no | dirt | no |

`mowable` and `surface` may override the role defaults.

A typical level is a level-wide `background` area that fills enough visible
space to avoid a hard island edge, with one or more `lawn` descendants that are
mowable and scored. Beds and dirt patches are deeper `replace` children.
Decorative flower scatter, clover accents, and leaf drifts are usually
`additive` areas.

### Coverage

There is no coverage budget and nothing competes. Each vegetation layer's
`density` is independent and means "how much of this foliage, where `1.0` is the
tuned desirable amount" (see Distribution). Layers never subtract from one
another.

To clear grass where clover sits, do not rely on competition: author a `replace`
area whose vegetation is just clover. `replace` means the parent's grass is
simply absent inside it, and the `edgeFalloff` cross-fade brings grass back at
the edges. To sprinkle a few flowers without touching the grass, use an
`additive` area.

The engine converts each final per-type density into instance counts using its
private foliage "full" reference.

## Examples

### Lawn With Organic Clover

The lawn carries grass. A `replace` child holds the clover; inside it the grass
is simply absent, and the area's `edgeFalloff` brings grass back along the edge.

```json
{
  "id": "front-lawn",
  "kind": "area",
  "role": "lawn",
  "shape": {
    "type": "polygon",
    "points": [[-9, -7], [9, -7], [9, 2], [0, 2], [0, 9], [-9, 9]]
  },
  "vegetation": [
    { "id": "grass", "type": "grass", "distribution": { "type": "uniform", "density": 1.0 } }
  ],
  "children": [
    {
      "id": "clover-patch",
      "kind": "area",
      "composition": "replace",
      "shape": { "type": "circle", "center": [-4, -2], "radius": 3 },
      "edgeFalloff": 0.6,
      "vegetation": [
        {
          "id": "clover",
          "type": "clover",
          "distribution": {
            "type": "perlin",
            "density": 1.0,
            "noise": {
              "seed": 7,
              "octaves": [
                { "frequency": 0.4, "weight": 1 },
                { "frequency": 0.9, "weight": 0.4 }
              ],
              "domainWarp": 0.3,
              "threshold": 0.5,
              "softness": 0.12
            }
          }
        }
      ]
    }
  ]
}
```

### Additive Flower Scatter

This area adds red and yellow flowers to its parent result without thinning or
replacing the grass/clover beneath.

```json
{
  "id": "roadside-sprinkle",
  "kind": "area",
  "composition": "additive",
  "shape": { "type": "rectangle", "center": [6, -1], "size": [1, 2] },
  "edgeFalloff": 0.4,
  "vegetation": [
    {
      "id": "red",
      "type": "flowerRed",
      "distribution": {
        "type": "perlin",
        "density": 0.2,
        "noise": {
          "seed": 21,
          "octaves": [{ "frequency": 0.9, "weight": 1 }],
          "threshold": 0.55,
          "softness": 0.2
        }
      }
    },
    {
      "id": "yellow",
      "type": "flowerYellow",
      "distribution": {
        "type": "perlin",
        "density": 0.2,
        "noise": {
          "seed": 99,
          "octaves": [{ "frequency": 0.9, "weight": 1 }],
          "threshold": 0.55,
          "softness": 0.2
        }
      }
    }
  ]
}
```

### Background, Lawn, and Bed

```json
{
  "id": "yard",
  "kind": "area",
  "role": "background",
  "shape": { "type": "rectangle", "center": [0, 0], "size": [120, 120] },
  "vegetation": [
    { "id": "grass", "type": "grass", "distribution": { "type": "uniform", "density": 1.0 } }
  ],
  "children": [
    {
      "id": "front-lawn",
      "kind": "area",
      "role": "lawn",
      "shape": { "type": "rectangle", "center": [0, 0], "size": [18, 14] },
      "vegetation": [
        { "id": "grass", "type": "grass", "distribution": { "type": "uniform", "density": 1.0 } }
      ],
      "children": [
        {
          "id": "rose-bed",
          "kind": "area",
          "role": "bed",
          "shape": { "type": "circle", "center": [4, -3], "radius": 1.4 },
          "vegetation": [
            { "id": "tulips", "type": "tulip", "distribution": { "type": "uniform", "density": 0.35 } }
          ]
        }
      ]
    }
  ]
}
```

## Roads, Dirt Paths, and Fences

Roads, dirt paths, and fences are distinct top-level kinds. They are not areas.

```ts
type Road = AuthoredItem & {
  kind: "road";
  width: number;
  shape: PathShape;
};

type DirtPath = AuthoredItem & {
  kind: "dirtPath";
  width: number;
  shape: PathShape;
};

type Fence = AuthoredItem & {
  kind: "fence";
  height: number;
  postSpacing?: number;
  shape: PathShape;
};
```

Examples:

```json
{
  "id": "main-road",
  "kind": "road",
  "width": 3.2,
  "shape": { "type": "line", "start": [12, -40], "end": [12, 40] }
}
```

```json
{
  "id": "garden-path",
  "kind": "dirtPath",
  "width": 1.1,
  "shape": {
    "type": "cubicBezierPath",
    "start": [-8, 2],
    "curves": [{ "c1": [-4, 4], "c2": [2, 3], "end": [8, 8] }]
  }
}
```

```json
{
  "id": "west-fence",
  "kind": "fence",
  "height": 1.0,
  "postSpacing": 2.0,
  "shape": { "type": "polyline", "points": [[-9, -9], [9, -9], [9, 9]] }
}
```

Straight runs should use `line` or `polyline`. Beziers are for genuinely curved
runs.

Fences are assumed to carry collision. A later version may allow collision-less
decorative fences, but v1 treats fences as gameplay boundaries first. Roads carry
lane stripes and markings as an engine concern; exact styling may change in a
later version. These are engine decisions, noted here only for context.

## Terrain

The lawn is a 2D domain projected onto a terrain surface. Terrain can have
height features, but it should not fold over itself.

```ts
type Terrain = {
  heightFeatures: HeightFeature[];
};

type HeightFeature = AuthoredItem & {
  type: "hill";
  shape: AreaShape;
  height: number;
  falloff: number;
};
```

Height features are not additive in v1. At any point, the terrain height
contribution is the maximum contribution from all height features containing
that point. Overlapping hills may look odd, but they do not stack into a larger
mountain.

Terrain hill behavior is still marked for revision before v1 ships. The current
direction is max-height-wins, but the exact contribution/falloff formula needs
engine validation. This section is intentionally narrow until the current game
hill behavior is confirmed.

Example:

```json
{
  "terrain": {
    "heightFeatures": [
      {
        "id": "soft-hill-a",
        "type": "hill",
        "shape": { "type": "circle", "center": [-20, -12], "radius": 8 },
        "height": 3.5,
        "falloff": 1.0
      }
    ]
  }
}
```

## Objects

v1 reserves an `objects: []` array on each level, but the object schema is not
defined in v1. The field stays in the draft as a placeholder while object needs
are still being discovered. v1 files should keep this array empty unless object
support is defined before v1 ships. If objects remain ambiguous or unnecessary,
this field should be removed from the final v1 spec and moved to a future-work
document instead.

## Open Before Final v1

These are draft questions, not hidden schema requirements:

- Confirm the exact area `edgeFalloff` math in the engine and editor preview.
- Confirm the terrain hill contribution/falloff formula, and whether v1 needs to
  represent anything beyond the current hill behavior.
- Decide whether `objects` gets a real v1 schema or moves to future work.
- Decide whether patch files are needed for v1 tooling. Normal v1 map files
  remain canonical pack state either way.

## Complete Level Example

```json
{
  "code": "ell",
  "name": "Front Lawn",
  "parSeconds": 300,
  "spawn": { "position": [0, 0], "headingDegrees": 0 },
  "areas": [],
  "roads": [],
  "dirtPaths": [],
  "fences": [],
  "terrain": { "heightFeatures": [] },
  "objects": [],
  "tags": []
}
```

`code` is the pack-local short code. The global code is derived from the pack
prefix and level code. Spawn is 2D plus a mathematical heading. The game places
the mower at the correct terrain height.

## Engine Work Implied

The game needs a v1 importer that converts this JSON into a runtime map.

Engine/editor helpers should move from rectangle-only logic to generic shapes:

- bounds
- area
- contains point
- random point in shape
- edge distance
- path sampling
- terrain height sampling
- area tree resolution
- vegetation coverage resolution

The mow field, grass placement, flowers, dandelions, clover, leaves, dirt,
roads, dirt paths, fences, and attract camera should consume the runtime v1 map
instead of reading old `xMin`/`xMax`/`zMin`/`zMax` and ad-hoc
`cloverPatches`/`flowerFields` data directly.

The Perlin distribution should be the shared implementation behind organic
clover, flower, and leaf shaping. The foliage registry should be a shared module
imported by both the game and editor so type keys and display names remain in
sync.
