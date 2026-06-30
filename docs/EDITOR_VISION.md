# LaMow Editor — Scope & Vision

**Status: PROPOSED. Nothing in this document is built. Cross-references to**
**`docs/VEGETATION_EDITOR.md` describe design work in progress; the mower section**
**is early concept only.**

---

## 1. Name

The tool is **LaMow Editor**, not "LaMow Map Editor."

The "Map Editor" framing made sense when the only authoring surface was the map JSON. The
scope has grown: the same tool will author vegetation species, mower configurations, and any
future definition type. Calling it the "Map Editor" would misrepresent what it does and make
the product name a liability the moment a second definition type ships.

**Where "map editor" currently appears in the codebase** (nothing to change yet — for
awareness when renaming):

| File | Line | Current text |
|---|---|---|
| `MAP_FORMAT_V1_DRAFT.md` | 6 | `"the current map editor format is a prototype"` |

No UI-visible string currently reads "LaMow Map Editor" — the phrase is doc-only and
informal. When the editor ships as a tool with a visible title bar or landing page, use
**LaMow Editor** there from day one.

**Rename task:** a 5-minute at-the-machine cleanup. When building the editor UI (Phase 1),
ensure any window title, `<title>` tag, or menu heading reads "LaMow Editor," not "LaMow Map
Editor." Also update `MAP_FORMAT_V1_DRAFT.md:6` to say "the current authored map format"
(removing the "editor" framing from the spec language). See `docs/BACKLOG.md §6` for the
home-task entry.

---

## 2. Unifying Concept: Definition Editor with WYSIWYG Preview

> **The LaMow Editor is a definition editor with a WYSIWYG preview.**
> It edits *definitions* — not raw geometry, not pixel art, not a scene graph — and previews
> them fully rendered using the real engine, so what the author sees is exactly what ships.

Every authoring surface in the LaMow Editor follows the same loop:

```
Edit definition → Validate → Bake (if needed) → Preview with real engine shaders → Ship
```

This loop is already partially built for maps:
- Author: `map-exports/lawn-maps.json` (the definition)
- Validate: `src/mapValidator.ts`
- Bake: `pnpm bake` → `lawn-maps.baked.json`
- Preview: `pnpm viz` (headless density maps) or the live game

The editor extends the same pipeline to other definition types without reinventing the loop.

### Asset storage decision

The editor's non-map assets are project-global by default. Vegetation species, mower parts,
imported meshes, procedural assembly rules, and shared material definitions should live in
project asset folders and work across all maps. Map files should reference those assets by
stable IDs; they should not embed flower-shape definitions, imported mesh data, or other
global asset contents.

Pack-local/custom assets are a reasonable later extension, but not the current target. The
first implementation should solve the common project-global case cleanly before adding
per-pack asset overrides.

### Definition types

| Type | Definition source | Bake step | Preview |
|---|---|---|---|
| **Maps** | `lawn-maps.json` (existing) | `pnpm bake` | `pnpm viz` + in-game |
| **Vegetation species** | `assets/species/*.json` (proposed) | bake writes per-instance props to `bakedInstances` | in-editor Babylon scene — see `docs/VEGETATION_EDITOR.md` |
| **Mowers** | `assets/mowers/*.json` (proposed) | none — real-time assembly | in-editor Babylon scene — see §3 below |
| **Structural objects** (fences, roads, props) | path data in `lawn-maps.json` (existing) + module mesh refs (proposed extension) | none — real-time assembly of imported modules | in-editor Babylon scene — see §4 below |

All types share the same validate → preview contract. The editor renders a different panel per
type but the same real-engine scene.

---

## 3. Mower Designer (PROPOSED — not built)

### Concept: Mr. Potato Head

A mower is not a fixed mesh. It is a **base form** with named **attachment sockets**
(hardpoints) that accept interchangeable **parts**. The player or level designer assembles a
mower by filling sockets with parts. A socket can be empty (the base shows through) or filled
(the part replaces or decorates that spot).

This gives:
- Unlimited combinations from a small library of parts
- A natural UX: click a socket → browse parts that fit that socket category → select → see it
  live in the preview
- A clear extension path: new parts drop in without touching the base mesh or the socket
  system

### Data shape (sketch)

