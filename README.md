<p align="center">
  <img src="https://raw.githubusercontent.com/lndgalante/oxlint-plugin-pngdeer/main/.github/logo.svg" alt="" width="128" height="128">
</p>

<h1 align="center">oxlint-plugin-pngdeer</h1>

<p align="center"><strong>Catch heavy PNGs and JPEGs on the line of code that uses them.</strong></p>

A lint rule for [oxlint](https://oxc.rs/docs/guide/usage/linter) and ESLint. It runs [pngdeer](https://github.com/heydeer/pngdeer), a lossy PNG and JPEG compressor in the spirit of TinyPNG, locally on the images your code imports or points to. When an image could be much smaller at about the same visual quality, the rule warns on that line, with the saving and the command that shrinks the file.

```
  ⚠ pngdeer(compressible-image): hero.png could be 70% smaller (509 kB → 151 kB) and look the same side by side (quality 87/100). Run: npx oxlint-plugin-pngdeer public/hero.png
    ╭─[src/App.jsx:10:16]
  9 │     <main>
 10 │       <img src="/hero.png" alt="An arcade stick" />
    ·                ───────────
 11 │       <img src={diagram} alt="Parts of a flower" />
    ╰────
```

- **Caught where it's added.** Linters don't usually open image files. This rule does, so a heavy image shows up in your editor and in the pull request that adds it.
- **Real savings.** In this repo's example app, 4 of its 6 images get flagged, and together they go from 1,028 kB to 310 kB. On the median image, pngdeer's PNGs come out 8–12% smaller than TinyPNG's at the same quality ([leaderboard](https://github.com/heydeer/pngdeer#leaderboard)).
- **TinyPNG-level quality by default.** The example's PNGs come out hard to tell apart from the originals. Its JPEG photo comes out at a level where a side-by-side comparison can show the difference. For photos, screenshots with small text or pixel-exact assets, ask for more ([how close?](https://github.com/lndgalante/oxlint-plugin-pngdeer#how-close-to-the-original)).
- **Local.** The engine is 2 MB of WebAssembly inside the package: no upload, no API key, no native binaries, no install scripts. The rule only reads your images. They change only when you run the command.
- **Slow once, then cached.** To know each saving, the first run compresses every PNG and JPEG in your project in memory: a few seconds of CPU per image, spread over your cores (about 5 s for the example app). Later lints read the results from a cache.

**Best for** Vite and React apps, static sites, and anything served as is from `public/`, where the file you commit is the file your users download. **Less useful** behind `next/image`, Astro's `<Image>` or an image CDN, which re-encode images anyway; there it mostly saves repository and build size.

**It sees** images named in JS and TS (and the script blocks of Vue, Svelte and Astro files): imports, `require`, `new URL(…, import.meta.url)`, JSX `src` and `srcSet`, and strings that start with `./`, `../`, `/` or an alias like `@/`. **It doesn't see** images used only from CSS `url()`, HTML or Markdown.

## Quick start

Needs Node 20.19+ or 22.12+ and oxlint 1.90+. oxlint's JS plugins are alpha, so pin oxlint's version:

```bash
npm install --save-dev --save-exact oxlint
npm install --save-dev oxlint-plugin-pngdeer
```

Add the plugin to `jsPlugins` (not `plugins`, which is for oxlint's built-in ones) and the rule to `rules`, next to what your `.oxlintrc.json` already has:

```json
{
  "jsPlugins": ["oxlint-plugin-pngdeer"],
  "rules": {
    "pngdeer/compressible-image": "warn"
  }
}
```

Run oxlint:

```console
$ npx oxlint
pngdeer: measuring 5 images not in the cache yet...
pngdeer: measured 5 images in 4.6 s; later runs read the cache

  ⚠ pngdeer(compressible-image): hero.png could be 70% smaller (509 kB → 151 kB) and look the same side by side (quality 87/100). Run: npx oxlint-plugin-pngdeer public/hero.png
  ⚠ pngdeer(compressible-image): photo.jpg could be 64% smaller (235 kB → 85 kB) and look close, with differences you might spot side by side (quality 76/100). Run: npx oxlint-plugin-pngdeer public/photo.jpg
  …

pngdeer: 4 flagged images could be 718 kB smaller in all (1.0 MB → 310 kB, 70% smaller):
  image                           now    after   saves  quality
  public/hero.png              509 kB → 151 kB  359 kB       87
  src/assets/diagram.png       248 kB →  63 kB  185 kB       90
  public/photo.jpg             235 kB →  85 kB  150 kB       76
  src/assets/crystal-ball.png   35 kB →  11 kB   24 kB       87
pngdeer: also 1 image that no linted JS or TS names could be 5.1 kB smaller:
  public/unused-fire.png        13 kB → 7.5 kB  5.1 kB       90  mentioned in README.md
pngdeer: quality is SSIMULACRA2, out of 100: 90+ looks identical, 80+ the same side by side, 70+ close, with differences you might spot side by side
pngdeer: to shrink the 4 flagged images in place (lossy, so commit first), run: npx oxlint-plugin-pngdeer --flagged
pngdeer: to shrink it too, run: npx oxlint-plugin-pngdeer public/unused-fire.png
```

- **Each image warns once per file,** on the line that names it, and says how close to the original it would look.
- **The table at the end** counts each image once, biggest saving first.
- **Images no JS or TS names** get their own list, since no warning can point at them. Each row says where the image is used instead: `used in src/App.css`, `mentioned in README.md` (a Markdown file that names it), or `nothing names it`, which may mean the image is unused and could be deleted. These aren't in `--flagged`; the list ends with the command for them.
- **The table is left out** with `--quiet` and in formats other programs read (`json`, `checkstyle`, `junit`, `sarif`, `gitlab`).

Then shrink what it found. There's no autofix (lint fixes can only edit code), so run the command: `--flagged` takes every image the last lint in that folder warned about, or name images yourself.

```console
$ npx oxlint-plugin-pngdeer --flagged
pngdeer: shrinking 4 images in place (lossy; commit first so you can undo)
[1/4] public/hero.png: 509 kB → 151 kB (70% smaller, quality 87/100: looks the same side by side)
[2/4] src/assets/diagram.png: 248 kB → 63 kB (75% smaller, quality 90/100: looks identical)
[3/4] public/photo.jpg: 235 kB → 85 kB (64% smaller, quality 76/100: looks close, with differences you might spot side by side)
[4/4] src/assets/crystal-ball.png: 35 kB → 11 kB (68% smaller, quality 87/100: looks the same side by side)
pngdeer: 4 images, 1.0 MB → 310 kB (718 kB smaller). Lint again to check.
```

- **It's lossy, and it writes over the file.** Commit first so git is your undo, or write a copy to compare with `-o hero.smaller.png`.
- **A warning you turn off with a comment** stays out of the table and out of `--flagged`.
- **It takes a few seconds per image,** one at a time.
- **`--flagged` uses the `target` each image was measured at.** For images you name, pass it yourself (`--target 90`), as the command in each warning does. `--help` lists the options.
- **JPEGs keep their orientation and color profile;** other camera metadata (EXIF, GPS) is dropped.
- **It marks each file it writes** with a short text tag (`pngdeer <size>`, in a PNG `tEXt` chunk or a JPEG comment), so the rule doesn't flag it again, on any machine.

Already have oxlint 1.90 or later? Install only `oxlint-plugin-pngdeer`. If yours is pinned lower, npm stops with ERESOLVE: upgrade both together.

## Using ESLint

The same rule runs in ESLint 9 and 10, and shares the cache with oxlint:

```bash
npm install --save-dev oxlint-plugin-pngdeer
```

```js
// eslint.config.js
import { defineConfig } from "eslint/config";
import pngdeer from "oxlint-plugin-pngdeer";

export default defineConfig([
  // ...your config
  {
    files: ["**/*.{js,jsx,ts,tsx}"],
    plugins: { pngdeer },
    rules: { "pngdeer/compressible-image": "warn" },
  },
]);
```

- **ESLint lints only `.js`, `.mjs` and `.cjs` files** unless a config object lists more, as `files` does above. Your config must also parse JSX and TypeScript if you use them. If `npx eslint .` doesn't print `pngdeer: measuring` on its first run, ESLint isn't linting the files that name your images.
- **With `tseslint.config(…)`**, pass the same object as one more argument.
- **ESLint's `--cache` can't see images change.** It re-lints only files whose code changed, so a warning stays after you shrink the image, until that file changes. Run this rule without `--cache`, or delete `.eslintcache` after shrinking images.

## How close to the original?

pngdeer scores every file it tries with [SSIMULACRA2](https://github.com/cloudinary/ssimulacra2), a perceptual metric, and keeps the smallest one that reaches a target score. On SSIMULACRA2's scale, at 90 an average viewer can't spot the difference even flipping between the two images; at 80, not side by side; at 70, the artifacts are visible but not annoying.

- **By default** (`"target": "auto"`), pngdeer aims for about the quality TinyPNG would give the image, never above 90. In the example app, the three flagged PNGs scored 86.9 to 89.5. The JPEG photo scored 75.5: side by side, you may spot a difference.
- **For photos, screenshots with small text, or assets that must match a design,** set `"target": 90` in the rule's options. It saves less, and images that can't reach 90 aren't flagged. In the example, the photo then saves 18% and `diagram.png` 71%. `hero.png` and `crystal-ball.png` drop out: their best scores are 88.1 and 88.0.

To judge by eye first, [try pngdeer in your browser](https://heydeer.ai/open-source/pngdeer). Nothing is uploaded.

## Why a lint rule?

- **Compressing once** with TinyPNG, Squoosh or ImageOptim fixes today's images, not next month's 2 MB screenshot. The rule keeps watching, and goes quiet once an image is fixed.
- **A build plugin** recompresses on every build, usually with one quality for all images. Here you fix the committed file once, at a quality picked for that image, and every build, deploy and clone gets the small file.
- **Lighthouse** audits the pages you test, after they ship. The rule checks every image your code names, before merge.
- **Converting to WebP or AVIF** often saves more, but means changing every reference and sometimes keeping fallbacks. This rule is for the PNGs and JPEGs you keep; it ignores other formats.

## What it costs

| | Example app, 6 images | pngdeer's test set, 155 images (76 MB) |
|---|---|---|
| First run | 4.6 s | 72 s, 4.0 GB peak memory |
| Later runs | 0.1 s for the whole lint | 41 ms to read all 155 results |

Measured on a 16-core M-series Mac ([details](https://github.com/lndgalante/oxlint-plugin-pngdeer/blob/main/FINDINGS.md)).

- **The first run compresses every PNG and JPEG in your project** (the folder with your `package.json`), not only the ones your code names, so the files linted after it find theirs cached. It skips images too small to save 4 KiB, and folders nobody ships: dependencies, build output, and test output like Playwright and Cypress snapshots.
- **It uses one engine per core, minus one (8 at most)**, within a quarter of the machine's memory. A median image takes about 3 s of one core. On a 4-core CI runner, budget a few minutes per hundred images.
- **If a first run passes 15 minutes**, it stops and reports what it measured, and the next run carries on.
- **A new plugin version with a new engine** measures everything again.
- **The package is 2.2 MB installed**, almost all of it pngdeer's engine.
- **Any oxlint JS plugin, not only this one,** makes oxlint reserve 4 GiB of virtual memory per lint thread. On some memory-constrained Linux machines, oxlint then fails with an out-of-memory panic ([oxc#20331](https://github.com/oxc-project/oxc/issues/20331)).

## In CI

`npm ci` deletes `node_modules`, and the cache with it, so restore the cache after installing, and save it even when the lint fails:

```yaml
- run: npm ci
- uses: actions/cache/restore@v4
  with:
    path: node_modules/.cache/pngdeer
    key: pngdeer-${{ github.run_id }}
    restore-keys: pngdeer-
- run: npx oxlint
- uses: actions/cache/save@v4
  if: always()
  with:
    path: node_modules/.cache/pngdeer
    key: pngdeer-${{ github.run_id }}
```

In a monorepo, each package has its own cache: list them all in both `path`s, like `packages/*/node_modules/.cache/pngdeer`.

- **To block the merge**, set the rule to `"error"`.
- **For annotations on the pull request**, run `npx oxlint --format github`. GitHub shows at most 10 per step, shared with every other rule.
- **It fails open.** If measuring fails, the rule reports what's cached, says why on stderr, and doesn't fail the lint by itself.

## In your editor

In oxlint's language server (the oxc extension) and ESLint's (VS Code, Zed, Neovim), the rule only reads the cache, so typing never waits for pngdeer. New images are measured in the background, and their warnings show up on your next edit. Running `npx oxlint` once fills the cache for the editor too.

## Options

```json
"pngdeer/compressible-image": ["warn", { "minSavedBytes": 4096, "minSavedPercent": 10, "target": "auto" }]
```

| Option | Default | |
|---|---|---|
| `minSavedBytes` | `4096` | Report only savings of at least this many bytes (Lighthouse's threshold). |
| `minSavedPercent` | `10` | …and of at least this share of the file. |
| `target` | `"auto"` | The SSIMULACRA2 score to keep, 0–100, or `"auto"`. |
| `measure` | `"auto"` | When to measure new images: `"auto"` (in the background in editors, otherwise right away), `"always"` (right away), or `"never"` (cache only). |

[The rule's page](https://github.com/lndgalante/oxlint-plugin-pngdeer/blob/main/docs/rules/compressible-image.md) covers the rest: how paths resolve, settings for other public folders and aliases, and turning the rule off for test fixtures.

## Limits

- **Images used only from CSS, HTML or Markdown aren't seen**, though the first run still measures them.
- **Shrink with this package's command.** Its mark keeps fixed files fixed. Images made smaller by pngdeer's web app or Homebrew command aren't marked, and metadata strippers (`oxipng --strip`, ImageOptim) remove the mark, so the rule measures those files again and may flag them. Don't shrink an image twice: each lossy pass costs quality.
- **Images another tool already compressed can still be flagged**, because pngdeer compares with the file you have, not the original. Compare by eye before shrinking those again.
- **oxlint runs JS plugins only on 64-bit little-endian machines** and silently skips them elsewhere.
- **Two engine bugs in this release of pngdeer.** Flat-color JPEGs (a solid-color banner, say) can't be measured at the default target, nor at most targets below about 88. PNGs with a smooth fade to transparent can't be measured at targets of 70 and above. Neither gets a warning; a lint outside the editor names them on stderr.

## Status

0.1.0. oxlint's JS plugins are alpha and don't follow semver, so pin oxlint and upgrade it on purpose. CI tests oxlint 1.90 on Linux, macOS and Windows with Node 20, 22 and 24, ESLint 9.0 and 10, and weekly against the newest oxlint.

## Development

```bash
git clone https://github.com/lndgalante/oxlint-plugin-pngdeer
cd oxlint-plugin-pngdeer
npm ci
npm test
cd example && npx oxlint
```

[FINDINGS.md](https://github.com/lndgalante/oxlint-plugin-pngdeer/blob/main/FINDINGS.md) has the design notes and measurements behind the plugin.

## License

[MIT](https://github.com/lndgalante/oxlint-plugin-pngdeer/blob/main/LICENSE). The engine's dependencies keep their own licenses ([engine/THIRD_PARTY_LICENSES.txt](https://github.com/lndgalante/oxlint-plugin-pngdeer/blob/main/engine/THIRD_PARTY_LICENSES.txt)), and [engine/README.md](https://github.com/lndgalante/oxlint-plugin-pngdeer/blob/main/engine/README.md) says where the engine comes from. The example images keep theirs ([example/SOURCES.md](https://github.com/lndgalante/oxlint-plugin-pngdeer/blob/main/example/SOURCES.md)). JPEG output is encoded with mozjpeg: this software is based in part on the work of the Independent JPEG Group.
