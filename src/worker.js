// One slimdeer engine per worker thread, doing what it's sent: { file, target } measures a file and
// reports sizes, the cache key of the bytes it actually read (the file may have changed since it was
// queued), and the key of its own output, so that file is recognized later if someone writes it to
// disk; { file, target, out, lint } makes the file smaller on disk, as the command does (shrink.js).
// With a `format` ("webp", "avif"): { file, target, format } measures the file as that format, and
// { file, target, format, out, mode } writes it as the command does (convert.js).
import { readFileSync } from "node:fs";
import { parentPort } from "node:worker_threads";
import { convertKey, key } from "./cache.js";
import { convertImage } from "./convert.js";
import { compress, convert, trapped } from "./engine.js";
import { keepOrientation, mark } from "./marker.js";
import { plain, save, shrink } from "./shrink.js";

parentPort.on("message", (message) => {
  const reply = answer(message);
  // an engine that panicked holds memory it can't free, and may fail images it would measure fine
  // otherwise: the pool replaces it (batch.js)
  parentPort.postMessage(trapped() ? { ...reply, trapped: true } : reply);
});

function answer({ file, target, format, out, mode, lint }) {
  if (format !== undefined) return mode === undefined ? measureCopy(file, target, format, out) : writeCopy(file, out, { format, target, mode });
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

/**
 * The file as `format` at `target`, a resolved score: { input (convertKey() of the bytes read), original,
 * compressed, outcome, score, target (as the engine reports it) }, or { input, error, refused }. A hit is
 * also written to `out`, if given (the review's previews); if that fails, the measurement comes with
 * the `error`.
 */
function measureCopy(file, target, format, out) {
  let bytes;
  try {
    bytes = readFileSync(file);
  } catch (error) {
    return { input: null, error: plain(error) };
  }
  const input = convertKey(bytes, target, format);
  let copy;
  try {
    copy = convert(bytes, format, target);
  } catch (error) {
    return { input, error: plain(error), refused: error.refused === true };
  }
  const reply = { input, original: bytes.length, compressed: copy.output.length, outcome: copy.outcome, score: copy.score, target: copy.target };
  if (out === undefined || copy.outcome !== "hit") return reply;
  try {
    save(out, copy.output);
  } catch (error) {
    reply.error = plain(error);
  }
  return reply;
}

/** convertImage()'s result, or { error }. */
function writeCopy(file, out, options) {
  try {
    return convertImage(file, out, options);
  } catch (error) {
    return { error: plain(error) };
  }
}