```ts
type SocketCategory = "eye" | "arm" | "topper" | "side-decal" | "wheel" | string;

type Socket = {
  name:     string;          // e.g. "left-eye", "right-arm", "roof-topper"
  category: SocketCategory;  // which part categories fit here
  transform: {               // local-space offset from the base mesh origin
    position: [x: number, y: number, z: number];
    rotation: [x: number, y: number, z: number]; // Euler, radians
    scale:    [x: number, y: number, z: number];
  };
};

type DecalSlot = {
  name:     string;          // e.g. "left-body-sticker"
  uvRegion: [u0: number, v0: number, u1: number, v1: number]; // UV space on base mesh
  category: string;          // e.g. "sticker"
};

type MowerDefinition = {
  mowerId:   string;
  baseMesh:  string;         // path to the base mesh asset
  sockets:   Socket[];
  decalSlots: DecalSlot[];
};

type PartDefinition = {
  partId:       string;
  fitsCategory: SocketCategory; // must match a socket's category to be placeable there
  mesh:         string;         // path to the part mesh asset
  // optional: per-instance range params (same [min,max] idea from FlowerSpeciesParams)
  scaleRange?:  [min: number, max: number];
  colorRange?:  { hueShift: [min: number, max: number]; saturation: [min: number, max: number] };
};
```

**Stickers** are the special case: instead of a 3D mesh at a socket, a sticker is a decal
projected onto a UV region of the base mesh. The authoring UX is the same (browse → select →
preview), but the backing primitive is a `DecalSlot` rather than a `Socket`. The sticker
definition includes the image/texture asset and the UV region it occupies.

### Ranges in mower parts

The `[min, max]` range concept from the vegetation editor (`docs/VEGETATION_EDITOR.md §2`)
extends naturally here. A "bouncy spring arm" part could have:
```json
{ "scaleRange": [0.8, 1.2], "colorRange": { "hueShift": [-15, 15] } }
```
This means each mower using that part gets a slightly different scale and hue, so a field of
mowers using the same parts still looks varied. The same `generatePart(partDef, seed)` pattern
from the vegetation editor applies — the seed is derived from the mower's instance ID.

### Editor preview

The mower designer panel shows a real Babylon scene with:
- The assembled mower in 3D, orbitable camera
- Click any socket → it highlights; a drawer shows compatible parts
- Select a part → it snaps into the socket live (no reload)
- Sticker slots show their UV region as a highlight on the mesh surface; select a sticker →
  it projects live

The same `generate()` + deterministic seed approach means saving a `MowerDefinition` +
`PartDefinition` set reproduces the exact mower appearance across sessions, platforms, and
players — or, if `randomnessAmount > 0`, produces a stable-yet-varied population.

---

## 4. Structural Objects — Fences, Roads, Props (PROPOSED — not built)

### The mesh-import-vs-procedural answer: both, via layering

The editor never edits geometry. The mesh-import-vs-procedural question resolves by
recognising the two live at different layers:

- **Mesh importer (GLTF/GLB):** the shared primitive for bringing external assets in. A post
  mesh, a rail section, a road profile cross-section, a mailbox body — all authored in Blender,
  imported into the editor's asset library. The importer touches no vertex data; it only
  registers the asset as available for assembly.
- **Procedural assembly:** the editor layer that parameterises how imported pieces are combined.
  It never exposes raw geometry. It says: *"repeat the post mesh every `spacing` metres along
  this path, with height jitter ±`h` and yaw jitter ±`θ`."*

The division is clean:

> **Blender authors meshes. LaMow Editor imports + parameterises assembly + previews.**

This is the same principle as the mower designer (§3): the base mesh and part meshes come from
Blender; the editor authors the assembly rule. Structural objects extend it to path-following
repetition.

### Unifying model: imported part(s) + procedural rule + live preview

Every structural element is one instance of the same framework. Three cases:

---

**Fence** — a `PathShape` + an imported post/rail module repeated along it:

```ts
type FenceDefinition = {
  path:              PathShape;
  postMesh:          string;    // GLTF/GLB asset reference
  railMesh?:         string;
  spacingRange:      [min: number, max: number]; // metres between posts
  heightRange:       [min: number, max: number]; // post height variation
  postRotationJitter:[min: number, max: number]; // per-post yaw jitter, radians
};
```

`spacingRange` and `heightRange` sample independently per post from a position-derived seed,
giving an organic, non-uniform fence from a single imported post mesh.

---

**Road / dirt path** — a `PathShape` + an imported cross-section profile extruded along it:

```ts
type RoadDefinition = {
  path:         PathShape;
  profileMesh:  string;    // 2D cross-section GLTF, extruded by the engine along the path
  width:        number;
  edgeBlend:    number;    // metres of terrain-blend on each side of the road
  markings?:    { mesh: string; spacingRange: [min: number, max: number] };
};
```

---

**Static object** (mailbox, rock, street lamp, …) — the n=1 trivial case:

