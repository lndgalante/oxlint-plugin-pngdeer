// measureAll() with a format (check.js), which --check --format and --review --format print: which
// list each image lands in, and what each holds. The copies' sizes and scores are the engine's of the
// day (test/engine-output.test.js pins those); what's pinned here is where each image goes and why.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";
import { cacheDir, convertKey, key, read } from "../src/cache.js";
import { compress, convert } from "../src/engine.js";
import { mark } from "../src/marker.js";
import { chunk, gradient, plugin, project, turn } from "./helpers.js";

const MARKED = "already shrunk by this command, so converting it would be a second lossy pass; convert the original from before it was shrunk";

/** measureAll(inputs, options) run in `dir` in a process of its own, as the command runs it: its result, as JSON keeps it, and its stderr. */
function measure(dir, options = {}, inputs = ["."]) {
  const out = join(dir, "result.json");
  const script = `import { writeFileSync } from "node:fs";
import { measureAll } from ${JSON.stringify(pathToFileURL(join(plugin, "src/check.js")).href)};
writeFileSync(${JSON.stringify(out)}, JSON.stringify(await measureAll(${JSON.stringify(inputs)}, ${JSON.stringify(options)})));`;
  const run = spawnSync(process.execPath, ["--input-type=module", "-e", script], { cwd: dir, encoding: "utf8", timeout: 300_000 });
  assert.equal(run.status, 0, run.stderr);
  assert.equal(run.stdout, "");
  return { result: JSON.parse(readFileSync(out, "utf8")), stderr: run.stderr };
}

/** The cache entries in `folder`, by file name; none if there is no such folder. */
function entries(folder) {
  if (!existsSync(folder)) return {};
  return Object.fromEntries(readdirSync(folder).filter((name) => name.endsWith(".json")).sort().map((name) => [name, read(folder, name.slice(0, -".json".length))]));
}

