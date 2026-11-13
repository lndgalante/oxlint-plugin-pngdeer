// The command's WebP and AVIF copies: npx oxlint-plugin-slimdeer --format webp|avif IMAGE..., and
// IMAGE -o OUT.webp|.avif. No copy's size or bytes are pinned here (test/convert.test.js and
// test/engine-convert.test.js do), and AVIF runs only on tiny images, as it is slow.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import os from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { Worker } from "node:worker_threads";
import { writeCopies } from "../src/copies.js";
import { compress, convert } from "../src/engine.js";
import { mark } from "../src/marker.js";
import { size } from "../src/text.js";
import { checker, gradient, plugin, project, slimdeer } from "./helpers.js";

const SLOW = "AVIF is slow: often about a minute per image";
const HELP = "Run npx oxlint-plugin-slimdeer --help to see every option.";
const MARKED = "already shrunk by this command, so converting it would be a second lossy pass; convert the original from before it was shrunk";

/** Each of `files` in `dir` by its SHA-256, to show an original wasn't touched. */
const hashes = (dir, files) => Object.fromEntries(files.map((file) => [file, createHash("sha256").update(readFileSync(join(dir, file))).digest("hex")]));

/** The WebP and AVIF files anywhere in `dir`, sorted. */
const copies = (dir) => readdirSync(dir, { recursive: true }).map((file) => file.split("\\").join("/")).filter((file) => /\.(webp|avif)$/.test(file)).sort();

