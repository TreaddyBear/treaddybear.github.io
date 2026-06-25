// Visual debug output for the bake-time vegetation sampler.
//
// Renders PNGs for each non-background level:
//   (a) Per-layer density field heatmap for each vegetation type
//   (b) Summed T field (total tier density) heatmap
//   (c) Scatter plot of final placements colored by type
//
// Run with: pnpm viz
// Output:   map-exports/debug/<levelCode>_*.png

import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import type { Area } from "../src/mapFormat";
import type { BakedInstance, BakedMapPack } from "../src/bakedMapFormat";
import { sampleDensitiesAt, TIERS, levelBounds } from "./vegetation-sampler";
import { shapeBounds } from "../src/utils/shapes";
import { encodePNG } from "./png-writer";

const __dirname = dirname(fileURLToPath(import.meta.url));
const bakedPath = resolve(__dirname, "../map-exports/lawn-maps.baked.json");
const outDir    = resolve(__dirname, "../map-exports/debug");

const baked = JSON.parse(readFileSync(bakedPath, "utf-8")) as BakedMapPack;
mkdirSync(outDir, { recursive: true });

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const PX_PER_M = 6;    // pixels per metre
const MAX_DIM  = 700;  // cap image dimensions at this many pixels

// Per-type dot colours for the scatter plot (RGBA)
type RGBA = [number, number, number, number];
const TYPE_RGBA: Record<string, RGBA> = {
  flowerBlue:   [80,  120, 255, 255],
  flowerWhite:  [240, 240, 255, 255],
  flowerYellow: [255, 210,   0, 255],
  flowerRed:    [230,  40,  40, 255],
  tulip:        [255, 140, 200, 255],
  clover:       [40,  180,  60, 255],
  dandelion:    [210, 185,  20, 255],
  grass:        [80,  185,  50, 255],
};

// Per-type hue applied to the density heatmap so each layer is visually distinct.
// Value: [r, g, b] multiplier for the density value (0-255).
const TYPE_HUE: Record<string, [number, number, number]> = {
  flowerBlue:   [60,  100, 255],
  flowerWhite:  [200, 210, 255],
  flowerYellow: [255, 210,   0],
  flowerRed:    [255,  40,  40],
  tulip:        [255, 100, 200],
  clover:       [40,  200,  60],
  dandelion:    [230, 190,  20],
  grass:        [80,  200,  60],
};

// ---------------------------------------------------------------------------
// Drawing helpers
// ---------------------------------------------------------------------------

function makeBuffer(w: number, h: number, fill: RGBA = [0, 0, 0, 255]): Uint8Array {
  const buf = new Uint8Array(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    buf[i * 4]     = fill[0];
    buf[i * 4 + 1] = fill[1];
    buf[i * 4 + 2] = fill[2];
    buf[i * 4 + 3] = fill[3];
  }
  return buf;
}

function setPixel(buf: Uint8Array, w: number, h: number, x: number, y: number, c: RGBA) {
  if (x < 0 || y < 0 || x >= w || y >= h) return;
  const i = (y * w + x) * 4;
  buf[i] = c[0]; buf[i + 1] = c[1]; buf[i + 2] = c[2]; buf[i + 3] = c[3];
}

// Filled circle
function drawDisk(buf: Uint8Array, w: number, h: number, cx: number, cy: number, r: number, c: RGBA) {
  const r2 = r * r;
  for (let dy = -r; dy <= r; dy++) {
    for (let dx = -r; dx <= r; dx++) {
      if (dx * dx + dy * dy <= r2) setPixel(buf, w, h, cx + dx, cy + dy, c);
    }
  }
}

// Hollow rectangle border
function drawRect(buf: Uint8Array, w: number, h: number, x0: number, y0: number, x1: number, y1: number, c: RGBA) {
  for (let x = x0; x <= x1; x++) { setPixel(buf, w, h, x, y0, c); setPixel(buf, w, h, x, y1, c); }
  for (let y = y0; y <= y1; y++) { setPixel(buf, w, h, x0, y, c); setPixel(buf, w, h, x1, y, c); }
}

