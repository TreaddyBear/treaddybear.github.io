# Release Flow

Development happens on `dev`.

Do not use `main` or `master` for ongoing work. Public releases should be tagged, then `master` should be fast-forwarded to that tested tag to publish GitHub Pages.

The repository currently uses pnpm v11 and a 40-day package minimum age policy via `pnpm-workspace.yaml`. Keep using `pnpm install --frozen-lockfile` when validating releases so dependency drift does not sneak into a tag.

## Current Release State

- Latest release tag found locally: `v0.2.0`.
- Release commit: `2763b78` (`Fill in CC0 sources and licenses for audio and texture assets`).
- `origin/master` points at the latest published release marker. Local `dev` currently contains that tag and has newer release-candidate work beyond it.
- `v0.1.0` exists as the first prototype release tag, but its tag-triggered Pages deployment failed because GitHub environment protection did not allow tag deployments to `github-pages`.
- The workflow now deploys from `master` pushes. Tags are still required as release markers.
- Before the next release, confirm `git status --short --branch`, finish/stage the intended local changes, and choose the next version tag explicitly.

## Local Development

```bash
git checkout dev
pnpm run dev
```

## Release

1. Finish and test on `dev`.
2. Build locally:

```bash
pnpm run build:gh-pages
```

3. Tag the tested commit, replacing `vNEXT` with the chosen version:

```bash
git tag vNEXT
git push origin dev
git push origin vNEXT
```

4. Fast-forward `master` to the same tagged commit and push it:

```bash
git checkout master
git merge --ff-only vNEXT
git push origin master
```

## Release Candidate Smoke Check

Before tagging, run the build and do one hands-on pass:

- Start a fresh run and confirm the pause/start menu appears.
- Check desktop Escape menu and touch hamburger behavior where possible.
- Complete level 1, reload, confirm level select appears, level 2 unlocks, and level 3 remains locked until level 2 has a saved star.
- Watch the live star meter through the first and second star thresholds.
- Break a fence plank and confirm the mower can drive through the opening.
- Confirm the accident X row lights up for flower/fence mistakes without layout shift.
- Run `pnpm run build:gh-pages` or the equivalent local `tsc` plus `vite build` commands.

The `Deploy GitHub Pages` workflow publishes the current `master` release commit. Tags remain the release markers, but the Pages environment deploys from `master` because GitHub environment protection may block tag-based deployments.

## GitHub Pages Notes

The workflow lives at `.github/workflows/deploy-gh-pages.yml`. It runs on pushes to `master`, installs with pnpm, builds `dist/`, uploads the Pages artifact, and deploys it through GitHub Pages.

Before the first public deploy, GitHub repository settings still need Pages enabled for GitHub Actions as the source. If tag-based deploys are desired later, update the `github-pages` environment protection rules to allow tags such as `v*`.
