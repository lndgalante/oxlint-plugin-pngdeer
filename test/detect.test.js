// What the rule finds and how it words it: CSS url() in strings and styled templates, srcSets with
// queries, an app's own public folder in a workspace, Gatsby's and React Native's layouts,
// next/image, and exclusions that hold however code reaches a file.
import assert from "node:assert/strict";
import { cpSync, existsSync, mkdirSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { cacheDir, key, read } from "../src/cache.js";
import { readFlagged } from "../src/summary.js";
import { chunk, eslint, names, oxlint, oxlintSummary, project } from "./helpers.js";

const ball = new URL("../example/src/assets/crystal-ball.png", import.meta.url);
const fire = new URL("../example/public/unused-fire.png", import.meta.url);
const NOTE = "Here next/image re-encodes it for visitors, so shrinking it saves repository and build size.";

/** Copies `image` to each of `paths` in `dir`; copies of one image are measured once. */
function place(dir, image, ...paths) {
  for (const path of paths) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    cpSync(image, join(dir, path));
  }
}

/** `png` (one IDAT chunk) as an APNG that shows its image twice: an animation, to Next.js's optimizer. */
function animate(png) {
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

/** The cached result for the image at `path` in `dir`, or null if it was never measured. */
const cached = (dir, path) => read(cacheDir(dir), key(readFileSync(join(dir, path))));

/** Where oxlint underlines the image a warning starts with: [line, column, length]. */
const oxlintSpans = ({ found }) => Object.fromEntries(found.map((d) => [d.message.split(" ")[0], [d.labels[0].span.line, d.labels[0].span.column, d.labels[0].span.length]]));

/** The same from ESLint, for one-line spans. */
const eslintSpans = ({ found }) => Object.fromEntries(found.map((m) => [m.message.split(" ")[0], [m.line, m.column, m.endColumn - m.column]]));

test("CSS url() in an inline style and in styled templates is flagged, each path underlined", () => {
  const files = {
    "src/App.jsx": [
      "export const Hero = () => <section style={{ backgroundImage: \"url(/hero.png), url('/layer.png')\" }} />;",
      "const Box = styled.div`",
      '  content: "\\201C";',
      '  background: url("/bg.png") center / cover no-repeat;',
      "  color: ${(p) => p.color};",
      "  border-image: url( '/border.png' ) 30;",
      "`;",
      'const Quote = css`content: "\\201C"; background: URL(/quote.png);`;',
      // built at runtime: a path that runs into an expression, wherever it starts
      "const Dynamic = styled.div`background: url(/img/${name}.png);`;",
      "const Built = `${base}/logo.png`;",
      "",
    ].join("\n"),
  };
  const dir = project({ files, images: [] });
  place(dir, ball, ...["hero", "layer", "bg", "border", "quote", "logo", "img/x"].map((name) => `public/${name}.png`));
  const expected = {
    "hero.png": [1, 67, 9],
    "layer.png": [1, 84, 10],
    "bg.png": [4, 20, 7],
    "border.png": [6, 23, 11],
    "quote.png": [8, 53, 10],
  };
  assert.deepEqual(oxlintSpans(oxlint(dir)), expected);
  assert.deepEqual(eslintSpans(eslint(dir, "src")), expected);
});

test("a url() that an escape spells differently underlines its part of the template", () => {
  const files = { "src/App.jsx": "export const a = 1;\nconst Escaped = styled.div`\n  background: url(/esc\\u0061ped.png);\n  color: ${c};\n`;\n" };
  const dir = project({ files, images: [] });
  place(dir, ball, "public/escaped.png");
  // from the template's backtick to the ${ that ends that part
  const [found] = oxlint(dir).found;
  assert.deepEqual([found.labels[0].span.line, found.labels[0].span.column, found.labels[0].span.length], [2, 27, 51]);
  const [message] = eslint(dir, "src").found;
  assert.deepEqual([message.line, message.column, message.endLine, message.endColumn], [2, 27, 4, 12]);
});

test("a srcSet whose candidates carry a query or hash is read candidate by candidate", () => {
  const files = { "src/App.jsx": 'export const a = <img srcSet="/logo.png?v=3 1x, /logo@2x.png?v=3 2x" />;\nexport const b = "/hero.png?v=2#top";\n' };
  const dir = project({ files, images: [] });
  place(dir, ball, "public/logo.png", "public/logo@2x.png", "public/hero.png");
  const expected = { "logo.png": [1, 31, 13], "logo@2x.png": [1, 49, 16], "hero.png": [2, 18, 19] };
  assert.deepEqual(oxlintSpans(oxlint(dir)), expected);
  assert.deepEqual(eslintSpans(eslint(dir, "src")), expected);
});

test("a path that ends an earlier one in the same string is underlined where it's written, not in the earlier one", () => {
  const files = {
    "src/App.jsx": [
      'export const a = <img srcSet="/img/logo.png 1x, /logo.png 2x" />;',
      "const Box = styled.div`",
      "  background: url(/img/bg.png);",
      "  mask-image: url(/bg.png);",
      "  color: ${(p) => p.color};",
      "`;",
      "",
    ].join("\n"),
  };
  const dir = project({ files, images: [] });
  place(dir, ball, ...["img/logo", "logo", "img/bg", "bg"].map((name) => `public/${name}.png`));
  // each warning by the path its command names, as both of a pair have one name
  const byPath = ({ found }) => ({ found: found.map((d) => ({ ...d, message: d.message.split("Run: npx oxlint-plugin-pngdeer ")[1] })) });
  const expected = {
    "public/img/logo.png": [1, 31, 13],
    "public/logo.png": [1, 49, 9],
    "public/img/bg.png": [3, 19, 11],
    "public/bg.png": [4, 19, 7],
  };
  assert.deepEqual(oxlintSpans(byPath(oxlint(dir))), expected);
  assert.deepEqual(eslintSpans(byPath(eslint(dir, "src"))), expected);
});

test('"/x.png" is looked up in the public folder nearest the file first, in a workspace with one package.json', () => {
  const page = 'export const Page = () => <img src="/logo.png" alt="" />;\n';
  const files = {
    "package.json": '{ "devDependencies": { "nx": "22.0.0" } }',
    "apps/web/project.json": "{}",
    "apps/web/src/app/page.jsx": page,
    "apps/admin/project.json": "{}",
    "apps/admin/src/page.jsx": page,
    "src/index.jsx": page,
  };
  const dir = project({ files, images: [] });
  place(dir, ball, "apps/web/public/logo.png", "public/logo.png");
  place(dir, fire, "apps/admin/public/logo.png");
  const { found } = oxlint(dir);
  const commands = Object.fromEntries(found.map((d) => [d.filename.split(/[\\/]/).slice(0, -1).join("/"), d.message.split("Run: ")[1]]));
  assert.deepEqual(commands, {
    "apps/web/src/app": "npx oxlint-plugin-pngdeer apps/web/public/logo.png",
    "apps/admin/src": "npx oxlint-plugin-pngdeer apps/admin/public/logo.png",
    src: "npx oxlint-plugin-pngdeer public/logo.png",
  });
});

test("in a Gatsby project, /x.png is static/x.png, and the build output in public/ is left alone", () => {
  const files = {
    "package.json": '{ "dependencies": { "gatsby": "^5.14.0" } }',
    "src/pages/index.jsx": 'export const Page = () => <img src="/logo.png" alt="" />;\n',
  };
  const dir = project({ files, images: [] });
  // static/ is the source; gatsby build copies it into public/, next to the images it generates
  place(dir, ball, "static/logo.png", "public/logo.png");
  place(dir, fire, "public/static/d1f3/9a2b/hero.png");
  const [found, ...rest] = oxlint(dir).found;
  assert.equal(rest.length, 0);
  assert.ok(found.message.endsWith("Run: npx oxlint-plugin-pngdeer static/logo.png"), found.message);
  assert.deepEqual(readFlagged(dir), [{ file: realpathSync(join(dir, "static/logo.png")) }]);
  assert.equal(cached(dir, "public/static/d1f3/9a2b/hero.png"), null);
  assert.doesNotMatch(oxlintSummary(dir), /public\//);
});

test("in a React Native project, an image's density and platform variants are named with it", () => {
  const files = {
    "package.json": '{ "dependencies": { "react-native": "0.80.0" } }',
    "src/App.jsx": 'import { Image } from "react-native";\nexport const Logo = () => <Image source={require("../assets/logo.png")} />;\n',
  };
  const dir = project({ files, images: [] });
  // other names that only start or end the same are other images
  place(dir, ball, ...["logo.png", "logo@2x.png", "logo@3x.ios.png", "logo.android.png", "my-logo@2x.png", "logo-dark.png"].map((name) => `assets/${name}`));
  const result = oxlint(dir);
  assert.deepEqual(names(result), ["logo.android.png", "logo.png", "logo@2x.png", "logo@3x.ios.png"]);
  // all at the string that names them
  assert.deepEqual(new Set(Object.values(oxlintSpans(result)).map(String)), new Set(["2,50,20"]));
  const stderr = oxlintSummary(dir);
  assert.match(stderr, /^pngdeer: 4 flagged images could be/m);
  assert.doesNotMatch(stderr, /assets\/logo[@.][^\n]*nothing names it/);
  // a project without React Native names the file alone
  writeFileSync(join(dir, "package.json"), "{}");
  assert.deepEqual(names(oxlint(dir)), ["logo.png"]);
  // and with it, a reference to a name that only has variants on disk still names them
  writeFileSync(join(dir, "package.json"), '{ "devDependencies": { "expo": "54.0.0" } }');
  rmSync(join(dir, "assets/logo.png"));
  assert.deepEqual(names(oxlint(dir)), ["logo.android.png", "logo@2x.png", "logo@3x.ios.png"]);
});

test("an image rendered through next/image says that Next.js re-encodes it, unless it's served as it is", () => {
  const files = {
    "src/app/page.jsx": [
      'import Image from "next/image";',
      'import NextImage from "next/legacy/image";',
      'import ball from "./ball.png";',
      'import shared from "./shared.png";',
      "export const Page = (props) => (",
      "  <>",
      '    <Image src={ball} alt="" />',
      '    <Image src="/a.png" alt="" />',
      '    <NextImage src={"/b.png"} alt="" />',
      '    <img src="/c.png" alt="" />',
      '    <Image src="/d.png" alt="" unoptimized />',
      '    <Image src="/e.png" alt="" unoptimized={false} />',
      '    <Image {...props} src="/f.png" alt="" />',
      '    <Image src={shared} alt="" />',
      '    <img src={shared.src} alt="" />',
      '    <Image src="/g.png" alt="" />',
      '    <img src="/g.png" alt="" />',
      '    <Image src="/h.png" alt="" loader={({ src }) => src} />',
      '    <Image src="/moving.png" alt="" />',
      "  </>",
      ");",
      "",
    ].join("\n"),
    "src/app/other.jsx": 'import Image from "next/image";\nexport const Other = () => <Image src="/a.png" alt="" />;\n',
    "src/app/typed.tsx": 'import Image from "next/image";\nimport typed from "./typed.png";\ntype Props = { alt: string };\nexport const Typed = ({ alt }: Props) => <Image src={typed} alt={alt} />;\n',
  };
  const dir = project({ files, images: [] });
  place(dir, ball, "src/app/ball.png", "src/app/shared.png", "src/app/typed.png", ...["a", "b", "c", "d", "e", "f", "g", "h"].map((name) => `public/${name}.png`));
  // Next.js's optimizer serves an animated image as it is
  writeFileSync(join(dir, "public/moving.png"), animate(readFileSync(ball)));
  const noted = ({ found }) => [...new Set(found.filter((d) => d.message.includes(NOTE)).map((d) => d.message.split(" ")[0]))].sort();
  const first = oxlint(dir);
  assert.deepEqual(noted(first), ["a.png", "b.png", "ball.png", "e.png", "typed.png"]);
  assert.equal(names(first).length, 13);
  assert.ok(names(first).includes("moving.png"));
  // the note sits before the command, in the full warning and in the short one another file gets
  const a = first.found.filter((d) => d.message.startsWith("a.png "));
  assert.equal(a.length, 2);
  assert.ok(a.some((d) => /^a\.png could be \d+% smaller \(.+\) and look .+ \(quality \d+\/100\)\. Here next\/image re-encodes it for visitors, so shrinking it saves repository and build size\. Run: npx oxlint-plugin-pngdeer public\/a\.png$/.test(d.message)), a[0].message);
  assert.ok(a.some((d) => d.message.includes(`as warned where it's first used. ${NOTE} Run: `)), a[0].message);
  // ESLint lints the .jsx files here, not the .tsx one
  assert.deepEqual(noted(eslint(dir, "src")), ["a.png", "b.png", "ball.png", "e.png"]);
  // a config that turns next/image's optimizing off (a static export, say) serves every image as it is
  writeFileSync(join(dir, "next.config.mjs"), "export default { output: 'export', images: { unoptimized: true } };\n");
  const plain = oxlint(dir);
  assert.equal(plain.found.length, first.found.length);
  assert.deepEqual(noted(plain), []);
  // and so may a loader of its own for every image
  writeFileSync(join(dir, "next.config.mjs"), "export default { images: { loader: 'custom', loaderFile: './image-loader.js' } };\n");
  assert.deepEqual(noted(oxlint(dir)), []);
});

test("an exclusion holds for an image code reaches through a symlinked folder", (t) => {
  const files = { "src/App.jsx": 'export const logo = "/brand/logo.png";\nexport const ball = "./assets/crystal-ball.png";\n' };
  const dir = project({ files, options: { exclude: ["design"] }, images: ["src/assets/crystal-ball.png"] });
  place(dir, fire, "design/brand/logo.png");
  mkdirSync(join(dir, "public"));
  try {
    symlinkSync(join(dir, "design/brand"), join(dir, "public/brand"), "junction");
  } catch (error) {
    if (process.platform === "win32" && error.code === "EPERM") return t.skip("symlinks require Windows Developer Mode");
    throw error;
  }
  assert.deepEqual(names(oxlint(dir)), ["crystal-ball.png"]);
  assert.equal(cached(dir, "design/brand/logo.png"), null);
  assert.deepEqual(readFlagged(dir), [{ file: realpathSync(join(dir, "src/assets/crystal-ball.png")) }]);
});

test("an exclusion holds for an image code spells in another letter case", (t) => {
  const files = { "src/App.jsx": 'export const brand = "/originals/brand.png";\n' };
  const dir = project({ files, options: { exclude: ["public/Originals"] }, images: [] });
  place(dir, fire, "public/Originals/brand.png");
  if (!existsSync(join(dir, "public/originals/brand.png"))) return t.skip("this filesystem tells the spellings apart");
  assert.deepEqual(oxlint(dir).found, []);
  assert.equal(cached(dir, "public/Originals/brand.png"), null);
});

test("an exclusion written in another letter case than the folder holds where the filesystem doesn't tell them apart", (t) => {
  const files = { "src/App.jsx": 'export const brand = "/Originals/brand.png";\nexport const ball = "./assets/crystal-ball.png";\n' };
  const dir = project({ files, options: { exclude: ["public/originals"] }, images: ["src/assets/crystal-ball.png"] });
  place(dir, fire, "public/Originals/brand.png", "public/Originals/unnamed.png");
  if (!existsSync(join(dir, "public/originals/brand.png"))) return t.skip("this filesystem tells the spellings apart");
  assert.deepEqual(names(oxlint(dir)), ["crystal-ball.png"]);
  // neither the named image nor the one the project scan finds is measured, flagged or listed
  assert.equal(cached(dir, "public/Originals/brand.png"), null);
  assert.deepEqual(readFlagged(dir), [{ file: realpathSync(join(dir, "src/assets/crystal-ball.png")) }]);
  assert.doesNotMatch(oxlintSummary(dir), /Originals/);
});

test("an exclusion holds for an image a public file links into an excluded folder", (t) => {
  const files = { "src/App.jsx": 'export const mark = "/mark.png";\nexport const ball = "./assets/crystal-ball.png";\n' };
  const dir = project({ files, options: { exclude: ["design"] }, images: ["src/assets/crystal-ball.png"] });
  place(dir, fire, "design/mark.png");
  mkdirSync(join(dir, "public"));
  try {
    symlinkSync(join(dir, "design/mark.png"), join(dir, "public/mark.png"));
  } catch (error) {
    if (process.platform === "win32" && error.code === "EPERM") return t.skip("symlinks require Windows Developer Mode");
    throw error;
  }
  assert.deepEqual(names(oxlint(dir)), ["crystal-ball.png"]);
  // the project scan doesn't measure it either, so the summary offers no command that would rewrite it
  assert.equal(cached(dir, "design/mark.png"), null);
  assert.doesNotMatch(oxlintSummary(dir), /mark\.png/);
});
