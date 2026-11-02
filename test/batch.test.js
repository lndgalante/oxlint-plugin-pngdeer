import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync } from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import os from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";
import { Worker } from "node:worker_threads";
import { fill, pool } from "../src/batch.js";
import { plugin, project } from "./helpers.js";

test("a constrained container runs large jobs one at a time", async (t) => {
  const dir = project({ images: [] });
  t.mock.method(os, "availableParallelism", () => 4);
  syncBuiltinESMExports();
  t.after(() => {
    t.mock.restoreAll();
    syncBuiltinESMExports();
  });
  t.mock.method(process, "constrainedMemory", () => 256e6);
  let active = 0;
  let maximum = 0;
  const postMessage = Worker.prototype.postMessage;
  t.mock.method(Worker.prototype, "postMessage", function (...args) {
    maximum = Math.max(maximum, ++active);
    this.once("message", () => active--);
    return postMessage.apply(this, args);
  });
  const jobs = Array.from({ length: 4 }, () => ({ peak: 128e6, message: { file: join(dir, "missing.png") } }));
  let finished = 0;
  await pool(jobs, { done: (_, reply) => {
    assert.equal(reply.error, "no such file or folder");
    finished++;
  } });
  assert.equal(finished, jobs.length);
  assert.equal(maximum, 1);
});

test("copies of one image are measured once, and the count reaches its total", async () => {
  const dir = project({ images: ["src/assets/crystal-ball.png", "public/unused-fire.png"] });
  const files = ["a.png", "b.png", "c.png"].map((name) => join(dir, name));
  for (const file of files) cpSync(join(dir, "src/assets/crystal-ball.png"), file);
  files.push(join(dir, "public/unused-fire.png"));
  const started = [];
  const counts = [];
  const request = { dir: join(dir, "cache"), files };
  const batch = () => fill(request, (done, total) => counts.push(`${done}/${total}`), (total) => started.push(total));
  // two at once, as ESLint's --concurrency threads start them: the one that waits for the other's
  // lock finds everything cached, and says nothing
  const [first, second] = await Promise.all([batch(), batch()]);
  assert.deepEqual(started, [2]);
  assert.deepEqual(counts, ["1/2", "2/2"]);
  assert.deepEqual([first.computed, first.cached, second.computed, second.cached], [2, 2, 0, 4]);
});

test("off a terminal, the count is a line every 30 s", () => {
  const script = `import { progressLine } from ${JSON.stringify(pathToFileURL(join(plugin, "src", "progress.js")).href)};
const progress = progressLine();
progress(1, 40);
Date.now = ((now) => () => now + 31_000)(Date.now());
progress(2, 40);
progress(3, 40);
`;
  const run = spawnSync(process.execPath, ["--input-type=module", "-e", script], { encoding: "utf8" });
  assert.equal(run.status, 0, run.stderr);
  assert.equal(run.stderr, "pngdeer: measured 2 of 40 images...\n");
});

test("a batch stopped for taking too long leaves no lock for its own process to wait on", () => {
  const images = ["public/hero.png", "public/photo.jpg", "src/assets/diagram.png"];
  const dir = project({ images });
  const cache = join(dir, "node_modules", ".cache", "pngdeer");
  // by 1 s the batch holds the lock and is still measuring (about 4 s on 16 cores); stopped, it can't
  // release the lock, which held this process's pid, so a later batch here would wait 15 minutes
  const script = `import { existsSync } from "node:fs";
import { fillSync } from ${JSON.stringify(pathToFileURL(join(plugin, "src", "sync.js")).href)};
try {
  fillSync(${JSON.stringify({ dir: cache, files: images.map((image) => join(dir, image)) })});
} catch (error) {
  console.log(error.after ? "stopped" : error.message);
}
console.log(existsSync(${JSON.stringify(join(cache, "measuring.lock"))}) ? "locked" : "unlocked");
`;
  const run = spawnSync(process.execPath, ["--input-type=module", "-e", script], { encoding: "utf8", env: { ...process.env, PNGDEER_TIMEOUT_MS: "1000" }, timeout: 60_000 });
  assert.equal(run.stdout, "stopped\nunlocked\n", run.stderr);
});
