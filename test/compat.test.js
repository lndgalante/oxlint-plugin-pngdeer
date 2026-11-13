// A project that still uses a name from before 0.6.0, when this package was oxlint-plugin-pngdeer:
// its settings key, its disable comments and its cache folder keep it safe, and the rule says in one
// line each how to move. These lines name the old word on purpose.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";
import { cacheDir, key } from "../src/cache.js";
import { eslint, eslintSummary, handled, names, oxlint, oxlintSummary, plugin, project, slimdeer } from "./helpers.js";

// oxlint and ESLint run as a person runs them
for (const name of ["AI_AGENT", "CLAUDECODE", "CLAUDE_CODE_ENTRYPOINT"]) delete process.env[name];

const index = join(plugin, "src", "index.js");
const N1 = "slimdeer: reading settings.pngdeer, the old name of settings.slimdeer; rename it in your lint config";
const N2 = "slimdeer: settings.pngdeer is ignored, since settings.slimdeer is set; remove it from your lint config";
const N3 = (where) => `slimdeer: ${where} turns off pngdeer/compressible-image, this rule's old name, so the warning shows there again; write slimdeer/compressible-image instead (until then, --flagged still leaves that image alone)`;
const MORE = "slimdeer: more disable comments name pngdeer/compressible-image; find them all with: git grep -n pngdeer/compressible-image";
const N4 = "slimdeer: node_modules/.cache/pngdeer holds results from oxlint-plugin-pngdeer, which this version doesn't read, so these images are measured again; delete that folder, and save node_modules/.cache/slimdeer in any CI cache step instead";
const N5 = (folder, command) => `slimdeer: measure is "never", and images named here have no result in ${folder}, so they weren't checked; to fill it, run: ${command}`;
// any of them, as they start
const NOTICE = /^slimdeer: (?:reading settings\.pngdeer|settings\.pngdeer is ignored|.* turns off pngdeer\/|more disable comments|.* holds results from oxlint-plugin-pngdeer|measure is "never")/m;
const OLD_COMMENT = "// oxlint-disable-next-line pngdeer/compressible-image";

/** How many of stderr's lines are `line`. */
const times = (stderr, line) => stderr.split(/\r?\n/).filter((each) => each === line).length;

/** The project's .oxlintrc.json, with `changes` in it. */
function configure(dir, changes) {
  const path = join(dir, ".oxlintrc.json");
  writeFileSync(path, JSON.stringify({ ...JSON.parse(readFileSync(path, "utf8")), ...changes }));
}

/** The config the old name's alias leaves in place: the plugin loaded under the name "pngdeer". */
const alias = { jsPlugins: [{ name: "pngdeer", specifier: index }], rules: { "pngdeer/compressible-image": "warn" } };

/** Whether `folder` holds the result for `image`'s bytes. */
const holds = (dir, folder, image) => existsSync(join(dir, folder, `${key(readFileSync(join(dir, image)))}.json`));

test("settings.pngdeer is still read, and one line says to rename it", () => {
  const files = { "src/A.jsx": 'import a from "./assets/crystal-ball.png";\n', "src/B.jsx": 'import b from "./assets/crystal-ball.png";\n' };
  const dir = project({ files, images: ["src/assets/crystal-ball.png"] });
  configure(dir, { settings: { pngdeer: { cacheDir: ".old" } } });
  const { found, stderr } = oxlint(dir);
  assert.equal(found.length, 2);
  assert.equal(times(stderr, N1), 1, stderr);
  assert.ok(holds(dir, ".old", "src/assets/crystal-ball.png"), "the old key's cacheDir is used");
});

test("with both keys, settings.slimdeer wins, and one line says the old one is ignored", () => {
  const files = { "src/A.jsx": 'import a from "./assets/crystal-ball.png";\n', "src/B.jsx": 'import b from "./assets/crystal-ball.png";\n' };
  const dir = project({ files, images: ["src/assets/crystal-ball.png"] });
  configure(dir, { settings: { slimdeer: { cacheDir: ".new" }, pngdeer: { cacheDir: ".old" } } });
  const { stderr } = oxlint(dir);
  assert.equal(times(stderr, N2), 1, stderr);
  assert.equal(times(stderr, N1), 0, stderr);
  assert.ok(holds(dir, ".new", "src/assets/crystal-ball.png"));
  assert.equal(existsSync(join(dir, ".old")), false);
});

