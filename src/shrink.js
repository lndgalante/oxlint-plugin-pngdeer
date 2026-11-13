// Making one image smaller on disk: what the command does to each image it's given, in its own
// thread for one image or on the pool's engines for several (worker.js).
import { accessSync, chmodSync, constants, readFileSync, realpathSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { floored, key } from "./cache.js";
import { compress } from "./engine.js";
import { refuse } from "./images.js";
import { keepOrientation, mark, marked } from "./marker.js";
import { looks, size, smaller } from "./text.js";

/**
 * Writes `input` made smaller to `output`, marked: { text } saying what happened, plus
 * { original, written } sizes when it wrote a smaller file. Throws when it can't read or compress, or
 * with `lint` ({ key, target }, an entry of a lint's list) when the image holds other bytes than the
 * ones that lint measured.
 */
export function shrink(input, output, target, lint) {
  input = realpathSync(input);
  const named = output; // as given, for a line: realpath makes it absolute
  try {
    // Atomic replacement must update a symlink's target, preserving the link itself.
    output = realpathSync(output);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  const bytes = readFileSync(input);
  // -o's file that can't be written is named, or the line would blame the image, which is never written
  const put = (data) => {
    try {
      save(output, data);
    } catch (error) {
      throw output === input || !error.code ? error : new Error(`can't write ${named}: ${plain(error)}`);
    }
  };
  const unchanged = (note) => {
    if (output === input) return { text: `${note}; left as is` };
    // -o still writes its file, so a script always finds one; the line says it's a copy, or a
    // preview of the original would pass for slimdeer's result
    put(bytes);
    return { text: `${note}; copied as is` };
  };
  if (marked(bytes)) return unchanged("already shrunk by this command");
  // --flagged compares the list with the images as it starts (summary.js), but a long run leaves a
  // branch switch or an export time to land before an image's turn: these are the bytes it compresses
  if (lint?.key && key(bytes, lint.target) !== lint.key) throw new Error("changed since the last lint here; left as is (lint again to check it)");
  refuse(bytes);

  const { output: compressed, outcome, score } = compress(bytes, target);
  if (outcome === "miss") {
    // rounded down: a miss's best is below its target, and 90.5 shown as 91 would reach --target 91
    const best = `the best reaches quality ${Math.floor(score)}/100`;
    // the automatic target found only results that look visibly different (engine.js)
    if (floored({ outcome, score }, target)) return unchanged(`slimdeer can't make it smaller without a visible difference (${best})`);
    const wanted = target === undefined ? "the automatic quality" : `--target ${target}`;
    return unchanged(`no smaller file reaches ${wanted} (${best})`);
  }
  // the mark costs a few dozen bytes, more than slimdeer saves on some tiny files
  const result = outcome === "original" ? null : mark(keepOrientation(bytes, compressed));
  if (!result || result.length >= bytes.length) return unchanged("slimdeer can't make it smaller");
  // Compressing took seconds, and the image may have changed meanwhile (a re-export, a branch
  // switch): written in place, the old picture made smaller would replace the new one.
  if (output === input && !readFileSync(input).equals(bytes)) throw new Error("changed while shrinking; left as is");
  put(result);
  const quality = outcome === "hit" ? `quality ${Math.round(score)}/100: looks ${looks(score)}` : "lossless: looks identical";
  const text = `${size(bytes.length)} → ${size(result.length)} (${smaller(bytes.length, result.length)}% smaller, ${quality})`;
  return { text, original: bytes.length, written: result.length };
}

/** An error as one line a person can act on. */
export function plain(error) {
  if (error?.code === "ENOENT") return "no such file or folder";
  if (error?.code === "EACCES" || error?.code === "EPERM") return "permission denied";
  if (error?.code === "EISDIR") return "a folder, not an image";
  return String(error?.message ?? error);
}

/** Writes a whole new file or nothing: the image is often written over itself. */
export function save(path, bytes) {
  // The rename below needs only the folder to be writable: a read-only image (chmod 444, a Perforce
  // workspace) is left as it is, as cp and eslint --fix leave a read-only file.
  try {
    accessSync(path, constants.W_OK);
    // access() lets root write anything (Docker, CI containers): a file with no write bit is read-only all the same
    if ((statSync(path).mode & 0o222) === 0) throw Object.assign(new Error("permission denied"), { code: "EACCES" });
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  // unique per writer: the pool's engines share the process, and one image may come twice
  const tmp = join(dirname(path), `.${basename(path)}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`);
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
