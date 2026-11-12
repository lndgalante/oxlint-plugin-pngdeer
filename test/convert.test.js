// The WebP and AVIF copies the command writes (convert.js): where they go, the images left out and
// why, the quality they aim at, and how they're written without replacing anything.
import assert from "node:assert/strict";
import fs, { chmodSync, lstatSync, mkdirSync, readdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { basename, join } from "node:path";
import { test } from "node:test";
import { AVIF_MAX_PIXELS, cautions, convertImage, equalTarget, leftOut, sibling, WEBP_MAX_SIDE } from "../src/convert.js";
import { compress, convert } from "../src/engine.js";
import { keepOrientation, mark, turned } from "../src/marker.js";
import { looks, pathFrom, shrinkCommand, size, smaller } from "../src/text.js";
import { animate, checker, chunk, gradient, grayWithProfile, project, turn } from "./helpers.js";

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const ANIMATED = (name) => `animated PNGs can't be written as ${name} yet`;

/** A PNG's header alone, claiming `width` × `height`: enough for what's read before decoding. */
function header(width, height) {
  const fields = Buffer.alloc(13);
  fields.writeUInt32BE(width, 0);
  fields.writeUInt32BE(height, 4);
  fields.set([8, 2], 8);
  return Buffer.concat([SIGNATURE, chunk("IHDR", fields), chunk("IEND", Buffer.alloc(0))]);
}

/** The files in `folder`, sorted; a temp file left behind would show here. */
const files = (folder) => readdirSync(folder).sort();

/** A symlink at `path` to `target`, or false where this system can't make one (Windows without Developer Mode). */
function link(target, path) {
  try {
    symlinkSync(target, path);
    return true;
  } catch (error) {
    if (process.platform === "win32" && error.code === "EPERM") return false;
    throw error;
  }
}

test("a copy goes next to its image, under its name, with the format's extension in lower case", () => {
  assert.equal(sibling("public/hero.png", "webp"), "public/hero.webp");
  assert.equal(sibling("photo.JPG", "webp"), "photo.webp");
  assert.equal(sibling("img/logo@2x.png", "avif"), "img/logo@2x.avif");
  assert.equal(sibling("assets.v2/hero", "avif"), "assets.v2/hero.avif");
  assert.equal(sibling(join("a", "b.PNG"), "avif"), join("a", "b.avif"));
});

test("a copy aims at its shrink's quality: a hit's score, 100 when nothing is lost, none after a miss", () => {
  assert.equal(equalTarget(undefined, { outcome: "hit", score: 86.895 }), 86.895);
  for (const outcome of ["exact", "lossless", "original"]) assert.equal(equalTarget(undefined, { outcome, score: 91.797 }), 100);
  // a miss at the automatic target: nothing reached the quality floor
  assert.equal(equalTarget(undefined, { outcome: "miss", score: 62.3 }), null);
  // a target given wins, whatever the shrink found
  for (const outcome of ["hit", "miss", "exact", "original"]) assert.equal(equalTarget(80, { outcome, score: 62.3 }), 80);
  assert.equal(equalTarget(0, { outcome: "miss", score: 62.3 }), 0);
});

test("eXIf turns a PNG with an orientation from 2 to 8, read before its image data, in either byte order", () => {
  const png = gradient(32);
  for (const order of ["MM", "II"]) {
    for (const orientation of [2, 6, 8]) assert.equal(turned(turn(png, orientation, { order })), true, `${order} ${orientation}`);
    for (const orientation of [0, 1, 9]) assert.equal(turned(turn(png, orientation, { order })), false, `${order} ${orientation}`);
  }
  // browsers ignore an eXIf after the image data
  assert.equal(turned(turn(png, 6, { late: true })), false);
  for (const bytes of [png, Buffer.alloc(0), png.subarray(0, 30), readFileSync(new URL("../example/public/photo.jpg", import.meta.url))]) assert.equal(turned(bytes), false);
});

test("an image is left out for the first reason that holds, in the words the command prints", () => {
  const dir = project({ images: [] });
  const file = join(dir, "image.png");
  const png = gradient(32);
  for (const format of ["webp", "avif"]) assert.equal(leftOut(png, file, format, dir), null);
  const marked = "already shrunk by this command, so converting it would be a second lossy pass; convert the original from before it was shrunk";
  for (const [format, name] of [["webp", "WebP"], ["avif", "AVIF"]]) {
    assert.deepEqual(leftOut(mark(png), file, format, dir), { kind: "marked", reason: marked });
    assert.deepEqual(leftOut(animate(png), file, format, dir), { kind: "animated", reason: ANIMATED(name) });
    assert.deepEqual(leftOut(turn(png, 6), file, format, dir), { kind: "turned", reason: `its eXIf data turns it, and the ${name} file would show it unturned; shrink it as PNG instead` });
    // in that order
    assert.equal(leftOut(mark(animate(png)), file, format, dir).kind, "marked");
    assert.equal(leftOut(turn(animate(png), 6), file, format, dir).kind, "animated");
  }
  // the engines' limits, by the header alone
  assert.deepEqual(leftOut(header(5000, 5000), file, "avif", dir), { kind: "size", reason: "too large for AVIF (25.0 MP, at most 24)" });
  assert.equal(leftOut(header(6000, AVIF_MAX_PIXELS / 6000), file, "avif", dir), null);
  // rounded up: one pixel row over the limit isn't "24.0 MP"
  assert.equal(leftOut(header(6000, AVIF_MAX_PIXELS / 6000 + 1), file, "avif", dir).reason, "too large for AVIF (24.1 MP, at most 24)");
  assert.deepEqual(leftOut(header(WEBP_MAX_SIDE + 1, 1), file, "webp", dir), { kind: "size", reason: "too wide or tall for WebP (at most 16,383 pixels a side)" });
  assert.equal(leftOut(header(1, WEBP_MAX_SIDE + 1), file, "webp", dir).kind, "size");
  assert.equal(leftOut(header(WEBP_MAX_SIDE, WEBP_MAX_SIDE), file, "webp", dir), null);
  assert.equal(leftOut(header(WEBP_MAX_SIDE + 1, 1), file, "avif", dir), null);
  assert.equal(leftOut(header(5000, 5000), file, "webp", dir), null);
  assert.equal(leftOut(turn(header(5000, 5000), 6), file, "avif", dir).kind, "turned");
});

test("Next.js's app/ metadata images are left out, and AVIF in a React Native or Expo project", () => {
  const next = project({ images: [], files: { "package.json": JSON.stringify({ dependencies: { next: "15.0.0", "react-native": "0.76.0" } }) } });
  const png = gradient(32);
  const reason = "Next.js serves app/ metadata images by their file name, and doesn't take WebP or AVIF there";
  for (const path of ["app/opengraph-image.png", "src/app/blog/icon2.png"]) {
    for (const format of ["webp", "avif"]) assert.deepEqual(leftOut(png, join(next, path), format, next), { kind: "next", reason });
  }
  assert.equal(leftOut(png, join(next, "public/hero.png"), "webp", next), null);
  // a size the engine can't take comes first
  assert.equal(leftOut(header(WEBP_MAX_SIDE + 1, 1), join(next, "app/icon.png"), "webp", next).kind, "size");
  // without next, app/ is a folder like any other
  const plain = project({ images: [] });
  assert.equal(leftOut(png, join(plain, "app/opengraph-image.png"), "webp", plain), null);
  for (const dependencies of [{ "react-native": "0.76.0" }, { expo: "52.0.0" }]) {
    const app = project({ images: [], files: { "package.json": JSON.stringify({ dependencies }) } });
    assert.deepEqual(leftOut(png, join(app, "assets/icon.png"), "avif", app), { kind: "react-native", reason: "React Native's Image doesn't list AVIF among the formats it shows" });
    assert.equal(leftOut(png, join(app, "assets/icon.png"), "webp", app), null);
  }
  const dev = project({ images: [], files: { "package.json": JSON.stringify({ devDependencies: { expo: "52.0.0" } }) } });
  assert.equal(leftOut(png, join(dev, "a.png"), "avif", dev).kind, "react-native");
});

test("an image is written as WebP next to it, at the quality its shrink has, and stays as it is", () => {
  const dir = project({ images: ["src/assets/crystal-ball.png", "src/assets/heart.png"] });
  for (const name of ["crystal-ball", "heart"]) {
    const file = join(dir, "src/assets", `${name}.png`);
    const bytes = readFileSync(file);
    const shrunk = compress(bytes);
    const copy = convert(bytes, "webp", equalTarget(undefined, shrunk));
    const result = convertImage(file, sibling(file, "webp"), { format: "webp", mode: "sibling" });
    assert.deepEqual(readFileSync(sibling(file, "webp")), Buffer.from(copy.output));
    assert.deepEqual(readFileSync(file), bytes);
    const compressed = shrunk.outcome === "original" ? bytes.length : mark(keepOrientation(bytes, shrunk.output)).length;
    const line = `${size(bytes.length)} → ${size(copy.output.length)} (${smaller(bytes.length, copy.output.length)}% smaller, quality ${Math.round(copy.score)}/100: looks ${looks(copy.score)}); `;
    const text = line + (name === "heart" ? "as PNG, slimdeer can't make it smaller" : `shrunk as PNG at the same quality: ${size(compressed)}`);
    // the base is what shrinking it in place would leave: the shrink's file, or the image itself
    assert.deepEqual(result, { status: "written", text, original: bytes.length, written: copy.output.length, base: Math.min(compressed, bytes.length), sameFormat: { compressed, outcome: shrunk.outcome, score: shrunk.score } });
    if (name === "crystal-ball") assert.equal(shrunk.outcome, "hit");
    // the heart's palette is as small as slimdeer makes it, so its WebP keeps every pixel
    else assert.deepEqual([shrunk.outcome, copy.score], ["original", 100]);
  }
  assert.deepEqual(files(join(dir, "src/assets")), ["crystal-ball.png", "crystal-ball.webp", "heart.png", "heart.webp"]);
});

test("a small image is written as AVIF at a target given, and says what its shrink would do", () => {
  const png = gradient(32);
  const dir = project({ images: [], files: { "tiny.png": png } });
  const file = join(dir, "tiny.png");
  const result = convertImage(file, sibling(file, "avif"), { format: "avif", target: 80, mode: "sibling" });
  const copy = convert(png, "avif", 80);
  assert.equal(result.status, "written");
  assert.deepEqual(readFileSync(sibling(file, "avif")), Buffer.from(copy.output));
  // slimdeer makes no smaller PNG of the gradient
  assert.equal(result.sameFormat.outcome, "miss");
  assert.equal(result.base, png.length);
  assert.match(result.text, /\); as PNG, no smaller file reaches --target 80$/);
  assert.deepEqual(readFileSync(file), png);
});

