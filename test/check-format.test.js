// --check --format webp|avif: the lines, the JSON and the job summary that compare each image's copy
// with its own shrink. The example's real images go to the engine once, as WebP, in one copy of
// example/ that the tests share; every other case is measured already, in the cache, so the engine
// doesn't run for it (AVIF, which is slow, never does here).
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { closeSync, cpSync, existsSync, mkdirSync, mkdtempSync, openSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, test } from "node:test";
import { pathToFileURL } from "node:url";
import { cacheDir, convertKey, key, write } from "../src/cache.js";
import { listing, notes, saving } from "../src/check.js";
import { mark } from "../src/marker.js";
import { looks, reviewCommand, size, smaller } from "../src/text.js";
import { chunk, gradient, plugin, project, turn } from "./helpers.js";

const ball = readFileSync(join(plugin, "example/src/assets/crystal-ball.png"));
const photo = readFileSync(join(plugin, "example/public/photo.jpg"));
const LEGEND = "Quality is SSIMULACRA2, out of 100: 90+ looks identical, 80+ the same side by side, 70+ close, with differences you might spot side by side, below 70 visibly different.";

const folders = []; // made here, removed at the end
after(() => folders.forEach((dir) => rmSync(dir, { recursive: true, force: true })));

/** A new empty folder, removed at the end. */
function folder() {
  const dir = mkdtempSync(join(tmpdir(), "slimdeer-"));
  folders.push(dir);
  return dir;
}

/** The command's run in `cwd`, as a person runs it; `env` adds to its environment (a GitHub Actions step's, say). */
function run(cwd, args, env = {}) {
  const result = spawnSync(process.execPath, [join(plugin, "bin/slimdeer.js"), ...args], { cwd, env: { ...process.env, ...env }, encoding: "utf8", timeout: 600_000 });
  assert.equal(result.error, undefined, result.error?.message);
  return result;
}

const check = (cwd, ...args) => run(cwd, ["--check", ...args]);

let shared;

/** A copy of example/ measured once, in its own format and as WebP, and that first run. */
function example() {
  if (!shared) {
    const dir = project();
    shared = { dir, cold: check(dir, "--format", "webp") };
  }
  return shared;
}

/** A copy of the measured example, its cache included, for a test that changes it. */
function exampleCopy() {
  const dir = folder();
  cpSync(example().dir, dir, { recursive: true });
  return dir;
}

let made = 0;

/**
 * An image at `path` in `dir`, different from every other one made here (`bytes` with zeros after),
 * measured already in the cache of its project at `root`: in its own format at `target` as `own`
 * says ({ saved, outcome, score }), and as `format` at its equal target as `copy` says, if given
 * ({ compressed or saved, outcome, score }, or { skipped, failed }). Returns its size.
 */
function measured(dir, path, { own = { saved: 20000, outcome: "hit", score: 87 }, copy, format = "webp", target, root = dir, bytes = ball }) {
  const image = Buffer.concat([bytes, Buffer.alloc(++made)]);
  mkdirSync(dirname(join(dir, path)), { recursive: true });
  writeFileSync(join(dir, path), image);
  const original = image.length;
  write(cacheDir(root), key(image, target), { original, compressed: original - (own.saved ?? 0), outcome: own.outcome, score: own.score });
  const equal = target ?? (own.outcome === "hit" ? own.score : 100);
  if (copy?.skipped) write(cacheDir(root), convertKey(image, equal, format), { format, ...copy });
  else if (copy) write(cacheDir(root), convertKey(image, equal, format), { format, original, compressed: copy.compressed ?? original - copy.saved, outcome: copy.outcome ?? "hit", score: copy.score, target: equal });
  return original;
}

/** The lines of a run's stderr, without the counts a slow machine adds every 30 s. */
const said = (stderr) => stderr.split("\n").filter((line) => line && !/^slimdeer: measured \d+ of /.test(line));

test("--check --format webp lists the example's copies that beat their own shrink, then what it doesn't list, the total and the commands", () => {
  const { dir, cold } = example();
  assert.equal(cold.status, 1, cold.stderr);
  assert.deepEqual(said(cold.stderr), ["slimdeer: measuring 5 images not in the cache yet...", "slimdeer: measuring 5 images as WebP at the same quality..."]);
  const report = JSON.parse(check(dir, "--format", "webp", "--json").stdout);
  // the copies that save the most beyond their shrink, and the two that don't save enough (measure-format.test.js)
  assert.deepEqual(report.images.map(({ file }) => file), ["public/hero.png", "src/assets/diagram.png", "src/assets/crystal-ball.png"]);
  assert.deepEqual(report.notWorthIt.map(({ file }) => file), ["public/photo.jpg", "public/unused-fire.png"]);
  const rows = [...report.images].reverse().map(({ file, original, compressed, quality, sameFormat }) => {
    assert.equal(sameFormat.outcome, "hit");
    return `${file}: as WebP, could be ${smaller(original, compressed)}% smaller (${size(original)} → ${size(compressed)}, quality ${quality}/100: looks ${looks(quality)}); shrunk as PNG at the same quality: ${size(sameFormat.compressed)}`;
  });
  const against = report.notWorthIt.map(({ file, compressed, sameFormat }) => `${file}: ${size(compressed)} against ${size(sameFormat.compressed)}`).join("; ");
  const { original, compressed, sameFormat } = report.totals;
  assert.equal(cold.stdout, [
    ...rows,
    "slimdeer: checked 6 images; 5 measured, 0 cached, 1 skipped (already optimized or below 4.1 kB), 0 errors.",
    `slimdeer: 2 images aren't listed: as WebP they would save less than 4.1 kB or 10% more than shrinking them in place (${against}); to shrink them in place instead, run: npx oxlint-plugin-slimdeer public/photo.jpg public/unused-fire.png`,
    `slimdeer: as WebP, 3 images could be ${size(original - compressed)} smaller (${size(original)} → ${size(compressed)}, ${smaller(original, compressed)}% smaller); shrunk in place at the same quality, they would be ${size(sameFormat)}. Images unchanged.`,
    "slimdeer: to see them before and after on one page first, run: npx oxlint-plugin-slimdeer --review --format webp",
    "slimdeer: to write them as WebP next to the originals, which stay, run: npx oxlint-plugin-slimdeer public/hero.png src/assets/diagram.png src/assets/crystal-ball.png --format webp",
    "",
  ].join("\n"));
  // the second run measures nothing, and says the same
  const warm = check(dir, "--format", "webp");
  assert.equal(warm.status, 1, warm.stderr);
  assert.equal(warm.stderr, "");
  assert.equal(warm.stdout, cold.stdout.replace("5 measured, 0 cached", "0 measured, 5 cached"));
});

