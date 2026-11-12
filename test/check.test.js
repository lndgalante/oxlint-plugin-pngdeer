import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, copyFileSync, existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";
import { cacheDir, key, write } from "../src/cache.js";
import { fill } from "../src/batch.js";
import { compress } from "../src/engine.js";
import { mark } from "../src/marker.js";
import { notes } from "../src/check.js";
import { reviewCommand, size, smaller } from "../src/text.js";
import { fade, grayWithProfile, names, oxlint, plugin, project } from "./helpers.js";

function check(cwd, ...args) {
  const run = spawnSync(process.execPath, [join(plugin, "bin/pngdeer.js"), "--check", ...args], { cwd, encoding: "utf8", timeout: 60_000 });
  assert.equal(run.error, undefined, run.error?.message);
  return run;
}

/** check() in a GitHub Actions step whose job summary goes to `summary`, in a checkout at `workspace`. */
function checkInActions(cwd, summary, workspace, ...args) {
  const env = { ...process.env, GITHUB_STEP_SUMMARY: summary, GITHUB_WORKSPACE: workspace };
  const run = spawnSync(process.execPath, [join(plugin, "bin/pngdeer.js"), "--check", ...args], { cwd, env, encoding: "utf8", timeout: 60_000 });
  assert.equal(run.error, undefined, run.error?.message);
  return run;
}

const ball = readFileSync(join(plugin, "example/src/assets/crystal-ball.png"));
let made = 0;

/**
 * A PNG at `path` in `dir`, different from every other one made here, already measured: `saved` bytes
 * smaller at quality `score` (its outcome `outcome`), in the cache of its project at `root`, so no
 * engine runs.
 */
function measured(dir, path, { saved, score = 90, outcome = "hit", target, root = dir }) {
  const bytes = Buffer.concat([ball, Buffer.alloc(++made)]);
  mkdirSync(dirname(join(dir, path)), { recursive: true });
  writeFileSync(join(dir, path), bytes);
  write(cacheDir(root), key(bytes, target), { original: bytes.length, compressed: bytes.length - saved, outcome, score });
  return bytes;
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
  // the page shows all 12, where the command takes the 10 biggest
  assert.match(run.stdout, /^pngdeer: to see all 12 before and after on one page first, run: npx oxlint-plugin-pngdeer --review public$/m);
  const biggest = Array.from({ length: 10 }, (_, i) => `public/img-${String(i).padStart(2, "0")}.png`).join(" ");
  assert.ok(run.stdout.includes(`pngdeer: to shrink the 10 biggest of 12 in place (lossy, so commit first), run: npx oxlint-plugin-pngdeer ${biggest}\n`), run.stdout);
  // the same next steps at a fixed target
  const fixed = check(dir, "public", "--target", "70").stdout;
  assert.match(fixed, /run: npx oxlint-plugin-pngdeer --review public --target 70$/m);
  assert.match(fixed, /run: npx oxlint-plugin-pngdeer( public\/img-\d\d\.png){10} --target 70$/m);
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

test("check warms the linter's cache for an image another package's code names", () => {
  // --check measures the root package's image into the root's folder; the app naming it lints from its own
  const dir = project({
    images: ["src/assets/crystal-ball.png"],
    files: { "apps/web/package.json": "{}", "apps/web/src/a.js": 'export const ball = new URL("../../../src/assets/crystal-ball.png", import.meta.url);\n' },
    options: { measure: "never" },
  });
  const configFile = join(dir, ".oxlintrc.json");
  writeFileSync(configFile, JSON.stringify({ ...JSON.parse(readFileSync(configFile, "utf8")), settings: { pngdeer: { cacheDir: ".pngdeer" } } }));
  assert.equal(check(dir, "--cache-dir", ".pngdeer").status, 1);
  assert.deepEqual(names(oxlint(dir, "apps")), ["crystal-ball.png"]);
  // copied into the app's folder, as measuring it there would have
  const bytes = readFileSync(join(dir, "src/assets/crystal-ball.png"));
  assert.equal(existsSync(join(dir, "apps/web/.pngdeer", `${key(bytes)}.json`)), true);
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
  // --exclude may be why there are none
  assert.match(run.stdout, /^pngdeer: found no PNG or JPEG images to check in src\/assets\/crystal-ball\.png and public, apart from what --exclude leaves out\.$/m);
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
    // counted once, as an error, not also as cached when the failure is read from the cache
    assert.match(run.stdout, /^pngdeer: checked 1 image; 0 measured, 0 cached, 0 skipped .*, 1 error\.$/m);
  }
});

