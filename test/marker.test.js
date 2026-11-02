import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { crc32, deflateSync } from "node:zlib";
import { fill } from "../src/batch.js";
import { cacheDir, key, read } from "../src/cache.js";
import { dimensions, kind, unsupported } from "../src/images.js";
import { keepOrientation, mark, marked } from "../src/marker.js";
import { shrink } from "../src/shrink.js";
import { project } from "./helpers.js";

const fixture = (path) => readFileSync(new URL(`../example/${path}`, import.meta.url));
const png = fixture("src/assets/crystal-ball.png");
const jpeg = fixture("public/photo.jpg");

function chunk(type, data) {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, "latin1");
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}

/** A PNG's chunks before its image data, as [{ type, data }]. */
function header(bytes) {
  const chunks = [];
  for (let pos = 8; pos + 12 <= bytes.length; pos += 12 + bytes.readUInt32BE(pos)) {
    const type = bytes.toString("latin1", pos + 4, pos + 8);
    if (type === "IDAT") break;
    chunks.push({ type, data: bytes.subarray(pos + 8, pos + 8 + bytes.readUInt32BE(pos)) });
  }
  return chunks;
}

/** An eXIf chunk whose first IFD holds a Make tag, then Orientation, in either byte order. */
function exif(orientation, order) {
  const tiff = Buffer.alloc(38);
  const le = order === "II";
  const u16 = (value, at) => (le ? tiff.writeUInt16LE(value, at) : tiff.writeUInt16BE(value, at));
  const u32 = (value, at) => (le ? tiff.writeUInt32LE(value, at) : tiff.writeUInt32BE(value, at));
  tiff.write(order, 0, "latin1");
  u16(42, 2);
  u32(8, 4);
  u16(2, 8);
  // Make: 4 ASCII bytes, held in the entry itself
  u16(0x010f, 10);
  u16(2, 12);
  u32(4, 14);
  tiff.write("Foo\0", 18, "latin1");
  // Orientation: one SHORT; no next IFD
  u16(0x0112, 22);
  u16(3, 24);
  u32(1, 26);
  u16(orientation, 30);
  return chunk("eXIf", tiff);
}

/** The orientation a PNG's eXIf gives it, read without src/marker.js; null without one. */
function orientation(bytes) {
  const tiff = header(bytes).find(({ type }) => type === "eXIf")?.data;
  if (!tiff) return null;
  const le = tiff.toString("latin1", 0, 2) === "II";
  const u16 = (at) => (le ? tiff.readUInt16LE(at) : tiff.readUInt16BE(at));
  const ifd = le ? tiff.readUInt32LE(4) : tiff.readUInt32BE(4);
  for (let i = 0; i < u16(ifd); i++) {
    if (u16(ifd + 2 + i * 12) === 0x0112) return u16(ifd + 10 + i * 12);
  }
  return 1;
}

/** `bytes` with chunks added right after IHDR. */
const withChunks = (bytes, ...chunks) => Buffer.concat([bytes.subarray(0, 33), ...chunks, bytes.subarray(33)]);

test("a marked PNG or JPEG is recognized, an unmarked one isn't", () => {
  for (const bytes of [png, jpeg]) {
    assert.equal(marked(bytes), false);
    const withMark = mark(bytes);
    assert.equal(marked(withMark), true);
    assert.equal(kind(withMark), kind(bytes));
    assert.deepEqual(dimensions(withMark, kind(withMark)), dimensions(bytes, kind(bytes)));
  }
});

test("a marked file that changed size since isn't recognized", () => {
  for (const bytes of [png, jpeg]) {
    const withMark = mark(bytes);
    assert.equal(marked(Buffer.concat([withMark, Buffer.from([0])])), false);
  }
});

test("a JPEG's mark goes after its APPn segments", () => {
  assert.equal(jpeg[3], 0xe0, "the fixture starts with JFIF's APP0");
  const withMark = mark(jpeg);
  assert.equal(withMark[3], 0xe0, "APP0 stays right after SOI");
});

