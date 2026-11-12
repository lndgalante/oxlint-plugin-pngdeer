// What a lint flagged, in all: a table at the end of the run, biggest saving first, and the list that
// `npx oxlint-plugin-slimdeer --flagged` shrinks, so nobody copies paths from warnings one by one.
// The table also lists images the run measured that got no warning, as they're named only where the
// run can't warn (a stylesheet, a page, a template, code it didn't lint or resolve), each with where
// it is named instead, if anywhere. In GitHub Actions, the job summary gets the tables too, with more
// rows, and the commands that preview and shrink the flagged images; the other hints stay on stderr.
import { existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, extname, isAbsolute, join, relative, resolve } from "node:path";
import { isMainThread, threadId } from "node:worker_threads";
import { cacheDir, fileKey, read, reportable } from "./cache.js";
import { appendJobSummary, block, capital, code, inCheckout, table } from "./markdown.js";
import { physical, projectFiles, projectImages } from "./scan.js";
import { count, LEGEND, pathFrom, printable, quote, shrinkCommand, size, smaller } from "./text.js";

// Rows shown per table; the rest are counted, and --flagged still takes them all.
const ROWS = 10;
const UNNAMED_ROWS = 5;
// The job summary has room for the rows a reader would scroll through. Finding where an image is
// named searches the project's files, so fewer of those.
const REPORT_ROWS = 200;
const REPORT_UNNAMED_ROWS = 50;
const NOWHERE = "nothing names it";
// The command that shows the flagged images before and after on one page (review.js), from the list
// this lint leaves, as --flagged shrinks them.
const REVIEW_FLAGGED = { text: "npx oxlint-plugin-slimdeer --review --flagged", shell: "" };
// How wide a terminal draws a character: East Asian wide ones and emoji take two columns, and
// combining marks (the accent of an NFD é) and the vowels and finals of a decomposed Hangul syllable
// none, as in Markus Kuhn's wcwidth.
const WIDE = /[\u1100-\u115f\u2329\u232a\u2e80-\u303e\u3040-\ua4cf\uac00-\ud7a3\uf900-\ufaff\ufe10-\ufe19\ufe30-\ufe6f\uff00-\uff60\uffe0-\uffe6\u{20000}-\u{2fffd}\u{30000}-\u{3fffd}]|\p{Emoji_Presentation}/u;
const ZERO_WIDTH = /[\p{Mn}\p{Me}\p{Cf}\u1160-\u11ff]/u;
// Formats other programs read: the table on stderr would only get in the way.
const MACHINE = new Set(["json", "json-with-metadata", "checkstyle", "junit", "sarif", "gitlab"]);
// Files the linter doesn't read but that use images, most telling first: styles, pages and
// templates, then content and data. Markdown comes last, and only "mentions" an image: a README
// that names one may just be describing it.
const PAGES = [".css", ".scss", ".sass", ".less", ".styl", ".html", ".htm", ".vue", ".svelte", ".astro", ".mdx", ".json", ".webmanifest", ".xml", ".yml", ".yaml"];
const DOCS = [".md"];
// JS and TS that names an image the rule didn't report: a file this run didn't lint (one file,
// lint-staged, a parse error, an ignore pattern), or a path the rule doesn't resolve (bare, built at
// runtime, another package's)
const SOURCES = [".js", ".jsx", ".mjs", ".cjs", ".ts", ".tsx", ".mts", ".cts"];
const ORDER = [...PAGES, ...SOURCES, ...DOCS];
const PAGE_BYTES = 1e6; // bigger ones are build output or lockfiles, not where people name images
// Next.js serves these from app/ by file name alone
const NEXT_METADATA = /^(?:src[\\/])?app[\\/](?:.+[\\/])?(?:opengraph-image|twitter-image|icon|apple-icon)\d*\.(?:png|jpe?g)$/i;

