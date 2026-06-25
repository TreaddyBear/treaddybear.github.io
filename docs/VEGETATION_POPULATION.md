# Vegetation Population Design

This document records the design decisions behind how vegetation is distributed across
authored areas: how `edgeFalloff` shapes a per-point strength field, how density maps to
instance counts, and the planned transition from runtime random sampling to bake-time
deterministic placement. The sections marked **[PROPOSED]** describe directions not yet
implemented; sections without that tag describe the current code.

Related: `src/runtimeMap.ts`, `src/utils/shapes.ts`, `src/fieldFlowers.ts`,
`src/cloverPatch.ts`, `src/grass.ts`.

---

## 1. Falloff semantics

### Orientation: the area's own contribution starts at zero at the boundary

`areaFade()` (`runtimeMap.ts:243`) computes a [0, 1] strength multiplier for every point
inside an area:

```
fade = smoothstep01(signedDistanceToShapeEdge(shape, x, z) / edgeFalloff)
```

`signedDistanceToShapeEdge` returns the distance in metres to the nearest boundary point,
**positive inside, negative outside**. So `fade` is:

| Location | fade |
|---|---|
| On the shape boundary | 0.0 — area's own vegetation is absent; parent is at full strength |
| `edgeFalloff` metres inside the boundary | 1.0 — area's own vegetation is at full strength |
| Deeper than `edgeFalloff` metres inside | 1.0 (clamped; interior at full strength) |
| Outside the shape | 0 (child not entered; parent controls) |

The area's own contribution **starts weak at the boundary and grows inward**. For a replace
area, this means: at the shape edge, the parent's vegetation is fully present; `edgeFalloff`
metres into the interior, the child's vegetation has fully replaced it.

`smoothstep01(t)` is the cubic Hermite S-curve `t²(3 - 2t)`, clamped to [0, 1]. It has
zero slope at both ends. A point that is `edgeFalloff/2` metres inside the boundary has
strength `smoothstep01(0.5) = 0.5`, not 0.5 linearly.

### Large-falloff behavior

A `falloff` value larger than the shape's inradius means no interior point reaches
`fade = 1`. The centre of a 1 × 1 m square is 0.5 m from the nearest edge. With
`edgeFalloff = 10 m`:

```
fade = smoothstep01(0.5 / 10) = smoothstep01(0.05)
     = 0.05² × (3 − 2 × 0.05)
     ≈ 0.007  (0.7 %)
```

The linear approximation (0.5 / 10 = 5%) does not apply because the curve is smoothstep,
not linear. For reference, a few smoothstep values near zero:

| t (dist/falloff) | smoothstep strength |
|---|---|
| 0.05 (centre of 1×1m at 10m falloff) | 0.7 % |
| 0.10 | 2.8 % |
| 0.20 | 10.4 % |
| 0.30 | 21.6 % |
| 0.50 | 50 % |

A large-falloff area still works as intended: the whole interior is populated at a low
density. Moderate values (covering the interior at 10 %–50 %) require a falloff of roughly
0.3×–0.5× the shape inradius.

### No magnitude validation for vegetation falloff

A vegetation-area `edgeFalloff` larger than the shape is not an error. It is a deliberate
design tool: a large falloff produces a gentle, wide gradient that populates the whole
interior at low strength. This is distinct from terrain-height falloff (see
`docs/OPEN_QUESTIONS.md §2`), where a falloff larger than the shape's inradius silently
prevents the hill from reaching its specified peak height — a surprising outcome on a
numeric axis. For vegetation, the density simply tapers across the whole area, which is
often the desired effect (e.g., a flower scatter that is denser in the centre and fades
to nothing at the edge, with a very wide falloff).

The validator accordingly checks `edgeFalloff >= 0` but does not enforce any relationship
between `edgeFalloff` and the shape's inradius.

---

## 2. Nearest-boundary distance: exact SDF for all simple polygons

`signedDistanceToShapeEdge` for polygons (`utils/shapes.ts:146`) computes:

