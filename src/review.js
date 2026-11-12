// --review: every image --check would list (with --flagged, the images the last lint flagged), written
// as a preview of what the command makes of it, beside a page that compares each one with its
// original, so the result can be seen before any image changes. Nothing leaves the machine: the page
// is a file, and opens only with --open.
import { spawn } from "node:child_process";
import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { isAbsolute, join, relative, resolve, sep, win32 } from "node:path";
import { pathToFileURL } from "node:url";
import { peakOf, pool } from "./batch.js";
import { cacheDir, key } from "./cache.js";
import { measureAll, notes, print, shortened } from "./check.js";
import { dimensions, kind, pngChunk } from "./images.js";
import { marked } from "./marker.js";
import { unwrapped } from "./progress.js";
import { commandCount, page } from "./review-page.js";
import { projectRoot } from "./scan.js";
import { plain } from "./shrink.js";
import { count, pathFrom, printable, reviewCommand, size, smaller } from "./text.js";

const ISSUES = "https://github.com/lndgalante/oxlint-plugin-pngdeer/issues";
// How long --open waits for the opener to give up before it takes the page as opening.
const SETTLE = 2000;

/**
 * Measures what --check would (cached results are reused), or with `flagged` ([{ file, target,
 * cacheDir, changed }]) the images the last lint here flagged, each at its own target, from the
 * cache folder the lint measured it into; writes each listed image's preview and a page comparing
 * them into the review folder of the project the command runs in, and says where it is. Resolves 0
 * when the page was written or there's nothing to review, 2 when an image couldn't be measured or
 * previewed (the page still shows the rest).
 */
export async function review(inputs, { cwd = process.cwd(), target, minSavedBytes, minSavedPercent, exclude, cacheDir: customCacheDir, open = false, flagged } = {}) {
  cwd = resolve(cwd);
  // what an error that may clear on its own says to run again: this review, not --check
  const again = flagged ? "--review --flagged" : "--review";
  const options = { cwd, target, minSavedBytes, minSavedPercent, exclude, cacheDir: customCacheDir, again };
  // the local cache, never a --cache-dir that may be committed
  const folder = join(cacheDir(projectRoot(cwd, cwd)), "review");
  // an image changed since the lint isn't the one it flagged (summary.js): neither measured nor shown
  const changed = (flagged ?? []).filter((image) => image.changed).map(({ file }) => ({ file, path: pathFrom(cwd, file), message: "changed since the last lint here; lint again to check it" }));
  const lists = flagged ? await measureFlagged(flagged.filter((image) => !image.changed), options) : [{ inputs, settings: options, result: await measureAll(inputs, options) }];
  const all = (part) => lists.flatMap(({ result }) => result[part]);
  // each image that missed with the target it missed, for the page
  const result = { rows: all("rows"), declined: all("declined"), missed: lists.flatMap(({ settings, result }) => result.missed.map((image) => ({ ...image, target: settings.target }))), errors: [...changed, ...all("errors")] };
  // what the page leaves out, as --check says it (for a lint's list, of each target's images), with
  // --review where a note gives the same run again (a lint's list names each image, so it gets none)
  const unlisted = lists.flatMap(({ inputs, settings, result }) => notes(inputs, result, settings, reviewCommand));
  // what couldn't be checked, before the previews take their time
  for (const { path, message } of result.errors) console.error(printable(`${path}: ${shortened(message)}`));
  if (result.rows.length === 0) {
    try {
      // a page left from an earlier run would show savings that are gone
      rmSync(folder, { recursive: true, force: true });
    } catch (cause) {
      console.error(printable(`pngdeer: couldn't remove the old review page in ${pathFrom(cwd, folder)}: ${denied(cause)}`));
    }
    // everything is measured now: --check says what it found in its own words, without its job
    // summary, which would be titled --check and point at no page; then that there's no page, as a
    // tab still showing the old one would pass for this run's
    if (!flagged) {
      const status = print(inputs, lists[0].result, { ...options, summary: false });
      console.log("pngdeer: no image to compare, so no page was written.");
      return status;
    }
    for (const line of unlisted) console.log(printable(line));
    console.log(`pngdeer: ${nothing(flagged, result.errors.length, target)}`);
    return result.errors.length ? 2 : 0;
  }

  const errors = [...result.errors];
  const cards = await previews(result.rows, folder, cwd, again, (file, path, message) => {
    errors.push({ file, path, message });
    console.error(printable(`${path}: ${message}`));
  });
  if (cards.length === 0) {
    console.log("pngdeer: review incomplete: no preview could be written. Images unchanged.");
    return 2;
  }
  const index = join(folder, "index.html");
  // the options that check the images left out again: a lint's list was measured without thresholds
  const settings = flagged ? { cacheDir: customCacheDir } : { exclude, cacheDir: customCacheDir, minSavedBytes, minSavedPercent };
  const html = page({ cwd, date: stamp(new Date()), target, cards, declined: result.declined, missed: result.missed, errors, settings });
  writable(cwd, folder, () => {
    const tmp = `${index}.${process.pid}.tmp`;
    writeFileSync(tmp, html);
    renameSync(tmp, index);
  });

  const files = cards.reduce((sum, card) => sum + card.paths.length, 0);
  const original = cards.reduce((sum, card) => sum + card.total.original, 0);
  const compressed = cards.reduce((sum, card) => sum + card.total.compressed, 0);
  const one = cards.length === 1;
  // the page gives a command per target, and splits a long one
  const several = commandCount(cards) > 1;
  console.log(`pngdeer: ${count(files, "image")} could be ${size(original - compressed)} smaller (${size(original)} → ${size(compressed)}, ${smaller(original, compressed)}% smaller). Images unchanged.`);
  // the terminal names what the page leaves out too
  for (const line of unlisted) console.log(printable(line));
  console.log(`pngdeer: the page that compares ${one ? "it" : "each one"} before and after: ${pathToFileURL(index).href}`);
  const failure = open ? await launch(index) : null;
  const gives = `run the ${several ? "commands" : "command"} it gives.`;
  const next = one ? `if the after looks right, ${gives}` : `untick any image to keep as it is, and ${gives}`;
  console.log(`pngdeer: ${open && !failure ? "opening it in your browser;" : `open it in a browser,${one ? " and" : ""}`} ${next}`);
  if (failure) console.error(printable(`pngdeer: couldn't open a browser: ${failure}`));
  return errors.length ? 2 : 0;
}

