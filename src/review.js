// --review: every image --check would list (with --flagged, the images the last lint flagged), written
// as a preview of what the command makes of it, beside a page that compares each one with its
// original, so the result can be seen before any image changes. Nothing leaves the machine: the page
// is a file, and opens only with --open.
import { spawn } from "node:child_process";
import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { isAbsolute, join, relative, resolve, sep, win32 } from "node:path";
import { pathToFileURL } from "node:url";
import { peakOf, pool } from "./batch.js";
import { cacheDir, convertKey, key } from "./cache.js";
import { cautionsOf, listing, notes, print, saving } from "./check.js";
import { measureAll, shortened } from "./measure.js";
import { cautions, FORMATS } from "./convert.js";
import { dimensions, kind, pngChunk } from "./images.js";
import { marked } from "./marker.js";
import { unwrapped } from "./progress.js";
import { commandCount, page } from "./review-page.js";
import { projectRoot } from "./scan.js";
import { plain } from "./shrink.js";
import { checkCommand, count, pathFrom, printable, reviewCommand } from "./text.js";

const ISSUES = "https://github.com/lndgalante/oxlint-plugin-slimdeer/issues";
// How long --open waits for the opener to give up before it takes the page as opening.
const SETTLE = 2000;

/**
 * Measures what --check would (cached results are reused), or with `flagged` ([{ file, target,
 * cacheDir, changed }]) the images the last lint here flagged, each at its own target, from the
 * cache folder the lint measured it into; writes each listed image's preview and a page comparing
 * them into the review folder of the project the command runs in, and says where it is. With `format`
 * ("webp", "avif"), each preview is the image's copy in that format, as the command writes it next to
 * the image, and the page compares it with the image's own shrink too. Resolves 0 when the page was
 * written or there's nothing to review, 2 when an image couldn't be measured or previewed (the page
 * still shows the rest).
 */
