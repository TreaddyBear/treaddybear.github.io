# Release Flow

Development happens on `dev`.

Do not use `main` or `master` for ongoing work. Public GitHub Pages deploys should come from tested version tags.

The repository currently uses pnpm v11 and a 40-day package minimum age policy via `pnpm-workspace.yaml`. Keep using `pnpm install --frozen-lockfile` when validating releases so dependency drift does not sneak into a tag.

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
git tag v0.1.0
git push origin dev
git push origin v0.1.0
```

The `Deploy GitHub Pages` workflow publishes the tagged version.

## GitHub Pages Notes

The workflow lives at `.github/workflows/deploy-gh-pages.yml`. It installs with pnpm, builds `dist/`, uploads the Pages artifact, and deploys it through GitHub Pages.

Before the first public deploy, GitHub repository settings still need Pages enabled for GitHub Actions as the source. After that, pushing a `v*` tag should publish the tagged build.
