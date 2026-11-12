import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, readFileSync } from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import os from "node:os";
import { join, sep } from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";
import { Worker } from "node:worker_threads";
import { fill, fillAll, pool } from "../src/batch.js";
import { key, read } from "../src/cache.js";
import { fade, plugin, project } from "./helpers.js";

const batch = JSON.stringify(pathToFileURL(join(plugin, "src", "batch.js")).href);

/** Mocks os.availableParallelism (and anything else in `os`) for batch.js, until the test ends. */
function machine(t, mocks) {
  for (const [name, value] of Object.entries(mocks)) t.mock.method(os, name, () => value);
  syncBuiltinESMExports();
  t.after(() => {
    t.mock.restoreAll();
    syncBuiltinESMExports();
  });
}

/** The most messages the pool's engines had at once, and the engine (thread) each message went to, in order. */
function watchEngines(t) {
  const seen = { maximum: 0, threads: [], files: [] };
  let active = 0;
  const postMessage = Worker.prototype.postMessage;
  t.mock.method(Worker.prototype, "postMessage", function (...args) {
    seen.maximum = Math.max(seen.maximum, ++active);
    seen.threads.push(this.threadId);
    seen.files.push(args[0].file);
    this.once("message", () => active--);
    return postMessage.apply(this, args);
  });
  return seen;
}

/** A script run by node with `env` added: its stdout and stderr, or a failure if it runs a minute. */
function script(source, env = {}) {
  const run = spawnSync(process.execPath, ["--input-type=module", "-e", source], { encoding: "utf8", env: { ...process.env, ...env }, timeout: 60_000 });
  assert.equal(run.status, 0, run.error?.message ?? run.stderr);
  return run;
}

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
  // release the lock, which held this process's pid, so a later batch here would wait until it went stale
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

test("a machine without a container limit gets a quarter of its own memory, whatever Linux reports", async (t) => {
  // where a cgroup sets no limit, Node reports one of about 1.8e19 bytes (nodejs/node#59227)
  machine(t, { availableParallelism: 4, totalmem: 1e9 });
  t.mock.method(process, "constrainedMemory", () => 18446744073709552000);
  const seen = watchEngines(t);
  const dir = project({ images: [] });
  const jobs = Array.from({ length: 4 }, () => ({ peak: 200e6, message: { file: join(dir, "missing.png") } }));
  await pool(jobs, { done: () => {} });
  // a budget of 250 MB: two of these at once would need 400 MB
  assert.equal(seen.maximum, 1);
});

test("a batch uses every core, but the editor's leaves one for the editor", async (t) => {
  machine(t, { availableParallelism: 2 });
  const dir = project({ images: [] });
  const jobs = Array.from({ length: 2 }, () => ({ peak: 1e6, message: { file: join(dir, "missing.png") } }));
  const seen = watchEngines(t);
  await pool(jobs, { done: () => {} });
  assert.equal(seen.maximum, 2);
  seen.maximum = 0;
  await pool(jobs, { done: () => {}, spare: 1 });
  assert.equal(seen.maximum, 1);
});

test("the pool starts with the smallest file, then goes largest first", async (t) => {
  machine(t, { availableParallelism: 1 });
  const dir = project({ images: [] });
  // expected memory says otherwise: the order follows the files' sizes
  const jobs = [
    { size: 1000, peak: 2e6, message: { file: join(dir, "small.png") } },
    { size: 3000, peak: 1e6, message: { file: join(dir, "large.png") } },
    { size: 2000, peak: 3e6, message: { file: join(dir, "middle.png") } },
  ];
  const seen = watchEngines(t);
  await pool(jobs, { done: () => {} });
  assert.deepEqual(seen.files.map((file) => file.slice(dir.length + 1)), ["small.png", "large.png", "middle.png"]);
});