export async function review(inputs, { cwd = process.cwd(), target, minSavedBytes, minSavedPercent, exclude, cacheDir: customCacheDir, open = false, flagged, format } = {}) {
  cwd = resolve(cwd);
  // what an error that may clear on its own says to run again: this review, not --check
  const again = `--review${flagged ? " --flagged" : ""}${format ? ` --format ${format}` : ""}`;
  // the local cache, never a --cache-dir that may be committed
  const folder = join(cacheDir(projectRoot(cwd, cwd)), "review");
  // measuring writes each copy it makes into the folder, as its preview: it has to be there, and not a link
  if (format) prepare(folder, cwd, again);
  const options = { cwd, target, minSavedBytes, minSavedPercent, exclude, cacheDir: customCacheDir, again, ...(format && { format, previewDir: folder }) };
  // an image changed since the lint isn't the one it flagged (summary.js): neither measured nor shown
  const changed = (flagged ?? []).filter((image) => image.changed).map(({ file }) => ({ file, path: pathFrom(cwd, file), message: "changed since the last lint here; lint again to check it" }));
  const lists = flagged ? await measureFlagged(flagged.filter((image) => !image.changed), options) : [{ inputs, settings: options, result: await measureAll(inputs, options) }];
  // with a format, the images whose copy's place something takes already are done (check.js listing())
  const all = (part) => lists.flatMap(({ result }) => listing(result)[part] ?? []);
  // each image with the target it was measured at, for the page
  const each = (part) => lists.flatMap(({ settings, result }) => (result[part] ?? []).map((image) => ({ ...image, target: settings.target })));
  const result = { format, rows: all("rows"), declined: all("declined"), missed: each("missed"), notWorthIt: each("notWorthIt"), leftOut: all("leftOut"), existing: all("existing"), errors: [...changed, ...all("errors")] };
  // what the page leaves out, as --check says it (for a lint's list, of each target's images), with
  // --review where a note gives the same run again (a lint's list names each image, so it gets none)
  const unlisted = (rerun) => lists.flatMap(({ inputs, settings, result }) => notes(inputs, result, settings, rerun));
  // with a format, what to keep in mind before converting, as --check says it of the same images
  const caution = (show) => cautionsOf(result, { cwd }, show);
  // what couldn't be checked, before the previews take their time
  for (const { path, message } of result.errors) console.error(printable(`${path}: ${shortened(message)}`));
  if (result.rows.length === 0) {
    try {
      // a page left from an earlier run would show savings that are gone
      rmSync(folder, { recursive: true, force: true });
    } catch (cause) {
      console.error(printable(`slimdeer: couldn't remove the old review page in ${pathFrom(cwd, folder)}: ${denied(cause)}`));
    }
    // everything is measured now: --check says what it found in its own words, without its job
    // summary, which would be titled --check and point at no page; then that there's no page, as a
    // tab still showing the old one would pass for this run's
    if (!flagged) {
      const status = print(inputs, lists[0].result, { ...options, summary: false });
      console.log(`slimdeer: ${none(format)}`);
      return status;
    }
    // with a format, in --check's words, as without --flagged: there's no page for an image not to be on
    for (const line of unlisted(format ? checkCommand : reviewCommand)) console.log(printable(line));
    for (const line of caution()) console.error(printable(line));
    console.log(`slimdeer: ${nothing(flagged, result.errors.length, target, format)}`);
    return result.errors.length ? 2 : 0;
  }

  const errors = [...result.errors];
  const cards = await previews(result.rows, folder, cwd, again, format, (file, path, message) => {
    errors.push({ file, path, message });
    console.error(printable(`${path}: ${message}`));
  });
  if (cards.length === 0) {
    console.log("slimdeer: review incomplete: no preview could be written. Images unchanged.");
    return 2;
  }
  const index = join(folder, "index.html");
  // the options that check the images left out again
  const settings = { ...(flagged ? { cacheDir: customCacheDir } : { exclude, cacheDir: customCacheDir, minSavedBytes, minSavedPercent }), ...(format && { format }) };
  const rows = cards.flatMap((card) => card.rows);
  const html = page({
    cwd, date: stamp(new Date()), target, cards, declined: result.declined, missed: result.missed, errors, settings,
    ...(format
      ? { format, notWorthIt: result.notWorthIt, leftOut: result.leftOut, existing: result.existing, cautions: caution }
      : { hint: hint(inputs, rows, { cwd, target, exclude, cacheDir: customCacheDir, minSavedBytes, minSavedPercent }, flagged) }),
  });
  writable(cwd, folder, () => {
    const tmp = `${index}.${process.pid}.tmp`;
    writeFileSync(tmp, html);
    renameSync(tmp, index);
  });

  const one = cards.length === 1;
  // the page gives a command per target, and splits a long one
  const several = commandCount(cards, format) > 1;
  console.log(`slimdeer: ${saving(rows, format)}. Images unchanged.`);
  // the terminal names what the page leaves out too
  for (const line of unlisted(reviewCommand)) console.log(printable(line));
  for (const line of caution()) console.error(printable(line));
  console.log(`slimdeer: the page that compares ${one ? "it" : "each one"} before and after: ${pathToFileURL(index).href}`);
  const failure = open ? await launch(index) : null;
  const gives = `run the ${several ? "commands" : "command"} it gives`;
  const next = one ? `if the after looks right, ${gives}` : `untick any image to keep as it is, and ${gives}`;
  // a copy is a new file, which the code has to be pointed at
  const what = rows.length === 1 ? "file next to the original" : "files next to the originals";
  const does = format ? `: ${several ? "they write" : "it writes"} the ${FORMATS[format].name} ${what} and ${several ? "list" : "lists"} the code that still names ${rows.length === 1 ? "it" : "them"}` : "";
  console.log(`slimdeer: ${open && !failure ? "opening it in your browser;" : `open it in a browser,${one ? " and" : ""}`} ${next}${does}.`);
  if (failure) console.error(printable(`slimdeer: couldn't open a browser: ${failure}`));
  return errors.length ? 2 : 0;
}

/**
 * Measures the images a lint flagged, each at its own target and from the cache folder the lint
 * measured it into (so nothing it measured is measured again), a measureAll() per target and folder:
 * [{ inputs, settings, result }]. The lint applied its thresholds to each image's own shrink: an image
 * is shown if slimdeer still makes it smaller at all. A copy, which the lint never measured, is shown
 * if it beats that shrink by --review's own thresholds, as without --flagged.
 */
async function measureFlagged(flagged, options) {
  const groups = new Map(); // [target, cache folder] -> its images
  for (const { file, target, cacheDir } of flagged) {
    const group = JSON.stringify([target, cacheDir]);
    groups.set(group, { target, cacheDir, inputs: [...(groups.get(group)?.inputs ?? []), file] });
  }
  const lists = [];
  const thresholds = options.format ? {} : { minSavedBytes: 0, minSavedPercent: 0 };
  for (const { target, cacheDir, inputs } of groups.values()) {
    const result = await measureAll(inputs, { ...options, target, cacheDir, ...thresholds });
    // --check's notes for them, with the --cache-dir given, if any, in the commands they give
    lists.push({ inputs, settings: { cwd: options.cwd, target, cacheDir: options.cacheDir }, result });
  }
  return lists;
}