// Hollow circle (Bresenham)
function drawCircle(buf: Uint8Array, w: number, h: number, cx: number, cy: number, r: number, c: RGBA) {
  let x = 0, y = r, d = 3 - 2 * r;
  const plot = (px: number, py: number) => {
    setPixel(buf, w, h, cx + px, cy + py, c);
    setPixel(buf, w, h, cx - px, cy + py, c);
    setPixel(buf, w, h, cx + px, cy - py, c);
    setPixel(buf, w, h, cx - px, cy - py, c);
    setPixel(buf, w, h, cx + py, cy + px, c);
    setPixel(buf, w, h, cx - py, cy + px, c);
    setPixel(buf, w, h, cx + py, cy - px, c);
    setPixel(buf, w, h, cx - py, cy - px, c);
  };
  while (y >= x) {
    plot(x, y);
    if (d > 0) { y--; d += 4 * (x - y) + 10; } else { d += 4 * x + 6; }
    x++;
  }
}

// ---------------------------------------------------------------------------
// Coordinate helpers
// ---------------------------------------------------------------------------

type Bounds = ReturnType<typeof levelBounds>;

function worldToImg(wx: number, wz: number, bounds: Bounds, scale: number, imgH: number): [number, number] {
  const px = Math.round((wx - bounds.xMin) * scale);
  // flip Z so +Z world = up in image
  const py = imgH - 1 - Math.round((wz - bounds.zMin) * scale);
  return [px, py];
}

// ---------------------------------------------------------------------------
// Area outline helpers
// ---------------------------------------------------------------------------

function drawAreaOutline(
  area: Area,
  buf: Uint8Array, w: number, h: number,
  bounds: Bounds, scale: number,
  c: RGBA,
) {
  const s = area.shape;
  if (s.type === "rectangle") {
    const hw = s.size[0] / 2, hh = s.size[1] / 2;
    const [x0, y0] = worldToImg(s.center[0] - hw, s.center[1] - hh, bounds, scale, h);
    const [x1, y1] = worldToImg(s.center[0] + hw, s.center[1] + hh, bounds, scale, h);
    drawRect(buf, w, h, Math.min(x0, x1), Math.min(y0, y1), Math.max(x0, x1), Math.max(y0, y1), c);
  } else if (s.type === "circle") {
    const [cx, cy] = worldToImg(s.center[0], s.center[1], bounds, scale, h);
    drawCircle(buf, w, h, cx, cy, Math.round(s.radius * scale), c);
  } else if (s.type === "polygon") {
    const pts = s.points;
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i]!, b = pts[(i + 1) % pts.length]!;
      const [ax, ay] = worldToImg(a[0], a[1], bounds, scale, h);
      const [bx, by] = worldToImg(b[0], b[1], bounds, scale, h);
      // Bresenham line
      let x = ax, y = ay;
      const dx = Math.abs(bx - ax), dy = Math.abs(by - ay);
      const sx = ax < bx ? 1 : -1, sy = ay < by ? 1 : -1;
      let err = dx - dy;
      // eslint-disable-next-line no-constant-condition
      while (true) {
        setPixel(buf, w, h, x, y, c);
        if (x === bx && y === by) break;
        const e2 = 2 * err;
        if (e2 > -dy) { err -= dy; x += sx; }
        if (e2 < dx) { err += dx; y += sy; }
      }
    }
  }
}

// Recursively draw area outlines (replace areas: opaque outline; additive: dashed-ish outline)
function drawAllAreaOutlines(areas: Area[], buf: Uint8Array, w: number, h: number, bounds: Bounds, scale: number) {
  const REPLACE_COLOR: RGBA = [255, 255, 255, 200];
  const ADDITIVE_COLOR: RGBA = [255, 220, 100, 200];
  const visit = (area: Area) => {
    const isAdditive = (area.composition ?? "replace") === "additive";
    drawAreaOutline(area, buf, w, h, bounds, scale, isAdditive ? ADDITIVE_COLOR : REPLACE_COLOR);
    for (const child of area.children ?? []) visit(child);
  };
  for (const area of areas) visit(area);
}

// ---------------------------------------------------------------------------
// PNG save helper
// ---------------------------------------------------------------------------

const savedPaths: string[] = [];

function savePNG(filename: string, w: number, h: number, buf: Uint8Array): string {
  const fullPath = resolve(outDir, filename);
  writeFileSync(fullPath, encodePNG(w, h, buf));
  savedPaths.push(fullPath);
  return fullPath;
}

// ---------------------------------------------------------------------------
// Vegetation type collection
// ---------------------------------------------------------------------------

function collectVegTypes(areas: Area[]): string[] {
  const seen = new Set<string>();
  const visit = (area: Area) => {
    for (const v of area.vegetation) seen.add(v.type);
    for (const child of area.children ?? []) visit(child);
  };
  for (const area of areas) visit(area);
  return [...seen];
}

