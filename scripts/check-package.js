import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const { name, version } = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const npm = process.env.npm_execpath;
assert.ok(npm, "Run this check with npm run check:package");
const published = process.argv.includes("--published");

const work = mkdtempSync(join(tmpdir(), "pngdeer-package-"));
const app = join(work, "consumer");
const npmArgs = ["--cache", join(work, "npm-cache"), ...(published ? [] : ["--offline"]), "--ignore-scripts", "--no-audit", "--no-fund"];
try {
  let source = `${name}@${version}`;
  if (!published) {
    const [packed] = JSON.parse(run(npm, [...npmArgs, "pack", "--json", "--pack-destination", work], root));
    source = join(work, packed.filename);
  }
  mkdirSync(join(app, "src"), { recursive: true });
  writeFileSync(join(app, "package.json"), JSON.stringify({ private: true, type: "module" }));
  // Keep the consumer independent of the checkout, without fetching optional linter peers.
  run(npm, [...npmArgs, "install", "--legacy-peer-deps", "--package-lock=false", source]);
  assert.ok(statSync(join(app, "node_modules", name, "src/index.d.ts")).isFile(), "the package includes its types");
  writeFileSync(join(app, "check.mjs"), `import assert from "node:assert/strict";
import plugin from ${JSON.stringify(name)};
assert.equal(plugin.meta.version, ${JSON.stringify(version)});
assert.equal(typeof plugin.rules["compressible-image"].create, "function");
`);
  run(join(app, "check.mjs"));
  assert.equal(command("--version").trim(), version, "the installed CLI shim works");

  writeFileSync(join(app, ".oxlintrc.json"), JSON.stringify({
    jsPlugins: [name],
    rules: { "pngdeer/compressible-image": ["warn", { measure: "never" }] },
  }));
  writeFileSync(join(app, "eslint.config.js"), `import pngdeer from ${JSON.stringify(name)};
export default [{ plugins: { pngdeer }, rules: { "pngdeer/compressible-image": ["warn", { measure: "never" }] } }];
`);
  writeFileSync(join(app, "src", "app.js"), 'export const image = "./image.png";\n');
  const image = join(app, "src", "image.png");
  copyFileSync(join(root, "example", "src", "assets", "crystal-ball.png"), image);
  const before = readFileSync(image);
  checkImages(1);
  assert.deepEqual(readFileSync(image), before, "--check leaves image bytes unchanged");
  const cache = join(app, "node_modules", ".cache", "pngdeer");
  assert.ok(readdirSync(cache).some((file) => /^[a-f0-9]{64}\.json$/.test(file)), "--check warms the shared cache");
  assert.ok(!readdirSync(cache).includes("flagged.json"), "--check does not create a lint manifest");
  assert.equal(oxlintWarnings(), 1, "oxlint reads measurements from --check without running the engine");
  assert.equal(eslintWarnings(), 1, "ESLint reads measurements from --check without running the engine");
  command("src/image.png");
  assert.ok(statSync(image).size < before.length, "the installed command compresses the image with its bundled engine");
  checkImages(0);
  assert.equal(oxlintWarnings(), 0, "oxlint recognizes the compressed image");
  assert.equal(eslintWarnings(), 0, "ESLint recognizes the compressed image");
  console.log(`${published ? "Published package" : "Package"} check passed: ${name}@${version}, import, CLI, WASM, oxlint and ESLint.`);
} finally {
  rmSync(work, { recursive: true, force: true });
}

function command(...args) {
  return run(npm, [...npmArgs, "exec", "--no", "--", name, ...args]);
}

function checkImages(status) {
  return run(npm, [...npmArgs, "exec", "--no", "--", name, "--check", "src"], app, status);
}

function oxlintWarnings() {
  const result = JSON.parse(run(join(root, "node_modules", "oxlint", "bin", "oxlint"), ["--format", "json", "src"]));
  return result.diagnostics.filter((item) => item.code.includes("compressible-image")).length;
}

function eslintWarnings() {
  const result = JSON.parse(run(join(root, "node_modules", "eslint", "bin", "eslint.js"), ["--format", "json", "src"]));
  return result.flatMap((file) => file.messages).filter((item) => item.ruleId === "pngdeer/compressible-image").length;
}

function run(script, args = [], cwd = app, status = 0) {
  const result = spawnSync(process.execPath, [script, ...args], { cwd, encoding: "utf8", timeout: 120_000 });
  assert.equal(result.status, status, `${script} ${args.join(" ")}\n${result.error ?? ""}\n${result.stderr}\n${result.stdout}`);
  return result.stdout;
}
