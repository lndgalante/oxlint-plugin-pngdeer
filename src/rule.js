// pngdeer/compressible-image: on each string in the code that names a local PNG or JPEG (imports,
// require, new URL, JSX src and srcSet, CSS url() in styles, plain strings), says how much smaller
// pngdeer would make it. oxlint never lints image files themselves, so the reference is where the
// warning goes.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { isatty } from "node:tty";
import { cacheDir, FLOOR, fileKey, read, readFirst, reportable, write } from "./cache.js";
import { excluded, physical, projectImages, projectRoot } from "./scan.js";
import { flag, name, owe, owing, requireTarget, settle, share, summarize, watch } from "./summary.js";
import { configAliases } from "./tsconfig.js";
import { fillInBackground, fillSync } from "./sync.js";
import { checkCommand, count, looks, pathFrom, printable, shrinkCommand, size, smaller } from "./text.js";

const RULE = "pngdeer/compressible-image";
const IMAGE = /\.(png|apng|jpe?g)$/i;
// ESLint's --no-inline-config ignores disable comments, so they turn nothing off
const NO_INLINE_CONFIG = process.argv.includes("--no-inline-config");
const REMOTE = /^[a-z][a-z0-9+.-]*:|^\/\//i;
const DEFAULTS = { minSavedBytes: 4096, minSavedPercent: 10, target: "auto", measure: "auto", scan: "project", exclude: [] };
// when neither the settings nor the project's tsconfig/jsconfig define aliases
const ALIASES = { "@/": "src/", "~/": "src/" };
// a CSS url() argument, quoted or not: background: url("/bg.png") center / cover
const URL_ARGUMENT = /\burl\(\s*(?:"([^"]*)"|'([^']*)'|([^\s"'()]+))\s*\)/gi;
// the modules whose default export renders an image through Next.js's optimizer
const NEXT_IMAGE = new Set(["next/image", "next/legacy/image", "next/future/image"]);
const NEXT_CONFIGS = ["next.config.js", "next.config.mjs", "next.config.cjs", "next.config.ts", "next.config.mts"];
// a warning's {{note}}, between its quality and its command, so it starts with the space between them
const REENCODED = " Here next/image re-encodes it for visitors, so shrinking it saves repository and build size.";

