// What a lint flagged, in all: a table at the end of the run, biggest saving first, and the list that
// `npx oxlint-plugin-pngdeer --flagged` shrinks, so nobody copies paths from warnings one by one.
// The table also lists images the run measured that no linted JS or TS names, which no warning can
// point at, each with where it is named instead (a stylesheet, a page, a template), if anywhere.
import { existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, extname, isAbsolute, join, relative } from "node:path";
import { isMainThread, threadId } from "node:worker_threads";
import { cacheDir, fileKey, read, reportable } from "./cache.js";
import { projectFiles, projectImages } from "./scan.js";
import { count, pathFrom, shrinkCommand, size, smaller } from "./text.js";

// Rows shown per table; the rest are counted, and --flagged still takes them all.
const ROWS = 10;
const UNNAMED_ROWS = 5;
const NOWHERE = "nothing names it";
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

// physical image path -> { original, compressed, score, target, file: the path as code first spelled it,
// files: the linted files warning about it }
const flagged = new Map();
const named = new Set(); // every image linted code names, flagged or not
const targets = new Map(); // physical image path -> targets required by every enabled reference
const roots = new Map(); // each distinct project/configuration pair, including scoped overrides
const kinds = new Set(); // the extensions of the files linted, like ".tsx"
let owed = null; // the data of a lint's "incomplete" problem that no linted file could report yet (rule.js)
let settled = false; // whether a linted file reported that problem
const SHARE_HOURS = 1; // a thread's share older than this was left by a run that died

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

