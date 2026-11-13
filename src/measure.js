// What --check and --review measure: every PNG and JPEG under the paths given, in every package
// there, with the lint's engine and cache on one pool, without changing an image; with a format, each
// one's WebP or AVIF copy too. check.js says what this finds.
import { readFileSync, realpathSync, statSync } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import { fillAll, fillConversions } from "./batch.js";
import { cacheDir, convertKey, floored, key, read, readFirst, reportable, valid, write } from "./cache.js";
import { oldCacheLines } from "./compat.js";
import { baseOf, equalTarget, FORMATS, leftOut, there } from "./convert.js";
import { copyOf } from "./copies.js";
import { kind, unsupported } from "./images.js";
import { marked } from "./marker.js";
import { convertLine, progressLine, startLine } from "./progress.js";
import { excluded, physical, projectImages, projectRoot } from "./scan.js";
import { plain } from "./shrink.js";
import { pathFrom, printable } from "./text.js";

// What this says of a Git LFS pointer.
export const LFS = "a Git LFS pointer, not the image itself";
// An image a failed cache folder kept from being measured: its message says why in full (for JSON,
// the job summary, the review page); the lines name the reason once, above.
const NOT_MEASURED = "not measured: ";
// Git LFS leaves a small text file like this in place of an image it hasn't fetched.
const POINTER = Buffer.from("version https://git-lfs.github.com/spec/");

/**
 * What a check finds under `inputs`, printing nothing on stdout: on stderr only the measuring count,
 * and why measuring failed, if it did.
 * Resolves { rows, declined, missed, errors, counts, builds }:
 * - rows: [{ file, path, root, target, original, compressed, outcome, score }], the images that clear
 *   both thresholds, smallest saving first; `path` is from `cwd`, `root` the image's project;
 * - declined: [{ file, path, original, score }], images the automatic target turned down, as nothing
 *   it found looks better than visibly different (engine.js), and that would otherwise be listed;
 * - missed: [{ file, path, original, score }], the other images for which no smaller file reaches the
 *   target (a target given, mostly), with the best score found;
 * - errors: [{ file, path, message }], what couldn't be checked, in the order found, each also given
 *   to `onError` then, if given;
 * - counts: { checked, measured, cached, skipped, packages };
 * - builds: [{ path, images }], Gatsby build folders left out, and how many images they hold.
 * An error that running it again may clear names `again`, the run to repeat (--review's, say).
 *
 * With `format` ("webp", "avif"), each image is then measured as that format at its equal target
 * (convert.js), the results kept in its project's local cache folder alone; with `previewDir` too (a
 * folder the caller made, not a link), each copy measured that reaches its target is also written
 * there, named by its cache key and the format's extension. Resolves { format, rows, notWorthIt,
 * leftOut, missed, declined, errors, counts, builds }, the last four as without `format`, except that
 * an image whose copy this run measured counts as measured:
 * - rows: [{ file, path, root, type, target, equal, original, compressed, score, sameFormat, base,
 *   output, outputExists, preview }], the copies smaller than their base by both thresholds, the
 *   smallest saving beyond it first. `type` is the image's own ("png", "jpeg"), `target` the one
 *   given, `equal` the copy's (equalTarget()), `compressed` and `score` the copy's, `sameFormat`
 *   { compressed, outcome, score } the image's own shrink, mark included, `base` what the image weighs
 *   shrunk in place (that shrink's size when it's smaller, else its own), `output` the sibling's full
 *   path, `outputExists` whether anything is there, `preview` its path in previewDir, else null (one
 *   read from the cache may not be there);
 * - notWorthIt: [{ file, path, root, type, original, compressed, score, sameFormat, base }], the other
 *   copies that reach their target;
 * - leftOut: [{ file, path, kind, reason }], images not measured as `format`, as leftOut() says (the
 *   command's own output only when big enough to list), or turned down by the engine in its own words
 *   (kind "refused");
 * - missed: [{ file, path, type, original, score, equal }], images for which no copy reaches `equal`,
 *   with the best score found.
 * slimdeer's own output without the mark (cache.js "output") is in none of them, as without `format`.
 */