// Editors lint on every keystroke, so there the rule measures in the background and reports on a
// later lint. Everywhere else it waits: a one-off run (the oxlint or eslint command, or a tool calling
// ESLint's Node API, like Nx or xo) would exit before a background batch finished. Neither linter
// has an API for this: it's how oxlint's language server (--lsp), ESLint's (the one VS Code, Zed
// and Neovim use, an Electron child in VS Code) and the eslint_d daemon that editors call start.
const EDITOR = editor(process.argv, process.env);

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
      // {{note}} is empty, or says why the saving may not reach visitors (REENCODED)
      compressible: "{{name}} could be {{percent}}% smaller ({{before}} → {{after}}) and look {{looks}} (quality {{quality}}/100).{{note}} Run{{shell}}: {{command}}",
      // the same image again, in another file of the same run: its first warning said the rest
      again: "{{name}} could be {{percent}}% smaller ({{before}} → {{after}}), as warned where it's first used.{{note}} Run{{shell}}: {{command}}",
      lossless: "{{name}} could be {{percent}}% smaller ({{before}} → {{after}}), losslessly.{{note}} Run{{shell}}: {{command}}",
      incomplete: "pngdeer stopped measuring after {{after}} with {{left}} not measured yet, so this lint is incomplete. Run it again to carry on; in CI, keep the cache between runs (settings.pngdeer.cacheDir).",
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
    const { minSavedBytes, minSavedPercent, target: option, measure, scan, exclude: excludeOption } = { ...DEFAULTS, ...context.options[0] };
    const target = option === "auto" ? undefined : option;
    const settings = context.settings.pngdeer ?? {};
    const from = resolve(context.cwd, context.physicalFilename ?? context.filename);
    // public dirs, aliases and the cache belong to the package, wherever the linter was started
    const root = projectRoot(dirname(from), context.cwd);
    const depends = dependencies(root);
    // Gatsby serves static/, and builds into public/: copies of static/ and the images it generates,
    // which the next build overwrites
    const gatsby = depends.has("gatsby");
    const { publicDirs = gatsby ? ["static"] : ["public", "static"] } = settings;
    const exclude = gatsby && !publicDirs.includes("public") ? [...excludeOption, "public"] : excludeOption;
    const aliases = settings.aliases ?? configAliases(root) ?? ALIASES;
    // the file's own folder and those above it, up to the root: an app's public dir comes first in
    // a workspace whose one package.json serves many apps (Nx)
    const folders = between(dirname(from), root);
    let served; // the public dirs on disk, from the file's folder up to the root's, read on first use
    const servedDirs = () => (served ??= [...folders, root].flatMap((folder) => publicDirs.map((name) => join(folder, name))).filter(isDirectory));
    // Metro serves logo@2x.png, logo@3x.png and logo.ios.png for require("./logo.png")
    const variants = depends.has("react-native") || depends.has("expo") ? metroVariants : null;
    const where = { from, root, servedDirs, aliases, variants };
    // a folder the team commits (settings.pngdeer.cacheDir) keeps CI and fresh clones warm
    const local = cacheDir(root);
    const dir = settings.cacheDir ? resolve(root, settings.cacheDir) : local;
    // the cache folders of the package an image is in, when it isn't this one (../../assets/logo.png):
    // --check measures an image into its own package's, as a cache folder is from each package
    const homes = (file) => {
      const home = projectRoot(dirname(file), context.cwd);
      return home === root ? [] : [settings.cacheDir ? resolve(home, settings.cacheDir) : cacheDir(home), cacheDir(home)];
    };
    // pngdeer failing on an image is kept in `local` only: the failure may be this machine's alone
    // (out of memory), and in a committed folder it would stick for the whole team
    const lookup = (k, file) => {
      const shared = read(dir, k);
      if (shared) return shared;
      const entry = readFirst(k, ...(dir === local ? [] : [local]), ...homes(file));
      // measured before cacheDir was set, or in the image's own package: copy it here, as measuring
      // it now would have
      if (entry && !entry.failed) {
        try {
          write(dir, k, entry);
        } catch {
          // a folder that can't be written: the local result still counts
        }
      }
      return entry;
    };
    // as written, or else as a browser reads it ("/my%20photo.png"); [] if it names no file
    const find = (path) => {
      const files = locate(path, where);
      return files.length || !path.includes("%") ? files : locate(decoded(path), where);
    };
    let realRoot; // the root as the filesystem spells it, read on first use
    // An exclusion holds whichever way code reaches the file: as code spells it, or as it is on
    // disk, through a symlinked folder or in another letter case (--flagged rewrites the file itself).
    const off = (file) => excluded(root, file, exclude) || (exclude.length > 0 && excluded((realRoot ??= physical(root)), physical(file), exclude));
    // a path as the person running the linter would type it
    const shown = (file) => pathFrom(context.cwd, file);
    const wait = measure === "always" || (measure === "auto" && !EDITOR);
    const found = [];
    const nextImages = new Set(); // this file's local names for next/image's default export

    const reported = new Set(); // images warned about in this file: once each, at their first mention
    let disabled; // (line) => whether a comment turns this rule off there, read on first use
    let kept; // (line) => whether a comment there says to keep the image, even where the linter ignores it
    if (!EDITOR) watch(root, { minSavedBytes, minSavedPercent, target, dir, scan, exclude, publicDirs }, from);

    function check(node, text, extract = imagesIn) {
      for (const { file, part } of extract(text, find)) {
        if (off(file)) continue;
        const image = fileKey(file, target);
        const loc = part && within(node, part);
        if (!EDITOR) {
          name(file);
          disabled ??= disabledLines(context.sourceCode, context.id ?? RULE);
          if (!disabled((loc?.start ?? node.loc.start).line)) requireTarget(file, target);
        }
        // a file smaller than minSavedBytes can't save that much: not worth measuring
        if (image && image.size >= minSavedBytes) found.push({ node, file, k: image.key, frames: image.frames, loc });
      }
    }

    // Where `part` sits in a string's source, so a warning for one image of a srcSet underlines that
    // image alone; null if the source spells it differently (escapes), and the whole string is used.
    // Where a path starts, not where it ends an earlier one ("/bg.png" in "url(/img/bg.png)"), unless
    // none does (an escape like \n just before it).
    function within(node, part) {
      const source = context.sourceCode;
      const text = source.getText(node);
      let at = text.indexOf(part);
      while (at > 0 && /[\w./-]/.test(text[at - 1])) at = text.indexOf(part, at + 1);
      if (at < 0) at = text.indexOf(part);
      if (at < 0) return null;
      const start = node.range[0] + at;
      return { start: source.getLocFromIndex(start), end: source.getLocFromIndex(start + part.length) };
    }

    function report({ node, file, k, loc }, result, note) {
      if (!reportable(result, { minSavedBytes, minSavedPercent })) return;
      // one image, however this file and others spell it (logo.png for Logo.png)
      const path = physical(file);
      if (reported.has(path)) return;
      // The linter hides a warning a comment turns off by itself, but the image mustn't count as
      // flagged either, or --flagged would rewrite an image someone chose to keep. ESLint's
      // --no-inline-config shows that warning, but the comment still says to keep the image.
      disabled ??= disabledLines(context.sourceCode, context.id ?? RULE);
      kept ??= NO_INLINE_CONFIG ? disabledLines(context.sourceCode, context.id ?? RULE, false) : disabled;
      const line = (loc?.start ?? node.loc.start).line;
      const suppressed = disabled(line);
      // The linter needs the report even when disabled, to recognize a used directive.
      if (!suppressed) reported.add(path);
      // with the key of the bytes measured (--flagged leaves alone other bytes there since), and the
      // folder it was measured into, unless it's the one --review --flagged reads by default, the
      // image's own package's local one: the settings name another, or the image is another package's
      const measuredIn = dir === cacheDir(projectRoot(dirname(file), context.cwd)) ? undefined : dir;
      if (!EDITOR && !kept(line)) flag(file, from, { original: result.original, compressed: result.compressed, score: result.score, target, key: k, cacheDir: measuredIn });
      // this package's own command (bin/pngdeer.js), at the target measured, so it writes exactly the
      // file this promises; named by the package, so npx can't fetch someone else's
      const command = shrinkCommand([shown(file)], target);
      const seen = `${path}\0${target}`;
      if (!EDITOR && !suppressed && !warned.has(seen)) warned.set(seen, from);
      const repeat = !EDITOR && warned.has(seen) && warned.get(seen) !== from;
      // a file name's control characters would reach the terminal through the linter's output
      context.report({
        node,
        loc: loc ?? undefined,
        messageId: repeat ? "again" : result.outcome === "hit" ? "compressible" : "lossless",
        data: {
          name: printable(basename(file)),
          percent: smaller(result.original, result.compressed),
          before: size(result.original),
          after: size(result.compressed),
          looks: looks(result.score),
          quality: Math.round(result.score),
          command: printable(command.text),
          shell: command.shell,
          note,
        },
      });
    }

    /**
     * The images (physical paths) that every mention in this file names as a src next/image
     * re-encodes for visitors; none when the nearest Next.js config may turn that off for all.
     */
    function reencodedImages() {
      const every = new Map();
      for (const { node, file, frames } of found) {
        const path = physical(file);
        // Next.js's optimizer serves an animated PNG as it is
        every.set(path, (every.get(path) ?? true) && frames === 1 && rendered(node));
      }
      const paths = [...every].filter(([, yes]) => yes).map(([path]) => path);
      return new Set(paths.length && !unoptimized([...folders, root]) ? paths : []);
    }

    /**
     * Whether a string that names an image reaches visitors only through next/image: it is the src
     * of an element next/image renders, or it is imported, and the import is used nowhere else.
     */
    function rendered(node) {
      if (node.parent?.type !== "ImportDeclaration") return nextSrc(node);
      const uses = context.sourceCode.getDeclaredVariables(node.parent).flatMap((variable) => variable.references);
      return uses.length > 0 && uses.every((use) => nextSrc(use.identifier));
    }

    /** Whether `node` is the whole src of a next/image element that doesn't serve it as it is. */
    function nextSrc(node) {
      const attribute = node.parent?.type === "JSXExpressionContainer" ? node.parent.parent : node.parent;
      if (attribute?.type !== "JSXAttribute" || attribute.name.name !== "src") return false;
      const element = attribute.parent;
      if (element.name.type !== "JSXIdentifier" || !nextImages.has(element.name.name)) return false;
      // unoptimized serves the file as it is, and so may a loader of its own or spread props
      return element.attributes.every((other) => other.type === "JSXAttribute" && other.name.name !== "loader" && (other.name.name !== "unoptimized" || isFalse(other.value)));
    }

    // When the lint waits for measuring, says once per image what the warnings can't: why one is missing.
    function tell(file, result) {
      if (!wait || !result?.skipped) return;
      const path = physical(file);
      if (told.has(path)) return;
      told.add(path);
      process.stderr.write(`${printable(`pngdeer: ${result.failed ? "" : "skipped "}${shown(file)}: ${result.skipped}`)}\n`);
    }

    return {
      Literal(node) {
        if (typeof node.value === "string") check(node, node.value);
      },
      TemplateLiteral(node) {
        // a tagged template with an escape JS doesn't read, like CSS's "\201C", has no cooked text
        const text = (quasi) => quasi.value.cooked ?? quasi.value.raw;
        if (node.expressions.length === 0) check(node, text(node.quasis[0]));
        // A path that runs into an expression ("/img/" then a name) is built at runtime, but a CSS
        // url() that closes before one names a whole file: styled.div`background: url("/bg.png"); color: ${c};`
        else for (const quasi of node.quasis) check(quasi, text(quasi), urlsIn);
      },
      ImportDeclaration(node) {
        if (!NEXT_IMAGE.has(node.source.value)) return;
        for (const specifier of node.specifiers) {
          const imported = specifier.imported?.name ?? specifier.imported?.value;
          if (specifier.type === "ImportDefaultSpecifier" || imported === "default") nextImages.add(specifier.local.name);
        }
      },
      // In project mode, the first file also measures unnamed images in the same parallel batch.
      // Later files find theirs cached, and the summary can list images only CSS or HTML uses.
      "Program:exit"() {
        // the problem of a run that ran out of time, which the file that measured turned off (measureNow)
        const owed = EDITOR ? null : owing();
        if (owed) {
          disabled ??= disabledLines(context.sourceCode, context.id ?? RULE);
          if (!disabled(1)) incomplete(owed);
        }
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
          return image && !image.marked && !lookup(image.key, file);
        };
        const named = measure === "never" ? [] : found.map(({ file }) => file);
        // the walk takes a linked image file by the link's own path: an exclusion holds for where it leads too
        const files = distinct([...new Set(first ? [...named, ...projectImages(root, minSavedBytes, exclude).filter((file) => !off(file))] : named)].filter(unmeasured));
        if (files.length) {
          if (!wait) {
            // this file's own images first, in a batch of their own, so its warnings don't wait for
            // the whole project's (a batch measures the smallest image first, then the largest files)
            const own = files.filter((file) => named.includes(file));
            if (own.length && own.length < files.length) fillInBackground({ dir, failures: local, target, files: own });
            fillInBackground({ dir, failures: local, target, files });
          } else if (!failed.has(root)) measureNow(files, unmeasured);
        }
        const reencoded = nextImages.size ? reencodedImages() : new Set();
        for (const ref of found) {
          const result = lookup(ref.k, ref.file);
          tell(ref.file, result);
          report(ref, result, reencoded.size && reencoded.has(physical(ref.file)) ? REENCODED : "");
        }
        if (!EDITOR) share();
      },
    };

    /**
     * Measures `files` (none cached yet) while the lint waits. The batch says what the wait is for
     * (fill-worker.js); `unmeasured` tells what's left if it runs out of time.
     */
    function measureNow(files, unmeasured) {
      // on a terminal the batch's line is a count it rewrites, cleared after. Asked of the file
      // descriptor, as the batch does: in ESLint's --concurrency threads, process.stderr isn't a TTY.
      const clear = isatty(2) ? "\r\x1b[K" : "";
      try {
        // measure: "always" waits in an editor too: a core stays free for the editor, as in its background batches (sync.js)
        const { computed, declined, ms } = fillSync({ dir, failures: local, target, files, progress: true, minSavedBytes, minSavedPercent, spare: EDITOR ? 1 : 0 });
        if (clear) process.stderr.write(clear);
        if (computed) process.stderr.write(`pngdeer: measured ${count(computed, "image")} in ${(ms / 1000).toFixed(1)} s; later runs read the cache\n`);
        // without a word, an image the floor turns down would just be missing: said once, as it's measured
        if (declined) {
          // the --check it gives looks where this batch did: in the project's folder, from a lint run
          // anywhere else (oxlint in src/, a folder beside it, a monorepo's root, where a bare --check
          // would walk every package), and without the images the rule leaves out
          const project = pathFrom(context.cwd, root);
          const paths = project ? [project] : [];
          const options = { paths, exclude: excludeOption, minSavedBytes, minSavedPercent, cacheDir: dir === local ? undefined : settings.cacheDir };
          process.stderr.write(`${printable(`pngdeer: ${floorLine(computed, declined, options)}`)}\n`);
        }
      } catch (error) {
        // the images stay unmeasured (and unreported) rather than failing the lint, and the rest
        // of this run doesn't try again
        failed.add(root);
        process.stderr.write(`${clear}${printable(error.message)}\n`);
        // but a first run that ran out of time is reported, at the rule's severity, so "error" and
        // --deny-warnings don't pass a lint that checked only part of the images
        if (error.after) {
          const data = { after: error.after, left: count(files.filter(unmeasured).length, "image") };
          // ESLint drops a problem where a comment turns the rule off: the next file in this thread
          // that doesn't reports it, or else, if no thread reported one, the summary fails the lint
          disabled ??= disabledLines(context.sourceCode, context.id ?? RULE);
          if (!EDITOR && disabled(1)) owe(data);
          else incomplete(data);
        }
      }
    }

    function incomplete(data) {
      context.report({
        node: context.sourceCode.ast,
        loc: { start: { line: 1, column: 0 }, end: { line: 1, column: 0 } },
        messageId: "incomplete",
        data,
      });
      if (!EDITOR) settle();
    }
  },
};

