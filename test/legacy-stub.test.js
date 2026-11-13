import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const stub = join(fileURLToPath(new URL("..", import.meta.url)), "legacy", "oxlint-plugin-pngdeer");
const link = "https://github.com/lndgalante/oxlint-plugin-slimdeer/blob/main/docs/rules/compressible-image.md#moving-from-oxlint-plugin-pngdeer";
const message = `oxlint-plugin-pngdeer is now oxlint-plugin-slimdeer. To move: npm uninstall oxlint-plugin-pngdeer && npm install --save-dev oxlint-plugin-slimdeer, then replace pngdeer with slimdeer in your lint config, except in a cacheDir. Every step: ${link}`;

function bin(...args) {
  const run = spawnSync(process.execPath, [join(stub, "bin.js"), ...args], { encoding: "utf8", timeout: 60_000 });
  return { ...run, lines: run.stderr.split(/\r?\n/) };
}

function lines(second) {
  return [
    "oxlint-plugin-pngdeer is now oxlint-plugin-slimdeer. Run the same command with the new name:",
    second,
    `Nothing was checked or changed. Every step of the move: ${link}`,
    "",
  ];
}

test("importing the old package throws the move message", async () => {
  await assert.rejects(import("../legacy/oxlint-plugin-pngdeer/index.js"), { message });
  // oxlint breaks an error's line at 400 columns, after "  |   Error: ": a longer message loses its link
  assert.ok(message.length <= 380, `the move message is ${message.length} characters`);
});

// ESLint imports the default export: without one, linking fails before the message is thrown.
test("a default import of the package by name throws the move message", () => {
  const run = spawnSync(process.execPath, ["--input-type=module", "-e", 'import plugin from "oxlint-plugin-pngdeer";'], { cwd: stub, encoding: "utf8", timeout: 60_000 });
  assert.equal(run.status, 1);
  assert.ok(run.stderr.split(/\r?\n/).includes(`Error: ${message}`), run.stderr);
});

test("npx runs bin.js with node", () => {
  const manifest = JSON.parse(readFileSync(join(stub, "package.json"), "utf8"));
  assert.deepEqual(manifest.bin, { "oxlint-plugin-pngdeer": "bin.js" });
  assert.match(readFileSync(join(stub, "bin.js"), "utf8"), /^#!\/usr\/bin\/env node\r?\n/);
});

test("the old command prints the new command and exits 2", () => {
  const run = bin("--check", "public", "my file.png");
  assert.equal(run.status, 2);
  assert.equal(run.stdout, "");
  assert.deepEqual(run.lines, lines("  npx oxlint-plugin-slimdeer --check public 'my file.png'"));
});

test("without arguments the new command stands alone", () => {
  const run = bin();
  assert.equal(run.status, 2);
  assert.equal(run.stdout, "");
  assert.deepEqual(run.lines, lines("  npx oxlint-plugin-slimdeer"));
});

test("a single quote in an argument is written '\\''", () => {
  assert.deepEqual(bin("it's.png").lines, lines("  npx oxlint-plugin-slimdeer 'it'\\''s.png'"));
});

// zsh expands a word that starts with = into a command's path, so it is quoted.
test("an argument that starts with = is quoted", () => {
  assert.deepEqual(bin("=x.png", "a=b").lines, lines("  npx oxlint-plugin-slimdeer '=x.png' a=b"));
});

// npm_execpath is set when npm runs the tests; otherwise look for npm beside this node.
function npmCli() {
  const set = process.env.npm_execpath;
  if (set && /npm-cli\.[cm]?js$/.test(set)) return set;
  const home = dirname(process.execPath);
  const found = [join(home, "node_modules", "npm", "bin", "npm-cli.js"), join(home, "..", "lib", "node_modules", "npm", "bin", "npm-cli.js"), join(home, "npm")].find(existsSync);
  // Homebrew links bin/npm to npm-cli.js elsewhere; on Windows bin/npm is a shell script.
  const cli = found && realpathSync(found);
  return cli && /npm-cli\.[cm]?js$/.test(cli) ? cli : undefined;
}

test("the folder packs index.js, bin.js, package.json and README.md only", (t) => {
  const cli = npmCli();
  if (!cli) return t.skip("npm's script was not found next to this node");
  const cache = mkdtempSync(join(tmpdir(), "slimdeer-legacy-"));
  try {
    const run = spawnSync(process.execPath, [cli, "--cache", join(cache, "npm-cache"), "--offline", "--ignore-scripts", "--no-audit", "--no-fund", "pack", "--dry-run", "--json"], { cwd: stub, encoding: "utf8", timeout: 120_000 });
    assert.equal(run.status, 0, `${run.error ?? ""}${run.stderr}`);
    const [packed] = JSON.parse(run.stdout);
    assert.deepEqual(packed.files.map((file) => file.path).sort(), ["README.md", "bin.js", "index.js", "package.json"]);
  } finally {
    rmSync(cache, { recursive: true, force: true });
  }
});

test("the section the link names is in the rule's docs", () => {
  const docs = readFileSync(join(stub, "..", "..", "docs", "rules", "compressible-image.md"), "utf8");
  assert.match(docs, /^## Moving from oxlint-plugin-pngdeer\r?$/m);
});
