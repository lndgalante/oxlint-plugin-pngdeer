// The lines of a project that name an image, as the lint's summary finds the file that does
// (summary.js): what the command lists once it has written a copy, so each can be pointed at the new
// file, and what --check --json gives agents. Found in each file's text as it is, with no parsing.
import { readFileSync } from "node:fs";
import { basename, dirname, extname, isAbsolute, join, relative, sep } from "node:path";
import { projectFiles, projectRoot } from "./scan.js";
import { holds, ORDER, PAGE_BYTES } from "./summary.js";
import { pathFrom } from "./text.js";

const WIDTH = 100; // characters of a line shown, so a minified file's line stays one line
// macOS and Windows don't tell letter case apart in file names: there, code may name hero.png HERO.PNG
const CASELESS = process.platform === "darwin" || process.platform === "win32";

/**
 * Every line that names `image`, an image of the project at `root`, by a path (from its own file, from
 * the root, or "/x" from one of `publicDirs`, as written or URL-encoded), or, when no line does, by its
 * name alone: [{ file, line, text, markdown }], `file` absolute, `line` from 1, `text` trimmed, tabs
 * as spaces, and cut to 100 characters, and `markdown` for Markdown files, which come after all the
 * others. The lines are looked for in the project this runs in when it holds `root` (a monorepo's
 * root holds its packages), else in `root`'s, packages inside it included. Give `image` and `root`
 * the same spelling (both from resolve(), say), or the paths won't match.
 */
export function mentions(image, root, publicDirs = ["public", "static"]) {
  // folded before any path is made from them, so SRC/ASSETS typed for src/assets still leads from src/
  const fold = (text) => (CASELESS ? text.toLowerCase() : text);
  const spellings = (forms) => [...new Set(forms.flatMap((form) => [form, encodeURI(form)]).map(fold))];
  const [path, home] = [fold(image), fold(root)];
  const names = spellings([basename(path)]);
  // every path ends in the name, so only files that hold it need a closer look
  const pages = pagesIn(scopeOf(root)).filter(({ folded }) => names.some((name) => folded.includes(name)));
  const byPath = pages.flatMap((page) => {
    const paths = spellings([
      pathFrom(fold(dirname(page.path)), path),
      pathFrom(home, path),
      ...publicDirs.map((dir) => `/${pathFrom(join(home, dir), path)}`).filter((form) => !form.startsWith("/..")),
    ]);
    return lines(page, paths, named);
  });
  return byPath.length ? byPath : pages.flatMap((page) => lines(page, names, holds));
}

/** The lines of `page` ({ path, text, folded }) where `test(line, spelling)` finds one of `spellings`. */
function lines({ path, text, folded }, spellings, test) {
  const markdown = extname(path).toLowerCase() === ".md";
  const shown = text.split("\n");
  // a "\r\n" line keeps its "\r" until it's trimmed, so the numbers are the same
  return folded.split("\n").flatMap((line, i) => (spellings.some((spelling) => test(line, spelling)) ? [{ file: path, line: i + 1, text: cut(shown[i].trim().replace(/\t+/g, " ")), markdown }] : []));
}

/**
 * Whether `line` names a file by `spelling`, a path from the file or the project: a bare name only
 * alone, or after "/" or "./" that start a path, as "img/hero.png" names another hero.png.
 */
function named(line, spelling) {
  if (spelling.includes("/")) return holds(line, spelling);
  for (let at = line.indexOf(spelling); at >= 0; at = line.indexOf(spelling, at + 1)) {
    const start = at >= 2 && line.startsWith("./", at - 2) ? at - 2 : line[at - 1] === "/" ? at - 1 : at;
    if (start === 0 || !/[\w./-]/.test(line[start - 1])) return true;
  }
  return false;
}

/** Where to look for the lines that name an image of the project at `root`: see mentions(). */
function scopeOf(root) {
  // with no package.json above the current folder, it holds no project but `root`'s
  const here = projectRoot(process.cwd(), root);
  const down = relative(here, root);
  return down === "" || (!isAbsolute(down) && down !== ".." && !down.startsWith(`..${sep}`)) ? here : root;
}

const pages = new Map(); // folder -> [{ path, text, folded }] of the files under it that may name images, in ORDER, read once

/** The files under `folder` that may name images, packages inside it included, as the lint's summary reads them (summary.js pagesOf()). */
function pagesIn(folder) {
  if (!pages.has(folder)) {
    const rank = (path) => ORDER.indexOf(extname(path).toLowerCase());
    // one walk, sorted by kind; the sort is stable, so each kind keeps the walk's order
    const files = projectFiles(folder, ORDER, 0, PAGE_BYTES, [], { nested: true }).sort((a, b) => rank(a) - rank(b));
    pages.set(folder, files.flatMap((path) => {
      try {
        const text = readFileSync(path, "utf8");
        return [{ path, text, folded: CASELESS ? text.toLowerCase() : text }];
      } catch {
        return [];
      }
    }));
  }
  return pages.get(folder);
}

/** `text` at most WIDTH characters long, its last one "…" when it was longer. */
function cut(text) {
  const chars = Array.from(text);
  return chars.length > WIDTH ? `${chars.slice(0, WIDTH - 1).join("")}…` : text;
}
