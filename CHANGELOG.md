# Changelog

## 0.5.0 (2026-11-02)

- The summary no longer calls an image unused when code the run didn't lint names it, and `--check` at a monorepo's root names the packages it skipped instead of passing.
- A first run that runs out of time reports a problem instead of passing.
- Shrunk PNGs keep their EXIF orientation, and grayscale PNGs with a color profile are left alone.
- `pngdeer.configs.recommended` for ESLint, and oxlint 1.60 or later.
- A new cache format: every image is measured again once.

[Release notes](docs/releases/0.5.0.md)

## 0.4.0 (2026-11-01)

`npx oxlint-plugin-pngdeer --check` measures images without a linter. New rule options `scan` and `exclude`. [Release notes](docs/releases/0.4.0.md)

## 0.3.1 (2026-10-31)

- A lint stopped while it measured no longer keeps the next one waiting.
- On Windows, ESLint `--concurrency` threads no longer trip over each other's cache probe.

## 0.3.0 (2026-10-31)

- Aliases come from tsconfig and jsconfig paths, resolved like TypeScript.
- `settings.pngdeer.cacheDir`: a cache you can commit, so CI and fresh clones don't measure again.
- Quieter repeated warnings, and shrinking runs in parallel.
- ESLint `--concurrency` support and a safer cache.

## 0.2.1 (2026-10-31)

- The summary says where images that no JS or TS names are used, and measures them on any run.

## 0.2.0 (2026-10-31)

- One warning per image, a summary table, and `npx oxlint-plugin-pngdeer --flagged`.
- A quality score per image, and safe ways to turn the rule off.

## 0.1.0 (2026-10-30)

- The `compressible-image` rule for oxlint and ESLint, and `npx oxlint-plugin-pngdeer` to shrink an image.
