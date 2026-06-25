# Parametric Vegetation Editor — Design Spec

**Status: PROPOSED — nothing here is built yet.**

This document specifies a proposed in-engine tool for authoring scattered procedural
vegetation (flowers, clover, dandelions, etc.). It is a companion to the bake pipeline
described in `docs/VEGETATION_POPULATION.md`.

---

## 1. Core Principle: Edit Parameters, Not Meshes

The central insight is that **scattered foliage is inherently procedural and population-based**.
No individual flower is artistically important — what matters is the *distribution*: what a
patch of 300 blue flowers looks like together, with all their natural variation intact.

This drives the design choice:

> **The editor edits ranges, not geometry. Every tunable property is a `[min, max]` range (or
> a probability distribution) that is sampled independently per instance, from a per-instance
> seed derived from position. The same generator code runs in both the editor preview and the
> shipping game — what you see in the editor is exactly what ships.**

This is the key refactor: today `fieldFlowers.ts`, `cloverPatch.ts`, and `dandelions.ts` use
inline `Math.random()` calls scattered through their placement functions. The goal is to
extract those calls into a **params object** — a typed record of ranges — so a single
`generateFlower(params, seed)` function can be called from both the editor UI and the runtime
`place()` path.

### Why Not Blender?

Blender is the right tool for **static hero props**: the mower body, a specific rock, a fence
post. For **scattered procedural foliage** it has two problems:

1. **It loses per-instance variation.** A flower modelled in Blender is one fixed mesh. To get
   variation across 500 instances you'd need hundreds of meshes, manual UV work, and a way
   to author the exact distribution in Blender's scatter tools — then export and re-import,
   losing the live preview.
2. **It breaks the live-preview loop.** Any parameter change requires an export, re-import,
   and re-bake cycle.

Blender cannot close the loop between parameter and rendered result for procedural populations.

### Why Not a From-Scratch Mesh Editor?

Building a polygon editor inside the game would be reinventing Blender at a fraction of the
quality, for no benefit. The game's vegetation is already fully procedural; what is missing is
**authoring control over the procedural parameters**.

### Recommended Hybrid

| Content type | Tool |
|---|---|
| Static hero props (mower, rocks, fence) | Blender → import |
| Scattered procedural foliage (flowers, clover, grass) | This editor |
| Terrain shape | Map JSON (`heightFeatures`) |
| Vegetation placement / density | Map JSON areas + bake pipeline |

---

## 2. Parameter Model

Every visual property of a procedural plant is described by a **range** `[min, max]`. At
placement time, each instance receives an independent sample from that range, seeded by a
deterministic hash of its (x, z) position and an index. This gives stable, repeatable results
across loads while preserving full per-instance variation.

### 2a. Range types

```ts
type RangeF  = { min: number; max: number };          // continuous float
type RangeI  = { minInt: number; maxInt: number };     // integer (petal count, etc.)
type Color3  = { r: number; g: number; b: number };
type Gradient = { root: Color3; tip: Color3 };         // per-petal gradient (frag shader)
```

### 2b. Concrete starting set — field flower (a "species" definition)

```ts
type FlowerSpeciesParams = {
  // Petal structure
  petalCount:        RangeI;   // [min, max] total petals per flower
  uprightCount:      RangeI;   // how many of those petals stand upright
  splayedCount:      RangeI;   // remaining petals that splay outward at the base

  // Petal shape
  petalLength:       RangeF;   // length of the petal mesh in world units
  petalWidth:        RangeF;   // base width at the widest point
  petalCupAmount:    RangeF;   // hyperbolic-paraboloid cup depth (saddle shape)
  petalCurlAmount:   RangeF;   // tip curl (Y droop toward tip)
  petalTaper:        RangeF;   // how pointed the tip is

  // Upright petals
  uprightTiltAngle:  RangeF;   // lean from vertical (radians) — 0 = fully upright
  uprightSpread:     RangeF;   // radial spread offset around the stem axis

  // Splayed petals
  splayAngle:        RangeF;   // angle from horizontal (0 = flat, π/2 = upright)
  splayRadialJitter: RangeF;   // angular jitter around the stem axis

  // Stem
  stemHeight:        RangeF;   // world units
  stemRadius:        RangeF;   // stem thickness

  // Centre disc
  centreRadius:      RangeF;   // world units

  // Per-flower scale
  scale:             RangeF;   // uniform scale multiplier per instance

  // Colour
  petalGradient:     Gradient; // fragment shader: root colour → tip colour
  rootCornerDark:    boolean;  // apply dark corner at base (see §3 worked example)
  rootCornerColor:   Color3;   // the dark corner tint if enabled
  centreColor:       Color3;
  stemColor:         Color3;

  // Randomness
  seed:              number;   // base seed for this species; combined with position hash
  randomnessAmount:  RangeF;   // 0 = all instances identical (min only); 1 = full range used
};
```

