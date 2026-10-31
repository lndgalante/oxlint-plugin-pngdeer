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

Each image warns once per file, at its first mention, and only its own path is underlined, even inside a `srcSet`. The warning says how close to the original the smaller file would look, from its SSIMULACRA2 score: "identical" from 90, "the same side by side" from 80, "close, with differences you might spot side by side" from 70.

On the command line, the run ends with a table of everything it flagged, each image counted once, biggest saving first, with each one's quality. Below it are images the run measured that no linted code names, like a CSS background: no warning can point at them, and `--flagged` leaves them alone.

## How to fix it

Run the command from the warning:

```bash
npx oxlint-plugin-pngdeer public/hero.png
```

It writes pngdeer's smaller file over the image (`-o` writes elsewhere), and marks it so this rule doesn't flag it again. pngdeer is lossy, so commit first.

To shrink everything the last lint flagged, at the target each image was measured at:

```bash
npx oxlint-plugin-pngdeer --flagged
```

A lint outside the editor leaves that list in `node_modules/.cache/pngdeer/flagged.json`, in the folder it ran from. `--help` lists the rest.

## Options

```json
"pngdeer/compressible-image": ["warn", { "minSavedBytes": 4096, "minSavedPercent": 10, "target": "auto", "measure": "auto" }]
```

| Option | Default | |
|---|---|---|
| `minSavedBytes` | `4096` | Report only savings of at least this many bytes. 4 KiB is Lighthouse's threshold. Images smaller than this are never measured. |
| `minSavedPercent` | `10` | …and of at least this percent of the file. |
| `target` | `"auto"` | The quality to keep. `"auto"` is about the quality TinyPNG would give the image, never above 90. A number is a [SSIMULACRA2](https://github.com/cloudinary/ssimulacra2) score from 0 to 100: 90 can't be told apart from the original even flipping between them, 80 not side by side, and 70 shows artifacts that aren't annoying. Images that can't reach the target aren't flagged. The warning's command repeats it as `--target`. |
| `measure` | `"auto"` | When to measure images that aren't in the cache. `"auto"`: in the background in editors (oxlint's language server, and ESLint's in VS Code, Zed or Neovim), where the warnings appear on a later lint; everywhere else (the `oxlint` and `eslint` commands, tools that call ESLint's Node API), while linting. `"always"`: while linting, editors included. `"never"`: never, so only cached results are reported. |

## Settings

Shared by every file. In `.oxlintrc.json`, `settings` sits next to `rules`; in ESLint, put it in a config object.

```json
"settings": {
  "pngdeer": { "publicDirs": ["public", "static"], "aliases": { "@/": "src/", "~/": "src/" } }
}
```

| Setting | Default | |
|---|---|---|
| `publicDirs` | `["public", "static"]` | Folders where root paths like `/logo.png` are looked up, before the project root. |
| `aliases` | `{ "@/": "src/", "~/": "src/" }` | Path prefixes and the folders they stand for, relative to the project root, like `"$lib/": "src/lib/"` or `"#assets/": "src/assets/"`. Setting it replaces both defaults: a Next.js app without `src/` wants `{ "@/": "./" }`. |

Paths starting with `./` or `../` resolve from the file. A path with none of these prefixes (`assets/logo.png`) isn't looked up, unless you add an alias for it, like `{ "assets/": "src/assets/" }`. The project root is the nearest folder above the file with a `package.json`.

## What it skips

- Strings that name no file, remote URLs, and paths built at runtime, silently.
- Images over 40 megapixels (30 for an animation, over all its frames), and files that aren't really PNGs or JPEGs. A command-line run names them on stderr, as it does images pngdeer fails on.
- Images used only from CSS, HTML or Markdown, which oxlint doesn't read.

## Turning it off

For images whose bytes must not change, like test fixtures, turn the rule off by folder:

```json
"overrides": [{ "files": ["test/**", "e2e/**"], "rules": { "pngdeer/compressible-image": "off" } }]
```

For one reference, `// oxlint-disable-next-line pngdeer/compressible-image` (in JSX, `{/* oxlint-disable-next-line pngdeer/compressible-image */}`), or `eslint-disable-next-line` in ESLint. An image whose warning is turned off this way stays out of the summary and out of `--flagged`.

## When not to use it

When every image goes through an optimizer that re-encodes it for users anyway (`next/image`, Astro's `<Image>`, an image CDN), the rule mostly saves repository and build size. When images must stay byte for byte, like visual-regression baselines, keep it off for them.