// A run's last word, outside editors: what all the warnings add up to (summary.js).
if (!EDITOR) process.once("exit", () => summarize());

/**
 * What a batch of `computed` images says of the `declined` ones the quality floor turned down
 * (cache.js floored()), which would otherwise be reported: with a warning, or in the summary's table
 * of images no code names. The --check that names them has the lint's thresholds, `paths` (the
 * project's folder, from a lint run anywhere else), the rule's `exclude`, and the settings' cache
 * folder (`cacheDir`), so it names those images, reading what the lint just measured.
 */
export function floorLine(computed, declined, { paths = [], exclude, minSavedBytes, minSavedPercent, cacheDir } = {}) {
  const one = declined === 1;
  const which = computed === declined ? (one ? "it can't" : "none of them can") : `${declined} of them can't`;
  const check = checkCommand(paths, { exclude, minSavedBytes, minSavedPercent, cacheDir });
  // a folder or pattern only PowerShell takes as typed would need "run in PowerShell", which this
  // sentence can't say: without them, --check still names them, among others it may measure again.
  // The project's folder goes last, only when its own name needs quotes (a ../ chain never does).
  const { text } = [check, checkCommand(paths, { minSavedBytes, minSavedPercent }), checkCommand([], { minSavedBytes, minSavedPercent })].find(({ shell }) => !shell);
  return `${which} be made smaller without a visible difference (${one ? "its" : "their"} best quality is below ${FLOOR}), so ${one ? "it isn't" : "they aren't"} reported; ${text} names ${one ? "it" : "them"}`;
}

