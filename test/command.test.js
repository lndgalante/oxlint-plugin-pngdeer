// The command, npx oxlint-plugin-pngdeer.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { marked } from "../src/marker.js";
import { fade, plugin, pngdeer, project } from "./helpers.js";

test("makes several images smaller in place, and marks them", () => {
  const dir = project({ images: ["src/assets/crystal-ball.png", "public/photo.jpg"] });
  const run = pngdeer(dir, "src/assets/crystal-ball.png", "public/photo.jpg");
  assert.equal(run.status, 0, run.stderr);
  assert.match(run.stdout, /^src\/assets\/crystal-ball\.png: 35 kB → 11 kB \(\d+% smaller, SSIMULACRA2 \d+\.\d\)$/m);
  assert.match(run.stdout, /^public\/photo\.jpg: 235 kB → 85 kB \(\d+% smaller, SSIMULACRA2 \d+\.\d\)$/m);
  assert.equal(marked(readFileSync(join(dir, "public/photo.jpg"))), true);
  assert.match(pngdeer(dir, "public/photo.jpg").stdout, /^public\/photo\.jpg: already pngdeer's; left as is$/m);
});

test("-o writes elsewhere and leaves the image alone", () => {
  const dir = project({ images: ["src/assets/crystal-ball.png"] });
  const before = readFileSync(join(dir, "src/assets/crystal-ball.png"));
  assert.equal(pngdeer(dir, "src/assets/crystal-ball.png", "-o", "smaller.png").status, 0);
  assert.deepEqual(readFileSync(join(dir, "src/assets/crystal-ball.png")), before);
  assert.equal(marked(readFileSync(join(dir, "smaller.png"))), true);
});

test("a target it can't reach leaves the file as it was", () => {
  const dir = project({ images: ["src/assets/crystal-ball.png"] });
  const before = readFileSync(join(dir, "src/assets/crystal-ball.png"));
  const run = pngdeer(dir, "src/assets/crystal-ball.png", "--target", "95");
  assert.equal(run.status, 0);
  assert.match(run.stdout, /no smaller file reaches --target 95 \(the best scores \d+\.\d\); left as is$/m);
  assert.deepEqual(readFileSync(join(dir, "src/assets/crystal-ball.png")), before);
});

test("a file it can't shrink stays as it was, unmarked", () => {
  const dir = project({ images: ["src/assets/heart.png"] });
  const before = readFileSync(join(dir, "src/assets/heart.png"));
  const run = pngdeer(dir, "src/assets/heart.png");
  assert.equal(run.status, 0);
  assert.match(run.stdout, /pngdeer can't make it smaller; left as is$/m);
  assert.deepEqual(readFileSync(join(dir, "src/assets/heart.png")), before);
  assert.equal(marked(before), false);
});

test("errors name the file, say why, and the others still get done", () => {
  const dir = project({ files: { "fade.png": fade() }, images: ["src/assets/crystal-ball.png"] });
  const run = pngdeer(dir, "missing.png", "fade.png", "src/assets/crystal-ball.png", "--target", "90");
  assert.equal(run.status, 1);
  assert.match(run.stderr, /^missing\.png: no such file$/m);
  assert.match(run.stderr, /^fade\.png: pngdeer couldn't compress this image: unreachable/m);
  assert.match(run.stdout, /^src\/assets\/crystal-ball\.png: /m);
});

test("arguments are checked, with help on a mistake", () => {
  const { version } = JSON.parse(readFileSync(join(plugin, "package.json"), "utf8"));
  assert.equal(pngdeer(plugin, "--version").stdout.trim(), version);
  assert.match(pngdeer(plugin, "--help").stdout, /^usage: oxlint-plugin-pngdeer IMAGE\.\.\./);
  const none = pngdeer(plugin);
  assert.equal(none.status, 2);
  assert.match(none.stderr, /no image given[\s\S]*usage:/);
  assert.match(pngdeer(plugin, "a.png", "--target", "200").stderr, /--target must be auto or a number from 0 to 100, not 200/);
  assert.match(pngdeer(plugin, "a.png", "b.png", "-o", "c.png").stderr, /-o takes one image/);
  assert.match(pngdeer(plugin, "a.png", "--frobnicate").stderr, /unknown option --frobnicate/);
});
