// --check: what measureAll() (measure.js) finds under the paths given, said as lines, as one JSON
// document, or as a GitHub Actions job summary; the review (review.js) says what it leaves out the
// same way.
import { readFileSync } from "node:fs";
import { basename, dirname, extname, resolve } from "node:path";
import { FLOOR, reportable } from "./cache.js";
import { cautions, FORMATS, missText, sameText, SUGGESTED } from "./convert.js";
import { listed } from "./copies.js";
import { appendJobSummary, block, capital, code, inCheckout, prose, table } from "./markdown.js";
import { LFS, measureAll, shortened } from "./measure.js";
import { mentions } from "./mentions.js";
import { projectRoot } from "./scan.js";
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
// What images.js says of a file that isn't a PNG or JPEG.
const NOT_IMAGE = "not a PNG or JPEG";
// How the other reasons images.js's unsupported() gives start: a file a check finds again each time.
const REFUSED = [NOT_IMAGE, "unreadable header", "a grayscale PNG", "too large", "animation too large"];

/**
 * Checks images without rewriting them: 0 clean, 1 savings found, 2 incomplete or failed. The lines
 * go to stdout, or with `json`, one JSON document; in GitHub Actions, a job summary too.
 */
export async function check(inputs, options = {}) {
  // each as it's found: a mistyped path shouldn't wait for minutes of measuring
  const onError = ({ path, message }) => console.error(printable(`${path}: ${shortened(message)}`));
  // an error that may clear on its own names the run to repeat, as typed
  const again = options.format ? `--check --format ${options.format}` : "--check";
  return print(inputs, await measureAll(inputs, { ...settingsOf(options), onError, again }), options);
}

/**
 * Says what measureAll() found under `inputs`, as --check does: lines, or with `json` one JSON
 * document; in GitHub Actions a job summary too, unless `summary` is false. With a format, the
 * cautions (cautionsOf()) go to stderr. Prints no error: the caller has. Returns the check's exit code.
 */
export function print(inputs, result, options = {}) {
  // what it says goes by the format the result was measured as, which its commands then carry
  const settings = settingsOf({ ...options, format: result.format });
  const shown = listing(result);
  const caution = () => cautionsOf(result, settings).forEach((line) => console.error(printable(line)));
  if (options.json) {
    caution();
    console.log(JSON.stringify(report(shown, settings)));
  } else {
    const says = tell(inputs, shown, settings);
    says.lines.forEach((line, i) => {
      console.log(printable(line));
      // right after the "checked" line, which follows the rows
      if (i === shown.rows.length) caution();
    });
    // GitHub Actions names a file for each step's job summary: --check makes no annotations, and the
    // lines above are deep in the step's log
    const summary = process.env.GITHUB_STEP_SUMMARY;
    const told = [shown.rows, shown.declined, shown.missed, shown.errors, shown.notWorthIt ?? [], shown.leftOut ?? []].some((list) => list.length);
    if (options.summary !== false && summary && told) {
      try {
        // the reader's machine has none of the node and slimdeer.js a Windows runner's PowerShell form
        // names: npx, quoted for a POSIX shell, as in the lint's job summary (summary.js)
        appendJobSummary(summary, markdown(shown, settings, tell(inputs, shown, settings, checkCommand, "linux"), cautionsOf(result, settings, code)));
      } catch {
        // the lines above still tell, and the exit code stays the check's
      }
    }
  }
  return result.errors.length ? 2 : shown.rows.length ? 1 : 0;
}

/**
 * The notes --check prints about what it doesn't list, as lines: Gatsby build folders left out, Git
 * LFS pointers, files slimdeer can't take, with a format the copies that wouldn't save enough, the
 * images that have one already and the images left out, then images the quality floor turned down,
 * images that missed the target. Each may end with the command to run next; `rerun` (text.js) writes
 * the one that runs this again with other paths or exclusions, as --review gives it for a review,
 * whose lines then say an image isn't "on the page" where a check's say it isn't "listed".
 */
export function notes(inputs, result, settings = {}, rerun = checkCommand) {
  const says = tell(inputs, listing(result), settingsOf({ ...settings, format: result.format }), rerun);
  return [...says.notes, says.declined, says.missed].filter(Boolean).map(({ line }) => line);
}

