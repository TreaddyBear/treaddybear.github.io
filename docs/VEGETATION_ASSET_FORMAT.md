# Vegetation Asset Import/Export Format

Status: format contract for the LaMow Editor vegetation species pipeline.

This defines the JSON shape the editor imports and exports for project-global vegetation
species. Maps should reference species by ID; they should not embed flower or clover shape
definitions.

## Storage

Project-global species live at:

```text
assets/species/<species-id>.json
```

Editor exports may use either plain `.json` or the clearer suffix:

```text
<species-id>.lamow-vegetation.json
```

The suffix is only a naming convention. The file content decides what it is.

## Single Species File

Use one species per file for normal editing. This is the default import/export path.

```json
{
  "assetVersion": 1,
  "kind": "vegetationSpecies",
  "species": {
    "id": "flowerBlue",
    "displayName": "Blue Field Flower",
    "category": "fieldFlower",
    "generator": "monolithicPlant",
    "materials": {
      "petal": {
        "baseColor": "#a8c7fa",
        "emissiveColor": "#4d5f7a",
        "roughness": 0.9
      }
    },
    "parts": [
      {
        "id": "flower",
        "kind": "monolith",
        "materialId": "petal",
        "shape": {
          "type": "saddleFlower",
          "petalCount": { "min": 5, "max": 8 },
          "petalLength": { "min": 0.075, "max": 0.115 },
          "petalWidth": { "min": 0.04, "max": 0.072 },
          "cup": { "min": 0.2, "max": 0.34 },
          "curl": { "min": 0.14, "max": 0.28 },
          "stemHeight": { "min": 0.1, "max": 0.18 },
          "stemRadius": { "min": 0.012, "max": 0.018 },
          "centerRadius": { "min": 0.04, "max": 0.06 }
        }
      }
    ],
    "instanceRanges": {
      "yaw": { "min": 0, "max": 6.283185307179586 },
      "scale": { "min": 0.9, "max": 1.12 }
    },
    "lod": {
      "nearGeometry": "procedural",
      "farRepresentation": "none",
      "farColor": "#a8c7fa",
      "farStrength": 0.4
    }
  },
  "editor": {
    "tags": ["field-flower", "blue"],
    "preview": {
      "populationSeed": 1,
      "populationCount": 80,
      "groundPatchMeters": 4
    }
  }
}
```

## Bundle File

Bundle files are for multi-select export/import. They are not the normal on-disk storage shape.
On import, the editor should split each species into its own global asset file.

```json
{
  "assetVersion": 1,
  "kind": "vegetationSpeciesBundle",
  "species": [
    {
      "id": "flowerBlue",
      "displayName": "Blue Field Flower",
      "category": "fieldFlower",
      "generator": "monolithicPlant",
      "materials": {},
      "parts": [],
      "instanceRanges": {
        "yaw": { "min": 0, "max": 6.283185307179586 },
        "scale": { "min": 1, "max": 1 }
      },
      "lod": {
        "nearGeometry": "procedural",
        "farRepresentation": "none"
      }
    }
  ]
}
```

The example above shows the envelope only. Real species must have at least one part and at least
one material.

## Species Fields

`id` is the stable reference used by maps, bake output, and runtime lookup. Current built-in
IDs include `flowerBlue`, `flowerWhite`, `flowerYellow`, `flowerRed`, and `clover`.

`displayName` is editor UI text. It is not a stable reference.

`category` groups the asset for editor browsing and default tooling. The first implemented
categories are `fieldFlower` and `groundcover`.

`generator` is currently always `monolithicPlant`. That means the engine treats each vegetation
instance as one plant made from a parts array. The first simple flower and clover definitions
should usually have one part, but the array exists so a flower can later become stem plus petals
without changing the file format.

`materials` owns color and material tuning. LOD color should come from this definition, not from
hardcoded runtime tint tables.

`parts` describes the generated plant shape. The first pass supports:

- `saddleFlower` for simple blue, white, yellow, and red field flowers.
- `cloverCluster` for low groundcover clover.
- `billboard` for simple impostors or editor experiments.
- `importedMesh` for reusable mesh assets when a procedural shape is not enough.

`instanceRanges` contains per-instance variation applied after the generated shape is created.

`lod` describes how the species is represented at distance. This is where colored flower slats
or grass-slat tinting belong once that rendering path is implemented and tuned in the editor.

`editor` is optional metadata for editor convenience. The game and bake pipeline should ignore
unknown editor metadata.

## Clover Example

```json
{
  "assetVersion": 1,
  "kind": "vegetationSpecies",
  "species": {
    "id": "clover",
    "displayName": "Clover",
    "category": "groundcover",
    "generator": "monolithicPlant",
    "materials": {
      "leaf": {
        "baseColor": "#0b2a05",
        "emissiveColor": "#010401",
        "roughness": 0.95
      }
    },
    "parts": [
      {
        "id": "cluster",
        "kind": "monolith",
        "materialId": "leaf",
        "shape": {
          "type": "cloverCluster",
          "leafCount": { "min": 2, "max": 4 },
          "leafRadius": { "min": 0.055, "max": 0.105 },
          "clusterRadius": { "min": 0.08, "max": 0.15 },
          "lift": { "min": 0.015, "max": 0.055 }
        }
      }
    ],
    "instanceRanges": {
      "yaw": { "min": 0, "max": 6.283185307179586 },
      "scale": { "min": 0.85, "max": 1.2 }
    },
    "lod": {
      "nearGeometry": "procedural",
      "farRepresentation": "none",
      "farColor": "#0b2a05",
      "farStrength": 0.25
    }
  }
}
```

## Validation Rules

The editor should reject imports that fail these rules:

- `assetVersion` must be `1`.
- `kind` must be `vegetationSpecies` or `vegetationSpeciesBundle`.
- Every species `id` must be stable text matching `^[A-Za-z][A-Za-z0-9_-]*$`.
- Every species must have at least one material and at least one part.
- Every part `materialId` must refer to a material in the same species.
- Every range must be finite, and `min` must be less than or equal to `max`.
- Every integer range must contain whole numbers.
- `farStrength`, when present, must be between `0` and `1`.
- `maxRenderDistance`, when present, must be greater than `0`.
- `importedMesh.assetId` must resolve to a project-global mesh asset before bake.
- Unknown fields should be preserved by the editor when possible, but the engine may ignore them.

## Runtime And Bake Mapping

1. The editor imports or writes `assets/species/<species-id>.json`.
2. Map vegetation layers reference the species ID; maps do not store the species definition.
3. Bake resolves each referenced species ID and writes baked instances with `definitionId`.
4. Runtime resolves `definitionId` through the shared vegetation definition loader.
5. Editor preview and game rendering call the same generator code for a given definition.

Dandelions are intentionally outside the first import/export target. They can use the same
envelope once their seed-head release behavior and generated shape model are ready to define.
