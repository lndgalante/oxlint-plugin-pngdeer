// One pngdeer engine per worker thread, doing what it's sent: { file, target } measures a file and
// reports sizes, the cache key of the bytes it actually read (the file may have changed since it was
// queued), and the key of its own output, so that file is recognized later if someone writes it to
// disk; { file, target, out } makes the file smaller on disk, as the command does (shrink.js).
import { readFileSync } from "node:fs";
import { parentPort } from "node:worker_threads";
import { key } from "./cache.js";
import { compress } from "./engine.js";
import { mark } from "./marker.js";
import { plain, shrink } from "./shrink.js";

parentPort.on("message", ({ file, target, out }) => {
  if (out !== undefined) {
    let reply;
    try {
      reply = shrink(file, out, target);
    } catch (error) {
      reply = { error: plain(error) };
    }
    parentPort.postMessage(reply);
    return;
  }
  const start = performance.now();
  let bytes;
  try {
    bytes = readFileSync(file);
  } catch (error) {
    parentPort.postMessage({ input: null, error: plain(error) });
    return;
  }
  const input = key(bytes, target);
  try {
    const { output, outcome, score } = compress(bytes, target);
    const ms = Math.round(performance.now() - start);
    // the size the command will write, mark included, so the warning and the command agree
    const compressed = outcome === "original" ? bytes.length : mark(output).length;
    parentPort.postMessage({ input, original: bytes.length, compressed, outcome, score, ms, output: key(output, target) });
  } catch (error) {
    parentPort.postMessage({ input, error: plain(error) });
  }
});
