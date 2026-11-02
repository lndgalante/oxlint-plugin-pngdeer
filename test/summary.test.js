import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { cacheDir, key, write } from "../src/cache.js";
import { flaggedList, readFlagged } from "../src/summary.js";
import { oxlintSummary, pngdeer, project } from "./helpers.js";

let runs = 0;

/**
 * The summary a lint in `dir` would end with, where linted code names `named` and warns about nothing,
 * and each of `images` is cached as 9 kB smaller. The project is `root` (from `dir`), and the run
 * linted `linted` there.
 */
async function summaryIn(t, dir, images, named = [], { root = ".", linted = "src/main.js" } = {}) {
  const project = join(dir, root);
  for (const image of images) {
    const bytes = readFileSync(join(dir, image));
    write(cacheDir(project), key(bytes), { original: bytes.length, compressed: bytes.length - 9000, outcome: "hit", score: 90 });
  }
  const summary = await import(`../src/summary.js?run=${++runs}`);
  for (const file of named) summary.name(join(dir, file));
  summary.watch(project, { minSavedBytes: 4096, minSavedPercent: 10, dir: cacheDir(project), scan: "project", exclude: [], publicDirs: ["public", "static"] }, join(project, linted));
  let stderr = "";
  const print = t.mock.method(process.stderr, "write", (text) => {
    stderr += text;
    return true;
  });
  summary.summarize(dir);
  print.mock.restore();
  return stderr;
}

test("summary commands keep each package's measured quality target", () => {
  const dir = project({
    images: [],
    files: {
      "packages/a/package.json": "{}",
      "packages/a/src/app.js": "export const app = 1;",
      "packages/a/public/bg.png": "a".repeat(10000),
      "packages/b/package.json": "{}",
      "packages/b/src/app.js": "export const app = 2;",
      "packages/b/public/bg.png": "b".repeat(10000),
    },
    options: { measure: "never" },
  });
  const config = JSON.parse(readFileSync(join(dir, ".oxlintrc.json"), "utf8"));
  config.overrides = [
    { files: ["packages/a/**"], rules: { "pngdeer/compressible-image": ["warn", { measure: "never", target: 90 }] } },
    { files: ["packages/b/**"], rules: { "pngdeer/compressible-image": ["warn", { measure: "never", target: 70 }] } },
  ];
  writeFileSync(join(dir, ".oxlintrc.json"), JSON.stringify(config));
  for (const [name, target] of [["a", 90], ["b", 70]]) {
    const root = join(dir, "packages", name);
    const bytes = readFileSync(join(root, "public/bg.png"));
    write(cacheDir(root), key(bytes, target), { original: bytes.length, compressed: 1000, outcome: "hit", score: target });
  }
  const stderr = oxlintSummary(dir, "packages");
  assert.match(stderr, /run: npx oxlint-plugin-pngdeer packages\/a\/public\/bg\.png --target 90$/m);
  assert.match(stderr, /run: npx oxlint-plugin-pngdeer packages\/b\/public\/bg\.png --target 70$/m);
});

test("the summary points at the file that names an image's path, and not at a longer name", async (t) => {
  const image = "a".repeat(10000);
  const files = {
    "blog/post/img/social-card.png": image,
    "blog/post/index.mdx": "---\nimage: ./img/social-card.png\n---\n",
    // a stylesheet comes first, but names another social-card.png
    "src/home.css": ".card { background: url(./img/social-card.png); }\n.logo { background: url(/site-logo.png); }\n",
    "public/logo.png": image,
    "public/team photo.png": image,
    "src/team.html": '<img src="/team%20photo.png">\n',
  };
  const dir = project({ images: [], files });
  const stderr = await summaryIn(t, dir, ["blog/post/img/social-card.png", "public/logo.png", "public/team photo.png"]);
  assert.match(stderr, /^  blog\/post\/img\/social-card\.png .* used in blog\/post\/index\.mdx$/m);
  assert.match(stderr, /^  public\/logo\.png .* nothing names it$/m);
  assert.match(stderr, /^  public\/team photo\.png .* used in src\/team\.html$/m);
});

test("Next.js metadata images aren't called unused in a project that depends on next", async (t) => {
  const image = "a".repeat(10000);
  const files = { "package.json": JSON.stringify({ dependencies: { next: "15.0.0" } }), "src/app/opengraph-image.png": image, "src/app/blog/icon2.png": image };
  const dir = project({ images: [], files });
  const next = await summaryIn(t, dir, ["src/app/opengraph-image.png", "src/app/blog/icon2.png"]);
  assert.match(next, /^  src\/app\/opengraph-image\.png .* a Next\.js metadata file$/m);
  assert.match(next, /^  src\/app\/blog\/icon2\.png .* a Next\.js metadata file$/m);
  assert.doesNotMatch(next, /may be unused/);
  // Rails and Ember keep icons in app/ too
  writeFileSync(join(dir, "package.json"), "{}");
  const other = await summaryIn(t, dir, []);
  assert.match(other, /^  src\/app\/opengraph-image\.png .* nothing names it$/m);
  assert.match(other, /^pngdeer: an image nothing names may be unused/m);
});

