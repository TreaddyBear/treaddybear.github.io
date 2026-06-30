import type { FoliageKey } from "./mapFormat";

export type RangeF = { min: number; max: number };
export type RangeI = { min: number; max: number };
export type ColorHex = `#${string}`;

export type VegetationCategory = "fieldFlower" | "groundcover" | "shrub" | "tree" | "decorative";

export type VegetationMaterialDefinition = {
  baseColor: ColorHex;
  emissiveColor?: ColorHex;
  roughness?: number;
  alpha?: number;
};

export type VegetationShapeDefinition =
  | {
    type: "saddleFlower";
    petalCount: RangeI;
    petalLength: RangeF;
    petalWidth: RangeF;
    cup: RangeF;
    curl: RangeF;
    stemHeight: RangeF;
    stemRadius: RangeF;
    centerRadius: RangeF;
  }
  | {
    type: "cloverCluster";
    leafCount: RangeI;
    leafRadius: RangeF;
    clusterRadius: RangeF;
    lift: RangeF;
  }
  | {
    type: "billboard";
    width: RangeF;
    height: RangeF;
    pivot: "base" | "center";
  }
  | {
    type: "importedMesh";
    assetId: string;
  };

export type VegetationTransformRanges = {
  yaw?: RangeF;
  pitch?: RangeF;
  roll?: RangeF;
  scale?: RangeF;
  xzJitter?: RangeF;
  yOffset?: RangeF;
};

export type VegetationPartDefinition = {
  id: string;
  kind: "monolith" | "stem" | "leaf" | "bud" | "petalCluster" | "groundMat";
  shape: VegetationShapeDefinition;
  materialId: string;
  transform?: VegetationTransformRanges;
};

export type VegetationInstanceRanges = {
  yaw: RangeF;
  scale: RangeF;
  height?: RangeF;
};

export type VegetationLodDefinition = {
  nearGeometry: "procedural" | "importedMesh";
  farRepresentation: "none" | "grassSlatTint" | "coloredSlats" | "billboard";
  farColor?: ColorHex;
  farStrength?: number;
  maxRenderDistance?: number;
};

export type VegetationSpeciesDefinition = {
  id: FoliageKey | string;
  displayName: string;
  category: VegetationCategory;
  generator: "monolithicPlant";
  parts: [VegetationPartDefinition, ...VegetationPartDefinition[]];
  materials: Record<string, VegetationMaterialDefinition>;
  instanceRanges: VegetationInstanceRanges;
  lod: VegetationLodDefinition;
};

export type VegetationAssetEditorMetadata = {
  tags?: string[];
  notes?: string;
  preview?: {
    cameraDistance?: number;
    populationSeed?: number;
    populationCount?: number;
    groundPatchMeters?: number;
  };
};

export type VegetationSpeciesAssetFile = {
  assetVersion: 1;
  kind: "vegetationSpecies";
  species: VegetationSpeciesDefinition;
  editor?: VegetationAssetEditorMetadata;
};

export type VegetationSpeciesBundleFile = {
  assetVersion: 1;
  kind: "vegetationSpeciesBundle";
  species: [VegetationSpeciesDefinition, ...VegetationSpeciesDefinition[]];
  editor?: VegetationAssetEditorMetadata;
};

export type VegetationAssetFile = VegetationSpeciesAssetFile | VegetationSpeciesBundleFile;

