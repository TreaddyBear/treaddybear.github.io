# Map Format v1 — Working Checklist

This project has three moving parts: the level editor, the game, and the format
that sits between them. This file tracks the v1 push of that format — what
remains before the standard is considered stable. It covers code work in the
game, open questions in the spec, and deliberate deferrals. It is a living
document; update it when items close or new ones surface.

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

- [ ] **Add a real validator.** One function that checks a parsed map pack
  against the spec: child areas fully contained within their parent, no sibling
  overlap, all `vegetation.type` values present in the foliage registry, no
  duplicate `id` values within a level. `tools/export-maps.mjs` already has
  partial structural validation to build from; the containment and overlap checks
  are the gap.

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

- [ ] **Resolve `edgeFalloff` math** — currently marked provisional ("Exact
  falloff math is provisional until validated in-engine" appears in both the
  Distribution and Areas → Composition sections). Pin the formula once the
  engine behavior is confirmed so editor preview can match it exactly.

- [ ] **Resolve terrain `max-height-wins` behavior** — spec says "Terrain hill
  behavior is still marked for revision before v1 ships. The current direction is
  max-height-wins, but the exact contribution/falloff formula needs engine
  validation." Confirm the formula, update the Terrain section, and remove the
  provisional note.

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

## This session's commits (context for whoever picks this up next)

These four commits landed locally on the `dev` branch and have **not been
pushed** as of 2026-06-25:

| Hash | Description |
|------|-------------|
| `d00541d` | Fix silent-breakage risk in pre-v1 map tools (version claim and `maps`/`levels` key mismatch) |
| `874ee77` | Fix six `runtimeMap.ts` correctness bugs (`lerpSamples`, `bedAreas`, `estimatedMowableArea`, clover radius, `grassKeep` comment, spawn Y); add `fallback`-capable sample API |
| `d7ca9b6` | Add default background level for outer-world authored content — `bgrnBackground` level with Perlin grass and authored conceal-hill height feature; remove hardcoded hill formula from `world.ts`; wire `defaultLawnMap` through `config.ts`, `grass.ts`, `main.ts` |
| `619d60c` | Wire grass overlay mask to authored background density — `grassMaskValue` now reads `foliageDensityAt(activeMap, "grass", x, z, defaultLawnMap)` instead of a hardcoded `distanceToAnyLawn` fade; remove dead `grassOverlayAlpha` |
