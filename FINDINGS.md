# Design notes and measurements

The research behind oxlint-plugin-pngdeer, and how it works. Can pngdeer warn, inside oxlint, how much smaller a project's PNGs and JPEGs could be? And would it be too heavy as an npm dependency? Researched on October 30, 2026, against oxlint 1.90.0 (released October 27) and the single-threaded wasm build of pngdeer 0.2.1 served by heydeer.ai. [README.md](README.md) is the user's guide.

## The answer

**Yes, and weight isn't the problem.** The plugin is 664 KB to download and 2.2 MB installed, about a seventh of oxlint itself (14.5 MB on macOS arm64, 17.7 MB on Linux x64). Nearly all of it is the wasm engine and its license notices; the plugin's own code is 39 KB. Three other things shape the design:

1. **oxlint never looks at image files.** It lints JS and TS, and only the script blocks of Vue, Svelte and Astro files. It cannot be pointed at other extensions, and a rule can only report inside the file being linted. So the warning goes where code names an image (`import`, `require`, `new URL(…, import.meta.url)`, JSX `src`, plain strings). Images used only from CSS, HTML, Markdown, templates or CMS data are invisible. Across 6 public repos, 38% of images were named somewhere oxlint lints (854 images in total; the per-repo median was 14%).
2. **pngdeer takes seconds per image, and oxlint runs every JS rule synchronously on one thread.** Results are cached by content hash, and any image not yet measured is measured once, in parallel worker threads.
3. **pngdeer's output isn't stable under recompression.** Running pngdeer on its own JPEG saves another 21%, and on some of its PNGs even more (43% on `hero.png`), each time losing more quality. A naive rule would keep flagging fixed images. The plugin's command marks what it writes, and the cache records the hash of pngdeer's own output: the rule measures neither again.

## Measured

On an M-series Mac with 16 cores and Node 26.12. "wasm" means one engine per thread.