/**
 * Whether an editor started this linter, from the process's arguments and environment. Only the
 * script's path inside the package that ships it (after the last node_modules) counts, or else its
 * file name: a project at ~/code/yaml-language-server, or CI's checkout of it, still lints as a
 * command. JetBrains IDEs run ESLint in their js-language-service.js.
 */
export function editor(argv, env) {
  const script = (argv[1] ?? "").split(/[\\/]node_modules[\\/]/);
  const path = script.length > 1 ? script.at(-1) : script[0].split(/[\\/]/).at(-1);
  return argv.includes("--lsp") || /eslintServer|language-?serv(?:er|ice)|eslint_d/i.test(path) || env.ELECTRON_RUN_AS_NODE === "1";
}

/**
 * The image files a string in the code names, as [{ file, part }]: the string itself (part null),
 * else a srcSet's candidates, else a style's url()s, each with the text that names it. `find` gives
 * the files a path names (more than one for Metro's variants).
 */
function imagesIn(text, find) {
  const trimmed = text.trim();
  const whole = strip(trimmed);
  // A whole path first, as file names can hold spaces and commas ("Screenshot … at 10.12.33.png"),
  // with its query or hash; but a srcSet whose first candidate has one goes on after it.
  const files = usable(whole) && !/[\s,]/.test(trimmed.slice(whole.length)) ? find(whole) : [];
  if (files.length) return files.map((file) => ({ file, part: null }));
  const candidates = text
    .split(",")
    .map((part) => part.trim().split(/\s+/)[0])
    .flatMap((part) => filesOf(part, find));
  return candidates.length ? candidates : urlsIn(text, find);
}

