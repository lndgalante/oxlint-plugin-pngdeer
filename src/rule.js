// pngdeer/compressible-image: on each string in the code that names a local PNG or JPEG (imports,
// require, new URL, JSX src and srcSet, plain strings), says how much smaller pngdeer would make it.
// oxlint never lints image files themselves, so the reference is where the warning goes.
import { readFileSync, statSync } from "node:fs";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { cacheDir, key, read } from "./cache.js";
import { marked } from "./marker.js";
import { projectImages } from "./scan.js";
import { fillInBackground, fillSync } from "./sync.js";
import { count, quote, size } from "./text.js";

const IMAGE = /\.(png|apng|jpe?g)$/i;
const REMOTE = /^[a-z][a-z0-9+.-]*:|^\/\//i;
const DEFAULTS = { minSavedBytes: 4096, minSavedPercent: 10, target: "auto", measure: "auto" };

// Editors lint on every keystroke, so there the rule measures in the background and reports on a
// later lint. Everywhere else it waits: a one-off run (the oxlint or eslint command, or a tool calling
// ESLint's Node API, like Nx or xo) would exit before a background batch finished. Neither linter
// has an API for this: it's how oxlint's language server (--lsp) and ESLint's (the one VS Code, Zed
// and Neovim use, an Electron child in VS Code) start.
const EDITOR =
  process.argv.includes("--lsp") ||
  /eslintServer|language-?server|languageService/i.test(process.argv[1] ?? "") ||
  process.env.ELECTRON_RUN_AS_NODE === "1";

// Per process (the language server's lasts the whole editor session):
const keys = new Map(); // image path -> { size, mtimeMs, target, key, marked }, so images aren't re-read on every keystroke
const roots = new Map(); // directory -> its project root
const scanned = new Set(); // `${root}\0${target}` whose images were all measured, or queued, once
const failed = new Set(); // outside editors: roots whose batch failed, not tried again this run
const told = new Set(); // outside editors: images already named on stderr
const savings = new Map(); // outside editors: image path -> { original, saved }, for the total at exit

export default {
  meta: {
    type: "suggestion",
    docs: {
      description: "Flag PNGs and JPEGs that pngdeer would make much smaller at about the same visual quality",
      recommended: true,
      url: "https://github.com/lndgalante/oxlint-plugin-pngdeer/blob/main/docs/rules/compressible-image.md",
    },
    messages: {
      compressible: "{{name}} could be {{percent}}% smaller ({{before}} → {{after}}) at {{quality}}. Run: {{command}}",
      lossless: "{{name}} could be {{percent}}% smaller ({{before}} → {{after}}) losslessly. Run: {{command}}",
    },
    schema: [
      {
        type: "object",
        properties: {
          minSavedBytes: { type: "integer", minimum: 0 },
          minSavedPercent: { type: "number", minimum: 0, maximum: 100 },
          target: { anyOf: [{ const: "auto" }, { type: "number", minimum: 0, maximum: 100 }] },
          measure: { enum: ["auto", "always", "never"] },
        },
        additionalProperties: false,
      },
    ],
    // Lighthouse flags an image from 4 KiB of savings; 10% keeps already-tight files quiet. Also read
    // in create(), as ESLint before 9.15 ignores defaultOptions.
    defaultOptions: [DEFAULTS],
  },

  create(context) {
    const { minSavedBytes, minSavedPercent, target: option, measure } = { ...DEFAULTS, ...context.options[0] };
    const target = option === "auto" ? undefined : option;
    const { publicDirs = ["public", "static"], aliases = { "@/": "src/", "~/": "src/" } } = context.settings.pngdeer ?? {};
    const from = context.physicalFilename ?? context.filename;
    // public dirs, aliases and the cache belong to the package, wherever the linter was started
    const root = projectRoot(dirname(from), context.cwd);
    const dir = cacheDir(root);
    const find = (path) => locate(path, from, root, publicDirs, aliases);
    // a path as the person running the linter would type it
    const shown = (file) => relative(context.cwd, file).split(sep).join("/");
    const wait = measure === "always" || (measure === "auto" && !EDITOR);
    const found = [];

    function check(node, text) {
      for (const file of imagesIn(text, find)) {
        const image = fileKey(file, target);
        // a file smaller than minSavedBytes can't save that much: not worth measuring
        if (image && image.size >= minSavedBytes) found.push({ node, file, k: image.key });
      }
    }

    function report({ node, file }, result) {
      if (!result || result.skipped || !["hit", "exact", "lossless"].includes(result.outcome)) return;
      const saved = result.original - result.compressed;
      const percent = Math.round((100 * saved) / result.original);
      if (saved < minSavedBytes || percent < minSavedPercent) return;
      if (!EDITOR) savings.set(file, { original: result.original, saved });
      // this package's own command (bin/pngdeer.js), at the target measured, so it writes exactly the
      // file this promises; named by the package, so npx can't fetch someone else's
      const command = `npx oxlint-plugin-pngdeer ${quote(shown(file))}${target === undefined ? "" : ` --target ${target}`}`;
      context.report({
        node,
        messageId: result.outcome === "hit" ? "compressible" : "lossless",
        data: {
          name: basename(file),
          percent,
          before: size(result.original),
          after: size(result.compressed),
          quality: target === undefined ? "about the same visual quality" : `SSIMULACRA2 ${target}`,
          command,
        },
      });
    }

    // When the lint waits for measuring, says once per image what the warnings can't: why one is missing.
    function tell(file, result) {
      if (!wait || !result?.skipped || told.has(file)) return;
      told.add(file);
      process.stderr.write(`pngdeer: ${result.failed ? "" : "skipped "}${shown(file)}: ${result.skipped}\n`);
    }

    return {
      Literal(node) {
        if (typeof node.value === "string") check(node, node.value);
      },
      TemplateLiteral(node) {
        if (node.expressions.length === 0) check(node, node.quasis[0].value.cooked ?? "");
      },
      // What this file names is measured, then reported. The first time, every image in the
      // project goes in the same parallel batch, so the files linted next find theirs cached.
      "Program:exit"() {
        if (found.length === 0) return;
        const missing = measure === "never" ? [] : [...new Set(found.filter(({ k }) => !read(dir, k)).map(({ file }) => file))];
        if (missing.length) {
          const group = `${root}\0${target}`;
          const files = scanned.has(group) ? missing : [...new Set([...missing, ...projectImages(root, minSavedBytes)])];
          scanned.add(group);
          if (!wait) fillInBackground({ cwd: root, target, files });
          else if (!failed.has(root)) measureNow(files);
        }
        for (const ref of found) {
          const result = read(dir, ref.k);
          tell(ref.file, result);
          report(ref, result);
        }
      },
    };

    function measureNow(files) {
      // how many need the engine, to say what the wait is for (the hashes are kept for later lookups)
      const fresh = files.filter((file) => {
        const image = fileKey(file, target);
        return image && !image.marked && !read(dir, image.key);
      }).length;
      if (fresh) process.stderr.write(`pngdeer: measuring ${count(fresh, "image")} not in the cache yet...\n`);
      try {
        const { computed, ms } = fillSync({ cwd: root, target, files });
        if (computed) process.stderr.write(`pngdeer: measured ${count(computed, "image")} in ${(ms / 1000).toFixed(1)} s; later runs read the cache\n`);
      } catch (error) {
        // the images stay unmeasured (and unreported) rather than failing the lint, and the rest
        // of this run doesn't try again
        failed.add(root);
        process.stderr.write(`${error.message}\n`);
      }
    }
  },
};

