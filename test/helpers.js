// Small projects in temporary directories, and the tools run on them.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { crc32, deflateSync } from "node:zlib";

export const plugin = fileURLToPath(new URL("..", import.meta.url));
const example = join(plugin, "example");
const dirs = [];
after(() => dirs.forEach((dir) => rmSync(dir, { recursive: true, force: true })));

/**
 * A project with the rule set up with `options`, for oxlint and ESLint, and `files` written into
 * it: a copy of example/, or with `images`, just those of its images (the first miss measures every
 * image in a project).
 */
export function project({ files = {}, options = {}, images } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "pngdeer-"));
  dirs.push(dir);
  if (images) {
    writeFileSync(join(dir, "package.json"), "{}");
    for (const image of images) {
      mkdirSync(dirname(join(dir, image)), { recursive: true });
      cpSync(join(example, image), join(dir, image));
    }
  } else {
    cpSync(example, dir, { recursive: true, filter: (path) => !path.includes("node_modules") });
  }
  const index = join(plugin, "src", "index.js");
  const oxlintrc = { jsPlugins: [index], rules: { "pngdeer/compressible-image": ["warn", options] } };
  writeFileSync(join(dir, ".oxlintrc.json"), JSON.stringify(oxlintrc));
  const eslintConfig = `import pngdeer from ${JSON.stringify(pathToFileURL(index).href)};
export default [{
  files: ["**/*.{js,jsx}"],
  languageOptions: { parserOptions: { ecmaFeatures: { jsx: true } } },
  plugins: { pngdeer },
  rules: { "pngdeer/compressible-image": ["warn", ${JSON.stringify(options)}] },
}];
`;
  writeFileSync(join(dir, "eslint.config.js"), eslintConfig);
  for (const [path, contents] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), contents);
  }
  return dir;
}

/** oxlint's run in `dir`: the rule's diagnostics, and what it printed on stderr. */
export function oxlint(dir, ...args) {
  const run = spawnSync(process.execPath, [join(plugin, "node_modules", "oxlint", "bin", "oxlint"), "--format", "json", ...args], { cwd: dir, encoding: "utf8" });
  assert.equal(run.status, 0, run.stderr || run.stdout);
  return { found: JSON.parse(run.stdout).diagnostics.filter((d) => d.code.includes("compressible-image")), stderr: run.stderr };
}

/** oxlint's run in `dir` in a format people read (the summary is left out of machine formats): its stderr. */
export function oxlintSummary(dir, ...args) {
  const run = spawnSync(process.execPath, [join(plugin, "node_modules", "oxlint", "bin", "oxlint"), "--format", "unix", ...args], { cwd: dir, encoding: "utf8" });
  assert.equal(run.status, 0, run.stderr || run.stdout);
  return run.stderr;
}

/** The images a run of the command says it handled, in order (without its [3/5] counters). */
export const handled = (stdout) => stdout.trim().split("\n").map((line) => line.replace(/^\[\d+\/\d+\] /, "").split(":")[0]);

/** ESLint's run in `dir`, in the same shape as oxlint(). */
export function eslint(dir, ...args) {
  const run = spawnSync(process.execPath, [join(plugin, "node_modules", "eslint", "bin", "eslint.js"), "--format", "json", ...args], { cwd: dir, encoding: "utf8" });
  assert.equal(run.status, 0, run.stderr || run.stdout);
  const found = JSON.parse(run.stdout).flatMap((file) => file.messages).filter((m) => m.ruleId === "pngdeer/compressible-image");
  return { found, stderr: run.stderr };
}

/** ESLint's run in `dir` in a format people read (the summary is left out of machine formats): its stderr. */
export function eslintSummary(dir, ...args) {
  const run = spawnSync(process.execPath, [join(plugin, "node_modules", "eslint", "bin", "eslint.js"), ...args], { cwd: dir, encoding: "utf8" });
  assert.ok(run.status === 0 || run.status === 1, run.stderr || run.stdout);
  return run.stderr;
}

/** The command's run in `cwd`. */
export function pngdeer(cwd, ...args) {
  return spawnSync(process.execPath, [join(plugin, "bin", "pngdeer.js"), ...args], { cwd, encoding: "utf8" });
}

/** The image names the warnings start with, sorted. */
export const names = ({ found }) => found.map((d) => d.message.split(" ")[0]).sort();

/** A 320 × 240 RGBA gradient fading to transparent, as a PNG. */
export function fade() {
  const [width, height] = [320, 240];
  const chunk = (type, data) => {
    const out = Buffer.alloc(12 + data.length);
    out.writeUInt32BE(data.length, 0);
    out.write(type, 4, "latin1");
    data.copy(out, 8);
    out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
    return out;
  };
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const o = y * (width * 4 + 1) + 1 + x * 4;
      raw.set([(x * 255) / width, (y * 255) / height, 128, 255 - (x * 255) / width], o);
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.set([8, 6], 8);
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  return Buffer.concat([signature, chunk("IHDR", header), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}