/**
 * The same-format page's pointer to the review of the same images as WebP, `rows` being the images it
 * shows: this review's own command with --format webp, or null where a project of theirs depends on a
 * framework that converts images itself (convert.js cautions()), where a copy would go through a
 * second lossy pass.
 */
function hint(inputs, rows, settings, flagged) {
  if (cautions(rows.map(({ root }) => root), "webp", []).length) return null;
  const { cwd } = settings;
  if (flagged) {
    const command = reviewCommand([], { ...settings, format: "webp" });
    return { ...command, text: command.text.replace(" --review", " --review --flagged") };
  }
  // as typed, but none for the folder it runs in, as --check gives it
  const paths = inputs.length === 1 && resolve(cwd, inputs[0]) === cwd ? [] : inputs;
  return reviewCommand(paths, { ...settings, format: "webp" });
}

/**
 * What a review of a lint's list (`flagged`) says when it shows none: none listed (a lint that held
 * every image it flagged back from --flagged leaves an empty list too), none that could be checked,
 * none whose copy as `format`, if given, would be smaller, or none that slimdeer still makes smaller
 * (at `target`, the --target given here, if one was).
 */
function nothing(flagged, failed, target, format) {
  if (flagged.length === 0) return "the last lint here left no images to review with --flagged.";
  // a list that names an image gone or changed since is out of date; one the cache folder failed
  // for isn't
  const gone = flagged.some(({ file, changed }) => changed || !existsSync(file));
  if (failed) return `review incomplete: none of the images the last lint here flagged could be shown${gone ? "; lint again to update the list" : ""}.`;
  if (format) return none(format);
  const which = flagged.length === 1 ? "the image the last lint here flagged can't" : `none of the ${flagged.length} images the last lint here flagged can`;
  // at a target given here, linting again would leave the same list: the target is why
  if (target !== undefined) return `${which} be made smaller at --target ${target}, so there is nothing to review.`;
  return `${which} be made smaller now, so there is nothing to review; lint again to update the list.`;
}

/** What a review says when it has no image to show: with `format`, none to compare as that format. */
function none(format) {
  return `no image to compare${format ? ` as ${FORMATS[format].name}` : ""}, so no page was written.`;
}

/**
 * Makes the review folder, which a review empties of what it doesn't write: through a link (to
 * public/, a home folder), that would be someone's own files, the originals among them, so a link is
 * refused. lstat calls a Windows junction a link too.
 */
function prepare(folder, cwd, again) {
  try {
    mkdirSync(folder, { recursive: true });
  } catch (cause) {
    throw new Error(`can't make the review folder ${pathFrom(cwd, folder)}: ${["EEXIST", "ENOTDIR"].includes(cause.code) ? "a file is in the way" : plain(cause)}`);
  }
  if (lstatSync(folder).isSymbolicLink()) throw new Error(`the review folder ${pathFrom(cwd, folder)} is a link to another folder, which a review would empty: remove the link and run ${again} again`);
  // kept out of a repository that doesn't ignore node_modules, before any preview goes in (measuring
  // writes copies there, and a review stopped then leaves them): previews weigh as much as the images
  writable(cwd, folder, () => {
    if (!existsSync(join(folder, ".gitignore"))) writeFileSync(join(folder, ".gitignore"), "# slimdeer --review's previews, rewritten on each run\n*\n");
  });
}

/**
 * Writes the preview of each row into `folder` on the pool's engines, at the row's target: the bytes
 * the command writes in place, or with `format` the copy it writes next to the image, so what the
 * page shows is what the command does. A preview from an earlier run, or one measuring wrote, is kept
 * when its image hasn't changed (its name is the image's cache key, or its copy's), so a second
 * review is quick and an interrupted one goes on where it stopped; everything else in the folder
 * goes. Copies of one image share a preview, and a card. Resolves the cards previewed, biggest saving
 * first (with a format, beyond the image's own shrink, as --check orders its command), each with its
 * rows, its URLs from the folder and its pixel size; reports the images it couldn't preview to
 * `error(file, path, message)`, naming `again` where running it again may help.
 */
