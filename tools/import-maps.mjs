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

const flowerFoliageToVariant = {
  flowerBlue: "blue",
  flowerWhite: "white",
  flowerYellow: "yellow",
  flowerRed: "red",
};

function capitalize(value) {
  return value ? value[0].toUpperCase() + value.slice(1) : value;
}

function fullLevelCode(pack, level) {
  return `${pack.prefix}${capitalize(level.code)}`;
}

function rotatePoint(x, z, degrees = 0) {
  const angle = (degrees * Math.PI) / 180;
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return [(x * c) - (z * s), (x * s) + (z * c)];
}

function boundsFromPoints(points) {
  if (points.length === 0) {
    return { xMin: 0, xMax: 0, zMin: 0, zMax: 0 };
  }
  return {
    xMin: Math.min(...points.map(([x]) => x)),
    xMax: Math.max(...points.map(([x]) => x)),
    zMin: Math.min(...points.map(([, z]) => z)),
    zMax: Math.max(...points.map(([, z]) => z)),
  };
}

function shapeBounds(shape) {
  if (shape.type === "circle") {
    return {
      xMin: shape.center[0] - shape.radius,
      xMax: shape.center[0] + shape.radius,
      zMin: shape.center[1] - shape.radius,
      zMax: shape.center[1] + shape.radius,
    };
  }

  if (shape.type === "rectangle") {
    const halfW = Math.abs(shape.size[0]) / 2;
    const halfD = Math.abs(shape.size[1]) / 2;
    const corners = [
      [-halfW, -halfD],
      [halfW, -halfD],
      [halfW, halfD],
      [-halfW, halfD],
    ].map(([x, z]) => {
      const [rx, rz] = rotatePoint(x, z, shape.rotationDegrees ?? 0);
      return [shape.center[0] + rx, shape.center[1] + rz];
    });
    return boundsFromPoints(corners);
  }

  return boundsFromPoints(shape.points ?? []);
}

function shapeArea(shape) {
  if (shape.type === "circle") {
    return Math.PI * shape.radius * shape.radius;
  }

  if (shape.type === "rectangle") {
    return Math.abs(shape.size[0] * shape.size[1]);
  }

  let sum = 0;
  const points = shape.points ?? [];
  for (let index = 0; index < points.length; index += 1) {
    const [x1, z1] = points[index];
    const [x2, z2] = points[(index + 1) % points.length];
    sum += (x1 * z2) - (x2 * z1);
  }
  return Math.abs(sum) / 2;
}

function walkAreas(areas, visit) {
  for (const area of areas ?? []) {
    visit(area);
    walkAreas(area.children ?? [], visit);
  }
}

function layerDensity(area, type) {
  return (area.vegetation ?? [])
    .filter((layer) => layer.type === type)
    .reduce((sum, layer) => sum + Number(layer.distribution?.density ?? 0), 0);
}

function point2(point, y = 0) {
  return { x: Number(point?.[0] ?? 0), y, z: Number(point?.[1] ?? 0) };
}

function densityToSpacing(density) {
  if (density <= 0) {
    return 0.6;
  }
  return Math.max(0.18, Number((0.5 / Math.sqrt(Math.max(0.01, density))).toFixed(3)));
}

// Approximate centroid: exact for circles/rectangles, vertex-average for polygons.
function shapeCenter(shape) {
  if (shape.type === "circle" || shape.type === "rectangle") {
    return { x: shape.center[0], z: shape.center[1] };
  }
  const pts = shape.points ?? [];
  if (pts.length === 0) {
    return { x: 0, z: 0 };
  }
  return {
    x: pts.reduce((sum, [x]) => sum + x, 0) / pts.length,
    z: pts.reduce((sum, [, z]) => sum + z, 0) / pts.length,
  };
}

