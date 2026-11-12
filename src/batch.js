// Fills the cache for a list of images, on a pool of worker threads (one wasm engine each, so all
// cores work even though the engine itself is single-threaded), within a memory budget. The command
// shrinks several images on the same pool.
import { readFileSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { availableParallelism, totalmem } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { threadId } from "node:worker_threads";
import { belowFloor, floored, key, legacyKey, read, readFirst, reportable, valid, write } from "./cache.js";
import { dimensions, kind, unsupported } from "./images.js";
import { marked } from "./marker.js";
import { say } from "./progress.js";
import { physical } from "./scan.js";
import { startWorker } from "./threads.js";

const MAX_WORKERS = 8;
// Wasm memory never shrinks, so a worker that measured an image expected to peak above this is
// replaced rather than kept.
const BIG = 300e6;
// A lock its holder hasn't refreshed for this long was left by a batch that's gone, whatever pid it
// names: a container gives the next run the same pids. The tests shorten it with PNGDEER_STALE_MS.
const STALE_MS = Number(process.env.PNGDEER_STALE_MS) || 60_000;
// several times within STALE_MS, so a holder on a busy machine doesn't lose its lock
const HEARTBEAT_MS = STALE_MS / 6;

/**
 * Computes every file of `request` ({ dir, failures = dir, target, files, spare }) not cached yet:
 * { computed, cached, skipped, failed, declined, ms }, `declined` counting the images computed that
 * the quality floor alone kept from being reported (cache.js floored(), by the request's
 * minSavedBytes and minSavedPercent, the rule's defaults if it has none). Once the batch holds the
 * lock, `onStart(total)` hears how many images go to the engine, if any, and
 * `progress(done, total, { saved, file, request })` then hears about each one finished: the bytes it
 * could save (0 unless they clear both), its path and its request. Copies of one image count as
 * cached.
 */
export async function fill(request, progress = () => {}, onStart = () => {}) {
  const { errors, ...result } = await fillAll([request], progress, onStart);
  if (errors.has(request)) throw errors.get(request);
  return result;
}

/**
 * fill() for several requests at once (one per project, each with its own cache folders), on one
 * pool, so no engine sits idle while another project's last images finish. Resolves the counts summed
 * over the requests, and `errors`: a Map from each request left out, because its cache can't be
 * written, to the reason. `onStart` and `progress` count the images of all of them. Rejects, as
 * fill() does, if an engine dies, or if a cache folder fails after its probe (a disk filling up).
 */
export async function fillAll(requests, progress = () => {}, onStart = () => {}) {
  const errors = new Map();
  const ready = requests.filter((request) => {
    try {
      probe(request);
      return true;
    } catch (error) {
      errors.set(request, error);
      return false;
    }
  });
  // each folder once however it's spelled (case, links, a trailing separator), and in one order
  // everywhere: two runs that need some of the same folders never each hold one the other waits for
  const folders = [...new Set(ready.map(({ dir, failures = dir }) => physical(resolve(failures))))].sort();
  const releases = [];
  try {
    for (const folder of folders) releases.push(await lock(folder));
    // `ms` is the measuring alone, not the wait for another batch
    const start = performance.now();
    const counts = await measure(ready, progress, onStart);
    return { ...counts, ms: Math.round(performance.now() - start), errors };
  } finally {
    for (const release of releases) release();
  }
}

// A cache that can't be written fails here, before any image is compressed for nothing; each thread
// probes with its own file, as ESLint's --concurrency threads probe at once.
function probe({ dir, failures = dir }) {
  const name = `probe-${process.pid}-${threadId}`;
  for (const folder of new Set([dir, failures])) {
    write(folder, name, {});
    rmSync(join(folder, `${name}.json`), { force: true });
  }
}

/** fillAll() once it holds the locks: what's cached by then is skipped, the rest goes to one pool. */
async function measure(requests, progress, onStart) {
  const todo = [];
  const queued = new Set(); // each job's folders and key: copies of one image are measured once
  const counts = { computed: 0, cached: 0, skipped: 0, failed: 0, declined: 0 };
  for (const request of requests) {
    const { dir, failures = dir, target } = request;
    for (const file of new Set(request.files)) {
      let bytes;
      try {
        bytes = readFileSync(file);
      } catch {
        continue;
      }
      const k = key(bytes, target);
      const id = `${dir}\0${failures}\0${k}`;
      if (readFirst(k, dir, failures) || queued.has(id)) {
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
      if (target === undefined && carried(bytes, k, dir, failures)) {
        counts.cached++;
        continue;
      }
      queued.add(id);
      todo.push({ request, file, k, size: bytes.length, peak: peakOf(bytes), message: { file, target } });
    }
  }
  if (todo.length) onStart(todo.length);

  // a finished image's result, in its request's folders; returns what it could save
  const record = ({ request, k }, result) => {
    const { dir, failures = dir } = request;
    // the file changed or went away after it was queued: cache nothing, the next lint measures it again
    if (result.input !== k) {
      counts.failed++;
      return 0;
    }
    if (result.error) {
      write(failures, k, { skipped: result.error, failed: true });
      counts.failed++;
      return 0;
    }
    counts.computed++;
    // only what pngdeer computes, the same on every machine, so a committed cache folder changes
    // only when a result does
    const entry = { original: result.original, compressed: result.compressed, outcome: result.outcome, score: result.score };
    // pngdeer writes these same bytes everywhere: if they land on disk, they're done (a JPEG would
    // otherwise lose about another fifth each time it's recompressed). Such a mark is never replaced.
    if (read(dir, k)?.outcome !== "output") write(dir, k, entry);
    if (result.output !== k) write(dir, result.output, { original: entry.compressed, outcome: "output" });
    if (floored(entry, request.target, thresholds(request))) counts.declined++;
    return saving(request, entry);
  };

  const total = todo.length;
  let finished = 0;
  await pool(todo, {
    // the editor's batches leave it a core (sync.js)
    spare: Math.max(0, ...requests.map(({ spare = 0 }) => spare)),
    // the same bytes may have been measured, or marked as pngdeer's output, since the batch started
    skip: (job) => {
      const { dir, failures = dir } = job.request;
      const entry = readFirst(job.k, dir, failures);
      if (!entry) return false;
      counts.cached++;
      progress(++finished, total, { saved: saving(job.request, entry), file: job.file, request: job.request });
      return true;
    },
    done: (job, result) => progress(++finished, total, { saved: record(job, result), file: job.file, request: job.request }),
  });
  return counts;
}

/** What `entry` could save, if that clears the request's thresholds; else 0. */
function saving(request, entry) {
  return reportable(entry, thresholds(request)) ? entry.original - entry.compressed : 0;
}

/** A request's thresholds, the rule's defaults if it has none. */
function thresholds({ minSavedBytes = 4096, minSavedPercent = 10 }) {
  return { minSavedBytes, minSavedPercent };
}

/**
 * Copies 0.5.0's result for `bytes` at the automatic target to its key `k` now, where the quality
 * floor (engine.js) changes nothing, so an upgrade measures again only the images that looked visibly
 * different. Whether it did. (A new engine or cache format leaves nothing to carry: remove it then.)
 */
function carried(bytes, k, dir, failures) {
  const old = readFirst(legacyKey(bytes), dir, failures);
  // what --check would call an invalid measurement (check.js) is measured again instead
  if (!old || !valid(old, bytes.length) || belowFloor(old)) return false;
  const { original, compressed, outcome, score } = old;
  write(dir, k, outcome === "output" ? { original, outcome } : { original, compressed, outcome, score });
  return true;
}

/**
 * Runs `jobs` ({ peak, size, message }) on a pool of engines (worker.js), within the memory budget,
 * the largest file first after the smallest one. `done(job, reply)` gets each reply as it comes; a job
 * `skip(job)` turns down when its turn comes isn't sent. `spare` cores are left to the caller, which
 * has other work. Rejects, with every engine stopped, if one fails or dies.
 */
export async function pool(jobs, { done, skip = () => false, spare = 0 }) {
  // A file's size predicts its time best: the largest first, so the slowest image doesn't start
  // last, but the smallest before them, so the first result lands within a second. Without a size,
  // by expected memory.
  const todo = [...jobs].sort((a, b) => (b.size ?? b.peak) - (a.size ?? a.peak));
  if (todo.length > 1) todo.unshift(todo.pop());
  const limit = budget();
  const lanes = Array.from({ length: Math.min(todo.length, MAX_WORKERS, Math.max(1, availableParallelism() - spare)) }, () => ({ worker: null, held: 0, busy: false }));
  const waiting = [];
  const wake = () => waiting.splice(0).forEach((resolve) => resolve());
  let failure = null;

  const lane = async (self) => {
    while (todo.length && !failure) {
      // the next image that fits next to what the other engines hold; anything, if none is busy
      const others = lanes.reduce((sum, l) => (l === self ? sum : sum + l.held), 0);
      const alone = !lanes.some((l) => l !== self && l.busy);
      const index = todo.findIndex((job) => alone || others + Math.max(self.held, job.peak) <= limit);
      if (index < 0) {
        if (self.worker) {
          // Wasm memory never shrinks, and in this order an image with many pixels in a small file
          // (a flat screenshot) can come last: an idle engine frees what it holds before it waits,
          // so that image never runs on top of it. Then look again, as a wake() may have come meanwhile.
          const worker = self.worker;
          self.worker = null;
          self.held = 0;
          await worker.terminate();
          continue;
        }
        await new Promise((resolve) => waiting.push(resolve));
        continue;
      }
      const [job] = todo.splice(index, 1);
      if (skip(job)) continue;
      self.busy = true;
      self.held = Math.max(self.held, job.peak);
      self.worker ??= startWorker(new URL("./worker.js", import.meta.url));
      try {
        const reply = await ask(self.worker, job.message);
        done(job, reply);
        // a panicked engine keeps what that image used, and may fail the next ones (worker.js)
        if (job.peak > BIG || reply.trapped) {
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
 * Waits until no other batch measures in `folder`, then holds that until `release()`: ESLint's
 * --concurrency lints in several threads, and a command-line lint may start while an editor measures.
 * Whoever waits then finds most images cached.
 */
export async function lock(folder) {
  const path = join(folder, "measuring.lock");
  // the holder's pid and thread, so a process can remove the lock of a thread it stopped (sync.js)
  const mine = `${process.pid} ${threadId}`;
  let told = false;
  for (;;) {
    try {
      writeFileSync(path, mine, { flag: "wx" });
      // refreshed while held, so its age tells a live batch, however long, from one that's gone
      const beat = setInterval(() => {
        if (!refresh(path, mine)) clearInterval(beat);
      }, HEARTBEAT_MS).unref();
      return () => {
        clearInterval(beat);
        unlock(folder);
      };
    } catch (error) {
      // a folder where nothing can be locked: measure anyway
      if (error.code !== "EEXIST") return () => {};
    }
    // recursive: 0.3.0 locked with a folder
    if (abandoned(path)) rmSync(path, { recursive: true, force: true });
    else if (!told && foreign(path)) {
      told = true;
      // a lock nothing refreshes goes stale within STALE_MS (a minute): no one needs to delete it
      say("pngdeer: waiting for another lint measuring this project (if none is running, this one goes on within a minute)\n");
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}

/** Marks the lock at `path` as still held, while it holds `mine`: whether to keep doing so. */
function refresh(path, mine) {
  try {
    if (readFileSync(path, "utf8") !== mine) return false;
    const now = new Date();
    utimesSync(path, now, now);
  } catch (error) {
    // released; any other error, the next beat tries again
    return error.code !== "ENOENT";
  }
  return true;
}

/** Whether the batch holding the lock at `path` is gone: its process ended, or it stopped refreshing the lock. */
function abandoned(path) {
  try {
    if (Date.now() - statSync(path).mtimeMs > STALE_MS) return true;
    // empty while its holder writes it
    const pid = holder(path);
    if (pid) process.kill(pid, 0);
    return false;
  } catch (error) {
    // released meanwhile (ENOENT), or held by another user's process (EPERM)
    return error.code === "ESRCH";
  }
}

/**
 * Whether to say why nothing happens: another process holds the lock (an editor, an earlier lint, or
 * a lock a killed lint left), or this process's pid does but nothing here refreshes it, so it was left
 * by a process that had the same pid. This process's other threads (ESLint's --concurrency) are
 * waited for without a word.
 */
function foreign(path) {
  const pid = holder(path);
  if (pid === 0) return false;
  if (pid !== process.pid) return true;
  try {
    return Date.now() - statSync(path).mtimeMs > 2 * HEARTBEAT_MS;
  } catch {
    return false;
  }
}

/** The pid in the lock at `path`: 0 while its holder writes it, or once it's gone. */
function holder(path) {
  try {
    return Number(readFileSync(path, "utf8").split(" ")[0]);
  } catch {
    return 0;
  }
}

/**
 * Removes the lock in `folder` if this process's thread `thread` holds it: a batch's own when it
 * ends, or one a stopped thread left (sync.js), which this process would otherwise wait on until it
 * goes stale. Another batch's lock stays.
 */
export function unlock(folder, thread = threadId) {
  const path = join(folder, "measuring.lock");
  try {
    if (readFileSync(path, "utf8") === `${process.pid} ${thread}`) rmSync(path, { force: true });
  } catch {
    // released already
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

// A quarter of the memory there is (a container's limit if any), capped at 4 GB.
// One image always runs, however big.
function budget() {
  // Node reports no limit as 0, but on Linux where a cgroup sets none, as about 1.8e19
  const limit = process.constrainedMemory?.() ?? 0;
  const total = limit > 0 && limit < totalmem() ? limit : totalmem();
  return Math.min(total / 4, 4e9);
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