test("under the old name's alias, settings.pngdeer is the plugin's own: no line", () => {
  const dir = project({ files: { "src/App.jsx": 'import a from "./assets/crystal-ball.png";\n' }, images: ["src/assets/crystal-ball.png"] });
  configure(dir, { ...alias, settings: { pngdeer: { cacheDir: ".old" } } });
  const { found, stderr } = oxlint(dir);
  assert.deepEqual(found.map((d) => d.code), ["pngdeer(compressible-image)"]);
  assert.doesNotMatch(stderr, NOTICE);
  assert.ok(holds(dir, ".old", "src/assets/crystal-ball.png"));
});

const kept = [
  'import ball from "./assets/crystal-ball.png";',
  OLD_COMMENT,
  'export const hero = "/hero.png";',
  "",
].join("\n");

test("a disable comment with the old name still keeps its image out of --flagged, and one line names it", () => {
  const dir = project({ files: { "src/App.jsx": kept }, images: ["src/assets/crystal-ball.png", "public/hero.png"] });
  const before = readFileSync(join(dir, "public/hero.png"));
  const run = oxlint(dir);
  // the linter doesn't know the old name, so the warning shows
  assert.deepEqual(names(run), ["crystal-ball.png", "hero.png"]);
  assert.equal(times(run.stderr, N3("src/App.jsx:2")), 1, run.stderr);
  const flagged = slimdeer(dir, "--flagged");
  assert.equal(flagged.status, 0, flagged.stderr);
  assert.deepEqual(handled(flagged.stdout), ["src/assets/crystal-ball.png"]);
  assert.deepEqual(readFileSync(join(dir, "public/hero.png")), before);
});

test("a block the new name opens and the old name closes keeps its image out of --flagged, as the linter hides its warning", () => {
  const text = ['import ball from "./assets/crystal-ball.png";', "/* eslint-disable slimdeer/compressible-image */", "/* eslint-enable pngdeer/compressible-image */", 'export const hero = "/hero.png";', ""].join("\n");
  const dir = project({ files: { "src/App.jsx": text }, images: ["src/assets/crystal-ball.png", "public/hero.png"] });
  const before = readFileSync(join(dir, "public/hero.png"));
  assert.deepEqual(names(oxlint(dir)), ["crystal-ball.png"]);
  assert.deepEqual(handled(slimdeer(dir, "--flagged").stdout), ["src/assets/crystal-ball.png"]);
  assert.deepEqual(readFileSync(join(dir, "public/hero.png")), before);
});

test("an old comment on a line turned off anyway, and an -enable, are never named", () => {
  const app = [
    "// oxlint-disable-next-line slimdeer/compressible-image, pngdeer/compressible-image",
    'export const hero = "/hero.png";',
    "/* eslint-disable pngdeer/compressible-image */",
    'export const ball = "./assets/crystal-ball.png";',
    "/* eslint-enable pngdeer/compressible-image */",
    "",
  ].join("\n");
  const off = ["/* eslint-disable */", OLD_COMMENT, 'export const hero = "/hero.png";', ""].join("\n");
  const dir = project({ files: { "src/App.js": app, "src/Off.js": off }, images: ["src/assets/crystal-ball.png", "public/hero.png"] });
  const run = oxlint(dir);
  assert.deepEqual(names(run), ["crystal-ball.png"]);
  assert.equal(run.stderr.match(/turns off pngdeer/g)?.length, 1, run.stderr);
  assert.equal(times(run.stderr, N3("src/App.js:3")), 1, run.stderr);
});

test("under the old name's alias, that comment turns the warning off, with no line", () => {
  const dir = project({ files: { "src/App.jsx": kept }, images: ["src/assets/crystal-ball.png", "public/hero.png"] });
  configure(dir, alias);
  const run = oxlint(dir);
  assert.deepEqual(names(run), ["crystal-ball.png"]);
  assert.doesNotMatch(run.stderr, NOTICE);
});

