# Task Review Notes

## Wind effects follow radius, not mower motion

Status: corrected after audit.

- Ambient wind wisps and motes now spawn around the mower/play area radius.
- Existing wisps and motes capture their wind direction at spawn and keep that direction for their lifetime.
- Existing ambient motes are no longer reset just because the mower moves away; they finish their natural duration, then the next spawn happens near the current play area.
- Wind direction variance remains independent of mower heading.

## Skybox shift and green horizon

Status: corrected for tunability; visual value still needs live inspection.

- The real sky asset remains the default texture.
- The diagnostic texture selector remains transient so magenta/orientation test assets are not accidentally committed as defaults.
- Sky vertical offset and vertical flip are now real `settings` values, visible under Scene > Lighting.
- Those two sky controls are no longer inside `data-dev-transient`, so the dev tuning UI can show revert/commit controls and save them into `src/config.ts`.
- The green appearance likely came from the lower field/ground band of the WebP being visible through the dome mapping; the new commit-able vertical offset is the intended calibration control for that.

## Flower density language

Status: settled.

- The current visible density is the intended meaning of authored density `1.0` for the current flower size.
- Do not keep describing this as a "10x" behavior in planning language. That was implementation history, not the design vocabulary.
- Future density changes should be discussed as changes to what `1.0` means visually for that species/size.

## Flower slats / colored slats

Status: required pre-release work.

- The current far LOD slat renderer is grass-only.
- Slats have tunable grass colors (`lodSlatTopColorA/B`, `lodSlatMidColor`, `lodSlatBottomColor`) but no per-flower color layer.
- Field flowers are still rendered as thin-instance flower geometry near the mower and collapsed outside the decorative vegetation render radius.
- Colored flower slats are required. The implementation choice is open: either tint existing slats from flower-density fields, or add separate cheap colored slat layers for flower color families.
- Selection criterion: pick the approach that gives better frame time and clearer flower-field readability at distance.

## Outstanding inventory

Status: reviewed and counted.

Recent / last-24h review items: 10.

1. Wind effects
   - Classification: implemented; needs live feel check.
   - Release call: pre-release verification.
   - Wording: spawn radius follows active play area. Existing wind wisps/motes are not dragged, re-aimed, or tied to mower heading.
   - Follow-up: if camera ever detaches from the mower, use a camera-ground focus point in addition to player position.

2. Skybox calibration
   - Classification: partially implemented.
   - Release call: pre-release.
   - Wording: vertical offset and vertical flip are now visible, commit-able settings; diagnostic texture selection remains transient.
   - Follow-up: live-calibrate the real WebP so the field/ground band cannot read as green sky.

3. Flower density
   - Classification: complete for current release unless live review says otherwise.
   - Release call: no separate work item.
   - Wording: current visible density is now the definition of `1.0` for the current flower size.
   - Follow-up: remove old "10x" planning language when touching related docs/comments.

4. Colored flower slats
   - Classification: not implemented.
   - Release call: pre-release performance/art task.
   - Wording: add colored far-LOD flower representation, either by tinting existing slats or by adding separate cheap colored slat layers.
   - Follow-up: prototype both if the faster/better-looking answer is not obvious from code inspection.

5. Clover clarity
   - Classification: legitimate unresolved issue.
   - Release call: pre-release inspection; larger determinism cleanup can be v2 if visuals are acceptable.
   - Wording: clover needs a readable test/editor inspection path, and older docs still call out legacy/non-deterministic clover-flower behavior.
   - Follow-up: inspect clover in the editor/test level, then decide whether visual clarity alone is enough for release.

6. Dandelion seed release
   - Classification: implemented path exists; reported live behavior still needs confirmation.
   - Release call: pre-release bug check.
   - Wording: seed heads should release fuzz into wind when popped/cut; "stuck head" behavior is not acceptable.
   - Follow-up: reproduce in live game and fix if seeds still fail to detach/drift.

7. Result-card dandelion fireworks
   - Classification: implemented; needs visual approval.
   - Release call: pre-release polish check.
   - Wording: end-card dandelion fireworks should render above UI/text, arc upward, pop, and scatter particles downward.
   - Follow-up: live-check timing, layer order, and whether it reads as dandelion heads rather than generic confetti.

8. Decorative mowing outside lawns
   - Classification: implemented for medium/wheat decorative grass; scope may need widening.
   - Release call: pre-release behavior/perf check.
   - Wording: mower should visibly mow grass anywhere it drives; outside-lawn mowing must not count toward lawn completion.
   - Follow-up: verify which grass layers are actually cut outside lawns and whether flowers/clover/dandelions should also respond outside scored areas.

9. Debug settings cleanup
   - Classification: partially implemented.
   - Release call: pre-release for broken/stale controls; broader submenu design can continue after.
   - Wording: stale/default localStorage pruning exists, but settings organization still needs a deliberate pass.
   - Follow-up: separate special controls like level launch and diagnostics from saved tunables.

