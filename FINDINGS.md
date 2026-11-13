# Design notes and measurements

The research behind oxlint-plugin-slimdeer (formerly oxlint-plugin-pngdeer), and how it works. Can pngdeer warn, inside oxlint, how much smaller a project's PNGs and JPEGs could be? And would it be too heavy as an npm dependency? Researched on October 30, 2026, against oxlint 1.90.0 (released October 27) and the single-threaded wasm build of pngdeer 0.2.1 served from heydeer.ai. [README.md](README.md) is the user's guide.

## The answer

**Yes, and weight isn't the problem.** The plugin is a 2.0 MB download and 5.9 MB installed (0.6.0, from `npm pack --dry-run`), a third to two fifths of oxlint itself (14.5 MB on macOS arm64, 17.7 MB on Linux x64). Nearly all of it is the wasm engine and its license notices; the plugin's own code (`src/` and `bin/`) is about 340 kB, up from 110 kB in 0.5.0. Three other things shape the design:

1. **oxlint never looks at image files.** It lints JS and TS, and only the script blocks of Vue, Svelte and Astro files. It cannot be pointed at other extensions, and a rule can only report inside the file being linted. So the warning goes where code names an image (`import`, `require`, `new URL(…, import.meta.url)`, JSX `src`, plain strings). Images used only from CSS, HTML, Markdown, templates or CMS data are invisible. Across 6 public repos, 38% of images were named somewhere oxlint lints (854 images in total; the per-repo median was 14%).
2. **pngdeer takes seconds per image, and oxlint runs every JS rule synchronously on one thread.** Results are cached by content hash, and any image not yet measured is measured once, in parallel worker threads.
3. **pngdeer's output isn't stable under recompression.** Running pngdeer on its own JPEG saves another 21%, and on some of its PNGs even more (43% on `hero.png`), each time losing more quality. A naive rule would keep flagging fixed images. The plugin's command marks what it writes, and the cache records the hash of pngdeer's own output: the rule measures neither again.

## Measured

These numbers predate 0.6.0 and haven't been measured again. On an M-series Mac with 16 cores and Node 26.12. "wasm" means one engine per thread.

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
| Language server, a keystroke 6 s later | 6 ms, all 4 warnings |
| Language server, 16 new 900×900 images at once (a branch switch) | 51 threads and 1.1 GB at peak; all 16 warnings 25 s later |
| Second pass over pngdeer's own PNG output | 0–0.7% smaller on 4 PNGs, but 43% on `hero.png` (151 kB → 86 kB, then unchanged) |
| Second pass over pngdeer's own JPEG output | 21% smaller, then 12% more on a third pass |
| 8 files each importing one illustration, cold cache | 9.3 s, about the slowest image (9.2 s); one at a time would take 43 s |

## How it works