test("as WebP, the example's copies that beat their own shrink by both thresholds are listed, the rest aren't", () => {
  const dir = project();
  const here = realpathSync(dir);
  const committed = join(dir, ".slimdeer");
  const local = cacheDir(dir);
  // without a format, the images as --check measures them, into a committed cache folder
  const plain = measure(dir, { cacheDir: ".slimdeer" });
  // matched by line: on a slow machine, a count follows every 30 s
  assert.match(plain.stderr, /^slimdeer: measuring 5 images not in the cache yet\.\.\.$/m);
  assert.deepEqual(Object.keys(plain.result), ["rows", "declined", "missed", "errors", "counts", "builds"]);
  assert.deepEqual(Object.keys(plain.result.rows[0]), ["file", "path", "root", "original", "compressed", "outcome", "score"]);
  const lint = entries(committed);
  assert.deepEqual(entries(local), {});

  const previewDir = join(dir, "previews");
  mkdirSync(previewDir);
  const options = { cacheDir: ".slimdeer", format: "webp", previewDir };
  const { result, stderr } = measure(dir, options);
  // the images' own results are cached: only their copies go to the engine
  assert.match(stderr, /^slimdeer: measuring 5 images as WebP at the same quality\.\.\.$/m);
  assert.doesNotMatch(stderr, /not in the cache/);
  assert.deepEqual(Object.keys(result), ["format", "rows", "notWorthIt", "leftOut", "missed", "declined", "errors", "counts", "builds"]);
  assert.equal(result.format, "webp");
  // the smallest saving beyond the shrink first
  assert.deepEqual(result.rows.map(({ path }) => path), ["src/assets/crystal-ball.png", "src/assets/diagram.png", "public/hero.png"]);
  assert.deepEqual(result.notWorthIt.map(({ path }) => path), ["public/photo.jpg", "public/unused-fire.png"]);
  assert.deepEqual([result.leftOut, result.missed, result.declined, result.errors, result.builds], [[], [], [], [], []]);
  // the images' own measurements, as without a format; heart.png is too small to save 4 kB
  assert.deepEqual(result.counts, { checked: 6, measured: 0, cached: 5, skipped: 1, packages: 1 });

  const previews = [];
  for (const copy of [...result.rows, ...result.notWorthIt]) {
    const bytes = readFileSync(join(dir, copy.path));
    const own = read(committed, key(bytes));
    assert.equal(copy.file, join(here, copy.path));
    assert.equal(copy.root, here);
    assert.equal(copy.type, copy.path.endsWith(".jpg") ? "jpeg" : "png");
    assert.equal(copy.original, bytes.length);
    assert.deepEqual(copy.sameFormat, { compressed: own.compressed, outcome: own.outcome, score: own.score });
    // each shrink here is a smaller file at the automatic target: the copy aims at its quality and has to beat its size
    assert.equal(own.outcome, "hit");
    assert.equal(copy.base, own.compressed);
    const k = convertKey(bytes, own.score, "webp");
    const entry = read(local, k);
    assert.deepEqual(entry, { format: "webp", original: bytes.length, compressed: copy.compressed, outcome: "hit", score: copy.score, target: entry.target });
    assert.ok(copy.score >= own.score, copy.path);
    // written as it was measured, to a file named by the copy's cache key
    previews.push(`${k}.webp`);
    assert.equal(readFileSync(join(previewDir, `${k}.webp`)).length, copy.compressed);
  }
  for (const row of result.rows) {
    assert.deepEqual(Object.keys(row), ["file", "path", "root", "type", "equal", "original", "compressed", "score", "sameFormat", "base", "output", "outputExists", "preview"]);
    const saved = row.base - row.compressed;
    assert.ok(saved >= 4096 && saved >= row.base / 10, row.path);
    assert.equal(row.equal, row.sameFormat.score);
    assert.equal(row.output, join(here, row.path.replace(/\.png$/, ".webp")));
    assert.equal(row.outputExists, false);
    assert.equal(row.preview, join(previewDir, `${convertKey(readFileSync(row.file), row.equal, "webp")}.webp`));
  }
  for (const copy of result.notWorthIt) {
    assert.deepEqual(Object.keys(copy), ["file", "path", "root", "type", "original", "compressed", "score", "sameFormat", "base"]);
    const saved = copy.base - copy.compressed;
    assert.ok(saved < 4096 || saved < copy.base / 10, copy.path);
  }
  assert.deepEqual(readdirSync(previewDir).sort(), previews.sort());
  // a preview is the copy the engine writes, byte for byte
  const [ball] = result.rows;
  const copy = convert(readFileSync(ball.file), "webp", ball.equal);
  assert.ok(readFileSync(ball.preview).equals(copy.output));
  // its cache entry keeps the target as the engine reports it, rounded, and is found by the one asked for
  assert.equal(read(local, convertKey(readFileSync(ball.file), ball.equal, "webp")).target, copy.target);
  assert.notEqual(copy.target, ball.equal);
  // the copies' results are in the local cache folder alone; the committed one holds the lint's, unchanged
  assert.deepEqual(Object.values(entries(local)).map(({ format }) => format), Array(5).fill("webp"));
  assert.deepEqual(entries(committed), lint);

  // a second run measures nothing, and finds the same
  const again = measure(dir, options);
  assert.equal(again.stderr, "");
  assert.deepEqual(again.result, result);

  // a file already where the copy would go is noted
  writeFileSync(join(dir, "public/hero.webp"), "someone's file");
  assert.equal(measure(dir, options).result.rows.find(({ path }) => path === "public/hero.png").outputExists, true);

  // the command's own output is left out, unless too small to list anyway
  writeFileSync(join(dir, "public/shrunk.png"), mark(readFileSync(join(dir, "src/assets/crystal-ball.png"))));
  writeFileSync(join(dir, "public/tiny.png"), mark(readFileSync(join(dir, "src/assets/heart.png"))));
  // and slimdeer's output without the mark (a preview saved over an image), which the lint takes as done
  writeFileSync(join(dir, "public/done.png"), compress(readFileSync(join(dir, "src/assets/crystal-ball.png"))).output);
  const marked = measure(dir, options);
  assert.deepEqual(marked.result.leftOut, [{ file: join(here, "public/shrunk.png"), path: "public/shrunk.png", kind: "marked", reason: MARKED }]);
  assert.deepEqual([marked.result.rows.map(({ path }) => path), marked.result.notWorthIt, marked.result.missed], [result.rows.map(({ path }) => path), result.notWorthIt, []]);
  assert.deepEqual(marked.result.counts, { checked: 9, measured: 0, cached: 6, skipped: 3, packages: 1 });
  assert.doesNotMatch(marked.stderr, /as WebP/);

  // with no thresholds, every copy smaller than its shrink is listed, photo.jpg's too, and only heart.png is measured
  const all = measure(dir, { ...options, minSavedBytes: 0, minSavedPercent: 0 });
  assert.match(all.stderr, /^slimdeer: measuring 1 image not in the cache yet\.\.\.\nslimdeer: measuring 1 image as WebP at the same quality\.\.\.$/m);
  assert.deepEqual(all.result.rows.map(({ path }) => path).sort(), ["public/hero.png", "public/photo.jpg", "public/unused-fire.png", "src/assets/crystal-ball.png", "src/assets/diagram.png", "src/assets/heart.png"]);
  assert.deepEqual(all.result.notWorthIt, []);
  assert.deepEqual(all.result.leftOut.map(({ path, kind }) => [path, kind]), [["public/shrunk.png", "marked"], ["public/tiny.png", "marked"]]);
});

