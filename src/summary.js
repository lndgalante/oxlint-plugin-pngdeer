// What a lint flagged, in all: a table at the end of the run, biggest saving first, and the list that
// `npx oxlint-plugin-pngdeer --flagged` shrinks, so nobody copies paths from warnings one by one.
// The table also names images the run measured but no linted code names (used from CSS or HTML, or
// not at all), which no warning can point at.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { cacheDir, key, read, reportable } from "./cache.js";
import { projectImages } from "./scan.js";
import { count, pathFrom, size, smaller } from "./text.js";

// Rows shown per table; the rest are counted, and --flagged still takes them all.
const ROWS = 10;
const UNNAMED_ROWS = 5;
// Formats other programs read: the table on stderr would only get in the way.
const MACHINE = new Set(["json", "json-with-metadata", "checkstyle", "junit", "sarif", "gitlab"]);

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
  const row = ([file, { original, compressed, score }]) => [pathFrom(cwd, file), size(original), size(compressed), size(original - compressed), String(Math.round(score))];
  const rows = [["image", "now", "after", "saves", "quality"], ...images.slice(0, ROWS).map(row), ...unnamed.slice(0, UNNAMED_ROWS).map(row)];
  const width = (column) => Math.max(...rows.map((cells) => cells[column].length));
  const line = ([path, before, after, saved, score], arrow = "→") =>
    `  ${path.padEnd(width(0))}  ${before.padStart(width(1))} ${arrow} ${after.padStart(width(2))}  ${saved.padStart(width(3))}  ${score.padStart(width(4))}`;
  const total = (list) => {
    const original = list.reduce((sum, [, image]) => sum + image.original, 0);
    const compressed = list.reduce((sum, [, image]) => sum + image.compressed, 0);
    return { saved: size(original - compressed), detail: `${size(original)} → ${size(compressed)}, ${smaller(original, compressed)}% smaller` };
  };
  const lines = [];
  if (images.length) {
    const { saved, detail } = total(images);
    lines.push(`pngdeer: ${count(images.length, "flagged image")} could be ${saved} smaller in all (${detail}):`, line(rows[0], " "));
    lines.push(...rows.slice(1, 1 + Math.min(images.length, ROWS)).map((cells) => line(cells)));
    if (images.length > ROWS) lines.push(`  …and ${count(images.length - ROWS, "more image")}, ${total(images.slice(ROWS)).saved} in all`);
  }
  if (unnamed.length) {
    const { saved } = total(unnamed);
    lines.push(`pngdeer: ${count(unnamed.length, "more image")} could be ${saved} smaller, but no linted code names ${unnamed.length === 1 ? "it" : "them"} (used from CSS or HTML, or not at all):`);
    if (!images.length) lines.push(line(rows[0], " "));
    lines.push(...rows.slice(1 + Math.min(images.length, ROWS)).map((cells) => line(cells)));
    if (unnamed.length > UNNAMED_ROWS) lines.push(`  …and ${count(unnamed.length - UNNAMED_ROWS, "more image")}`);
  }
  lines.push("pngdeer: quality is SSIMULACRA2, out of 100: 90+ looks identical, 80+ the same side by side, 70+ close, with differences you might spot side by side");
  if (images.length) {
    lines.push(`pngdeer: to shrink the ${images.length === 1 ? "flagged image" : `${images.length} flagged images`} in place (lossy, so commit first), run: npx oxlint-plugin-pngdeer --flagged`);
  }
  process.stderr.write(`${lines.join("\n")}\n`);
}

/**
 * Measured images in the linted projects that no linted code names, and that would clear the rule's
 * thresholds: [[path, entry]], biggest saving first. Reads only results already cached.
 */
function unnamedImages() {
  const found = [];
  for (const [root, options] of roots) {
    for (const file of projectImages(root, options.minSavedBytes)) {
      if (named.has(file) || flagged.has(file)) continue;
      let entry;
      try {
        entry = read(cacheDir(root), key(readFileSync(file), options.target));
      } catch {
        continue;
      }
      if (reportable(entry, options)) found.push([file, entry]);
    }
  }
  return found.sort(([, a], [, b]) => b.original - b.compressed - (a.original - a.compressed));
}

/** The linter's output format, from its command line: `-f x`, `--format x` or `--format=x`. */
function format() {
  const args = process.argv;
  const at = args.findIndex((arg) => arg === "-f" || arg === "--format");
  if (at >= 0) return args[at + 1];
  return args.find((arg) => arg.startsWith("--format="))?.slice("--format=".length);
}
