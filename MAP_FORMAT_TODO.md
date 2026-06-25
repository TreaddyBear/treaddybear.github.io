# Map Format v1 — Working Checklist

This project has three moving parts: the level editor, the game, and the format
that sits between them. This file tracks the v1 push of that format — what
remains before the standard is considered stable. It covers code work in the
game, open questions in the spec, and deliberate deferrals. It is a living
document; update it when items close or new ones surface.

---

## Bake-step checklist (decided 2026-06-25 — see `ARCHITECTURE.md`)

- [x] **Baked format types** (`src/bakedMapFormat.ts`): `BakedVec3`, `BakedRuntimeSegment`, `BakedFenceSegment`, `BakedRuntimeMap`, `BakedMapPack`. `RuntimeMap.source` made optional so the baked format can omit the redundant raw level data.
- [x] **Baker tool** (`tools/bake-maps.ts`): validates authored source (`assertMapPackValid`), runs `bakeLevel()` (same logic as `normalizeLevel()` but without Babylon.js — outputs plain `BakedVec3`), emits `map-exports/lawn-maps.baked.json`. Run with `pnpm bake`. Exits 1 on invalid input.
- [x] **Initial baked artifact** committed (`map-exports/lawn-maps.baked.json`): 6 levels, 25 areas, 10 mowable segments. Regenerate with `pnpm bake` after editing the authored source.
- [x] **Engine wiring** (`src/bakedMapLoader.ts` + `src/config.ts`): `loadBakedMapPack()` imports the baked JSON, hydrates `BakedVec3 → Vector3`, and returns the same `{ maps, byCode, parSeconds, codes, defaultMap }` shape. `config.ts` now calls `loadBakedMapPack()` instead of `normalizeMapPack(mapPack)`. `mapData.ts` is no longer imported by any production module.
- [x] **Dev escape hatch** (`src/devMapLoader.ts`): `loadAuthoredMapPack()` is DEV-gated (throws in production) and uses dynamic imports so it is tree-shaken out of production bundles. Not imported by any game module.
- [ ] **Remove runtime normalize from production path**: `normalizeMapPack`/`normalizeLevel` in `runtimeMap.ts` are no longer called at startup but remain in the codebase — used by `devMapLoader.ts` and potentially useful for testing. Mark them `@deprecated` or move to a dev-only module once the bake step is fully trusted and the dev escape hatch is the only consumer.
- [x] **Stale-artifact detection** (`src/devMapStaleCheck.ts`): FNV-1a hash of `JSON.stringify(parsedSource)` embedded in the artifact at bake time (`BakedMapPack.sourceHash`). At dev startup `bakedMapLoader.ts` fires-and-forgets a dynamic import of the check module; it recomputes the same hash from the Vite-served `lawn-maps.json` and `console.warn`s if they differ (`"⚠️ [LaMow] Baked map artifact is stale — run pnpm bake"`). Severity is warn, not error — the dev escape hatch exists for intentional unbaked tinkering. Tree-shaken from production (dynamic import inside `if (import.meta.env.DEV)`).

**Baking issues caught during implementation (validator wins):**
- `bgrnField.areas[0].children`: `flowerYellow03` and `flowerRed04` are identical additive rectangles — intentional (two flower types, same footprint). Validator updated to skip additive+additive pairs (commit `68c9329`).
- `bgrnShowcase.areas[0].children`: `cloverPatch02` (replace circle, r=5.8) overlap with `flowerRed03` (additive rectangle) at corner region. Fixed by shifting circle center 0.5m east to `[2.0, 4.5]` (commit `19f39bf`).

---

## Bucket 1 — Close out v1 (finishable code work)

- [ ] **Retire the legacy intermediary arrays.** `normalizeLevel` in
  `src/runtimeMap.ts` compiles the v1 area tree into flat arrays (`segments`,
  `cloverPatches`, `flowerBeds`, `flowerFields`) that game systems read directly.
  These are a derivative representation — the same data already lives in the area
  tree and can be queried via `sampleMapArea`. Migrate the remaining consumers
  (`cloverField.ts`, `cloverPatch.ts`, `fieldFlowers.ts`, `attractCamera.ts`) to
  the `sampleMapArea` path and drop the flat arrays from `RuntimeMap`. The
  conversion tool `tools/import-maps.mjs` (which produces the old flat shape as
  legacy output) can then be removed or repurposed as a read-only validator.
  *(Biggest cleanup — needs a deliberate pass.)*

- [ ] **Remove remaining legacy shims in `RuntimeMap`.** The `CloverPatch` type
  still carries `spacing` (computed from `densityToSpacing`) and `grassKeep`
  (a density scalar read by `cloverField.ts`). These exist because the clover
  renderer prefers spacing over density and needs a grass-retention floor. Once
  the clover renderer is rewritten to consume `sampleMapArea` directly (see
  above), both fields can be dropped from the type.

- [x] **Add a real validator.** `src/mapValidator.ts` — `validateMapPack()`
  returns a list of error strings; `assertMapPackValid()` throws on any error.
  Checks: version field, prefix present, level code uniqueness, area ID
  uniqueness (within each level tree), vegetation layer ID uniqueness (within
  each area), all `vegetation.type` values in the foliage registry, density ≥ 0
  and < 10, Perlin softness > 0, octaves non-empty, edgeFalloff ≥ 0, road/path
  widths and fence heights > 0, heightFeature falloff > 0,
  `defaultLevelCode` resolves to an existing level, area containment (boundary
  samples of child inside parent, 0.5% inset to avoid float false-positives),
  and sibling overlap (boundary samples of one sibling not inside another).
  Wired into `src/mapData.ts` at startup — fails loudly on malformed data.
  *(Geometric checks approximate: false negatives possible for edge crossings
  without vertex containment; false positives are suppressed by the inset.)*