/** The image files the CSS url()s in a text name, as imagesIn() gives them: background: url("/bg.png"). */
function urlsIn(text, find) {
  return [...text.matchAll(URL_ARGUMENT)]
    .map((match) => match[1] ?? match[2] ?? match[3])
    .flatMap((part) => filesOf(part, find));
}

/** The image files one `part` of a text names, as imagesIn() gives them; none if it can't name a local image. */
function filesOf(part, find) {
  const path = strip(part);
  return usable(path) ? find(path).map((file) => ({ file, part })) : [];
}

/** A path without its query or hash; a leading # is a subpath import ("#assets/x.png"), not a hash. */
function strip(path) {
  return path.replace(/(?!^)[?#].*$/, "");
}

/** Whether a path may name a local image: a PNG or JPEG name, with no scheme. */
function usable(path) {
  return IMAGE.test(path) && !REMOTE.test(path);
}

/**
 * Whether a comment turns this rule off at a line: `oxlint-` or `eslint-disable-next-line` above it,
 * `-disable-line` on it, or a `-disable` block around it, for this rule (`id`, as the config names
 * the plugin) or for all rules. Nowhere when the linter `ignores` such comments.
 */
function disabledLines(source, id, ignores = NO_INLINE_CONFIG) {
  if (ignores) return () => false;
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

/**
 * The files a path in `from` names, or []: relative to the file; or "/x" in a public dir, the file's
 * own and those above it first (`servedDirs()`), then in the root itself; or through an alias. With
 * `variants`, a file comes with its variants on disk, and names them even when it doesn't exist itself.
 */
function locate(path, { from, root, servedDirs, aliases, variants }) {
  const tries = [];
  if (path.startsWith("./") || path.startsWith("../")) tries.push(resolve(dirname(from), path));
  else if (path.startsWith("/")) tries.push(...servedDirs().map((dir) => join(dir, path)), join(root, path));
  else {
    const prefix = Object.keys(aliases).filter((prefix) => path.startsWith(prefix)).sort((a, b) => b.length - a.length)[0];
    if (prefix !== undefined) {
      for (const target of [].concat(aliases[prefix])) tries.push(join(root, target, path.slice(prefix.length)));
    }
  }
  for (const file of tries) {
    const files = (variants ? [file, ...variants(file)] : [file]).filter(isFile);
    if (files.length) return files;
  }
  return [];
}

/** The folders from `dir` up to `root`, nearest first, without `root`; none if `dir` isn't inside it. */
function between(dir, root) {
  const folders = [];
  for (let at = dir; at !== root; at = dirname(at)) {
    // the filesystem's root: a file linted from outside the project
    if (dirname(at) === at) return [];
    folders.push(at);
  }
  return folders;
}

/**
 * The files Metro, React Native's bundler, serves for an image besides the file itself, by scale and
 * platform: logo@2x.png, logo@3x.png, logo.ios.png, logo@2x.android.png for logo.png.
 */
function metroVariants(file) {
  const name = basename(file);
  return (metroGroups(dirname(file)).get(name) ?? []).filter((entry) => entry !== name).map((entry) => join(dirname(file), entry));
}

// a file name as Metro reads it: the name code requires, then a scale and a platform before its extension
const METRO_NAME = /^(.+?)(?:@\d+(?:\.\d+)?x)?(?:\.(?:ios|android|native|web))?(\.[^.]+)$/;
const listings = new Map(); // folder -> { mtimeMs, groups }

/**
 * A folder's files by the name code requires them by (logo.png for logo@2x.ios.png), sorted: read
 * once, and again when the folder changes, as an app names hundreds of images in one folder.
 */
function metroGroups(dir) {
  const mtimeMs = mtimeOf(dir);
  const memo = listings.get(dir);
  if (memo && memo.mtimeMs === mtimeMs) return memo.groups;
  const groups = new Map();
  let entries = [];
  try {
    entries = readdirSync(dir).sort();
  } catch {
    // no such folder: no variants
  }
  for (const entry of entries) {
    const match = METRO_NAME.exec(entry);
    if (!match) continue;
    const group = groups.get(match[1] + match[2]) ?? [];
    group.push(entry);
    groups.set(match[1] + match[2], group);
  }
  listings.set(dir, { mtimeMs, groups });
  return groups;
}

const reads = new Map(); // project file -> { mtimeMs, value }

/** What `parse` makes of a project file's text (null if there's none), read again when it changes: an editor runs for hours. */
function readProject(path, parse) {
  const mtimeMs = mtimeOf(path);
  const memo = reads.get(path);
  if (memo && memo.mtimeMs === mtimeMs) return memo.value;
  let text = null;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    // none, or unreadable: as if there were none
  }
  const value = parse(text);
  reads.set(path, { mtimeMs, value });
  return value;
}

/** The names the project's package.json depends on, in dependencies or devDependencies. */
function dependencies(root) {
  return readProject(join(root, "package.json"), (text) => {
    try {
      const manifest = JSON.parse(text);
      return new Set([...Object.keys(manifest.dependencies ?? {}), ...Object.keys(manifest.devDependencies ?? {})]);
    } catch {
      // the linter's folder stands in for a project without one, or it isn't JSON
      return new Set();
    }
  });
}

/**
 * Whether the Next.js config nearest the file (in `folders`, nearest first) may serve every image as
 * it is: it mentions images.unoptimized, which a static export sets, or images.loaderFile, a loader
 * of its own that may pass files through. Configs are code, so any mention counts.
 */
function unoptimized(folders) {
  for (const dir of folders) {
    for (const name of NEXT_CONFIGS) {
      const mentions = readProject(join(dir, name), (text) => (text === null ? null : /\b(?:unoptimized|loaderFile)\b/.test(text)));
      if (mentions !== null) return mentions;
    }
  }
  return false;
}

/** Whether a JSX attribute's value is the literal false: unoptimized={false}. */
function isFalse(value) {
  return value?.type === "JSXExpressionContainer" && value.expression.type === "Literal" && value.expression.value === false;
}

function mtimeOf(path) {
  try {
    return statSync(path, { throwIfNoEntry: false })?.mtimeMs ?? -1;
  } catch {
    return -1;
  }
}

/** `path` with its %-escapes decoded, as a browser or server reads a URL; as it is if one is malformed. */
function decoded(path) {
  try {
    // not decodeURIComponent: "%2F" stays in the name rather than becoming a folder
    return decodeURI(path);
  } catch {
    return path;
  }
}

/** `files` with each file once, where code spells it in another case or Unicode form than the disk (macOS, Windows). */
function distinct(files) {
  const seen = new Set();
  return files.filter((file) => {
    const path = physical(file);
    if (seen.has(path)) return false;
    seen.add(path);
    return true;
  });
}

function isFile(path) {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

function isDirectory(path) {
  try {
    // no exception for a folder that isn't there, as most files have no public dir beside them
    return statSync(path, { throwIfNoEntry: false })?.isDirectory() ?? false;
  } catch {
    return false;
  }
}
