# LaMow Map Format v1 Draft

## Core Rule

This is the target for the first supported map format. The current editor format is a prototype and should be changed freely until it emits this v1 shape.

Forward/backward compatibility intent: a later v2 is a superset — all v1 files are valid v2 files, v2 engines (editor + game) read both v1 and v2, and v1 engines may reject v2 files. New foliage types, new distribution types, new object kinds, etc. are added this way, NOT by reinterpreting v1 fields.

## Coordinates

All distances are meters. Most authored positions are 2D ground-plane points. 3D points are only for objects that intentionally need height.

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
      "positive": "counter-clockwise in the XZ plane (from +x toward +z)",
      "direction": "heading T maps to ground vector (x, z) = (cos T, sin T)"
    }
  }
}
```

`point2` values are numeric tuples like `[12, -4]`.
`point3` values are numeric tuples like `[12, 2.5, -4]`.

Angles are mathematical, not compass: `0deg` = +x (east), `90deg` = +z (north), increasing counter-clockwise. A heading `T` is exactly `(cos T, sin T)`. `rectangle.rotationDegrees` and `spawn.headingDegrees` both use this. The importer converts to whatever the engine's internal yaw convention is — the *file* is unambiguous.

## IDs and Level Codes

Every authored item inside a level has an `id`, unique within that level. Stable IDs matter for patch files, editor diffs, upgrades, and targeted changes.

Level codes are globally unique **by construction**, and stored as a single source of truth (never hand-typed as a full string):

- Each pack has a unique `prefix` (e.g. `bgrn`).
- Each level has a short `code`, unique within its pack (e.g. `ell`).
- The full, globally-unique level code is **derived**: `prefix + Capitalize(code)` → `bgrnEll`.

Because prefixes are unique across all packs and short codes are unique within a pack, full codes can never collide. Global identity for any item is `{fullLevelCode}:{itemId}`.

## Packs and Patching

A file is a pack (or a patch against a pack). There is no `complete`/`modified` flag — patching is expressed per item via `op`.

```json
{
  "version": 1,
  "pack": { "prefix": "bgrn", "name": "Beta Green" },
  "levels": []
}
```

Every patchable item (a level, an area, a vegetation layer, a road, etc.) may carry an `op`:

| `op` | meaning when an item with this `id` is imported |
| --- | --- |
| `add` | add a new item; error if the id already exists |
| `replace` | replace the existing item wholesale (default when an id matches) |
| `merge` | shallow-merge the provided fields over the existing item (children/layers merge by their own `id` + `op`) |
| `remove` | delete the existing item **and all of its children** |

Default with no `op`: `add` if new, `replace` if the id exists. `op` cascades — a `merge` on an area lets you `add`/`replace`/`remove`/`merge` individual children or vegetation layers by their ids, so you can patch at any depth.

Tooling note (out of band, but required for safety): a destructive import (`replace` / `remove`) of existing, committed map content should be **confirmed and diffed** by the importing tool — ideally a visual before/after (split map view or fly-over), not a silent overwrite.

## Foliage Registry

Foliage `type` keys are **not** engine-private. The registry is shared by the editor and the game and lives with the spec, so a designer picks from human-readable names instead of guessing a developer's casing. The registry is a shared, versioned list; **adding entries does not bump the map format version** (it is data, like the meaning of "full" density below).

v1 registry:

| key | display name | category | mowable |
| --- | --- | --- | --- |
| `grass` | Grass | groundcover | yes |
| `clover` | Clover | groundcover | yes |
| `leaf` | Leaf | groundcover | yes |
| `dandelion` | Dandelion | flower | yes |
| `flowerBlue` | Blue Flower | flower | yes |
| `flowerWhite` | White Flower | flower | yes |
| `flowerYellow` | Yellow Flower | flower | yes |
| `flowerRed` | Red Flower | flower | yes |

Each registry entry owns its mesh/behavior on the engine side (e.g. `dandelion`'s seed-puff, petal counts, mow animation) — the map file only references the `key`. Flower colors are distinct entries rather than a `flower` + `variant` pair, because some flowers (dandelion) are not simple color swaps. `leaf` behaves like a groundcover similar to clover but with its own look.

## Distribution

A distribution describes how dense a vegetation layer is across its area.

```json
{
  "type": "uniform",
  "density": 1.0,
  "edgeFalloff": 0.75
}
```

`density` is normalized coverage, where `1.0` = the engine's reference "full" for that foliage type.

- `1.0` is the ideal/default for mowable lawn areas (and the editor should treat it as the normal full value).
- `> 1.0` is allowed for intentionally overfilled areas.
- `< 1.0` is fine but should generally be reserved for sparse, decorative, or non-mowable cover (scattered flowers, light leaf litter).

What "full" (`1.0`) renders as — 300 instances/m², 800/m², whatever looks right for the current mesh — is **owned by the engine** and may change with the art at any time. It is not part of the format and never triggers a format version bump. The editor only needs the normalized number; it does not need to know what full looks like (until/unless it gains a shared 3D renderer, which is a separate concern).

`edgeFalloff` is in meters and cuts inward from the shape edge. It never expands outside the shape. Runtime/editor may clamp impossible falloffs rather than doing heavy validation.

### Perlin distribution (organic blobs)

v1 supports a noise distribution so the editor can paint organic, blobby cover (clover patches, flower clumps, leaf drifts) instead of only even fills. This is a first-class v1 feature.

```json
{
  "type": "perlin",
  "density": 0.9,
  "edgeFalloff": 0.5,
  "noise": {
    "seed": 1337,
    "octaves": [
      { "frequency": 0.35, "weight": 1.0 },
      { "frequency": 0.8,  "weight": 0.45 },
      { "frequency": 1.7,  "weight": 0.2 }
    ],
    "domainWarp": 0.3,
    "threshold": 0.45,
    "softness": 0.12
  }
}
```

- `octaves` — the weighted perlin layers (frequency in cycles/m, plus weight). This is the live-tunable part in the editor.
- `domainWarp` — warps the sample coordinates so blobs aren't round (the "country / amoeba" look).
- `threshold` — how much of the area the blobs cover (raise → smaller, sparser islands).
- `softness` — organic feathering of the blob edge, in noise units.
- `seed` — determinism; the editor can randomize or lock it.

The engine evaluates a coverage mask roughly as `mask(p) = smoothstep((fbm(warp(p)) - threshold) / softness)`, then multiplies by `density` and clamps inside the shape via `edgeFalloff`. (`uniform` is just this with a flat mask of `1`.)

## Shapes

Area (filled) shapes — used for lawns, beds, dirt patches, clover/leaf zones, hills:

```ts
type AreaShape =
  | { type: "rectangle"; center: Point2; size: Point2; rotationDegrees?: number }
  | { type: "circle"; center: Point2; radius: number }
  | { type: "polygon"; points: Point2[] };
