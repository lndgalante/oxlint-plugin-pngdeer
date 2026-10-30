import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { dimensions, kind, unsupported } from "../src/images.js";
import { mark, marked } from "../src/marker.js";

const fixture = (path) => readFileSync(new URL(`../example/${path}`, import.meta.url));
const png = fixture("src/assets/crystal-ball.png");
const jpeg = fixture("public/photo.jpg");

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

test("anything else comes back unmarked, and nothing throws on junk", () => {
  const junk = [Buffer.alloc(0), Buffer.from("GIF89a"), png.subarray(0, 30), jpeg.subarray(0, 5), Buffer.from([0xff, 0xd8, 0xff, 0xfe, 0, 0])];
  for (const bytes of junk) {
    assert.doesNotThrow(() => marked(bytes));
    assert.equal(marked(bytes), false);
    assert.doesNotThrow(() => unsupported(bytes));
  }
  assert.equal(mark(Buffer.from("GIF89a")).toString(), "GIF89a");
});
