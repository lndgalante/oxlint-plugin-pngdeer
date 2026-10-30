// Every PNG and JPEG under a project, to measure them all in one parallel batch the first time the
// rule meets an image it hasn't seen (later references then find them cached). A prototype: build
// output and dependencies are skipped by name, not by reading .gitignore.
import { readdirSync } from "node:fs";
import { extname, join } from "node:path";
import { EXTENSIONS } from "./images.js";

const SKIP = new Set(["node_modules", "dist", "build", "out", "coverage", "target", "vendor"]);

export function projectImages(root) {
  const found = [];
  const walk = (dir) => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.name.startsWith(".")) continue;
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!SKIP.has(entry.name)) walk(path);
      } else if (entry.isFile() && EXTENSIONS.includes(extname(entry.name).toLowerCase())) {
        found.push(path);
      }
    }
  };
  walk(root);
  return found;
}
