// pngdeer/compressible-image: on each string in the code that names a local PNG or JPEG (imports,
// require, new URL, JSX src and srcSet, plain strings), says how much smaller pngdeer would make it.
// oxlint never lints image files themselves, so the reference is where the warning goes.
import { statSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { cacheDir, fileKey, readFirst, reportable } from "./cache.js";
import { excluded, projectImages, projectRoot } from "./scan.js";
import { flag, name, requireTarget, share, summarize, watch } from "./summary.js";
import { configAliases } from "./tsconfig.js";
import { fillInBackground, fillSync } from "./sync.js";
import { count, looks, pathFrom, shrinkCommand, size, smaller } from "./text.js";

const RULE = "pngdeer/compressible-image";
const IMAGE = /\.(png|apng|jpe?g)$/i;
const REMOTE = /^[a-z][a-z0-9+.-]*:|^\/\//i;
const DEFAULTS = { minSavedBytes: 4096, minSavedPercent: 10, target: "auto", measure: "auto", scan: "project", exclude: [] };
// when neither the settings nor the project's tsconfig/jsconfig define aliases
const ALIASES = { "@/": "src/", "~/": "src/" };

// Editors lint on every keystroke, so there the rule measures in the background and reports on a
// later lint. Everywhere else it waits: a one-off run (the oxlint or eslint command, or a tool calling
// ESLint's Node API, like Nx or xo) would exit before a background batch finished. Neither linter
// has an API for this: it's how oxlint's language server (--lsp), ESLint's (the one VS Code, Zed
// and Neovim use, an Electron child in VS Code) and the eslint_d daemon that editors call start.
const EDITOR =
  process.argv.includes("--lsp") ||
  /eslintServer|language-?server|languageService|eslint_d/i.test(process.argv[1] ?? "") ||
  process.env.ELECTRON_RUN_AS_NODE === "1";

// Per process (the language server's lasts the whole editor session):
const scanned = new Set(); // project scans already measured or queued, keyed by scope and settings
const failed = new Set(); // outside editors: roots whose batch failed, not tried again this run
const told = new Set(); // outside editors: images already named on stderr
// outside editors: `${image}\0${target}` -> the linted file that got the image's full warning; other
// files get a short one. A file linted again (eslint --fix passes, watch modes) keeps its full one.
const warned = new Map();

export default {
  meta: {
    type: "suggestion",
    docs: {
      description: "Flag PNGs and JPEGs that pngdeer would make much smaller at about the same visual quality",
      recommended: true,
      url: "https://github.com/lndgalante/oxlint-plugin-pngdeer/blob/main/docs/rules/compressible-image.md",
    },
    messages: {
      compressible: "{{name}} could be {{percent}}% smaller ({{before}} → {{after}}) and look {{looks}} (quality {{quality}}/100). Run{{shell}}: {{command}}",
      // the same image again, in another file of the same run: its first warning said the rest
      again: "{{name}} could be {{percent}}% smaller ({{before}} → {{after}}), as warned where it's first used. Run{{shell}}: {{command}}",
      lossless: "{{name}} could be {{percent}}% smaller ({{before}} → {{after}}), losslessly. Run{{shell}}: {{command}}",
    },
    schema: [
      {
        type: "object",
        properties: {
          minSavedBytes: { type: "integer", minimum: 0 },
          minSavedPercent: { type: "number", minimum: 0, maximum: 100 },
          target: { anyOf: [{ const: "auto" }, { type: "number", minimum: 0, maximum: 100 }] },
          measure: { enum: ["auto", "always", "never"] },
          scan: { enum: ["project", "referenced"] },
          exclude: { type: "array", items: { type: "string", minLength: 1 } },
        },
        additionalProperties: false,
      },
    ],
    // Lighthouse flags an image from 4 KiB of savings; 10% keeps already-tight files quiet. Also read
    // in create(), as ESLint before 9.15 ignores defaultOptions.
    defaultOptions: [DEFAULTS],
  },

  create(context) {
    const { minSavedBytes, minSavedPercent, target: option, measure, scan, exclude } = { ...DEFAULTS, ...context.options[0] };
    const target = option === "auto" ? undefined : option;
    const settings = context.settings.pngdeer ?? {};
    const from = resolve(context.cwd, context.physicalFilename ?? context.filename);
    // public dirs, aliases and the cache belong to the package, wherever the linter was started
    const root = projectRoot(dirname(from), context.cwd);
    const { publicDirs = ["public", "static"] } = settings;
    const aliases = settings.aliases ?? configAliases(root) ?? ALIASES;
    // a folder the team commits (settings.pngdeer.cacheDir) keeps CI and fresh clones warm
    const local = cacheDir(root);
    const dir = settings.cacheDir ? resolve(root, settings.cacheDir) : local;
    // pngdeer failing on an image is kept in `local` only: the failure may be this machine's alone
    // (out of memory), and in a committed folder it would stick for the whole team
    const lookup = (k) => readFirst(k, dir, local);
    const find = (path) => locate(path, from, root, publicDirs, aliases);
    // a path as the person running the linter would type it
    const shown = (file) => pathFrom(context.cwd, file);
    const wait = measure === "always" || (measure === "auto" && !EDITOR);
    const found = [];

    const reported = new Set(); // images warned about in this file: once each, at their first mention
    let disabled; // (line) => whether a comment turns this rule off there, read on first use
    if (!EDITOR) watch(root, { minSavedBytes, minSavedPercent, target, dir, scan, exclude });

    function check(node, text) {
      for (const { file, part } of imagesIn(text, find)) {
        if (excluded(root, file, exclude)) continue;
        const image = fileKey(file, target);
        const loc = part && within(node, part);
        if (!EDITOR) {
          name(file);
          disabled ??= disabledLines(context.sourceCode, context.id ?? RULE);
          if (!disabled((loc?.start ?? node.loc.start).line)) requireTarget(file, target);
        }
        // a file smaller than minSavedBytes can't save that much: not worth measuring
        if (image && image.size >= minSavedBytes) found.push({ node, file, k: image.key, loc });
      }
    }

    // Where `part` sits in a string's source, so a warning for one image of a srcSet underlines that
    // image alone; null if the source spells it differently (escapes), and the whole string is used.
    function within(node, part) {
      const source = context.sourceCode;
      const at = source.getText(node).indexOf(part);
      if (at < 0) return null;
      const start = node.range[0] + at;
      return { start: source.getLocFromIndex(start), end: source.getLocFromIndex(start + part.length) };
    }

    function report({ node, file, loc }, result) {
      if (!reportable(result, { minSavedBytes, minSavedPercent }) || reported.has(file)) return;
      // The linter hides a warning a comment turns off by itself, but the image mustn't count as
      // flagged either, or --flagged would rewrite an image someone chose to keep.
      disabled ??= disabledLines(context.sourceCode, context.id ?? RULE);
      const suppressed = disabled((loc?.start ?? node.loc.start).line);
      // The linter needs the report even when disabled, to recognize a used directive.
      if (!suppressed) {
        reported.add(file);
        if (!EDITOR) flag(file, from, { original: result.original, compressed: result.compressed, score: result.score, target });
      }
      // this package's own command (bin/pngdeer.js), at the target measured, so it writes exactly the
      // file this promises; named by the package, so npx can't fetch someone else's
      const command = shrinkCommand([shown(file)], target);
      const seen = `${file}\0${target}`;
      if (!EDITOR && !suppressed && !warned.has(seen)) warned.set(seen, from);
      const repeat = !EDITOR && warned.has(seen) && warned.get(seen) !== from;
      context.report({
        node,
        loc: loc ?? undefined,
        messageId: repeat ? "again" : result.outcome === "hit" ? "compressible" : "lossless",
        data: {
          name: basename(file),
          percent: smaller(result.original, result.compressed),
          before: size(result.original),
          after: size(result.compressed),
          looks: looks(result.score),
          quality: Math.round(result.score),
          command: command.text,
          shell: command.shell,
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
      // In project mode, the first file also measures unnamed images in the same parallel batch.
      // Later files find theirs cached, and the summary can list images only CSS or HTML uses.
      "Program:exit"() {
        const group = JSON.stringify([root, dir, target, minSavedBytes, scan, exclude]);
        const first = scan === "project" && measure !== "never" && !scanned.has(group);
        if (found.length === 0 && !first) {
          if (!EDITOR) share();
          return;
        }
        if (first) scanned.add(group);
        // what the engine has yet to measure: pngdeer's own output (marked) needs none, and gets no entry,
        // so the editor and the command line leave the same files in a cache folder someone commits
        const unmeasured = (file) => {
          const image = fileKey(file, target);
          return image && !image.marked && !lookup(image.key);
        };
        const named = measure === "never" ? [] : found.map(({ file }) => file);
        const files = [...new Set(first ? [...named, ...projectImages(root, minSavedBytes, exclude)] : named)].filter(unmeasured);
        if (files.length) {
          if (!wait) fillInBackground({ dir, failures: local, target, files });
          else if (!failed.has(root)) measureNow(files);
        }
        for (const ref of found) {
          const result = lookup(ref.k);
          tell(ref.file, result);
          report(ref, result);
        }
        if (!EDITOR) share();
      },
    };

    /** Measures `files` (none cached yet) while the lint waits, saying what the wait is for. */
    function measureNow(files) {
      // on a terminal the batch rewrites this line as a count (fill-worker.js), and it's cleared after
      const tty = Boolean(process.stderr.isTTY);
      process.stderr.write(`pngdeer: measuring ${count(files.length, "image")} not in the cache yet...${tty ? "" : "\n"}`);
      try {
        const { computed, ms } = fillSync({ dir, failures: local, target, files, progress: tty });
        if (tty) process.stderr.write("\r\x1b[K");
        if (computed) process.stderr.write(`pngdeer: measured ${count(computed, "image")} in ${(ms / 1000).toFixed(1)} s; later runs read the cache\n`);
      } catch (error) {
        // the images stay unmeasured (and unreported) rather than failing the lint, and the rest
        // of this run doesn't try again
        failed.add(root);
        process.stderr.write(`${tty ? "\n" : ""}${error.message}\n`);
      }
    }
  },
};

// A run's last word, outside editors: what all the warnings add up to (summary.js).
if (!EDITOR) process.once("exit", () => summarize());

/**
 * The image files a string in the code names, as [{ file, part }]: the string itself (part null), or
 * else a srcSet's candidates, each with the text that names it.
 */
function imagesIn(text, find) {
  // a query or hash ends a path, but a leading # is a subpath import ("#assets/x.png")
  const strip = (path) => path.replace(/(?!^)[?#].*$/, "");
  const usable = (path) => IMAGE.test(path) && !REMOTE.test(path);
  // a whole path first, as file names can hold spaces and commas ("Screenshot … at 10.12.33.png")
  const whole = strip(text.trim());
  const single = usable(whole) && find(whole);
  if (single) return [{ file: single, part: null }];
  const parts = text.split(",").map((part) => part.trim().split(/\s+/)[0]);
  return parts
    .filter((part) => usable(strip(part)))
    .map((part) => ({ file: find(strip(part)), part }))
    .filter(({ file }) => file);
}

/**
 * Whether a comment turns this rule off at a line: `oxlint-` or `eslint-disable-next-line` above it,
 * `-disable-line` on it, or a `-disable` block around it, for this rule (`id`, as the config names
 * the plugin) or for all rules.
 */
function disabledLines(source, id) {
  const lines = new Set();
  const blocks = [];
  let open = null;
  for (const comment of source.getAllComments()) {
    const directive = /^\s*(?:oxlint|eslint)-(disable-next-line|disable-line|disable|enable)\b(.*)$/s.exec(comment.value);
    if (!directive) continue;
    const [, kind, rest] = directive;
    const rules = rest.split("--")[0].split(",").map((rule) => rule.trim()).filter(Boolean);
    if (rules.length && !rules.includes(id) && !rules.includes(RULE)) continue;
    if (kind === "disable-next-line") lines.add(comment.loc.end.line + 1);
    else if (kind === "disable-line") lines.add(comment.loc.start.line);
    else if (kind === "disable") open ??= comment.loc.start.line;
    else if (open !== null) {
      blocks.push([open, comment.loc.start.line]);
      open = null;
    }
  }
  if (open !== null) blocks.push([open, Infinity]);
  return (line) => lines.has(line) || blocks.some(([from, to]) => line >= from && line <= to);
}

/** The file a path in `from` names, or null: relative to the file, or "/x" in a public dir or the root. */
function locate(path, from, root, publicDirs, aliases) {
  const tries = [];
  if (path.startsWith("./") || path.startsWith("../")) tries.push(resolve(dirname(from), path));
  else if (path.startsWith("/")) tries.push(...publicDirs.map((dir) => join(root, dir, path)), join(root, path));
  else {
    const prefix = Object.keys(aliases).filter((prefix) => path.startsWith(prefix)).sort((a, b) => b.length - a.length)[0];
    if (prefix !== undefined) {
      for (const target of [].concat(aliases[prefix])) tries.push(join(root, target, path.slice(prefix.length)));
    }
  }
  return tries.find(isFile) ?? null;
}

function isFile(path) {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}
