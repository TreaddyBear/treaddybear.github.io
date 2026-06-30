# MAP_FORMAT_V1_DRAFT — Open Questions: Proposed Resolutions

These are the two spec questions still open before v1 ships (see "Open Before Final v1"
section of `MAP_FORMAT_V1_DRAFT.md` and Bucket 2 in `MAP_FORMAT_TODO.md`). This document
does NOT resolve them — it does the legwork so the decisions are easy. No runtime behavior
was changed to produce this analysis.

---

## 1. `edgeFalloff` math

### What the code actually does

`areaFade()` in `src/runtimeMap.ts:243` computes a blend factor for every point inside an area:

```ts
fade = smoothstep01(signedDistanceToShapeEdge(shape, x, z) / edgeFalloff)
```

`signedDistanceToShapeEdge` (in `src/utils/shapes.ts:123`) returns a positive value for points
inside the shape equal to the distance in meters to the nearest edge. The blend factor:

| Location | fade |
|---|---|
| Outside shape | 0 (parent controls; area is not entered) |
| On the shape edge | 0 (parent-only vegetation) |
| `edgeFalloff` m inside edge | 1 (child-only vegetation) |
| Deeper than `edgeFalloff` m | 1 (clamped; child wins fully) |

`smoothstep01(t)` is cubic Hermite: `clamp(t,0,1)² × (3 − 2×clamp(t,0,1))`. The slope is
zero at both ends, so the transition accelerates from the edge, peaks at mid-band, and
decelerates back to flat — an S-curve, not a linear ramp.

**Replace composition** (`runtimeMap.ts:261`):
```
vegetation at point = parent_density × (1 − fade) + child_density × fade
role/mowable/surface = child's values everywhere the point is inside the shape
```

The role/mowable/surface snap occurs at the shape boundary, not at the vegetation transition.
A mowable `lawn` child area is treated as mowable for its entire authored footprint —
including the `edgeFalloff` band where grass is visually blending with the parent.
This is intentional (mow-completion score tracks shape boundaries, not visual coverage),
but it is not currently spelled out in the spec.

**Additive composition** (`runtimeMap.ts:262`):
```
vegetation at point = parent_density + child_density × fade
role/mowable/surface = parent's values (additive never overrides these)
```

**Polygon signed distance:** For all shapes, the signed distance is exact.
`distanceToSegment` (`geometry.ts:4`) clamps the closest-point parameter `t` to [0, 1],
finding the exact nearest point on the finite segment. `min()` over all edge segments
(`shapes.ts:146`) gives the exact nearest-boundary distance for any simple
(non-self-intersecting) polygon, including concave ones. The SDF *gradient* has a crease
at the medial axis (equidistant from two boundaries) for both convex and concave shapes,
but the scalar *value* is correct everywhere. See `docs/VEGETATION_POPULATION.md §2`
for a full derivation.

### What the spec currently says

> "Across the area's `edgeFalloff` band, inset from the shape edge, the two cross-fade:
> this area's vegetation ramps from full in the interior to zero at the edge while the
> parent's vegetation ramps back from zero to full. Exact falloff math is provisional until
> validated in-engine."

The description matches the implementation. The specific things that are unwritten:

1. The curve is smoothstep (S-shaped), not linear.
2. `edgeFalloff` is measured in meters, inward from the shape edge.
3. `role`/`mowable`/`surface` snap at the shape boundary; only vegetation cross-fades.

### Proposed resolution

**Lock in the formula as implemented.** No in-engine visual validation is strictly required
to resolve the math — the formula is already producing the expected results in the one authored
hill and in every clover/flower area. The remaining spec work is three clarifying sentences:

1. *Curve:* "The falloff blend factor is `smoothstep(0, 1, d / edgeFalloff)` where `d` is
   the distance in meters from the nearest point on the shape edge, clamped to [0, 1]."
2. *Role/mowable/surface:* "Only vegetation densities cross-fade across the band.
   `role`, `mowable`, and `surface` apply at the shape boundary, not at the vegetation
   transition: any point geometrically inside the shape uses the area's own role and
   mowability regardless of how much vegetation is blending."