```

Path shapes — used by roads, dirt paths, and fences:

```ts
type PathShape =
  | { type: "line"; start: Point2; end: Point2 }
  | { type: "polyline"; points: Point2[] }
  | { type: "cubicBezierPath"; start: Point2; curves: { c1: Point2; c2: Point2; end: Point2 }[] };
```

Prefer the simplest shape that fits. A straight road must use `line`, not a near-zero-curvature bezier — see Roads, Paths, Fences.

## Areas

Areas are the heart of a level. They form a **tree**, and there are two modes:

- **`replace`** (default) — a partitioning region. It defines the base ground, surface, role (mowable?), and base vegetation for everything inside it. Replace areas **must be contained within their parent** and **must not overlap their replace-siblings**. At any ground point, the **deepest** replace area that contains it wins.
- **`add`** — a supplementary overlay. It **adds** its vegetation on top of whatever is already there, without removing or changing the base. Add areas may overlap anything (the base, each other, replace boundaries) and are not bound by containment. They do not change surface, role, or mowability of the ground beneath.

```ts
type Area = {
  id: string;
  kind: "area";
  mode?: "replace" | "add";        // default "replace"
  role?: "background" | "lawn" | "bed";  // semantic; sets defaults below
  mowable?: boolean;               // override; default from role
  surface?: "grass" | "dirt";      // override; default from role
  shape: AreaShape;
  vegetation: VegetationLayer[];
  children?: Area[];
  op?: PatchOp;
};

