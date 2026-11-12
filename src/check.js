// --check: every PNG and JPEG under the paths given, in every package there, measured with the lint's
// engine and cache on one pool, without changing an image. The review page (review.js) measures the
// same way.
import { readFileSync, realpathSync, statSync } from "node:fs";
import { basename, dirname, extname, join, resolve, sep } from "node:path";
import { fillAll } from "./batch.js";
import { cacheDir, FLOOR, floored, key, read, readFirst, reportable, valid, write } from "./cache.js";
import { kind, unsupported } from "./images.js";
import { appendJobSummary, block, capital, code, inCheckout, prose, table } from "./markdown.js";
import { marked } from "./marker.js";
import { progressLine, startLine } from "./progress.js";
import { excluded, physical, projectImages, projectRoot } from "./scan.js";
import { plain } from "./shrink.js";
import { checkCommand, count, LEGEND, looks, pathFrom, printable, quote, reviewCommand, shrinkCommand, size, smaller } from "./text.js";

// A target below FLOOR, to try the images the automatic target turned down at. It may list them, but
// the engine searches anew at each target, so a check at it says which it still can't. The review
// page offers the same command.
export const LOWER = 60;
// The commands take this many images, the biggest.
export const COMMAND_ROWS = 10;
// The job summary has room for the rows a reader would scroll through; the step's log has the rest.
const REPORT_ROWS = 200;
const REPORT_ERRORS = 10;
// What images.js says of a file that isn't a PNG or JPEG, and what this says of a Git LFS pointer.
const NOT_IMAGE = "not a PNG or JPEG";
const LFS = "a Git LFS pointer, not the image itself";
// How the other reasons images.js's unsupported() gives start: a file a check finds again each time.
const REFUSED = [NOT_IMAGE, "unreadable header", "a grayscale PNG", "too large", "animation too large"];
// An image a failed cache folder kept from being measured: its message says why in full (for JSON,
// the job summary, the review page); the lines name the reason once, above.
const NOT_MEASURED = "not measured: ";
// Git LFS leaves a small text file like this in place of an image it hasn't fetched.
const POINTER = Buffer.from("version https://git-lfs.github.com/spec/");

/**
 * Checks images without rewriting them: 0 clean, 1 savings found, 2 incomplete or failed. The lines
 * go to stdout, or with `json`, one JSON document; in GitHub Actions, a job summary too.
 */
export async function check(inputs, options = {}) {
  // each as it's found: a mistyped path shouldn't wait for minutes of measuring
  const onError = ({ path, message }) => console.error(printable(`${path}: ${shortened(message)}`));
  return print(inputs, await measureAll(inputs, { ...settingsOf(options), onError }), options);
}

/**
 * Says what measureAll() found under `inputs`, as --check does: lines, or with `json` one JSON
 * document; in GitHub Actions a job summary too, unless `summary` is false. Prints no error: the
 * caller has. Returns the check's exit code.
 */
export function print(inputs, result, options = {}) {
  const settings = settingsOf(options);
  if (options.json) console.log(JSON.stringify(report(result, settings)));
  else {
    const says = tell(inputs, result, settings);
    for (const line of says.lines) console.log(printable(line));
    // GitHub Actions names a file for each step's job summary: --check makes no annotations, and the
    // lines above are deep in the step's log
    const summary = process.env.GITHUB_STEP_SUMMARY;
    if (options.summary !== false && summary && (result.rows.length || result.declined.length || result.missed.length || result.errors.length)) {
      try {
        // the reader's machine has none of the node and slimdeer.js a Windows runner's PowerShell form
        // names: npx, quoted for a POSIX shell, as in the lint's job summary (summary.js)
        appendJobSummary(summary, markdown(result, settings, tell(inputs, result, settings, checkCommand, "linux")));
      } catch {
        // the lines above still tell, and the exit code stays the check's
      }
    }
  }
  return result.errors.length ? 2 : result.rows.length ? 1 : 0;
}