`randomnessAmount` is a convenience dial: at 0.0, every instance uses `min`; at 1.0, each
independently samples the full `[min, max]`. Intermediate values narrow the effective range
toward `min`, letting an author suppress variation per-axis without zeroing the range.

---

## 3. Worked Example — The White Flower

T's spec: *"triangle-shaped petals, mostly upright, ~10 petals each (range ~8–12),
~6 upright + ~4 angled outward at the base, a fragment-shader gradient with a dark-brown
bottom corner on each petal."*

### Mapping to the parameter model

```json
{
  "petalCount":       { "minInt": 8, "maxInt": 12 },
  "uprightCount":     { "minInt": 5, "maxInt": 7 },
  "splayedCount":     { "minInt": 3, "maxInt": 5 },

  "petalLength":      { "min": 0.055, "max": 0.075 },
  "petalWidth":       { "min": 0.018, "max": 0.028 },
  "petalCupAmount":   { "min": 0.05,  "max": 0.12  },
  "petalCurlAmount":  { "min": 0.08,  "max": 0.16  },
  "petalTaper":       { "min": 0.82,  "max": 0.94  },

  "uprightTiltAngle": { "min": 0.0,   "max": 0.25  },
  "uprightSpread":    { "min": 0.0,   "max": 0.22  },

  "splayAngle":       { "min": 0.28,  "max": 0.55  },
  "splayRadialJitter":{ "min": 0.0,   "max": 0.38  },

  "stemHeight":       { "min": 0.06,  "max": 0.10  },
  "stemRadius":       { "min": 0.005, "max": 0.008 },
  "centreRadius":     { "min": 0.012, "max": 0.018 },

  "scale":            { "min": 0.85,  "max": 1.15  },

  "petalGradient": {
    "root": { "r": 0.96, "g": 0.96, "b": 0.97 },
    "tip":  { "r": 1.00, "g": 1.00, "b": 1.00 }
  },
  "rootCornerDark":  true,
  "rootCornerColor": { "r": 0.22, "g": 0.14, "b": 0.08 },
  "centreColor":     { "r": 1.00, "g": 0.92, "b": 0.55 },
  "stemColor":       { "r": 0.38, "g": 0.56, "b": 0.22 },

  "seed": 7,
  "randomnessAmount": { "min": 1.0, "max": 1.0 }
}
```

### Petal fragment shader (sketch)

The "dark-brown bottom corner" is a UV-based darkening in the fragment shader. The petal mesh
has UV `(u, v)` where `u ∈ [0, 1]` is width (0 = left edge, 1 = right edge) and `v ∈ [0, 1]`
is length (0 = base, 1 = tip). The gradient goes root→tip along `v`; the dark corner adds a
spot at low `v`, low/high `u`:

```glsl
// vUv.x = petal-width UV, vUv.y = petal-length UV
vec3 gradient = mix(uRootColor, uTipColor, vUv.y);

// Dark corner: strongest at (corner_u, 0) — the two base corners
float cornerU  = min(vUv.x, 1.0 - vUv.x);   // 0 at edges, 0.5 at centre
float cornerV  = vUv.y;
float corner   = (1.0 - smoothstep(0.0, 0.18, cornerU))  // edge proximity
               * (1.0 - smoothstep(0.0, 0.30, cornerV));  // base proximity
vec3 color     = mix(gradient, uRootCornerColor, corner * 0.65);

gl_FragColor   = vec4(color, 1.0);
```

The `0.65` is the mix strength of the corner tint — a slider in the editor.

---

## 4. UI Sketch

The editor is an additional panel/route in the existing dev scene (dev-mode only, gated by
`import.meta.env.DEV`). No separate build step required.

```
┌─────────────────────────────────────────────────────────────────┐
│  SPECIES: White Flower                          [Save] [Export] │
├──────────────────────┬──────────────────────────────────────────┤
│  PARAMETERS          │                                          │
│  ─────────────────── │   LIVE PREVIEW  (Babylon scene)         │
│  Petal count         │                                          │
│    min [──●───] 8    │   [  seed scrubber: ◄ 1 2 3 4 5 6 7 ► ] │
│    max [────●─] 12   │                                          │
│                      │   Single instance:                       │
│  Upright count       │     [big 3D flower, lit by game sun]     │
│    min [─●────] 5    │                                          │
│    max [───●──] 7    │                                          │
│                      │                                          │
│  Petal length        │                                          │
│    min [──●───] 0.055│                                          │
│    max [────●─] 0.075│                                          │
│                      │                                          │
│  Splay angle         │                                          │
│    min [●─────] 0.28 │                                          │
│    max [──●───] 0.55 │                                          │
│                      ├──────────────────────────────────────────┤
│  ─ Colour ─────────  │  VARIANT GALLERY  (N seeds, same params) │
│  Petal gradient      │                                          │
│    root [■■■]        │  🌸 🌸 🌸 🌸 🌸 🌸 🌸 🌸 🌸 🌸 🌸 🌸  │
│    tip  [□□□]        │  (12 instances, lighting + shader on)   │
│  Root corner         │                                          │
│    [■ enable]        │                                          │
│    color [■■■]       │                                          │
│    strength [─●──]   │                                          │
└──────────────────────┴──────────────────────────────────────────┘
```

