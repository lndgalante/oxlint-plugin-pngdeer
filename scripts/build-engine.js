import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const args = process.argv.slice(2);
if (args.includes("--help")) {
  console.log("usage: node scripts/build-engine.js [--output NEW_DIRECTORY]\nRequires Docker with linux/amd64 support. Builds twice; never replaces engine/.");
  process.exit(0);
}
assert.ok(args.length === 0 || (args.length === 2 && args[0] === "--output"), "use --output NEW_DIRECTORY or no arguments");
const root = fileURLToPath(new URL("..", import.meta.url));
const provenance = JSON.parse(readFileSync(join(root, "engine/provenance.json"), "utf8"));
assert.match(provenance.source.revision, /^[a-f0-9]{40}$/, "pin a full source revision");
assert.match(provenance.source.cargoLockSha256, /^[a-f0-9]{64}$/, "pin the Cargo.lock checksum");
const output = args.length ? resolve(args[1]) : mkdtempSync(join(tmpdir(), "pngdeer-engine-"));
if (args.length) mkdirSync(output);
const tag = `pngdeer-engine:${provenance.source.revision.slice(0, 12)}`;
run([
  "build", "--platform", "linux/amd64", "--tag", tag,
  "--build-arg", `SOURCE_REPOSITORY=${provenance.source.repository}`,
  "--build-arg", `SOURCE_REVISION=${provenance.source.revision}`,
  "--build-arg", `CARGO_LOCK_SHA256=${provenance.source.cargoLockSha256}`,
  join(root, "scripts/engine"),
]);
for (const name of ["first", "second"]) {
  const folder = join(output, name);
  mkdirSync(folder);
  run(["run", "--rm", "--platform", "linux/amd64", "--network", "none", "--mount", `type=bind,source=${folder},target=/output`, tag, `/build-${name}`]);
}
const files = Object.keys(provenance.files);
const results = files.map((file) => {
  const first = hash(join(output, "first", file));
  const second = hash(join(output, "second", file));
  const repeatable = first === second;
  const matchesVendored = first === provenance.files[file];
  const message = `${file}: ${first}; repeatable=${repeatable}; matches vendored=${matchesVendored}`;
  console.log(message);
  if (process.env.GITHUB_ACTIONS) console.log(`::${repeatable ? "notice" : "error"} title=Engine build::${message}`);
  return { file, first, second, repeatable, matchesVendored };
});
writeFileSync(join(output, "results.json"), `${JSON.stringify({ source: provenance.source, results }, null, 2)}\n`);
console.log(`Build outputs and comparison: ${output}`);
assert.ok(results.every((result) => result.repeatable), "the two clean builds differ; inspect results.json");
if (results.some((result) => !result.matchesVendored)) {
  console.log("The source build is repeatable but differs from the vendored engine. engine/ is unchanged; source correspondence remains unverified.");
}

function run(args) {
  const result = spawnSync("docker", args, { encoding: "utf8", maxBuffer: 32e6, timeout: 30 * 60 * 1000 });
  process.stdout.write(result.stdout ?? "");
  process.stderr.write(result.stderr ?? "");
  if (result.error || result.status !== 0) {
    const tail = `${result.error?.message ?? ""}\n${result.stdout ?? ""}\n${result.stderr ?? ""}`.slice(-4000);
    if (process.env.GITHUB_ACTIONS) console.log(`::error title=Engine ${args[0]} failed::${tail.replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A")}`);
    if (result.error) throw result.error;
  }
  assert.equal(result.status, 0, `docker ${args[0]} failed`);
}

function hash(file) {
  return createHash("sha256").update(readFileSync(file)).digest("hex");
}