3. *Polygon note:* "For polygon shapes, the distance is the minimum distance to any edge
   segment, which is exact for all simple (non-self-intersecting) polygons including
   concave ones. The SDF gradient has a crease at the medial axis but the distance value
   is correct everywhere — this is not an approximation."

**The one tradeoff to decide:** Whether the role/mowable/surface snap behavior should be
documented as specified (current impl) or changed to also fade. The snap approach is simpler,
more predictable for mow-scoring, and is already shipping. The alternative would require
defining which area "wins" the role/mowable/surface at mid-band — and the answer would almost
certainly be the inner area (same as the snap), since any point inside the lawn shape is in the
lawn. There is no practical reason to change this.

**If visual confirmation is still desired:** Start the dev server, load the `demoField` level
(which has both a `replace` clover area with edgeFalloff and an `additive` flower rectangle).
Look at the grass → clover edge inside the main lawn. A smooth, slightly S-curved visual
transition confirms the smoothstep curve. A linear-looking ramp would indicate a bug (there
isn't one). The mow-completion counter jumping exactly at the authored shape boundary confirms
the role snap.

---

## 2. Terrain `max-height-wins` behavior

### What the code actually does

`terrainFeatureHeightAt()` in `src/runtimeMap.ts:478`:

```ts
for (const feature of map.terrain.heightFeatures) {
  if (!containsPoint(feature.shape, x, z)) continue;

  const edge = signedDistanceToShapeEdge(feature.shape, x, z);
  const amount = smoothstep01(edge / feature.falloff);
  height = Math.max(height, feature.height * amount);
}
```

Per feature, at each point inside the shape:

```
contribution = feature.height × smoothstep01(dist_to_edge_in_meters / falloff)
```

Multiple features: the final height is `max()` over all contributions. Then in `world.ts:88`:

```ts
return Math.max(authoredHeight, rolling);
```

where `rolling` is a distance-faded Perlin terrain that only activates far from any lawn.
Authored height features always dominate.

### Interpretation of the parameters

**`falloff` (in meters):** The width of the slope band, measured inward from the shape edge.

| `falloff` vs. shape size | Result |
|---|---|
| `falloff` is small (e.g., 1 m on a radius-8 circle) | Wide plateau at `height`, with a narrow ramp at the edge |
| `falloff = shape_inradius` (e.g., both 9) | No plateau; smooth cone from edge (h=0) to center (h=`height`) |
| `falloff > shape_inradius` | No plateau; center peak is **less than `height`** |

**`height`:** The plateau height. The hill reaches this value everywhere more than `falloff`
meters from the edge — provided the shape has such a region. If `falloff >= shape_inradius`
(the shape is "too small" for the falloff), no such region exists and the hill never reaches
`feature.height`. For a circle, `shape_inradius = radius`; for a rectangle, it is
`min(width, depth) / 2`.

**The only authored height feature** (`worldBackground.concealHill`):
```json
{ "shape": { "type": "circle", "radius": 9 }, "height": 4.1, "falloff": 9 }
```
Here `falloff = radius = 9`, so the center is exactly 9 m from the edge, and
`smoothstep01(9/9) = 1`, giving a peak of exactly `4.1 m`. There is no plateau — the
hill rises smoothly (S-curve) from 0 at the edge to 4.1 m at the center.

**Multi-feature behavior:** `max()` at each point. Two overlapping hills produce a height
surface that is C0 continuous (no gaps) but not C1 (the slope can kink along the line
where the two contributions cross). This is visually acceptable for large background hills
but would look sharp if two hills nearly meet up close.

**Terrain vs. authored hills:** `Math.max(authoredHeight, rolling)`. Height features can
only raise terrain above 0; there is no mechanism to lower terrain below the background
rolling surface. A height feature with `height: 0` would have no effect.

### The latent authoring footgun

The validator currently checks `falloff > 0` and `height >= 0` but does NOT check
`falloff <= shape_inradius`. This means an author can write:

```json
{ "shape": { "type": "circle", "radius": 9 }, "height": 3.0, "falloff": 18 }
```

...and the hill will only reach `3.0 × smoothstep01(9/18) = 3.0 × 0.5 = 1.5 m` at the
center — half the specified height — with no error or warning. This is a quiet surprise.

The error is small when `falloff` is only slightly above `radius` (e.g., `falloff=10,
radius=9` → peak = `height × 0.972`) but large when `falloff` is a multiple of the
inradius (e.g., `falloff=18, radius=9` → peak = `height × 0.5`).

This is noted here as a potential footgun but is not currently a bug in any authored map.

### Proposed resolution

**Lock in the formula.** `smoothstep01(edge / falloff) × height` is confirmed by the one
authored hill and consistent with how `edgeFalloff` works (same curve, same distance
interpretation). Two things still need T's decision:

**A) How to specify `height` in the draft:**

