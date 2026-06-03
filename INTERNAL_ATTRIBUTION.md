# Internal Asset Attribution

This file is an internal source ledger for third-party or modified assets. It is not currently a public credits page.

Most current audio assets are expected to be CC0 or original/placeholder material, and many may be edited for loopability, level matching, timing, cleanup, or game feel. Still, keep the source trail here so releases can be audited later.

## Policy

- Prefer CC0/public-domain assets when sourcing audio or art.
- Record the original source URL before editing the file.
- Record the license as found at download time.
- Keep a short note about meaningful edits, especially trimming, looping, pitch changes, layering, denoising, or format conversion.
- If an asset is not CC0, mark whether public attribution is required before shipping a tagged release.
- Empty placeholder files should stay marked as placeholders until replaced.

## Audio Assets

| Project File                        | Status                     | Source / Author                                                                                                                                                  | License    | Modifications                       | Public Credit Needed | Notes                                                                  |
| ----------------------------------- | -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- | ----------------------------------- | -------------------- | ---------------------------------------------------------------------- |
| `src/assets/lawn-mower.mp3`         | Edited, Added              | https://www.freesound.org/people/craigsmith/sounds/482756/                                                                                                       | CC0        | Yes                                 | No                   | Looping mower engine bed.                                              |
| `src/assets/breeze.mp3`             | Edited, Added              | https://opengameart.org/content/mild-wind-background-noise (high pass)                                                                                           | CC0        | Yes                                 | No                   | Directional wind loop; volume changes based on camera facing wind.     |
| `src/assets/breeze-ambient.mp3`     | Edited, Added              | https://opengameart.org/content/mild-wind-background-noise (low pass)                                                                                            | CC0        | Yes                                 | No                   | Constant wind bed.                                                     |
| `src/assets/grass-cutting.mp3`      | Edited, Added              | https://www.freesound.org/people/mudflea2/sounds/704936/                                                                                                         | CC0        | Yes                                 | No                   | Loop active only while cutting grass.                                  |
| `src/assets/completion-fanfare.mp3` | Placeholder                | Project placeholder                                                                                                                                              | N/A        | Empty placeholder file.             | No                   | One-shot level-complete fanfare; replace with sourced/original audio.  |
| `src/assets/completion-loop.mp3`    | Placeholder                | Project placeholder                                                                                                                                              | N/A        | Empty placeholder file.             | No                   | Looping level-complete chill bed; replace with sourced/original audio. |
| `src/assets/reverse-beep.mp3`       | Added                      | Created from scratch                                                                                                                                             | (C) 2026   | N/A                                 | N/A                  | Comical reverse loop.                                                  |
| `src/assets/wall-bump.mp3`          | Edited, Added              | Combined from two separate resources: https://www.freesound.org/people/wwstudioswastaken/sounds/616295/ and https://www.freesound.org/people/j1987/sounds/79391/ | CC0 (both) | Combined, clipped, mixed two sounds | No                   | One-shot boundary bump.                                                |
| `src/assets/gun-shot.mp3`           | Placeholder                | Project placeholder                                                                                                                                              | N/A        | Empty placeholder file.             | No                   | One-shot hidden gun sound; replace with sourced/original audio.        |
| `src/assets/flower-pop-1.mp3`       | Placeholder / needs source | https://www.freesound.org/people/onehugeeye/sounds/511330/                                                                                                       | CC0        | Cropped from composition            | No                   | Yellow dandelion first-pop variant, weight 28.                         |
| `src/assets/flower-pop-2.mp3`       | Placeholder / needs source | (see first)                                                                                                                                                      | CC0        | Cropped from composition            | No                   | Yellow dandelion first-pop variant, weight 24.                         |
| `src/assets/flower-pop-3.mp3`       | Placeholder / needs source | (see first)                                                                                                                                                      | CC0        | Cropped from composition            | No                   | Yellow dandelion first-pop variant, weight 20.                         |
| `src/assets/flower-pop-4.mp3`       | Placeholder / needs source | (see first)                                                                                                                                                      | CC0        | Cropped from composition            | No                   | Yellow dandelion first-pop variant, weight 16.                         |
| `src/assets/flower-pop-5.mp3`       | Placeholder / needs source | (see first)                                                                                                                                                      | CC0        | Cropped from composition            | No                   | Yellow dandelion first-pop variant, weight 8.                          |
| `src/assets/flower-pop-6.mp3`       | Placeholder / needs source | (see first)                                                                                                                                                      | CC0        | Cropped from composition            | No                   | Yellow dandelion first-pop variant, weight 3.                          |
| `src/assets/flower-pop-7.mp3`       | Placeholder / needs source | (see first)                                                                                                                                                      | CC0        | Cropped from composition            | No                   | Yellow dandelion first-pop variant, weight 1.                          |

## Generated Or Procedural Assets

| Asset                                        | Status                | Source / Author                                              | Notes                                                                         |
| -------------------------------------------- | --------------------- | ------------------------------------------------------------ | ----------------------------------------------------------------------------- |
| Ground texture                               | Procedural            | Project code                                                 | Created at runtime in `src/textures.ts`; no external source.                  |
| Road texture                                 | Procedural            | Project code                                                 | Created at runtime in `src/textures.ts`; no external source.                  |
| Grass, dandelions, wind wisps                | Procedural meshes     | Project code                                                 | Built in Babylon.js from local mesh/material code.                            |
| `src/assets/textures/ground-grassy.png`      | Edited, Added         | https://opengameart.org/content/synthetic-grass-texture-pack | CC0 grass albedo texture                                                      |
| `src/assets/textures/Dirt_02.png`            | Added                 | https://opengameart.org/content/tileable-dirt-textures       | CC0 dirt albedo texture                                                       |
| `src/assets/textures/Dirt_02_Nrm.png`        | Added                 | https://opengameart.org/content/tileable-dirt-textures       | CC0 dirt normal map                                                           |
| `src/assets/textures/road-pattern.png`       | Generated placeholder | Project code                                                 | Tiny replaceable tiled placeholder based on the road-noise direction.         |
| `src/assets/textures/road-stripes-atlas.png` | Edited/Created        | (C) 2026                                                     | 1024x1024 hand-editable atlas with eight vertical road-stripe paint variants. |

## Release Checklist

Before tagging a public release:

- Replace remaining placeholder audio or confirm placeholders are intentional.
- Fill all `TODO` source, license, and modification fields for non-placeholder assets.
- Confirm every shipped third-party asset is CC0 or otherwise allowed for this use.
- Add public credits only if any license requires it or if the project chooses to credit voluntarily.