// physical image path -> { original, compressed, score, target, key (the cache key of the bytes
// measured), cacheDir (the folder it was measured into, when not its own package's local one), file:
// the path as code first spelled it, files: the linted files warning about it }
const flagged = new Map();
const named = new Set(); // every image linted code names, flagged or not
const targets = new Map(); // physical image path -> targets required by every enabled reference
const roots = new Map(); // each distinct project/configuration pair, including scoped overrides
const kinds = new Set(); // the extensions of the files linted, like ".tsx"
let owed = null; // the data of a lint's "incomplete" problem that no linted file could report yet (rule.js)
let settled = false; // whether a linted file reported that problem
const SHARE_HOURS = 1; // a thread's share older than this was left by a run that died
// When this process started, in ms by the clock that never jumps, which each of its threads reads
// alike to within microseconds: a thread's share says which run it's from.
const STARTED = Number(process.hrtime.bigint()) / 1e6 - process.uptime() * 1000;

/**
 * Notes an image a warning in linted file `from` was reported for: one warning per file, however often
 * it's linted, and one image however code spells it (logo.png for Logo.png, a symlink to it).
 */
export function flag(file, from, entry) {
  const path = physical(file);
  const previous = flagged.get(path);
  const files = previous?.files ?? new Set();
  // A shared image must keep the strictest quality requested by its reported references.
  const keep = previous && (previous.target ?? previous.score) > (entry.target ?? entry.score) ? previous : entry;
  flagged.set(path, { ...keep, file: previous?.file ?? entry.file ?? file, files: files.add(from) });
}

/** Notes an image linted code names. */
export function name(file) {
  named.add(file);
}

/** A target constrains bulk compression even when its reference produces no warning. */
export function requireTarget(file, target) {
  const path = physical(file);
  const required = targets.get(path) ?? new Set();
  required.add(target ?? "auto");
  targets.set(path, required);
}

/** Notes a project the lint ran in, the options it ran with, and the file it lints, to find images nothing names. */
export function watch(root, options, from) {
  roots.set(JSON.stringify([root, options]), { root, options });
  if (from) kinds.add(extname(from).toLowerCase());
}

/** Leaves the "incomplete" problem's data for a later file to report. */
export function owe(data) {
  owed = data;
}

/** Notes that a linted file reported the "incomplete" problem, so none is owed. */
export function settle() {
  owed = null;
  settled = true;
}

/** The "incomplete" problem's data no file has reported yet, or null. */
export function owing() {
  return owed;
}

/** The list a lint run from `cwd` leaves for --flagged. */
export function flaggedList(cwd) {
  return join(cacheDir(cwd), "flagged.json");
}

/**
 * The images the last lint run from `cwd` flagged, as [{ file, target, cacheDir, changed }] with
 * absolute paths (`cacheDir` only when the lint measured into another folder than the image's own
 * package's local one: its settings name one, or another package's code names the image; `changed`
 * only when the image changed since); null if no lint here left a usable list.
 */
export function readFlagged(cwd) {
  try {
    const list = JSON.parse(readFileSync(flaggedList(cwd), "utf8"));
    const here = physical(cwd);
    // node_modules/.cache travels with a copied project, and worktrees that link one node_modules
    // share it: a list another folder's lint left would have --flagged rewrite that folder's images.
    // A list from before 0.6.0 doesn't say where its lint ran, so it's never used.
    if (typeof list?.cwd !== "string" || !samePath(list.cwd, here) || !Array.isArray(list.images)) return null;
    const usable = (path) => typeof path === "string" && path !== "" && !path.includes("\0");
    if (!list.images.every((entry) =>
      entry && usable(entry.file) && (entry.cacheDir === undefined || usable(entry.cacheDir)) &&
      (entry.key === undefined || (typeof entry.key === "string" && /^[0-9a-f]{64}$/.test(entry.key))) &&
      (entry.target === undefined || (typeof entry.target === "number" && Number.isFinite(entry.target) && entry.target >= 0 && entry.target <= 100)),
    )) return null;
    // Paths from the folder the lint ran in, which may lead out of it ("../shared/logo.png"): the lint
    // here named those images, and its warnings showed them that way. Joined to the folder as
    // realpathSync spells it, links resolved but Windows short names (RUNNER~1) kept, so a path shown
    // from the folder as the shell spells it stays short.
    const base = realpathSync(cwd);
    return list.images.map(({ file, target, key, cacheDir }) => ({
      file: resolve(base, file),
      ...(target === undefined ? {} : { target }),
      ...(cacheDir === undefined ? {} : { cacheDir: resolve(base, cacheDir) }),
      // The lint flagged the bytes it measured. Others there since (a branch switch, a new export,
      // another tool's pass) may be bytes it would leave alone: excluded, kept, or saving too little.
      ...(key === undefined || !changed(resolve(base, file), key, target) ? {} : { changed: true }),
    }));
  } catch {
    return null;
  }
}