```ts
let distance = Infinity;
for each edge (ax,az)→(bx,bz):
  distance = min(distance, distanceToSegment(x, z, ax, az, bx, bz));
return containsPoint(shape, x, z) ? distance : -distance;
```

`distanceToSegment` (`utils/geometry.ts:4`) clamps the closest-point parameter `t` to
[0, 1], so it finds the exact nearest point on a *finite* segment, not the infinite line.
`min()` over all edge segments gives the exact distance to the nearest point on the
polygon boundary.

**This is exact for all simple (non-self-intersecting) polygons, including concave ones.**
The boundary of a simple polygon is precisely its edge segments; the nearest boundary point
is always on one of those segments (or at a vertex shared by two segments, where both
give the same distance). There is no approximation — not for convex shapes, not for
concave shapes, not for sharp angles.

**The medial axis.** The SDF *value* is exact everywhere. The SDF *gradient* is
discontinuous along the medial axis (the set of interior points equidistant from two or more
boundaries). On both sides of the axis the distance value is correct; only the direction of
the gradient "switches" at the axis. For a square, the medial axis is the two diagonals.
For an L-shaped polygon it is more complex. This gradient crease is invisible to
vegetation placement (which only samples the value, not the gradient) and is barely
perceptible visually even if you were to plot the falloff field, because the value
transitions continuously across the axis.

**Concave polygons and sharp interior angles.** Near a concave reflex vertex (an inward
notch), the nearest boundary is one of the edges adjacent to that vertex. The falloff
there will be tighter than in the open interior — the falloff band compresses toward the
notch. This is the geometrically correct behavior: a point in the notch IS close to two
boundaries. It is not an approximation error.

---

## 3. Density mapping: current code vs. proposed design

### What the code currently does

`distributionAmount()` in `runtimeMap.ts:364` returns density as a raw multiplier:

```
output = max(0, authored_density) × perlin_mask
```

For uniform distributions: `output = authored_density` (no remapping).

This output — call it `D(x, z)` — flows through the falloff:

```
effective = D(x, z) × fade(x, z)        (for additive: added to parent)
effective = lerp(parent, D(x, z), fade)  (for replace: blends with parent)
```

**Flower placement** (`fieldFlowers.ts`): two factors drive instance count.

1. **Grid spacing** (baked at normalize/bake time):
   `spacing = 0.5 / sqrt(authored_density)`, minimum 0.18 m.
   Candidates per m² = (1 / spacing)² = 4 × authored_density.

2. **Acceptance rate** (evaluated at runtime per-candidate, per-point):
   `keep_rate = min(1, foliageDensityAt(x, z))` = min(1, effective density including falloff and Perlin).

Combined instances per m² in the uniform interior:

| authored density | candidates / m² | acceptance | instances / m² | ratio vs. density=1 |
|---|---|---|---|---|
| 0.25 | 1 | 0.25 | 0.25 | 6.25 % |
| 0.50 | 2 | 0.50 | 1 | 25 % |
| 1.00 | 4 | 1.00 | 4 | 100 % (baseline) |
| 2.00 | 8 | 1.00 (clamped) | 8 | 200 % |
| 4.00 | 16 | 1.00 (clamped) | 16 | 400 % |

For `density < 1`, instances scale as `density²` (quadratic): both the grid and the
acceptance rate reduce together. For `density > 1`, instances scale as `density` (linear):
only the grid densifies (acceptance is clamped to 1). This creates a kink in the
density-to-instances curve at density = 1.

**Grass blade placement** (`grass.ts`): uses a fixed global budget (`bladeCount`), placed
via `randomMowablePoint()` with a per-candidate rejection gate:

```ts
Math.random() < min(1, foliageDensityAt(..., "grass", ...) × (0.5 + 0.5 × openFieldEdge))
```

Blades that fail the gate retry up to 90 times in new random positions. The total count
stays constant; low-density areas get fewer blades because candidates there keep failing
and being relocated to high-density areas. Density effectively weights the spatial
distribution of the fixed budget, not the total count.