/** The images the last lint run from `cwd` flagged, as [{ file, target }]; null if no lint left a list. */
export function readFlagged(cwd) {
  try {
    const list = JSON.parse(readFileSync(flaggedList(cwd), "utf8"));
    if (!Array.isArray(list) || !list.every((entry) =>
      entry && typeof entry.file === "string" && isAbsolute(entry.file) && !entry.file.includes("\0") &&
      (entry.target === undefined || (typeof entry.target === "number" && Number.isFinite(entry.target) && entry.target >= 0 && entry.target <= 100)),
    )) return null;
    return list;
  } catch {
    return null;
  }
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
    const state = { flagged: [...flagged].map(([file, entry]) => [file, { ...entry, files: [...entry.files] }]), named: [...named], roots: [...roots], kinds: [...kinds], targets: [...targets].map(([file, required]) => [file, [...required]]), owed, settled };
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
      if (name.startsWith(`${process.pid}-`)) {
        const state = JSON.parse(readFileSync(path, "utf8"));
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
      } else if (Date.now() - statSync(path).mtimeMs < SHARE_HOURS * 3600e3) continue;
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
    process.stderr.write(`pngdeer: this lint is incomplete, with ${owed.left} not measured yet, so it fails (a comment turning the rule off hides the problem that says so)\n`);
    process.exitCode ||= 1;
  }
  // ESLint's --cache replays cached warnings without running the rule: they may be stale, and this run
  // saw only the files that changed, if any, so neither a table nor a new --flagged list would be right
  if (eslintCache()) {
    if (!process.argv.includes("--quiet") && !MACHINE.has(format())) {
      process.stderr.write("pngdeer: with eslint --cache, warnings can be stale and there is no summary; run without --cache to update both\n");
    }
    return;
  }
  // a process that linted nothing (ESLint's main thread, when worker threads did the linting and
  // left nothing) has nothing to say, and mustn't empty the list the last lint left
  if (roots.size === 0) return;
  const list = flaggedList(cwd);
  const images = [...flagged.values()].filter((entry) => meetsTargets(entry.file, entry.target)).map((entry) => [entry.file, entry]).sort(([, a], [, b]) => b.original - b.compressed - (a.original - a.compressed));
  const held = [...flagged.values()].filter((entry) => !meetsTargets(entry.file, entry.target)).map((entry) => entry.file);
  // a clean run replaces an older list, but doesn't create one
  if (flagged.size || existsSync(list)) {
    try {
      mkdirSync(dirname(list), { recursive: true });
      writeFileSync(list, JSON.stringify(images.map(([file, { target }]) => ({ file, target }))));
    } catch {
      // without the list, --flagged has nothing to read; the table still tells
    }
  }
  if (process.argv.includes("--quiet") || MACHINE.has(format())) return;

  const unnamed = unnamedImages();
  if (images.length === 0 && unnamed.length === 0 && held.length === 0) return;
  const shownUnnamed = unnamed.slice(0, UNNAMED_ROWS);
  const row = ([file, { original, compressed, score }]) => [pathFrom(cwd, file), size(original), size(compressed), size(original - compressed), String(Math.round(score))];
  const header = ["image", "now", "after", "saves", "quality"];
  // the unnamed images say where they're named, as no warning can point there
  const unlinted = new Map(); // JS or TS extensions this run linted no file of -> a file that names an image
  const where = ([file, , root, { publicDirs }]) => {
    if (nextMetadata(file, root)) return "a Next.js metadata file";
    const page = namedIn(root, file, publicDirs);
    if (!page) return NOWHERE;
    const kind = extname(page).toLowerCase();
    if (SOURCES.includes(kind) && !kinds.has(kind) && !unlinted.has(kind)) unlinted.set(kind, page);
    return `${DOCS.includes(kind) ? "mentioned" : SOURCES.includes(kind) ? "named" : "used"} in ${pathFrom(cwd, page)}`;
  };
  const places = shownUnnamed.map(where);
  const rows = [header, ...images.slice(0, ROWS).map(row), ...shownUnnamed.map((image, i) => [...row(image), places[i]])];
  const width = (column) => Math.max(...rows.map((cells) => (cells[column] ?? "").length));
  const line = ([path, before, after, saved, score, place], arrow = "→") =>
    `  ${path.padEnd(width(0))}  ${before.padStart(width(1))} ${arrow} ${after.padStart(width(2))}  ${saved.padStart(width(3))}  ${score.padStart(width(4))}${place === undefined ? "" : `  ${place}`}`.trimEnd();
  const total = (list) => {
    const original = list.reduce((sum, [, image]) => sum + image.original, 0);
    const compressed = list.reduce((sum, [, image]) => sum + image.compressed, 0);
    return { saved: size(original - compressed), detail: `${size(original)} → ${size(compressed)}, ${smaller(original, compressed)}% smaller` };
  };
  const lines = [];
  if (images.length) {
    const { saved, detail } = total(images);
    // an image named in many files warns in each: say so, or the counts look wrong
    const warnings = images.reduce((sum, [, image]) => sum + image.files.size, 0);
    const often = warnings > images.length ? ` (${count(warnings, "warning")})` : "";
    lines.push(`pngdeer: ${count(images.length, "flagged image")}${often} could be ${saved} smaller in all (${detail}):`, line(header, " "));
    lines.push(...rows.slice(1, 1 + Math.min(images.length, ROWS)).map((cells) => line(cells)));
    if (images.length > ROWS) lines.push(`  …and ${count(images.length - ROWS, "more image")}, ${total(images.slice(ROWS)).saved} in all`);
  }
  if (unnamed.length) {
    // no warning can point at these: they're named in CSS, HTML and the like, in JS or TS the rule
    // didn't lint or resolve, or nowhere
    const { saved } = total(unnamed);
    const lead = flagged.size ? "also" : "no warnings, but";
    lines.push(`pngdeer: ${lead} ${count(unnamed.length, "image")} that no linted JS or TS names could be ${saved} smaller:`);
    if (!images.length) lines.push(line(header, " "));
    lines.push(...rows.slice(1 + Math.min(images.length, ROWS)).map((cells) => line(cells)));
    if (unnamed.length > UNNAMED_ROWS) lines.push(`  …and ${count(unnamed.length - UNNAMED_ROWS, "more image")}, ${total(unnamed.slice(UNNAMED_ROWS)).saved} in all`);
  }
  if (images.length || unnamed.length) lines.push("pngdeer: quality is SSIMULACRA2, out of 100: 90+ looks identical, 80+ the same side by side, 70+ close, with differences you might spot side by side, below 70 visibly different");
  if (images.length) {
    lines.push(`pngdeer: to shrink the ${images.length === 1 ? "flagged image" : `${images.length} flagged images`} in place (lossy, so commit first), run: npx oxlint-plugin-pngdeer --flagged`);
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
      lines.push(`pngdeer: to shrink ${images.length ? `${shrunk} too` : `${shrunk} in place (lossy, so commit first)`}, run${command.shell}: ${command.text}`);
    }
    // an ESLint config that lints only .js files, say: "exclude" isn't the answer there
    for (const [kind, page] of unlinted) {
      lines.push(`pngdeer: this run linted no ${kind} files, like ${pathFrom(cwd, page)}, so their images get no warning; with ESLint, see https://github.com/lndgalante/oxlint-plugin-pngdeer#quick-start-with-eslint`);
    }
    // "exclude" takes paths from each image's project folder: name them when the rows show others
    const patterns = shownUnnamed.map(([file, , root]) => ({ pattern: pathFrom(root, file), shown: pathFrom(cwd, file), folder: pathFrom(cwd, root) || "." }));
    if (patterns.every(({ pattern, shown }) => pattern === shown)) {
      lines.push(`pngdeer: to keep ${which} as is and stop listing ${which}, add ${unnamed.length === 1 ? "its path" : "their paths"} to the rule's "exclude" option`);
    } else {
      const folders = new Set(patterns.map(({ folder }) => folder));
      const list = patterns.map(({ pattern, folder }) => `${JSON.stringify(pattern)}${folders.size > 1 ? ` (in ${folder})` : ""}`).join(", ");
      const start = folders.size > 1 ? "each package's folder" : [...folders][0];
      lines.push(`pngdeer: to keep ${which} as is and stop listing ${which}, add ${list}${unnamed.length > patterns.length ? ", …" : ""} to the rule's "exclude" option (its paths start at ${start})`);
    }
    if (places.includes(NOWHERE)) {
      lines.push("pngdeer: an image nothing names may be unused (or its path is built at runtime): deleting it saves it all");
    }
  }
  if (held.length) {
    lines.push(`pngdeer: left ${count(held.length, "shared image")} out of --flagged because another reference requires a different quality target:`);
    lines.push(...held.slice(0, ROWS).map((file) => `  ${pathFrom(cwd, file)}`));
    if (held.length > ROWS) lines.push(`  …and ${count(held.length - ROWS, "more image")}`);
    lines.push("pngdeer: use one target for each shared image before compressing it in bulk.");
  }
  process.stderr.write(`${lines.join("\n")}\n`);
}

function meetsTargets(file, target) {
  const required = targets.get(physical(file));
  if (!required) return true;
  // An automatic target is image-dependent, so it cannot safely be ordered against a fixed one.
  if (required.has("auto")) return required.size === 1 && target === undefined;
  return target !== undefined && target >= Math.max(...required);
}

/**
 * The path on disk, as the filesystem spells it: code may name Logo.png as logo.png, or café.png in
 * another Unicode form, where the filesystem doesn't tell them apart.
 */
export function physical(file) {
  try {
    return realpathSync.native(file);
  } catch {
    return file;
  }
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