/**
 * Whether `file` holds other bytes than those with the cache key `k` at `target`, and not ones
 * the command wrote (it leaves those as they are); one it can't read is said so when shrunk.
 */
function changed(file, k, target) {
  const image = fileKey(file, target);
  return image !== null && !image.marked && image.key !== k;
}

/** The list --flagged reads: the folder the lint ran in, as the filesystem spells it, and each image from there. */
function listing(cwd, images) {
  const here = physical(cwd);
  const from = (file) => {
    const spelled = pathFrom(cwd, file);
    // below the folder, as its warning showed it (a linked public/brand stays public/brand)
    if (spelled !== ".." && !spelled.startsWith("../") && !isAbsolute(spelled)) return spelled;
    // out of it, from both ends as the filesystem spells them, so a link at cwd can't send ../ astray
    try {
      return pathFrom(here, realpathSync.native(file));
    } catch {
      // gone since it was measured
      return spelled;
    }
  };
  return {
    cwd: here,
    // with the key of the bytes measured, and the folder the lint measured each into, if not its
    // package's local one, where --review --flagged reads it
    images: images.map(([file, { target, key, cacheDir }]) => ({ file: from(file), target, key, cacheDir: cacheDir === undefined ? undefined : from(cacheDir) || "." })),
  };
}

/** Whether two physical paths are one folder: Windows doesn't tell letter case apart, drive letters included. */
function samePath(a, b) {
  return a === b || (process.platform === "win32" && a.toLowerCase() === b.toLowerCase());
}

/**
 * ESLint's --concurrency lints in worker threads, each with its own copy of this module: each leaves
 * what it saw for the main thread, after every file it lints (a thread may be stopped without warning),
 * and only the main thread prints. oxlint runs every rule on its main thread.
 */
export function share(cwd = process.cwd()) {
  if (isMainThread || roots.size === 0) return;
  try {
    const dir = join(cacheDir(cwd), "threads");
    mkdirSync(dir, { recursive: true });
    const state = { started: STARTED, flagged: [...flagged].map(([file, entry]) => [file, { ...entry, files: [...entry.files] }]), named: [...named], roots: [...roots], kinds: [...kinds], targets: [...targets].map(([file, required]) => [file, [...required]]), owed, settled };
    writeFileSync(join(dir, `${process.pid}-${threadId}.json`), JSON.stringify(state));
  } catch {
    // that thread's images go untold
  }
}

/** Takes in what this process's lint threads left, and drops shares a dead run left behind. */
function gather(cwd) {
  const dir = join(cacheDir(cwd), "threads");
  let names;
  try {
    names = readdirSync(dir);
  } catch {
    return;
  }
  for (const name of names) {
    const path = join(dir, name);
    try {
      const mine = name.startsWith(`${process.pid}-`);
      const state = mine ? JSON.parse(readFileSync(path, "utf8")) : null;
      // A share with this PID that names another start (or none, from 0.5.0) is a dead run's, whose
      // process had the same PID (routine in containers), and whose images aren't this run's. That
      // run started a whole run earlier: 100 ms is room for a pause between the clock's two reads.
      if (mine && Math.abs(state.started - STARTED) < 100) {
        for (const [file, entry] of state.flagged) {
          for (const from of entry.files) flag(file, from, entry);
        }
        for (const file of state.named) named.add(file);
        for (const [key, scope] of state.roots) roots.set(key, scope);
        for (const kind of state.kinds) kinds.add(kind);
        for (const [file, required] of state.targets) {
          for (const target of required) requireTarget(file, target === "auto" ? undefined : target);
        }
        owed ??= state.owed;
        settled ||= state.settled;
      } else if (!mine && Date.now() - statSync(path).mtimeMs < SHARE_HOURS * 3600e3) continue;
      rmSync(path, { force: true });
    } catch {
      // a share half written or already gone
    }
  }
}

