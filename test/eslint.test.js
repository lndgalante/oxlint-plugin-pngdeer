// The same rule under ESLint: CI runs this with the newest ESLint and with 9.0, which
// ignores meta.defaultOptions.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";
import { eslint, eslintSummary, handled, names, oxlint, plugin, pngdeer, project } from "./helpers.js";

test("ESLint gives the same warnings as oxlint, and waits for a cold cache the same way", () => {
  const dir = project();
  const first = eslint(dir, "src");
  assert.deepEqual(names(first), ["crystal-ball.png", "diagram.png", "hero.png", "photo.jpg"]);
  assert.match(first.stderr, /^pngdeer: measured 5 images in /m);
  assert.deepEqual(names(oxlint(dir)), names(first));
});

test("ESLint takes the rule's options", () => {
  const dir = project({ files: { "src/App.jsx": 'import ball from "./assets/crystal-ball.png";\n' }, options: { target: 70, minSavedPercent: 50 }, images: ["src/assets/crystal-ball.png"] });
  const [found] = eslint(dir, "src").found;
  assert.match(found.message, / \(quality 7\d\/100\)\. Run: npx oxlint-plugin-pngdeer src\/assets\/crystal-ball\.png --target 70$/);
});

test("ESLint owns suppression so used disable comments are not reported as unused", () => {
  const dir = project({
    files: { "src/App.jsx": '// eslint-disable-next-line pngdeer/compressible-image\nexport const hero = "/hero.png";\n' },
    images: ["public/hero.png"],
  });
  const run = spawnSync(process.execPath, [join(plugin, "node_modules/eslint/bin/eslint.js"), "--format", "json", "--report-unused-disable-directives", "src"], { cwd: dir, encoding: "utf8" });
  assert.equal(run.status, 0, run.stdout || run.stderr);
  assert.deepEqual(JSON.parse(run.stdout).flatMap(({ messages }) => messages), []);
  const unsuppressed = eslint(dir, "--no-inline-config", "src");
  assert.deepEqual(names(unsuppressed), ["hero.png"]);
  assert.match(unsuppressed.found[0].message, /quality \d+\/100/);
});

test("lintText without a filename resolves images from ESLint's cwd", () => {
  const dir = project({ images: ["public/hero.png"] });
  const script = `import { ESLint } from ${JSON.stringify(pathToFileURL(join(plugin, "node_modules", "eslint", "lib", "api.js")).href)};
const results = await new ESLint({ cwd: ${JSON.stringify(dir)} }).lintText('export const hero = "/hero.png";');
console.log(JSON.stringify(results.flatMap((result) => result.messages)));
`;
  const scriptFile = join(dir, "lint.mjs");
  writeFileSync(scriptFile, script);
  const run = spawnSync(process.execPath, [scriptFile], { cwd: plugin, encoding: "utf8", timeout: 60_000 });
  assert.equal(run.status, 0, run.stderr);
  assert.ok(JSON.parse(run.stdout).some(({ message }) => message.startsWith("hero.png could be")), run.stdout);
});

test("a tool calling ESLint's Node API waits, and an editor's language server doesn't", () => {
  const dir = project();
  // the same few lines, as a one-off script and as ESLint's language server would run them
  const script = `import { ESLint } from ${JSON.stringify(pathToFileURL(join(plugin, "node_modules", "eslint", "lib", "api.js")).href)};
const results = await new ESLint({ cwd: process.argv[2] }).lintFiles(["src"]);
console.log(results.flatMap((r) => r.messages).filter((m) => m.ruleId === "pngdeer/compressible-image").length);
`;
  const run = (name) => {
    writeFileSync(join(dir, name), script);
    const result = spawnSync(process.execPath, [join(dir, name), dir], { encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    return Number(result.stdout.trim());
  };
  assert.equal(run("eslintServer.mjs"), 0, "the editor's first lint doesn't wait");
  assert.equal(run("lint.mjs"), 4, "a one-off run waits for the measuring");
});

const eslintVersion = JSON.parse(readFileSync(join(plugin, "node_modules", "eslint", "package.json"), "utf8")).version;
const [major, minor] = eslintVersion.split(".").map(Number);

test("ESLint --concurrency: one summary, and --flagged still has the list", { skip: major < 9 || (major === 9 && minor < 34) }, () => {
  const files = Object.fromEntries(Array.from({ length: 8 }, (_, i) => [`src/F${i}.jsx`, `import a from "./assets/crystal-ball.png";\nexport const b = "/photo.jpg";\n`]));
  const dir = project({ files, images: ["src/assets/crystal-ball.png", "public/photo.jpg"] });
  const stderr = eslintSummary(dir, "--concurrency", "2", "src");
  assert.equal(stderr.match(/flagged images? .*could be/g)?.length, 1, stderr);
  assert.match(stderr, /^pngdeer: 2 flagged images \(16 warnings\) could be/m);
  assert.deepEqual(handled(pngdeer(dir, "--flagged").stdout).sort(), ["public/photo.jpg", "src/assets/crystal-ball.png"]);
});

test("eslint --fix lints a file again, and its warning stays the full one", () => {
  const files = {
    "src/App.jsx": 'var x = 1;\nexport const a = ["./assets/crystal-ball.png", x];\n',
    "eslint.config.js": `import pngdeer from ${JSON.stringify(pathToFileURL(join(plugin, "src", "index.js")).href)};
export default [{ files: ["**/*.jsx"], plugins: { pngdeer }, rules: { "no-var": "error", "pngdeer/compressible-image": "warn" } }];
`,
  };
  const dir = project({ files, images: ["src/assets/crystal-ball.png"] });
  const [found] = eslint(dir, "--fix", "src").found;
  assert.match(found.message, /and look .* \(quality \d+\/100\)/);
  assert.match(eslintSummary(dir, "src"), /^pngdeer: 1 flagged image could be/m);
});
