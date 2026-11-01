import assert from "node:assert/strict";
import { renameSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { fileKey, key, reportable } from "../src/cache.js";
import { project } from "./helpers.js";

test("a same-size replacement with preserved mtime gets a new content key", () => {
  const dir = project({ images: [] });
  const file = join(dir, "image.png");
  const replacement = join(dir, "replacement.png");
  const time = new Date("2020-01-01T00:00:00Z");
  writeFileSync(file, "before");
  utimesSync(file, time, time);
  const before = fileKey(file);
  assert.equal(fileKey(file), before);
  writeFileSync(replacement, "after!");
  utimesSync(replacement, time, time);
  renameSync(replacement, file);
  const after = fileKey(file);
  assert.notEqual(after.key, before.key);
  assert.equal(after.key, key(Buffer.from("after!")));
});

test("zero thresholds still require an actual saving", () => {
  const options = { minSavedBytes: 0, minSavedPercent: 0 };
  const entry = { original: 100, compressed: 100, outcome: "lossless" };
  assert.equal(reportable(entry, options), false);
  assert.equal(reportable({ ...entry, compressed: 101 }, options), false);
  assert.equal(reportable({ ...entry, compressed: 99 }, options), true);
});

test("percentage thresholds compare exact savings before display rounding", () => {
  const options = { minSavedBytes: 0, minSavedPercent: 10 };
  const entry = { original: 1000, compressed: 905, outcome: "hit" };
  assert.equal(reportable(entry, options), false);
  assert.equal(reportable({ ...entry, compressed: 900 }, options), true);
});
