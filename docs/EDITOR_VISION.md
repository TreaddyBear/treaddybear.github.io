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

### Three definition types

| Type | Definition file | Bake step | Preview |
|---|---|---|---|
| **Maps** | `lawn-maps.json` (existing) | `pnpm bake` | `pnpm viz` + in-game |
| **Vegetation species** | `map-exports/species/*.json` (proposed) | bake writes per-instance props to `bakedInstances` | in-editor Babylon scene — see `docs/VEGETATION_EDITOR.md` |
| **Mowers** | `mowers/*.json` (proposed) | none — real-time assembly | in-editor Babylon scene — see §3 below |

All three types share the validation + preview principle. A new definition type plugs in by
implementing the same `validate → preview` contract. The editor UI renders a different panel
per type but the same real-engine scene.

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

## 4. Pipeline Integration

All three definition types flow into the same build artifact structure:

```
map-exports/
  lawn-maps.json              ← map definitions (existing)
  lawn-maps.baked.json        ← baked output (existing)
  species/
    white-flower.json         ← vegetation species definitions (proposed)
    blue-flower.json
  mowers/
    base-roundy.json          ← mower base definitions (proposed)
  parts/
    eye-star.json             ← part definitions (proposed)
    arm-wave.json
```

The bake step (`pnpm bake`) already processes maps. When vegetation species ship, `pnpm bake`
extends to read `species/*.json` and write per-instance visual props into `bakedInstances`.
Mower definitions do not need a bake step — assembly is real-time.

---

## 5. What This Is Not

- **Not a polygon mesh modeller.** The editor never exposes raw vertex positions. Static hero
  props (the mower body, rocks, the fence) are authored in Blender and imported as assets.
  The editor authors *definitions that reference those assets*, not the assets themselves.
- **Not a level layout tool.** Placing objects in 3D space at specific coordinates is not a
  current goal. Map areas are authored in the JSON format; the editor previews them.
- **Not a game engine editor.** The LaMow Editor is a narrow, domain-specific tool for LaMow
  content. It is not Unity or Godot. The Babylon scene in the preview is the *same scene as
  the game*, not a separate editor runtime.

---

## 6. Cross-references

- `docs/VEGETATION_EDITOR.md` — full spec for the vegetation species editor (Phase 1/2)
- `docs/VEGETATION_POPULATION.md` — bake pipeline and tiered Poisson sampler
- `docs/BACKLOG.md §6` — at-the-machine rename task
- `MAP_FORMAT_V1_DRAFT.md` — current map definition format (the first definition type)
- `MAP_FORMAT_TODO.md` — open items in the map format pipeline

---

*Written 2026-06-25. PROPOSED — nothing in this document is implemented.*
