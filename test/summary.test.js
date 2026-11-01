import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { cacheDir, key, write } from "../src/cache.js";
import { flaggedList, readFlagged } from "../src/summary.js";
import { oxlintSummary, pngdeer, project } from "./helpers.js";

test("summary commands keep each package's measured quality target", () => {
  const dir = project({
    images: [],
    files: {
      "packages/a/package.json": "{}",
      "packages/a/src/app.js": "export const app = 1;",
      "packages/a/public/bg.png": "a".repeat(10000),
      "packages/b/package.json": "{}",
      "packages/b/src/app.js": "export const app = 2;",
      "packages/b/public/bg.png": "b".repeat(10000),
    },
    options: { measure: "never" },
  });
  const config = JSON.parse(readFileSync(join(dir, ".oxlintrc.json"), "utf8"));
  config.overrides = [
    { files: ["packages/a/**"], rules: { "pngdeer/compressible-image": ["warn", { measure: "never", target: 90 }] } },
    { files: ["packages/b/**"], rules: { "pngdeer/compressible-image": ["warn", { measure: "never", target: 70 }] } },
  ];
  writeFileSync(join(dir, ".oxlintrc.json"), JSON.stringify(config));
  for (const [name, target] of [["a", 90], ["b", 70]]) {
    const root = join(dir, "packages", name);
    const bytes = readFileSync(join(root, "public/bg.png"));
    write(cacheDir(root), key(bytes, target), { original: bytes.length, compressed: 1000, outcome: "hit", score: target });
  }
  const stderr = oxlintSummary(dir, "packages");
  assert.match(stderr, /run: npx oxlint-plugin-pngdeer packages\/a\/public\/bg\.png --target 90$/m);
  assert.match(stderr, /run: npx oxlint-plugin-pngdeer packages\/b\/public\/bg\.png --target 70$/m);
});

test("corrupt flagged lists are rejected before the command reads image paths", () => {
  const dir = project({ images: [] });
  mkdirSync(cacheDir(dir), { recursive: true });
  const file = join(dir, "image.png");
  for (const value of [{}, "invalid", [null], [{}], [{ file: 123 }], [{ file: "relative.png" }], [{ file, target: "90" }], [{ file, target: null }], [{ file, target: -1 }], [{ file, target: 101 }]]) {
    writeFileSync(flaggedList(dir), JSON.stringify(value));
    assert.equal(readFlagged(dir), null, JSON.stringify(value));
  }
  const run = pngdeer(dir, "--flagged");
  assert.equal(run.status, 1);
  assert.match(run.stderr, /run npx oxlint \(or eslint\) here first/);
  assert.doesNotMatch(run.stderr, /TypeError|RangeError/);
  const valid = [{ file }, { file, target: 90 }];
  writeFileSync(flaggedList(dir), JSON.stringify(valid));
  assert.deepEqual(readFlagged(dir), valid);
});

test("shared images keep the strictest reported target regardless of file order", async (t) => {
  t.mock.method(process.stderr, "write", () => true);
  for (const targets of [[90, 70], [70, 90]]) {
    const dir = project({ images: [] });
    const summary = await import(`../src/summary.js?targets=${targets.join("-")}`);
    const file = join(dir, "image.png");
    summary.watch(dir, { minSavedBytes: 4096, minSavedPercent: 10, dir: cacheDir(dir) });
    for (const target of targets) {
      summary.flag(file, join(dir, `${target}.js`), { original: 10000, compressed: 1000, score: target, target });
    }
    summary.summarize(dir);
    assert.deepEqual(readFlagged(dir), [{ file, target: 90 }]);
  }
});