test("an image with many pixels in a small file still runs within the memory budget", async (t) => {
  // a budget of 1.2 GB on 4 cores
  machine(t, { availableParallelism: 4, totalmem: 4.8e9 });
  t.mock.method(process, "constrainedMemory", () => 0);
  const dir = project({ images: [] });
  const job = (name, size, peak) => ({ size, peak, message: { file: join(dir, name) } });
  // Engines that measured a photo keep its memory (under BIG, so they aren't replaced). The flat
  // screenshot's file is small, so it comes last, when the other engines are idle.
  const jobs = [job("icon.png", 5e3, 60e6), ...Array.from({ length: 6 }, (_, i) => job(`photo${i}.png`, 500e3, 280e6)), job("screenshot.png", 100e3, 900e6)];
  const peaks = new Map(jobs.map(({ peak, message }) => [message.file, peak]));
  const held = new Map(); // engine -> the largest peak it was sent, until it's stopped
  let most = 0;
  const postMessage = Worker.prototype.postMessage;
  t.mock.method(Worker.prototype, "postMessage", function (message) {
    held.set(this, Math.max(held.get(this) ?? 0, peaks.get(message.file)));
    most = Math.max(most, [...held.values()].reduce((sum, peak) => sum + peak, 0));
    return postMessage.call(this, message);
  });
  const terminate = Worker.prototype.terminate;
  t.mock.method(Worker.prototype, "terminate", function () {
    held.delete(this);
    return terminate.call(this);
  });
  await pool(jobs, { done: () => {} });
  assert.ok(most <= 1.2e9, `held ${most / 1e6} MB`);
});

test("an engine that panicked is replaced before the next image", async (t) => {
  machine(t, { availableParallelism: 1 });
  const dir = project({ images: ["src/assets/crystal-ball.png", "public/unused-fire.png"], files: { "fade.png": fade() } });
  // smallest first, then largest: unused-fire (13 kB), fade (154 kB), crystal-ball (35 kB). fade
  // panics at target 70 (a bug upstream), which leaves its engine holding memory it can't free; if
  // that bug is ever fixed, this test needs another image the engine panics on
  const files = ["public/unused-fire.png", "fade.png", "src/assets/crystal-ball.png"].map((file) => join(dir, file));
  const jobs = files.map((file) => ({ size: readFileSync(file).length, peak: 60e6, message: { file, target: 70 } }));
  const seen = watchEngines(t);
  const replies = new Map();
  await pool(jobs, { done: (job, reply) => replies.set(job.message.file, reply) });
  assert.match(replies.get(files[1]).error, /unreachable/);
  assert.equal(replies.get(files[2]).outcome, "hit");
  const [first, second, third] = seen.threads;
  assert.equal(second, first);
  assert.notEqual(third, first);
});

test("one pool measures several projects, each into its own cache folder", async () => {
  const a = project({ images: ["src/assets/crystal-ball.png"] });
  const b = project({ images: ["src/assets/crystal-ball.png", "public/unused-fire.png"] });
  const requests = [
    { dir: join(a, "cache"), files: [join(a, "src/assets/crystal-ball.png")] },
    { dir: join(b, "cache"), files: [join(b, "src/assets/crystal-ball.png"), join(b, "public/unused-fire.png")] },
  ];
  const started = [];
  const counts = [];
  const result = await fillAll(requests, (done, total) => counts.push(`${done}/${total}`), (total) => started.push(total));
  assert.deepEqual(started, [3]);
  assert.deepEqual(counts, ["1/3", "2/3", "3/3"]);
  assert.deepEqual([result.computed, result.cached, result.failed, result.errors.size], [3, 0, 0, 0]);
  const ball = key(readFileSync(join(a, "src/assets/crystal-ball.png")));
  const fire = key(readFileSync(join(b, "public/unused-fire.png")));
  assert.equal(read(join(a, "cache"), ball).outcome, "hit");
  assert.equal(read(join(a, "cache"), fire), null);
  assert.equal(read(join(b, "cache"), ball).outcome, "hit");
  assert.equal(read(join(b, "cache"), fire).outcome, "hit");
});

