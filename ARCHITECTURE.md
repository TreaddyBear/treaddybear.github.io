# Babylon Lawn Prototype Architecture

The prototype is still intentionally small, but the big one-file scene has been split into a few responsibility-based modules so grass, world dressing, and tuning can evolve independently.

- `src/main.ts` owns the Babylon scene lifecycle, input, game loop, mowing rules, grass blades, flowers, and wind actors.
- `src/config.ts` centralizes gameplay constants, settings defaults, and the playable yard shape.
- `src/world.ts` builds static world pieces: road, neighboring yards, fence planks, and the chase camera follow behavior.
- `src/textures.ts` creates procedural dynamic textures for the ground and road.
- `src/audio.ts` owns the simple looping prototype audio layer and gracefully ignores missing, empty, or malformed audio assets.
- `src/utils/color.ts` contains color conversion and blending helpers.
- `src/utils/noise.ts` contains deterministic value-noise helpers used by grass, ground, and road variation.
- `src/utils/yard.ts` contains yard/rectangle sampling and grid key helpers.
- `src/utils/buffers.ts` contains thin-instance matrix/color buffer helpers.

The road material uses a generated dynamic texture rather than asset loading. It layers broad value noise with much finer noise, then darkens soft bands at both road edges and down the center so the surface reads less flat without adding textures or dependencies.

The main lawn grass tracks two influences per blade: wind sway and mower pressure. Mower pressure is painted onto blades as the mower body passes over them, and wind is reduced on blades that have been pressed down so wheel/body tracks can read separately from the ambient breeze.

Audio uses placeholder MP3 files in `src/assets/`. The mower and breeze loops are started after the first user gesture because browsers block autoplay; empty placeholder files are expected and handled without surfacing errors to the game.

Production builds hide the tuning settings panel. The Vite build uses relative asset paths so the `dist/` folder can be served from GitHub Pages under a project subpath.
