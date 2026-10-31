// The rule under oxlint, end to end.
import assert from "node:assert/strict";
import { chmodSync, cpSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { fade, handled, names, oxlint, oxlintSummary, pngdeer, project } from "./helpers.js";

test("warns on each reference to a compressible image, with the command that fixes it", () => {
  const dir = project();
  const first = oxlint(dir);
  // once per image per file (diagram.png is named twice), and not for heart.png (saves too little),
  // missing.png (doesn't exist) or unused-fire.png (named nowhere)
  assert.deepEqual(names(first), ["crystal-ball.png", "diagram.png", "hero.png", "photo.jpg"]);
  const hero = first.found.find((d) => d.message.startsWith("hero.png"));
  assert.match(hero.message, /^hero\.png could be 70% smaller \(509 kB → 151 kB\) and look the same side by side \(quality 87\/100\)\. Run: npx oxlint-plugin-pngdeer public\/hero\.png$/);
  // a photo that lands lower says so
  const photo = first.found.find((d) => d.message.startsWith("photo.jpg"));
  assert.match(photo.message, /and look close, with differences you might spot side by side \(quality 76\/100\)/);
  // a second run reads the cache
  assert.deepEqual(names(oxlint(dir)), names(first));
});

test("says what the first run is doing, and what the warnings add up to", () => {
  const dir = project();
  const stderr = oxlintSummary(dir);
  assert.match(stderr, /^pngdeer: measuring 5 images not in the cache yet\.\.\.$/m);
  assert.match(stderr, /^pngdeer: measured 5 images in \d+\.\d s; later runs read the cache$/m);
  assert.match(stderr, /^pngdeer: 4 flagged images could be 718 kB smaller in all \(1\.0 MB → 310 kB, 70% smaller\):$/m);
  // a table, the biggest saving first; then what no code names; then what quality means, and the
  // one command for all the flagged images
  const rows = stderr.split("\n").filter((line) => line.startsWith("  ")).map((line) => line.trim().split(/\s+/)[0]);
  assert.deepEqual(rows, ["image", "public/hero.png", "src/assets/diagram.png", "public/photo.jpg", "src/assets/crystal-ball.png", "public/unused-fire.png"]);
  assert.match(stderr, /^pngdeer: 1 more image could be 5\.\d kB smaller, but no linted code names it \(used from CSS or HTML, or not at all\):$/m);
  assert.match(stderr, /^pngdeer: quality is SSIMULACRA2, out of 100: 90\+ looks identical/m);
  assert.match(stderr, /^pngdeer: to shrink the 4 flagged images in place \(lossy, so commit first\), run: npx oxlint-plugin-pngdeer --flagged$/m);
  const again = oxlintSummary(dir);
  assert.doesNotMatch(again, /measur/);
  assert.match(again, /4 flagged images could be/);
  // nothing for machine formats or --quiet
  assert.doesNotMatch(oxlint(dir).stderr, /flagged images/);
  assert.doesNotMatch(oxlintSummary(dir, "--quiet"), /flagged images/);
});

test("an image whose warning a comment turns off is left out of the summary and --flagged", () => {
  const files = {
    "src/App.jsx": [
      'import ball from "./assets/crystal-ball.png";',
      "// oxlint-disable-next-line pngdeer/compressible-image -- the brand's master copy",
      'export const hero = "/hero.png";',
      'export const photo = "/photo.jpg"; // eslint-disable-line pngdeer/compressible-image',
      "",
    ].join("\n"),
  };
  const dir = project({ files, images: ["src/assets/crystal-ball.png", "public/hero.png", "public/photo.jpg"] });
  assert.deepEqual(names(oxlint(dir)), ["crystal-ball.png"]);
  const stderr = oxlintSummary(dir);
  assert.match(stderr, /1 flagged image could be/);
  assert.doesNotMatch(stderr, /hero\.png|photo\.jpg/);
  assert.deepEqual(handled(pngdeer(dir, "--flagged").stdout), ["src/assets/crystal-ball.png"]);
});

test("--flagged shrinks what the last lint flagged, at the target it measured", () => {
  const dir = project({ options: { target: 70 } });
  assert.match(pngdeer(dir, "--flagged").stderr, /no lint has run in this folder yet/);
  oxlint(dir);
  const run = pngdeer(dir, "--flagged");
  assert.equal(run.status, 0, run.stderr);
  assert.deepEqual(handled(run.stdout), ["public/hero.png", "src/assets/diagram.png", "public/photo.jpg", "src/assets/crystal-ball.png"]);
  assert.match(run.stderr, /^pngdeer: shrinking 4 images in place \(lossy; commit first so you can undo\)$/m);
  assert.match(run.stderr, /^pngdeer: 4 images, 1\.0 MB → \d+ kB \(\d+ kB smaller\)\. Lint again to check\.$/m);
  assert.deepEqual(oxlint(dir).found, []);
  assert.equal(pngdeer(dir, "--flagged").stdout.trim(), "the last lint here flagged nothing");
});

test("files fixed with the command aren't flagged again, even on a fresh clone", () => {
  const dir = project();
  assert.equal(pngdeer(dir, "public/photo.jpg", "src/assets/diagram.png").status, 0);
  // pngdeer's own JPEG would otherwise come out about a fifth smaller again
  const after = oxlint(dir);
  assert.deepEqual(names(after), ["crystal-ball.png", "hero.png"]);
  // crystal-ball.png, hero.png and unused-fire.png: the marked two need no engine, heart.png is too small
  assert.match(after.stderr, /measuring 3 images not in the cache yet/);
});

test("a fixed target is measured and repeated in the command", () => {
  const dir = project({ files: { "src/App.jsx": 'import ball from "./assets/crystal-ball.png";\n' }, options: { target: 70 }, images: ["src/assets/crystal-ball.png"] });
  const [found] = oxlint(dir).found;
  assert.match(found.message, / \(quality 7\d\/100\)\. Run: npx oxlint-plugin-pngdeer src\/assets\/crystal-ball\.png --target 70$/);
});

test("thresholds keep small savings quiet", () => {
  const dir = project({ files: { "src/App.jsx": 'import ball from "./assets/crystal-ball.png";\n' }, options: { minSavedPercent: 90 }, images: ["src/assets/crystal-ball.png"] });
  assert.deepEqual(oxlint(dir).found, []);
});

test("paths with spaces are found and quoted for the platform's shell", () => {
  const dir = project({ files: { "src/App.jsx": 'import shot from "./assets/My Shot, final.png";\n' }, images: ["src/assets/crystal-ball.png"] });
  cpSync(join(dir, "src/assets/crystal-ball.png"), join(dir, "src/assets/My Shot, final.png"));
  const [found] = oxlint(dir).found;
  const quoted = process.platform === "win32" ? '"src/assets/My Shot, final.png"' : "'src/assets/My Shot, final.png'";
  assert.ok(found.message.endsWith(`Run: npx oxlint-plugin-pngdeer ${quoted}`), found.message);
});

test("srcSet lists, public and static paths resolve, each image underlined on its own", () => {
  const files = { "src/App.jsx": 'export const a = <img srcSet="./assets/crystal-ball.png 1x, /photo.jpg 2x" />;\nexport const b = "/hero.png";\n' };
  const dir = project({ files, images: ["src/assets/crystal-ball.png", "public/photo.jpg"] });
  mkdirSync(join(dir, "static"));
  cpSync(join(dir, "src/assets/crystal-ball.png"), join(dir, "static/hero.png"));
  const result = oxlint(dir);
  assert.deepEqual(names(result), ["crystal-ball.png", "hero.png", "photo.jpg"]);
  const span = (name) => result.found.find((d) => d.message.startsWith(name)).labels[0].span;
  assert.deepEqual([span("crystal-ball.png").column, span("crystal-ball.png").length], [31, 25]);
  assert.deepEqual([span("photo.jpg").column, span("photo.jpg").length], [61, 10]);
});

test("runs from a parent directory find the same images", () => {
  const files = { "src/App.jsx": 'import ball from "./assets/crystal-ball.png";\nexport const photo = "/photo.jpg";\n' };
  const dir = project({ files, images: ["src/assets/crystal-ball.png", "public/photo.jpg"] });
  assert.deepEqual(names(oxlint(join(dir, ".."), join(dir, "src"))), ["crystal-ball.png", "photo.jpg"]);
});

test("an unreadable image is skipped, not an error", { skip: process.platform === "win32" }, () => {
  const files = { "src/App.jsx": 'import a from "./assets/crystal-ball.png";\nimport b from "./assets/diagram.png";\n' };
  const dir = project({ files, images: ["src/assets/crystal-ball.png", "src/assets/diagram.png"] });
  chmodSync(join(dir, "src/assets/diagram.png"), 0o000);
  try {
    assert.deepEqual(names(oxlint(dir)), ["crystal-ball.png"]);
  } finally {
    chmodSync(join(dir, "src/assets/diagram.png"), 0o644);
  }
});

test("an image pngdeer can't take is named on stderr, not silently skipped", () => {
  const files = {
    "src/App.jsx": 'import fade from "./assets/fade.png";\nimport fake from "./assets/fake.png";\n',
    // pngdeer's engine panics on this image at target 90 (a bug upstream); if it ever stops, this
    // test needs another image it fails on
    "src/assets/fade.png": fade(),
    "src/assets/fake.png": "not an image ".repeat(400),
  };
  const dir = project({ files, options: { target: 90 }, images: [] });
  const { found, stderr } = oxlint(dir);
  assert.deepEqual(found, []);
  assert.match(stderr, /^pngdeer: src\/assets\/fade\.png: pngdeer couldn't compress this image: unreachable \(a bug in pngdeer/m);
  assert.match(stderr, /^pngdeer: skipped src\/assets\/fake\.png: not a PNG or JPEG$/m);
});

test("aliases resolve, including subpath imports that start with #", () => {
  const files = { "src/App.jsx": 'import a from "@/assets/crystal-ball.png";\nimport b from "#img/photo.jpg";\n' };
  const dir = project({ files, images: ["src/assets/crystal-ball.png", "public/photo.jpg"] });
  const config = JSON.parse(readFileSync(join(dir, ".oxlintrc.json"), "utf8"));
  config.settings = { pngdeer: { aliases: { "@/": "src/", "#img/": "public/" } } };
  writeFileSync(join(dir, ".oxlintrc.json"), JSON.stringify(config));
  assert.deepEqual(names(oxlint(dir)), ["crystal-ball.png", "photo.jpg"]);
});