test("the help says what --format writes and how the command exits with it", () => {
  const help = slimdeer(plugin, "--help").stdout;
  assert.match(help, /^usage: oxlint-plugin-slimdeer IMAGE\.\.\. \[--target auto\|T\] \[--format webp\|avif\]\n/);
  assert.match(help, /\n {2}--format F {4}webp or avif: write each image as a new file next to it \(hero\.png ->\n/);
  assert.match(help, /\nWith --format, the command exits 0 when each image was written or left out for a reason it\nnames, 1 when one failed or another file was in the way, and 2 on a mistake\. With an OUT\nending in \.webp or \.avif, it exits 0 only when it wrote OUT\.\n/);
});

test("each usage mistake is one line, exit 2, before any work", () => {
  const dir = project();
  const images = ["public/hero.png", "public/photo.jpg"];
  const before = hashes(dir, images);
  writeFileSync(join(dir, "public/hero.jpg"), readFileSync(join(dir, "public/photo.jpg")));
  const cases = [
    [["--format", "png", "public/hero.png"], "--format must be webp or avif, not png (without --format, each image keeps its own format)"],
    // the value as it was typed
    [["--format=PNG", "public/hero.png"], "--format must be webp or avif, not PNG (without --format, each image keeps its own format)"],
    [["--flagged", "--format", "webp"], "--flagged --format would write a new file for every image the lint flagged, and each one needs a change in the code: review them first with npx oxlint-plugin-slimdeer --review --flagged --format webp, and run the command the page gives"],
    [["--format=AVIF", "--flagged"], "--flagged --format would write a new file for every image the lint flagged, and each one needs a change in the code: review them first with npx oxlint-plugin-slimdeer --review --flagged --format avif, and run the command the page gives"],
    [["public/hero.png", "-o", "hero.avif", "--format", "webp"], "--format webp and -o hero.avif name different formats: give one of them"],
    [["public/hero.png", "-o", "hero.png", "--format", "webp"], "--format webp and -o hero.png name different formats: give one of them"],
    // -o's extension names what it writes: the image's own kind (read from its bytes), or a copy's
    [["public/hero.png", "-o", "x.jpg"], "-o x.jpg: public/hero.png is a PNG, so OUT must end in .png, or in .webp or .avif to write that format"],
    [["public/hero.png", "-o", "x"], "-o x: public/hero.png is a PNG, so OUT must end in .png, or in .webp or .avif to write that format"],
    [["--format", "webp", "public/hero.png", "-o", "x"], "-o x: public/hero.png is a PNG, so OUT must end in .png, or in .webp or .avif to write that format"],
    [["public/photo.jpg", "-o", "x.png"], "-o x.png: public/photo.jpg is a JPEG, so OUT must end in .jpg or .jpeg, or in .webp or .avif to write that format"],
    [["public/hero.jpg", "-o", "x.apng"], "-o x.apng: public/hero.jpg is a JPEG, so OUT must end in .jpg or .jpeg, or in .webp or .avif to write that format"],
    [["--format", "webp", "public/hero.png", "public/hero.jpg"], "public/hero.png and public/hero.jpg would both be written as public/hero.webp: convert one of them with -o"],
    [["--format", "avif", "public/hero.png", "public/photo.jpg", "-o", "x.avif"], "-o takes one image; without it, each image's AVIF copy is written next to it"],
    // OUT asked for copies: the images alone, without -o, would be shrunk in place
    [["public/hero.png", "public/photo.jpg", "-o", "x.webp"], "-o takes one image; without it, each image's WebP copy is written next to it with --format webp"],
    [["public/hero.png", "public/photo.jpg", "-o", "x.AVIF"], "-o takes one image; without it, each image's AVIF copy is written next to it with --format avif"],
    // a folder: the example is the copy's name, which can't be the image's, even in its own folder
    [["--format", "webp", "public/hero.png", "-o", "src"], "-o src is a folder: give the file to write, like -o src/hero.webp"],
    [["--format", "avif", "public/hero.png", "-o", "public"], "-o public is a folder: give the file to write, like -o public/hero.avif"],
  ];
  // macOS and Windows don't tell letter case apart, so there HERO.webp is hero.webp
  if (process.platform === "darwin" || process.platform === "win32") {
    cases.push([["--format", "webp", "public/hero.png", "public/HERO.jpg"], "public/hero.png and public/HERO.jpg would both be written as public/hero.webp: convert one of them with -o"]);
  }
  for (const [args, message] of cases) {
    const run = slimdeer(dir, ...args);
    assert.equal(run.status, 2, args.join(" "));
    assert.equal(run.stderr, `oxlint-plugin-slimdeer: ${message}\n${HELP}\n`, args.join(" "));
    assert.equal(run.stdout, "", args.join(" "));
  }
  assert.deepEqual(copies(dir), []);
  assert.deepEqual(hashes(dir, images), before);
});

test("-o with the image's own extension, in any letter case, previews its shrink as it did, and an unreadable image is today's error", () => {
  const dir = project({ images: ["src/assets/heart.png"] });
  const run = slimdeer(dir, "src/assets/heart.png", "-o", "heart.preview.APNG");
  assert.equal(run.status, 0, run.stderr);
  assert.equal(run.stdout, "src/assets/heart.png → heart.preview.APNG: slimdeer can't make it smaller; copied as is\n");
  const missing = slimdeer(dir, "missing.png", "-o", "x.jpg");
  assert.equal(missing.status, 1);
  assert.equal(missing.stderr, "missing.png: no such file or folder\n");
});

test("--format webp writes each copy next to its image, then names the lines that still use the originals", () => {
  const dir = project();
  const images = ["public/hero.png", "src/assets/crystal-ball.png"];
  const before = hashes(dir, images);
  const run = slimdeer(dir, "--format", "webp", ...images);
  assert.equal(run.status, 0, run.stderr);
  assert.deepEqual(copies(dir), ["public/hero.webp", "src/assets/crystal-ball.webp"]);
  for (const copy of copies(dir)) assert.equal(readFileSync(join(dir, copy)).subarray(8, 12).toString("latin1"), "WEBP", copy);
  // one line each, in the order they finish
  const lines = run.stdout.trim().split("\n");
  assert.equal(lines.length, 2, run.stdout);
  assert.deepEqual(lines.map((line) => line.slice(0, 6)).sort(), ["[1/2] ", "[2/2] "]);
  assert.match(run.stdout, /^\[[12]\/2\] public\/hero\.png → public\/hero\.webp: \S+ kB → \S+ kB \(\d+% smaller, quality \d+\/100: looks [^)]+\); shrunk as PNG at the same quality: \S+ kB$/m);
  assert.match(run.stdout, /^\[[12]\/2\] src\/assets\/crystal-ball\.png → src\/assets\/crystal-ball\.webp: \S+ kB → \S+ kB \(\d+% smaller, quality \d+\/100: looks [^)]+\); shrunk as PNG at the same quality: \S+ kB$/m);
  const after = [
    "slimdeer: these lines still name the originals; point each one at its new file:",
    '  src/App.jsx:2   import crystalBall from "./assets/crystal-ball.png";',
    '  src/App.jsx:10  <img src="/hero.png" alt="An arcade stick" />',
    "  and 2 mentions in Markdown: SOURCES.md:8, SOURCES.md:10",
    "slimdeer: delete an original only once nothing uses it; other sites, emails and share previews may link to files in public/.",
  ];
  const stderr = run.stderr.trim().split("\n");
  assert.equal(stderr[0], "slimdeer: writing 2 images as WebP next to their originals, which stay as they are");
  assert.match(stderr[1], /^slimdeer: wrote 2 WebP files, \S+ kB → \S+ kB in all \(shrunk in place at the same quality, they would be \S+ kB\)\. The originals are still there\.$/);
  assert.deepEqual(stderr.slice(2), after);
  assert.deepEqual(hashes(dir, images), before);

  // again (the smaller image alone: each run converts it, to compare): the copy is there, and stays
  const written = hashes(dir, copies(dir));
  const again = slimdeer(dir, "--format", "webp", "src/assets/crystal-ball.png");
  assert.equal(again.status, 0, again.stderr);
  assert.equal(again.stdout, "src/assets/crystal-ball.png → src/assets/crystal-ball.webp: already written; left as is\n");
  assert.equal(again.stderr, "");
  assert.deepEqual(hashes(dir, copies(dir)), written);
  assert.deepEqual(hashes(dir, images), before);
});