**Clover** (`cloverPatch.ts`): uses hardcoded global rates (SMALL_PER_SQM = 32,
LARGE_PER_SQM = 6), not the authored density. Acceptance scales with `cloverAmountAt ^
1.35`. The authored density enters only through `foliageDensityAt("clover", ...)` inside
`cloverAmountAt`, which adds a supplemental contribution on top of the legacy shape-based
amount.

### [PROPOSED] — Density remapping to a [0, 2] headroom scale

The proposed design maps authored density so that `density = 1.0` (the "tuned target")
reads as 0.5 in the value field, leaving headroom up to 2.0 for lusher areas. In the
value-field + blue-noise pipeline (see section 5), this means:

```
value(x, z) = min(2, authored_density) × fade(x, z) × perlin_mask(x, z) / 2
           ∈ [0, 1]
```

`density = 1.0` → value peaks at 0.5; `density = 2.0` → value peaks at 1.0.

This resolves the density² artifact: the greedy sampler places instances until the value
field is locally depleted. With a linear scale, halving the density halves the instance
count, not quarters it.

**This remapping is not currently implemented.** The current code treats `density = 1.0`
as the maximum acceptance rate (100%), not as 50% headroom.

---

## 4. Population algorithm: current implementation

### Flowers (fieldFlowers.ts)

1. For each flower field (from `flowerFields` in the baked artifact): iterate a regular
   grid with spacing from `densityToSpacing(authored_density)` and ±34% jitter per cell.
2. For each candidate position: call `foliageDensityAt(map, type, x, z)` and reject with
   probability `1 - min(1, density)`.
3. Additional clumping: a secondary low-frequency noise gates another fraction, creating
   organic groupings with gaps between.

**Currently non-deterministic**: `Math.random()` is used for jitter and rejection with no
seed. Positions change on every call to `place()` and do not survive a reload.

### Clover (cloverPatch.ts)

A two-tier grid (small leaves, large leaves) with fixed per-m² rates and ±85% jitter.
Acceptance scales with `cloverAmountAt ^ 1.35`. Also non-deterministic.

### Grass (grass.ts)

`bladeCount` blades placed via weighted-random mowable-area sampling (area-proportional
across mowable zones). Per-candidate rejection based on grass density at the candidate
point. Fixed total count; density shapes the spatial distribution. Also non-deterministic.

---

## 5. Methods comparison: population algorithm options

Five strategies for distributing instances across a density field, with honest tradeoffs.
Method 3 is implemented in `tools/vegetation-sampler.ts` and is the recommended path.

---

### Method 1 — N independent stipple passes (naive)

Run a separate placement pass for each vegetation type, treating each type's density layer
as if the others do not exist.

**How it works**: for each type, iterate a grid or random set of candidates; accept a
candidate with probability proportional to `d_i(x,z)`.

**Flaws for multi-layer scenes**:

1. **Collisions.** A blue flower and a red flower can occupy the same position, or be
   placed so close together they visually overlap. Each pass is blind to the others.

2. **Double-counted space.** Where two types have high density, both see the full grid of
   candidates. Their combined instance count is the sum of the two independent counts
   rather than the combined count that the total density T = d₁ + d₂ would naturally
   produce. The result is artificially crowded where layers overlap.

3. **Order-dependence.** If blue is placed before red, and the grid uses jitter, blue
   might claim positions that would otherwise go to red. The output changes if you swap
   the processing order.

4. **Non-deterministic from ordering.** Stable positions require locking the per-type
   seed. If you add a new type, all other types' seeds must shift to keep existing saves
   valid.

**Verdict**: Works for a single type in isolation. Breaks in multi-layer scenes.

---

### Method 2 — Unified blue-noise + per-point categorical draw

Sum all layers at each point into a single total density field T(x,z) = Σᵢ dᵢ(x,z).
Generate one blue-noise point set using T to control local spacing. For each placed point
p, draw its type from the categorical distribution P(type=i | p) = dᵢ(p) / T(p).

**Properties**:
- **No collisions**: one point set, one type per point — two instances can never occupy the
  same position.