/** Prints the table on stderr and leaves the list in `cwd`; once, as the lint exits, on the main thread. */
export function summarize(cwd = process.cwd()) {
  if (!isMainThread) return;
  gather(cwd);
  // every file linted after a run that ran out of time turned the rule off at its first line, where
  // the problem would go (rule.js), and no other lint thread reported one: the lint still fails
  if (owed && !settled) {
    process.stderr.write(`slimdeer: this lint is incomplete, with ${owed.left} not measured yet, so it fails (a comment turning the rule off hides the problem that says so)\n`);
    process.exitCode ||= 1;
  }
  // ESLint's --cache replays cached warnings without running the rule: they may be stale, and this run
  // saw only the files that changed, if any, so neither a table nor a new --flagged list would be right
  if (eslintCache()) {
    if (!process.argv.includes("--quiet") && !MACHINE.has(format())) {
      process.stderr.write("slimdeer: with eslint --cache, warnings can be stale and there is no summary; run without --cache to update both\n");
    }
    return;
  }
  // a process that linted nothing (ESLint's main thread, when worker threads did the linting and
  // left nothing) has nothing to say, and mustn't empty the list the last lint left
  if (roots.size === 0) return;
  const list = flaggedList(cwd);
  const images = [...flagged.values()].filter((entry) => meetsTargets(entry.file, entry.target)).map((entry) => [entry.file, entry]).sort(([, a], [, b]) => b.original - b.compressed - (a.original - a.compressed));
  const held = [...flagged.values()].filter((entry) => !meetsTargets(entry.file, entry.target)).map((entry) => entry.file);
  // a clean run replaces an older list, and leaves an empty one where the cache folder is already, so
  // --flagged says there's nothing to shrink rather than asking for the lint that just ran; it makes
  // no folder just for that
  if (flagged.size || existsSync(dirname(list))) {
    try {
      mkdirSync(dirname(list), { recursive: true });
      writeFileSync(list, JSON.stringify(listing(cwd, images)));
    } catch {
      // without the list, --flagged has nothing to read; the table still tells
    }
  }
  if (process.argv.includes("--quiet") || MACHINE.has(format())) return;

  const unnamed = unnamedImages();
  if (images.length === 0 && unnamed.length === 0 && held.length === 0) return;
  // GitHub Actions names a file for each step's job summary
  const report = process.env.GITHUB_STEP_SUMMARY;
  const shownUnnamed = unnamed.slice(0, UNNAMED_ROWS);
  // the unnamed images say where they're named, as no warning can point there
  const places = unnamed.slice(0, report ? REPORT_UNNAMED_ROWS : UNNAMED_ROWS).map(place);
  const row = ([file, { original, compressed, score }]) => [pathFrom(cwd, file), size(original), size(compressed), size(original - compressed), String(Math.round(score))];
  const header = ["image", "now", "after", "saves", "quality"];
  const rows = [header, ...images.slice(0, ROWS).map(row), ...shownUnnamed.map((image, i) => [...row(image), said(cwd, places[i])])];
  const width = (column) => Math.max(...rows.map((cells) => columns(cells[column] ?? "")));
  const line = ([path, before, after, saved, score, place], arrow = "→") =>
    `  ${path}${" ".repeat(width(0) - columns(path))}  ${before.padStart(width(1))} ${arrow} ${after.padStart(width(2))}  ${saved.padStart(width(3))}  ${score.padStart(width(4))}${place === undefined ? "" : `  ${place}`}`.trimEnd();
  const lines = [];
  const says = {}; // what the job summary says too
  if (images.length) {
    const { saved, detail } = total(images);
    // an image named in many files warns in each: say so, or the counts look wrong
    const warnings = images.reduce((sum, [, image]) => sum + image.files.size, 0);
    const often = warnings > images.length ? ` (${count(warnings, "warning")})` : "";
    says.flagged = `${count(images.length, "flagged image")}${often} could be ${saved} smaller in all (${detail})`;
    lines.push(`slimdeer: ${says.flagged}:`, line(header, " "));
    lines.push(...rows.slice(1, 1 + Math.min(images.length, ROWS)).map((cells) => line(cells)));
    if (images.length > ROWS) lines.push(`  …and ${count(images.length - ROWS, "more image")}, ${total(images.slice(ROWS)).saved} in all`);
  }
  if (unnamed.length) {
    // no warning points at these: they're named in CSS, HTML and the like, in JS or TS the rule
    // didn't lint or resolve, or nowhere. "This run", not "the rule": a file a one-file lint or
    // lint-staged left out gets its warning when it's linted.
    const lead = flagged.size ? `also ${count(unnamed.length, "image")} with no warning` : `no warnings, but ${count(unnamed.length, "image")}`;
    says.unnamed = `${lead} could be ${total(unnamed).saved} smaller (named only where this run can't warn, or nowhere)`;
    lines.push(`slimdeer: ${says.unnamed}:`);
    if (!images.length) lines.push(line(header, " "));
    lines.push(...rows.slice(1 + Math.min(images.length, ROWS)).map((cells) => line(cells)));
    if (unnamed.length > UNNAMED_ROWS) lines.push(`  …and ${count(unnamed.length - UNNAMED_ROWS, "more image")}, ${total(unnamed.slice(UNNAMED_ROWS)).saved} in all`);
  }
  if (images.length || unnamed.length) lines.push(`slimdeer: ${LEGEND}`);
  if (images.length) {
    says.shrink = { say: `to shrink the ${images.length === 1 ? "flagged image" : `${images.length} flagged images`} in place (lossy, so commit first)`, command: { text: "npx oxlint-plugin-slimdeer --flagged", shell: "" } };
    for (const { say, command } of [preview(cwd, images), says.shrink]) lines.push(`slimdeer: ${say}, run${command.shell}: ${command.text}`);
  }
  if (unnamed.length) {
    const which = unnamed.length === 1 ? "it" : "them";
    const commands = new Map();
    for (const [file, { target }] of shownUnnamed) {
      const paths = commands.get(target) ?? [];
      paths.push(pathFrom(cwd, file));
      commands.set(target, paths);
    }
    // the command takes the rows shown, as --check's takes its 10 biggest
    const shrunk = unnamed.length > UNNAMED_ROWS ? `the ${UNNAMED_ROWS} biggest of ${unnamed.length}` : which;
    for (const [target, paths] of commands) {
      const command = shrinkCommand(paths, target);
      lines.push(`slimdeer: to shrink ${images.length ? `${shrunk} too` : `${shrunk} in place (lossy, so commit first)`}, run${command.shell}: ${command.text}`);
    }
    // an ESLint config that lints only .js files, say: "exclude" isn't the answer there
    const unlinted = new Map(); // JS or TS extensions this run linted no file of -> a file that names an image
    for (const { page } of places.slice(0, UNNAMED_ROWS)) {
      const kind = page && extname(page).toLowerCase();
      if (SOURCES.includes(kind) && !kinds.has(kind) && !unlinted.has(kind)) unlinted.set(kind, page);
    }
    for (const [kind, page] of unlinted) {
      lines.push(`slimdeer: this run linted no ${kind} files, like ${pathFrom(cwd, page)}, so their images get no warning; with ESLint, see https://github.com/lndgalante/oxlint-plugin-slimdeer#quick-start-with-eslint`);
    }
    // "exclude" takes paths from each image's project folder: name them when the rows show others
    const patterns = shownUnnamed.map(([file, , root]) => ({ pattern: pathFrom(root, file), shown: pathFrom(cwd, file), folder: pathFrom(cwd, root) || "." }));
    if (patterns.every(({ pattern, shown }) => pattern === shown)) {
      lines.push(`slimdeer: to keep ${which} as is and stop listing ${which}, add ${unnamed.length === 1 ? "its path" : "their paths"} to the rule's "exclude" option`);
    } else {
      const folders = new Set(patterns.map(({ folder }) => folder));
      const list = patterns.map(({ pattern, folder }) => `${JSON.stringify(pattern)}${folders.size > 1 ? ` (in ${folder})` : ""}`).join(", ");
      const start = folders.size > 1 ? "each package's folder" : [...folders][0];
      lines.push(`slimdeer: to keep ${which} as is and stop listing ${which}, add ${list}${unnamed.length > patterns.length ? ", …" : ""} to the rule's "exclude" option (its paths start at ${start})`);
    }
    if (places.slice(0, UNNAMED_ROWS).some(({ what }) => what === NOWHERE)) {
      lines.push("slimdeer: an image nothing names may be unused (or its path is built at runtime): deleting it saves it all");
    }
  }
  if (held.length) {
    says.held = `left ${count(held.length, "shared image")} out of --flagged because another reference requires a different quality target`;
    lines.push(`slimdeer: ${says.held}:`);
    lines.push(...held.slice(0, ROWS).map((file) => `  ${pathFrom(cwd, file)}`));
    if (held.length > ROWS) lines.push(`  …and ${count(held.length - ROWS, "more image")}`);
    lines.push("slimdeer: use one target for each shared image before compressing it in bulk.");
  }
  // a file name's control characters (an escape sequence, a line break) would restyle the terminal or
  // break a row: replaced, as in the job summary, by a character as wide
  process.stderr.write(`${lines.map(printable).join("\n")}\n`);
  // GitHub annotates a step's first 10 warnings only, and the table above is deep in its log
  if (report) {
    try {
      appendJobSummary(report, markdown(cwd, { images, unnamed, places, held, says, incomplete: Boolean(owed) || settled }));
    } catch {
      // the table on stderr still tells
    }
  }
}

