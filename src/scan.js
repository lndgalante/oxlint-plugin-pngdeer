// Every PNG and JPEG in a project, to measure them all in one parallel batch on a run's first file
// (later references then find them cached), and the other files the summary searches for images no
// linted code names. Folders are skipped by name, not by reading .gitignore: dot folders,
// dependencies, build output, and test output such as visual-regression snapshots, which are images
// too but never shipped. A folder with its own package.json is another project, with its own cache,
// and is left to it.
import { readdirSync, statSync } from "node:fs";
import { extname, join } from "node:path";
import { EXTENSIONS } from "./images.js";

const SKIP = new Set([
  "node_modules", "dist", "build", "out", "coverage", "target", "vendor",
  "__snapshots__", "__screenshots__", "__image_snapshots__", "__fixtures__",
  "test-results", "playwright-report", "storybook-static", "cypress",
]);

/** The project's images of at least `minSize` bytes. */
export function projectImages(root, minSize = 0) {
  return projectFiles(root, EXTENSIONS, minSize);
}

/** The project's files with one of `extensions`, from `minSize` to `maxSize` bytes. */
export function projectFiles(root, extensions, minSize = 0, maxSize = Infinity) {
  const found = [];
  const walk = (dir) => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    if (dir !== root && entries.some((entry) => entry.name === "package.json" && entry.isFile())) return;
    for (const entry of entries) {
      if (entry.name.startsWith(".")) continue;
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        // Playwright keeps a test's snapshots in "<test file>-snapshots"
        if (!SKIP.has(entry.name) && !entry.name.endsWith("-snapshots")) walk(path);
      } else if (entry.isFile() && extensions.includes(extname(entry.name).toLowerCase())) {
        const bytes = size(path);
        if (bytes >= minSize && bytes <= maxSize) found.push(path);
      }
    }
  };
  walk(root);
  return found;
}

function size(path) {
  try {
    return statSync(path).size;
  } catch {
    return 0;
  }
}
