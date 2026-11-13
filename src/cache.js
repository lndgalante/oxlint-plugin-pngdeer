// Results by content: slimdeer writes the same bytes for the same input everywhere, so an image's
// saving only changes when its bytes, the engine or the target do. One small JSON file per entry,
// so parallel lint threads and batch workers never write the same file twice over.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { dimensions, kind } from "./images.js";
import { marked } from "./marker.js";

const keys = new Map(); // image path -> file metadata and content key, so images aren't re-read on every keystroke

// Which engine output the entries describe: the first 16 hex digits of the SHA-256 of the build whose
// PNG and JPEG bytes they were measured from. 0.1.0 to 0.5.0 shipped that build; 0.6.0's engine
// (slimdeer 0.3.1) writes the same PNG and JPEG bytes, so those results carry over. Conversions
// (convertKey) name it too. An engine that writes any other PNG, JPEG, WebP or AVIF file needs the
// new wasm's first 16 hex digits here and in engine/provenance.json, and every image is then measured
// again: test/engine-output.test.js checks a sample, and engine/README.md says how to compare more.
export const ENGINE = "ad2351d25459d45c";

export function cacheDir(cwd) {
  return join(cwd, "node_modules", ".cache", "slimdeer");
}

// What an entry holds: a change measures everything again. 2 added the score; 3 skips grayscale
// PNGs with a color profile, and counts the eXIf a turned PNG now keeps.
const FORMAT = 3;

// The lowest quality the automatic target settles for: below it the warning would say "visibly
// different" (looks() in text.js), so engine.js compresses such an image again at FLOOR. The
// automatic target's key names it, so changing it measures those results again.
export const FLOOR = 70;

/** The cache key of an image's bytes for a given target (undefined: automatic quality, at least FLOOR). */
export function key(bytes, target) {
  return hash(bytes, target ?? `auto${FLOOR}`);
}

/** The key 0.5.0 gave an image's bytes at the automatic target, before FLOOR: batch.js carries over what FLOOR doesn't change. */
export function legacyKey(bytes) {
  return hash(bytes, "auto");
}

/** The cache key of an image's bytes as WebP or AVIF (`format`) at `target`, a resolved score. */
export function convertKey(bytes, target, format) {
  return createHash("sha256").update(bytes).update(`\0${ENGINE}\0${target}\0${FORMAT}\0${format}`).digest("hex");
}

function hash(bytes, target) {
  return createHash("sha256").update(bytes).update(`\0${ENGINE}\0${target}\0${FORMAT}`).digest("hex");
}

/** Whether a result is a saving that would look visibly different: under FLOOR as people see the score, rounded. */
export function belowFloor({ outcome, score }) {
  return outcome === "hit" && Math.round(score) < FLOOR;
}

/**
 * { original, compressed, outcome, score }, compressed counting the mark the command adds;
 * { skipped } (with failed: true if slimdeer itself failed); { outcome: "output" } for bytes the
 * command writes; or null if not cached yet.
 */
export function read(dir, k) {
  try {
    const entry = JSON.parse(readFileSync(join(dir, `${k}.json`), "utf8"));
    // 0.5.0 also kept how long measuring took, which differs on every machine: without it, an entry
    // copied into a committed cache folder (rule.js, measure.js) is the same file wherever it's made
    delete entry.ms;
    return entry;
  } catch {
    return null;
  }
}

/** The entry for `k` in the first of `dirs` that has one, or null. */
export function readFirst(k, ...dirs) {
  for (const dir of new Set(dirs)) {
    const entry = read(dir, k);
    if (entry) return entry;
  }
  return null;
}

/** Whether `entry` is a measurement as write() stores one, of an image of `original` bytes: one edited by hand may not be. */
export function valid(entry, original) {
  if (entry.outcome === "output") return Number.isFinite(entry.original) && entry.original > 0;
  return ["hit", "miss", "exact", "lossless", "original"].includes(entry.outcome) && entry.original === original && Number.isFinite(entry.compressed) && entry.compressed >= 0 && Number.isFinite(entry.score);
}

/**
 * Whether the quality floor turned an image down at the automatic target (engine.js): the best it
 * found looks visibly different. With `thresholds`, only one whose best would otherwise be reported,
 * the floor alone keeping it from a warning: what --check names, and the lint counts as it measures.
 */
export function floored(entry, target, thresholds) {
  if (target !== undefined || entry?.outcome !== "miss" || Math.round(entry.score) >= FLOOR) return false;
  return !thresholds || reportable({ ...entry, outcome: "hit" }, thresholds);
}

/** Whether an entry is a saving the rule reports: smaller at the target, by both thresholds. */
export function reportable(entry, { minSavedBytes, minSavedPercent }) {
  if (!entry || entry.skipped || !["hit", "exact", "lossless"].includes(entry.outcome)) return false;
  const saved = entry.original - entry.compressed;
  return saved > 0 && saved >= minSavedBytes && (100 * saved) / entry.original >= minSavedPercent;
}

/** An image's size, the cache key of its current bytes, whether the command wrote it and its frame count; null if it can't be read. */
export function fileKey(file, target) {
  try {
    const { size, mtimeMs, ctimeMs, dev, ino } = statSync(file);
    const memo = keys.get(file);
    // Copy tools can preserve mtime; an atomic replacement can also keep the same size.
    if (memo && memo.size === size && memo.mtimeMs === mtimeMs && memo.ctimeMs === ctimeMs && memo.dev === dev && memo.ino === ino && memo.target === target) return memo;
    const bytes = readFileSync(file);
    const frames = kind(bytes) === "png" ? dimensions(bytes, "png")[2] : 1;
    const image = { size, mtimeMs, ctimeMs, dev, ino, target, key: key(bytes, target), marked: marked(bytes), frames };
    keys.set(file, image);
    return image;
  } catch {
    return null;
  }
}

export function write(dir, k, entry) {
  mkdirSync(dir, { recursive: true });
  // written whole and renamed, so a reader never sees half an entry; formatted the way Prettier
  // would, so a committed cache folder passes `prettier --check`
  const path = join(dir, `${k}.json`);
  const tmp = join(dir, `${k}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`);
  writeFileSync(tmp, `${JSON.stringify(entry, null, 2)}\n`);
  try {
    renameSync(tmp, path);
  } catch (error) {
    // Windows won't replace a file another writer is replacing at that moment (packages sharing a
    // cache folder, say); an entry is named by its content, so that writer's is as good
    rmSync(tmp, { force: true });
    if (!existsSync(path)) throw error;
  }
}