test("a copy is never written over another file, and an image that can't be read fails alone", () => {
  const dir = project({ images: [], files: { "tiny.png": gradient(16), "other.png": gradient(16), "tiny.webp": "not this image" } });
  const before = hashes(dir, ["tiny.png", "other.png", "tiny.webp"]);
  const run = slimdeer(dir, "--format", "webp", "tiny.png");
  assert.equal(run.status, 1);
  assert.equal(run.stdout, "");
  assert.equal(run.stderr, "tiny.png: not written: tiny.webp exists already; move it, or name another file with -o\n");
  // the others are still written
  const several = slimdeer(dir, "--format", "webp", "tiny.png", "missing.png", "other.png");
  assert.equal(several.status, 1);
  assert.match(several.stderr, /^\[[123]\/3\] tiny\.png: not written: tiny\.webp exists already; move it, or name another file with -o$/m);
  assert.match(several.stderr, /^\[[123]\/3\] missing\.png: no such file or folder$/m);
  assert.match(several.stdout, /^\[[123]\/3\] other\.png → other\.webp: /m);
  assert.deepEqual(copies(dir), ["other.webp", "tiny.webp"]);
  assert.deepEqual(hashes(dir, ["tiny.png", "other.png", "tiny.webp"]), before);
});

test("AVIF says it is slow before any work, for one image, several, and -o", () => {
  const dir = project({ images: [], files: { "a.png": gradient(32), "b.png": gradient(32) } });
  const before = hashes(dir, ["a.png", "b.png"]);
  // at the automatic target, this image's shrink reaches no quality worth matching
  const one = slimdeer(dir, "--format", "avif", "a.png");
  assert.equal(one.status, 0, one.stderr);
  assert.equal(one.stderr, `slimdeer: ${SLOW}\n`);
  assert.equal(one.stdout, "a.png: not written: shrunk as PNG it doesn't reach quality 70, so there is no quality to match; to choose one, add --target, like: npx oxlint-plugin-slimdeer a.png --target 80 --format avif\n");
  assert.deepEqual(copies(dir), []);

  const several = slimdeer(dir, "--format", "avif", "a.png", "b.png", "--target", "80");
  assert.equal(several.status, 0, several.stderr);
  const lines = several.stderr.trim().split("\n");
  assert.equal(lines[0], `slimdeer: writing 2 images as AVIF next to their originals, which stay as they are; ${SLOW}`);
  assert.match(lines[1], /^slimdeer: wrote 2 AVIF files, /);
  // no file in this project names them
  assert.deepEqual(lines.slice(2), ["slimdeer: no file here names a.png, b.png; something outside this project may (a CMS, an email, another site), so keep them until you know."]);
  assert.match(several.stdout, /^\[[12]\/2\] a\.png → a\.avif: .*; as PNG, no smaller file reaches --target 80$/m);
  assert.deepEqual(copies(dir), ["a.avif", "b.avif"]);
  for (const copy of copies(dir)) assert.equal(readFileSync(join(dir, copy)).subarray(4, 12).toString("latin1"), "ftypavif", copy);

  const named = slimdeer(dir, "a.png", "-o", "copy.AVIF", "--target", "80");
  assert.equal(named.status, 0, named.stderr);
  assert.equal(named.stderr.split("\n")[0], `slimdeer: ${SLOW}`);
  assert.match(named.stdout, /^a\.png → copy\.AVIF: /);
  assert.ok(existsSync(join(dir, "copy.AVIF")));
  assert.deepEqual(hashes(dir, ["a.png", "b.png"]), before);
});