test("a project whose cache can't be written is left out, and the others are measured", async () => {
  const a = project({ images: ["src/assets/crystal-ball.png"] });
  const b = project({ images: ["public/unused-fire.png"] });
  // a cache folder inside a file can't be created, on any platform
  const broken = { dir: join(b, "package.json", "cache"), files: [join(b, "public/unused-fire.png")] };
  const result = await fillAll([{ dir: join(a, "cache"), files: [join(a, "src/assets/crystal-ball.png")] }, broken]);
  assert.equal(result.computed, 1);
  assert.deepEqual([...result.errors.keys()], [broken]);
  assert.ok(result.errors.get(broken) instanceof Error);
  await assert.rejects(fill(broken), (error) => error === result.errors.get(broken) || error instanceof Error);
});

test("one cache folder spelled two ways is locked once", () => {
  const dir = project({ images: ["src/assets/crystal-ball.png", "public/unused-fire.png"] });
  const cache = join(dir, "cache");
  // locked twice, the second lock would wait for the first, held by the same run, for good
  const requests = [
    { dir: cache, files: [join(dir, "src/assets/crystal-ball.png")] },
    { dir: `${cache}${sep}`, files: [join(dir, "public/unused-fire.png")] },
  ];
  const run = script(`import { fillAll } from ${batch};
const { computed } = await fillAll(${JSON.stringify(requests)});
console.log(computed);
`);
  assert.equal(run.stdout, "2\n");
});

test("a lock left by a process that had this one's pid is taken once a minute has passed", () => {
  const dir = project({ images: ["src/assets/crystal-ball.png"] });
  const cache = join(dir, "node_modules", ".cache", "pngdeer");
  // a lint killed two minutes ago in a container left it, and this run got the same pid
  const run = script(`import { mkdirSync, utimesSync, writeFileSync } from "node:fs";
import { fill } from ${batch};
mkdirSync(${JSON.stringify(cache)}, { recursive: true });
const lock = ${JSON.stringify(join(cache, "measuring.lock"))};
writeFileSync(lock, \`\${process.pid} 1\`);
const then = new Date(Date.now() - 120_000);
utimesSync(lock, then, then);
const { computed } = await fill({ dir: ${JSON.stringify(cache)}, files: [${JSON.stringify(join(dir, "src/assets/crystal-ball.png"))}] });
console.log(computed);
`);
  assert.equal(run.stdout, "1\n");
  // taken at once, without waiting
  assert.doesNotMatch(run.stderr, /waiting/);
});

test("waiting on such a lock, a run says so", () => {
  const dir = project({ images: ["src/assets/crystal-ball.png"] });
  const cache = join(dir, "node_modules", ".cache", "pngdeer");
  // with a lock stale after 4 s, refreshed every 0.67 s: one 2.5 s old isn't refreshed by anyone
  const run = script(`import { mkdirSync, utimesSync, writeFileSync } from "node:fs";
import { fill } from ${batch};
mkdirSync(${JSON.stringify(cache)}, { recursive: true });
const lock = ${JSON.stringify(join(cache, "measuring.lock"))};
writeFileSync(lock, \`\${process.pid} 1\`);
const then = new Date(Date.now() - 2500);
utimesSync(lock, then, then);
const { computed } = await fill({ dir: ${JSON.stringify(cache)}, files: [${JSON.stringify(join(dir, "src/assets/crystal-ball.png"))}] });
console.log(computed);
`, { PNGDEER_STALE_MS: "4000" });
  assert.equal(run.stdout, "1\n");
  // nothing to delete by hand: the lock goes stale by itself
  assert.match(run.stderr, /^pngdeer: waiting for another lint measuring this project \(if none is running, this one goes on within a minute\)$/m);
});

test("a batch keeps its lock fresh for as long as it holds it, and only its own", () => {
  const dir = project({ images: [] });
  const run = script(`import { mkdirSync, statSync, utimesSync, writeFileSync, existsSync } from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";
import { lock } from ${batch};
const folder = ${JSON.stringify(join(dir, "cache"))};
mkdirSync(folder);
const path = ${JSON.stringify(join(dir, "cache", "measuring.lock"))};
const release = await lock(folder);
const then = new Date(Date.now() - 3_600_000);
utimesSync(path, then, then);
const old = () => statSync(path).mtimeMs < Date.now() - 1_800_000;
for (let i = 0; i < 100 && old(); i++) await sleep(50);
console.log(old() ? "stale" : "refreshed");
// another batch took it over: its lock isn't refreshed, or removed, by this one
writeFileSync(path, "1 1");
utimesSync(path, then, then);
await sleep(500);
console.log(old() ? "left alone" : "refreshed");
release();
console.log(existsSync(path) ? "kept" : "removed");
`, { PNGDEER_STALE_MS: "600" });
  assert.equal(run.stdout, "refreshed\nleft alone\nkept\n");
});

