#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const args = process.argv.slice(2);
const inputArg = args.find((arg) => !arg.startsWith("--") && args[args.indexOf(arg) - 1] !== "--out");
const inputPath = path.resolve(inputArg ?? "map-exports/lawn-maps.json");

function option(name, fallback) {
  const index = args.indexOf(name);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
}

const outPath = path.resolve(option("--out", "map-exports/lawn-levels.generated.ts"));
const exportJson = JSON.parse(fs.readFileSync(inputPath, "utf8"));

if (exportJson.version !== 1 || !Array.isArray(exportJson.maps)) {
  throw new Error("Expected { version: 1, maps: [...] }");
}

function num(value) {
  if (!Number.isFinite(value)) {
    throw new Error(`Expected finite number, got ${value}`);
  }
  return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(6)));
}

function string(value) {
  return JSON.stringify(String(value));
}

function vec(vector) {
  return `new Vector3(${num(vector.x)}, ${num(vector.y)}, ${num(vector.z)})`;
}

function rect(rectangle) {
  return `xMin: ${num(rectangle.xMin)}, xMax: ${num(rectangle.xMax)}, zMin: ${num(rectangle.zMin)}, zMax: ${num(rectangle.zMax)}`;
}

function segment(segmentValue) {
  const width = segmentValue.width ?? (segmentValue.xMax - segmentValue.xMin);
  const height = segmentValue.height ?? (segmentValue.zMax - segmentValue.zMin);
  const center = segmentValue.center ?? {
    x: (segmentValue.xMin + segmentValue.xMax) / 2,
    y: 0,
    z: (segmentValue.zMin + segmentValue.zMax) / 2,
  };
  return `{ ${rect(segmentValue)}, width: ${num(width)}, height: ${num(height)}, center: ${vec(center)} }`;
}

function fenceSegment(fence) {
  return `{ start: ${vec(fence.start)}, end: ${vec(fence.end)} }`;
}

function flowerBed(bed) {
  return `{ ${rect(bed)}, count: ${num(bed.count)} }`;
}

function flowerField(field) {
  return `{ variant: ${string(field.variant)}, area: { ${rect(field.area)} }, spacing: ${num(field.spacing)} }`;
}

function cloverPatch(patch) {
  const optional = [];
  if (patch.spacing !== undefined) {
    optional.push(`spacing: ${num(patch.spacing)}`);
  }
  if (patch.grassKeep !== undefined) {
    optional.push(`grassKeep: ${num(patch.grassKeep)}`);
  }
  return `{ x: ${num(patch.x)}, z: ${num(patch.z)}, radius: ${num(patch.radius)}${optional.length ? `, ${optional.join(", ")}` : ""} }`;
}

function array(values, formatter, indent) {
  if (!values || values.length === 0) {
    return "[]";
  }
  const pad = " ".repeat(indent);
  const inner = " ".repeat(indent + 2);
  return `[\n${values.map((value) => `${inner}${formatter(value)}`).join(",\n")}\n${pad}]`;
}

function mapEntry(map) {
  const lines = [
    `code: ${string(map.code)}`,
    `name: ${string(map.name)}`,
    `spawn: ${vec(map.spawn)}`,
    `segments: ${array(map.segments, segment, 4)}`,
    `fenceSegments: ${array(map.fenceSegments, fenceSegment, 4)}`,
    `flowerBeds: ${array(map.flowerBeds, flowerBed, 4)}`,
    `dandelionCount: ${num(map.dandelionCount)}`,
  ];

  if (map.flowerFields?.length) {
    lines.push(`flowerFields: ${array(map.flowerFields, flowerField, 4)}`);
  }
  if (map.cloverPatches?.length) {
    lines.push(`cloverPatches: ${array(map.cloverPatches, cloverPatch, 4)}`);
  }

  return `  ${string(map.code)}: {\n${lines.map((line) => `    ${line}`).join(",\n")}\n  }`;
}

const maps = exportJson.maps;
const levelCodes = maps.map((map) => map.code);
const parSeconds = Object.fromEntries(maps.map((map) => [map.code, map.parSeconds]));
const tsText = `import { Vector3 } from "@babylonjs/core";

export const importedLevelCodes = ${JSON.stringify(levelCodes)} as const;

export const importedParSeconds = ${JSON.stringify(parSeconds, null, 2)};

export const importedLawnLevels = {
  settings: {
    parSeconds: importedParSeconds,
  },
${maps.map(mapEntry).join(",\n")}
};
`;

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, tsText);
console.log(`Imported ${maps.length} maps into ${path.relative(process.cwd(), outPath)}`);
