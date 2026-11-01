import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, copyFileSync, existsSync, lstatSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { cacheDir, key, write } from "../src/cache.js";
import { fill } from "../src/batch.js";
import { compress } from "../src/engine.js";
import { mark } from "../src/marker.js";
import { fade, names, oxlint, plugin, project } from "./helpers.js";

function check(cwd, ...args) {
  const run = spawnSync(process.execPath, [join(plugin, "bin/pngdeer.js"), "--check", ...args], { cwd, encoding: "utf8", timeout: 60_000 });
  assert.equal(run.error, undefined, run.error?.message);
  return run;
}

test("check finds unreferenced images, deduplicates inputs and preserves images and the flagged list", () => {
  const dir = project({ images: ["src/assets/crystal-ball.png"] });
  const file = join(dir, "src/assets/crystal-ball.png");
  const before = readFileSync(file);
  mkdirSync(cacheDir(dir), { recursive: true });
  const manifest = join(cacheDir(dir), "flagged.json");
  writeFileSync(manifest, "[]\n");
  const first = check(dir, "src", "src/assets/crystal-ball.png", "./src/assets/crystal-ball.png");
  assert.equal(first.status, 1, first.stderr);
  assert.match(first.stdout, /src\/assets\/crystal-ball\.png: could be 68% smaller/);
  assert.match(first.stdout, /checked 1 image; 1 measured, 0 cached/);
  assert.match(first.stdout, /1 image could save/);
  assert.deepEqual(readFileSync(file), before);
  assert.equal(readFileSync(manifest, "utf8"), "[]\n");
  const second = check(dir, "src");
  assert.equal(second.status, 1, second.stderr);
  assert.match(second.stdout, /0 measured, 1 cached/);
  assert.doesNotMatch(second.stderr, /measuring/);
});

test("check warms the linter's cache at the requested target and custom cache directory", () => {
  const dir = project({
    images: ["src/assets/crystal-ball.png"],
    files: { "src/app.js": 'export const image = "./assets/crystal-ball.png";' },
    options: { target: 70, measure: "never" },
  });
  const configFile = join(dir, ".oxlintrc.json");
  const config = JSON.parse(readFileSync(configFile, "utf8"));
  config.settings = { pngdeer: { cacheDir: ".pngdeer" } };
  writeFileSync(configFile, JSON.stringify(config));
  const run = check(dir, "src", "--target", "70", "--cache-dir", ".pngdeer");
  assert.equal(run.status, 1, run.stderr);
  const bytes = readFileSync(join(dir, "src/assets/crystal-ball.png"));
  assert.equal(existsSync(join(dir, ".pngdeer", `${key(bytes, 70)}.json`)), true);
  const lint = oxlint(dir, "src");
  assert.deepEqual(names(lint), ["crystal-ball.png"]);
  assert.doesNotMatch(lint.stderr, /measuring/);
  assert.equal(check(dir, "src", "--target", "70", "--cache-dir", ".pngdeer").status, 1);
});

test("check applies both savings thresholds and skips marked or tiny images", () => {
  const dir = project({ images: ["src/assets/crystal-ball.png"] });
  const run = check(dir, "src", "--min-saved-percent", "99");
  assert.equal(run.status, 0, run.stderr);
  assert.match(run.stdout, /no images exceed the savings thresholds/);
  const tiny = check(dir, "src", "--min-saved-bytes", "1000000");
  assert.equal(tiny.status, 0, tiny.stderr);
  assert.match(tiny.stdout, /0 measured, 0 cached, 1 skipped/);
  const file = join(dir, "src/assets/crystal-ball.png");
  writeFileSync(file, mark(readFileSync(file)));
  const marked = check(dir, "src");
  assert.equal(marked.status, 0, marked.stderr);
  assert.match(marked.stdout, /0 measured, 0 cached, 1 skipped/);
});

test("check uses package-relative exclusions even when scanning a subdirectory", () => {
  const dir = project({ images: ["src/assets/crystal-ball.png", "public/photo.jpg"] });
  let run = check(dir, "src/assets", "--exclude", "src/assets/**");
  assert.equal(run.status, 0, run.stderr);
  assert.match(run.stdout, /checked 0 images/);
  run = check(dir, "src/assets/crystal-ball.png", "public", "--exclude", "**/*.png", "--exclude", "public");
  assert.equal(run.status, 0, run.stderr);
  assert.match(run.stdout, /checked 0 images/);
  assert.equal(existsSync(cacheDir(dir)), false);
});

test("check errors override savings while still reporting valid images", () => {
  const dir = project({
    images: ["src/assets/crystal-ball.png"],
    files: { "bad.png": "not an image" },
  });
  const run = check(dir, "missing.png", "bad.png", "src");
  assert.equal(run.status, 2, run.stderr);
  assert.match(run.stderr, /missing\.png: no such file/);
  assert.match(run.stderr, /bad\.png: not a PNG or JPEG/);
  assert.match(run.stdout, /crystal-ball\.png: could be/);
  assert.match(run.stdout, /2 errors/);
  assert.equal(check(dir, "bad.png").status, 2);
});

