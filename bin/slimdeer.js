#!/usr/bin/env node
// Checks or shrinks images with the same engine and targets as the lint rule, or writes WebP and AVIF
// copies of them (copies.js).
import { readFileSync, statSync } from "node:fs";
import { basename, dirname, extname, join, resolve, sep } from "node:path";
import { peakOf, pool } from "../src/batch.js";
import { fileKey } from "../src/cache.js";
import { FORMATS, sibling } from "../src/convert.js";
import { clash, writeCopies } from "../src/copies.js";
import { kind } from "../src/images.js";
import { physical } from "../src/scan.js";
import { plain, shrink } from "../src/shrink.js";
import { readFlagged } from "../src/summary.js";
import { count, pathFrom, printable, quote, size } from "../src/text.js";

const HELP = `usage: oxlint-plugin-slimdeer IMAGE... [--target auto|T] [--format webp|avif]
       oxlint-plugin-slimdeer IMAGE -o OUT [--target auto|T]
       oxlint-plugin-slimdeer --flagged [--target auto|T]
       oxlint-plugin-slimdeer --check [PATH...] [--format webp|avif] [--json] [options]
       oxlint-plugin-slimdeer --review [PATH...] [--format webp|avif] [--open] [options]
       oxlint-plugin-slimdeer --review --flagged [--format webp|avif] [--open] [--target auto|T] [--cache-dir PATH]

Makes PNGs and JPEGs smaller with slimdeer, in place, at about the same visual quality, or
writes a WebP or AVIF copy of each next to it. slimdeer is lossy: the picture looks about the
same, the bytes don't, so commit first.

  -o OUT        write to OUT instead of in place (one image only): OUT named like the image
                (.png, .jpg) previews the shrink; OUT ending in .webp or .avif gets that format
  --format F    webp or avif: write each image as a new file next to it (hero.png ->
                hero.webp), at the quality its PNG or JPEG shrink would have, only where that
                file is smaller than both. It never replaces a file and keeps the original:
                code that names an image must change to use the new file. AVIF is slow
  --flagged     the images the last lint here flagged, each at the target it was measured at;
                shared images with conflicting quality targets are left out
  --check       measure, changing no image: files and folders (default: this folder), with
                the packages inside them; warms the lint's cache. With --format, it compares
                each image as WebP or AVIF with its PNG or JPEG shrink at the same quality
  --json        with --check, print one JSON document on stdout instead of lines
  --review      write previews and a page to compare them with the originals; changes no image
  --open        with --review, open the page in a browser
  --target T    the SSIMULACRA2 score to keep, 0-100 (90 looks identical at 1:1); auto
                (the default) picks one per image, about TinyPNG's quality, never below 70

Options for --check and --review:
  --min-saved-bytes N    the smallest saving to list, in bytes (default: 4096); with
                         --format, the saving beyond the PNG or JPEG shrink
  --min-saved-percent N  the smallest saving to list, in percent (default: 10); with
                         --format, of the PNG or JPEG shrink's size
  --exclude PATTERN      leave out a file, folder or glob (*, **, ?), as a path from the
                         image's package or from this folder; repeat for more
  --cache-dir PATH       the cache folder, from each package (default: node_modules/.cache/slimdeer)

  --            treat all remaining arguments as image paths
  -v, --version
  -h, --help

An option's value can follow it or an = sign: --target 80 or --target=80.
--check exits 0 when no image clears both thresholds, 1 when one does, and 2 on a mistake
or when an image or folder couldn't be checked. It reads no linter configuration.
--review exits 0 when it wrote the page or found nothing to review, and 2 on a mistake,
when --flagged finds no list, or when an image or folder couldn't be checked or previewed.
Like --check, it reads no linter configuration; with --flagged, it shows what the lint flagged.
With --format, the command exits 0 when each image was written or left out for a reason it
names, 1 when one failed or another file was in the way, and 2 on a mistake. With an OUT
ending in .webp or .avif, it exits 0 only when it wrote OUT.
PNGs and JPEGs it writes are marked, so the lint rule doesn't flag them again. WebP and AVIF
files aren't marked: the rule doesn't measure those formats.`;

