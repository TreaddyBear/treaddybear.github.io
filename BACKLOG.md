# Backlog And Deferred Ideas

This is the parking lot for ideas that came up during iteration but are not the current active task. Items here are not promises for the next commit; they are meant to keep good ideas from evaporating between context resets.

## Believed Fixed This Pass (verify in real play)

Changed during the same pass and believed working, but worth confirming hands-on:

- **Fence dirt is now placed correctly via a texture swap.** The previous per-segment mesh strips landed rotated 90 degrees (verified top-down with grass hidden: each strip lanced into the yard instead of lying under its fence). Replaced with a single ground-level dirt overlay (`createFenceDirtOverlay` in `src/world.ts`) whose opacity is a high-resolution mask: opaque dirt within a noise-perturbed band of the fence *segments* (distance based, so orientation can't be wrong), fading to transparent over grass so the lawn shows through. Verified top-down, angled, and in normal play that the soil border now follows the whole fence with ragged, blended edges.
- **Levels are completable again.** Grass that could not be placed clear of the fence margin or a flower bed used to be dropped there anyway, counted toward 100% but unreachable by the mower, making the level impossible to finish. Such blades are now retired (counted as already mowed and hidden), so every remaining cuttable blade is reachable. This was the cause of "a piece of grass too close to the fence I couldn't cut".
- **Keyboard is the default input** when no controller or touch device is present (confirmed in preview: the K input chip is selected on load). A present controller or a genuine touch device still auto-selects at startup.
- **Fence collision matches the visible boxes.** The mower collider is the visible mower box and each plank collider is the visible 0.34 x 0.08 plank, via an oriented-box (SAT) test, plus a push-out so turning against a wall nudges the mower away instead of wedging it. Grass cutting (the 0.42 cut circle) was deliberately left untouched.
- **The completion card is reachable by every control scheme:** keyboard (Enter/Space advance, Esc close), gamepad (A/B), and mouse/touch click.

## Near-Term Polish

- Verify the completion card in real play after the click-through fix. `#celebrationSeeds` no longer accepts pointer events and the overlay no longer fades to invisible, but the full 100% flow should be smoke-tested by actually completing a level.
- Keep tuning terrain texture/mask readability. The current terrain uses a baked biome mask plus shader-tiled grass/dirt textures, but the grass/dirt art, texture scale, and ground visibility are still active visual risks.
- Continue tuning medium/outside grass. The rectangular near-fence density pass was replaced with a smoother distance/noise falloff, but it still needs visual review in play so outside grass is dense enough without square transitions or mindless uniform thickness.
- Verify the new three-tone cut grass in real mowing. Cut grass now has root/top vertex tones and per-instance neutral variation, but the final mowed patch needs eyes-on tuning.
- Improve the `Flower Court` map. It exists, but the layout, flower-bed feel, mistake tuning, and grass buffer around the bed need real design passes.
- Revisit the white dandelion art. Seed heads should look more spherical and wispy, not like blocky pieces clustered around a stem.
- Revisit yellow dandelion destruction. First hit should pop the whole head off; second hit should obliterate it. The head movement should feel punchy without the petals being the main flying object.
- Tune gun feedback after seeing it in play. Current implementation has a placeholder sound, short tracer, impact dust, and rare grass flecks, but the style and timing may need refinement.
- Replace placeholder completion audio. The completion UI has fanfare and loop hooks, but both files are currently empty placeholders.
- Replace or source final audio for mower, breeze, grass cutting, reverse beep, wall bump, flower pops, and gun shot, then fill `INTERNAL_ATTRIBUTION.md`.
- Tune road and stripe textures by hand. `road-pattern.png` and `road-stripes-atlas.png` are now file-backed for manual editing.
- Decide whether to remove `ground-spotty.png`. It is no longer active, but was left in place until an explicit cleanup.

## World And Art Direction

- Add better trees farther out beyond the hilly area. Current trees are simple procedural placeholders.
- Add distant houses or neighborhood props. Consider small hand-built meshes first; GLB assets are possible if sourced CC0 and kept lightweight.
- Add more rocks/boulders and tune moss/non-moss variation so the hidden-gun hill feels less suspicious.
- Make the far out-of-bounds wheat/wilderness grass more naturally clumpy and less like a rectangular transition.
- Continue improving neighbor yards so grass density thins with distance, but still meets the main lawn without visible gaps.
- Add real cloud shadows eventually. Current cloud shadow effect only modulates sun intensity/specular; a projected cloud texture would be better.
- Explore small tiled ground textures and texture blending. Dirt has a normal map now; grassy/dirt mixing could use Perlin masks later.
- Apply the same edge-randomization to ALL grass/dirt boundaries, not just the fence dirt. The fence dirt overlay now uses noise-wobbled, soft-alpha edges, but the world biome ground (`createBiomeGroundMaterial` in `src/world.ts`) still hard-thresholds its mask with `step(0.5, ...)`, so the biome grass/dirt line is crisper/simpler than the fence dirt. A final pass could soften and noise-up the biome boundary to match.
- Fence clearance is one knob if it still feels tight: the no-grass margin is `grassFenceFalloff` in `src/main.ts` (~0.22m clear) and the dirt band half-width is `0.3` in `createFenceDirtOverlay`.
- Keep art additions size-conscious. Prefer small tiled textures and compressed assets before adding multi-megabyte model packs.

## Game Design

- Build more maps and make map selection feel like a real level flow, not just a dev setting.
- Explore win/lose pressure. Ideas included timers, mistakes bars, protected flower beds, or dandelion spread as a soft fail pressure.
- Prototype dandelion lifecycle gameplay: wind carries seeds, seeds land, yellow dandelions grow, yellow turns white, white can pop and spread more seeds.
- Add challenge around mowing cleanly without damaging protected plants.
- Consider a launcher/version page later if releases become a bigger thing.
- Add hidden secrets outside the fence, but keep the current hidden-gun discovery from being too easy.
- Decide what shooting should and should not affect. It currently cuts grass, damages fences, pops dandelions, and destroys protected tulips as mistakes.

## Input And Camera

- Flesh out controller support beyond the current stub. Current support is functional but light.
- Revisit mobile/touch input. Auto mode can misclassify touch as mouse-like behavior, so mobile needs more careful input selection.
- Replace the quick input selector letters with better icons.
- Continue tuning controller steering separately from keyboard steering. Keyboard should keep immediate hold-to-build acceleration; controller should avoid the slippery spiral feel.
- Tune camera auto-return. Current behavior returns behind the mower after rest delays and eventually stops returning after repeated manual adjustment.
- Consider whether mouse should steer mower only in specific input modes and how that should interact with camera drag.

## Technical Cleanup

- Continue breaking up `src/main.ts`; it still owns too much game logic.
- Consider moving gun effects, dandelions, grass generation, and HUD/settings code into separate modules.
- Add a proper asset-size check or at least document expected asset budgets before releases.
- Consider code-splitting Babylon imports if bundle size becomes painful.
- Add a lightweight smoke-test checklist for release candidates: build, browser load, map switch, complete level, fence damage, hidden gun, controller/touch sanity.
- Revisit texture sampling modes. Some placeholder textures are currently nearest-sampled for crisp editability, but final art may want linear/mipmapped behavior.

## Release / Workflow

- Keep active work on `dev`.
- Use version tags for releases.
- Fast-forward `master` only to a tested release tag because GitHub Pages deploys from `master`.
- Keep `HANDOFF.md`, `ARCHITECTURE.md`, `BACKLOG.md`, and `INTERNAL_ATTRIBUTION.md` current before context resets.