test("check reports engine failures, including cached failures, as incomplete", () => {
  const dir = project({ images: [], files: { "fade.png": fade() } });
  for (let i = 0; i < 2; i++) {
    const run = check(dir, "fade.png", "--target", "90");
    assert.equal(run.status, 2, run.stderr);
    assert.match(run.stderr, /fade\.png: pngdeer couldn't compress/);
    assert.match(run.stdout, /check incomplete/);
  }
});

test("check defaults to the current directory and skips nested packages until named", () => {
  const dir = project({ images: [], files: { "packages/web/package.json": "{}" } });
  const nested = join(dir, "packages/web");
  copyFileSync(join(plugin, "example/src/assets/crystal-ball.png"), join(nested, "image.png"));
  const root = check(dir);
  assert.equal(root.status, 0, root.stderr);
  assert.match(root.stdout, /checked 0 images/);
  const child = check(dir, "packages/web");
  assert.equal(child.status, 1, child.stderr);
  assert.equal(existsSync(cacheDir(nested)), true);
  assert.equal(existsSync(cacheDir(dir)), false);
});

test("check deduplicates explicit symlinks with their targets", (t) => {
  const dir = project({ images: ["src/assets/crystal-ball.png"] });
  const file = join(dir, "src/assets/crystal-ball.png");
  try {
    symlinkSync(file, join(dir, "linked.png"));
  } catch (error) {
    if (process.platform === "win32" && error.code === "EPERM") return t.skip("symlinks require Windows Developer Mode");
    throw error;
  }
  const run = check(dir, "linked.png", "src");
  assert.equal(run.status, 1, run.stderr);
  assert.match(run.stdout, /checked 1 image;/);
});

test("check accepts cached unmarked engine output without measuring it again", async () => {
  const dir = project({ images: ["src/assets/crystal-ball.png"] });
  const file = join(dir, "src/assets/crystal-ball.png");
  const bytes = readFileSync(file);
  await fill({ dir: cacheDir(dir), files: [file] });
  writeFileSync(file, compress(bytes).output);
  const run = check(dir, file);
  assert.equal(run.status, 0, run.stderr);
  assert.match(run.stdout, /0 measured, 1 cached/);
});

test("check is clean when no smaller image reaches the target", () => {
  const dir = project({ images: ["src/assets/crystal-ball.png", "src/assets/heart.png"] });
  const run = check(dir, "src", "--target", "95");
  assert.equal(run.status, 0, run.stderr);
  assert.match(run.stdout, /no images exceed the savings thresholds/);
});

test("check reports unreadable subdirectories instead of a clean result", { skip: process.platform === "win32" }, (t) => {
  const dir = project({ images: [], files: { "private/image.png": "unreadable" } });
  const locked = join(dir, "private");
  chmodSync(locked, 0o000);
  t.after(() => chmodSync(locked, 0o755));
  const run = check(dir);
  assert.equal(run.status, 2, run.stderr);
  assert.match(run.stderr, /private: permission denied/);
});

test("check copies successful local results into a requested shared cache, but keeps failures local", () => {
  const dir = project({ images: ["src/assets/crystal-ball.png"] });
  const file = join(dir, "src/assets/crystal-ball.png");
  const bytes = readFileSync(file);
  const k = key(bytes);
  const entry = { original: bytes.length, compressed: 10000, outcome: "hit", score: 90 };
  write(cacheDir(dir), k, entry);
  const run = check(dir, file, "--cache-dir", ".pngdeer");
  assert.equal(run.status, 1, run.stderr);
  assert.match(run.stdout, /0 measured, 1 cached/);
  assert.deepEqual(JSON.parse(readFileSync(join(dir, ".pngdeer", `${k}.json`), "utf8")), entry);

  const failureKey = key(bytes, 90);
  write(cacheDir(dir), failureKey, { skipped: "engine failed", failed: true });
  const failed = check(dir, file, "--target", "90", "--cache-dir", ".pngdeer");
  assert.equal(failed.status, 2, failed.stderr);
  assert.equal(existsSync(join(dir, ".pngdeer", `${failureKey}.json`)), false);
});

test("directory checks include symlinked images and report dangling image links", (t) => {
  const dir = project({ images: ["src/assets/crystal-ball.png"] });
  const file = join(dir, "src/assets/crystal-ball.png");
  const bytes = readFileSync(file);
  const folder = join(dir, "public");
  const link = join(folder, "linked.png");
  mkdirSync(folder);
  try {
    symlinkSync(file, link);
  } catch (error) {
    if (process.platform === "win32" && error.code === "EPERM") return t.skip("symlinks require Windows Developer Mode");
    throw error;
  }
  write(cacheDir(dir), key(bytes), { original: bytes.length, compressed: 10000, outcome: "hit", score: 90 });
  const linked = check(dir, "public");
  assert.equal(linked.status, 1, linked.stderr);
  assert.match(linked.stdout, /checked 1 image; 0 measured, 1 cached/);
  assert.equal(lstatSync(link).isSymbolicLink(), true);
  assert.deepEqual(readFileSync(file), bytes);
  symlinkSync(join(dir, "missing.png"), join(folder, "dangling.png"));
  const dangling = check(dir, "public");
  assert.equal(dangling.status, 2, dangling.stderr);
  assert.match(dangling.stderr, /public\/dangling\.png: no such file/);
});
