# Changelog

## 0.6.1 (2026-11-13)

- The package description fits npm's 250 characters; npm cut 0.6.0's in the middle of a sentence.
- The ESLint peer range stops below 11, as the README says: ESLint 9 or 10.
- The README's "Quick start with ESLint" gives the config object that makes ESLint lint and parse `.jsx` files: without one, the rule warned on nothing in a JSX app.
- Published from GitHub Actions with npm provenance; 0.6.0 was published by hand, to create the package.

## 0.6.0 (2026-11-13)

- `npx oxlint-plugin-slimdeer --review` writes a page that shows each image before and after, with a divider, and gives the command that shrinks the ones you keep ticked. `--review --flagged` does the same for what the last lint flagged. The page has a link that skips to the command, keeps its bar off the images in a short window and on paper, and says when it can't copy; `--open` says when it can't open a browser.
- `--check` now checks every package under the folder in one run, and `--json` prints one JSON document for scripts. Its exit code counts the nested packages too, so a CI step that gates on it may report more after upgrading. A lint reads what `--check` measured for an image of another package, and an image short of its target shows its best quality rounded down.
- `--format webp|avif` writes WebP or AVIF copies next to images, at the same quality score as their PNG or JPEG shrink, never over a file, and lists the code that still names the originals; `--check --format` and `--review --format` compare first. `-o OUT.webp` or `-o OUT.avif` writes one copy to OUT. `-o` now goes by OUT's extension: it refuses an OUT that ends in neither the image's own format nor .webp or .avif, or has no extension, where 0.5.0 wrote the file.
- The automatic target never goes below quality 70. An image that can't reach it is no longer flagged, and the lint and `--check` say how many there are.
- More images are flagged: CSS `url()` in JS, `srcSet` candidates with a query, variants like `logo@2x.png` in React Native and Expo projects, root paths in Nx apps, and Gatsby's `static/` (not its `public/` build output).
- An agent skill, `skills/oxlint-plugin-slimdeer`, has coding agents check the images, show you the review page, shrink only what you approve, and, when you ask, write WebP or AVIF copies and list the code that still names the originals: `npx skills add lndgalante/oxlint-plugin-slimdeer`.
- Safer: exclusions hold through links and letter case, `--flagged` refuses a list left by a lint in another folder, `--flagged` and `--review --flagged` leave out an image that changed since the lint, an image that changed while shrinking is left as it is, `-o` refuses the image itself, a read-only image is left alone, `--review` refuses a review folder that is a link, and a command printed for a file name with control characters, or one that starts with `=`, runs as printed in bash, zsh and ksh.
- In GitHub Actions, the lint and `--check` write a job summary, with the `npx` commands that review and shrink what they found, and the folder to run them in when it isn't the checkout's root.
- The command takes `--option=value`, prints one line for a usage mistake, and no longer crashes when you pipe it into `head`. On Windows, its commands write paths with `/`, and a name like `logo@2x.png` needs no PowerShell.
- A lock left by a run that died is taken over after a minute, not up to 15.
- The engine is slimdeer 0.3.1, with AVIF output. It writes the same PNG and JPEG files as before, so results in a committed cache folder carry over.
- Renamed from oxlint-plugin-pngdeer, after the engine, which HeyDeer renamed from pngdeer to slimdeer: the rule is `slimdeer/compressible-image`, with `settings.slimdeer`, the command `npx oxlint-plugin-slimdeer` and the cache folder `node_modules/.cache/slimdeer`. Images shrunk by any version are still recognized: the command keeps writing the mark `pngdeer <size>`. The lint names old settings, disable comments and cache folders; see [Moving from oxlint-plugin-pngdeer](docs/rules/compressible-image.md#moving-from-oxlint-plugin-pngdeer).
- Upgrading keeps 0.5.0's results in a committed cache folder, except automatic results that scored below 70, which are measured again once; the local cache moved to `node_modules/.cache/slimdeer`, so each machine measures its images again once.

[Release notes](docs/releases/0.6.0.md)

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
