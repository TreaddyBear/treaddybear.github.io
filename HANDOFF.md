# Project Handoff

This document is the compact handoff for starting a fresh conversation without relying on prior chat context.

## Branch And Workflow

- Active development branch: `dev`.
- Do not use `main` or `master` for day-to-day work.
- Public releases should be made from tested commits using version tags like `v0.1.1`.
- GitHub Pages deploys are handled by `.github/workflows/deploy-gh-pages.yml` on pushes to `master` or manual workflow dispatch.
- Tags remain the release markers, but Pages deploys from `master` because the `github-pages` environment protection blocked tag-triggered deploys. The failed `v0.1.0` tag workflow can be ignored.
- Current published release marker: `v0.1.2` at commit `63d61b8` (`Add terrain hiding and fence debug tools`).
- `dev`, `master`, `origin/dev`, and `origin/master` were aligned at the same `v0.1.2` commit before the current uncommitted development work.
- The project is a Vite TypeScript Babylon.js app using `@babylonjs/core` only for runtime dependencies.
- Package manager is `pnpm@11.0.0`.
- Dependency security policy currently requires `minimumReleaseAge: 57600` in `pnpm-workspace.yaml`.
- Internal asset/source tracking lives in `INTERNAL_ATTRIBUTION.md`.
- Deferred ideas and non-active follow-ups live in `BACKLOG.md`.

## Current Working Tree

- As of the `v0.1.2` release push, the working tree was clean.
- This handoff edit may be uncommitted if a new conversation starts immediately after it; check `git status --short --branch`.
- Usual harmless local warning: Git may print `unable to access 'C:\Users\Owner/.config/git/ignore': Permission denied`.

Known non-empty audio files:

- `src/assets/breeze.mp3`
- `src/assets/lawn-mower.mp3`
- `src/assets/breeze-ambient.mp3`
- `src/assets/grass-cutting.mp3`
- `src/assets/reverse-beep.mp3`
- `src/assets/wall-bump.mp3`
- `src/assets/flower-pop-1.mp3` through `src/assets/flower-pop-7.mp3`

Known empty placeholder audio files:

- `src/assets/completion-fanfare.mp3`
- `src/assets/completion-loop.mp3`
- `src/assets/gun-shot.mp3`

Empty placeholders are intentional during prototyping; the audio layer must handle missing, empty, or malformed MP3s gracefully.

## Last Verified State

- `pnpm install --frozen-lockfile` passed after the 40-day minimum package age setting was added.
- `pnpm run build` passed after the latest terrain, gun hiding, fence debug, tree, and gun feedback changes.
- A browser smoke test confirmed the terrain/gun scene loaded, the canvas rendered, and no console errors were reported. A later debug-toggle smoke test was attempted but hit a browser automation variable redeclare before completing; the production build passed.
- `v0.1.0` was pushed but its tag-triggered Pages workflow failed due to GitHub environment protection rules.
- `v0.1.1` changed Pages deployment to run from `master` pushes instead of tags.
- `v0.1.2` added terrain hiding, fence debug controls, simple trees, and related world polish, then pushed `dev`, `master`, and the `v0.1.2` tag.

## Current Features

- Full-window Babylon canvas.
- Selectable maps: `Main` and `Flower Court`.
- `Main` is the original L-shaped playable lawn.
- `Flower Court` has a central protected tulip bed.
- Flower beds should be slightly raised brown soil with mostly no grass on the bed and a visible grass buffer around most flowers.
- Low fence plank boundaries generated from each map config.
- Chase camera following the mower.
- Dense instanced grass that changes to cut state instead of disappearing.
- Neighbor lawns and far out-of-bounds grass/wheat dressing.
- Large outer terrain mesh with procedural bumpy height variation.
- Five simple procedural trees in the expanded outer world, using low-poly trunks and leafy crowns at varied scales.
- Simple procedural boulders in the expanded outer world.
- File-backed textures for grassy ground, CC0 dirt with normal map, road pattern, and road stripe atlas in `src/assets/textures/`.
- Dandelions with yellow and white seed-head behavior.
- Sparse large wind wisps and tiny wind particles.
- Development settings panel with numeric value readouts.
- Settings include a map selector.
- Production builds hide the settings panel.
- Fullscreen button that does not conflict with spacebar boost.
- Keyboard movement with forward/reverse throttle, steering, and boost.
- Stubbed controller/touch input behind an input mode selector.
- Mouse position can steer the mower when the canvas is focused in `auto` or controller-oriented modes, but not in forced `keyboard` or `touch` mode.
- Right mouse drag orbits the follow camera, mouse wheel zooms, and controller right stick controls camera orbit/height.
- In forced `keyboard` input mode, arrow keys adjust camera orbit/height.
- Audio system with mower, directional breeze, ambient breeze, cutting loop, reverse beep, weighted random yellow flower pop bank, and wall bump hooks.
- Hidden gun feedback now includes a placeholder shot sound, a short fuzzy tracer, impact dust, and sparse grass fleck particles when shots cut blades.
- Completion UI has a fanfare one-shot hook, a looping chill-bed hook, and `Next Level` / `Close` buttons. Current completion audio files are placeholders unless replaced.
- Mistakes meter increments when protected tulips are destroyed.

