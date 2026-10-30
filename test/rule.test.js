// The rule and the command, end to end: oxlint linting small projects in temporary directories.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";
import { crc32, deflateSync } from "node:zlib";
import { marked } from "../src/marker.js";

const plugin = fileURLToPath(new URL("..", import.meta.url));
const example = join(plugin, "example");
const oxlint = join(plugin, "node_modules", "oxlint", "bin", "oxlint");
const command = join(plugin, "bin", "pngdeer.js");
const dirs = [];
after(() => dirs.forEach((dir) => rmSync(dir, { recursive: true, force: true })));

/**
 * A project with the rule set up with `options` and `files` written into it: a copy of example/, or
 * with `images`, just those of its images (the first miss measures every image in a project).
 */
function project({ files = {}, options = {}, images } = {}) {
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
  const config = { jsPlugins: [join(plugin, "src", "index.js")], rules: { "pngdeer/compressible-image": ["warn", options] } };
  writeFileSync(join(dir, ".oxlintrc.json"), JSON.stringify(config));
  for (const [path, contents] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), contents);
  }
  return dir;
}

/** oxlint's run in `dir`, and the rule's diagnostics. */
function lint(dir, ...args) {
  const run = spawnSync(process.execPath, [oxlint, "--format", "json", ...args], { cwd: dir, encoding: "utf8" });
  assert.equal(run.status, 0, run.stderr || run.stdout);
  return { found: JSON.parse(run.stdout).diagnostics.filter((d) => d.code.includes("pngdeer")), stderr: run.stderr };
}

const names = ({ found }) => found.map((d) => d.message.split(" ")[0]).sort();
const pngdeer = (cwd, ...args) => spawnSync(process.execPath, [command, ...args], { cwd, encoding: "utf8" });

test("warns on each reference to a compressible image, with the command that fixes it", () => {
  const dir = project();
  const first = lint(dir);
  // heart.png saves too little, missing.png doesn't exist, unused-fire.png isn't referenced
  assert.deepEqual(names(first), ["crystal-ball.png", "diagram.png", "diagram.png", "hero.png", "photo.jpg"]);
  const hero = first.found.find((d) => d.message.startsWith("hero.png"));
  assert.match(hero.message, /could be \d+ kB smaller \(\d+%: 509 kB → \d+ kB\)/);
  assert.match(hero.message, /Run: npx oxlint-plugin-pngdeer public\/hero\.png -o public\/hero\.png$/);
  // a second run reads the cache
  assert.deepEqual(names(lint(dir)), names(first));
});

