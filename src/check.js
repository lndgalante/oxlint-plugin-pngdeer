import { readFileSync, realpathSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fill } from "./batch.js";
import { cacheDir, key, read, readFirst, reportable, write } from "./cache.js";
import { unsupported } from "./images.js";
import { marked } from "./marker.js";
import { excluded, projectImages, projectRoot } from "./scan.js";
import { plain } from "./shrink.js";
import { count, pathFrom, size, smaller } from "./text.js";

/** Checks images without rewriting them: 0 clean, 1 savings found, 2 incomplete or failed. */
export async function check(inputs, { cwd = process.cwd(), target, minSavedBytes = 4096, minSavedPercent = 10, exclude = [], cacheDir: customCacheDir } = {}) {
  cwd = resolve(cwd);
  const errors = new Set();
  const error = (file, reason) => {
    if (errors.has(file)) return;
    errors.add(file);
    console.error(`${pathFrom(cwd, file) || "."}: ${plain(reason)}`);
  };
  const files = collect(inputs, cwd, exclude, error);
  const groups = new Map();
  let skipped = 0;
  let cached = 0;
  let measured = 0;
  let flagged = 0;
  let saved = 0;

  for (const { file, root } of files.values()) {
    try {
      const bytes = readFileSync(file);
      const why = unsupported(bytes);
      if (why) {
        error(file, why);
        continue;
      }
      if (marked(bytes) || bytes.length < minSavedBytes) {
        skipped++;
        continue;
      }
      const local = cacheDir(root);
      const dir = customCacheDir ? resolve(root, customCacheDir) : local;
      const k = key(bytes, target);
      const entry = readFirst(k, dir, local);
      if (entry) cached++;
      const group = groups.get(root) ?? { dir, local, images: [] };
      group.images.push({ file, k, original: bytes.length, entry });
      groups.set(root, group);
    } catch (cause) {
      error(file, cause);
    }
  }

  // Separate packages share neither their local failure cache nor their measuring lock.
  for (const { dir, local, images } of groups.values()) {
    const pending = images.filter((image) => !image.entry);
    let failure;
    if (pending.length) {
      console.error(`pngdeer: measuring ${count(pending.length, "image")} not in the cache yet...`);
      try {
        const result = await fill({ dir, failures: local, target, files: pending.map(({ file }) => file) });
        measured += result.computed;
        cached += result.cached;
      } catch (cause) {
        failure = cause;
      }
    }
    for (const image of images) {
      const { file, k, original } = image;
      try {
        // A file changed during measurement must not receive a stale clean result.
        if (key(readFileSync(file), target) !== k) {
          error(file, "changed while checking; run --check again");
          continue;
        }
        const entry = image.entry ?? readFirst(k, dir, local);
        if (!entry) {
          error(file, failure ?? "could not measure this image; run --check again");
          continue;
        }
        if (entry.skipped) {
          error(file, entry.skipped);
          continue;
        }
        if (!valid(entry, original)) {
          error(file, `invalid measurement in ${pathFrom(cwd, dir)}; remove that cache entry and run --check again`);
          continue;
        }
        // --cache-dir can prepare a committed cache from results already measured locally.
        if (dir !== local && !read(dir, k)) write(dir, k, entry);
        if (!reportable(entry, { minSavedBytes, minSavedPercent })) continue;
        flagged++;
        saved += entry.original - entry.compressed;
        const quality = entry.outcome === "hit" ? `quality ${Math.round(entry.score)}/100` : "lossless";
        console.log(`${pathFrom(cwd, file)}: could be ${smaller(entry.original, entry.compressed)}% smaller (${size(entry.original)} → ${size(entry.compressed)}, ${quality})`);
      } catch (cause) {
        error(file, cause);
      }
    }
  }

  console.log(`pngdeer: checked ${count(files.size, "image")}; ${measured} measured, ${cached} cached, ${skipped} skipped (already optimized or below ${size(minSavedBytes)}), ${count(errors.size, "error")}.`);
  if (flagged) console.log(`pngdeer: ${count(flagged, "image")} could save ${size(saved)}. Images unchanged.`);
  else if (errors.size) console.log("pngdeer: check incomplete. Images unchanged.");
  else console.log("pngdeer: no images exceed the savings thresholds. Images unchanged.");
  return errors.size ? 2 : flagged ? 1 : 0;
}

function collect(inputs, cwd, exclude, error) {
  const files = new Map();
  const add = (file, root) => {
    if (excluded(root, file, exclude)) return;
    try {
      const physical = realpathSync(file);
      if (!files.has(physical)) files.set(physical, { file, root });
    } catch (cause) {
      error(file, cause);
    }
  };
  for (const input of inputs) {
    const path = resolve(cwd, input);
    try {
      const stat = statSync(path);
      const root = projectRoot(stat.isDirectory() ? path : dirname(path), cwd);
      if (excluded(root, path, exclude)) continue;
      if (stat.isDirectory()) {
        for (const file of projectImages(path, 0, exclude, { base: root, onError: error }).sort()) add(file, root);
      } else if (stat.isFile()) add(path, root);
      else error(path, "not a regular file or directory");
    } catch (cause) {
      error(path, cause);
    }
  }
  return files;
}

function valid(entry, original) {
  if (entry.outcome === "output") return Number.isFinite(entry.original) && entry.original > 0;
  return ["hit", "miss", "exact", "lossless", "original"].includes(entry.outcome) &&
    entry.original === original && Number.isFinite(entry.compressed) && entry.compressed >= 0 &&
    Number.isFinite(entry.score);
}