| What | Result |
|---|---|
| wasm engine size | 1,957,171 B raw, 611,513 B gzip |
| Engine start-up (`initSync`, lazy compile) | 2 ms |
| One image, wasm (7 samples, 0.4–1.5 MP PNG) | 0.3 s (tiny icon) to 9.1 s |
| 12 MP camera JPEG, wasm | 31 s |
| Searching a smaller preview (100k or 50k pixels instead of 350k) | 1.0–1.5× faster, saving within ~1 point: not worth it |
| All 155 bench images (76 MB), cold cache, 8 workers | 72 s wall-clock, 574 s CPU, 4.0 GB peak memory (the budget's cap) |
| The same, warm cache (hash all 76 MB, read 155 entries) | 41 ms |
| Median image on the bench set | 3.3 s, 70% smaller |
| Bench images saving under 4 KiB (Lighthouse's threshold) | 18 of 155 |
| Example app (`example/`, 6 images), cold cache | 4.6 s for the whole `oxlint` run |
| Example app, warm cache | 0.10 s for the whole `oxlint` run |
| After overwriting 2 images with pngdeer's output | Both stop warning, no recompression (0.10 s) |
| Language server, open file on a cold cache | 13 ms, no pngdeer warnings yet |
| Language server, a keystroke 6 s later | 6 ms, all 5 warnings |
| Language server, 16 new 900×900 images at once (a branch switch) | 51 threads and 1.1 GB at peak; all 16 warnings 25 s later |
| Second pass over pngdeer's own PNG output | 0–0.7% smaller on 4 PNGs, but 43% on `hero.png` (151 kB → 86 kB, then unchanged) |
| Second pass over pngdeer's own JPEG output | 21% smaller, then 12% more on a third pass |
| 8 files each importing one illustration, cold cache | 9.3 s, about the slowest image (9.2 s); one at a time would take 43 s |

## How it works

```
src/index.js        the plugin: { meta: { name: "pngdeer" }, rules } (src/index.d.ts: its types)
src/rule.js         pngdeer/compressible-image: finds image paths in strings, resolves them, reports
src/cache.js        one JSON file per content hash in node_modules/.cache/pngdeer
src/batch.js        measures uncached images on a pool of worker threads, biggest first
src/worker.js       one wasm engine per worker thread
src/engine.js       the wasm engine, started on first use: a PNG or JPEG in, pngdeer's file out
src/sync.js         waits for a batch with Atomics.wait (CLI), or runs it in the background (editor)
src/scan.js         lists the project's images, to measure them all on the first miss
src/images.js       PNG/JPEG headers: kind, dimensions, frames, size limits
src/marker.js       marks pngdeer's output, so it's never measured again
src/text.js         sizes and shell arguments, for messages
src/summary.js      the table at the end of a run, and the list --flagged shrinks
src/shrink.js       one image made smaller on disk, for the command, in its thread or on the pool
src/tsconfig.js     path aliases from the project's tsconfig/jsconfig paths
bin/pngdeer.js      npx oxlint-plugin-pngdeer IMAGE... | --flagged [-o OUT] [--target T], same engine
engine/             pngdeer's wasm and its wasm-bindgen glue, as served by heydeer.ai
docs/rules/         the rule's reference page (meta.docs.url)
example/            a small app to lint
test/               node --test: the marker and the scan, and the rule (under oxlint and ESLint)
                    and the command end to end
```

- **One visitor for every kind of reference.** Every string literal (and template literal without expressions) is checked for local `.png`, `.apng`, `.jpg` and `.jpeg` paths. That catches imports, re-exports, `require`, `new URL`, JSX attributes and `srcSet` lists (split on commas) without a visitor for each. URLs with a scheme or starting with `//` are skipped. `?query` and `#hash` are stripped.
- **Resolving paths.** A whole string is tried as one path first, since file names can hold spaces and commas. Only after that is it split as a `srcSet`. `./` and `../` resolve against the file. `/x.png` resolves against each of `settings.pngdeer.publicDirs` (default `["public", "static"]`), then the project root. `@/` and `~/` map to `src/`, configurable through `settings.pngdeer.aliases`. The project root is the nearest directory with a `package.json`, so running oxlint from a parent folder finds the same files and the same cache.
- **The cache key** is SHA-256 over the image bytes, the engine's own hash and the target. pngdeer writes the same bytes on every platform, so results are portable: a cache could be committed or shared with CI. A result is stored under the key of the bytes the engine actually read, so a file changed during a batch is measured again next time rather than cached under the wrong content.
- **Outside editors** (the `oxlint` and `eslint` commands, and tools that call ESLint's Node API), the first file that names an unmeasured image triggers one batch: that file's images plus every image in the project, in a worker pool. The lint thread blocks with `Atomics.wait` meanwhile (the synckit pattern; no child process, so oxlint's large address space is never forked), and the files linted after it find their images cached. Measuring file by file instead made a cold run of 8 one-image files take the sum of their times rather than the slowest one's. The cost is that a cold `lint-staged` run over one file also waits for the rest of the project, once. The scan skips images smaller than `minSavedBytes` (they can't save that much), test output by folder name, and nested packages, which have their own cache. On stderr, the run says how many images it's measuring, how long that took, and at exit what the warnings add up to. A failed batch is reported once, and the rest of the run doesn't try again. So is each image pngdeer fails on or can't take.
- **In editors** the rule only reads the cache. An editor is `oxlint --lsp`, ESLint's language server (VS Code's, which Zed and Neovim use too: its script is `eslintServer.js`), or any process VS Code runs as Node (`ELECTRON_RUN_AS_NODE`). Neither linter has an API for this. Misses join a single background queue: one batch at a time per process, and the first one takes every image in the project. The warnings appear on the next lint. A failed batch isn't retried for 5 minutes. Through ESLint's Node API under the server's script name, a cold lint of the example returns in 41 ms with no warnings, and 8 s later with all 5. Under any other name it waits and reports all 5. An earlier version did it the other way round and waited only under the `oxlint` and `eslint` bins. Then a one-off run through ESLint's Node API (Nx, xo, a script) counted as an editor, exited before its background batch finished, and never reported anything.
- **ESLint 9 and 10** run the rule unchanged: it uses ESLint's `create` API, and reads its defaults in code, since ESLint before 9.15 ignores `meta.defaultOptions`. oxlint and ESLint share the cache. Both are optional peer dependencies.
- **The output** has one warning per image per file, underlining just that image's path (a `srcSet` names several). Each warning words the quality from that image's SSIMULACRA2 score, which the cache keeps (cache format 2): "identical" from 90, "the same side by side" from 80, "close, with differences you might spot side by side" from 70. A reviewer playing a designer found that one wording for every image hid exactly the ones that matter: the demo's banner at 82 and its photos at 75. The size shown includes the few bytes of the mark, so the warning, the table and the command agree. A warning turned off with a disable comment isn't flagged either, since `--flagged` would otherwise rewrite an image someone chose to keep. The table also lists images the run measured that no linted JS or TS names (a CSS background in the demo, its largest saving), each with where it is used. That's the first stylesheet, HTML page, template, MDX or data file that names it, else a Markdown file ("mentioned"), else "nothing names it". A doc that only describes an image shouldn't pass for its use, so Markdown is searched last. To see those images at all, the first file a run lints measures the whole project, whether or not it names an image; an image already cached costs a hash, about 0.33 s for a warm lint with 100 images. The table is left out with `--quiet` and machine formats. On a terminal, a first run counts the images as it measures them: the lint thread is blocked, so the batch's worker writes the count straight to the terminal. oxlint's JS plugins can't attach a help line to a warning, so the command sits at the end of the message. A run outside an editor ends with a table on stderr: what the warnings add up to, each image counted once, biggest saving first. It also leaves the list in `node_modules/.cache/pngdeer/flagged.json`, in the folder the lint ran from. `npx oxlint-plugin-pngdeer --flagged` shrinks that list, each image at the target it was measured at, so neither a person nor an agent has to copy paths out of warnings.
- **Memory** is budgeted, not just threads. Each image is charged its expected peak (125 bytes a pixel below 8 MP, 85 above, plus 50 MB). The pool runs within a quarter of the machine's memory, or of a container's limit, between 1 and 4 GB. An engine that measured a big image is replaced, because wasm memory never shrinks.
- **Options:** `minSavedBytes` (default 4096, Lighthouse's threshold), `minSavedPercent` (10), `target` (`"auto"` or a SSIMULACRA2 score, which the suggested command repeats as `--target`), `measure` (`"auto"`, `"always"`, `"never"`). [docs/rules/compressible-image.md](docs/rules/compressible-image.md) is the reference.

```json
{
  "jsPlugins": ["oxlint-plugin-pngdeer"],
  "rules": { "pngdeer/compressible-image": ["warn", { "minSavedBytes": 4096, "minSavedPercent": 10 }] }
}
```

Output (`--format unix`):

```
src/App.jsx:10:16: warning pngdeer(compressible-image): hero.png could be 70% smaller (509 kB → 151 kB) and look the same side by side (quality 87/100). Run: npx oxlint-plugin-pngdeer public/hero.png
```

## What a lint rule can't do

- **Fix the image.** A lint fix edits source text, not binary files. The message carries the command instead.
- **Know, on a fresh clone, that an image is already pngdeer's output, unless the plugin's own command wrote it.** The package ships `npx oxlint-plugin-pngdeer` (bin/pngdeer.js, same engine; named after the package so that npx can never fetch a stranger's `pngdeer`). It marks what it writes: a JPEG COM segment or a PNG `tEXt` entry reading `pngdeer <size>`. The rule never measures a marked file whose size still matches. Images written by pngdeer's web app or Homebrew command aren't marked. Neither are files whose mark a metadata stripper removed. Such an image is only recognized on a machine whose cache measured the original. Anywhere else, the rule reports it as smaller again: 21% for `photo.jpg`, 43% for `hero.png`. The full fix belongs in pngdeer (recommendation 4). Homebrew's pngdeer 0.2.1 also predates JPEG support.
- **See images that code doesn't name.** That needs a whole-project command, such as a `pngdeer check` that walks the repo, prints the total, and shares this cache.
- **Notice an image changed on disk in the editor.** The language server watches only config files, so the warning updates on the next edit of the file that references it.
- **Carry many warnings to a PR.** `oxlint --format github` uses GitHub annotations, capped at 10 warnings per step and 50 per job, shared with every other warning.
- **Rely on a stable API.** JS plugins are alpha and "not subject to semver", with a minor release most weeks. They only run on 64-bit little-endian platforms; elsewhere the plugin is silently ignored.
- **Cost nothing to turn on.** With any JS plugin enabled, oxlint switches to fixed-size arenas (4 GiB of virtual memory reserved per lint thread). There are out-of-memory reports on constrained CI ([oxc#20331](https://github.com/oxc-project/oxc/issues/20331)). This applies to every JS plugin, not to pngdeer in particular, but projects with no other JS plugin would pay it because of this one.

## Shipping the engine

| Option | Install (one platform) | Platforms | Speed | Maintainer cost |
|---|---:|---|---|---|
| **wasm inside the plugin (what ships)** | 2.2 MB | every Node, including Windows and StackBlitz | single-threaded, parallel across images | one more `npm publish` from web/build.sh |
| wasm built for lint: no WebP, names stripped, wasm-opt | ~1.2–1.5 MB (est.) | same | same | a build flag |
| napi-rs native addon, per-platform packages | ~2–2.8 MB | 8+ packages, Windows needs C build work | 2.6–3.9× faster | 8–13 CI jobs |
| Call an installed `pngdeer` binary | 0 MB | wherever brew installs it | native, all cores | none, but users install it separately |

For scale: TypeScript is 24–30 MB, sharp about 19.5 MB, Prettier 10 MB, ESLint 3 MB. Download-at-install packages are effectively ruled out: npm 12, pnpm 10+ and Bun block dependency install scripts by default.

The engine can shrink without changing its output:

- Building without the `webp` feature removes about 0.45 MB; lint only compares PNG with PNG and JPEG with JPEG.
- `--remove-name-section` removes 121 KB.
- mozjpeg's 64 KB `jpeg_nbits_table` is compiled in three times (jchuff.c, jcphuff.c and jcdctmgr.c each include it). Using clz on wasm32 in two of them saves 128 KB, and sharing the table saves the rest.

## Recommendation

1. **Ship one package, `oxlint-plugin-pngdeer`, with the wasm engine inside.** At 2 MB, an optional peer dependency or a native build matrix would add more friction than it saves. Use the plain ESLint `create` API, as here, and the same package works in ESLint's flat config too. Pin a narrow oxlint range and test against each oxlint release, since the API is alpha.
2. **Publish a lint build of the wasm:** no WebP, names stripped, wasm-opt, the nbits fix. Also add an `estimate` export that returns sizes and the output's hash without copying the output bytes across.
3. **Pair the rule with a `check` command,** sharing the cache. It would cover the images no code names. The package already ships the fixing half, `npx oxlint-plugin-pngdeer IMAGE...`, so the warning's "Run:" line works for npm users, whose only pngdeer command line until now was Homebrew's. A command-line lint already prints the total of what it flagged.
4. **Make pngdeer recognize its own output, PNG and JPEG.** One option is to mark what it writes the way the plugin's command does (src/marker.js). Another is to return the input unchanged when it already scores at or above the target at the quality pngdeer would choose. Either way, it also protects anyone who runs pngdeer twice by hand.
5. **Fix two engine bugs the release review found.** Both ship in this engine:
   - An RGBA image with a smooth fade to transparent panics at every explicit target from 70 up (it works at auto): an out-of-bounds index in `color::Nearest::find`, reached from `Search::candidate`. A test generates such an image (`fade()` in test/helpers.js).
   - Flat JPEGs (a solid banner) fail at the automatic target and at explicit targets up to about 85 with "no such JPEG quality or table: Options { quality: 0, … }", because the quality search walks down to 0. They work from about 88.

An independent review of the first prototype raised 18 findings, and each was reproduced before being fixed. They came down to 11 problems, 10 of them fixed here: an unbounded number of background engines in the editor, a project root taken from oxlint's working directory, a command that ignored `target`, results cached under the wrong content when a file changed mid-batch, a pool sized by cores rather than memory, the whole repo measured on one file's miss, failed batches retried on every reference, unreadable images failing the file, a race on the output record, and paths with spaces. The eleventh, the output record being local, is the limitation above.

A second review, before 0.1.0, installed the packed tarball with npm, pnpm and Bun and followed the README. It raised 15 findings, each reproduced:
- The warning's `npx pngdeer` named an npm package nobody owns. From a monorepo root, npx fetched whatever was published under that name, and in CI it would have run it.
- The command wrote a "miss" (target out of reach) in place, marked as done.
- The command's in-place write could truncate the image on a disk error.
- The mark could make a tiny file bigger.
- A cold run measured file by file.
- Engine failures were cryptic or silent.
- The PNG idempotence claim above was wrong.
- The CI cache recipe was erased by `npm ci`.
- Paths were quoted for POSIX shells on Windows.
- The release workflow had three problems: it would fail on the hand-published first version, npm's 2-day trusted-publisher expiry wasn't noted, and prerelease tags had no dist-tag.

All are fixed, except the engine bugs, which belong upstream (recommendation 5).

A third review looked at the developer experience. Six reviewers had separate lenses: a first read of the README, onboarding in a fresh Vite app, the printed words, positioning against other tools, a skeptical tech lead, and the npm and GitHub surface. A README draft was then tested on two first-time readers. Out of that came:
- the README's order: what it is, the warning, why, quick start;
- ESLint support (9.0 and 10, tested in CI), with oxlint and ESLint both optional peers;
- no waiting outside a linter's command line;
- shorter warnings and a command that defaults to in place;
- progress and a total on stderr, and notes for images it skips;
- clearer option names (`minSavedBytes`, `minSavedPercent`, `measure`) and `static/` as a public folder;
- a rule page, types and an issue template.

Left for later, then done in 0.3.0: a committed cache (`settings.pngdeer.cacheDir`), aliases read from tsconfig/jsconfig `paths` (through `extends` and `references`), one full warning per image per run (short ones in other files), and `--flagged` on the engine pool. On 16 illustrations, that took 14 s instead of 78 s one at a time, with the same bytes. Still left: a `check` command, a before/after image in the README.

A review of 0.3.0 before its release raised 18 findings, all reproduced and fixed:
- Alias reading: a `"baseUrl": null` that TypeScript accepts crashed every file in the lint. `${configDir}`, a `baseUrl` inherited through `extends`, `extends` arrays and paths without `.json`, BOMs, and editing a config during an editor session each gave wrong or missing aliases. src/tsconfig.js now resolves configs the way TypeScript does.
- ESLint's `--concurrency` lints in worker threads, each with its own copy of the plugin. Each printed a partial summary and ran its own engine pool, and the main thread, having linted nothing, emptied `--flagged`'s list. The threads now leave what they saw for the main thread, which prints once, and batches take a lock so one measures at a time.
- Repeats were keyed by image only. ESLint's `--fix` passes, watch modes and eslint_d lost a file's full warning, and folders with different targets mixed their numbers. A disable comment under a renamed plugin wasn't recognized either.
- Packages sharing a `cacheDir` skipped all but the first package's project scan. The editor wrote entries the command line didn't, which dirtied a committed folder. A failure on one machine stuck for a whole team. Entries failed `prettier --check`.
- The command raced on one temp file when the same image came twice.

Sources: the oxlint 1.90.0 npm package (`dist/lint.js`, `dist/index.d.ts`, `configuration_schema.json`), oxc's source at the `oxlint_v1.90.0` tag, [the JS plugins docs](https://oxc.rs/docs/guide/usage/linter/js-plugins), [the alpha announcement](https://oxc.rs/blog/2026-03-11-oxlint-js-plugins-alpha), and `npm view` for package sizes. The 6-repo image count used clones of excalidraw, docusaurus, taxonomy, svelte.dev, vuejs/docs and starlight.