test("an image code names in another case or Unicode form isn't listed again as unnamed", async (t) => {
  const image = "a".repeat(10000);
  const dir = project({ images: [], files: { "src/assets/Logo.png": image, "src/assets/café.png": image, "src/assets/other.png": image } });
  // the spellings of the first two that this filesystem takes for them (case on macOS and Windows, Unicode form on macOS)
  const onDisk = { "src/assets/logo.png": "src/assets/Logo.png", "src/assets/café.png": "src/assets/café.png" };
  const named = Object.keys(onDisk).filter((file) => existsSync(join(dir, file)));
  if (named.length === 0) return t.skip("this filesystem tells the spellings apart");
  const stderr = await summaryIn(t, dir, Object.values(onDisk).concat("src/assets/other.png"), named);
  assert.match(stderr, /^  src\/assets\/other\.png /m);
  for (const file of named) assert.ok(!stderr.includes(onDisk[file]), stderr);
});

test("unnamed images past the table are added up, and the summary says how to stop listing them", async (t) => {
  const files = Object.fromEntries(Array.from({ length: 7 }, (_, i) => [`public/${i}.png`, "a".repeat(10000)]));
  const dir = project({ images: [], files });
  const stderr = await summaryIn(t, dir, Object.keys(files));
  assert.match(stderr, /^pngdeer: no warnings, but 7 images that no linted JS or TS names could be 63 kB smaller:$/m);
  assert.match(stderr, /^  …and 2 more images, 18 kB in all$/m);
  // the command takes the rows shown, and says so
  assert.match(stderr, /^pngdeer: to shrink the 5 biggest of 7 in place \(lossy, so commit first\), run: npx oxlint-plugin-pngdeer( public\/\d\.png){5}$/m);
  assert.match(stderr, /^pngdeer: to keep them as is and stop listing them, add their paths to the rule's "exclude" option$/m);
  const one = project({ images: [], files: { "public/0.png": "a".repeat(10000) } });
  assert.match(await summaryIn(t, one, ["public/0.png"]), /^pngdeer: to keep it as is and stop listing it, add its path to the rule's "exclude" option$/m);
});

test("linted from above a package, the summary names the exclude entries from the package's folder", async (t) => {
  const image = "a".repeat(10000);
  const dir = project({ images: [], files: { "packages/web/package.json": "{}", "packages/web/public/unused.png": image, "packages/web/public/old.png": image } });
  const one = await summaryIn(t, dir, ["packages/web/public/unused.png"], ["packages/web/public/old.png"], { root: "packages/web" });
  assert.match(one, /^  packages\/web\/public\/unused\.png /m);
  assert.match(one, /^pngdeer: to keep it as is and stop listing it, add "public\/unused\.png" to the rule's "exclude" option \(its paths start at packages\/web\)$/m);
  const both = await summaryIn(t, dir, ["packages/web/public/unused.png", "packages/web/public/old.png"], [], { root: "packages/web" });
  assert.match(both, /^pngdeer: to keep them as is and stop listing them, add "public\/(unused|old)\.png", "public\/(unused|old)\.png" to the rule's "exclude" option \(its paths start at packages\/web\)$/m);
});

test("the summary says when the files naming an image are of a kind the run linted none of", async (t) => {
  const files = { "public/arcade.png": "a".repeat(10000), "src/Gallery.tsx": 'export const src = "/arcade.png";\n' };
  const dir = project({ images: [], files });
  // an ESLint config that lints only .js files
  const js = await summaryIn(t, dir, ["public/arcade.png"]);
  assert.match(js, /^  public\/arcade\.png .* named in src\/Gallery\.tsx$/m);
  assert.match(js, /^pngdeer: this run linted no \.tsx files, like src\/Gallery\.tsx, so their images get no warning; with ESLint, see https:\/\/github\.com\/lndgalante\/oxlint-plugin-pngdeer#quick-start-with-eslint$/m);
  // a one-file lint of a .tsx file: the others are left out on purpose
  assert.doesNotMatch(await summaryIn(t, dir, ["public/arcade.png"], [], { linted: "src/Other.tsx" }), /linted no/);
});

test("corrupt flagged lists are rejected before the command reads image paths", () => {
  const dir = project({ images: [] });
  mkdirSync(cacheDir(dir), { recursive: true });
  const file = join(dir, "image.png");
  for (const value of [{}, "invalid", [null], [{}], [{ file: 123 }], [{ file: "relative.png" }], [{ file, target: "90" }], [{ file, target: null }], [{ file, target: -1 }], [{ file, target: 101 }]]) {
    writeFileSync(flaggedList(dir), JSON.stringify(value));
    assert.equal(readFlagged(dir), null, JSON.stringify(value));
  }
  const run = pngdeer(dir, "--flagged");
  assert.equal(run.status, 1);
  assert.match(run.stderr, /run npx oxlint, or eslint without --cache, in this folder first/);
  assert.doesNotMatch(run.stderr, /TypeError|RangeError/);
  const valid = [{ file }, { file, target: 90 }];
  writeFileSync(flaggedList(dir), JSON.stringify(valid));
  assert.deepEqual(readFlagged(dir), valid);
});

test("shared images keep the strictest reported target regardless of file order", async (t) => {
  t.mock.method(process.stderr, "write", () => true);
  for (const targets of [[90, 70], [70, 90]]) {
    const dir = project({ images: [] });
    const summary = await import(`../src/summary.js?targets=${targets.join("-")}`);
    const file = join(dir, "image.png");
    summary.watch(dir, { minSavedBytes: 4096, minSavedPercent: 10, dir: cacheDir(dir) });
    for (const target of targets) {
      summary.flag(file, join(dir, `${target}.js`), { original: 10000, compressed: 1000, score: target, target });
    }
    summary.summarize(dir);
    assert.deepEqual(readFlagged(dir), [{ file, target: 90 }]);
  }
});