10. Invisible collision / mower height shove
    - Classification: unresolved until live repro says otherwise.
    - Release call: pre-release bug check.
    - Wording: no invisible walls. Only visible opaque objects or physical slope behavior should stop the mower.
    - Follow-up: verify the lawn-edge shove/downward grounding case after the recent collision/grounding changes.

Overall outstanding items found in docs/code: 13.

1. Shared rendering modules for LaMow + LaMow Editor
   - Classification: real architecture goal.
   - Release call: v2/ongoing, except pieces needed by immediate sky/foliage work.
   - Wording: rendering code should move toward reusable modules consumed by both game and editor, but this should happen by extracting one stable renderer at a time.
   - Follow-up: start with sky/lighting and foliage LOD, because those are already active problem areas.

2. Shared foliage/species generation standards
   - Classification: real architecture goal.
   - Release call: v2, with pre-release slices if needed for visible flower/clover fixes.
   - Wording: editor previews and runtime should eventually use the same species definitions and deterministic generation code.
   - Follow-up: do not block the next release on a full species editor unless current foliage visuals cannot be tuned safely otherwise.

3. Retire legacy flat map arrays
   - Classification: legitimate technical debt.
   - Release call: v2 unless map editor parity is blocked by it.
   - Wording: `segments`, `cloverPatches`, `flowerBeds`, and `flowerFields` are derived legacy views; long-term source of truth should be area-tree/baked queries.
   - Follow-up: migrate one consumer at a time. Avoid a large rewrite while performance/foliage/sky are still moving.

4. Tulip baked-instance audit
   - Classification: legitimate correctness issue.
   - Release call: pre-release if tulips appear in release levels; v2 if tulips remain demo/dev-only.
   - Wording: docs say tulips are baked but runtime placement still uses old `flowerBeds` plus `Math.random()`.
   - Follow-up: confirm whether tulips exist in the three final `bgrn` levels. If yes, wire them to baked instances or explicitly exclude them from release content.

5. Clover baked/deterministic audit
   - Classification: legitimate but split into visual vs determinism concerns.
   - Release call: pre-release for visual clarity; v2 for exact deterministic clover blossoms unless release behavior visibly depends on it.
   - Wording: clover itself has baked support, but white clover-flower bunches still appear to use legacy patches and `Math.random()`.
   - Follow-up: inspect clover in `devVegtest`/editor first. Fix visual readability before chasing full determinism.

6. Stable dandelion kind selection
   - Classification: correctness cleanup.
   - Release call: v2 unless save-state or authored dandelion identity matters before release.
   - Wording: seed/yellow kind should eventually be derived from a stable per-instance seed/id, not array position.
   - Follow-up: safe to postpone if current release only needs consistent-enough distribution, not persistent individual dandelion identity.

7. Attract-camera POI migration
   - Classification: legitimate dependency cleanup.
   - Release call: pre-release if attract screen shots are visibly wrong; otherwise v2 with legacy-array retirement.
   - Wording: attract camera still reads legacy flat vegetation arrays for points of interest.
   - Follow-up: leave until either legacy arrays are retired or attract shots lose flower/clover targeting.

8. Flower far LOD / colored slats
   - Classification: required performance/art task.
   - Release call: pre-release.
   - Wording: add colored far-LOD flower representation, either by tinting grass slats from flower density or by adding separate cheap colored slat layers.
   - Follow-up: prioritize this before further density changes, because it attacks both frame rate and distant readability.

9. Debug settings information architecture
   - Classification: real UX/dev-tooling task.
   - Release call: pre-release for broken/confusing essentials; v2 for a full polish pass.
   - Wording: level launch, diagnostics, and saved tunables need clearer separation.
   - Follow-up: keep special controls above tunables and outside saved local settings unless explicitly intended.

10. Terrain/height falloff spec and validator warnings
    - Classification: spec hygiene.
    - Release call: v2/doc unless current authored maps hit the ambiguous case.
    - Wording: define what `height` means when falloff exceeds shape inradius, and decide whether validator warns.
    - Follow-up: do not block release if current final maps validate visually.

11. Sky/HDRI conversion pipeline
    - Classification: useful asset-pipeline work.
    - Release call: pre-release if the current sky asset still looks wrong; otherwise v2/tooling.
    - Wording: conversion should be repeatable, size-conscious, and avoid committing huge source EXR files.
    - Follow-up: current immediate task is live sky calibration; formal source-asset tooling can come after the visual is accepted.

12. Automated visual review path
    - Classification: dev-experience/tooling.
    - Release call: v2 unless lack of screenshots blocks remote verification.
    - Wording: `pnpm viz` is the reliable headless vegetation path; browser/game screenshots still need a hardened single-command capture flow.
    - Follow-up: not gameplay-critical, but valuable for long remote sessions and release confidence.

13. Map editor parity
    - Classification: umbrella requirement.
    - Release call: pre-release for anything that makes final levels render/play differently from authored intent; v2 for broader editor feature growth.
    - Wording: map editor changes must reflect the game accurately, especially level identity, vegetation density, terrain, and foliage standards.
    - Follow-up: treat as a gate for final `bgrn` levels, not as a demand to finish the whole editor before release.