*Option A1 (recommended):* Define `height` as "the plateau height — the value the hill
reaches at any point more than `falloff` meters from the edge." Then add: "If the shape's
interior does not contain any point more than `falloff` meters from the edge (i.e., `falloff`
exceeds the shape's inscribed radius), the hill forms a smooth dome and its peak value is
`height × smoothstep(0, 1, inradius / falloff)`, which is less than `height`."

This is accurate, honest, and matches the current authored hill. The downside is that
`height` is not always the peak — it's the *plateau* height, which is unintuitive when
there is no plateau.

*Option A2:* Redefine `height` as "the peak height at the geometric center (or
closest-to-edge-farthest point) of the shape." This would require changing the formula:
`amount = smoothstep01(edge / (shape_inradius × feature.falloffFraction))` where
`falloffFraction ∈ (0, 1]` describes what fraction of the interior the slope occupies.
This is more intuitive for "all cone" shapes like the current hill, but it changes the
formula and adds a harder authoring concept. Not recommended unless T prefers it.

**B) Whether to add a validator check:**

*Option B1 (recommended):* Add a warning (not an error) to `validateMapPack()` when
`falloff > shape_inradius`: "heightFeature `X`: falloff (`Y`) exceeds the shape's inscribed
radius (`Z`); actual peak will be less than `height`. This may be intentional — suppress this
warning by setting `falloff = inradius` for a cone profile." A warning rather than an error
because `falloff > inradius` is a valid artistic choice (a hill that rises gently and never
reaches a specific plateau).

*Option B2:* Leave the validator as-is and document the edge case in the spec only.

**The formula itself (no decision needed):** `smoothstep01(edge / falloff) × height`, with
max-wins multi-feature behavior, is confirmed as implemented and correct. The spec can be
updated to name the curve explicitly.

**If visual confirmation is desired:** Start the dev server and look at the conceal hill
(`worldBackground`, center at `[-25.5, -16.5]`, radius=9m). The hill should read as a smooth
dome with no flat top, rising from ground level at the circle's edge to ~4.1 m at center.
If it looks too pointy at the top or too flat, the smoothstep S-curve can be adjusted by
changing `falloff` — the formula itself doesn't need to change. The only alternative curve
worth considering is a cosine falloff (smoother highlights on lit terrain) vs. smoothstep
(slightly more "tent-like"). Both are easy to implement; the current smoothstep matches
edgeFalloff, which is an argument for keeping it consistent.

---

## Summary table

| Question | Formula confirmed? | T's decision needed |
|---|---|---|
| `edgeFalloff` curve | Yes — smoothstep, S-shaped | Yes: add the three spec clarifications |
| `edgeFalloff` role/mowable/surface behavior | Yes — snaps at shape boundary | Yes: decide whether to spec this as written or change it (snap is recommended) |
| Terrain hill formula | Yes — same smoothstep × height | Yes: choose Option A1 or A2 for `height` definition |
| Terrain validator for `falloff > inradius` | N/A — not currently checked | Yes: choose B1 (add warning) or B2 (doc only) |
| Multi-feature max-wins | Yes — confirmed in code and already spec'd as intent | Confirm and close |

---

## 3. Mowing score vs. decorative vegetation

### What the code does

Mow completion (the grass-percentage score that drives `grassPoints()` in `src/scoring.ts`) is
tracked solely by `src/mowField.ts` + the per-blade `isMowed[]` array in `src/grass.ts`. The
HUD completion fraction is `grass.mowedCount / grass.bladeCount`.

