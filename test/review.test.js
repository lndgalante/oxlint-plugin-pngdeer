// --review: the previews, the page that compares them with the originals, and the page's own logic.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, copyFileSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, win32 } from "node:path";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import vm from "node:vm";
import { cacheDir, key, read, write } from "../src/cache.js";
import { opener } from "../src/review.js";
import { page } from "../src/review-page.js";
import { flaggedList } from "../src/summary.js";
import { checkCommand, quote, shrinkCommand } from "../src/text.js";
import { oxlintSummary, plugin, slimdeer, project } from "./helpers.js";

// a name with what a shell, HTML and a URL each read specially; Windows refuses " < > ? in names
const ODD = process.platform === "win32" ? "public/odd dir/it's a & c #1 50% [x].png" : `public/odd dir/it's "a" <b> & c #1 50%?.png`;
const BALL = "src/assets/crystal-ball.png";
const PHOTO = "public/photo.jpg";
const IMAGES = [BALL, PHOTO, ODD];

// One project for the tests that measure: the odd name is a copy of the crystal ball, so it shares
// its measurement, its preview and its card (as its first path: "public/" sorts before "src/").
const dir = project({ images: [BALL, PHOTO] });
mkdirSync(join(dir, "public/odd dir"));
copyFileSync(join(dir, BALL), join(dir, ODD));
const folder = join(cacheDir(dir), "review");

const sha = (file) => createHash("sha256").update(readFileSync(file)).digest("hex");
const unescape = (text) => text.replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)));

/** The parts of a page: its data, its script, and per card its paths, both images' URLs and its zoom. */
function parse(html) {
  const data = JSON.parse(/<script type="application\/json" id="data">([\s\S]*?)<\/script>/.exec(html)[1]);
  const script = /<script>([\s\S]*?)<\/script>/.exec(html)[1];
  const cards = [...html.matchAll(/<article class="image[^"]*" id="image-\d+"[\s\S]*?<\/article>/g)].map(([block]) => ({
    path: unescape(/<h2 class="path" id="path-\d+">(.*?)<\/h2>/.exec(block)[1]),
    also: [...(/<p class="also">(.*?)<\/p>/.exec(block)?.[1] ?? "").matchAll(/<code>(.*?)<\/code>/g)].map(([, path]) => unescape(path)),
    before: unescape(/<img class="before" src="(.*?)"/.exec(block)[1]),
    after: unescape(/<img class="after" src="(.*?)"/.exec(block)[1]),
    zoom: /name="zoom-\d+" value="(\d+)" checked/.exec(block)[1],
    zooms: [...block.matchAll(/name="zoom-\d+" value="\d+"(?: checked)?><span>(.*?)<\/span>/g)].map(([, label]) => label),
    figure: /<figure class="(.*?)">/.exec(block)[1],
  }));
  return { data, script, cards };
}

/** The page's script run without a browser: its pure functions. */
function run(script) {
  const context = vm.createContext({});
  vm.runInContext(script, context);
  return context;
}

/**
 * The page's start() on a stand-in for a browser that shows no card, with the Show radio `checked`
 * already, as Firefox restores it on a reload before the script runs: the classes start() gives <main>.
 * `elements` are the ones a test watches, by id.
 */
function started(html, checked, elements = {}) {
  const noop = () => {};
  const element = (more) => ({ classList: { toggle: noop }, style: { setProperty: noop }, dataset: {}, addEventListener: noop, ...more });
  const classes = new Set();
  const main = element({ classList: { toggle: (name, on) => (on ? classes.add(name) : classes.delete(name)) } });
  const data = element({ textContent: /<script type="application\/json" id="data">([\s\S]*?)<\/script>/.exec(html)[1] });
  const radios = ["all", "low"].map((value) => element({ value, checked: value === checked }));
  const document = {
    getElementById: (id) => ({ data, main, ...elements })[id] ?? element(),
    querySelector: (selector) => (selector === "input[name=show]:checked" ? radios.find((radio) => radio.checked) : selector === ".bar" ? element() : null),
    querySelectorAll: (selector) => (selector === "input[name=show]" ? radios : []),
    documentElement: element(),
    body: element(),
  };
  const browser = { document, matchMedia: () => element({ matches: false }), ResizeObserver: class { observe() {} }, localStorage: { getItem: () => null } };
  vm.runInContext(parse(html).script, vm.createContext(browser));
  return [...classes];
}

/** A value made in the page's script, as a plain one of this realm, to compare. */
const plain = (value) => JSON.parse(JSON.stringify(value));

/** The page's text with its no-break spaces (between a size's number and unit) as plain ones. */
const spaced = (text) => text.replaceAll("\u00A0", " ");

/** A URL from the page, as the file it names. */
const resolveFrom = (url) => realpathSync(fileURLToPath(new URL(url, pathToFileURL(`${folder}/`))));

/** A card for page(), as review.js makes them: `paths` are copies of one image. */
function card(paths, { saved = 5000, score = 90, width = 10, height = 10, alpha = false, outcome = "hit" } = {}) {
  paths = [paths].flat();
  const [original, compressed] = [100000, 100000 - saved];
  return { paths, before: paths[0], after: "x.png", width, height, alpha, original, compressed, outcome, score, total: { original: original * paths.length, compressed: compressed * paths.length } };
}

const model = (cards, more = {}) => ({ cwd: "/project", date: "2026-11-11 12:00", target: undefined, cards, ...more });

