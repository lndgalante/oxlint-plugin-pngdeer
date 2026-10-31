// Results by content: pngdeer writes the same bytes for the same input everywhere, so an image's
// saving only changes when its bytes, the engine or the target do. One small JSON file per entry,
// so parallel lint threads and batch workers never write the same file twice over.
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { smaller } from "./text.js";

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

/** Whether an entry is a saving the rule reports: smaller at the target, by both thresholds. */
export function reportable(entry, { minSavedBytes, minSavedPercent }) {
  if (!entry || entry.skipped || !["hit", "exact", "lossless"].includes(entry.outcome)) return false;
  const saved = entry.original - entry.compressed;
  return saved >= minSavedBytes && smaller(entry.original, entry.compressed) >= minSavedPercent;
}

export function write(dir, k, entry) {
  mkdirSync(dir, { recursive: true });
  // written whole and renamed, so a reader never sees half an entry
  const tmp = join(dir, `${k}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`);
  writeFileSync(tmp, JSON.stringify(entry));
  renameSync(tmp, join(dir, `${k}.json`));
}
