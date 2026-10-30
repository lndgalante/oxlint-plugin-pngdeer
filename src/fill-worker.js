// Runs one batch (batch.js) off the lint thread; sync.js waits on `signal` when it needs the answer.
import { workerData } from "node:worker_threads";
import { fill } from "./batch.js";

const { request, signal, port } = workerData;
let reply;
try {
  reply = { result: await fill(request) };
} catch (error) {
  reply = { error: String(error?.message ?? error) };
  // a background batch has no one to tell but its exit code
  process.exitCode = 1;
}
port?.postMessage(reply);
port?.close();
if (signal) {
  Atomics.store(signal, 0, 1);
  Atomics.notify(signal, 0);
}
