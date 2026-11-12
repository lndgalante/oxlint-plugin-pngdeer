import assert from "node:assert/strict";
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, symlinkSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { test } from "node:test";
import { Worker } from "node:worker_threads";
import { cacheDir, key, write } from "../src/cache.js";
import { flaggedList, readFlagged } from "../src/summary.js";
import { oxlintSummary, slimdeer, project } from "./helpers.js";

let runs = 0;

/**
 * The summary a lint in `dir` would end with, where linted code names `named`, warns about each of
 * `flagged` ([path from dir, { original, compressed, score, target }]), and each of `images` is cached
 * as 9 kB smaller. The project is `root` (from `dir`), and the run linted `linted` there. With
 * `settled`, a linted file reported that the lint is incomplete.
 */
async function summaryIn(t, dir, images, named = [], { root = ".", linted = "src/main.js", flagged = [], settled = false } = {}) {
  const project = join(dir, root);
  for (const image of images) {
    const bytes = readFileSync(join(dir, image));
    write(cacheDir(project), key(bytes), { original: bytes.length, compressed: bytes.length - 9000, outcome: "hit", score: 90 });
  }
  const summary = await import(`../src/summary.js?run=${++runs}`);
  for (const file of named) summary.name(join(dir, file));
  summary.watch(project, { minSavedBytes: 4096, minSavedPercent: 10, dir: cacheDir(project), scan: "project", exclude: [], publicDirs: ["public", "static"] }, join(project, linted));
  for (const [file, entry] of flagged) summary.flag(join(dir, file), join(project, linted), entry);
  if (settled) summary.settle();
  let stderr = "";
  const print = t.mock.method(process.stderr, "write", (text) => {
    stderr += text;
    return true;
  });
  summary.summarize(dir);
  print.mock.restore();
  return stderr;
}

/** As in a GitHub Actions step, whose job summary goes to `file`, in a checkout at `workspace`. */
function inActions(t, file, workspace) {
  process.env.GITHUB_STEP_SUMMARY = file;
  if (workspace) process.env.GITHUB_WORKSPACE = workspace;
  t.after(() => {
    delete process.env.GITHUB_STEP_SUMMARY;
    delete process.env.GITHUB_WORKSPACE;
  });
}

/** A flagged image's measurement: `saved` bytes off 100 kB, at quality `score`. */
const saving = (saved, score, target) => ({ original: 100000, compressed: 100000 - saved, score, target });

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
    { files: ["packages/a/**"], rules: { "slimdeer/compressible-image": ["warn", { measure: "never", target: 90 }] } },
    { files: ["packages/b/**"], rules: { "slimdeer/compressible-image": ["warn", { measure: "never", target: 70 }] } },
  ];
  writeFileSync(join(dir, ".oxlintrc.json"), JSON.stringify(config));
  for (const [name, target] of [["a", 90], ["b", 70]]) {
    const root = join(dir, "packages", name);
    const bytes = readFileSync(join(root, "public/bg.png"));
    write(cacheDir(root), key(bytes, target), { original: bytes.length, compressed: 1000, outcome: "hit", score: target });
  }
  const stderr = oxlintSummary(dir, "packages");
  assert.match(stderr, /run: npx oxlint-plugin-slimdeer packages\/a\/public\/bg\.png --target 90$/m);
  assert.match(stderr, /run: npx oxlint-plugin-slimdeer packages\/b\/public\/bg\.png --target 70$/m);
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
  assert.match(other, /^slimdeer: an image nothing names may be unused/m);
});

