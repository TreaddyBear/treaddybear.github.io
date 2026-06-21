# LaMow Map Format v1 Draft

## Core Rule

This is the target for the first supported map format. The current editor format is a prototype and should be changed freely until it emits this v1 shape.

## Coordinates

All distances are meters. Most authored positions are 2D ground-plane points. 3D points are only for objects that intentionally need height.

```json
{
  "version": 1,
  "units": "meters",
  "coordinates": {
    "axes": { "x": "east", "y": "up", "z": "north" },
    "point2": ["x", "z"],
    "point3": ["x", "y", "z"]
  }
}
```

`point2` values are numeric tuples like `[12, -4]`.
`point3` values are numeric tuples like `[12, 2.5, -4]`.

## IDs

Every authored item inside a level should have an `id`. IDs only need to be unique within that level. Global identity can be treated as `{levelCode}:{id}`.

Stable IDs matter for patch files, editor diffs, upgrades, and targeted changes.

## Pack Files

A file may be a complete pack or a partial patch.

```json
{
  "version": 1,
  "pack": {
    "code": "base",
    "name": "Base Pack",
    "complete": false
  },
  "levels": []
}
```

`complete: true` means the file is authoritative for the pack.
`complete: false` means missing levels/items are not deleted. The file may only patch or add content.

## Shapes

Filled area shapes:

```ts
type AreaShape =
  | { type: "rectangle"; center: Point2; size: Point2; rotationDegrees?: number }
  | { type: "circle"; center: Point2; radius: number }
  | { type: "polygon"; points: Point2[] };
```

Path shapes:

```ts
type PathShape =
  | { type: "line"; start: Point2; end: Point2 }
  | { type: "polyline"; points: Point2[] }
  | { type: "cubicBezierPath"; start: Point2; curves: { c1: Point2; c2: Point2; end: Point2 }[] };
```

Use filled shapes for lawns, flower beds, dirt patches, clover patches, leaf zones, and hills.

Use path shapes for fences, roads, garden paths, edging, and similar linear features.

## Distribution

V1 only requires `uniform`.

```json
{
  "type": "uniform",
  "density": 1,
  "edgeFalloff": 0.75
}
```

`density` is normalized coverage.

`0` means none.
`1.0` means 100 percent reasonable/full coverage.
Values above `1.0` may be allowed for intentionally overfilled areas, but the normal editor UI should treat `1.0` as full.

Grass usually defaults to `1.0`.
Flowers may default around `0.01`.
Clover may be around `0.9`, leaving roughly `0.1` density for ordinary grass in that same space.

Overlapping vegetation should compete for coverage. Higher-priority layers consume density first. Lower-priority layers fill what remains.

`edgeFalloff` is in meters and cuts inward from the shape edge. It should never expand outside the shape. Runtime/editor may clamp impossible falloffs rather than making validation geometry-heavy.

## Level Shape

```json
{
  "code": "front-lawn",
  "name": "Front Lawn",
  "modified": true,
  "parSeconds": 300,
  "spawn": {
    "position": [0, 0],
    "headingDegrees": 0
  },
  "areas": [],
  "paths": [],
  "terrain": { "heightFeatures": [] },
  "objects": []
}
```

Spawn is 2D only. The game places the mower at the correct surface height.

## Area Example

```json
{
  "id": "main-lawn",
  "kind": "lawn",
  "shape": {
    "type": "rectangle",
    "center": [0, 0],
    "size": [18, 14]
  },
  "vegetation": [
    {
      "type": "grass",
      "priority": 0,
      "distribution": { "type": "uniform", "density": 1, "edgeFalloff": 0.75 }
    },
    {
      "type": "dandelion",
      "priority": 10,
      "distribution": { "type": "uniform", "density": 0.01, "edgeFalloff": 0.5 }
    }
  ]
}
```

## Clover Example

```json
{
  "id": "clover-patch-a",
  "kind": "vegetationPatch",
  "shape": {
    "type": "circle",
    "center": [4, -4],
    "radius": 2.5
  },
  "vegetation": [
    {
      "type": "clover",
      "priority": 100,
      "distribution": { "type": "uniform", "density": 0.9, "edgeFalloff": 0.6 }
    }
  ]
}
```

## Roads, Paths, Fences

Roads and garden paths should be path-based, not just rectangles.

```json
{
  "id": "front-path",
  "kind": "path",
  "surface": "dirt",
  "width": 1.1,
  "shape": {
    "type": "cubicBezierPath",
    "start": [-8, 2],
    "curves": [
      { "c1": [-4, 4], "c2": [2, 3], "end": [8, 8] }
    ]
  }
}
```

Fences can use `line` or `polyline`.

## Terrain

The lawn is a 2D domain projected onto a terrain surface. It can have hills/displacement, but it should not fold over itself.

```json
{
  "id": "soft-hill-a",
  "type": "hill",
  "shape": { "type": "circle", "center": [-20, -12], "radius": 8 },
  "height": 3.5,
  "falloff": 1
}
```

## Engine Work Implied

The game should add a v1 importer that converts this JSON into a runtime map. Engine helpers should move from rectangles to generic shapes: bounds, area, contains point, random point, edge distance, and path sampling.

The mow field, grass placement, flowers, dandelions, clover, leaves, dirt, fences, roads, and attract camera should consume the runtime map instead of reading old `xMin/xMax/zMin/zMax` data directly.
