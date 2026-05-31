# Project Handoff

This document is the compact handoff for starting a fresh conversation without relying on prior chat context.

## Branch And Workflow

- Active development branch: `dev`.
- Do not use `main` or `master` for day-to-day work.
- Public releases should be made from tested commits using version tags like `v0.1.0`.
- GitHub Pages deploys are handled by `.github/workflows/deploy-gh-pages.yml` on `v*` tags or manual workflow dispatch.
- The project is a Vite TypeScript Babylon.js app using `@babylonjs/core` only for runtime dependencies.
- Package manager is `pnpm@11.0.0`.
- Dependency security policy currently requires `minimumReleaseAge: 57600` in `pnpm-workspace.yaml`.
- Internal asset/source tracking lives in `INTERNAL_ATTRIBUTION.md`.

## Current Uncommitted Work

The current working tree includes uncommitted audio, input, UI, and documentation changes. Do not assume a clean tree.

Expected modified or new files include:

- `ARCHITECTURE.md`
- `HANDOFF.md`
- `INTERNAL_ATTRIBUTION.md`
- `index.html`
- `pnpm-workspace.yaml`
- `src/audio.ts`
- `src/config.ts`
- `src/input.ts`
- `src/main.ts`
- `src/style.css`
- `src/assets/breeze-ambient.mp3`
- `src/assets/completion-fanfare.mp3`
- `src/assets/completion-loop.mp3`
- `src/assets/flower-pop-1.mp3`
- `src/assets/flower-pop-2.mp3`
- `src/assets/flower-pop-3.mp3`
- `src/assets/flower-pop-4.mp3`
- `src/assets/flower-pop-5.mp3`
- `src/assets/flower-pop-6.mp3`
- `src/assets/flower-pop-7.mp3`
- `src/assets/grass-cutting.mp3`
- `src/assets/reverse-beep.mp3`
- `src/assets/wall-bump.mp3`

Known non-empty audio files at the time of this handoff:

- `src/assets/breeze.mp3`
- `src/assets/lawn-mower.mp3`

The new effect assets may be empty placeholders. That is intentional; the audio layer must handle missing, empty, or malformed MP3s gracefully.

## Last Verified State

- `pnpm install --frozen-lockfile` passed after the 40-day minimum package age setting was added.
- `pnpm run build` passed after the latest UI, audio default, individual fence plank damage, camera-return, completion-audio, and blade-shape changes.
- A browser smoke test confirmed the HUD/settings no longer overlap on desktop, the quick input selector only showed available modes on the current machine, the scene loaded, and no console errors were reported.

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
- Procedural ground and road materials.
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
- Completion UI has a fanfare one-shot hook, a looping chill-bed hook, and `Next Level` / `Close` buttons. Current completion audio files are placeholders unless replaced.
- Mistakes meter increments when protected tulips are destroyed.

## Current Tuning Defaults

Important defaults in `src/config.ts`:

- `playerSpeed = 1.65`
- `playerBoost = 1.45`
- `playerRadius = 0.75`
- `mowerCutRadius = 0.42`
- `bladeCount = 30000`
- `mediumGrassCount = 24000`
- `wheatGrassCount = 7000`
- `mapId = "main"`
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
- Fence planks each have hidden damage and AABB-style collision from every direction. Bumps deal `1`, medium hits deal `3`, and near-full-speed hits deal `5` against `10` health. Broken planks disappear individually and stop blocking. No special out-of-bounds content exists yet.
- There is a hidden gun pickup in a shallow divot outside the fence at roughly `(-31.5, -18.5)`. It is intentionally not visible from the starting area. Once picked up, HUD shows `Armed`; left click, `E`, or controller face button 2 shoots a forward line that cuts grass, damages fences, pops dandelions, and destroys protected tulips as mistakes.
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
git tag v0.1.0
git push origin dev
git push origin v0.1.0
```