test("of six such comments, five are named, then one line says how to find the rest", () => {
  const files = Object.fromEntries(Array.from({ length: 6 }, (_, i) => [`src/F${i}.js`, `${OLD_COMMENT}\nexport const a = ${i};\n`]));
  const dir = project({ files, images: [] });
  const { stderr } = oxlint(dir);
  const named = stderr.split("\n").filter((line) => /^slimdeer: src\/F\d\.js:1 turns off/.test(line));
  assert.equal(named.length, 5, stderr);
  assert.equal(new Set(named).size, 5);
  assert.ok(named.every((line) => line === N3(line.split(" ")[1])), stderr);
  assert.equal(times(stderr, MORE), 1, stderr);
});

/** A project with an old cache folder holding one result, and what that folder holds. */
function oldCache(files) {
  const dir = project({ files, images: ["src/assets/crystal-ball.png", "public/hero.png"] });
  const old = join(dir, "node_modules", ".cache", "pngdeer");
  mkdirSync(old, { recursive: true });
  writeFileSync(join(old, `${key(readFileSync(join(dir, "public/hero.png")))}.json`), '{ "original": 509000, "compressed": 151000 }\n');
  const contents = () => readdirSync(old).map((name) => [name, readFileSync(join(old, name), "utf8")]);
  return { dir, contents };
}

test("an old cache folder is named just before the lint measures again, and --check names it too", () => {
  const { dir, contents } = oldCache({ "src/App.jsx": 'import ball from "./assets/crystal-ball.png";\n' });
  const before = contents();
  const lines = oxlintSummary(dir).split("\n");
  assert.equal(lines.filter((line) => line === N4).length, 1, lines.join("\n"));
  assert.equal(lines[lines.indexOf(N4) + 1], "slimdeer: measuring 2 images not in the cache yet...");
  assert.doesNotMatch(oxlintSummary(dir), /holds results from/, "a warm lint measures nothing");
  rmSync(cacheDir(dir), { recursive: true });
  const check = slimdeer(dir, "--check").stderr.split("\n");
  assert.equal(check.filter((line) => line === N4).length, 1, check.join("\n"));
  assert.equal(check[check.indexOf(N4) + 1], "slimdeer: measuring 2 images not in the cache yet...");
  assert.doesNotMatch(slimdeer(dir, "--check").stderr, /holds results from/);
  assert.deepEqual(contents(), before, "the old folder is left as it was");
});

test("an old cache folder is named once a run, however many batches measure", () => {
  // each file its own batch: scan "referenced" measures what the file names, as the file is linted
  const files = { "src/A.jsx": 'import a from "./assets/crystal-ball.png";\n', "src/B.jsx": 'export const b = "/hero.png";\n' };
  const { dir } = oldCache(files);
  configure(dir, { rules: { "slimdeer/compressible-image": ["warn", { scan: "referenced" }] } });
  const stderr = oxlintSummary(dir);
  assert.equal(stderr.match(/^slimdeer: measuring 1 image not in the cache yet\.\.\.$/gm)?.length, 2, stderr);
  assert.equal(times(stderr, N4), 1, stderr);
});

test("an old cache folder gets no line when the results go into a committed folder", () => {
  const { dir } = oldCache({ "src/App.jsx": 'import ball from "./assets/crystal-ball.png";\n' });
  configure(dir, { settings: { slimdeer: { cacheDir: ".slimdeer" } } });
  const lint = oxlintSummary(dir);
  assert.match(lint, /^slimdeer: measuring 2 images not in the cache yet\.\.\.$/m);
  assert.doesNotMatch(lint, /holds results from/);
  const check = slimdeer(dir, "--check", "--cache-dir", ".other").stderr;
  assert.match(check, /^slimdeer: measuring 2 images not in the cache yet\.\.\.$/m);
  assert.doesNotMatch(check, /holds results from/);
});