async function previews(rows, folder, cwd, again, format, error) {
  // with a format, review() made it before measuring, which writes the copies into it
  if (!format) prepare(folder, cwd, again);
  const cards = new Map(); // preview name -> its card
  const jobs = new Map(); // preview name -> what writes it, for its card
  // biggest saving first; copies, which save alike, by path, so the first named is the same each time
  const saved = (row) => (row.base ?? row.original) - row.compressed;
  const order = (a, b) => saved(b) - saved(a) || (a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
  for (const row of [...rows].sort(order)) {
    try {
      const bytes = readFileSync(row.file);
      if (bytes.length !== row.original) throw new Error(`changed while reviewing; run ${again} again`);
      const type = kind(bytes);
      // named by the image's cache key, or its copy's: copies of one image share a preview, and a
      // changed image gets a new one
      const { target } = row;
      const k = format ? convertKey(bytes, row.equal, format) : key(bytes, target);
      const name = `${k}${format ? FORMATS[format].extension : type === "jpeg" ? ".jpg" : ".png"}`;
      // measuring named the copy by the bytes it read
      if (format && join(folder, name) !== row.preview) throw new Error(`changed while reviewing; run ${again} again`);
      if (!cards.has(name)) {
        const [width, height] = dimensions(bytes, type);
        // a copy listed reached its target
        const { original, compressed, outcome = "hit", score, sameFormat, base } = row;
        const card = { paths: [], files: [], rows: [], before: href(folder, row.file), after: name, width, height, alpha: transparent(bytes, type), original, compressed, outcome, score, target, type, sameFormat, base, total: { original: 0, compressed: 0 } };
        cards.set(name, card);
        const message = format ? { file: row.file, target: row.equal, format, out: row.preview } : { file: row.file, target, out: join(folder, name) };
        jobs.set(name, { k, card, size: bytes.length, peak: peakOf(bytes, format), message });
      }
      const card = cards.get(name);
      card.paths.push(row.path);
      card.files.push(row.file);
      card.rows.push(row);
      card.total.original += row.original;
      card.total.compressed += row.compressed;
    } catch (cause) {
      error(row.file, row.path, plain(cause));
    }
  }
  writable(cwd, folder, () => {
    // the old page first, so it never links a preview that's gone
    rmSync(join(folder, "index.html"), { force: true });
    for (const entry of readdirSync(folder)) {
      if (entry === ".gitignore") continue;
      if (jobs.has(entry) && preview(join(folder, entry), cards.get(entry), format)) jobs.delete(entry);
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
        // a copy's measurement says its size, and saves only a copy that reaches its target (worker.js)
        const written = format ? reply.outcome === "hit" && reply.compressed : reply.written;
        if (reply.error) fail(job, reply.error);
        // slimdeer left the image as it is, and the "preview" is a copy of it; or no copy reached the target
        else if (!written) fail(job, `no preview: ${format ? `as ${FORMATS[format].name}, no file reaches quality ${Math.round(job.message.target)}/100 now; please report this at ${ISSUES}` : reply.text}`);
        // the page shows what was measured, so a preview of another size can't go on it
        else if (written !== job.card.compressed) fail(job, changed(job.message, job.k) ? `changed while reviewing; run ${again} again` : `its preview is ${written} bytes, but measuring said ${job.card.compressed}; please report this at ${ISSUES}`);
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

/**
 * Whether `out` holds the preview of `card`: slimdeer's file, of the size measured; with `format`, a
 * file of its own (not a link) of the size measured, as a copy has no mark to tell it by.
 */
function preview(out, { compressed }, format) {
  try {
    if (format) {
      const stat = lstatSync(out);
      return stat.isFile() && stat.size === compressed;
    }
    const bytes = readFileSync(out);
    return bytes.length === compressed && marked(bytes);
  } catch {
    return false;
  }
}

/**
 * Whether the image of a preview's `message` ({ file, target, format }) no longer has the cache key
 * `k` (with a format, its copy's), which explains a preview of another size.
 */
function changed({ file, target, format }, k) {
  try {
    const bytes = readFileSync(file);
    return (format ? convertKey(bytes, target, format) : key(bytes, target)) !== k;
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
  const line = `slimdeer: writing ${count(total, "preview")}...`;
  process.stderr.write(tty ? unwrapped(line) : `${line}\n`);
  return (done) => {
    if (done === null) {
      if (tty) process.stderr.write("\r\x1b[K");
      return;
    }
    if (tty) return void process.stderr.write(unwrapped(`\r${line} ${done}/${total}\x1b[K`));
    if (Date.now() - last < 30_000) return;
    last = Date.now();
    process.stderr.write(`slimdeer: wrote ${done} of ${count(total, "preview")}...\n`);
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