test("check covers a monorepo's packages in one run, each with its own cache, on one count", () => {
  // a workspace root with no images of its own, as vite's
  const dir = project({ images: [], files: {
    "package.json": '{"workspaces":["packages/*"]}',
    "packages/a/package.json": "{}",
    "packages/b/package.json": "{}",
  } });
  copyFileSync(join(plugin, "example/src/assets/crystal-ball.png"), join(dir, "packages/a/ball.png"));
  mkdirSync(join(dir, "packages/b/public"));
  copyFileSync(join(plugin, "example/src/assets/crystal-ball.png"), join(dir, "packages/b/public/ball.png"));
  // a package's dependencies stay skipped
  mkdirSync(join(dir, "packages/a/node_modules/dep"), { recursive: true });
  copyFileSync(join(plugin, "example/src/assets/crystal-ball.png"), join(dir, "packages/a/node_modules/dep/ball.png"));
  const first = check(dir);
  assert.equal(first.status, 1, first.stderr);
  // one pool, one count: the same image in two packages is measured for each package's cache
  assert.deepEqual(first.stderr.match(/^pngdeer: measuring .*$/gm), ["pngdeer: measuring 2 images not in the cache yet..."]);
  assert.match(first.stdout, /^pngdeer: checked 2 images in 2 packages; 2 measured, 0 cached, 0 skipped /m);
  assert.match(first.stdout, /^packages\/a\/ball\.png: could be 68% smaller/m);
  assert.match(first.stdout, /^packages\/b\/public\/ball\.png: could be 68% smaller/m);
  assert.equal(existsSync(cacheDir(join(dir, "packages/a"))), true);
  assert.equal(existsSync(cacheDir(join(dir, "packages/b"))), true);
  assert.equal(existsSync(cacheDir(dir)), false);
  // the packages folder alone, too
  assert.match(check(dir, "packages").stdout, /^pngdeer: checked 2 images in 2 packages; 0 measured, 2 cached/m);
  // exclusions from the folder it runs in, or from each image's package, as the rule's option
  const fromRoot = check(dir, "--exclude", "packages/b");
  assert.match(fromRoot.stdout, /^pngdeer: checked 1 image; 0 measured, 1 cached/m);
  assert.doesNotMatch(fromRoot.stdout, /packages\/b/);
  const fromPackage = check(dir, "--exclude", "public");
  assert.match(fromPackage.stdout, /^pngdeer: checked 1 image; /m);
  assert.doesNotMatch(fromPackage.stdout, /packages\/b/);
  assert.equal(check(dir, "--exclude", "packages/*/ball.png", "--exclude", "packages/b/**").status, 0);
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

test("one image named in two letter cases is checked and counted once", (t) => {
  const dir = project({ images: [] });
  measured(dir, "public/logo.png", { saved: 30000 });
  if (!existsSync(join(dir, "public/LOGO.png"))) return t.skip("this file system tells letter case apart");
  // named twice, and named once beside the folder that holds it
  for (const args of [["public/logo.png", "public/LOGO.png"], ["public", "public/LOGO.png"]]) {
    const run = check(dir, ...args);
    assert.equal(run.status, 1, run.stderr);
    assert.match(run.stdout, /^pngdeer: checked 1 image; /m);
    assert.match(run.stdout, /^pngdeer: 1 image could be 30 kB smaller /m);
  }
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

// chmod keeps neither Windows nor root out
test("check reports unreadable subdirectories instead of a clean result", { skip: process.platform === "win32" || process.getuid?.() === 0 }, (t) => {
  const dir = project({ images: [], files: { "private/image.png": "unreadable" } });
  const locked = join(dir, "private");
  chmodSync(locked, 0o000);
  t.after(() => chmodSync(locked, 0o755));
  const run = check(dir);
  assert.equal(run.status, 2, run.stderr);
  assert.match(run.stderr, /private: permission denied/);
});

// chmod keeps neither Windows nor root out
test("check blames an unwritable cache folder, not the image", { skip: process.platform === "win32" || process.getuid?.() === 0 }, (t) => {
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

test("check says where it looked when it finds no images", () => {
  const dir = project({ images: [], files: { "public/readme.txt": "no images" } });
  const here = check(dir);
  assert.equal(here.status, 0, here.stderr);
  // the folder it runs in by its full path, which tells a wrong folder at once
  assert.ok(here.stdout.includes(`\npngdeer: found no PNG or JPEG images to check in ${realpathSync(dir)}.\n`), here.stdout);
  assert.match(check(dir, "public").stdout, /^pngdeer: found no PNG or JPEG images to check in public\.$/m);
  for (const name of ["a", "b", "c", "d"]) mkdirSync(join(dir, name));
  assert.match(check(dir, "a", "b").stdout, /^pngdeer: found no PNG or JPEG images to check in a and b\.$/m);
  assert.match(check(dir, "a", "b", "c", "d", "public").stdout, /^pngdeer: found no PNG or JPEG images to check in a, b, c and 2 more paths\.$/m);
});

test("files named like images that aren't are counted, with the check that leaves them out", () => {
  const dir = project({ images: [], files: {
    "fixtures/fake.png": "not an image",
    "fixtures/also-fake.jpg": "nor this",
    "public/hero.png": "version https://git-lfs.github.com/spec/v1\noid sha256:4d7a214614ab2935c943f9e0ff69d22eadbb8f32b1258daaa5e2ca24d17e2393\nsize 509372\n",
  } });
  measured(dir, "public/real.png", { saved: 20000 });
  const run = check(dir);
  assert.equal(run.status, 2, run.stderr);
  assert.match(run.stderr, /^fixtures\/fake\.png: not a PNG or JPEG$/m);
  assert.match(run.stderr, /^public\/hero\.png: a Git LFS pointer, not the image itself$/m);
  assert.match(run.stdout, /^pngdeer: checked 4 images; 0 measured, 1 cached, 0 skipped \(already optimized or below 4\.1 kB\), 3 errors\.$/m);
  assert.match(run.stdout, /^pngdeer: 1 image is a Git LFS pointer: git lfs pull fetches it \(in GitHub Actions, check out with lfs: true\)$/m);
  // the LFS pointer is fetched, not left out
  const command = "npx oxlint-plugin-pngdeer --check --exclude fixtures/also-fake.jpg --exclude fixtures/fake.png";
  assert.ok(run.stdout.includes(`\npngdeer: 2 files named like images aren't PNGs or JPEGs; if that's expected (test fixtures, say), to leave them out, run: ${command}\n`), run.stdout);
  // the image that is one still counts
  assert.match(run.stdout, /^public\/real\.png: could be/m);
  // with the check's own paths and options
  const one = check(dir, "fixtures", "--exclude", "fixtures/also-fake.jpg", "--min-saved-percent", "5");
  assert.match(one.stdout, /^pngdeer: 1 file named like an image isn't a PNG or JPEG; if that's expected \(a test fixture, say\), to leave it out, run: npx oxlint-plugin-pngdeer --check fixtures --exclude fixtures\/also-fake\.jpg --exclude fixtures\/fake\.png --min-saved-percent 5$/m);
  // the command it gives works
  const left = check(dir, "--exclude", "fixtures/also-fake.jpg", "--exclude", "fixtures/fake.png", "--exclude", "public/hero.png");
  assert.equal(left.status, 1, left.stderr);
  assert.match(left.stdout, /, 0 errors\.$/m);
  // a file named is meant: no advice to leave it out
  const named = check(dir, "fixtures/fake.png");
  assert.equal(named.status, 2, named.stderr);
  assert.doesNotMatch(named.stdout, /leave/);
  // another file pngdeer won't take is counted too, in other words
  writeFileSync(join(dir, "fixtures/gray.png"), grayWithProfile(100));
  assert.match(check(dir, "fixtures").stdout, /^pngdeer: 3 files pngdeer can't take \(see above\); to leave them out, run: npx oxlint-plugin-pngdeer --check fixtures --exclude fixtures\/also-fake\.jpg --exclude fixtures\/fake\.png --exclude fixtures\/gray\.png$/m);
});

test("check names a path it can't find before it measures", () => {
  const dir = project({ images: ["src/assets/crystal-ball.png"] });
  const run = check(dir, "missing.png", "src");
  assert.equal(run.status, 2, run.stderr);
  assert.match(run.stderr, /^missing\.png: no such file or folder\npngdeer: measuring 1 image not in the cache yet\.\.\.$/m);
});

test("check offers one page to see several images before and after, and a new file to see one", () => {
  const dir = project({ images: [] });
  measured(dir, "public/a.png", { saved: 30000, score: 90 });
  measured(dir, "public/b.png", { saved: 20000, score: 76 });
  measured(dir, "public/c.png", { saved: 10000, score: 79.4 });
  const run = check(dir);
  assert.equal(run.status, 1, run.stderr);
  // the folder it runs in is what --review checks by itself
  assert.match(run.stdout, /^pngdeer: to see all 3 before and after on one page first, run: npx oxlint-plugin-pngdeer --review$/m);
  // before the command that writes in place, and instead of a file for one of them
  assert.ok(run.stdout.indexOf("to see") < run.stdout.indexOf("to shrink"), run.stdout);
  assert.doesNotMatch(run.stdout, / -o /);
  // two, with the paths and options of the check, so the page shows what it listed
  const both = check(dir, "public/a.png", "public/c.png", "--min-saved-percent", "5", "--exclude", "public/b.png");
  assert.match(both.stdout, /^pngdeer: to see both before and after on one page first, run: npx oxlint-plugin-pngdeer --review public\/a\.png public\/c\.png --exclude public\/b\.png --min-saved-percent 5$/m);
  // one: a new file, which the page would only frame
  const one = check(dir, "public/b.png");
  assert.match(one.stdout, /^pngdeer: to preview it as a new file, run: npx oxlint-plugin-pngdeer public\/b\.png -o b\.preview\.png$/m);
  assert.doesNotMatch(one.stdout, /--review/);
  // --json says none of it
  assert.doesNotMatch(check(dir, "--json").stdout, /--review/);
});

test("check says how many images the quality floor turned down, with the command that tries them lower", () => {
  const dir = project({ images: [] });
  measured(dir, "public/logo.png", { saved: 20000, score: 88 });
  // the automatic target's best looked visibly different, and nothing reached 70 (engine.js)
  const header = measured(dir, "public/header.png", { saved: 20000, score: 64.2, outcome: "miss" });
  const run = check(dir, "--cache-dir", ".pngdeer", "--min-saved-percent", "5");
  assert.equal(run.status, 1, run.stderr);
  assert.doesNotMatch(run.stdout, /^public\/header\.png/m);
  const command = "npx oxlint-plugin-pngdeer --check public/header.png --cache-dir .pngdeer --min-saved-percent 5 --target 60";
  assert.ok(run.stdout.includes(`\npngdeer: 1 image can't be made smaller without a visible difference (its best quality is below 70), so it isn't listed; to try it at a lower target, run: ${command}\n`), run.stdout);
  // at that target it may be listed: here it is
  write(join(dir, ".pngdeer"), key(header, 60), { original: header.length, compressed: header.length - 25000, outcome: "hit", score: 61 });
  const lower = check(dir, "public/header.png", "--cache-dir", ".pngdeer", "--min-saved-percent", "5", "--target", "60");
  assert.equal(lower.status, 1, lower.stderr);
  assert.match(lower.stdout, /^public\/header\.png: could be \d+% smaller \(.*, quality 61\/100: looks visibly different\)$/m);
  // a target given is never turned down
  assert.doesNotMatch(lower.stdout, /visible difference \(/);
  // the plural, with the same target whatever their best: the engine searches anew at each target
  const banner = measured(dir, "public/banner.png", { saved: 20000, score: 57.8, outcome: "miss" });
  assert.match(check(dir).stdout, /^pngdeer: 2 images can't be made smaller without a visible difference \(their best quality is below 70\), so they aren't listed; to try them at a lower target, run: npx oxlint-plugin-pngdeer --check public\/\w+\.png public\/\w+\.png --target 60$/m);
  // one it still can't make reach the target given is named, not left out without a word, its best
  // rounded down: 59.6 shown as 60 would reach the target it missed
  write(cacheDir(dir), key(banner, 60), { original: banner.length, compressed: banner.length - 30000, outcome: "miss", score: 59.6 });
  const missed = check(dir, "public/banner.png", "--target", "60");
  assert.equal(missed.status, 0, missed.stderr);
  assert.match(missed.stdout, /^pngdeer: public\/banner\.png isn't listed: no smaller file reaches --target 60 \(the best reaches quality 59\/100\)$/m);
  assert.deepEqual(JSON.parse(check(dir, "public/banner.png", "--target", "60", "--json").stdout).missed, [{ file: "public/banner.png", original: banner.length, quality: 59 }]);
  const summary = join(dir, "summary.md");
  assert.equal(checkInActions(dir, summary, dir, "public/banner.png", "--target", "60").status, 0);
  assert.match(readFileSync(summary, "utf8"), /^`public\/banner\.png` isn't listed: no smaller file reaches --target 60 \(the best reaches quality 59\/100\)\.$/m);
  // several
  write(cacheDir(dir), key(header, 90), { original: header.length, compressed: header.length - 30000, outcome: "miss", score: 89.6 });
  write(cacheDir(dir), key(banner, 90), { original: banner.length, compressed: banner.length - 30000, outcome: "miss", score: 85.2 });
  assert.match(check(dir, "public/header.png", "public/banner.png", "--target", "90").stdout, /^pngdeer: 2 images aren't listed: no smaller file reaches --target 90 \(the best of them reaches quality 89\/100\)$/m);
});

test("an image the floor turned down is named only if it would otherwise be listed", () => {
  const dir = project({ images: [] });
  // its best looked visibly different, and would save too little to list anyway
  measured(dir, "public/small.png", { saved: 2000, score: 64, outcome: "miss" });
  const run = check(dir);
  assert.equal(run.status, 0, run.stderr);
  assert.doesNotMatch(run.stdout, /visible difference|isn't listed/);
  assert.match(run.stdout, /^pngdeer: no images exceed the savings thresholds\. Images unchanged\.$/m);
  assert.deepEqual(JSON.parse(check(dir, "--json").stdout).declined, []);
  // with thresholds it clears, the floor is what keeps it off the list
  const lower = check(dir, "--min-saved-bytes", "1000", "--min-saved-percent", "5");
  assert.match(lower.stdout, /^pngdeer: 1 image can't be made smaller without a visible difference \(its best quality is below 70\), so it isn't listed; /m);
});

test("--json prints one JSON document on stdout, biggest saving first, with the same exit codes", () => {
  const dir = project({ images: [], files: { "bad.png": "not an image", "package.json": "{}", "packages/web/package.json": "{}" } });
  const a = measured(dir, "public/a.png", { saved: 10000, score: 76.4 });
  const b = measured(dir, "packages/web/b.png", { saved: 30000, score: 91, root: join(dir, "packages/web") });
  const c = measured(dir, "public/c.png", { saved: 20000, outcome: "lossless", score: 100 });
  measured(dir, "public/d.png", { saved: 100, score: 70 });
  const e = measured(dir, "public/e.png", { saved: 20000, outcome: "miss", score: 63.6 });
  const run = check(dir, "--json");
  assert.equal(run.status, 2, run.stderr);
  // errors stay on stderr, as the lines they'd be among
  assert.match(run.stderr, /^bad\.png: not a PNG or JPEG$/m);
  assert.equal(run.stdout.split("\n").length, 2, run.stdout);
  const report = JSON.parse(run.stdout);
  const { version } = JSON.parse(readFileSync(join(plugin, "package.json"), "utf8"));
  assert.deepEqual(report, {
    version,
    options: { target: "auto", minSavedBytes: 4096, minSavedPercent: 10, exclude: [], cacheDir: null },
    counts: { checked: 6, measured: 0, cached: 5, skipped: 0, packages: 2, errors: 1 },
    totals: { images: 3, original: a.length + b.length + c.length, compressed: a.length + b.length + c.length - 60000, saved: 60000, percent: 56 },
    images: [
      { file: "packages/web/b.png", package: "packages/web", original: b.length, compressed: b.length - 30000, saved: 30000, percent: 85, outcome: "hit", quality: 91, looks: "identical" },
      { file: "public/c.png", package: ".", original: c.length, compressed: c.length - 20000, saved: 20000, percent: 56, outcome: "lossless", quality: null, looks: "identical" },
      { file: "public/a.png", package: ".", original: a.length, compressed: a.length - 10000, saved: 10000, percent: 28, outcome: "hit", quality: 76, looks: "close, with differences you might spot side by side" },
    ],
    declined: [{ file: "public/e.png", original: e.length, quality: 63 }],
    missed: [],
    errors: [{ file: "bad.png", message: "not a PNG or JPEG" }],
    builds: [],
  });
  // too small to save that much: nothing measured, nothing listed
  const clean = check(dir, "public/d.png", "--json", "--target=70", "--min-saved-bytes", "100000");
  assert.equal(clean.status, 0, clean.stderr);
  assert.deepEqual(JSON.parse(clean.stdout).options, { target: 70, minSavedBytes: 100000, minSavedPercent: 10, exclude: [], cacheDir: null });
  assert.deepEqual(JSON.parse(clean.stdout).images, []);
  assert.equal(check(dir, "public/a.png", "--json").status, 1);
});

test("measureAll prints nothing on stdout and resolves what --check found", () => {
  const dir = project({ images: [], files: { "bad.png": "not an image" } });
  const a = measured(dir, "public/a.png", { saved: 10000, score: 76.4 });
  measured(dir, "public/e.png", { saved: 20000, outcome: "miss", score: 63.6 });
  const out = join(dir, "result.json");
  // onError hears each error as it's found
  const script = `import { writeFileSync } from "node:fs";
import { measureAll } from ${JSON.stringify(pathToFileURL(join(plugin, "src/check.js")).href)};
const heard = [];
const result = await measureAll(["."], { onError: (error) => heard.push(error) });
writeFileSync(${JSON.stringify(out)}, JSON.stringify({ ...result, heard }));`;
  const run = spawnSync(process.execPath, ["--input-type=module", "-e", script], { cwd: dir, encoding: "utf8", timeout: 60_000 });
  assert.equal(run.status, 0, run.stderr);
  assert.equal(run.stdout, "");
  assert.equal(run.stderr, "");
  const result = JSON.parse(readFileSync(out, "utf8"));
  const here = realpathSync(dir);
  assert.deepEqual(result.rows, [{ file: join(here, "public/a.png"), path: "public/a.png", root: here, original: a.length, compressed: a.length - 10000, outcome: "hit", score: 76.4 }]);
  assert.deepEqual(result.declined.map(({ path, score }) => [path, score]), [["public/e.png", 63.6]]);
  assert.deepEqual(result.missed, []);
  assert.deepEqual(result.errors, [{ file: join(here, "bad.png"), path: "bad.png", message: "not a PNG or JPEG" }]);
  assert.deepEqual(result.heard, result.errors);
  assert.deepEqual(result.counts, { checked: 3, measured: 0, cached: 2, skipped: 0, packages: 1 });
});

test("in a Gatsby project, check leaves out the build output in public/ unless it's named", () => {
  const dir = project({ images: [], files: { "package.json": '{"dependencies":{"gatsby":"^5.14.0"}}' } });
  measured(dir, "static/logo.png", { saved: 20000 });
  measured(dir, "public/logo.png", { saved: 20000 });
  measured(dir, "public/static/abc/photo.png", { saved: 20000 });
  const run = check(dir);
  assert.equal(run.status, 1, run.stderr);
  assert.match(run.stdout, /^pngdeer: checked 1 image; /m);
  assert.match(run.stdout, /^pngdeer: left out 2 images in public, Gatsby's build output; to check them too, run: npx oxlint-plugin-pngdeer --check public$/m);
  assert.match(check(dir, "public").stdout, /^pngdeer: checked 2 images; /m);
  assert.match(check(dir, "public/static").stdout, /^pngdeer: checked 1 image; /m);
  const named = check(dir, ".", "public/logo.png");
  assert.match(named.stdout, /^pngdeer: checked 2 images; /m);
  assert.match(named.stdout, /^pngdeer: left out 1 image in public, Gatsby's build output; to check it too, run: npx oxlint-plugin-pngdeer --check public$/m);
  // a review's page shows one run's images, so its command takes the review's paths as well, which
  // reach every image
  const found = { rows: [], declined: [], missed: [], errors: [], counts: { checked: 1, measured: 0, cached: 1, skipped: 0, packages: 1 }, builds: [{ path: "public", images: 2 }] };
  assert.deepEqual(notes(["."], found, { cwd: dir }, reviewCommand), ["pngdeer: left out 2 images in public, Gatsby's build output; to review them too, run: npx oxlint-plugin-pngdeer --review . public"]);
  const both = check(dir, ".", "public");
  assert.match(both.stdout, /^pngdeer: checked 3 images; /m);
  assert.doesNotMatch(both.stdout, /left out/);
  // a script hears of them too
  assert.deepEqual(JSON.parse(check(dir, "--json").stdout).builds, [{ folder: "public", images: 2 }]);
  // with nothing else, it doesn't say it found no images just after saying it left some out
  const none = check(dir, "--exclude", "static");
  assert.equal(none.status, 0, none.stderr);
  assert.ok(none.stdout.endsWith(`\npngdeer: found no other PNG or JPEG images to check in ${realpathSync(dir)}, apart from what --exclude leaves out.\n`), none.stdout);
  // elsewhere public/ is what the site serves
  writeFileSync(join(dir, "package.json"), '{"dependencies":{"next":"^16.0.0"}}');
  assert.match(check(dir).stdout, /^pngdeer: checked 3 images; /m);
});

test("--exclude holds for a named image or a walked one through a link, as in the rule", (t) => {
  const dir = project({ images: [] });
  measured(dir, "design/mark.png", { saved: 20000 });
  mkdirSync(join(dir, "public"));
  try {
    symlinkSync(join(dir, "design/mark.png"), join(dir, "public/mark.png"));
  } catch (error) {
    if (process.platform === "win32" && error.code === "EPERM") return t.skip("symlinks require Windows Developer Mode");
    throw error;
  }
  assert.match(check(dir, "public/mark.png").stdout, /^pngdeer: checked 1 image; /m);
  for (const args of [["public/mark.png"], ["public"], []]) {
    const run = check(dir, ...args, "--exclude", "design");
    assert.equal(run.status, 0, run.stderr);
    assert.match(run.stdout, /^pngdeer: checked 0 images; /m);
  }
});

test("in GitHub Actions, check writes a job summary, never with --json, and a failed write keeps its exit code", () => {
  // __tests__ as prose in Markdown would read as a bold "tests"
  const dir = project({ images: [], files: { "package.json": "{}", "packages/web/package.json": "{}", "packages/web/__tests__/bad.png": "not an image" } });
  const web = join(dir, "packages/web");
  const summary = join(dir, "summary.md");
  measured(web, "public/hero.png", { saved: 30000, score: 87, root: web });
  measured(web, "public/photo.jpg", { saved: 20000, score: 76, root: web });
  measured(web, "public/flat.png", { saved: 20000, outcome: "miss", score: 64, root: web });
  const run = checkInActions(web, summary, dir);
  assert.equal(run.status, 2, run.stderr);
  const hero = readFileSync(join(web, "public/hero.png")).length;
  const photo = readFileSync(join(web, "public/photo.jpg")).length;
  assert.equal(readFileSync(summary, "utf8"), `
### pngdeer --check in \`packages/web\`

Checked 4 images; 0 measured, 3 cached, 0 skipped (already optimized or below 4.1 kB), 1 error.

2 images could be 50 kB smaller (${size(hero + photo)} → ${size(hero + photo - 50000)}, ${smaller(hero + photo, hero + photo - 50000)}% smaller):

| Image | Now | After | Saves | Quality |
| --- | ---: | ---: | ---: | ---: |
| \`public/hero.png\` | 35 kB | 5.5 kB | 30 kB | 87 |
| \`public/photo.jpg\` | 35 kB | 15 kB | 20 kB | 76 |

Quality is SSIMULACRA2, out of 100: 90+ looks identical, 80+ the same side by side, 70+ close, with differences you might spot side by side, below 70 visibly different.

1 image can't be made smaller without a visible difference (its best quality is below 70), so it isn't listed; to try it at a lower target, run in \`packages/web\`:

\`\`\`
npx oxlint-plugin-pngdeer --check public/flat.png --target 60
\`\`\`

The check is incomplete: 1 image or folder couldn't be checked:

- \`__tests__/bad.png\`: not a PNG or JPEG

1 file named like an image isn't a PNG or JPEG; if that's expected (a test fixture, say), to leave it out, run in \`packages/web\`:

\`\`\`
npx oxlint-plugin-pngdeer --check --exclude __tests__/bad.png
\`\`\`

To see both before and after on one page first, run in \`packages/web\`:

\`\`\`
npx oxlint-plugin-pngdeer --review
\`\`\`

To shrink them in place (lossy, so commit first), run in \`packages/web\`:

\`\`\`
npx oxlint-plugin-pngdeer public/hero.png public/photo.jpg
\`\`\`
`);
  // the lines on stdout are the same as without a job summary
  assert.equal(run.stdout, check(web).stdout);
  // checked at the checkout's root, no folder is named, before the commands either
  const root = join(dir, "root.md");
  assert.equal(checkInActions(web, root, web).status, 2);
  assert.match(readFileSync(root, "utf8"), /^### pngdeer --check\n[\s\S]*^To shrink them in place \(lossy, so commit first\), run:$/m);
  // --json is for a script, which writes its own
  const json = join(dir, "json.md");
  assert.equal(checkInActions(web, json, dir, "--json").status, 2);
  assert.equal(existsSync(json), false);
  // nothing to say, nothing written
  const clean = join(dir, "clean.md");
  assert.equal(checkInActions(web, clean, dir, "public/hero.png", "--min-saved-percent", "99").status, 0);
  assert.equal(existsSync(clean), false);
  // a summary it can't write (a folder) changes nothing else
  const folder = checkInActions(web, dir, dir, "public");
  assert.equal(folder.status, 1, folder.stderr);
  assert.equal(folder.stdout, check(web, "public").stdout);
});

// Windows allows no * or < in a file name
test("in a job summary, an error that quotes a file name can't make a link or emphasis there", { skip: process.platform === "win32" }, () => {
  const dir = project({ images: [] });
  const name = "**urgent** [re-run with a token](https:example.com) <img src=x> ~~old~~.png";
  mkdirSync(join(dir, "public"));
  // a link to itself: stat fails with ELOOP, whose message quotes the whole path
  symlinkSync(name, join(dir, "public", name));
  const summary = join(dir, "summary.md");
  const run = checkInActions(dir, summary, dir);
  assert.equal(run.status, 2, run.stderr);
  const line = readFileSync(summary, "utf8").split("\n").find((text) => text.startsWith("- `public/"));
  const message = line.slice(line.indexOf("`: ") + 3);
  assert.match(message, /^ELOOP: /);
  // the name in it as text: each of Markdown's marks escaped
  assert.doesNotMatch(message, /(?<!\\)[*[\]()<>~]/);
});

test("on a Windows runner, the job summary's commands are npx, quoted for a POSIX shell, as the lint's are", () => {
  const dir = project({ images: [], files: { "public/not an image.png": "not an image" } });
  measured(dir, "public/my logo.png", { saved: 30000, score: 87 });
  measured(dir, "public/my photo.png", { saved: 20000, score: 76 });
  measured(dir, "public/my flat.png", { saved: 20000, outcome: "miss", score: 64 });
  // on Windows these names take PowerShell's form, which names this machine's node and pngdeer.js
  const windows = join(dir, "windows.mjs");
  writeFileSync(windows, 'Object.defineProperty(process, "platform", { value: "win32" });\n');
  const asOnWindows = (summary, ...args) => {
    const env = { ...process.env, GITHUB_STEP_SUMMARY: summary, GITHUB_WORKSPACE: dir };
    return spawnSync(process.execPath, ["--import", pathToFileURL(windows).href, join(plugin, "bin/pngdeer.js"), "--check", ...args], { cwd: dir, env, encoding: "utf8", timeout: 60_000 });
  };
  const summary = join(dir, "summary.md");
  const run = asOnWindows(summary);
  assert.equal(run.status, 2, run.stderr);
  // the step's log is read on the runner
  assert.match(run.stdout, /^pngdeer: to shrink them in place \(lossy, so commit first\), run in PowerShell: & /m);
  // one image: the preview's -o name too
  const one = join(dir, "one.md");
  assert.equal(asOnWindows(one, "public/my logo.png").status, 1);
  const markdown = readFileSync(summary, "utf8") + readFileSync(one, "utf8");
  assert.doesNotMatch(markdown, /PowerShell|pngdeer\.js/);
  for (const command of [
    "npx oxlint-plugin-pngdeer --check 'public/my flat.png' --target 60",
    "npx oxlint-plugin-pngdeer --check --exclude 'public/not an image.png'",
    "npx oxlint-plugin-pngdeer 'public/my logo.png' 'public/my photo.png'",
    "npx oxlint-plugin-pngdeer 'public/my logo.png' -o 'my logo.preview.png'",
  ]) {
    assert.ok(markdown.includes(`run:\n\n\`\`\`\n${command}\n\`\`\``), markdown);
  }
  // a folder given, which the page's command takes, and a Gatsby site's build output, which its note does
  const site = join(dir, "my site");
  mkdirSync(site);
  writeFileSync(join(site, "package.json"), '{"dependencies":{"gatsby":"^5.14.0"}}');
  for (const path of ["static/a.png", "static/b.png", "public/c.png"]) measured(dir, `my site/${path}`, { saved: 20000, root: site });
  const gatsby = join(dir, "gatsby.md");
  assert.equal(asOnWindows(gatsby, "my site").status, 1);
  const more = readFileSync(gatsby, "utf8");
  assert.doesNotMatch(more, /PowerShell|pngdeer\.js/);
  for (const command of ["npx oxlint-plugin-pngdeer --check 'my site/public'", "npx oxlint-plugin-pngdeer --review 'my site'"]) {
    assert.ok(more.includes(`run:\n\n\`\`\`\n${command}\n\`\`\``), more);
  }
});

// chmod keeps neither Windows nor root out
test("a package whose cache can't be written fails alone; the others are still measured", { skip: process.platform === "win32" || process.getuid?.() === 0 }, (t) => {
  const dir = project({ images: [], files: { "package.json": "{}", "packages/a/package.json": "{}", "packages/b/package.json": "{}" } });
  for (const name of ["a", "b"]) copyFileSync(join(plugin, "example/src/assets/crystal-ball.png"), join(dir, "packages", name, "ball.png"));
  const modules = join(dir, "packages/a/node_modules");
  mkdirSync(modules);
  chmodSync(modules, 0o555);
  t.after(() => chmodSync(modules, 0o755));
  const run = check(dir);
  assert.equal(run.status, 2, run.stderr);
  assert.deepEqual(run.stderr.match(/^pngdeer: measuring failed: .*$/gm).length, 1);
  assert.match(run.stderr, /^pngdeer: measuring failed: EACCES: permission denied, mkdir '.*packages[\\/]a[\\/]node_modules[\\/]\.cache[\\/]pngdeer'$/m);
  assert.match(run.stderr, /^packages\/a\/ball\.png: not measured \(see above\)$/m);
  assert.match(run.stdout, /^packages\/b\/ball\.png: could be 68% smaller/m);
  assert.match(run.stdout, /^pngdeer: checked 2 images in 2 packages; 1 measured, 0 cached, 0 skipped \(already optimized or below 4\.1 kB\), 1 error\.$/m);
  // where nothing is above, the message says why in full
  const { errors } = JSON.parse(check(dir, "--json").stdout);
  assert.equal(errors.length, 1);
  assert.equal(errors[0].file, "packages/a/ball.png");
  assert.match(errors[0].message, /^not measured: EACCES: permission denied, mkdir '.*packages[\\/]a[\\/]node_modules[\\/]\.cache[\\/]pngdeer'$/);
});
