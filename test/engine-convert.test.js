// convert(): the engine's WebP and AVIF files, the images it turns down, and its panics.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";
import { deflateSync } from "node:zlib";
import { convert } from "../src/engine.js";
import { chunk, fade, plugin, project } from "./helpers.js";

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const SIDE = 32;
const header = Buffer.alloc(13);
header.writeUInt32BE(SIDE, 0);
header.writeUInt32BE(SIDE, 4);
header.set([8, 2], 8); // 8-bit RGB
const raw = Buffer.alloc((SIDE * 3 + 1) * SIDE);
for (let y = 0; y < SIDE; y++) {
  for (let x = 0; x < SIDE; x++) raw.set([x * 8, y * 8, 128], y * (SIDE * 3 + 1) + 1 + x * 3);
}
const pixels = deflateSync(raw);
const end = chunk("IEND", Buffer.alloc(0));

// A 32 × 32 RGB gradient: small enough for AVIF to take well under a second
const png = Buffer.concat([SIGNATURE, chunk("IHDR", header), chunk("IDAT", pixels), end]);

/** The gradient as an APNG of two frames. */
function animated() {
  const control = (sequence) => {
    const fields = Buffer.alloc(26);
    fields.writeUInt32BE(sequence, 0);
    header.copy(fields, 4, 0, 8); // the whole canvas
    fields.writeUInt16BE(1, 20); // shown for 1/10 s
    fields.writeUInt16BE(10, 22);
    return chunk("fcTL", fields);
  };
  const frames = Buffer.alloc(8);
  frames.writeUInt32BE(2, 0);
  const sequence = Buffer.alloc(4);
  sequence.writeUInt32BE(2, 0);
  const frame = chunk("fdAT", Buffer.concat([sequence, pixels]));
  return Buffer.concat([SIGNATURE, chunk("IHDR", header), chunk("acTL", frames), control(0), chunk("IDAT", pixels), control(1), frame, end]);
}

test("WebP and AVIF come out as files of their format", () => {
  const webp = Buffer.from(convert(png, "webp", 80).output);
  assert.equal(webp.toString("latin1", 0, 4), "RIFF");
  assert.equal(webp.toString("latin1", 8, 12), "WEBP");
  const avif = Buffer.from(convert(png, "avif", 80).output);
  assert.equal(avif.toString("latin1", 4, 12), "ftypavif");
});

test("a WebP is a hit exactly when its score reaches the target asked for", () => {
  // the gradient reaches 50 as WebP, not 80
  assert.deepEqual([50, 80].map((target) => convert(png, "webp", target).outcome), ["hit", "miss"]);
  // heart.png's palette scores 87.608, which its lossless WebP keeps; the engine reports the target as 87.61
  const heart = convert(readFileSync(join(plugin, "example", "src", "assets", "heart.png")), "webp", 87.608);
  assert.deepEqual([heart.outcome, heart.mode, heart.score, heart.target], ["hit", "lossless", 87.608, 87.61]);
});

test("an animated PNG is turned down in the engine's words", () => {
  for (const [format, name] of [["webp", "WebP"], ["avif", "AVIF"]]) {
    assert.throws(() => convert(animated(), format, 80), { refused: true, message: `animated PNGs can't be written as ${name} yet` });
  }
});

test("a caller's mistake is a TypeError, not the engine turning the image down", () => {
  for (const format of ["WEBP", "png", undefined]) assert.throws(() => convert(png, format, 80), TypeError);
  // the engine turns the bare signature down at once: without the check, these fail rather than hang
  // as a NaN target does on a real image
  for (const target of [NaN, Infinity, undefined, "80"]) assert.throws(() => convert(SIGNATURE, "webp", target), TypeError);
  for (const bytes of [undefined, null]) assert.throws(() => convert(bytes, "webp", 80), (error) => error instanceof TypeError && error.refused === undefined);
  assert.throws(() => convert(SIGNATURE, "avif", 80), { refused: true, message: "unexpected end of file" });
});

test("a panic is reported as the engine's bug, and leaves the engine trapped", () => {
  // in a process of its own: a panic leaves the thread's engine holding memory it can't free
  const dir = project({ images: [], files: { "fade.png": fade() } });
  const script = `import { readFileSync } from "node:fs";
import { convert, trapped } from ${JSON.stringify(pathToFileURL(join(plugin, "src", "engine.js")).href)};
try {
  convert(readFileSync(${JSON.stringify(join(dir, "fade.png"))}), "webp", 70);
} catch (error) {
  console.log(JSON.stringify({ message: error.message, refused: error.refused, trapped: trapped() }));
}
`;
  const run = spawnSync(process.execPath, ["--input-type=module", "-e", script], { encoding: "utf8", timeout: 60_000 });
  assert.equal(run.status, 0, run.stderr);
  const message = "slimdeer couldn't write this image as WebP: unreachable (a bug in HeyDeer's slimdeer engine: please report it at https://github.com/heydeer/slimdeer/issues)";
  assert.deepEqual(JSON.parse(run.stdout), { message, trapped: true });
});