export async function measureAll(inputs, { cwd = process.cwd(), target, minSavedBytes = 4096, minSavedPercent = 10, exclude = [], cacheDir: customCacheDir, onError, again = "--check", format, previewDir } = {}) {
  cwd = resolve(cwd);
  const errors = [];
  const failed = new Set();
  const error = (file, reason) => {
    if (failed.has(file)) return;
    failed.add(file);
    const item = { file, path: pathFrom(cwd, file) || ".", message: plain(reason) };
    errors.push(item);
    // before the measuring count starts, or after it's cleared: never on its line
    onError?.(item);
  };
  const { files, builds } = collect(inputs, cwd, exclude, error);
  const counts = { checked: files.size, measured: 0, cached: 0, skipped: 0, packages: new Set([...files.values()].map(({ root }) => root)).size };
  const cached = new Set(); // the images counted as cached
  const groups = new Map(); // project root -> its cache folders and its images
  const left = []; // with `format`, the images not measured as that format, and why

  for (const { file, root } of files.values()) {
    try {
      const bytes = readFileSync(file);
      // an image too small to save minSavedBytes, or already shrunk by the command, needs nothing more,
      // whatever slimdeer would make of it; a file that isn't a PNG or JPEG is an error at any size
      if (kind(bytes) && (marked(bytes) || bytes.length < minSavedBytes)) {
        counts.skipped++;
        // converting the command's output would be a second lossy pass; an image too small goes unlisted anyway
        if (format && marked(bytes) && bytes.length >= minSavedBytes) left.push({ file, path: pathFrom(cwd, file), ...leftOut(bytes, file, format, root) });
        continue;
      }
      const why = pointer(bytes) ? LFS : unsupported(bytes);
      if (why) {
        error(file, why);
        continue;
      }
      const local = cacheDir(root);
      const dir = customCacheDir ? resolve(root, customCacheDir) : local;
      const k = key(bytes, target);
      const entry = readFirst(k, dir, local);
      // a failure kept from an earlier run counts as the error it is, not also as cached
      if (entry && !entry.skipped) {
        counts.cached++;
        cached.add(file);
      }
      const group = groups.get(root) ?? { dir, local, images: [] };
      group.images.push({ file, k, original: bytes.length, entry });
      groups.set(root, group);
    } catch (cause) {
      error(file, cause);
    }
  }
  await measure(groups, { target, format, minSavedBytes, minSavedPercent }, counts, cached);

  const rows = [];
  const declined = [];
  const missed = [];
  const copies = []; // with `format`, the images to measure as that format
  for (const [root, { dir, local, images, failure }] of groups) {
    for (const image of images) {
      const { file, k, original } = image;
      try {
        const bytes = readFileSync(file);
        // A file changed during measurement must not receive a stale clean result.
        if (key(bytes, target) !== k) {
          error(file, `changed while checking; run ${again} again`);
          continue;
        }
        const entry = image.entry ?? readFirst(k, dir, local);
        if (!entry) {
          error(file, failure ? `${NOT_MEASURED}${failure.message ?? failure}` : `could not measure this image; run ${again} again`);
          continue;
        }
        if (entry.skipped) {
          error(file, entry.skipped);
          continue;
        }
        if (!valid(entry, original)) {
          error(file, `invalid measurement in ${pathFrom(cwd, dir)}; remove that cache entry and run ${again} again`);
          continue;
        }
        // --cache-dir can prepare a committed cache from results already measured locally.
        if (dir !== local && !read(dir, k)) write(dir, k, entry);
        const path = pathFrom(cwd, file);
        if (format) {
          // slimdeer's own output, which the lint takes as done, as without a format: it has no
          // shrink to match, and converting it would be a second lossy pass
          if (entry.outcome === "output") continue;
          // before any conversion: one turned by eXIf would be measured unturned (engine.js)
          const why = leftOut(bytes, file, format, root);
          if (why) left.push({ file, path, ...why });
          else if (floored(entry, target, { minSavedBytes, minSavedPercent })) declined.push({ file, path, original, score: entry.score });
          else {
            // none for a miss at the automatic target: nothing reached the floor, so there is no quality to match
            const equal = equalTarget(target, entry);
            const sameFormat = { compressed: entry.compressed, outcome: entry.outcome, score: entry.score };
            if (equal !== null) copies.push({ file, path, root, local, type: kind(bytes), original, equal, k: convertKey(bytes, equal, format), sameFormat });
          }
          continue;
        }
        if (floored(entry, target)) {
          // named when the floor alone keeps it off the list, as the lint counts them (cache.js); one
          // whose best would save too little goes unlisted at any target
          if (floored(entry, target, { minSavedBytes, minSavedPercent })) declined.push({ file, path, original, score: entry.score });
        } else if (entry.outcome === "miss") {
          // it would go unlisted without a word, as one the floor's line sent to a lower target can
          missed.push({ file, path, original, score: entry.score });
        }
        if (!reportable(entry, { minSavedBytes, minSavedPercent })) continue;
        rows.push({ file, path, root, target, original: entry.original, compressed: entry.compressed, outcome: entry.outcome, score: entry.score });
      } catch (cause) {
        error(file, cause);
      }
    }
  }
  // smallest saving first, so the biggest end up next to the totals, where a long output ends
  rows.sort((a, b) => a.original - a.compressed - (b.original - b.compressed));
  if (!format) return { rows, declined, missed, errors, counts, builds };
  const found = await measureCopies(copies, { format, target, minSavedBytes, minSavedPercent, previewDir, again }, error);
  // an image counts as measured when this run measured its own result or its copy; a copy another
  // run measured while this one waited for the lock is read from the cache, so it counts as cached,
  // as an image's own result does then
  for (const file of found.measured) {
    if (!cached.delete(file)) continue;
    counts.cached--;
    counts.measured++;
  }
  return { format, rows: found.rows, notWorthIt: found.notWorthIt, leftOut: [...left, ...found.refused], missed: found.missed, declined, errors, counts, builds };
}