/**
 * Measures the images a lint flagged, each at its own target and from the cache folder the lint
 * measured it into (so nothing it measured is measured again), a measureAll() per target and folder:
 * [{ inputs, settings, result }]. The lint applied its thresholds: an image is shown if pngdeer still
 * makes it smaller at all.
 */
async function measureFlagged(flagged, options) {
  const groups = new Map(); // [target, cache folder] -> its images
  for (const { file, target, cacheDir } of flagged) {
    const group = JSON.stringify([target, cacheDir]);
    groups.set(group, { target, cacheDir, inputs: [...(groups.get(group)?.inputs ?? []), file] });
  }
  const lists = [];
  for (const { target, cacheDir, inputs } of groups.values()) {
    const result = await measureAll(inputs, { ...options, target, cacheDir, minSavedBytes: 0, minSavedPercent: 0 });
    // --check's notes for them, with its own thresholds and the --cache-dir given, if any, in the
    // commands they give
    lists.push({ inputs, settings: { cwd: options.cwd, target, cacheDir: options.cacheDir }, result });
  }
  return lists;
}

/**
 * What a review of a lint's list (`flagged`) says when it shows none: none listed (a lint that held
 * every image it flagged back from --flagged leaves an empty list too), none that could be checked,
 * or none that pngdeer still makes smaller (at `target`, the --target given here, if one was).
 */
function nothing(flagged, failed, target) {
  if (flagged.length === 0) return "the last lint here left no images to review with --flagged.";
  // a list that names an image gone or changed since is out of date; one the cache folder failed
  // for isn't
  const gone = flagged.some(({ file, changed }) => changed || !existsSync(file));
  if (failed) return `review incomplete: none of the images the last lint here flagged could be shown${gone ? "; lint again to update the list" : ""}.`;
  const which = flagged.length === 1 ? "the image the last lint here flagged can't" : `none of the ${flagged.length} images the last lint here flagged can`;
  // at a target given here, linting again would leave the same list: the target is why
  if (target !== undefined) return `${which} be made smaller at --target ${target}, so there is nothing to review.`;
  return `${which} be made smaller now, so there is nothing to review; lint again to update the list.`;
}