type VegetationLayer = {
  id?: string;                     // needed only for patching
  type: string;                    // foliage registry key
  priority: number;                // higher consumes coverage first (replace areas)
  distribution: Distribution;
  op?: PatchOp;
};
```

Role defaults:

| role | mowable | surface | scored toward completion |
| --- | --- | --- | --- |
| `background` | no | grass | no |
| `lawn` | yes | grass | yes |
| `bed` | no | dirt | no |

A typical level is a level-wide `background` area (decorative, fills out to the horizon so there is no visible "lawn island" edge) with at least one `lawn` child (mowable, scored). Beds, dirt patches, etc. are deeper `replace` children; cute extra scatter is `add` overlays.

### Coverage resolution

For any ground point:

1. **Base:** find the deepest `replace` area containing the point. That area gives the surface, role/mowable, and the base vegetation. Its layers compete for a coverage budget that starts at `1.0`: sort by `priority` descending; each layer claims `min(density * mask(point), remaining budget)`; `grass` at `priority 0` naturally fills the remainder. (So clover at priority 100 / density 0.9 leaves ~0.1 for grass beneath it — the clover thins the grass, organically, via its perlin mask.)
2. **Overlays:** for every `add` area containing the point, **sum** each of its layers' `density * mask(point)` on top of the base result. Overlays do not compete and are not capped — totals may exceed `1.0` (overfill is allowed).

The engine converts the resulting per-type densities into actual instance counts using its private "full" reference.

## Examples

### Lawn with organic clover (clover as a competing layer, not a sub-area)

```json
{
  "id": "front-lawn",
  "kind": "area",
  "role": "lawn",
  "shape": { "type": "polygon", "points": [[-9,-7],[9,-7],[9,2],[0,2],[0,9],[-9,9]] },
  "vegetation": [
    { "id": "grass",  "type": "grass",  "priority": 0,   "distribution": { "type": "uniform", "density": 1.0 } },
    { "id": "clover", "type": "clover", "priority": 100, "distribution": {
        "type": "perlin", "density": 0.95, "edgeFalloff": 0.4,
        "noise": { "seed": 7, "octaves": [{ "frequency": 0.4, "weight": 1 }, { "frequency": 0.9, "weight": 0.4 }], "domainWarp": 0.3, "threshold": 0.5, "softness": 0.12 }
    } }
  ]
}
```

### Supplementary flower scatter (does not disturb the grass/clover beneath)

A 1x2 m `add` overlay: a soft perlin band of red + yellow flowers, capped low, that just sprinkles a few cute flowers on top of the existing lawn.

```json
{
  "id": "roadside-sprinkle",
  "kind": "area",
  "mode": "add",
  "shape": { "type": "rectangle", "center": [6, -1], "size": [1, 2] },
  "vegetation": [
    { "type": "flowerRed",    "priority": 0, "distribution": { "type": "perlin", "density": 0.2, "edgeFalloff": 0.4, "noise": { "seed": 21, "octaves": [{ "frequency": 0.9, "weight": 1 }], "threshold": 0.55, "softness": 0.2 } } },
    { "type": "flowerYellow", "priority": 0, "distribution": { "type": "perlin", "density": 0.2, "edgeFalloff": 0.4, "noise": { "seed": 99, "octaves": [{ "frequency": 0.9, "weight": 1 }], "threshold": 0.55, "softness": 0.2 } } }
  ]
}
```

### Background + lawn + bed (the partition tree)

```json
{
  "id": "yard",
  "kind": "area",
  "role": "background",
  "shape": { "type": "rectangle", "center": [0,0], "size": [120,120] },
  "vegetation": [{ "type": "grass", "priority": 0, "distribution": { "type": "uniform", "density": 1.0 } }],
  "children": [
    { "id": "front-lawn", "kind": "area", "role": "lawn", "shape": { "type": "rectangle", "center": [0,0], "size": [18,14] },
      "vegetation": [{ "type": "grass", "priority": 0, "distribution": { "type": "uniform", "density": 1.0 } }],
      "children": [
        { "id": "rose-bed", "kind": "area", "role": "bed", "shape": { "type": "circle", "center": [4,-3], "radius": 1.4 },
          "vegetation": [{ "type": "flowerRed", "priority": 0, "distribution": { "type": "uniform", "density": 0.35, "edgeFalloff": 0.3 } }] }
      ] }
  ]
}
```

## Roads, Paths, Fences

Three distinct top-level kinds (not areas, not the same "path" thing):

- **`road`** — a drivable/paved strip. Surface override (asphalt etc.) with optional stripes.
- **`dirtPath`** — a path that turns the ground to **dirt** along its run (this is the "path" people actually mean).
- **`fence`** — a vertical **collision barrier** with height and posts.

```json
{ "id": "main-road", "kind": "road",     "width": 3.2, "shape": { "type": "line", "start": [12, -40], "end": [12, 40] } }
{ "id": "garden",    "kind": "dirtPath", "width": 1.1, "shape": { "type": "cubicBezierPath", "start": [-8,2], "curves": [{ "c1": [-4,4], "c2": [2,3], "end": [8,8] }] } }
{ "id": "west-fence","kind": "fence",    "height": 1.0, "postSpacing": 2.0, "shape": { "type": "polyline", "points": [[-9,-9],[9,-9],[9,9]] } }
```

Straight-by-default: a straight road/path/fence must use `line` (or `polyline`), **not** a bezier with near-zero curvature. Splines are only for genuinely curved runs — a low-curvature spline with far-apart control points produces tessellation glitches (torn stripes, kinks), so the format keeps straight runs as straight segments.

## Terrain

The lawn is a 2D domain projected onto a terrain surface. It can have hills/displacement but should not fold over itself. Height features live under the level's `terrain.heightFeatures`.

```json
{
  "terrain": {
    "heightFeatures": [
      { "id": "soft-hill-a", "type": "hill", "shape": { "type": "circle", "center": [-20,-12], "radius": 8 }, "height": 3.5, "falloff": 1.0 }
    ]
  }
}
```

(Hill semantics — additive vs absolute height, overlap behavior — are still open; we'll refine when this folds back in.)

## Objects

Trees, rocks/boulders (with collision), props like the hidden gun, etc. v1 **reserves** an `objects: []` array on each level so files stay structurally valid, but the object schema itself is a planned **v2 addendum** — v1 engines simply ignore unknown object contents, v2 adds full support. Defining it later does not break any v1 file.

## Level Shape

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
  "objects": []
}
```

`code` is the pack-local short code; the global code is derived (`prefix + Capitalize(code)`). Spawn is 2D plus a heading (math angle); the game places the mower at the correct surface height.

## Engine Work Implied

The game adds a v1 importer that converts this JSON into a runtime map. Engine helpers move from rectangles to generic shapes and the area tree: bounds, area, contains-point, random-point-in-shape, edge-distance, path sampling, and per-point coverage resolution (deepest replace area + within-area priority budget + additive overlays).

The mow field, grass placement, flowers, dandelions, clover, leaves, dirt, roads, dirt paths, fences, and the attract camera should consume the runtime map (areas, vegetation layers, distributions) instead of reading old `xMin/xMax/zMin/zMax` and ad-hoc `cloverPatches`/`flowerFields` data directly. The perlin distribution should be the shared implementation behind today's hand-coded organic clover/flower shaping.

The foliage registry is a shared module both the game and the editor import, so type keys and their display names stay in sync from a single source.
