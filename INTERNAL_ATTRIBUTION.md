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

| Project File | Status | Source / Author | License | Modifications | Public Credit Needed | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| `src/assets/lawn-mower.mp3` | Needs source | TODO | TODO | TODO | TODO | Looping mower engine bed. |
| `src/assets/breeze.mp3` | Needs source | TODO | TODO | TODO | TODO | Directional wind loop; volume changes based on camera facing wind. |
| `src/assets/breeze-ambient.mp3` | Placeholder / needs source | TODO | TODO | TODO | TODO | Constant wind bed. |
| `src/assets/grass-cutting.mp3` | Placeholder / needs source | TODO | TODO | TODO | TODO | Loop active only while cutting grass. |
| `src/assets/completion-fanfare.mp3` | Placeholder | Project placeholder | N/A | Empty placeholder file. | No | One-shot level-complete fanfare; replace with sourced/original audio. |
| `src/assets/completion-loop.mp3` | Placeholder | Project placeholder | N/A | Empty placeholder file. | No | Looping level-complete chill bed; replace with sourced/original audio. |
| `src/assets/reverse-beep.mp3` | Placeholder / needs source | TODO | TODO | TODO | TODO | Comical reverse loop. |
| `src/assets/wall-bump.mp3` | Placeholder / needs source | TODO | TODO | TODO | TODO | One-shot boundary bump. |
| `src/assets/flower-pop-1.mp3` | Placeholder / needs source | TODO | TODO | TODO | TODO | Yellow dandelion first-pop variant, weight 28. |
| `src/assets/flower-pop-2.mp3` | Placeholder / needs source | TODO | TODO | TODO | TODO | Yellow dandelion first-pop variant, weight 24. |
| `src/assets/flower-pop-3.mp3` | Placeholder / needs source | TODO | TODO | TODO | TODO | Yellow dandelion first-pop variant, weight 20. |
| `src/assets/flower-pop-4.mp3` | Placeholder / needs source | TODO | TODO | TODO | TODO | Yellow dandelion first-pop variant, weight 16. |
| `src/assets/flower-pop-5.mp3` | Placeholder / needs source | TODO | TODO | TODO | TODO | Yellow dandelion first-pop variant, weight 8. |
| `src/assets/flower-pop-6.mp3` | Placeholder / needs source | TODO | TODO | TODO | TODO | Yellow dandelion first-pop variant, weight 3. |
| `src/assets/flower-pop-7.mp3` | Placeholder / needs source | TODO | TODO | TODO | TODO | Yellow dandelion first-pop variant, weight 1. |
| `src/assets/flower-pop.mp3` | Legacy placeholder | TODO | TODO | TODO | TODO | Old single-pop placeholder; no longer used by current audio code. Remove after confirming it is not needed. |

## Generated Or Procedural Assets

| Asset | Status | Source / Author | Notes |
| --- | --- | --- | --- |
| Ground texture | Procedural | Project code | Created at runtime in `src/textures.ts`; no external source. |
| Road texture | Procedural | Project code | Created at runtime in `src/textures.ts`; no external source. |
| Grass, dandelions, wind wisps | Procedural meshes | Project code | Built in Babylon.js from local mesh/material code. |

## Release Checklist

Before tagging a public release:

- Replace remaining placeholder audio or confirm placeholders are intentional.
- Fill all `TODO` source, license, and modification fields for non-placeholder assets.
- Confirm every shipped third-party asset is CC0 or otherwise allowed for this use.
- Add public credits only if any license requires it or if the project chooses to credit voluntarily.