test("a PNG turned by EXIF stays turned when shrunk, at the size the lint measured", async () => {
  // macOS sips writes a rotated photo this way; pngdeer itself drops eXIf
  const bytes = withChunks(png, exif(6, "MM"));
  const dir = project({ images: [], files: { "turned.png": bytes } });
  const file = join(dir, "turned.png");
  await fill({ dir: cacheDir(dir), files: [file] });
  shrink(file, file);
  const written = readFileSync(file);
  assert.equal(orientation(written), 6);
  assert.equal(marked(written), true);
  assert.equal(read(cacheDir(dir), key(bytes)).compressed, written.length);
});

test("an EXIF orientation is read in either byte order and carried over once", () => {
  // `png` stands in for pngdeer's output, which has no eXIf
  for (const order of ["MM", "II"]) {
    for (const value of [3, 6, 8]) {
      const output = keepOrientation(withChunks(png, exif(value, order)), png);
      assert.equal(orientation(output), value);
      assert.equal(header(output).filter(({ type }) => type === "eXIf").length, 1);
      assert.equal(keepOrientation(withChunks(png, exif(value, order)), output), output, "an output with eXIf keeps its own");
    }
  }
  assert.equal(header(keepOrientation(withChunks(png, exif(6, "MM")), png))[0].type, "IHDR");
});

test("output for an image EXIF doesn't turn, or that isn't a PNG starting with IHDR, comes back as is", () => {
  const iend = png.length - 12;
  const late = Buffer.concat([png.subarray(0, iend), exif(6, "MM"), png.subarray(iend)]);
  const notFirst = Buffer.concat([png.subarray(0, 8), chunk("tEXt", Buffer.from("a\0b")), png.subarray(8)]);
  // browsers ignore an eXIf after the image data, so it doesn't count
  for (const input of [png, withChunks(png, exif(1, "MM")), withChunks(png, exif(9, "II")), late, jpeg]) assert.equal(keepOrientation(input, png), png);
  for (const output of [jpeg, notFirst]) assert.equal(keepOrientation(withChunks(png, exif(6, "MM")), output), output);
});

test("a grayscale PNG with a color profile is left alone, as pngdeer's output can look darker", () => {
  const image = (colorType, ...chunks) => {
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(16, 0);
    ihdr.writeUInt32BE(16, 4);
    ihdr.set([8, colorType], 8);
    const pixels = Buffer.alloc((16 * { 0: 1, 4: 2, 6: 4 }[colorType] + 1) * 16);
    return Buffer.concat([png.subarray(0, 8), chunk("IHDR", ihdr), ...chunks, chunk("IDAT", deflateSync(pixels)), chunk("IEND", Buffer.alloc(0))]);
  };
  const profile = chunk("iCCP", Buffer.concat([Buffer.from("Gray\0\0", "latin1"), deflateSync(Buffer.alloc(128))]));
  const why = "a grayscale PNG with a color profile (pngdeer's output can look darker)";
  assert.equal(unsupported(image(0, profile)), why);
  assert.equal(unsupported(image(4, profile)), why, "gray with alpha");
  assert.equal(unsupported(image(0)), null, "gray without a profile");
  assert.equal(unsupported(image(6, profile)), null, "color with a profile");
  const dir = project({ images: [], files: { "gray.png": image(0, profile) } });
  const file = join(dir, "gray.png");
  assert.throws(() => shrink(file, file), { message: why });
  assert.deepEqual(readFileSync(file), image(0, profile));
});

test("anything else comes back unmarked, and nothing throws on junk", () => {
  const junk = [Buffer.alloc(0), Buffer.from("GIF89a"), png.subarray(0, 30), jpeg.subarray(0, 5), Buffer.from([0xff, 0xd8, 0xff, 0xfe, 0, 0])];
  const badExif = [Buffer.alloc(0), Buffer.from("MM\0*"), Buffer.from("MM\0*\xff\xff\xff\xff\0\0", "latin1"), Buffer.from("XX\0*\0\0\0\x08\0\x01", "latin1")];
  for (const bytes of junk) {
    assert.doesNotThrow(() => marked(bytes));
    assert.equal(marked(bytes), false);
    assert.doesNotThrow(() => unsupported(bytes));
    assert.doesNotThrow(() => keepOrientation(withChunks(png, exif(6, "MM")), bytes));
  }
  for (const data of badExif) assert.equal(keepOrientation(withChunks(png, chunk("eXIf", data)), png), png);
  assert.equal(mark(Buffer.from("GIF89a")).toString(), "GIF89a");
});
