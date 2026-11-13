# slimdeer/compressible-image

Flags PNGs and JPEGs that [slimdeer](https://github.com/heydeer/slimdeer), HeyDeer's open-source lossy image compressor, would make at least 4 KiB and 10% smaller at about the same visual quality, on the line of code that uses them. The engine ships in this package as WebAssembly: images are measured on your machine and never uploaded.

[What it flags](#what-it-flags) · [No warnings?](#no-warnings) · [`--check`](#check-images-without-changing-them) · [`--review`](#review-images-before-and-after) · [How to fix it](#how-to-fix-it) · [WebP and AVIF](#write-images-as-webp-or-avif) · [Job summaries](#github-actions-job-summaries) · [Options](#options) · [Excluding images](#scan-scope-and-exclusions) · [ESLint setup](#eslint-setup) · [Settings](#settings) · [The cache](#the-cache) · [Upgrading](#upgrading) · [Moving from the old name](#moving-from-oxlint-plugin-pngdeer) · [What it skips](#what-it-skips) · [Turning it off](#turning-it-off) · [When not to use it](#when-not-to-use-it)

## What it flags

Any string in JS or TS (and the script blocks of Vue, Svelte and Astro files, Astro's frontmatter included) that names a local `.png`, `.apng`, `.jpg` or `.jpeg` file as a whole path, in a `srcSet`, or in a CSS `url()`, when slimdeer can save at least 4 KiB (4096 bytes) and 10% of it:

```jsx
import hero from "./hero.png"; // ⚠ hero.png could be 70% smaller (509 kB → 151 kB) …
const banner = new URL("./banner.jpg", import.meta.url); // ⚠ when banner.jpg could be smaller
export const Logo = () => <img src="/logo.png" srcSet="/logo.png 1x, /logo@2x.png 2x" />; // ⚠ each file
export const Avatar = () => <img srcSet="/me.jpg?v=2 1x, /me@2x.png?v=2 2x" />; // ⚠ each file, query and all
export const Hero = () => <div style={{ backgroundImage: "url(/hero.png)" }} />; // ⚠ CSS url() in a string
const Card = styled.div`background: url(/card.png) no-repeat;`; // ⚠ and in a CSS-in-JS template
const icons = { star: "/icons/star.png" }; // ⚠ any string that is an image's path
export const Photo = () => <img src="/my%20photo.png" />; // ⚠ public/my photo.png, read as a browser reads it
```

Not flagged:

```jsx
import icon from "./icon.png"; // already small, or already shrunk by the command
const remote = "https://cdn.example.com/hero.png"; // not a local file
const page = `/images/${name}.png`; // built at runtime
const bg = `url(/bg.png?v=${version})`; // a url() that runs into an expression, even only in its query
const missing = "/no-such-file.png"; // names no file
const bare = "assets/logo.png"; // no ./, ../, / or alias prefix: not looked up
el.innerHTML = '<img src="/banner.png">'; // HTML in a string or template: only a url() in it is read
```

Nor is an image the automatic target can't make smaller without a visible difference ([the quality floor](#the-quality-floor)). An image named only in HTML inside a string, like the `innerHTML` above or an `html` tagged template, gets no warning unless a CSS `url()` names it, and [the summary](#the-summary) lists it among the images with no warning, as `named in src/html.js`.

A `url()` counts whether it's quoted, unquoted or written `URL(`, in inline styles, CSS strings, and styled-components or emotion templates, and each of several in one value counts. Each image warns once per file, at its first mention, and only its own path is underlined, even inside a `srcSet` or a `url()`, where it is written. Outside an editor, an image named in several files gets the full warning once per run and a shorter one in the other files ("as warned where it's first used"), and the summary counts the warnings.

The warning says how close to the original the smaller file would look, from its SSIMULACRA2 score: "identical" from 90, "the same side by side" from 80, "close, with differences you might spot side by side" from 70, and "visibly different" below 70, which only an explicit `target` below 70 can give. A file slimdeer can shrink without loss says "losslessly" instead.

### Frameworks

- **Next.js.** When `next/image` re-encodes the image for visitors, the warning says so before the command (here in oxlint's `unix` format):

  ```
  app/page.jsx:4:21: photo.jpg could be 64% smaller (235 kB → 85 kB) and look close, with differences you might spot side by side (quality 76/100). Here next/image re-encodes it for visitors, so shrinking it saves repository and build size. Run: npx oxlint-plugin-slimdeer public/photo.jpg [Warning/slimdeer(compressible-image)]
  ```

  The note shows when every mention of the image in the file is a string `src` of the default import of `next/image`, `next/legacy/image` or `next/future/image`, or an imported image used only in such `src` props. It doesn't show when the element has `unoptimized` (other than `unoptimized={false}`), a `loader` prop or spread props, when the image is used elsewhere in the file, when the nearest `next.config.{js,mjs,cjs,ts,mts}` mentions `unoptimized` or `loaderFile`, or for an animated PNG, which Next.js serves as it is. The note speaks for that file only, and changes nothing else: the image is still reported, summed and shrunk by `--flagged` (see [When not to use it](#when-not-to-use-it)).
- **React Native and Expo.** In a project that depends on `react-native` or `expo`, a reference to `logo.png` also names `logo@2x.png`, `logo@3x.png`, `logo@1.5x.png`, `logo.ios.png`, `logo.android.png`, `logo.native.png`, `logo.web.png` and combinations like `logo@2x.ios.png` in the same folder, even when only the variants exist. Each one is warned at the same string and flagged. Names must match in letter case, and `require("./logo@2x.png")` names only that file.
- **Gatsby.** In a project that depends on `gatsby`, root paths like `/hero.png` are looked up in `static/`, and `public/`, Gatsby's build output, is left out of warnings, the project scan, the summary and `--flagged`, unless `settings.slimdeer.publicDirs` includes `"public"`. `--check` leaves it out too (see [below](#check-images-without-changing-them)).
- **Workspaces like Nx.** A root path like `/logo.png` is looked up in the `public/` and `static/` folders next to the linted file and in each folder above it, nearest first, so each app finds its own `public/` (see [Settings](#settings)).

### The quality floor

The automatic target picks a quality for each image, about what TinyPNG would give it, and never settles below 70. When its result would score below 70, "visibly different", slimdeer compresses the image again at target 70. If nothing reaches 70, the image isn't flagged, `--check` and `--review` don't list it, and the command leaves it as it is:

```
public/fade.png: slimdeer can't make it smaller without a visible difference (the best reaches quality 59/100); left as is
```

With `-o`, the new file is written anyway, as a copy of the image:

```
public/fade.png → fade.preview.png: slimdeer can't make it smaller without a visible difference (the best reaches quality 59/100); copied as is
```

A lint says how many images the floor turned down, once, right after measuring them:

```
slimdeer: measuring 2 images not in the cache yet...
slimdeer: measured 2 images in 4.0 s; later runs read the cache
slimdeer: 1 of them can't be made smaller without a visible difference (its best quality is below 70), so it isn't reported; npx oxlint-plugin-slimdeer --check names it
```

They get no warning and no row in the summary. The line doesn't print on runs that read the cache, in an editor's background measuring, or with an explicit `target`. The `--check` command in that line carries the rule's `exclude`, thresholds and `cacheDir` when they differ from the defaults and, from a lint run anywhere other than the project's folder (below it, beside it, or at a monorepo's root), that folder's path, like `npx oxlint-plugin-slimdeer --check .. --exclude public/old` or `npx oxlint-plugin-slimdeer --check packages/web`: run where the lint ran, it names the images the line counted. [`--check`](#check-images-without-changing-them) names the images, with the command that tries them at a lower target.

An explicit target below 70 still allows a result below 70. To shrink one such image anyway, preview it at a lower target first, then shrink it the same way:

```bash
npx oxlint-plugin-slimdeer public/header.png --target 60 -o header.preview.png
npx oxlint-plugin-slimdeer public/header.png --target 60
```

A `target` in the rule's options applies to every image, so it is the wrong tool for one.

### The summary

On the command line, the run ends with a table of everything it flagged, each image counted once, biggest saving first, with each one's quality. Below it are images the run measured that no linted JS or TS names, like a CSS background. No warning can point at them, so each row says where the image is named instead. In `example/`:

```
slimdeer: 4 flagged images could be 718 kB smaller in all (1.0 MB → 310 kB, 70% smaller):
  image                           now    after   saves  quality
  public/hero.png              509 kB → 151 kB  359 kB       87
  src/assets/diagram.png       248 kB →  63 kB  185 kB       90
  public/photo.jpg             235 kB →  85 kB  150 kB       76
  src/assets/crystal-ball.png   35 kB →  11 kB   24 kB       87
slimdeer: also 1 image with no warning could be 5.1 kB smaller (named only where this run can't warn, or nowhere):
  public/unused-fire.png        13 kB → 7.5 kB  5.1 kB       90  mentioned in SOURCES.md
slimdeer: quality is SSIMULACRA2, out of 100: 90+ looks identical, 80+ the same side by side, 70+ close, with differences you might spot side by side, below 70 visibly different
slimdeer: to see the 4 flagged images before and after on one page first, run: npx oxlint-plugin-slimdeer --review --flagged
slimdeer: to shrink the 4 flagged images in place (lossy, so commit first), run: npx oxlint-plugin-slimdeer --flagged
slimdeer: to shrink it too, run: npx oxlint-plugin-slimdeer public/unused-fire.png
slimdeer: to keep it as is and stop listing it, add its path to the rule's "exclude" option
```

When the run flagged nothing, the second table's lead reads `slimdeer: no warnings, but 1 image could be 5.1 kB smaller (named only where this run can't warn, or nowhere):`. With one flagged image, the review line gives way to a preview as a new file:

```
slimdeer: to preview it as a new file, run: npx oxlint-plugin-slimdeer public/photo.jpg -o photo.preview.jpg
slimdeer: to shrink the flagged image in place (lossy, so commit first), run: npx oxlint-plugin-slimdeer --flagged
```

Where each image with no warning is named:

- `used in src/App.css`: a stylesheet, HTML page, template, MDX, data file, web manifest or XML file.
- `named in src/App.jsx`: JS or TS this run didn't lint (a one-file lint, lint-staged, a parse error, an ignore pattern), or a path the rule doesn't look up, like `"images/hero.png"` with no prefix, or another package's path. When the run linted no file of that kind at all, like an ESLint config that leaves out `.tsx` files, the summary says so (see [ESLint setup](#eslint-setup)).
- `a Next.js metadata file`: an image Next.js serves by its file name alone, like `app/opengraph-image.png` or `src/app/icon.png`, in a project whose `package.json` depends on `next`.
- `mentioned in README.md`: only Markdown names it.
- `nothing names it`: maybe an unused image, or one whose path is built at runtime. Only these rows bring the note that deleting the image saves it all.

A file that names the image's path counts before one that names only its file name, and the image's own project is searched before the other projects the run linted. `--flagged` leaves these images alone. The list ends with the command that shrinks them (the 5 biggest savings, when there are more), and with how to stop listing one you keep on purpose: add its path, from its project's folder, to the rule's `exclude` option. When the linter runs from another folder, like a monorepo's root, the summary names those paths.

`--quiet` and the formats other programs read (`json`, `checkstyle`, `junit`, `sarif`, `gitlab`) leave the summary out. So does `eslint --cache`: ESLint then replays the cached warnings of files that didn't change, without running the rule on them, so the rule prints one line instead, `slimdeer: with eslint --cache, warnings can be stale and there is no summary; run without --cache to update both`, and keeps the `--flagged` list from the last run without it.

Control characters in a file name show as U+FFFD (`�`) in the summary, in the warnings and in every line the command prints, so a name can't rewrite your terminal. A command printed for such a name writes each one as an escape, like `public/ball$'\x1b''[2J.png'`, which bash, zsh and ksh read back as the real name. On Windows, such a command shows U+FFFD too and won't find the file. `--json` keeps the real names.

## No warnings?

If a lint shows no warning from the rule where you expect one, check these in order:

- **The config.** In `.oxlintrc.json`, the package goes in `jsPlugins`, not `plugins`, and a second `rules` key silently replaces the first. Vite+ reads the `lint` block of `vite.config.ts` instead.
- **The versions.** oxlint 1.60 or newer, and Node 20.19+ or 22.12+. On a machine that isn't 64-bit little-endian, oxlint skips JS plugins without a word.
- **ESLint's files.** The config must lint and parse the files that name images. When it leaves out a kind of file that names one, like `.tsx`, the summary says the run linted no such files (see [ESLint setup](#eslint-setup)).
- **`eslint --cache`.** It replays cached results without running the rule. Run without it.
- **The editor.** It measures in the background, and a file shows its warnings the next time the editor lints it. Lint once from the command line first.
- **The path.** It must start with `./`, `../`, `/` or an alias: `"assets/logo.png"` isn't looked up (see [Settings](#settings)).
- **The saving.** By default, an image is flagged when it could be at least 4 KiB and 10% smaller at quality 70 or above. The lint says how many images [the quality floor](#the-quality-floor) turned down.
- **The options.** `exclude` leaves images out, and `measure: "never"` reports only cached results.

`npx oxlint-plugin-slimdeer --check` measures the images without a linter; pass it the rule's options. If it lists an image your code names and the lint still doesn't warn on it, [open an issue](https://github.com/lndgalante/oxlint-plugin-slimdeer/issues/new?template=bug.yml).

## Check images without changing them

The command can evaluate images before you configure either linter, and includes images used only by CSS, HTML or content files:

```bash
npx oxlint-plugin-slimdeer --check
npx oxlint-plugin-slimdeer --check public src/assets
npx oxlint-plugin-slimdeer --check public/hero.png --target 90
npx oxlint-plugin-slimdeer --check --exclude "public/originals/**" --min-saved-bytes=8192
npx oxlint-plugin-slimdeer --check --json > images.json
```

`--check` accepts files and folders, and without paths starts at the current folder. It never changes an image. It writes its measurements to the same cache as the lint rule, so a lint afterwards finds them, and leaves the lint's `--flagged` list alone. An image must clear both savings thresholds to be listed. With `--format webp` or `--format avif`, it compares each image's WebP or AVIF copy with its shrink instead ([WebP and AVIF](#check-first)).

It prints one line per image, biggest saving last, then the totals and the next commands. With two or more images it offers [`--review`](#review-images-before-and-after) with the same paths and options; with one, a preview as a new file. In `example/`:

```
public/unused-fire.png: could be 40% smaller (13 kB → 7.5 kB, quality 90/100: looks identical)
src/assets/crystal-ball.png: could be 68% smaller (35 kB → 11 kB, quality 87/100: looks the same side by side)
public/photo.jpg: could be 64% smaller (235 kB → 85 kB, quality 76/100: looks close, with differences you might spot side by side)
src/assets/diagram.png: could be 75% smaller (248 kB → 63 kB, quality 90/100: looks identical)
public/hero.png: could be 70% smaller (509 kB → 151 kB, quality 87/100: looks the same side by side)
slimdeer: checked 6 images; 0 measured, 5 cached, 1 skipped (already optimized or below 4.1 kB), 0 errors.
slimdeer: 5 images could be 723 kB smaller (1.0 MB → 317 kB, 70% smaller). Images unchanged.
slimdeer: to see all 5 before and after on one page first, run: npx oxlint-plugin-slimdeer --review
slimdeer: to shrink them in place (lossy, so commit first), run: npx oxlint-plugin-slimdeer public/hero.png src/assets/diagram.png public/photo.jpg src/assets/crystal-ball.png public/unused-fire.png
```

The shrink command names the 10 biggest savings when there are more. Sizes are in kB of 1000 bytes, so the default 4096-byte threshold reads 4.1 kB; 999,500 bytes read 1.0 MB, and sizes past 1 GB read in GB. A percentage reads 100 only when nothing is left and 0 only when nothing is saved. The preview goes in the current folder, over any file there with that name.

| Option | Default | |
|---|---|---|
| `--target auto\|T` | `auto` | Quality target, as for the lint rule. |
| `--min-saved-bytes N` | `4096` | Minimum saving in bytes. |
| `--min-saved-percent N` | `10` | Minimum saving as a percentage. |
| `--exclude PATTERN` | none | A file, folder or pattern to leave out, with the same syntax as the rule's `exclude`. Repeat it for more. |
| `--cache-dir PATH` | `node_modules/.cache/slimdeer` | Cache folder relative to each image's package, or an absolute path. Use the same value as `settings.slimdeer.cacheDir` to share a committed cache. |
| `--json` | off | Print one JSON document on stdout instead of lines (see [below](#json)). |
| `--format webp\|avif` | none | Compare each image's WebP or AVIF copy with its shrink, at the same quality score (see [WebP and AVIF](#check-first)). |

An option's value can follow it or an `=` sign: `--target 80` or `--target=80`. A mistake in the arguments is one line and a pointer to `--help`, and exits `2`:

```
oxlint-plugin-slimdeer: unknown option --chekc
Run npx oxlint-plugin-slimdeer --help to see every option.
```

### Packages, exclusions and odd files

The check doesn't load an oxlint or ESLint configuration: pass the target, thresholds, exclusions and cache folder when they differ from the defaults. It walks into nested packages (folders with their own `package.json`), so at a monorepo's root it checks every package in one run, each image with its own package's cache and lock:

```
packages/docs/public/photo.jpg: could be 64% smaller (235 kB → 85 kB, quality 76/100: looks close, with differences you might spot side by side)
packages/docs/public/diagram.png: could be 75% smaller (248 kB → 63 kB, quality 90/100: looks identical)
packages/web/public/hero.png: could be 70% smaller (509 kB → 151 kB, quality 87/100: looks the same side by side)
slimdeer: checked 3 images in 2 packages; 3 measured, 0 cached, 0 skipped (already optimized or below 4.1 kB), 0 errors.
```

A CI step that gates on its exit code therefore covers test fixtures, examples and vendored packages too. To check only the root package, leave the others out, like `--exclude 'packages/*'`.

`--exclude` matches a path from the image's package, as the rule's `exclude` does, or from the folder the command runs in, so `packages/*/fixtures` works from a monorepo's root and `fixtures` from inside a package. It also matches an image's real path through links, and ignores letter case on macOS and Windows. Quote patterns so your shell doesn't expand them first.

The walk skips the same dependency, build, hidden and test-output folders as the project scan. Links to image files are included, unless an exclusion matches their target; links to folders are not followed. An image named several ways (through a link, in another letter case on macOS and Windows, or as a file inside a folder you also named) is checked and counted once; one linked into another package is checked under the first path the walk finds, so a lint in the other package measures it once more. An image's package is the nearest folder above it with a `package.json`, with the command's folder as fallback. `--cache-dir .slimdeer` also copies successful measurements already in the local cache into `.slimdeer`, so you can commit them without measuring again; run from a monorepo's root, it fills each package's `.slimdeer`. Failed measurements stay in the machine's local cache.

What the check leaves out or can't take, it says after the checked line:

- In a project that depends on `gatsby`, the build output in `public/`, unless you name it or something in it:

  ```
  slimdeer: left out 1 image in public, Gatsby's build output; to check it too, run: npx oxlint-plugin-slimdeer --check public
  ```

- Images the [quality floor](#the-quality-floor) turned down, and only those: one whose best result would save less than the thresholds isn't named. The command it gives may still not list them.

  ```
  slimdeer: 1 image can't be made smaller without a visible difference (its best quality is below 70), so it isn't listed; to try it at a lower target, run: npx oxlint-plugin-slimdeer --check public/fade.png --target 60
  ```

- At an explicit target, images no smaller file reaches it for, with the best quality rounded down, so it never reads as the target. An image slimdeer finds nothing smaller for at all isn't named, as at the automatic target:

  ```
  slimdeer: public/fade.png isn't listed: no smaller file reaches --target 60 (the best reaches quality 59/100)
  ```

- Git LFS pointers, each named on stderr as `a Git LFS pointer, not the image itself`:

  ```
  slimdeer: 1 image is a Git LFS pointer: git lfs pull fetches it (in GitHub Actions, check out with lfs: true)
  ```

- Files named like images that aren't PNGs or JPEGs, each named on stderr, with the command that leaves them out (only for files the walk found, not ones you named):

  ```
  slimdeer: 1 file named like an image isn't a PNG or JPEG; if that's expected (a test fixture, say), to leave it out, run: npx oxlint-plugin-slimdeer --check --exclude packages/vite/src/node/ssr/runtime/__tests__/fixtures/assets/placeholder.png
  ```

When it finds nothing, it says `slimdeer: found no PNG or JPEG images to check in` and where it looked: the paths as you typed them, or the current folder by its full path. With `--exclude`, it adds `, apart from what --exclude leaves out`.

If measuring itself fails, for example because the cache folder can't be written, the check says why once (`slimdeer: measuring failed: EACCES: permission denied, mkdir '…'`), and each image it couldn't measure reads `not measured (see above)`. When it only copies results your machine already has into a `--cache-dir` it can't write, it names that folder once (`.slimdeer: can't write this cache folder: permission denied`, or `a file is in the way`), lists the images as usual, and exits `2`.

Already marked images and images too small to meet the byte threshold need no measurement, even ones the rule would skip, like a small grayscale icon with a color profile. A check that can't read or measure an image exits `2`, even if it also finds savings; the lint rule fails open instead, except on a timeout (see [The cache](#the-cache)).

| Exit code | Meaning |
|---|---|
| `0` | No image clears both thresholds, or it found no images at all. |
| `1` | At least one image could be smaller by both thresholds. |
| `2` | A mistake in the arguments, a missing or unreadable path, a file that isn't a PNG or JPEG (a Git LFS pointer included), or a measurement that failed. The other results are still printed. |

### JSON

`--json` (with `--check` only) prints one JSON document on stdout and nothing else there. Progress and errors still go to stderr, and the exit codes are the same. In `example/`, with four of the five images left out:

```
{
  "version": "0.6.0",
  "options": {
    "target": "auto",
    "minSavedBytes": 4096,
    "minSavedPercent": 10,
    "exclude": [],
    "cacheDir": null
  },
  "counts": {
    "checked": 6,
    "measured": 0,
    "cached": 5,
    "skipped": 1,
    "packages": 1,
    "errors": 0
  },
  "totals": {
    "images": 5,
    "original": 1040462,
    "compressed": 317339,
    "saved": 723123,
    "percent": 70
  },
  "images": [
    {
      "file": "public/hero.png",
      "package": ".",
      "original": 509372,
      "compressed": 150714,
      "saved": 358658,
      "percent": 70,
      "outcome": "hit",
      "quality": 87,
      "looks": "the same side by side"
    },
    …
  ],
  "declined": [],
  "missed": [],
  "errors": [],
  "builds": []
}
```

- `version` is the plugin's version. Sizes are in bytes.
- `images` are the images the lines list, biggest saving first. `package` is the image's package folder from where the command ran (`.` for that folder). `outcome` is `"hit"` for a lossy result, with its `quality` and `looks`, and `"lossless"` or `"exact"` for a lossless one, with `quality: null` and `looks: "identical"`.
- `declined` are the images the quality floor turned down, and `missed` the ones short of an explicit target, each as `{ file, original, quality }`, with the best quality rounded down.
- `errors` are `{ file, message }`, each message complete on its own. `builds` are the Gatsby build folders left out, as `{ folder, images }`.

## Review images before and after

```bash
npx oxlint-plugin-slimdeer --review [PATH...] [--open]
npx oxlint-plugin-slimdeer --review --flagged [--open] [--target auto|T] [--cache-dir PATH]
```

`--review` takes `--check`'s paths and options, except `--json`. It writes a preview of every image `--check` would list, and one page that compares each preview with its original, to `node_modules/.cache/slimdeer/review/index.html` in the project it runs in. It changes no image and uploads nothing. Like `--check`, it reads no linter configuration, so pass `--exclude` for the images the rule's `exclude` keeps, or after a lint, use `--review --flagged` (below). With `--format webp` or `--format avif`, the page compares each image with its WebP or AVIF copy instead ([WebP and AVIF](#see-them-first)). In `example/`, with nothing cached yet:

```
$ npx oxlint-plugin-slimdeer --review
slimdeer: measuring 5 images not in the cache yet...
slimdeer: writing 5 previews...
slimdeer: 5 images could be 723 kB smaller (1.0 MB → 317 kB, 70% smaller). Images unchanged.
slimdeer: the page that compares each one before and after: file:///…/example/node_modules/.cache/slimdeer/review/index.html
slimdeer: open it in a browser, untick any image to keep as it is, and run the command it gives.
```

The page:

- Shows each original and its preview on top of each other, with a divider you drag or move with the arrow keys. It opens at Fit; 100% and 200% show the pixels as they are, and you drag or scroll to pan. Small icons open enlarged, up to 800%, and long screenshots and banners open at 100%. Transparent images can sit on checks, white or black.
- Says what it shows: "Each “after” is the file the command writes, byte for byte. Nothing was uploaded, and no image file was changed."
- Has a tick per image, "Tick all", "Untick quality below 80", a "Quality below 80" filter, and from 10 images a "Jump to an image" list. Copies of one image share a card, which gives one copy's numbers, marked "each".
- Keeps a bar at the bottom with the running total ("5 of 5 images ticked: could save 723 kB (1.0 MB → 317 kB, 70% smaller)", which screen readers announce) and the command that shrinks the ticked images, with a Copy button, to run in the folder it names. Past 6000 characters, the command is split into several, and the terminal then says to run the commands it gives. A "Skip to the command" link leads there from the keyboard. In a window 480 px tall or less, the bar ends the page instead of staying in view. If the browser won't let the page copy, it selects the command and says to press Ctrl+C (⌘C on a Mac).
- Names what it leaves out: images the quality floor turned down (with the command that tries them at `--target 60`), images short of the target, and images that couldn't be checked.
- Follows light and dark mode, and works from disk, with no server and no network.

`--open` opens the page with the system's opener (`open` on macOS, `xdg-open` elsewhere, and on Windows its own `explorer.exe`, by its full path) and waits up to 2 seconds to see whether it fails. Without it nothing opens, which suits CI and coding agents: they can give you the printed address. When the opener is missing or fails, like `xdg-open` over SSH with no display, the command says to open the printed address in a browser, then says on stderr that it couldn't open one; the exit code doesn't change.

After a lint or `--check`, a review compresses each listed image once more, for its preview; with nothing cached, it measures first. A second review reuses the previews, and an interrupted one keeps the ones it wrote. The review folder belongs to the command: each review removes anything else in it, it has its own `.gitignore`, and if it is a link to another folder, `--review` refuses to run. After its totals, `--review` prints the notes `--check` would (Gatsby builds, LFS pointers, files it can't take, images the floor turned down, images short of the target), with `--review` in the commands that run the same thing again; for Gatsby's build output, that command names your paths too, since a page shows one run's images:

```
slimdeer: left out 1 image in public, Gatsby's build output; to review it too, run: npx oxlint-plugin-slimdeer --review . public
```

With nothing to review, it prints what `--check` prints, then `slimdeer: no image to compare, so no page was written.`, and removes an old page.

After a lint, `--review --flagged` writes the page for exactly the images the lint flagged, each at the target the lint measured it at, so images the rule's `exclude` option or a disable comment leaves out stay out. It reads each result from the cache folder the lint measured it into, `settings.slimdeer.cacheDir` included, so it measures nothing again; a `--target` or `--cache-dir` given here wins for all. The thresholds don't apply, and it can't be combined with paths, `-o`, `--json`, `--check`, `--exclude`, `--min-saved-bytes` or `--min-saved-percent`. The page's command lists the ticked paths, never `--flagged`:

```
$ npx oxlint-plugin-slimdeer --review --flagged
slimdeer: writing 4 previews...
slimdeer: 4 images could be 718 kB smaller (1.0 MB → 310 kB, 70% smaller). Images unchanged.
slimdeer: the page that compares each one before and after: file:///…/example/node_modules/.cache/slimdeer/review/index.html
slimdeer: open it in a browser, untick any image to keep as it is, and run the command it gives.
```

When the flagged images have different targets, the page says which image has which, marks each card, and gives one command per target ("run these 2 commands"); the terminal then says to run the commands it gives. Like `--flagged`, it uses the list only in the folder whose lint left it (see [How to fix it](#how-to-fix-it)), and it leaves out an image whose bytes changed since the lint (a branch switch, a new export, another tool's pass), among the images it couldn't check:

```
src/assets/crystal-ball.png: changed since the last lint here; lint again to check it
```

After a lint that flagged nothing, it says `slimdeer: the last lint here left no images to review with --flagged.` When none of the flagged images can be made smaller any more, or at the `--target` given, it says so and writes no page.

| Exit code | Meaning |
|---|---|
| `0` | It wrote the page, or found nothing to review. |
| `2` | A mistake in the arguments, no list for `--flagged`, an image or folder that couldn't be checked or previewed (an image changed since the lint included; the page still shows the others), or a review folder that can't be made or written, or is a link. |

## How to fix it

Run the command from the warning:

```bash
npx oxlint-plugin-slimdeer public/hero.png
```

It writes slimdeer's smaller file over the image, and marks it so this rule doesn't flag it again. The file keeps its name and format, so no code changes. slimdeer is lossy, so commit first. To see the result before you shrink anything, lint, then run [`--review --flagged`](#review-images-before-and-after): it shows the images the lint flagged, so images the rule's `exclude` option or a disable comment leaves out stay out. Plain `--review` shows every image `--check` would list and, like `--check`, reads no linter configuration, so pass `--exclude` for the images you keep. For one image, `-o` writes the result as a new file instead, to compare with the original:

```
$ npx oxlint-plugin-slimdeer public/photo.jpg -o photo.preview.jpg
public/photo.jpg → photo.preview.jpg: 235 kB → 85 kB (64% smaller, quality 76/100: looks close, with differences you might spot side by side)
```

`-o` takes the file to write, not a folder. It refuses the image itself (the same path, another letter case on macOS or Windows, or a link to it), and writes nothing:

```
oxlint-plugin-slimdeer: -o public/hero.png is public/hero.png itself: give another name, or leave out -o to shrink it in place
Run npx oxlint-plugin-slimdeer --help to see every option.
```

OUT's extension says what to write. `.png` or `.apng` for a PNG, and `.jpg` or `.jpeg` for a JPEG, get the shrink; `.webp` and `.avif` get a copy in that format; the image stays as it is, and the copy saves nothing until your code names it ([WebP and AVIF](#write-images-as-webp-or-avif)). Any other extension, or none, is a mistake in the arguments (exit `2`), and nothing is written:

```
oxlint-plugin-slimdeer: -o hero.jpg: public/hero.png is a PNG, so OUT must end in .png, or in .webp or .avif to write that format
Run npx oxlint-plugin-slimdeer --help to see every option.
```

Quality scores estimate perception; they are not a guarantee for every image or viewing condition.

To shrink everything the last lint flagged, each at the target it was measured at:

```
$ npx oxlint-plugin-slimdeer --flagged
slimdeer: shrinking 4 images in place (lossy; commit first so you can undo)
[1/4] src/assets/crystal-ball.png: 35 kB → 11 kB (68% smaller, quality 87/100: looks the same side by side)
[2/4] public/photo.jpg: 235 kB → 85 kB (64% smaller, quality 76/100: looks close, with differences you might spot side by side)
[3/4] src/assets/diagram.png: 248 kB → 63 kB (75% smaller, quality 90/100: looks identical)
[4/4] public/hero.png: 509 kB → 151 kB (70% smaller, quality 87/100: looks the same side by side)
slimdeer: 4 images, 1.0 MB → 310 kB (718 kB smaller). Lint again to check.
```

A lint outside the editor leaves that list in `node_modules/.cache/slimdeer/flagged.json`, with the folder it ran in, and `--flagged` uses the list only in that folder. A copied project, or a worktree that links another one's `node_modules`, gets this line and exit `1` instead of a rewrite of the other folder's images:

```
oxlint-plugin-slimdeer: no list of flagged images here: lint in this folder first (npx oxlint, or eslint without --cache); if a lint here flagged no image, there is nothing to do
```

`--flagged` reads no linter configuration, only that list: after you exclude an image or turn off its warning, lint again before you run it. After a lint that flagged nothing, `--flagged` says `the last lint here left no images to shrink with --flagged`; where the rule has never measured an image, there is no list, and it prints the line above. A `--target` given with `--flagged` wins for every image. `--help` lists the rest.

`--flagged` shrinks only the bytes the lint measured. An image that changed since (a branch switch, a new export, another tool's pass), even during the run before its turn came, is left as it is, and the command exits `1` after shrinking the rest; lint again to check it (with ESLint, without `--cache`):

```
src/assets/crystal-ball.png: changed since the last lint here; left as is (lint again to check it)
```

An image the command itself wrote since the lint says `already shrunk by this command; left as is` instead. Several images run in parallel, one engine per core, 8 at most. Each image is shrunk once, however it's spelled: `Logo.png` and `logo.png` are one image on macOS and Windows. An image that changes while it is being compressed is left as it is, and so is a read-only one:

```
public/locked.png: permission denied
```

A run killed in the middle of a write leaves the image as it was, but can leave a hidden file next to it (or next to OUT, with `-o`) named `.<name>.<pid>.<random>.tmp`, which nothing reads, so delete it; a `--format` copy can leave a folder instead ([Limits and costs](#limits-and-costs)).

The command exits `0` when every image was shrunk or left as it is for a reason it gives (`already shrunk by this command`, say), `1` when an image failed (missing, read-only, changed meanwhile or since the lint) or `--flagged` found no list, and `2` on a mistake in the arguments. The other images are still done.

Use one quality target for code that shares an image. When several references use fixed targets, `--flagged` uses the highest one only if its measurement warrants a warning. If a stricter reference produces no warning, or references mix automatic and fixed targets, the image is left out of bulk compression and the summary explains why. Constraints from enabled references also count when their measurements are missing or their thresholds produce no warning.

On Windows, the commands the plugin prints write paths and `--exclude` patterns with `/`, even ones typed with `\`, so they run from cmd.exe and PowerShell alike. Commands for unusual file or folder names are labeled `Run in PowerShell`. They use literal arguments and invoke Node with the installed plugin's executable directly, avoiding expansion of `$`, backticks or `%` by PowerShell or npm's batch shim. Paste those commands into PowerShell. Common paths keep the shorter `npx` command, and so do paths with an `@` after the first character, like `public/logo@2x.png`; only a path that starts with `@`, like `@brand/logo.png`, needs PowerShell. `--flagged` reads image paths directly from its list.

- **Images keep their color profile and EXIF orientation.** Everything else is dropped: the rest of EXIF (GPS included), XMP and IPTC, so copyright and captions too. A profile that only says sRGB goes as well, since browsers assume sRGB.
- **The mark is a short text tag,** so a fixed file stays fixed on every machine. Each PNG or JPEG the command writes carries `pngdeer <size>`, in a PNG `tEXt` entry named Software or in a JPEG comment. Versions up to 0.5.0, under the old name oxlint-plugin-pngdeer, recognize only that word, so the command keeps writing it, and every version recognizes every file it wrote; it also recognizes `slimdeer <size>`. Metadata strippers (`oxipng --strip`, ImageOptim) remove it, and images shrunk by slimdeer's own web app or command-line tool aren't marked: the rule measures those again and may flag them. The tag checks file size, so an edit that preserves both the tag and the byte count is still treated as optimized. Don't shrink an image twice, as each lossy pass costs quality.
- **Images another tool already compressed can still be flagged,** because slimdeer compares with the file you have, not the original. Look at those on the review page before shrinking them.

## Write images as WebP or AVIF

The command can also write a WebP or AVIF copy of a PNG or JPEG, next to it or to a file you name. It makes the copy at the quality score the image's own shrink would have, so the two sizes compare at the same quality. The original stays as it is, and `--format` never writes over a file. A copy saves nothing until your code names it, so after writing, the command lists the lines that still name the original. Like the shrink, a copy is lossy: it looks about the same, and its bytes differ.

The lint rule suggests no format change: its fix keeps each image's name and format, so no code changes. It doesn't measure WebP or AVIF files, and copies carry no mark.

```bash
npx oxlint-plugin-slimdeer --check --format webp           # which images are worth it
npx oxlint-plugin-slimdeer --review --format webp          # see them before and after
npx oxlint-plugin-slimdeer --format webp public/hero.png   # write public/hero.webp
npx oxlint-plugin-slimdeer public/photo.jpg -o photo.avif  # write the copy you name
```

### The four commands

| Command | What it writes | Also takes |
|---|---|---|
| `IMAGE... --format webp\|avif` | Each image's copy next to it, under its name with the format's extension: `public/hero.png` → `public/hero.webp`. | `--target` |
| `IMAGE -o OUT.webp` or `IMAGE -o OUT.avif` | One image's copy, to OUT. A `--format` given too must name OUT's format. | `--target` |
| `--check [PATH...] --format webp\|avif` | Nothing: it compares each image's copy with its shrink ([below](#check-first)). | `--check`'s options, `--json` included |
| `--review [PATH...] --format webp\|avif` | Previews of the copies, and a page that compares them with the originals ([below](#see-them-first)). | `--review`'s options, `--open` included; `--review --flagged --format` too |

`--json` needs `--check`, and `--exclude`, `--cache-dir` and the two thresholds need `--check` or `--review`: when writing copies, each is a mistake in the arguments, and so is `-o` with several images. Two images whose copies would get one name stop the run before any work:

```
oxlint-plugin-slimdeer: public/hero.png and public/hero.jpg would both be written as public/hero.webp: convert one of them with -o
Run npx oxlint-plugin-slimdeer --help to see every option.
```

`--flagged --format` is refused: each copy needs its own change in the code, which the review page lets you choose.

```
oxlint-plugin-slimdeer: --flagged --format would write a new file for every image the lint flagged, and each one needs a change in the code: review them first with npx oxlint-plugin-slimdeer --review --flagged --format webp, and run the command the page gives
Run npx oxlint-plugin-slimdeer --help to see every option.
```

### The quality of a copy

At the automatic target, a copy aims at the quality score the image's own shrink reaches. With `--target T`, it aims at T, as the shrink does. Each format's own automatic setting can aim lower: WebP's gave `hero.png` quality 78 where its shrink has 87, so a size at that setting would set a smaller file against a worse picture ([FINDINGS.md](../../FINDINGS.md#2026-11-renamed-slimdeer-slimdeer-031-webp-and-avif-copies)). In `example/`, `public/hero.png` shrinks as PNG to 151 kB at quality 87, and its WebP copy at quality 87 is 92 kB:

```
$ npx oxlint-plugin-slimdeer --format webp public/hero.png
public/hero.png → public/hero.webp: 509 kB → 92 kB (82% smaller, quality 87/100: looks the same side by side); shrunk as PNG at the same quality: 151 kB
slimdeer: public/hero.png is still there, and this line still names it; point it at hero.webp:
  src/App.jsx:10  <img src="/hero.png" alt="An arcade stick" />
  and 1 mention in Markdown: SOURCES.md:10
slimdeer: delete public/hero.png only once nothing uses it; other sites, emails and share previews may link to files in public/.
```

When the shrink doesn't reach quality 70 ([the quality floor](#the-quality-floor)), there is no quality to match, and the command asks you to choose one:

```
img/noisy.png: not written: shrunk as PNG it doesn't reach quality 70, so there is no quality to match; to choose one, add --target, like: npx oxlint-plugin-slimdeer img/noisy.png --target 80 --format webp
```

When no copy reaches the target, the line gives the best quality found, rounded down: `img/noisy.png: not written: as WebP, no file reaches --target 80 (the best reaches quality 61/100)`.

### When a copy is written

With `--format`, a copy is written only when it is smaller than the original and than the image's own shrink at the same quality. Otherwise the line says why, and what to run instead:

```
$ npx oxlint-plugin-slimdeer --format avif src/assets/diagram.png
slimdeer: AVIF is slow: often about a minute per image
src/assets/diagram.png: not written: as AVIF it would be 100 kB, no smaller than shrinking it as PNG at the same quality (63 kB); to shrink it in place instead, run: npx oxlint-plugin-slimdeer src/assets/diagram.png
```

With `-o`, the copy is written whenever it is smaller than the original, and the command says when the shrink would be smaller:

```
$ npx oxlint-plugin-slimdeer src/assets/diagram.png -o diagram.avif
slimdeer: AVIF is slow: often about a minute per image
src/assets/diagram.png → diagram.avif: 248 kB → 100 kB (60% smaller, quality 90/100: looks identical); shrunk as PNG at the same quality: 63 kB, smaller than this AVIF
slimdeer: to shrink src/assets/diagram.png in place instead, run: npx oxlint-plugin-slimdeer src/assets/diagram.png
```

`--format` never writes over a file. A file already there with the copy's bytes, reached through a link or not, is left as it is; anything else in its place (another file, a folder, a link to other bytes or to nothing) stops that image, and the command exits `1`:

```
public/hero.png → public/hero.webp: already written; left as is
```

```
public/photo.jpg: not written: public/photo.webp exists already; move it, or name another file with -o
```

An image whose name already ends in the format's own extension (`.webp` with `--format webp`, `.avif` with `--format avif`) has no new name to take, and gets `not written: its name already ends in .webp; name the copy with -o`. Any other file with that ending, like a copy an earlier run wrote that `public/*` picks up again, gets `not written: its name ends in .webp, and it isn't a PNG or JPEG`, and doesn't change the exit code. A copy is named after the image as its folder lists it, so on macOS and Windows, `HERO.PNG` typed for `hero.png` gets `hero.webp`.

`-o` writes the file you name, over any file already there, as it does for a shrink, and refuses the image itself (see [How to fix it](#how-to-fix-it)). A `--format` that names another format than OUT's extension is a mistake in the arguments, and so is a folder:

```
oxlint-plugin-slimdeer: --format avif and -o hero.webp name different formats: give one of them
Run npx oxlint-plugin-slimdeer --help to see every option.
```

```
oxlint-plugin-slimdeer: -o public is a folder: give the file to write, like -o public/hero.webp
Run npx oxlint-plugin-slimdeer --help to see every option.
```

Writing converts the image again, even after a check measured its copy, so writing an AVIF copy takes as long as measuring one.

| Exit code | Meaning |
|---|---|
| `0` | Each image was written, was already written, or was left out for a reason its line gives. With `-o`, only when OUT was written. |
| `1` | An image failed (missing, unreadable, an engine error), or something else is where its copy goes. With `-o`, OUT wasn't written. |
| `2` | A mistake in the arguments. |

### What it prints after writing

The command then lists the lines that still name each original, so you can point them at the copy. With several images, it first gives their sizes in all. The end of a run over `example/`'s six images:

```
slimdeer: wrote 6 WebP files, 1.0 MB → 242 kB in all (shrunk in place at the same quality, they would be 318 kB). The originals are still there.
slimdeer: these lines still name the originals; point each one at its new file:
  src/App.jsx:1   import diagram from "./assets/diagram.png";
  src/App.jsx:2   import crystalBall from "./assets/crystal-ball.png";
  src/App.jsx:3   import heart from "./assets/heart.png";
  src/App.jsx:5   const banner = new URL("./assets/diagram.png", import.meta.url);
  src/App.jsx:10  <img src="/hero.png" alt="An arcade stick" />
  src/App.jsx:15  <img src="/photo.jpg" alt="Motocross riders at a starting line" />
  and 6 mentions in Markdown: SOURCES.md:7, SOURCES.md:8, SOURCES.md:9, SOURCES.md:10, SOURCES.md:11, and 1 more
slimdeer: delete an original only once nothing uses it; other sites, emails and share previews may link to files in public/.
```

- A line names an original by a path: from its own file (`./assets/diagram.png`), from the project's folder, or from `public/` or `static/` (`/hero.png`), as written or URL-encoded. When no line does, the lines that hold its file name are listed instead. The search covers the project the command runs in, packages included, and ignores letter case on macOS and Windows. Code comes first, then Markdown, each by file path.
- Up to 10 lines of code and 5 Markdown places are shown. For one image with more, the line after them gives the search that finds them all: `and 2 more lines: git grep -nF -e ball.png`.
- An image no file names gets `slimdeer: no file here names assets/fire.png; something outside this project may (a CMS, an email, another site), so keep it until you know.`
- For images in `public/` or `static/`, which a site serves as they are, the last line adds that other sites, emails and share previews may link to them.

### Check first

`--check --format` measures each image's copy at the same quality score as its shrink, and lists the copies that save at least 4.1 kB and 10% more than the shrink. It changes no image and writes no copy. In `example/`, after a plain `--check`:

```
$ npx oxlint-plugin-slimdeer --check --format webp
slimdeer: measuring 5 images as WebP at the same quality...
src/assets/crystal-ball.png: as WebP, could be 87% smaller (35 kB → 4.8 kB, quality 87/100: looks the same side by side); shrunk as PNG at the same quality: 11 kB
src/assets/diagram.png: as WebP, could be 78% smaller (248 kB → 55 kB, quality 90/100: looks identical); shrunk as PNG at the same quality: 63 kB
public/hero.png: as WebP, could be 82% smaller (509 kB → 92 kB, quality 87/100: looks the same side by side); shrunk as PNG at the same quality: 151 kB
slimdeer: checked 6 images; 5 measured, 0 cached, 1 skipped (already optimized or below 4.1 kB), 0 errors.
slimdeer: 2 images aren't listed: as WebP they would save less than 4.1 kB or 10% more than shrinking them in place (public/photo.jpg: 83 kB against 85 kB; public/unused-fire.png: 6.6 kB against 7.5 kB); to shrink them in place instead, run: npx oxlint-plugin-slimdeer public/photo.jpg public/unused-fire.png
slimdeer: as WebP, 3 images could be 641 kB smaller (793 kB → 152 kB, 81% smaller); shrunk in place at the same quality, they would be 225 kB. Images unchanged.
slimdeer: to see them before and after on one page first, run: npx oxlint-plugin-slimdeer --review --format webp
slimdeer: to write them as WebP next to the originals, which stay, run: npx oxlint-plugin-slimdeer public/hero.png src/assets/diagram.png src/assets/crystal-ball.png --format webp
```

- With `--format`, `--min-saved-bytes` is the saving beyond the shrink, and `--min-saved-percent` that saving as a percentage of the shrink's size. Writing takes any copy smaller than both the original and the shrink, so it also writes copies the check leaves out, like `public/photo.jpg`'s (83 kB against 85 kB).
- The checked line counts an image as measured when this run measured its shrink or its copy, and as cached when it read both from the cache, including a result that another run measured while this one waited for it. Above, the shrinks came from the plain `--check` and the copies were new; a second run reads both and says `0 measured, 5 cached`.
- An image whose copy is there already isn't listed, so a project that keeps both files passes: `slimdeer: public/hero.png already has a WebP file next to it, which --format never replaces, so it isn't listed`. When every image that would be smaller has its copy, the check ends `slimdeer: as WebP, every image that would be smaller already has its WebP file. Images unchanged.` and exits `0`.
- The images it doesn't list get a line for each reason: copies that save too little beyond the shrink (above), images [left out](#images-left-out), images the quality floor turned down (`slimdeer: public/fade.png isn't listed: shrunk in place it doesn't reach quality 70, so there is no quality to match; to choose one, run: npx oxlint-plugin-slimdeer --check public/fade.png --target 80 --format webp`), and at a `--target`, images no copy reaches it for (`slimdeer: public/photo.jpg isn't listed: as WebP, no file reaches --target 98 (the best reaches quality 92/100)`). When nothing is listed and an image was left out, turned down or short of the target, the check ends `slimdeer: as WebP, no image here is listed. Images unchanged.`
- The exit codes are `--check`'s: `0` when no copy is listed, `1` when one is, `2` when an image couldn't be checked.
- In GitHub Actions, the job summary is headed `slimdeer --check --format webp`, and its table gives each copy's size next to the shrink's: `| Image | Now | As WebP | Saves | Quality | Shrunk as PNG or JPEG |`.

### Its JSON

`--check --json --format webp` (or `avif`) prints one JSON document that adds the copies to what [`--json`](#json) gives. These are all its fields, from real runs on `example/` and on projects with an image of each kind it doesn't list:

| Field | Type | Meaning |
|---|---|---|
| `version` | string | The plugin's version. |
| `options` | object | `target` (`"auto"` or a number), `format` (`"webp"` or `"avif"`), `minSavedBytes`, `minSavedPercent`, `exclude` (the patterns given) and `cacheDir` (`null` for the default). |
| `counts` | object | `checked`, `measured`, `cached`, `skipped`, `packages` and `errors`, as in the checked line. |
| `totals.images` | number | How many copies are listed. |
| `totals.original` | bytes | Those images' sizes now. |
| `totals.compressed` | bytes | Their copies' sizes. |
| `totals.saved`, `totals.percent` | bytes, number | `original` less `compressed`, and that as a percentage of `original`. |
| `totals.sameFormat` | bytes | What shrinking them in place would leave: each image's shrink where that is smaller, else the image itself. |
| `totals.savedMore` | bytes | `sameFormat` less `compressed`: what the copies save beyond the shrinks. |
| `images[]` | array | The listed images, the biggest saving beyond the shrink first. |
| `images[].file`, `images[].package` | string | The image's path, and its package's folder, from where the command ran (`.` for that folder). |
| `images[].output` | string | Where `--format` writes its copy. |
| `images[].original`, `images[].compressed` | bytes | The image's size, and its copy's. |
| `images[].saved`, `images[].percent` | bytes, number | What the copy saves, and that as a percentage. |
| `images[].quality`, `images[].looks` | number, string | The copy's quality score, rounded, and how close it looks. |
| `images[].sameFormat.compressed` | bytes or `null` | The size of the image's shrink; `null` when no file reached the target. |
| `images[].sameFormat.outcome` | string | The shrink's outcome: `"hit"`, `"lossless"`, `"exact"`, `"original"` (nothing smaller) or `"miss"`. |
| `images[].sameFormat.quality` | number or `null` | The shrink's quality score, for a `"hit"`. |
| `images[].sameFormat.savedMore`, `images[].sameFormat.percentMore` | bytes, number | What the copy saves beyond the shrink (or beyond the image, where the shrink isn't smaller), and that as a percentage of it. |
| `images[].namedIn[]` | array | The lines that name the image, as `{ file, line, text }`: `line` counts from 1, and `text` is trimmed and cut to 100 characters. Code first, then Markdown, each by file path. |
| `notWorthIt[]` | array | Copies that reach their quality but don't save enough beyond the shrink, the biggest image first: `{ file, original, compressed, sameFormat: { compressed, outcome, quality } }`, `compressed` being the copy's size. |
| `leftOut[]` | array | Images not measured as the format: `{ file, reason }`, the reason worded as in the rows of [Images left out](#images-left-out) marked `leftOut`. |
| `existing[]` | array | Images whose copy's place something already takes: `{ file, output }`. |
| `declined[]` | array | Images the quality floor turned down, with no quality to match: `{ file, original, quality }`, the best quality rounded down. |
| `missed[]` | array | Images no copy reaches the target for: `{ file, original, quality }`, the best quality rounded down. |
| `errors[]`, `builds[]` | array | As without `--format`: `{ file, message }`, and the Gatsby build folders left out as `{ folder, images }`. |

In `example/`, cut to the first image of each list:

```
{
  "version": "0.6.0",
  "options": {
    "target": "auto",
    "format": "webp",
    "minSavedBytes": 4096,
    "minSavedPercent": 10,
    "exclude": [],
    "cacheDir": null
  },
  "counts": {
    "checked": 6,
    "measured": 0,
    "cached": 5,
    "skipped": 1,
    "packages": 1,
    "errors": 0
  },
  "totals": {
    "images": 3,
    "original": 792545,
    "compressed": 151714,
    "saved": 640831,
    "percent": 81,
    "sameFormat": 224699,
    "savedMore": 72985
  },
  "images": [
    {
      "file": "public/hero.png",
      "package": ".",
      "output": "public/hero.webp",
      "original": 509372,
      "compressed": 92082,
      "saved": 417290,
      "percent": 82,
      "quality": 87,
      "looks": "the same side by side",
      "sameFormat": {
        "compressed": 150714,
        "outcome": "hit",
        "quality": 87,
        "savedMore": 58632,
        "percentMore": 39
      },
      "namedIn": [
        {
          "file": "src/App.jsx",
          "line": 10,
          "text": "<img src=\"/hero.png\" alt=\"An arcade stick\" />"
        },
        {
          "file": "SOURCES.md",
          "line": 10,
          "text": "| `public/hero.png` | [Wikimedia Commons: Sega Dreamcast Arcade Stick](https://commons.wikimedia.or…"
        }
      ]
    },
    …
  ],
  "notWorthIt": [
    {
      "file": "public/photo.jpg",
      "original": 235315,
      "compressed": 82764,
      "sameFormat": {
        "compressed": 85140,
        "outcome": "hit",
        "quality": 76
      }
    },
    …
  ],
  "leftOut": [],
  "existing": [],
  "declined": [],
  "missed": [],
  "errors": [],
  "builds": []
}
```

### See them first

`--review --format webp` (or `avif`) writes the copies `--check --format` would list as previews, and one page that compares each with its original. In `example/`, with nothing cached yet:

```
$ npx oxlint-plugin-slimdeer --review --format webp
slimdeer: measuring 5 images not in the cache yet...
slimdeer: measuring 5 images as WebP at the same quality...
slimdeer: as WebP, 3 images could be 641 kB smaller (793 kB → 152 kB, 81% smaller); shrunk in place at the same quality, they would be 225 kB. Images unchanged.
slimdeer: 2 images aren't on the page: as WebP they would save less than 4.1 kB or 10% more than shrinking them in place; to shrink them in place instead, run: npx oxlint-plugin-slimdeer public/photo.jpg public/unused-fire.png
slimdeer: the page that compares each one before and after: file:///…/node_modules/.cache/slimdeer/review/index.html
slimdeer: open it in a browser, untick any image to keep as it is, and run the command it gives: it writes the WebP files next to the originals and lists the code that still names them.
```

Each "after" on the page is the copy the command writes, byte for byte. Each card gives the copy's quality score and what the shrink would weigh ("Shrunk as PNG at the same quality: 151 kB"), with a "Write as WebP" tick. The page's command writes the ticked copies next to their originals and lists the code that still names them, and the page names the images it leaves out, for the reasons `--check --format` gives. On an AVIF page, a browser that can't show AVIF gets "This browser can't show AVIF (Safari needs 16.4 or later)." under each picture. A plain `--review` page offers the same review as WebP, unless the project depends on a framework that converts images ([below](#notes-it-prints)).

`--review --flagged --format webp` does the same for the images the last lint flagged, and lists their copies by `--review`'s thresholds. With nothing to compare, a review prints what `--check --format` would, then `slimdeer: no image to compare as WebP, so no page was written.`

### Images left out

These images get no copy. Writing says `not written:` and the reason, worded as below. `--check --format` gives the reasons marked `leftOut` after the checked line, and `--review --format` before the page's address, like `slimdeer: 1 image left out: img/wide.png (too wide or tall for WebP: at most 16,383 pixels a side)`, and the JSON lists them in `leftOut[]`. The other rows get the lines [Check first](#check-first) shows, and go in the JSON list the middle column names:

| Reason, as writing words it | In `--check --json` | What to do |
|---|---|---|
| `already shrunk by this command, so converting it would be a second lossy pass; convert the original from before it was shrunk` | `leftOut` | Convert the original, from your version history. `--check` says `1 image this command already shrank is left out (public/photo.jpg)`. |
| `animated PNGs can't be written as WebP yet` (or AVIF) | `leftOut` | Keep it as a PNG. |
| `its eXIf data turns it, and the WebP file would show it unturned; shrink it as PNG instead` | `leftOut` | Shrink it in place. |
| `too wide or tall for WebP: at most 16,383 pixels a side` | `leftOut` | Keep it, or try AVIF. |
| `too large for AVIF: 25.0 MP, at most 24` | `leftOut` | Keep it, or try WebP. |
| `Next.js serves app/ metadata images by their file name, and doesn't take WebP or AVIF there` | `leftOut` | Keep it: [Next.js](https://nextjs.org/docs/app/api-reference/file-conventions/metadata/opengraph-image) takes only JPEG, PNG and GIF for `opengraph-image`, and JPEG and PNG for `apple-icon`. |
| `React Native's Image doesn't list AVIF among the formats it shows` (AVIF only, in a project that depends on `react-native` or `expo`) | `leftOut` | Try WebP, which [React Native's Image](https://reactnative.dev/docs/image) lists, with limits on iOS and Android that page gives. |
| `its name already ends in .webp; name the copy with -o` | `existing`, when the image is given by path (a folder's scan skips the name) | Name the copy with `-o`. |
| `shrunk as PNG it doesn't reach quality 70, so there is no quality to match; to choose one, add --target, like: …` | `declined` | Choose a target, and look at the copy before you use it. |
| `as WebP, no file reaches --target 80 (the best reaches quality 61/100)` | `missed` | Choose a lower target, or keep the image. |
| `as AVIF it would be 100 kB, no smaller than shrinking it as PNG at the same quality (63 kB); to shrink it in place instead, run: …` | `notWorthIt` | Shrink it in place, with the command the line gives. |
| `as WebP it would be …, no smaller than the image itself (…)` | `notWorthIt` | Keep the image. |
| `public/photo.webp exists already; move it, or name another file with -o` | `existing` | Move that file, or name the copy with `-o`. |
| The engine's own words, for an image it turns down | `leftOut` | Keep the image as it is. |

### Notes it prints

The command doesn't know where your images are served, so it says what to check before converting. It prints the first line below in a project that depends on `next`, `astro`, `gatsby`, `@nuxt/image` or `vite-imagetools`, and, for AVIF only, the second for each image named like a share image or an icon (`og`, `opengraph`, `twitter`, `social` or `share` as a word of its name, like `og-image.png`, or `apple-touch-icon`, `favicon`, `android-chrome` or `mstile` in it):

```
slimdeer: this project depends on next, which can serve images as WebP by itself; convert only images it doesn't serve, or they go through a second lossy pass
slimdeer: public/og-image.png looks like a share image or an icon by its name; in a December 2024 test, link previews on X, LinkedIn, Slack and iMessage didn't show AVIF, so keep a PNG or JPEG for those
```

`--check --format` prints them right after the checked line, and `--review --format` right before the page's address; the job summary and the review page show them too. Writing prints the first before it starts and the second after. In [that test](https://joost.blog/use-avif-webp-share-images/), WebP showed on all 11 platforms tried, and AVIF only on Facebook, Pinterest, Threads and WhatsApp.

Keep images for email as PNG or JPEG too: caniemail.com estimates support at about 98% for [WebP](https://www.caniemail.com/features/image-webp/) and 66% for [AVIF](https://www.caniemail.com/features/image-avif/), and Outlook for Windows doesn't show AVIF. The command can't tell which images go into email.

### Limits and costs

- **AVIF is slow.** On the example app, `--check --format avif` took 66 seconds for five images, against 13 as WebP and 5 for the PNG and JPEG check, and one image alone often takes about a minute. `--check --format` and `--review --format` cache what they measure. The command says so as it starts: `slimdeer: AVIF is slow: often about a minute per image` when it writes one image, and the same words at the end of its `measuring …` or `writing …` line otherwise.
- **Memory.** The pool plans for 70 MB plus 150 bytes a pixel for each AVIF image, more than for a shrink, within the budget [The cache](#the-cache) describes.
- **Sizes.** AVIF takes at most 24 megapixels, and WebP at most 16,383 pixels a side.
- **What a copy keeps.** Transparency and the color profile, in both formats. Other metadata, EXIF included, isn't kept. A JPEG's EXIF orientation is applied to its pixels, so the copy shows it the same way up; a PNG turned by an eXIf chunk is left out.
- **Browsers.** WebP and AVIF each show in about 97% of browsers in use ([WebP](https://caniuse.com/webp), [AVIF](https://caniuse.com/avif); caniuse, November 2026). AVIF needs Safari 16.4 or later to show on every Mac. How Safari and Firefox show slimdeer's AVIF files hasn't been checked; Chrome showed them on the review page.
- **The cache.** Measurements of copies go into each package's local cache, `node_modules/.cache/slimdeer`, keyed by the image's bytes, the engine, the target and the format. A committed cache folder (`cacheDir`, `--cache-dir`) never gets them, as the lint doesn't read them, so a CI run measures copies again unless it keeps the local cache ([The cache](#the-cache)).
- **One run measures copies at a time per project,** under a lock of its own, so a lint never waits for one. A second run waits, then finds them cached, and says so:

  ```
  slimdeer: waiting for another run measuring this project's images as WebP or AVIF (if none is running, this one goes on within a minute)
  ```

- **A run killed while it writes a copy** can leave a hidden folder named `.slimdeer-` and six more characters next to the image. Nothing reads it, so delete it.

## GitHub Actions job summaries

In GitHub Actions, where `GITHUB_STEP_SUMMARY` is set, the lint and `--check` also write the step's job summary, with no option or permission. The lint's holds the flagged images (up to 200), up to 50 images with no warning and where each is named, the quality legend, and the commands that review and shrink the flagged images, each in a block you can copy. In `example/`, its end reads:

````
To see the 4 flagged images before and after on one page first, lint in the folder CI linted, then run:

```
npx oxlint-plugin-slimdeer --review --flagged
```

To shrink the 4 flagged images in place (lossy, so commit first), lint in the folder CI linted, then run:

```
npx oxlint-plugin-slimdeer --flagged
```
````

When the lint ran in a package below `GITHUB_WORKSPACE`, the heading and these leads name that folder instead. With one flagged image, the summary offers the `-o` preview, always as the `npx` command quoted for a POSIX shell, on Windows runners too. The lint writes no job summary with `--quiet`, the formats other programs read, or `eslint --cache`, nor when it would pass GitHub's 1 MiB limit.

`--check`'s job summary, headed `slimdeer --check`, holds its checked line and totals, up to 200 images biggest saving first, the legend, the floor note, up to 10 errors, its other notes, and the commands. Its commands too are the `npx` form quoted for a POSIX shell, on Windows runners too; only the step's log gives the PowerShell form. When the check ran in a folder below `GITHUB_WORKSPACE`, the heading names it, like `` slimdeer --check in `packages/docs` ``, and each command's lead says `` run in `packages/docs`: ``. It isn't written with `--json` or when there is nothing to report. A failed write never changes either command's exit code.

## Options

```json
"slimdeer/compressible-image": ["warn", { "minSavedBytes": 4096, "minSavedPercent": 10, "target": "auto", "measure": "auto", "scan": "project", "exclude": [] }]
```

| Option | Default | |
|---|---|---|
| `minSavedBytes` | `4096` | Report only savings of at least this many bytes. 4 KiB is Lighthouse's threshold. Images smaller than this are never measured. |
| `minSavedPercent` | `10` | …and of at least this percent of the file. |
| `target` | `"auto"` | The quality to keep. `"auto"` picks one per image, about the quality TinyPNG would give it, never above 90 and never below 70 (see [the quality floor](#the-quality-floor)), though the smaller file can score higher. A number is a [SSIMULACRA2](https://github.com/cloudinary/ssimulacra2) score from 0 to 100: 90 can't be told apart from the original even flipping between them, 80 not side by side, and 70 shows artifacts that aren't annoying. Images that can't reach the target aren't flagged. The warning's command repeats it as `--target`. |
| `measure` | `"auto"` | When to measure images that aren't in the cache. `"auto"`: in the background in editors (oxlint's language server, ESLint's in VS Code, Zed or Neovim, JetBrains IDEs, and eslint_d), where the warnings appear on a later lint; everywhere else (the `oxlint` and `eslint` commands, tools that call ESLint's Node API), while linting. `"always"`: while linting, editors included. `"never"`: never, so only cached results are reported; fill the cache again after upgrading (see [Upgrading](#upgrading)). |
| `scan` | `"project"` | `"project"` measures the project's images in a parallel batch. `"referenced"` measures only images named by the source files being linted, and omits unreferenced images from the summary even if they are cached. |
| `exclude` | `[]` | Image paths or patterns relative to the project root. Excluded images are not measured, reported, or listed in the summary, even when code references them directly. In a project that depends on `gatsby`, `public/` is excluded too, unless `settings.slimdeer.publicDirs` includes `"public"`. `--check` and `--review` don't read it: pass the same patterns as `--exclude` (`--review --flagged` shows only what the lint flagged). |

In ESLint, the rule and its options go in a config object's `rules`, the same way. `slimdeer.configs.recommended` turns the rule on at `"warn"`, with these defaults, for the files the rest of your config lints. It sets no `files`, so it never adds JSX or TypeScript your config doesn't parse (for those, see [ESLint setup](#eslint-setup)). To change an option, set the rule again in a config object after it:

```js
// eslint.config.js
import slimdeer from "oxlint-plugin-slimdeer";

export default [
  // ...your config, which parses your JSX or TypeScript
  slimdeer.configs.recommended,
  { rules: { "slimdeer/compressible-image": ["warn", { target: 90 }] } },
];
```

### Scan scope and exclusions

Use `"scan": "referenced"` for targeted runs such as lint-staged, or to avoid measuring unrelated assets in the editor. A full cold lint may take longer with this mode: the rule discovers references one source file at a time, so it cannot batch all images in parallel as the project scan does. The default remains `"project"`; compare both modes on your project before choosing.

```json
"slimdeer/compressible-image": ["warn", {
  "scan": "referenced",
  "exclude": ["public/originals", "**/fixtures/**", "**/*.baseline.png"]
}]
```

Patterns use `/` separators on every platform. A literal path excludes that file or directory and its descendants. `*` matches within one path segment, `?` matches one character within a segment, and `**` matches across directories. Patterns are rooted at the project folder: `*.png` matches root images, while `**/*.png` matches PNG paths at any depth. Braces, character classes and negated patterns are not supported. Quote CLI patterns so your shell does not expand them first.

An exclusion also matches an image's real path: a linked folder, a linked file (`public/mark.png` pointing to `../design/mark.png`), and on macOS and Windows another letter case, as `.gitignore` does there, so `public/originals` also leaves out `public/Originals`. On Linux, patterns match letter case exactly.

## ESLint setup

`slimdeer.configs.recommended` needs a config that already lints and parses your JSX or TypeScript files, and ESLint's default parser reads plain JavaScript only. Otherwise, give the rule a config object for the files it should lint. For JavaScript with JSX:

```js
// eslint.config.js
import slimdeer from "oxlint-plugin-slimdeer";

export default [
  // ...your config
  {
    files: ["**/*.{js,jsx}"],
    languageOptions: { parserOptions: { ecmaFeatures: { jsx: true } } },
    plugins: { slimdeer },
    rules: { "slimdeer/compressible-image": "warn" },
  },
];
```

For TypeScript, with [typescript-eslint](https://typescript-eslint.io/getting-started/) installed. It needs TypeScript 6.0 or older, and most of Vite's TypeScript templates (all but Vue's and Svelte's) now come with TypeScript 7: there, install both with `npm install --save-dev typescript@~6.0 typescript-eslint`, or use oxlint.

```js
// eslint.config.js
import tseslint from "typescript-eslint";
import slimdeer from "oxlint-plugin-slimdeer";

export default [
  // ...your config
  {
    files: ["**/*.{ts,tsx}"],
    languageOptions: { parser: tseslint.parser },
    plugins: { slimdeer },
    rules: { "slimdeer/compressible-image": "warn" },
  },
];
```

A project with both kinds of file uses both objects. A `Parsing error: Unexpected token` on JSX or on a type means the rule runs on a file your config doesn't parse. In `eslint.config.ts`, the plugin's types work with `defineConfig`. A CommonJS config (`eslint.config.cjs`, or `eslint.config.js` in a package without `"type": "module"`) loads the plugin with `const slimdeer = require("oxlint-plugin-slimdeer").default;`.

## Settings

Shared by every file. In `.oxlintrc.json`, `settings` sits next to `rules`; in ESLint, put it in a config object; with Vite+, in the `lint` block of `vite.config.ts`.

```json
"settings": {
  "slimdeer": { "publicDirs": ["public", "static"], "aliases": { "@/": "src/" }, "cacheDir": ".slimdeer" }
}
```

| Setting | Default | |
|---|---|---|
| `publicDirs` | `["public", "static"]`, or `["static"]` in a project that depends on `gatsby` | Folders where root paths like `/logo.png` are looked up: in the linted file's folder and each folder above it, nearest first, up to the project root, then in the root itself. |
| `aliases` | the project's tsconfig/jsconfig `paths`, else `{ "@/": "src/", "~/": "src/" }` | Path prefixes and the folder, or list of folders, they stand for, relative to the project root, like `"$lib/": "src/lib/"` or `"#assets/": "src/assets/"`. Without this setting, the rule reads `compilerOptions.paths` from `tsconfig.json` (or `jsconfig.json`) the way TypeScript does: through `extends` (later entries win), with `baseUrl` from wherever the chain sets it and `${configDir}` as the project's folder, and through `references` when the config itself has no `paths` (Vite keeps them in `tsconfig.app.json`). It reads them again when a config changes. Setting it replaces those. |
| `cacheDir` | `node_modules/.cache/slimdeer` | Where results are kept, relative to the project root. A folder you commit, like `.slimdeer`, keeps CI and fresh clones from measuring again; its entries are formatted for Prettier. Packages can share one. An image of another package that this package's code names (`../../assets/logo.png`, or through an alias) is also looked up in that package's cache folders. Images slimdeer fails on are remembered in `node_modules/.cache/slimdeer` only. |

A setting of the wrong type is named in one line, like `slimdeer: settings.slimdeer.publicDirs must be a list of folder names, so the default is used`, and the lint goes on with that setting's default; `null` means the default, with no line.

Paths starting with `./` or `../` resolve from the file. A path with none of these prefixes (`assets/logo.png`) isn't looked up, unless you add an alias for it, like `{ "assets/": "src/assets/" }`. The project root is the nearest folder above the file with a `package.json`.

Automatic aliases support prefix patterns ending in `*`, choose the longest matching prefix, and try its target folders in order. Package-based `extends` such as `@tsconfig/node22/tsconfig.json`, exact-file aliases, and patterns with a suffix after `*` are not resolved. Set `settings.slimdeer.aliases` explicitly when needed.

## The cache

With the default `"scan": "project"`, the first run measures every eligible PNG and JPEG in the project (the folder with your `package.json`), not only the ones your code names, so the files linted after it find theirs cached. It skips excluded images, images too small to save `minSavedBytes`, and folders nobody ships: dependencies, build output, dot folders, and test output like Playwright and Cypress snapshots. In an editor this happens in the background, and the open file's own images go first, in a batch of their own, so its warnings don't wait for the whole project's.

- **It uses one engine per core, 8 at most, and one core fewer in an editor,** within an estimated memory budget of a quarter of the machine's memory (or of a container's limit), up to 4 GB. One image always runs even if its estimate exceeds the budget, and the linter itself also uses memory.
- **It shows its progress on stderr.** On a terminal, a first run counts the images as it measures them, with what they could save so far. Elsewhere, like a CI log, it prints `slimdeer: measured N of M images, could save X so far...` every 30 s, so a long run doesn't look stuck.
- **Results are kept by the image's bytes and the target,** so a moved or renamed image stays cached, and copies of one image are measured once. An entry holds only what slimdeer computes, so every machine writes the same files.
- **One lint measures at a time per project.** Another one waits, then finds the results cached. When the one measuring is another process, like your editor or a `--check`, the waiting one says so: `slimdeer: waiting for another lint measuring this project (if none is running, this one goes on within a minute)`. A lock that nothing has refreshed for a minute is taken over, so a run that died doesn't hold up the next. ESLint's `--concurrency` threads take turns the same way, without that line, and print one summary.
- **A first run that passes 15 minutes stops.** What it measured is cached, and the next run carries on (in CI, only if the cache is kept between runs). The run reports one problem, on the first line of the file it was linting, saying how many images it didn't measure; with ESLint's `--concurrency`, each lint thread reports its own. The problem has the rule's severity, so `"error"` and `--deny-warnings` fail the lint. If a comment turns the rule off on that line, the next file the same thread lints that doesn't gets the problem. If none does, and no other thread reported one, the rule says so on stderr and the lint fails, whatever the rule's severity. With `eslint --no-inline-config`, comments turn nothing off, so the file reports it.
- **Other failures fail open.** If measuring fails another way, the rule reports what's cached, says why on stderr, and doesn't fail the lint by itself.

To commit the results, set `cacheDir` (see [Settings](#settings)), then fill that folder. This copies what earlier runs measured and measures the rest, and from a monorepo's root it fills each package's folder:

```bash
npx oxlint-plugin-slimdeer --check --cache-dir .slimdeer
```

Pass the rule's `--target`, if it sets one (see [Check images without changing them](#check-images-without-changing-them)). Commit the folder, and commit it again after adding or changing images; a lint with `cacheDir` set also copies into it what it finds only in the local cache, or in the cache of another package whose image its code names (`--check` measures an image into its own package's folder). Entries for images that changed or were shrunk stay; to drop them, delete the folder and run the same command again, which copies what your machine has measured. Its JSON is formatted the way Prettier formats JSON (Biome users: add `!.slimdeer` to `files.includes`). Images slimdeer fails on are remembered on each machine only. The lint trusts the entries it reads, without the checks `--check` makes, so review a change to that folder like code: an entry edited by hand shows its own numbers in the warning.

Or let GitHub Actions cache it. `npm ci` deletes `node_modules`, and the default cache with it, so restore the cache after installing, and save it even when the lint fails:

```yaml
- run: npm ci
- uses: actions/cache/restore@v6
  with:
    path: node_modules/.cache/slimdeer
    key: slimdeer-${{ github.run_id }}
    restore-keys: slimdeer-
- run: npx oxlint
- uses: actions/cache/save@v6
  if: always()
  with:
    path: node_modules/.cache/slimdeer
    key: slimdeer-${{ github.run_id }}
```

In a monorepo, each package has its own cache: list them all in both `path`s, like `packages/*/node_modules/.cache/slimdeer`.

The memory budget applies to each batch. Concurrent lints of different packages can run several pools, so it is not a process-wide or machine-wide memory cap.

### Upgrading

From 0.5.0, which had the old name oxlint-plugin-pngdeer, start with [Moving from oxlint-plugin-pngdeer](#moving-from-oxlint-plugin-pngdeer). The engine changed to slimdeer 0.3.1, but it writes the same PNG and JPEG files, and the cache format is the same, so results in a committed `cacheDir` carry over. The local cache moved to `node_modules/.cache/slimdeer`, and the folder 0.5.0 used isn't read, so the first lint on each machine measures every image again, once. In a `cacheDir`, only automatic-target results that scored below 70 are measured again, once, because of the [quality floor](#the-quality-floor); every other result, explicit targets included, is reused. The first `--check`, or the first lint whose `measure` isn't `"never"`, copies the other 0.5.0 automatic-target results to new entries, without measuring those images again; `--check` counts them as cached. On tanstack.com's 148 images, with a cache folder 0.5.0 had filled, the first `--check` after upgrading measured again only the 7 whose 0.5.0 result was below 70.

- **A committed `cacheDir`:** that first run writes new entry files for the automatic target. Commit them. 0.5.0's automatic-target entries stay, unread and harmless. To drop them, delete the folder before filling it again, at the cost of measuring again what your local cache doesn't hold.
- **`measure: "never"`:** a lint measures nothing, so until the cache is filled again it doesn't check the images that have no result, and says so with the command that fills it. Without a `cacheDir`, the local cache starts empty: run `npx oxlint-plugin-slimdeer --check` once (with the rule's `--target`, if it sets one). With one, run `npx oxlint-plugin-slimdeer --check --cache-dir PATH` once, with PATH your `cacheDir`, and commit the folder: it copies 0.5.0's automatic-target results to new entries and measures again only those below 70.
- **`--flagged`:** run the lint once before it. 0.5.0's list doesn't say which folder its lint ran in, so `--flagged` ignores it.
- **Images 0.5.0 flagged below quality 70:** they are compressed again at 70. Those that reach it are still flagged, with a smaller saving; those that don't are no longer flagged. On tanstack.com, 3 of those 7 images were flagged again at quality 70 or 71, and 4 dropped out.
- **`--check` in CI:** it now checks nested packages too, so a step that gates on its exit code can fail where 0.5.0 passed (test fixtures, examples, vendored packages). To check only the root package, as 0.5.0 did, leave out every folder with a package.json of its own. Where those are all in `packages/` and `examples/`, that is `npx oxlint-plugin-slimdeer --check --exclude 'packages/*' --exclude 'examples/*'`; add any others, like `apps/*` or `docs`. `--check --json` gives each listed image's `package`.
- **`exclude` on macOS and Windows:** patterns now ignore letter case there, so `public/originals` also leaves out `public/Originals`.
- **`-o`:** OUT's extension now says what to write (see [How to fix it](#how-to-fix-it)), so `-o x.jpg` on a PNG, or an OUT with no extension, is a mistake in the arguments where 0.5.0 wrote the file.

A later version whose engine writes other PNG, JPEG, WebP or AVIF files, or whose cache format changes, measures everything again. Then delete a committed folder and fill it again: nothing reads the old entries. [Everything that changed in 0.6.0](../releases/0.6.0.md)

## Moving from oxlint-plugin-pngdeer

Until 0.5.0, this package was oxlint-plugin-pngdeer. It was renamed along with its engine, which HeyDeer now calls slimdeer. Images it shrank need nothing: they keep their mark (`pngdeer <size>`), which every version recognizes, so none is compressed twice. 0.5.0 keeps working, but gets no more updates. The old name has one more version, which only says it moved: if a dependency bot installs it, the lint stops with an error that says how to move.

1. Swap the package:
   ```bash
   npm uninstall oxlint-plugin-pngdeer
   npm install --save-dev oxlint-plugin-slimdeer
   ```
2. In `.oxlintrc.json` (or the `lint` block of `vite.config.ts`): `"oxlint-plugin-slimdeer"` in `jsPlugins`, `"slimdeer/compressible-image"` in `rules` and `overrides`, and `"settings": { "slimdeer": { … } }`. With ESLint: `import slimdeer from "oxlint-plugin-slimdeer"`, then `slimdeer.configs.recommended`, or `plugins: { slimdeer }` with `"slimdeer/compressible-image"` in `rules`.
3. Find the rest with `git grep -n -I pngdeer` (`-I` leaves out binary files, like the images the old package shrank: their mark keeps the old word):

   | What you find | Change it to |
   |---|---|
   | `pngdeer/compressible-image` in disable comments or `eslint-suppressions.json` | `slimdeer/compressible-image` |
   | `oxlint-plugin-pngdeer` in scripts (with or without `npx`), CI and docs | `oxlint-plugin-slimdeer` |
   | `node_modules/.cache/pngdeer` in a CI cache step | `node_modules/.cache/slimdeer` |
   | `"pngdeer"` as the key in `settings` | `"slimdeer"` (step 2) |
   | `.pngdeer` as a `cacheDir` value | nothing: it keeps working (step 4) |

4. Lint once. Then delete `node_modules/.cache/pngdeer`, and if you commit a `cacheDir`, commit the new files the lint wrote in it. [Upgrading](#upgrading) says what that first lint measures again, and what to run with `measure: "never"`.

Missed a step? A lint config that still names the old package or rule id stops the lint with oxlint's or ESLint's own error, which means step 2 isn't done: `Cannot find module 'oxlint-plugin-pngdeer'` (ESLint: `Cannot find package 'oxlint-plugin-pngdeer'`) for the package, and `Plugin 'pngdeer' not found` (ESLint: `could not find plugin "pngdeer"`) for `pngdeer/compressible-image` left in `rules` or `overrides`. Under ESLint, an old disable comment is an error too: `Definition for rule 'pngdeer/compressible-image' was not found`. An `eslint-suppressions.json` entry left under `pngdeer/compressible-image` suppresses nothing: ESLint reports the images it held back as errors and says `There are suppressions left that do not occur anymore`. Rename the entry to `slimdeer/compressible-image`; `--prune-suppressions` would drop it and leave the errors. For the rest, the lint tells you: an old `settings.pngdeer` is still read, with a line asking you to rename it; an old disable comment gets a line with its file and line; and an old cache folder gets a line when the lint measures again. Once the old package is uninstalled, a missed `npx oxlint-plugin-pngdeer` checks nothing: it prints the same command with the new name and exits 2.

Many disable comments? Keep the old rule id and change only the package: `"jsPlugins": [{ "name": "pngdeer", "specifier": "oxlint-plugin-slimdeer" }]` in oxlint, or `plugins: { pngdeer: slimdeer }` in ESLint. Rules, comments and `settings.pngdeer` then work as they are, and warnings keep the old id: `pngdeer(compressible-image)` in oxlint, `pngdeer/compressible-image` in ESLint.

## What it skips

- Strings that name no file, remote URLs, and paths built at runtime, like a `url()` that runs into an expression, silently.
- Images over 40 megapixels (30 for an animation, over all its frames), CMYK JPEGs, grayscale PNGs with a color profile (slimdeer's output can look darker), and files that aren't really PNGs or JPEGs, Git LFS pointers included. A command-line run names them on stderr, as it does images slimdeer fails on, and `--check` exits 2. Like any image too small to meet the byte threshold, a small one is skipped instead, and a lint says nothing of it, not even of a Git LFS pointer or an empty file; `--check` still names a small file that isn't really a PNG or JPEG. Convert a CMYK JPEG to RGB, or leave such an image out: `exclude` in the rule, `--exclude` for `--check` (the check doesn't read the rule's options).
- Images used only from CSS files, HTML or Markdown, which oxlint doesn't read. The first run still measures them, and the summary lists them. CSS in JS strings and templates is read.
- Images the automatic target can't make smaller at quality 70 or above ([the quality floor](#the-quality-floor)). The lint says how many, and `--check` names them.
- Two kinds of image this release of slimdeer fails on. Flat-color JPEGs (a solid-color banner, say) can't be measured at the default target, and explicit targets don't reliably help: eight solid banners each failed at a different set of targets between 80 and 95. PNGs with a smooth fade to transparent work at the default target, but the test image (`fade()` in test/helpers.js) fails at every explicit target from 62 up. A command-line run names them on stderr.
- Everything, on machines that aren't 64-bit little-endian, where oxlint silently skips JS plugins.

## Turning it off

For images whose bytes must not change, like test fixtures, exclude their folders. From the next lint on, they are not measured, warned about, listed in the summary, or shrunk by `--flagged`:

```json
"slimdeer/compressible-image": ["warn", { "exclude": ["test", "e2e"] }]
```

In ESLint the option goes in the same place: `rules: { "slimdeer/compressible-image": ["warn", { exclude: ["test", "e2e"] }] }`. Turning the rule off for those files, with oxlint's `overrides` or an ESLint config object with `files`, hides their warnings. But the project scan still measures their images, and the summary still lists them with a command that shrinks them.

For one reference, `// oxlint-disable-next-line slimdeer/compressible-image` (in JSX, `{/* oxlint-disable-next-line slimdeer/compressible-image */}`), or `eslint-disable-next-line` in ESLint. A `-next-line` comment can't go inside a template, so for a `url()` in a CSS-in-JS template, put the statement between `/* oxlint-disable slimdeer/compressible-image */` and `/* oxlint-enable slimdeer/compressible-image */` (or the `eslint-` forms). From the next lint on, an image whose warning is turned off this way stays out of the summary and out of `--flagged`.

With ESLint's `--no-inline-config`, those references produce diagnostics again, but the summary and `--flagged` still leave them out. Use the command in the individual warning in that mode.

With ESLint 9.24+ and the rule at `"error"`, you can suppress the heavy images you already have instead: run `npx eslint --suppress-rule slimdeer/compressible-image` once and commit `eslint-suppressions.json`. The rule's summary and `--flagged` still include suppressed images, so shrink a new image with the command in its warning. After shrinking a suppressed one, run `npx eslint --prune-suppressions`.

## When not to use it

When every image goes through an optimizer that re-encodes it for users anyway (`next/image`, Astro's `<Image>`, an image CDN), the rule mostly saves repository and build size. Behind `next/image` the warning says so, but the image is still flagged like any other, and `--flagged` shrinks it too, which adds a second lossy pass, so leave those folders out with `exclude`. Images served as they are still count: plain `<img>`, CSS backgrounds, files in `public/` for Vite and Astro, Next's `opengraph-image` and `icon` files, and every image when `images.unoptimized` is set. The summary adds up file sizes, which may not be what users download. When images must stay byte for byte, like visual-regression baselines, exclude them.