test("--check --format webp --json gives each image's copy, its own shrink and the lines that name it, in a fixed key order", () => {
  const { dir } = example();
  const json = check(dir, "--format", "webp", "--json");
  assert.equal(json.status, 1, json.stderr);
  assert.equal(json.stderr, "");
  assert.equal(json.stdout.split("\n").length, 2, json.stdout);
  const report = JSON.parse(json.stdout);
  assert.deepEqual(Object.keys(report), ["version", "options", "counts", "totals", "images", "notWorthIt", "leftOut", "existing", "declined", "missed", "errors", "builds"]);
  assert.deepEqual(report.options, { target: "auto", format: "webp", minSavedBytes: 4096, minSavedPercent: 10, exclude: [], cacheDir: null });
  assert.deepEqual(report.counts, { checked: 6, measured: 0, cached: 5, skipped: 1, packages: 1, errors: 0 });
  const [hero] = report.images;
  assert.deepEqual(Object.keys(hero), ["file", "package", "output", "original", "compressed", "saved", "percent", "quality", "looks", "sameFormat", "namedIn"]);
  assert.deepEqual([hero.file, hero.package, hero.output], ["public/hero.png", ".", "public/hero.webp"]);
  assert.equal(hero.original, readFileSync(join(dir, "public/hero.png")).length);
  assert.deepEqual([hero.saved, hero.percent, hero.looks], [hero.original - hero.compressed, smaller(hero.original, hero.compressed), looks(hero.quality)]);
  const shrunk = hero.sameFormat.compressed;
  assert.deepEqual(hero.sameFormat, { compressed: shrunk, outcome: "hit", quality: hero.sameFormat.quality, savedMore: shrunk - hero.compressed, percentMore: smaller(shrunk, hero.compressed) });
  // every line that names it, code first, as paths from here
  assert.deepEqual(hero.namedIn, [
    { file: "src/App.jsx", line: 10, text: '<img src="/hero.png" alt="An arcade stick" />' },
    { file: "SOURCES.md", line: 10, text: "| `public/hero.png` | [Wikimedia Commons: Sega Dreamcast Arcade Stick](https://commons.wikimedia.or…" },
  ]);
  assert.deepEqual(report.images[1].namedIn.map(({ file, line }) => `${file}:${line}`), ["src/App.jsx:1", "src/App.jsx:5", "SOURCES.md:7"]);
  // the biggest saving beyond the image's own shrink first
  const more = report.images.map(({ sameFormat }) => sameFormat.savedMore);
  assert.deepEqual(more, [...more].sort((a, b) => b - a));
  const sum = (bytes) => report.images.reduce((total, image) => total + bytes(image), 0);
  const original = sum((image) => image.original);
  const compressed = sum((image) => image.compressed);
  const sameFormat = sum((image) => image.sameFormat.compressed);
  assert.deepEqual(report.totals, { images: 3, original, compressed, saved: original - compressed, percent: smaller(original, compressed), sameFormat, savedMore: sameFormat - compressed });
  for (const image of report.notWorthIt) {
    assert.deepEqual(Object.keys(image), ["file", "original", "compressed", "sameFormat"]);
    assert.deepEqual(Object.keys(image.sameFormat), ["compressed", "outcome", "quality"]);
  }
  assert.deepEqual([report.leftOut, report.existing, report.declined, report.missed, report.errors, report.builds], [[], [], [], [], [], []]);
});

test("without --format, the check's lines and JSON name no format", () => {
  const { dir } = example();
  const report = JSON.parse(check(dir, "--json").stdout);
  assert.deepEqual(Object.keys(report), ["version", "options", "counts", "totals", "images", "declined", "missed", "errors", "builds"]);
  assert.deepEqual(Object.keys(report.options), ["target", "minSavedBytes", "minSavedPercent", "exclude", "cacheDir"]);
  assert.deepEqual(Object.keys(report.totals), ["images", "original", "compressed", "saved", "percent"]);
  assert.deepEqual(Object.keys(report.images[0]), ["file", "package", "original", "compressed", "saved", "percent", "outcome", "quality", "looks"]);
  assert.equal(report.images.length, 5);
  const rows = [...report.images].reverse().map(({ file, original, compressed, outcome, quality }) => `${file}: could be ${smaller(original, compressed)}% smaller (${size(original)} → ${size(compressed)}, ${outcome === "hit" ? `quality ${quality}/100: looks ${looks(quality)}` : "lossless: looks identical"})`);
  const { original, compressed } = report.totals;
  const lines = check(dir);
  assert.equal(lines.status, 1, lines.stderr);
  assert.equal(lines.stderr, "");
  assert.equal(lines.stdout, [
    ...rows,
    "slimdeer: checked 6 images; 0 measured, 5 cached, 1 skipped (already optimized or below 4.1 kB), 0 errors.",
    `slimdeer: 5 images could be ${size(original - compressed)} smaller (${size(original)} → ${size(compressed)}, ${smaller(original, compressed)}% smaller). Images unchanged.`,
    "slimdeer: to see all 5 before and after on one page first, run: npx oxlint-plugin-slimdeer --review",
    `slimdeer: to shrink them in place (lossy, so commit first), run: npx oxlint-plugin-slimdeer ${report.images.map(({ file }) => file).join(" ")}`,
    "",
  ].join("\n"));
});

test("with no thresholds, a JPEG and an image slimdeer can't shrink are listed too", () => {
  const dir = exampleCopy();
  const args = ["--format", "webp", "--min-saved-bytes", "0", "--min-saved-percent", "0"];
  const lines = check(dir, ...args);
  assert.equal(lines.status, 1, lines.stderr);
  // heart.png is too small for 4 kB: only it goes to the engine
  assert.deepEqual(said(lines.stderr), ["slimdeer: measuring 1 image not in the cache yet...", "slimdeer: measuring 1 image as WebP at the same quality..."]);
  const { images, notWorthIt } = JSON.parse(check(dir, ...args, "--json").stdout);
  assert.deepEqual(notWorthIt, []);
  const line = (file) => lines.stdout.split("\n").find((text) => text.startsWith(`${file}: `));
  const jpeg = images.find(({ file }) => file === "public/photo.jpg");
  assert.equal(line("public/photo.jpg"), `public/photo.jpg: as WebP, could be ${smaller(jpeg.original, jpeg.compressed)}% smaller (${size(jpeg.original)} → ${size(jpeg.compressed)}, quality ${jpeg.quality}/100: looks ${looks(jpeg.quality)}); shrunk as JPEG at the same quality: ${size(jpeg.sameFormat.compressed)}`);
  // its shrink keeps it as it is: the copy aims at 100 and has to beat the image itself
  const heart = images.find(({ file }) => file === "src/assets/heart.png");
  assert.deepEqual([heart.sameFormat.outcome, heart.quality, heart.sameFormat.savedMore], ["original", 100, heart.original - heart.compressed]);
  assert.equal(line("src/assets/heart.png"), `src/assets/heart.png: as WebP, could be ${smaller(heart.original, heart.compressed)}% smaller (${size(heart.original)} → ${size(heart.compressed)}, quality 100/100: looks identical); as PNG, slimdeer can't make it smaller`);
  assert.match(lines.stdout, /^slimdeer: as WebP, 6 images could be .*% smaller\); shrunk in place at the same quality, they would be .*\. Images unchanged\.$/m);
  assert.match(lines.stdout, /^slimdeer: to see them before and after on one page first, run: npx oxlint-plugin-slimdeer --review --min-saved-bytes 0 --min-saved-percent 0 --format webp$/m);
});

