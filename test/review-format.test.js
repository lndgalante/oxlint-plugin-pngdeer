// --review --format webp|avif: the page that sets each image's copy beside the original and beside
// the image's own shrink, and the command it gives, which writes the very files it shows. The
// example's real images go to the engine once, as WebP, in one copy of example/ that the tests share;
// the cases that change it start from a copy of that, its cache included. AVIF, which is slow, runs
// only on a tiny generated image.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { once } from "node:events";
import { cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, test } from "node:test";
import { pathToFileURL } from "node:url";
import vm from "node:vm";
import { cacheDir, convertKey, key, read, write } from "../src/cache.js";
import { mark } from "../src/marker.js";
import { page } from "../src/review-page.js";
import { flaggedList } from "../src/summary.js";
import { shrinkCommand, size, smaller } from "../src/text.js";
import { gradient, oxlintSummary, plugin, project, slimdeer } from "./helpers.js";

const BALL = "src/assets/crystal-ball.png";
const HERO = "public/hero.png";
const DIAGRAM = "src/assets/diagram.png";
const FIRE = "public/unused-fire.png";
const IMAGES = [HERO, DIAGRAM, BALL, "public/photo.jpg", FIRE, "src/assets/heart.png"];

const folders = []; // made here, removed at the end
after(() => folders.forEach((dir) => rmSync(dir, { recursive: true, force: true })));

const sha = (file) => createHash("sha256").update(readFileSync(file)).digest("hex");
const unescape = (text) => text.replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)));
/** The page's text with its no-break spaces (between a size's number and unit) as plain ones. */
const spaced = (text) => text.replaceAll(" ", " ");
/** The lines of a run's stderr, without the counts a slow machine adds every 30 s. */
const said = (stderr) => stderr.split("\n").filter((line) => line && !/^slimdeer: (measured|wrote) \d+ of /.test(line));
const review = (dir, ...args) => slimdeer(dir, "--review", ...args);
const reviewFolder = (dir) => join(cacheDir(dir), "review");
const html = (dir) => spaced(readFileSync(join(reviewFolder(dir), "index.html"), "utf8"));

/** The parts of a page: its data, its script, its command, and per card its path, copies, facts, labels and images. */
function parse(text) {
  const data = JSON.parse(/<script type="application\/json" id="data">([\s\S]*?)<\/script>/.exec(text)[1]);
  const script = /<script>([\s\S]*?)<\/script>/.exec(text)[1];
  const cards = [...text.matchAll(/<article class="image[^"]*" id="image-\d+"[\s\S]*?<\/article>/g)].map(([block]) => ({
    path: unescape(/<h2 class="path" id="path-\d+">(.*?)<\/h2>/.exec(block)[1]),
    also: [...(/<p class="also">(.*?)<\/p>/.exec(block)?.[1] ?? "").matchAll(/<code>(.*?)<\/code>/g)].map(([, path]) => unescape(path)),
    pick: /<label class="pick"><input [^>]*> (.*?)<\/label>/.exec(block)[1],
    facts: unescape(/<div class="facts">\n<p>(.*?)<\/p>/.exec(block)[1].replace(/ <span class="dot" aria-hidden="true">·<\/span> /g, " · ").replace(/<\/?(span|code)[^>]*>/g, "")),
    labels: /<div class="labels">(.*?)<\/div>/.exec(block)[1].replace(/<\/?(span|b)>/g, (tag) => (tag === "</span>" ? "|" : "")).split("|").filter(Boolean),
    after: unescape(/<img class="after" src="(.*?)"/.exec(block)[1]),
    alt: unescape(/<img class="after" [^>]*alt="(.*?)"/.exec(block)[1]),
  }));
  const command = unescape(/<pre id="command"[^>]*>([^<]*)<\/pre>/.exec(text)[1]);
  return { data, script, cards, command };
}

/** The page's script run without a browser, in `context`: its functions. */
function run(script, context = {}) {
  const sandbox = vm.createContext(context);
  vm.runInContext(script, sandbox);
  return sandbox;
}

/** Runs the command a page gives, in `dir`, as npx would: its result. */
function runCommand(dir, command) {
  const result = slimdeer(dir, ...command.replace(/^npx oxlint-plugin-slimdeer /, "").split(" "));
  assert.equal(result.status, 0, result.stderr);
  return result;
}

let shared;

/** A copy of example/ reviewed once as WebP, and that first run. */
function example() {
  if (!shared) {
    const dir = project();
    shared = { dir, cold: review(dir, "--format", "webp") };
  }
  return shared;
}

/** A copy of the reviewed example, its cache and review folder included, for a test that changes it. */
function exampleCopy() {
  const dir = mkdtempSync(join(tmpdir(), "slimdeer-"));
  folders.push(dir);
  cpSync(example().dir, dir, { recursive: true });
  return dir;
}

let made = 0;

/**
 * An image at `path` in `dir`, different from every other one made here (the crystal ball with zeros
 * after), measured already in its cache at `target`: in its own format as `own` says, and as WebP at
 * its equal target as `copy` says ({ compressed or saved, outcome, score }). Returns its size and the
 * name of its copy's preview.
 */
function measured(dir, path, { own, copy: { saved, ...copy }, target }) {
  const image = Buffer.concat([readFileSync(join(plugin, "example", BALL)), Buffer.alloc(++made)]);
  mkdirSync(dirname(join(dir, path)), { recursive: true });
  writeFileSync(join(dir, path), image);
  const original = image.length;
  write(cacheDir(dir), key(image, target), { original, compressed: original - own.saved, outcome: "hit", score: own.score });
  const equal = target ?? own.score;
  write(cacheDir(dir), convertKey(image, equal, "webp"), { format: "webp", original, outcome: "hit", target: equal, ...(saved === undefined ? {} : { compressed: original - saved }), ...copy });
  return { original, preview: `${convertKey(image, equal, "webp")}.webp` };
}

