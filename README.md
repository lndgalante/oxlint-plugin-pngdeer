<p align="center">
  <img src="https://raw.githubusercontent.com/lndgalante/oxlint-plugin-pngdeer/main/.github/logo.svg" alt="" width="128" height="128">
</p>

<h1 align="center">oxlint-plugin-pngdeer</h1>

<p align="center"><strong>Catch heavy PNGs and JPEGs on the line of code that uses them.</strong></p>

A lint rule for [oxlint](https://oxc.rs/docs/guide/usage/linter) and ESLint. It compresses the images your code uses with [pngdeer](https://github.com/heydeer/pngdeer), locally, and warns when one could be much smaller at about the same visual quality:

```
  ⚠ pngdeer(compressible-image): hero.png could be 70% smaller (509 kB → 151 kB) and look the same side by side (quality 87/100). Run: npx oxlint-plugin-pngdeer public/hero.png
    ╭─[src/App.jsx:10:16]
 10 │       <img src="/hero.png" alt="An arcade stick" />
    ·                ───────────
    ╰────
```

Compressing your images once fixes today's. The rule also catches next month's 2 MB screenshot, in your editor and in the pull request that adds it.

## Quick start

```bash
npm install --save-dev --save-exact oxlint
npm install --save-dev oxlint-plugin-pngdeer
```

In `.oxlintrc.json`:

```json
{
  "jsPlugins": ["oxlint-plugin-pngdeer"],
  "rules": { "pngdeer/compressible-image": "warn" }
}
```

```bash
npx oxlint                            # warns on each heavy image, then sums them up
npx oxlint-plugin-pngdeer --flagged   # shrinks them in place (lossy: commit first)
```

Needs Node 20.19+ or 22.12+ and oxlint 1.90+. oxlint's JS plugins are alpha, so pin oxlint's version.

## How it works

- **Local.** pngdeer, a lossy compressor like TinyPNG, ships in the package as 2 MB of WebAssembly: no upload, no API key, no native binaries, no install scripts.
- **About TinyPNG's quality.** pngdeer keeps the smallest file that scores about what TinyPNG would give the image on [SSIMULACRA2](https://github.com/cloudinary/ssimulacra2), never above 90. Its PNGs come out 8–12% smaller than TinyPNG's at the same quality ([leaderboard](https://github.com/heydeer/pngdeer#leaderboard)). For photos and screenshots with small text, set `"target": 90`.
- **Slow once, then cached.** The first run compresses every PNG and JPEG in the project, in memory, on all cores. Later lints read the cache, and editors never wait: they measure new images in the background.
- **It sees** images named in JS and TS: imports, `require`, `new URL(…, import.meta.url)`, JSX `src` and `srcSet`, and strings that start with `./`, `../`, `/` or an alias like `@/`. Images used only from CSS, HTML or Markdown get no warning, but the summary lists them.
- **Your images change only when you run the command,** which marks what it writes so it isn't flagged again.

## Performance

From `npm run bench`: an app with 200 components and 39 images (12 MB), on a 16-core M3 Max.

| | Time |
|---|---:|
| oxlint without the plugin | 68 ms |
| First run, nothing cached | 14.6 s |
| Later runs | 178 ms |
| After one image changed | 0.96 s |
| Editor's first lint, nothing cached | 171 ms |

A median image takes about 3 s of one core. On a 4-core CI runner, budget a few minutes per hundred images, or commit the cache (below). [Every scenario](https://github.com/lndgalante/oxlint-plugin-pngdeer/blob/main/bench/README.md)

## ESLint

ESLint 9 and 10 run the same rule and share oxlint's cache:

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

Your config must also parse JSX and TypeScript. Don't run this rule with `--cache`: ESLint's cache can't see images change.

## CI

Commit the results, so CI and fresh clones don't measure again:

```json
"settings": { "pngdeer": { "cacheDir": ".pngdeer" } }
```

After adding or changing images, run `npx oxlint` and commit `.pngdeer`. Set the rule to `"error"` to block merges, and run `npx oxlint --format github` for annotations on the pull request. To cache results in GitHub Actions instead, see [the cache](https://github.com/lndgalante/oxlint-plugin-pngdeer/blob/main/docs/rules/compressible-image.md#the-cache).

## Options

```json
"pngdeer/compressible-image": ["warn", { "minSavedBytes": 4096, "minSavedPercent": 10, "target": "auto" }]
```

`minSavedBytes` and `minSavedPercent` set the smallest saving worth a warning. `target` is the quality to keep: `"auto"`, or a SSIMULACRA2 score, where 90 looks identical and 80 the same side by side. [The rule's docs](https://github.com/lndgalante/oxlint-plugin-pngdeer/blob/main/docs/rules/compressible-image.md) cover the rest: paths and aliases, public folders, the cache, and turning the rule off for test fixtures.

## Limits

- **Less useful behind `next/image`, Astro's `<Image>` or an image CDN,** which re-encode images anyway.
- **Shrink each image once, with this command.** Each lossy pass costs quality, and images another tool compressed can still be flagged.
- **oxlint runs JS plugins only on 64-bit little-endian machines.** On some memory-constrained Linux machines, any JS plugin can make oxlint run out of memory ([oxc#20331](https://github.com/oxc-project/oxc/issues/20331)).
- **pngdeer fails on flat-color JPEGs and on PNGs that fade smoothly to transparent,** at most targets. They get no warning, and the lint names them on stderr.

## Development

```bash
git clone https://github.com/lndgalante/oxlint-plugin-pngdeer
cd oxlint-plugin-pngdeer
npm ci
npm test
npm run bench
cd example && npx oxlint
```

CI runs on Linux, macOS and Windows with Node 20, 22 and 24, oxlint 1.90 (and the newest, weekly), and ESLint 9.0 and 10. [FINDINGS.md](https://github.com/lndgalante/oxlint-plugin-pngdeer/blob/main/FINDINGS.md) has the design notes.

## License

[MIT](https://github.com/lndgalante/oxlint-plugin-pngdeer/blob/main/LICENSE). The engine's dependencies keep their own licenses ([engine/THIRD_PARTY_LICENSES.txt](https://github.com/lndgalante/oxlint-plugin-pngdeer/blob/main/engine/THIRD_PARTY_LICENSES.txt)), and [engine/README.md](https://github.com/lndgalante/oxlint-plugin-pngdeer/blob/main/engine/README.md) says where the engine comes from. The example images keep theirs ([example/SOURCES.md](https://github.com/lndgalante/oxlint-plugin-pngdeer/blob/main/example/SOURCES.md)). JPEG output is encoded with mozjpeg: this software is based in part on the work of the Independent JPEG Group.
