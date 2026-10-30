// pngdeer's wasm engine (engine/), started on first use: one instance per thread.
import { readFileSync } from "node:fs";
import { compress as compressPng, compress_jpeg as compressJpeg, initSync } from "../engine/pngdeer_wasm.js";
import { kind } from "./images.js";

let started = false;

/**
 * pngdeer's file for a PNG or JPEG, its outcome ("hit", "miss" when no file reaches the target,
 * "exact", "lossless", or "original" when nothing smaller does) and its SSIMULACRA2 score.
 */
export function compress(bytes, target) {
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
    const bug = error instanceof WebAssembly.RuntimeError ? " (a bug in pngdeer: please report it at https://github.com/heydeer/pngdeer/issues)" : "";
    throw new Error(`pngdeer couldn't compress this image: ${error.message}${bug}`);
  }
  const output = jpeg ? out.jpeg : out.png;
  const { outcome, score } = JSON.parse(out.report);
  out.free();
  return { output, outcome, score };
}
