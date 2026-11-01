import assert from "node:assert/strict";
import { syncBuiltinESMExports } from "node:module";
import os from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { Worker } from "node:worker_threads";
import { pool } from "../src/batch.js";
import { project } from "./helpers.js";

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
    assert.equal(reply.error, "no such file");
    finished++;
  } });
  assert.equal(finished, jobs.length);
  assert.equal(maximum, 1);
});
