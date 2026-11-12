// This file keeps the old word "pngdeer" on purpose: it pins what the rename to slimdeer must not
// lose. Files the command wrote before 0.6.0 carry the mark "pngdeer <size>", and they must stay
// recognized and untouched.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";
import { mark, marked } from "../src/marker.js";

const root = fileURLToPath(new URL("..", import.meta.url));
const fixture = (path) => join(root, path);
const read = (path) => readFileSync(fixture(path));
const marks = ["docs/images/crystal-ball.optimized.png", "docs/images/showcase/multabot/flotas.optimized.jpg"];

// the command's file, whatever the package's bin is called
const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const bin = join(root, Object.values(manifest.bin)[0]);
const run = (cwd, ...args) => spawnSync(process.execPath, [bin, ...args], { cwd, encoding: "utf8", timeout: 300_000 });

const dirs = [];
after(() => dirs.forEach((dir) => rmSync(dir, { recursive: true, force: true })));

/** A temporary folder holding copies of the two files the command wrote before 0.6.0. */
function copies() {
  const dir = mkdtempSync(join(tmpdir(), "rename-compat-"));
  dirs.push(dir);
  for (const path of marks) copyFileSync(fixture(path), join(dir, basename(path)));
  return dir;
}

test("(a) files the command wrote before 0.6.0 are recognized as marked", () => {
  for (const path of marks) {
    const bytes = read(path);
    assert.equal(marked(bytes), true, path);
    assert.match(bytes.toString("latin1"), /pngdeer \d+/, path);
  }
});

test("(b) mark() still writes the old word", () => {
  const png = read("example/src/assets/crystal-ball.png");
  assert.ok(mark(png).toString("latin1").includes(`Software\0pngdeer ${png.length}`));
  const jpeg = read("example/public/photo.jpg");
  const text = Buffer.from(`pngdeer ${jpeg.length}`, "latin1");
  const segment = Buffer.concat([Buffer.from([0xff, 0xfe, 0, 2 + text.length]), text]);
  assert.ok(mark(jpeg).includes(segment));
});

test("(c) the command leaves those files as they are", () => {
  const dir = copies();
  for (const path of marks) {
    const file = basename(path);
    const before = read(path);
    const result = run(dir, file);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout.trim(), /; left as is$/);
    assert.deepEqual(readFileSync(join(dir, file)), before, file);
  }
});

test("(d) --check skips them", () => {
  const dir = copies();
  const { status, stdout, stderr } = run(dir, "--check", "--json");
  assert.equal(status, 0, stderr);
  const report = JSON.parse(stdout);
  assert.equal(report.counts.skipped, 2);
  assert.deepEqual(report.images, []);
});
