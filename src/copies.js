// What the command does with --format, and with -o OUT.webp or OUT.avif: writes each image's copy
// (convert.js), one image in this thread and several on the pool's engines; says how each copy
// compares with the image's own shrink; then lists the lines of code that still name each original
// (mentions.js), as the copies help only once the code uses them. Nothing already there is replaced.
import { readdirSync, readFileSync } from "node:fs";
import { basename, dirname, extname, join, relative, resolve, sep } from "node:path";
import { peakOf, pool } from "./batch.js";
import { cautions, convertImage, FORMATS, rootOf, sibling } from "./convert.js";
import { mentions } from "./mentions.js";
import { physical } from "./scan.js";
import { plain } from "./shrink.js";
import { ORDER } from "./summary.js";
import { count, pathFrom, printable, quote, shrinkCommand, size } from "./text.js";

const SLOW = "AVIF is slow: about half a minute per image on a 16-core laptop, and over two minutes for a large one";
// the folders a site serves as they are, where other sites and emails may link to an image
const PUBLIC = ["public", "static"];
const LINES = 10; // code lines listed after writing
const PLACES = 5; // Markdown places listed after writing
const NAMES = 3; // images named in the line for those no file names
// macOS and Windows don't tell letter case apart in file names: there, Hero.webp is hero.webp
const CASELESS = process.platform === "darwin" || process.platform === "win32";
// a file with a copy's extension gets no copy (it's no PNG or JPEG, or it's named like its own copy)
const COPIES = new Set(Object.values(FORMATS).map(({ extension }) => extension));

/** Why two of `images` can't both get a copy in `format` next to them: the usage mistake, or null. */
export function clash(images, format) {
  const seen = new Map();
  for (const image of images) {
    // a second run over public/* finds the first one's copies: they're no reason to stop
    if (COPIES.has(extname(image).toLowerCase())) continue;
    const copy = copyOf(image, format);
    // the folder as the filesystem spells it, so one reached through a link is the same folder
    const path = join(physical(dirname(resolve(copy))), basename(copy));
    const key = CASELESS ? path.toLowerCase() : path;
    const first = seen.get(key);
    if (first) return `${first} and ${image} would both be written as ${copyOf(first, format)}: convert one of them with -o`;
    seen.set(key, image);
  }
  return null;
}

/**
 * Writes `images` (as typed, each once) as `format` at `target` (a score, or undefined for
 * automatic): each next to itself, or, with `output` (-o), the one image to that file. Prints a line
 * per image, then what still names the originals. Resolves the exit code: with `output`, 0 only when
 * it wrote that file; else 0 when each image was written or left out for a reason it named.
 */
export async function writeCopies(images, { format, target, output }) {
  const { name } = FORMATS[format];
  const mode = output === undefined ? "sibling" : "named";
  const several = images.length > 1;
  if (several) console.error(`slimdeer: writing ${count(images.length, "image")} as ${name} next to their originals, which stay as they are${format === "avif" ? `; ${SLOW}` : ""}`);
  else if (format === "avif") console.error(`slimdeer: ${SLOW}`);
  // a framework that converts images is said before the work, which AVIF makes long
  for (const note of cautions(images.map(rootOf), format, [])) console.error(printable(note));

  let status = 0;
  let finished = 0;
  const written = []; // { image, out, result }
  const copied = []; // the images whose copy is there now, written by this run or before
  const report = (image, out, result) => {
    const line = `${several ? `[${++finished}/${images.length}] ` : ""}${image}`;
    if (result.status === "written" || result.status === "already") {
      console.log(printable(`${line} → ${out}: ${result.status === "written" ? result.text : "already written; left as is"}`));
      copied.push(image);
      if (result.status === "written") written.push({ image, out, result });
      return;
    }
    // an image left out for a reason is part of the work with --format, but -o asked for that file
    const failed = result.status !== "left" || mode === "named";
    const why = result.error ?? `not written: ${result.status === "left" ? result.reason : `${out} exists already; move it, or name another file with -o`}`;
    (failed ? console.error : console.log)(printable(`${line}: ${why}`));
    if (failed) status = 1;
  };

  if (several) {
    const jobs = [];
    for (const image of images) {
      const out = copyOf(image, format);
      let bytes;
      try {
        bytes = readFileSync(image);
      } catch (error) {
        report(image, out, { error: plain(error) });
        continue;
      }
      // the pool goes by file size, the best guess of an image's time (batch.js)
      jobs.push({ image, out, size: bytes.length, peak: peakOf(bytes, format), message: { file: image, target, format, out, mode } });
    }
    try {
      await pool(jobs, { done: (job, result) => report(job.image, job.out, result) });
    } catch (error) {
      // an engine died: the copies written before are there all the same, and still need the code changed
      console.error(printable(`oxlint-plugin-slimdeer: ${plain(error)}`));
      status = 1;
    }
  } else {
    const [image] = images;
    const out = output ?? copyOf(image, format);
    let result;
    try {
      result = convertImage(image, out, { format, target, mode });
    } catch (error) {
      result = { error: plain(error) };
    }
    report(image, out, result);
  }

  // in the order given, not the order the engines finished in
  const given = (a, b) => images.indexOf(a) - images.indexOf(b);
  written.sort((a, b) => given(a.image, b.image));
  copied.sort(given);
  const notes = [...afterwards(written, { name, mode, target }), ...cautions([], format, copied)];
  for (const note of notes) console.error(printable(note));
  return status;
}