/**
 * What a check of `rows` could save in all, as a sentence for after "slimdeer: ": with `format`, as
 * that format, and what shrinking them in place at the copies' quality would leave instead (the
 * quality is the same as the shrink's, never the original's).
 */
export function saving(rows, format) {
  const { original, compressed, base } = totals(rows);
  const sentence = `${count(rows.length, "image")} could be ${size(original - compressed)} smaller (${size(original)} → ${size(compressed)}, ${smaller(original, compressed)}% smaller)`;
  if (!format) return sentence;
  return `as ${FORMATS[format].name}, ${sentence}; shrunk in place at the same quality, ${rows.length === 1 ? "it" : "they"} would be ${size(base)}`;
}

/**
 * What to keep in mind before converting what a check with a format found (convert.js cautions()):
 * a line for each project of the images it checked that depends on a framework that converts images
 * itself; for AVIF, one for each image it lists that is named like a share image or an icon. Lines
 * for stderr, `show` writing each path in them; none without a format.
 */
export function cautionsOf(result, settings, show) {
  if (!result.format) return [];
  const { cwd } = settingsOf(settings);
  const checked = [...result.rows, ...(result.existing ?? []), ...result.notWorthIt, ...result.leftOut, ...result.missed, ...result.declined];
  return cautions(checked.map(({ file }) => projectRoot(dirname(file), cwd)), result.format, listing(result).rows.map(({ path }) => path), show, cwd);
}

/** A check's options, with the defaults filled in and the folder it runs in as a full path. */
function settingsOf({ cwd, target, format, minSavedBytes = 4096, minSavedPercent = 10, exclude = [], cacheDir } = {}) {
  return { cwd: resolve(cwd ?? process.cwd()), target, format, minSavedBytes, minSavedPercent, exclude, cacheDir };
}

/**
 * measureAll()'s result as a check lists it: with a format, the rows whose copy's place something
 * already takes go from `rows` to `existing`, as --format never replaces a file, so for the command
 * they are done. Without a format, the result itself.
 */
export function listing(result) {
  // a result listed already has its `existing`
  if (!result.format || result.existing) return result;
  return { ...result, rows: result.rows.filter(({ outputExists }) => !outputExists), existing: result.rows.filter(({ outputExists }) => outputExists) };
}

/**
 * What the check says, as lines for stdout, and in parts for the job summary. Each part is a sentence,
 * `words(show)` with `show` writing each path in it (as code, in Markdown), maybe the command to run
 * next, and its line ({ words, command, line }). `rerun` writes the command that runs it again; the
 * commands are for `platform`'s shell.
 */