function cubicBezier(start, c1, c2, end, t) {
  const mt = 1 - t;
  const a = mt * mt * mt;
  const b = 3 * mt * mt * t;
  const c = 3 * mt * t * t;
  const d = t * t * t;
  return [
    (start[0] * a) + (c1[0] * b) + (c2[0] * c) + (end[0] * d),
    (start[1] * a) + (c1[1] * b) + (c2[1] * c) + (end[1] * d),
  ];
}

function pathPolyline(shape, steps = 16) {
  if (shape.type === "line") {
    return [shape.start, shape.end];
  }
  if (shape.type === "polyline") {
    return shape.points ?? [];
  }

  const points = [shape.start];
  let start = shape.start;
  for (const curve of shape.curves ?? []) {
    for (let step = 1; step <= steps; step += 1) {
      points.push(cubicBezier(start, curve.c1, curve.c2, curve.end, step / steps));
    }
    start = curve.end;
  }
  return points;
}

function pathFenceSegments(shape) {
  const points = pathPolyline(shape);
  const segments = [];
  for (let index = 0; index < points.length - 1; index += 1) {
    segments.push({ start: point2(points[index]), end: point2(points[index + 1]) });
  }
  return segments;
}

function v1AreaToRect(shape) {
  const bounds = shapeBounds(shape);
  return {
    xMin: Number(bounds.xMin.toFixed(6)),
    xMax: Number(bounds.xMax.toFixed(6)),
    zMin: Number(bounds.zMin.toFixed(6)),
    zMax: Number(bounds.zMax.toFixed(6)),
  };
}

function v1LevelToLegacyMap(pack, level) {
  const segments = [];
  const flowerBeds = [];
  const flowerFields = [];
  const cloverPatches = [];
  let dandelionCount = 0;

  walkAreas(level.areas, (area) => {
    const areaRect = v1AreaToRect(area.shape);
    const areaSize = shapeArea(area.shape);

    if (area.role === "lawn" || area.mowable === true) {
      segments.push(areaRect);
    }

    const tulipDensity = layerDensity(area, "tulip");
    if (area.role === "bed" || tulipDensity > 0) {
      flowerBeds.push({ ...areaRect, count: Math.max(0, Math.round(areaSize * Math.max(tulipDensity, 0.35) * 4)) });
    }

    const dandelionDensity = layerDensity(area, "dandelion");
    if (dandelionDensity > 0) {
      dandelionCount += Math.round(areaSize * dandelionDensity);
    }

    for (const [type, variant] of Object.entries(flowerFoliageToVariant)) {
      const density = layerDensity(area, type);
      if (density > 0) {
        flowerFields.push({ variant, area: areaRect, spacing: densityToSpacing(density) });
      }
    }

    const cloverDensity = layerDensity(area, "clover");
    if (cloverDensity > 0) {
      if (area.shape.type === "circle") {
        cloverPatches.push({
          x: area.shape.center[0],
          z: area.shape.center[1],
          radius: area.shape.radius,
          grassKeep: layerDensity(area, "grass") || 0,
        });
      } else {
        const center = shapeCenter(area.shape);
        cloverPatches.push({
          x: center.x,
          z: center.z,
          radius: Math.sqrt(shapeArea(area.shape) / Math.PI),
          grassKeep: layerDensity(area, "grass") || 0,
        });
      }
    }
  });

  return {
    code: fullLevelCode(pack, level),
    name: level.name,
    parSeconds: level.parSeconds,
    spawn: point2(level.spawn?.position, 0),
    segments,
    fenceSegments: (level.fences ?? []).flatMap((fence) => pathFenceSegments(fence.shape)),
    flowerBeds,
    dandelionCount,
    flowerFields,
    cloverPatches,
  };
}

function mapsFromInput(value) {
  if (value.version === 1 && Array.isArray(value.levels) && value.pack) {
    return value.levels.map((level) => v1LevelToLegacyMap(value.pack, level));
  }

  if (value.version === 1 && Array.isArray(value.maps)) {
    return value.maps;
  }

  throw new Error("Expected a v1 map pack { version: 1, pack, levels } or legacy { version: 1, maps: [...] }");
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

const maps = mapsFromInput(exportJson);
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