/** What `images` ([path, entry]) add up to: the bytes saved, and before → after. */
function total(images) {
  const original = images.reduce((sum, [, image]) => sum + image.original, 0);
  const compressed = images.reduce((sum, [, image]) => sum + image.compressed, 0);
  return { saved: size(original - compressed), detail: `${size(original)} → ${size(compressed)}, ${smaller(original, compressed)}% smaller` };
}

/** How many columns a terminal takes to draw `text`. */
function columns(text) {
  let n = 0;
  for (const char of text) n += ZERO_WIDTH.test(char) ? 0 : WIDE.test(char) ? 2 : 1;
  return n;
}

/** Where an image no warning points at is named instead: { what, page }, `page` the file that names it, if any. */
function place([file, , root, { publicDirs }]) {
  if (nextMetadata(file, root)) return { what: "a Next.js metadata file" };
  const page = namedIn(root, file, publicDirs);
  if (!page) return { what: NOWHERE };
  const kind = extname(page).toLowerCase();
  return { what: `${DOCS.includes(kind) ? "mentioned" : SOURCES.includes(kind) ? "named" : "used"} in`, page };
}

/** A place() as the table says it. */
function said(cwd, { what, page }) {
  return page ? `${what} ${pathFrom(cwd, page)}` : what;
}

