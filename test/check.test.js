import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, copyFileSync, existsSync, lstatSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { cacheDir, key, write } from "../src/cache.js";
import { fill } from "../src/batch.js";
import { compress } from "../src/engine.js";
import { mark } from "../src/marker.js";
import { fade, grayWithProfile, names, oxlint, plugin, project } from "./helpers.js";

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
  assert.match(first.stdout, /^src\/assets\/crystal-ball\.png: could be 68% smaller \(35 kB → 11 kB, quality 87\/100: looks the same side by side\)$/m);
  assert.match(first.stdout, /checked 1 image; 1 measured, 0 cached/);
  assert.match(first.stdout, /^pngdeer: 1 image could be 24 kB smaller \(35 kB → 11 kB, 68% smaller\)\. Images unchanged\.$/m);
  assert.match(first.stdout, /^pngdeer: to preview it as a new file, run: npx oxlint-plugin-pngdeer src\/assets\/crystal-ball\.png -o crystal-ball\.preview\.png$/m);
  assert.match(first.stdout, /^pngdeer: to shrink it in place \(lossy, so commit first\), run: npx oxlint-plugin-pngdeer src\/assets\/crystal-ball\.png$/m);
  // stderr isn't a terminal: no count rewriting its line
  assert.doesNotMatch(first.stderr, /\r/);
  assert.deepEqual(readFileSync(file), before);
  assert.equal(readFileSync(manifest, "utf8"), "[]\n");
  const second = check(dir, "src");
  assert.equal(second.status, 1, second.stderr);
  assert.match(second.stdout, /0 measured, 1 cached/);
  assert.doesNotMatch(second.stderr, /measuring/);
});