test("--review --format webp writes a page of the copies that beat their own shrink, and says where it is and what it leaves out", () => {
  const { dir, cold } = example();
  assert.equal(cold.status, 0, cold.stderr);
  // measuring wrote each copy it made into the review folder: none is written again
  assert.deepEqual(said(cold.stderr), ["slimdeer: measuring 5 images not in the cache yet...", "slimdeer: measuring 5 images as WebP at the same quality..."]);
  const index = join(realpathSync(dir), "node_modules/.cache/slimdeer/review/index.html");
  assert.deepEqual(cold.stdout.split("\n"), [
    "slimdeer: as WebP, 3 images could be 641 kB smaller (793 kB → 152 kB, 81% smaller); shrunk in place at the same quality, they would be 225 kB. Images unchanged.",
    "slimdeer: 2 images aren't on the page: as WebP they would save less than 4.1 kB or 10% more than shrinking them in place; to shrink them in place instead, run: npx oxlint-plugin-slimdeer public/photo.jpg public/unused-fire.png",
    `slimdeer: the page that compares each one before and after: ${pathToFileURL(index).href}`,
    "slimdeer: open it in a browser, untick any image to keep as it is, and run the command it gives: it writes the WebP files next to the originals and lists the code that still names them.",
    "",
  ]);
  // the review changed no image, and wrote nothing next to one
  for (const image of IMAGES) assert.equal(sha(join(dir, image)), sha(join(plugin, "example", image)), image);
  assert.deepEqual(readdirSync(join(dir, "public")).filter((name) => /\.(webp|avif)$/.test(name)), []);

  const text = html(dir);
  const { data, script, cards, command } = parse(text);
  assert.ok(text.includes("<title>slimdeer review: as WebP, 3 images could be 641 kB smaller</title>"));
  assert.ok(text.includes("<h1>As WebP, 3 images could be 641 kB smaller</h1>\n<p class=\"sum\">793 kB → 152 kB, 81% smaller; shrunk in place at the same quality, they would be 225 kB</p>"));
  assert.ok(text.includes("<div><dt>Format</dt><dd>WebP, written next to each original, which stays</dd></div>"));
  assert.ok(text.includes("<div><dt>Target</dt><dd>the quality each image's PNG or JPEG shrink would have (automatic, never below quality 70)</dd></div>"));
  assert.ok(text.includes("<p>Each “after” is the WebP file the command writes next to its original, byte for byte. Nothing was uploaded, and no image file was changed. The originals stay; the code that names them has to change to use the new files.</p>\n</details>"));
  // the cards, the biggest saving beyond the shrink first, as --check's command names them
  assert.deepEqual(cards.map(({ path, pick, facts, labels, alt }) => [path, pick, facts, labels, alt]), [
    [HERO, "Write as WebP", "82% smaller, 509 kB → 92 kB · Quality 87/100: looks the same side by side · Shrunk as PNG at the same quality: 151 kB", ["Before 509 kB", "After (WebP) 92 kB"], `${HERO}, after: the WebP file the command writes`],
    [DIAGRAM, "Write as WebP", "78% smaller, 248 kB → 55 kB · Quality 90/100: looks identical · Shrunk as PNG at the same quality: 63 kB", ["Before 248 kB", "After (WebP) 55 kB"], `${DIAGRAM}, after: the WebP file the command writes`],
    [BALL, "Write as WebP", "87% smaller, 35 kB → 4.8 kB · Quality 87/100: looks the same side by side · Shrunk as PNG at the same quality: 11 kB", ["Before 35 kB", "After (WebP) 4.8 kB"], `${BALL}, after: the WebP file the command writes`],
  ]);
  // the bar: the tally, the command --check gives to write them, and what it does
  assert.ok(text.includes(`<p id="tally" aria-live="polite">3 of 3 images ticked: as WebP, could save 641 kB (793 kB → 152 kB, 81% smaller)</p>`));
  const check = slimdeer(dir, "--check", "--format", "webp");
  assert.equal(command, check.stdout.trim().split("\n").at(-1).replace(/^.*?, run: /, ""));
  assert.equal(command, "npx oxlint-plugin-slimdeer public/hero.png src/assets/diagram.png src/assets/crystal-ball.png --format webp");
  assert.ok(text.includes(`<span id="say">To write them, run this</span>`));
  assert.ok(text.includes(`</pre><button type="button" id="copy">Copy</button></div>\n<p class="writes">It writes each one as a new .webp file next to its original, which stays, then lists the lines of code that still name the originals.</p>`));
  // what isn't here, as the terminal says it, with the sizes
  assert.ok(text.includes(`<details class="unlisted"><summary>2 images aren&#39;t here: as WebP they would save less than 4.1 kB or 10% more than shrinking them in place.</summary>
<ul><li><code>public/photo.jpg</code>: 83 kB as WebP, 85 kB shrunk in place</li><li><code>public/unused-fire.png</code>: 6.6 kB as WebP, 7.5 kB shrunk in place</li></ul>
<p>To shrink them in place instead, run:</p>
<pre>npx oxlint-plugin-slimdeer public/photo.jpg public/unused-fire.png</pre>
</details>`), text);
  // a page of copies doesn't point at itself, and shows no AVIF note
  assert.doesNotMatch(text, /As WebP or AVIF\?|can't show AVIF/);
  // the page's own script: as the bar changes
  const { commands, tally, instruction } = run(script);
  assert.equal(spaced(tally(data, [true, false, true])), "2 of 3 images ticked: as WebP, could save 448 kB (545 kB → 97 kB, 82% smaller)");
  assert.equal(commands(data, [false, true, false]).lines[0], shrinkCommand([DIAGRAM], undefined, process.platform, "webp").text);
  assert.equal(instruction(1, 1, ""), "To write it, run this");
  assert.equal(instruction(0, 0, ""), "Tick the images to write, and the command that writes them appears here.");
  // the policy stays as strict: no inline handler, nothing from the network
  assert.match(text, /<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src 'self' file:; style-src 'sha256-[^']+'; script-src 'sha256-[^']+'; base-uri 'none'; form-action 'none'">/);
  assert.doesNotMatch(text, /\son[a-z]+=|\sstyle=|(?:src|href)="(?:https?:)?\/\//);

  // each "after" is a file of its own in the review folder, of the size the card says, named by its copy's key
  const folder = reviewFolder(dir);
  assert.deepEqual(readdirSync(folder).sort(), [".gitignore", "index.html", ...cards.map(({ after }) => after)].sort());
  for (const card of cards) {
    const image = readFileSync(join(dir, card.path));
    // the copy aims at the score of the image's own shrink
    assert.equal(card.after, `${convertKey(image, read(cacheDir(dir), key(image)).score, "webp")}.webp`);
    assert.equal(`After (WebP) ${size(statSync(join(folder, card.after)).size)}`, card.labels[1]);
  }
});

test("a second --review --format webp measures nothing, writes no preview, and says the same", () => {
  const { dir, cold } = example();
  const folder = reviewFolder(dir);
  const times = Object.fromEntries(readdirSync(folder).filter((name) => name.endsWith(".webp")).map((name) => [name, statSync(join(folder, name)).mtimeMs]));
  const warm = review(dir, "--format", "webp");
  assert.equal(warm.status, 0, warm.stderr);
  assert.equal(warm.stderr, "");
  assert.equal(warm.stdout, cold.stdout);
  for (const [name, time] of Object.entries(times)) assert.equal(statSync(join(folder, name)).mtimeMs, time, name);
});

test("with a copy next to each image on the page, the review has nothing to show, and says so in --check's words", () => {
  const dir = exampleCopy();
  // the copies the page's command writes (other tests run it, and compare the bytes)
  for (const { path, after } of parse(html(dir)).cards) writeFileSync(join(dir, path.replace(/\.png$/, ".webp")), readFileSync(join(reviewFolder(dir), after)));

  const again = review(dir, "--format", "webp");
  assert.equal(again.status, 0, again.stderr);
  assert.equal(again.stdout, `${slimdeer(dir, "--check", "--format", "webp").stdout}slimdeer: no image to compare as WebP, so no page was written.\n`);
  assert.match(again.stdout, /^slimdeer: 3 images already have a WebP file next to them, which --format never replaces, so they aren't listed: public\/hero\.png, src\/assets\/diagram\.png, src\/assets\/crystal-ball\.png$/m);
  assert.match(again.stdout, /^slimdeer: as WebP, every image that would be smaller already has its WebP file\. Images unchanged\.$/m);
  assert.equal(existsSync(reviewFolder(dir)), false);
});

test("the page's command names the copies in the order --check's does: the biggest saving beyond the shrink first", () => {
  const dir = exampleCopy();
  const args = ["--format", "webp", "--min-saved-bytes", "0", "--min-saved-percent", "0"];
  assert.equal(review(dir, ...args).status, 0);
  const { command } = parse(html(dir));
  assert.equal(command, slimdeer(dir, "--check", ...args).stdout.trim().split("\n").at(-1).replace(/^.*?, run: /, ""));
  // the photo saves more in all than the crystal ball, which saves more beyond its shrink
  assert.match(command, / src\/assets\/crystal-ball\.png public\/photo\.jpg /);
});

test("with nothing to compare as WebP, the review says what --check --format says and that it wrote no page", () => {
  const dir = exampleCopy();
  const nothing = review(dir, "--format", "webp", "src/assets/heart.png");
  assert.equal(nothing.status, 0, nothing.stderr);
  assert.equal(nothing.stdout, `${slimdeer(dir, "--check", "--format", "webp", "src/assets/heart.png").stdout}slimdeer: no image to compare as WebP, so no page was written.\n`);
  assert.match(nothing.stdout, /^slimdeer: as WebP, no image here would be smaller than shrinking it in place by both thresholds\. Images unchanged\.$/m);
  // the page from before goes: its savings aren't this run's
  assert.equal(existsSync(reviewFolder(dir)), false);
});

test("an image with a file where its copy would go isn't on the page, which says so; copies of one image share a card; left out and missed images are named", () => {
  const dir = exampleCopy();
  writeFileSync(join(dir, "public/hero.webp"), "someone's file");
  // a copy of the crystal ball, which shares its measurement, its preview and its card
  cpSync(join(dir, BALL), join(dir, "public/ball-copy.png"));
  // the command's own output: converting it would be a second lossy pass
  writeFileSync(join(dir, "public/shrunk.png"), mark(readFileSync(join(dir, DIAGRAM))));
  // a copy whose best rounds as its target does
  measured(dir, "public/close.png", { own: { saved: 20000, score: 87.3 }, copy: { compressed: 9000, outcome: "miss", score: 87.1 } });
  const lines = review(dir, "--format", "webp");
  assert.equal(lines.status, 0, lines.stderr);
  assert.deepEqual(lines.stdout.split("\n").slice(0, -3), [
    "slimdeer: as WebP, 3 images could be 254 kB smaller (319 kB → 64 kB, 80% smaller); shrunk in place at the same quality, they would be 85 kB. Images unchanged.",
    "slimdeer: 2 images aren't on the page: as WebP they would save less than 4.1 kB or 10% more than shrinking them in place; to shrink them in place instead, run: npx oxlint-plugin-slimdeer public/photo.jpg public/unused-fire.png",
    "slimdeer: public/hero.png already has a WebP file next to it, which --format never replaces, so it isn't on the page",
    "slimdeer: 1 image this command already shrank is left out: converting it would be a second lossy pass; convert the original instead",
    "slimdeer: public/close.png isn't on the page: as WebP, no file reaches quality 87.3/100, the PNG's (the best reaches quality 87.1/100)",
  ]);
  assert.equal(readFileSync(join(dir, "public/hero.webp"), "utf8"), "someone's file");

  const text = html(dir);
  const { data, script, cards, command } = parse(text);
  assert.deepEqual(cards.map(({ path, also, pick }) => [path, also, pick]), [[DIAGRAM, [], "Write as WebP"], ["public/ball-copy.png", [BALL], "Write all 2 as WebP"]]);
  assert.equal(cards[1].facts, "87% smaller, 35 kB → 4.8 kB each · Quality 87/100: looks the same side by side · Shrunk as PNG at the same quality: 11 kB");
  assert.equal(command, "npx oxlint-plugin-slimdeer src/assets/diagram.png public/ball-copy.png src/assets/crystal-ball.png --format webp");
  assert.ok(text.includes(`<p id="tally" aria-live="polite">3 of 3 images ticked: as WebP, could save 254 kB (319 kB → 64 kB, 80% smaller)</p>`), text);
  // each copy of the ball counts, as it would be shrunk in place too
  assert.ok(text.includes(`<p class="sum">319 kB → 64 kB, 80% smaller; shrunk in place at the same quality, they would be 85 kB</p>`), text);
  assert.ok(text.includes(`<details class="unlisted"><summary>1 image already has a WebP file next to it, which the command never replaces, so it isn&#39;t here.</summary>\n<ul><li><code>public/hero.png</code> → <code>public/hero.webp</code></li></ul>\n</details>`), text);
  assert.ok(text.includes(`<details class="unlisted"><summary>1 image is left out:</summary>\n<ul><li><code>public/shrunk.png</code> (already shrunk by this command, so converting it would be a second lossy pass; convert the original from before it was shrunk)</li></ul>\n</details>`), text);
  assert.ok(text.includes(`<details class="unlisted"><summary>1 image isn&#39;t here: as WebP, no file reaches quality 87.3/100, the PNG&#39;s.</summary>\n<ul><li><code>public/close.png</code>: best quality 87.1/100</li></ul>\n</details>`), text);
  // the hero's preview goes with its card; the copies share one
  assert.deepEqual(readdirSync(reviewFolder(dir)).filter((name) => name.endsWith(".webp")).sort(), cards.map(({ after }) => after).sort());

  // the ball's card ticked alone: its command writes both copies as its one preview
  const [ball] = run(script).commands(data, [false, true]).lines;
  assert.equal(ball, "npx oxlint-plugin-slimdeer public/ball-copy.png src/assets/crystal-ball.png --format webp");
  runCommand(dir, ball);
  for (const copy of ["public/ball-copy.webp", "src/assets/crystal-ball.webp"]) assert.equal(sha(join(dir, copy)), sha(join(reviewFolder(dir), cards[1].after)), copy);
});

test("a preview gone, cut short or replaced by a link is written again, and counted; nothing else stays in the folder", (t) => {
  const dir = exampleCopy();
  const folder = reviewFolder(dir);
  const { cards } = parse(html(dir));
  const ball = join(folder, cards.find(({ path }) => path === BALL).after);
  const good = readFileSync(ball);
  // a link to someone's file, even one of the very size, which a review must neither keep nor write through
  const elsewhere = mkdtempSync(join(tmpdir(), "slimdeer-elsewhere-"));
  t.after(() => rmSync(elsewhere, { recursive: true, force: true }));
  writeFileSync(join(elsewhere, "mine.webp"), Buffer.alloc(good.length, 1));
  rmSync(ball);
  try {
    symlinkSync(join(elsewhere, "mine.webp"), ball);
  } catch (error) {
    if (process.platform !== "win32") throw error;
    // no symbolic links without a privilege on Windows: a file cut short instead
    writeFileSync(ball, good.subarray(0, 100));
  }
  // a preview cut short
  const diagram = join(folder, cards.find(({ path }) => path === DIAGRAM).after);
  const whole = readFileSync(diagram);
  writeFileSync(diagram, whole.subarray(0, 100));
  // a same-format review's preview, a page and a temporary file left by a killed run
  writeFileSync(join(folder, "0123.png"), "old");
  writeFileSync(join(folder, ".x.webp.123.tmp"), "left");
  const again = review(dir, "--format", "webp");
  assert.equal(again.status, 0, again.stderr);
  assert.deepEqual(said(again.stderr), ["slimdeer: writing 2 previews..."]);
  assert.equal(lstatSync(ball).isFile(), true);
  assert.deepEqual(readFileSync(ball), good);
  assert.deepEqual(readFileSync(diagram), whole);
  assert.deepEqual(readFileSync(join(elsewhere, "mine.webp")), Buffer.alloc(good.length, 1));
  assert.deepEqual(readdirSync(folder).sort(), [".gitignore", "index.html", ...cards.map(({ after }) => after)].sort());
});

test("a review as WebP after a same-format one, and the other way round, each page showing its own previews; the same-format page points at --format webp unless a framework converts images", () => {
  const dir = project({ images: [BALL] });
  const folder = reviewFolder(dir);
  const hint = `<p>As WebP or AVIF? <code>npx oxlint-plugin-slimdeer --review --format webp</code> compares each image as WebP at the same quality as the file above. A new format means a new file name, so the code that uses the image has to change.</p>\n</details>`;
  const same = review(dir);
  assert.equal(same.status, 0, same.stderr);
  assert.ok(html(dir).includes(`<p>Each “after” is the file the command writes, byte for byte. Nothing was uploaded, and no image file was changed.</p>\n${hint}`));
  const png = readdirSync(folder).filter((name) => name.endsWith(".png"));
  assert.equal(png.length, 1);

  // one image: the singular forms
  const webp = review(dir, "--format", "webp");
  assert.equal(webp.status, 0, webp.stderr);
  assert.deepEqual(said(webp.stderr), ["slimdeer: measuring 1 image as WebP at the same quality..."]);
  const index = join(realpathSync(dir), "node_modules/.cache/slimdeer/review/index.html");
  assert.deepEqual(webp.stdout.split("\n"), [
    "slimdeer: as WebP, 1 image could be 31 kB smaller (35 kB → 4.8 kB, 87% smaller); shrunk in place at the same quality, it would be 11 kB. Images unchanged.",
    `slimdeer: the page that compares it before and after: ${pathToFileURL(index).href}`,
    "slimdeer: open it in a browser, and if the after looks right, run the command it gives: it writes the WebP file next to the original and lists the code that still names it.",
    "",
  ]);
  const text = html(dir);
  assert.ok(text.includes("<div><dt>Format</dt><dd>WebP, written next to the original, which stays</dd></div>"));
  assert.ok(text.includes("<div><dt>Target</dt><dd>the quality the image's PNG or JPEG shrink would have (automatic, never below quality 70)</dd></div>"));
  assert.ok(text.includes("<p>The “after” is the WebP file the command writes next to the original, byte for byte. Nothing was uploaded, and no image file was changed. The original stays; the code that names it has to change to use the new file.</p>"));
  assert.ok(text.includes(`<p id="tally" aria-live="polite">Ticked: as WebP, could save 31 kB (35 kB → 4.8 kB, 87% smaller)</p>`));
  assert.ok(text.includes(`<span id="say">To write it, run this</span>`));
  assert.ok(text.includes(`<p class="writes">It writes it as a new .webp file next to the original, which stays, then lists the lines of code that still name the original.</p>`));
  assert.ok(!text.includes("As WebP or AVIF?"));
  const [after] = readdirSync(folder).filter((name) => name !== ".gitignore" && name !== "index.html");
  assert.match(after, /\.webp$/);

  // back: the same-format preview is written again, and the copy's goes
  const back = review(dir);
  assert.equal(back.status, 0, back.stderr);
  assert.deepEqual(said(back.stderr), ["slimdeer: writing 1 preview..."]);
  assert.deepEqual(readdirSync(folder).sort(), [".gitignore", "index.html", ...png].sort());
  assert.ok(html(dir).includes(hint));

  // a project that depends on a framework that converts images itself: no pointer, and as WebP, the caution
  writeFileSync(join(dir, "package.json"), JSON.stringify({ dependencies: { next: "16.0.0" } }));
  const framework = review(dir);
  assert.equal(framework.status, 0, framework.stderr);
  assert.ok(!html(dir).includes("As WebP or AVIF?"));
  const caution = "slimdeer: this project depends on next, which can serve images as WebP by itself; convert only images it doesn't serve, or they go through a second lossy pass";
  const converted = review(dir, "--format", "webp");
  assert.equal(converted.status, 0, converted.stderr);
  assert.deepEqual(said(converted.stderr), ["slimdeer: writing 1 preview...", caution]);
  assert.ok(html(dir).includes(`</dl>\n<ul class="cautions"><li>This project depends on next, which can serve images as WebP by itself; convert only images it doesn't serve, or they go through a second lossy pass.</li></ul>\n</div>`));
});

test("as AVIF at a target given, a tiny image's page names the target, the shrink that misses it, the cautions, and what a browser without AVIF shows", () => {
  const dir = project({ images: [], files: { "package.json": JSON.stringify({ devDependencies: { "vite-imagetools": "7.0.0" } }), "public/og-image.png": gradient(32) } });
  const args = ["--format", "avif", "--target", "80", "--min-saved-bytes", "0", "--min-saved-percent", "0"];
  const lines = review(dir, ...args);
  assert.equal(lines.status, 0, lines.stderr);
  const original = statSync(join(dir, "public/og-image.png")).size;
  const { cards, command, script } = parse(html(dir));
  const preview = join(reviewFolder(dir), cards[0].after);
  const copy = statSync(preview).size;
  assert.deepEqual(said(lines.stderr), [
    "slimdeer: measuring 1 image not in the cache yet...",
    "slimdeer: measuring 1 image as AVIF at the same quality; AVIF is slow: often about a minute per image...",
    "slimdeer: this project depends on vite-imagetools, which can serve images as WebP by itself; convert only images it doesn't serve, or they go through a second lossy pass",
    "slimdeer: public/og-image.png looks like a share image or an icon by its name; in a December 2024 test, link previews on X, LinkedIn, Slack and iMessage didn't show AVIF, so keep a PNG or JPEG for those",
  ]);
  // the shrink misses the target, so in place it stays as it is
  assert.equal(lines.stdout.split("\n")[0], `slimdeer: as AVIF, 1 image could be ${size(original - copy)} smaller (${size(original)} → ${size(copy)}, ${smaller(original, copy)}% smaller); shrunk in place at the same quality, it would be ${size(original)}. Images unchanged.`);
  const text = html(dir);
  assert.ok(text.includes("<div><dt>Format</dt><dd>AVIF, written next to the original, which stays</dd></div>\n<div><dt>Target</dt><dd>quality 80 (<code>--target 80</code>)</dd></div>"));
  assert.match(cards[0].facts, /^\d+% smaller, .* · Quality \d+\/100: looks .* · As PNG, no smaller file reaches --target 80$/);
  assert.equal(cards[0].labels[1], `After (AVIF) ${size(copy)}`);
  assert.equal(command, "npx oxlint-plugin-slimdeer public/og-image.png --target 80 --format avif");
  assert.ok(text.includes(`<ul class="cautions"><li>This project depends on vite-imagetools, which can serve images as WebP by itself; convert only images it doesn't serve, or they go through a second lossy pass.</li><li><code>public/og-image.png</code> looks like a share image or an icon by its name; in a December 2024 test, link previews on X, LinkedIn, Slack and iMessage didn't show AVIF, so keep a PNG or JPEG for those.</li></ul>`));
  // where the browser can't show AVIF, the page script says so in the image's place: no inline handler
  assert.match(script, /image\.addEventListener\("error", say\)/);
  assert.ok(script.endsWith(`if (typeof document === "object") {\n  start();\n  unshown("This browser can't show AVIF (Safari needs 16.4 or later).");\n}\n`));
  assert.doesNotMatch(text, /\son[a-z]+=/);

  // the command writes the very file the page shows
  runCommand(dir, command);
  assert.equal(sha(join(dir, "public/og-image.avif")), sha(preview));
});

test("--review --flagged --format webp after a lint shows what the lint flagged whose copy beats its shrink by --review's thresholds", () => {
  const files = { "src/a.js": 'import ball from "./assets/crystal-ball.png";\n', "src/b.js": 'export const fire = "/unused-fire.png";\n' };
  const linted = project({ files, images: [BALL, FIRE], options: { scan: "referenced" } });
  oxlintSummary(linted);
  // the same-format page points at the review of the lint's list as WebP
  assert.equal(review(linted, "--flagged").status, 0);
  assert.ok(html(linted).includes("<p>As WebP or AVIF? <code>npx oxlint-plugin-slimdeer --review --flagged --format webp</code> compares each image"));

  const flagged = review(linted, "--flagged", "--format", "webp");
  assert.equal(flagged.status, 0, flagged.stderr);
  assert.deepEqual(said(flagged.stderr), ["slimdeer: measuring 2 images as WebP at the same quality..."]);
  // the fire's copy saves less than 4.1 kB beyond its shrink, as --review --format would say without --flagged
  const fire = "slimdeer: public/unused-fire.png isn't on the page: as WebP it would save less than 4.1 kB or 10% more than shrinking it in place; to shrink it in place instead, run: npx oxlint-plugin-slimdeer public/unused-fire.png";
  assert.deepEqual(flagged.stdout.split("\n").slice(0, 2), ["slimdeer: as WebP, 1 image could be 31 kB smaller (35 kB → 4.8 kB, 87% smaller); shrunk in place at the same quality, it would be 11 kB. Images unchanged.", fire]);
  const { cards, command } = parse(html(linted));
  assert.deepEqual(cards.map(({ path }) => path), [BALL]);
  assert.equal(command, "npx oxlint-plugin-slimdeer src/assets/crystal-ball.png --format webp");
  runCommand(linted, command);
  assert.equal(sha(join(linted, "src/assets/crystal-ball.webp")), sha(join(reviewFolder(linted), cards[0].after)));

  // written: nothing left to compare, said in --check's words, as without --flagged
  const done = review(linted, "--flagged", "--format", "webp");
  assert.equal(done.status, 0, done.stderr);
  assert.equal(done.stdout, [
    "slimdeer: public/unused-fire.png isn't listed: as WebP it would save less than 4.1 kB or 10% more than shrinking it in place (6.6 kB against 7.5 kB); to shrink it in place instead, run: npx oxlint-plugin-slimdeer public/unused-fire.png",
    "slimdeer: src/assets/crystal-ball.png already has a WebP file next to it, which --format never replaces, so it isn't listed",
    "slimdeer: no image to compare as WebP, so no page was written.",
    "",
  ].join("\n"));
  assert.equal(existsSync(reviewFolder(linted)), false);
});

test("--review --flagged --format names what it leaves out at each target the lint flagged at, and the cautions, page or no page", () => {
  const dir = project({ images: [], files: { "package.json": JSON.stringify({ dependencies: { astro: "5.0.0" } }) } });
  // no smaller than its shrink, at 70; missing 80; and one that beats its shrink at 80
  const a = measured(dir, "public/a.png", { target: 70, own: { saved: 20000, score: 72 }, copy: { saved: 19000, score: 75 } }).original;
  measured(dir, "public/b.png", { target: 80, own: { saved: 20000, score: 82 }, copy: { compressed: 2000, outcome: "miss", score: 78.4 } });
  const { original, preview } = measured(dir, "public/c.png", { target: 80, own: { saved: 5000, score: 81 }, copy: { compressed: 3000, score: 83 } });
  // the copy's preview, of the size measured, as an earlier review leaves it
  mkdirSync(reviewFolder(dir), { recursive: true });
  writeFileSync(join(reviewFolder(dir), preview), Buffer.alloc(3000));
  writeFileSync(flaggedList(dir), JSON.stringify({ cwd: realpathSync.native(dir), images: [{ file: "public/a.png", target: 70 }, { file: "public/b.png", target: 80 }, { file: "public/c.png", target: 80 }] }));
  const astro = "slimdeer: this project depends on astro, which can serve images as WebP by itself; convert only images it doesn't serve, or they go through a second lossy pass";

  const shown = review(dir, "--flagged", "--format", "webp");
  assert.equal(shown.status, 0, shown.stderr);
  assert.deepEqual(said(shown.stderr), [astro]);
  assert.deepEqual(shown.stdout.split("\n").slice(0, 3), [
    `slimdeer: as WebP, 1 image could be ${size(original - 3000)} smaller (${size(original)} → 3.0 kB, ${smaller(original, 3000)}% smaller); shrunk in place at the same quality, it would be ${size(original - 5000)}. Images unchanged.`,
    "slimdeer: public/a.png isn't on the page: as WebP it would be no smaller than shrinking it in place; to shrink it in place instead, run: npx oxlint-plugin-slimdeer public/a.png --target 70",
    "slimdeer: public/b.png isn't on the page: as WebP, no file reaches --target 80 (the best reaches quality 78/100)",
  ]);
  const text = spaced(html(dir));
  assert.ok(text.includes(`<summary>1 image isn&#39;t here: as WebP it would be no smaller than shrinking it in place.</summary>\n<ul><li><code>public/a.png</code>: ${size(a - 19000)} as WebP, ${size(a - 20000)} shrunk in place</li></ul>\n<p>To shrink it in place instead, run:</p>\n<pre>npx oxlint-plugin-slimdeer public/a.png --target 70</pre>`), text);
  assert.ok(text.includes(`<summary>1 image isn&#39;t here: as WebP, no file reaches --target 80.</summary>\n<ul><li><code>public/b.png</code>: best quality 78/100</li></ul>`), text);
  assert.ok(text.includes(`<ul class="cautions"><li>This project depends on astro, which can serve images as WebP by itself; convert only images it doesn't serve, or they go through a second lossy pass.</li></ul>`), text);
  assert.equal(parse(text).command, "npx oxlint-plugin-slimdeer public/c.png --target 80 --format webp");

  // with c's copy there, no page: --check's words, each target's, then the caution
  writeFileSync(join(dir, "public/c.webp"), "");
  const none = review(dir, "--flagged", "--format", "webp");
  assert.equal(none.status, 0, none.stderr);
  assert.deepEqual(said(none.stderr), [astro]);
  assert.equal(none.stdout, [
    `slimdeer: public/a.png isn't listed: as WebP it would be no smaller than shrinking it in place (${size(a - 19000)} against ${size(a - 20000)}); to shrink it in place instead, run: npx oxlint-plugin-slimdeer public/a.png --target 70`,
    "slimdeer: public/c.png already has a WebP file next to it, which --format never replaces, so it isn't listed",
    "slimdeer: public/b.png isn't listed: as WebP, no file reaches --target 80 (the best reaches quality 78/100)",
    "slimdeer: no image to compare as WebP, so no page was written.",
    "",
  ].join("\n"));
});

test("a copy whose preview comes out another size than measured is reported and left off the page", () => {
  const dir = project({ images: [] });
  // a measurement no copy of these bytes matches
  measured(dir, "ball.png", { own: { saved: 20000, score: 87 }, copy: { compressed: 3000, score: 88 } });
  const odd = review(dir, "--format", "webp", "--min-saved-bytes", "0");
  assert.equal(odd.status, 2);
  assert.deepEqual(said(odd.stderr).map((line) => line.replace(/ \d+ bytes,/, " N bytes,")), [
    "slimdeer: writing 1 preview...",
    "ball.png: its preview is N bytes, but measuring said 3000; please report this at https://github.com/lndgalante/oxlint-plugin-slimdeer/issues",
  ]);
  assert.equal(odd.stdout, "slimdeer: review incomplete: no preview could be written. Images unchanged.\n");
  assert.deepEqual(readdirSync(reviewFolder(dir)), [".gitignore"]);
});

test("a review folder that is a link is refused before anything is measured as WebP", (t) => {
  const dir = project({ images: [BALL] });
  const elsewhere = mkdtempSync(join(tmpdir(), "slimdeer-elsewhere-"));
  t.after(() => rmSync(elsewhere, { recursive: true, force: true }));
  writeFileSync(join(elsewhere, "index.html"), "<h1>site</h1>");
  mkdirSync(cacheDir(dir), { recursive: true });
  try {
    symlinkSync(elsewhere, reviewFolder(dir), "junction");
  } catch (error) {
    if (process.platform !== "win32") throw error;
    return t.skip("no junction here");
  }
  const refused = review(dir, "--format", "webp");
  assert.equal(refused.status, 2);
  assert.equal(refused.stderr, "oxlint-plugin-slimdeer: the review folder node_modules/.cache/slimdeer/review is a link to another folder, which a review would empty: remove the link and run --review --format webp again\n");
  assert.equal(refused.stdout, "");
  assert.deepEqual(readdirSync(elsewhere), ["index.html"]);
  assert.deepEqual(readdirSync(cacheDir(dir)), ["review"]);
});

test("the review folder keeps Git out before measuring writes a copy into it, so a review stopped then leaves none to commit", async () => {
  const dir = project({ images: [BALL] });
  // another run measuring copies (this process, which is alive) holds the lock: the review waits there
  mkdirSync(cacheDir(dir), { recursive: true });
  const lock = join(cacheDir(dir), "converting.lock");
  writeFileSync(lock, `${process.pid} 0`);
  const child = spawn(process.execPath, [join(plugin, "bin", "slimdeer.js"), "--review", "--format", "webp"], { cwd: dir, stdio: ["ignore", "pipe", "pipe"] });
  let stderr = "";
  const closed = once(child, "close");
  try {
    await new Promise((resolve, reject) => {
      child.stderr.on("data", (chunk) => {
        stderr += chunk;
        if (stderr.includes("slimdeer: waiting for another run measuring this project's images as WebP or AVIF")) resolve();
      });
      closed.then(() => reject(new Error(`the review ended without waiting:\n${stderr}`)));
    });
    assert.equal(readFileSync(join(reviewFolder(dir), ".gitignore"), "utf8"), "# slimdeer --review's previews, rewritten on each run\n*\n");
  } finally {
    rmSync(lock, { force: true });
  }
  const [status] = await closed;
  assert.equal(status, 0, stderr);
  assert.equal(readdirSync(reviewFolder(dir)).filter((name) => name.endsWith(".webp")).length, 1);
});

/** A card for page(), as review.js makes them with a format: `paths` are copies of one image. */
function copyCard(paths, { original = 100000, compressed = 20000, score = 88, sameFormat = { compressed: 40000, outcome: "hit", score: 88 }, type = "png", target } = {}) {
  paths = [paths].flat();
  const base = ["hit", "exact", "lossless"].includes(sameFormat.outcome) && sameFormat.compressed < original ? sameFormat.compressed : original;
  return { paths, before: paths[0], after: "x.webp", width: 10, height: 10, alpha: false, original, compressed, outcome: "hit", score, type, sameFormat, base, ...(target === undefined ? {} : { target }), total: { original: original * paths.length, compressed: compressed * paths.length } };
}

const model = (cards, more = {}) => ({ cwd: "/project", date: "2026-11-12 12:00", target: undefined, cards, format: "webp", ...more });

test("a page of copies says what each image's own shrink would do, as the command does, at a target given or at several", () => {
  const cards = [
    copyCard("a.png", { sameFormat: { compressed: 60000, outcome: "miss", score: 78 }, target: 80 }),
    copyCard("b.jpg", { type: "jpeg", sameFormat: { compressed: 85000, outcome: "hit", score: 81 }, target: 80 }),
    copyCard("c.png", { sameFormat: { compressed: 100000, outcome: "original", score: 100 }, target: 80 }),
  ];
  const one = parse(spaced(page(model(cards, { target: 80 }), "linux")));
  assert.deepEqual(one.cards.map(({ facts }) => facts.replace(/^.*Quality 88\/100: looks the same side by side · /, "")), [
    "As PNG, no smaller file reaches --target 80",
    "Shrunk as JPEG at the same quality: 85 kB",
    "As PNG, slimdeer can't make it smaller",
  ]);
  assert.equal(one.command, "npx oxlint-plugin-slimdeer a.png b.jpg c.png --target 80 --format webp");
  // at several targets, as a lint's list may give them: each card names its own, then its shrink
  const mixed = [copyCard("a.png", { target: 70 }), copyCard("b.png")];
  const text = spaced(page(model(mixed), "linux"));
  assert.ok(text.includes("<div><dt>Targets</dt><dd>each image at the target the lint flagged it at: quality 70 for 1 image, automatic (the quality of its PNG or JPEG shrink, never below quality 70) for 1 image</dd></div>"), text);
  assert.deepEqual(parse(text).cards.map(({ facts }) => facts.replace(/^.*side by side · /, "")), ["--target 70 · Shrunk as PNG at the same quality: 40 kB", "automatic target · Shrunk as PNG at the same quality: 40 kB"]);
  const { data, script } = parse(text);
  assert.deepEqual(JSON.parse(JSON.stringify(run(script).commands(data, [true, true]).lines)), [shrinkCommand(["a.png"], 70, "linux", "webp").text, shrinkCommand(["b.png"], undefined, "linux", "webp").text]);
  assert.ok(text.includes(`<p class="writes">They write each one as a new .webp file next to its original, which stays, then list the lines of code that still name the originals.</p>`));
});

test("on Windows, a page of copies quotes a path as the terminal does, through PowerShell, and ends each command with --format", () => {
  const paths = ["public/a.png", "public/50% off.png"];
  for (const platform of ["linux", "win32"]) {
    const { data, script } = parse(page(model(paths.map((path) => copyCard(path))), platform));
    const { lines, shell } = run(script).commands(data, [true, true]);
    const expected = shrinkCommand(paths, undefined, platform, "webp");
    assert.deepEqual([...lines], [expected.text]);
    assert.equal(shell, expected.shell);
  }
  assert.equal(parse(page(model(paths.map((path) => copyCard(path))), "win32")).data.images[1].powershell, true);
});

test("an AVIF page's script covers an after image it can't show and says why under it, one that failed before it ran included; a WebP page has none", () => {
  const avif = parse(page(model([copyCard("a.png"), copyCard("b.png")], { format: "avif" })));
  assert.doesNotMatch(parse(page(model([copyCard("a.png")]))).script, /unshown|can't show AVIF/);
  // a stand-in for a browser: the first image failed already, the second fails later, the third loaded
  const covered = [];
  const said = [];
  const image = (name, complete, naturalWidth = 0) => {
    const on = {};
    return { complete, naturalWidth, on, addEventListener: (type, listener) => (on[type] = listener), replaceWith: (cover) => covered.push([name, cover.className]), closest: () => ({ append: (note) => said.push([name, note.className, note.textContent]) }) };
  };
  const images = [image("failed", true), image("later", false), image("loaded", true, 32)];
  const context = run(avif.script);
  context.document = { querySelectorAll: (selector) => (selector === "img.after" ? images : []), createElement: () => ({}) };
  context.unshown("This browser can't show AVIF (Safari needs 16.4 or later).");
  assert.deepEqual(covered, [["failed", "after unshown"]]);
  images[1].on.error();
  assert.deepEqual(covered, [["failed", "after unshown"], ["later", "after unshown"]]);
  assert.deepEqual(said, [
    ["failed", "unshown-note", "This browser can't show AVIF (Safari needs 16.4 or later)."],
    ["later", "unshown-note", "This browser can't show AVIF (Safari needs 16.4 or later)."],
  ]);
});

test("the page names copies that wouldn't save enough by the thresholds they were measured with, and with none, that they'd be no smaller", () => {
  const notWorthIt = [{ path: "public/a.png", original: 50000, compressed: 29000, base: 31000, sameFormat: { compressed: 31000, outcome: "hit", score: 85 } }];
  const at = (settings, more = {}) => spaced(page(model([copyCard("b.png")], { notWorthIt, settings, ...more })));
  assert.ok(at({}).includes("<summary>1 image isn&#39;t here: as WebP it would save less than 4.1 kB or 10% more than shrinking it in place.</summary>\n<ul><li><code>public/a.png</code>: 29 kB as WebP, 31 kB shrunk in place</li></ul>\n<p>To shrink it in place instead, run:</p>\n<pre>npx oxlint-plugin-slimdeer public/a.png</pre>"));
  assert.ok(at({ minSavedBytes: 0, minSavedPercent: 0 }).includes("<summary>1 image isn&#39;t here: as WebP it would be no smaller than shrinking it in place.</summary>"));
  // at a target given, the command that shrinks it in place keeps it
  assert.ok(at({}, { target: 80 }).includes("<pre>npx oxlint-plugin-slimdeer public/a.png --target 80</pre>"));
  // a copy bigger than its shrink saves nothing at all; and one whose shrink leaves it as it is has no shrunk file
  const bigger = [{ path: "public/d.png", original: 50000, compressed: 32000, base: 31000, sameFormat: { compressed: 31000, outcome: "hit", score: 85 } }];
  assert.ok(spaced(page(model([copyCard("b.png")], { notWorthIt: bigger }))).includes("<summary>1 image isn&#39;t here: as WebP it would be no smaller than shrinking it in place.</summary>\n<ul><li><code>public/d.png</code>: 32 kB as WebP, 31 kB shrunk in place</li></ul>"));
  const kept = [{ path: "public/e.png", original: 6000, compressed: 3000, base: 6000, sameFormat: { compressed: 5900, outcome: "miss", score: 78 }, target: 80 }];
  assert.ok(spaced(page(model([copyCard("b.png", { target: 80 })], { target: 80, notWorthIt: kept }))).includes("<li><code>public/e.png</code>: 3.0 kB as WebP, 6.0 kB as it is</li>"));
});

test("the page of copies names what has no quality to match, what has its copy already, and what missed, as --check says it", () => {
  const declined = [{ path: "public/fade.png", original: 40000, score: 64.2 }];
  const existing = [{ path: "public/hero.png", output: "/project/public/hero.avif", base: 30000, compressed: 9000 }];
  // two misses at one quality asked: said once, with as many decimals as the best of them needs
  const missed = [{ path: "public/m2.png", type: "png", original: 30000, score: 80.2, equal: 86.4 }, { path: "public/m1.png", type: "png", original: 40000, score: 86.1, equal: 86.4 }];
  const text = spaced(page(model([copyCard("b.png")], { format: "avif", declined, existing, missed, settings: { format: "avif" } })));
  assert.ok(text.includes(`<summary>1 image isn&#39;t here: shrunk in place it doesn&#39;t reach quality 70, so there is no quality to match.</summary>\n<ul><li><code>public/fade.png</code>: best quality 64/100</li></ul>\n<p>To choose one, run:</p>\n<pre>npx oxlint-plugin-slimdeer --check public/fade.png --target 80 --format avif</pre>`), text);
  assert.ok(text.includes(`<summary>1 image already has an AVIF file next to it, which the command never replaces, so it isn&#39;t here.</summary>`), text);
  assert.ok(text.includes(`<summary>2 images aren&#39;t here: as AVIF, no file reaches quality 86.4/100, the PNG&#39;s.</summary>\n<ul><li><code>public/m1.png</code>: best quality 86.1/100</li><li><code>public/m2.png</code>: best quality 80/100</li></ul>`), text);
});
