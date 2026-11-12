import assert from "node:assert/strict";
import { once } from "node:events";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { Worker } from "node:worker_threads";
import { deflateSync } from "node:zlib";
import { fill, peakOf, pool } from "../src/batch.js";
import { key, read } from "../src/cache.js";
import { compress, trapped } from "../src/engine.js";
import { shrink } from "../src/shrink.js";
import { chunk, fade, project } from "./helpers.js";

/** A 320 × 240 RGB gradient as a PNG: its automatic result looks visibly different (62), and target 70 reaches 72. */
function gradient() {
  const [width, height] = [320, 240];
  const raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) raw.set([(x * 255) / width, (y * 255) / height, ((x + y) * 255) / (width + height)], y * (width * 3 + 1) + 1 + x * 3);
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.set([8, 2], 8);
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  return Buffer.concat([signature, chunk("IHDR", header), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}

test("the automatic target settles for no less than 70: below, it compresses again at 70", () => {
  const bytes = gradient();
  const automatic = compress(bytes);
  assert.equal(automatic.outcome, "hit");
  assert.ok(Math.round(automatic.score) >= 70, `scored ${automatic.score}`);
  // the very file target 70 gives, so the warning, --check and the command agree
  assert.deepEqual(automatic.output, compress(bytes, 70).output);
});

test("an image that changes while it's shrunk in place is left as is", async () => {
  const dir = project({ images: ["public/hero.png", "src/assets/diagram.png"] });
  const file = join(dir, "public/hero.png");
  const replacement = readFileSync(join(dir, "src/assets/diagram.png"));
  // Another thread replaces the image 0.3 s after shrinking starts, while the engine works on it
  // (seconds, for hero.png): as a design tool's export or a branch switch would.
  const go = new Int32Array(new SharedArrayBuffer(4));
  const writer = new Worker(
    `const { workerData: { go, file, replacement } } = require("node:worker_threads");
const { renameSync, writeFileSync } = require("node:fs");
Atomics.wait(go, 0, 0);
Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 300);
writeFileSync(file + ".new", replacement);
renameSync(file + ".new", file);`,
    { eval: true, workerData: { go, file, replacement } },
  );
  await once(writer, "online");
  Atomics.store(go, 0, 1);
  Atomics.notify(go, 0);
  assert.throws(() => shrink(file, file), { message: "changed while shrinking; left as is" });
  await once(writer, "exit");
  assert.deepEqual(readFileSync(file), replacement);
});

test("--flagged shrinks only the bytes the lint measured, checked again when an image's turn comes", async () => {
  const dir = project({ images: ["src/assets/crystal-ball.png", "public/unused-fire.png"] });
  const file = join(dir, "src/assets/crystal-ball.png");
  const measured = readFileSync(file);
  const lint = { key: key(measured), target: undefined };
  // other bytes there by the time its turn comes, after the list was checked as the run started (a
  // branch switch, an export): on the pool's engines, as in a run of several images, and alone
  const other = readFileSync(join(dir, "public/unused-fire.png"));
  writeFileSync(file, other);
  const replies = [];
  await pool([{ size: other.length, peak: peakOf(other), message: { file, target: undefined, out: file, lint } }], { done: (job, reply) => replies.push(reply) });
  assert.deepEqual(replies, [{ error: "changed since the last lint here; left as is (lint again to check it)" }]);
  assert.throws(() => shrink(file, file, undefined, lint), { message: "changed since the last lint here; left as is (lint again to check it)" });
  assert.deepEqual(readFileSync(file), other);
  // the bytes it measured are shrunk
  writeFileSync(file, measured);
  assert.match(shrink(file, file, undefined, lint).text, /^35 kB → 11 kB /);
});

// fade() makes the engine panic at target 70 (a bug upstream), so these come last: a panic leaves
// this thread's engine holding memory it can't free.

test("an image the automatic target can't make close enough is left alone by the command", () => {
  const dir = project({ images: [], files: { "fade.png": fade() } });
  const file = join(dir, "fade.png");
  const before = readFileSync(file);
  const { text } = shrink(file, file);
  assert.match(text, /^slimdeer can't make it smaller without a visible difference \(the best reaches quality \d+\/100\); left as is$/);
  assert.deepEqual(readFileSync(file), before);
});

test("the automatic target's second try can fail: the image is a miss, and the engine says it panicked", () => {
  const result = compress(fade());
  assert.equal(result.outcome, "miss");
  assert.ok(Math.round(result.score) < 70);
  assert.equal(trapped(), true);
});

test("a batch caches such an image as a miss, not as a failure", async () => {
  const dir = project({ images: [], files: { "fade.png": fade() } });
  const file = join(dir, "fade.png");
  const result = await fill({ dir: join(dir, "cache"), files: [file] });
  assert.deepEqual([result.computed, result.failed], [1, 0]);
  const entry = read(join(dir, "cache"), key(readFileSync(file)));
  assert.equal(entry.outcome, "miss");
  assert.equal(entry.failed, undefined);
  // the floor alone kept it from being reported, which the lint says (rule.js)
  assert.equal(result.declined, 1);
  assert.equal((await fill({ dir: join(dir, "cache"), files: [file] })).declined, 0);
  // by the request's thresholds: one it wouldn't report anyway isn't counted
  assert.equal((await fill({ dir: join(dir, "strict"), files: [file], minSavedPercent: 95 })).declined, 0);
});