test("an image whose shrink reaches no quality worth matching is left, with how to choose one", () => {
  // the gradient's best PNG looks visibly different
  const dir = project({ images: [], files: { "tiny.png": gradient(32) } });
  const file = join(dir, "tiny.png");
  for (const format of ["webp", "avif"]) {
    const { text, shell } = shrinkCommand([file], 80, undefined, format);
    const reason = `shrunk as PNG it doesn't reach quality 70, so there is no quality to match; to choose one, add --target, like${shell}: ${text}`;
    assert.deepEqual(convertImage(file, sibling(file, format), { format, mode: "sibling" }), { status: "left", reason });
  }
  // -o's own command, as --format would write another file than the one asked for
  const out = join(dir, "out.webp");
  const { reason } = convertImage(file, out, { format: "webp", mode: "named" });
  assert.match(reason, / --target 80 -o \S*out\.webp'?$/);
  assert.doesNotMatch(reason, /--format/);
  assert.deepEqual(files(dir), [".oxlintrc.json", "eslint.config.js", "package.json", "tiny.png"]);
});

test("a copy that misses its quality, or would be no smaller, is left with the reason", () => {
  // slimdeer keeps every pixel of this gradient as PNG, which AVIF doesn't reach
  const lossless = gradient(8);
  const dir = project({ images: [], files: { "lossless.png": lossless, "small.png": checker(), "stored.png": checker(true) } });
  const at = (name) => join(dir, name);
  const { score } = convert(lossless, "avif", 100);
  // a best whose rounding would show it one higher: the best is rounded down
  assert.ok(score < 100 && Math.floor(score) !== Math.round(score), `scored ${score}`);
  const best = Math.floor(score);
  assert.deepEqual(convertImage(at("lossless.png"), sibling(at("lossless.png"), "avif"), { format: "avif", mode: "sibling" }), { status: "left", reason: `as AVIF, no file reaches quality 100/100, the PNG's (the best reaches ${best}/100)` });
  assert.deepEqual(convertImage(at("lossless.png"), sibling(at("lossless.png"), "avif"), { format: "avif", target: 100, mode: "named" }), { status: "left", reason: `as AVIF, no file reaches --target 100 (the best reaches ${best}/100)` });
  // an AVIF file starts at about 300 bytes
  const small = readFileSync(at("small.png"));
  const avif = convert(small, "avif", 100).output.length;
  for (const mode of ["sibling", "named"]) {
    assert.deepEqual(convertImage(at("small.png"), at("small.avif"), { format: "avif", mode }), { status: "left", reason: `as AVIF it would be ${size(avif)}, no smaller than the image itself (${size(small.length)})` });
  }
  // a large file whose shrink is tiny: --format leaves it to the shrink, -o writes it and says so
  const stored = readFileSync(at("stored.png"));
  const shrunk = mark(compress(stored).output).length;
  const copy = convert(stored, "avif", 100).output.length;
  assert.ok(shrunk < copy && copy < stored.length);
  const { text, shell } = shrinkCommand([at("stored.png")]);
  assert.deepEqual(convertImage(at("stored.png"), sibling(at("stored.png"), "avif"), { format: "avif", mode: "sibling" }), { status: "left", reason: `as AVIF it would be ${size(copy)}, no smaller than shrinking it as PNG at the same quality (${size(shrunk)}); to shrink it in place instead, run${shell}: ${text}` });
  const named = convertImage(at("stored.png"), at("out.avif"), { format: "avif", mode: "named" });
  assert.equal(named.status, "written");
  assert.match(named.text, new RegExp(`\\); shrunk as PNG \\(lossless\\): ${size(shrunk)}, smaller than this AVIF$`));
  assert.deepEqual(files(dir), [".oxlintrc.json", "eslint.config.js", "lossless.png", "out.avif", "package.json", "small.png", "stored.png"]);
});

test("an image left out, turned down by the engine, or not taken is never converted", () => {
  const png = gradient(32);
  // a PQ color space, which WebP can't carry
  const hdr = Buffer.concat([png.subarray(0, 33), chunk("cICP", Buffer.from([9, 16, 0, 1])), png.subarray(33)]);
  const dir = project({ images: [], files: { "turned.png": turn(png, 6), "moving.png": animate(png), "hdr.png": hdr, "gray.png": grayWithProfile(16), "notes.png": "not an image" } });
  const at = (name) => join(dir, name);
  assert.deepEqual(convertImage(at("turned.png"), at("turned.webp"), { format: "webp", target: 50, mode: "sibling" }), { status: "left", reason: "its eXIf data turns it, and the WebP file would show it unturned; shrink it as PNG instead" });
  assert.deepEqual(convertImage(at("moving.png"), at("moving.avif"), { format: "avif", target: 50, mode: "named" }), { status: "left", reason: ANIMATED("AVIF") });
  assert.deepEqual(convertImage(at("hdr.png"), at("hdr.webp"), { format: "webp", target: 50, mode: "sibling" }), { status: "left", reason: "this PNG's color space is set by cICP, which WebP can't carry; keep it as PNG" });
  assert.throws(() => convertImage(at("gray.png"), at("gray.webp"), { format: "webp", mode: "sibling" }), { message: "a grayscale PNG with a color profile (slimdeer's output can look darker)" });
  assert.throws(() => convertImage(at("notes.png"), at("notes.webp"), { format: "webp", mode: "sibling" }), { message: "not a PNG or JPEG" });
  assert.throws(() => convertImage(at("missing.png"), at("missing.webp"), { format: "webp", mode: "sibling" }), { code: "ENOENT" });
  assert.deepEqual(files(dir), [".oxlintrc.json", "eslint.config.js", "gray.png", "hdr.png", "moving.png", "notes.png", "package.json", "turned.png"]);
});

test("next to the image, nothing is replaced: these very bytes are already written, anything else is in the way", (t) => {
  const png = gradient(32);
  const dir = project({ images: [], files: Object.fromEntries(["a", "b", "c", "d", "e", "f"].map((folder) => [`${folder}/tiny.png`, png])) });
  const options = { format: "webp", target: 50, mode: "sibling" };
  const copy = Buffer.from(convert(png, "webp", 50).output);
  const write = (folder) => convertImage(join(dir, folder, "tiny.png"), join(dir, folder, "tiny.webp"), options);
  assert.equal(write("a").status, "written");
  assert.deepEqual(write("a"), { status: "already" });
  writeFileSync(join(dir, "b/tiny.webp"), "another image");
  assert.deepEqual(write("b"), { status: "inTheWay" });
  assert.equal(readFileSync(join(dir, "b/tiny.webp"), "utf8"), "another image");
  mkdirSync(join(dir, "c/tiny.webp"));
  assert.deepEqual(write("c"), { status: "inTheWay" });
  for (const folder of ["a", "b", "c"]) assert.deepEqual(readFileSync(join(dir, folder, "tiny.png")), png);
  assert.deepEqual(files(join(dir, "a")), ["tiny.png", "tiny.webp"]);
  assert.deepEqual(files(join(dir, "c/tiny.webp")), []);
  // never written through a link, to another file or to none
  writeFileSync(join(dir, "other.webp"), "another image");
  if (!link(join(dir, "other.webp"), join(dir, "d/tiny.webp"))) return t.skip("symlinks require Windows Developer Mode");
  assert.deepEqual(write("d"), { status: "inTheWay" });
  assert.equal(readFileSync(join(dir, "other.webp"), "utf8"), "another image");
  link(join(dir, "nowhere.webp"), join(dir, "e/tiny.webp"));
  assert.deepEqual(write("e"), { status: "inTheWay" });
  assert.ok(!files(dir).includes("nowhere.webp"));
  // a link to these very bytes holds the copy already
  writeFileSync(join(dir, "copy.webp"), copy);
  link(join(dir, "copy.webp"), join(dir, "f/tiny.webp"));
  assert.deepEqual(write("f"), { status: "already" });
  for (const folder of ["d", "e", "f"]) {
    assert.equal(lstatSync(join(dir, folder, "tiny.webp")).isSymbolicLink(), true);
    assert.deepEqual(files(join(dir, folder)), ["tiny.png", "tiny.webp"]);
  }
});

test("a copy next to an image in a folder that can't be written fails, naming the file", { skip: process.platform === "win32" || process.getuid?.() === 0 }, (t) => {
  const png = gradient(32);
  const dir = project({ images: [], files: { "locked/tiny.png": png } });
  const folder = join(dir, "locked");
  chmodSync(folder, 0o555);
  t.after(() => chmodSync(folder, 0o755));
  const output = join(folder, "tiny.webp");
  assert.throws(() => convertImage(join(folder, "tiny.png"), output, { format: "webp", target: 50, mode: "sibling" }), { message: `can't write ${output}: permission denied` });
  assert.deepEqual(files(folder), ["tiny.png"]);
  // with the copy already there, nothing needs writing
  chmodSync(folder, 0o755);
  writeFileSync(output, convert(png, "webp", 50).output);
  chmodSync(folder, 0o555);
  assert.deepEqual(convertImage(join(folder, "tiny.png"), output, { format: "webp", target: 50, mode: "sibling" }), { status: "already" });
});

test("where hard links fail, a copy is still written only as a new file", (t) => {
  // as on FAT or exFAT, which have none: Windows says EISDIR there
  let code;
  t.mock.method(fs, "linkSync", () => {
    throw Object.assign(new Error(`${code}: link`), { code });
  });
  syncBuiltinESMExports();
  t.after(() => {
    t.mock.restoreAll();
    syncBuiltinESMExports();
  });
  const png = gradient(32);
  const copy = Buffer.from(convert(png, "webp", 50).output);
  for (code of ["EPERM", "EISDIR"]) {
    const dir = project({ images: [], files: { "a/tiny.png": png, "b/tiny.png": png, "b/tiny.webp": "another image" } });
    const options = { format: "webp", target: 50, mode: "sibling" };
    const write = (folder) => convertImage(join(dir, folder, "tiny.png"), join(dir, folder, "tiny.webp"), options);
    assert.equal(write("a").status, "written", code);
    assert.deepEqual(readFileSync(join(dir, "a/tiny.webp")), copy);
    assert.deepEqual(write("a"), { status: "already" });
    assert.deepEqual(write("b"), { status: "inTheWay" });
    assert.equal(readFileSync(join(dir, "b/tiny.webp"), "utf8"), "another image");
    for (const folder of ["a", "b"]) assert.deepEqual(files(join(dir, folder)), ["tiny.png", "tiny.webp"]);
  }
});

test("a copy written stands when its temporary folder can't be removed at once", (t) => {
  // as when a virus scanner holds the new file a moment (Windows)
  const { rmSync } = fs;
  t.mock.method(fs, "rmSync", (path, options) => {
    if (basename(path).startsWith(".slimdeer-")) throw Object.assign(new Error("EBUSY: resource busy or locked, rmdir"), { code: "EBUSY" });
    return rmSync(path, options);
  });
  syncBuiltinESMExports();
  t.after(() => {
    t.mock.restoreAll();
    syncBuiltinESMExports();
  });
  const png = gradient(32);
  const dir = project({ images: [], files: { "tiny.png": png } });
  const result = convertImage(join(dir, "tiny.png"), join(dir, "tiny.webp"), { format: "webp", target: 50, mode: "sibling" });
  assert.equal(result.status, "written");
  assert.deepEqual(readFileSync(join(dir, "tiny.webp")), Buffer.from(convert(png, "webp", 50).output));
});

test("an image named like its own copy is left, as there is no new name to write", () => {
  const png = gradient(32);
  const dir = project({ images: [], files: { "tiny.webp": png, "TINY.AVIF": png } });
  const options = { target: 50, mode: "sibling" };
  for (const [name, format] of [["tiny.webp", "webp"], ["TINY.AVIF", "avif"]]) {
    const file = join(dir, name);
    assert.deepEqual(convertImage(file, sibling(file, format), { ...options, format }), { status: "left", reason: `its name already ends in .${format}; name the copy with -o` });
  }
  // with -o, there is
  assert.equal(convertImage(join(dir, "tiny.webp"), join(dir, "copy.webp"), { ...options, format: "webp", mode: "named" }).status, "written");
  assert.deepEqual(readFileSync(join(dir, "tiny.webp")), png);
});

test("-o's file is replaced, through a link as -o does, and never with the image itself", (t) => {
  const png = gradient(32);
  const dir = project({ images: [], files: { "tiny.png": png, "out.webp": "an older copy", "kept.webp": "an older copy" } });
  const options = { format: "webp", target: 50, mode: "named" };
  const copy = Buffer.from(convert(png, "webp", 50).output);
  assert.equal(convertImage(join(dir, "tiny.png"), join(dir, "out.webp"), options).status, "written");
  assert.deepEqual(readFileSync(join(dir, "out.webp")), copy);
  // a new file
  assert.equal(convertImage(join(dir, "tiny.png"), join(dir, "new.webp"), options).status, "written");
  assert.deepEqual(readFileSync(join(dir, "new.webp")), copy);
  assert.throws(() => convertImage(join(dir, "tiny.png"), join(dir, "tiny.png"), options), { message: `can't write ${join(dir, "tiny.png")}: it is the image itself` });
  assert.deepEqual(readFileSync(join(dir, "tiny.png")), png);
  assert.deepEqual(files(dir), [".oxlintrc.json", "eslint.config.js", "kept.webp", "new.webp", "out.webp", "package.json", "tiny.png"]);
  if (!link(join(dir, "kept.webp"), join(dir, "linked.webp"))) return t.skip("symlinks require Windows Developer Mode");
  assert.equal(convertImage(join(dir, "tiny.png"), join(dir, "linked.webp"), options).status, "written");
  assert.equal(lstatSync(join(dir, "linked.webp")).isSymbolicLink(), true);
  assert.deepEqual(readFileSync(join(dir, "kept.webp")), copy);
});

test("before writing copies, a project whose framework converts images and a share image's name are named", (t) => {
  const dir = project({
    images: [],
    files: {
      "package.json": JSON.stringify({ dependencies: { astro: "5.0.0", next: "15.0.0" } }),
      "packages/web/package.json": JSON.stringify({ devDependencies: { "vite-imagetools": "7.0.0" } }),
      "packages/docs/package.json": JSON.stringify({ dependencies: { react: "19.0.0" } }),
    },
  });
  const web = join(dir, "packages/web");
  const docs = join(dir, "packages/docs");
  const note = (where, framework) => `slimdeer: ${where} depends on ${framework}, which can serve images as WebP by itself; convert only images it doesn't serve, or they go through a second lossy pass`;
  const share = (file) => `slimdeer: ${file} looks like a share image or an icon by its name; in a December 2024 test, link previews on X, LinkedIn, Slack and iMessage didn't show AVIF, so keep a PNG or JPEG for those`;
  const images = ["public/og-image.png", "public/twitter_card.jpg", "public/apple-touch-icon.png", "favicon-32.png", "public/blog.share.png", "public/dog.png", "public/sharepoint.png", "public/hero.png"];
  // from a folder above the projects: each by its path, once, by its first framework in a fixed order
  assert.deepEqual(cautions([web, docs, web, dir], "webp", images), [note(pathFrom(process.cwd(), web), "vite-imagetools"), note(pathFrom(process.cwd(), dir), "next")]);
  // from inside a project, or one of its folders
  const cwd = process.cwd();
  t.after(() => process.chdir(cwd));
  for (const folder of [dir, join(dir, "src")]) {
    mkdirSync(folder, { recursive: true });
    process.chdir(folder);
    assert.deepEqual(cautions([dir, docs], "avif", images), [note("this project", "next"), ...images.slice(0, 5).map(share)]);
  }
  assert.deepEqual(cautions([docs], "avif", ["public/hero.png"]), []);
});
