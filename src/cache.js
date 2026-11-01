// Results by content: pngdeer writes the same bytes for the same input everywhere, so an image's
// saving only changes when its bytes, the engine or the target do. One small JSON file per entry,
// so parallel lint threads and batch workers never write the same file twice over.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { marked } from "./marker.js";

const keys = new Map(); // image path -> file metadata and content key, so images aren't re-read on every keystroke

// The engine's identity: the first 16 hex digits of the wasm's SHA-256 (a few ms for 2 MB). A new
// engine invalidates every entry.
export const ENGINE = createHash("sha256")
  .update(readFileSync(new URL("../engine/pngdeer_wasm_bg.wasm", import.meta.url)))
  .digest("hex")
  .slice(0, 16);

export function cacheDir(cwd) {
  return join(cwd, "node_modules", ".cache", "pngdeer");
}

// What an entry holds: a new shape (2 added the score) measures everything again.
const FORMAT = 2;

/** The cache key of an image's bytes for a given target (undefined: automatic quality). */
export function key(bytes, target) {
  return createHash("sha256").update(bytes).update(`\0${ENGINE}\0${target ?? "auto"}\0${FORMAT}`).digest("hex");
}

/**
 * { original, compressed, outcome, score, ms }, compressed counting the mark the command adds;
 * { skipped } (with failed: true if pngdeer itself failed); { outcome: "output" } for bytes pngdeer
 * wrote; or null if not cached yet.
 */
export function read(dir, k) {
  try {
    return JSON.parse(readFileSync(join(dir, `${k}.json`), "utf8"));
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

/** Whether an entry is a saving the rule reports: smaller at the target, by both thresholds. */
export function reportable(entry, { minSavedBytes, minSavedPercent }) {
  if (!entry || entry.skipped || !["hit", "exact", "lossless"].includes(entry.outcome)) return false;
  const saved = entry.original - entry.compressed;
  return saved > 0 && saved >= minSavedBytes && (100 * saved) / entry.original >= minSavedPercent;
}

/** An image's size, the cache key of its current bytes and whether pngdeer wrote it; null if it can't be read. */
export function fileKey(file, target) {
  try {
    const { size, mtimeMs, ctimeMs, dev, ino } = statSync(file);
    const memo = keys.get(file);
    // Copy tools can preserve mtime; an atomic replacement can also keep the same size.
    if (memo && memo.size === size && memo.mtimeMs === mtimeMs && memo.ctimeMs === ctimeMs && memo.dev === dev && memo.ino === ino && memo.target === target) return memo;
    const bytes = readFileSync(file);
    const image = { size, mtimeMs, ctimeMs, dev, ino, target, key: key(bytes, target), marked: marked(bytes) };
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
