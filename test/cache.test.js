import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { fill } from "../src/batch.js";
import { cacheDir, ENGINE, fileKey, key, legacyKey, read, reportable, write } from "../src/cache.js";
import { oxlintSummary, slimdeer, project } from "./helpers.js";

test("a same-size replacement with preserved mtime gets a new content key", () => {
  const dir = project({ images: [] });
  const file = join(dir, "image.png");
  const replacement = join(dir, "replacement.png");
  const time = new Date("2020-01-01T00:00:00Z");
  writeFileSync(file, "before");
  utimesSync(file, time, time);
  const before = fileKey(file);
  assert.equal(fileKey(file), before);
  writeFileSync(replacement, "after!");
  utimesSync(replacement, time, time);
  renameSync(replacement, file);
  const after = fileKey(file);
  assert.notEqual(after.key, before.key);
  assert.equal(after.key, key(Buffer.from("after!")));
});

test("zero thresholds still require an actual saving", () => {
  const options = { minSavedBytes: 0, minSavedPercent: 0 };
  const entry = { original: 100, compressed: 100, outcome: "lossless" };
  assert.equal(reportable(entry, options), false);
  assert.equal(reportable({ ...entry, compressed: 101 }, options), false);
  assert.equal(reportable({ ...entry, compressed: 99 }, options), true);
});

test("percentage thresholds compare exact savings before display rounding", () => {
  const options = { minSavedBytes: 0, minSavedPercent: 10 };
  const entry = { original: 1000, compressed: 905, outcome: "hit" };
  assert.equal(reportable(entry, options), false);
  assert.equal(reportable({ ...entry, compressed: 900 }, options), true);
});

test("an entry holds only what slimdeer computes, so it is the same on every machine", async () => {
  const dir = project({ images: ["src/assets/crystal-ball.png"] });
  const file = join(dir, "src/assets/crystal-ball.png");
  await fill({ dir: join(dir, "cache"), files: [file] });
  // the file itself: read() leaves out the time 0.5.0 kept, so it couldn't tell
  const entry = JSON.parse(readFileSync(join(dir, "cache", `${key(readFileSync(file))}.json`), "utf8"));
  assert.deepEqual(Object.keys(entry), ["original", "compressed", "outcome", "score"]);
});

test("a result 0.5.0 measured goes into a cache folder set later without the time it took", () => {
  const files = { "src/App.jsx": 'import ball from "./assets/crystal-ball.png";\n' };
  const dir = project({ files, images: ["src/assets/crystal-ball.png"], options: { target: 80 } });
  const bytes = readFileSync(join(dir, "src/assets/crystal-ball.png"));
  const k = key(bytes, 80);
  const measured = { original: bytes.length, compressed: 6652, outcome: "hit", score: 80.08 };
  // as 0.5.0 left it, at a target whose key hasn't changed: with how long it took on that machine
  mkdirSync(cacheDir(dir), { recursive: true });
  writeFileSync(join(cacheDir(dir), `${k}.json`), JSON.stringify({ ...measured, ms: 838 }));
  const config = JSON.parse(readFileSync(join(dir, ".oxlintrc.json"), "utf8"));
  config.settings = { slimdeer: { cacheDir: ".slimdeer" } };
  writeFileSync(join(dir, ".oxlintrc.json"), JSON.stringify(config));
  const copied = () => JSON.parse(readFileSync(join(dir, ".slimdeer", `${k}.json`), "utf8"));
  assert.doesNotMatch(oxlintSummary(dir), /measur/);
  assert.deepEqual(copied(), measured);
  // and --check --cache-dir, which fills such a folder from what this machine measured
  rmSync(join(dir, ".slimdeer"), { recursive: true });
  assert.equal(slimdeer(dir, "--check", "src", "--target", "80", "--cache-dir", ".slimdeer").status, 1);
  assert.deepEqual(copied(), measured);
});

test("0.5.0's automatic results carry over where the quality floor changes nothing", async () => {
  const dir = project({ images: ["src/assets/crystal-ball.png", "public/unused-fire.png"] });
  const cache = join(dir, "cache");
  const [ball, fire] = ["src/assets/crystal-ball.png", "public/unused-fire.png"].map((file) => readFileSync(join(dir, file)));
  // as 0.5.0 left them: a measurement with the time it took, and the mark of slimdeer's own output
  write(cache, legacyKey(ball), { original: ball.length, compressed: 11179, outcome: "hit", score: 86.9, ms: 726 });
  write(cache, legacyKey(fire), { original: fire.length, outcome: "output" });
  const result = await fill({ dir: cache, files: ["src/assets/crystal-ball.png", "public/unused-fire.png"].map((file) => join(dir, file)) });
  assert.deepEqual([result.computed, result.cached], [0, 2]);
  assert.deepEqual(read(cache, key(ball)), { original: ball.length, compressed: 11179, outcome: "hit", score: 86.9 });
  assert.deepEqual(read(cache, key(fire)), { original: fire.length, outcome: "output" });
});

test("0.5.0's automatic results that look visibly different are measured again", async () => {
  const dir = project({ images: ["src/assets/crystal-ball.png"] });
  const cache = join(dir, "cache");
  const file = join(dir, "src/assets/crystal-ball.png");
  const bytes = readFileSync(file);
  write(cache, legacyKey(bytes), { original: bytes.length, compressed: 5000, outcome: "hit", score: 61.2, ms: 700 });
  const result = await fill({ dir: cache, files: [file] });
  assert.equal(result.computed, 1);
  assert.ok(Math.round(read(cache, key(bytes)).score) >= 70);
});

test("0.5.0's entries that --check would call invalid are measured again, not carried over", async () => {
  const dir = project({ images: ["src/assets/crystal-ball.png", "public/unused-fire.png"] });
  const cache = join(dir, "cache");
  const files = ["src/assets/crystal-ball.png", "public/unused-fire.png"].map((file) => join(dir, file));
  const [ball, fire] = files.map((file) => readFileSync(file));
  // the size of other bytes, and a hit with no score
  write(cache, legacyKey(ball), { original: 1, compressed: 5, outcome: "hit", score: 86.9 });
  write(cache, legacyKey(fire), { original: fire.length, compressed: 100, outcome: "hit" });
  const result = await fill({ dir: cache, files });
  assert.deepEqual([result.computed, result.cached], [2, 0]);
  for (const bytes of [ball, fire]) {
    const entry = read(cache, key(bytes));
    assert.equal(entry.original, bytes.length);
    assert.ok(Number.isFinite(entry.score));
  }
});

test("explicit targets keep 0.5.0's keys, and the automatic target's names its floor", () => {
  const bytes = Buffer.from("image");
  // 0.5.0's key: the bytes, the engine, the target ("auto" for automatic) and cache format 3
  const old = (target) => createHash("sha256").update(bytes).update(`\0${ENGINE}\0${target}\0${3}`).digest("hex");
  assert.equal(key(bytes, 70), old(70));
  assert.equal(key(bytes, 0), old(0));
  assert.equal(legacyKey(bytes), old("auto"));
  assert.notEqual(key(bytes), old("auto"));
});
