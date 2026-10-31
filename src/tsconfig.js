// Path aliases a project defines in tsconfig.json or jsconfig.json (compilerOptions.paths), so
// "@/assets/hero.png" finds the file the build would. Vite's templates keep them in a referenced
// config (tsconfig.app.json), and many extend another, so `references` and `extends` are followed.
import { readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";

const found = new Map(); // project root -> its aliases, or null when it defines none

/** { "@/": "src/" }-style aliases from the project's config, as folders relative to `root`; null if none. */
export function configAliases(root) {
  if (!found.has(root)) {
    const seen = new Set();
    found.set(root, aliasesIn(join(root, "tsconfig.json"), root, seen) ?? aliasesIn(join(root, "jsconfig.json"), root, seen));
  }
  return found.get(root);
}

/** The aliases one config defines, or else the first its `extends` or `references` define. */
function aliasesIn(file, root, seen) {
  if (seen.has(file)) return null;
  seen.add(file);
  let config;
  try {
    config = parse(readFileSync(file, "utf8"));
  } catch {
    return null;
  }
  const { paths, baseUrl = "." } = config.compilerOptions ?? {};
  const aliases = {};
  for (const [pattern, [target] = []] of Object.entries(paths ?? {})) {
    // only folder patterns map to an alias: "@/*": ["./src/*"]; a bare "*" would match every path
    if (pattern === "*" || !pattern.endsWith("*") || typeof target !== "string" || !target.endsWith("*")) continue;
    const folder = relative(root, resolve(dirname(file), baseUrl, target.slice(0, -1))).split(sep).join("/");
    aliases[pattern.slice(0, -1)] = folder ? `${folder}/` : "";
  }
  if (Object.keys(aliases).length) return aliases;

  const extended = typeof config.extends === "string" ? [config.extends] : (config.extends ?? []);
  const referenced = (config.references ?? []).map((reference) => reference.path);
  for (const next of [...extended, ...referenced]) {
    // a package's config (@tsconfig/strictest) has no paths into this project
    if (typeof next !== "string" || !next.startsWith(".")) continue;
    const path = resolve(dirname(file), next);
    const aliases = aliasesIn(isFolder(path) ? join(path, "tsconfig.json") : path, root, seen);
    if (aliases) return aliases;
  }
  return null;
}

/** JSON with comments and trailing commas, as tsconfig files are written. */
function parse(text) {
  const bare = text.replace(/"(?:\\.|[^"\\])*"|\/\/[^\n]*|\/\*[\s\S]*?\*\//g, (match) => (match.startsWith('"') ? match : ""));
  return JSON.parse(bare.replace(/,(\s*[}\]])/g, "$1"));
}

function isFolder(path) {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}
