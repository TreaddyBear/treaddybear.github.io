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

- Standardize shared rendering modules between LaMow and LaMow Editor.
- Extract shared foliage/species generation standards so editor previews and game runtime use the same definitions.
- Retire legacy flat map arrays (`segments`, `cloverPatches`, `flowerBeds`, `flowerFields`) once remaining consumers move to area-tree/baked queries.
- Audit tulips: docs say tulip runtime placement bypasses baked instances and remains non-deterministic.
- Audit clover: docs say clover white bunches still use legacy flat patches and `Math.random()`.
- Stabilize dandelion kind selection; docs note seed/yellow type depends on baked array index.
- Move attract-camera points of interest off legacy flat vegetation arrays.
- Add flower far LOD strategy, either colored slats or another cheap representation.
- Finish debug settings information architecture: organize submenus and keep special controls distinct from tunables.
- Decide and document terrain/height falloff edge cases and validator warnings.
- Make sky/HDRI conversion pipeline repeatable and asset-size-conscious.
- Improve automated visual review path; existing docs still call out Vite/browser screenshot reliability work.
- Continue map editor parity work so authored changes reflect game output exactly.