Key elements:

- **Live 3D preview** — the actual Babylon scene with game sun, SSAO, and PBR shaders. One
  flower at 1:1 scale. Not a thumbnail — you are looking at the shipped material.
- **Variant gallery** — renders 12–20 instances simultaneously, each with a different seed
  but the same params. This is the critical view: you tune the *distribution*, not one lucky
  instance. If the gallery shows even one ugly outlier, tighten the range.
- **Seed scrubber** — step through individual seeds in the single-instance view to inspect
  any specific instance.
- **Min/max sliders** per param — the range defines what any instance can be; both ends are
  tunable. Sliders are labelled in meaningful units (world metres, degrees converted from
  radians, integer counts).
- **Export** — writes the current params as JSON to the clipboard or a named species file.
  Import reads it back. These files are the species definitions consumed by the bake pipeline.

---

## 5. Architecture and Integration

### 5a. The required refactor

The editor requires extracting the procedural placement logic from each renderer into a pure
`generate*(params, seed)` function. Currently the generators are entangled with `Math.random()`
and instance buffers. The split is:

```
fieldFlowers.ts
  createFieldFlowers()
    ├── place()            ← calls generateFlower() N times
    └── generateFlower(params: FlowerSpeciesParams, seed: number)
              ↑
              same function called from the editor UI's preview render
```

The editor lives in a new file (`src/editor/vegetationEditor.ts`, dev-only). It instantiates a
small Babylon scene (reusing the existing `scene` in dev mode, or a dedicated off-screen one),
calls `generateFlower(currentParams, scrubberSeed)` and attaches the result to a preview mesh.

No changes to the shipped game path — the editor module is tree-shaken in production.

### 5b. Babylon scene reuse

In dev mode the editor can open as an overlay on the live game scene. The preview flower is
added as a separate `TransformNode` at a fixed world position (e.g., `x=0, z=0`) with the
camera locked to frame it. The game world (grass, terrain, HUD) is hidden while the editor is
open; restoring it means removing the preview node and re-enabling the hidden nodes.

Alternatively, a dedicated `EditorScene` (off-screen `EngineView`) isolates the preview from
the game scene at the cost of a second GPU context.

### 5c. Output format — species definition JSON

The editor's output is a species definition file, stored alongside the map format:

```json
// map-exports/species/white-flower.json
{
  "speciesId": "white-flower",
  "generator": "fieldFlower",
  "params": { ...FlowerSpeciesParams... }
}
```

The bake pipeline (`tools/vegetation-sampler.ts`) accepts a species definition in place of the
current hardcoded flower variants. During bake, the pipeline samples positions via Poisson disc
as today, then for each position calls `generateFlower(params, positionHash(x, z))` to write
deterministic per-instance visual properties into `bakedInstances`. This closes the bake-path
non-determinism described in `docs/BACKLOG.md §A2`.

At runtime, `fieldFlowers.ts` reads the per-instance properties from `bakedInstances` (position
+ visual props), so a single baked artifact reproduces the editor preview exactly.

### 5d. Affected source files

| File | Change needed |
|---|---|
| `src/fieldFlowers.ts` | Extract `generateFlower(params, seed)` out of `place()` |
| `src/cloverPatch.ts` | Extract `generateCloverLeaf(params, seed)` |
| `src/dandelions.ts` | Extract `generateDandelion(params, seed)` |
| `src/editor/vegetationEditor.ts` | New (dev-only) |
| `tools/vegetation-sampler.ts` | Accept species JSON; write visual props to `bakedInstances` |
| `map-exports/species/*.json` | New species definition files per flower type |

---

## 6. Phasing

### Phase 1 — single flower, single preview, sliders

Goal: prove the live-preview loop works. Scope:
- Refactor `fieldFlowers.ts` to accept a params object.
- Build the editor panel (sliders + live single-instance preview).
- Export params as JSON; hardcode one species (white flower).
- No bake integration yet — editor is dev-only inspection.

Deliverable: a dev panel where you can tune the white flower and see it live.

### Phase 2 — variant gallery, more types, bake integration

Goal: make the editor the authoritative source of species definitions. Scope:
- Variant gallery (N seeds rendered at once).
- Species definition files + bake pipeline reads them.
- Additional types: blue/yellow/red flower, clover leaf, dandelion.
- Seed scrubber in single-instance view.
- Baked visual props in `bakedInstances` (closes BACKLOG A2 non-determinism).

Deliverable: `pnpm bake` reads species JSON, `bakedInstances` includes visual props, editor
preview and game are pixel-identical for a given species+position.

---

*Written 2026-06-25. PROPOSED — nothing is built. References code as of commit `66d4ab0`.*