test("an image the command shrank is left out with the reason, and with -o that fails", () => {
  const dir = project({ images: [], files: { "tiny.png": gradient(16) } });
  assert.equal(slimdeer(dir, "tiny.png").status, 0);
  const before = hashes(dir, ["tiny.png"]);
  // the value in any letter case, after an = sign
  const run = slimdeer(dir, "--format=WEBP", "tiny.png");
  assert.equal(run.status, 0, run.stderr);
  assert.equal(run.stdout, `tiny.png: not written: ${MARKED}\n`);
  assert.equal(run.stderr, "");
  const named = slimdeer(dir, "tiny.png", "-o", "tiny.webp");
  assert.equal(named.status, 1);
  assert.equal(named.stdout, "");
  assert.equal(named.stderr, `tiny.png: not written: ${MARKED}\n`);
  assert.deepEqual(copies(dir), []);
  assert.deepEqual(hashes(dir, ["tiny.png"]), before);
});

test("-o OUT.webp writes that file, replacing what was there, and names the lines that still use the image", () => {
  const dir = project();
  const before = hashes(dir, ["src/assets/crystal-ball.png"]);
  writeFileSync(join(dir, "ball.webp"), "an older copy");
  const run = slimdeer(dir, "src/assets/crystal-ball.png", "-o", "ball.webp");
  assert.equal(run.status, 0, run.stderr);
  assert.match(run.stdout, /^src\/assets\/crystal-ball\.png → ball\.webp: \S+ kB → \S+ kB \(\d+% smaller, quality \d+\/100: looks [^)]+\); shrunk as PNG at the same quality: \S+ kB\n$/);
  assert.equal(readFileSync(join(dir, "ball.webp")).subarray(8, 12).toString("latin1"), "WEBP");
  assert.equal(
    run.stderr,
    [
      "slimdeer: src/assets/crystal-ball.png is still there, and this line still names it; point it at ball.webp:",
      '  src/App.jsx:2  import crystalBall from "./assets/crystal-ball.png";',
      "  and 1 mention in Markdown: SOURCES.md:8",
      "slimdeer: delete src/assets/crystal-ball.png only once nothing uses it.",
      "",
    ].join("\n"),
  );
  // --format may name the same format as OUT
  const copy = readFileSync(join(dir, "ball.webp"));
  writeFileSync(join(dir, "ball.webp"), "an older copy");
  assert.equal(slimdeer(dir, "src/assets/crystal-ball.png", "-o", "ball.webp", "--format", "webp").status, 0);
  assert.deepEqual(readFileSync(join(dir, "ball.webp")), copy);
  assert.deepEqual(hashes(dir, ["src/assets/crystal-ball.png"]), before);
});

test("after writing, at most 10 lines of code and 5 places in Markdown are listed, and a framework that converts is named", () => {
  const code = Array.from({ length: 12 }, () => '<img src="/tiny.png" />').join("\n");
  const docs = Array.from({ length: 7 }, () => "See `public/tiny.png`.").join("\n");
  const dir = project({ images: [], files: { "package.json": '{ "dependencies": { "astro": "5" } }', "public/tiny.png": gradient(16), "src/App.jsx": code, "README.md": docs } });
  const before = hashes(dir, ["public/tiny.png"]);
  const run = slimdeer(dir, "--format", "webp", "public/tiny.png");
  assert.equal(run.status, 0, run.stderr);
  assert.match(run.stdout, /^public\/tiny\.png → public\/tiny\.webp: /);
  const listed = Array.from({ length: 10 }, (_, i) => `  ${`src/App.jsx:${i + 1}`.padEnd(14)}  <img src="/tiny.png" />`);
  assert.deepEqual(run.stderr.trim().split("\n"), [
    // before the work
    "slimdeer: this project depends on astro, which can serve images as WebP by itself; convert only images it doesn't serve, or they go through a second lossy pass",
    "slimdeer: public/tiny.png is still there, and these lines still name it; point them at tiny.webp:",
    ...listed,
    "  and 2 more lines: git grep -nF -e tiny.png",
    "  and 7 mentions in Markdown: README.md:1, README.md:2, README.md:3, README.md:4, README.md:5, and 2 more",
    "slimdeer: delete public/tiny.png only once nothing uses it; other sites, emails and share previews may link to files in public/.",
  ]);
  assert.deepEqual(hashes(dir, ["public/tiny.png"]), before);
});