/**
 * Writes the preview of each row into `folder` on the pool's engines, at the row's target: the bytes
 * the command writes in place, so what the page shows is what the command does. A preview from an
 * earlier run is kept when its image hasn't changed (its name is the image's cache key), so a second
 * review is quick and an interrupted one goes on where it stopped; everything else in the folder
 * goes. Copies of one image share a preview, and a card. Resolves the cards previewed, biggest saving
 * first, each with its URLs from the folder and its pixel size; reports the images it couldn't
 * preview to `error(file, path, message)`, naming `again` where running it again may help.
 */
async function previews(rows, folder, cwd, again, error) {
  try {
    mkdirSync(folder, { recursive: true });
  } catch (cause) {
    throw new Error(`can't make the review folder ${pathFrom(cwd, folder)}: ${["EEXIST", "ENOTDIR"].includes(cause.code) ? "a file is in the way" : plain(cause)}`);
  }
  // a review empties its folder of what it doesn't write: through a link (to public/, a home folder),
  // that would be someone's own files, the originals among them. lstat calls a Windows junction a link too.
  if (lstatSync(folder).isSymbolicLink()) throw new Error(`the review folder ${pathFrom(cwd, folder)} is a link to another folder, which a review would empty: remove the link and run ${again} again`);
  const cards = new Map(); // preview name -> its card
  const jobs = new Map(); // preview name -> what writes it, for its card
  // biggest saving first; copies, which save alike, by path, so the first named is the same each time
  const order = (a, b) => b.original - b.compressed - (a.original - a.compressed) || (a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
  for (const row of [...rows].sort(order)) {
    try {
      const bytes = readFileSync(row.file);
      if (bytes.length !== row.original) throw new Error(`changed while reviewing; run ${again} again`);
      const type = kind(bytes);
      // named by the image's cache key: copies of one image share a preview, and a changed image gets a new one
      const { target } = row;
      const k = key(bytes, target);
      const name = `${k}.${type === "jpeg" ? "jpg" : "png"}`;
      if (!cards.has(name)) {
        const [width, height] = dimensions(bytes, type);
        const { original, compressed, outcome, score } = row;
        const card = { paths: [], files: [], before: href(folder, row.file), after: name, width, height, alpha: transparent(bytes, type), original, compressed, outcome, score, target, total: { original: 0, compressed: 0 } };
        cards.set(name, card);
        jobs.set(name, { k, card, size: bytes.length, peak: peakOf(bytes), message: { file: row.file, target, out: join(folder, name) } });
      }
      const card = cards.get(name);
      card.paths.push(row.path);
      card.files.push(row.file);
      card.total.original += row.original;
      card.total.compressed += row.compressed;
    } catch (cause) {
      error(row.file, row.path, plain(cause));
    }
  }
  writable(cwd, folder, () => {
    // kept out of a repository that doesn't ignore node_modules: previews weigh as much as the images
    if (!existsSync(join(folder, ".gitignore"))) writeFileSync(join(folder, ".gitignore"), "# pngdeer --review's previews, rewritten on each run\n*\n");
    // the old page first, so it never links a preview that's gone
    rmSync(join(folder, "index.html"), { force: true });
    for (const entry of readdirSync(folder)) {
      if (entry === ".gitignore") continue;
      if (jobs.has(entry) && preview(join(folder, entry), cards.get(entry))) jobs.delete(entry);
      else rmSync(join(folder, entry), { recursive: true, force: true });
    }
  });

  const failed = new Set();
  const answered = new Set();
  const todo = [...jobs.values()];
  const counter = progress(todo.length);
  const fail = ({ card, message: { out } }, reason) => {
    rmSync(out, { force: true });
    failed.add(card);
    // off the count's line on a terminal: the next answer writes it again
    counter(null);
    card.paths.forEach((path, i) => error(card.files[i], path, reason));
  };
  try {
    await pool(todo, {
      done: (job, reply) => {
        answered.add(job);
        counter(answered.size);
        const { files: [file], compressed } = job.card;
        if (reply.error) fail(job, reply.error);
        // pngdeer left the image as it is, and the "preview" is a copy of it
        else if (!reply.written) fail(job, `no preview: ${reply.text}`);
        // the page shows what was measured, so a preview of another size can't go on it
        else if (reply.written !== compressed) fail(job, changed(file, job.k, job.message.target) ? `changed while reviewing; run ${again} again` : `its preview is ${reply.written} bytes, but measuring said ${compressed}; please report this at ${ISSUES}`);
      },
    });
  } catch (cause) {
    // an engine died: the images it hadn't answered for have no preview
    for (const job of todo) {
      if (!answered.has(job)) fail(job, plain(cause));
    }
  }
  counter(null);
  return [...cards.values()].filter((card) => !failed.has(card));
}

/** Runs `write`, a change to the review folder, saying which folder failed if it does. */
function writable(cwd, folder, write) {
  try {
    write();
  } catch (cause) {
    throw new Error(`can't write the review folder ${pathFrom(cwd, folder)}: ${denied(cause)}`);
  }
}

/** Why a folder couldn't be changed: a child that couldn't go leaves its folder "not empty". */
function denied(cause) {
  return cause?.code === "ENOTEMPTY" ? "permission denied" : plain(cause);
}

/** Whether `out` holds the preview of `card`: pngdeer's file, of the size measured. */
function preview(out, { compressed }) {
  try {
    const bytes = readFileSync(out);
    return bytes.length === compressed && marked(bytes);
  } catch {
    return false;
  }
}

/** Whether `file` no longer has the cache key `k`, which explains a preview of another size. */
function changed(file, k, target) {
  try {
    return key(readFileSync(file), target) !== k;
  } catch {
    return true;
  }
}

/** Whether an image may hold transparent pixels: a PNG with an alpha channel, or a tRNS chunk. */
function transparent(bytes, type) {
  return type === "png" && (bytes[25] === 4 || bytes[25] === 6 || pngChunk(bytes, "tRNS") !== null);
}

/**
 * The URL of `file` from `folder`, each segment percent-encoded: relative, so the page works from
 * disk; a file URL on another drive (Windows), which no relative path reaches.
 */
function href(folder, file) {
  const path = relative(folder, file);
  if (isAbsolute(path)) return pathToFileURL(file).href;
  return path.split(sep).map(encodeURIComponent).join("/");
}

/**
 * How many previews are written, on stderr: as the measuring count does (progress.js), one line
 * rewritten on a terminal, and elsewhere a line every 30 s. `null` ends it.
 */
function progress(total) {
  if (total === 0) return () => {};
  const tty = process.stderr.isTTY;
  let last = Date.now();
  const line = `pngdeer: writing ${count(total, "preview")}...`;
  process.stderr.write(tty ? unwrapped(line) : `${line}\n`);
  return (done) => {
    if (done === null) {
      if (tty) process.stderr.write("\r\x1b[K");
      return;
    }
    if (tty) return void process.stderr.write(unwrapped(`\r${line} ${done}/${total}\x1b[K`));
    if (Date.now() - last < 30_000) return;
    last = Date.now();
    process.stderr.write(`pngdeer: wrote ${done} of ${count(total, "preview")}...\n`);
  };
}

/** The date and time for the page, as people read it wherever they are: 2026-11-11 15:57. */
function stamp(date) {
  const two = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${two(date.getMonth() + 1)}-${two(date.getDate())} ${two(date.getHours())}:${two(date.getMinutes())}`;
}

/**
 * The program that opens `file` with what the system opens pages with, and its arguments: run without
 * a shell, so a folder named with & or % reaches it as it is (Windows' cmd would read those). Windows
 * looks for a bare program name in the current folder first, where a project could hold its own
 * explorer.exe: Windows' own, by its full path.
 */
export function opener(file, platform = process.platform) {
  if (platform === "darwin") return { command: "open", args: [file] };
  if (platform === "win32") return { command: win32.join(process.env.SystemRoot || "C:\\Windows", "explorer.exe"), args: [file] };
  return { command: "xdg-open", args: [file] };
}

/**
 * Opens `file` in the default browser, detached: null once it's opening, or why it couldn't. An opener
 * that can't gives up at once, with an exit code (xdg-open with no display or browser to use, over SSH
 * or in a container, exits 3); one still running after SETTLE ms is waiting on the browser it started.
 * Windows' explorer.exe exits 1 even when it opened the page.
 */
function launch(file) {
  const { command, args } = opener(file);
  return new Promise((done) => {
    try {
      const child = spawn(command, args, { detached: true, stdio: "ignore", windowsHide: true });
      child.once("error", (cause) => done(cause.code === "ENOENT" ? `${command} isn't installed` : plain(cause)));
      child.once("spawn", () => {
        const running = setTimeout(() => {
          child.unref();
          done(null);
        }, SETTLE);
        child.once("exit", (code) => {
          clearTimeout(running);
          done(code && process.platform !== "win32" ? `${command} exited with code ${code}` : null);
        });
      });
    } catch (cause) {
      done(plain(cause));
    }
  });
}
