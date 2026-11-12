// slimdeer, HeyDeer's engine (engine/), started on first use: one instance per thread.
import { readFileSync } from "node:fs";
import { compress as compressPng, compress_avif as compressAvif, compress_jpeg as compressJpeg, compress_webp as compressWebp, initSync } from "../engine/slimdeer_wasm.js";
import { belowFloor, FLOOR } from "./cache.js";
import { kind } from "./images.js";

let started = false;
// A panic skips the engine's cleanup, so what it held for that image stays allocated for good
let panicked = false;

const BUG = " (a bug in HeyDeer's slimdeer engine: please report it at https://github.com/heydeer/slimdeer/issues)";

/**
 * slimdeer's file for a PNG or JPEG, its outcome ("hit", "miss" when no file reaches the target,
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

/**
 * The image (a PNG or JPEG) as WebP or AVIF ("webp", "avif") at `target`, a score the caller always
 * gives: no floor and no retry. { output, outcome, score, target (as the engine rounded it, to 2
 * decimals), mode (WebP's "lossy" or "lossless", never shown as "lossless"; AVIF has none) }. Either
 * format is a hit when its score, as reported (to 3 decimals), reaches `target`, not the rounded one
 * the engine reports: WebP reports no outcome, and AVIF's compares the score before the report rounds
 * it, so it could call a file that shows the very score asked a miss. A PNG that eXIf turns comes out
 * unturned, so callers leave such PNGs out. Throws an Error with `refused` set when the engine turns
 * the image down (its own words), and a bug error, as compress() does, on a panic.
 */
export function convert(bytes, format, target) {
  if (format !== "webp" && format !== "avif") throw new TypeError(`convert() writes "webp" or "avif", not ${format}`);
  // the engine's search never ends at a NaN target
  if (!Number.isFinite(target)) throw new TypeError(`convert() needs a target score, not ${target}`);
  start();
  const webp = format === "webp";
  let out;
  try {
    out = webp ? compressWebp(bytes, target) : compressAvif(bytes, target);
  } catch (error) {
    if (error instanceof WebAssembly.RuntimeError) {
      panicked = true;
      throw new Error(`slimdeer couldn't write this image as ${webp ? "WebP" : "AVIF"}: ${error.message}${BUG}`);
    }
    // the engine turns an image down with a plain Error in its own words; anything else is a mistake in the call
    if (error.constructor !== Error) throw error;
    throw Object.assign(new Error(error.message), { refused: true });
  }
  try {
    // each getter copies out of the engine's memory, so each is read once
    const output = webp ? out.webp : out.avif;
    const report = JSON.parse(out.report);
    return { output, outcome: report.score >= target ? "hit" : "miss", score: report.score, target: report.target, mode: report.mode };
  } finally {
    out.free();
  }
}

/** Whether this thread's engine has panicked: it then holds memory it can't free (worker.js). */
export function trapped() {
  return panicked;
}

function start() {
  if (started) return;
  initSync({ module: readFileSync(new URL("../engine/slimdeer_wasm_bg.wasm", import.meta.url)) });
  started = true;
}

function run(bytes, target) {
  start();
  const jpeg = kind(bytes) === "jpeg";
  let out;
  try {
    out = jpeg ? compressJpeg(bytes, target) : compressPng(bytes, target);
  } catch (error) {
    // a panic inside the engine surfaces as a bare "unreachable"
    const bug = error instanceof WebAssembly.RuntimeError;
    if (bug) panicked = true;
    throw new Error(`slimdeer couldn't compress this image: ${error.message}${bug ? BUG : ""}`);
  }
  const output = jpeg ? out.jpeg : out.png;
  const { outcome, score } = JSON.parse(out.report);
  out.free();
  return { output, outcome, score };
}