// A run's last word, outside editors: what all the warnings add up to, each image counted once.
if (!EDITOR) {
  process.once("exit", () => {
    if (savings.size === 0) return;
    let original = 0;
    let saved = 0;
    for (const image of savings.values()) {
      original += image.original;
      saved += image.saved;
    }
    process.stderr.write(`pngdeer: ${count(savings.size, "image")} could be ${size(saved)} smaller in all (${Math.round((100 * saved) / original)}%)\n`);
  });
}

/** The image files a string in the code names: itself, or else a srcSet's candidates. */
function imagesIn(text, find) {
  // a query or hash ends a path, but a leading # is a subpath import ("#assets/x.png")
  const strip = (path) => path.replace(/(?!^)[?#].*$/, "");
  const usable = (path) => IMAGE.test(path) && !REMOTE.test(path);
  // a whole path first, as file names can hold spaces and commas ("Screenshot … at 10.12.33.png")
  const whole = strip(text.trim());
  const single = usable(whole) && find(whole);
  if (single) return [single];
  const candidates = text.split(",").map((part) => strip(part.trim().split(/\s+/)[0]));
  return candidates.filter(usable).map(find).filter(Boolean);
}

/** The file a path in `from` names, or null: relative to the file, or "/x" in a public dir or the root. */
function locate(path, from, root, publicDirs, aliases) {
  const tries = [];
  if (path.startsWith("./") || path.startsWith("../")) tries.push(resolve(dirname(from), path));
  else if (path.startsWith("/")) tries.push(...publicDirs.map((dir) => join(root, dir, path)), join(root, path));
  else {
    for (const [prefix, target] of Object.entries(aliases)) {
      if (path.startsWith(prefix)) tries.push(join(root, target, path.slice(prefix.length)));
    }
  }
  return tries.find(isFile) ?? null;
}

/** The nearest directory with a package.json, from `dir` up; `fallback` if none has one. */
function projectRoot(dir, fallback) {
  if (!roots.has(dir)) {
    const parent = dirname(dir);
    roots.set(dir, isFile(join(dir, "package.json")) ? dir : parent === dir ? fallback : projectRoot(parent, fallback));
  }
  return roots.get(dir);
}

/** An image's size, the cache key of its current bytes and whether pngdeer wrote it; null if it can't be read. */
function fileKey(file, target) {
  try {
    const { size, mtimeMs } = statSync(file);
    const memo = keys.get(file);
    if (memo && memo.size === size && memo.mtimeMs === mtimeMs && memo.target === target) return memo;
    const bytes = readFileSync(file);
    const image = { size, mtimeMs, target, key: key(bytes, target), marked: marked(bytes) };
    keys.set(file, image);
    return image;
  } catch {
    return null;
  }
}

function isFile(path) {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}
