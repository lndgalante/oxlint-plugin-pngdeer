// The rule and the command, end to end: oxlint 1.90 linting a small project in a temporary directory.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, cpSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";

const plugin = fileURLToPath(new URL("..", import.meta.url));
const oxlint = join(plugin, "node_modules", "oxlint", "bin", "oxlint");
const pngdeer = join(plugin, "bin", "pngdeer.js");
const dirs = [];
after(() => dirs.forEach((dir) => rmSync(dir, { recursive: true, force: true })));

/** A copy of example/ with `files` written over it and the rule set up with `options`. */
function project(files = {}, options = {}) {
  const dir = mkdtempSync(join(tmpdir(), "pngdeer-"));
  dirs.push(dir);
  cpSync(join(plugin, "example"), dir, { recursive: true, filter: (path) => !path.includes("node_modules") });
  const config = { jsPlugins: [join(plugin, "src", "index.js")], rules: { "pngdeer/compressible-image": ["warn", options] } };
  writeFileSync(join(dir, ".oxlintrc.json"), JSON.stringify(config));
  for (const [path, text] of Object.entries(files)) writeFileSync(join(dir, path), text);
  return dir;
}

function lint(dir, ...args) {
  const run = spawnSync(process.execPath, [oxlint, "--format", "json", ...args], { cwd: dir, encoding: "utf8" });
  assert.equal(run.status, 0, run.stderr || run.stdout);
  return JSON.parse(run.stdout).diagnostics.filter((d) => d.code.includes("pngdeer"));
}

const names = (diagnostics) => diagnostics.map((d) => d.message.split(" ")[0]).sort();

test("warns on each reference to a compressible image, with the command that fixes it", () => {
  const dir = project();
  const found = lint(dir);
  // heart.png saves too little, missing.png doesn't exist, unused-fire.png isn't referenced
  assert.deepEqual(names(found), ["crystal-ball.png", "diagram.png", "diagram.png", "hero.png", "photo.jpg"]);
  const hero = found.find((d) => d.message.startsWith("hero.png"));
  assert.match(hero.message, /could be \d+ kB smaller \(\d+%: 509 kB → \d+ kB\)/);
  assert.match(hero.message, /Run: npx pngdeer public\/hero\.png -o public\/hero\.png$/);
  // a second run reads the cache
  assert.deepEqual(names(lint(dir)), names(found));
});

test("files fixed with the command aren't flagged again, even on a fresh clone", () => {
  const dir = project();
  for (const file of ["public/photo.jpg", "src/assets/diagram.png"]) {
    const run = spawnSync(process.execPath, [pngdeer, file, "-o", file], { cwd: dir, encoding: "utf8" });
    assert.equal(run.status, 0, run.stderr);
  }
  // pngdeer's own JPEG would otherwise come out about a fifth smaller again
  assert.deepEqual(names(lint(dir)), ["crystal-ball.png", "hero.png"]);
  const again = spawnSync(process.execPath, [pngdeer, "public/photo.jpg", "-o", "public/photo.jpg"], { cwd: dir, encoding: "utf8" });
  assert.match(again.stderr, /already pngdeer's/);
});

test("a fixed target is measured and repeated in the command", () => {
  const dir = project({ "src/App.jsx": 'import hero from "./assets/crystal-ball.png";\n' }, { target: 70 });
  const [found] = lint(dir);
  assert.match(found.message, / --target 70$/);
});

test("thresholds keep small savings quiet", () => {
  const dir = project({}, { minPercent: 90 });
  assert.deepEqual(lint(dir), []);
});

test("paths with spaces are found and quoted", () => {
  const dir = project({ "src/App.jsx": 'import shot from "./assets/My Shot, final.png";\n' });
  cpSync(join(dir, "src/assets/crystal-ball.png"), join(dir, "src/assets/My Shot, final.png"));
  const [found] = lint(dir);
  assert.match(found.message, /Run: npx pngdeer 'src\/assets\/My Shot, final\.png' -o/);
});

test("srcSet lists and public paths resolve", () => {
  const dir = project({ "src/App.jsx": 'export const a = <img srcSet="./assets/diagram.png 1x, /hero.png 2x" />;\n' });
  assert.deepEqual(names(lint(dir)), ["diagram.png", "hero.png"]);
});

test("runs from a parent directory find the same images", () => {
  const dir = project();
  const found = lint(join(dir, ".."), join(dir, "src"));
  assert.equal(found.length, 5);
});

test("an unreadable image is skipped, not an error", { skip: process.platform === "win32" }, () => {
  const dir = project({ "src/App.jsx": 'import a from "./assets/crystal-ball.png";\nimport b from "./assets/diagram.png";\n' });
  chmodSync(join(dir, "src/assets/diagram.png"), 0o000);
  try {
    assert.deepEqual(names(lint(dir)), ["crystal-ball.png"]);
  } finally {
    chmodSync(join(dir, "src/assets/diagram.png"), 0o644);
  }
});

test("the command checks its arguments", () => {
  const run = (...args) => spawnSync(process.execPath, [pngdeer, ...args], { encoding: "utf8" });
  assert.equal(run().status, 1);
  assert.equal(run("a.png").status, 1);
  assert.match(run("a.png", "-o", "b.png", "--target", "200").stderr, /bad --target/);
  assert.match(run("--help").stdout, /usage: pngdeer/);
});