- [ ] **Visual check (in-game).** Two changes from the 2026-06-24–25 session
  need eyes on them before being considered done:
  - *Outer-grass patchiness:* background Perlin threshold is 0.25 / softness
    0.18. If the outer world reads as too patchy compared to the old smooth
    distance-fade, raise threshold toward 0.1–0.15 to widen grassy coverage
    (file: `map-exports/lawn-maps.json`, level `background`, area `outer`).
  - *Conceal-hill shape:* the old hardcoded ellipse (`dx²/74 + dz²/34`) is now
    the authored circle at `[-25.5, -16.5]` with `radius: 9, height: 4.1,
    falloff: 9` in `terrain.heightFeatures`. The shapes differ by ~0.5m at
    mid-slope; confirm it looks right in-world.

---

## Bucket 2 — Spec hygiene (doc edits in `MAP_FORMAT_V1_DRAFT.md`, not code)

See **[docs/OPEN_QUESTIONS.md](docs/OPEN_QUESTIONS.md)** for full analysis and proposed
resolutions for both items below. Checkboxes stay open until T accepts a resolution and
edits MAP_FORMAT_V1_DRAFT.md.

- [ ] **Resolve `edgeFalloff` math** — formula confirmed as
  `smoothstep01(signedDistToEdge / edgeFalloff) × density`. Three spec
  clarifications proposed: name the smoothstep curve; document that
  role/mowable/surface snap at shape boundary (not at vegetation transition);
  note polygon SDF approximation. See `docs/OPEN_QUESTIONS.md §1`.

- [ ] **Resolve terrain `max-height-wins` behavior** — formula confirmed as
  `max(feature.height × smoothstep01(distToEdge / falloff))` over all features.
  Two decisions still open: how to define `height` when `falloff ≥ shape_inradius`
  (Option A1 vs. A2 in the doc), and whether to add a validator warning for that
  case (Option B1 vs. B2). Max-wins multi-feature is already spec'd as intent and
  confirmed. See `docs/OPEN_QUESTIONS.md §2`.

- [x] **`objects: []`** — DECIDED (2026-06-24 session): stays in the spec as an
  intentional future placeholder. No schema defined in v1; the array is kept
  empty. No action needed.

---

## Bucket 3 — Explicitly deferred (v2/v3 — parked on purpose)

- [ ] **Biome-prefix concept.** A pack prefix maps to a shared "biome" that
  defines default outer terrain shape, foliage density, roads, skybox, sky/sun
  color — things a specific level can then tweak or fully override.

- [ ] **Per-level override/tweak of biome values.** The mechanism by which a
  level inherits from its biome and selectively overrides individual fields
  (terrain falloff, grass density, lighting temperature, etc.).

- [ ] **Skybox / sky / sun / lighting in the format.** Not in scope for v1 by
  design ("Rendering, art, themes, seasons, or color. The game decides how
  anything looks" — Scope and Non-Goals). Tracked here as a v2/v3 candidate.

---

## Additional completed items (not in original buckets)

- [x] **Move `shapeCenter` to `utils/shapes.ts`.** It is a shape-geometry
  utility with no business being in `runtimeMap.ts`. Moved and re-exported from
  the correct module; `runtimeMap.ts` imports it alongside the rest of the shape
  helpers.

- [x] **Fix `import-maps.mjs` legacy divergences** (see commit `45e6671`):
  `densityToSpacing` formula aligned with runtime (`0.5/√density`, min 0.18);
  non-circle clover center now uses `shapeCenter` (vertex-average) instead of
  bounding-box midpoint; non-circle clover radius now uses area-equivalent
  `√(area/π)` instead of inscribed-circle-from-bounds; spawn Y changed 0.18→0.

---

## This session's commits (context for whoever picks this up next)

These four commits landed locally on the `dev` branch and have **not been
pushed** as of 2026-06-25:

| Hash | Description |
|------|-------------|
| `d00541d` | Fix silent-breakage risk in pre-v1 map tools (version claim and `maps`/`levels` key mismatch) |
| `874ee77` | Fix six `runtimeMap.ts` correctness bugs (`lerpSamples`, `bedAreas`, `estimatedMowableArea`, clover radius, `grassKeep` comment, spawn Y); add `fallback`-capable sample API |
| `d7ca9b6` | Add default background level for outer-world authored content — `bgrnBackground` level with Perlin grass and authored conceal-hill height feature; remove hardcoded hill formula from `world.ts`; wire `defaultLawnMap` through `config.ts`, `grass.ts`, `main.ts` |
| `619d60c` | Wire grass overlay mask to authored background density — `grassMaskValue` now reads `foliageDensityAt(activeMap, "grass", x, z, defaultLawnMap)` instead of a hardcoded `distanceToAnyLawn` fade; remove dead `grassOverlayAlpha` |
| `383028c` | Add map-pack validator (`src/mapValidator.ts`) and wire into `src/mapData.ts` at startup |
| `596b0c6` | Move `shapeCenter` from `runtimeMap.ts` to `utils/shapes.ts` |
| `45e6671` | Fix three legacy divergences in `tools/import-maps.mjs` (densityToSpacing, non-circle clover, spawn Y) |