/**
 * The command to see the flagged images before they're shrunk: with several, the page that compares
 * them all, each at its own target; with one, the command that writes it as a new file, as --check
 * prints it, quoted for `platform`'s shell.
 */
function preview(cwd, images, platform = process.platform) {
  if (images.length > 1) return { say: `to see the ${images.length} flagged images before and after on one page first`, command: REVIEW_FLAGGED };
  const [[file, { target }]] = images;
  const path = pathFrom(cwd, file);
  const extension = extname(path);
  const command = shrinkCommand([path], target, platform);
  return { say: "to preview it as a new file", command: { text: `${command.text} -o ${quote(`${basename(path, extension)}.preview${extension}`, platform)}`, shell: command.shell } };
}

/**
 * The summary in Markdown, for a GitHub Actions job summary: every row up to REPORT_ROWS, each path
 * as code (a file name can hold | or `), and each command in a block GitHub gives a copy button.
 */
function markdown(cwd, { images, unnamed, places, held, says, incomplete }) {
  // a monorepo's packages may each lint in their own folder, where their commands run
  const folder = inCheckout(cwd);
  const blocks = [`### slimdeer${folder ? ` in ${code(folder)}` : ""}`];
  // the lint's output says so too, but a table here would pass for the whole story
  if (incomplete) {
    blocks.push("This lint is incomplete: slimdeer stopped measuring before it had measured every image, so these totals leave some out. Run it again to carry on, and keep the cache between CI runs (`settings.slimdeer.cacheDir`).");
  }
  const header = ["Image", "Now", "After", "Saves", "Quality"];
  const cells = ([file, { original, compressed, score }]) => [code(pathFrom(cwd, file)), size(original), size(compressed), size(original - compressed), String(Math.round(score))];
  const more = (list, shown) => `…and ${count(list.length - shown, "more image")}, ${total(list.slice(shown)).saved} in all.`;
  if (images.length) {
    blocks.push(`${capital(says.flagged)}:`, table(header, images.slice(0, REPORT_ROWS).map(cells)));
    if (images.length > REPORT_ROWS) blocks.push(more(images, REPORT_ROWS));
  }
  if (unnamed.length) {
    const rows = places.map((where, i) => [...cells(unnamed[i]), where.page ? `${where.what} ${code(pathFrom(cwd, where.page))}` : where.what]);
    blocks.push(`${capital(says.unnamed)}:`, table([...header, "Where"], rows));
    if (unnamed.length > places.length) blocks.push(more(unnamed, places.length));
  }
  if (images.length || unnamed.length) blocks.push(`${capital(LEGEND)}.`);
  if (images.length) {
    // the reader's machine has neither the list that --flagged and --review --flagged read, which a
    // lint leaves where it ran, nor the node and slimdeer.js a Windows runner's PowerShell form names:
    // npx, quoted for a POSIX shell. The commands run where the lint did, and a page has no "this
    // folder", so the folder is named.
    const where = folder ? code(folder) : "the folder CI linted";
    const lintFirst = `lint in ${where}, then run`;
    for (const [{ say, command }, run] of [[preview(cwd, images, "linux"), images.length > 1 ? lintFirst : folder ? `run in ${where}` : "run"], [says.shrink, lintFirst]]) {
      blocks.push(`${capital(say)}, ${run}${command.shell}:\n\n${block(command.text)}`);
    }
  }
  if (held.length) {
    const files = held.slice(0, REPORT_ROWS).map((file) => code(pathFrom(cwd, file))).join(", ");
    blocks.push(`${capital(says.held)}: ${files}${held.length > REPORT_ROWS ? ", …" : ""}. Use one target for each shared image before compressing it in bulk.`);
  }
  return `\n${blocks.join("\n\n")}\n`;
}

