#!/usr/bin/env node
// oxlint-plugin-pngdeer: makes the images the lint rule flags smaller, with the engine the rule
// measures with, so each file it writes is the one the warning promised. Files it writes are marked
// as pngdeer's (src/marker.js), so the rule never measures them again, on any machine.
import { readFileSync } from "node:fs";
import { peakOf, pool } from "../src/batch.js";
import { plain, shrink } from "../src/shrink.js";
import { readFlagged } from "../src/summary.js";
import { count, pathFrom, size } from "../src/text.js";

const HELP = `usage: oxlint-plugin-pngdeer IMAGE... [--target auto|T]
       oxlint-plugin-pngdeer --flagged [--target auto|T]
       oxlint-plugin-pngdeer IMAGE -o OUT [--target auto|T]

Makes PNGs and JPEGs smaller with pngdeer, in place, at about the same visual quality.
pngdeer is lossy: the picture looks the same, the bytes don't, so commit first.

  --flagged     the images the last lint run from this folder warned about, each at the
                target it was measured at
  -o OUT        write to OUT instead of in place (one image only)
  --target T    the SSIMULACRA2 score to keep, 0-100 (90 looks identical at 1:1);
                auto (the default) picks one per image, about TinyPNG's quality
  -v, --version
  -h, --help

Files it writes are marked as pngdeer's, so the lint rule doesn't flag them again.`;

async function main(args) {
  const inputs = [];
  let output;
  let target;
  let targeted = false;
  let fromLint = false;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "-h" || arg === "--help") {
      console.log(HELP);
      return 0;
    }
    if (arg === "-v" || arg === "--version") {
      console.log(JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")).version);
      return 0;
    }
    if (arg === "--flagged") fromLint = true;
    else if (arg === "-o" || arg === "--target") {
      const value = args[++i];
      if (value === undefined) return fail(`${arg} needs a value`);
      if (arg === "-o") output = value;
      else {
        targeted = true;
        target = value === "auto" ? undefined : Number(value);
        if (target !== undefined && !(value.trim() !== "" && target >= 0 && target <= 100)) return fail(`--target must be auto or a number from 0 to 100, not ${value}`);
      }
    } else if (arg.startsWith("-") && arg !== "-") return fail(`unknown option ${arg}`);
    else inputs.push(arg);
  }
  if (fromLint && (inputs.length || output !== undefined)) return fail("--flagged takes no images and no -o");
  if (!fromLint && inputs.length === 0) return fail("no image given");
  if (output !== undefined && inputs.length > 1) return fail("-o takes one image; without it, each image is written in place");

  const flagged = fromLint ? readFlagged(process.cwd()) : null;
  if (fromLint && !flagged) {
    console.error("oxlint-plugin-pngdeer: no lint has run in this folder yet: run npx oxlint (or eslint) here first");
    return 1;
  }
  if (fromLint && flagged.length === 0) {
    console.log("the last lint here flagged nothing");
    return 0;
  }
  // each image, the path to show for it, and its target: a --target given here wins over the lint's
  const jobs = fromLint
    ? flagged.map((image) => ({
        input: pathFrom(process.cwd(), image.file),
        target: targeted ? target : image.target,
      }))
    : inputs.map((input) => ({ input, target }));

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

function fail(message) {
  console.error(`oxlint-plugin-pngdeer: ${message}\n\n${HELP}`);
  return 2;
}

process.exitCode = await main(process.argv.slice(2));