## Current Tuning Defaults

Important defaults in `src/config.ts`:

- `playerSpeed = 1.65`
- `playerBoost = 1.45`
- `playerRadius = 0.75`
- `playerFenceRadius = 0.72`
- `mowerCutRadius = 0.42`
- `bladeCount = 30000`
- `mediumGrassCount = 24000`
- `wheatGrassCount = 7000`
- `mapId = "main"`
- `grassyTextureScale = 20`
- `dirtTextureUScale = 42`
- `dirtTextureVScale = 84`
- `dirtNormalStrength = 0.42`
- `roadTextureUScale = 1`
- `roadTextureVScale = 48`
- `turnBuild = 0.77`
- `turnMaxSpeed = 2.25`
- `controllerTurnAccelThreshold = 0.7`
- `mowerVolume = 0.4`
- `breezeVolume = 0.6`
- `ambientBreezeVolume = 0.3`
- `breezeFacingAmount = 0.7`
- `grassCuttingVolume = 0.4`
- `grassCuttingAttackDelay = 0.2`
- `grassCuttingAttack = 0.03`
- `grassCuttingDecay = 0.17`
- `flowerPopVolume = 0.17`
- `wallBumpVolume = 0.75`
- `reverseBeepVolume = 0.04`
- `completionFanfareVolume = 0.7`
- `completionLoopVolume = 0.35`
- `gunShotVolume = 0.35`
- `grassBaseColor = "#0d2c02"`
- `cutGrassColor = "#152b03"`
- `grassRoughness = 0.22`
- `grassMetallic = 0`
- `grassClearCoat = 0.009`
- `cutGrassRoughness = 0.36`
- `cutGrassMetallic = 0`
- `cutGrassClearCoat = 0.003`

## Design Intent To Preserve