test("a lint blocked waiting for its batch still keeps the batch's lock fresh", () => {
  const dir = project({ images: ["public/hero.png"] });
  const cache = join(dir, "node_modules", ".cache", "pngdeer");
  // Stale after 2 s, refreshed every 0.33 s, and hero.png takes seconds. The batch's own thread holds
  // the lock while this one waits in fillSync, as the lint thread does; a third thread, not blocked,
  // watches the lock's age. (execArgv: [] keeps --input-type=module from the eval'd watcher.)
  const run = script(`import { Worker } from "node:worker_threads";
import { fillSync } from ${JSON.stringify(pathToFileURL(join(plugin, "src", "sync.js")).href)};
const oldest = new Float64Array(new SharedArrayBuffer(8));
const watcher = new Worker(\`const { workerData: { lock, oldest } } = require("node:worker_threads");
const { statSync } = require("node:fs");
setInterval(() => {
  try { oldest[0] = Math.max(oldest[0], Date.now() - statSync(lock).mtimeMs); } catch {}
}, 50);\`, { eval: true, execArgv: [], workerData: { lock: ${JSON.stringify(join(cache, "measuring.lock"))}, oldest } });
await new Promise((resolve) => watcher.once("online", resolve));
const { computed } = fillSync(${JSON.stringify({ dir: cache, files: [join(dir, "public/hero.png")] })});
await watcher.terminate();
console.log(computed, oldest[0] < 2000 ? "fresh" : \`\${Math.round(oldest[0])} ms old\`);
`, { PNGDEER_STALE_MS: "2000" });
  assert.equal(run.stdout, "1 fresh\n");
});

test("off a terminal, the count adds up what the images measured so far could save", () => {
  const run = script(`import { progressLine } from ${JSON.stringify(pathToFileURL(join(plugin, "src", "progress.js")).href)};
const progress = progressLine();
progress(1, 40, { saved: 3000 });
Date.now = ((now) => () => now + 31_000)(Date.now());
progress(2, 40, { saved: 1500 });
progress(3, 40, { saved: 0 });
`);
  assert.equal(run.stderr, "pngdeer: measured 2 of 40 images, could save 4.5 kB so far...\n");
});

test("off a terminal, the last image's count is left to the caller, even after a long wait for the lock", () => {
  const run = script(`import { progressLine } from ${JSON.stringify(pathToFileURL(join(plugin, "src", "progress.js")).href)};
const progress = progressLine();
// the batch waited 61 s for another lint's lock before its one image finished
Date.now = ((now) => () => now + 61_000)(Date.now());
progress(1, 1, { saved: 157000 });
`);
  // not "measured 1 of 1 image, could save 157 kB so far...": the rule's "measured 1 image in …" comes next
  assert.equal(run.stderr, "");
});

test("progress hears which image finished and what it could save, by the request's thresholds", async () => {
  const dir = project({ images: ["src/assets/crystal-ball.png", "public/unused-fire.png"] });
  const files = ["src/assets/crystal-ball.png", "public/unused-fire.png"].map((file) => join(dir, file));
  const heard = new Map();
  const request = { dir: join(dir, "cache"), files, minSavedBytes: 10000 };
  await fill(request, (done, total, info) => heard.set(info.file, info));
  const [ball, fire] = files.map((file) => read(request.dir, key(readFileSync(file))));
  // crystal-ball saves about 24 kB; unused-fire about 5 kB, under the 10 kB asked for
  assert.ok(ball.original - ball.compressed >= 10000 && fire.original - fire.compressed < 10000);
  assert.deepEqual(files.map((file) => heard.get(file)?.saved), [ball.original - ball.compressed, 0]);
  // and the request it came with, so --check can tell which project's image it was
  assert.ok(files.every((file) => heard.get(file).request === request));
});