test("an image with a file where its copy would go isn't listed, said once, and doesn't fail the check", () => {
  const dir = exampleCopy();
  // anything there: --format never replaces it
  writeFileSync(join(dir, "public/hero.webp"), "someone's file");
  const one = check(dir, "--format", "webp");
  assert.equal(one.status, 1, one.stderr);
  assert.doesNotMatch(one.stdout, /^public\/hero\.png:/m);
  assert.match(one.stdout, /^slimdeer: public\/hero\.png already has a WebP file next to it, which --format never replaces, so it isn't listed\nslimdeer: as WebP, 2 images could be /m);
  assert.match(one.stdout, /run: npx oxlint-plugin-slimdeer src\/assets\/diagram\.png src\/assets\/crystal-ball\.png --format webp\n$/);
  // not in the JSON's images or totals, but named
  const report = JSON.parse(check(dir, "--format", "webp", "--json").stdout);
  assert.deepEqual(report.images.map(({ file }) => file), ["src/assets/diagram.png", "src/assets/crystal-ball.png"]);
  assert.equal(report.totals.images, 2);
  assert.deepEqual(report.existing, [{ file: "public/hero.png", output: "public/hero.webp" }]);
  // with every one done, none is said to be smaller, and the check passes
  mkdirSync(join(dir, "src/assets/diagram.webp"));
  writeFileSync(join(dir, "src/assets/crystal-ball.webp"), "");
  const all = check(dir, "--format", "webp");
  assert.equal(all.status, 0, all.stderr);
  assert.match(all.stdout, /^slimdeer: 3 images already have a WebP file next to them, which --format never replaces, so they aren't listed: public\/hero\.png, src\/assets\/diagram\.png, src\/assets\/crystal-ball\.png$/m);
  assert.ok(all.stdout.endsWith("\nslimdeer: as WebP, every image that would be smaller already has its WebP file. Images unchanged.\n"), all.stdout);
  assert.doesNotMatch(all.stdout, /to write|to see/);
  // without --format, nothing is said of copies
  assert.doesNotMatch(check(dir).stdout, /already has/);
});

test("images left out are named a line per reason, the command's own output in a line of its own", () => {
  const dir = exampleCopy();
  writeFileSync(join(dir, "public/shrunk.png"), mark(readFileSync(join(dir, "src/assets/crystal-ball.png"))));
  const one = check(dir, "--format", "webp");
  assert.match(one.stdout, /^slimdeer: 1 image this command already shrank is left out: converting it would be a second lossy pass; convert the original instead$/m);
  writeFileSync(join(dir, "public/shrunk-too.png"), mark(readFileSync(join(dir, "src/assets/diagram.png"))));
  const two = check(dir, "--format", "webp");
  assert.equal(two.status, 1, two.stderr);
  assert.match(two.stdout, /^slimdeer: 2 images this command already shrank are left out: converting them would be a second lossy pass; convert the originals instead$/m);
  assert.deepEqual(JSON.parse(check(dir, "--format", "webp", "--json").stdout).leftOut.map(({ file }) => file), ["public/shrunk-too.png", "public/shrunk.png"]);

  // a reason more than 3 images share names 3 of them; each other reason has its own line
  const next = project({ images: [], files: { "package.json": JSON.stringify({ dependencies: { next: "16.0.0" } }) } });
  for (const name of ["apple-icon", "icon", "icon1", "opengraph-image", "twitter-image"]) measured(next, `app/${name}.png`, { target: 50 });
  const bytes = gradient(32);
  // turned a quarter by its eXIf data, which the copy would lose
  writeFileSync(join(next, "turned.png"), turn(bytes, 6));
  // a PQ color space, which the engine turns down in its own words (at the automatic target the
  // floor turns this gradient down first)
  writeFileSync(join(next, "hdr.png"), Buffer.concat([bytes.subarray(0, 33), chunk("cICP", Buffer.from([9, 16, 0, 1])), bytes.subarray(33)]));
  const args = ["--format", "webp", "--min-saved-bytes", "0", "--min-saved-percent", "0", "--target", "50"];
  const lines = check(next, ...args);
  assert.equal(lines.status, 0, lines.stderr);
  assert.deepEqual(lines.stdout.split("\n").filter((line) => line.includes(" left out: ")), [
    "slimdeer: 5 images left out: app/apple-icon.png, app/icon.png, app/icon1.png, and 2 more (Next.js serves app/ metadata images by their file name, and doesn't take WebP or AVIF there)",
    "slimdeer: 1 image left out: turned.png (its eXIf data turns it, and the WebP file would show it unturned; shrink it as PNG instead)",
    "slimdeer: 1 image left out: hdr.png (this PNG's color space is set by cICP, which WebP can't carry; keep it as PNG)",
  ]);
  // a project that depends on next is told it converts images itself
  assert.deepEqual(said(lines.stderr).filter((line) => !line.startsWith("slimdeer: measuring ")), ["slimdeer: this project depends on next, which can serve images as WebP by itself; convert only images it doesn't serve, or they go through a second lossy pass"]);
  // none was measured as WebP: nothing is said of what it would save
  assert.ok(lines.stdout.endsWith("\nslimdeer: as WebP, no image here is listed. Images unchanged.\n"), lines.stdout);
  assert.deepEqual(JSON.parse(check(next, ...args, "--json").stdout).leftOut.slice(-1), [{ file: "hdr.png", reason: "this PNG's color space is set by cICP, which WebP can't carry; keep it as PNG" }]);
});

test("as AVIF, a React Native project's images are left out, and the engine never makes a copy", () => {
  const dir = project({ images: [], files: { "package.json": JSON.stringify({ dependencies: { "react-native": "0.82.0" } }), "icon.png": gradient(16) } });
  const lines = check(dir, "--format", "avif", "--min-saved-bytes", "0", "--min-saved-percent", "0");
  assert.equal(lines.status, 0, lines.stderr);
  assert.doesNotMatch(lines.stderr, /as AVIF/);
  assert.match(lines.stdout, /^slimdeer: 1 image left out: icon\.png \(React Native's Image doesn't list AVIF among the formats it shows\)\nslimdeer: as AVIF, no image here is listed\. Images unchanged\.\n$/m);
});

test("copies that don't save enough beyond their shrink name their sizes, and the in-place command only for those worth shrinking", () => {
  const dir = project({ images: [] });
  // its own shrink finds nothing smaller: no command, and the line ends there
  const flat = measured(dir, "public/flat.png", { own: { outcome: "original", score: 100 }, copy: { saved: 1000, score: 100 } });
  const summary = join(folder(), "summary.md");
  const one = run(dir, ["--check", "--format", "webp", "public/flat.png"], { GITHUB_STEP_SUMMARY: summary, GITHUB_WORKSPACE: dir });
  assert.equal(one.status, 0, one.stderr);
  // in GitHub Actions too, where nothing listed is no reason to say nothing
  assert.ok(readFileSync(summary, "utf8").includes(`\n\n\`public/flat.png\` isn't listed: as WebP it would save less than 4.1 kB or 10% more than shrinking it in place (${size(flat - 1000)} against ${size(flat)}).\n`));
  assert.equal(one.stdout, [
    "slimdeer: checked 1 image; 0 measured, 1 cached, 0 skipped (already optimized or below 4.1 kB), 0 errors.",
    `slimdeer: public/flat.png isn't listed: as WebP it would save less than 4.1 kB or 10% more than shrinking it in place (${size(flat - 1000)} against ${size(flat)}).`,
    "slimdeer: as WebP, no image here would be smaller than shrinking it in place by both thresholds. Images unchanged.",
    "",
  ].join("\n"));
  // one worth shrinking in place gets the command
  const a = measured(dir, "public/a.png", { own: { saved: 30000, outcome: "hit", score: 85 }, copy: { saved: 31000, score: 86 } });
  const command = "to shrink it in place instead, run: npx oxlint-plugin-slimdeer public/a.png";
  assert.ok(check(dir, "--format", "webp", "public/a.png").stdout.includes(`\nslimdeer: public/a.png isn't listed: as WebP it would save less than 4.1 kB or 10% more than shrinking it in place (${size(a - 31000)} against ${size(a - 30000)}); ${command}\n`));
  // at a target given, the command keeps it
  measured(dir, "other/b.png", { own: { saved: 25000, outcome: "hit", score: 81 }, target: 80, copy: { saved: 26000, score: 82 } });
  assert.match(check(dir, "--format", "webp", "other/b.png", "--target", "80").stdout, /; to shrink it in place instead, run: npx oxlint-plugin-slimdeer other\/b\.png --target 80$/m);
  // several, the biggest first: 3 named, then how many more; the command for those worth it
  const c = measured(dir, "public/c.png", { own: { outcome: "original", score: 100 }, copy: { saved: 100, score: 100 } });
  const d = measured(dir, "public/d.png", { own: { outcome: "original", score: 100 }, copy: { saved: 100, score: 100 } });
  const several = check(dir, "--format", "webp", "public");
  assert.equal(several.status, 0, several.stderr);
  // made one after another, each a byte bigger than the one before
  assert.ok(d > c && c > a && a > flat);
  const sizes = `public/d.png: ${size(d - 100)} against ${size(d)}; public/c.png: ${size(c - 100)} against ${size(c)}; public/a.png: ${size(a - 31000)} against ${size(a - 30000)}; and 1 more`;
  assert.ok(several.stdout.includes(`\nslimdeer: 4 images aren't listed: as WebP they would save less than 4.1 kB or 10% more than shrinking them in place (${sizes}); to shrink 1 of them in place instead, run: npx oxlint-plugin-slimdeer public/a.png\n`), several.stdout);
  // a threshold of 0 isn't named; with neither, a copy that isn't listed is no smaller
  assert.match(check(dir, "--format", "webp", "public/c.png", "--min-saved-bytes", "0").stdout, /^slimdeer: public\/c\.png isn't listed: as WebP it would save less than 10% more than shrinking it in place \(/m);
  const bigger = measured(dir, "zero/bigger.png", { own: { outcome: "original", score: 100 }, copy: { saved: -500, score: 100 } });
  assert.ok(check(dir, "--format", "webp", "zero", "--min-saved-bytes", "0", "--min-saved-percent", "0").stdout.includes(`\nslimdeer: zero/bigger.png isn't listed: as WebP it would be no smaller than shrinking it in place (${size(bigger + 500)} against ${size(bigger)}).\n`));
  // a review's lines say they aren't on the page, which shows the sizes; the result's format is the
  // one its commands carry
  const result = {
    format: "webp",
    rows: [{ file: join(dir, "public/done.png"), path: "public/done.png", root: dir, type: "png", original: 40000, compressed: 4000, score: 88, sameFormat: { compressed: 20000, outcome: "hit", score: 87 }, base: 20000, output: join(dir, "public/done.webp"), outputExists: true, preview: null }],
    notWorthIt: [{ file: join(dir, "public/a.png"), path: "public/a.png", root: dir, type: "png", original: a, compressed: a - 31000, score: 86, sameFormat: { compressed: a - 30000, outcome: "hit", score: 85 }, base: a - 30000 }],
    leftOut: [],
    missed: [{ file: join(dir, "public/far.png"), path: "public/far.png", type: "png", original: 40000, score: 81.2, equal: 85.4 }],
    declined: [{ file: join(dir, "public/header.png"), path: "public/header.png", original: 40000, score: 64.2 }],
    errors: [],
    counts: { checked: 4, measured: 0, cached: 4, skipped: 0, packages: 1 },
    builds: [],
  };
  // the page leaves out what the lines leave out, and a result listed already stays as it is
  assert.deepEqual([listing(result).rows, listing(result).existing.map(({ path }) => path)], [[], ["public/done.png"]]);
  assert.deepEqual(listing(listing(result)), listing(result));
  assert.deepEqual(notes(["."], listing(result), { cwd: dir }, reviewCommand), notes(["."], result, { cwd: dir }, reviewCommand));
  assert.deepEqual(notes(["."], result, { cwd: dir }, reviewCommand), [
    `slimdeer: public/a.png isn't on the page: as WebP it would save less than 4.1 kB or 10% more than shrinking it in place; ${command}`,
    "slimdeer: public/done.png already has a WebP file next to it, which --format never replaces, so it isn't on the page",
    "slimdeer: public/header.png isn't on the page: shrunk in place it doesn't reach quality 70, so there is no quality to match; to choose one, run: npx oxlint-plugin-slimdeer --check public/header.png --target 80 --format webp",
    "slimdeer: public/far.png isn't on the page: as WebP, no file reaches quality 85/100, the PNG's (the best reaches quality 81/100)",
  ]);
});

test("a copy that can't reach its target is named with its best, set apart from the target even when they round alike", () => {
  const dir = project({ images: [] });
  // its own shrink reached 87.3, the copy only 87.1: as whole numbers, both read 87
  const close = measured(dir, "public/close.png", { own: { saved: 20000, outcome: "hit", score: 87.3 }, copy: { saved: 26000, outcome: "miss", score: 87.1 } });
  const one = check(dir, "--format", "webp");
  assert.equal(one.status, 0, one.stderr);
  assert.match(one.stdout, /^slimdeer: public\/close\.png isn't listed: as WebP, no file reaches quality 87\.3\/100, the PNG's \(the best reaches quality 87\.1\/100\)$/m);
  const far = measured(dir, "public/far.jpg", { bytes: photo, own: { saved: 20000, outcome: "hit", score: 87.6 }, copy: { saved: 26000, outcome: "miss", score: 86.9 } });
  assert.match(check(dir, "--format", "webp", "public/far.jpg").stdout, /^slimdeer: public\/far\.jpg isn't listed: as WebP, no file reaches quality 88\/100, the JPEG's \(the best reaches quality 86\/100\)$/m);
  assert.match(check(dir, "--format", "webp").stdout, /^slimdeer: 2 images aren't listed: as WebP, no file reaches the quality asked \(the best of them reaches quality 87\/100\)$/m);
  assert.deepEqual(JSON.parse(check(dir, "--format", "webp", "--json").stdout).missed, [{ file: "public/far.jpg", original: far, quality: 86 }, { file: "public/close.png", original: close, quality: 87 }]);
  // at a target given, the target as given
  measured(dir, "other/given.png", { own: { saved: 20000, outcome: "hit", score: 80.5 }, target: 80, copy: { saved: 26000, outcome: "miss", score: 79.6 } });
  assert.match(check(dir, "--format", "webp", "other/given.png", "--target", "80").stdout, /^slimdeer: other\/given\.png isn't listed: as WebP, no file reaches --target 80 \(the best reaches quality 79\/100\)$/m);
  measured(dir, "other/given-too.png", { own: { saved: 20000, outcome: "hit", score: 80.5 }, target: 80, copy: { saved: 26000, outcome: "miss", score: 77.2 } });
  assert.match(check(dir, "--format", "webp", "other", "--target", "80").stdout, /^slimdeer: 2 images aren't listed: as WebP, no file reaches --target 80 \(the best of them reaches quality 79\/100\)$/m);
  // the scores the engine reports have 3 decimals, which set apart what one or two don't
  measured(dir, "edge/edge.png", { own: { saved: 20000, outcome: "hit", score: 87.314 }, copy: { saved: 26000, outcome: "miss", score: 87.312 } });
  assert.match(check(dir, "--format", "webp", "edge").stdout, /^slimdeer: edge\/edge\.png isn't listed: as WebP, no file reaches quality 87\.314\/100, the PNG's \(the best reaches quality 87\.312\/100\)$/m);
});

test("an image the quality floor turned down has no quality for its copy to match: the line says so, and gives a target to try", () => {
  const dir = project({ images: [] });
  measured(dir, "public/header.png", { own: { saved: 20000, outcome: "miss", score: 64.2 } });
  const lines = check(dir, "--format", "webp");
  assert.equal(lines.status, 0, lines.stderr);
  assert.doesNotMatch(lines.stderr, /as WebP/);
  assert.equal(lines.stdout, [
    "slimdeer: checked 1 image; 0 measured, 1 cached, 0 skipped (already optimized or below 4.1 kB), 0 errors.",
    "slimdeer: public/header.png isn't listed: shrunk in place it doesn't reach quality 70, so there is no quality to match; to choose one, run: npx oxlint-plugin-slimdeer --check public/header.png --target 80 --format webp",
    // it was never measured as WebP, where it may well be smaller
    "slimdeer: as WebP, no image here is listed. Images unchanged.",
    "",
  ].join("\n"));
  for (let i = 0; i < 11; i++) measured(dir, `public/fade-${String(i).padStart(2, "0")}.png`, { own: { saved: 20000, outcome: "miss", score: 64.2 } });
  assert.match(check(dir, "--format", "webp").stdout, /^slimdeer: 12 images aren't listed: shrunk in place they don't reach quality 70, so there is no quality to match; to choose one for the 10 biggest, run: npx oxlint-plugin-slimdeer --check public\/fade-10\.png .* --target 80 --format webp$/m);
  // without a format, the line is the same-format check's
  assert.match(check(dir).stdout, /^slimdeer: 12 images can't be made smaller without a visible difference \(their best quality is below 70\), so they aren't listed; to try the 10 biggest at a lower target, run: npx oxlint-plugin-slimdeer --check .* --target 60$/m);
});

test("at a target given, a copy says the quality it reached, and a shrink that misses gives no size", () => {
  const dir = project({ images: [] });
  const image = measured(dir, "public/a.png", { own: { saved: 5000, outcome: "miss", score: 78.4 }, target: 80, copy: { compressed: 9000, score: 81.2 } });
  const lines = check(dir, "--format", "webp", "--target", "80");
  assert.equal(lines.status, 1, lines.stderr);
  assert.equal(lines.stdout, [
    `public/a.png: as WebP, could be ${smaller(image, 9000)}% smaller (${size(image)} → 9.0 kB, quality 81/100: looks the same side by side); as PNG, no smaller file reaches --target 80`,
    "slimdeer: checked 1 image; 0 measured, 1 cached, 0 skipped (already optimized or below 4.1 kB), 0 errors.",
    // both aim at 80, where the shrink leaves the image as it is
    `slimdeer: as WebP, 1 image could be ${size(image - 9000)} smaller (${size(image)} → 9.0 kB, ${smaller(image, 9000)}% smaller); shrunk in place at the same quality, it would be ${size(image)}. Images unchanged.`,
    "slimdeer: to see it before and after on one page first, run: npx oxlint-plugin-slimdeer --review --target 80 --format webp",
    "slimdeer: to write it as WebP next to the original, which stays, run: npx oxlint-plugin-slimdeer public/a.png --target 80 --format webp",
    "",
  ].join("\n"));
  const { images } = JSON.parse(check(dir, "--format", "webp", "--target", "80", "--json").stdout);
  assert.deepEqual(images[0].sameFormat, { compressed: null, outcome: "miss", quality: null, savedMore: image - 9000, percentMore: smaller(image, 9000) });
  // in place, the image stays as it is: the job summary gives its own size, not the file that missed
  const summary = join(folder(), "summary.md");
  run(dir, ["--check", "--format", "webp", "--target", "80"], { GITHUB_STEP_SUMMARY: summary, GITHUB_WORKSPACE: dir });
  assert.ok(readFileSync(summary, "utf8").includes(`\n| \`public/a.png\` | ${size(image)} | 9.0 kB | ${size(image - 9000)} | 81 | ${size(image)} |\n`));
});

test("the images listed go by what they save beyond their own shrink, not by what they save in all", () => {
  const dir = project({ images: [] });
  // x saves more in all, y more beyond its shrink
  measured(dir, "public/x.png", { own: { saved: 25000, outcome: "hit", score: 87 }, copy: { saved: 40000, score: 88 } });
  measured(dir, "public/y.png", { own: { saved: 2000, outcome: "hit", score: 87 }, copy: { saved: 30000, score: 88 } });
  const report = JSON.parse(check(dir, "--format", "webp", "--json").stdout);
  assert.deepEqual(report.images.map(({ file, saved, sameFormat }) => [file, saved, sameFormat.savedMore]), [["public/y.png", 30000, 28000], ["public/x.png", 40000, 15000]]);
  const lines = check(dir, "--format", "webp");
  assert.match(lines.stdout, /^public\/x\.png: [^\n]*\npublic\/y\.png: /m);
  assert.match(lines.stdout, /run: npx oxlint-plugin-slimdeer public\/y\.png public\/x\.png --format webp\n$/);
  const summary = join(folder(), "summary.md");
  run(dir, ["--check", "--format", "webp"], { GITHUB_STEP_SUMMARY: summary, GITHUB_WORKSPACE: dir });
  assert.match(readFileSync(summary, "utf8"), /\n\| `public\/y\.png` \|[^\n]*\n\| `public\/x\.png` \|/);
});

test("more than 10 listed: the write command takes the 10 that save the most beyond their shrink", () => {
  const dir = project({ images: [] });
  for (let i = 0; i < 12; i++) measured(dir, `public/img-${String(i).padStart(2, "0")}.png`, { copy: { saved: 30000 - 500 * i, score: 88 } });
  const lines = check(dir, "--format", "webp");
  assert.equal(lines.status, 1, lines.stderr);
  const biggest = Array.from({ length: 10 }, (_, i) => `public/img-${String(i).padStart(2, "0")}.png`).join(" ");
  assert.ok(lines.stdout.includes(`\nslimdeer: to write the 10 biggest of 12 as WebP next to the originals, which stay, run: npx oxlint-plugin-slimdeer ${biggest} --format webp\n`), lines.stdout);
  assert.match(lines.stdout, /^slimdeer: to see them before and after on one page first, run: npx oxlint-plugin-slimdeer --review --format webp$/m);
});

test("errors come with the rows, and fail the check, in lines and in JSON", () => {
  const dir = project({ images: [], files: { "bad.png": "not an image" } });
  const image = measured(dir, "public/a.png", { copy: { compressed: 4000, score: 88 } });
  // the engine failed on this one's copy, as it said then
  measured(dir, "public/b.png", { copy: { skipped: "slimdeer couldn't write this image as WebP: unreachable", failed: true } });
  const lines = check(dir, "--format", "webp");
  assert.equal(lines.status, 2, lines.stderr);
  assert.match(lines.stderr, /^bad\.png: not a PNG or JPEG$/m);
  assert.match(lines.stderr, /^public\/b\.png: slimdeer couldn't write this image as WebP: unreachable$/m);
  assert.match(lines.stdout, /^public\/a\.png: as WebP, could be /m);
  assert.match(lines.stdout, /^slimdeer: checked 3 images; 0 measured, 2 cached, 0 skipped \(already optimized or below 4\.1 kB\), 2 errors\.$/m);
  assert.match(lines.stdout, /^slimdeer: as WebP, 1 image could be /m);
  const json = check(dir, "--format", "webp", "--json");
  assert.equal(json.status, 2, json.stderr);
  const report = JSON.parse(json.stdout);
  assert.deepEqual(report.errors, [{ file: "bad.png", message: "not a PNG or JPEG" }, { file: "public/b.png", message: "slimdeer couldn't write this image as WebP: unreachable" }]);
  assert.deepEqual([report.images[0].original, report.images[0].compressed], [image, 4000]);
  // only errors: the check is incomplete
  const bad = check(dir, "--format", "webp", "bad.png", "public/b.png");
  assert.equal(bad.status, 2, bad.stderr);
  assert.ok(bad.stdout.endsWith("\nslimdeer: check incomplete. Images unchanged.\n"), bad.stdout);
});

test("a copy another run measured while the check waited for the lock counts as cached, as an image's own result would", async () => {
  const dir = project({ images: [] });
  const original = measured(dir, "public/a.png", {});
  // another run measuring copies (this process, which is alive) holds the lock: the check waits there
  const lock = join(cacheDir(dir), "converting.lock");
  writeFileSync(lock, `${process.pid} 0`);
  const child = spawn(process.execPath, [join(plugin, "bin/slimdeer.js"), "--check", "--format", "webp", "--json"], { cwd: dir, stdio: ["ignore", "pipe", "pipe"] });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => (stdout += chunk));
  const closed = once(child, "close");
  try {
    await new Promise((resolve, reject) => {
      child.stderr.on("data", (chunk) => {
        stderr += chunk;
        if (stderr.includes("slimdeer: waiting for another run measuring this project's images as WebP or AVIF")) resolve();
      });
      closed.then(() => reject(new Error(`the check ended without waiting:\n${stderr}`)));
    });
    // the other run measures the copy meanwhile
    const k = convertKey(readFileSync(join(dir, "public/a.png")), 87, "webp");
    write(cacheDir(dir), k, { format: "webp", original, compressed: 4000, outcome: "hit", score: 88, target: 87 });
  } finally {
    rmSync(lock, { force: true });
  }
  const [status] = await closed;
  assert.equal(status, 1, stderr);
  // nothing went to the engine
  assert.equal(stderr, "slimdeer: waiting for another run measuring this project's images as WebP or AVIF (if none is running, this one goes on within a minute)\n");
  const report = JSON.parse(stdout);
  assert.deepEqual([report.images[0].file, report.images[0].compressed], ["public/a.png", 4000]);
  assert.deepEqual(report.counts, { checked: 1, measured: 0, cached: 1, skipped: 0, packages: 1, errors: 0 });
});

test("cautions go to stderr after the checked line, in JSON mode too: a framework's project, and for AVIF a share image listed", () => {
  const dir = project({ images: [], files: { "package.json": JSON.stringify({ devDependencies: { "vite-imagetools": "7.0.0" } }) } });
  measured(dir, "public/og-image.png", { format: "avif", copy: { saved: 32000, score: 88 } });
  // named like an icon, but not listed: no caution for it
  measured(dir, "public/favicon.png", { format: "avif", copy: { saved: 6000, score: 88 } });
  const framework = "slimdeer: this project depends on vite-imagetools, which can serve images as WebP by itself; convert only images it doesn't serve, or they go through a second lossy pass";
  const share = "slimdeer: public/og-image.png looks like a share image or an icon by its name; in a December 2024 test, link previews on X, LinkedIn, Slack and iMessage didn't show AVIF, so keep a PNG or JPEG for those";
  // every copy is measured already: no AVIF line
  const lines = check(dir, "--format", "avif");
  assert.equal(lines.status, 1, lines.stderr);
  assert.deepEqual(said(lines.stderr), [framework, share]);
  // its copy is bigger than its shrink: it saves nothing at all
  assert.match(lines.stdout, /^slimdeer: public\/favicon\.png isn't listed: as AVIF it would be no smaller than shrinking it in place \(30 kB against 16 kB\); /m);
  const json = check(dir, "--format", "avif", "--json");
  assert.deepEqual(said(json.stderr), [framework, share]);
  assert.deepEqual(JSON.parse(json.stdout).images.map(({ file }) => file), ["public/og-image.png"]);
  // the job summary has them among its notes, before the commands, each path as code
  const summary = join(folder(), "summary.md");
  run(dir, ["--check", "--format", "avif"], { GITHUB_STEP_SUMMARY: summary, GITHUB_WORKSPACE: dir });
  const markdown = readFileSync(summary, "utf8");
  assert.match(markdown, /^\n### slimdeer --check --format avif\n/);
  assert.ok(markdown.includes("\n\nThis project depends on vite-imagetools, which can serve images as WebP by itself; convert only images it doesn't serve, or they go through a second lossy pass.\n\n"), markdown);
  assert.ok(markdown.includes("\n\n`public/og-image.png` looks like a share image or an icon by its name; in a December 2024 test, link previews on X, LinkedIn, Slack and iMessage didn't show AVIF, so keep a PNG or JPEG for those.\n\n"), markdown);
  assert.ok(markdown.indexOf("This project depends") < markdown.indexOf("To see it before and after"), markdown);
  // on one screen, the cautions come right after the "checked" line
  const both = join(folder(), "both.txt");
  const fd = openSync(both, "w");
  spawnSync(process.execPath, [join(plugin, "bin/slimdeer.js"), "--check", "--format", "avif"], { cwd: dir, stdio: ["ignore", fd, fd] });
  closeSync(fd);
  const screen = readFileSync(both, "utf8").split("\n");
  const checked = screen.findIndex((line) => line.startsWith("slimdeer: checked "));
  assert.deepEqual(screen.slice(checked + 1, checked + 3), [framework, share]);
  // a share image whose copy is there already isn't listed, and needs no caution
  writeFileSync(join(dir, "public/og-image.avif"), "");
  const done = check(dir, "--format", "avif");
  assert.deepEqual(said(done.stderr), [framework]);
  assert.match(done.stdout, /^slimdeer: public\/og-image\.png already has an AVIF file next to it, which --format never replaces, so it isn't listed$/m);
  // without a format, none
  assert.equal(check(dir).stderr, "");

  // a package of a monorepo checked from its root is named by its path
  const mono = project({ images: [], files: { "package.json": '{ "workspaces": ["packages/*"] }', "packages/web/package.json": JSON.stringify({ dependencies: { astro: "5.0.0" } }) } });
  const web = join(mono, "packages/web");
  measured(web, "public/ball.png", { root: web, copy: { saved: 32000, score: 88 } });
  const astro = check(mono, "--format", "webp");
  assert.deepEqual(said(astro.stderr), ["slimdeer: packages/web depends on astro, which can serve images as WebP by itself; convert only images it doesn't serve, or they go through a second lossy pass"]);
  const monoSummary = join(folder(), "summary.md");
  run(mono, ["--check", "--format", "webp"], { GITHUB_STEP_SUMMARY: monoSummary, GITHUB_WORKSPACE: mono });
  assert.ok(readFileSync(monoSummary, "utf8").includes("\n\n`packages/web` depends on astro, which can serve images as WebP by itself; convert only images it doesn't serve, or they go through a second lossy pass.\n\n"));
});

test("in GitHub Actions, --check --format writes a job summary with each copy's size and its shrink's", () => {
  const { dir } = example();
  const summary = join(folder(), "summary.md");
  const actions = run(dir, ["--check", "--format", "webp"], { GITHUB_STEP_SUMMARY: summary, GITHUB_WORKSPACE: dir });
  assert.equal(actions.status, 1, actions.stderr);
  // the lines on stdout are the same as without a job summary
  assert.equal(actions.stdout, check(dir, "--format", "webp").stdout);
  const report = JSON.parse(check(dir, "--format", "webp", "--json").stdout);
  const rows = report.images.map(({ file, original, compressed, quality, sameFormat }) => `| \`${file}\` | ${size(original)} | ${size(compressed)} | ${size(original - compressed)} | ${quality} | ${size(sameFormat.compressed)} |`);
  const against = report.notWorthIt.map(({ file, compressed, sameFormat }) => `\`${file}\`: ${size(compressed)} against ${size(sameFormat.compressed)}`).join("; ");
  const { original, compressed, sameFormat } = report.totals;
  assert.equal(readFileSync(summary, "utf8"), `
### slimdeer --check --format webp

Checked 6 images; 0 measured, 5 cached, 1 skipped (already optimized or below 4.1 kB), 0 errors.

As WebP, 3 images could be ${size(original - compressed)} smaller (${size(original)} → ${size(compressed)}, ${smaller(original, compressed)}% smaller); shrunk in place at the same quality, they would be ${size(sameFormat)}:

| Image | Now | As WebP | Saves | Quality | Shrunk as PNG or JPEG |
| --- | ---: | ---: | ---: | ---: | ---: |
${rows.join("\n")}

${LEGEND}

2 images aren't listed: as WebP they would save less than 4.1 kB or 10% more than shrinking them in place (${against}); to shrink them in place instead, run:

\`\`\`
npx oxlint-plugin-slimdeer public/photo.jpg public/unused-fire.png
\`\`\`

To see them before and after on one page first, run:

\`\`\`
npx oxlint-plugin-slimdeer --review --format webp
\`\`\`

To write them as WebP next to the originals, which stay, run:

\`\`\`
npx oxlint-plugin-slimdeer public/hero.png src/assets/diagram.png src/assets/crystal-ball.png --format webp
\`\`\`
`);
  // nothing to say, nothing written
  const clean = join(folder(), "clean.md");
  assert.equal(run(dir, ["--check", "--format", "webp", "src/assets/heart.png"], { GITHUB_STEP_SUMMARY: clean }).status, 0);
  assert.equal(existsSync(clean), false);
});

test("the lines that name an image are looked for from the folder the check runs in", () => {
  const dir = project({ images: [], files: {
    "package.json": '{ "workspaces": ["packages/*"] }',
    "packages/web/package.json": JSON.stringify({ dependencies: { astro: "5.0.0" } }),
    "packages/web/src/App.jsx": '<img src="/hero.png" />\n',
    "packages/docs/package.json": "{}",
    "packages/docs/guide.md": "The hero is `../web/public/hero.png`.\n",
  } });
  const web = join(dir, "packages/web");
  measured(web, "public/hero.png", { root: web, copy: { compressed: 4000, score: 88 } });
  const script = `import { check } from ${JSON.stringify(pathToFileURL(join(plugin, "src/check.js")).href)};
process.exitCode = await check([process.argv[1]], { cwd: process.argv[2], format: "webp", json: true });`;
  // `image` checked from the folder `from`, by a process in `cwd`: the lines that name it, and the caution
  const named = (cwd, from, image) => {
    const result = spawnSync(process.execPath, ["--input-type=module", "-e", script, image, from], { cwd, encoding: "utf8" });
    assert.equal(result.status, 1, result.stderr);
    return [JSON.parse(result.stdout).images[0].namedIn.map(({ file, line }) => `${file}:${line}`), result.stderr.replace(/ depends on astro, .*\n$/, "")];
  };
  // from the monorepo's root, another package's Markdown names it too, and the package is named by its path
  assert.deepEqual(named(web, dir, "packages/web/public/hero.png"), [["packages/web/src/App.jsx:1", "packages/docs/guide.md:1"], "slimdeer: packages/web"]);
  // from inside its package, that package's lines alone, wherever the process is
  assert.deepEqual(named(dir, web, "public/hero.png"), [["src/App.jsx:1"], "slimdeer: this project"]);
  assert.deepEqual(named(realpathSync(web), realpathSync(web), "public/hero.png"), [["src/App.jsx:1"], "slimdeer: this project"]);
});

test("saving() totals rows as the lines do, with a format beside what shrinking them would leave", () => {
  const rows = [{ original: 509372, compressed: 92082, base: 150714 }, { original: 35475, compressed: 4760, base: 11179 }];
  assert.equal(saving(rows), "2 images could be 448 kB smaller (545 kB → 97 kB, 82% smaller)");
  assert.equal(saving(rows, "avif"), "as AVIF, 2 images could be 448 kB smaller (545 kB → 97 kB, 82% smaller); shrunk in place at the same quality, they would be 162 kB");
  assert.equal(saving(rows.slice(1), "webp"), "as WebP, 1 image could be 31 kB smaller (35 kB → 4.8 kB, 87% smaller); shrunk in place at the same quality, it would be 11 kB");
});

test("the measuring count keeps saying what it measures as, on a terminal and in a log", () => {
  const progress = JSON.stringify(pathToFileURL(join(plugin, "src/progress.js")).href);
  // a terminal: each count rewrites the line; AVIF's slowness comes after it, where the margin may cut it
  const tty = `import { writeSync } from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import tty from "node:tty";
tty.isatty = () => true;
syncBuiltinESMExports();
const { convertLine, progressLine } = await import(${progress});
for (const name of [undefined, "WebP", "AVIF"]) {
  if (name) convertLine(2, name);
  const count = progressLine(name);
  count(1, 2);
  count(2, 2, { saved: name ? 0 : 1500 });
  writeSync(2, "|");
}`;
  const terminal = spawnSync(process.execPath, ["--input-type=module", "-e", tty], { encoding: "utf8" });
  assert.equal(terminal.status, 0, terminal.stderr);
  const [own, webp, avif] = terminal.stderr.split("|");
  const line = (text) => `\x1b[?7l${text}\x1b[?7h`;
  const slow = "; AVIF is slow: often about a minute per image";
  assert.equal(own, line("\rslimdeer: measuring 2 images... 1/2\x1b[K") + line("\rslimdeer: measuring 2 images... 2/2, could save 1.5 kB so far\x1b[K"));
  assert.equal(webp, line("slimdeer: measuring 2 images as WebP at the same quality...") + line("\rslimdeer: measuring 2 images as WebP at the same quality... 1/2\x1b[K") + line("\rslimdeer: measuring 2 images as WebP at the same quality... 2/2\x1b[K"));
  assert.equal(avif, line(`slimdeer: measuring 2 images as AVIF at the same quality${slow}...`) + line(`\rslimdeer: measuring 2 images as AVIF at the same quality... 1/2${slow}\x1b[K`) + line(`\rslimdeer: measuring 2 images as AVIF at the same quality... 2/2${slow}\x1b[K`));
  // a log: a line every 30 s, here at every count, as the clock jumps
  const log = `const { progressLine } = await import(${progress});
let now = Date.now();
Date.now = () => (now += 31_000);
for (const name of [undefined, "AVIF"]) {
  const count = progressLine(name);
  count(1, 3);
  count(2, 3);
  count(3, 3);
}`;
  const logged = spawnSync(process.execPath, ["--input-type=module", "-e", log], { encoding: "utf8" });
  assert.equal(logged.status, 0, logged.stderr);
  assert.equal(logged.stderr, [
    "slimdeer: measured 1 of 3 images...",
    "slimdeer: measured 2 of 3 images...",
    "slimdeer: measured 1 of 3 images as AVIF at the same quality...",
    "slimdeer: measured 2 of 3 images as AVIF at the same quality...",
    "",
  ].join("\n"));
});

test("on a terminal, a check with a format keeps saying what it measures as, and not what shrinking in place would save", () => {
  const terminal = `data:text/javascript,${encodeURIComponent('import tty from "node:tty"; import { syncBuiltinESMExports } from "node:module"; tty.isatty = () => true; syncBuiltinESMExports();')}`;
  const dir = project({ images: [], files: { "g.png": gradient(16) } });
  const args = ["--check", "--format", "webp", "--target", "50", "--min-saved-bytes", "0", "--min-saved-percent", "0"];
  const result = spawnSync(process.execPath, ["--import", terminal, join(plugin, "bin/slimdeer.js"), ...args], { cwd: dir, encoding: "utf8" });
  assert.equal(result.error, undefined);
  assert.ok(result.stderr.includes("\rslimdeer: measuring 1 image... 1/1\x1b[K"), JSON.stringify(result.stderr));
  assert.ok(result.stderr.includes("\rslimdeer: measuring 1 image as WebP at the same quality... 1/1\x1b[K"), JSON.stringify(result.stderr));
  assert.doesNotMatch(result.stderr, /could save/);
});

test("an error that running the check again may clear names the run with its format", () => {
  const dir = project({ images: [] });
  const image = measured(dir, "public/a.png", { copy: { saved: 30000, score: 88 } });
  // a measurement of another file's size
  write(cacheDir(dir), key(readFileSync(join(dir, "public/a.png"))), { original: image + 1, compressed: 1000, outcome: "hit", score: 87 });
  const lines = check(dir, "--format", "webp");
  assert.equal(lines.status, 2, lines.stderr);
  assert.match(lines.stderr, /^public\/a\.png: invalid measurement in node_modules\/\.cache\/slimdeer; remove that cache entry and run --check --format webp again$/m);
  assert.match(check(dir).stderr, /^public\/a\.png: invalid measurement in node_modules\/\.cache\/slimdeer; remove that cache entry and run --check again$/m);
});

test("where the filesystem doesn't tell letter case apart, the JSON names the copy as --format writes it", (t) => {
  const dir = exampleCopy();
  if (!existsSync(join(dir, "SRC/ASSETS/CRYSTAL-BALL.PNG"))) return t.skip("this filesystem tells letter case apart");
  const report = JSON.parse(check(dir, "--format", "webp", "--json", "--min-saved-bytes", "0", "SRC/ASSETS/CRYSTAL-BALL.PNG").stdout);
  assert.deepEqual(report.images.map(({ file, output }) => [file, output]), [["SRC/ASSETS/CRYSTAL-BALL.PNG", "SRC/ASSETS/crystal-ball.webp"]]);
});
