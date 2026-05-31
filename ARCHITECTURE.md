# Babylon Lawn Prototype Architecture

The prototype is still intentionally small, but the big one-file scene has been split into a few responsibility-based modules so grass, world dressing, and tuning can evolve independently.

## Current Snapshot

- Active development branch: `dev`.
- Latest release tag: `v0.1.1` at commit `97687ff`.
- GitHub Pages deploys from pushes to `master`; tags are release markers, but tag-triggered deploys were blocked by `github-pages` environment protection.
- Use `HANDOFF.md` for fresh-conversation context and `RELEASE.md` for the exact release/deploy procedure.

## Code Map

- `src/main.ts` owns the Babylon scene lifecycle, input, game loop, mowing rules, grass blades, flowers, and wind actors.
- `src/config.ts` centralizes gameplay constants, settings defaults, and the playable yard shape.
- `src/world.ts` builds static world pieces: road, neighboring yards, fence planks, and the chase camera follow behavior.
- `src/textures.ts` creates procedural dynamic textures for the ground and road.
- `src/audio.ts` owns the simple looping prototype audio layer and gracefully ignores missing, empty, or malformed audio assets.
- `src/input.ts` owns non-keyboard input stubs: browser gamepad polling and a coarse-pointer virtual touchpad.
- `src/utils/color.ts` contains color conversion and blending helpers.
- `src/utils/noise.ts` contains deterministic value-noise helpers used by grass, ground, and road variation.
- `src/utils/yard.ts` contains yard/rectangle sampling and grid key helpers.
- `src/utils/buffers.ts` contains thin-instance matrix/color buffer helpers.

## Current Game Shape

The prototype now has selectable maps. `Main` is the original L-shaped yard with a low white plank fence. `Flower Court` is a wider, different-shaped yard with a protected tulip bed in the middle. The fence should be a visual boundary, but the player should not feel forced to ram the mower into it: grass near the fence is intentionally sparse or already effectively cut, with a very small falloff close to the fence line.

The mower is a short, low box with arcade steering. `W` drives forward in the mower's facing direction, reverse drives backward, `A` and `D` steer with a hold-to-build turn response, and space is boost/run. Space must not toggle fullscreen. The chase camera follows the mower and currently feels acceptable.

Keyboard steering always uses the original hold-to-build turn acceleration curve, starting gently and building up. Controller steering is split from keyboard input and only adds acceleration once the left stick passes `controllerTurnAccelThreshold`, currently `0.7`; below that threshold it keeps the natural analog turn speed and does not reset/drop the existing turn response.

The mowing blade cuts a smaller circular area near the center of the mower, while the mower body paints pressure into the grass so grass can be pressed down separately from being cut. Wall collisions play a bump sound, nudge the mower back a little, and zero its momentum so it can ramp up again from input. Each fence plank has its own hidden damage and disappears independently when broken.

Progress is a percentage and smooth meter based on cuttable grass completion. Settings are available in development for tuning and hidden in production builds. The settings element is hidden in HTML by default and only unhidden in dev so production builds do not briefly flash the tuning panel.

Protected flowers are a new map objective type. Tulips can be destroyed by the mower, but doing so increments the mistakes meter. That is intentionally allowed physically but bad for scoring. Flower beds should be slightly raised brown soil patches with almost no grass inside them; grass may creep close at a few edges, but most grass should keep a visible buffer from the flowers.

## Grass And World

The road material uses a generated dynamic texture rather than asset loading. It layers broad value noise with much finer noise, then darkens soft bands at both road edges and down the center so the surface reads less flat without adding textures or dependencies. The road mesh extends roughly 3x farther than the original prototype road.

The outer ground is a generated terrain mesh rather than a flat ground plane. `terrainHeightAt()` keeps the area near the yard mostly flat for about 10 meters, increases rolling noise farther out, damps height near the road corridor, and includes a deliberate concealment mound between the main yard and the hidden gun. Future idea: add trees farther beyond the hilly area.

The main lawn grass tracks two influences per blade: wind sway and mower pressure. Mower pressure is painted onto blades as the mower body passes over them, and wind is reduced on blades that have been pressed down so wheel/body tracks can read separately from the ambient breeze.

The grass is rendered with thin instances and should stay dense. The main lawn uses long, noisy, clumpy grass that becomes short when cut instead of disappearing. Neighbor yards should visually meet the main lawn with no visible ground gap, use mid-length grass, and must thin out with distance. Far out-of-bounds areas should read more like patchy wheat/wilderness grass than manicured lawn, with irregular taller edge patches so the transition is not a hard box. The expanded outer world currently has five simple procedural trees as placeholders for future art direction.

Dandelions are part of the game feel. Yellow dandelions should be canary yellow and roughly dandelion-shaped. On first mow, the whole head pops off and flies farther than the current tiny petals; on the second mow it can obliterate into particles. White seed heads should be spherical and wispy rather than blocky. Breeze-triggered seed release should pull individual seeds or small random groups into the wind without fading every matching flower instance at once.