test("an image code names in another case or Unicode form isn't listed again as unnamed", async (t) => {
  const image = "a".repeat(10000);
  const dir = project({ images: [], files: { "src/assets/Logo.png": image, "src/assets/café.png": image, "src/assets/other.png": image } });
  // the spellings of the first two that this filesystem takes for them (case on macOS and Windows, Unicode form on macOS)
  const onDisk = { "src/assets/logo.png": "src/assets/Logo.png", "src/assets/café.png": "src/assets/café.png" };
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
  // the lead is true of every row, "named in" a file the run linted included
  assert.match(stderr, /^slimdeer: no warnings, but 7 images could be 63 kB smaller \(named only where this run can't warn, or nowhere\):$/m);
  assert.match(stderr, /^  …and 2 more images, 18 kB in all$/m);
  // the command takes the rows shown, and says so
  assert.match(stderr, /^slimdeer: to shrink the 5 biggest of 7 in place \(lossy, so commit first\), run: npx oxlint-plugin-slimdeer( public\/\d\.png){5}$/m);
  assert.match(stderr, /^slimdeer: to keep them as is and stop listing them, add their paths to the rule's "exclude" option$/m);
  const one = project({ images: [], files: { "public/0.png": "a".repeat(10000) } });
  assert.match(await summaryIn(t, one, ["public/0.png"]), /^slimdeer: to keep it as is and stop listing it, add its path to the rule's "exclude" option$/m);
});

test("linted from above a package, the summary names the exclude entries from the package's folder", async (t) => {
  const image = "a".repeat(10000);
  const dir = project({ images: [], files: { "packages/web/package.json": "{}", "packages/web/public/unused.png": image, "packages/web/public/old.png": image } });
  const one = await summaryIn(t, dir, ["packages/web/public/unused.png"], ["packages/web/public/old.png"], { root: "packages/web" });
  assert.match(one, /^  packages\/web\/public\/unused\.png /m);
  assert.match(one, /^slimdeer: to keep it as is and stop listing it, add "public\/unused\.png" to the rule's "exclude" option \(its paths start at packages\/web\)$/m);
  const both = await summaryIn(t, dir, ["packages/web/public/unused.png", "packages/web/public/old.png"], [], { root: "packages/web" });
  assert.match(both, /^slimdeer: to keep them as is and stop listing them, add "public\/(unused|old)\.png", "public\/(unused|old)\.png" to the rule's "exclude" option \(its paths start at packages\/web\)$/m);
});

test("the summary says when the files naming an image are of a kind the run linted none of", async (t) => {
  const files = { "public/arcade.png": "a".repeat(10000), "src/Gallery.tsx": 'export const src = "/arcade.png";\n' };
  const dir = project({ images: [], files });
  // an ESLint config that lints only .js files
  const js = await summaryIn(t, dir, ["public/arcade.png"]);
  assert.match(js, /^  public\/arcade\.png .* named in src\/Gallery\.tsx$/m);
  assert.match(js, /^slimdeer: this run linted no \.tsx files, like src\/Gallery\.tsx, so their images get no warning; with ESLint, see https:\/\/github\.com\/lndgalante\/oxlint-plugin-slimdeer#quick-start-with-eslint$/m);
  // a one-file lint of a .tsx file: the others are left out on purpose, and the rule warns in them
  // when they're linted, so the lead blames this run, not the rule
  const one = await summaryIn(t, dir, ["public/arcade.png"], [], { linted: "src/Other.tsx" });
  assert.doesNotMatch(one, /linted no/);
  assert.match(one, /^slimdeer: no warnings, but 1 image could be 9\.0 kB smaller \(named only where this run can't warn, or nowhere\):$/m);
});

test("the flagged list names the folder the lint ran in, and each image from there", async (t) => {
  const dir = project({ images: ["src/assets/crystal-ball.png"], files: { "packages/web/package.json": "{}", "shared/logo.png": "a".repeat(10000) } });
  await summaryIn(t, dir, [], [], { flagged: [["src/assets/crystal-ball.png", saving(24000, 87, 90)]] });
  assert.deepEqual(JSON.parse(readFileSync(flaggedList(dir), "utf8")), { cwd: realpathSync.native(dir), images: [{ file: "src/assets/crystal-ball.png", target: 90 }] });
  // absolute again, from the folder with its links resolved (macOS's /var is /private/var)
  const ball = [{ file: join(realpathSync(dir), "src/assets/crystal-ball.png"), target: 90 }];
  assert.deepEqual(readFlagged(dir), ball);
  // the same folder through a link to it
  const elsewhere = project({ images: [] });
  const link = join(elsewhere, "link");
  symlinkSync(dir, link, "junction");
  assert.deepEqual(readFlagged(link), ball);
  // linted through that link, with the image spelled the other way: from the folder, not up and back
  await summaryIn(t, link, [], [], { flagged: [[relative(link, join(dir, "src/assets/crystal-ball.png")), saving(24000, 87, 90)]] });
  assert.deepEqual(JSON.parse(readFileSync(flaggedList(dir), "utf8")).images, [{ file: "src/assets/crystal-ball.png", target: 90 }]);
  // an image through a linked folder keeps the spelling its warning showed
  symlinkSync(join(dir, "shared"), join(dir, "src/brand"), "junction");
  await summaryIn(t, dir, [], [], { flagged: [["src/brand/logo.png", saving(9000, 90)]] });
  assert.deepEqual(JSON.parse(readFileSync(flaggedList(dir), "utf8")).images, [{ file: "src/brand/logo.png" }]);
  assert.deepEqual(readFlagged(dir), [{ file: join(realpathSync(dir), "src/brand/logo.png") }]);
  // a lint run from a package can flag an image outside it, which its warning showed as ../, and
  // one since deleted stays as the lint spelled it
  const web = join(dir, "packages/web");
  await summaryIn(t, web, [], [], { flagged: [["../../shared/logo.png", saving(9000, 90)], ["../../gone.png", saving(5000, 90)]] });
  assert.deepEqual(JSON.parse(readFileSync(flaggedList(web), "utf8")).images, [{ file: "../../shared/logo.png" }, { file: "../../gone.png" }]);
  assert.deepEqual(readFlagged(web), [{ file: join(realpathSync(dir), "shared/logo.png") }, { file: join(realpathSync(dir), "gone.png") }]);
  // the cache folder its lint measured it into, when the settings name one, for --review --flagged
  await summaryIn(t, dir, [], [], { flagged: [["src/assets/crystal-ball.png", { ...saving(24000, 87, 90), cacheDir: join(dir, ".slimdeer") }]] });
  assert.deepEqual(JSON.parse(readFileSync(flaggedList(dir), "utf8")).images, [{ file: "src/assets/crystal-ball.png", target: 90, cacheDir: ".slimdeer" }]);
  assert.deepEqual(readFlagged(dir), [{ ...ball[0], cacheDir: join(realpathSync(dir), ".slimdeer") }]);
  // the folder the lint ran in itself (cacheDir: "."), which an empty path can't name
  await summaryIn(t, dir, [], [], { flagged: [["src/assets/crystal-ball.png", { ...saving(24000, 87, 90), cacheDir: dir }]] });
  assert.deepEqual(JSON.parse(readFileSync(flaggedList(dir), "utf8")).images, [{ file: "src/assets/crystal-ball.png", target: 90, cacheDir: "." }]);
  assert.deepEqual(readFlagged(dir), [{ ...ball[0], cacheDir: realpathSync(dir) }]);
});

test("--flagged in a copied project or another worktree doesn't rewrite the images of the folder that linted", async (t) => {
  const dir = project({ images: ["src/assets/crystal-ball.png"] });
  const ball = readFileSync(join(dir, "src/assets/crystal-ball.png"));
  await summaryIn(t, dir, [], [], { flagged: [["src/assets/crystal-ball.png", saving(24000, 87)]] });
  // a copy to try the shrink on first, cache folder and all
  const copy = project({ images: [] });
  cpSync(dir, copy, { recursive: true });
  // a worktree whose node_modules links to the first one's
  const worktree = project({ images: ["src/assets/crystal-ball.png"] });
  symlinkSync(join(dir, "node_modules"), join(worktree, "node_modules"), "junction");
  for (const other of [copy, worktree]) {
    assert.equal(readFlagged(other), null);
    const run = slimdeer(other, "--flagged");
    assert.equal(run.status, 1, run.stdout);
    assert.match(run.stderr, /^oxlint-plugin-slimdeer: no list of flagged images here: lint in this folder first \(npx oxlint, or eslint without --cache\); if a lint here flagged no image, there is nothing to do$/m);
  }
  assert.ok(readFileSync(join(dir, "src/assets/crystal-ball.png")).equals(ball));
  assert.equal(readFlagged(dir).length, 1);
});

test("--flagged and --review --flagged leave alone an image changed since the lint, which flagged other bytes", () => {
  const ball = "src/assets/crystal-ball.png";
  const dir = project({ images: [ball, "public/unused-fire.png"], files: { "src/a.js": 'import ball from "./assets/crystal-ball.png";\n' }, options: { scan: "referenced" } });
  oxlintSummary(dir);
  // other bytes there since (a branch switch, a new export, another tool's pass), which the lint
  // may leave alone: neither command measures or shrinks them
  cpSync(join(dir, "public/unused-fire.png"), join(dir, ball));
  const other = readFileSync(join(dir, ball));
  const review = slimdeer(dir, "--review", "--flagged");
  assert.equal(review.status, 2);
  assert.equal(review.stderr, `${ball}: changed since the last lint here; lint again to check it\n`);
  assert.equal(review.stdout, "slimdeer: review incomplete: none of the images the last lint here flagged could be shown; lint again to update the list.\n");
  const run = slimdeer(dir, "--flagged");
  assert.equal(run.status, 1);
  assert.equal(run.stderr, `${ball}: changed since the last lint here; left as is (lint again to check it)\n`);
  assert.equal(run.stdout, "");
  assert.ok(readFileSync(join(dir, ball)).equals(other));
  // a lint flags these bytes, and --flagged shrinks them; then they're slimdeer's, left as they are
  oxlintSummary(dir);
  const shrunk = slimdeer(dir, "--flagged");
  assert.equal(shrunk.status, 0, shrunk.stderr);
  assert.match(shrunk.stdout, /^src\/assets\/crystal-ball\.png: 13 kB → /);
  const again = slimdeer(dir, "--flagged");
  assert.equal(again.status, 0, again.stderr);
  assert.equal(again.stdout, `${ball}: already slimdeer's; left as is\n`);
});

test("a list from 0.5.0, which doesn't say where its lint ran, isn't used", () => {
  const dir = project({ images: [] });
  mkdirSync(cacheDir(dir), { recursive: true });
  // even when its images are in this folder: a worktree inside this one looks just the same
  writeFileSync(flaggedList(dir), JSON.stringify([{ file: join(realpathSync.native(dir), "image.png"), target: 90 }]));
  assert.equal(readFlagged(dir), null);
});

test("corrupt flagged lists are rejected before the command reads image paths", () => {
  const dir = project({ images: [] });
  mkdirSync(cacheDir(dir), { recursive: true });
  const here = realpathSync.native(dir);
  const entries = [null, {}, { file: 123 }, { file: "" }, { file: "a\0.png" }, { file: "a.png", target: "90" }, { file: "a.png", target: null }, { file: "a.png", target: -1 }, { file: "a.png", target: 101 }, { file: "a.png", cacheDir: 1 }, { file: "a.png", cacheDir: "" }, { file: "a.png", cacheDir: ".png\0deer" }, { file: "a.png", key: "abc" }, { file: "a.png", key: 1 }];
  const values = [{}, "invalid", null, [], { cwd: here }, { cwd: here, images: {} }, { cwd: 1, images: [] }, ...entries.map((entry) => ({ cwd: here, images: [entry] }))];
  for (const value of values) {
    writeFileSync(flaggedList(dir), JSON.stringify(value));
    assert.equal(readFlagged(dir), null, JSON.stringify(value));
  }
  const run = slimdeer(dir, "--flagged");
  assert.equal(run.status, 1);
  assert.match(run.stderr, /lint in this folder first \(npx oxlint, or eslint without --cache\)/);
  assert.doesNotMatch(run.stderr, /TypeError|RangeError/);
  // with the key of the bytes the lint measured: an image gone since isn't called changed, as
  // shrinking it says it's gone
  writeFileSync(flaggedList(dir), JSON.stringify({ cwd: here, images: [{ file: "a.png", key: "0".repeat(64) }, { file: "b/c.png", target: 90, cacheDir: ".slimdeer" }] }));
  assert.deepEqual(readFlagged(dir), [{ file: join(realpathSync(dir), "a.png") }, { file: resolve(realpathSync(dir), "b/c.png"), target: 90, cacheDir: join(realpathSync(dir), ".slimdeer") }]);
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
    // image.png isn't on disk (as if deleted since it was measured): still listed, from this folder
    assert.deepEqual(JSON.parse(readFileSync(flaggedList(dir), "utf8")).images, [{ file: "image.png", target: 90 }]);
    assert.deepEqual(readFlagged(dir), [{ file: join(realpathSync(dir), "image.png"), target: 90 }]);
  }
});

test("a lint thread's share left by a dead run with this process's PID isn't taken for this run's", async (t) => {
  const dir = project({ images: [], files: { "stale.png": "a", "live.png": "a" } });
  const threads = join(cacheDir(dir), "threads");
  mkdirSync(threads, { recursive: true });
  // ESLint's main process had this PID in a run stopped before this one: its share names another
  // start, or none (0.5.0), and it owes an "incomplete" problem this run mustn't report. Its thread
  // numbers are ones this process won't reach, so the live share below can't write over either.
  for (const [name, start] of [[`${process.pid}-901.json`, { started: 0 }], [`${process.pid}-902.json`, {}]]) {
    const file = join(dir, "stale.png");
    const state = { ...start, flagged: [[file, { original: 20000, compressed: 1000, score: 90, file, files: [join(dir, "src/a.js")] }]], named: [], roots: [], kinds: [], targets: [], owed: { left: "3 images" }, settled: false };
    writeFileSync(join(threads, name), JSON.stringify(state));
  }
  // a lint thread of this process flags live.png and leaves its share
  const summary = new URL("../src/summary.js", import.meta.url).href;
  const options = { minSavedBytes: 4096, minSavedPercent: 10, dir: cacheDir(dir), scan: "referenced", exclude: [], publicDirs: [] };
  const thread = new Worker(`import(${JSON.stringify(summary)}).then((summary) => {
    summary.watch(${JSON.stringify(dir)}, ${JSON.stringify(options)}, ${JSON.stringify(join(dir, "src/a.js"))});
    summary.flag(${JSON.stringify(join(dir, "live.png"))}, ${JSON.stringify(join(dir, "src/a.js"))}, { original: 20000, compressed: 1000, score: 90 });
    summary.share(${JSON.stringify(dir)});
  });`, { eval: true });
  await new Promise((done, fail) => thread.on("error", fail).on("exit", done));
  const stderr = await summaryIn(t, dir, []);
  assert.deepEqual(readFlagged(dir), [{ file: join(realpathSync(dir), "live.png") }]);
  assert.doesNotMatch(stderr, /incomplete/);
  // each share is gone: this run's taken in, the dead run's dropped unread
  assert.deepEqual(readdirSync(threads), []);
});

test("the summary offers a look first: one page for several flagged images, a new file for one", async (t) => {
  const dir = project({ images: [] });
  const commands = async (flagged) => (await summaryIn(t, dir, [], [], { flagged })).split("\n").filter((line) => /^slimdeer: to (see|preview|shrink)/.test(line));
  // several, at their own targets: the page of the list the shrink takes, as short as its command
  assert.deepEqual(await commands([["public/a.png", saving(50000, 79.5)], ["public/b.png", saving(60000, 85)], ["public/c.jpg", saving(10000, 72, 70)]]), [
    "slimdeer: to see the 3 flagged images before and after on one page first, run: npx oxlint-plugin-slimdeer --review --flagged",
    "slimdeer: to shrink the 3 flagged images in place (lossy, so commit first), run: npx oxlint-plugin-slimdeer --flagged",
  ]);
  assert.deepEqual(await commands([["public/a.png", saving(50000, 90)], ["public/b.png", saving(60000, 85)]]), [
    "slimdeer: to see the 2 flagged images before and after on one page first, run: npx oxlint-plugin-slimdeer --review --flagged",
    "slimdeer: to shrink the 2 flagged images in place (lossy, so commit first), run: npx oxlint-plugin-slimdeer --flagged",
  ]);
  // one image: "it", as a new file, at its target, as --check says
  assert.deepEqual(await commands([["public/photo.jpg", saving(50000, 76, 70)]]), [
    "slimdeer: to preview it as a new file, run: npx oxlint-plugin-slimdeer public/photo.jpg --target 70 -o photo.preview.jpg",
    "slimdeer: to shrink the flagged image in place (lossy, so commit first), run: npx oxlint-plugin-slimdeer --flagged",
  ]);
});

test("table columns line up after wide (CJK) and decomposed (NFD) file names", async (t) => {
  const dir = project({ images: [] });
  const names = ["public/首页横幅.png", "public/hero.png", "public/cafe\u0301.png", "public/\u1107\u1162\u1102\u1165.png"];
  const stderr = await summaryIn(t, dir, [], [], { flagged: names.map((name) => [name, saving(9000, 90)]) });
  // the terminal column the arrow is drawn at: a CJK or Hangul character takes two, and an accent (or
  // the vowel of a Hangul syllable) composed with its letter none
  const column = (line) => [...line.slice(0, line.indexOf("→")).normalize("NFC")].reduce((n, char) => n + (/[\u4e00-\u9fff\uac00-\ud7a3]/.test(char) ? 2 : 1), 0);
  const rows = stderr.split("\n").filter((line) => line.startsWith("  ") && line.includes("→"));
  assert.equal(rows.length, 4, stderr);
  assert.equal(new Set(rows.map(column)).size, 1, stderr);
});

test("a file name's control characters can't restyle the terminal or break a row", async (t) => {
  const dir = project({ images: [] });
  const names = ["public/\x1b[31mred\x1b[0m.png", "public/\x1b]52;c;aGk=\x07clip.png", "public/new\nline.png", "public/plain.png"];
  const stderr = await summaryIn(t, dir, [], [], { flagged: names.map((name) => [name, saving(9000, 90)]) });
  assert.doesNotMatch(stderr.replaceAll("\n", ""), /\p{Cc}/u);
  const rows = stderr.split("\n").filter((line) => line.startsWith("  ") && line.includes("→"));
  assert.equal(rows.length, 4, stderr);
  assert.equal(new Set(rows.map((line) => line.indexOf("→"))).size, 1, stderr);
});

test("in GitHub Actions, the job summary gets the summary in Markdown, after what's there", async (t) => {
  const dir = project({ images: [], files: { "public/bg.png": "a".repeat(10000), "src/site.css": ".hero { background: url(/bg.png); }\n" } });
  const file = join(dir, "summary.md");
  writeFileSync(file, "an earlier step's summary\n");
  inActions(t, file);
  const stderr = await summaryIn(t, dir, ["public/bg.png"], [], { flagged: [["public/hero.png", { original: 509372, compressed: 150714, score: 87 }], ["public/photo.jpg", { original: 235315, compressed: 85000, score: 76 }]] });
  assert.match(stderr, /^slimdeer: also 1 image with no warning could be 9\.0 kB smaller \(named only where this run can't warn, or nowhere\):$/m);
  assert.equal(readFileSync(file, "utf8"), `an earlier step's summary

### slimdeer

2 flagged images could be 509 kB smaller in all (745 kB → 236 kB, 68% smaller):

| Image | Now | After | Saves | Quality |
| --- | ---: | ---: | ---: | ---: |
| \`public/hero.png\` | 509 kB | 151 kB | 359 kB | 87 |
| \`public/photo.jpg\` | 235 kB | 85 kB | 150 kB | 76 |

Also 1 image with no warning could be 9.0 kB smaller (named only where this run can't warn, or nowhere):

| Image | Now | After | Saves | Quality | Where |
| --- | ---: | ---: | ---: | ---: | --- |
| \`public/bg.png\` | 10 kB | 1.0 kB | 9.0 kB | 90 | used in \`src/site.css\` |

Quality is SSIMULACRA2, out of 100: 90+ looks identical, 80+ the same side by side, 70+ close, with differences you might spot side by side, below 70 visibly different.

To see the 2 flagged images before and after on one page first, lint in the folder CI linted, then run:

\`\`\`
npx oxlint-plugin-slimdeer --review --flagged
\`\`\`

To shrink the 2 flagged images in place (lossy, so commit first), lint in the folder CI linted, then run:

\`\`\`
npx oxlint-plugin-slimdeer --flagged
\`\`\`
`);
});

test("the job summary lists every row up to 200, keeps odd names in their cells, and names the package folder", async (t) => {
  const dir = project({ images: [], files: { "packages/web/package.json": "{}" } });
  const web = join(dir, "packages/web");
  const file = join(dir, "summary.md");
  // the checkout as the runner names it, through a link (as macOS's /var is)
  const checkout = join(project({ images: [] }), "checkout");
  symlinkSync(dir, checkout, "junction");
  inActions(t, file, checkout);
  const many = Array.from({ length: 201 }, (_, i) => [`public/${String(i).padStart(3, "0")}.png`, saving(5000 + i, 90)]);
  const odd = [["public/a|b.png", saving(90000, 90)], ["public/`tick`.png", saving(80000, 90)], [" lead.png", saving(70000, 90)]];
  await summaryIn(t, web, [], [], { flagged: [...odd, ...many] });
  const markdown = readFileSync(file, "utf8");
  assert.match(markdown, /^### slimdeer in `packages\/web`$/m);
  // the commands run there, as the heading alone is a long table away from them, and both read the
  // list a lint leaves
  assert.match(markdown, /^To see the 204 flagged images before and after on one page first, lint in `packages\/web`, then run:$/m);
  assert.match(markdown, /^To shrink the 204 flagged images in place \(lossy, so commit first\), lint in `packages\/web`, then run:$/m);
  // a | would end the cell, and a backtick the code, so the fence is longer; Markdown trims one space off each end
  assert.match(markdown, /^\| `public\/a\\\|b\.png` \| /m);
  assert.match(markdown, /^\| ``public\/`tick`\.png`` \| /m);
  assert.match(markdown, /^\| `  lead\.png ` \| /m);
  assert.equal(markdown.split("\n").filter((line) => line.startsWith("| `")).length, 200);
  assert.match(markdown, /^…and 4 more images, 20 kB in all\.$/m);
});

test("the job summary's preview command runs on the reader's machine, whatever the runner's", async (t) => {
  const dir = project({ images: [] });
  const file = join(dir, "summary.md");
  inActions(t, file);
  // on Windows, a name with a space is run through this machine's node and slimdeer.js in PowerShell,
  // which the reader's machine doesn't have
  const platform = Object.getOwnPropertyDescriptor(process, "platform");
  Object.defineProperty(process, "platform", { ...platform, value: "win32" });
  t.after(() => Object.defineProperty(process, "platform", platform));
  const stderr = await summaryIn(t, dir, [], [], { flagged: [["assets/my logo.png", saving(60000, 76)]] });
  assert.match(stderr, /^slimdeer: to preview it as a new file, run in PowerShell: & /m);
  // with one image, the command needs no lint first: just the folder
  assert.match(readFileSync(file, "utf8"), /^To preview it as a new file, run:\n\n```\nnpx oxlint-plugin-slimdeer 'assets\/my logo\.png' -o 'my logo\.preview\.png'\n```$/m);
  // several: the page, which names no path, the same everywhere
  const several = await summaryIn(t, dir, [], [], { flagged: [["assets/my logo.png", saving(60000, 76)], ["assets/icon.png", saving(20000, 90)]] });
  assert.match(several, /^slimdeer: to see the 2 flagged images before and after on one page first, run: npx oxlint-plugin-slimdeer --review --flagged$/m);
});

test("the job summary is left alone with --quiet, with nothing to say, past GitHub's limit, or when it can't be written", async (t) => {
  const dir = project({ images: [] });
  const file = join(dir, "summary.md");
  inActions(t, file);
  const flagged = [["public/hero.png", saving(50000, 90)]];
  process.argv.push("--quiet");
  try {
    await summaryIn(t, dir, [], [], { flagged });
  } finally {
    process.argv.pop();
  }
  await summaryIn(t, dir, []);
  assert.equal(existsSync(file), false);
  // GitHub drops a step's whole summary past 1 MiB
  const full = "x".repeat(1024 * 1024 - 100);
  writeFileSync(file, full);
  await summaryIn(t, dir, [], [], { flagged });
  assert.equal(readFileSync(file, "utf8"), full);
  // a folder where the file should be: the table on stderr still tells, and the lint doesn't fail
  inActions(t, dir);
  assert.match(await summaryIn(t, dir, [], [], { flagged }), /^slimdeer: 1 flagged image could be 50 kB smaller in all/m);
});

test("the job summary says when the lint is incomplete, and names no folder outside the checkout", async (t) => {
  const dir = project({ images: [] });
  const file = join(dir, "summary.md");
  // the checkout is another folder, as when a step lints outside it
  inActions(t, file, project({ images: [] }));
  await summaryIn(t, dir, [], [], { flagged: [["public/hero.png", saving(50000, 90)]], settled: true });
  const markdown = readFileSync(file, "utf8");
  assert.match(markdown, /^### slimdeer$/m);
  assert.match(markdown, /^This lint is incomplete: slimdeer stopped measuring before it had measured every image, so these totals leave some out\. Run it again to carry on, and keep the cache between CI runs \(`settings\.slimdeer\.cacheDir`\)\.$/m);
  // right below the heading, before the table it qualifies
  assert.ok(markdown.indexOf("This lint is incomplete") < markdown.indexOf("| Image |"), markdown);
});

test("oxlint in GitHub Actions writes the job summary", (t) => {
  const dir = project({ images: ["src/assets/crystal-ball.png"], files: { "src/app.js": 'import ball from "./assets/crystal-ball.png";\n' }, options: { measure: "never", scan: "referenced" } });
  const bytes = readFileSync(join(dir, "src/assets/crystal-ball.png"));
  write(cacheDir(dir), key(bytes), { original: bytes.length, compressed: 11000, outcome: "hit", score: 87 });
  const file = join(dir, "summary.md");
  inActions(t, file);
  oxlintSummary(dir);
  assert.match(readFileSync(file, "utf8"), /^\| `src\/assets\/crystal-ball\.png` \| 35 kB \| 11 kB \| 24 kB \| 87 \|$/m);
});
