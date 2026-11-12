// WebP and AVIF copies of PNGs and JPEGs, as the command writes them (--format, -o OUT.webp): at the
// quality the image's own shrink would have, so "smaller" compares like with like, and only where
// that's smaller. The image itself is never written: the code that names it has to change to use the copy.
import { closeSync, linkSync, lstatSync, mkdtempSync, openSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { FLOOR } from "./cache.js";
import { compress, convert } from "./engine.js";
import { dimensions, kind, unsupported } from "./images.js";
import { keepOrientation, mark, marked, turned } from "./marker.js";
import { physical, projectRoot } from "./scan.js";
import { plain, save } from "./shrink.js";
import { nextMetadata } from "./summary.js";
import { looks, pathFrom, quote, shrinkCommand, size, smaller } from "./text.js";

export const FORMATS = { webp: { name: "WebP", extension: ".webp" }, avif: { name: "AVIF", extension: ".avif" } };
// slimdeer's AVIF limit (at 24 MP the engine needs about 2.9 GB), and the WebP format's own
export const AVIF_MAX_PIXELS = 24e6;
export const WEBP_MAX_SIDE = 16383;

// Projects whose build or server can convert images itself: a copy made here would go through a
// second lossy pass there
const FRAMEWORKS = ["next", "astro", "gatsby", "@nuxt/image", "vite-imagetools"];
// File names of share images and icons, which link previews and devices may not show as AVIF
const SHARED = /(^|[-_.])(og|opengraph|twitter|social|share)([-_.]|$)|apple-touch-icon|favicon|android-chrome|mstile/i;
// What link() says on a filesystem without hard links (FAT, exFAT, some network shares; Windows says
// EISDIR for FAT and exFAT, and link()'s source here is never a folder)
const NO_LINKS = new Set(["EPERM", "ENOTSUP", "EXDEV", "EMLINK", "ENOSYS", "EISDIR"]);

/** Where the copy of `file` in `format` goes: the same folder and name, with the format's extension (photo.JPG → photo.webp). */
export function sibling(file, format) {
  return `${file.slice(0, file.length - extname(file).length)}${FORMATS[format].extension}`;
}

/**
 * Why the command won't write the image `file` (its `bytes`, in the project at `root`) as `format`:
 * { kind, reason }, the first of these that holds, or null.
 */
export function leftOut(bytes, file, format, root) {
  const { name } = FORMATS[format];
  const type = kind(bytes);
  const [width, height, frames] = type ? dimensions(bytes, type) : [0, 0, 1];
  if (marked(bytes)) return { kind: "marked", reason: "already shrunk by this command, so converting it would be a second lossy pass; convert the original from before it was shrunk" };
  if (frames > 1) return { kind: "animated", reason: `animated PNGs can't be written as ${name} yet` };
  if (turned(bytes)) return { kind: "turned", reason: `its eXIf data turns it, and the ${name} file would show it unturned; shrink it as PNG instead` };
  // rounded up, so an image just over the limit doesn't read as 24.0 MP
  if (format === "avif" && width * height > AVIF_MAX_PIXELS) return { kind: "size", reason: `too large for AVIF (${(Math.ceil((width * height) / 1e5) / 10).toFixed(1)} MP, at most ${AVIF_MAX_PIXELS / 1e6})` };
  if (format === "webp" && Math.max(width, height) > WEBP_MAX_SIDE) return { kind: "size", reason: `too wide or tall for WebP (at most ${WEBP_MAX_SIDE.toLocaleString("en-US")} pixels a side)` };
  if (nextMetadata(file, root)) return { kind: "next", reason: "Next.js serves app/ metadata images by their file name, and doesn't take WebP or AVIF there" };
  if (format === "avif" && ["react-native", "expo"].some((dependency) => dependencies(root).has(dependency))) {
    return { kind: "react-native", reason: "React Native's Image doesn't list AVIF among the formats it shows" };
  }
  return null;
}

/**
 * The quality score a copy aims at: `target` if given; else that of the image's own shrink
 * (`sameFormat`, { outcome, score } as compress() gives them) on a hit, or 100 when slimdeer found
 * nothing smaller or kept every pixel; null on a miss, as nothing reached the quality floor and there
 * is no quality to match.
 */
export function equalTarget(target, { outcome, score }) {
  if (target !== undefined) return target;
  if (outcome === "hit") return score;
  return outcome === "miss" ? null : 100;
}

/**
 * What shrinking an image of `original` bytes in place would leave, which a copy has to beat: its
 * shrink's file (`sameFormat`, { compressed, outcome }) when that is smaller, else the image itself.
 */
export function baseOf({ compressed, outcome }, original) {
  return ["hit", "exact", "lossless"].includes(outcome) && compressed < original ? compressed : original;
}

/**
 * The project that holds the image at `image`: the folder of the nearest package.json above it, else
 * the current folder, as --check and the lint take it (a site without one is still a project).
 */
export function rootOf(image) {
  return projectRoot(dirname(resolve(image)), process.cwd());
}

/**
 * Writes the image at `input` as `format` ("webp", "avif") to `output`, at equalTarget() of `target`
 * (a score, or undefined for automatic), when the copy is smaller than the image. `mode` "sibling"
 * (--format) writes only a new file, and only a copy smaller than the image's shrink too; "named" (-o)
 * replaces `output`, as -o does. The image is read once, and never written. Returns { status }:
 * - "written", with { text, original, written, base, sameFormat }: `text` what the command prints
 *   after "→ output: ", the sizes of the image and the copy, baseOf() the image, and `sameFormat` the
 *   image's own shrink, { compressed (mark included, as the command would write it), outcome, score };
 * - "left", with { reason }, why it wrote nothing;
 * - in sibling mode, "already" when `output` holds these very bytes, and "inTheWay" when anything else
 *   is there (another file, a folder, a link).
 * Throws why slimdeer can't take the image (images.js unsupported()), an engine bug, or why `output`
 * can't be written, naming it.
 */
export function convertImage(input, output, { format, target, mode }) {
  const { name, extension } = FORMATS[format];
  const bytes = readFileSync(input);
  const why = unsupported(bytes);
  if (why) throw new Error(why);
  // a PNG or JPEG named like its own copy (photo.webp): there is no new name to write
  if (mode === "sibling" && extname(input).toLowerCase() === extension) return { status: "left", reason: `its name already ends in ${extension}; name the copy with -o` };
  const left = leftOut(bytes, resolve(input), format, rootOf(input));
  if (left) return { status: "left", reason: left.reason };
  const own = kind(bytes) === "jpeg" ? "JPEG" : "PNG";

  // never from the cache: these are the bytes converted, read once
  const shrunk = compress(bytes, target);
  const sameFormat = { compressed: shrunk.outcome === "original" ? bytes.length : mark(keepOrientation(bytes, shrunk.output)).length, outcome: shrunk.outcome, score: shrunk.score };
  const equal = equalTarget(target, sameFormat);
  if (equal === null) {
    // with -o, the example keeps -o: --format would write another file than the one asked for
    const example = shrinkCommand([input], 80, undefined, mode === "named" ? undefined : format);
    const command = mode === "named" ? `${example.text} -o ${quote(output)}` : example.text;
    return { status: "left", reason: `shrunk as ${own} it doesn't reach quality ${FLOOR}, so there is no quality to match; to choose one, add --target, like${example.shell}: ${command}` };
  }
  let copy;
  try {
    copy = convert(bytes, format, equal);
  } catch (error) {
    if (error.refused) return { status: "left", reason: error.message };
    throw error;
  }
  if (copy.outcome === "miss") {
    // rounded down: a miss's best is below its target, and 90.5 shown as 91 would reach --target 91
    const asked = target === undefined ? `quality ${Math.round(equal)}/100, the ${own}'s` : `--target ${target}`;
    return { status: "left", reason: `as ${name}, no file reaches ${asked} (the best reaches ${Math.floor(copy.score)}/100)` };
  }
  const written = copy.output.length;
  if (written >= bytes.length) return { status: "left", reason: `as ${name} it would be ${size(written)}, no smaller than the image itself (${size(bytes.length)})` };
  const base = baseOf(sameFormat, bytes.length);
  // next to the image, a copy has to beat its shrink too
  if (mode === "sibling" && written >= base) {
    const { text, shell } = shrinkCommand([input], target);
    return { status: "left", reason: `as ${name} it would be ${size(written)}, no smaller than shrinking it as ${own} at the same quality (${size(base)}); to shrink it in place instead, run${shell}: ${text}` };
  }

  if (mode === "named") {
    // through a link to its file, as -o does (shrink.js); the image itself only by a caller's mistake
    const file = physical(output);
    if (file === physical(input)) throw new Error(`can't write ${output}: it is the image itself`);
    save(file, copy.output);
  } else {
    const status = create(output, copy.output);
    if (status) return { status };
  }
  const shrink = sameText(sameFormat, bytes.length, target, own) + (base < written ? `, smaller than this ${name}` : "");
  const text = `${size(bytes.length)} → ${size(written)} (${smaller(bytes.length, written)}% smaller, quality ${Math.round(copy.score)}/100: looks ${looks(copy.score)}); ${shrink}`;
  return { status: "written", text, original: bytes.length, written, base, sameFormat };
}

/**
 * What to say before writing copies in `format` of `files` (as they're shown) from the projects at
 * `roots`: for each project that depends on a framework that converts images itself, that it does;
 * then, for AVIF, each image named like a share image or an icon. Lines for stderr, without a line break.
 */
export function cautions(roots, format, files) {
  const cwd = process.cwd();
  const lines = [];
  for (const root of new Set(roots)) {
    const framework = FRAMEWORKS.find((dependency) => dependencies(root).has(dependency));
    if (!framework) continue;
    // as the filesystem spells them, so a link (macOS's /var) doesn't hide that one folder holds the other
    const up = relative(physical(root), physical(cwd));
    const here = !isAbsolute(up) && up !== ".." && !up.startsWith(`..${sep}`);
    lines.push(`slimdeer: ${here ? "this project" : pathFrom(cwd, root)} depends on ${framework}, which can serve images as WebP by itself; convert only images it doesn't serve, or they go through a second lossy pass`);
  }
  if (format !== "avif") return lines;
  for (const file of files) {
    if (SHARED.test(basename(file))) lines.push(`slimdeer: ${file} looks like a share image or an icon by its name; in a December 2024 test, link previews on X, LinkedIn, Slack and iMessage didn't show AVIF, so keep a PNG or JPEG for those`);
  }
  return lines;
}

/** What the image's own shrink would do, after the copy's sizes. */
function sameText({ compressed, outcome }, original, target, own) {
  if (outcome === "miss") return `as ${own}, no smaller file reaches --target ${target}`;
  // the mark costs a few dozen bytes, more than slimdeer saves on some tiny files (shrink.js)
  if (outcome === "original" || compressed >= original) return `as ${own}, slimdeer can't make it smaller`;
  return outcome === "hit" ? `shrunk as ${own} at the same quality: ${size(compressed)}` : `shrunk as ${own} (lossless): ${size(compressed)}`;
}

const packages = new Map(); // project root -> the names its package.json depends on, read once

function dependencies(root) {
  if (!packages.has(root)) {
    let names = [];
    try {
      const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
      names = [...Object.keys(pkg.dependencies ?? {}), ...Object.keys(pkg.devDependencies ?? {})];
    } catch {
      // no package.json there, or one that can't be read: nothing it depends on is known
    }
    packages.set(root, new Set(names));
  }
  return packages.get(root);
}

/**
 * Writes `bytes` to `path` only if nothing is there, not even a link or a folder, and whole or not at
 * all: null when it did; else "already" when `path` holds these very bytes, or "inTheWay".
 */
function create(path, bytes) {
  try {
    exclusive(path, bytes);
    return null;
  } catch (error) {
    // a folder that can't be written may hold the copy already
    if (error.code !== "EEXIST" && !there(path)) throw new Error(`can't write ${path}: ${plain(error)}`);
  }
  try {
    return readFileSync(path).equals(bytes) ? "already" : "inTheWay";
  } catch {
    // a folder, a link that leads nowhere, a file that can't be read
    return "inTheWay";
  }
}

/** Whether anything is at `path`, a link that leads nowhere included: no copy is written over it. */
export function there(path) {
  try {
    lstatSync(path);
    return true;
  } catch {
    return false;
  }
}

/** create()'s write: throws EEXIST when anything is at `path`. */
function exclusive(path, bytes) {
  // A folder made new beside `path`: nothing in it can be a link someone left, and a link from it
  // never crosses a filesystem. link() then fails on anything at `path`, a link that leads nowhere
  // included, and never writes through one.
  const temp = mkdtempSync(join(dirname(path), ".slimdeer-"));
  try {
    const file = join(temp, basename(path));
    writeFileSync(file, bytes);
    linkSync(file, path);
    return;
  } catch (error) {
    if (!NO_LINKS.has(error.code)) throw error;
  } finally {
    try {
      rmSync(temp, { recursive: true, force: true, maxRetries: 3 });
    } catch {
      // a virus scanner can hold the temp file a moment (Windows): what was written stands
    }
  }
  // no hard links on this filesystem: "wx" makes a new file only, and one left half written goes
  const fd = openSync(path, "wx");
  let done = false;
  try {
    writeFileSync(fd, bytes);
    done = true;
  } finally {
    closeSync(fd);
    if (!done) rmSync(path, { force: true });
  }
}
