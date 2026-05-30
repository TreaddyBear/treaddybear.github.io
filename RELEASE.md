# Release Flow

Development happens on `dev`.

Do not use `main` or `master` for ongoing work. Public GitHub Pages deploys should come from tested version tags.

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
