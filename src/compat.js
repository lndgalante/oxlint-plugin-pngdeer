// The names this package had as oxlint-plugin-pngdeer, before 0.6.0, that a project may still use:
// the rule keeps working with them and says, a line each, how to move. The mark the command writes
// into images keeps the old word for good (marker.js), so it isn't here.
import { existsSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { isMainThread } from "node:worker_threads";
import { say } from "./progress.js";
import { physical } from "./scan.js";
import { pathFrom, printable } from "./text.js";

const OLD = "pngdeer";
export const OLD_RULE = `${OLD}/compressible-image`;
const RULE = "slimdeer/compressible-image";
// the old comments a run names one by one; the rest get one line that says how to find them
const COMMENTS = 5;

const said = new Set(); // the keys of the notices this process said
let named = 0; // old comments named
/** A lint thread's notices, as [key, text], for the main thread to say as the run ends (summary.js). */
export const pending = [];

/**
 * The plugin's settings: settings.slimdeer, else settings.pngdeer, with a line that says to rename
 * the old key, or, when both are set, that it is ignored. Quiet when `quiet` (an editor), and under
 * the old name's alias, where `id`, the rule as the config names it, is the old one.
 */
export function pluginSettings(all, { id, quiet }) {
  const settings = all.slimdeer ?? all[OLD] ?? {};
  if (all[OLD] && !quiet && id !== OLD_RULE) {
    if (settings === all[OLD]) notice("settings", "slimdeer: reading settings.pngdeer, the old name of settings.slimdeer; rename it in your lint config");
    else notice("both settings", "slimdeer: settings.pngdeer is ignored, since settings.slimdeer is set; remove it from your lint config");
  }
  return settings;
}

/** Names each disable comment in `file` that turns the rule off by its old name, at its `line`, with `file` written from `cwd`. */
export function oldCommentLines(file, comments, cwd) {
  for (const { line } of comments) {
    const where = `${pathFrom(cwd, file)}:${line}`;
    notice(`comment ${file}:${line}`, `slimdeer: ${where} turns off ${OLD_RULE}, this rule's old name, so the warning shows there again; write ${RULE} instead (until then, --flagged still leaves that image alone)`);
  }
}

/**
 * Names each of the default cache `folders` a batch is about to measure into whose old-name sibling
 * (node_modules/.cache/pngdeer) is there: this version doesn't read it, so its results are measured
 * again. Both written from `cwd`, as the filesystem spells them, or a link (macOS's /var) would
 * give a long ../ chain.
 */
export function oldCacheLines(folders, cwd) {
  for (const folder of folders) {
    if (basename(folder) !== "slimdeer" || !existsSync(join(dirname(folder), OLD))) continue;
    const from = physical(cwd);
    const parent = physical(dirname(folder));
    notice(`cache ${parent}`, `slimdeer: ${pathFrom(from, join(parent, OLD))} holds results from oxlint-plugin-pngdeer, which this version doesn't read, so these images are measured again; delete that folder, and save ${pathFrom(from, join(parent, "slimdeer"))} in any CI cache step instead`);
  }
}

/** Says that with measure "never", images the lint names have no result in `folder`, so `command` (text.js) should fill it. */
export function neverLine(command, folder) {
  notice("never", `slimdeer: measure is "never", and images named here have no result in ${folder}, so they weren't checked; to fill it, run${command.shell}: ${command.text}`);
}

/**
 * Says `text` once per process, by `key`, and no more than COMMENTS old comments. oxlint and ESLint
 * lint on the main thread, which says it at once. ESLint's --concurrency lints in worker threads, each
 * with its own copy of this module: there it waits in `pending`, and the main thread says it, once,
 * as it says the summary (summary.js).
 */
export function notice(key, text) {
  if (said.has(key)) return;
  if (key.startsWith("comment ") && named++ >= COMMENTS) {
    return notice("more comments", `slimdeer: more disable comments name ${OLD_RULE}; find them all with: git grep -n ${OLD_RULE}`);
  }
  said.add(key);
  if (isMainThread) say(`${printable(text)}\n`);
  else pending.push([key, text]);
}
