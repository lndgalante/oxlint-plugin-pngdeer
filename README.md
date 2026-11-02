<p align="center">
  <img src="https://raw.githubusercontent.com/lndgalante/oxlint-plugin-pngdeer/main/.github/logo.svg" alt="" width="128" height="128">
</p>

<h1 align="center">oxlint-plugin-pngdeer</h1>

<p align="center"><strong>Catch heavy PNGs and JPEGs on the line of code that uses them.</strong></p>

<p align="center">
  <a href="https://www.npmjs.com/package/oxlint-plugin-pngdeer"><img src="https://img.shields.io/npm/v/oxlint-plugin-pngdeer" alt="npm version"></a>
  <a href="https://github.com/lndgalante/oxlint-plugin-pngdeer/actions/workflows/ci.yml"><img src="https://github.com/lndgalante/oxlint-plugin-pngdeer/actions/workflows/ci.yml/badge.svg" alt="CI status"></a>
</p>

A lint rule for [oxlint](https://oxc.rs/docs/guide/usage/linter) and ESLint. It compresses the images your code uses with [pngdeer](https://github.com/heydeer/pngdeer), locally, and warns when one could be much smaller at about the same visual quality:

```
  ⚠ pngdeer(compressible-image): hero.png could be 70% smaller (509 kB → 151 kB) and look the same side by side (quality 87/100). Run: npx oxlint-plugin-pngdeer public/hero.png
    ╭─[src/App.jsx:10:16]
 10 │       <img src="/hero.png" alt="An arcade stick" />
    ·                ───────────
    ╰────
```

Compressing your images once fixes today's. The rule also catches next month's 2 MB screenshot, in your editor and in the pull request that adds it.

## Try it on your images

From your project's folder, the one with `package.json`:

```bash
npx oxlint-plugin-pngdeer --check
```

It checks the PNGs and JPEGs under it without changing them, including images used only from CSS or HTML, and ends with the commands that preview the biggest saving as a new file and shrink the images in place. It skips dependencies, build and test output, dot folders, and nested packages, which it names with the command that checks them. To check only some folders or files, name them: `--check public src/assets`.

It reports savings of at least 4096 bytes (4.1 kB) and 10%, and warms the cache for later lints, in `node_modules/.cache/pngdeer` next to the nearest `package.json` (or in the current folder, if there is none). No linter configuration is needed. Exit codes are `0` for no qualifying savings, `1` for savings found, and `2` if the check could not finish or found no images outside the nested packages it skipped.

Use `--target 90`, `--min-saved-bytes 8192`, or `--exclude "public/originals/**"` to adjust the check. It does not read your linter's options or change the list used by `--flagged`. [Check command details](https://github.com/lndgalante/oxlint-plugin-pngdeer/blob/main/docs/rules/compressible-image.md#check-images-without-changing-them)

Automatic, lossy compression of the included crystal-ball image saved **24,296 bytes (68.5%)**:

| Original · 35,475 bytes | Compressed · 11,179 bytes |
|---|---|
| ![Original purple crystal ball with yellow stars](https://raw.githubusercontent.com/lndgalante/oxlint-plugin-pngdeer/main/example/src/assets/crystal-ball.png) | ![Compressed purple crystal ball with yellow stars](https://raw.githubusercontent.com/lndgalante/oxlint-plugin-pngdeer/main/docs/images/crystal-ball.optimized.png) |

The compressed gradients show added texture. Compare previews at full size before replacing your own images; savings and visible differences vary by image.

On pinned copies of three public projects' images, `--check` flagged all 19 of the Vue docs' guide images, 74% smaller in all (1.2 MB → 316 kB), and 4 of the Docusaurus starter's 5 images, 53% smaller in all. It flagged only 2 of Starlight's 12 small portraits, 7% smaller in all. These are repository bytes: an image pipeline or CDN may already re-encode what users download. [The trials](https://github.com/lndgalante/oxlint-plugin-pngdeer/blob/main/bench/TRIALS.md)

## Why a lint rule

Vite copies `public/` to the build as is, and compresses imported images only with a plugin. The usual fixes run at other moments:

- **Build plugins** like vite-plugin-image-optimizer re-encode during the build, at a quality you set. The committed file stays heavy.
- **calibreapp/image-actions** commits recompressed images to the pull request's branch, so it needs write access, and without extra setup it doesn't work on pull requests from forks. Imgbot opens its own pull requests, lossless by default.
- **TinyPNG and ImageOptim** work when someone remembers to run them. TinyPNG uploads each image, and its API needs a key.
- **Lighthouse** reports heavy images on a page that is already running.

This rule shows the saving on the line that uses the image, with the command that applies it. It never changes an image by itself, and it picks a quality for each image with a perceptual score.

## Quick start with oxlint

```bash
npm install --save-dev --save-exact oxlint
npm install --save-dev oxlint-plugin-pngdeer
```

Create `.oxlintrc.json` next to `package.json`. If you have one (Vite's React templates and `npx oxlint --init` create one), add `jsPlugins` and put the rule in its `rules`: a second `rules` key would silently replace the first. The package goes in `jsPlugins`, not `plugins`:

```json
{
  "jsPlugins": ["oxlint-plugin-pngdeer"],
  "rules": { "pngdeer/compressible-image": "warn" }
}
```

```bash
npx oxlint                            # warns on each heavy image, then sums them up
# preview one warning's image as a new file, and compare it with the original:
npx oxlint-plugin-pngdeer public/hero.png -o hero.preview.png
npx oxlint-plugin-pngdeer --flagged   # shrinks them in place (lossy: commit first)
```

Needs Node 20.19+ or 22.12+ and oxlint 1.60+. oxlint's JS plugins are alpha, so pin oxlint's version.

## Quick start with ESLint

In a project that already lints with ESLint 9 or 10, ESLint runs the same rule and shares oxlint's cache. New Vite React apps come with oxlint instead: see above.

```bash
npm install --save-dev oxlint-plugin-pngdeer
```

If your config already parses your JSX or TypeScript, add the recommended config. It turns the rule on for the files the rest of your config lints:

```js
// eslint.config.js
import pngdeer from "oxlint-plugin-pngdeer";

export default [
  // ...your config, which parses your JSX or TypeScript
  pngdeer.configs.recommended,
];
```

Otherwise, give the rule only files your config already parses. ESLint's default parser reads plain JavaScript, without JSX or TypeScript. For JavaScript with JSX:

```js
// eslint.config.js
import pngdeer from "oxlint-plugin-pngdeer";

export default [
  // ...your config
  {
    files: ["**/*.{js,jsx}"],
    languageOptions: { parserOptions: { ecmaFeatures: { jsx: true } } },
    plugins: { pngdeer },
    rules: { "pngdeer/compressible-image": "warn" },
  },
];
```

For TypeScript, with [typescript-eslint](https://typescript-eslint.io/getting-started/) installed. It needs TypeScript 6.0 or older, and most of Vite's TypeScript templates (all but Vue's and Svelte's) now come with TypeScript 7: there, install both with `npm install --save-dev typescript@~6.0 typescript-eslint`, or use oxlint.

```js
// eslint.config.js
import tseslint from "typescript-eslint";
import pngdeer from "oxlint-plugin-pngdeer";

export default [
  // ...your config
  {
    files: ["**/*.{ts,tsx}"],
    languageOptions: { parser: tseslint.parser },
    plugins: { pngdeer },
    rules: { "pngdeer/compressible-image": "warn" },
  },
];
```

A project with both kinds of file uses both objects. Then run `npx eslint .`. A `Parsing error: Unexpected token` on JSX or on a type means the rule runs on a file your config doesn't parse. In `eslint.config.ts`, the plugin's types work with `defineConfig`.

Don't run this rule with `--cache`: ESLint replays old warnings for files that didn't change, so it keeps flagging an image you already shrank, and pngdeer prints no summary.

Needs ESLint 9 or 10, and Node 20.19+ or 22.12+ (22.13+ for ESLint 10).

## Quick start with Vite+

Vite+ brings its own oxlint, so install only the plugin:

```bash
npm install --save-dev oxlint-plugin-pngdeer
```

`vp lint`, and editors that start `vp lint --lsp`, read the `lint` block of `vite.config.ts`, not `.oxlintrc.json`:

```ts
// vite.config.ts
import { defineConfig } from "vite-plus";

export default defineConfig({
  // ...your config
  lint: {
    jsPlugins: ["oxlint-plugin-pngdeer"],
    rules: { "pngdeer/compressible-image": "warn" },
  },
});
```

Then run `npx vp lint`. Vite+ 1.4 brings oxlint 1.89.

## Editors

The rule runs wherever your project's oxlint runs as a language server: the [Oxc extension](https://github.com/oxc-project/oxc-vscode) for VS Code and its forks, Zed's Oxc extension, and Neovim's `oxlint` config. They start the project's `oxlint --lsp`, or `vp lint --lsp` in a Vite+ project, so install oxlint in the project. Zed uses the project's copy only if `package.json` lists `oxlint` or `vite-plus`. With ESLint, ESLint's own editor extensions run the rule the same way.

The editor never waits for pngdeer. The first file it lints starts measuring in the background: that file's images first, then the rest of the project's, the same work as a first `npx oxlint`. A file shows its warnings the next time the editor lints it, usually when you type in it. Run `npx oxlint` (or `npx eslint .`) once first, or commit the cache, and the warnings are there when you open a file.

## CI

Commit the results, so CI and fresh clones don't measure again. In `.oxlintrc.json`, `settings` sits next to `rules`; in ESLint, put it in a config object; with Vite+, in the `lint` block of `vite.config.ts`:

```json
"settings": { "pngdeer": { "cacheDir": ".pngdeer" } }
```

Fill that folder and commit it. This copies what your machine has already measured and measures the rest:

```bash
npx oxlint-plugin-pngdeer --check --cache-dir .pngdeer
```

If the rule sets a `target`, pass the same `--target`. In a monorepo, name each package's folder. After adding or changing images, lint again and commit `.pngdeer`. Entries for images that changed or were shrunk stay in it; to drop them, delete the folder and run the same `--check` command again, which copies what your machine has measured.

Then lint each pull request, with annotations on the lines that name heavy images:

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

With ESLint, run `npx eslint .`: ESLint has no `github` format, but `actions/setup-node` turns its default output into annotations. With Vite+, run `npx vp lint --format github`: its oxlint isn't in `node_modules/.bin`, and it reads `vite.config.ts`, not `.oxlintrc.json`. GitHub shows at most 10 warning and 10 error annotations per step, and 50 per job, shared with your other lint warnings. pngdeer's summary in the job log has the total.

Without a committed cache, CI measures every image on every run, and a 2-core runner, GitHub's default for private repositories, measures one image at a time. A first run that passes 15 minutes stops and reports one problem saying how many images it didn't measure (with ESLint's `--concurrency`, one per thread). To cache results in GitHub Actions instead of committing them, see [the cache](https://github.com/lndgalante/oxlint-plugin-pngdeer/blob/main/docs/rules/compressible-image.md#the-cache).

### Block only new heavy images

Set the rule to `"error"` to fail the check. If the project already has heavy images you won't shrink yet:

- **oxlint:** list them in the rule's `exclude` option. They are no longer measured or reported, and `--flagged` leaves them alone.
- **ESLint 9.24+:** run `npx eslint --suppress-rule pngdeer/compressible-image` once and commit `eslint-suppressions.json`. ESLint stops reporting the existing images and fails on new ones. pngdeer's summary still lists the existing ones and `--flagged` still shrinks them, so shrink a new image with the command in its warning. After shrinking an existing one, run `npx eslint --prune-suppressions`.

## How it works

- **Local.** pngdeer, a lossy compressor like TinyPNG, ships in the package as 2 MB of WebAssembly: no upload, no API key, no dependencies, no native binaries, no install scripts.
- **About TinyPNG's quality.** pngdeer keeps the smallest file that scores about what TinyPNG would give the image on [SSIMULACRA2](https://github.com/cloudinary/ssimulacra2), a 0–100 score of how close an image looks to its original (90 looks identical). Its automatic quality target is capped at 90; output scores can be higher. In pngdeer's own benchmark of 180 PNGs, the median file is 8–12% smaller than TinyPNG's at the same quality ([leaderboard](https://github.com/heydeer/pngdeer#leaderboard)). Scores estimate perceptual similarity; they do not guarantee identical appearance. For photos and screenshots with small text, try `"target": 90` and compare the output.
- **Slow once, then cached.** By default, the first run compresses every PNG and JPEG in the project, in memory, with up to eight workers. Later lints read the cache. Use `"scan": "referenced"` to measure only images named in the files being linted.
- **It sees** images named in JS and TS, and in the script parts of Vue, Svelte and Astro files (Astro's frontmatter included): imports, `require`, `new URL(…, import.meta.url)`, JSX `src` and `srcSet`, and strings that start with `./`, `../`, `/` or an alias like `@/`. Images used only from CSS, HTML, Markdown or a Vue, Svelte or Astro template get no warning, but the summary lists them and `--check` reports them.
- **Your images change only when you run the command,** which marks what it writes so it isn't flagged again.

## Performance

From `npm run bench` with version 0.3.0 (the engine hasn't changed since): an app with 200 components and 39 images (12 MB), on a 16-core M3 Max with 52 GB.

| | Time |
|---|---:|
| oxlint without the plugin | 68 ms |
| First run, nothing cached | 14.6 s |
| Later runs | 178 ms |
| After one image changed | 0.96 s |
| ESLint's language server, first lint, nothing cached | 171 ms |

Measuring runs in worker threads, one per core minus one (8 at most), within an estimated budget of a quarter of the machine's memory, or of a container's limit, up to 4 GB per batch. One image always runs, even over budget, and the linter's own memory comes on top. In the benchmark, the first run peaked at 3.0 GB, and ESLint's language server at 3.1 GB while it measured in the background. Checking the example app's 6 images peaks at about 0.7 GB. A median image takes 1 to 3 s of one core. [Every scenario](https://github.com/lndgalante/oxlint-plugin-pngdeer/blob/main/bench/README.md)

## Options

```json
"pngdeer/compressible-image": ["warn", { "minSavedBytes": 4096, "minSavedPercent": 10, "target": "auto" }]
```

`minSavedBytes` and `minSavedPercent` set the smallest saving worth a warning. `target` is the quality to keep: `"auto"`, or a SSIMULACRA2 score, where 90 looks identical and 80 the same side by side. [The rule's docs](https://github.com/lndgalante/oxlint-plugin-pngdeer/blob/main/docs/rules/compressible-image.md) cover the rest: paths and aliases, public folders, the cache, and excluding test fixtures.

For a targeted lint, limit work to images that its source files reference and exclude originals or fixtures:

```json
"pngdeer/compressible-image": ["warn", {
  "scan": "referenced",
  "exclude": ["public/originals", "**/fixtures/**"]
}]
```

Exclusions also suppress warnings on direct references. The default `"scan": "project"` batches images in parallel and can be faster for a full cold lint; referenced mode is useful when linting a few files. [Compare both scopes](https://github.com/lndgalante/oxlint-plugin-pngdeer/blob/main/bench/README.md#comparing-scan-scopes)

## Limits

- **Less useful behind `next/image`, Astro's `<Image>` or an image CDN,** which re-encode images for users anyway. The rule flags the images they serve like any other, and `--flagged` shrinks them too. For those, shrinking mostly saves repository and build size, and adds a second lossy pass, so leave their folders out with `exclude`. Images served as they are still count: plain `<img>`, CSS backgrounds, Next's `opengraph-image` and `icon` files, and every image when `images.unoptimized` is set.
- **Shrink each image once, with this command.** Each lossy pass costs quality, and images another tool compressed can still be flagged.
- **oxlint runs JS plugins only on 64-bit little-endian machines.** On some memory-constrained Linux machines, any JS plugin can make oxlint run out of memory ([oxc#20331](https://github.com/oxc-project/oxc/issues/20331)).
- **Some images get no warning.** pngdeer fails on flat-color JPEGs at the default target and at some others, and on PNGs that fade smoothly to transparent at explicit targets from 62 up. The rule skips grayscale PNGs with a color profile, as pngdeer's output can look darker. The lint names these images on stderr.

## Development

```bash
git clone https://github.com/lndgalante/oxlint-plugin-pngdeer
cd oxlint-plugin-pngdeer
npm ci
npm test
cd example && npx oxlint
```

[CONTRIBUTING.md](https://github.com/lndgalante/oxlint-plugin-pngdeer/blob/main/CONTRIBUTING.md) has the other commands, how long each takes, and how releases work. CI runs on Linux, macOS and Windows with Node 20, 22, 24 and 26, and on Linux with Node 20.19.0, the oldest supported. It tests oxlint 1.60, 1.89 and 1.90 (and the newest, weekly), and ESLint 9.0 and 10. [CHANGELOG.md](https://github.com/lndgalante/oxlint-plugin-pngdeer/blob/main/CHANGELOG.md) lists the changes in each version, and [FINDINGS.md](https://github.com/lndgalante/oxlint-plugin-pngdeer/blob/main/FINDINGS.md) has the design notes. To rerun the public-project trials, see [Reproduce](https://github.com/lndgalante/oxlint-plugin-pngdeer/blob/main/bench/TRIALS.md#reproduce).

## Showcase

Using pngdeer in a real project? We'd like to feature a few examples here: what it caught, how much smaller the images became, and whether the result looked good enough to ship. [Share your case in an issue](https://github.com/lndgalante/oxlint-plugin-pngdeer/issues/new?template=showcase.yml).

A useful case includes:

- Your project link and where the images appear.
- One to three before/after examples, with original and compressed byte counts and the quality target.
- Any visible tradeoffs, and whether you use the rule in your editor, pull requests or CI—or are just trying it out.
- How you'd like to be credited, and which submitted images, links and quotes we may feature here.

### A prompt to share

Send this to a maintainer, or paste it into your coding assistant from your project's directory. Review the report and previews before sharing them in an issue.

```text
Help me prepare a showcase case for oxlint-plugin-pngdeer in this project.

Inspect the project and choose up to three PNG/JPEG assets used by the app.
Run `npx oxlint-plugin-pngdeer --version`, then run
`npx oxlint-plugin-pngdeer@<that version> --check` with explicit paths to
those assets.
Keep original images, source files and linter configuration unchanged.
For images with useful savings, create separate previews in a temporary
directory using the same package version and quality target with `-o`.

Draft a short Markdown report with:
- Project name/link and where each image appears.
- Exact commands, package version and quality target.
- A table of original bytes, preview bytes, bytes saved and percent saved.
- Original and preview paths for me to compare at full size.
- Any errors or images with no useful savings.
- Whether an image optimizer or CDN already re-encodes these assets.
  Describe file-size savings as repository savings; claim browser-transfer
  savings only if you measured the deployed files too.

Use recorded results only. Leave visual approval, any visible tradeoffs and
whether I use or plan to keep the lint rule enabled for me to answer.
Ask how I want to be credited and which material may be featured publicly.
Return the report for my review without posting it or sending messages.
```

## License

[MIT](https://github.com/lndgalante/oxlint-plugin-pngdeer/blob/main/LICENSE). The engine's dependencies keep their own licenses ([engine/THIRD_PARTY_LICENSES.txt](https://github.com/lndgalante/oxlint-plugin-pngdeer/blob/main/engine/THIRD_PARTY_LICENSES.txt)), and [engine/README.md](https://github.com/lndgalante/oxlint-plugin-pngdeer/blob/main/engine/README.md) says where the engine comes from. The example images keep theirs ([example/SOURCES.md](https://github.com/lndgalante/oxlint-plugin-pngdeer/blob/main/example/SOURCES.md)). JPEG output is encoded with mozjpeg: this software is based in part on the work of the Independent JPEG Group.
