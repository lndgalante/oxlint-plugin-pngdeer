#!/usr/bin/env node
// Checks or shrinks images with the same engine and targets as the lint rule.
import { readFileSync, realpathSync } from "node:fs";
import { peakOf, pool } from "../src/batch.js";
import { plain, shrink } from "../src/shrink.js";
import { readFlagged } from "../src/summary.js";
import { count, pathFrom, size } from "../src/text.js";

const HELP = `usage: oxlint-plugin-pngdeer IMAGE... [--target auto|T]
       oxlint-plugin-pngdeer --flagged [--target auto|T]
       oxlint-plugin-pngdeer IMAGE -o OUT [--target auto|T]
       oxlint-plugin-pngdeer --check [IMAGE|DIR...] [options]

Makes PNGs and JPEGs smaller with pngdeer, in place, at about the same visual quality.
pngdeer is lossy: the picture looks the same, the bytes don't, so commit first.
Use --check to measure savings without changing images.

  --check       check files or directories (default: this directory); warms the cache
  --flagged     images from the last lint run here, at their measured targets;
                shared images with conflicting quality targets are left out
  -o OUT        write to OUT instead of in place (one image only)
  --target T    the SSIMULACRA2 score to keep, 0-100 (90 looks identical at 1:1);
                auto (the default) picks one per image, about TinyPNG's quality
  --min-saved-bytes N    minimum saving to report in --check (default: 4096)
  --min-saved-percent N  minimum percentage to report in --check (default: 10)
  --exclude PATTERN     exclude a project-relative file, directory or glob in --check;
                        supports *, ** and ?; repeat this option for more exclusions
  --cache-dir PATH      cache directory relative to each project root, for --check
  --            treat all remaining arguments as image paths
  -v, --version
  -h, --help

--check exits 0 when clean, 1 when savings meet both thresholds, and 2 on errors.
It uses explicit options, without reading linter configuration.
Files it writes are marked as pngdeer's, so the lint rule doesn't flag them again.`;

const CHECK_OPTIONS = {
  "--min-saved-bytes": "minSavedBytes",
  "--min-saved-percent": "minSavedPercent",
  "--exclude": "exclude",
  "--cache-dir": "cacheDir",
};

async function main(args) {
  const inputs = [];
  let output;
  let target;
  let targeted = false;
  let fromLint = false;
  let checking = false;
  const checkOptions = {};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--") {
      inputs.push(...args.slice(i + 1));
      break;
    }
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
    else if (arg === "-o" || arg === "--target" || Object.hasOwn(CHECK_OPTIONS, arg)) {
      const value = args[++i];
      if (value === undefined || value.startsWith("--") || ["-h", "-v", "-o"].includes(value)) return fail(`${arg} needs a value`);
      if (arg === "-o") output = value;
      else if (arg === "--target") {
        targeted = true;
        target = value === "auto" ? undefined : Number(value);
        if (target !== undefined && !(value.trim() !== "" && target >= 0 && target <= 100)) return fail(`--target must be auto or a number from 0 to 100, not ${value}`);
      } else if (arg === "--exclude" || arg === "--cache-dir") {
        if (!value.trim() || value.startsWith("--")) return fail(`${arg} needs a nonempty value`);
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
  if (checking) {
    if (fromLint || output !== undefined) return fail("--check cannot be combined with --flagged or -o");
    try {
      const { check } = await import("../src/check.js");
      return await check(inputs.length ? inputs : ["."], { ...checkOptions, target });
    } catch (error) {
      console.error(`oxlint-plugin-pngdeer: ${plain(error)}`);
      return 2;
    }
  }
  if (Object.keys(checkOptions).length) return fail("--min-saved-bytes, --min-saved-percent, --exclude and --cache-dir require --check");
  if (fromLint && (inputs.length || output !== undefined)) return fail("--flagged takes no images and no -o");
  if (!fromLint && inputs.length === 0) return fail("no image given");
  if (output !== undefined && inputs.length > 1) return fail("-o takes one image; without it, each image is written in place");

  const flagged = fromLint ? readFlagged(process.cwd()) : null;
  if (fromLint && !flagged) {
    console.error("oxlint-plugin-pngdeer: no lint has run in this folder yet: run npx oxlint (or eslint) here first");
    return 1;
  }
  if (fromLint && flagged.length === 0) {
    console.log("the last lint here left no images to shrink with --flagged");
    return 0;
  }
  // each image, the path to show for it, and its target: a --target given here wins over the lint's
  const jobs = once(
    fromLint
      ? flagged.map((image) => ({ input: pathFrom(process.cwd(), image.file), target: targeted ? target : image.target }))
      : inputs.map((input) => ({ input, target })),
  );

  // one image runs here; several run on a pool of engines, one per core, each line printed as it lands
  if (jobs.length === 1) {
    const [{ input, target }] = jobs;
    try {
      console.log(`${input}: ${shrink(input, output ?? input, target).text}`);
      return 0;
    } catch (error) {
      console.error(`${input}: ${plain(error)}`);
      return 1;
    }
  }
  console.error(`pngdeer: shrinking ${count(jobs.length, "image")} in place (lossy; commit first so you can undo)`);
  let status = 0;
  let finished = 0;
  let original = 0;
  let compressed = 0;
  let shrunk = 0;
  const report = (input, result) => {
    const step = `[${++finished}/${jobs.length}] ${input}`;
    if (result.error) {
      console.error(`${step}: ${result.error}`);
      status = 1;
      return;
    }
    console.log(`${step}: ${result.text}`);
    if (result.written) {
      shrunk++;
      original += result.original;
      compressed += result.written;
    }
  };
  const work = [];
  for (const { input, target } of jobs) {
    let bytes;
    try {
      bytes = readFileSync(input);
    } catch (error) {
      report(input, { error: plain(error) });
      continue;
    }
    work.push({ input, peak: peakOf(bytes), message: { file: input, target, out: input } });
  }
  try {
    await pool(work, { done: (job, result) => report(job.input, result) });
  } catch (error) {
    console.error(`oxlint-plugin-pngdeer: ${plain(error)}`);
    return 1;
  }
  if (shrunk) {
    console.error(`pngdeer: ${count(shrunk, "image")}, ${size(original)} → ${size(compressed)} (${size(original - compressed)} smaller). Lint again to check.`);
  }
  return status;
}

/** Each image once: overlapping globs or ./ forms would shrink it twice, the second time lossily. */
function once(jobs) {
  const seen = new Set();
  return jobs.filter(({ input }) => {
    let path = input;
    try {
      path = realpathSync(input);
    } catch {
      // a missing file is reported when it's read
    }
    if (seen.has(path)) return false;
    seen.add(path);
    return true;
  });
}

function fail(message) {
  console.error(`oxlint-plugin-pngdeer: ${message}\n\n${HELP}`);
  return 2;
}

process.exitCode = await main(process.argv.slice(2));