test("files fixed with the command aren't flagged again, even on a fresh clone", () => {
  const dir = project();
  for (const file of ["public/photo.jpg", "src/assets/diagram.png"]) assert.equal(pngdeer(dir, file, "-o", file).status, 0);
  // pngdeer's own JPEG would otherwise come out about a fifth smaller again
  assert.deepEqual(names(lint(dir)), ["crystal-ball.png", "hero.png"]);
  assert.match(pngdeer(dir, "public/photo.jpg", "-o", "public/photo.jpg").stderr, /already pngdeer's/);
});

test("a fixed target is measured and repeated in the command", () => {
  const dir = project({ files: { "src/App.jsx": 'import ball from "./assets/crystal-ball.png";\n' }, options: { target: 70 }, images: ["src/assets/crystal-ball.png"] });
  const [found] = lint(dir).found;
  assert.match(found.message, / --target 70$/);
});

test("thresholds keep small savings quiet", () => {
  const dir = project({ files: { "src/App.jsx": 'import ball from "./assets/crystal-ball.png";\n' }, options: { minPercent: 90 }, images: ["src/assets/crystal-ball.png"] });
  assert.deepEqual(lint(dir).found, []);
});

test("paths with spaces are found and quoted for the platform's shell", () => {
  const dir = project({ files: { "src/App.jsx": 'import shot from "./assets/My Shot, final.png";\n' }, images: ["src/assets/crystal-ball.png"] });
  cpSync(join(dir, "src/assets/crystal-ball.png"), join(dir, "src/assets/My Shot, final.png"));
  const [found] = lint(dir).found;
  const quoted = process.platform === "win32" ? '"src/assets/My Shot, final.png"' : "'src/assets/My Shot, final.png'";
  assert.ok(found.message.endsWith(`Run: npx oxlint-plugin-pngdeer ${quoted} -o ${quoted}`), found.message);
});

test("srcSet lists and public paths resolve", () => {
  const files = { "src/App.jsx": 'export const a = <img srcSet="./assets/crystal-ball.png 1x, /photo.jpg 2x" />;\n' };
  const dir = project({ files, images: ["src/assets/crystal-ball.png", "public/photo.jpg"] });
  assert.deepEqual(names(lint(dir)), ["crystal-ball.png", "photo.jpg"]);
});

test("runs from a parent directory find the same images", () => {
  const files = { "src/App.jsx": 'import ball from "./assets/crystal-ball.png";\nexport const photo = "/photo.jpg";\n' };
  const dir = project({ files, images: ["src/assets/crystal-ball.png", "public/photo.jpg"] });
  assert.deepEqual(names(lint(join(dir, ".."), join(dir, "src"))), ["crystal-ball.png", "photo.jpg"]);
});

test("an unreadable image is skipped, not an error", { skip: process.platform === "win32" }, () => {
  const files = { "src/App.jsx": 'import a from "./assets/crystal-ball.png";\nimport b from "./assets/diagram.png";\n' };
  const dir = project({ files, images: ["src/assets/crystal-ball.png", "src/assets/diagram.png"] });
  chmodSync(join(dir, "src/assets/diagram.png"), 0o000);
  try {
    assert.deepEqual(names(lint(dir)), ["crystal-ball.png"]);
  } finally {
    chmodSync(join(dir, "src/assets/diagram.png"), 0o644);
  }
});

test("an image pngdeer fails on is named, not silently skipped", () => {
  // pngdeer's engine panics on this image at target 90 (a bug upstream); if it ever stops, this test
  // needs another image it fails on
  const dir = project({ files: { "src/App.jsx": 'import fade from "./assets/fade.png";\n', "src/assets/fade.png": fade() }, options: { target: 90 }, images: [] });
  const { found, stderr } = lint(dir);
  assert.deepEqual(found, []);
  assert.match(stderr, /pngdeer: src\/assets\/fade\.png: pngdeer couldn't compress this image: unreachable \(a bug in pngdeer/);
  const run = pngdeer(dir, "src/assets/fade.png", "-o", "src/assets/fade.png", "--target", "90");
  assert.equal(run.status, 1);
  assert.match(run.stderr, /src\/assets\/fade\.png: pngdeer couldn't compress this image/);
});

test("the command refuses a target it can't reach, and leaves the file alone", () => {
  const dir = project({ images: ["src/assets/crystal-ball.png"] });
  const before = readFileSync(join(dir, "src/assets/crystal-ball.png"));
  const run = pngdeer(dir, "src/assets/crystal-ball.png", "-o", "src/assets/crystal-ball.png", "--target", "95");
  assert.equal(run.status, 1);
  assert.match(run.stderr, /no smaller file reaches --target 95 \(the closest scores \d+\.\d\), so nothing was written/);
  assert.deepEqual(readFileSync(join(dir, "src/assets/crystal-ball.png")), before);
});

test("the command leaves a file it can't shrink as it was, unmarked", () => {
  const dir = project({ images: ["src/assets/heart.png"] });
  const before = readFileSync(join(dir, "src/assets/heart.png"));
  const run = pngdeer(dir, "src/assets/heart.png", "-o", "src/assets/heart.png");
  assert.equal(run.status, 0);
  assert.match(run.stderr, /already as small as pngdeer makes it/);
  const after = readFileSync(join(dir, "src/assets/heart.png"));
  assert.deepEqual(after, before);
  assert.equal(marked(after), false);
});

test("the command checks its arguments", () => {
  assert.equal(pngdeer(plugin).status, 1);
  assert.equal(pngdeer(plugin, "a.png").status, 1);
  assert.match(pngdeer(plugin, "a.png", "-o", "b.png", "--target", "200").stderr, /bad --target/);
  assert.match(pngdeer(plugin, "--help").stdout, /usage: oxlint-plugin-pngdeer/);
});

/** A 320 × 240 RGBA gradient fading to transparent, as a PNG. */
function fade() {
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