/**
 * Measures what the cache lacks, every project's images on one pool (one count, no engine idle while
 * another project's last image finishes), each in its own project's cache folders under its own lock.
 * Notes on each group why it couldn't be measured, if so. With `format`, adds to `cached` the images
 * the batch counted as cached.
 */
async function measure(groups, { target, format, minSavedBytes, minSavedPercent }, counts, cached) {
  const requests = new Map(); // request -> its group: fillAll() names a request it left out
  for (const group of groups.values()) {
    const pending = group.images.filter((image) => !image.entry);
    if (pending.length) requests.set({ dir: group.dir, failures: group.local, target, files: pending.map(({ file }) => file), minSavedBytes, minSavedPercent }, group);
  }
  if (requests.size === 0) return;
  // the batch says it once it holds the locks, counting copies of one image once and leaving out what
  // another lint measured meanwhile (a closed stderr loses the line, nothing else: progress.js), after
  // any old cache folder beside the ones the results go into (compat.js)
  const count = progressLine();
  // with a format, the images the batch measured, or found measured on their turn
  const finished = new Set();
  // with a format, the check is after what the copies save, not what shrinking in place would: the
  // count leaves that out
  const progress = format
    ? (done, total, { file }) => {
        finished.add(file);
        count(done, total);
      }
    : count;
  const result = await batch(requests, fillAll, (total, folders) => {
    oldCacheLines(folders, process.cwd());
    startLine(total);
  }, progress);
  counts.measured += result?.computed ?? 0;
  counts.cached += result?.cached ?? 0;
  if (!format || !result) return;
  // the batch counts the others as cached: measured by another run while this one waited for the
  // lock, carried over from 0.5.0, or copies of one image
  for (const [request] of requests) {
    if (result.errors.has(request)) continue;
    for (const file of request.files) if (!finished.has(file)) cached.add(file);
  }
}