## Wind And Audio

Wind has two visual layers: sparse large S-shaped breeze wisps and very sparse tiny particulate specks. The wisps should billboard to the camera, grow along the wind path rather than visibly travel like projectiles, and stay white/wispy instead of dark. They should spawn upstream and across neighboring properties so they cross the whole scene before fading.

Audio uses MP3 files in `src/assets/`. The current intended audio set is:

- `lawn-mower.mp3`: looping mower engine, default volume `0.4`.
- `breeze.mp3`: directional looping breeze, default volume `0.6`; volume increases when the camera faces the wind.
- `breeze-ambient.mp3`: constant looping breeze bed, default volume `0.3`.
- `grass-cutting.mp3`: looping cutting layer, active only while mowing grass.
- `completion-fanfare.mp3`: one-shot level-complete fanfare placeholder.
- `completion-loop.mp3`: looping calm completion-bed placeholder.
- `reverse-beep.mp3`: looping reverse truck-beep gag, active only while moving backward.
- `flower-pop-1.mp3` through `flower-pop-7.mp3`: weighted random one-shots for yellow dandelion first-pop. The current distribution is intentionally skewed common-to-rare: 28%, 24%, 20%, 16%, 8%, 3%, and 1%.
- `wall-bump.mp3`: one-shot for fence/wall collision.

The audio loader trims loop silence for Web Audio loops and falls back gracefully for missing, empty, or malformed assets. Empty placeholder MP3 files are valid during prototyping and should not surface errors to the game. The grass-cutting loop uses a short tunable onset delay plus attack/decay smoothing so it does not snap abruptly on and off or smear too long after mowing stops; current defaults are `0.2` delay, `0.03` attack, and `0.17` decay. The reverse beep starts from reverse intent as well as actual negative speed so it feels responsive.

Grass materials are PBR and intentionally a little wet/sunny. Long and cut grass have tunable roughness, metallic, and clear-coat values in development settings. Metallic defaults to `0` because dark green metallic specular can look wrong. Keep specular intensity and clear-coat intensity restrained; use low clear-coat roughness for tighter slick glints instead of broad hazy gloss.

The main lawn and adjacent lots share grass materials, but their instance colors and height distributions differ. The main lawn is darker and denser, so highlights can be harder to see. Do not brighten the albedo to fake shine; the long blade mesh uses hand-authored leaf normals biased upward/sideways so direct sun can catch the surface more reliably.

Third-party or modified asset sources should be tracked internally in `INTERNAL_ATTRIBUTION.md`. That document is the source ledger, not a public credits page.

Production builds hide the tuning settings panel. The Vite build uses relative asset paths so the `dist/` folder can be served from GitHub Pages under a project subpath.

## Input

Controller support is currently intentionally light: left stick turns/drives, and A or right trigger boosts. Touch support exposes a virtual pad on coarse-pointer devices and feeds the same turn/throttle path as controller input.

The settings panel has a map selector plus an input mode selector with `auto`, `keyboard`, `controller`, and `touchpad`. Keyboard stays available in `auto` and `keyboard`; controller and touch are deliberately stubby but functional enough to test the path.

Camera/input control layers are prototype-simple: mouse position steers the mower while the canvas is focused in `auto` or controller-oriented modes, but not in forced `keyboard` or `touch` mode. Right mouse drag orbits the follow camera; mouse wheel zooms; controller right stick adjusts camera orbit/height. In forced `keyboard` mode, arrow keys adjust camera orbit/height. After manual camera adjustment, the camera rests for a short delay, then slowly interpolates back behind the mower; repeated manual adjustments extend the rest delay, and after enough repeats the camera stays where the player put it.

Development settings are grouped into collapsible submenus for input, debug, grass shape, grass color, grass shine, dandelions, and audio. The HUD also has a quick input-mode selector that shows only modes available on the current system, while the hidden/dev settings selector keeps all modes for forced testing.

Fence pieces are the collision source now, not an abstract yard-boundary gate. Each unbroken plank has an AABB-style blocker expanded by the mower footprint, and movement tests those boxes from every direction. Bumping a plank damages that exact plank, harder hits do more damage, and once its configurable max HP reaches zero only that plank disappears and stops blocking. The Debug settings group can show billboard health labels over unbroken planks and tune `fenceMaxHealth`, currently `100`. There is intentionally no special content beyond the fence yet.

There is one hidden gun pickup outside the fence behind a terrain mound, currently around `(-33.5, -21.5)`. It should not be visible from the main yard. Once collected, the mower can shoot forward with left click, `E`, or controller face button 2. Shots cut grass, damage fences, pop dandelions, and destroy protected tulips as mistakes.

## Package And Build Notes

Use pnpm v11. `pnpm-workspace.yaml` currently allows the `esbuild` build script and enforces `minimumReleaseAge: 57600`, which is 40 days. Keep that security setting unless the user explicitly changes it.