function meetsTargets(file, target) {
  const required = targets.get(physical(file));
  if (!required) return true;
  // An automatic target is image-dependent, so it cannot safely be ordered against a fixed one.
  if (required.has("auto")) return required.size === 1 && target === undefined;
  return target !== undefined && target >= Math.max(...required);
}

/**
 * Measured images in the linted projects that no linted code names, and that would clear the rule's
 * thresholds: [[path, entry, root, options]], biggest saving first. Reads only results already cached.
 */
function unnamedImages() {
  const found = new Map();
  let known; // the physical paths of the images linted code names, read once one is needed
  for (const { root, options } of roots.values()) {
    if (options.scan === "referenced") continue;
    for (const file of projectImages(root, options.minSavedBytes, options.exclude)) {
      if (named.has(file) || flagged.has(file)) continue;
      const image = fileKey(file, options.target);
      const entry = image && read(options.dir, image.key);
      if (!reportable(entry, options)) continue;
      known ??= new Set([...named, ...flagged.keys()].map(physical));
      if (known.has(physical(file))) continue;
      const previous = found.get(file)?.[1];
      if (previous && (previous.target ?? previous.score) > (options.target ?? entry.score)) continue;
      found.set(file, [file, { ...entry, target: options.target }, root, options]);
    }
  }
  return [...found.values()].sort(([, a], [, b]) => b.original - b.compressed - (a.original - a.compressed));
}

