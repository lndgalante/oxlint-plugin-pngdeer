// pngdeer's wasm engine (engine/), started on first use: one instance per thread.
import { readFileSync } from "node:fs";
import { compress as compressPng, compress_jpeg as compressJpeg, initSync } from "../engine/pngdeer_wasm.js";
import { kind } from "./images.js";

let started = false;

/** pngdeer's file for a PNG or JPEG, and its outcome: "hit", "miss", "exact", "lossless" or "original" (unchanged). */
export function compress(bytes, target) {
  if (!started) {
    initSync({ module: readFileSync(new URL("../engine/pngdeer_wasm_bg.wasm", import.meta.url)) });
    started = true;
  }
  const jpeg = kind(bytes) === "jpeg";
  const out = jpeg ? compressJpeg(bytes, target) : compressPng(bytes, target);
  const output = jpeg ? out.jpeg : out.png;
  const { outcome } = JSON.parse(out.report);
  out.free();
  return { output, outcome };
}