- **Expected count of type i** ∝ ∫ dᵢ(x,z) dx dz — types compete fairly for space.
- **Natural competition**: where blue and red overlap, points are split proportionally. Where
  only blue exists, every point is blue.
- **Deterministic and bakeable**: same seed → same point positions and same type draws.
- **Blue-noise quality**: local spacing ∝ 1/√T means dense regions are tighter, sparse
  regions more open — always as uniform as the density allows.

**Remaining issue**: fine (dense, small) types and coarse (sparse, large) types share the
same point set. The spacing is driven by whichever type has the highest local T. A clover
patch (dense) inside a flower bed (sparse) forces the sampler to use fine spacing in the
overlap, generating many close flower candidates that still compete for the coarser flower
slots. The blue-noise quality for the coarse tier degrades.

**Verdict**: Correct. Works well when all types are at the same visual scale. Degrades for
mixed-scale scenes.

---

### Method 3 — Tiered unified-categorical ⟵ RECOMMENDED

Group vegetation types into **scale tiers** (e.g., 2–3 groups by feature size), run
Method 2 independently within each tier, and composite the tiers by subtracting the
coarser tier's footprints from the finer tier's density field before sampling.

**Tiers used in this project**:

| Tier | Types | Min spacing |
|---|---|---|
| Flower (coarse) | flowerBlue, flowerWhite, flowerYellow, flowerRed, tulip | 0.45 m |
| Ground cover (fine) | clover, dandelion | 0.30 m |
| Grass | managed by blade system (fixed budget) | N/A |

**Algorithm**:
1. Sample the **flower tier** first. Collect all placed positions.
2. Add flower positions as "pre-occupied" exclusion points when sampling the **ground
   cover tier**. Ground cover candidates within 0.30 m of any flower are rejected.
3. Each tier produces a typed instance list. Concatenate into the final output.

**Properties**:
- Inherits all benefits of Method 2 within each tier.
- Flowers and ground cover are never collocated within the finer tier's minimum spacing.
- The flower tier's blue-noise quality is not distorted by clover density: they live in
  separate point sets.
- Visual scale separation matches biological intuition — clover doesn't grow right at the
  base of a flower stem.
- Still deterministic and bakeable.

**Trade-off**: slightly more complex to implement; the tier boundaries (what goes in which
tier) are an authoring choice that must be documented.

**Verdict**: Best overall quality for a multi-scale scene. Implemented.

---

### Method 4 — Blue-noise-mask / dithered importance sampling

Precompute a fixed Halton, Sobol, or blue-noise tile of points over the unit square.
Scale and tile it to cover the area. For each point in the tile, keep it if
`random() < d_i(x,z) / d_max` (importance sampling), discard otherwise. Repeat per type.

**Pros**: essentially O(1) setup (no active-list iteration); predictable point count;
easy to implement.

**Cons**:
- The tile is uniform — the blue-noise quality is constant regardless of density. Dense
  regions get the same inter-point distances as sparse regions instead of adapting.
- Per-type: inherits the collision and double-counting problems of Method 1 unless a
  unified categorical draw is added, at which point you recover Method 2 but with a
  non-adaptive point set.
- Tiling artifacts can appear if the tile period doesn't match the authored feature scale.

**Verdict**: Fast and simple for homogeneous density fields. Suboptimal quality for
large density variation or multi-scale scenes.

---

### Method 5 — Adaptive Poisson-disk (Bridson, variable radius)

This is the **position generator** used inside Methods 2 and 3 — it is not a separate
placement strategy but a component.

**Algorithm** (Bridson 2007, extended to variable radius):
1. Choose a global minimum radius `r_min` (the minimum possible spacing).
2. Build a background grid with cell size `r_min / √2`.
3. Start with one seed point. Add it to an "active" list.
4. While active list non-empty:
   - Pick a random active point `p`.
   - Try `k=30` random candidates in the annulus `[r(p), 2r(p)]` around `p`,
     where `r(p) = min_spacing / √T(p)` is the local target radius.
   - Accept a candidate `q` if no accepted point is within `r(q)` of `q` (checked via grid).
   - If no valid candidate found after k tries, remove `p` from active list.
