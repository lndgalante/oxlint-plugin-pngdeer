# oxlint-plugin-pngdeer

**Smaller images, flagged where you use them.** An [oxlint](https://oxc.rs/docs/guide/usage/linter) rule that says, on the line of code that names a PNG or JPEG, how much smaller [pngdeer](https://github.com/heydeer/pngdeer) would make it at the same visual quality, and the command that does it.

```
src/App.jsx:10:16: warning pngdeer(compressible-image): hero.png could be 359 kB smaller (70%: 509 kB → 151 kB) and still look right. Run: npx oxlint-plugin-pngdeer public/hero.png -o public/hero.png
```

## Setup

```bash
npm install --save-dev oxlint oxlint-plugin-pngdeer
```

In `.oxlintrc.json`:

```json
{
  "jsPlugins": ["oxlint-plugin-pngdeer"],
  "rules": {
    "pngdeer/compressible-image": "warn"
  }
}
```

Then run `npx oxlint`. The first run measures each image it meets (a few seconds each, in parallel); later runs read the results from a cache and take milliseconds.

To make an image smaller, run the command in the warning. It uses the same engine as the rule, so it writes exactly the file the warning describes:

```bash
npx oxlint-plugin-pngdeer public/hero.png -o public/hero.png
```

## What it checks

Any string in JS or TS (and the script blocks of Vue, Svelte and Astro files) that names a local `.png`, `.apng`, `.jpg` or `.jpeg` file: imports, `require`, `new URL("./x.png", import.meta.url)`, JSX `src` and `srcSet`, and plain strings. Paths resolve:

- `./` and `../` from the file.
- `/x.png` from each public directory, then the project root (the nearest folder with a `package.json`).
- `@/` and `~/` from `src/`.

oxlint lints code, not images, so images used only from CSS, HTML or Markdown aren't seen.

## Options

```json
"pngdeer/compressible-image": ["warn", { "minBytes": 4096, "minPercent": 10, "target": "auto", "compute": "auto" }]
```

| Option | Default | |
|---|---|---|
| `minBytes` | `4096` | Report only savings of at least this many bytes (Lighthouse's threshold) |
| `minPercent` | `10` | …and at least this share of the file |
| `target` | `"auto"` | The quality to keep: `"auto"` picks one per image, as pngdeer does; a number is a SSIMULACRA2 score (90 is indistinguishable at 1:1) |
| `compute` | `"auto"` | `"always"` measures new images while linting; `"never"` only reports what's cached; `"auto"` measures on the command line and in the background in the editor |

Settings, shared by every file:

```json
"settings": { "pngdeer": { "publicDirs": ["public"], "aliases": { "@/": "src/", "~/": "src/" } } }
```

## How it works

- **pngdeer** searches palette sizes and dithering for each PNG, and JPEG qualities for each JPEG, scores each candidate with SSIMULACRA2, and keeps the smallest file that still looks right. The engine is pngdeer's WebAssembly build, so it runs wherever Node does, with nothing to compile or download at install.
- **Cache:** results are kept per image content in `node_modules/.cache/pngdeer` (in a workspace, each package's own), so an image is measured once until it changes. See [In CI](#in-ci).
- **Speed:** the first time a run meets an image it hasn't measured, every image in the project is measured together, one engine per core, within a quarter of the machine's memory. A median image takes about 3 seconds; a 12-megapixel photo about 30. The run takes about as long as its slowest image.
- **Editor:** in oxlint's language server the rule only reads the cache, and measures new images in the background. Their warnings appear on your next edit.
- **Fixed files stay fixed:** `npx oxlint-plugin-pngdeer` marks what it writes (a JPEG comment or a PNG text chunk), so the rule doesn't measure that file again, on any machine. Running pngdeer on its own output would otherwise find it smaller again, and worse, each time: about a fifth smaller for a JPEG, sometimes more for a PNG. Images made smaller by pngdeer's web app or Homebrew command aren't marked, and neither are files whose mark another tool removed (`oxipng --strip`, ImageOptim); the rule measures those like any other image.
- **When pngdeer can't take an image** (it's over 40 megapixels, say, or pngdeer fails on it), there's no warning for it, and a command-line run names it on stderr.

## In CI

`npm ci` deletes `node_modules`, cache included, so restore the cache after installing. A key unique to each run, with a prefix to restore from, saves what each run adds:

```yaml
- run: npm ci
- uses: actions/cache@v4
  with:
    path: "**/node_modules/.cache/pngdeer"
    key: pngdeer-${{ github.run_id }}
    restore-keys: pngdeer-
- run: npx oxlint
```

With `--format github`, oxlint's warnings become annotations on the pull request, but GitHub shows at most 10 per step.

## Status

oxlint's JS plugins are alpha. This plugin is tested with oxlint 1.90 on Linux, macOS and Windows with Node 20, 22 and 24, and on a weekly schedule against the newest oxlint. [FINDINGS.md](FINDINGS.md) has the research behind it, with measurements.

## License

[MIT](LICENSE). The engine's dependencies keep their own licenses ([engine/THIRD_PARTY_LICENSES.txt](engine/THIRD_PARTY_LICENSES.txt)); [engine/README.md](engine/README.md) says where the engine comes from. The example images keep theirs ([example/SOURCES.md](example/SOURCES.md)). JPEG output is encoded with mozjpeg: this software is based in part on the work of the Independent JPEG Group.
