// The same rule under ESLint: CI runs this with the newest ESLint and with 9.0, which
// ignores meta.defaultOptions.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";
import { eslint, names, oxlint, plugin, project } from "./helpers.js";

test("ESLint gives the same warnings as oxlint, and waits for a cold cache the same way", () => {
  const dir = project();
  const first = eslint(dir, "src");
  assert.deepEqual(names(first), ["crystal-ball.png", "diagram.png", "hero.png", "photo.jpg"]);
  assert.match(first.stderr, /^pngdeer: measured 5 images in /m);
  assert.match(first.stderr, /^pngdeer: 4 images could be \d+ kB smaller in all/m);
  assert.deepEqual(names(oxlint(dir)), names(first));
});

test("ESLint takes the rule's options", () => {
  const dir = project({ files: { "src/App.jsx": 'import ball from "./assets/crystal-ball.png";\n' }, options: { target: 70, minSavedPercent: 50 }, images: ["src/assets/crystal-ball.png"] });
  const [found] = eslint(dir, "src").found;
  assert.match(found.message, / at SSIMULACRA2 70\. Run: npx oxlint-plugin-pngdeer src\/assets\/crystal-ball\.png --target 70$/);
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
