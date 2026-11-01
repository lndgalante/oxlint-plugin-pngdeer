import { Worker } from "node:worker_threads";

/** Starts a file worker even when the caller runs code from stdin or `node -e`. */
export function startWorker(url, options) {
  // --input-type only applies to string input; file workers reject it before loading any code.
  const execArgv = process.execArgv.filter((arg, index, args) =>
    arg !== "--input-type" && !arg.startsWith("--input-type=") && args[index - 1] !== "--input-type",
  );
  // Leave Node's default inheritance alone when there is nothing to strip: it can carry
  // internal flags (such as the test runner's) that an explicit execArgv rejects.
  return new Worker(url, execArgv.length === process.execArgv.length ? options : { ...options, execArgv });
}
