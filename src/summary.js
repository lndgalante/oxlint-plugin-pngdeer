// What a lint flagged, in all: a table at the end of the run, biggest saving first, and the list that
// `npx oxlint-plugin-pngdeer --flagged` shrinks, so nobody copies paths from warnings one by one.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { cacheDir } from "./cache.js";
import { count, pathFrom, size, smaller } from "./text.js";

// Rows shown in the table; the rest are counted, and --flagged still takes them all.
const ROWS = 10;

const flagged = new Map(); // image path -> { original, compressed, target }

/** Notes an image a warning was reported for. */
export function flag(file, entry) {
  flagged.set(file, entry);
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
  // a clean run replaces an older list, but doesn't create one
  if (flagged.size === 0 && !existsSync(list)) return;
  const images = [...flagged].sort(([, a], [, b]) => b.original - b.compressed - (a.original - a.compressed));
  try {
    mkdirSync(dirname(list), { recursive: true });
    writeFileSync(list, JSON.stringify(images.map(([file, { target }]) => ({ file, target }))));
  } catch {
    // without the list, --flagged has nothing to read; the table still tells
  }
  if (images.length === 0) return;

  const rows = images.slice(0, ROWS).map(([file, { original, compressed }]) => [
    pathFrom(cwd, file),
    size(original),
    size(compressed),
    `${smaller(original, compressed)}%`,
  ]);
  const width = (column) => Math.max(...rows.map((row) => row[column].length));
  const original = images.reduce((sum, [, image]) => sum + image.original, 0);
  const compressed = images.reduce((sum, [, image]) => sum + image.compressed, 0);
  const lines = [
    `pngdeer: ${count(images.length, "image")} could be ${size(original - compressed)} smaller in all (${size(original)} → ${size(compressed)}, ${smaller(original, compressed)}%)`,
    ...rows.map(([path, before, after, percent]) =>
      `  ${path.padEnd(width(0))}  ${before.padStart(width(1))} → ${after.padStart(width(2))}  ${percent.padStart(width(3))}`,
    ),
    ...(images.length > ROWS ? [`  …and ${count(images.length - ROWS, "more image")}`] : []),
    `pngdeer: to shrink ${images.length === 1 ? "it" : "them all"}, run: npx oxlint-plugin-pngdeer --flagged`,
  ];
  process.stderr.write(`${lines.join("\n")}\n`);
}
