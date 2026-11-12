// Lint rules are synchronous and oxlint runs them all on one JS thread, so a batch that has to
// finish before the rule reports runs in a worker while this thread blocks on Atomics.wait (the
// pattern synckit uses for eslint-plugin-prettier). No child process: no fork of oxlint's large
// address space.
import { MessageChannel, receiveMessageOnPort } from "node:worker_threads";
import { unlock } from "./batch.js";
import { count } from "./text.js";
import { startWorker } from "./threads.js";

// A worker that dies without answering (out of memory, say) must not hang the lint forever. The
// tests shorten it with SLIMDEER_TIMEOUT_MS.
const TIMEOUT_MS = Number(process.env.SLIMDEER_TIMEOUT_MS) || 15 * 60 * 1000;
const LIMIT = TIMEOUT_MS < 60000 ? `${TIMEOUT_MS / 1000} s` : count(TIMEOUT_MS / 60000, "minute");

/** fill(request) from batch.js, waited for synchronously. */
export function fillSync(request) {
  const signal = new Int32Array(new SharedArrayBuffer(4));
  const { port1, port2 } = new MessageChannel();
  const worker = startWorker(new URL("./fill-worker.js", import.meta.url), {
    workerData: { request, signal, port: port2 },
    transferList: [port2],
  });
  const thread = worker.threadId;
  // Errors cannot reach this thread while Atomics.wait blocks it. The timeout reports failure;
  // consume the later event so an engine startup error cannot crash the linter afterward.
  worker.on("error", () => {});
  const status = Atomics.wait(signal, 0, 0, TIMEOUT_MS);
  const reply = receiveMessageOnPort(port1)?.message;
  port1.close();
  if (status === "timed-out" || !reply) {
    // its engines would go on computing next to whatever runs after; stopped, it can't release the lock
    worker.terminate();
    unlock(request.failures ?? request.dir, thread);
    const why = status === "timed-out" ? `stopped measuring after ${LIMIT}` : "measuring stopped without an answer (out of memory?)";
    const error = new Error(`slimdeer: ${why}; what it measured is cached, so the next run here carries on (in CI, only if the cache is kept between runs)`);
    // the lint reports a run that ran out of time as incomplete (rule.js)
    if (status === "timed-out") error.after = LIMIT;
    throw error;
  }
  worker.unref();
  if (reply.error) throw new Error(`slimdeer: ${reply.error}`);
  return reply.result;
}

// The editor's background batches: one at a time per process, whatever arrives meanwhile goes in
// the next one, so fill()'s pool and memory budget hold for the whole language server. Files are
// keyed by cache folder and target, as a batch has one of each.
const queued = new Map(); // `${dir}\0${target}` -> { dir, target, files: Set }
const pending = new Set(); // `${dir}\0${target}\0${file}`, queued or being measured
const failedAt = new Map(); // `${dir}\0${target}` -> when its last batch failed
const RETRY_MS = 5 * 60 * 1000;
let running = false;

function drain() {
  const [group, batch] = queued.entries().next().value ?? [];
  if (running || !batch) return;
  queued.delete(group);
  running = true;
  const files = [...batch.files];
  // a core stays free for the language server, which keeps linting meanwhile
  const worker = startWorker(new URL("./fill-worker.js", import.meta.url), { workerData: { request: { ...batch, files, spare: 1 } } });
  // read now: by its exit, a worker's threadId is -1
  const thread = worker.threadId;
  // an error thrown here would take the whole language server down with it
  worker.on("error", () => {});
  worker.on("exit", (code) => {
    if (code !== 0) {
      failedAt.set(group, Date.now());
      // a batch that died (out of memory) left its lock, which every later batch would wait on
      unlock(batch.failures ?? batch.dir, thread);
    }
    for (const file of files) pending.delete(`${group}\0${file}`);
    running = false;
    drain();
  });
  worker.unref();
}

/** fill(request) in the background, for the editor: nothing waits, nothing is reported late. */
export function fillInBackground({ dir, failures, target, files }) {
  const group = `${dir}\0${target}`;
  if (Date.now() - (failedAt.get(group) ?? -Infinity) < RETRY_MS) return;
  const batch = queued.get(group) ?? { dir, failures, target, files: new Set() };
  for (const file of files) {
    if (pending.has(`${group}\0${file}`)) continue;
    pending.add(`${group}\0${file}`);
    batch.files.add(file);
  }
  if (batch.files.size) queued.set(group, batch);
  drain();
}
