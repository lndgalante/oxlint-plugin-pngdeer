// Fills the cache for a list of images, on a pool of worker threads (one wasm engine each, so all
// cores work even though the engine itself is single-threaded), within a memory budget. The command
// shrinks several images on the same pool.
import { readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { availableParallelism, totalmem } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { Worker } from "node:worker_threads";
import { key, read, readFirst, write } from "./cache.js";
import { dimensions, kind, unsupported } from "./images.js";
import { marked } from "./marker.js";

const MAX_WORKERS = 8;
// Wasm memory never shrinks, so a worker that measured an image expected to peak above this is
// replaced rather than kept.
const BIG = 300e6;
// A batch holding the lock longer than this died with it (sync.js gives up waiting at 15 minutes too).
const STALE_MS = 15 * 60 * 1000;

/**
 * Computes every file not cached yet; { computed, cached, skipped, failed, ms }. `progress(done,
 * total)` hears about each image the engine finishes.
 */
export async function fill({ dir, failures = dir, target, files }, progress = () => {}) {
  // a result in either folder counts: `failures` keeps what pngdeer failed on, on this machine only
  const cached = (k) => readFirst(k, dir, failures);
  const start = performance.now();
  // a cache that can't be written fails here, before any image is compressed for nothing
  for (const folder of new Set([dir, failures])) {
    write(folder, "probe", {});
    rmSync(join(folder, "probe.json"), { force: true });
  }
  const release = await lock(failures);
  try {
    return await measure({ dir, failures, target, files, cached }, progress, start);
  } finally {
    release();
  }
}

/** fill() once it holds the lock: what's cached by then is skipped, the rest goes to the pool. */
async function measure({ dir, failures, target, files, cached }, progress, start) {
  const todo = [];
  const counts = { computed: 0, cached: 0, skipped: 0, failed: 0 };
  for (const file of new Set(files)) {
    let bytes;
    try {
      bytes = readFileSync(file);
    } catch {
      continue;
    }
    const k = key(bytes, target);
    if (cached(k)) {
      counts.cached++;
      continue;
    }
    // pngdeer's own output needs no engine, and no entry: the rule knows it by its mark
    if (marked(bytes)) {
      counts.skipped++;
      continue;
    }
    const why = unsupported(bytes);
    if (why) {
      write(dir, k, { original: bytes.length, skipped: why });
      counts.skipped++;
      continue;
    }
    todo.push({ file, k, peak: peakOf(bytes), message: { file, target } });
  }

  const record = (job, result) => {
    // the file changed or went away after it was queued: cache nothing, the next lint measures it again
    if (result.input !== job.k) {
      counts.failed++;
      return;
    }
    if (result.error) {
      write(failures, job.k, { skipped: result.error, failed: true });
      counts.failed++;
      return;
    }
    counts.computed++;
    const { input, output, ...entry } = result;
    // pngdeer writes these same bytes everywhere: if they land on disk, they're done (a JPEG would
    // otherwise lose about another fifth each time it's recompressed). Such a mark is never replaced.
    if (read(dir, input)?.outcome !== "output") write(dir, input, entry);
    if (output !== input) write(dir, output, { original: entry.compressed, outcome: "output" });
  };

  const total = todo.length;
  await pool(todo, {
    // the same bytes may have been marked as pngdeer's output since the batch started
    skip: (job) => {
      if (!cached(job.k)) return false;
      counts.cached++;
      return true;
    },
    done: (job, result) => {
      record(job, result);
      progress(counts.computed + counts.failed, total);
    },
  });
  return { ...counts, ms: Math.round(performance.now() - start) };
}

/**
 * Runs `jobs` ({ peak, message }) on a pool of engines (worker.js), biggest first, within the memory
 * budget. `done(job, reply)` gets each reply as it comes; a job `skip(job)` turns down when its turn
 * comes isn't sent. Rejects, with every engine stopped, if one fails or dies.
 */
export async function pool(jobs, { done, skip = () => false }) {
  // biggest first, so the slowest image doesn't start last
  const todo = [...jobs].sort((a, b) => b.peak - a.peak);
  const limit = budget();
  const lanes = Array.from({ length: Math.min(todo.length, MAX_WORKERS, Math.max(1, availableParallelism() - 1)) }, () => ({ worker: null, held: 0, busy: false }));
  const waiting = [];
  const wake = () => waiting.splice(0).forEach((resolve) => resolve());
  let failure = null;

  const lane = async (self) => {
    while (todo.length && !failure) {
      // the biggest image that fits next to what the other engines hold; anything, if none is busy
      const others = lanes.reduce((sum, l) => (l === self ? sum : sum + l.held), 0);
      const alone = !lanes.some((l) => l !== self && l.busy);
      const index = todo.findIndex((job) => alone || others + Math.max(self.held, job.peak) <= limit);
      if (index < 0) {
        await new Promise((resolve) => waiting.push(resolve));
        continue;
      }
      const [job] = todo.splice(index, 1);
      if (skip(job)) continue;
      self.busy = true;
      self.held = Math.max(self.held, job.peak);
      self.worker ??= new Worker(new URL("./worker.js", import.meta.url));
      try {
        done(job, await ask(self.worker, job.message));
        if (job.peak > BIG) {
          await self.worker.terminate();
          self.worker = null;
          self.held = 0;
        }
      } catch (error) {
        failure ??= error;
        // stop the other engines now rather than after their current image
        for (const l of lanes) l.worker?.terminate();
      } finally {
        self.busy = false;
        wake();
      }
    }
  };
  try {
    await Promise.all(lanes.map(lane));
  } finally {
    await Promise.all(lanes.map((l) => l.worker?.terminate()));
  }
  if (failure) throw failure;
}

/**
 * Waits until no other batch measures for this project, then holds that until `release()`: ESLint's
 * --concurrency lints in several threads, and a command-line lint may start while an editor measures.
 * Whoever waits then finds most images cached.
 */
async function lock(folder) {
  const path = join(folder, "measuring.lock");
  for (;;) {
    try {
      // the holder's pid, so a lint stopped while it measured (Ctrl-C, an editor closing) holds nothing
      writeFileSync(path, `${process.pid}`, { flag: "wx" });
      return () => rmSync(path, { force: true });
    } catch (error) {
      // a folder where nothing can be locked: measure anyway
      if (error.code !== "EEXIST") return () => {};
    }
    // recursive: 0.3.0 locked with a folder
    if (abandoned(path)) rmSync(path, { recursive: true, force: true });
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}

/** Whether the batch holding the lock at `path` is gone: its process ended, or it's older than any batch. */
function abandoned(path) {
  try {
    if (Date.now() - statSync(path).mtimeMs > STALE_MS) return true;
    // empty while its holder writes it
    const pid = Number(readFileSync(path, "utf8"));
    if (pid) process.kill(pid, 0);
    return false;
  } catch (error) {
    // released meanwhile (ENOENT), or held by another user's process (EPERM)
    return error.code === "ESRCH";
  }
}

/** An engine's expected peak memory for an image (by its header), for the pool's budget. */
export function peakOf(bytes) {
  const type = kind(bytes);
  const [width, height, frames] = type ? dimensions(bytes, type) : [0, 0, 1];
  return peak(width * height * frames);
}

/** An engine's expected peak memory for an image of this many pixels (over all its frames). */
function peak(pixels) {
  // about 125 bytes a pixel below 8 MP and 85 above (pngdeer keeps a lean reference there), on top
  // of about 50 MB of its own
  return 50e6 + pixels * (pixels < 8e6 ? 125 : 85);
}

// A quarter of the memory there is (a container's limit if any), between 1 and 4 GB. One image
// always runs, however big.
function budget() {
  const total = process.constrainedMemory?.() || totalmem();
  return Math.min(Math.max(total / 4, 1e9), 4e9);
}

// The worker's answer to one message, or a rejection if it fails or exits first.
function ask(worker, message) {
  return new Promise((resolve, reject) => {
    const settle = (fn) => (value) => {
      worker.off("message", onMessage).off("error", onError).off("exit", onExit);
      fn(value);
    };
    const onMessage = settle(resolve);
    const onError = settle(reject);
    const onExit = settle((code) => reject(new Error(`engine exited (${code})`)));
    worker.on("message", onMessage).on("error", onError).on("exit", onExit);
    worker.postMessage(message);
  });
}

// `node src/batch.js` with { dir, target, files } as JSON on stdin (dir: the cache folder), for trying it outside a linter
if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const request = JSON.parse(readFileSync(0, "utf8"));
  process.stdout.write(JSON.stringify(await fill(request)));
}
