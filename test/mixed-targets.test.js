import assert from "node:assert/strict";
import { readFileSync, realpathSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";
import { cacheDir, key, write } from "../src/cache.js";
import { readFlagged } from "../src/summary.js";
import { eslintSummary, oxlintSummary, plugin, project } from "./helpers.js";

function mixed({ strict = 95, entry = "miss", minSavedBytes = 4096, files = 2 } = {}) {
  const dir = project({ images: ["src/assets/crystal-ball.png"], options: { measure: "never", scan: "referenced", target: 70 } });
  for (let i = 0; i < files; i++) writeFileSync(join(dir, `src/${i % 2 ? "strict" : "loose"}${i}.js`), 'export const image = "./assets/crystal-ball.png";');
  const config = JSON.parse(readFileSync(join(dir, ".oxlintrc.json"), "utf8"));
  const options = { measure: "never", scan: "referenced", target: strict, minSavedBytes };
  config.overrides = [{ files: ["src/strict*.js"], rules: { "pngdeer/compressible-image": ["warn", options] } }];
  writeFileSync(join(dir, ".oxlintrc.json"), JSON.stringify(config));
  const index = pathToFileURL(join(plugin, "src/index.js")).href;
  writeFileSync(join(dir, "eslint.config.js"), `import pngdeer from ${JSON.stringify(index)};
export default [
  { files: ["src/*.js"], plugins: { pngdeer }, rules: { "pngdeer/compressible-image": ["warn", { measure: "never", scan: "referenced", target: 70 }] } },
  { files: ["src/strict*.js"], rules: { "pngdeer/compressible-image": ["warn", ${JSON.stringify(options)}] } },
];
`);
  const file = join(dir, "src/assets/crystal-ball.png");
  const bytes = readFileSync(file);
  write(cacheDir(dir), key(bytes, 70), { original: bytes.length, compressed: 10000, outcome: "hit", score: 72 });
  if (entry !== "missing") write(cacheDir(dir), key(bytes, strict === "auto" ? undefined : strict), {
    original: bytes.length,
    compressed: entry === "small" ? bytes.length - 100 : 20000,
    outcome: entry === "miss" ? "miss" : "hit",
    score: strict === "auto" ? 85 : strict,
  });
  return { dir, file };
}

for (const [name, lint] of [["oxlint", oxlintSummary], ["ESLint", eslintSummary]]) {
  test(`${name}: a stricter reference without a warning protects --flagged`, () => {
    for (const entry of ["miss", "small", "missing"]) {
      const { dir } = mixed({ entry });
      const stderr = lint(dir, "src");
      assert.deepEqual(readFlagged(dir), []);
      assert.match(stderr, /left 1 shared image out of --flagged/);
      assert.match(stderr, /src\/assets\/crystal-ball\.png/);
    }
  });

  test(`${name}: a reference below its byte threshold still constrains quality`, () => {
    const { dir } = mixed({ entry: "hit", minSavedBytes: 1000000 });
    assert.match(lint(dir, "src"), /left 1 shared image out of --flagged/);
    assert.deepEqual(readFlagged(dir), []);
  });

  test(`${name}: a disabled reference does not constrain bulk quality`, () => {
    const { dir, file } = mixed({ entry: "hit" });
    writeFileSync(join(dir, "src/strict1.js"), '// eslint-disable-next-line pngdeer/compressible-image\nexport const image = "./assets/crystal-ball.png";');
    assert.doesNotMatch(lint(dir, "src"), /left 1 shared image out of --flagged/);
    assert.deepEqual(readFlagged(dir), [{ file: realpathSync(file), target: 70 }]);
  });

  test(`${name}: reported fixed targets select the strictest, but automatic/fixed mixtures need review`, () => {
    const fixed = mixed({ strict: 90, entry: "hit" });
    lint(fixed.dir, "src");
    assert.deepEqual(readFlagged(fixed.dir), [{ file: realpathSync(fixed.file), target: 90 }]);
    const automatic = mixed({ strict: "auto", entry: "hit" });
    assert.match(lint(automatic.dir, "src"), /left 1 shared image out of --flagged/);
    assert.deepEqual(readFlagged(automatic.dir), []);
  });
}

const [major, minor] = JSON.parse(readFileSync(join(plugin, "node_modules/eslint/package.json"), "utf8")).version.split(".").map(Number);
test("ESLint concurrency shares non-reporting target constraints with the summary", { skip: major < 9 || (major === 9 && minor < 34) }, () => {
  const { dir } = mixed({ files: 32 });
  const stderr = eslintSummary(dir, "--concurrency", "2", "src");
  assert.deepEqual(readFlagged(dir), []);
  assert.match(stderr, /left 1 shared image out of --flagged/);
});
