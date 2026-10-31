// What a lint flagged, in all: a table at the end of the run, biggest saving first, and the list that
// `npx oxlint-plugin-pngdeer --flagged` shrinks, so nobody copies paths from warnings one by one.
// The table also lists images the run measured that no linted JS or TS names, which no warning can
// point at, each with where it is used instead (a stylesheet, a page, a template), if anywhere.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { cacheDir, fileKey, read, reportable } from "./cache.js";
import { projectFiles, projectImages } from "./scan.js";
import { count, pathFrom, quote, size, smaller } from "./text.js";

// Rows shown per table; the rest are counted, and --flagged still takes them all.
const ROWS = 10;
const UNNAMED_ROWS = 5;
// Formats other programs read: the table on stderr would only get in the way.
const MACHINE = new Set(["json", "json-with-metadata", "checkstyle", "junit", "sarif", "gitlab"]);
// Files the linter doesn't read but that use images, most telling first: styles, pages and
// templates, then content and data. Markdown comes last, and only "mentions" an image: a README
// that names one may just be describing it.
const PAGES = [".css", ".scss", ".sass", ".less", ".styl", ".html", ".htm", ".vue", ".svelte", ".astro", ".mdx", ".json", ".yml", ".yaml"];
const DOCS = [".md"];
const PAGE_BYTES = 1e6; // bigger ones are build output or lockfiles, not where people name images

const flagged = new Map(); // image path -> { original, compressed, score, target }
const named = new Set(); // every image linted code names, flagged or not
const roots = new Map(); // project root -> the rule's options there

/** Notes an image a warning was reported for. */
export function flag(file, entry) {
  flagged.set(file, entry);
}

/** Notes an image linted code names. */
export function name(file) {
  named.add(file);
}

/** Notes a project the lint ran in, and the options it ran with, to find images nothing names. */
export function watch(root, options) {
  roots.set(root, options);
}

/** The list a lint run from `cwd` leaves for --flagged. */
export function flaggedList(cwd) {
  return join(cacheDir(cwd), "flagged.json");
}

/** The images the last lint run from `cwd` flagged, as [{ file, target }]; null if no lint left a list. */
export function readFlagged(cwd) {
  try {
    return JSON.parse(readFileSync(flaggedList(cwd), "utf8"));
  } catch {
    return null;
  }
}

/** Prints the table on stderr and leaves the list in `cwd`; once, as the lint exits. */
export function summarize(cwd = process.cwd()) {
  const list = flaggedList(cwd);
  const images = [...flagged].sort(([, a], [, b]) => b.original - b.compressed - (a.original - a.compressed));
  // a clean run replaces an older list, but doesn't create one
  if (images.length || existsSync(list)) {
    try {
      mkdirSync(dirname(list), { recursive: true });
      writeFileSync(list, JSON.stringify(images.map(([file, { target }]) => ({ file, target }))));
    } catch {
      // without the list, --flagged has nothing to read; the table still tells
    }
  }
  if (process.argv.includes("--quiet") || MACHINE.has(format())) return;

  const unnamed = unnamedImages();
  if (images.length === 0 && unnamed.length === 0) return;
  const shownUnnamed = unnamed.slice(0, UNNAMED_ROWS);
  const row = ([file, { original, compressed, score }]) => [pathFrom(cwd, file), size(original), size(compressed), size(original - compressed), String(Math.round(score))];
  const header = ["image", "now", "after", "saves", "quality"];
  // the unnamed images say where they're named, as no warning can point there
  const where = ([file, , root]) => {
    const page = namedIn(root, file);
    if (!page) return "nothing names it";
    return `${page.endsWith(".md") ? "mentioned" : "used"} in ${pathFrom(cwd, page)}`;
  };
  const rows = [header, ...images.slice(0, ROWS).map(row), ...shownUnnamed.map((image) => [...row(image), where(image)])];
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
    lines.push(`pngdeer: ${count(images.length, "flagged image")} could be ${saved} smaller in all (${detail}):`, line(header, " "));
    lines.push(...rows.slice(1, 1 + Math.min(images.length, ROWS)).map((cells) => line(cells)));
    if (images.length > ROWS) lines.push(`  …and ${count(images.length - ROWS, "more image")}, ${total(images.slice(ROWS)).saved} in all`);
  }
  if (unnamed.length) {
    // no warning can point at these: their only mention is in CSS, HTML and the like, or nowhere
    const { saved } = total(unnamed);
    const lead = images.length ? "also" : "no warnings, but";
    lines.push(`pngdeer: ${lead} ${count(unnamed.length, "image")} that no linted JS or TS names could be ${saved} smaller:`);
    if (!images.length) lines.push(line(header, " "));
    lines.push(...rows.slice(1 + Math.min(images.length, ROWS)).map((cells) => line(cells)));
    if (unnamed.length > UNNAMED_ROWS) lines.push(`  …and ${count(unnamed.length - UNNAMED_ROWS, "more image")}`);
  }
  lines.push("pngdeer: quality is SSIMULACRA2, out of 100: 90+ looks identical, 80+ the same side by side, 70+ close, with differences you might spot side by side");
  if (images.length) {
    lines.push(`pngdeer: to shrink the ${images.length === 1 ? "flagged image" : `${images.length} flagged images`} in place (lossy, so commit first), run: npx oxlint-plugin-pngdeer --flagged`);
  }
  if (unnamed.length) {
    const paths = shownUnnamed.map(([file]) => quote(pathFrom(cwd, file))).join(" ");
    const which = unnamed.length === 1 ? "it" : "them";
    lines.push(`pngdeer: to shrink ${images.length ? `${which} too` : `${which} in place (lossy, so commit first)`}, run: npx oxlint-plugin-pngdeer ${paths}`);
    if (shownUnnamed.some((image) => !namedIn(image[2], image[0]))) {
      lines.push("pngdeer: an image nothing names may be unused (or its path is built at runtime): deleting it saves it all");
    }
  }
  process.stderr.write(`${lines.join("\n")}\n`);
}

/**
 * Measured images in the linted projects that no linted code names, and that would clear the rule's
 * thresholds: [[path, entry, root]], biggest saving first. Reads only results already cached.
 */
function unnamedImages() {
  const found = [];
  for (const [root, options] of roots) {
    for (const file of projectImages(root, options.minSavedBytes)) {
      if (named.has(file) || flagged.has(file)) continue;
      const image = fileKey(file, options.target);
      const entry = image && read(cacheDir(root), image.key);
      if (reportable(entry, options)) found.push([file, entry, root]);
    }
  }
  return found.sort(([, a], [, b]) => b.original - b.compressed - (a.original - a.compressed));
}

const pages = new Map(); // project root -> [{ path, text }] of its PAGES, then its DOCS, read once

/** The most telling file the linter doesn't read (a stylesheet, a template, a doc) that names `image`; or null. */
function namedIn(root, image) {
  if (!pages.has(root)) {
    const files = [...PAGES, ...DOCS].flatMap((extension) => projectFiles(root, [extension], 0, PAGE_BYTES));
    pages.set(root, files.flatMap((path) => {
      try {
        return [{ path, text: readFileSync(path, "utf8") }];
      } catch {
        return [];
      }
    }));
  }
  const name = basename(image);
  return pages.get(root).find(({ text }) => text.includes(name))?.path ?? null;
}

/** The linter's output format, from its command line: `-f x`, `--format x` or `--format=x`. */
function format() {
  const args = process.argv;
  const at = args.findIndex((arg) => arg === "-f" || arg === "--format");
  if (at >= 0) return args[at + 1];
  return args.find((arg) => arg.startsWith("--format="))?.slice("--format=".length);
}
