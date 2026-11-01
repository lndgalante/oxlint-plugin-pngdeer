// Bounded image samples from pinned public repositories. Downloads are explicit; checks run offline.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { cpus, platform, release, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { ENGINE, cacheDir, key, read, reportable } from "../src/cache.js";

const SOURCES = JSON.parse(readFileSync(new URL("./trial-images.json", import.meta.url), "utf8"));

const root = fileURLToPath(new URL("..", import.meta.url));
const downloads = join(root, "bench", ".images", "trials");
const options = { minSavedBytes: 4096, minSavedPercent: 10 };
const args = process.argv.slice(2);
const outputAt = args.indexOf("--json");
if (args.some((arg, index) => arg !== "--fetch-only" && arg !== "--json" && !(outputAt >= 0 && index === outputAt + 1)) ||
    (outputAt >= 0 && (!args[outputAt + 1] || args[outputAt + 1].startsWith("--") || args.includes("--fetch-only")))) {
  throw new Error("usage: node bench/trials.js [--fetch-only] [--json RESULTS.json]");
}

if (args.includes("--fetch-only")) {
  for (const source of SOURCES) await fetchSource(source);
} else {
  const results = SOURCES.map(measure);
  const report = {
    measuredAt: new Date().toISOString(),
    pluginVersion: JSON.parse(readFileSync(join(root, "package.json"), "utf8")).version,
    engine: ENGINE,
    environment: { node: process.versions.node, platform: platform(), release: release(), cpu: cpus()[0]?.model, cores: cpus().length },
    options: { ...options, target: "auto" },
    results,
  };
  console.log("\n| Sample | Images | Original bytes | Reported savings | Cold | Cached | Errors |");
  console.log("|---|---:|---:|---:|---:|---:|---:|");
  for (const result of results) {
    console.log(`| ${result.repo} | ${result.images.length} | ${result.originalBytes} | ${result.savedBytes} | ${result.cold.ms} ms | ${result.warm.ms} ms | ${result.errors} |`);
  }
  if (outputAt >= 0) writeFileSync(args[outputAt + 1], `${JSON.stringify(report, null, 2)}\n`);
}

async function fetchSource(source) {
  for (const file of source.files) {
    const path = join(downloads, source.id, file.path);
    if (existsSync(path)) {
      verify(readFileSync(path), file);
      continue;
    }
    const url = `https://raw.githubusercontent.com/${source.repo}/${source.commit}/${file.path.split("/").map(encodeURIComponent).join("/")}`;
    const response = await fetch(url, { signal: AbortSignal.timeout(30_000) });
    if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
    const bytes = Buffer.from(await response.arrayBuffer());
    verify(bytes, file);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, bytes);
  }
  console.log(`Fetched and verified ${source.files.length} images from ${source.repo}@${source.commit}.`);
}

function measure(source) {
  const work = mkdtempSync(join(tmpdir(), `pngdeer-trial-${source.id}-`));
  try {
    // Copy assets only: none of the upstream project's code or install scripts is executed.
    writeFileSync(join(work, "package.json"), '{"private":true}\n');
    for (const file of source.files) {
      const original = join(downloads, source.id, file.path);
      if (!existsSync(original)) throw new Error("Images missing: run node bench/trials.js --fetch-only first");
      verify(readFileSync(original), file);
      const copy = join(work, file.path);
      mkdirSync(dirname(copy), { recursive: true });
      copyFileSync(original, copy);
    }
    const cold = check(work);
    const cachedRuns = Array.from({ length: 3 }, () => check(work));
    for (const run of cachedRuns) assert.equal(run.status, cold.status, "cached and cold checks must agree");
    const warm = [...cachedRuns].sort((a, b) => a.ms - b.ms)[1];
    const images = source.files.map((file) => {
      const bytes = readFileSync(join(work, file.path));
      verify(bytes, file);
      const entry = read(cacheDir(work), key(bytes));
      return {
        path: file.path,
        sha256: createHash("sha256").update(bytes).digest("hex"),
        original: bytes.length,
        compressed: entry?.compressed ?? null,
        score: entry?.score ?? null,
        outcome: entry?.outcome ?? null,
        error: entry?.skipped ?? null,
        reported: reportable(entry, options),
      };
    });
    const result = {
      repo: source.repo,
      commit: source.commit,
      selection: source.selection,
      originalBytes: images.reduce((sum, image) => sum + image.original, 0),
      savedBytes: images.reduce((sum, image) => sum + (image.reported ? image.original - image.compressed : 0), 0),
      flagged: images.filter((image) => image.reported).length,
      errors: images.filter((image) => image.error).length,
      cold,
      warm,
      images,
    };
    assert.equal(cold.status, result.errors ? 2 : result.flagged ? 1 : 0, "exit code must agree with cached measurements");
    console.log(`${source.repo}: ${result.flagged}/${images.length} images reported; ${cold.ms} ms cold, ${warm.ms} ms cached; source bytes unchanged.`);
    return result;
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

function check(cwd) {
  const start = performance.now();
  const run = spawnSync(process.execPath, [join(root, "bin", "pngdeer.js"), "--check", "."], {
    cwd, encoding: "utf8", timeout: 180_000, maxBuffer: 4e6,
  });
  if (run.error || ![0, 1, 2].includes(run.status)) throw new Error(`${run.error?.message ?? "check failed"}\n${run.stderr}`);
  return { ms: Math.round(performance.now() - start), status: run.status };
}

function verify(bytes, file) {
  const blob = createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex");
  assert.equal(bytes.length, file.size, `${file.path}: size changed`);
  assert.equal(blob, file.sha, `${file.path}: bytes differ from the pinned Git object`);
}
