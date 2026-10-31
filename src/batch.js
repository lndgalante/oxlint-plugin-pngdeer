// Fills the cache for a list of images, on a pool of worker threads (one wasm engine each, so all
// cores work even though the engine itself is single-threaded), within a memory budget.
import { readFileSync, rmSync } from "node:fs";
import { availableParallelism, totalmem } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { Worker } from "node:worker_threads";
import { cacheDir, key, read, write } from "./cache.js";
import { dimensions, kind, unsupported } from "./images.js";
import { marked } from "./marker.js";

const MAX_WORKERS = 8;
// Wasm memory never shrinks, so a worker that measured an image expected to peak above this is
// replaced rather than kept.
const BIG = 300e6;

/**
 * Computes every file not cached yet; { computed, cached, skipped, failed, ms }. `progress(done,
 * total)` hears about each image the engine finishes.
 */
export async function fill({ cwd, target, files }, progress = () => {}) {
  const start = performance.now();
  const dir = cacheDir(cwd);
  // a cache that can't be written fails here, before any image is compressed for nothing
  write(dir, "probe", {});
  rmSync(join(dir, "probe.json"), { force: true });

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
    if (read(dir, k)) {
      counts.cached++;
      continue;
    }
    if (marked(bytes)) {
      write(dir, k, { original: bytes.length, outcome: "output" });
      counts.skipped++;
      continue;
    }
    const why = unsupported(bytes);
    if (why) {
      write(dir, k, { original: bytes.length, skipped: why });
      counts.skipped++;
      continue;
    }
    const [width, height, frames] = dimensions(bytes, kind(bytes));
    todo.push({ file, k, peak: peak(width * height * frames) });
  }
  // biggest first, so the slowest image doesn't start last
  todo.sort((a, b) => b.peak - a.peak);
  const total = todo.length;

  const record = (job, result) => {
    // the file changed or went away after it was queued: cache nothing, the next lint measures it again
    if (result.input !== job.k) {
      counts.failed++;
      return;
    }
    if (result.error) {
      write(dir, job.k, { skipped: result.error, failed: true });
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
      // the same bytes may have been marked as pngdeer's output since the batch started
      if (read(dir, job.k)) {
        counts.cached++;
        continue;
      }
      self.busy = true;
      self.held = Math.max(self.held, job.peak);
      self.worker ??= new Worker(new URL("./worker.js", import.meta.url), { workerData: { target } });
      try {
        record(job, await ask(self.worker, { file: job.file }));
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
        progress(counts.computed + counts.failed, total);
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
  return { ...counts, ms: Math.round(performance.now() - start) };
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

// `node src/batch.js` with { cwd, target, files } as JSON on stdin, for trying it outside a linter
if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const request = JSON.parse(readFileSync(0, "utf8"));
  process.stdout.write(JSON.stringify(await fill(request)));
}