```
src/index.js        the plugin: { meta: { name: "slimdeer" }, rules, configs } (src/index.d.ts: its types)
src/rule.js         slimdeer/compressible-image: finds image paths in strings, resolves them, reports;
                    homes() looks an image of another package up in that package's cache folders too;
                    floorLine() says how many images the quality floor turned down, with the --check
                    that names them
src/cache.js        one JSON file per content hash in node_modules/.cache/slimdeer; the quality floor's
                    judgment (floored(): an image the automatic target turned down, and with thresholds,
                    one only the floor kept from being reported)
src/batch.js        measures uncached images on a pool of worker threads, largest file first after the
                    smallest, under a lock that is refreshed while it is held; fillAll() fills several
                    projects' caches on one pool
src/fill-worker.js  runs one batch off the lint thread, and says on stderr what it measures
src/progress.js     the batch's count and what it could save so far: rewritten on a terminal, a line every
                    30 s elsewhere; say() writes to stderr and loses the line if stderr is closed;
                    unwrapped() turns line wrap off for a line the next one rewrites, so it leaves no row
src/threads.js      starts worker threads, even when the caller runs code from stdin or node -e
src/check.js        --check: measures images in every package under the paths without a linter and
                    without changing them (--json, the job summary); measureAll() returns the rows, and
                    print(), notes() and shortened() print them for --review too, notes() with --review
                    commands; tell() writes the job summary's commands for a POSIX shell
src/review.js       --review: previews of what --check lists (or with --flagged, of what the last lint
                    flagged, less what changed since; measureFlagged() reads each from the cache folder
                    the lint measured it into), and the page comparing them with the originals; refuses
                    a review folder that is a link; launch() (--open) waits up to 2 s to hear whether
                    the opener failed
src/review-page.js  the review page: one HTML file, style and script inline, locked by its CSP;
                    commandCount() tells review.js how many commands it gives; unbroken() keeps each
                    size's number and unit on one line
src/markdown.js     Markdown for GitHub Actions job summaries (the lint's summary and --check); prose()
                    escapes Markdown in error text
src/worker.js       one wasm engine per worker thread
src/engine.js       the wasm engine, started on first use: a PNG or JPEG in, slimdeer's file out; replaced
                    after a panic
src/sync.js         waits for a batch with Atomics.wait (CLI), or runs it in the background (editor)
src/scan.js         lists the project's images, to measure them all on the first miss; walks every
                    package for --check; matches exclusions against physical paths
src/images.js       PNG/JPEG headers: kind, dimensions, frames, and what slimdeer can't take
src/marker.js       marks the command's output with `pngdeer <size>`, so it's never measured again; keeps
                    a PNG's EXIF orientation
src/compat.js       the old names a project may still use (settings.pngdeer, the old rule id in disable
                    comments, node_modules/.cache/pngdeer), and the line the lint prints for each
src/text.js         sizes, shell arguments and commands for messages; printable() shows control
                    characters as U+FFFD, literal() writes them as $'\x..' escapes in a command (and on
                    Windows, / for \); reviewCommand() words the --review command
src/summary.js      the table at the end of a run, the job summary, and the list --flagged shrinks: each
                    image's target, the cache key of the bytes measured and, when not its own package's
                    local one, the cache folder it was measured into; changed() finds those changed since
src/shrink.js       one image made smaller on disk, for the command, in its thread or on the pool
src/tsconfig.js     path aliases from the project's tsconfig/jsconfig paths
bin/slimdeer.js     npx oxlint-plugin-slimdeer IMAGE... | IMAGE -o OUT | --flagged | --check [PATH...] |
                    --review [PATH...] | --review --flagged, same engine
engine/             slimdeer 0.3.1's wasm and its wasm-bindgen glue, rebuilt from pinned source
                    (engine/README.md)
legacy/             the old package name's last version, which only says the package moved
docs/rules/         the rule's reference page (meta.docs.url)
example/            a small app to lint
test/               node --test: the rule under oxlint and ESLint (and oxlint's language server), the
                    command, --check and --review end to end, and most modules on their own
```

