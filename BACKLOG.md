# Backlog And Deferred Ideas

This is the parking lot for ideas that came up during iteration but are not the current active task. Items here are not promises for the next commit; they are meant to keep good ideas from evaporating between context resets.

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
