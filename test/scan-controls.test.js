import assert from "node:assert/strict";
import { readFileSync, realpathSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { cacheDir, key, read, write } from "../src/cache.js";
import { readFlagged } from "../src/summary.js";
import { eslint, eslintSummary, names, oxlint, oxlintSummary, project } from "./helpers.js";

const ball = "src/assets/crystal-ball.png";
const photo = "public/photo.jpg";
const source = 'export const images = ["./assets/crystal-ball.png", "/photo.jpg"];';
const cached = (dir, path) => read(cacheDir(dir), key(readFileSync(join(dir, path))));

for (const [name, lint, summary] of [["oxlint", oxlint, oxlintSummary], ["ESLint", eslint, eslintSummary]]) {
  test(`${name}: referenced scanning measures only images named by linted files`, () => {
    const dir = project({
      images: [ball, photo],
      files: { "src/app.js": 'export const image = "./assets/crystal-ball.png";' },
      options: { scan: "referenced" },
    });
    const result = lint(dir, "src/app.js");
    assert.deepEqual(names(result), ["crystal-ball.png"]);
    assert.ok(cached(dir, ball));
    assert.equal(cached(dir, photo), null);
    assert.match(result.stderr, /measured 1 image in/);

    const bytes = readFileSync(join(dir, photo));
    write(cacheDir(dir), key(bytes), { original: bytes.length, compressed: 1000, outcome: "hit", score: 90 });
    assert.doesNotMatch(summary(dir, "src/app.js"), /photo\.jpg|no linted JS or TS names/);
  });

  test(`${name}: exclusions apply to references, scans, cached summaries and --flagged`, () => {
    const dir = project({ images: [ball, photo], files: { "src/app.js": source }, options: { exclude: ["public/**"] } });
    assert.deepEqual(names(lint(dir, "src/app.js")), ["crystal-ball.png"]);
    assert.equal(cached(dir, photo), null);
    assert.deepEqual(readFlagged(dir), [{ file: realpathSync(join(dir, ball)) }]);

    const bytes = readFileSync(join(dir, photo));
    write(cacheDir(dir), key(bytes), { original: bytes.length, compressed: 1000, outcome: "hit", score: 90 });
    assert.doesNotMatch(summary(dir, "src/app.js"), /photo\.jpg/);
  });
}

test("a project scan still runs after a referenced-only override in the same project", () => {
  const dir = project({ images: [ball, photo], files: {
    "src/a.js": 'export const image = "./assets/crystal-ball.png";',
    "src/b.js": "export const value = 1;",
  }, options: { scan: "project" } });
  const path = join(dir, ".oxlintrc.json");
  const config = JSON.parse(readFileSync(path, "utf8"));
  config.overrides = [{ files: ["src/a.js"], rules: { "pngdeer/compressible-image": ["warn", { scan: "referenced" }] } }];
  writeFileSync(path, JSON.stringify(config));
  const stderr = oxlintSummary(dir, "src/a.js", "src/b.js");
  assert.ok(cached(dir, photo));
  assert.match(stderr, /photo\.jpg/);
});

test("project summaries retain configurations with different exclusions", async (t) => {
  const summary = await import("../src/summary.js?scan-controls");
  const dir = project({ images: [ball, photo] });
  for (const file of [ball, photo]) {
    const bytes = readFileSync(join(dir, file));
    write(cacheDir(dir), key(bytes), { original: bytes.length, compressed: 1000, outcome: "hit", score: 90 });
  }
  const options = { minSavedBytes: 4096, minSavedPercent: 10, dir: cacheDir(dir), scan: "project" };
  summary.watch(dir, { ...options, exclude: ["public"] });
  summary.watch(dir, { ...options, exclude: ["src/assets"] });
  summary.watch(dir, { ...options, scan: "referenced" });
  let stderr = "";
  t.mock.method(process.stderr, "write", (text) => { stderr += text; return true; });
  summary.summarize(dir);
  assert.match(stderr, /2 images that no linted JS or TS names/);
  assert.match(stderr, /photo\.jpg/);
  assert.match(stderr, /crystal-ball\.png/);
});
