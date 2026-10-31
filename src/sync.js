// Lint rules are synchronous and oxlint runs them all on one JS thread, so a batch that has to
// finish before the rule reports runs in a worker while this thread blocks on Atomics.wait (the
// pattern synckit uses for eslint-plugin-prettier). No child process: no fork of oxlint's large
// address space.
import { MessageChannel, Worker, receiveMessageOnPort } from "node:worker_threads";

// A worker that dies without answering (out of memory, say) must not hang the lint forever.
const TIMEOUT_MS = 15 * 60 * 1000;

/** fill(request) from batch.js, waited for synchronously. */
export function fillSync(request) {
  const signal = new Int32Array(new SharedArrayBuffer(4));
  const { port1, port2 } = new MessageChannel();
  const worker = new Worker(new URL("./fill-worker.js", import.meta.url), {
    workerData: { request, signal, port: port2 },
    transferList: [port2],
  });
  const status = Atomics.wait(signal, 0, 0, TIMEOUT_MS);
  const reply = receiveMessageOnPort(port1)?.message;
  port1.close();
  if (status === "timed-out" || !reply) {
    // its engines would go on computing next to whatever runs after
    worker.terminate();
    const why = status === "timed-out" ? `stopped measuring after ${TIMEOUT_MS / 60000} minutes` : "measuring stopped without an answer (out of memory?)";
    throw new Error(`pngdeer: ${why}; what it measured is cached, and the next run carries on`);
  }
  worker.unref();
  if (reply.error) throw new Error(`pngdeer: ${reply.error}`);
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
  const worker = new Worker(new URL("./fill-worker.js", import.meta.url), { workerData: { request: { ...batch, files } } });
  // an error thrown here would take the whole language server down with it
  worker.on("error", () => {});
  worker.on("exit", (code) => {
    if (code !== 0) failedAt.set(group, Date.now());
    for (const file of files) pending.delete(`${group}\0${file}`);
    running = false;
    drain();
  });
  worker.unref();
}

/** fill(request) in the background, for the editor: nothing waits, nothing is reported late. */
export function fillInBackground({ dir, target, files }) {
  const group = `${dir}\0${target}`;
  if (Date.now() - (failedAt.get(group) ?? -Infinity) < RETRY_MS) return;
  const batch = queued.get(group) ?? { dir, target, files: new Set() };
  for (const file of files) {
    if (pending.has(`${group}\0${file}`)) continue;
    pending.add(`${group}\0${file}`);
    batch.files.add(file);
  }
  if (batch.files.size) queued.set(group, batch);
  drain();
}
