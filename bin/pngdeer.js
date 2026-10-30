#!/usr/bin/env node
// oxlint-plugin-pngdeer IN -o OUT [--target auto|T], as pngdeer's own command line takes it, with
// the engine the rule measures with: the file it writes is the one the warning promised. The file is
// marked as pngdeer's (src/marker.js), so the rule never measures it again, on any machine.
import { chmodSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { compress } from "../src/engine.js";
import { unsupported } from "../src/images.js";
import { mark, marked } from "../src/marker.js";
import { size } from "../src/text.js";

const USAGE = "usage: oxlint-plugin-pngdeer IN.png|IN.jpg -o OUT [--target auto|T]";

function main(args) {
  let input, output, target;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "-h" || arg === "--help") {
      console.log(USAGE);
      return;
    }
    if (arg === "-o" || arg === "--target") {
      const value = args[++i];
      if (value === undefined) throw new Error(`${arg} needs a value\n${USAGE}`);
      if (arg === "-o") output = value;
      else if (value !== "auto") {
        target = Number(value);
        if (!(target >= 0 && target <= 100)) throw new Error(`bad --target: ${value}`);
      }
    } else if (input === undefined && !arg.startsWith("-")) input = arg;
    else throw new Error(`unexpected ${arg}\n${USAGE}`);
  }
  if (input === undefined || output === undefined) throw new Error(USAGE);

  const bytes = readFileSync(input);
  const unchanged = (note) => {
    if (output !== input) save(output, bytes);
    console.error(`${input}: ${note}`);
  };
  if (marked(bytes)) {
    unchanged("already pngdeer's");
    return;
  }
  const why = unsupported(bytes);
  if (why) throw new Error(`${input}: ${why}`);

  let compressed, outcome, score;
  try {
    ({ output: compressed, outcome, score } = compress(bytes, target));
  } catch (error) {
    throw new Error(`${input}: ${error.message}`);
  }
  if (outcome === "miss") {
    const wanted = target === undefined ? "the automatic quality" : `--target ${target}`;
    throw new Error(`${input}: no smaller file reaches ${wanted} (the closest scores ${score.toFixed(1)}), so nothing was written`);
  }
  // the mark costs a few dozen bytes, more than pngdeer saves on some tiny files
  const result = outcome === "original" ? null : mark(compressed);
  if (!result || result.length >= bytes.length) {
    unchanged("already as small as pngdeer makes it");
    return;
  }
  save(output, result);
  const percent = Math.round(100 - (100 * result.length) / bytes.length);
  console.error(`${input}: ${size(bytes.length)} → ${size(result.length)} (${percent}% smaller)`);
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
    throw error;
  }
}

try {
  main(process.argv.slice(2));
} catch (error) {
  console.error(`oxlint-plugin-pngdeer: ${error.message}`);
  process.exitCode = 1;
}