export const vegetationSpeciesDefinitions: Partial<Record<FoliageKey, VegetationSpeciesDefinition>> = {
  flowerBlue: {
    id: "flowerBlue",
    displayName: "Blue Field Flower",
    category: "fieldFlower",
    generator: "monolithicPlant",
    materials: {
      petal: { baseColor: "#a8c7fa", emissiveColor: "#4d5f7a", roughness: 0.9 },
    },
    parts: [{
      id: "flower",
      kind: "monolith",
      materialId: "petal",
      shape: {
        type: "saddleFlower",
        petalCount: { min: 5, max: 8 },
        petalLength: { min: 0.075, max: 0.115 },
        petalWidth: { min: 0.04, max: 0.072 },
        cup: { min: 0.2, max: 0.34 },
        curl: { min: 0.14, max: 0.28 },
        stemHeight: { min: 0.1, max: 0.18 },
        stemRadius: { min: 0.012, max: 0.018 },
        centerRadius: { min: 0.04, max: 0.06 },
      },
    }],
    instanceRanges: { yaw: { min: 0, max: Math.PI * 2 }, scale: { min: 0.9, max: 1.12 } },
    lod: { nearGeometry: "procedural", farRepresentation: "none", farColor: "#a8c7fa", farStrength: 0.4 },
  },
  flowerWhite: {
    id: "flowerWhite",
    displayName: "White Field Flower",
    category: "fieldFlower",
    generator: "monolithicPlant",
    materials: {
      petal: { baseColor: "#f2f5fc", emissiveColor: "#6b6e75", roughness: 0.9 },
    },
    parts: [{
      id: "flower",
      kind: "monolith",
      materialId: "petal",
      shape: {
        type: "saddleFlower",
        petalCount: { min: 5, max: 8 },
        petalLength: { min: 0.075, max: 0.115 },
        petalWidth: { min: 0.04, max: 0.072 },
        cup: { min: 0.2, max: 0.34 },
        curl: { min: 0.14, max: 0.28 },
        stemHeight: { min: 0.1, max: 0.18 },
        stemRadius: { min: 0.012, max: 0.018 },
        centerRadius: { min: 0.04, max: 0.06 },
      },
    }],
    instanceRanges: { yaw: { min: 0, max: Math.PI * 2 }, scale: { min: 0.9, max: 1.12 } },
    lod: { nearGeometry: "procedural", farRepresentation: "none", farColor: "#f2f5fc", farStrength: 0.4 },
  },
  flowerYellow: {
    id: "flowerYellow",
    displayName: "Yellow Field Flower",
    category: "fieldFlower",
    generator: "monolithicPlant",
    materials: {
      petal: { baseColor: "#fcdb38", emissiveColor: "#756112", roughness: 0.9 },
    },
    parts: [{
      id: "flower",
      kind: "monolith",
      materialId: "petal",
      shape: {
        type: "saddleFlower",
        petalCount: { min: 5, max: 8 },
        petalLength: { min: 0.075, max: 0.115 },
        petalWidth: { min: 0.04, max: 0.072 },
        cup: { min: 0.2, max: 0.34 },
        curl: { min: 0.14, max: 0.28 },
        stemHeight: { min: 0.1, max: 0.18 },
        stemRadius: { min: 0.012, max: 0.018 },
        centerRadius: { min: 0.04, max: 0.06 },
      },
    }],
    instanceRanges: { yaw: { min: 0, max: Math.PI * 2 }, scale: { min: 0.9, max: 1.12 } },
    lod: { nearGeometry: "procedural", farRepresentation: "none", farColor: "#fcdb38", farStrength: 0.4 },
  },
  flowerRed: {
    id: "flowerRed",
    displayName: "Red Field Flower",
    category: "fieldFlower",
    generator: "monolithicPlant",
    materials: {
      petal: { baseColor: "#eb3830", emissiveColor: "#781a14", roughness: 0.9 },
    },
    parts: [{
      id: "flower",
      kind: "monolith",
      materialId: "petal",
      shape: {
        type: "saddleFlower",
        petalCount: { min: 5, max: 8 },
        petalLength: { min: 0.075, max: 0.115 },
        petalWidth: { min: 0.04, max: 0.072 },
        cup: { min: 0.2, max: 0.34 },
        curl: { min: 0.14, max: 0.28 },
        stemHeight: { min: 0.1, max: 0.18 },
        stemRadius: { min: 0.012, max: 0.018 },
        centerRadius: { min: 0.04, max: 0.06 },
      },
    }],
    instanceRanges: { yaw: { min: 0, max: Math.PI * 2 }, scale: { min: 0.9, max: 1.12 } },
    lod: { nearGeometry: "procedural", farRepresentation: "none", farColor: "#eb3830", farStrength: 0.4 },
  },
  clover: {
    id: "clover",
    displayName: "Clover",
    category: "groundcover",
    generator: "monolithicPlant",
    materials: {
      leaf: { baseColor: "#0b2a05", emissiveColor: "#010401", roughness: 0.95 },
    },
    parts: [{
      id: "cluster",
      kind: "monolith",
      materialId: "leaf",
      shape: {
        type: "cloverCluster",
        leafCount: { min: 2, max: 4 },
        leafRadius: { min: 0.055, max: 0.105 },
        clusterRadius: { min: 0.08, max: 0.15 },
        lift: { min: 0.015, max: 0.055 },
      },
    }],
    instanceRanges: { yaw: { min: 0, max: Math.PI * 2 }, scale: { min: 0.85, max: 1.2 } },
    lod: { nearGeometry: "procedural", farRepresentation: "none", farColor: "#0b2a05", farStrength: 0.25 },
  },
};

export function vegetationDefinitionFor(type: string): VegetationSpeciesDefinition | undefined {
  return vegetationSpeciesDefinitions[type as FoliageKey];
}