const CHECK_OPTIONS = {
  "--min-saved-bytes": "minSavedBytes",
  "--min-saved-percent": "minSavedPercent",
  "--exclude": "exclude",
  "--cache-dir": "cacheDir",
};
// the options that take a value, and those that take none
const VALUED = new Set(["-o", "--target", "--format", ...Object.keys(CHECK_OPTIONS)]);
const FLAGS = new Set(["--check", "--flagged", "--json", "--review", "--open", "--help", "--version"]);
// The format an -o file's extension names: the image's own (a preview of its shrink), or a copy's
const NAMED = { ".png": "png", ".apng": "png", ".jpg": "jpeg", ".jpeg": "jpeg", ".webp": "webp", ".avif": "avif" };
// What --flagged finds where no lint left a list: none ran here (or one ran in a folder above), eslint
// ran with --cache, or a lint here flagged nothing and had no cache folder to leave an empty list in.
const NO_LIST = "no list of flagged images here: lint in this folder first (npx oxlint, or eslint without --cache); if a lint here flagged no image, there is nothing to do";

// A reader that stops early (| head) closes the pipe: the printing stops there, but the work goes on.
// Each image is written whole, one by one, and a list shrunk halfway without a word would be worse.
// The exit code is still the work's. (Windows says EOF where others say EPIPE.)
for (const stream of [process.stdout, process.stderr]) {
  stream.on("error", (error) => {
    if (error.code !== "EPIPE" && error.code !== "EOF") throw error;
  });
}

