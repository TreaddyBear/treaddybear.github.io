#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const args = process.argv.slice(2);

function option(name, fallback) {
  const index = args.indexOf(name);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
}

const inputPath = path.resolve(option("--input", "map-exports/lawn-maps.json"));
const outPath = path.resolve(option("--out", "map-exports/lawn-maps.json"));

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function assertPoint2(value, label) {
  assert(Array.isArray(value) && value.length === 2, `${label} must be a Point2 [x, z]`);
  assert(value.every((item) => Number.isFinite(item)), `${label} must contain finite numbers`);
}

function assertShape(shape, label) {
  assert(shape && typeof shape === "object", `${label} must be an object`);

  if (shape.type === "rectangle") {
    assertPoint2(shape.center, `${label}.center`);
    assertPoint2(shape.size, `${label}.size`);
    return;
  }

  if (shape.type === "circle") {
    assertPoint2(shape.center, `${label}.center`);
    assert(Number.isFinite(shape.radius) && shape.radius > 0, `${label}.radius must be positive`);
    return;
  }

  if (shape.type === "polygon") {
    assert(Array.isArray(shape.points) && shape.points.length >= 3, `${label}.points must have at least 3 points`);
    shape.points.forEach((point, index) => assertPoint2(point, `${label}.points[${index}]`));
    return;
  }

  throw new Error(`${label}.type must be rectangle, circle, or polygon`);
}

function assertPathShape(shape, label) {
  assert(shape && typeof shape === "object", `${label} must be an object`);

  if (shape.type === "line") {
    assertPoint2(shape.start, `${label}.start`);
    assertPoint2(shape.end, `${label}.end`);
    return;
  }

  if (shape.type === "polyline") {
    assert(Array.isArray(shape.points) && shape.points.length >= 2, `${label}.points must have at least 2 points`);
    shape.points.forEach((point, index) => assertPoint2(point, `${label}.points[${index}]`));
    return;
  }

  if (shape.type === "cubicBezierPath") {
    assertPoint2(shape.start, `${label}.start`);
    assert(Array.isArray(shape.curves), `${label}.curves must be an array`);
    shape.curves.forEach((curve, index) => {
      assertPoint2(curve.c1, `${label}.curves[${index}].c1`);
      assertPoint2(curve.c2, `${label}.curves[${index}].c2`);
      assertPoint2(curve.end, `${label}.curves[${index}].end`);
    });
    return;
  }

  throw new Error(`${label}.type must be line, polyline, or cubicBezierPath`);
}

function walkAreas(areas, visit) {
  for (const area of areas ?? []) {
    visit(area);
    walkAreas(area.children ?? [], visit);
  }
}

function validatePack(pack) {
  assert(pack.version === 1, "Expected version: 1");
  assert(pack.units === "meters", 'Expected units: "meters"');
  assert(pack.pack && typeof pack.pack.prefix === "string" && typeof pack.pack.name === "string", "Expected pack prefix and name");
  assert(Array.isArray(pack.levels) && pack.levels.length > 0, "Expected at least one level");

  for (const [levelIndex, level] of pack.levels.entries()) {
    const label = `levels[${levelIndex}]`;
    assert(typeof level.code === "string" && level.code.length > 0, `${label}.code is required`);
    assert(typeof level.name === "string" && level.name.length > 0, `${label}.name is required`);
    assert(Number.isFinite(level.parSeconds), `${label}.parSeconds must be a number`);
    assertPoint2(level.spawn?.position, `${label}.spawn.position`);
    assert(Number.isFinite(level.spawn?.headingDegrees), `${label}.spawn.headingDegrees must be a number`);
    assert(Array.isArray(level.areas), `${label}.areas must be an array`);
    assert(Array.isArray(level.roads), `${label}.roads must be an array`);
    assert(Array.isArray(level.dirtPaths), `${label}.dirtPaths must be an array`);
    assert(Array.isArray(level.fences), `${label}.fences must be an array`);
    assert(level.terrain && Array.isArray(level.terrain.heightFeatures), `${label}.terrain.heightFeatures must be an array`);
    assert(Array.isArray(level.objects), `${label}.objects must be an array`);

    const ids = new Set();
    const checkId = (item, itemLabel) => {
      assert(typeof item.id === "string" && item.id.length > 0, `${itemLabel}.id is required`);
      assert(!ids.has(item.id), `${label} has duplicate id: ${item.id}`);
      ids.add(item.id);
    };

    walkAreas(level.areas, (area) => {
      checkId(area, `${label}.area`);
      assert(area.kind === "area", `${label}.area ${area.id} must have kind: "area"`);
      assertShape(area.shape, `${label}.area ${area.id}.shape`);
      assert(Array.isArray(area.vegetation), `${label}.area ${area.id}.vegetation must be an array`);
    });

    for (const road of level.roads) {
      checkId(road, `${label}.road`);
      assert(road.kind === "road", `${label}.road ${road.id} must have kind: "road"`);
      assert(Number.isFinite(road.width) && road.width > 0, `${label}.road ${road.id}.width must be positive`);
      assertPathShape(road.shape, `${label}.road ${road.id}.shape`);
    }

    for (const dirtPath of level.dirtPaths) {
      checkId(dirtPath, `${label}.dirtPath`);
      assert(dirtPath.kind === "dirtPath", `${label}.dirtPath ${dirtPath.id} must have kind: "dirtPath"`);
      assert(Number.isFinite(dirtPath.width) && dirtPath.width > 0, `${label}.dirtPath ${dirtPath.id}.width must be positive`);
      assertPathShape(dirtPath.shape, `${label}.dirtPath ${dirtPath.id}.shape`);
    }

    for (const fence of level.fences) {
      checkId(fence, `${label}.fence`);
      assert(fence.kind === "fence", `${label}.fence ${fence.id} must have kind: "fence"`);
      assert(Number.isFinite(fence.height) && fence.height > 0, `${label}.fence ${fence.id}.height must be positive`);
      assertPathShape(fence.shape, `${label}.fence ${fence.id}.shape`);
    }

    for (const feature of level.terrain.heightFeatures) {
      checkId(feature, `${label}.heightFeature`);
      assert(feature.type === "hill", `${label}.heightFeature ${feature.id} must have type: "hill"`);
      assertShape(feature.shape, `${label}.heightFeature ${feature.id}.shape`);
      assert(Number.isFinite(feature.height), `${label}.heightFeature ${feature.id}.height must be a number`);
      assert(Number.isFinite(feature.falloff) && feature.falloff > 0, `${label}.heightFeature ${feature.id}.falloff must be positive`);
    }
  }
}

const pack = JSON.parse(fs.readFileSync(inputPath, "utf8"));
validatePack(pack);

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, `${JSON.stringify(pack, null, 2)}\n`);
console.log(`Validated and exported ${pack.levels.length} v1 levels to ${path.relative(process.cwd(), outPath)}`);
