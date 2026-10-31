// Runs one batch (batch.js) off the lint thread; sync.js waits on `signal` when it needs the answer.
import { writeSync } from "node:fs";
import { isatty } from "node:tty";
import { workerData } from "node:worker_threads";
import { fill } from "./batch.js";

const { request, signal, port } = workerData;
// A count that rewrites its own line while the lint waits. The lint thread is blocked on `signal`,
// so it can't print; this writes to the terminal directly, and only to a terminal.
const progress = request.progress && isatty(2) ? (done, total) => writeSync(2, `\rpngdeer: measuring ${total} images... ${done}/${total}`) : undefined;
let reply;
try {
  reply = { result: await fill(request, progress) };
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