test('measure "never" with nothing cached says so once, with the --check that fills the cache', () => {
  const files = { "src/A.jsx": 'import a from "./assets/crystal-ball.png";\n', "src/B.jsx": 'export const b = "/hero.png";\n' };
  const dir = project({ files, options: { measure: "never" }, images: ["src/assets/crystal-ball.png", "public/hero.png"] });
  const cold = oxlint(dir);
  assert.deepEqual(cold.found, []);
  assert.equal(times(cold.stderr, N5("node_modules/.cache/slimdeer", "npx oxlint-plugin-slimdeer --check")), 1, cold.stderr);
  // a cacheDir of null is the default's, with no --cache-dir
  configure(dir, { settings: { slimdeer: { cacheDir: null } } });
  const unset = oxlint(dir).stderr;
  assert.equal(times(unset, N5("node_modules/.cache/slimdeer", "npx oxlint-plugin-slimdeer --check")), 1, unset);
  configure(dir, { settings: { slimdeer: { cacheDir: ".slimdeer" } } });
  const committed = oxlint(dir).stderr;
  assert.equal(times(committed, N5(".slimdeer", "npx oxlint-plugin-slimdeer --check --cache-dir .slimdeer")), 1, committed);
  // the command it gives
  assert.equal(slimdeer(dir, "--check", "--cache-dir", ".slimdeer").status, 1);
  const warm = oxlint(dir);
  assert.deepEqual(names(warm), ["crystal-ball.png", "hero.png"]);
  assert.doesNotMatch(warm.stderr, /measure is "never"/);
});

test('from a subfolder, measure "never" gives a --check with the project\'s folder and the rule\'s options', () => {
  const files = { "src/A.jsx": 'import a from "./assets/crystal-ball.png";\nexport const h = "/hero.png";\nexport const p = "/photo.jpg";\n' };
  const options = { measure: "never", target: 85, minSavedBytes: 1000, exclude: ["public/photo.jpg"] };
  const dir = project({ files, options, images: ["src/assets/crystal-ball.png", "public/hero.png", "public/photo.jpg"] });
  configure(dir, { settings: { slimdeer: { cacheDir: ".committed" } } });
  const src = join(dir, "src");
  const args = ["--check", "..", "--exclude", "public/photo.jpg", "--cache-dir", ".committed", "--min-saved-bytes", "1000", "--target", "85"];
  const cold = oxlint(src, "-c", "../.oxlintrc.json").stderr;
  assert.equal(times(cold, N5(".committed", `npx oxlint-plugin-slimdeer ${args.join(" ")}`)), 1, cold);
  assert.equal(slimdeer(src, ...args).status, 1);
  const warm = oxlint(src, "-c", "../.oxlintrc.json");
  assert.deepEqual(names(warm), ["crystal-ball.png", "hero.png"]);
  assert.doesNotMatch(warm.stderr, /measure is "never"/);
});

test('measure "never" gives the --check that fills the folder of an image another package holds', () => {
  const files = { "packages/web/package.json": "{}", "packages/web/src/A.js": 'import d from "../../app/src/assets/diagram.png";\nexport { d };\n', "packages/app/package.json": "{}" };
  const dir = project({ files, options: { measure: "never" }, images: [] });
  mkdirSync(join(dir, "packages/app/src/assets"), { recursive: true });
  cpSync(join(plugin, "example/src/assets/diagram.png"), join(dir, "packages/app/src/assets/diagram.png"));
  const cold = oxlint(dir).stderr;
  assert.equal(times(cold, N5("node_modules/.cache/slimdeer", "npx oxlint-plugin-slimdeer --check packages/app")), 1, cold);
  assert.equal(slimdeer(dir, "--check", "packages/app").status, 1);
  const warm = oxlint(dir);
  assert.deepEqual(names(warm), ["diagram.png"]);
  assert.doesNotMatch(warm.stderr, /measure is "never"/);
});

/** An ESLint config like the project's own (helpers.js), with `settings`. */
function eslintConfig(settings) {
  return `import slimdeer from ${JSON.stringify(pathToFileURL(index).href)};
export default [{
  files: ["**/*.{js,jsx}"],
  languageOptions: { parserOptions: { ecmaFeatures: { jsx: true } } },
  plugins: { slimdeer },
  rules: { "slimdeer/compressible-image": "warn" },
  settings: ${JSON.stringify(settings)},
}];
`;
}

test("ESLint reads settings.pngdeer and names an old disable comment the same way", () => {
  const files = { "src/App.jsx": kept.replace("oxlint-", "eslint-"), "eslint.config.js": eslintConfig({ pngdeer: { cacheDir: ".old" } }) };
  const dir = project({ files, images: ["src/assets/crystal-ball.png", "public/hero.png"] });
  // ESLint fails on a disable comment for a rule it doesn't know
  const stderr = eslintSummary(dir, "src");
  assert.equal(times(stderr, N1), 1, stderr);
  assert.equal(times(stderr, N3("src/App.jsx:2")), 1, stderr);
  assert.ok(holds(dir, ".old", "public/hero.png"));
  assert.deepEqual(handled(slimdeer(dir, "--flagged").stdout), ["src/assets/crystal-ball.png"]);
});