Three other vegetation types respond to the mower spatially every frame (in `src/main.ts`
lines 1551–1555) but are explicitly marked decorative with no scoring effect:

```ts
// Field flowers + clover mow away under the mower (decorative — no scoring).
fieldFlowers.update(player.position.x, player.position.z, flowerMowRadiusSquared);
cloverPatch.update(player.position.x, player.position.z, flowerMowRadiusSquared);
```

Dandelions also mow away (`dandelions.mowAt(…)` line 1551) with a full animation
(stem shrink, head toss, seed scatter) but do not advance the score percentage.

Tulips (`src/tulips.ts`) sit in `role: "bed"` (non-mowable) areas. The mower radius
reaches them anyway, and hitting one increments `tulips.mistakeCount`, deducting from
the final score via `mistakePenalty()`.

The `role`/`mowable` area flags gate **grass-blade placement** (via `randomMowablePoint`)
and **scoring geometry** (via `mowableAreas`). They do NOT gate whether flowers, clover,
or dandelions respond to the mower — those respond purely on proximity, with no check of the
enclosing area's `mowable` flag.

Full analysis: see the mow investigation note appended to `docs/BACKLOG.md` and `main.ts`
lines 1550–1565.

### The open design question

**Should cutting decorative vegetation in the mowable lawn affect the score or any secondary
metric — or should it stay purely cosmetic?**

Three options:

---

**Option D1 — Keep decorative-only (current behaviour)**

Flowers, clover, and dandelions collapse visually when the mower passes but count for nothing.
The player may not even notice they mowed a dandelion.

*Pros:* Simple scoring model (grass % only); no design work needed; all existing scoring
formulas stay untouched; no gameplay balance re-tuning.

*Cons:* The richest visual events in the game (dandelion seed pop, flower collapse, clover mat
disappearing) have zero mechanical weight. A player completing the level notices the flowers
are gone but the score ignores it entirely. The visual feedback is orphaned from the loop.

---

**Option D2 — Add a secondary "tidiness" score for decorative vegetation**

Introduce a second score axis (e.g., "garden score" or "tidiness %") that tracks how many
decorative instances in the mowable zone have been cut. Display it separately — or fold it
into the star thresholds as a bonus that can push a 2-star run to 3 stars.

*Pros:* Rewards thorough mowing; gives the dandelion/flower animations mechanical meaning;
creates a clearer skill ceiling (100% grass AND full tidiness = perfection).

*Cons:* Two score axes are harder to communicate to the player; requires HUD design work;
the existing `grassPoints + timePoints − mistakePenalty` formula needs a fourth term; balance
needs re-tuning across all levels. The bake pipeline would need stable per-instance IDs to
track which instances were mowed (currently non-deterministic — see `docs/BACKLOG.md §A2`).

---

**Option D3 — Count decorative vegetation toward the existing grass completion %**

Treat clover leaves, flowers, and dandelions as additional "grass" for scoring purposes.
Each mowed decorative instance advances the same `mowedCount / totalCount` fraction.

*Pros:* Single score axis preserved; no HUD redesign; gives vegetation mowing mechanical
weight without new UI.

*Cons:* The grass % would now include items the player doesn't naturally think of as grass
(a mowed flower advances "lawn done %"). Clover patches thin grass and restore blade count
elsewhere (by design — see `grass.ts:469–472`), so mixing the two populations distorts the
completion denominator. The mow score would become harder to predict and explain. Requires
per-instance stable IDs across loads for decorative types (same BACKLOG §A2 dependency).

---

**Interaction with the tulip mismatch**

Tulips are the sharpest variant: they sit in non-mowable (`role: "bed"`) areas, the mower
reaches them, and hitting one is a *mistake*. That behaviour is intentional and unlikely to
change. Any option above that adds a positive score for decorative mowing should explicitly
carve out tulips (and any future `bed`-area obstacles) so they remain penalty-only.

**Decision is T's — do not implement any of the above options without explicit direction.**

---

*Analysis generated 2026-06-25. No runtime behavior was modified.*
