#!/usr/bin/env node
// pngdeer IN -o OUT [--target auto|T], as pngdeer's own command line takes it, with the engine the
// rule measures with: the file it writes is the one the warning promised. The file is marked as
// pngdeer's (src/marker.js), so the rule never measures it again, on any machine.
import { readFileSync, writeFileSync } from "node:fs";
import { compress } from "../src/engine.js";
import { unsupported } from "../src/images.js";
import { mark, marked } from "../src/marker.js";
import { size } from "../src/text.js";

const USAGE = "usage: pngdeer IN.png|IN.jpg -o OUT [--target auto|T]";

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
  if (marked(bytes)) {
    if (output !== input) writeFileSync(output, bytes);
    console.error(`${input}: already pngdeer's`);
    return;
  }
  const why = unsupported(bytes);
  if (why) throw new Error(`${input}: ${why}`);

  const { output: compressed, outcome } = compress(bytes, target);
  // "original": nothing smaller keeps the quality, so the file stays as it was
  const result = outcome === "original" ? bytes : mark(compressed);
  writeFileSync(output, result);
  const percent = Math.round(100 - (100 * result.length) / bytes.length);
  console.error(outcome === "original" ? `${input}: already as small as pngdeer makes it` : `${input}: ${size(bytes.length)} → ${size(result.length)} (${percent}% smaller)`);
}

try {
  main(process.argv.slice(2));
} catch (error) {
  console.error(`pngdeer: ${error.message}`);
  process.exitCode = 1;
}