const pages = new Map(); // project root -> [{ path, text }] of the files that may name images, in ORDER, read once
const nexts = new Map(); // project root -> whether its package.json depends on next

function pagesOf(root) {
  if (!pages.has(root)) {
    const rank = (path) => ORDER.indexOf(extname(path).toLowerCase());
    // one walk, sorted by kind; the sort is stable, so each kind keeps the walk's order
    const files = projectFiles(root, ORDER, 0, PAGE_BYTES).sort((a, b) => rank(a) - rank(b));
    pages.set(root, files.flatMap((path) => {
      try {
        return [{ path, text: readFileSync(path, "utf8") }];
      } catch {
        return [];
      }
    }));
  }
  return pages.get(root);
}

/**
 * The most telling file that names `image`: by its path first (from the file, from the project, or
 * "/x" from a public dir), then by its name alone; in its own project first, then in the other
 * linted ones; or null.
 */
function namedIn(imageRoot, image, publicDirs = []) {
  const name = basename(image);
  const spellings = (forms) => [...new Set(forms.flatMap((form) => [form, encodeURI(form)]))];
  const names = spellings([name]);
  for (const root of new Set([imageRoot, ...[...roots.values()].map((scope) => scope.root)])) {
    const paths = (page) => spellings([
      pathFrom(dirname(page), image),
      pathFrom(root, image),
      ...publicDirs.map((dir) => `/${pathFrom(join(root, dir), image)}`).filter((path) => !path.startsWith("/..")),
    ]);
    // every path ends in the name, so only files that hold it need a closer look
    const candidates = pagesOf(root).filter(({ text }) => names.some((spelling) => text.includes(spelling)));
    const page =
      candidates.find(({ path, text }) => paths(path).some((spelling) => holds(text, spelling))) ??
      candidates.find(({ text }) => names.some((spelling) => holds(text, spelling)));
    if (page) return page.path;
  }
  return null;
}

/** Whether `text` holds `path` whole, not as the end of a longer name (my-logo.png for logo.png). */
function holds(text, path) {
  for (let at = text.indexOf(path); at >= 0; at = text.indexOf(path, at + 1)) {
    if (at === 0 || !/[\w.-]/.test(text[at - 1])) return true;
  }
  return false;
}

/** A Next.js app/ metadata image (opengraph-image.png, icon.png), in a project that depends on next. */
function nextMetadata(file, root) {
  if (!NEXT_METADATA.test(relative(root, file))) return false;
  if (!nexts.has(root)) {
    try {
      const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
      nexts.set(root, Boolean(pkg.dependencies?.next ?? pkg.devDependencies?.next));
    } catch {
      nexts.set(root, false);
    }
  }
  return nexts.get(root);
}

/** Whether ESLint runs with --cache: the last of --cache, --cache=true, --no-cache and --cache=false wins. */
function eslintCache() {
  const flag = process.argv.findLast((arg) => /^--(?:no-)?cache(?:=(?:true|false))?$/.test(arg));
  return flag === "--cache" || flag === "--cache=true";
}

/** The linter's output format, from its command line: `-f x`, `--format x` or `--format=x`. */
function format() {
  const args = process.argv;
  const at = args.findIndex((arg) => arg === "-f" || arg === "--format");
  if (at >= 0) return args[at + 1];
  return args.find((arg) => arg.startsWith("--format="))?.slice("--format=".length);
}