test("as AVIF, a project that can't show it, or a Next.js metadata image, is left out; another image is measured", () => {
  const dir = project({ images: [], files: {
    "g.png": gradient(16),
    "packages/native/package.json": JSON.stringify({ dependencies: { "react-native": "0.82.0" } }),
    "packages/native/icon.png": gradient(16),
    "packages/site/package.json": JSON.stringify({ dependencies: { next: "16.0.0" } }),
    "packages/site/app/opengraph-image.png": gradient(16),
  } });
  const here = realpathSync(dir);
  const { result, stderr } = measure(dir, { format: "avif", minSavedBytes: 0, minSavedPercent: 0 });
  // said before AVIF's slow work, for the one image that goes to it
  assert.match(stderr, /^slimdeer: measuring 1 image as AVIF at the same quality; AVIF is slow: about half a minute per image on a 16-core laptop\.\.\.$/m);
  assert.deepEqual(result.leftOut, [
    { file: join(here, "packages/native/icon.png"), path: "packages/native/icon.png", kind: "react-native", reason: "React Native's Image doesn't list AVIF among the formats it shows" },
    { file: join(here, "packages/site/app/opengraph-image.png"), path: "packages/site/app/opengraph-image.png", kind: "next", reason: "Next.js serves app/ metadata images by their file name, and doesn't take WebP or AVIF there" },
  ]);
  // shrunk as PNG it keeps every pixel, so its copy aims at 100, which this AVIF doesn't reach
  const bytes = gradient(16);
  const [miss] = result.missed;
  assert.deepEqual(result.missed, [{ file: join(here, "g.png"), path: "g.png", type: "png", original: bytes.length, score: miss.score, equal: 100 }]);
  assert.ok(miss.score < 100);
  assert.deepEqual([result.rows, result.notWorthIt, result.declined, result.errors], [[], [], [], []]);
  assert.equal(read(cacheDir(dir), convertKey(bytes, 100, "avif")).score, miss.score);
  // the packages left out have their own results, and no copy's
  for (const name of ["native", "site"]) {
    const found = Object.values(entries(cacheDir(join(dir, "packages", name))));
    assert.ok(found.length > 0 && found.every((entry) => entry.format === undefined), name);
  }
});

test("as WebP, a copy that can't reach the target given is named with its best; the floor still declines", () => {
  const bytes = gradient(32);
  const dir = project({ images: [], files: {
    "g.png": bytes,
    // turned a quarter by an eXIf Orientation of 6, which the copy would lose
    "turned.png": turn(bytes, 6),
    // a PQ color space, which WebP can't carry
    "hdr.png": Buffer.concat([bytes.subarray(0, 33), chunk("cICP", Buffer.from([9, 16, 0, 1])), bytes.subarray(33)]),
  } });
  const here = realpathSync(dir);
  const options = { format: "webp", minSavedBytes: 0, minSavedPercent: 0 };
  const missed = measure(dir, { ...options, target: 80 }, ["g.png"]);
  assert.match(missed.stderr, /^slimdeer: measuring 1 image as WebP at the same quality\.\.\.$/m);
  const [miss] = missed.result.missed;
  assert.deepEqual(missed.result.missed, [{ file: join(here, "g.png"), path: "g.png", type: "png", original: bytes.length, score: miss.score, equal: 80 }]);
  assert.ok(miss.score < 80);
  assert.deepEqual([missed.result.rows, missed.result.notWorthIt], [[], []]);
  // at a target it reaches, it's listed; its shrink misses there, so the copy has to beat the image itself
  const listed = measure(dir, { ...options, target: 50 });
  const [row] = listed.result.rows;
  assert.equal(row.path, "g.png");
  assert.equal(row.target, 50);
  assert.equal(row.equal, 50);
  assert.equal(row.sameFormat.outcome, "miss");
  assert.equal(row.base, bytes.length);
  assert.equal(row.preview, null);
  // the turned image is left out before it reaches the engine; the engine turns down the other in its own words
  assert.match(listed.stderr, /^slimdeer: measuring 2 images as WebP at the same quality\.\.\.$/m);
  assert.deepEqual(listed.result.leftOut, [
    { file: join(here, "turned.png"), path: "turned.png", kind: "turned", reason: "its eXIf data turns it, and the WebP file would show it unturned; shrink it as PNG instead" },
    { file: join(here, "hdr.png"), path: "hdr.png", kind: "refused", reason: "this PNG's color space is set by cICP, which WebP can't carry; keep it as PNG" },
  ]);
  assert.deepEqual(listed.result.errors, []);
  // at the automatic target, nothing reaches the quality floor: declined, as without a format, and no copy measured
  const auto = measure(dir, options, ["g.png"]);
  assert.doesNotMatch(auto.stderr, /as WebP/);
  assert.deepEqual(auto.result.declined.map(({ path }) => path), ["g.png"]);
  assert.deepEqual([auto.result.rows, auto.result.notWorthIt, auto.result.missed], [[], [], []]);
});