/**
 * measureAll()'s second part, with `format`: measures each of `copies` as that format at its equal
 * target, what the local cache folders lack on one pool and one count, then sorts them into
 * { rows, notWorthIt, refused, missed }, as measureAll() resolves them, `refused` for its leftOut, and
 * `measured`, the images whose copy this run measured. A committed cache folder never gets these: the
 * lint doesn't read them.
 */
async function measureCopies(copies, { format, target, minSavedBytes, minSavedPercent, previewDir, again }, error) {
  const { name, extension } = FORMATS[format];
  const preview = ({ k }) => (previewDir === undefined ? undefined : join(previewDir, `${k}${extension}`));
  const requests = new Map(); // local cache folder -> its request, which notes why it failed, if it does
  for (const copy of copies) {
    copy.entry = read(copy.local, copy.k);
    if (copy.entry) continue;
    const request = requests.get(copy.local) ?? { failures: copy.local, format, jobs: [] };
    request.jobs.push({ file: copy.file, target: copy.equal, out: preview(copy) });
    requests.set(copy.local, request);
  }
  const measured = new Set();
  if (requests.size) {
    const count = progressLine(name);
    await batch(new Map([...requests.values()].map((request) => [request, request])), fillConversions, (total) => convertLine(total, name), (done, total, info) => {
      measured.add(info.file);
      count(done, total, info);
    });
  }

  const rows = [];
  const notWorthIt = [];
  const refused = [];
  const missed = [];
  for (const copy of copies) {
    const { file, path, root, local, type, original, equal, k, sameFormat } = copy;
    try {
      const entry = copy.entry ?? read(local, k);
      if (!entry) {
        const { failure } = requests.get(local);
        error(file, convertKey(readFileSync(file), equal, format) !== k ? `changed while checking; run ${again} again` : failure ? `${NOT_MEASURED}${failure.message ?? failure}` : `could not measure this image; run ${again} again`);
        continue;
      }
      if (entry.failed) error(file, entry.skipped);
      else if (entry.skipped) refused.push({ file, path, kind: "refused", reason: entry.skipped });
      else if (entry.outcome === "miss") missed.push({ file, path, type, original, score: entry.score, equal });
      else {
        const base = baseOf(sameFormat, original);
        const { compressed, score } = entry;
        if (reportable({ original: base, compressed, outcome: "hit" }, { minSavedBytes, minSavedPercent })) {
          // named after the image as its folder lists it, as --format names it (copies.js)
          const output = copyOf(file, format);
          rows.push({ file, path, root, type, target, equal, original, compressed, score, sameFormat, base, output, outputExists: there(output), preview: preview(copy) ?? null });
        } else notWorthIt.push({ file, path, root, type, original, compressed, score, sameFormat, base });
      }
    } catch (cause) {
      error(file, cause);
    }
  }
  // the smallest saving beyond the shrink first, so the biggest end up next to the totals
  rows.sort((a, b) => a.base - a.compressed - (b.base - b.compressed));
  return { rows, notWorthIt, refused, missed, measured };
}

/**
 * Runs `fill` (batch.js fillAll() or fillConversions()) on the requests `requests` maps, each to what
 * notes why it failed, if it does, with the measuring count (`progress`, progress.js progressLine())
 * on stderr after `onStart`'s line. Says each reason once. Resolves the batch's result, or null if it
 * rejected.
 */