test("check lists the biggest savings last, totals them, and shrinks the 10 biggest", () => {
  const dir = project({ images: ["src/assets/crystal-ball.png"] });
  const bytes = readFileSync(join(dir, "src/assets/crystal-ball.png"));
  mkdirSync(join(dir, "public"));
  // 12 different images, measured already: the first by name saves the most
  for (let i = 0; i < 12; i++) {
    const image = Buffer.concat([bytes, Buffer.alloc(i + 1)]);
    writeFileSync(join(dir, "public", `img-${String(i).padStart(2, "0")}.png`), image);
    const entry = { original: image.length, compressed: image.length - 20000 + 1000 * i, outcome: i === 11 ? "lossless" : "hit", score: 85 };
    write(cacheDir(dir), key(image), entry);
    write(cacheDir(dir), key(image, 70), entry);
  }
  const run = check(dir, "public");
  assert.equal(run.status, 1, run.stderr);
  const rows = run.stdout.split("\n").filter((line) => line.startsWith("public/"));
  assert.deepEqual(rows.map((line) => line.split(":")[0]), Array.from({ length: 12 }, (_, i) => `public/img-${String(11 - i).padStart(2, "0")}.png`));
  assert.match(rows[0], /: could be 25% smaller \(35 kB → 26 kB, lossless: looks identical\)$/);
  assert.match(rows[11], /: could be 56% smaller \(35 kB → 15 kB, quality 85\/100: looks the same side by side\)$/);
  assert.match(run.stdout, /^pngdeer: 12 images could be 174 kB smaller \(426 kB → 252 kB, 41% smaller\)\. Images unchanged\.$/m);
  assert.match(run.stdout, /^pngdeer: to preview the biggest saving as a new file, run: npx oxlint-plugin-pngdeer public\/img-00\.png -o img-00\.preview\.png$/m);
  const biggest = Array.from({ length: 10 }, (_, i) => `public/img-${String(i).padStart(2, "0")}.png`).join(" ");
  assert.ok(run.stdout.includes(`pngdeer: to shrink the 10 biggest of 12 in place (lossy, so commit first), run: npx oxlint-plugin-pngdeer ${biggest}\n`), run.stdout);
  // the same next steps at a fixed target
  assert.match(check(dir, "public", "--target", "70").stdout, /run: npx oxlint-plugin-pngdeer public\/img-00\.png --target 70 -o img-00\.preview\.png$/m);
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

test("check says how many images it measures once copies of one image count once", () => {
  const dir = project({ images: [] });
  for (const name of ["a.png", "b.png"]) copyFileSync(join(plugin, "example/src/assets/crystal-ball.png"), join(dir, name));
  const run = check(dir);
  assert.equal(run.status, 1, run.stderr);
  assert.match(run.stderr, /^pngdeer: measuring 1 image not in the cache yet\.\.\.$/m);
  assert.match(run.stdout, /checked 2 images; 1 measured, 1 cached/);
});

test("a grayscale PNG with a color profile below the byte threshold is skipped, not an error", () => {
  const dir = project({ images: [], files: { "icon.png": grayWithProfile(16), "big.png": grayWithProfile(100) } });
  const small = check(dir, "icon.png");
  assert.equal(small.status, 0, small.stderr);
  assert.match(small.stdout, /checked 1 image; 0 measured, 0 cached, 1 skipped/);
  assert.equal(small.stderr, "");
  // one big enough to measure is named, as pngdeer's output could look darker
  const big = check(dir, "big.png");
  assert.equal(big.status, 2, big.stderr);
  assert.match(big.stderr, /^big\.png: a grayscale PNG with a color profile \(pngdeer's output can look darker\)$/m);
  // a file that isn't an image is an error at any size (a Git LFS pointer, say)
  writeFileSync(join(dir, "pointer.png"), "version https://git-lfs.github.com/spec/v1\n");
  assert.equal(check(dir, "pointer.png").status, 2);
});

test("check uses package-relative exclusions even when scanning a subdirectory", () => {
  const dir = project({ images: ["src/assets/crystal-ball.png", "public/photo.jpg"] });
  let run = check(dir, "src/assets", "--exclude", "src/assets/**");
  assert.equal(run.status, 0, run.stderr);
  assert.match(run.stdout, /checked 0 images/);
  run = check(dir, "src/assets/crystal-ball.png", "public", "--exclude", "**/*.png", "--exclude", "public");
  assert.equal(run.status, 0, run.stderr);
  assert.match(run.stdout, /checked 0 images/);
  assert.match(run.stdout, /^pngdeer: found no PNG or JPEG images to check\.$/m);
  assert.equal(existsSync(cacheDir(dir)), false);
});

test("check errors override savings while still reporting valid images", () => {
  const dir = project({
    images: ["src/assets/crystal-ball.png"],
    files: { "bad.png": "not an image" },
  });
  const run = check(dir, "missing.png", "bad.png", "src");
  assert.equal(run.status, 2, run.stderr);
  assert.match(run.stderr, /missing\.png: no such file or folder/);
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
  const dir = project({ images: [], files: { "package.json": '{"workspaces":["packages/*"]}', "packages/web/package.json": "{}" } });
  const nested = join(dir, "packages/web");
  copyFileSync(join(plugin, "example/src/assets/crystal-ball.png"), join(nested, "image.png"));
  // a workspace root, or its packages folder: a check that found nothing else isn't clean
  for (const args of [[], ["packages"]]) {
    const root = check(dir, ...args);
    assert.equal(root.status, 2, root.stderr);
    assert.match(root.stdout, /checked 0 images/);
    assert.match(root.stderr, /^pngdeer: skipped 1 nested package \(a folder with its own package\.json is checked only when named\); to check it, run: npx oxlint-plugin-pngdeer --check packages\/web$/m);
    assert.match(root.stdout, /^pngdeer: check incomplete: found no PNG or JPEG images outside the nested packages\.$/m);
  }
  const child = check(dir, "packages/web");
  assert.equal(child.status, 1, child.stderr);
  assert.doesNotMatch(child.stderr, /skipped/);
  assert.equal(existsSync(cacheDir(nested)), true);
  assert.equal(existsSync(cacheDir(dir)), false);
  // named as well as walked past: checked, so not called skipped
  const both = check(dir, ".", "packages/web");
  assert.equal(both.status, 1, both.stderr);
  assert.doesNotMatch(both.stderr, /skipped/);
});

test("check names skipped packages next to the root's own results, with the same options", () => {
  const dir = project({ images: ["src/assets/heart.png"], files: { "packages/web/package.json": "{}", "packages/docs/package.json": "{}" } });
  const run = check(dir, "--target", "70");
  assert.equal(run.status, 0, run.stderr);
  assert.match(run.stderr, /^pngdeer: skipped 2 nested packages .*; to check them, run: npx oxlint-plugin-pngdeer --check packages\/docs packages\/web --target 70$/m);
  assert.match(run.stdout, /no images exceed the savings thresholds/);
  // every option it was given: the committed cache folder above all, or CI would measure again
  const options = check(dir, "--exclude", "**/fixtures/**", "--cache-dir", ".pngdeer", "--min-saved-bytes", "8192", "--min-saved-percent", "30", "--target", "85");
  const command = "npx oxlint-plugin-pngdeer --check packages/docs packages/web --exclude '**/fixtures/**' --cache-dir .pngdeer --min-saved-bytes 8192 --min-saved-percent 30 --target 85";
  if (process.platform !== "win32") assert.ok(options.stderr.includes(`to check them, run: ${command}\n`), options.stderr);
  else assert.match(options.stderr, /to check them, run in PowerShell: & .* --check packages\/docs packages\/web --exclude '\*\*\/fixtures\/\*\*' --cache-dir \.pngdeer --min-saved-bytes 8192 --min-saved-percent 30 --target 85$/m);
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

test("check blames an unwritable cache folder, not the image", { skip: process.platform === "win32" }, (t) => {
  const dir = project({ images: ["src/assets/crystal-ball.png"] });
  const modules = join(dir, "node_modules");
  mkdirSync(modules);
  chmodSync(modules, 0o555);
  t.after(() => chmodSync(modules, 0o755));
  const run = check(dir, "src");
  assert.equal(run.status, 2, run.stderr);
  assert.match(run.stderr, /^pngdeer: measuring failed: EACCES: permission denied, mkdir '.*node_modules[\\/]\.cache[\\/]pngdeer'$/m);
  assert.match(run.stderr, /^src\/assets\/crystal-ball\.png: not measured \(see above\)$/m);
  assert.match(run.stdout, /check incomplete/);
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
  assert.match(dangling.stderr, /public\/dangling\.png: no such file or folder/);
});
