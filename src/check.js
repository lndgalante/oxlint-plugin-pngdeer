import { readFileSync, realpathSync, statSync } from "node:fs";
import { basename, dirname, extname, resolve, sep } from "node:path";
import { fill } from "./batch.js";
import { cacheDir, key, read, readFirst, reportable, write } from "./cache.js";
import { kind, unsupported } from "./images.js";
import { marked } from "./marker.js";
import { progressLine } from "./progress.js";
import { excluded, projectImages, projectRoot } from "./scan.js";
import { plain } from "./shrink.js";
import { checkCommand, count, looks, pathFrom, quote, shrinkCommand, size, smaller } from "./text.js";

/** Checks images without rewriting them: 0 clean, 1 savings found, 2 incomplete or failed. */
export async function check(inputs, { cwd = process.cwd(), target, minSavedBytes = 4096, minSavedPercent = 10, exclude = [], cacheDir: customCacheDir } = {}) {
  cwd = resolve(cwd);
  const errors = new Set();
  const error = (file, reason) => {
    if (errors.has(file)) return;
    errors.add(file);
    console.error(`${pathFrom(cwd, file) || "."}: ${plain(reason)}`);
  };
  const { files, packages } = collect(inputs, cwd, exclude, error);
  const groups = new Map();
  const rows = [];
  let skipped = 0;
  let cached = 0;
  let measured = 0;

  for (const { file, root } of files.values()) {
    try {
      const bytes = readFileSync(file);
      // an image too small to save minSavedBytes, or already pngdeer's, needs nothing more, whatever
      // pngdeer would make of it; a file that isn't a PNG or JPEG (a Git LFS pointer) is an error at any size
      if (kind(bytes) && (marked(bytes) || bytes.length < minSavedBytes)) {
        skipped++;
        continue;
      }
      const why = unsupported(bytes);
      if (why) {
        error(file, why);
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
      // the batch says it once it holds the lock, counting copies of one image once and leaving out
      // what another lint measured meanwhile
      const onStart = (n) => console.error(`pngdeer: measuring ${count(n, "image")} not in the cache yet...`);
      try {
        const result = await fill({ dir, failures: local, target, files: pending.map(({ file }) => file) }, progressLine(), onStart);
        measured += result.computed;
        cached += result.cached;
      } catch (cause) {
        failure = cause;
      }
      // on a terminal the count rewrites one line: clear it
      if (process.stderr.isTTY) process.stderr.write("\r\x1b[K");
      // once and in full: a cache folder it can't write fails every image, and only this message names the folder
      if (failure) console.error(`pngdeer: measuring failed: ${failure.message ?? failure}`);
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
          error(file, failure ? "not measured (see above)" : "could not measure this image; run --check again");
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
        const quality = entry.outcome === "hit" ? `quality ${Math.round(entry.score)}/100: looks ${looks(entry.score)}` : "lossless: looks identical";
        const path = pathFrom(cwd, file);
        rows.push({ path, original: entry.original, compressed: entry.compressed, text: `${path}: could be ${smaller(entry.original, entry.compressed)}% smaller (${size(entry.original)} → ${size(entry.compressed)}, ${quality})` });
      } catch (cause) {
        error(file, cause);
      }
    }
  }

  // smallest saving first, so the biggest end up next to the totals, where a long output ends
  rows.sort((a, b) => a.original - a.compressed - (b.original - b.compressed));
  for (const { text } of rows) console.log(text);
  console.log(`pngdeer: checked ${count(files.size, "image")}; ${measured} measured, ${cached} cached, ${skipped} skipped (already optimized or below ${size(minSavedBytes)}), ${count(errors.size, "error")}.`);
  if (packages.length) {
    const command = checkCommand(packages, { target, exclude, cacheDir: customCacheDir, minSavedBytes, minSavedPercent });
    console.error(`pngdeer: skipped ${count(packages.length, "nested package")} (a folder with its own package.json is checked only when named); to check ${packages.length === 1 ? "it" : "them"}, run${command.shell}: ${command.text}`);
  }
  // only nested packages: the check covered none of the project
  const uncovered = files.size === 0 && packages.length > 0;
  if (rows.length) {
    const before = rows.reduce((sum, row) => sum + row.original, 0);
    const after = rows.reduce((sum, row) => sum + row.compressed, 0);
    console.log(`pngdeer: ${count(rows.length, "image")} could be ${size(before - after)} smaller (${size(before)} → ${size(after)}, ${smaller(before, after)}% smaller). Images unchanged.`);
    const biggest = rows.slice(-10).reverse().map(({ path }) => path);
    const extension = extname(biggest[0]);
    const preview = shrinkCommand([biggest[0]], target);
    console.log(`pngdeer: to preview ${rows.length === 1 ? "it" : "the biggest saving"} as a new file, run${preview.shell}: ${preview.text} -o ${quote(`${basename(biggest[0], extension)}.preview${extension}`)}`);
    const shrink = shrinkCommand(biggest, target);
    const which = rows.length > 10 ? `the 10 biggest of ${rows.length}` : rows.length === 1 ? "it" : "them";
    console.log(`pngdeer: to shrink ${which} in place (lossy, so commit first), run${shrink.shell}: ${shrink.text}`);
  } else if (errors.size) console.log("pngdeer: check incomplete. Images unchanged.");
  else if (uncovered) console.log("pngdeer: check incomplete: found no PNG or JPEG images outside the nested packages.");
  else if (files.size === 0) console.log("pngdeer: found no PNG or JPEG images to check.");
  else console.log("pngdeer: no images exceed the savings thresholds. Images unchanged.");
  return errors.size || uncovered ? 2 : rows.length ? 1 : 0;
}

/** The images to check, and the nested packages its folder walks left out, as paths from `cwd`. */
function collect(inputs, cwd, exclude, error) {
  const files = new Map();
  const packages = new Set();
  const add = (file, root) => {
    if (excluded(root, file, exclude)) return;
    try {
      const physical = realpathSync(file);
      if (!files.has(physical)) files.set(physical, { file, root });
    } catch (cause) {
      error(file, cause);
    }
  };
  const paths = inputs.map((input) => resolve(cwd, input));
  for (const path of paths) {
    try {
      const stat = statSync(path);
      const root = projectRoot(stat.isDirectory() ? path : dirname(path), cwd);
      if (excluded(root, path, exclude)) continue;
      if (stat.isDirectory()) {
        const options = { base: root, onError: error, onPackage: (dir) => packages.add(dir) };
        for (const file of projectImages(path, 0, exclude, options).sort()) add(file, root);
      } else if (stat.isFile()) add(path, root);
      else error(path, "not a regular file or directory");
    } catch (cause) {
      error(path, cause);
    }
  }
  // a package named too, or something in it, was checked
  const named = (dir) => paths.some((path) => path === dir || path.startsWith(`${dir}${sep}`));
  return { files, packages: [...packages].filter((dir) => !named(dir)).map((dir) => pathFrom(cwd, dir) || ".").sort() };
}

function valid(entry, original) {
  if (entry.outcome === "output") return Number.isFinite(entry.original) && entry.original > 0;
  return ["hit", "miss", "exact", "lossless", "original"].includes(entry.outcome) &&
    entry.original === original && Number.isFinite(entry.compressed) && entry.compressed >= 0 &&
    Number.isFinite(entry.score);
}