/**
 * The notes --check prints about what it doesn't list, as lines: Gatsby build folders left out, Git
 * LFS pointers, files slimdeer can't take, images the quality floor turned down, images that missed
 * the target. Each may end with the command to run next; `rerun` (text.js) writes the one that runs
 * this again with other paths or exclusions, as --review gives it for a review.
 */
export function notes(inputs, result, settings = {}, rerun = checkCommand) {
  const says = tell(inputs, result, settingsOf(settings), rerun);
  return [...says.notes, says.declined, says.missed].filter(Boolean).map(({ line }) => line);
}

/** An error as the lines show it: a cache folder's reason once, on its "measuring failed" line. */
export function shortened(message) {
  return message.startsWith(NOT_MEASURED) ? "not measured (see above)" : message;
}

/** A check's options, with the defaults filled in and the folder it runs in as a full path. */
function settingsOf({ cwd, target, minSavedBytes = 4096, minSavedPercent = 10, exclude = [], cacheDir } = {}) {
  return { cwd: resolve(cwd ?? process.cwd()), target, minSavedBytes, minSavedPercent, exclude, cacheDir };
}

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
 */
export async function measureAll(inputs, { cwd = process.cwd(), target, minSavedBytes = 4096, minSavedPercent = 10, exclude = [], cacheDir: customCacheDir, onError, again = "--check" } = {}) {
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
  const groups = new Map(); // project root -> its cache folders and its images

  for (const { file, root } of files.values()) {
    try {
      const bytes = readFileSync(file);
      // an image too small to save minSavedBytes, or already shrunk by the command, needs nothing more,
      // whatever slimdeer would make of it; a file that isn't a PNG or JPEG is an error at any size
      if (kind(bytes) && (marked(bytes) || bytes.length < minSavedBytes)) {
        counts.skipped++;
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
      if (entry && !entry.skipped) counts.cached++;
      const group = groups.get(root) ?? { dir, local, images: [] };
      group.images.push({ file, k, original: bytes.length, entry });
      groups.set(root, group);
    } catch (cause) {
      error(file, cause);
    }
  }
  await measure(groups, { target, minSavedBytes, minSavedPercent }, counts);

  const rows = [];
  const declined = [];
  const missed = [];
  for (const [root, { dir, local, images, failure }] of groups) {
    for (const image of images) {
      const { file, k, original } = image;
      try {
        // A file changed during measurement must not receive a stale clean result.
        if (key(readFileSync(file), target) !== k) {
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
  return { rows, declined, missed, errors, counts, builds };
}

/**
 * Measures what the cache lacks, every project's images on one pool (one count, no engine idle while
 * another project's last image finishes), each in its own project's cache folders under its own lock.
 * Notes on each group why it couldn't be measured, if so.
 */
async function measure(groups, { target, minSavedBytes, minSavedPercent }, counts) {
  const requests = new Map(); // request -> its group: fillAll() names a request it left out
  for (const group of groups.values()) {
    const pending = group.images.filter((image) => !image.entry);
    if (pending.length) requests.set({ dir: group.dir, failures: group.local, target, files: pending.map(({ file }) => file), minSavedBytes, minSavedPercent }, group);
  }
  if (requests.size === 0) return;
  let started = false;
  // the batch says it once it holds the locks, counting copies of one image once and leaving out what
  // another lint measured meanwhile (a closed stderr loses the line, nothing else: progress.js)
  const onStart = (total) => {
    started = true;
    startLine(total);
  };
  try {
    const result = await fillAll([...requests.keys()], progressLine(), onStart);
    counts.measured += result.computed;
    counts.cached += result.cached;
    for (const [request, cause] of result.errors) requests.get(request).failure = cause;
  } catch (cause) {
    // an engine died, or a cache folder failed once measuring had begun
    for (const group of requests.values()) group.failure = cause;
  }
  // on a terminal the count rewrites one line: clear it
  if (started && process.stderr.isTTY) process.stderr.write("\r\x1b[K");
  // once each and in full: a cache folder it can't write fails every image there, and only this names the folder
  const reasons = new Set([...requests.values()].filter(({ failure }) => failure).map(({ failure }) => failure.message ?? String(failure)));
  for (const reason of reasons) console.error(printable(`slimdeer: measuring failed: ${reason}`));
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

/**
 * What the check says, as lines for stdout, and in parts for the job summary. Each part is a sentence,
 * `words(show)` with `show` writing each path in it (as code, in Markdown), maybe the command to run
 * next, and its line ({ words, command, line }). `rerun` writes the command that runs it again; the
 * commands are for `platform`'s shell.
 */
function tell(inputs, { rows, declined, missed, errors, counts, builds }, settings, rerun = checkCommand, platform = process.platform) {
  const { cwd, target, minSavedBytes, exclude } = settings;
  const says = { lines: rows.map(row), notes: [] };
  const packages = counts.packages > 1 ? ` in ${count(counts.packages, "package")}` : "";
  says.checked = `checked ${count(counts.checked, "image")}${packages}; ${counts.measured} measured, ${counts.cached} cached, ${counts.skipped} skipped (already optimized or below ${size(minSavedBytes)}), ${count(errors.length, "error")}`;
  says.lines.push(`slimdeer: ${says.checked}.`);
  const part = (words, command) => {
    const line = `slimdeer: ${words((path) => path)}${command ? `, run${command.shell}: ${command.text}` : ""}`;
    says.lines.push(line);
    return { words, command, line };
  };
  const note = (words, command) => says.notes.push(part(words, command));
  // the same check again, as the paths were given: none for the folder it runs in
  const args = inputs.length === 1 && resolve(cwd, inputs[0]) === cwd ? [] : inputs;

  if (builds.length) {
    const images = builds.reduce((sum, build) => sum + build.images, 0);
    const paths = builds.map(({ path }) => path);
    const place = (show) => (paths.length === 1 ? `${show(paths[0])}, Gatsby's build output` : `Gatsby's build output (${paths.map(show).join(", ")})`);
    // a check's lines add to the ones above, but a review's page shows one run's images: that run
    // takes this one's paths as well
    const review = rerun === reviewCommand;
    note((show) => `left out ${count(images, "image")} in ${place(show)}; to ${review ? "review" : "check"} ${images === 1 ? "it" : "them"} too`, rerun(review ? [...inputs, ...paths] : paths, settings, platform));
  }
  const pointers = errors.filter(({ message }) => message === LFS).length;
  if (pointers) {
    const which = pointers === 1 ? "1 image is a Git LFS pointer" : `${pointers} images are Git LFS pointers`;
    note(() => `${which}: git lfs pull fetches ${pointers === 1 ? "it" : "them"} (in GitHub Actions, check out with lfs: true)`);
  }
  // files a walk found that slimdeer won't take, which every check would find again; one named is meant
  const named = new Set(inputs.map((input) => resolve(cwd, input)));
  const strays = errors.filter(({ file, message }) => !named.has(file) && REFUSED.some((start) => message.startsWith(start)));
  if (strays.length) {
    const one = strays.length === 1;
    const them = one ? "it" : strays.length > COMMAND_ROWS ? `the first ${COMMAND_ROWS}` : "them";
    const say = strays.every(({ message }) => message === NOT_IMAGE)
      ? one ? "1 file named like an image isn't a PNG or JPEG; if that's expected (a test fixture, say)," : `${strays.length} files named like images aren't PNGs or JPEGs; if that's expected (test fixtures, say),`
      : `${count(strays.length, "file")} slimdeer can't take (see above);`;
    // the same check again, with each one's path from here, which --exclude matches
    const left = strays.slice(0, COMMAND_ROWS).map(({ path }) => path);
    note(() => `${say} to leave ${them} out`, rerun(args, { ...settings, exclude: [...exclude, ...left] }, platform));
  }
  if (declined.length) {
    const one = declined.length === 1;
    const which = one ? "it" : declined.length > COMMAND_ROWS ? `the ${COMMAND_ROWS} biggest` : "them";
    const biggest = [...declined].sort((a, b) => b.original - a.original).slice(0, COMMAND_ROWS).map(({ path }) => path);
    says.declined = part(
      () => `${count(declined.length, "image")} can't be made smaller without a visible difference (${one ? "its" : "their"} best quality is below ${FLOOR}), so ${one ? "it isn't" : "they aren't"} listed; to try ${which} at a lower target`,
      checkCommand(biggest, { ...settings, target: LOWER }, platform),
    );
  }
  if (missed.length) {
    // as shrink.js says it of one image
    const wanted = target === undefined ? "the automatic quality" : `--target ${target}`;
    // rounded down, as a miss's best is below its target: 90.5 shown as 91 would reach --target 91
    const best = Math.floor(Math.max(...missed.map(({ score }) => score)));
    says.missed = part(missed.length === 1
      ? (show) => `${show(missed[0].path)} isn't listed: no smaller file reaches ${wanted} (the best reaches quality ${best}/100)`
      : () => `${missed.length} images aren't listed: no smaller file reaches ${wanted} (the best of them reaches quality ${best}/100)`);
  }

  if (rows.length) {
    const { original, compressed } = totals(rows);
    says.total = `${count(rows.length, "image")} could be ${size(original - compressed)} smaller (${size(original)} → ${size(compressed)}, ${smaller(original, compressed)}% smaller)`;
    says.lines.push(`slimdeer: ${says.total}. Images unchanged.`);
    if (rows.length === 1) {
      const [{ path }] = rows;
      const extension = extname(path);
      const preview = shrinkCommand([path], target, platform);
      says.preview = part(() => "to preview it as a new file", { text: `${preview.text} -o ${quote(`${basename(path, extension)}.preview${extension}`, platform)}`, shell: preview.shell });
    } else {
      // one page shows every one, where a -o file shows one at a time (review.js)
      says.preview = part(() => `to see ${rows.length === 2 ? "both" : `all ${rows.length}`} before and after on one page first`, reviewCommand(args, settings, platform));
    }
    const biggest = rows.slice(-COMMAND_ROWS).reverse().map(({ path }) => path);
    const which = rows.length > COMMAND_ROWS ? `the ${COMMAND_ROWS} biggest of ${rows.length}` : rows.length === 1 ? "it" : "them";
    says.shrink = part(() => `to shrink ${which} in place (lossy, so commit first)`, shrinkCommand(biggest, target, platform));
  } else if (errors.length) says.lines.push("slimdeer: check incomplete. Images unchanged.");
  else if (counts.checked === 0) {
    // after the Gatsby line, "no images" would contradict it; and --exclude may be why there are none
    says.lines.push(`slimdeer: found no ${builds.length ? "other " : ""}PNG or JPEG images to check in ${where(inputs, cwd)}${exclude.length ? ", apart from what --exclude leaves out" : ""}.`);
  } else says.lines.push("slimdeer: no images exceed the savings thresholds. Images unchanged.");
  return says;
}

/** One row as --check prints it. */
function row({ path, original, compressed, outcome, score }) {
  const quality = outcome === "hit" ? `quality ${Math.round(score)}/100: looks ${looks(score)}` : "lossless: looks identical";
  return `${path}: could be ${smaller(original, compressed)}% smaller (${size(original)} → ${size(compressed)}, ${quality})`;
}

function totals(rows) {
  return { original: rows.reduce((sum, { original }) => sum + original, 0), compressed: rows.reduce((sum, { compressed }) => sum + compressed, 0) };
}

/** The paths a check started from, for a message: as typed, but the folder it runs in by its full path, which tells a wrong folder at once. */
function where(inputs, cwd) {
  const paths = inputs.map((input) => (resolve(cwd, input) === cwd ? cwd : input));
  if (paths.length === 1) return paths[0];
  const shown = paths.slice(0, 3);
  return paths.length > 3 ? `${shown.join(", ")} and ${count(paths.length - 3, "more path")}` : `${shown.slice(0, -1).join(", ")} and ${shown.at(-1)}`;
}

/**
 * The check as one JSON document, for scripts and agents: every number in bytes, the images with the
 * biggest saving first (a script wants the top; the lines put the biggest last, next to the totals).
 */
function report({ rows, declined, missed, errors, counts, builds }, { cwd, target, minSavedBytes, minSavedPercent, exclude, cacheDir }) {
  const { version } = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  const images = biggestFirst(rows).map(({ path, root, original, compressed, outcome, score }) => ({
    file: path,
    package: pathFrom(cwd, root) || ".",
    original,
    compressed,
    saved: original - compressed,
    percent: smaller(original, compressed),
    outcome,
    quality: outcome === "hit" ? Math.round(score) : null,
    looks: outcome === "hit" ? looks(score) : "identical",
  }));
  const { original, compressed } = totals(rows);
  return {
    version,
    options: { target: target ?? "auto", minSavedBytes, minSavedPercent, exclude, cacheDir: cacheDir ?? null },
    counts: { ...counts, errors: errors.length },
    totals: { images: rows.length, original, compressed, saved: original - compressed, percent: rows.length ? smaller(original, compressed) : 0 },
    images,
    declined: unlisted(declined),
    missed: unlisted(missed),
    errors: errors.map(({ path, message }) => ({ file: path, message })),
    builds: builds.map(({ path, images }) => ({ folder: path, images })),
  };
}

/** Images measured but not listed, the biggest file first, each with its best quality, rounded down as tell() says it. */
function unlisted(images) {
  return [...images].sort((a, b) => b.original - a.original).map(({ path, original, score }) => ({ file: path, original, quality: Math.floor(score) }));
}

function biggestFirst(rows) {
  return [...rows].sort((a, b) => b.original - b.compressed - (a.original - a.compressed));
}

/**
 * The check in Markdown, for a GitHub Actions job summary: the savings biggest first, up to
 * REPORT_ROWS, each path as code, and each command in a block GitHub gives a copy button.
 */
function markdown({ rows, errors }, { cwd }, says) {
  // a monorepo's packages may each be checked in their own folder, where their commands run
  const folder = inCheckout(cwd);
  // a path in a sentence as code, as in the table: Markdown would read __tests__ as bold "tests". The
  // commands run where the check did, so a folder the heading names is named before each one too.
  const at = folder ? ` in ${code(folder)}` : "";
  const run = ({ words, command }) => (command ? [`${capital(words(code))}, run${at}${command.shell}:`, block(command.text)] : [`${capital(words(code))}.`]);
  const blocks = [`### slimdeer --check${at}`, `${capital(says.checked)}.`];
  if (rows.length) {
    const cells = ({ path, original, compressed, outcome, score }) => [code(path), size(original), size(compressed), size(original - compressed), outcome === "hit" ? String(Math.round(score)) : "lossless"];
    const sorted = biggestFirst(rows);
    blocks.push(`${capital(says.total)}:`, table(["Image", "Now", "After", "Saves", "Quality"], sorted.slice(0, REPORT_ROWS).map(cells)));
    if (rows.length > REPORT_ROWS) {
      const { original, compressed } = totals(sorted.slice(REPORT_ROWS));
      blocks.push(`…and ${count(rows.length - REPORT_ROWS, "more image")}, which could save ${size(original - compressed)} more.`);
    }
    blocks.push(`${capital(LEGEND)}.`);
  }
  for (const part of [says.declined, says.missed]) if (part) blocks.push(...run(part));
  if (errors.length) {
    const listed = errors.slice(0, REPORT_ERRORS).map(({ path, message }) => `- ${code(path)}: ${prose(message)}`);
    if (errors.length > REPORT_ERRORS) listed.push(`- …and ${errors.length - REPORT_ERRORS} more, in the step's log`);
    const which = errors.length === 1 ? "1 image or folder" : `${errors.length} images or folders`;
    blocks.push(`The check is incomplete: ${which} couldn't be checked:`, listed.join("\n"));
  }
  for (const part of says.notes) blocks.push(...run(part));
  if (rows.length) blocks.push(...run(says.preview), ...run(says.shrink));
  return `\n${blocks.join("\n\n")}\n`;
}
