// Runs one batch (batch.js) off the lint thread; sync.js waits on `signal` when it needs the answer.
import { workerData } from "node:worker_threads";
import { fill } from "./batch.js";
import { progressLine, startLine } from "./progress.js";

const { request, signal, port } = workerData;
// The lint thread is blocked on `signal`, so it can't print: the batch writes to stderr directly. It
// says what it measures once the batch holds the lock, so a thread that waited for another's batch
// (ESLint's --concurrency) and finds it all cached says nothing. On a terminal the count rewrites it.
const progress = request.progress ? progressLine() : undefined;
const onStart = request.progress ? startLine : undefined;
let reply;
try {
  reply = { result: await fill(request, progress, onStart) };
} catch (error) {
  // the code tells the lint a cache folder it may not write (rule.js)
  reply = { error: String(error?.message ?? error), code: error?.code };
  // a background batch has no one to tell but its exit code
  process.exitCode = 1;
}
port?.postMessage(reply);
port?.close();
if (signal) {
  Atomics.store(signal, 0, 1);
  Atomics.notify(signal, 0);
}
