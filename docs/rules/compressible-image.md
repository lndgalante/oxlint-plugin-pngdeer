# pngdeer/compressible-image

Flags PNGs and JPEGs that [pngdeer](https://github.com/heydeer/pngdeer) would make much smaller at about the same visual quality, on the line of code that uses them.

## What it flags

Any string in JS or TS (and the script blocks of Vue, Svelte and Astro files) that names a local `.png`, `.apng`, `.jpg` or `.jpeg` file, when pngdeer can save at least 4 KiB and 10% of it:

```jsx
import hero from "./hero.png"; // ⚠ hero.png could be 70% smaller (509 kB → 151 kB) …
const banner = new URL("./banner.jpg", import.meta.url); // ⚠ when banner.jpg could be smaller
export const Logo = () => <img src="/logo.png" srcSet="/logo.png 1x, /logo@2x.png 2x" />; // ⚠ each file
const icons = { star: "/icons/star.png" }; // ⚠ any string that names an image
```

Not flagged:

```jsx
import icon from "./icon.png"; // already small, or already pngdeer's output
const remote = "https://cdn.example.com/hero.png"; // not a local file
const page = `/images/${name}.png`; // built at runtime
const missing = "/no-such-file.png"; // names no file
const bare = "assets/logo.png"; // no ./, ../, / or alias prefix: not looked up
```

Each image warns once per file, at its first mention, and only its own path is underlined, even inside a `srcSet`. Outside an editor, an image named in several files gets the full warning once per run and a shorter one in the other files, and the summary counts the warnings. The warning says how close to the original the smaller file would look, from its SSIMULACRA2 score: "identical" from 90, "the same side by side" from 80, "close, with differences you might spot side by side" from 70.

On the command line, the run ends with a table of everything it flagged, each image counted once, biggest saving first, with each one's quality. Below it are images the run measured that no linted JS or TS names, like a CSS background. No warning can point at them, so each row says where the image is used: in a stylesheet, HTML page, template, MDX or data file (`used in src/App.css`), only in Markdown (`mentioned in README.md`), or nowhere (`nothing names it`, maybe an unused image). `--flagged` leaves them alone; the list ends with the command that shrinks them. `--quiet` and the formats other programs read (`json`, `checkstyle`, `junit`, `sarif`, `gitlab`) leave the table out.

## Check images without changing them

The command can evaluate images before you configure either linter, and includes images used only by CSS, HTML or content files:

```bash
npx oxlint-plugin-pngdeer --check public src/assets
npx oxlint-plugin-pngdeer --check public/hero.png --target 90
npx oxlint-plugin-pngdeer --check --exclude "public/originals/**" --min-saved-bytes 8192
```

`--check` accepts files and directories; without paths it starts at the current directory. It never changes image files. It writes measurements to the same content cache as the lint rule, and leaves the lint's `--flagged` list alone. Both savings thresholds must be met to report an image.

| Option | Default | |
|---|---|---|
| `--target auto\|T` | `auto` | Quality target, as for the lint rule. |
| `--min-saved-bytes N` | `4096` | Minimum saving in bytes. |
| `--min-saved-percent N` | `10` | Minimum saving as a percentage. |
| `--exclude PATTERN` | none | Repeat to exclude several paths or patterns; uses the same syntax as the rule's `exclude`. |
| `--cache-dir PATH` | `node_modules/.cache/pngdeer` | Cache folder relative to each image's project root, or an absolute path. Use the same value as `settings.pngdeer.cacheDir` to share a committed cache. |

The check does not load an oxlint or ESLint configuration. Pass the target, thresholds, exclusions and custom cache location explicitly when they differ from the defaults. Directory traversal skips the same dependency, build, hidden and test-output folders as the project scan. It also skips nested packages; in a monorepo, pass each package directory explicitly. Symlinks to image files are included; directory symlinks are not traversed. The nearest ancestor containing `package.json` is the project root, with the command's working directory as fallback. Exclusion patterns are relative to that root.

`--cache-dir .pngdeer` also copies successful measurements already in the local cache into `.pngdeer`, so you can commit them without recompressing the images. Failed measurements remain in the machine's local cache.

| Exit code | Meaning |
|---|---|
| `0` | Check completed with no savings above both thresholds. |
| `1` | At least one image could be smaller by both thresholds. |
| `2` | Invalid arguments, missing or unreadable input, unsupported image, or a measurement failure prevented a complete check. Other results are still reported. |

Already marked images and files too small to meet the byte threshold need no measurement. A check that cannot read or measure an image exits `2`, even if it also finds savings; the lint rule continues to fail open as described below.

## How to fix it

Run the command from the warning:

```bash
npx oxlint-plugin-pngdeer public/hero.png
```

It writes pngdeer's smaller file over the image (`-o` writes elsewhere), and marks it so this rule doesn't flag it again. pngdeer is lossy, so commit first. To inspect the result before replacing an original, run `npx oxlint-plugin-pngdeer public/hero.png -o hero.preview.png` and compare both images. Quality scores estimate perception; they are not a guarantee for every image or viewing condition.

To shrink everything the last lint flagged, at the target each image was measured at:

```bash
npx oxlint-plugin-pngdeer --flagged
```

A lint outside the editor leaves that list in `node_modules/.cache/pngdeer/flagged.json`, in the folder it ran from. Several images run in parallel, with up to eight engines. `--help` lists the rest.

Use one quality target for code that shares an image. When several references use fixed targets, `--flagged` uses the highest one only if its measurement warrants a warning. If a stricter reference produces no warning, or references mix automatic and fixed targets, the image is left out of bulk compression and the summary explains why. Constraints from enabled references also count when their measurements are missing or their thresholds produce no warning.

On Windows, commands for unusual filenames are labeled `Run in PowerShell`. They use literal arguments and invoke Node with the installed plugin's executable directly, avoiding expansion of `$`, backticks or `%` by PowerShell or npm's batch shim. Paste those commands into PowerShell. Common paths keep the shorter `npx` command. `--flagged` reads image paths directly from its manifest.

- **JPEGs keep their orientation and color profile.** Other camera metadata (EXIF, GPS) is dropped.
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
| `target` | `"auto"` | The quality to keep. `"auto"` is about the quality TinyPNG would give the image, never above 90. A number is a [SSIMULACRA2](https://github.com/cloudinary/ssimulacra2) score from 0 to 100: 90 can't be told apart from the original even flipping between them, 80 not side by side, and 70 shows artifacts that aren't annoying. Images that can't reach the target aren't flagged. The warning's command repeats it as `--target`. |
| `measure` | `"auto"` | When to measure images that aren't in the cache. `"auto"`: in the background in editors (oxlint's language server, and ESLint's in VS Code, Zed or Neovim), where the warnings appear on a later lint; everywhere else (the `oxlint` and `eslint` commands, tools that call ESLint's Node API), while linting. `"always"`: while linting, editors included. `"never"`: never, so only cached results are reported. |
| `scan` | `"project"` | `"project"` measures the project's images in a parallel batch. `"referenced"` measures only images named by the source files being linted, and omits unreferenced images from the summary even if they are cached. |
| `exclude` | `[]` | Image paths or patterns relative to the project root. Excluded images are not measured, reported, or listed in the summary, even when code references them directly. |

### Scan scope and exclusions

Use `"scan": "referenced"` for targeted runs such as lint-staged, or to avoid measuring unrelated assets in the editor. A full cold lint may take longer with this mode: the rule discovers references one source file at a time, so it cannot batch all images in parallel as the project scan does. The default remains `"project"`; compare both modes on your project before choosing.

```json
"pngdeer/compressible-image": ["warn", {
  "scan": "referenced",
  "exclude": ["public/originals", "**/fixtures/**", "**/*.baseline.png"]
}]
```

Patterns use `/` separators on every platform. A literal path excludes that file or directory and its descendants. `*` matches within one path segment, `?` matches one character within a segment, and `**` matches across directories. Patterns are rooted at the project folder: `*.png` matches root images, while `**/*.png` matches PNG paths at any depth. Braces, character classes and negated patterns are not supported. Quote CLI patterns so your shell does not expand them first.

## Settings

Shared by every file. In `.oxlintrc.json`, `settings` sits next to `rules`; in ESLint, put it in a config object.

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

With the default `"scan": "project"`, the first run measures every eligible PNG and JPEG in the project (the folder with your `package.json`), not only the ones your code names, so the files linted after it find theirs cached. It skips excluded images, images too small to save `minSavedBytes`, and folders nobody ships: dependencies, build output, dot folders, and test output like Playwright and Cypress snapshots.

- **It uses one engine per core, minus one (8 at most),** with an estimated worker-memory budget of a quarter of the machine's memory, up to 4 GB. One image always runs even if its estimate exceeds the budget, and the linter itself also uses memory. A median image takes about 3 s of one core.
- **Results are kept by the image's bytes and the target,** so a moved or renamed image stays cached. A plugin version with a new engine measures everything again.
- **One lint measures at a time per project.** Another one waits, then finds the results cached. ESLint's `--concurrency` threads take turns the same way and print one summary.
- **A first run that passes 15 minutes stops** and reports what it measured, and the next run carries on.
- **It fails open.** If measuring fails, the rule reports what's cached, says why on stderr, and doesn't fail the lint by itself.

To commit the results, set `cacheDir` (see [Settings](#settings)) and commit that folder after adding or changing images. Its JSON is formatted the way Prettier formats JSON (Biome users: add `!.pngdeer` to `files.includes`). Images pngdeer fails on are remembered on each machine only. After upgrading to a new engine, delete the folder to drop the old results.

Or let GitHub Actions cache it. `npm ci` deletes `node_modules`, and the default cache with it, so restore the cache after installing, and save it even when the lint fails:

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

The memory budget applies to each batch. Concurrent lints of different packages can run several pools, so it is not a process-wide or machine-wide memory cap.

## What it skips

- Strings that name no file, remote URLs, and paths built at runtime, silently.
- Images over 40 megapixels (30 for an animation, over all its frames), and files that aren't really PNGs or JPEGs. A command-line run names them on stderr, as it does images pngdeer fails on.
- Images used only from CSS, HTML or Markdown, which oxlint doesn't read. The first run still measures them, and the summary lists them.
- Two kinds of image this release of pngdeer fails on. Flat-color JPEGs (a solid-color banner, say) can't be measured at the default target, nor at most targets below about 88. PNGs with a smooth fade to transparent can't be measured at targets of 70 and above. A command-line run names them on stderr.
- Everything, on machines that aren't 64-bit little-endian, where oxlint silently skips JS plugins.

## Turning it off

For images whose bytes must not change, like test fixtures, turn the rule off by folder:

```json
"overrides": [{ "files": ["test/**", "e2e/**"], "rules": { "pngdeer/compressible-image": "off" } }]
```

For one reference, `// oxlint-disable-next-line pngdeer/compressible-image` (in JSX, `{/* oxlint-disable-next-line pngdeer/compressible-image */}`), or `eslint-disable-next-line` in ESLint. An image whose warning is turned off this way stays out of the summary and out of `--flagged`.

With ESLint's `--no-inline-config`, those references produce diagnostics again, but the summary and `--flagged` still conservatively exclude them. Use the command in the individual warning in that mode.

## When not to use it

When every image goes through an optimizer that re-encodes it for users anyway (`next/image`, Astro's `<Image>`, an image CDN), the rule mostly saves repository and build size. When images must stay byte for byte, like visual-regression baselines, keep it off for them.
