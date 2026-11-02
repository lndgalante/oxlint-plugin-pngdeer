# pngdeer/compressible-image

Flags PNGs and JPEGs that [pngdeer](https://github.com/heydeer/pngdeer) would make much smaller at about the same visual quality, on the line of code that uses them.

## What it flags

Any string in JS or TS (and the script blocks of Vue, Svelte and Astro files, Astro's frontmatter included) that names a local `.png`, `.apng`, `.jpg` or `.jpeg` file, when pngdeer can save at least 4 KiB (4096 bytes) and 10% of it:

```jsx
import hero from "./hero.png"; // ⚠ hero.png could be 70% smaller (509 kB → 151 kB) …
const banner = new URL("./banner.jpg", import.meta.url); // ⚠ when banner.jpg could be smaller
export const Logo = () => <img src="/logo.png" srcSet="/logo.png 1x, /logo@2x.png 2x" />; // ⚠ each file
const icons = { star: "/icons/star.png" }; // ⚠ any string that names an image
export const Photo = () => <img src="/my%20photo.png" />; // ⚠ public/my photo.png, read as a browser reads it
```

Not flagged:

```jsx
import icon from "./icon.png"; // already small, or already pngdeer's output
const remote = "https://cdn.example.com/hero.png"; // not a local file
const page = `/images/${name}.png`; // built at runtime
const missing = "/no-such-file.png"; // names no file
const bare = "assets/logo.png"; // no ./, ../, / or alias prefix: not looked up
```

Each image warns once per file, at its first mention, and only its own path is underlined, even inside a `srcSet`. Outside an editor, an image named in several files gets the full warning once per run and a shorter one in the other files, and the summary counts the warnings. The warning says how close to the original the smaller file would look, from its SSIMULACRA2 score: "identical" from 90, "the same side by side" from 80, "close, with differences you might spot side by side" from 70, and "visibly different" below 70, which the automatic target can reach on some images: compare those before shrinking. A file pngdeer can shrink without loss says "losslessly" instead.

On the command line, the run ends with a table of everything it flagged, each image counted once, biggest saving first, with each one's quality. Below it are images the run measured that no linted JS or TS names, like a CSS background. No warning can point at them, so each row says where the image is named instead:

- `used in src/App.css`: a stylesheet, HTML page, template, MDX, data file, web manifest or XML file.
- `named in src/App.jsx`: JS or TS this run didn't lint (a one-file lint, lint-staged, a parse error, an ignore pattern), or a path the rule doesn't look up, like `"images/hero.png"` with no prefix, or another package's path. When the run linted no file of that kind at all, like an ESLint config that leaves out `.tsx` files, the summary says so (see [ESLint setup](#eslint-setup)).
- `a Next.js metadata file`: an image Next.js serves by its file name alone, like `app/opengraph-image.png` or `src/app/icon.png`, in a project whose `package.json` depends on `next`.
- `mentioned in README.md`: only Markdown names it.
- `nothing names it`: maybe an unused image, or one whose path is built at runtime. Only these rows bring the note that deleting the image saves it all.

A file that names the image's path counts before one that names only its file name, and the image's own project is searched before the other projects the run linted. `--flagged` leaves these images alone. The list ends with the command that shrinks them (the 5 biggest savings, when there are more), and with how to stop listing one you keep on purpose: add its path, from its project's folder, to the rule's `exclude` option. When the linter runs from another folder, like a monorepo's root, the summary names those paths.

`--quiet` and the formats other programs read (`json`, `checkstyle`, `junit`, `sarif`, `gitlab`) leave the table out. So does `eslint --cache`: ESLint then replays the cached warnings of files that didn't change, without running the rule on them, so pngdeer prints one line instead, `pngdeer: with eslint --cache, warnings can be stale and there is no summary; run without --cache to update both`, and keeps the `--flagged` list from the last run without it.

## Check images without changing them

The command can evaluate images before you configure either linter, and includes images used only by CSS, HTML or content files:

```bash
npx oxlint-plugin-pngdeer --check
npx oxlint-plugin-pngdeer --check public src/assets
npx oxlint-plugin-pngdeer --check public/hero.png --target 90
npx oxlint-plugin-pngdeer --check --exclude "public/originals/**" --min-saved-bytes 8192
```

`--check` accepts files and directories; without paths it starts at the current directory. It never changes image files. It writes measurements to the same content cache as the lint rule, and leaves the lint's `--flagged` list alone. Both savings thresholds must be met to report an image.

It prints one line per image that clears both thresholds, biggest saving last, then the totals and the commands that preview the biggest saving as a new file and shrink the biggest images (up to 10) in place. In `example/`:

```
public/unused-fire.png: could be 40% smaller (13 kB → 7.5 kB, quality 90/100: looks identical)
src/assets/crystal-ball.png: could be 68% smaller (35 kB → 11 kB, quality 87/100: looks the same side by side)
public/photo.jpg: could be 64% smaller (235 kB → 85 kB, quality 76/100: looks close, with differences you might spot side by side)
src/assets/diagram.png: could be 75% smaller (248 kB → 63 kB, quality 90/100: looks identical)
public/hero.png: could be 70% smaller (509 kB → 151 kB, quality 87/100: looks the same side by side)
pngdeer: checked 6 images; 5 measured, 0 cached, 1 skipped (already optimized or below 4.1 kB), 0 errors.
pngdeer: 5 images could be 723 kB smaller (1.0 MB → 317 kB, 70% smaller). Images unchanged.
pngdeer: to preview the biggest saving as a new file, run: npx oxlint-plugin-pngdeer public/hero.png -o hero.preview.png
pngdeer: to shrink them in place (lossy, so commit first), run: npx oxlint-plugin-pngdeer public/hero.png src/assets/diagram.png public/photo.jpg src/assets/crystal-ball.png public/unused-fire.png
```

Sizes are in kB of 1000 bytes, so the default 4096-byte threshold reads 4.1 kB. The preview goes in the current folder, over any file there with that name.

| Option | Default | |
|---|---|---|
| `--target auto\|T` | `auto` | Quality target, as for the lint rule. |
| `--min-saved-bytes N` | `4096` | Minimum saving in bytes. |
| `--min-saved-percent N` | `10` | Minimum saving as a percentage. |
| `--exclude PATTERN` | none | Repeat to exclude several paths or patterns; uses the same syntax as the rule's `exclude`. |
| `--cache-dir PATH` | `node_modules/.cache/pngdeer` | Cache folder relative to each image's project root, or an absolute path. Use the same value as `settings.pngdeer.cacheDir` to share a committed cache. |

The check does not load an oxlint or ESLint configuration. Pass the target, thresholds, exclusions and custom cache location explicitly when they differ from the defaults. Directory traversal skips the same dependency, build, hidden and test-output folders as the project scan. It also skips nested packages and names them on stderr, with the command that checks them with the same options; in a monorepo, pass each package directory explicitly:

```
pngdeer: skipped 2 nested packages (a folder with its own package.json is checked only when named); to check them, run: npx oxlint-plugin-pngdeer --check packages/docs packages/web
```

Symlinks to image files are included; directory symlinks are not traversed. The nearest ancestor containing `package.json` is the project root, with the command's working directory as fallback. Exclusion patterns are relative to that root, so in the command for skipped packages, a pattern that starts at the workspace root, like `packages/web/fixtures`, needs rewriting from the package's folder (`fixtures`); patterns like `**/fixtures/**` work anywhere.

`--cache-dir .pngdeer` also copies successful measurements already in the local cache into `.pngdeer`, so you can commit them without recompressing the images. Failed measurements remain in the machine's local cache.

| Exit code | Meaning |
|---|---|
| `0` | Check completed with no savings above both thresholds, or found no images at all. |
| `1` | At least one image could be smaller by both thresholds. |
| `2` | Invalid arguments, missing or unreadable input, unsupported image, or a measurement failure prevented a complete check. Other results are still reported. Also when it found no images outside the nested packages it skipped, as at a monorepo's root. |

Already marked images and images too small to meet the byte threshold need no measurement, even ones pngdeer would leave alone, like a small grayscale icon with a color profile. A check that cannot read or measure an image exits `2`, even if it also finds savings; the lint rule fails open instead, except on a timeout (see [The cache](#the-cache)). If measuring itself fails, for example because the cache folder can't be written, the check says why once (`pngdeer: measuring failed: EACCES: permission denied, mkdir '…'`), and each image it couldn't measure reads `not measured (see above)`.

## How to fix it

Run the command from the warning:

```bash
npx oxlint-plugin-pngdeer public/hero.png
```

It writes pngdeer's smaller file over the image (`-o` writes elsewhere), and marks it so this rule doesn't flag it again. pngdeer is lossy, so commit first. To inspect the result before replacing an original, write a preview and compare both images:

```
$ npx oxlint-plugin-pngdeer public/hero.png -o hero.preview.png
public/hero.png → hero.preview.png: 509 kB → 151 kB (70% smaller, quality 87/100: looks the same side by side)
```

`-o` takes the file to write, not a folder. Quality scores estimate perception; they are not a guarantee for every image or viewing condition.

To shrink everything the last lint flagged, at the target each image was measured at:

```bash
npx oxlint-plugin-pngdeer --flagged
```

A lint outside the editor leaves that list in `node_modules/.cache/pngdeer/flagged.json`, in the folder it ran from. Several images run in parallel, with up to eight engines. `--help` lists the rest.

Use one quality target for code that shares an image. When several references use fixed targets, `--flagged` uses the highest one only if its measurement warrants a warning. If a stricter reference produces no warning, or references mix automatic and fixed targets, the image is left out of bulk compression and the summary explains why. Constraints from enabled references also count when their measurements are missing or their thresholds produce no warning.

On Windows, commands for unusual file or folder names, including `--check`'s for skipped packages, are labeled `Run in PowerShell`. They use literal arguments and invoke Node with the installed plugin's executable directly, avoiding expansion of `$`, backticks or `%` by PowerShell or npm's batch shim. Paste those commands into PowerShell. Common paths keep the shorter `npx` command. `--flagged` reads image paths directly from its manifest.

- **Images keep their color profile and EXIF orientation.** Everything else is dropped: the rest of EXIF (GPS included), XMP and IPTC, so copyright and captions too. A profile that only says sRGB goes as well, since browsers assume sRGB.
- **The mark is a short text tag** (`pngdeer <size>`, in a PNG `tEXt` chunk or a JPEG comment), so a fixed file stays fixed on every machine. Metadata strippers (`oxipng --strip`, ImageOptim) remove it, and images shrunk by pngdeer's web app or Homebrew command aren't marked: the rule measures those again and may flag them. The tag checks file size, so an edit that preserves both the tag and the byte count is still treated as optimized. Don't shrink an image twice, as each lossy pass costs quality.
- **Images another tool already compressed can still be flagged,** because pngdeer compares with the file you have, not the original. Compare by eye before shrinking those.

## Options

```json
"pngdeer/compressible-image": ["warn", { "minSavedBytes": 4096, "minSavedPercent": 10, "target": "auto", "measure": "auto", "scan": "project", "exclude": [] }]
```

| Option | Default | |
|---|---|---|
| `minSavedBytes` | `4096` | Report only savings of at least this many bytes. 4 KiB is Lighthouse's threshold. Images smaller than this are never measured. |
| `minSavedPercent` | `10` | …and of at least this percent of the file. |
| `target` | `"auto"` | The quality to keep. `"auto"` is about the quality TinyPNG would give the image, never above 90, though the smaller file can score higher. A number is a [SSIMULACRA2](https://github.com/cloudinary/ssimulacra2) score from 0 to 100: 90 can't be told apart from the original even flipping between them, 80 not side by side, and 70 shows artifacts that aren't annoying. Images that can't reach the target aren't flagged. The warning's command repeats it as `--target`. |
| `measure` | `"auto"` | When to measure images that aren't in the cache. `"auto"`: in the background in editors (oxlint's language server, and ESLint's in VS Code, Zed or Neovim), where the warnings appear on a later lint; everywhere else (the `oxlint` and `eslint` commands, tools that call ESLint's Node API), while linting. `"always"`: while linting, editors included. `"never"`: never, so only cached results are reported. |
| `scan` | `"project"` | `"project"` measures the project's images in a parallel batch. `"referenced"` measures only images named by the source files being linted, and omits unreferenced images from the summary even if they are cached. |
| `exclude` | `[]` | Image paths or patterns relative to the project root. Excluded images are not measured, reported, or listed in the summary, even when code references them directly. |

In ESLint, the rule and its options go in a config object's `rules`, the same way. `pngdeer.configs.recommended` turns the rule on at `"warn"`, with these defaults, for the files the rest of your config lints. It sets no `files`, so it never adds JSX or TypeScript your config doesn't parse (for those, see [ESLint setup](#eslint-setup)). To change an option, set the rule again in a config object after it:

```js
// eslint.config.js
import pngdeer from "oxlint-plugin-pngdeer";

export default [
  // ...your config, which parses your JSX or TypeScript
  pngdeer.configs.recommended,
  { rules: { "pngdeer/compressible-image": ["warn", { target: 90 }] } },
];
```

### Scan scope and exclusions

Use `"scan": "referenced"` for targeted runs such as lint-staged, or to avoid measuring unrelated assets in the editor. A full cold lint may take longer with this mode: the rule discovers references one source file at a time, so it cannot batch all images in parallel as the project scan does. The default remains `"project"`; compare both modes on your project before choosing.

```json
"pngdeer/compressible-image": ["warn", {
  "scan": "referenced",
  "exclude": ["public/originals", "**/fixtures/**", "**/*.baseline.png"]
}]
```

Patterns use `/` separators on every platform. A literal path excludes that file or directory and its descendants. `*` matches within one path segment, `?` matches one character within a segment, and `**` matches across directories. Patterns are rooted at the project folder: `*.png` matches root images, while `**/*.png` matches PNG paths at any depth. Braces, character classes and negated patterns are not supported. Quote CLI patterns so your shell does not expand them first.

## ESLint setup

`pngdeer.configs.recommended` needs a config that already lints and parses your JSX or TypeScript files, and ESLint's default parser reads plain JavaScript only. Otherwise, give the rule a config object for the files it should lint. For JavaScript with JSX:

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

A project with both kinds of file uses both objects. A `Parsing error: Unexpected token` on JSX or on a type means the rule runs on a file your config doesn't parse. In `eslint.config.ts`, the plugin's types work with `defineConfig`.

## Settings

Shared by every file. In `.oxlintrc.json`, `settings` sits next to `rules`; in ESLint, put it in a config object; with Vite+, in the `lint` block of `vite.config.ts`.

```json
"settings": {
  "pngdeer": { "publicDirs": ["public", "static"], "aliases": { "@/": "src/" }, "cacheDir": ".pngdeer" }
}
```

| Setting | Default | |
|---|---|---|
| `publicDirs` | `["public", "static"]` | Folders where root paths like `/logo.png` are looked up, before the project root. |
| `aliases` | the project's tsconfig/jsconfig `paths`, else `{ "@/": "src/", "~/": "src/" }` | Path prefixes and the folders they stand for, relative to the project root, like `"$lib/": "src/lib/"` or `"#assets/": "src/assets/"`. Without this setting, the rule reads `compilerOptions.paths` from `tsconfig.json` (or `jsconfig.json`) the way TypeScript does: through `extends` (later entries win), with `baseUrl` from wherever the chain sets it and `${configDir}` as the project's folder, and through `references` when the config itself has no `paths` (Vite keeps them in `tsconfig.app.json`). It reads them again when a config changes. Setting it replaces those. |
| `cacheDir` | `node_modules/.cache/pngdeer` | Where results are kept, relative to the project root. A folder you commit, like `.pngdeer`, keeps CI and fresh clones from measuring again; its entries are formatted for Prettier. Packages can share one. Images pngdeer fails on are remembered in `node_modules/.cache/pngdeer` only. |

Paths starting with `./` or `../` resolve from the file. A path with none of these prefixes (`assets/logo.png`) isn't looked up, unless you add an alias for it, like `{ "assets/": "src/assets/" }`. The project root is the nearest folder above the file with a `package.json`.

Automatic aliases support prefix patterns ending in `*`, choose the longest matching prefix, and try its target folders in order. Package-based `extends` such as `@tsconfig/node22/tsconfig.json`, exact-file aliases, and patterns with a suffix after `*` are not resolved. Set `settings.pngdeer.aliases` explicitly when needed.

## The cache

With the default `"scan": "project"`, the first run measures every eligible PNG and JPEG in the project (the folder with your `package.json`), not only the ones your code names, so the files linted after it find theirs cached. It skips excluded images, images too small to save `minSavedBytes`, and folders nobody ships: dependencies, build output, dot folders, and test output like Playwright and Cypress snapshots. In an editor this happens in the background, and the open file's own images go first, in a batch of their own, so its warnings don't wait for the whole project's.

- **It uses one engine per core, minus one (8 at most),** with an estimated worker-memory budget of a quarter of the machine's memory (or of a container's limit), up to 4 GB. One image always runs even if its estimate exceeds the budget, and the linter itself also uses memory. A median image takes 1 to 3 s of one core.
- **It shows its progress on stderr.** On a terminal, a first run counts the images as it measures them. Elsewhere, like a CI log, it prints `pngdeer: measured N of M images...` every 30 s, so a long run doesn't look stuck.
- **Results are kept by the image's bytes and the target,** so a moved or renamed image stays cached, and copies of one image are measured once. A plugin version with a new engine or a new cache format, like 0.5.0, measures everything again.
- **One lint measures at a time per project.** Another one waits, then finds the results cached. When the one measuring is another process, like your editor, the waiting lint says so: `pngdeer: waiting for another lint measuring this project (if none is running, delete …/measuring.lock)`. ESLint's `--concurrency` threads take turns the same way, without that line, and print one summary.
- **A first run that passes 15 minutes stops.** What it measured is cached, and the next run carries on (in CI, only if the cache is kept between runs). The run reports one problem, on the first line of the file it was linting, saying how many images it didn't measure; with ESLint's `--concurrency`, each lint thread reports its own. The problem has the rule's severity, so `"error"` and `--deny-warnings` fail the lint. If a comment turns the rule off on that line, the next file the same thread lints that doesn't gets the problem. If none does, and no other thread reported one, pngdeer says so on stderr and the lint fails, whatever the rule's severity. With `eslint --no-inline-config`, comments turn nothing off, so the file reports it.
- **Other failures fail open.** If measuring fails another way, the rule reports what's cached, says why on stderr, and doesn't fail the lint by itself.

To commit the results, set `cacheDir` (see [Settings](#settings)), then fill that folder. This copies what earlier runs measured and measures the rest:

```bash
npx oxlint-plugin-pngdeer --check --cache-dir .pngdeer
```

Pass the rule's `--target`, if it sets one (see [Check images without changing them](#check-images-without-changing-them)), and in a monorepo, name each package's folder. Commit the folder, and commit it again after adding or changing images; a lint with `cacheDir` set also copies into it what it finds only in the local cache. Entries for images that changed or were shrunk stay; to drop them, delete the folder and run the same command again, which copies what your machine has measured. Its JSON is formatted the way Prettier formats JSON (Biome users: add `!.pngdeer` to `files.includes`). Images pngdeer fails on are remembered on each machine only. After upgrading to a version with a new engine or cache format, delete the folder and fill it again: nothing reads the old entries.

Or let GitHub Actions cache it. `npm ci` deletes `node_modules`, and the default cache with it, so restore the cache after installing, and save it even when the lint fails:

```yaml
- run: npm ci
- uses: actions/cache/restore@v6
  with:
    path: node_modules/.cache/pngdeer
    key: pngdeer-${{ github.run_id }}
    restore-keys: pngdeer-
- run: npx oxlint
- uses: actions/cache/save@v6
  if: always()
  with:
    path: node_modules/.cache/pngdeer
    key: pngdeer-${{ github.run_id }}
```

In a monorepo, each package has its own cache: list them all in both `path`s, like `packages/*/node_modules/.cache/pngdeer`.

The memory budget applies to each batch. Concurrent lints of different packages can run several pools, so it is not a process-wide or machine-wide memory cap.

## What it skips

- Strings that name no file, remote URLs, and paths built at runtime, silently.
- Images over 40 megapixels (30 for an animation, over all its frames), CMYK JPEGs, grayscale PNGs with a color profile (pngdeer's output can look darker), and files that aren't really PNGs or JPEGs. A command-line run names them on stderr, as it does images pngdeer fails on, and `--check` exits 2. Like any image too small to meet the byte threshold, a small one is skipped instead, unless it isn't really a PNG or JPEG. Convert a CMYK JPEG to RGB, or leave such an image out: `exclude` in the rule, `--exclude` for `--check` (the check doesn't read the rule's options).
- Images used only from CSS, HTML or Markdown, which oxlint doesn't read. The first run still measures them, and the summary lists them.
- Two kinds of image this release of pngdeer fails on. Flat-color JPEGs (a solid-color banner, say) can't be measured at the default target, and explicit targets don't reliably help: eight solid banners each failed at a different set of targets between 80 and 95. PNGs with a smooth fade to transparent work at the default target, but the test image (`fade()` in test/helpers.js) fails at every explicit target from 62 up. A command-line run names them on stderr.
- Everything, on machines that aren't 64-bit little-endian, where oxlint silently skips JS plugins.

## Turning it off

For images whose bytes must not change, like test fixtures, exclude their folders. They are then not measured, warned about, listed in the summary, or shrunk by `--flagged`:

```json
"pngdeer/compressible-image": ["warn", { "exclude": ["test", "e2e"] }]
```

In ESLint the option goes in the same place: `rules: { "pngdeer/compressible-image": ["warn", { exclude: ["test", "e2e"] }] }`. Turning the rule off for those files, with oxlint's `overrides` or an ESLint config object with `files`, hides their warnings. But the project scan still measures their images, and the summary still lists them with a command that shrinks them.

For one reference, `// oxlint-disable-next-line pngdeer/compressible-image` (in JSX, `{/* oxlint-disable-next-line pngdeer/compressible-image */}`), or `eslint-disable-next-line` in ESLint. An image whose warning is turned off this way stays out of the summary and out of `--flagged`.

With ESLint's `--no-inline-config`, those references produce diagnostics again, but the summary and `--flagged` still conservatively exclude them. Use the command in the individual warning in that mode.

## When not to use it

When every image goes through an optimizer that re-encodes it for users anyway (`next/image`, Astro's `<Image>`, an image CDN), the rule mostly saves repository and build size. It still flags those images like any other, and `--flagged` shrinks them too, which adds a second lossy pass, so leave their folders out with `exclude`. Images served as they are still count: plain `<img>`, CSS backgrounds, Next's `opengraph-image` and `icon` files, and every image when `images.unoptimized` is set. The summary adds up file sizes, which may not be what users download. When images must stay byte for byte, like visual-regression baselines, exclude them.
