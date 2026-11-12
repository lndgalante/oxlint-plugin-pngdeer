// Every PNG and JPEG in a project, to measure them all in one parallel batch on a run's first file
// (later references then find them cached), and the other files the summary searches for images no
// linted code names. Folders are skipped by name, not by reading .gitignore: dot folders,
// dependencies, build output, and test output such as visual-regression snapshots, which are images
// too but never shipped. A folder with its own package.json is another project, with its own cache,
// and is left to it, unless the caller walks every project below a folder (--check).
import { readdirSync, realpathSync, statSync } from "node:fs";
import { dirname, extname, join, relative, sep } from "node:path";
import { EXTENSIONS } from "./images.js";

const SKIP = new Set([
  "node_modules", "dist", "build", "out", "coverage", "target", "vendor",
  "__snapshots__", "__screenshots__", "__image_snapshots__", "__fixtures__",
  "test-results", "playwright-report", "storybook-static", "cypress",
]);
const patterns = new Map();
const roots = new Map();
// macOS and Windows don't tell letter case apart in file names, so there an exclusion doesn't either
// (nor does .gitignore): "public/originals" leaves out the folder public/Originals
const CASELESS = process.platform === "darwin" || process.platform === "win32";

/** The nearest directory with a package.json, from `dir` up; `fallback` if none has one. */
export function projectRoot(dir, fallback) {
  const key = `${dir}\0${fallback}`;
  if (!roots.has(key)) {
    const parent = dirname(dir);
    let packageHere = false;
    try {
      packageHere = statSync(join(dir, "package.json")).isFile();
    } catch {
      // A folder without a readable package.json belongs to its parent's project.
    }
    roots.set(key, packageHere ? dir : parent === dir ? fallback : projectRoot(parent, fallback));
  }
  return roots.get(key);
}

/** Whether a root-relative file or directory matches an exclusion, including its descendants. */
export function excluded(root, file, exclude = []) {
  if (exclude.length === 0) return false;
  const path = relative(root, file).split(sep).join("/");
  return exclude.some((pattern) => {
    if (!patterns.has(pattern)) patterns.set(pattern, glob(pattern));
    const match = patterns.get(pattern);
    return match.test(path) || match.test(`${path}/`);
  });
}

/** Project images above `minSize`, with projectFiles()'s options. */
export function projectImages(root, minSize = 0, exclude = [], options = {}) {
  return projectFiles(root, EXTENSIONS, minSize, Infinity, exclude, options);
}

/**
 * The project's files with one of `extensions`, from `minSize` to `maxSize` bytes. Exclusions match a
 * path from options.base, or from options.top too when given; options.onError reports failures. A
 * folder with its own package.json is left out, or with options.nested walked too, its own folder
 * then anchoring exclusions in place of base, as each project's exclusions start at its own folder.
 */
export function projectFiles(root, extensions, minSize = 0, maxSize = Infinity, exclude = [], { base = root, top, nested = false, onError = () => {} } = {}) {
  const found = [];
  const anchors = (from) => (top === undefined ? [from] : [from, top]);
  const out = (from, path) => anchors(from).some((anchor) => excluded(anchor, path, exclude));
  const real = new Map(); // each anchor as the filesystem spells it, read once a link needs it
  // A linked file is also left out when an exclusion matches where it leads, as the rule's own check
  // does (rule.js): else a command printed for it would rewrite an excluded file.
  const leadsOut = (from, path) => {
    if (exclude.length === 0) return false;
    try {
      const target = realpathSync.native(path);
      return anchors(from).some((anchor) => {
        if (!real.has(anchor)) real.set(anchor, physical(anchor));
        return excluded(real.get(anchor), target, exclude);
      });
    } catch {
      // a broken link: reported when its size is read
      return false;
    }
  };
  const walk = (dir, from) => {
    if (out(from, dir)) return;
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch (error) {
      onError(dir, error);
      return;
    }
    if (dir !== root && entries.some((entry) => entry.name === "package.json" && entry.isFile())) {
      if (!nested) return;
      from = dir;
    }
    for (const entry of entries) {
      if (entry.name.startsWith(".")) continue;
      const path = join(dir, entry.name);
      if (out(from, path)) continue;
      if (entry.isDirectory()) {
        // Playwright keeps a test's snapshots in "<test file>-snapshots"
        if (!SKIP.has(entry.name) && !entry.name.endsWith("-snapshots")) walk(path, from);
      } else if ((entry.isFile() || entry.isSymbolicLink()) && extensions.includes(extname(entry.name).toLowerCase())) {
        if (entry.isSymbolicLink() && leadsOut(from, path)) continue;
        const bytes = size(path, onError);
        if (bytes >= minSize && bytes <= maxSize) found.push(path);
      }
    }
  };
  walk(root, base);
  return found;
}

/**
 * A path as the filesystem spells it (links resolved, its own letter case and Unicode form: code may
 * name Logo.png as logo.png where the filesystem doesn't tell them apart), or as given if it can't be read.
 */
export function physical(path) {
  try {
    return realpathSync.native(path);
  } catch {
    return path;
  }
}

/** Small path globs: * and ? stay in one segment; ** crosses directory boundaries. */
function glob(pattern) {
  const path = pattern.replace(/\\/g, "/").replace(/^(?:\.\/)+|^\/+|\/+$/g, "");
  if (path === ".") return /^/;
  let source = "";
  for (let i = 0; i < path.length; i++) {
    const char = path[i];
    if (char === "*" && path[i + 1] === "*") {
      i++;
      if (path[i + 1] === "/") {
        source += "(?:[^/]+/)*";
        i++;
      } else source += ".*";
    } else if (char === "*") source += "[^/]*";
    else if (char === "?") source += "[^/]";
    else source += char.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp(`^${source}(?:/|$)`, CASELESS ? "i" : "");
}

function size(path, onError) {
  try {
    const stat = statSync(path);
    // Include linked files, but never recurse through directory links or read special files.
    return stat.isFile() ? stat.size : -1;
  } catch (error) {
    onError(path, error);
    return -1;
  }
}