5. Return all accepted points.

**Complexity**: O(n) time and space, where n is the number of placed points.

**Properties**: provably no two accepted points are within their respective target radius
of each other; guarantees maximal packing relative to the density field.

**Trade-offs vs. greedy dart throwing**: Bridson is faster (O(n) vs. O(n²) for dart
throwing). Greedy dart throwing starts from the highest-density points, which can produce
marginally better initial coverage but is slower. For bake-time (not real-time), both are
acceptable; Bridson was chosen for its O(n) guarantee.

---

## 6. [PROPOSED] — Bake-time precompute and stable identity

### Motivation

This is a mowing game. Every blade is individually stateful (standing vs. cut). That state
must be saveable and restorable: after a reload, blade N should be at the same position as
it was before the reload, so save data referencing index N remains valid. The current
runtime random sampling gives every session a different arrangement.

The fix is to bake instance positions into the artifact at `pnpm bake` time using a
deterministic seed, then store stable per-instance indices in save data.

### [PROPOSED] — Value-field + greedy blue-noise sampler

1. **Build a per-pixel value buffer** over the area bounding box at some texel density
   (e.g., 4–8 px/m). Each texel:
   ```
   value(x, z) = remap(authored_density) × edgeFalloff_fade(x, z) × perlin_mask(x, z)
   ```
   where `remap` is the [0, 2] → [0, 1] mapping from section 3.

2. **Greedy blue-noise placement**: repeatedly find the current-maximum-value texel, emit
   one instance at that position (plus a small random jitter, seeded deterministically),
   then subtract a kernel (a Gaussian or tent falloff) centered on the new instance from
   the value buffer. Repeat until the maximum value falls below a threshold.

   This is a greedy variant of Void-and-Cluster / weighted Voronoi stippling: it
   approximately maximizes the minimum distance between instances in high-value regions
   (blue noise character) while respecting the value field (density) natively. No separate
   rejection sampling step is needed.

3. **Stable indices**: the output is an ordered list of `[x, z, type, instanceIndex]`
   records written into the baked artifact. Game systems use `instanceIndex` as a stable
   identifier in save data.

4. **The value buffer is a debug artifact**: the baker should optionally emit the value
   buffer as a PNG (or as raw data) for visual inspection during authoring.

### [PROPOSED] — Alternative: density field + fast O(n) sampler at load time

If baking per-instance positions is too large (e.g., a level with 50k flowers), an
alternative is:

- Baker emits the density field parameters (authored density + Perlin octaves + falloff)
  and a fixed integer seed per area.
- At engine load time, run a fast Bridson Poisson-disk sampler with density-varying radius
  (radius ∝ 1/√D(x,z)) using the fixed seed. O(n) time, produces stable positions for
  a given seed.
- Positions are stable across reloads as long as the authored data and seed don't change.

**Tradeoff**: save data still references the order in which Poisson-disk enumerated
instances (deterministic for a given seed), but any change to the authored data or seed
invalidates existing save data. The greedy-blue-noise approach written into the artifact
has the same invalidation risk but exposes the output explicitly so it can be reviewed.

### Recommendation

Greedy blue-noise baked into the artifact is the cleaner path for a save-compatible
mowing game. The artifact size increase is manageable: 50 k flowers at 8 bytes each
(x, z as float32) is 400 KB — well within reasonable JSON limits. The density-field
alternative is a valid fallback if artifact size becomes a concern.

**Decision still T's.** Neither approach is implemented; both are described here to
frame the tradeoff before implementation begins.

---

*Written 2026-06-25; methods section added 2026-06-25. Sections marked [PROPOSED] are
design directions, not implemented code. Section 5 (tiered unified-categorical) is
implemented in `tools/vegetation-sampler.ts`. Verify current runtime behavior against
`src/runtimeMap.ts`, `src/fieldFlowers.ts`, `src/cloverPatch.ts`, and `src/grass.ts`
before rewiring engine consumers.*
