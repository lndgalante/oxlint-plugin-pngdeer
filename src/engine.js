// pngdeer's wasm engine (engine/), started on first use: one instance per thread.
import { readFileSync } from "node:fs";
import { compress as compressPng, compress_jpeg as compressJpeg, initSync } from "../engine/pngdeer_wasm.js";
import { belowFloor, FLOOR } from "./cache.js";
import { kind } from "./images.js";

let started = false;
// A panic skips the engine's cleanup, so what it held for that image stays allocated for good
let panicked = false;

/**
 * pngdeer's file for a PNG or JPEG, its outcome ("hit", "miss" when no file reaches the target,
 * "exact", "lossless", or "original" when nothing smaller does) and its SSIMULACRA2 score. The
 * automatic target settles for no less than FLOOR: an image it would make visibly different is
 * compressed again at FLOOR, and is a miss if nothing reaches it.
 */
export function compress(bytes, target) {
  const result = run(bytes, target);
  if (target !== undefined || !belowFloor(result)) return result;
  try {
    const retry = run(bytes, FLOOR);
    // the engine's hits at FLOOR score FLOOR or more today; one that still rounds below would read
    // "visibly different" too
    return belowFloor(retry) ? { ...retry, outcome: "miss" } : retry;
  } catch {
    // the engine can fail at a target it handles automatically (a fade to transparent, from 62 up)
    return { ...result, outcome: "miss" };
  }
}

/** Whether this thread's engine has panicked: it then holds memory it can't free (worker.js). */
export function trapped() {
  return panicked;
}

function run(bytes, target) {
  if (!started) {
    initSync({ module: readFileSync(new URL("../engine/pngdeer_wasm_bg.wasm", import.meta.url)) });
    started = true;
  }
  const jpeg = kind(bytes) === "jpeg";
  let out;
  try {
    out = jpeg ? compressJpeg(bytes, target) : compressPng(bytes, target);
  } catch (error) {
    // a panic inside the engine surfaces as a bare "unreachable"
    const bug = error instanceof WebAssembly.RuntimeError;
    if (bug) panicked = true;
    // upstream renamed its engine slimdeer: said so, as the link names it
    throw new Error(`pngdeer couldn't compress this image: ${error.message}${bug ? " (a bug in pngdeer's engine, now named slimdeer: please report it at https://github.com/heydeer/slimdeer/issues)" : ""}`);
  }
  const output = jpeg ? out.jpeg : out.png;
  const { outcome, score } = JSON.parse(out.report);
  out.free();
  return { output, outcome, score };
}