// All types across all tiers (for T field)
const ALL_TIER_TYPES = TIERS.flatMap((t) => [...t.types] as string[]);

// ---------------------------------------------------------------------------
// Main rendering loop
// ---------------------------------------------------------------------------

for (const map of baked.maps) {
  const areas = map.areas as Area[];
  const bounds = levelBounds(areas);
  const worldW = bounds.xMax - bounds.xMin;
  const worldH = bounds.zMax - bounds.zMin;

  // Skip if there's nothing to show or the level is enormous (background)
  if (worldW <= 0 || worldH <= 0 || worldW > 600 || worldH > 600) {
    console.log(`  skip ${map.shortCode} (bounds ${worldW.toFixed(0)}×${worldH.toFixed(0)} m)`);
    continue;
  }

  const scale = Math.min(PX_PER_M, MAX_DIM / Math.max(worldW, worldH));
  const imgW  = Math.max(1, Math.ceil(worldW * scale));
  const imgH  = Math.max(1, Math.ceil(worldH * scale));

  const code = map.shortCode;
  console.log(`\n${code}: ${imgW}×${imgH} px @ ${scale.toFixed(2)} px/m — ${map.bakedInstances.length} instances`);

  // --- (a) Per-layer density heatmaps ---
  const vegTypes = collectVegTypes(areas);
  for (const type of vegTypes) {
    const hue = TYPE_HUE[type] ?? [220, 220, 220];
    const buf = makeBuffer(imgW, imgH, [12, 12, 12, 255]);

    for (let py = 0; py < imgH; py++) {
      for (let px = 0; px < imgW; px++) {
        const wx = bounds.xMin + (px + 0.5) / scale;
        const wz = bounds.zMin + (imgH - 1 - py + 0.5) / scale;
        const dens = sampleDensitiesAt(areas, wx, wz);
        const d = Math.min(1, Math.max(0, dens.get(type) ?? 0));
        if (d > 0) {
          const v = d * d;  // gamma-correct: boost mid-low values visually
          const i = (py * imgW + px) * 4;
          buf[i]     = Math.round(hue[0] * v);
          buf[i + 1] = Math.round(hue[1] * v);
          buf[i + 2] = Math.round(hue[2] * v);
        }
      }
    }

    // Draw area outlines on top
    drawAllAreaOutlines(areas, buf, imgW, imgH, bounds, scale);

    const path = savePNG(`${code}_${type}_density.png`, imgW, imgH, buf);
    console.log(`  ${path}`);
  }

  // --- (b) Summed T field heatmap ---
  {
    const buf = makeBuffer(imgW, imgH, [12, 12, 12, 255]);

    for (let py = 0; py < imgH; py++) {
      for (let px = 0; px < imgW; px++) {
        const wx = bounds.xMin + (px + 0.5) / scale;
        const wz = bounds.zMin + (imgH - 1 - py + 0.5) / scale;
        const dens = sampleDensitiesAt(areas, wx, wz);
        let T = 0;
        for (const type of ALL_TIER_TYPES) T += dens.get(type) ?? 0;
        const d = Math.min(1, Math.max(0, T));
        if (d > 0) {
          const v = Math.round(d * 255);
          const i = (py * imgW + px) * 4;
          buf[i] = v; buf[i + 1] = v; buf[i + 2] = v;
        }
      }
    }

    drawAllAreaOutlines(areas, buf, imgW, imgH, bounds, scale);

    const path = savePNG(`${code}_T_field.png`, imgW, imgH, buf);
    console.log(`  ${path}`);
  }

  // --- (c) Scatter plot ---
  {
    // Background: dark lawn green
    const buf = makeBuffer(imgW, imgH, [34, 68, 30, 255]);

    // Draw area outlines first (under the dots)
    drawAllAreaOutlines(areas, buf, imgW, imgH, bounds, scale);

    // Dot radius: at least 1px, scales with zoom
    const dotR = Math.max(1, Math.round(scale * 0.25));

    for (const inst of map.bakedInstances as BakedInstance[]) {
      const [px, py] = worldToImg(inst.x, inst.z, bounds, scale, imgH);
      const color: RGBA = TYPE_RGBA[inst.type] ?? [200, 200, 200, 255];
      drawDisk(buf, imgW, imgH, px, py, dotR, color);
    }

    const path = savePNG(`${code}_scatter.png`, imgW, imgH, buf);
    console.log(`  ${path}`);
  }
}

console.log(`\n=== Generated ${savedPaths.length} PNGs → ${outDir} ===\n`);
for (const p of savedPaths) console.log(p);