/**
 * What to do now that the copies in `written` are there, as stderr lines: with several, their sizes
 * in all; then the lines of code that still name the originals, or that none does. With -o, a copy
 * bigger than the image's shrink gets the command that shrinks it instead.
 */
function afterwards(written, { name, mode, target }) {
  if (written.length === 0) return [];
  if (mode === "named" && written[0].result.base < written[0].result.written) {
    const { text, shell } = shrinkCommand([written[0].image], target);
    return [`slimdeer: to shrink ${written[0].image} in place instead, run${shell}: ${text}`];
  }
  const notes = [];
  if (written.length > 1) {
    const sum = (bytes) => size(written.reduce((total, { result }) => total + bytes(result), 0));
    notes.push(`slimdeer: wrote ${count(written.length, `${name} file`)}, ${sum((result) => result.original)} → ${sum((result) => result.written)} in all (shrunk in place at the same quality, they would be ${sum((result) => result.base)}). The originals are still there.`);
  }
  const found = new Map(); // "file:line" -> the mention: a line that names two originals is listed once
  const named = []; // { path, root } of the originals some line names
  const unnamed = []; // the images no line names
  for (const { image } of written) {
    const path = resolve(image);
    const root = rootOf(image);
    const lines = mentions(path, root, PUBLIC);
    for (const mention of lines) found.set(`${mention.file}:${mention.line}`, mention);
    if (lines.length) named.push({ path, root });
    else unnamed.push(image);
  }
  const nowhere = unnamed.length ? [`slimdeer: no file here names ${listed(unnamed)}; something outside this project may (a CMS, an email, another site), so keep ${unnamed.length === 1 ? "it" : "them"} until you know.`] : [];
  if (named.length === 0) return [...notes, ...nowhere];

  const cwd = process.cwd();
  const rank = (file) => ORDER.indexOf(extname(file).toLowerCase());
  const sorted = [...found.values()].sort((a, b) => rank(a.file) - rank(b.file) || (a.file < b.file ? -1 : a.file > b.file ? 1 : a.line - b.line));
  const place = ({ file, line }) => `${pathFrom(cwd, file)}:${line}`;
  const code = sorted.filter((mention) => !mention.markdown);
  const docs = sorted.filter((mention) => mention.markdown);
  // the lines listed, or with no code line, the Markdown places
  const lines = code.length || docs.length;
  if (written.length === 1) {
    const [{ out }] = written;
    const at = mode === "named" ? out : basename(out);
    notes.push(`slimdeer: ${written[0].image} is still there, and ${lines === 1 ? "this line still names it; point it" : "these lines still name it; point them"} at ${at}:`);
  } else {
    notes.push(`slimdeer: ${lines === 1 ? "this line still names an original; point it" : "these lines still name the originals; point each one"} at its new file:`);
  }
  const shown = code.slice(0, LINES);
  const width = Math.max(...shown.map((mention) => place(mention).length));
  for (const mention of shown) notes.push(`  ${place(mention).padEnd(width)}  ${mention.text}`);
  if (code.length > LINES) {
    const more = `  and ${count(code.length - LINES, "more line")}`;
    // fixed strings: a name is no pattern ([1].png)
    notes.push(written.length === 1 ? `${more}: git grep -nF ${quote(basename(written[0].image))}` : more);
  }
  if (docs.length) {
    const places = docs.slice(0, PLACES).map(place).join(", ");
    notes.push(`  ${code.length ? "and " : ""}${count(docs.length, "mention")} in Markdown: ${places}${docs.length > PLACES ? `, and ${docs.length - PLACES} more` : ""}`);
  }
  // a site serves these folders as they are: a link from elsewhere breaks when the file goes
  const top = ({ path, root }) => relative(root, path).split(sep)[0];
  const served = PUBLIC.filter((dir) => named.some((image) => (CASELESS ? top(image).toLowerCase() : top(image)) === dir));
  const linked = served.length ? `; other sites, emails and share previews may link to files in ${served.map((dir) => `${dir}/`).join(" and ")}.` : ".";
  notes.push(`slimdeer: delete ${written.length === 1 ? written[0].image : "an original"} only once nothing uses it${linked}`);
  return [...notes, ...nowhere];
}

/** `images` in a line: the first NAMES, then how many more. */
function listed(images) {
  const more = images.length - NAMES;
  return `${images.slice(0, NAMES).join(", ")}${more > 0 ? `, and ${more} more` : ""}`;
}

const folders = new Map(); // folder -> the names in it, read once

/**
 * Where the copy of `image` (as typed) in `format` goes: next to it, under its name as its folder
 * spells it, so HERO.PNG typed for hero.png on macOS or Windows gets hero.webp, which code on a
 * server that tells letter case apart can reach.
 */
function copyOf(image, format) {
  let name = basename(image);
  if (CASELESS) {
    const folder = dirname(resolve(image));
    if (!folders.has(folder)) {
      try {
        folders.set(folder, readdirSync(folder));
      } catch {
        // no such folder: the image is reported missing when it's read
        folders.set(folder, []);
      }
    }
    const names = folders.get(folder);
    if (!names.includes(name)) name = names.find((entry) => entry.toLowerCase() === name.toLowerCase()) ?? name;
  }
  return sibling(image.slice(0, image.length - basename(image).length) + name, format);
}
