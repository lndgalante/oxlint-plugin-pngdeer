// The rule under oxlint, end to end.
import assert from "node:assert/strict";
import { chmodSync, cpSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { fade, names, oxlint, pngdeer, project } from "./helpers.js";

test("warns on each reference to a compressible image, with the command that fixes it", () => {
  const dir = project();
  const first = oxlint(dir);
  // heart.png saves too little, missing.png doesn't exist, unused-fire.png isn't referenced
  assert.deepEqual(names(first), ["crystal-ball.png", "diagram.png", "diagram.png", "hero.png", "photo.jpg"]);
  const hero = first.found.find((d) => d.message.startsWith("hero.png"));
  assert.match(hero.message, /^hero\.png could be \d+% smaller \(509 kB → \d+ kB\) at about the same visual quality\. Run: npx oxlint-plugin-pngdeer public\/hero\.png$/);
  // a second run reads the cache
  assert.deepEqual(names(oxlint(dir)), names(first));
});

test("says what the first run is doing, and what the warnings add up to", () => {
  const dir = project();
  const { stderr } = oxlint(dir);
  assert.match(stderr, /^pngdeer: measuring 5 images not in the cache yet\.\.\.$/m);
  assert.match(stderr, /^pngdeer: measured 5 images in \d+\.\d s; later runs read the cache$/m);
  assert.match(stderr, /^pngdeer: 4 images could be \d+ kB smaller in all \(\d+%\)$/m);
  const again = oxlint(dir).stderr;
  assert.doesNotMatch(again, /measur/);
  assert.match(again, /4 images could be/);
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
  assert.match(found.message, / at SSIMULACRA2 70\. Run: npx oxlint-plugin-pngdeer src\/assets\/crystal-ball\.png --target 70$/);
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

test("srcSet lists, public and static paths resolve", () => {
  const files = { "src/App.jsx": 'export const a = <img srcSet="./assets/crystal-ball.png 1x, /photo.jpg 2x" />;\nexport const b = "/hero.png";\n' };
  const dir = project({ files, images: ["src/assets/crystal-ball.png", "public/photo.jpg"] });
  mkdirSync(join(dir, "static"));
  cpSync(join(dir, "src/assets/crystal-ball.png"), join(dir, "static/hero.png"));
  assert.deepEqual(names(oxlint(dir)), ["crystal-ball.png", "hero.png", "photo.jpg"]);
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