- **One visitor for every kind of reference.** Every string literal (and template literal without expressions) is checked for local `.png`, `.apng`, `.jpg` and `.jpeg` paths. That catches imports, re-exports, `require`, `new URL`, JSX attributes and `srcSet` lists (split on commas) without a visitor for each. URLs with a scheme or starting with `//` are skipped. `?query` and `#hash` are stripped. CSS `url()` in a string or a template part is read too (quoted, unquoted, several in one value), with only its path underlined; a `url()` that runs into an expression isn't. Tagged templates with CSS escapes that JavaScript can't read are read as written. Each `srcSet` candidate and each `url()` is underlined where it is written: `within()` takes the first occurrence of the path that isn't preceded by a path character. A visitor on `ImportDeclaration` finds the default import of `next/image`, `next/legacy/image` and `next/future/image` and tells the warning when every mention of an image in the file is a string `src` of it, or an imported image used only in such `src` props (not for an animated PNG, whose frame count `fileKey()` records; not with `unoptimized`, a `loader` or spread props; not when the nearest `next.config` mentions `unoptimized` or `loaderFile`). The warning then says that next/image re-encodes the image for visitors.
- **Resolving paths.** A whole string is tried as one path first, since file names can hold spaces and commas. Only after that is it split as a `srcSet`. `./` and `../` resolve against the file. `/x.png` resolves against each `publicDirs` folder (`settings.slimdeer.publicDirs`, default `["public", "static"]`; in a Gatsby project, `["static"]`) of the linted file's folder and of every folder above it, nearest first, up to the project root, then the root's, then the root itself (an Nx app finds its own `public/`). In a project that depends on `react-native` or `expo`, a reference to `logo.png` also names its Metro variants in the same folder (`logo@2x.png`, `logo.ios.png`, `logo@2x.ios.png` and so on, matched in letter case), each folder listed once per run and again when it changes. In a Gatsby project, `public/` is build output and is left out unless `publicDirs` names it. `exclude` is tested against the spelled path and the physical one (`realpath`, and letter case on macOS and Windows, where patterns ignore case), so a link into an excluded folder is excluded too. Aliases come from `settings.slimdeer.aliases`, else the project's tsconfig or jsconfig `paths`, else `@/` and `~/` map to `src/`. A path with %-escapes (`/my%20photo.png`) that names no file is tried again decoded, as a browser reads it. The project root is the nearest directory with a `package.json`, so running oxlint from a parent folder finds the same files and the same cache.
- **The cache key** is SHA-256 over the image bytes, the engine's output identity (`ENGINE`, see 2026-11 below), the target and the cache format. slimdeer writes the same bytes on every platform, so results are portable: a cache could be committed or shared with CI. A result is stored under the key of the bytes the engine actually read, so a file changed during a batch is measured again next time rather than cached under the wrong content. An image of another package (`../../shared/logo.png`) is also looked up in that package's cache folders, where `--check` measures it, and copied into the lint's own.
- **Outside editors** (the `oxlint` and `eslint` commands, and tools that call ESLint's Node API), the first file a run lints triggers one batch, with the default `scan: "project"`, whether or not it names an image: that file's images plus every image in the project, in a worker pool. The lint thread blocks with `Atomics.wait` meanwhile (the synckit pattern; no child process, so oxlint's large address space is never forked), and the files linted after it find their images cached. Measuring file by file instead made a cold run of 8 one-image files take the sum of their times rather than the slowest one's. Only one batch measures at a time per project: it holds a lock file, refreshed several times a minute while it runs, that anyone else takes over once nothing has refreshed it for a minute, whatever its process id. The cost is that a cold `lint-staged` run over one file also waits for the rest of the project, once. `scan: "referenced"` avoids that. The scan skips images smaller than `minSavedBytes` (they can't save that much), test output by folder name, and nested packages, which have their own cache (`--check` walks into them, each image with its own package's cache and lock). On stderr, the run says how many images it's measuring, how long that took, and at exit what the warnings add up to. When it measured and the automatic target's quality floor turned images down, it says so once, with a `--check` that names them: it carries the rule's `exclude`, thresholds and cache folder when they are set, and the project's path when the lint ran anywhere else: below it (`npx oxlint-plugin-slimdeer --check ..`), beside it, or at a monorepo's root (`npx oxlint-plugin-slimdeer --check packages/web`). A failed batch is reported once, and the rest of the run doesn't try again. So is each image slimdeer fails on or can't take. A batch that passes 15 minutes is the exception to failing open: it stops, and the run reports one problem at the rule's severity saying how many images it didn't measure, so a rule at `"error"` can't pass a lint that checked only part of the images.
- **In editors** the rule only reads the cache. An editor is `oxlint --lsp`, ESLint's language server (VS Code's, which Zed and Neovim use too: its script is `eslintServer.js`), or any process VS Code runs as Node (`ELECTRON_RUN_AS_NODE`). Only the script's own path counts, from its last `node_modules` on, so a project in a folder named like a language server (a clone of yaml-language-server) still lints as a command. Neither linter has an API for this. Misses join a single background queue: one batch at a time per process. The first file's own images go first, in a batch of their own, then every image in the project, so the open file's warnings don't wait for the whole project's. The warnings appear on the next lint. A failed batch isn't retried for 5 minutes. Through ESLint's Node API under the server's script name, a cold lint of the example returns in 41 ms with no warnings, and 8 s later with all 4. Under any other name it waits and reports all 4. An earlier version did it the other way round and waited only under the `oxlint` and `eslint` bins. Then a one-off run through ESLint's Node API (Nx, xo, a script) counted as an editor, exited before its background batch finished, and never reported anything.
- **ESLint 9 and 10** run the rule unchanged: it uses ESLint's `create` API, and reads its defaults in code, since ESLint before 9.15 ignores `meta.defaultOptions`. oxlint and ESLint share the cache. Both are optional peer dependencies.
- **The output** has one warning per image per file, underlining just that image's path (a `srcSet` names several). Each warning words the quality from that image's SSIMULACRA2 score, which the cache keeps (cache format 3): "identical" from 90, "the same side by side" from 80, "close, with differences you might spot side by side" from 70, and "visibly different" below. The automatic target never settles in that last band: a result that would score below 70 is compressed again at target 70, and an image whose best is still below 70 is a "miss" at the cache key `auto70`, not flagged, not listed by `--check`, and left as is by the command (an explicit target below 70 allows it). The summary doesn't list such images on every run; the lint names how many once as it measures, and `--check` names them. A reviewer playing a designer found that one wording for every image hid exactly the ones that matter: on that reviewer's 43-image site, the banner at 82 and the photos at 75. The size shown includes the few bytes of the mark, so the warning, the table and the command agree. A warning turned off with a disable comment isn't flagged either, since `--flagged` would otherwise rewrite an image someone chose to keep. The summary also lists images with no warning that the run measured ("named only where this run can't warn, or nowhere": on that site, a CSS background with its largest saving), each with where it is named. It says "this run" and not "the rule" because a file a one-file lint or lint-staged left out gets its warning when it is linted. That's the first stylesheet, HTML page, template, MDX or data file that names it, else JS or TS the run didn't lint or resolve ("named in"), else a Markdown file ("mentioned"), else "nothing names it". A file that names the image's path wins over one that names only its file name. A doc that only describes an image shouldn't pass for its use, so Markdown is searched last. Next.js serves `app/opengraph-image.png` and `app/icon.png` by name alone, so in a project that depends on `next` those say "a Next.js metadata file". To see those images at all, the first file a run lints measures the whole project, whether or not it names an image; an image already cached costs a hash, about 0.33 s for a warm lint with 100 images. The table is left out with `--quiet` and machine formats, and with `eslint --cache`, which replays old warnings without running the rule. On a terminal, a first run counts the images as it measures them: the lint thread is blocked, so the batch's worker writes the count straight to stderr. Off a terminal, as in a CI log, the count is a line every 30 s, so a long first run doesn't look hung. oxlint's JS plugins can't attach a help line to a warning, so the command sits at the end of the message. A run outside an editor ends with a table on stderr: what the warnings add up to, each image counted once, biggest saving first. It also leaves the list in `node_modules/.cache/slimdeer/flagged.json`, which records the real path of the folder the lint ran in and, per image, its target when it is explicit, the cache key of the bytes it measured and, when that isn't the image's own package's local folder, the cache folder it measured the image into. `npx oxlint-plugin-slimdeer --flagged` shrinks that list, each image at the target it was measured at, and only in that folder: a copied project, or a worktree with a linked `node_modules`, gets no list instead of rewriting the other folder's images. An image whose bytes changed since the lint (a branch switch, a new export) is left as it is, since the lint never measured those bytes. So neither a person nor an agent has to copy paths out of warnings. `--review --flagged` shows the same images before and after on one page first, and the summary offers it from two flagged images on. In GitHub Actions the job summary gets the tables too, with more rows, and the commands. In the table, names with control characters show as U+FFFD, and columns line up for wide characters.
- **Memory** is budgeted, not just threads. Each image is charged its expected peak (125 bytes a pixel below 8 MP, 85 above, plus 50 MB). Each pool has an estimated budget of a quarter of the machine's memory, or of a container's limit, capped at 4 GB. One image always runs even if its estimate exceeds the budget. An engine that measured a big image, that panicked, or that waits for room is stopped, because wasm memory never shrinks and a panic skips the engine's cleanup. At most 8 engines run, one per core; an editor leaves one core to the editor.
- **Options:** `minSavedBytes` (default 4096, Lighthouse's threshold), `minSavedPercent` (10), `target` (`"auto"`, which is never above 90 and never below 70, or a SSIMULACRA2 score, which the suggested command repeats as `--target`), `measure` (`"auto"`, `"always"`, `"never"`), `scan` (`"project"`, `"referenced"`) and `exclude` (paths or globs from the project root). [docs/rules/compressible-image.md](docs/rules/compressible-image.md) is the reference.

```json
{
  "jsPlugins": ["oxlint-plugin-slimdeer"],
  "rules": { "slimdeer/compressible-image": ["warn", { "minSavedBytes": 4096, "minSavedPercent": 10 }] }
}
```

Output (`--format unix`):

```
src/App.jsx:10:16: hero.png could be 70% smaller (509 kB → 151 kB) and look the same side by side (quality 87/100). Run: npx oxlint-plugin-slimdeer public/hero.png [Warning/slimdeer(compressible-image)]
```

## What a lint rule can't do

- **Fix the image.** A lint fix edits source text, not binary files. The message carries the command instead.
- **Know, on a fresh clone, that an image is already slimdeer's output, unless the plugin's own command wrote it.** The package ships `npx oxlint-plugin-slimdeer` (bin/slimdeer.js, same engine; named after the package so that npx can never fetch a stranger's `slimdeer`). It marks what it writes: a JPEG COM segment or a PNG `tEXt` entry reading `pngdeer <size>`. The rule never measures a marked file whose size still matches. Images written by slimdeer's own web app or command aren't marked. Neither are files whose mark a metadata stripper removed. Such an image is only recognized on a machine whose cache measured the original. Anywhere else, the rule reports it as smaller again: 21% for `photo.jpg`, 43% for `hero.png`. The full fix belongs in slimdeer (recommendation 4). Homebrew's pngdeer 0.2.1 also predates JPEG support.
- **Warn on images that code doesn't name.** The project scan measures them and the summary lists them, and `npx oxlint-plugin-slimdeer --check` (0.4.0) checks any folder with the same cache, but no warning can point at them.
- **Notice an image changed on disk in the editor.** The language server watches only config files, so the warning updates on the next edit of the file that references it.
- **Carry many warnings to a PR.** `oxlint --format github` uses GitHub annotations, capped at 10 warnings per step and 50 per job, shared with every other warning.
- **Rely on a stable API.** JS plugins are alpha and "not subject to semver", with a minor release most weeks. They only run on 64-bit little-endian platforms; elsewhere the plugin is silently ignored.
- **Cost nothing to turn on.** With any JS plugin enabled, oxlint switches to fixed-size arenas (4 GiB of virtual memory reserved per lint thread). There are out-of-memory reports on constrained CI ([oxc#20331](https://github.com/oxc-project/oxc/issues/20331)). This applies to every JS plugin, not to this plugin in particular, but projects with no other JS plugin would pay it because of this one.

## Shipping the engine

| Option | Install (one platform) | Platforms | Speed | Maintainer cost |
|---|---:|---|---|---|
| **wasm inside the plugin (what ships)** | 2.3 MB in 0.5.0, 5.9 MB with AVIF (0.6.0) | every Node, including Windows and StackBlitz | single-threaded, parallel across images | one more `npm publish` from web/build.sh |
| wasm built for lint: no WebP, names stripped, wasm-opt | ~1.2–1.5 MB (est.) | same | same | a build flag |
| napi-rs native addon, per-platform packages | ~2–2.8 MB | 8+ packages, Windows needs C build work | 2.6–3.9× faster | 8–13 CI jobs |
| Call an installed `pngdeer` binary | 0 MB | wherever brew installs it | native, all cores | none, but users install it separately |

For scale: TypeScript is 24–30 MB, sharp about 19.5 MB, Prettier 10 MB, ESLint 3 MB. Download-at-install packages are effectively ruled out: npm 12, pnpm 10+ and Bun block dependency install scripts by default.

The engine can shrink without changing its output:

- Building without the `webp` feature removes about 0.45 MB; lint only compares PNG with PNG and JPEG with JPEG.
- `--remove-name-section` removes 121 KB.
- mozjpeg's 64 KB `jpeg_nbits_table` is compiled in three times (jchuff.c, jcphuff.c and jcdctmgr.c each include it). Using clz on wasm32 in two of them saves 128 KB, and sharing the table saves the rest.

## Recommendation

1. **Ship one package, `oxlint-plugin-pngdeer`, with the wasm engine inside.** At 2 MB, an optional peer dependency or a native build matrix would add more friction than it saves. Use the plain ESLint `create` API, as here, and the same package works in ESLint's flat config too. Since the API is alpha, allow the oldest oxlint it works on (1.60) up to `<2`, and test the oldest, the one Vite+ bundles, the pinned one and, weekly, the newest.
2. **Publish a lint build of the wasm:** no WebP, names stripped, wasm-opt, the nbits fix. Also add an `estimate` export that returns sizes and the output's hash without copying the output bytes across.
3. **Pair the rule with a `check` command,** sharing the cache. Done in 0.4.0: `--check` covers the images no code names. The package also ships the fixing half, `npx oxlint-plugin-pngdeer IMAGE...`, so the warning's "Run:" line works for npm users, whose only pngdeer command line until now was Homebrew's. A command-line lint already prints the total of what it flagged.
4. **Make pngdeer recognize its own output, PNG and JPEG.** One option is to mark what it writes the way the plugin's command does (src/marker.js). Another is to return the input unchanged when it already scores at or above the target at the quality pngdeer would choose. Either way, it also protects anyone who runs pngdeer twice by hand.
5. **Fix the engine bugs the reviews found.** All ship in this engine:
   - An RGBA image with a smooth fade to transparent panics at every explicit target from 62 up (60 and 61 return a miss; it works at auto, at quality 59): an out-of-bounds index in `color::Nearest::find`, reached from `Search::candidate`. A test generates such an image (`fade()` in test/helpers.js).
   - Flat JPEGs (a solid banner) fail at the automatic target, and at some explicit targets, with "no such JPEG quality or table: Options { quality: 0, … }", because the quality search walks down to 0. Which targets fail varies with the image: eight solid banners each failed at a different set of targets between 80 and 95.
   - PNG output drops the eXIf chunk, so a PNG that EXIF turns (macOS `sips` writes these) comes out unturned. A grayscale PNG with a gray color profile comes out as a palette PNG that keeps the profile, which a palette PNG can't use, so browsers show it darker. The report scores both as close to the original. The plugin puts the orientation back (src/marker.js) and skips such grayscale PNGs.

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

Left for later, then done in 0.3.0: a committed cache (`settings.pngdeer.cacheDir`), aliases read from tsconfig/jsconfig `paths` (through `extends` and `references`), one full warning per image per run (short ones in other files), and `--flagged` on the engine pool. On 16 illustrations, that took 14 s instead of 78 s one at a time, with the same bytes. Version 0.4.0 adds `--check`, the `scan` and `exclude` options, checks of the packed tarball in CI, and a verified rebuild of the engine.

A review of 0.3.0 before its release raised 18 findings, all reproduced and fixed:
- Alias reading: a `"baseUrl": null` that TypeScript accepts crashed every file in the lint. `${configDir}`, a `baseUrl` inherited through `extends`, `extends` arrays and paths without `.json`, BOMs, and editing a config during an editor session each gave wrong or missing aliases. src/tsconfig.js now resolves configs the way TypeScript does.
- ESLint's `--concurrency` lints in worker threads, each with its own copy of the plugin. Each printed a partial summary and ran its own engine pool, and the main thread, having linted nothing, emptied `--flagged`'s list. The threads now leave what they saw for the main thread, which prints once, and batches take a lock so one measures at a time. A thread's share records when its process started, so a dead run's share with the same process id is no longer taken in.
- Repeats were keyed by image only. ESLint's `--fix` passes, watch modes and eslint_d lost a file's full warning, and folders with different targets mixed their numbers. A disable comment under a renamed plugin wasn't recognized either.
- Packages sharing a `cacheDir` skipped all but the first package's project scan. The editor wrote entries the command line didn't, which dirtied a committed folder. A failure on one machine stuck for a whole team. Entries failed `prettier --check`.
- The command raced on one temp file when the same image came twice.

A review of 0.4.0 after its release had ten lenses: a first read of the README, onboarding with oxlint and with ESLint, the docs' accuracy, code correctness, large repositories, image fidelity, positioning, the npm and GitHub surface, and CI and releases. Of its findings, 96 held up under independent verification, and a probe of oxlint's language server raised 10 more. Version 0.5.0 fixes these:
- `--check` at a monorepo root skipped every package and reported a clean check. It now names the packages it skipped, with the command that checks them, and exits 2 when it found no other images.
- After a one-file lint or lint-staged, the summary said "nothing names it" for images the unlinted code uses, and suggested deleting them. It now says "named in" that file, matches an image's path before its bare name, and recognizes Next.js metadata images.
- A first run that passed 15 minutes stopped and let the lint pass, even at `"error"`. It now reports one problem at the rule's severity.
- A PNG that EXIF turns came out unturned, and a grayscale PNG with a color profile came out darker, while the warning said they'd look the same. The first now keeps its orientation, and the second is skipped.
- Setting `cacheDir` after a first lint left the committed folder empty. A lint now copies what it already measured into it.
- A project in a folder named like a language server counted as an editor, so its command-line lint never measured anything and passed.
- `eslint --cache` replayed old warnings next to a summary that contradicted them, and emptied `--flagged`'s list.
- Smaller ones: no progress in CI logs, identical images measured once per copy, a silent wait on another process's lock, `%20` in paths, an `-o` folder blamed on the image, and an unwritable cache folder blamed on each image.
- Around the code: `pngdeer.configs.recommended` for ESLint, a peer range down to oxlint 1.60 (CI also tests 1.89, which Vite+ bundles), a release workflow whose publishing job runs no dependency code, Node 26 and the oldest supported Node in CI, and a test of oxlint's language server.

The engine bugs are still upstream's (recommendation 5). An editor still shows a file's warnings only when it lints that file again after measuring ends, since the language server watches only config files (above).

Sources: the oxlint 1.90.0 npm package (`dist/lint.js`, `dist/index.d.ts`, `configuration_schema.json`), oxc's source at the `oxlint_v1.90.0` tag, [the JS plugins docs](https://oxc.rs/docs/guide/usage/linter/js-plugins), [the alpha announcement](https://oxc.rs/blog/2026-03-11-oxlint-js-plugins-alpha), and `npm view` for package sizes. The 6-repo image count used clones of excalidraw, docusaurus, taxonomy, svelte.dev, vuejs/docs and starlight.

## 2026-11: renamed slimdeer, slimdeer 0.3.1, WebP and AVIF copies

HeyDeer renamed the engine from pngdeer to slimdeer, and 0.6.0 renamed the package, its command and its rule after it. 0.6.0 also writes WebP and AVIF copies. Five decisions came with these changes:

- **One build of the engine, with AVIF.** The package vendors upstream's single-threaded build with AVIF output (slimdeer 0.3.1, commit 38ce560) and nothing else, so there is one build to reproduce and license. It writes the same PNG and JPEG files as 0.5.0's engine: a comparison of 440 results on 110 images found no difference, and on five of `example/`'s images it took about the same time (10.3 and 10.6 s in all, against 10.2 and 10.4 s, two runs each). The cost is size: the wasm grows from 1,957,171 to 5,318,519 bytes, and the package from 0.5.0's 0.70 MB download (2.3 MB unpacked) to 2.0 MB (5.9 MB). Each engine thread starts in 4.0 ms instead of 1.7 ms, and holds about 8 MB more memory (Node 26 on an M3 Max: 26 MB of process memory after starting the engine, against 18 MB).
- **`ENGINE` names the output, not the file.** The cache key holds `ENGINE` (src/cache.js), which until 0.5.0 was the first 16 hex digits of the wasm's SHA-256. It stays `ad2351d25459d45c`, the prefix of the wasm 0.1.0 to 0.5.0 shipped, and now declares whose PNG and JPEG output an entry describes (`outputIdentity` in engine/provenance.json). The new wasm writes the same files, so 0.5.0's results still count, in a committed cache folder too; keying on the new file's hash would have measured every image again for the same bytes. test/engine-output.test.js compresses five of `example/`'s images at the automatic target and at 80 on every CI platform, and compares each hash, outcome and score with the old engine's. If it fails after an engine change, `ENGINE` becomes the new wasm's prefix, and every image is measured again once.
- **Copies are made at the shrink's quality score.** Each format's own automatic setting can aim lower than the plugin's: upstream aims WebP at TinyPNG's WebP level, and AVIF at 62.3 for a photo. On `example/`'s five images, WebP's own setting gave `hero.png` quality 78 and `crystal-ball.png` 82 where their PNG shrinks reach 87, and AVIF's gave each image 8 to 12 points less than its shrink: `photo.jpg` 64 against 76, below the quality floor. A size at those settings would set a smaller file against a worse picture, so `--format` makes each copy at the quality score of the image's own shrink, or at `--target`, and `--check --format` compares the two at that score. Measured that way, the five copies came out 24% smaller in all than the shrinks as WebP, and 38% as AVIF, with the diagram 59% bigger as AVIF.
- **The mark keeps its old word.** The command still writes `pngdeer <size>` into what it shrinks, and reads both `pngdeer <size>` and `slimdeer <size>`. Versions 0.1.0 to 0.5.0 recognize only the old word, so a teammate or a CI job still on 0.5.0 would measure a file marked `slimdeer <size>` again and flag it, and a second lossy pass costs quality (21% more off `photo.jpg`, 43% off `hero.png`, above). Reading both words lets a later version switch once 0.5.0 is gone.
- **The lint rule has no format option.** On one thread, measuring `example/`'s five images as WebP at their shrinks' quality took 29.3 s, against 11.0 s for the shrinks (2.7 times as long), and as AVIF 229.5 s (21 times as long in all, 8 to 58 times per image). A first lint measures every image of a project, so a format option would multiply its wait, and a copy needs a change in the code that a lint's fix can't make. Only the command writes copies, when asked; `--check --format` and `--review --format` measure them on demand, into the local cache only.
