# Release Flow

Development happens on `dev`.

Do not use `main` or `master` for ongoing work. Public releases should be tagged, then `master` should be fast-forwarded to that tested tag to publish GitHub Pages.

The repository currently uses pnpm v11 and a 40-day package minimum age policy via `pnpm-workspace.yaml`. Keep using `pnpm install --frozen-lockfile` when validating releases so dependency drift does not sneak into a tag.

## Current Release State

- Latest release tag: `v0.1.1`.
- Release commit: `97687ff` (`Deploy Pages from release branch`).
- `dev`, `master`, `origin/dev`, and `origin/master` were aligned to `v0.1.1` after the last release push.
- `v0.1.0` exists as the first prototype release tag, but its tag-triggered Pages deployment failed because GitHub environment protection did not allow tag deployments to `github-pages`.
- The workflow now deploys from `master` pushes. Tags are still required as release markers.

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

3. Tag the tested commit:

```bash
git tag v0.1.2
git push origin dev
git push origin v0.1.2
```

4. Fast-forward `master` to the same tagged commit and push it:

```bash
git checkout master
git merge --ff-only v0.1.2
git push origin master
```

The `Deploy GitHub Pages` workflow publishes the current `master` release commit. Tags remain the release markers, but the Pages environment deploys from `master` because GitHub environment protection may block tag-based deployments.

## GitHub Pages Notes

The workflow lives at `.github/workflows/deploy-gh-pages.yml`. It runs on pushes to `master`, installs with pnpm, builds `dist/`, uploads the Pages artifact, and deploys it through GitHub Pages.

Before the first public deploy, GitHub repository settings still need Pages enabled for GitHub Actions as the source. If tag-based deploys are desired later, update the `github-pages` environment protection rules to allow tags such as `v*`.