async function batch(requests, fill, onStart, progress) {
  let started = false;
  let result = null;
  try {
    result = await fill([...requests.keys()], progress, (...args) => {
      started = true;
      onStart(...args);
    });
    for (const [request, cause] of result.errors) requests.get(request).failure = cause;
  } catch (cause) {
    // an engine died, or a cache folder failed once measuring had begun
    for (const holder of requests.values()) holder.failure = cause;
  }
  // on a terminal the count rewrites one line: clear it
  if (started && process.stderr.isTTY) process.stderr.write("\r\x1b[K");
  // once each and in full: a cache folder it can't write fails every image there, and only this names the folder
  const reasons = new Set([...requests.values()].filter(({ failure }) => failure).map(({ failure }) => failure.message ?? String(failure)));
  for (const reason of reasons) console.error(printable(`slimdeer: measuring failed: ${reason}`));
  return result;
}

/**
 * The images to check, by their physical path, each with its project's root (a folder with its own
 * package.json is a project of its own, with its own cache, as in the lint), and the images in
 * Gatsby build folders the walks left out.
 */
function collect(inputs, cwd, exclude, error) {
  const files = new Map();
  const built = new Map(); // physical path -> the Gatsby build folder it's in
  const add = (file, walked) => {
    try {
      // as the file system spells it, so logo.png and LOGO.png are one image on macOS and Windows, as
      // the command takes them (bin/slimdeer.js); realpathSync, unlike physical(), fails on a missing
      // file or a broken link
      const path = physical(realpathSync(file));
      if (files.has(path)) return;
      const root = projectRoot(dirname(file), cwd);
      // Gatsby builds into public/ copies of static/ and the images it makes, which the next build
      // overwrites, as the rule knows (rule.js): left out unless named, or a folder in it is
      const build = join(root, "public");
      if (walked && within(file, build) && !within(walked, build) && gatsby(root)) built.set(path, build);
      else files.set(path, { file, root });
    } catch (cause) {
      error(file, cause);
    }
  };
  for (const input of inputs) {
    const path = resolve(cwd, input);
    try {
      const stat = statSync(path);
      const root = projectRoot(stat.isDirectory() ? path : dirname(path), cwd);
      if (off(exclude, path, root, cwd)) continue;
      if (stat.isDirectory()) {
        const options = { base: root, top: cwd, nested: true, onError: error };
        for (const file of projectImages(path, 0, exclude, options).sort()) add(file, path);
      } else if (stat.isFile()) add(path);
      else error(path, "not a regular file or directory");
    } catch (cause) {
      error(path, cause);
    }
  }
  const builds = new Map(); // folder -> how many images were left out there
  for (const [path, build] of built) {
    if (!files.has(path)) builds.set(build, (builds.get(build) ?? 0) + 1);
  }
  return { files, builds: [...builds].map(([folder, images]) => ({ path: pathFrom(cwd, folder) || ".", images })) };
}

/**
 * Whether --exclude leaves a named path out: matched from its project's root, as the rule's option
 * is, or from the folder the check runs in, as it was typed; as spelled or as it is on disk, as the
 * rule does (a link, another letter case).
 */
function off(exclude, path, root, cwd) {
  if (exclude.length === 0) return false;
  const real = physical(path);
  return [root, cwd].some((anchor) => excluded(anchor, path, exclude) || excluded(physical(anchor), real, exclude));
}

function within(path, folder) {
  return path === folder || path.startsWith(`${folder}${sep}`);
}

const gatsbys = new Map(); // project root -> whether its package.json depends on gatsby

function gatsby(root) {
  if (!gatsbys.has(root)) {
    try {
      const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
      gatsbys.set(root, Boolean(manifest.dependencies?.gatsby ?? manifest.devDependencies?.gatsby));
    } catch {
      gatsbys.set(root, false);
    }
  }
  return gatsbys.get(root);
}

function pointer(bytes) {
  return bytes.length < 1024 && bytes.subarray(0, POINTER.length).equals(POINTER);
}

/** An error as the lines show it: a cache folder's reason once, on its "measuring failed" line. */
export function shortened(message) {
  return message.startsWith(NOT_MEASURED) ? "not measured (see above)" : message;
}