test("the git grep that finds the other lines takes a name that starts with - or needs quotes", () => {
  const code = ["-x.png", "my hero.png"].flatMap((name) => Array.from({ length: 12 }, () => `<img src="/${name}" />`)).join("\n");
  const dir = project({ images: [], files: { "public/-x.png": gradient(16), "public/my hero.png": gradient(16), "src/App.jsx": code } });
  const git = (...args) => spawnSync("git", args, { cwd: dir, encoding: "utf8" });
  git("init", "-q");
  git("add", "-A");
  const more = (name) => slimdeer(dir, "--format", "webp", "--", `public/${name}`).stderr.split("\n").find((line) => line.startsWith("  and "));
  // after -e, as no line holds ./-x.png
  assert.equal(more("-x.png"), "  and 2 more lines: git grep -nF -e -x.png");
  assert.equal(git("grep", "-nF", "-e", "-x.png").stdout.trim().split("\n").length, 12);
  // quoted for this platform's shell: on Windows, PowerShell's
  const line = more("my hero.png");
  assert.equal(line, `  and 2 more lines${process.platform === "win32" ? ", in PowerShell" : ""}: git grep -nF -e 'my hero.png'`);
  if (process.platform !== "win32") assert.equal(spawnSync("sh", ["-c", line.split(": ")[1]], { cwd: dir, encoding: "utf8" }).stdout.trim().split("\n").length, 12);
});

test("several copies are summed against their shrinks, and the images no file names are named in one line", () => {
  // shrunk at --target 50, this gradient keeps every pixel in a file a tenth its size, which its WebP beats
  const png = gradient(24);
  const images = ["a.png", "b.png", "c.png", "d.png", "e.png"];
  const dir = project({ images: [], files: Object.fromEntries(images.map((image) => [image, png])) });
  const run = slimdeer(dir, "--format", "webp", ...images, "--target", "50");
  assert.equal(run.status, 0, run.stderr);
  const shrunk = mark(compress(png, 50).output).length;
  const copy = convert(png, "webp", 50).output.length;
  assert.ok(copy < shrunk && shrunk < png.length);
  assert.deepEqual(run.stderr.trim().split("\n").slice(1), [
    `slimdeer: wrote 5 WebP files, ${size(5 * png.length)} → ${size(5 * copy)} in all (shrunk in place at the same quality, they would be ${size(5 * shrunk)}). The originals are still there.`,
    "slimdeer: no file here names a.png, b.png, c.png, and 2 more; something outside this project may (a CMS, an email, another site), so keep them until you know.",
  ]);
});

test("a site without a package.json is the folder the command runs in, so its pages' lines are found", () => {
  const dir = project({ images: [], files: { "img/a.png": gradient(32), "index.html": '<img src="img/a.png">\n' } });
  rmSync(join(dir, "package.json"));
  const run = slimdeer(dir, "--format", "webp", "img/a.png", "--target", "50");
  assert.equal(run.status, 0, run.stderr);
  assert.match(run.stdout, /^img\/a\.png → img\/a\.webp: /);
  assert.equal(run.stderr, ["slimdeer: img/a.png is still there, and this line still names it; point it at a.webp:", '  index.html:1  <img src="img/a.png">', "slimdeer: delete img/a.png only once nothing uses it.", ""].join("\n"));
});

