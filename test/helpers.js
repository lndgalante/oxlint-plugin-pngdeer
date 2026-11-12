// Small projects in temporary directories, and the tools run on them.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { crc32, deflateSync } from "node:zlib";

// the tests' own lints mustn't write into the job summary of the CI run testing them
delete process.env.GITHUB_STEP_SUMMARY;
delete process.env.GITHUB_WORKSPACE;

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
  const dir = mkdtempSync(join(tmpdir(), "slimdeer-"));
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
  const oxlintrc = { jsPlugins: [index], rules: { "slimdeer/compressible-image": ["warn", options] } };
  writeFileSync(join(dir, ".oxlintrc.json"), JSON.stringify(oxlintrc));
  const eslintConfig = `import slimdeer from ${JSON.stringify(pathToFileURL(index).href)};
export default [{
  files: ["**/*.{js,jsx}"],
  languageOptions: { parserOptions: { ecmaFeatures: { jsx: true } } },
  plugins: { slimdeer },
  rules: { "slimdeer/compressible-image": ["warn", ${JSON.stringify(options)}] },
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
  const run = spawnSync(process.execPath, [join(plugin, "node_modules", "oxlint", "bin", "oxlint"), "--format", "json", ...args], { cwd: dir, encoding: "utf8", timeout: 300_000 });
  assert.equal(run.status, 0, run.stderr || run.stdout);
  return { found: JSON.parse(run.stdout).diagnostics.filter((d) => d.code.includes("compressible-image")), stderr: run.stderr };
}

/** oxlint's run in `dir` in a format people read (the summary is left out of machine formats): its stderr. */
export function oxlintSummary(dir, ...args) {
  const run = spawnSync(process.execPath, [join(plugin, "node_modules", "oxlint", "bin", "oxlint"), "--format", "unix", ...args], { cwd: dir, encoding: "utf8", timeout: 300_000 });
  assert.equal(run.status, 0, run.stderr || run.stdout);
  return run.stderr;
}

/** The images a run of the command says it handled, in order (without its [3/5] counters). */
export const handled = (stdout) => stdout.trim().split("\n").map((line) => line.replace(/^\[\d+\/\d+\] /, "").split(":")[0]);

/** ESLint's run in `dir`, in the same shape as oxlint(). */
export function eslint(dir, ...args) {
  const run = spawnSync(process.execPath, [join(plugin, "node_modules", "eslint", "bin", "eslint.js"), "--format", "json", ...args], { cwd: dir, encoding: "utf8", timeout: 300_000 });
  assert.equal(run.status, 0, run.stderr || run.stdout);
  const found = JSON.parse(run.stdout).flatMap((file) => file.messages).filter((m) => m.ruleId === "slimdeer/compressible-image");
  return { found, stderr: run.stderr };
}

/** ESLint's run in `dir` in a format people read (the summary is left out of machine formats): its stderr. */
export function eslintSummary(dir, ...args) {
  const run = spawnSync(process.execPath, [join(plugin, "node_modules", "eslint", "bin", "eslint.js"), ...args], { cwd: dir, encoding: "utf8", timeout: 300_000 });
  assert.ok(run.status === 0 || run.status === 1, run.stderr || run.stdout);
  return run.stderr;
}

/** The command's run in `cwd`. */
export function slimdeer(cwd, ...args) {
  return spawnSync(process.execPath, [join(plugin, "bin", "slimdeer.js"), ...args], { cwd, encoding: "utf8", timeout: 300_000 });
}

/** The image names the warnings start with, sorted. */
export const names = ({ found }) => found.map((d) => d.message.split(" ")[0]).sort();

/** A PNG chunk of `type` holding `data`. */
export function chunk(type, data) {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, "latin1");
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** `png` (one IDAT chunk) as an APNG of two frames that each show its image. */
export function animate(png) {
  const idat = png.indexOf("IDAT") - 4;
  const end = idat + 12 + png.readUInt32BE(idat);
  const control = (sequence) => {
    const fields = Buffer.alloc(26);
    fields.writeUInt32BE(sequence, 0);
    png.copy(fields, 4, 16, 24); // the whole canvas: the IHDR's width and height
    fields.writeUInt16BE(1, 20); // shown for 1/10 s
    fields.writeUInt16BE(10, 22);
    return chunk("fcTL", fields);
  };
  const frames = Buffer.alloc(8);
  frames.writeUInt32BE(2, 0);
  const sequence = Buffer.alloc(4);
  sequence.writeUInt32BE(2, 0);
  const frame = chunk("fdAT", Buffer.concat([sequence, png.subarray(idat + 8, end - 4)]));
  return Buffer.concat([png.subarray(0, 33), chunk("acTL", frames), png.subarray(33, idat), control(0), png.subarray(idat, end), control(1), frame, png.subarray(end)]);
}

/** A square 8-bit grayscale PNG of random pixels with a gray color profile, `side` pixels wide. */
export function grayWithProfile(side) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(side, 0);
  header.writeUInt32BE(side, 4);
  header.set([8, 0], 8);
  const raw = Buffer.alloc((side + 1) * side);
  for (let i = 0; i < raw.length; i++) raw[i] = i % (side + 1) === 0 ? 0 : Math.floor(Math.random() * 256);
  const profile = chunk("iCCP", Buffer.concat([Buffer.from("Gray Gamma 2.2\0\0", "latin1"), deflateSync(Buffer.alloc(128))]));
  return Buffer.concat([SIGNATURE, chunk("IHDR", header), profile, chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}

/** A `side` × `side` RGB gradient, as a PNG: 32 pixels a side is small enough for AVIF to take well under a second. */
export function gradient(side) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(side, 0);
  header.writeUInt32BE(side, 4);
  header.set([8, 2], 8); // 8-bit RGB
  const raw = Buffer.alloc((side * 3 + 1) * side);
  for (let y = 0; y < side; y++) {
    for (let x = 0; x < side; x++) raw.set([(x * 256) / side, (y * 256) / side, 128], y * (side * 3 + 1) + 1 + x * 3);
  }
  return Buffer.concat([SIGNATURE, chunk("IHDR", header), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}

/** `png` turned by an eXIf chunk holding only an Orientation, before its image data or after it. */
export function turn(png, orientation, { order = "MM", late = false } = {}) {
  const tiff = order === "MM" ? [0x4d, 0x4d, 0, 42, 0, 0, 0, 8, 0, 1, 0x01, 0x12, 0, 3, 0, 0, 0, 1, 0, orientation, 0, 0, 0, 0, 0, 0] : [0x49, 0x49, 42, 0, 8, 0, 0, 0, 1, 0, 0x12, 0x01, 3, 0, 1, 0, 0, 0, orientation, 0, 0, 0, 0, 0, 0, 0];
  const at = late ? png.length - 12 : 33;
  return Buffer.concat([png.subarray(0, at), chunk("eXIf", Buffer.from(tiff)), png.subarray(at)]);
}

/** A 32 × 32 black and white checkerboard; with `stored`, deflated at level 0, so the file is large and its shrink tiny. */
export function checker(stored = false) {
  const fields = Buffer.alloc(13);
  fields.writeUInt32BE(32, 0);
  fields.writeUInt32BE(32, 4);
  fields.set([8, 2], 8);
  const raw = Buffer.alloc(97 * 32);
  for (let y = 0; y < 32; y++) {
    for (let x = 0; x < 32; x++) raw.set(((x >> 3) + (y >> 3)) % 2 ? [250, 250, 250] : [10, 10, 10], y * 97 + 1 + x * 3);
  }
  return Buffer.concat([SIGNATURE, chunk("IHDR", fields), chunk("IDAT", deflateSync(raw, { level: stored ? 0 : 6 })), chunk("IEND", Buffer.alloc(0))]);
}

/** A 320 × 240 RGBA gradient fading to transparent, as a PNG. */
export function fade() {
  const [width, height] = [320, 240];
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
  return Buffer.concat([SIGNATURE, chunk("IHDR", header), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}
