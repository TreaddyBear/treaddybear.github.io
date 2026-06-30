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

## Red/blue flower density language

Status: clarified.

- "Semantic 10x" means the engine/baker interprets an authored density of `1.0` for blue/red flowers as much denser than the raw map number would normally imply.
- Current implementation: blue/red use a 10x placement multiplier; white/yellow use a 5x placement multiplier.
- Current `devVegtest` baked counts confirm the result: blue `1179`, red `1191`, white `599`, yellow `592`.
- No map file density values were raised to get that result; the interpretation happens in the bake/runtime placement code.

## Flower slats / colored slats

Status: not implemented.

- The current far LOD slat renderer is grass-only.
- Slats have tunable grass colors (`lodSlatTopColorA/B`, `lodSlatMidColor`, `lodSlatBottomColor`) but no per-flower color layer.
- Field flowers are still rendered as thin-instance flower geometry near the mower and collapsed outside the decorative vegetation render radius.
- No colored flower slat layer has been added yet, and existing grass slats are not being tinted by flower density.

## Outstanding inventory

Status: reviewed and counted.

Recent / last-24h review items: 10.

- Wind effects: corrected so the spawn radius follows the active play area, while existing wisps/motes keep their spawn-time wind direction and lifetime. Current center is the player/mower position; if the camera ever detaches from the mower, this should be revisited to include a camera-ground focus point.
- Skybox: vertical offset and vertical flip are now real visible tuning settings, while diagnostic texture selection stays transient. Needs live calibration against the real WebP so the field/ground band never reads as a green sky.
- Flower density: red/blue flower density is implemented as an engine/baker interpretation multiplier, not as raised map densities. Needs live approval after the latest bake values.
- Flower LOD: colored flower slats are not implemented yet. This is still a likely performance/appearance task.
- Clover clarity: clover still needs an editor/game inspection pass; older docs call out legacy/non-deterministic clover-flower behavior.
- Dandelion seed release: code was touched recently but still needs live confirmation that seed heads release and drift correctly.
- Result card fireworks: implemented recently, but still needs visual approval in the running game.
- Decorative mowing outside lawns: implemented recently for medium/wheat decorative grass, but still needs live confirmation and performance review.
- Debug settings storage: stale/default localStorage pruning was added, but broader menu organization is still outstanding.
- Invisible collision / mower height shove: recent collision/grounding work needs live confirmation against the lawn-edge shove case.

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