test("a setting of the wrong type is named once, and the lint goes on with its default", () => {
  // a "/x" path reads publicDirs, an "@/" path the aliases, and every file the cache folder
  const text = 'export const a = ["/ball.png", "@/assets/crystal-ball.png"];\n';
  const ball = readFileSync(join(plugin, "example/src/assets/crystal-ball.png"));
  const dir = project({ files: { "src/A.js": text, "src/B.js": text, "public/ball.png": ball }, images: ["src/assets/crystal-ball.png"] });
  const line = (key, what, name = "slimdeer") => `slimdeer: settings.${name}.${key} must be ${what}, so the default is used`;
  const list = line("publicDirs", "a list of folder names");
  const path = line("cacheDir", "a folder path");
  const cases = [
    [{ publicDirs: "public", cacheDir: 5, aliases: { "@/": 5 } }, [list, path, line("aliases", "an object of prefixes and folders")]],
    [{ publicDirs: [null], cacheDir: true }, [list, path]],
    // null, as a config may write for "the default": that, quietly
    [{ publicDirs: null, aliases: null, cacheDir: null }, []],
  ];
  const lint = (linter, settings) => {
    if (linter === "oxlint") {
      configure(dir, { settings: { slimdeer: settings } });
      return oxlint(dir);
    }
    writeFileSync(join(dir, "eslint.config.js"), eslintConfig({ slimdeer: settings }));
    return eslint(dir, "src");
  };
  for (const linter of ["oxlint", "eslint"]) {
    for (const [settings, lines] of cases) {
      const run = lint(linter, settings);
      const why = `${linter}\n${run.stderr}`;
      assert.deepEqual(names(run), ["ball.png", "ball.png", "crystal-ball.png", "crystal-ball.png"], why);
      // each once, however many files read it
      assert.deepEqual(run.stderr.split(/\r?\n/).filter((each) => each.includes(" must be ")).sort(), lines.sort(), why);
      assert.doesNotMatch(run.stderr, /TypeError|ERR_INVALID_ARG_TYPE/, why);
    }
  }
  // the key the config holds, by its old name
  configure(dir, { settings: { pngdeer: { cacheDir: 5 } } });
  const old = oxlint(dir).stderr;
  assert.equal(times(old, line("cacheDir", "a folder path", "pngdeer")), 1, old);
  assert.equal(times(old, N1), 1, old);
});

const [major, minor] = JSON.parse(readFileSync(join(plugin, "node_modules", "eslint", "package.json"), "utf8")).version.split(".").map(Number);

test("under ESLint's --concurrency, each line is said once a run, however many threads lint", { skip: major < 9 || (major === 9 && minor < 34) }, () => {
  const text = `${OLD_COMMENT.replace("oxlint-", "eslint-")}\nexport const a = "./assets/crystal-ball.png";\n`;
  const files = Object.fromEntries(Array.from({ length: 8 }, (_, i) => [`src/F${i}.jsx`, text]));
  files["eslint.config.js"] = eslintConfig({ pngdeer: {} });
  const dir = project({ files, images: ["src/assets/crystal-ball.png"] });
  const stderr = eslintSummary(dir, "--concurrency", "4", "src");
  assert.equal(times(stderr, N1), 1, stderr);
  assert.equal(stderr.match(/^slimdeer: src\/F\d\.jsx:1 turns off/gm)?.length, 5, stderr);
  assert.equal(times(stderr, MORE), 1, stderr);
});