```ts
type ObjectPlacement = {
  mesh:       string;
  transform:  {
    position: [x: number, y: number, z: number];
    rotation: [x: number, y: number, z: number]; // Euler, radians
    scale:    [x: number, y: number, z: number];
  };
  sockets?:   Socket[];  // optional — reuses the mower socket system (§3) for attachables
};
```

A static object is not a separate concept. It is a fence with one element and no repetition —
a degenerate assembly rule: "place once." The `objects: unknown[]` field already exists in the
map schema (currently untyped); `ObjectPlacement` would be its concrete type.

### Tie-ins with the existing map format

Fences, roads, and dirtPaths are **already top-level `kind` items with `PathShape`** in
`MAP_FORMAT_V1_DRAFT.md` (lines 640–657):

```ts
type Fence    = AuthoredItem & { kind: "fence";    height: number; postSpacing?: number; shape: PathShape; };
type Road     = AuthoredItem & { kind: "road";     width: number;  shape: PathShape; };
type DirtPath = AuthoredItem & { kind: "dirtPath"; width: number;  shape: PathShape; };
```

The structural editor components are the **authoring UI for those existing path-kind items**,
extended with imported module references and range parameters. `PathShape` itself (`line |
polyline`, spec lines 363–370) is unchanged — the editor draws it interactively and previews
the assembled modules along it. The existing scalar `postSpacing` on `Fence` is the degenerate
form of `spacingRange: [n, n]` — the range version is a backwards-compatible proposed
extension.

### Ranges are the consistent thread

The `[min, max]` range idea now spans every content domain in the editor:

| Domain | Example range | Sampled per… |
|---|---|---|
| Vegetation (`docs/VEGETATION_EDITOR.md §2`) | petal count, stem height | per flower instance |
| Mower parts (§3) | part scale, hue shift | per mower |
| Structural objects (§4) | post spacing, height jitter | per structural element |

The same `sample(range, seed)` utility underlies all three. Authors tune a *distribution*; the
engine samples it deterministically per element. This uniformity means the same mental model
and the same range-slider UI component work across every editor panel.

### Per-asset editor windows, shared framework

Each structural type gets its own editor panel:

| Panel | Key authoring controls |
|---|---|
| **Fence** | polyline path editor; post/rail mesh picker; spacing range slider; height/rotation jitter sliders |
| **Road / dirt path** | polyline path editor; profile mesh picker; width + edge-blend controls |
| **Object** | transform gizmo (translate/rotate/scale); mesh picker; optional socket list |

All three panels share the same underlying framework: GLTF importer, procedural assembly
runtime, Babylon preview scene. A new structural type (hedge, power line, hedge row) is a new
panel, not a new framework.

---

## 5. Pipeline Integration

All three definition types flow into the same build artifact structure:

```
map-exports/
  lawn-maps.json              ← map definitions, incl. fence/road/dirtPath paths (existing)
  lawn-maps.baked.json        ← baked output (existing)
  species/
    white-flower.json         ← vegetation species definitions (proposed)
    blue-flower.json
  mowers/
    base-roundy.json          ← mower base definitions (proposed)
  parts/
    eye-star.json             ← part definitions (proposed)
    arm-wave.json
  modules/
    fence-post-a.glb          ← imported structural modules (proposed, Blender-authored)
    road-profile-concrete.glb
```

The bake step (`pnpm bake`) already processes maps. When vegetation species ship, `pnpm bake`
extends to read `species/*.json` and write per-instance visual props into `bakedInstances`.
Mower and structural definitions do not need a bake step — assembly is real-time.

---

## 6. What This Is Not

- **Not a polygon mesh modeller.** The editor never exposes raw vertex positions. Static hero
  props (the mower body, rocks, the fence) are authored in Blender and imported as assets.
  The editor authors *definitions that reference those assets*, not the assets themselves.
- **Not a level layout tool.** Placing objects in 3D space at specific coordinates is not a
  current goal. Map areas are authored in the JSON format; the editor previews them.
- **Not a game engine editor.** The LaMow Editor is a narrow, domain-specific tool for LaMow
  content. It is not Unity or Godot. The Babylon scene in the preview is the *same scene as
  the game*, not a separate editor runtime.

---

## 7. Cross-references

- `docs/VEGETATION_EDITOR.md` — full spec for the vegetation species editor (Phase 1/2)
- `docs/VEGETATION_POPULATION.md` — bake pipeline and tiered Poisson sampler
- `docs/BACKLOG.md §6` — at-the-machine rename task
- `MAP_FORMAT_V1_DRAFT.md` — current map definition format; fence/road/dirtPath/PathShape types (lines 363–657)
- `MAP_FORMAT_TODO.md` — open items in the map format pipeline

---

*Written 2026-06-25. PROPOSED — nothing in this document is implemented.*
