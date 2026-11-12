<p align="center">
  <img src="https://raw.githubusercontent.com/lndgalante/oxlint-plugin-slimdeer/main/.github/logo.svg" alt="" width="128" height="128">
</p>

<h1 align="center">oxlint-plugin-slimdeer</h1>

<p align="center"><strong>Catch heavy PNGs and JPEGs on the line of code that uses them.</strong></p>

<p align="center">
  <a href="https://www.npmjs.com/package/oxlint-plugin-slimdeer"><img src="https://img.shields.io/npm/v/oxlint-plugin-slimdeer" alt="npm version"></a>
  <a href="https://github.com/lndgalante/oxlint-plugin-slimdeer/actions/workflows/ci.yml"><img src="https://github.com/lndgalante/oxlint-plugin-slimdeer/actions/workflows/ci.yml/badge.svg" alt="CI status"></a>
</p>

A lint rule for [oxlint](https://oxc.rs/docs/guide/usage/linter) and ESLint. It runs slimdeer, a lossy compressor like TinyPNG, on your project's PNGs and JPEGs, in memory and on your machine. Then it warns, on the line of code that names an image, when that image could be much smaller at about the same visual quality:

![VS Code with the Oxc extension: "/hero.png" in App.jsx is underlined, and the hover says hero.png could be 70% smaller (509 kB → 151 kB) and gives the command that shrinks it](https://raw.githubusercontent.com/lndgalante/oxlint-plugin-slimdeer/main/docs/images/editor.png)

## Try it on your images

From your project's folder, with no setup:

```bash
npx oxlint-plugin-slimdeer --review
```

It writes a page that shows each image before and after, with the command that shrinks the ones you keep ticked. It changes no image and uploads nothing: the compressor runs inside the package as WebAssembly (slimdeer's engine, now developed upstream as [slimdeer](https://github.com/heydeer/slimdeer)). It is lossy, so commit before you shrink.

The first run takes a few seconds per image, several at a time, and later runs read the cache. The cache and the page go in `node_modules/.cache/slimdeer`. It needs Node 20.19+ or 22.12+.

![slimdeer's review page in a browser: public/hero.png, an arcade stick, split by a divider into before (509 kB) and after (151 kB), with "Quality 87/100: looks the same side by side" and Fit, 100% and 200% buttons. The bar at the bottom says "5 of 5 images ticked: could save 723 kB (1.0 MB → 317 kB, 70% smaller)" above the command that shrinks them and a Copy button](https://raw.githubusercontent.com/lndgalante/oxlint-plugin-slimdeer/main/docs/images/review.png)

- Drag the divider across an image, or switch from Fit to 100% or 200% to see the pixels. Each "after" is the file the command writes, byte for byte.
- Untick an image to keep it as it is, or press "Untick quality below 80". The bar gives the command for the rest; run it in the same folder. The lint still warns on an image you keep until you add it to the rule's [`exclude` option](#options).
- The command prints the page's address. Add `--open` to open it in your browser.

Prefer the terminal? `npx oxlint-plugin-slimdeer --check` lists the same images, then the commands that review and shrink them ([below](#check-without-a-linter)).

Savings vary by image. On pinned copies of three public projects' images, `--check` flagged all 19 of the Vue docs' guide images (74% smaller in all, 1.2 MB → 316 kB) and 4 of the Docusaurus starter's 5 (53% smaller in all), but only 2 of Starlight's 12 small portraits (7% smaller in all). On [SSIMULACRA2](https://github.com/cloudinary/ssimulacra2), the 0–100 perceptual score each warning shows, 21 of those 25 scored 89 or more, and 4 scored 73 to 78, which slimdeer calls "close, with differences you might spot side by side". These are repository bytes: an image pipeline or CDN may already re-encode what users download. [The trials](https://github.com/lndgalante/oxlint-plugin-slimdeer/blob/main/bench/TRIALS.md)

## Why a lint rule

Compressing your images once fixes today's. The rule also catches next month's 2 MB screenshot, whether you, a teammate or a coding agent adds it, in your editor and in the pull request. Vite copies `public/` to the build as it is, and Astro never optimizes images there. The usual fixes run at other moments:

| | When it runs | The committed file |
|---|---|---|
| **Build plugins** like vite-plugin-image-optimizer | during each build, lossless by default | stays heavy |
| **calibreapp/image-actions** | on pull requests, with write access; forks need extra setup | recompressed on the branch |
| **Imgbot** | in pull requests it opens, lossless by default | recompressed |
| **TinyPNG** | when someone uploads the images; its API needs a key | recompressed |
| **Lighthouse** | on a running page, estimating savings from bytes per pixel | unchanged |
| **This rule** | in your editor, lint and CI, on the line that names the image | unchanged until you run the command it gives |

## Quick start with oxlint

Needs Node 20.19+ or 22.12+ and oxlint 1.60+. oxlint's JS plugins are alpha, so pin oxlint's version:

```bash
npm install --save-dev --save-exact oxlint
npm install --save-dev oxlint-plugin-slimdeer
```

Create `.oxlintrc.json` next to `package.json`, or edit the one you have (Vite's React templates and `npx oxlint --init` create one). The package goes in `jsPlugins`, not `plugins`. If the file has `rules`, add the rule there: a second `rules` key silently replaces the first.

```json
{
  "jsPlugins": ["oxlint-plugin-slimdeer"],
  "rules": { "slimdeer/compressible-image": "warn" }
}
```

Then run `npx oxlint`. It warns on each heavy image, then sums them up.

## Quick start with ESLint

If your project already lints with ESLint 9 or 10, ESLint runs the same rule and shares oxlint's cache. Needs Node 20.19+ or 22.12+ (22.13+ for ESLint 10).

```bash
npm install --save-dev oxlint-plugin-slimdeer
```

Add the recommended config. It turns the rule on for the files the rest of your config lints:

```js
// eslint.config.js
import slimdeer from "oxlint-plugin-slimdeer";

export default [
  // ...your config, which parses your JSX or TypeScript
  slimdeer.configs.recommended,
];
```

If your config doesn't lint and parse your JSX or TypeScript files yet, [add a config object for them](https://github.com/lndgalante/oxlint-plugin-slimdeer/blob/main/docs/rules/compressible-image.md#eslint-setup).

Then run `npx eslint .`, without `--cache`: ESLint would replay old warnings for images you already shrank, and slimdeer would print no summary.

## Quick start with Vite+

Vite+ brings its own oxlint, so install only the plugin: `npm install --save-dev oxlint-plugin-slimdeer`. `vp lint`, and editors that start `vp lint --lsp`, read the `lint` block of `vite.config.ts`, not `.oxlintrc.json`:

```ts
// vite.config.ts
import { defineConfig } from "vite-plus";

export default defineConfig({
  // ...your config
  lint: {
    jsPlugins: ["oxlint-plugin-slimdeer"],
    rules: { "slimdeer/compressible-image": "warn" },
  },
});
```

Then run `npx vp lint`.

## What a lint shows

Each warning ends with the command that shrinks its image. After the warnings, slimdeer sums them up, each image once, biggest saving first (here in `example/`, shortened):

```
slimdeer: 4 flagged images could be 718 kB smaller in all (1.0 MB → 310 kB, 70% smaller):
  image                           now    after   saves  quality
  public/hero.png              509 kB → 151 kB  359 kB       87
  src/assets/diagram.png       248 kB →  63 kB  185 kB       90
  public/photo.jpg             235 kB →  85 kB  150 kB       76
  src/assets/crystal-ball.png   35 kB →  11 kB   24 kB       87
…
slimdeer: to see the 4 flagged images before and after on one page first, run: npx oxlint-plugin-slimdeer --review --flagged
slimdeer: to shrink the 4 flagged images in place (lossy, so commit first), run: npx oxlint-plugin-slimdeer --flagged
```

`--review --flagged` writes the review page for exactly the images the lint flagged, each at the target the lint measured it at, so images the rule's `exclude` option or a disable comment leaves out stay out. `--flagged` shrinks them in place. Both leave out, and name, an image whose bytes changed since the lint; lint again to check it. With one flagged image, the summary offers a preview as a new file instead, like `npx oxlint-plugin-slimdeer public/photo.jpg -o photo.preview.jpg`. The summary also lists images no linted code names, like a background in a CSS file, with where each one is named.

The shrink command marks what it writes, so the rule doesn't flag it again, and keeps each file's name and format, so no code changes. Each lossy pass costs quality, so shrink an image once. An image another tool already compressed can still be flagged: look at it on the review page first.

No warnings at all? [Go through this list](https://github.com/lndgalante/oxlint-plugin-slimdeer/blob/main/docs/rules/compressible-image.md#no-warnings).

## Check without a linter

`--check` measures without changing any image and needs no linter setup. It checks every package below the folder, warms the lint's cache, and ends with the commands that review and shrink what it lists. It reads no linter configuration, and neither does plain `--review`: pass the rule's options, like its `exclude` as `--exclude`. It exits 0 when no image clears both thresholds, 1 when one does, and 2 on a mistake in the arguments or when an image or folder couldn't be checked, so a CI step can gate on it. `--json` prints one JSON document on stdout instead, for scripts. [Options, exit codes and the JSON](https://github.com/lndgalante/oxlint-plugin-slimdeer/blob/main/docs/rules/compressible-image.md#check-images-without-changing-them)

## For coding agents

An agent adds images as easily as you do, and the rule warns on them in the agent's own lint run. [The agent skill](https://github.com/lndgalante/oxlint-plugin-slimdeer/blob/main/skills/oxlint-plugin-slimdeer/SKILL.md) in this repository has a coding agent measure your images with `--check --json`, give you the review page's address, and shrink only the images you approve:

```bash
npx skills add lndgalante/oxlint-plugin-slimdeer
```

Without it, ask the agent to run `npx oxlint-plugin-slimdeer --review` (after a lint, `--review --flagged`) and give you the page's address: without `--open`, it opens nothing and prints the address. The page's command shrinks only the images you keep ticked; run it, or paste it back to the agent.

## What gets flagged

The rule reads imports, `require`, `new URL(…, import.meta.url)`, JSX `src` and `srcSet`, CSS `url()` in inline styles and CSS-in-JS templates, and strings that start with `./`, `../`, `/` or an alias like `@/`, in JS and TS and in the script parts of Vue, Svelte and Astro files. In React Native and Expo projects, `@2x` and platform variants count with the image they belong to. Images named only from CSS files, HTML or Markdown get no warning, but the summary lists them, and `--check` and `--review` include them. An image is flagged when it could be at least 4 KiB and 10% smaller.

By default, slimdeer picks a quality for each image, about what TinyPNG would give it, and never below 70: below that, it calls a result "visibly different". An image it can't make smaller at 70 or above isn't flagged, and the shrink command leaves it as it is. The lint says how many it turned down as it measures, and `--check` names them:

```
slimdeer: 1 image can't be made smaller without a visible difference (its best quality is below 70), so it isn't listed; to try it at a lower target, run: npx oxlint-plugin-slimdeer --check public/fade.png --target 60
```

Above the floor, a score in the 70s still means "close, with differences you might spot side by side", like `photo.jpg` above: look at those on the review page before you shrink them. [What it flags, and what it skips](https://github.com/lndgalante/oxlint-plugin-slimdeer/blob/main/docs/rules/compressible-image.md#what-it-flags)

## Editors

Warnings show in editors that run your project's oxlint as a language server: the [Oxc extension](https://github.com/oxc-project/oxc-vscode) for VS Code and its forks, Zed's Oxc extension (when `package.json` lists `oxlint` or `vite-plus`), and Neovim's `oxlint` config. With ESLint, ESLint's own editor extensions run the rule.

By default, the editor never waits for slimdeer, which measures images in the background. A file shows its warnings the next time the editor lints it, usually when you type in it. Lint once from the command line first, or commit the cache (see CI below), and the warnings are there when you open a file.

## CI

Lint each pull request, with annotations on the lines that name heavy images:

```yaml
# .github/workflows/images.yml
name: Images
on: pull_request
permissions:
  contents: read
jobs:
  lint:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
      - uses: actions/setup-node@v7
        with:
          node-version: 24
      - run: npm ci
      - run: npx oxlint --format github
```

A pull request that adds a heavy image then gets a warning on the line that uses it ([see it live](https://github.com/lndgalante/slimdeer-demo/pull/1/files)):

![A GitHub pull request's Files changed tab: under the added line that uses /hero.png, a check warning from slimdeer(compressible-image) says hero.png could be 70% smaller (509 kB → 151 kB) and gives the command that shrinks it](https://raw.githubusercontent.com/lndgalante/oxlint-plugin-slimdeer/main/docs/images/pull-request.png)

With ESLint, run `npx eslint .`: `actions/setup-node` turns its output into annotations. With Vite+, run `npx vp lint --format github`. GitHub annotates at most 10 warnings and 10 errors per step, your other lint warnings included. slimdeer also writes the job summary, with no option or permission: a table of the flagged images (up to 200) and the commands that review and shrink them.

### Commit the cache

Without it, CI measures every image on every run, two at a time on a 2-core runner (GitHub's default for private repositories).

1. Name a folder in `settings`: next to `rules` in `.oxlintrc.json`, in a config object in ESLint, or in the `lint` block of `vite.config.ts`.
   ```json
   "settings": { "slimdeer": { "cacheDir": ".slimdeer" } }
   ```
2. Fill it. This copies what your machine has measured and measures the rest; from a monorepo's root, it fills each package's folder. If the rule sets a `target`, pass the same `--target`. It exits 1 when it lists images that could be smaller: a finding, not a failure.
   ```bash
   npx oxlint-plugin-slimdeer --check --cache-dir .slimdeer
   ```
3. Commit the folder, and again after adding or changing images. To clear old entries, or to cache in GitHub Actions instead, see [the cache](https://github.com/lndgalante/oxlint-plugin-slimdeer/blob/main/docs/rules/compressible-image.md#the-cache).

### Block only new heavy images

Set the rule to `"error"` to fail the check. To let through the heavy images you already have, list them in the rule's `exclude` option: from the next lint on, they are no longer measured or reported, and `--flagged` leaves them alone (it shrinks what the last lint flagged). ESLint 9.24+ can also [suppress them](https://github.com/lndgalante/oxlint-plugin-slimdeer/blob/main/docs/rules/compressible-image.md#turning-it-off).

## Options

Pass options after the severity, like `["warn", { "exclude": ["public/originals", "**/fixtures/**"] }]`:

- `exclude` (default `[]`) leaves out paths or patterns, relative to the project's folder.
- `target` (`"auto"`) is the quality to keep: `"auto"`, or a SSIMULACRA2 score, where 90 looks identical and 80 the same side by side.
- `minSavedBytes` (`4096`) and `minSavedPercent` (`10`) set the smallest saving worth a warning. An image must clear both.
- `scan` (`"project"`): `"referenced"` measures only the images the linted files name, for linting a few files. [Compare them](https://github.com/lndgalante/oxlint-plugin-slimdeer/blob/main/bench/README.md#comparing-scan-scopes).

With ESLint's recommended config, set the rule again in a config object after it. [All options](https://github.com/lndgalante/oxlint-plugin-slimdeer/blob/main/docs/rules/compressible-image.md#options)

## Questions

- **Does it upload my images?** No. The engine ships in the package as 2 MB of WebAssembly: no upload, no API key, no dependencies, no native binaries, no install scripts.
- **Is it lossless?** No. By default, slimdeer keeps the smallest file that scores about what TinyPNG would give the image on SSIMULACRA2, a 0–100 score of how close an image looks to its original, shown in each warning. In slimdeer's own benchmark of 180 PNGs, the median file is 8–12% smaller than TinyPNG's at the same quality ([leaderboard](https://github.com/heydeer/slimdeer/blob/a8e88267ba02cbaf66e746db93ed04242dca8450/README.md#leaderboard)). For photos and screenshots with small text, try `"target": 90` and compare.
- **How is it different from TinyPNG or Squoosh?** Both compress the images you hand them. TinyPNG uploads each one, and its API needs a key, with 500 free compressions a month. Squoosh runs in your browser, one image at a time, at the settings you pick. slimdeer runs on your machine, picks the quality per image, and finds the images that need it in your code.
- **Does it help behind `next/image`, Astro's `<Image>` or an image CDN?** Less: they re-encode images for visitors anyway, so shrinking those mostly saves repository and build size, and adds a second lossy pass. Behind `next/image`, the warning says so. Leave those folders out with `exclude`. Images served as they are still count: plain `<img>`, CSS backgrounds, and `public/` in Vite and Astro. [When not to use it](https://github.com/lndgalante/oxlint-plugin-slimdeer/blob/main/docs/rules/compressible-image.md#when-not-to-use-it)
- **Why not WebP or AVIF?** It keeps each image's name and format, so no code or reference changes. WebP, AVIF, GIF and SVG files aren't measured.
- **How slow is the first run?** The first lint measures every PNG and JPEG in the project, one engine per core (8 at most); later lints read the cache. On a 16-core M3 Max, the first lint of an app with 39 images (12 MB) took 14.6 s and peaked at 3.0 GB of memory, and later lints took 178 ms, against 68 ms without the plugin (version 0.3.0, the same engine as today's). Since 0.6.0, an image whose automatic result scores below 70 is compressed a second time, at 70: on tanstack.com's 148 images, that took 8.5% more CPU time than 0.5.0, in the same wall time. [The benchmark](https://github.com/lndgalante/oxlint-plugin-slimdeer/blob/main/bench/README.md)
- **Does it need oxlint?** No. `--check`, `--review` and the shrink command run alone, and ESLint 9 and 10 run the same rule.
- **Where doesn't it work?** oxlint runs JS plugins only on 64-bit little-endian machines, and on some memory-constrained Linux machines any JS plugin can make oxlint run out of memory ([oxc#20331](https://github.com/oxc-project/oxc/issues/20331)). slimdeer fails on some images, like flat-color JPEGs, and the rule skips others, like grayscale PNGs with a color profile; a command-line lint names them on stderr. [What it skips](https://github.com/lndgalante/oxlint-plugin-slimdeer/blob/main/docs/rules/compressible-image.md#what-it-skips)

## Learn more

[The rule's docs](https://github.com/lndgalante/oxlint-plugin-slimdeer/blob/main/docs/rules/compressible-image.md) cover every option and setting, `--check`, `--review`, paths and aliases, the cache, and upgrading. Also: [CHANGELOG.md](https://github.com/lndgalante/oxlint-plugin-slimdeer/blob/main/CHANGELOG.md), [FINDINGS.md](https://github.com/lndgalante/oxlint-plugin-slimdeer/blob/main/FINDINGS.md) (design notes) and [CONTRIBUTING.md](https://github.com/lndgalante/oxlint-plugin-slimdeer/blob/main/CONTRIBUTING.md).

## Showcase

[Multabot](https://multabot.com.ar) tracks traffic fines in Argentina. It ran slimdeer's command line on three images that its Astro site, on Cloudflare Pages, serves from `public/` as they are. At `--target 90`, the quality suggested above for photos and screenshots with small text, they became 67% smaller in all (965 kB → 317 kB). Multabot shipped the compressed files: on November 2, 2026, the site served each one byte for byte. Two are below. The third, an annotated screenshot of a partner's site, went from 485,329 to 190,091 bytes (61% smaller). [The full report](https://github.com/lndgalante/oxlint-plugin-slimdeer/blob/main/docs/showcase.md#multabot)

| Original | Compressed at quality 90 |
|---|---|
| ![Multabot's social preview: the headline "Las multas de tu flota, en un solo tablero." beside a glowing dotted map of Argentina and a list of speeding fines](https://raw.githubusercontent.com/lndgalante/oxlint-plugin-slimdeer/main/docs/images/showcase/multabot/opengraph.png)<br>Social preview · 370,801 bytes | ![Compressed social preview with the same headline, map and list of fines](https://raw.githubusercontent.com/lndgalante/oxlint-plugin-slimdeer/main/docs/images/showcase/multabot/opengraph.optimized.png)<br>66,520 bytes · 82% smaller |
| ![Photo of a man smiling at a laptop that shows a fleet dashboard, with trucks outside the window](https://raw.githubusercontent.com/lndgalante/oxlint-plugin-slimdeer/main/docs/images/showcase/multabot/flotas.jpg)<br>Blog photo · 108,899 bytes | ![Compressed photo of the same man, laptop and trucks](https://raw.githubusercontent.com/lndgalante/oxlint-plugin-slimdeer/main/docs/images/showcase/multabot/flotas.optimized.jpg)<br>60,161 bytes · 45% smaller |

Using slimdeer in a real project? We'd like to feature more. [Share yours in an issue](https://github.com/lndgalante/oxlint-plugin-slimdeer/issues/new?template=showcase.yml): what it caught, how much smaller the images became, and whether the result looked good enough to ship. [A prompt](https://github.com/lndgalante/oxlint-plugin-slimdeer/blob/main/docs/showcase.md#a-prompt-to-share) helps a coding assistant draft one.

## License

[MIT](https://github.com/lndgalante/oxlint-plugin-slimdeer/blob/main/LICENSE). The engine's dependencies keep their own licenses ([engine/THIRD_PARTY_LICENSES.txt](https://github.com/lndgalante/oxlint-plugin-slimdeer/blob/main/engine/THIRD_PARTY_LICENSES.txt)), and [engine/README.md](https://github.com/lndgalante/oxlint-plugin-slimdeer/blob/main/engine/README.md) says where the engine comes from. The example images keep theirs ([example/SOURCES.md](https://github.com/lndgalante/oxlint-plugin-slimdeer/blob/main/example/SOURCES.md)), and the MIT license doesn't cover the showcase images. JPEG output is encoded with mozjpeg: this software is based in part on the work of the Independent JPEG Group.