/** `oxlint --lsp` in `dir`, as test/lsp.test.js starts it: request(method, params), notify(method, params), what it printed on stderr. */
function server(dir) {
  const child = spawn(process.execPath, [join(plugin, "node_modules", "oxlint", "bin", "oxlint"), "--lsp"], { cwd: dir });
  const exited = new Promise((resolve) => child.on("exit", resolve));
  const waiting = new Map();
  let buffer = Buffer.alloc(0);
  let log = "";
  let id = 0;
  child.stderr.setEncoding("utf8").on("data", (chunk) => (log += chunk));
  const send = (message) => {
    const body = Buffer.from(JSON.stringify({ jsonrpc: "2.0", ...message }));
    child.stdin.write(Buffer.concat([Buffer.from(`Content-Length: ${body.length}\r\n\r\n`), body]));
  };
  child.stdout.on("data", (chunk) => {
    buffer = Buffer.concat([buffer, chunk]);
    for (;;) {
      const end = buffer.indexOf("\r\n\r\n");
      if (end < 0) return;
      const length = Number(/Content-Length: (\d+)/i.exec(buffer.subarray(0, end).toString())?.[1] ?? 0);
      if (buffer.length < end + 4 + length) return;
      const body = buffer.subarray(end + 4, end + 4 + length).toString();
      buffer = buffer.subarray(end + 4 + length);
      if (!body) continue;
      const message = JSON.parse(body);
      // the server's own requests (configuration, registering capabilities): answered with nothing
      if (message.method && message.id !== undefined) send({ id: message.id, result: null });
      else if (waiting.has(message.id)) {
        waiting.get(message.id).resolve(message.result);
        waiting.delete(message.id);
      }
    }
  });
  exited.then((code) => waiting.forEach(({ reject }) => reject(new Error(`oxlint --lsp exited (${code}): ${log}`))));
  return {
    request: (method, params) => new Promise((resolve, reject) => {
      waiting.set(++id, { resolve, reject });
      send({ id, method, params });
    }),
    notify: (method, params) => send({ method, params }),
    log: () => log,
    stop: () => {
      child.kill();
      return exited;
    },
  };
}

test("in an editor, none of these lines is said", { timeout: 120_000 }, async (t) => {
  const files = {
    "src/App.jsx": kept,
    // an image no project scan measures (bytes no other image has), named where the rule never measures
    "src/never.js": 'export const x = "../dist/x.jpg";\n',
  };
  const dir = realpathSync.native(project({ files, images: ["src/assets/crystal-ball.png", "public/hero.png"] }));
  mkdirSync(join(dir, "dist"));
  cpSync(join(plugin, "example", "public", "photo.jpg"), join(dir, "dist/x.jpg"));
  mkdirSync(join(dir, "node_modules", ".cache", "pngdeer"), { recursive: true });
  configure(dir, {
    // "always" measures while the editor waits, as a lint run does
    rules: { "slimdeer/compressible-image": ["warn", { measure: "always" }] },
    overrides: [{ files: ["src/never.js"], rules: { "slimdeer/compressible-image": ["warn", { measure: "never" }] } }],
    settings: { pngdeer: {} },
  });
  const lsp = server(dir);
  t.after(() => lsp.stop());
  const root = pathToFileURL(dir).href;
  await lsp.request("initialize", {
    processId: process.pid,
    rootUri: root,
    workspaceFolders: [{ uri: root, name: "project" }],
    capabilities: { textDocument: { diagnostic: { dynamicRegistration: true } }, workspace: { configuration: true, diagnostics: { refreshSupport: true } } },
    initializationOptions: [{ workspaceUri: root, options: { run: "onType" } }],
  });
  lsp.notify("initialized", {});
  const warnings = async (path, languageId) => {
    const uri = pathToFileURL(join(dir, path)).href;
    lsp.notify("textDocument/didOpen", { textDocument: { uri, languageId, version: 1, text: readFileSync(join(dir, path), "utf8") } });
    const { items } = await lsp.request("textDocument/diagnostic", { textDocument: { uri } });
    return items.filter((d) => JSON.stringify(d.code).includes("compressible-image"));
  };
  assert.deepEqual(await warnings("src/never.js", "javascript"), []);
  assert.equal((await warnings("src/App.jsx", "javascriptreact")).length, 2, "the editor measured, and warns");
  // its stderr has the batch's own line, next to the old cache folder, and nothing else of ours
  assert.match(lsp.log(), /^slimdeer: measuring 2 images not in the cache yet\.\.\.$/m);
  assert.doesNotMatch(lsp.log(), NOTICE);
  await lsp.stop();
  // the same project from the command line says them all
  rmSync(cacheDir(dir), { recursive: true });
  const stderr = oxlintSummary(dir);
  for (const line of [N1, N3("src/App.jsx:2"), N4, N5("node_modules/.cache/slimdeer", "npx oxlint-plugin-slimdeer --check")]) assert.equal(times(stderr, line), 1, `${line}\n${stderr}`);
});
