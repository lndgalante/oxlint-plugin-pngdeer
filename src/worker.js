// One pngdeer engine per worker thread, doing what it's sent: { file, target } measures a file and
// reports sizes, the cache key of the bytes it actually read (the file may have changed since it was
// queued), and the key of its own output, so that file is recognized later if someone writes it to
// disk; { file, target, out, lint } makes the file smaller on disk, as the command does (shrink.js).
import { readFileSync } from "node:fs";
import { parentPort } from "node:worker_threads";
import { key } from "./cache.js";
import { compress, trapped } from "./engine.js";
import { keepOrientation, mark } from "./marker.js";
import { plain, shrink } from "./shrink.js";

parentPort.on("message", (message) => {
  const reply = answer(message);
  // an engine that panicked holds memory it can't free, and may fail images it would measure fine
  // otherwise: the pool replaces it (batch.js)
  parentPort.postMessage(trapped() ? { ...reply, trapped: true } : reply);
});

function answer({ file, target, out, lint }) {
  if (out !== undefined) {
    try {
      return shrink(file, out, target, lint);
    } catch (error) {
      return { error: plain(error) };
    }
  }
  let bytes;
  try {
    bytes = readFileSync(file);
  } catch (error) {
    return { input: null, error: plain(error) };
  }
  const input = key(bytes, target);
  try {
    const { output, outcome, score } = compress(bytes, target);
    // the size the command will write, mark included, so the warning and the command agree
    const compressed = outcome === "original" ? bytes.length : mark(keepOrientation(bytes, output)).length;
    return { input, original: bytes.length, compressed, outcome, score, output: key(output, target) };
  } catch (error) {
    return { input, error: plain(error) };
  }
}
