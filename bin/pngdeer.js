#!/usr/bin/env node
// oxlint-plugin-pngdeer: makes the images the lint rule flags smaller, with the engine the rule
// measures with, so each file it writes is the one the warning promised. Files it writes are marked
// as pngdeer's (src/marker.js), so the rule never measures them again, on any machine.
import { chmodSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { compress } from "../src/engine.js";
import { unsupported } from "../src/images.js";
import { mark, marked } from "../src/marker.js";
import { size } from "../src/text.js";

const HELP = `usage: oxlint-plugin-pngdeer IMAGE... [--target auto|T]
       oxlint-plugin-pngdeer IMAGE -o OUT [--target auto|T]

Makes PNGs and JPEGs smaller with pngdeer, in place, at about the same visual quality.
pngdeer is lossy: the picture looks the same, the bytes don't, so commit first.

  -o OUT        write to OUT instead of in place (one image only)
  --target T    the SSIMULACRA2 score to keep, 0-100 (90 looks identical at 1:1);
                auto (the default) picks one per image, about TinyPNG's quality
  -v, --version
  -h, --help

Files it writes are marked as pngdeer's, so the lint rule doesn't flag them again.`;

function main(args) {
  const inputs = [];
  let output;
  let target;
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
    if (arg === "-o" || arg === "--target") {
      const value = args[++i];
      if (value === undefined) return fail(`${arg} needs a value`);
      if (arg === "-o") output = value;
      else if (value !== "auto") {
        target = Number(value);
        if (!(value.trim() !== "" && target >= 0 && target <= 100)) return fail(`--target must be auto or a number from 0 to 100, not ${value}`);
      }
    } else if (arg.startsWith("-") && arg !== "-") return fail(`unknown option ${arg}`);
    else inputs.push(arg);
  }
  if (inputs.length === 0) return fail("no image given");
  if (output !== undefined && inputs.length > 1) return fail("-o takes one image; without it, each image is written in place");

  let status = 0;
  for (const input of inputs) {
    try {
      console.log(`${input}: ${shrink(input, output ?? input, target)}`);
    } catch (error) {
      console.error(`${input}: ${plain(error)}`);
      status = 1;
    }
  }
  return status;
}

/** Writes `input` made smaller to `output`, and says what happened. */
function shrink(input, output, target) {
  const bytes = readFileSync(input);
  const unchanged = (note) => {
    if (output !== input) save(output, bytes);
    return `${note}; left as is`;
  };
  if (marked(bytes)) return unchanged("already pngdeer's");
  const why = unsupported(bytes);
  if (why) throw new Error(why);

  const { output: compressed, outcome, score } = compress(bytes, target);
  if (outcome === "miss") {
    const wanted = target === undefined ? "the automatic quality" : `--target ${target}`;
    return unchanged(`no smaller file reaches ${wanted} (the best scores ${score.toFixed(1)})`);
  }
  // the mark costs a few dozen bytes, more than pngdeer saves on some tiny files
  const result = outcome === "original" ? null : mark(compressed);
  if (!result || result.length >= bytes.length) return unchanged("pngdeer can't make it smaller");
  save(output, result);
  const percent = Math.round(100 - (100 * result.length) / bytes.length);
  return `${size(bytes.length)} → ${size(result.length)} (${percent}% smaller, SSIMULACRA2 ${score.toFixed(1)})`;
}

/** Writes a whole new file or nothing: the image is often written over itself. */
function save(path, bytes) {
  const tmp = join(dirname(path), `.${basename(path)}.${process.pid}.tmp`);
  try {
    writeFileSync(tmp, bytes);
    try {
      chmodSync(tmp, statSync(path).mode & 0o7777);
    } catch {
      // a new file keeps the default mode
    }
    renameSync(tmp, path);
  } catch (error) {
    rmSync(tmp, { force: true });
    if (error.code === "ENOENT") throw new Error(`can't write ${path}: its folder doesn't exist`);
    throw error;
  }
}

/** An error as one line a person can act on. */
function plain(error) {
  if (error.code === "ENOENT") return "no such file";
  if (error.code === "EACCES" || error.code === "EPERM") return "permission denied";
  if (error.code === "EISDIR") return "a folder, not an image";
  return error.message;
}

function fail(message) {
  console.error(`oxlint-plugin-pngdeer: ${message}\n\n${HELP}`);
  return 2;
}

process.exitCode = main(process.argv.slice(2));