- Keep the code simple and tuned for iteration; do not introduce an ECS.
- Avoid new dependencies unless there is a clear payoff.
- Maps should stay data-driven in `src/config.ts` for now; do not build a full level editor yet.
- The game should feel sunny, shiny, pleasant, and a little playful rather than flat or muddy.
- Grass shine is tunable with roughness, metallic, and clear-coat settings; the metallic knob is stylized to make sun glints stronger in spots.
- Grass shine should come from material/normal response, not from brightening the albedo. Main long blades use hand-authored leaf normals biased upward/sideways so direct sun can catch them more reliably.
- Grass should look dense, noisy, and clumpy, with subtle HSL variation from noise and per-blade randomness.
- Cut grass should still look nice and green, not brown.
- Near-to-far grass should transition irregularly, with tall edge patches outside the normal lawn rather than a hard rectangular change into wheat.
- Neighbor/medium grass outside the main lawn must get thinner with distance; do not fill the whole nearby rectangle at uniform density.
- Grass near the fence should not force precision wall-rubbing; prefer sparse/already-cut grass very close to the fence instead of blocking the mower far away.
- Wind wisps should be poetic, sparse, white, and camera-billboarded, not dark moving stink-line shapes.
- Tiny wind particles should be rare; the user strongly disliked excessive green dot/block particles.
- White dandelion seeds should drift into wind beautifully, but each seed/petal needs unique opacity and lifecycle so one fading object does not fade all flowers of the same type.
- Yellow dandelion heads should pop off as a whole object on first hit, flying noticeably farther, then be destructible on a later hit.
- Yellow dandelion first-pop audio uses seven weighted variants. Current weights are `28, 24, 20, 16, 8, 3, 1`, so the first few sounds are common and the last sounds are rare.
- Mowing particles should look thrown from the side/back of the mower, not detached from it.
- Grass-cutting audio should use a short onset delay plus attack/decay smoothing because abrupt loop gating sounds bad, but the decay should stay tight enough that the layer does not smear after mowing stops.
- Reverse movement should play a comical backing-up loop.
- Protected flower beds are allowed to be destructible, but destroying them should count as mistakes rather than progress.
- Fence planks each have hidden damage and AABB-style collision from every direction. Fence collision uses `playerFenceRadius = 0.72`, larger than the blade collider, so the mower body should stop before visibly overlapping the planks. Bumps deal `1`, medium hits deal `3`, and near-full-speed hits deal `5` against `settings.fenceMaxHealth`, currently `100`. Broken planks disappear individually and stop blocking. Fence hits should not axis-slide; the mower should stop/bump instead. Bump-back distance scales by impact speed: low-speed contact should stop with no visible shove, while full boosted hits get the full bump-back distance.
- Dev settings include a Debug group with `showFenceHealth`, `fenceMaxHealth`, and `disableFenceCollision`. The health overlay creates billboard text labels over unbroken planks only while enabled, changing max health schedules a reset so planks get the new max, and disabling fence collision is an emergency fallback if the fence interaction breaks again.
- There is a hidden gun pickup outside the fence at roughly `(-33.5, -21.5)`, behind a terrain mound centered roughly near `(-25.5, -16.5)`. It should be impossible to see from the main yard area. Once picked up, HUD shows `Armed`; left click, `E`, or controller face button 2 shoots a forward line that cuts grass, damages fences, pops dandelions, and destroys protected tulips as mistakes. Shots also play `gun-shot.mp3`, draw a very short-lived fuzzy tracer, spawn dust at the final impact, and emit rare tiny grass flecks from cut blades.
- Outer ground and road now extend roughly 3x farther than before. The world terrain uses procedural value-noise height variation: mostly flat for about the first 10 meters beyond the yard, much taller farther out, and damped around the road corridor so the road does not visibly fight the terrain. Outside the flat authored lawn/road, mower height and medium/wheat grass placement reference the terrain surface. The mower rides slopes below the current steepness cutoff and blocks on too-steep hill faces.
- Dirt terrain has a transparent grass-texture overlay rather than a baked mixed texture. The overlay uses a generated high-resolution black/white-ish opacity texture, not coarse terrain vertex alpha. The mask comes from tileable layered noise whose threshold changes by distance and height: nearly solid grass near lawn edges, fading toward mostly dirt by roughly 10-20m out, with less grass on hilltops and more in lower spaces between hills. Most mask pixels should resolve close to full grass or full dirt, with only a narrow transition band.
- Texture tiling for grassy ground, dirt albedo/normal, dirt normal strength, and road pattern are exposed in the dev settings `Textures` group.
- Road and stripe texture files should not be modified by code. Runtime sampling uses filtered road textures to reduce harsh aliasing, and stripe atlas black is treated as opacity so it does not paint black rectangles over the road.
- Procedural boulders have simple circular mower-body collision in the ground plane.
- Trees farther out beyond the hilly area are on the future docket, but not implemented yet.
- Cloud shadows are currently approximated by slow directional-light intensity/specular modulation, not a real projected cloud texture.
- Keep future art additions small and cache-friendly. Current placeholders are tiny PNGs; if replacing them, prefer small tiled textures and already-compressed files. Vite fingerprints imported assets for browser caching.
- When an idea is deferred instead of implemented, add it to `BACKLOG.md` so it survives context resets.
- Keyboard steering should use the original gentle-to-fast turn acceleration curve. Controller steering should stay stable for small stick movements and only add acceleration once the left stick passes the tunable threshold, currently `0.7`.
- The HUD has a quick input-mode selector. It should only show currently available modes such as keyboard, detected controller, and detected touch; the full dev settings menu still keeps all modes for forced testing.
- The dev settings menu starts hidden in raw HTML and is only unhidden by script in dev mode, so production builds should not flicker the settings panel.
- Camera orbit controls should rest briefly after manual adjustment, then slowly return behind the mower. Each manual adjustment increases the rest delay, and after repeated adjustments the camera should stop auto-returning.
- Long grass blade tips were narrowed because the older top triangle read like a devil-tail/arrowhead.

## Useful Commands

```bash
pnpm install --frozen-lockfile
pnpm run dev
pnpm run build
pnpm run build:gh-pages
```

For release:

```bash
git checkout dev
pnpm run build:gh-pages
git tag v0.1.3
git push origin dev
git push origin v0.1.3
git checkout master
git merge --ff-only v0.1.3
git push origin master
```