function tell(inputs, result, settings, rerun = checkCommand, platform = process.platform) {
  const { rows, declined, missed, errors, counts, builds, format } = result;
  const { cwd, target, minSavedBytes, exclude } = settings;
  const says = { lines: rows.map((each) => row(each, format)), notes: [] };
  const packages = counts.packages > 1 ? ` in ${count(counts.packages, "package")}` : "";
  says.checked = `checked ${count(counts.checked, "image")}${packages}; ${counts.measured} measured, ${counts.cached} cached, ${counts.skipped} skipped (already optimized or below ${size(minSavedBytes)}), ${count(errors.length, "error")}`;
  says.lines.push(`slimdeer: ${says.checked}.`);
  // `end` closes a line that gives no command
  const part = (words, command, end = "") => {
    const line = `slimdeer: ${words((path) => path)}${command ? `, run${command.shell}: ${command.text}` : end}`;
    says.lines.push(line);
    return { words, command, line };
  };
  const note = (words, command, end) => says.notes.push(part(words, command, end));
  // the same check again, as the paths were given: none for the folder it runs in
  const args = inputs.length === 1 && resolve(cwd, inputs[0]) === cwd ? [] : inputs;
  // a check's lines add to the ones above, but a review's page shows one run's images
  const review = rerun === reviewCommand;
  const place = review ? "on the page" : "listed";

  if (builds.length) {
    const images = builds.reduce((sum, build) => sum + build.images, 0);
    const paths = builds.map(({ path }) => path);
    const folders = (show) => (paths.length === 1 ? `${show(paths[0])}, Gatsby's build output` : `Gatsby's build output (${paths.map(show).join(", ")})`);
    // a review's run takes this one's paths as well
    note((show) => `left out ${count(images, "image")} in ${folders(show)}; to ${review ? "review" : "check"} ${images === 1 ? "it" : "them"} too`, rerun(review ? [...inputs, ...paths] : paths, settings, platform));
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
  if (format) copyNotes(result, settings, { note, place, platform });
  if (declined.length && format) {
    const one = declined.length === 1;
    const biggest = bySize(declined).slice(0, COMMAND_ROWS).map(({ path }) => path);
    // a copy aims at the quality of the image's own shrink, and below the floor there is none; as WebP
    // or AVIF the image may well be smaller at a target chosen (convert.js says it so of one image)
    says.declined = part(
      (show) => `${one ? `${show(declined[0].path)} isn't` : `${declined.length} images aren't`} ${place}: shrunk in place ${one ? "it doesn't" : "they don't"} reach quality ${FLOOR}, so there is no quality to match; to choose one${declined.length > COMMAND_ROWS ? ` for the ${COMMAND_ROWS} biggest` : ""}`,
      checkCommand(biggest, { ...settings, target: SUGGESTED }, platform),
    );
  } else if (declined.length) {
    const one = declined.length === 1;
    const which = one ? "it" : declined.length > COMMAND_ROWS ? `the ${COMMAND_ROWS} biggest` : "them";
    const biggest = bySize(declined).slice(0, COMMAND_ROWS).map(({ path }) => path);
    says.declined = part(
      () => `${count(declined.length, "image")} can't be made smaller without a visible difference (${one ? "its" : "their"} best quality is below ${FLOOR}), so ${one ? "it isn't" : "they aren't"} listed; to try ${which} at a lower target`,
      checkCommand(biggest, { ...settings, target: LOWER }, platform),
    );
  }
  if (missed.length && format) says.missed = part(copyMissed(missed, format, target, place));
  else if (missed.length) {
    // as shrink.js says it of one image
    const wanted = target === undefined ? "the automatic quality" : `--target ${target}`;
    // rounded down, as a miss's best is below its target: 90.5 shown as 91 would reach --target 91
    const best = Math.floor(Math.max(...missed.map(({ score }) => score)));
    says.missed = part(missed.length === 1
      ? (show) => `${show(missed[0].path)} isn't listed: no smaller file reaches ${wanted} (the best reaches quality ${best}/100)`
      : () => `${missed.length} images aren't listed: no smaller file reaches ${wanted} (the best of them reaches quality ${best}/100)`);
  }

  if (rows.length) {
    says.total = saving(rows, format);
    says.lines.push(`slimdeer: ${says.total}. Images unchanged.`);
    const one = rows.length === 1;
    if (format) says.preview = part(() => `to see ${one ? "it" : "them"} before and after on one page first`, reviewCommand(args, settings, platform));
    else if (one) {
      const [{ path }] = rows;
      const extension = extname(path);
      const preview = shrinkCommand([path], target, platform);
      says.preview = part(() => "to preview it as a new file", { text: `${preview.text} -o ${quote(`${basename(path, extension)}.preview${extension}`, platform)}`, shell: preview.shell });
    } else {
      // one page shows every one, where a -o file shows one at a time (review.js)
      says.preview = part(() => `to see ${rows.length === 2 ? "both" : `all ${rows.length}`} before and after on one page first`, reviewCommand(args, settings, platform));
    }
    // the biggest saving, beyond the image's own shrink with a format, first
    const biggest = rows.slice(-COMMAND_ROWS).reverse().map(({ path }) => path);
    const which = rows.length > COMMAND_ROWS ? `the ${COMMAND_ROWS} biggest of ${rows.length}` : one ? "it" : "them";
    says.shrink = format
      ? part(() => `to write ${which} as ${FORMATS[format].name} next to the ${one ? "original, which stays" : "originals, which stay"}`, shrinkCommand(biggest, target, platform, format))
      : part(() => `to shrink ${which} in place (lossy, so commit first)`, shrinkCommand(biggest, target, platform));
  } else if (errors.length) says.lines.push("slimdeer: check incomplete. Images unchanged.");
  else if (counts.checked === 0) {
    // after the Gatsby line, "no images" would contradict it; and --exclude may be why there are none
    says.lines.push(`slimdeer: found no ${builds.length ? "other " : ""}PNG or JPEG images to check in ${where(inputs, cwd)}${exclude.length ? ", apart from what --exclude leaves out" : ""}.`);
  } else if (format) {
    const { name } = FORMATS[format];
    // "would be smaller" or not is known only of copies measured that reach their target: the lines
    // above say why each other image isn't listed. "Nothing would be smaller" isn't true of an image
    // whose copy is there already.
    const unknown = result.leftOut.length + declined.length + missed.length;
    says.lines.push(unknown
      ? `slimdeer: as ${name}, no image here is listed. Images unchanged.`
      : result.existing.length
        ? `slimdeer: as ${name}, every image that would be smaller already has its ${name} file. Images unchanged.`
        : `slimdeer: as ${name}, no image here would be smaller than shrinking it in place by both thresholds. Images unchanged.`);
  } else says.lines.push("slimdeer: no images exceed the savings thresholds. Images unchanged.");
  return says;
}

/**
 * With a format, what a check says, by `note`, of the images it doesn't list as that format: copies
 * that wouldn't save enough beyond the image's own shrink, with the command that shrinks those worth
 * shrinking; images that have a file where their copy would go; images left out, a line per reason.
 * `place` says where they aren't ("listed", or a review's "on the page", which shows the sizes the
 * check's lines give).
 */
function copyNotes({ format, notWorthIt, existing, leftOut }, settings, { note, place, platform }) {
  const { name, article } = FORMATS[format];
  if (notWorthIt.length) {
    const { images, why, command, which } = shortfall(notWorthIt, settings, platform);
    const one = images.length === 1;
    const it = one ? "it" : "them";
    const against = ({ compressed, base }) => `${size(compressed)} against ${size(base)}`;
    const sizes = (show) => (one ? against(images[0]) : listed(images.map((image) => `${show(image.path)}: ${against(image)}`), "; "));
    note(
      (show) => `${one ? `${show(images[0].path)} isn't` : `${images.length} images aren't`} ${place}: as ${name} ${one ? "it" : "they"} ${why} shrinking ${it} in place${place === "listed" ? ` (${sizes(show)})` : ""}${command ? `; to shrink ${which} in place instead` : ""}`,
      command,
      ".",
    );
  }
  if (existing.length) {
    const paths = bySaving(existing).map(({ path }) => path);
    note((show) => (paths.length === 1
      ? `${show(paths[0])} already has ${article} ${name} file next to it, which --format never replaces, so it isn't ${place}`
      : `${paths.length} images already have ${article} ${name} file next to them, which --format never replaces, so they aren't ${place}: ${listed(paths.map(show))}`));
  }
  const reasons = new Map(); // reason -> the images left out for it, in the order found
  for (const image of leftOut) reasons.set(image.reason, [...(reasons.get(image.reason) ?? []), image]);
  for (const [reason, images] of reasons) {
    const one = images.length === 1;
    if (images[0].kind === "marked") note(() => `${count(images.length, "image")} this command already shrank ${one ? "is" : "are"} left out: converting ${one ? "it" : "them"} would be a second lossy pass; convert the ${one ? "original" : "originals"} instead`);
    else note((show) => `${count(images.length, "image")} left out: ${listed(images.map(({ path }) => show(path)))} (${reason})`);
  }
}

/**
 * What a check with a format says of the copies in `notWorthIt`, which wouldn't save enough beyond
 * their image's own shrink: the `images`, the biggest file first; `why` they fall short, by the
 * thresholds that aren't 0 ("would save less than 4.1 kB or 10% more than"), or with none, or when
 * none is smaller, "would be no smaller than"; and, if any of them is worth shrinking in place as
 * --check would list it without a format, the `command` that does, and `which` of them it names ("it",
 * "them", "1 of them", "the 10 biggest of 12").
 */
export function shortfall(notWorthIt, { target, minSavedBytes = 4096, minSavedPercent = 10 }, platform = process.platform) {
  const images = bySize(notWorthIt);
  const worth = images.filter(({ original, sameFormat }) => reportable({ ...sameFormat, original }, { minSavedBytes, minSavedPercent }));
  const command = worth.length ? shrinkCommand(worth.slice(0, COMMAND_ROWS).map(({ path }) => path), target, platform) : undefined;
  const which = worth.length < images.length
    ? `${worth.length > COMMAND_ROWS ? `the ${COMMAND_ROWS} biggest of ` : ""}${worth.length} of them`
    : images.length > COMMAND_ROWS ? `the ${COMMAND_ROWS} biggest of ${images.length}` : images.length === 1 ? "it" : "them";
  // with no threshold, a copy listed is any copy smaller than its base; and a copy bigger than its
  // base saves nothing, which "less than 4.1 kB more" would make read as a little
  const less = [minSavedBytes ? size(minSavedBytes) : "", minSavedPercent ? `${minSavedPercent}%` : ""].filter(Boolean).join(" or ");
  const bigger = images.every(({ compressed, base }) => compressed >= base);
  return { images, why: less && !bigger ? `would save less than ${less} more than` : "would be no smaller than", command, which };
}

/** With a format, what a check says of the images `missed` for which no copy reaches its target, as part()'s words; `place` as copyNotes() takes it. */
function copyMissed(missed, format, target, place) {
  if (missed.length === 1) {
    const [{ path, type, score, equal }] = missed;
    // as the command says it of one image
    return (show) => `${show(path)} isn't ${place}: ${missText(format, type, { equal, score, target })}`;
  }
  // rounded down, as each best is below its target
  const best = Math.floor(Math.max(...missed.map(({ score }) => score)));
  return () => `${missed.length} images aren't ${place}: as ${FORMATS[format].name}, no file reaches ${target === undefined ? "the quality asked" : `--target ${target}`} (the best of them reaches quality ${best}/100)`;
}

/**
 * One row as --check prints it: what the image's own shrink saves, or with `format`, what its copy in
 * that format saves, then what its own shrink would do (convert.js, as the command says it).
 */
function row({ path, type, target, original, compressed, outcome = "hit", score, sameFormat }, format) {
  // a copy listed is always a hit
  const quality = outcome === "hit" ? `quality ${Math.round(score)}/100: looks ${looks(score)}` : "lossless: looks identical";
  const saves = `could be ${smaller(original, compressed)}% smaller (${size(original)} → ${size(compressed)}, ${quality})`;
  return format ? `${path}: as ${FORMATS[format].name}, ${saves}; ${sameText(sameFormat, original, target, type)}` : `${path}: ${saves}`;
}

/** What a row weighs without its saving: with a format, its base, what shrinking the image in place would leave. */
function baseIn(row) {
  return row.base ?? row.original;
}

function totals(rows) {
  const sum = (bytes) => rows.reduce((total, row) => total + bytes(row), 0);
  return { original: sum((row) => row.original), compressed: sum((row) => row.compressed), base: sum(baseIn) };
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
 * With a format, each image's copy, its own shrink, and the lines that name it, so an agent can change
 * them; paths are from the folder the check runs in.
 */
function report(result, { cwd, target, minSavedBytes, minSavedPercent, exclude, cacheDir }) {
  const { rows, declined, missed, errors, counts, builds, format } = result;
  const { version } = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  const { original, compressed, base: sameFormat } = totals(rows);
  const options = { target: target ?? "auto", ...(format && { format }), minSavedBytes, minSavedPercent, exclude, cacheDir: cacheDir ?? null };
  const sums = { images: rows.length, original, compressed, saved: original - compressed, percent: rows.length ? smaller(original, compressed) : 0 };
  const head = { version, options, counts: { ...counts, errors: errors.length } };
  const tail = {
    declined: unlisted(declined),
    missed: unlisted(missed),
    errors: errors.map(({ path, message }) => ({ file: path, message })),
    builds: builds.map(({ path, images }) => ({ folder: path, images })),
  };
  if (!format) {
    const images = bySaving(rows).map(({ path, root, original, compressed, outcome, score }) => ({
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
    return { ...head, totals: sums, images, ...tail };
  }
  // the image's own shrink: no size for a miss, as no file it found reached the target
  const shrink = ({ compressed, outcome, score }) => ({ compressed: outcome === "miss" ? null : compressed, outcome, quality: outcome === "hit" ? Math.round(score) : null });
  const images = bySaving(rows).map(({ file, path, root, output, original, compressed, score, sameFormat, base }) => ({
    file: path,
    package: pathFrom(cwd, root) || ".",
    output: pathFrom(cwd, output),
    original,
    compressed,
    saved: original - compressed,
    percent: smaller(original, compressed),
    quality: Math.round(score),
    looks: looks(score),
    sameFormat: { ...shrink(sameFormat), savedMore: base - compressed, percentMore: smaller(base, compressed) },
    namedIn: mentions(file, root, undefined, cwd).map(({ file, line, text }) => ({ file: pathFrom(cwd, file), line, text })),
  }));
  return {
    ...head,
    totals: { ...sums, sameFormat, savedMore: sameFormat - compressed },
    images,
    notWorthIt: bySize(result.notWorthIt).map(({ path, original, compressed, sameFormat }) => ({ file: path, original, compressed, sameFormat: shrink(sameFormat) })),
    leftOut: result.leftOut.map(({ path, reason }) => ({ file: path, reason })),
    existing: bySaving(result.existing).map(({ path, output }) => ({ file: path, output: pathFrom(cwd, output) })),
    ...tail,
  };
}

/** Images measured but not listed, the biggest file first, each with its best quality, rounded down as tell() says it. */
function unlisted(images) {
  return bySize(images).map(({ path, original, score }) => ({ file: path, original, quality: Math.floor(score) }));
}

/** Rows, the biggest saving first: with a format, the biggest saving beyond the image's own shrink. */
function bySaving(rows) {
  return [...rows].sort((a, b) => baseIn(b) - b.compressed - (baseIn(a) - a.compressed));
}

/** Images, the biggest file first. */
function bySize(images) {
  return [...images].sort((a, b) => b.original - a.original);
}

/**
 * The check in Markdown, for a GitHub Actions job summary: the savings biggest first, up to
 * REPORT_ROWS, each path as code, and each command in a block GitHub gives a copy button. With a
 * format, each copy's size next to what the image's own shrink would leave, and the `cautions`
 * (cautionsOf()) among the notes.
 */
function markdown({ rows, errors, format }, { cwd }, says, cautions = []) {
  // a monorepo's packages may each be checked in their own folder, where their commands run
  const folder = inCheckout(cwd);
  // a path in a sentence as code, as in the table: Markdown would read __tests__ as bold "tests". The
  // commands run where the check did, so a folder the heading names is named before each one too.
  const at = folder ? ` in ${code(folder)}` : "";
  const run = ({ words, command }) => (command ? [`${capital(words(code))}, run${at}${command.shell}:`, block(command.text)] : [`${capital(words(code))}.`]);
  const blocks = [`### slimdeer --check${format ? ` --format ${format}` : ""}${at}`, `${capital(says.checked)}.`];
  if (rows.length) {
    const cells = format
      ? ({ path, original, compressed, score, base }) => [code(path), size(original), size(compressed), size(original - compressed), String(Math.round(score)), size(base)]
      : ({ path, original, compressed, outcome, score }) => [code(path), size(original), size(compressed), size(original - compressed), outcome === "hit" ? String(Math.round(score)) : "lossless"];
    const header = format ? ["Image", "Now", `As ${FORMATS[format].name}`, "Saves", "Quality", "Shrunk as PNG or JPEG"] : ["Image", "Now", "After", "Saves", "Quality"];
    const sorted = bySaving(rows);
    blocks.push(`${capital(says.total)}:`, table(header, sorted.slice(0, REPORT_ROWS).map(cells)));
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
  for (const caution of cautions) blocks.push(`${capital(caution.slice("slimdeer: ".length))}.`);
  if (rows.length) blocks.push(...run(says.preview), ...run(says.shrink));
  return `\n${blocks.join("\n\n")}\n`;
}