test("review writes each preview and a page into the project's cache, and changes no image", (t) => {
  const before = IMAGES.map((image) => sha(join(dir, image)));
  const review = slimdeer(dir, "--review");
  assert.equal(review.status, 0, review.stderr);
  const index = join(realpathSync(dir), "node_modules/.cache/slimdeer/review/index.html");
  assert.deepEqual(review.stdout.split("\n"), [
    "slimdeer: 3 images could be 199 kB smaller (306 kB → 107 kB, 65% smaller). Images unchanged.",
    `slimdeer: the page that compares each one before and after: ${pathToFileURL(index).href}`,
    "slimdeer: open it in a browser, untick any image to keep as it is, and run the command it gives.",
    "",
  ]);
  // measured, then the two previews (the copies share one)
  assert.match(review.stderr, /^slimdeer: measuring 2 images not in the cache yet\.\.\.$/m);
  assert.match(review.stderr, /^slimdeer: writing 2 previews\.\.\.$/m);
  assert.deepEqual(IMAGES.map((image) => sha(join(dir, image))), before);
  // the page, two previews, and what keeps them out of a repository
  assert.equal(readdirSync(folder).length, 4);
  assert.match(readFileSync(join(folder, ".gitignore"), "utf8"), /^\*$/m);

  const html = readFileSync(index, "utf8");
  const { data, script, cards } = parse(html);
  // biggest saving first: the photo, then the crystal ball under its first path, with its copy
  assert.deepEqual(cards.map(({ path, also }) => [path, also]), [[PHOTO, []], [ODD, [BALL]]]);
  assert.match(html, /> Shrink all 2<\/label>/);
  for (const { path, before, after } of cards) {
    // relative URLs, which reach the original and the preview from the page's folder
    assert.doesNotMatch(before, /^[a-z]+:/);
    assert.equal(resolveFrom(before), realpathSync(join(dir, path)));
    assert.equal(resolveFrom(after), realpathSync(join(folder, after)));
  }
  // each preview is what the command writes with -o, byte for byte
  const out = mkdtempSync(join(tmpdir(), "slimdeer-preview-"));
  t.after(() => rmSync(out, { recursive: true, force: true }));
  for (const [i, [image, shown]] of [[BALL, ODD], [PHOTO, PHOTO]].entries()) {
    const preview = join(out, `${i}${image.slice(-4)}`);
    assert.equal(slimdeer(dir, image, "-o", preview).status, 0);
    assert.deepEqual(readFileSync(join(folder, cards.find(({ path }) => path === shown).after)), readFileSync(preview));
  }

  // the odd name: escaped in the HTML, percent-encoded in its URL, quoted in the command
  if (process.platform !== "win32") {
    // nowhere as it is, so it adds no markup and ends no script
    assert.ok(!html.includes(basename(ODD)), "the name appears unescaped");
    assert.ok(html.includes("it&#39;s &#34;a&#34; &#60;b&#62; &#38; c #1 50%?.png"));
    assert.ok(/<script type="application\/json" id="data">[^<]*<\/script>/.test(html));
  }
  const odd = cards.find(({ path }) => path === ODD);
  assert.ok(odd.before.endsWith(ODD.split("/").map(encodeURIComponent).join("/")), odd.before);
  assert.match(odd.before, /^(?:[^%\s#?"<>]|%[0-9A-F]{2})+$/);
  // every copy in the command, its card ticking them together
  assert.deepEqual(plain(data.images.map(({ args, count }) => [args, count])), [[[quote(PHOTO)], 1], [[quote(ODD), quote(BALL)], 2]]);
  const { commands, tally } = run(script);
  assert.equal(commands(data, [true, true]).lines[0], shrinkCommand([PHOTO, ODD, BALL]).text);
  assert.equal(commands(data, [false, true]).lines[0], shrinkCommand([ODD, BALL]).text);
  assert.equal(spaced(tally(data, [true, false])), "1 of 3 images ticked: could save 150 kB (235 kB → 85 kB, 64% smaller)");
  // nothing but the page's own folder and file URLs: no network
  assert.doesNotMatch(html, /(?:src|href)="(?:https?:)?\/\//);
});

test("a second review reuses the previews still wanted, writes the ones that went wrong, and removes the rest", () => {
  const { cards } = parse(readFileSync(join(folder, "index.html"), "utf8"));
  const ball = join(folder, cards.find(({ path }) => path === ODD).after);
  const photo = join(folder, cards.find(({ path }) => path === PHOTO).after);
  const good = { ball: readFileSync(ball), photo: readFileSync(photo) };
  // one cut short, one of the right size that isn't slimdeer's
  writeFileSync(photo, good.photo.subarray(0, 100));
  writeFileSync(ball, Buffer.alloc(good.ball.length));
  writeFileSync(join(folder, "stale.png"), "old");
  writeFileSync(join(folder, ".x.png.123.tmp"), "left by a killed run");

  const again = slimdeer(dir, "--review");
  assert.equal(again.status, 0, again.stderr);
  assert.match(again.stderr, /^slimdeer: writing 2 previews\.\.\.$/m);
  assert.doesNotMatch(again.stderr, /measuring/);
  assert.deepEqual(readFileSync(photo), good.photo);
  assert.deepEqual(readFileSync(ball), good.ball);
  assert.deepEqual(readdirSync(folder).sort(), [".gitignore", basename(ball), basename(photo), "index.html"].sort());

  // left out now: its preview goes, the other is kept as it is, and nothing is compressed
  const kept = statSync(ball).mtimeMs;
  const fewer = slimdeer(dir, "--review", "--exclude", PHOTO);
  assert.equal(fewer.status, 0, fewer.stderr);
  assert.equal(fewer.stderr, "");
  assert.match(fewer.stdout, /^slimdeer: 2 images could be /);
  assert.match(fewer.stdout, /^slimdeer: the page that compares it before and after: /m);
  assert.match(fewer.stdout, /^slimdeer: open it in a browser, and if the after looks right, run the command it gives\.$/m);
  assert.equal(existsSync(photo), false);
  assert.equal(statSync(ball).mtimeMs, kept);
  assert.equal(parse(readFileSync(join(folder, "index.html"), "utf8")).cards.length, 1);
});

test("a long list's page gives several commands, and the terminal says so", () => {
  // one picture under 121 long names: one card, measured once, whose command the page splits
  const long = project({ images: [BALL] });
  for (let i = 0; i < 120; i++) {
    const copy = join(long, `public/a-rather-long-folder-for-the-assets/copy-${i}`);
    mkdirSync(copy, { recursive: true });
    copyFileSync(join(long, BALL), join(copy, "crystal-ball-with-a-long-name.png"));
  }
  const review = slimdeer(long, "--review");
  assert.equal(review.status, 0, review.stderr);
  assert.match(readFileSync(join(cacheDir(long), "review/index.html"), "utf8"), /<span id="say">[^<]*, run these \d+ commands/);
  assert.match(review.stdout, /^slimdeer: open it in a browser, and if the after looks right, run the commands it gives\.$/m);
});

test("an image that can't be checked makes the review exit 2, and the page still shows the others and lists it", () => {
  writeFileSync(join(dir, "public/fixture.png"), "not an image");
  try {
    const review = slimdeer(dir, "--review", "--exclude", PHOTO);
    assert.equal(review.status, 2);
    assert.equal(review.stderr, "public/fixture.png: not a PNG or JPEG\n");
    // the terminal names what the page leaves out, as --check would, right after the totals, with
    // the review that leaves it out
    const lines = review.stdout.split("\n");
    assert.match(lines[0], /^slimdeer: 2 images could be /);
    assert.equal(lines[1], "slimdeer: 1 file named like an image isn't a PNG or JPEG; if that's expected (a test fixture, say), to leave it out, run: npx oxlint-plugin-slimdeer --review --exclude public/photo.jpg --exclude public/fixture.png");
    assert.match(lines[2], /^slimdeer: the page that compares it before and after: file:/);
    const html = readFileSync(join(folder, "index.html"), "utf8");
    assert.equal(parse(html).cards.length, 1);
    assert.ok(html.includes("<details class=\"unlisted\"><summary>1 image or folder couldn&#39;t be checked or previewed.</summary>\n<ul><li><code>public/fixture.png</code>: not a PNG or JPEG</li></ul>"));
  } finally {
    rmSync(join(dir, "public/fixture.png"));
  }
});

test("an error that running it again may clear names the run to repeat", () => {
  const stale = project({ images: [PHOTO] });
  const bytes = readFileSync(join(stale, PHOTO));
  // an entry no measurement writes
  write(cacheDir(stale), key(bytes), { original: bytes.length, compressed: -1, outcome: "hit", score: 80 });
  const said = (run) => `public/photo.jpg: invalid measurement in node_modules/.cache/slimdeer; remove that cache entry and run ${run} again\n`;
  assert.equal(slimdeer(stale, "--check").stderr, said("--check"));
  assert.equal(slimdeer(stale, "--review").stderr, said("--review"));
  // the lint's list again, not the whole folder
  mkdirSync(cacheDir(stale), { recursive: true });
  writeFileSync(flaggedList(stale), JSON.stringify({ cwd: realpathSync.native(stale), images: [{ file: PHOTO }] }));
  assert.equal(slimdeer(stale, "--review", "--flagged").stderr, said("--review --flagged"));
});

// what a review adds to --check's words when it shows nothing, as a tab may still show an old page
const NO_PAGE = "slimdeer: no image to compare, so no page was written.\n";

test("with nothing to review, review says what --check says and that it wrote no page, leaves no page and no job summary, and exits 0", () => {
  const small = project({ images: ["src/assets/heart.png"] });
  const old = join(cacheDir(small), "review");
  mkdirSync(old, { recursive: true });
  writeFileSync(join(old, "index.html"), "a page from an earlier run");
  const review = slimdeer(small, "--review");
  assert.equal(review.status, 0, review.stderr);
  assert.equal(review.stdout, `${slimdeer(small, "--check").stdout}${NO_PAGE}`);
  assert.match(review.stdout, /^slimdeer: no images exceed the savings thresholds\. Images unchanged\.$/m);
  assert.equal(existsSync(old), false);

  // in GitHub Actions --check would write a job summary for the file that isn't an image; a review doesn't
  writeFileSync(join(small, "bad.png"), "not an image");
  const summary = join(small, "summary.md");
  const env = { ...process.env, GITHUB_STEP_SUMMARY: summary };
  const command = (...args) => spawnSync(process.execPath, [join(plugin, "bin/slimdeer.js"), ...args], { cwd: small, env, encoding: "utf8" });
  const failed = command("--review");
  assert.equal(failed.status, 2);
  assert.ok(failed.stdout.endsWith(`slimdeer: check incomplete. Images unchanged.\n${NO_PAGE}`), failed.stdout);
  assert.equal(existsSync(summary), false);
  assert.equal(command("--check").status, 2);
  assert.match(readFileSync(summary, "utf8"), /### slimdeer --check/);
});

// chmod keeps neither Windows nor root out
test("with nothing measured, as a cache folder can't be written, review says why once", { skip: process.platform === "win32" || process.getuid?.() === 0 }, (t) => {
  const locked = project({ images: [BALL] });
  const modules = join(locked, "node_modules");
  mkdirSync(modules);
  chmodSync(modules, 0o555);
  t.after(() => chmodSync(modules, 0o755));
  const review = slimdeer(locked, "--review");
  assert.equal(review.status, 2);
  assert.equal(review.stderr.match(/^slimdeer: measuring failed: .*$/gm).length, 1, review.stderr);
  assert.equal(review.stderr.match(/^src\/assets\/crystal-ball\.png: not measured \(see above\)$/gm).length, 1, review.stderr);
  assert.match(review.stdout, /^slimdeer: check incomplete\. Images unchanged\.$/m);
});

test("a preview of another size than measured is reported and left off the page, which shows the others", () => {
  const odd = project({ images: [] });
  const bytes = Buffer.concat([readFileSync(join(plugin, "example/src/assets/crystal-ball.png")), Buffer.alloc(7)]);
  writeFileSync(join(odd, "ball.png"), bytes);
  // a measurement that no preview of these bytes matches
  write(cacheDir(odd), key(bytes), { original: bytes.length, compressed: 20000, outcome: "hit", score: 90 });
  const report = /^ball\.png: its preview is \d+ bytes, but measuring said 20000; please report this at https:\/\/github\.com\/lndgalante\/oxlint-plugin-slimdeer\/issues$/m;
  const alone = slimdeer(odd, "--review");
  assert.equal(alone.status, 2);
  assert.match(alone.stderr, report);
  assert.equal(alone.stdout, "slimdeer: review incomplete: no preview could be written. Images unchanged.\n");
  assert.deepEqual(readdirSync(join(cacheDir(odd), "review")), [".gitignore"]);
  // on a terminal, the report starts a line of its own, not the end of the count's
  const tty = spawnSync(process.execPath, ["--import", "data:text/javascript,process.stderr.isTTY=true", join(plugin, "bin/slimdeer.js"), "--review"], { cwd: odd, encoding: "utf8" });
  assert.equal(tty.status, 2, tty.stderr);
  assert.ok(tty.stderr.includes("\r\x1b[Kball.png: its preview is"), JSON.stringify(tty.stderr));

  // with the photo, measured already in the shared project: a page for it alone, and still exit 2
  const photo = readFileSync(join(dir, PHOTO));
  writeFileSync(join(odd, "photo.jpg"), photo);
  write(cacheDir(odd), key(photo), read(cacheDir(dir), key(photo)));
  const review = slimdeer(odd, "--review");
  assert.equal(review.status, 2);
  assert.match(review.stderr, report);
  assert.match(review.stdout, /^slimdeer: 1 image could be 150 kB smaller /);
  const { cards } = parse(readFileSync(join(cacheDir(odd), "review/index.html"), "utf8"));
  assert.deepEqual(cards.map(({ path }) => path), ["photo.jpg"]);
});

test("the page's script builds the ticked images' commands as the terminal does: quoted, with the target, split near 6000 characters", () => {
  const paths = ["public/a.png", "public/50% off.png", "src/b.png"];
  const cards = paths.map((path, i) => card(path, { saved: 30000 - i * 1000, score: 75 + i * 5 }));
  for (const platform of ["linux", "win32"]) {
    const { data, script } = parse(page(model(cards, { target: 80 }), platform));
    const { commands, tally } = run(script);
    assert.deepEqual(plain(commands(data, [true, true, true])), { lines: [shrinkCommand(paths, 80, platform).text], shell: shrinkCommand(paths, 80, platform).shell });
    assert.deepEqual(plain(commands(data, [true, false, true]).lines), [shrinkCommand([paths[0], paths[2]], 80, platform).text]);
    assert.deepEqual(plain(commands(data, [false, false, false])), { lines: [], shell: "" });
    assert.equal(spaced(tally(data, [true, false, true])), "2 of 3 images ticked: could save 58 kB (200 kB → 142 kB, 29% smaller)");
    assert.equal(tally(data, [false, false, false]), "None of the 3 images ticked.");
  }
  // on Windows, a path with % goes through PowerShell, and so does the whole command
  assert.equal(parse(page(model(cards), "win32")).data.images[1].powershell, true);
  // quality below 80, in whole numbers as shown: the first only
  assert.deepEqual(parse(page(model(cards))).data.images.map(({ low }) => low), [true, false, false]);
  // one picture, with its copy: both shrink, and count, together
  const copies = parse(page(model([card(["a.png", "b/a.png"], { saved: 30000 })])));
  const { commands, tally } = run(copies.script);
  assert.equal(commands(copies.data, [true]).lines[0], shrinkCommand(["a.png", "b/a.png"]).text);
  assert.equal(spaced(tally(copies.data, [true])), "Ticked: could save 60 kB (200 kB → 140 kB, 30% smaller)");
  assert.equal(tally(copies.data, [false]), "Not ticked.");

  // 300 long paths: several commands, each under the limit, together naming every image in order
  const many = Array.from({ length: 300 }, (_, i) => `public/blog-assets/some-long-post-name-${i}/header-image.png`);
  const big = parse(page(model(many.map((path) => card(path)), { target: 80 })));
  const { lines } = plain(run(big.script).commands(big.data, many.map(() => true)));
  assert.ok(lines.length > 1);
  for (const line of lines) {
    assert.ok(line.length <= 6000, String(line.length));
    assert.match(line, /^npx oxlint-plugin-slimdeer .* --target 80$/);
  }
  assert.deepEqual(lines.flatMap((line) => line.replace(/^npx oxlint-plugin-slimdeer /, "").replace(/ --target 80$/, "").split(" ")), many);
});

test("when the page can't copy the command, the reader sees what to press, not only a screen reader", async () => {
  const html = page(model([card("a.png")]));
  assert.ok(html.includes(`<p id="status" class="hidden" aria-live="polite"></p>`));
  const context = run(parse(html).script);
  // what copy() touches, the status hidden as the page starts it
  const classes = new Set(["hidden"]);
  const status = { textContent: "", classList: { toggle: (name, on) => void (on ? classes.add(name) : classes.delete(name)) } };
  const button = { textContent: "Copy" };
  const shown = {};
  let selected = null;
  Object.assign(context, {
    document: { getElementById: (id) => ({ copy: button, status })[id], createElement: () => ({ select() {}, remove() {} }), body: { append() {} }, execCommand: () => false },
    getSelection: () => ({ selectAllChildren: (node) => void (selected = node) }),
    navigator: { clipboard: { writeText: () => Promise.reject(new Error("denied")) } },
    setTimeout: () => {},
  });
  context.copy(["npx oxlint-plugin-slimdeer a.png"], shown);
  await new Promise(setImmediate);
  assert.equal(selected, shown);
  assert.equal(button.textContent, "Copy");
  assert.match(status.textContent, /^Couldn't copy\. The command is selected: press Ctrl\+C/);
  assert.equal(classes.has("hidden"), false);
  // copied: the button says so, and the line is for screen readers again
  context.navigator.clipboard.writeText = () => Promise.resolve();
  context.copy(["npx oxlint-plugin-slimdeer a.png"], shown);
  await new Promise(setImmediate);
  assert.equal(button.textContent, "Copied");
  assert.equal(status.textContent, "Copied the command.");
  assert.equal(classes.has("hidden"), true);
});

test("the page keeps each size's number and unit on one line, and with one image the tally, and the line under it, speak of its tick", () => {
  const html = page(model([card("a.png", { saved: 30000 })]));
  const { data, script } = parse(html);
  const { instruction, tally, unbroken } = run(script);
  // a no-break space between them, so a phone never starts a line with "kB"; a count still wraps
  assert.equal(unbroken("from 999 B to 1.0 MB, 3 images, 12 GB"), "from 999\u00A0B to 1.0\u00A0MB, 3 images, 12\u00A0GB");
  assert.ok(html.includes("<h1>1 image could be 30\u00A0kB smaller</h1>"));
  assert.ok(html.includes(`<p class="sum">100\u00A0kB → 70\u00A0kB, 30% smaller</p>`));
  assert.ok(html.includes("<p>30% smaller, 100\u00A0kB → 70\u00A0kB <span"));
  // one card: no "1 of 1 image ticked"
  assert.equal(tally(data, [true]), "Ticked: could save 30\u00A0kB (100\u00A0kB → 70\u00A0kB, 30% smaller)");
  assert.ok(html.includes(`<p id="tally" aria-live="polite">Ticked: could save 30\u00A0kB (100\u00A0kB → 70\u00A0kB, 30% smaller)</p>`));
  assert.equal(tally(data, [false]), "Not ticked.");
  assert.equal(instruction(0, 0, "", true), "Tick the image to shrink it, and the command that shrinks it appears here.");
  assert.equal(instruction(0, 0, ""), "Tick the images to shrink, and the command that shrinks them appears here.");
});

test("Copy says what it copied: the command, or the commands", () => {
  const context = run(parse(page(model([card("a.png")]))).script);
  // a browser with no clipboard API, whose old way copies or not
  const said = (lines, copied) => {
    const status = { classList: { toggle() {} } };
    let text;
    context.document = {
      getElementById: (id) => (id === "status" ? status : {}),
      createElement: () => ({ select() {}, remove() {} }),
      body: { append: (area) => (text = area.value) },
      execCommand: () => copied,
    };
    Object.assign(context, { navigator: {}, getSelection: () => ({ selectAllChildren() {} }), setTimeout() {} });
    context.copy(lines, {});
    assert.equal(text, lines.join("\n"));
    return status.textContent;
  };
  assert.equal(said(["npx a"], true), "Copied the command.");
  assert.equal(said(["npx a", "npx b"], true), "Copied the commands.");
  assert.equal(said(["npx a"], false), "Couldn't copy. The command is selected: press Ctrl+C (⌘C on a Mac).");
  assert.equal(said(["npx a", "npx b"], false), "Couldn't copy. The commands are selected: press Ctrl+C (⌘C on a Mac).");
});

test("the page's Copy button copies every command the bar gives", async () => {
  const html = page(model([card("a.png"), { ...card("b.png"), target: 80 }]));
  // a stand-in for a browser with a clipboard, which keeps each element by its id, with its handlers
  const noop = () => {};
  const elements = new Map();
  const element = (id) => {
    const on = {};
    if (!elements.has(id)) elements.set(id, { on, classList: { toggle: noop }, style: { setProperty: noop }, dataset: {}, addEventListener: (type, handler) => (on[type] = handler) });
    return elements.get(id);
  };
  element("data").textContent = /<script type="application\/json" id="data">([\s\S]*?)<\/script>/.exec(html)[1];
  let copied;
  const document = { getElementById: element, querySelector: (selector) => (selector === ".bar" ? element("bar") : null), querySelectorAll: () => [], documentElement: element("root"), body: element("body") };
  const clipboard = { writeText: async (text) => (copied = text) };
  vm.runInContext(parse(html).script, vm.createContext({ document, matchMedia: () => element("media"), ResizeObserver: class { observe() {} }, localStorage: { getItem: () => null }, navigator: { clipboard }, setTimeout: noop }));
  element("copy").on.click();
  // once the clipboard has answered
  await new Promise(setImmediate);
  assert.equal(copied, "npx oxlint-plugin-slimdeer a.png\nnpx oxlint-plugin-slimdeer b.png --target 80");
  assert.equal(element("status").textContent, "Copied the commands.");
});

test("when the ticks change, the line Copy wrote goes: it was about the commands before", () => {
  let change;
  const all = { checked: true, addEventListener: (type, listener) => (change = listener) };
  const classes = new Set(["hidden"]);
  const status = { textContent: "", classList: { toggle: (name, on) => void (on ? classes.add(name) : classes.delete(name)) } };
  started(page(model([card("a.png"), card("b.png")])), "all", { all, status });
  // a Copy that failed said so, and selected the command; then every image is unticked
  status.textContent = "Couldn't copy. The command is selected: press Ctrl+C.";
  classes.delete("hidden");
  all.checked = false;
  change();
  assert.equal(status.textContent, "");
  assert.equal(classes.has("hidden"), true);
});

test("a page of images at several targets says so, marks each card, and gives one command per target", () => {
  const at = (target, ...args) => ({ ...card(...args), target });
  const cards = [at(70, "public/a.png", { saved: 30000, score: 75 }), at(undefined, "public/b.png", { saved: 20000 }), at(70, ["c.png", "d/c.png"], { saved: 10000 })];
  const missed = [{ path: "m.png", original: 7000, score: 89.6, target: 90 }, { path: "n.png", original: 6000, score: 66, target: undefined }];
  const html = page(model(cards, { missed }));
  assert.ok(html.includes("<div><dt>Targets</dt><dd>each image at the target the lint flagged it at: quality 70 for 3 images, automatic (never below quality 70) for 1 image</dd></div>"), html);
  assert.equal(html.match(/<span class="dot" aria-hidden="true">·<\/span> <code>--target 70<\/code><\/p>/g).length, 2);
  assert.equal(html.match(/<span class="dot" aria-hidden="true">·<\/span> automatic target<\/p>/g).length, 1);
  const { data, script } = parse(html);
  const { commands, instruction } = run(script);
  // each target's images in one command, the biggest saving's first, so pasting both shrinks each as the page shows it
  assert.deepEqual(plain(commands(data, [true, true, true]).lines), [shrinkCommand(["public/a.png", "c.png", "d/c.png"], 70).text, shrinkCommand(["public/b.png"]).text]);
  assert.deepEqual(plain(commands(data, [false, true, true]).lines), [shrinkCommand(["public/b.png"]).text, shrinkCommand(["c.png", "d/c.png"], 70).text]);
  assert.deepEqual(plain(commands(data, [true, false, false]).lines), [shrinkCommand(["public/a.png"], 70).text]);
  assert.equal(instruction(4, 2, ""), "To shrink them in place (lossy, so commit first), run these 2 commands");
  // what missed, each with its own target
  assert.ok(html.includes("<summary>2 images aren&#39;t here: no smaller file reaches its target.</summary>\n<ul><li><code>m.png</code>: best quality 89/100, short of --target 90</li><li><code>n.png</code>: best quality 66/100, short of the automatic quality</li></ul>"), html);
  // long lists are split per target, each line ending with its own
  const many = Array.from({ length: 400 }, (_, i) => at(i % 2 ? 70 : undefined, `public/blog-assets/some-long-post-name-${i}/header-image.png`));
  const big = parse(page(model(many)));
  const { lines } = plain(run(big.script).commands(big.data, many.map(() => true)));
  assert.ok(lines.length > 2, String(lines.length));
  for (const line of lines) assert.ok(line.length <= 6000, String(line.length));
  const ends = lines.map((line) => line.endsWith(" --target 70"));
  assert.deepEqual(ends, [...ends].sort(), "each target's commands together");
  // one target: the header says it, and no card does
  const one = page(model([at(90, "a.png"), at(90, "b.png")]));
  assert.ok(one.includes("<div><dt>Target</dt><dd>quality 90 (<code>--target 90</code>)</dd></div>"));
  assert.ok(!one.includes("automatic target") && !one.includes("</span> <code>--target"));
});

test("--review --flagged shows the images the last lint flagged, each at its own target, and the page's commands shrink them as shown", () => {
  const files = { "src/a.js": 'import ball from "./assets/crystal-ball.png";\n', "src/b.js": 'export const photo = "/photo.jpg";\n' };
  // unused-fire.png would be on a --review of the folder; no code names it, so the lint flags it not
  const linted = project({ files, images: [BALL, PHOTO, "public/unused-fire.png"], options: { scan: "referenced" } });
  const configFile = join(linted, ".oxlintrc.json");
  const config = JSON.parse(readFileSync(configFile, "utf8"));
  config.overrides = [{ files: ["src/b.js"], rules: { "slimdeer/compressible-image": ["warn", { scan: "referenced", target: 70 }] } }];
  writeFileSync(configFile, JSON.stringify(config));
  const noList = "oxlint-plugin-slimdeer: no list of flagged images here: lint in this folder first (npx oxlint, or eslint without --cache); if a lint here flagged no image, there is nothing to do\n";
  const before = slimdeer(linted, "--review", "--flagged");
  assert.equal(before.status, 2);
  assert.equal(before.stderr, noList);

  assert.match(oxlintSummary(linted), /^slimdeer: to see the 2 flagged images before and after on one page first, run: npx oxlint-plugin-slimdeer --review --flagged$/m);
  const review = slimdeer(linted, "--review", "--flagged");
  assert.equal(review.status, 0, review.stderr);
  assert.match(review.stdout, /^slimdeer: 2 images could be \d+ kB smaller /);
  // a command per target, as the page says
  assert.match(review.stdout, /^slimdeer: open it in a browser, untick any image to keep as it is, and run the commands it gives\.$/m);
  const reviewFolder = join(cacheDir(linted), "review");
  const html = readFileSync(join(reviewFolder, "index.html"), "utf8");
  const { data, script, cards } = parse(html);
  assert.deepEqual(cards.map(({ path }) => path), [PHOTO, BALL]);
  assert.ok(html.includes("<dt>Targets</dt><dd>each image at the target the lint flagged it at: quality 70 for 1 image, automatic (never below quality 70) for 1 image</dd>"));
  const { commands } = run(script);
  const lines = plain(commands(data, [true, true]).lines);
  // the paths ticked, never --flagged, so a later lint can't change what the command does
  assert.deepEqual(lines, [shrinkCommand([PHOTO], 70).text, shrinkCommand([BALL]).text]);

  // a --target given here wins for every image
  const fixed = slimdeer(linted, "--review", "--flagged", "--target", "70");
  assert.equal(fixed.status, 0, fixed.stderr);
  assert.match(fixed.stdout, /^slimdeer: open it in a browser, untick any image to keep as it is, and run the command it gives\.$/m);
  const one = parse(readFileSync(join(reviewFolder, "index.html"), "utf8"));
  assert.deepEqual(plain(run(one.script).commands(one.data, [true, true]).lines), [shrinkCommand([PHOTO, BALL], 70).text]);

  // the page's commands write what it shows, byte for byte
  assert.equal(slimdeer(linted, "--review", "--flagged").status, 0);
  const shown = parse(readFileSync(join(reviewFolder, "index.html"), "utf8"));
  const previews = Object.fromEntries(shown.cards.map(({ path, after }) => [path, readFileSync(join(reviewFolder, after))]));
  for (const line of plain(run(shown.script).commands(shown.data, [true, true]).lines)) {
    const shrink = slimdeer(linted, ...line.replace(/^npx oxlint-plugin-slimdeer /, "").split(" "));
    assert.equal(shrink.status, 0, shrink.stderr);
  }
  for (const path of [PHOTO, BALL]) assert.deepEqual(readFileSync(join(linted, path)), previews[path], path);

  // the list is the last lint's: nothing on it can be made smaller now, and the page goes
  const after = slimdeer(linted, "--review", "--flagged");
  assert.equal(after.status, 0, after.stderr);
  assert.equal(after.stdout, "slimdeer: none of the 2 images the last lint here flagged can be made smaller now, so there is nothing to review; lint again to update the list.\n");
  assert.equal(existsSync(join(reviewFolder, "index.html")), false);
  // a lint that flags nothing leaves an empty list, and an old page still goes
  oxlintSummary(linted);
  assert.deepEqual(JSON.parse(readFileSync(flaggedList(linted), "utf8")).images, []);
  mkdirSync(reviewFolder, { recursive: true });
  writeFileSync(join(reviewFolder, "index.html"), "a page from an earlier run");
  const empty = slimdeer(linted, "--review", "--flagged");
  assert.equal(empty.status, 0, empty.stderr);
  assert.equal(empty.stdout, "slimdeer: the last lint here left no images to review with --flagged.\n");
  assert.equal(empty.stderr, "");
  assert.equal(existsSync(join(reviewFolder, "index.html")), false);
});

test("--review --flagged shows what the lint flagged by the lint's thresholds, from the lint's cache folder, and says when its list is out of date", () => {
  // 12.6 kB to 11.4 kB at quality 95 clears these thresholds, but not --check's defaults
  const fire = "public/unused-fire.png";
  const linted = project({ images: [fire], files: { "src/a.js": 'export const fire = "/unused-fire.png";\n' }, options: { scan: "referenced", target: 95, minSavedBytes: 1000, minSavedPercent: 5 } });
  // measured into a folder the team commits, where the lint writes what it measures
  const configFile = join(linted, ".oxlintrc.json");
  writeFileSync(configFile, JSON.stringify({ ...JSON.parse(readFileSync(configFile, "utf8")), settings: { slimdeer: { cacheDir: ".slimdeer" } } }));
  assert.match(oxlintSummary(linted), /^slimdeer: 1 flagged image could be 1\.2 kB smaller/m);
  const check = slimdeer(linted, "--check", fire, "--target", "95", "--cache-dir", ".slimdeer");
  assert.equal(check.status, 0, check.stderr);
  assert.match(check.stdout, /^slimdeer: no images exceed the savings thresholds\. Images unchanged\.$/m);
  for (const given of [[], ["--cache-dir", ".slimdeer"]]) {
    const review = slimdeer(linted, "--review", "--flagged", ...given);
    assert.equal(review.status, 0, review.stderr);
    // read from where the lint measured it: nothing is measured again
    assert.doesNotMatch(review.stderr, /measuring/);
    assert.deepEqual(parse(readFileSync(join(cacheDir(linted), "review", "index.html"), "utf8")).cards.map(({ path }) => path), [fire]);
  }
  // at a target given here that nothing reaches, the list is up to date: the target is named instead
  const bytes = readFileSync(join(linted, fire));
  write(cacheDir(linted), key(bytes, 99), { original: bytes.length, compressed: bytes.length - 1000, outcome: "miss", score: 97.4 });
  const strict = slimdeer(linted, "--review", "--flagged", "--target", "99");
  assert.equal(strict.status, 0, strict.stderr);
  assert.equal(strict.stdout, `slimdeer: ${fire} isn't listed: no smaller file reaches --target 99 (the best reaches quality 97/100)\nslimdeer: the image the last lint here flagged can't be made smaller at --target 99, so there is nothing to review.\n`);
  // shrunk since the lint
  assert.equal(slimdeer(linted, fire, "--target", "95").status, 0);
  const shrunk = slimdeer(linted, "--review", "--flagged");
  assert.equal(shrunk.status, 0, shrunk.stderr);
  assert.equal(shrunk.stdout, "slimdeer: the image the last lint here flagged can't be made smaller now, so there is nothing to review; lint again to update the list.\n");
  // gone since the lint
  rmSync(join(linted, fire));
  const gone = slimdeer(linted, "--review", "--flagged");
  assert.equal(gone.status, 2);
  assert.equal(gone.stderr, `${fire}: no such file or folder\n`);
  assert.equal(gone.stdout, "slimdeer: review incomplete: none of the images the last lint here flagged could be shown; lint again to update the list.\n");
});

test("--review --flagged reads an image another package's code names from the folder the lint measured it into", () => {
  // the app's lint measures the root package's image into the app's cache, not the image's package's
  const linted = project({ images: [BALL], files: { "apps/web/package.json": "{}", "apps/web/src/a.js": `export const ball = new URL("../../../${BALL}", import.meta.url);\n` } });
  assert.match(oxlintSummary(linted, "apps"), /^slimdeer: 1 flagged image could be/m);
  const review = slimdeer(linted, "--review", "--flagged");
  assert.equal(review.status, 0, review.stderr);
  assert.doesNotMatch(review.stderr, /measuring/);
  assert.deepEqual(parse(readFileSync(join(cacheDir(linted), "review", "index.html"), "utf8")).cards.map(({ path }) => path), [BALL]);
});

test("each image opens at a zoom that shows its pixels: a small icon enlarged, a long strip at 100%, the rest to fit", () => {
  const sizes = [[32, 32], [100, 100], [600, 6000], [6000, 300], [800, 600], [128, 20]];
  const html = page(model(sizes.map(([width, height], i) => card(`${i}.png`, { width, height }))));
  const { cards } = parse(html);
  assert.deepEqual(cards.map(({ zoom }) => zoom), ["8", "2", "1", "1", "0", "1"]);
  assert.deepEqual(cards.map(({ figure }) => figure), ["compare zoomed pixels", "compare zoomed pixels", "compare zoomed", "compare zoomed", "compare", "compare zoomed"]);
  // beyond 200% only where it opens there
  assert.deepEqual(cards[0].zooms, ["Fit", "100%", "200%", "800%"]);
  assert.deepEqual(cards[1].zooms, ["Fit", "100%", "200%"]);
  assert.ok(html.includes("#image-0 { --w: 32; --h: 32; --z: 8; }"));
  assert.ok(html.includes("#image-4 { --w: 800; --h: 600; --z: 1; }"));
});

test("printed, the page ends with the bar instead of covering a card, keeps each card to a page, puts a fitted image's divider in the middle, and gives the command whole", () => {
  const print = /@media print \{\n([\s\S]*?)\n\}/.exec(page(model([card("a.png"), card("b.png")])))?.[1] ?? "";
  assert.match(print, /^ {2}\.bar \{ position: static;/m);
  assert.match(print, /^ {2}\.image \{ break-inside: avoid; \}$/m);
  // the script sets the divider in pixels of the screen's frame, which the paper's isn't; a zoomed
  // image's cut is in pixels of the whole image, so the divider stays over it
  assert.match(print, /^ {2}\.compare:not\(\.zoomed\) \.view \{ --d: 50% !important; --x: 50% !important; \}$/m);
  assert.match(print, /^ {2}\.grip \{ display: none; \}$/m);
  // paper has no scroll bar: the command wraps, all of it in view; Copy and what it said are for the screen
  assert.match(print, /^ {2}#command \{ max-height: none; white-space: pre-wrap; overflow-wrap: anywhere; \}$/m);
  assert.match(print, /^ {2}#copy, #status \{ display: none; \}$/m);
});

test("the divider's grip sits near the top of a tall image, where a laptop's first screen shows it, over the keyboard's slider", () => {
  const style = /<style>([\s\S]*?)<\/style>/.exec(page(model([card("a.png", { width: 1280, height: 758 })])))[1];
  const top = (rule) => new RegExp(`^\\${rule} \\{[^}]*?\\btop: ([^;]+);`, "m").exec(style)[1];
  assert.equal(top(".grip"), "min(50%, 160px)");
  // focus scrolls the slider above the bar, and its ring is drawn on the grip: the two move together
  assert.equal(top(".slider"), top(".grip"));
});

test("the page offers each view only where it does something: a filter, a background, the bulk ticks, a list to jump from", () => {
  const has = (html, text) => html.includes(text);
  const mixed = page(model([card("a.png", { score: 75, alpha: true }), card("b.png", { score: 90 }), card("c.png", { outcome: "lossless", score: 100 })]));
  assert.ok(has(mixed, `<input autocomplete="off" type="radio" name="show" value="low"><span>Quality below 80 (1)</span>`));
  assert.ok(has(mixed, `<legend>Background<span class="hidden"> behind transparent images</span></legend>`));
  assert.ok(has(mixed, `<article class="image low-card" id="image-0"`));
  assert.ok(has(mixed, `id="all" checked> Tick all</label>`));
  assert.ok(!has(mixed, `class="index"`));
  // all below 80, or none: no filter; no transparency: no background
  const opaque = page(model([card("a.png", { score: 75 }), card("b.png", { score: 72 })]));
  assert.ok(!has(opaque, `name="show"`));
  assert.ok(!has(opaque, `name="bg"`));
  // one image: nothing to tick in bulk
  const one = page(model([card("a.png")]));
  assert.ok(!has(one, `id="all"`));
  assert.ok(!has(one, `id="low"`));
  // ten: a list, biggest saving first, each linking to its card
  const ten = page(model(Array.from({ length: 10 }, (_, i) => card(i === 1 ? ["1.png", "copy/1.png"] : `${i}.png`, { saved: 10000 - i }))));
  const links = [...ten.matchAll(/<td><a href="#image-(\d+)">(.*?)<\/a>/g)].map(([, i, path]) => `${i}:${path}`);
  assert.deepEqual(links, Array.from({ length: 10 }, (_, i) => `${i}:${i}.png`));
  // the filter follows the radio checked when the page starts, as Firefox keeps it across a reload
  assert.deepEqual(started(mixed, "low"), ["only-low"]);
  assert.deepEqual(started(mixed, "all"), []);
  // copies: one copy's numbers, as the card's picture is one copy, said to be each one's, as the
  // card's tick shrinks them all
  assert.ok(has(ten, `1.png</a> <span class="muted">(2 copies)</span></td><td>10 kB each</td><td class="size">100 kB → 90 kB each</td>`), ten);
  assert.ok(has(spaced(ten), `<p>10% smaller, 100 kB → 90 kB each <span class="dot"`));
  assert.ok(has(ten, `0.png</a></td><td>10 kB</td><td class="size">100 kB → 90 kB</td>`));
  assert.equal(ten.match(/ each <span class="dot"/g).length, 1);
});

test("the page names what it leaves out: images turned down, with the command to try them lower, ones that missed the target, and errors", () => {
  const hostile = `public/<b>"x" & 'y'.png`;
  const declined = [{ file: "/p/a.png", path: "a.png", original: 5000, score: 65.2 }, { file: "/p/x.png", path: hostile, original: 9000, score: 61 }];
  // rounded down: a miss's best is below its target
  const missed = [{ file: "/p/m.png", path: "m.png", original: 7000, score: 89.6 }];
  const errors = [{ file: "/p/e.png", path: "e <1>.png", message: "not measured: EACCES: permission denied, mkdir '/p/<x>'" }];
  const settings = { exclude: ["fixtures"], cacheDir: undefined, minSavedBytes: undefined, minSavedPercent: undefined };
  for (const platform of ["linux", "win32"]) {
    const html = page(model([card("a.png")], { target: undefined, declined, missed, errors, settings }), platform);
    const command = checkCommand([hostile, "a.png"], { exclude: ["fixtures"], target: 60 }, platform);
    assert.ok(html.includes("<summary>2 images can&#39;t be made smaller without a visible difference (best quality below 70), so they aren&#39;t here.</summary>"));
    assert.ok(html.includes("<li><code>public/&#60;b&#62;&#34;x&#34; &#38; &#39;y&#39;.png</code>: best quality 61/100</li><li><code>a.png</code>: best quality 65/100</li>"));
    assert.ok(html.includes(`<p>To try them at a lower target, run${command.shell}:</p>\n<pre>${command.text.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`)}</pre>`));
    assert.ok(html.includes("<summary>1 image isn&#39;t here: no smaller file reaches the automatic quality.</summary>\n<ul><li><code>m.png</code>: best quality 89/100</li></ul>"));
    assert.ok(html.includes("<li><code>e &#60;1&#62;.png</code>: not measured: EACCES: permission denied, mkdir &#39;/p/&#60;x&#62;&#39;</li>"));
    assert.ok(!html.includes(`<b>"x"`));
  }
  assert.ok(page(model([card("a.png")], { target: 90, missed })).includes("<summary>1 image isn&#39;t here: no smaller file reaches --target 90.</summary>"));
  // the command to try them lower wraps, all of it in view: a scroll bar may not show
  assert.match(page(model([card("a.png")], { declined })), /\.unlisted pre \{[^}]*white-space: pre-wrap; overflow-wrap: anywhere;/);
});

test("a screen reader hears the new totals after each tick, as the page rewrites them", () => {
  const html = page(model([card("a.png"), card("b.png")]));
  assert.match(html, /<p id="tally" aria-live="polite">2 of 2 images ticked: /);
});

test("the browser puts none of the page's controls back as they were, so a box never shows unticked while the command shrinks its image", () => {
  const html = page(model([card("a.png", { score: 75, alpha: true }), card("b.png", { score: 90 })]));
  const inputs = html.match(/<input\b[^>]*>/g);
  // the ticks, the bulk tick, the filter, the backgrounds, and each card's four zooms and divider
  assert.equal(inputs.length, 2 + 1 + 2 + 3 + 2 * (4 + 1));
  for (const input of inputs) assert.match(input, /^<input autocomplete="off" /);
});

test("the page runs only its own script and style, and loads nothing from the network", () => {
  const cards = [card("a.png", { outcome: "lossless", score: 100, alpha: true, width: 4, height: 3 }), card("b.png", { score: 71 })];
  const html = page(model(cards, { declined: [{ path: "d.png", original: 1, score: 50 }], errors: [{ path: "e.png", message: "no" }] }));
  const policy = /<meta http-equiv="Content-Security-Policy" content="(.*?)">/.exec(html)[1];
  const hash = (text) => `'sha256-${createHash("sha256").update(text).digest("base64")}'`;
  assert.ok(policy.startsWith("default-src 'none'; img-src 'self' file:; "), policy);
  assert.ok(policy.includes(`style-src ${hash(/<style>([\s\S]*?)<\/style>/.exec(html)[1])};`));
  assert.ok(policy.includes(`script-src ${hash(/<script>([\s\S]*?)<\/script>/.exec(html)[1])};`));
  // no inline handler or style attribute, which the policy would block
  assert.doesNotMatch(html, /\son[a-z]+=|\sstyle=/);
  assert.match(html, /Lossless: looks identical/);
  assert.match(html, /<dd>automatic, never below quality 70<\/dd>/);
  assert.match(html, /aria-label="Divider for b\.png: before on its left, after on its right"/);
});

test("the bar stays at the bottom of the window, and keyboard focus above it, only where the window has room for an image", () => {
  const html = page(model([card("a.png"), card("b.png")]));
  const { script } = parse(html);
  const style = /<style>([\s\S]*?)<\/style>/.exec(html)[1];
  assert.match(style, /\n\.bar \{ position: sticky; bottom: 0;/);
  assert.match(style, /\n:root \{ scroll-padding-bottom: calc\(var\(--bar, 0px\) \+ 12px\); \}/);
  // a phone on its side, a page zoomed in far: the bar ends the page, and focus isn't padded for it
  const start = style.indexOf("@media (max-height: 480px) {");
  assert.notEqual(start, -1);
  const short = style.slice(start, style.indexOf("\n}", start));
  assert.match(short, /\n {2}\.bar \{ position: static; \}/);
  assert.match(short, /\n {2}:root \{ scroll-padding-bottom: 0; \}/);
  // the script gives the bar's height, not the padding: an inline padding would beat the short window's
  assert.match(script, /setProperty\("--bar", `\$\{bar\.offsetHeight\}px`\)/);
  assert.doesNotMatch(script, /scroll-padding/);
});

test("the first Tab on the page offers to skip every card's controls to the command", () => {
  const html = page(model([card("a.png"), card("b.png")]));
  assert.match(html, /<body>\n<a class="skip" href="#command">Skip to the command<\/a>\n<header/);
  assert.match(html, /<pre id="command" tabindex="0"/);
});

test("--open asks the system's opener for the page, with no shell to read the path", () => {
  const file = "/work/R&D 100%/node_modules/.cache/slimdeer/review/index.html";
  assert.deepEqual(opener(file, "darwin"), { command: "open", args: [file] });
  // Windows' own explorer.exe, by its full path, never one in the folder the review runs in
  const windows = opener("C:\\R&D 100%\\index.html", "win32");
  assert.deepEqual(windows.args, ["C:\\R&D 100%\\index.html"]);
  assert.ok(win32.isAbsolute(windows.command) && win32.basename(windows.command).toLowerCase() === "explorer.exe", windows.command);
  assert.deepEqual(opener(file, "linux"), { command: "xdg-open", args: [file] });
  assert.deepEqual(opener(file, "freebsd"), { command: "xdg-open", args: [file] });
});

// Windows finds explorer.exe without PATH
test("--open with no opener installed says so in one line, and the review still exits 0", { skip: process.platform === "win32" }, (t) => {
  const empty = mkdtempSync(join(tmpdir(), "slimdeer-nopath-"));
  t.after(() => rmSync(empty, { recursive: true, force: true }));
  const review = spawnSync(process.execPath, [join(plugin, "bin/slimdeer.js"), "--review", "--open"], { cwd: dir, env: { ...process.env, PATH: empty }, encoding: "utf8" });
  assert.equal(review.status, 0, review.stderr);
  assert.match(review.stderr, /^slimdeer: couldn't open a browser: (?:open|xdg-open) isn't installed$/m);
  assert.match(review.stdout, /^slimdeer: open it in a browser, untick any image to keep as it is, and run the command it gives\.$/m);
});

// Windows' explorer.exe exits 1 even when it opened the page
test("--open whose opener gives up says so, and the review still exits 0", { skip: process.platform === "win32" }, (t) => {
  const bin = mkdtempSync(join(tmpdir(), "slimdeer-opener-"));
  t.after(() => rmSync(bin, { recursive: true, force: true }));
  // as xdg-open does with no display and no browser to use (over SSH, in a container)
  for (const name of ["open", "xdg-open"]) writeFileSync(join(bin, name), "#!/bin/sh\necho \"xdg-open: no method available for opening '$1'\" >&2\nexit 3\n", { mode: 0o755 });
  const review = spawnSync(process.execPath, [join(plugin, "bin/slimdeer.js"), "--review", "--open"], { cwd: dir, env: { ...process.env, PATH: bin }, encoding: "utf8" });
  assert.equal(review.status, 0, review.stderr);
  assert.match(review.stderr, /^slimdeer: couldn't open a browser: (?:open|xdg-open) exited with code 3$/m);
  assert.match(review.stdout, /^slimdeer: open it in a browser, untick any image to keep as it is, and run the command it gives\.$/m);
});

test("--open whose opener stays with the browser it started doesn't wait for it", { skip: process.platform === "win32" }, (t) => {
  const bin = mkdtempSync(join(tmpdir(), "slimdeer-opener-"));
  const pid = join(bin, "pid");
  t.after(() => {
    try {
      process.kill(Number(readFileSync(pid, "utf8")));
    } catch {
      // it never started, or it's gone
    }
    rmSync(bin, { recursive: true, force: true });
  });
  // as xdg-open does outside a desktop environment: it runs the browser and waits for it to close
  for (const name of ["open", "xdg-open"]) writeFileSync(join(bin, name), `#!/bin/sh\necho $$ > '${pid}'\nexec /bin/sleep 120\n`, { mode: 0o755 });
  const review = spawnSync(process.execPath, [join(plugin, "bin/slimdeer.js"), "--review", "--open"], { cwd: dir, env: { ...process.env, PATH: bin }, encoding: "utf8", timeout: 60_000 });
  assert.equal(review.status, 0, review.stderr);
  assert.doesNotMatch(review.stderr, /couldn't open a browser/);
  assert.match(review.stdout, /^slimdeer: opening it in your browser; untick any image to keep as it is, and run the command it gives\.$/m);
});

// chmod keeps neither Windows nor root out
test("a review folder that can't be changed is named, and with nothing to review --check's words still follow", { skip: process.platform === "win32" || process.getuid?.() === 0 }, () => {
  chmodSync(folder, 0o555);
  try {
    const nothing = slimdeer(dir, "--review", "--min-saved-percent", "99");
    assert.equal(nothing.status, 0, nothing.stderr);
    assert.equal(nothing.stderr, "slimdeer: couldn't remove the old review page in node_modules/.cache/slimdeer/review: permission denied\n");
    assert.equal(nothing.stdout, `${slimdeer(dir, "--check", "--min-saved-percent", "99").stdout}${NO_PAGE}`);
    const review = slimdeer(dir, "--review");
    assert.equal(review.status, 2);
    assert.equal(review.stderr, "oxlint-plugin-slimdeer: can't write the review folder node_modules/.cache/slimdeer/review: permission denied\n");
  } finally {
    chmodSync(folder, 0o755);
  }
});

/**
 * What a terminal `columns` wide shows of `text`, row by row: lines wrap at the margin (unless DECAWM
 * turns that off), \r goes back to the start of the row the cursor is on, and erase in line clears
 * the rest of it.
 */
function screen(text, columns) {
  const rows = [[]];
  let [row, column, wrap, pending] = [0, 0, true, false];
  const down = () => (rows[++row] ??= []);
  for (let i = 0; i < text.length; i++) {
    const escape = text[i] === "\x1b" && /^\[(\??)(\d*)([A-Za-z])/.exec(text.slice(i + 1, i + 16));
    if (escape) {
      const [whole, mode, number, final] = escape;
      if (mode && number === "7") wrap = final === "h";
      else if (!mode && final === "K") rows[row].length = Math.min(rows[row].length, column);
      [i, pending] = [i + whole.length, false];
    } else if (text[i] === "\r") [column, pending] = [0, false];
    else if (text[i] === "\n") [pending] = [false, down()];
    else if (text[i] === "\b") [column, pending] = [Math.max(0, column - 1), false];
    else if (text[i] >= " ") {
      // the cursor waits at the margin until the next character, which starts a row, or with line wrap
      // off overwrites the last column
      if (pending && wrap) [column] = [0, down()];
      rows[row][column] = text[i];
      pending = column === columns - 1;
      if (!pending) column++;
    }
  }
  return rows.map((cells) => Array.from(cells, (cell) => cell ?? " ").join(""));
}

// script(1) gives the command a terminal (a pty): Windows has none
test("on a narrow terminal, the measuring and preview counts leave no rows behind", { skip: process.platform === "win32" }, (t) => {
  const narrow = project({ images: [BALL, "public/unused-fire.png"] });
  const out = join(narrow, "terminal.txt");
  const command = `stty cols 30 rows 50; exec ${[process.execPath, join(plugin, "bin/slimdeer.js"), "--review"].map((arg) => `'${arg.replaceAll("'", "'\\''")}'`).join(" ")}`;
  // util-linux's script(1) takes the command with -c, BSD's (macOS) after the file
  const flags = process.platform === "linux" ? ["-q", "-c", command, out] : ["-q", out, "sh", "-c", command];
  // no input: macOS's script(1) fails asking a pipe for its terminal settings
  const run = spawnSync("script", flags, { cwd: narrow, stdio: ["ignore", "pipe", "pipe"], encoding: "utf8", timeout: 300_000 });
  if (run.error?.code === "ENOENT") return t.skip("no script(1) to give the command a terminal");
  assert.equal(run.status, 0, run.stderr);
  const text = readFileSync(out, "utf8");
  // both counts ran, each wider than the terminal
  assert.match(text, /\rslimdeer: measuring 2 images\.\.\. 2\/2, could save /);
  assert.match(text, /\rslimdeer: writing 2 previews\.\.\. 2\/2/);
  const rows = screen(text, 30);
  assert.ok(rows.some((row) => row.startsWith("slimdeer: the page that compar")), rows.join("\n"));
  assert.deepEqual(rows.filter((row) => /measuring|writing/.test(row)), []);
});

test("a review folder that is a link is left as it is, and so is every file where it leads", (t) => {
  const linked = project({ images: [BALL] });
  // someone's own folder, as a link to public/ or to a home folder leads to
  const elsewhere = mkdtempSync(join(tmpdir(), "slimdeer-elsewhere-"));
  t.after(() => rmSync(elsewhere, { recursive: true, force: true }));
  mkdirSync(join(elsewhere, "posts"));
  writeFileSync(join(elsewhere, "index.html"), "<h1>site</h1>");
  writeFileSync(join(elsewhere, "posts/first.md"), "# first");
  copyFileSync(join(dir, PHOTO), join(elsewhere, "photo.jpg"));
  const link = join(cacheDir(linked), "review");
  mkdirSync(cacheDir(linked), { recursive: true });
  try {
    // a junction on Windows, which needs no privilege
    symlinkSync(elsewhere, link, "junction");
  } catch (error) {
    if (process.platform !== "win32") throw error;
    return t.skip("no junction here");
  }
  const review = slimdeer(linked, "--review");
  assert.equal(review.status, 2, review.stdout);
  assert.match(review.stderr, /^oxlint-plugin-slimdeer: the review folder node_modules\/\.cache\/slimdeer\/review is a link to another folder, which a review would empty: remove the link and run --review again$/m);
  assert.equal(review.stdout, "");
  // a review of the last lint's list says to run that again
  writeFileSync(flaggedList(linked), JSON.stringify({ cwd: realpathSync.native(linked), images: [{ file: BALL }] }));
  assert.match(slimdeer(linked, "--review", "--flagged").stderr, /: remove the link and run --review --flagged again$/m);
  assert.ok(lstatSync(link).isSymbolicLink());
  assert.deepEqual(readdirSync(elsewhere, { recursive: true }).sort(), ["index.html", "photo.jpg", "posts", join("posts", "first.md")].sort());
  assert.equal(sha(join(elsewhere, "photo.jpg")), sha(join(dir, PHOTO)));
});
