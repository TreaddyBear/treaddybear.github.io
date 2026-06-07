# Backlog And Deferred Ideas

This is the parking lot for ideas that came up during iteration but are not the current active task. Items here are not promises for the next commit; they are meant to keep good ideas from evaporating between context resets.

## Recently Fixed Or Changed (verify in real play)

These were changed recently and are believed working, but they are still worth confirming hands-on before treating them as release-safe:

- **Fence dirt is now placed correctly via a texture swap.** The previous per-segment mesh strips landed rotated 90 degrees (verified top-down with grass hidden: each strip lanced into the yard instead of lying under its fence). Replaced with a single ground-level dirt overlay (`createFenceDirtOverlay` in `src/world.ts`) whose opacity is a high-resolution mask: opaque dirt within a noise-perturbed band of the fence *segments* (distance based, so orientation can't be wrong), fading to transparent over grass so the lawn shows through. Verified top-down, angled, and in normal play that the soil border now follows the whole fence with ragged, blended edges.
- **Levels are completable again.** Grass that could not be placed clear of the fence margin or a flower bed used to be dropped there anyway, counted toward 100% but unreachable by the mower, making the level impossible to finish. Such blades are now retired (counted as already mowed and hidden), so every remaining cuttable blade is reachable. This was the cause of "a piece of grass too close to the fence I couldn't cut".
- **Keyboard is the default input** when no controller or touch device is present (confirmed in preview: the K input chip is selected on load). A present controller or a genuine touch device still auto-selects at startup.
- **Fence collision matches the visible boxes.** The mower collider is the visible mower box and each plank collider is the visible 0.34 x 0.08 plank, via an oriented-box (SAT) test, plus a push-out so turning against a wall nudges the mower away instead of wedging it. Grass cutting (the 0.42 cut circle) was deliberately left untouched.
- **The completion card is reachable by every control scheme:** keyboard (Enter/Space advance, Esc close), gamepad (A/B), and mouse/touch click.
- **Find-the-last-strands highlight.** When under 1% of the lawn is left and the player stalls, the remaining blades gently pulse brighter so they are easy to locate. The "Help Me" prompt also clears isolated single blades (no unmowed neighbor within 0.3m) and enables recurring highlight pulses for up to the final 20% of grass. If only isolated singles remain, the run auto-finishes as "Good Enough" instead of asking the player to hunt them.
- **Loading overlay on Next Level.** Building the next lawn blocks for a beat (felt like a dead button on mobile); a spinner now shows while it generates (`#loading`, deferred regen in `goToNextLevel`).
- **Mistakes meter uses star-scoring context.** The meter stays visible on every map because fence mistakes now matter too. The report-card copy should name whether flowers, fences, or both caused the mistake penalty.
- **Dandelion destruction bounces.** Popped heads and obliterated petals now bounce on the ground and linger before fading, instead of fading mid-air.
- **Latest fence/result-card pass.** Gentle and medium fence contact should do no damage and no mistake; only mistake-level hits at or above `fenceDamageSpeed` damage planks. Breaking a plank now clears a mower-width opening so the mower can fit through. The results card now distinguishes flower mistakes from fence mistakes instead of always saying "Mind the flowers."
- **Flower Court bed/mower terrain pass.** The protected bed is now a raised dirt mesh with a sloped edge, tulips sit on the raised surface, and the mower smoothly tilts to the sampled ground normal on slopes/raised terrain.
- **Mobile playability pass.** Touch-primary or narrow viewports now use a mobile render profile: dynamic resolution off by default, 30 FPS tuning target if the player enables it, SSAO off, and a 2048 shadow map cap. The HUD/settings layout also avoids narrow-screen overlap, settings controls now reflect runtime defaults after those mobile adjustments, and `pnpm run dev:lan` / `pnpm run preview:lan` exist for local Wi-Fi phone testing.

## Near-Term Polish

- Verify the completion card in real play after the click-through fix. `#celebrationSeeds` no longer accepts pointer events and the overlay no longer fades to invisible, but the full 100% flow should be smoke-tested by actually completing a level.
- Verify the new star meter in a real run. The live HUD now mounts the compact star meter, hides the normal clock, and keeps Mistakes visible, but the first/second/third star banking animation should be watched during actual mowing.
- Verify the star results card in real play. It now hard-triggers on 100%, hard time limit, or no-star failure; for one-star-or-better runs that cannot improve and have stalled near the end, it shows a one-time soft "Fine Work" prompt with Keep Going, Help Me, and Next Level. Help Me clears isolated single blades; if only isolated singles remain, the result card uses "Good Enough" instead of asking the player to hunt them.
- Verify fence escape in real play. The code now clears a mower-width opening around broken planks, including close corner planks, but the feel still needs hands-on testing at straight segments and corners.
- Tune fence damage thresholds. Current intent: slow/medium contact = no damage/no mistake, full-speed unboosted or boosted hard crash at or above `fenceDamageSpeed` = mistake + fence damage. This may need value tuning once playtested.
- Verify mower tilt on Flower Court and outer slopes. The mower now eases toward the sampled terrain normal, but the visual tilt rate and sample distance may need tuning.
- Tune result-card action feel. Current first pass uses contextual actions: perfect = Next Level + Report Card; non-perfect = Retry + Report Card, plus Next Level if at least one star was earned. Near-end soft prompts use Keep Going + Help Me + Next Level. Max-stars-before-100% shows Finish Run unless `autoFinishOnMaxStars` is enabled.
- Tune Flower Court flower-bed risk. Tulips now mostly spawn inset from the bed edge, with a small chance of edge flowers; verify whether the edge-risk amount feels fun without making accidental flower mistakes feel cheap.
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
- Revisit real ground shadows without adding `@babylonjs/materials`. A `ShadowOnlyMaterial` overlay briefly existed, but it added a second Babylon dependency and broke the local no-install build path, so it was backed out during the star-meter handoff.
- Keep SSAO off the grass. Ambient occlusion is useful for grounding fences, rocks, mower, trees, and ground contact, but it makes individual grass read dirty/muddy. Grass needs its own custom height/shadow treatment driven by the mow-state field below, not the global SSAO pass.
- Explore small tiled ground textures and texture blending. Dirt has a normal map now; grassy/dirt mixing could use Perlin masks later.
- Apply the same edge-randomization to ALL grass/dirt boundaries, not just the fence dirt. The fence dirt overlay now uses noise-wobbled, soft-alpha edges, but the world biome ground (`createBiomeGroundMaterial` in `src/world.ts`) still hard-thresholds its mask with `step(0.5, ...)`, so the biome grass/dirt line is crisper/simpler than the fence dirt. A final pass could soften and noise-up the biome boundary to match.
- Fence clearance is one knob if it still feels tight: the no-grass margin is `grassFenceFalloff` in `src/main.ts` (~0.22m clear) and the dirt band half-width is `0.3` in `createFenceDirtOverlay`.
- Keep art additions size-conscious. Prefer small tiled textures and compressed assets before adding multi-megabyte model packs.

## Rendering: Grass LOD + Mow Height/Shadow Field (future, documented idea)

The current lawn is per-blade thin instances (~30k today). That looks great up close but will not scale to *huge* lawns. The plan below is a two-pass system; we are only documenting it now, not building it, and today's level does not need to be built for it. Today's level can be considered the "final" / easy-mode mower (cuts perfectly in one pass).

**Performance reality check.** When the game sits around 30 FPS on multiple devices, assume we are missing the 16.7ms 60Hz frame budget and the browser is effectively presenting every other frame. This is not believed to be a Babylon hard cap. Dynamic resolution is currently a bad primary lever because the grass path is probably CPU/buffer-upload bound: `updateMotion` iterates the main lawn blades every frame and uploads the long-grass thin-instance matrix buffer. Lowering render resolution cannot fix that cost, so it can trash image quality without improving frame rate.

**Adaptive resolution follow-up after LOD.** Keep dynamic resolution off by default until the LOD/mow-state work reduces CPU and buffer upload pressure. When revisiting it, make it prove that a hardware-scale drop actually improves FPS before holding lower quality, ramp back toward native resolution when it does not help, cap mobile degradation conservatively, and pick targets that respect display cadence. Do not use a target above the observed browser/display refresh ceiling as proof of headroom; on a 60Hz display, 60/30/20/15 are stable presentation targets, while 45 FPS is only a clean target on displays that can present it cleanly, such as many 90Hz panels.

**Two passes for grass:**

1. **Far LOD — a single "grass field" mesh.** One ground-conforming mesh covering the whole lawn that *reads* as full-height grass via an exaggerated normal map and/or some baked surface-level deviation (vertex displacement), so it looks like a field of grass without millions of blades. Where the lawn has been **mowed**, the same mesh is **lower** and smoother (less deviation / a calmer normal map). This is cheap and scales to any lawn size.
2. **Near detail — the individual blades we have today.** The existing thin-instance blades (budget ~10k at a time on most current hardware) render only near the camera and **cross-fade/blend** into the far field mesh as the camera pulls away. Close up you get real blades; far away you get the field mesh; the transition is a distance-based blend.

**The shared data: a mow-state field.** Both passes (and shadows, below) are driven by a single data structure — a grid/texture storing per-cell mow state (tall vs. short today; partial states later), updated as the mower drives over it. This is the source of truth that:
- sets the far mesh's height/normal-strength per region,
- gates which near blades are present/cut,
- and feeds shadows.

We will need a generator that produces/updates this field from where the mower has been (essentially a paint-as-you-mow heightmap).

**Shadows from the same field.** The tall vs. short field can also drive shadows: **tall** (unmowed) areas cast a shadow, **mowed/low** areas do not. This could be done only near the camera for performance (and is a much better answer to "we need more shadow" than spreading one shadow map over the whole world). It ties grass height directly to shadow, for free, off the same data.

**Designed to grow into difficulty:** later we want **partial-mow states** and **worse mowers** — slower ones, or ones that do not cut cleanly and need multiple passes. So the field should eventually support **fractional height** (e.g. half-mown), with matching fractional shadow. When we build it, pick a height/shadow representation that looks good and stays performant at partial states. (Details are a conversation for later; this entry just preserves the plan.)

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
- Revisit mobile/touch input in real-device play. The quick selector and mobile render profile exist, but auto mode, touchpad feel, and phone/tablet input detection still need hands-on testing over LAN.
- Replace the quick input selector letters with better icons.
- Continue tuning controller steering separately from keyboard steering. Keyboard should keep immediate hold-to-build acceleration; controller should avoid the slippery spiral feel.
- Tune camera auto-return. Current behavior returns behind the mower after rest delays and eventually stops returning after repeated manual adjustment.
- Consider whether mouse should steer mower only in specific input modes and how that should interact with camera drag.

## Technical Cleanup

- Continue breaking up `src/main.ts`; it still owns too much orchestration and cross-system game-loop logic.
- Keep module boundaries honest. Gun effects, dandelions, grass generation, HUD, settings, fence, camera, and mower helpers already have modules; future cleanup should focus on reducing `main.ts` wiring complexity, map lifecycle/reset coupling, and collision/rules coordination rather than re-moving systems that are already split out.
- Add a proper asset-size check or at least document expected asset budgets before releases.
- Consider code-splitting Babylon imports if bundle size becomes painful.
- Add a lightweight smoke-test checklist for release candidates: build, browser load, map switch, complete level, fence damage, hidden gun, controller/touch sanity.
- Revisit texture sampling modes. Some placeholder textures are currently nearest-sampled for crisp editability, but final art may want linear/mipmapped behavior.

## Release / Workflow

- Keep active work on `dev`.
- Use version tags for releases.
- Fast-forward `master` only to a tested release tag because GitHub Pages deploys from `master`.
- Keep `HANDOFF.md`, `ARCHITECTURE.md`, `BACKLOG.md`, and `INTERNAL_ATTRIBUTION.md` current before context resets.