async function main(args) {
  // run bare, it says what it does
  if (args.length === 0) {
    console.error(`oxlint-plugin-slimdeer: no image given\n\n${HELP}`);
    return 2;
  }
  const inputs = [];
  let output;
  let format;
  let target;
  let targeted = false;
  let fromLint = false;
  let checking = false;
  let json = false;
  let reviewing = false;
  let open = false;
  const checkOptions = {};
  for (let i = 0; i < args.length; i++) {
    let arg = args[i];
    let value;
    if (arg === "--") {
      inputs.push(...args.slice(i + 1));
      break;
    }
    // --target=80, as linters take their options
    const joined = /^(--[a-z-]+)=(.*)$/s.exec(arg);
    if (joined && FLAGS.has(joined[1])) return fail(`${joined[1]} takes no value`);
    if (joined && VALUED.has(joined[1])) [, arg, value] = joined;
    if (arg === "-h" || arg === "--help") {
      console.log(HELP);
      return 0;
    }
    if (arg === "-v" || arg === "--version") {
      console.log(JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")).version);
      return 0;
    }
    if (arg === "--flagged") fromLint = true;
    else if (arg === "--check") checking = true;
    else if (arg === "--json") json = true;
    else if (arg === "--review") reviewing = true;
    else if (arg === "--open") open = true;
    else if (VALUED.has(arg)) {
      if (value === undefined) {
        value = args[++i];
        if (value === undefined || value.startsWith("--") || ["-h", "-v", "-o"].includes(value)) return fail(`${arg} needs a value`);
      }
      // empty either way, as a script's unset variable gives it (-o "$OUT"): else -o "" blames the image
      if (value === "") return fail(`${arg} needs a value`);
      if (arg === "-o") output = value;
      else if (arg === "--format") {
        format = value.toLowerCase();
        if (!Object.hasOwn(FORMATS, format)) return fail(`--format must be webp or avif, not ${value} (without --format, each image keeps its own format)`);
      } else if (arg === "--target") {
        targeted = true;
        target = value === "auto" ? undefined : Number(value);
        if (target !== undefined && !(value.trim() !== "" && target >= 0 && target <= 100)) return fail(`--target must be auto or a number from 0 to 100, not ${value}`);
      } else if (arg === "--exclude" || arg === "--cache-dir") {
        if (!value.trim() || value.startsWith("--")) return fail(`${arg} needs a value`);
        if (arg === "--exclude") (checkOptions.exclude ??= []).push(value);
        else checkOptions.cacheDir = value;
      } else {
        const number = Number(value);
        const valid = value.trim() !== "" && Number.isFinite(number) && number >= 0 &&
          (arg === "--min-saved-bytes" ? Number.isSafeInteger(number) : number <= 100);
        if (!valid) return fail(`${arg} must be ${arg === "--min-saved-bytes" ? "a nonnegative integer" : "a number from 0 to 100"}, not ${value}`);
        checkOptions[CHECK_OPTIONS[arg]] = number;
      }
    } else if (arg.startsWith("-") && arg !== "-") return fail(`unknown option ${arg}`);
    else inputs.push(arg);
  }
  if (reviewing) {
    if (checking || output !== undefined || json) return fail("--review cannot be combined with --check, -o or --json");
    let flagged;
    if (fromLint) {
      if (inputs.length) return fail("--flagged takes no images and no -o");
      // the lint chose the images by its own thresholds and exclusions
      if (["exclude", "minSavedBytes", "minSavedPercent"].some((option) => option in checkOptions)) return fail("--review --flagged cannot be combined with --exclude, --min-saved-bytes or --min-saved-percent");
      const list = readFlagged(process.cwd());
      if (!list) {
        console.error(`oxlint-plugin-slimdeer: ${NO_LIST}`);
        return 2;
      }
      // a --target given here wins over the lint's, as with --flagged, and so does a --cache-dir over
      // the folder the lint measured into
      flagged = list.map(({ file, target: own, cacheDir, changed }) => ({ file, target: targeted ? target : own, cacheDir: checkOptions.cacheDir ?? cacheDir, changed }));
    }
    try {
      // the review page (review.js) loads only when asked for
      const { review } = await import("../src/review.js");
      return await review(inputs.length ? inputs : ["."], { ...checkOptions, target, open, flagged, format });
    } catch (error) {
      console.error(printable(`oxlint-plugin-slimdeer: ${plain(error)}`));
      return 2;
    }
  }
  if (open) return fail("--open requires --review");
  if (checking) {
    if (fromLint || output !== undefined) return fail("--check cannot be combined with --flagged or -o");
    try {
      const { check } = await import("../src/check.js");
      return await check(inputs.length ? inputs : ["."], { ...checkOptions, target, json, format });
    } catch (error) {
      console.error(printable(`oxlint-plugin-slimdeer: ${plain(error)}`));
      return 2;
    }
  }
  // each copy needs its own change in the code, which the review page lets a person choose
  if (fromLint && format) return fail(`--flagged --format would write a new file for every image the lint flagged, and each one needs a change in the code: review them first with npx oxlint-plugin-slimdeer --review --flagged --format ${format}, and run the command the page gives`);
  if (json) return fail("--json requires --check");
  if (Object.keys(checkOptions).length) return fail("--min-saved-bytes, --min-saved-percent, --exclude and --cache-dir require --check or --review");
  if (fromLint && (inputs.length || output !== undefined)) return fail("--flagged takes no images and no -o");
  if (!fromLint && inputs.length === 0) return fail("no image given");
  if (output !== undefined && inputs.length > 1) {
    // OUT.webp asks for copies, but without -o only --format writes them: the images alone are shrunk in place
    const asked = format ?? NAMED[extname(output).toLowerCase()];
    const without = Object.hasOwn(FORMATS, asked) ? `each image's ${FORMATS[asked].name} copy is written next to it${format ? "" : ` with --format ${asked}`}` : "each image is written in place";
    return fail(`-o takes one image; without it, ${without}`);
  }
  if (output !== undefined && folder(output)) {
    // with --format, the copy's name; else the image's, which in its own folder (however it's spelled
    // or linked) would write over it
    const example = join(output, basename(format ? sibling(inputs[0], format) : inputs[0])).split(sep).join("/");
    const own = !format && physical(output) === physical(dirname(resolve(inputs[0])));
    return fail(`-o ${output} is a folder: give the file to write${own ? "" : `, like -o ${quote(example)}`}`);
  }
  // -o is for a new file: the image itself, through a link or in another letter case (macOS,
  // Windows), would be written over, and its in-place checks skipped (shrink.js)
  if (output !== undefined && physical(resolve(output)) === physical(resolve(inputs[0]))) {
    return fail(`-o ${output} is ${inputs[0]} itself: give another name, or leave out -o to shrink it in place`);
  }
  if (output !== undefined) {
    // OUT's extension says what to write, so a PNG never lands under a JPEG's name
    const named = NAMED[extname(output).toLowerCase()];
    if (format && named && named !== format) return fail(`--format ${format} and -o ${output} name different formats: give one of them`);
    if (Object.hasOwn(FORMATS, named)) format = named;
    else {
      const type = kindOf(inputs[0]);
      if (type && type !== named) return fail(`-o ${output}: ${inputs[0]} is a ${type === "png" ? "PNG, so OUT must end in .png" : "JPEG, so OUT must end in .jpg or .jpeg"}, or in .webp or .avif to write that format`);
    }
  }
  if (format) {
    const images = once(inputs.map((input) => ({ input }))).map(({ input }) => input);
    const mistake = output === undefined && clash(images, format);
    if (mistake) return fail(mistake);
    return writeCopies(images, { format, target, output });
  }

  const flagged = fromLint ? readFlagged(process.cwd()) : null;
  if (fromLint && !flagged) {
    console.error(`oxlint-plugin-slimdeer: ${NO_LIST}`);
    return 1;
  }
  if (fromLint && flagged.length === 0) {
    console.log("the last lint here left no images to shrink with --flagged");
    return 0;
  }
  // an image changed since the lint isn't the one it flagged (summary.js): left as it is
  const changed = fromLint ? flagged.filter((image) => image.changed) : [];
  for (const { file } of changed) console.error(printable(`${pathFrom(process.cwd(), file)}: changed since the last lint here; left as is (lint again to check it)`));
  // each image, the path to show for it, and its target: a --target given here wins over the lint's.
  // From a lint's list, also the key of the bytes readFlagged() just found there, the ones the lint
  // measured: the shrink checks them again when the image's turn comes (shrink.js).
  const jobs = once(
    fromLint
      ? flagged.filter((image) => !image.changed).map((image) => ({ input: pathFrom(process.cwd(), image.file), target: targeted ? target : image.target, lint: { key: fileKey(image.file, image.target)?.key, target: image.target } }))
      : inputs.map((input) => ({ input, target })),
  );
  if (jobs.length === 0) return 1;

  // one image runs here; several run on a pool of engines, one per core, each line printed as it lands
  if (jobs.length === 1) {
    const [{ input, target, lint }] = jobs;
    try {
      // with -o, say where it wrote, so a preview doesn't read like an in-place write
      console.log(printable(`${output === undefined ? input : `${input} → ${output}`}: ${shrink(input, output ?? input, target, lint).text}`));
      return changed.length ? 1 : 0;
    } catch (error) {
      console.error(printable(`${input}: ${plain(error)}`));
      return 1;
    }
  }
  console.error(`slimdeer: shrinking ${count(jobs.length, "image")} in place (lossy; commit first so you can undo)`);
  let status = changed.length ? 1 : 0;
  let finished = 0;
  let original = 0;
  let compressed = 0;
  let shrunk = 0;
  const report = (input, result) => {
    const step = `[${++finished}/${jobs.length}] ${input}`;
    if (result.error) {
      console.error(printable(`${step}: ${result.error}`));
      status = 1;
      return;
    }
    console.log(printable(`${step}: ${result.text}`));
    if (result.written) {
      shrunk++;
      original += result.original;
      compressed += result.written;
    }
  };
  const work = [];
  for (const { input, target, lint } of jobs) {
    let bytes;
    try {
      bytes = readFileSync(input);
    } catch (error) {
      report(input, { error: plain(error) });
      continue;
    }
    // the pool goes by file size, the best guess of an image's time (batch.js)
    work.push({ input, size: bytes.length, peak: peakOf(bytes), message: { file: input, target, out: input, lint } });
  }
  try {
    await pool(work, { done: (job, result) => report(job.input, result) });
  } catch (error) {
    console.error(printable(`oxlint-plugin-slimdeer: ${plain(error)}`));
    return 1;
  }
  if (shrunk) {
    console.error(`slimdeer: ${count(shrunk, "image")}, ${size(original)} → ${size(compressed)} (${size(original - compressed)} smaller). Lint again to check.`);
  }
  return status;
}

/** Each image once: overlapping globs or ./ forms would shrink it twice, the second time lossily. */
function once(jobs) {
  const seen = new Set();
  return jobs.filter(({ input }) => {
    // as the filesystem spells it, so Logo.png and logo.png are one image on macOS and Windows; a
    // missing file is reported when it's read
    const path = physical(resolve(input));
    if (seen.has(path)) return false;
    seen.add(path);
    return true;
  });
}

/** "png", "jpeg", or null for a file that is neither or can't be read, which the work then says. */
function kindOf(path) {
  try {
    return kind(readFileSync(path));
  } catch {
    return null;
  }
}

function folder(path) {
  try {
    return statSync(path).isDirectory();
  } catch {
    // a new file
    return false;
  }
}

/** A mistake in the arguments: said in one line, which the usage would scroll away. */
function fail(message) {
  console.error(`oxlint-plugin-slimdeer: ${printable(message)}\nRun npx oxlint-plugin-slimdeer --help to see every option.`);
  return 2;
}

process.exitCode = await main(process.argv.slice(2));
