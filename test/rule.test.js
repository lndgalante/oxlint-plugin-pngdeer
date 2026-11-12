// The rule under oxlint, end to end.
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { chmodSync, cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";
import { editor, floorLine } from "../src/rule.js";
import { eslintSummary, fade, handled, names, oxlint, oxlintSummary, plugin, pngdeer, project } from "./helpers.js";

test("warns on each reference to a compressible image, with the command that fixes it", () => {
  const dir = project();
  const first = oxlint(dir);
  // once per image per file (diagram.png is named twice), and not for heart.png (saves too little),
  // missing.png (doesn't exist) or unused-fire.png (named nowhere)
  assert.deepEqual(names(first), ["crystal-ball.png", "diagram.png", "hero.png", "photo.jpg"]);
  const hero = first.found.find((d) => d.message.startsWith("hero.png"));
  assert.match(hero.message, /^hero\.png could be 70% smaller \(509 kB → 151 kB\) and look the same side by side \(quality 87\/100\)\. Run: npx oxlint-plugin-pngdeer public\/hero\.png$/);
  // a photo that lands lower says so
  const photo = first.found.find((d) => d.message.startsWith("photo.jpg"));
  assert.match(photo.message, /and look close, with differences you might spot side by side \(quality 76\/100\)/);
  // a second run reads the cache
  assert.deepEqual(names(oxlint(dir)), names(first));
});

test("says what the first run is doing, and what the warnings add up to", () => {
  const dir = project();
  const stderr = oxlintSummary(dir);
  assert.match(stderr, /^pngdeer: measuring 5 images not in the cache yet\.\.\.$/m);
  assert.match(stderr, /^pngdeer: measured 5 images in \d+\.\d s; later runs read the cache$/m);
  // off a terminal (a CI log), whole lines only: a count every 30 s, never one rewritten in place
  assert.doesNotMatch(stderr, /\r/);
  assert.match(stderr, /^pngdeer: 4 flagged images could be 718 kB smaller in all \(1\.0 MB → 310 kB, 70% smaller\):$/m);
  // a table, the biggest saving first; then what no code names; then what quality means, and the
  // one command for all the flagged images
  const rows = stderr.split("\n").filter((line) => line.startsWith("  ")).map((line) => line.trim().split(/\s+/)[0]);
  assert.deepEqual(rows, ["image", "public/hero.png", "src/assets/diagram.png", "public/photo.jpg", "src/assets/crystal-ball.png", "public/unused-fire.png"]);
  assert.match(stderr, /^pngdeer: also 1 image with no warning could be 5\.\d kB smaller \(named only where this run can't warn, or nowhere\):$/m);
  assert.match(stderr, /^  public\/unused-fire\.png .* mentioned in (README|SOURCES)\.md$/m);
  assert.match(stderr, /^pngdeer: to shrink it too, run: npx oxlint-plugin-pngdeer public\/unused-fire\.png$/m);
  assert.match(stderr, /^pngdeer: quality is SSIMULACRA2, out of 100: 90\+ looks identical, .*, below 70 visibly different$/m);
  assert.match(stderr, /^pngdeer: to shrink the 4 flagged images in place \(lossy, so commit first\), run: npx oxlint-plugin-pngdeer --flagged$/m);
  const again = oxlintSummary(dir);
  assert.doesNotMatch(again, /measur/);
  assert.match(again, /4 flagged images could be/);
  // nothing for machine formats or --quiet
  assert.doesNotMatch(oxlint(dir).stderr, /flagged images/);
  assert.doesNotMatch(oxlintSummary(dir, "--quiet"), /flagged images/);
});

test("the summary says where an image no JS or TS names is used, or that nothing names it", () => {
  const files = {
    "src/App.jsx": "export const app = 1;\n",
    "src/styles.css": "body { background: url('/hero.png'); }\n",
  };
  const dir = project({ files, images: ["public/hero.png", "public/photo.jpg"] });
  oxlint(dir);
  const stderr = oxlintSummary(dir);
  assert.match(stderr, /^pngdeer: no warnings, but 2 images could be \d+ kB smaller \(named only where this run can't warn, or nowhere\):$/m);
  assert.match(stderr, /^  public\/hero\.png .* used in src\/styles\.css$/m);
  assert.match(stderr, /^  public\/photo\.jpg .* nothing names it$/m);
  assert.match(stderr, /^pngdeer: to shrink them in place \(lossy, so commit first\), run: npx oxlint-plugin-pngdeer public\/hero\.png public\/photo\.jpg$/m);
  assert.match(stderr, /^pngdeer: to keep them as is and stop listing them, add their paths to the rule's "exclude" option$/m);
  assert.match(stderr, /^pngdeer: an image nothing names may be unused/m);
});

test("a lint of some files doesn't call the images other files name unused", () => {
  const files = {
    "src/App.jsx": 'import ball from "./assets/crystal-ball.png";\n',
    // a bare path, which the rule doesn't resolve
    "src/data.js": 'export const slides = ["images/photo.jpg"];\n',
    "src/util.js": "export const util = 1;\n",
  };
  const dir = project({ files, images: ["src/assets/crystal-ball.png", "public/photo.jpg"] });
  const stderr = oxlintSummary(dir, "src/util.js", "src/data.js");
  assert.match(stderr, /^  src\/assets\/crystal-ball\.png .* named in src\/App\.jsx$/m);
  assert.match(stderr, /^  public\/photo\.jpg .* named in src\/data\.js$/m);
  assert.doesNotMatch(stderr, /nothing names it|may be unused/);
});

test("the summary looks for an image's path in the public dirs the settings name", () => {
  const files = {
    "src/App.jsx": "export const app = 1;\n",
    // a stylesheet comes first, but names another ball.png
    "src/a.css": ".old { background: url(../img/ball.png); }\n",
    "src/b.html": '<img src="/ball.png">\n',
  };
  const dir = project({ files, images: [] });
  mkdirSync(join(dir, "www"));
  cpSync(new URL("../example/src/assets/crystal-ball.png", import.meta.url), join(dir, "www/ball.png"));
  const config = JSON.parse(readFileSync(join(dir, ".oxlintrc.json"), "utf8"));
  config.settings = { pngdeer: { publicDirs: ["www"] } };
  writeFileSync(join(dir, ".oxlintrc.json"), JSON.stringify(config));
  assert.match(oxlintSummary(dir), /^  www\/ball\.png .* used in src\/b\.html$/m);
});

test("an image whose warning a comment turns off is left out of the summary and --flagged", () => {
  const files = {
    "src/App.jsx": [
      'import ball from "./assets/crystal-ball.png";',
      "// oxlint-disable-next-line pngdeer/compressible-image -- the brand's master copy",
      'export const hero = "/hero.png";',
      'export const photo = "/photo.jpg"; // eslint-disable-line pngdeer/compressible-image',
      "",
    ].join("\n"),
  };
  const dir = project({ files, images: ["src/assets/crystal-ball.png", "public/hero.png", "public/photo.jpg"] });
  assert.deepEqual(names(oxlint(dir)), ["crystal-ball.png"]);
  const stderr = oxlintSummary(dir);
  assert.match(stderr, /1 flagged image could be/);
  assert.doesNotMatch(stderr, /hero\.png|photo\.jpg/);
  assert.deepEqual(handled(pngdeer(dir, "--flagged").stdout), ["src/assets/crystal-ball.png"]);
});

test("--flagged shrinks what the last lint flagged, at the target it measured", () => {
  const dir = project({ options: { target: 70 } });
  assert.match(pngdeer(dir, "--flagged").stderr, /^oxlint-plugin-pngdeer: no list of flagged images here: lint in this folder first \(npx oxlint, or eslint without --cache\); if a lint here flagged no image, there is nothing to do$/m);
  oxlint(dir);
  const run = pngdeer(dir, "--flagged");
  assert.equal(run.status, 0, run.stderr);
  assert.deepEqual(handled(run.stdout).sort(), ["public/hero.png", "public/photo.jpg", "src/assets/crystal-ball.png", "src/assets/diagram.png"]);
  assert.match(run.stderr, /^pngdeer: shrinking 4 images in place \(lossy; commit first so you can undo\)$/m);
  assert.match(run.stderr, /^pngdeer: 4 images, 1\.0 MB → \d+ kB \(\d+ kB smaller\)\. Lint again to check\.$/m);
  assert.deepEqual(oxlint(dir).found, []);
  assert.equal(pngdeer(dir, "--flagged").stdout.trim(), "the last lint here left no images to shrink with --flagged");
});

test("--flagged after a first lint that measured images but flagged none says there's nothing to shrink", () => {
  const dir = project({ options: { minSavedPercent: 90 }, images: ["public/photo.jpg"], files: { "src/App.jsx": 'export const a = <img src="/photo.jpg" />;\n' } });
  assert.deepEqual(oxlint(dir).found, []);
  const run = pngdeer(dir, "--flagged");
  assert.equal(run.status, 0, run.stderr);
  assert.equal(run.stdout.trim(), "the last lint here left no images to shrink with --flagged");
  // a lint that measured nothing makes no cache folder just for an empty list, so --flagged finds
  // none, and says what's true either way
  const bare = project({ images: [], files: { "src/App.jsx": "export const a = 1;\n" } });
  oxlint(bare);
  assert.equal(existsSync(join(bare, "node_modules")), false);
  const none = pngdeer(bare, "--flagged");
  assert.equal(none.status, 1);
  assert.equal(none.stderr, "oxlint-plugin-pngdeer: no list of flagged images here: lint in this folder first (npx oxlint, or eslint without --cache); if a lint here flagged no image, there is nothing to do\n");
});

test("files fixed with the command aren't flagged again, even on a fresh clone", () => {
  const dir = project();
  assert.equal(pngdeer(dir, "public/photo.jpg", "src/assets/diagram.png").status, 0);
  // pngdeer's own JPEG would otherwise come out about a fifth smaller again
  const after = oxlint(dir);
  assert.deepEqual(names(after), ["crystal-ball.png", "hero.png"]);
  // crystal-ball.png, hero.png and unused-fire.png: the marked two need no engine, heart.png is too small
  assert.match(after.stderr, /measuring 3 images not in the cache yet/);
});

test("a fixed target is measured and repeated in the command", () => {
  const dir = project({ files: { "src/App.jsx": 'import ball from "./assets/crystal-ball.png";\n' }, options: { target: 70 }, images: ["src/assets/crystal-ball.png"] });
  const [found] = oxlint(dir).found;
  assert.match(found.message, / \(quality 7\d\/100\)\. Run: npx oxlint-plugin-pngdeer src\/assets\/crystal-ball\.png --target 70$/);
});

test("thresholds keep small savings quiet", () => {
  const dir = project({ files: { "src/App.jsx": 'import ball from "./assets/crystal-ball.png";\n' }, options: { minSavedPercent: 90 }, images: ["src/assets/crystal-ball.png"] });
  assert.deepEqual(oxlint(dir).found, []);
});

test("paths with spaces are found and quoted for the platform's shell", () => {
  const dir = project({ files: { "src/App.jsx": 'import shot from "./assets/My Shot, final.png";\n' }, images: ["src/assets/crystal-ball.png"] });
  cpSync(join(dir, "src/assets/crystal-ball.png"), join(dir, "src/assets/My Shot, final.png"));
  const [found] = oxlint(dir).found;
  if (process.platform === "win32") {
    assert.match(found.message, /Run in PowerShell: & /);
    assert.ok(found.message.endsWith(" 'src/assets/My Shot, final.png'"), found.message);
  } else {
    assert.ok(found.message.endsWith("Run: npx oxlint-plugin-pngdeer 'src/assets/My Shot, final.png'"), found.message);
  }
});

test("%-escaped paths resolve as a browser reads them", () => {
  // in a srcSet, %20 is the only way to write a space; a malformed escape is just a path not found
  const files = { "src/App.jsx": 'export const a = <img srcSet="/my%20ball.png 1x, /bad%zz.png 2x" />;\n' };
  const dir = project({ files, images: [] });
  mkdirSync(join(dir, "public"));
  cpSync(new URL("../example/src/assets/crystal-ball.png", import.meta.url), join(dir, "public/my ball.png"));
  const { found } = oxlint(dir);
  assert.equal(found.length, 1);
  assert.match(found[0].message, /^my ball\.png could be \d+% smaller/);
  assert.ok(found[0].message.endsWith(" 'public/my ball.png'"), found[0].message);
  assert.deepEqual([found[0].labels[0].span.column, found[0].labels[0].span.length], [31, 14]);
});

test("srcSet lists, public and static paths resolve, each image underlined on its own", () => {
  const files = { "src/App.jsx": 'export const a = <img srcSet="./assets/crystal-ball.png 1x, /photo.jpg 2x" />;\nexport const b = "/hero.png";\n' };
  const dir = project({ files, images: ["src/assets/crystal-ball.png", "public/photo.jpg"] });
  mkdirSync(join(dir, "static"));
  cpSync(join(dir, "src/assets/crystal-ball.png"), join(dir, "static/hero.png"));
  const result = oxlint(dir);
  assert.deepEqual(names(result), ["crystal-ball.png", "hero.png", "photo.jpg"]);
  const span = (name) => result.found.find((d) => d.message.startsWith(name)).labels[0].span;
  assert.deepEqual([span("crystal-ball.png").column, span("crystal-ball.png").length], [31, 25]);
  assert.deepEqual([span("photo.jpg").column, span("photo.jpg").length], [61, 10]);
});

test("runs from a parent directory find the same images", () => {
  const files = { "src/App.jsx": 'import ball from "./assets/crystal-ball.png";\nexport const photo = "/photo.jpg";\n' };
  const dir = project({ files, images: ["src/assets/crystal-ball.png", "public/photo.jpg"] });
  assert.deepEqual(names(oxlint(join(dir, ".."), join(dir, "src"))), ["crystal-ball.png", "photo.jpg"]);
});

test("a project in a folder named like a language server still lints as a command", () => {
  const files = { "src/App.jsx": 'import ball from "./assets/crystal-ball.png";\n' };
  const dir = project({ files, images: ["src/assets/crystal-ball.png"] });
  // what `npx oxlint` runs in a checkout of yaml-language-server: oxlint's script in its
  // node_modules, here a stand-in that loads the real one
  const bin = join(dir, "yaml-language-server", "node_modules", "oxlint", "bin", "oxlint");
  mkdirSync(dirname(bin), { recursive: true });
  writeFileSync(bin, `import(${JSON.stringify(pathToFileURL(join(plugin, "node_modules", "oxlint", "dist", "cli.js")).href)});\n`);
  const run = spawnSync(process.execPath, [bin, "--format", "json"], { cwd: dir, encoding: "utf8" });
  assert.equal(run.status, 0, run.stderr);
  assert.match(run.stderr, /^pngdeer: measured 1 image in /m);
  assert.deepEqual(names({ found: JSON.parse(run.stdout).diagnostics.filter((d) => d.code.includes("compressible-image")) }), ["crystal-ball.png"]);
});

test("editors are told apart by the linter's script, not by the project's folder", () => {
  const editors = [
    "/Users/me/.vscode/extensions/dbaeumer.vscode-eslint-3.0.16/server/out/eslintServer.js",
    "/opt/homebrew/lib/node_modules/vscode-langservers-extracted/bin/vscode-eslint-language-server",
    "/usr/local/lib/node_modules/eslint_d/bin/eslint_d.js",
    // JetBrains IDEs run ESLint in their own language service
    "/Applications/WebStorm.app/Contents/plugins/javascript-plugin/jsLanguageServicesImpl/js-language-service.js",
    "C:\\Program Files\\JetBrains\\IntelliJ IDEA\\plugins\\JavaScriptLanguage\\jsLanguageServicesImpl\\js-language-service.js",
  ];
  for (const script of editors) assert.equal(editor(["node", script], {}), true, script);
  assert.equal(editor(["node", "/code/app/node_modules/oxlint/bin/oxlint", "--lsp"], {}), true);
  assert.equal(editor(["node", "/code/app/node_modules/eslint/bin/eslint.js"], { ELECTRON_RUN_AS_NODE: "1" }), true);
  const commands = [
    "/code/yaml-language-server/node_modules/.bin/oxlint",
    "/code/my-language-service/node_modules/eslint/bin/eslint.js",
    "C:\\code\\eslint_d\\node_modules\\oxlint\\bin\\oxlint",
  ];
  for (const script of commands) assert.equal(editor(["node", script], {}), false, script);
});

test("an editor that waits for measuring still leaves a core to the editor", () => {
  const files = {
    "src/App.jsx": 'import ball from "./assets/crystal-ball.png";\n',
    // says how many cores each batch the lint starts leaves free
    "spy.mjs": [
      'import { writeSync } from "node:fs";',
      'import { syncBuiltinESMExports } from "node:module";',
      'import threads from "node:worker_threads";',
      "const { Worker } = threads;",
      "threads.Worker = class extends Worker {",
      "  constructor(url, options) {",
      "    const request = options?.workerData?.request;",
      "    if (request) writeSync(2, `spare ${request.spare}\\n`);",
      "    super(url, options);",
      "  }",
      "};",
      "syncBuiltinESMExports();",
    ].join("\n"),
  };
  const dir = project({ files, images: ["src/assets/crystal-ball.png"], options: { measure: "always" } });
  const args = ["--import", pathToFileURL(join(dir, "spy.mjs")).href, join(plugin, "node_modules", "oxlint", "bin", "oxlint"), "--format", "json", "src"];
  // ESLint's language server in VS Code, as editor() tells it
  const run = spawnSync(process.execPath, args, { cwd: dir, encoding: "utf8", env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" } });
  assert.equal(run.status, 0, run.stderr);
  assert.deepEqual(names({ found: JSON.parse(run.stdout).diagnostics.filter((d) => d.code.includes("compressible-image")) }), ["crystal-ball.png"]);
  assert.deepEqual(run.stderr.match(/^spare .*$/gm), ["spare 1"]);
  // the oxlint command, which has nothing else to do meanwhile, uses every core
  rmSync(join(dir, "node_modules"), { recursive: true, force: true });
  const command = spawnSync(process.execPath, args, { cwd: dir, encoding: "utf8", env: { ...process.env, ELECTRON_RUN_AS_NODE: "" } });
  assert.deepEqual(command.stderr.match(/^spare .*$/gm), ["spare 0"]);
});

// chmod keeps neither Windows nor root out
test("an unreadable image is skipped, not an error", { skip: process.platform === "win32" || process.getuid?.() === 0 }, () => {
  const files = { "src/App.jsx": 'import a from "./assets/crystal-ball.png";\nimport b from "./assets/diagram.png";\n' };
  const dir = project({ files, images: ["src/assets/crystal-ball.png", "src/assets/diagram.png"] });
  chmodSync(join(dir, "src/assets/diagram.png"), 0o000);
  try {
    assert.deepEqual(names(oxlint(dir)), ["crystal-ball.png"]);
  } finally {
    chmodSync(join(dir, "src/assets/diagram.png"), 0o644);
  }
});

test("an image pngdeer can't take is named on stderr, not silently skipped", () => {
  const files = {
    "src/App.jsx": 'import fade from "./assets/fade.png";\nimport fake from "./assets/fake.png";\n',
    // pngdeer's engine panics on this image at target 90 (a bug upstream); if it ever stops, this
    // test needs another image it fails on
    "src/assets/fade.png": fade(),
    "src/assets/fake.png": "not an image ".repeat(400),
  };
  const dir = project({ files, options: { target: 90 }, images: [] });
  const { found, stderr } = oxlint(dir);
  assert.deepEqual(found, []);
  // upstream's new name, said so a user who knows the engine as pngdeer's isn't lost
  assert.match(stderr, /^pngdeer: src\/assets\/fade\.png: pngdeer couldn't compress this image: unreachable \(a bug in pngdeer's engine, now named slimdeer: please report it at https:\/\/github\.com\/heydeer\/slimdeer\/issues\)$/m);
  assert.match(stderr, /^pngdeer: skipped src\/assets\/fake\.png: not a PNG or JPEG$/m);
});

test("the lint says once, as it measures them, how many images the quality floor kept from being reported", () => {
  // fade.png's best at the automatic target looks visibly different (59), and nothing reaches 70
  const files = { "src/App.jsx": 'import fade from "./assets/fade.png";\nimport ball from "./assets/crystal-ball.png";\n', "src/assets/fade.png": fade() };
  const dir = project({ files, images: ["src/assets/crystal-ball.png"], options: { scan: "referenced" } });
  const first = oxlintSummary(dir);
  assert.match(first, /^pngdeer: measured 2 images in \d+\.\d s; later runs read the cache\npngdeer: 1 of them can't be made smaller without a visible difference \(its best quality is below 70\), so it isn't reported; npx oxlint-plugin-pngdeer --check names it$/m);
  assert.match(first, /^pngdeer: 1 flagged image could be/m);
  // and so it does
  assert.match(pngdeer(dir, "--check", "src").stdout, /^pngdeer: 1 image can't be made smaller without a visible difference \(its best quality is below 70\), so it isn't listed; /m);
  // later runs read the cache, and say nothing more
  assert.doesNotMatch(oxlintSummary(dir), /visible difference/);
  // a batch of that one image alone, which no code names (the project scan measures it for the
  // summary's table, where it isn't either), with the lint's own thresholds and cache folder: the
  // --check the line gives names it, from what the lint measured
  const alone = project({ files: { "src/App.jsx": "export const a = 1;\n", "public/fade.png": fade() }, images: [], options: { minSavedPercent: 5 } });
  const configFile = join(alone, ".oxlintrc.json");
  writeFileSync(configFile, JSON.stringify({ ...JSON.parse(readFileSync(configFile, "utf8")), settings: { pngdeer: { cacheDir: ".pngdeer" } } }));
  const line = /^pngdeer: measured 1 image in \d+\.\d s; later runs read the cache\npngdeer: it can't be made smaller without a visible difference \(its best quality is below 70\), so it isn't reported; npx oxlint-plugin-pngdeer (--check --cache-dir \.pngdeer --min-saved-percent 5) names it$/m.exec(oxlintSummary(alone));
  assert.ok(line);
  const named = pngdeer(alone, ...line[1].split(" "));
  assert.doesNotMatch(named.stderr, /measuring/);
  assert.match(named.stdout, /^pngdeer: 1 image can't be made smaller without a visible difference /m);
  // thresholds it wouldn't clear anyway: the floor isn't why it gets no warning
  const quiet = project({ files: { "src/App.jsx": 'import fade from "./assets/fade.png";\n', "src/assets/fade.png": fade() }, images: [], options: { minSavedPercent: 95 } });
  assert.doesNotMatch(oxlintSummary(quiet), /visible difference/);
  // the other forms; the --check that names them is the one with the lint's thresholds and cache folder
  assert.equal(floorLine(5, 4), "4 of them can't be made smaller without a visible difference (their best quality is below 70), so they aren't reported; npx oxlint-plugin-pngdeer --check names them");
  assert.equal(floorLine(3, 3, { minSavedBytes: 4096, minSavedPercent: 5 }), "none of them can be made smaller without a visible difference (their best quality is below 70), so they aren't reported; npx oxlint-plugin-pngdeer --check --min-saved-percent 5 names them");
  assert.equal(floorLine(2, 1, { cacheDir: ".pngdeer" }), "1 of them can't be made smaller without a visible difference (its best quality is below 70), so it isn't reported; npx oxlint-plugin-pngdeer --check --cache-dir .pngdeer names it");
  // a folder only PowerShell takes as typed would need "run in PowerShell": the plain --check names them too
  const platform = Object.getOwnPropertyDescriptor(process, "platform");
  Object.defineProperty(process, "platform", { ...platform, value: "win32" });
  try {
    assert.match(floorLine(1, 1, { cacheDir: "my cache" }), /; npx oxlint-plugin-pngdeer --check names it$/);
  } finally {
    Object.defineProperty(process, "platform", platform);
  }
  assert.match(floorLine(1, 1, { cacheDir: "my cache" }), process.platform === "win32" ? /--check names it$/ : /; npx oxlint-plugin-pngdeer --check --cache-dir 'my cache' names it$/);
});

test("the --check the floor line gives looks where the lint's batch did: in the project's folder, without what the rule leaves out", () => {
  // two copies of fade.png, whose best looks visibly different: the rule leaves one out
  const files = { "src/App.jsx": 'export const logo = "/logo.png";\n', "public/logo.png": fade(), "public/old/fade.png": fade() };
  const dir = project({ files, images: [], options: { exclude: ["public/old"] } });
  // a lint run below the project's folder, with its configuration
  const src = join(dir, "src");
  const line = /^pngdeer: it can't be made smaller .*; npx oxlint-plugin-pngdeer (--check \.\. --exclude public\/old) names it$/m.exec(oxlintSummary(src, "-c", "../.oxlintrc.json"));
  assert.ok(line);
  // run there, it names that one image, from what the lint measured
  const named = pngdeer(src, ...line[1].split(" "));
  assert.doesNotMatch(named.stderr, /measuring/);
  assert.match(named.stdout, /^pngdeer: checked 1 image; 0 measured, 1 cached, /m);
  assert.match(named.stdout, /^pngdeer: 1 image can't be made smaller without a visible difference .* --check \.\.\/public\/logo\.png /m);
  // and from a folder beside the project, or a monorepo's root, where a bare --check would find none,
  // or walk every package: it names that package's folder
  const packages = { "tools/notes.txt": "" };
  for (const name of ["a", "b"]) Object.assign(packages, { [`packages/${name}/package.json`]: "{}", [`packages/${name}/src/App.jsx`]: 'export const logo = "/logo.png";\n', [`packages/${name}/public/logo.png`]: fade() });
  const monorepo = project({ files: packages, images: [] });
  const tools = join(monorepo, "tools");
  const beside = /^pngdeer: it can't be made smaller .*; npx oxlint-plugin-pngdeer (--check \.\.\/packages\/a) names it$/m.exec(oxlintSummary(tools, "-c", "../.oxlintrc.json", join(monorepo, "packages/a/src")));
  assert.ok(beside);
  assert.match(pngdeer(tools, ...beside[1].split(" ")).stdout, /^pngdeer: checked 1 image; 0 measured, 1 cached, /m);
  const root = /^pngdeer: it can't be made smaller .*; npx oxlint-plugin-pngdeer (--check packages\/b) names it$/m.exec(oxlintSummary(monorepo));
  assert.ok(root);
  assert.match(pngdeer(monorepo, ...root[1].split(" ")).stdout, /^pngdeer: checked 1 image; 0 measured, 1 cached, /m);
  // a folder or pattern only PowerShell takes as typed: the plain --check from the project's folder
  const platform = Object.getOwnPropertyDescriptor(process, "platform");
  Object.defineProperty(process, "platform", { ...platform, value: "win32" });
  try {
    assert.match(floorLine(1, 1, { paths: [".."], exclude: ["old *"] }), /; npx oxlint-plugin-pngdeer --check \.\. names it$/);
    // a package's folder whose name needs quotes there: the plain --check, which walks it too
    assert.match(floorLine(1, 1, { paths: ["packages/my app"] }), /; npx oxlint-plugin-pngdeer --check names it$/);
  } finally {
    Object.defineProperty(process, "platform", platform);
  }
});

test("an explicit target has no quality floor, and the lint says nothing of one", () => {
  const files = { "src/App.jsx": 'import fade from "./assets/fade.png";\n', "src/assets/fade.png": fade() };
  const dir = project({ files, images: [], options: { target: 60 } });
  const stderr = oxlintSummary(dir);
  assert.match(stderr, /^pngdeer: measured 1 image in /m);
  assert.doesNotMatch(stderr, /visible difference/);
});

test("aliases resolve, including subpath imports that start with #", () => {
  const files = { "src/App.jsx": 'import a from "@/assets/crystal-ball.png";\nimport b from "#img/photo.jpg";\n' };
  const dir = project({ files, images: ["src/assets/crystal-ball.png", "public/photo.jpg"] });
  const config = JSON.parse(readFileSync(join(dir, ".oxlintrc.json"), "utf8"));
  config.settings = { pngdeer: { aliases: { "@/": "src/", "#img/": "public/" } } };
  writeFileSync(join(dir, ".oxlintrc.json"), JSON.stringify(config));
  assert.deepEqual(names(oxlint(dir)), ["crystal-ball.png", "photo.jpg"]);
});

test("aliases come from the project's tsconfig paths, through references and comments", () => {
  const files = {
    "src/App.jsx": 'import ball from "@assets/crystal-ball.png";\n',
    // Vite's templates keep paths in a referenced config; tsconfig files take comments and trailing commas
    "tsconfig.json": '{ "files": [], "references": [{ "path": "./tsconfig.app.json" }] }\n',
    "tsconfig.app.json": '{\n  // where images live\n  "compilerOptions": { "paths": { "@assets/*": ["./src/assets/*"], }, },\n}\n',
  };
  const dir = project({ files, images: ["src/assets/crystal-ball.png"] });
  assert.deepEqual(names(oxlint(dir)), ["crystal-ball.png"]);
  // settings win over the tsconfig
  const config = JSON.parse(readFileSync(join(dir, ".oxlintrc.json"), "utf8"));
  config.settings = { pngdeer: { aliases: { "@/": "src/" } } };
  writeFileSync(join(dir, ".oxlintrc.json"), JSON.stringify(config));
  assert.deepEqual(oxlint(dir).found, []);
});

test("the most specific tsconfig alias wins, with fallbacks only inside that mapping", () => {
  const dir = project({
    files: {
      "src/App.jsx": 'import photo from "@/assets/photo.jpg";\nimport hero from "@fallback/hero.png";\n',
      "tsconfig.json": JSON.stringify({ compilerOptions: { paths: {
        "@/*": ["./src/*"],
        "@/assets/*": ["./public/*"],
        "@fallback/*": ["./missing/*", "./public/*"],
      } } }),
    },
    images: ["public/photo.jpg", "public/hero.png"],
  });
  mkdirSync(join(dir, "src/assets"), { recursive: true });
  cpSync(join(dir, "public/photo.jpg"), join(dir, "src/assets/photo.jpg"));
  const { found } = oxlint(dir);
  assert.equal(found.length, 2);
  assert.ok(found.some(({ message }) => message.endsWith("Run: npx oxlint-plugin-pngdeer public/photo.jpg")));
  assert.ok(found.some(({ message }) => message.endsWith("Run: npx oxlint-plugin-pngdeer public/hero.png")));
  rmSync(join(dir, "public/photo.jpg"));
  assert.deepEqual(names(oxlint(dir)), ["hero.png"], "a missing specific mapping must not use the broader alias");
});

test("commands for leading-hyphen filenames use an explicit relative path", () => {
  const dir = project({ files: { "src/App.jsx": 'import hero from "../-hero.png";\n' }, images: ["public/hero.png"] });
  cpSync(join(dir, "public/hero.png"), join(dir, "-hero.png"));
  assert.match(oxlint(dir).found[0].message, /Run: npx oxlint-plugin-pngdeer \.\/-hero\.png$/);
});

test("a committed cache folder keeps a fresh clone from measuring again", () => {
  const files = { "src/App.jsx": 'import ball from "./assets/crystal-ball.png";\n' };
  const dir = project({ files, images: ["src/assets/crystal-ball.png"] });
  const config = JSON.parse(readFileSync(join(dir, ".oxlintrc.json"), "utf8"));
  config.settings = { pngdeer: { cacheDir: ".pngdeer" } };
  writeFileSync(join(dir, ".oxlintrc.json"), JSON.stringify(config));
  assert.match(oxlintSummary(dir), /measured 1 image/);
  assert.ok(readdirSync(join(dir, ".pngdeer")).some((name) => name.endsWith(".json")));
  // a clone: the committed folder, no node_modules
  rmSync(join(dir, "node_modules"), { recursive: true, force: true });
  const stderr = oxlintSummary(dir);
  assert.doesNotMatch(stderr, /measur/);
  assert.match(stderr, /1 flagged image could be/);
});

test("a cache folder set after a first lint gets what that lint measured", () => {
  const files = { "src/App.jsx": 'import ball from "./assets/crystal-ball.png";\n' };
  const dir = project({ files, images: ["src/assets/crystal-ball.png", "public/unused-fire.png"] });
  assert.match(oxlintSummary(dir), /measured 2 images/);
  const config = JSON.parse(readFileSync(join(dir, ".oxlintrc.json"), "utf8"));
  config.settings = { pngdeer: { cacheDir: ".pngdeer" } };
  writeFileSync(join(dir, ".oxlintrc.json"), JSON.stringify(config));
  const stderr = oxlintSummary(dir);
  assert.doesNotMatch(stderr, /measur/);
  // the named image and the one only the project scan finds, which the summary lists from that folder
  assert.equal(readdirSync(join(dir, ".pngdeer")).filter((name) => name.endsWith(".json")).length, 2);
  assert.match(stderr, /^  public\/unused-fire\.png /m);
  rmSync(join(dir, "node_modules"), { recursive: true, force: true });
  const clone = oxlintSummary(dir);
  assert.doesNotMatch(clone, /measur/);
  assert.match(clone, /1 flagged image could be/);
  assert.match(clone, /^  public\/unused-fire\.png /m);
});

test("a lint stopped while it measured doesn't keep the next one waiting", () => {
  const files = { "src/App.jsx": 'import ball from "./assets/crystal-ball.png";\n' };
  const dir = project({ files, images: ["src/assets/crystal-ball.png"] });
  const cache = join(dir, "node_modules", ".cache", "pngdeer");
  mkdirSync(cache, { recursive: true });
  // the lock of a process that has ended
  writeFileSync(join(cache, "measuring.lock"), `${spawnSync(process.execPath, ["-e", ""]).pid}`);
  const start = performance.now();
  assert.match(oxlintSummary(dir), /measured 1 image/);
  assert.ok(performance.now() - start < 60_000);
  assert.ok(!existsSync(join(cache, "measuring.lock")));
});

test("a lint waiting for another one's batch says so", { timeout: 60_000 }, async (t) => {
  const files = { "src/App.jsx": 'import ball from "./assets/crystal-ball.png";\n' };
  const dir = project({ files, images: ["src/assets/crystal-ball.png"] });
  const cache = join(dir, "node_modules", ".cache", "pngdeer");
  mkdirSync(cache, { recursive: true });
  // the lock of a process still running: an editor measuring, say
  const other = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"]);
  t.after(() => other.kill());
  writeFileSync(join(cache, "measuring.lock"), `${other.pid}`);
  const start = performance.now();
  const lint = spawn(process.execPath, [join(plugin, "node_modules", "oxlint", "bin", "oxlint"), "--format", "json"], { cwd: dir });
  t.after(() => lint.kill());
  lint.stdout.resume();
  lint.stderr.setEncoding("utf8");
  let stderr = "";
  const exit = new Promise((resolve) => lint.on("close", resolve));
  await new Promise((resolve) => {
    lint.stderr.on("data", (chunk) => {
      stderr += chunk;
      if (stderr.includes("waiting")) resolve();
    });
    exit.then(resolve);
  });
  // the other lint goes on a while, then ends
  await new Promise((resolve) => setTimeout(resolve, 1500));
  other.kill();
  assert.equal(await exit, 0, stderr);
  assert.match(stderr, /^pngdeer: waiting for another lint measuring this project \(if none is running, this one goes on within a minute\)$/m);
  // the time it gives is the measuring alone, without the wait
  const seconds = Number(/^pngdeer: measured 1 image in (\d+\.\d) s/m.exec(stderr)?.[1]);
  assert.ok(seconds + 1.5 <= (performance.now() - start) / 1000, stderr);
});

test('a first run that runs out of time fails a lint at "error" instead of passing it', () => {
  const files = { "src/App.jsx": 'import ball from "./assets/crystal-ball.png";\n' };
  const dir = project({ files, images: ["src/assets/crystal-ball.png"] });
  for (const config of [".oxlintrc.json", "eslint.config.js"]) {
    writeFileSync(join(dir, config), readFileSync(join(dir, config), "utf8").replace('["warn",', '["error",'));
  }
  const lint = (env, ...args) => spawnSync(process.execPath, args, { cwd: dir, encoding: "utf8", env: { ...process.env, ...env } });
  const oxlintBin = join(plugin, "node_modules", "oxlint", "bin", "oxlint");
  // a batch that can't finish in time (the real limit is 15 minutes)
  const short = { PNGDEER_TIMEOUT_MS: "1" };
  const byOxlint = lint(short, oxlintBin, "--format", "json");
  const byESLint = lint(short, join(plugin, "node_modules", "eslint", "bin", "eslint.js"), "--format", "json", "src");
  const incomplete = "pngdeer stopped measuring after 0.001 s with 1 image not measured yet, so this lint is incomplete. Run it again to carry on; in CI, keep the cache between runs (settings.pngdeer.cacheDir).";
  for (const [run, messages] of [
    [byOxlint, JSON.parse(byOxlint.stdout).diagnostics.filter((d) => d.code.includes("compressible-image"))],
    [byESLint, JSON.parse(byESLint.stdout).flatMap((file) => file.messages)],
  ]) {
    assert.equal(run.status, 1, run.stderr);
    assert.match(run.stderr, /^pngdeer: stopped measuring after 0\.001 s; what it measured is cached, so the next run here carries on \(in CI, only if the cache is kept between runs\)$/m);
    assert.deepEqual(messages.map(({ message }) => message), [incomplete]);
  }
  // the next run carries on
  const next = lint({}, oxlintBin, "--format", "json");
  assert.equal(next.status, 1, next.stderr);
  assert.deepEqual(names({ found: JSON.parse(next.stdout).diagnostics.filter((d) => d.code.includes("compressible-image")) }), ["crystal-ball.png"]);
});

test("a run out of time whose file turns the rule off reports on the next file, or else fails the lint", () => {
  const files = {
    "src/App.jsx": 'export const ball = "./assets/crystal-ball.png";\n',
    // linted first, so it measures, and ESLint would drop the problem on its line 1
    "src/0-legacy.js": "/* eslint-disable pngdeer/compressible-image */\nexport const old = 1;\n",
  };
  const lint = (dir, ...args) => {
    const run = spawnSync(process.execPath, [join(plugin, "node_modules", "eslint", "bin", "eslint.js"), "--format", "json", ...args], { cwd: dir, encoding: "utf8", env: { ...process.env, PNGDEER_TIMEOUT_MS: "1" } });
    const problems = JSON.parse(run.stdout).flatMap((file) => file.messages.filter((m) => m.ruleId === "pngdeer/compressible-image").map((m) => `${file.filePath.split(/[\\/]/).at(-1)}: ${m.message.split(",")[0]}`));
    return { ...run, problems };
  };
  const strict = project({ files, images: ["src/assets/crystal-ball.png"] });
  writeFileSync(join(strict, "eslint.config.js"), readFileSync(join(strict, "eslint.config.js"), "utf8").replace('["warn",', '["error",'));
  const both = lint(strict, "src");
  assert.equal(both.status, 1, both.stderr);
  assert.deepEqual(both.problems, ["App.jsx: pngdeer stopped measuring after 0.001 s with 1 image not measured yet"]);
  // no other file to take it: stderr says so, and the lint fails even at "warn"
  const alone = lint(project({ files, images: ["src/assets/crystal-ball.png"] }), "src/0-legacy.js");
  assert.equal(alone.status, 1, alone.stderr);
  assert.deepEqual(alone.problems, []);
  assert.match(alone.stderr, /^pngdeer: this lint is incomplete, with 1 image not measured yet, so it fails \(a comment turning the rule off hides the problem that says so\)$/m);
  // ESLint ignores the comment, so the file reports the problem itself, at the rule's severity
  const ignored = lint(project({ files, images: ["src/assets/crystal-ball.png"] }), "--no-inline-config", "src/0-legacy.js");
  assert.equal(ignored.status, 0, ignored.stderr);
  assert.deepEqual(ignored.problems, ["0-legacy.js: pngdeer stopped measuring after 0.001 s with 1 image not measured yet"]);
  assert.doesNotMatch(ignored.stderr, /so it fails/);
});

const [eslintMajor, eslintMinor] = JSON.parse(readFileSync(join(plugin, "node_modules", "eslint", "package.json"), "utf8")).version.split(".").map(Number);

test("ESLint's --concurrency threads say once what they measure", { skip: eslintMajor < 9 || (eslintMajor === 9 && eslintMinor < 34) }, () => {
  const files = Object.fromEntries(Array.from({ length: 8 }, (_, i) => [`src/F${i}.jsx`, 'export const a = "./assets/crystal-ball.png";\n']));
  const dir = project({ files, images: ["src/assets/crystal-ball.png", "public/unused-fire.png"] });
  // each thread's first file measures the project: one does, the others wait for it and find it done
  const stderr = eslintSummary(dir, "--concurrency", "4", "src");
  assert.equal(stderr.match(/^pngdeer: measuring 2 images not in the cache yet\.\.\.$/gm)?.length, 1, stderr);
  assert.equal(stderr.match(/^pngdeer: measured 2 images in /gm)?.length, 1, stderr);
  assert.doesNotMatch(stderr, /waiting/);
});

test("under ESLint's --concurrency, a problem another thread reported isn't owed", { skip: eslintMajor < 9 || (eslintMajor === 9 && eslintMinor < 34) }, () => {
  const files = {
    "src/App.jsx": 'export const ball = "./assets/crystal-ball.png";\n',
    "src/0-legacy.js": "/* eslint-disable pngdeer/compressible-image */\nexport const old = 1;\n",
  };
  const dir = project({ files, images: ["src/assets/crystal-ball.png"] });
  // each file in a thread of its own: the one that turns the rule off has no later file to report on
  const run = spawnSync(process.execPath, [join(plugin, "node_modules", "eslint", "bin", "eslint.js"), "--concurrency", "2", "src"], { cwd: dir, encoding: "utf8", env: { ...process.env, PNGDEER_TIMEOUT_MS: "1" } });
  assert.equal(run.status, 0, run.stdout + run.stderr);
  assert.match(run.stdout, /warning +pngdeer stopped measuring after 0\.001 s/);
  assert.doesNotMatch(run.stderr, /so it fails/);
});

test("an image code spells in two cases is one image: one full warning, one row, one --flagged entry", (t) => {
  const files = {
    "src/A.jsx": 'import ball from "./assets/crystal-ball.png";\n',
    "src/B.jsx": 'import ball from "./assets/Crystal-Ball.png";\n',
  };
  const dir = project({ files, images: ["src/assets/crystal-ball.png"] });
  if (!existsSync(join(dir, "src/assets/Crystal-Ball.png"))) return t.skip("this filesystem tells the spellings apart");
  const { found } = oxlint(dir);
  assert.equal(found.length, 2);
  assert.equal(found.filter((d) => /and look .* \(quality \d+\/100\)/.test(d.message)).length, 1);
  assert.equal(found.filter((d) => d.message.includes("as warned where it's first used")).length, 1);
  assert.match(oxlintSummary(dir), /^pngdeer: 1 flagged image \(2 warnings\) could be 24 kB smaller in all/m);
  assert.equal(handled(pngdeer(dir, "--flagged").stdout).length, 1);
});

test("an image named in several files gets one full warning, then short ones", () => {
  const files = {
    "src/A.jsx": 'import ball from "./assets/crystal-ball.png";\n',
    "src/B.jsx": 'import ball from "./assets/crystal-ball.png";\n',
  };
  const dir = project({ files, images: ["src/assets/crystal-ball.png"] });
  const { found } = oxlint(dir);
  assert.equal(found.length, 2);
  assert.equal(found.filter((d) => /and look .* \(quality \d+\/100\)/.test(d.message)).length, 1);
  assert.equal(found.filter((d) => d.message.endsWith("as warned where it's first used. Run: npx oxlint-plugin-pngdeer src/assets/crystal-ball.png")).length, 1);
  assert.match(oxlintSummary(dir), /^pngdeer: 1 flagged image \(2 warnings\) could be/m);
});

test("packages that share a cache folder each get their images measured", () => {
  const files = {
    "packages/a/package.json": "{}",
    "packages/a/src/A.jsx": 'import ball from "./ball.png";\n',
    "packages/b/package.json": "{}",
    "packages/b/src/B.jsx": "export const b = 1;\n",
    "packages/b/src/b.css": "body { background: url('./bg.png'); }\n",
  };
  const dir = project({ files, images: [] });
  mkdirSync(join(dir, "packages/a/src"), { recursive: true });
  cpSync(new URL("../example/src/assets/crystal-ball.png", import.meta.url), join(dir, "packages/a/src/ball.png"));
  cpSync(new URL("../example/src/assets/diagram.png", import.meta.url), join(dir, "packages/b/src/bg.png"));
  const config = JSON.parse(readFileSync(join(dir, ".oxlintrc.json"), "utf8"));
  config.settings = { pngdeer: { cacheDir: "../../.pngdeer" } };
  writeFileSync(join(dir, ".oxlintrc.json"), JSON.stringify(config));
  const stderr = oxlintSummary(dir, "packages");
  assert.match(stderr, /1 flagged image could be/);
  assert.match(stderr, /^  packages\/b\/src\/bg\.png .* used in packages\/b\/src\/b\.css$/m);
  // entries are formatted for Prettier: two-space JSON and a final newline
  const entry = readdirSync(join(dir, ".pngdeer")).find((name) => name.endsWith(".json"));
  assert.match(readFileSync(join(dir, ".pngdeer", entry), "utf8"), /^\{\n  "[\s\S]*\n\}\n$/);
});

test("a renamed plugin's disable comment counts, and the other file keeps its full warning", () => {
  const files = {
    "src/A.jsx": '// oxlint-disable-next-line img/compressible-image\nexport const a = "./assets/crystal-ball.png";\n',
    "src/B.jsx": 'export const b = "./assets/crystal-ball.png";\n',
  };
  const dir = project({ files, images: ["src/assets/crystal-ball.png"] });
  const config = { jsPlugins: [{ name: "img", specifier: join(plugin, "src", "index.js") }], rules: { "img/compressible-image": "warn" } };
  writeFileSync(join(dir, ".oxlintrc.json"), JSON.stringify(config));
  const { found } = oxlint(dir);
  assert.equal(found.length, 1);
  assert.match(found[0].message, /and look .* \(quality \d+\/100\)/);
  assert.match(oxlintSummary(dir), /^pngdeer: 1 flagged image could be/m);
});
