// pngdeer/compressible-image: on each string in the code that names a local PNG or JPEG (imports,
// require, new URL, JSX src and srcSet, plain strings), says how much smaller pngdeer would make it.
// oxlint never lints image files themselves, so the reference is where the warning goes.
import { readFileSync, statSync } from "node:fs";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { cacheDir, key, read } from "./cache.js";
import { projectImages } from "./scan.js";
import { fillInBackground, fillSync } from "./sync.js";

const IMAGE = /\.(png|apng|jpe?g)$/i;
const REMOTE = /^[a-z][a-z0-9+.-]*:|^\/\//i;

// oxlint's language server: lint on every keystroke, so never wait for pngdeer there. Not an API,
// just how the VS Code extension starts oxlint (1.90).
const EDITOR = process.argv.includes("--lsp");

// Per process (the language server's lasts the whole editor session):
const keys = new Map(); // image path -> { size, mtimeMs, target, key }, so images aren't re-hashed on every keystroke
const roots = new Map(); // directory -> its project root
const scanned = new Set(); // editor: `${root}\0${target}` whose images were all queued once
const failed = new Set(); // command line: roots whose batch failed, not tried again this run

export default {
  meta: {
    type: "suggestion",
    docs: { description: "Images pngdeer would make smaller at the same visual quality" },
    messages: {
      compressible: "{{name}} could be {{saved}} smaller ({{percent}}%: {{before}} → {{after}}) and still look right. Run: {{command}}",
      lossless: "{{name}} could be {{saved}} smaller ({{percent}}%: {{before}} → {{after}}) losslessly. Run: {{command}}",
    },
    schema: [
      {
        type: "object",
        properties: {
          minBytes: { type: "integer", minimum: 0 },
          minPercent: { type: "number", minimum: 0, maximum: 100 },
          target: { anyOf: [{ const: "auto" }, { type: "number", minimum: 0, maximum: 100 }] },
          compute: { enum: ["auto", "always", "never"] },
        },
        additionalProperties: false,
      },
    ],
    // Lighthouse flags an image from 4 KiB of savings; 10% keeps already-tight files quiet
    defaultOptions: [{ minBytes: 4096, minPercent: 10, target: "auto", compute: "auto" }],
  },

  create(context) {
    const { minBytes, minPercent, target: option, compute } = context.options[0];
    const target = option === "auto" ? undefined : option;
    const { publicDirs = ["public"], aliases = { "@/": "src/", "~/": "src/" } } = context.settings.pngdeer ?? {};
    const from = context.physicalFilename ?? context.filename;
    // public dirs, aliases and the cache belong to the package, wherever oxlint was started
    const root = projectRoot(dirname(from), context.cwd);
    const dir = cacheDir(root);
    const find = (path) => locate(path, from, root, publicDirs, aliases);
    const wait = compute === "always" || (compute === "auto" && !EDITOR);
    const found = [];

    function check(node, text) {
      for (const file of imagesIn(text, find)) {
        const k = fileKey(file, target);
        if (k) found.push({ node, file, k });
      }
    }

    function report({ node, file }, result) {
      if (!result || result.skipped || !["hit", "exact", "lossless"].includes(result.outcome)) return;
      const saved = result.original - result.compressed;
      const percent = Math.round((100 * saved) / result.original);
      if (saved < minBytes || percent < minPercent) return;
      const path = quote(relative(context.cwd, file).split(sep).join("/"));
      // the same target as measured, so the command writes exactly the file this promises
      const command = `pngdeer ${path} -o ${path}${target === undefined ? "" : ` --target ${target}`}`;
      context.report({
        node,
        messageId: result.outcome === "hit" ? "compressible" : "lossless",
        data: { name: basename(file), saved: size(saved), percent, before: size(result.original), after: size(result.compressed), command },
      });
    }

    return {
      Literal(node) {
        if (typeof node.value === "string") check(node, node.value);
      },
      TemplateLiteral(node) {
        if (node.expressions.length === 0) check(node, node.quasis[0].value.cooked ?? "");
      },
      // Everything this file names is measured together, in parallel, then reported.
      "Program:exit"() {
        if (found.length === 0) return;
        const missing = compute === "never" ? [] : [...new Set(found.filter(({ k }) => !read(dir, k)).map(({ file }) => file))];
        if (missing.length && wait && !failed.has(root)) {
          if (missing.length > 1 && process.stderr.isTTY) process.stderr.write(`pngdeer: measuring ${missing.length} images; they're cached after this\n`);
          try {
            fillSync({ cwd: root, target, files: missing });
          } catch (error) {
            // the images stay unmeasured (and unreported) rather than failing the lint, and the
            // rest of this run doesn't try again
            failed.add(root);
            process.stderr.write(`${error.message}\n`);
          }
        } else if (missing.length && !wait) {
          // in the editor, the first time, every image in the project, so files opened next are ready
          const group = `${root}\0${target}`;
          fillInBackground({ cwd: root, target, files: scanned.has(group) ? missing : [...missing, ...projectImages(root)] });
          scanned.add(group);
        }
        for (const ref of found) report(ref, read(dir, ref.k));
      },
    };
  },
};

/** The image files a string in the code names: itself, or else a srcSet's candidates. */
function imagesIn(text, find) {
  const strip = (path) => path.replace(/[?#].*$/, "");
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

/** The cache key of an image's current bytes, or null if it can't be read. */
function fileKey(file, target) {
  try {
    const { size, mtimeMs } = statSync(file);
    const memo = keys.get(file);
    if (memo && memo.size === size && memo.mtimeMs === mtimeMs && memo.target === target) return memo.key;
    const k = key(readFileSync(file), target);
    keys.set(file, { size, mtimeMs, target, key: k });
    return k;
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

function size(bytes) {
  if (bytes < 1000) return `${bytes} B`;
  if (bytes < 1e6) return `${(bytes / 1000).toFixed(bytes < 1e4 ? 1 : 0)} kB`;
  return `${(bytes / 1e6).toFixed(1)} MB`;
}

/** A path as a shell argument. */
function quote(arg) {
  return /^[\w@%+=:,./-]+$/.test(arg) ? arg : `'${arg.replace(/'/g, `'\\''`)}'`;
}
