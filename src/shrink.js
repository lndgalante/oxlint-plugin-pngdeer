// Making one image smaller on disk: what the command does to each image it's given, in its own
// thread for one image or on the pool's engines for several (worker.js).
import { chmodSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { compress } from "./engine.js";
import { unsupported } from "./images.js";
import { mark, marked } from "./marker.js";
import { looks, size, smaller } from "./text.js";

/**
 * Writes `input` made smaller to `output`, marked as pngdeer's: { text } saying what happened, plus
 * { original, written } sizes when it wrote a smaller file. Throws when it can't read or compress.
 */
export function shrink(input, output, target) {
  const bytes = readFileSync(input);
  const unchanged = (note) => {
    if (output !== input) save(output, bytes);
    return { text: `${note}; left as is` };
  };
  if (marked(bytes)) return unchanged("already pngdeer's");
  const why = unsupported(bytes);
  if (why) throw new Error(why);

  const { output: compressed, outcome, score } = compress(bytes, target);
  if (outcome === "miss") {
    const wanted = target === undefined ? "the automatic quality" : `--target ${target}`;
    return unchanged(`no smaller file reaches ${wanted} (the best reaches quality ${Math.round(score)}/100)`);
  }
  // the mark costs a few dozen bytes, more than pngdeer saves on some tiny files
  const result = outcome === "original" ? null : mark(compressed);
  if (!result || result.length >= bytes.length) return unchanged("pngdeer can't make it smaller");
  save(output, result);
  const quality = outcome === "hit" ? `quality ${Math.round(score)}/100: looks ${looks(score)}` : "lossless: looks identical";
  const text = `${size(bytes.length)} → ${size(result.length)} (${smaller(bytes.length, result.length)}% smaller, ${quality})`;
  return { text, original: bytes.length, written: result.length };
}

/** An error as one line a person can act on. */
export function plain(error) {
  if (error?.code === "ENOENT") return "no such file";
  if (error?.code === "EACCES" || error?.code === "EPERM") return "permission denied";
  if (error?.code === "EISDIR") return "a folder, not an image";
  return String(error?.message ?? error);
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
    if (error.code === "ENOENT") throw new Error(`can't write ${path}: its folder doesn't exist`);
    throw error;
  }
}