test("a second run over the same files leaves the copies and the files named like them as they are", () => {
  const png = gradient(32);
  const dir = project({ images: [], files: { "a.png": png, "b.webp": png } });
  assert.equal(slimdeer(dir, "--format", "webp", "a.png", "--target", "50").status, 0);
  const before = hashes(dir, ["a.png", "a.webp", "b.webp"]);
  // as public/* would give them: a's copy is left out as no failure, and b, a PNG, has no new name to take
  const run = slimdeer(dir, "--format", "webp", "a.png", "a.webp", "b.webp", "--target", "50");
  assert.equal(run.status, 0, run.stderr);
  assert.match(run.stdout, /^\[[123]\/3\] a\.png → a\.webp: already written; left as is$/m);
  assert.match(run.stdout, /^\[[123]\/3\] b\.webp: not written: its name already ends in \.webp; name the copy with -o$/m);
  assert.match(run.stdout, /^\[[123]\/3\] a\.webp: not written: its name ends in \.webp, and it isn't a PNG or JPEG$/m);
  assert.equal(run.stderr.split("\n")[0], "slimdeer: writing 3 images as WebP next to their originals, which stay as they are");
  assert.equal(run.stderr.split("\n").length, 2, run.stderr);
  // and as AVIF, the same
  const avif = slimdeer(dir, "--format", "avif", "a.webp");
  assert.equal(avif.status, 0, avif.stderr);
  assert.equal(avif.stdout, "a.webp: not written: its name ends in .webp, and it isn't a PNG or JPEG\n");
  assert.deepEqual(hashes(dir, ["a.png", "a.webp", "b.webp"]), before);
  // what the line says is the name, as written: an empty file has one like a copy's too
  writeFileSync(join(dir, "c.AVIF"), "");
  assert.equal(slimdeer(dir, "--format", "webp", "c.AVIF").stdout, "c.AVIF: not written: its name ends in .AVIF, and it isn't a PNG or JPEG\n");
});

test("an image typed in another letter case gets its copy under its own name, and its lines are found", { skip: process.platform !== "darwin" && process.platform !== "win32" }, () => {
  const dir = project({ images: [], files: { "public/tiny.png": gradient(32), "src/App.jsx": '<img src="/tiny.png" />\n' } });
  const run = slimdeer(dir, "--format", "webp", "PUBLIC/TINY.PNG", "--target", "50");
  assert.equal(run.status, 0, run.stderr);
  // a server that tells letter case apart serves /tiny.webp only from tiny.webp
  assert.match(run.stdout, /^PUBLIC\/TINY\.PNG → PUBLIC\/tiny\.webp: /);
  assert.deepEqual(copies(dir), ["public/tiny.webp"]);
  assert.equal(run.stderr.split("\n")[1], '  src/App.jsx:1  <img src="/tiny.png" />');
});

test("with -o, a copy bigger than the image's shrink gets the command that shrinks it instead", () => {
  const dir = project({ images: [], files: { "stored.png": checker(true), "src/App.jsx": 'import stored from "../stored.png";\n' } });
  const run = slimdeer(dir, "stored.png", "-o", "out.avif");
  assert.equal(run.status, 0, run.stderr);
  assert.match(run.stdout, /^stored\.png → out\.avif: .*; shrunk as PNG \(lossless\): \S+ B, smaller than this AVIF\n$/);
  assert.equal(run.stderr, "slimdeer: AVIF is slow: often about a minute per image\nslimdeer: to shrink stored.png in place instead, run: npx oxlint-plugin-slimdeer stored.png\n");
});

test("when an engine dies, the copies written before it still get the lines that name their originals", async (t) => {
  const dir = project({ images: [], files: { "small.png": gradient(24), "large.png": gradient(32), "src/App.jsx": 'import small from "../small.png";\n' } });
  // one engine, the smaller image first, and the engine stops at the second
  t.mock.method(os, "availableParallelism", () => 1);
  syncBuiltinESMExports();
  const postMessage = Worker.prototype.postMessage;
  let sent = 0;
  t.mock.method(Worker.prototype, "postMessage", function (message) {
    if (++sent === 2) return void this.terminate();
    return postMessage.call(this, message);
  });
  const out = [];
  const err = [];
  t.mock.method(console, "log", (line) => out.push(line));
  t.mock.method(console, "error", (line) => err.push(line));
  const cwd = process.cwd();
  t.after(() => {
    process.chdir(cwd);
    t.mock.restoreAll();
    syncBuiltinESMExports();
  });
  process.chdir(dir);
  const status = await writeCopies(["large.png", "small.png"], { format: "webp", target: 50 });
  t.mock.restoreAll();
  assert.equal(status, 1);
  assert.equal(out.length, 1);
  assert.match(out[0], /^\[1\/2\] small\.png → small\.webp: /);
  assert.equal(err[0], "slimdeer: writing 2 images as WebP next to their originals, which stay as they are");
  assert.match(err[1], /^oxlint-plugin-slimdeer: engine exited/);
  assert.deepEqual(err.slice(2), ["slimdeer: small.png is still there, and this line still names it; point it at small.webp:", '  src/App.jsx:1  import small from "../small.png";', "slimdeer: delete small.png only once nothing uses it."]);
});
