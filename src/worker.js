// One pngdeer engine per worker thread: compresses the files it's sent and reports sizes, the cache
// key of the bytes it actually read (the file may have changed since it was queued), and the key of
// its own output, so that file is recognized later if someone writes it to disk.
import { readFileSync } from "node:fs";
import { parentPort, workerData } from "node:worker_threads";
import { compress, compress_jpeg, initSync } from "../engine/pngdeer_wasm.js";
import { key } from "./cache.js";
import { kind } from "./images.js";

initSync({ module: readFileSync(new URL("../engine/pngdeer_wasm_bg.wasm", import.meta.url)) });

const why = (error) => String(error?.message ?? error);

parentPort.on("message", ({ file }) => {
  const start = performance.now();
  let bytes;
  try {
    bytes = readFileSync(file);
  } catch (error) {
    parentPort.postMessage({ input: null, error: why(error) });
    return;
  }
  const input = key(bytes, workerData.target);
  try {
    const jpeg = kind(bytes) === "jpeg";
    const out = jpeg ? compress_jpeg(bytes, workerData.target) : compress(bytes, workerData.target);
    const output = jpeg ? out.jpeg : out.png;
    const { outcome } = JSON.parse(out.report);
    out.free();
    const ms = Math.round(performance.now() - start);
    parentPort.postMessage({ input, original: bytes.length, compressed: output.length, outcome, ms, output: key(output, workerData.target) });
  } catch (error) {
    parentPort.postMessage({ input, error: why(error) });
  }
});
