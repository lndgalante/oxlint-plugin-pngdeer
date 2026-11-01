// Path aliases a project defines in tsconfig.json or jsconfig.json (compilerOptions.paths), resolved
// the way TypeScript does, so "@/assets/hero.png" finds the file the build would: `extends` (later
// entries win, ".json" optional), `paths` and `baseUrl` each from the nearest config that sets them
// (`null` unsets), targets relative to `baseUrl` or else to the config that set `paths`, and
// `${configDir}` as the folder of the config being resolved. A config without paths falls back to
// its `references` (Vite keeps them in tsconfig.app.json). Configs from packages are skipped: they
// don't point into the project.
import { readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";

const found = new Map(); // project root -> { aliases, seen: Map(config path -> mtime, or -1 if missing) }
const told = new Set(); // configs that couldn't be read, already said so

/** Folder aliases relative to `root`, with arrays for fallback targets; null if none. */
export function configAliases(root) {
  const memo = found.get(root);
  // a config edited since (an editor runs for hours; .svelte-kit and .nuxt regenerate theirs)
  if (memo && [...memo.seen].every(([file, mtime]) => mtimeOf(file) === mtime)) return memo.aliases;
  const seen = new Map();
  let aliases = null;
  try {
    aliases = projectAliases(root, seen);
  } catch {
    // whatever a config holds, the rule goes on with the default aliases
  }
  found.set(root, { aliases, seen });
  return aliases;
}

/** The aliases of the project's tsconfig.json (or jsconfig.json, without one), or of its references. */
function projectAliases(root, seen) {
  const tsconfig = join(root, "tsconfig.json");
  seen.set(tsconfig, mtimeOf(tsconfig));
  const leaf = seen.get(tsconfig) >= 0 ? tsconfig : join(root, "jsconfig.json");
  const options = effective(leaf, dirname(leaf), seen, new Set());
  if (options?.paths !== undefined) return aliasesOf(options, root, dirname(leaf));
  for (const reference of load(leaf, seen)?.references ?? []) {
    if (typeof reference?.path !== "string") continue;
    const file = configFile(resolve(dirname(leaf), reference.path), seen);
    if (!file) continue;
    const referenced = effective(file, dirname(file), seen, new Set());
    if (referenced?.paths !== undefined) return aliasesOf(referenced, root, dirname(file));
  }
  return null;
}

/**
 * A config's `paths` (with `pathsDir`, the folder of the config that set them) and `baseUrl` (a
 * folder), after its `extends`; a key is present only if some config in the chain set it.
 */
function effective(file, configDir, seen, chain) {
  if (chain.has(file)) return {};
  chain.add(file);
  const config = load(file, seen);
  if (!config) return null;
  let options = {};
  const extended = typeof config.extends === "string" ? [config.extends] : Array.isArray(config.extends) ? config.extends : [];
  for (const spec of extended) {
    const base = typeof spec === "string" && (spec.startsWith(".") || spec.startsWith("/") || spec.startsWith("${configDir}")) ? configFile(resolve(dirname(file), expand(spec, configDir)), seen) : null;
    if (base) options = { ...options, ...effective(base, configDir, seen, new Set(chain)) };
  }
  const own = config.compilerOptions ?? {};
  if ("baseUrl" in own) options.baseUrl = typeof own.baseUrl === "string" ? resolve(dirname(file), expand(own.baseUrl, configDir)) : undefined;
  if ("paths" in own) {
    options.paths = own.paths && typeof own.paths === "object" ? own.paths : null;
    options.pathsDir = dirname(file);
  }
  return options;
}

/** Folder aliases from effective options; null when none is a folder pattern ("@/*": ["./src/*"]). */
function aliasesOf({ paths, pathsDir, baseUrl }, root, configDir) {
  const aliases = {};
  for (const [pattern, targets] of Object.entries(paths ?? {})) {
    // a bare "*" would match every path
    if (pattern === "*" || !pattern.endsWith("*") || !Array.isArray(targets)) continue;
    const folders = targets.filter((target) => typeof target === "string" && target.endsWith("*")).map((target) => {
      const folder = relative(root, resolve(baseUrl ?? pathsDir, expand(target, configDir).slice(0, -1))).split(sep).join("/");
      return folder ? `${folder}/` : "";
    });
    if (folders.length) aliases[pattern.slice(0, -1)] = folders.length === 1 ? folders[0] : folders;
  }
  return Object.keys(aliases).length ? aliases : null;
}

/** A config's contents, or null if it doesn't exist; a config that can't be parsed is named on stderr once. */
function load(file, seen) {
  seen.set(file, mtimeOf(file));
  let text;
  try {
    text = readFileSync(file, "utf8");
  } catch {
    return null;
  }
  try {
    return parse(text);
  } catch (error) {
    if (!told.has(file)) {
      told.add(file);
      process.stderr.write(`pngdeer: couldn't read path aliases from ${file}: ${error.message}\n`);
    }
    return null;
  }
}

/** The config file a path in `extends` or `references` names: as is, with ".json", or a folder's tsconfig.json. */
function configFile(path, seen) {
  for (const file of [path, `${path}.json`, join(path, "tsconfig.json")]) {
    seen.set(file, mtimeOf(file));
    try {
      if (statSync(file).isFile()) return file;
    } catch {
      // not this one
    }
  }
  return null;
}

/** JSON with a BOM, comments and trailing commas, as tsconfig files are written. */
function parse(text) {
  const bare = text.replace(/^\uFEFF/, "").replace(/"(?:\\.|[^"\\])*"|\/\/[^\n]*|\/\*[\s\S]*?\*\//g, (match) => (match.startsWith('"') ? match : ""));
  return JSON.parse(bare.replace(/"(?:\\.|[^"\\])*"|,(?=\s*[}\]])/g, (match) => match === "," ? "" : match));
}

/** TypeScript 5.5's ${configDir}: the folder of the config being resolved, not of the one that says it. */
function expand(path, configDir) {
  return path.replace(/^\$\{configDir\}/, configDir);
}

function mtimeOf(file) {
  try {
    return statSync(file).mtimeMs;
  } catch {
    return -1;
  }
}
