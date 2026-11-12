// The command, npx oxlint-plugin-pngdeer.
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { chmodSync, copyFileSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { cacheDir } from "../src/cache.js";
import { marked } from "../src/marker.js";
import { fade, handled, plugin, pngdeer, project } from "./helpers.js";

test("makes several images smaller in place, and marks them", () => {
  const dir = project({ images: ["src/assets/crystal-ball.png", "public/photo.jpg"] });
  const run = pngdeer(dir, "src/assets/crystal-ball.png", "public/photo.jpg");
  assert.equal(run.status, 0, run.stderr);
  // several images run in parallel, so lines come in the order they finish
  assert.match(run.stdout, /^\[[12]\/2\] src\/assets\/crystal-ball\.png: 35 kB → 11 kB \(68% smaller, quality 87\/100: looks the same side by side\)$/m);
  assert.match(run.stdout, /^\[[12]\/2\] public\/photo\.jpg: 235 kB → 85 kB \(64% smaller, quality 76\/100: looks close, with differences you might spot side by side\)$/m);
  assert.match(run.stderr, /^pngdeer: 2 images, 271 kB → 96 kB \(174 kB smaller\)\. Lint again to check\.$/m);
  assert.equal(marked(readFileSync(join(dir, "public/photo.jpg"))), true);
  assert.match(pngdeer(dir, "public/photo.jpg").stdout, /^public\/photo\.jpg: already pngdeer's; left as is$/m);
});

test("-o writes elsewhere and leaves the image alone", () => {
  const dir = project({ images: ["src/assets/crystal-ball.png"] });
  const before = readFileSync(join(dir, "src/assets/crystal-ball.png"));
  const run = pngdeer(dir, "src/assets/crystal-ball.png", "-o", "smaller.png");
  assert.equal(run.status, 0, run.stderr);
  assert.match(run.stdout, /^src\/assets\/crystal-ball\.png → smaller\.png: 35 kB → 11 kB /m);
  assert.deepEqual(readFileSync(join(dir, "src/assets/crystal-ball.png")), before);
  assert.equal(marked(readFileSync(join(dir, "smaller.png"))), true);
});

test("-o naming a folder asks for a file before compressing anything", () => {
  const dir = project({ images: ["src/assets/crystal-ball.png"] });
  const before = readFileSync(join(dir, "src/assets/crystal-ball.png"));
  mkdirSync(join(dir, "out"));
  const run = pngdeer(dir, "src/assets/crystal-ball.png", "-o", "out");
  assert.equal(run.status, 2);
  assert.match(run.stderr, /^oxlint-plugin-pngdeer: -o out is a folder: give the file to write, like -o out[\\/]crystal-ball\.png$/m);
  assert.deepEqual(readdirSync(join(dir, "out")), []);
  // the image's own folder: the same name would write over it, so no example
  const own = pngdeer(dir, "src/assets/crystal-ball.png", "-o", "src/assets/");
  assert.equal(own.status, 2);
  assert.match(own.stderr, /^oxlint-plugin-pngdeer: -o src\/assets\/ is a folder: give the file to write$/m);
  // the same folder spelled in another case, or through a link, is still the image's own
  const spellings = [existsSync(join(dir, "SRC/Assets")) ? "SRC/Assets" : null];
  try {
    symlinkSync(join(dir, "src/assets"), join(dir, "assets-link"), "junction");
    spellings.push("assets-link");
  } catch (error) {
    if (process.platform !== "win32") throw error;
  }
  for (const folder of spellings.filter(Boolean)) {
    assert.match(pngdeer(dir, "src/assets/crystal-ball.png", "-o", folder).stderr, new RegExp(`^oxlint-plugin-pngdeer: -o ${folder} is a folder: give the file to write$`, "m"));
  }
  assert.deepEqual(readFileSync(join(dir, "src/assets/crystal-ball.png")), before);
  // an example to paste, quoted
  mkdirSync(join(dir, "my out"));
  assert.match(pngdeer(dir, "src/assets/crystal-ball.png", "-o", "my out").stderr, /^oxlint-plugin-pngdeer: -o my out is a folder: give the file to write, like -o 'my out\/crystal-ball\.png'$/m);
});

test("-o naming the image itself, in another spelling or through a link, writes nothing", () => {
  const dir = project({ images: ["src/assets/crystal-ball.png"] });
  const before = readFileSync(join(dir, "src/assets/crystal-ball.png"));
  // another letter case is the same file on macOS and Windows
  const spellings = ["./src/assets/crystal-ball.png", existsSync(join(dir, "src/assets/Crystal-Ball.PNG")) ? "src/assets/Crystal-Ball.PNG" : null];
  try {
    symlinkSync(join(dir, "src/assets/crystal-ball.png"), join(dir, "ball-link.png"));
    spellings.push("ball-link.png");
  } catch (error) {
    if (process.platform !== "win32") throw error;
  }
  for (const out of spellings.filter(Boolean)) {
    const run = pngdeer(dir, "src/assets/crystal-ball.png", "-o", out);
    assert.equal(run.status, 2, `-o ${out}: ${run.stdout}`);
    assert.match(run.stderr, new RegExp(`^oxlint-plugin-pngdeer: -o ${out.replaceAll(".", "\\.")} is src/assets/crystal-ball\\.png itself: give another name, or leave out -o to shrink it in place$`, "m"));
  }
  assert.deepEqual(readFileSync(join(dir, "src/assets/crystal-ball.png")), before);
});

test("a target it can't reach leaves the file as it was", () => {
  const dir = project({ images: ["src/assets/crystal-ball.png"] });
  const before = readFileSync(join(dir, "src/assets/crystal-ball.png"));
  const run = pngdeer(dir, "src/assets/crystal-ball.png", "--target", "95");
  assert.equal(run.status, 0);
  assert.match(run.stdout, /no smaller file reaches --target 95 \(the best reaches quality 88\/100\); left as is$/m);
  assert.deepEqual(readFileSync(join(dir, "src/assets/crystal-ball.png")), before);
});

test("the best quality a missed target names is below that target", () => {
  // diagram.png's best at --target 91 scores 90.51, which rounded would be the very target it missed
  const dir = project({ images: ["src/assets/diagram.png"] });
  const run = pngdeer(dir, "src/assets/diagram.png", "--target", "91", "-o", "diagram.preview.png");
  assert.equal(run.status, 0, run.stderr);
  assert.match(run.stdout, /: no smaller file reaches --target 91 \(the best reaches quality 90\/100\); copied as is$/m);
});

test("a file it can't shrink stays as it was, unmarked", () => {
  const dir = project({ images: ["src/assets/heart.png"] });
  const before = readFileSync(join(dir, "src/assets/heart.png"));
  const run = pngdeer(dir, "src/assets/heart.png");
  assert.equal(run.status, 0);
  assert.match(run.stdout, /pngdeer can't make it smaller; left as is$/m);
  assert.deepEqual(readFileSync(join(dir, "src/assets/heart.png")), before);
  assert.equal(marked(before), false);
});

test("a read-only image is left as it is", (t) => {
  if (process.platform === "win32" || process.getuid?.() === 0) return t.skip("read-only means nothing to root, and Windows refuses on its own");
  const dir = project({ images: ["src/assets/crystal-ball.png"] });
  const file = join(dir, "src/assets/crystal-ball.png");
  const before = readFileSync(file);
  chmodSync(file, 0o444);
  const run = pngdeer(dir, "src/assets/crystal-ball.png");
  assert.equal(run.status, 1, run.stdout);
  assert.match(run.stderr, /^src\/assets\/crystal-ball\.png: permission denied$/m);
  assert.deepEqual(readFileSync(file), before);
});

test("with -o, an image it leaves as it was is copied, and the line says so", () => {
  const dir = project({ images: ["src/assets/heart.png"] });
  const run = pngdeer(dir, "src/assets/heart.png", "-o", "heart.preview.png");
  assert.equal(run.status, 0, run.stderr);
  assert.match(run.stdout, /^src\/assets\/heart\.png → heart\.preview\.png: pngdeer can't make it smaller; copied as is$/m);
  assert.deepEqual(readFileSync(join(dir, "heart.preview.png")), readFileSync(join(dir, "src/assets/heart.png")));
});

test("errors name the file, say why, and the others still get done", () => {
  const dir = project({ files: { "fade.png": fade() }, images: ["src/assets/crystal-ball.png"] });
  const run = pngdeer(dir, "missing.png", "fade.png", "src/assets/crystal-ball.png", "--target", "90");
  assert.equal(run.status, 1);
  assert.match(run.stderr, /^\[1\/3\] missing\.png: no such file or folder$/m);
  assert.match(run.stderr, /^\[[23]\/3\] fade\.png: pngdeer couldn't compress this image: unreachable/m);
  assert.deepEqual(handled(run.stdout), ["src/assets/crystal-ball.png"]);
});

test("arguments are checked: a mistake is one line, and where the help is", () => {
  const { version } = JSON.parse(readFileSync(join(plugin, "package.json"), "utf8"));
  assert.equal(pngdeer(plugin, "--version").stdout.trim(), version);
  assert.match(pngdeer(plugin, "--help").stdout, /^usage: oxlint-plugin-pngdeer IMAGE\.\.\./);
  // run bare, it says what it does
  const none = pngdeer(plugin);
  assert.equal(none.status, 2);
  assert.match(none.stderr, /no image given[\s\S]*usage:/);
  const cases = [
    [["a.png", "--target", "200"], "--target must be auto or a number from 0 to 100, not 200"],
    [["a.png", "b.png", "-o", "c.png"], "-o takes one image; without it, each image is written in place"],
    [["a.png", "--frobnicate"], "unknown option --frobnicate"],
    [["--target", "80"], "no image given"],
  ];
  for (const [args, message] of cases) {
    const run = pngdeer(plugin, ...args);
    assert.equal(run.status, 2);
    // the mistake stays on screen: no usage after it
    assert.equal(run.stderr, `oxlint-plugin-pngdeer: ${message}\nRun npx oxlint-plugin-pngdeer --help to see every option.\n`);
  }
});

/** A pattern for the line the command prints for the mistake `message`, word for word. */
function mistake(message) {
  return new RegExp(`^oxlint-plugin-pngdeer: ${message.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "m");
}

test("an option's value can follow an = sign", () => {
  const dir = project({ images: ["src/assets/crystal-ball.png"] });
  const before = readFileSync(join(dir, "src/assets/crystal-ball.png"));
  const run = pngdeer(dir, "--check", "src", "--target=95", "--min-saved-bytes=1000", "--min-saved-percent=0", "--exclude=public/**", "--cache-dir=.pngdeer");
  assert.equal(run.status, 0, run.stderr);
  // the values took: measured at 95 into .pngdeer, where nothing reaches 95
  assert.match(run.stdout, /^pngdeer: checked 1 image; 1 measured, 0 cached, 0 skipped \(already optimized or below 1\.0 kB\), 0 errors\.$/m);
  assert.equal(readdirSync(join(dir, ".pngdeer")).length > 0, true);
  // = keeps the checks a value gets the other way, and an option without a value says so
  const cases = [
    [["a.png", "--target="], "--target needs a value"],
    [["a.png", "--target=200"], "--target must be auto or a number from 0 to 100, not 200"],
    [["--check", "--exclude="], "--exclude needs a value"],
    // the same words for an empty value the other way, as a script's unset variable gives it (-o "$OUT")
    [["--check", "--exclude", " "], "--exclude needs a value"],
    [["a.png", "-o", ""], "-o needs a value"],
    [["a.png", "--target", ""], "--target needs a value"],
    [["--check", "--min-saved-bytes", ""], "--min-saved-bytes needs a value"],
    [["--check", "--min-saved-percent=101"], "--min-saved-percent must be a number from 0 to 100, not 101"],
    [["--check=src"], "--check takes no value"],
    [["--check", "--json=true"], "--json takes no value"],
    [["a.png", "--frobnicate=1"], "unknown option --frobnicate=1"],
  ];
  for (const [args, message] of cases) assert.match(pngdeer(dir, ...args).stderr, mistake(message), args.join(" "));
  assert.equal(pngdeer(dir, "src/assets/crystal-ball.png", "--target=auto", "-o", "out.png").status, 0);
  assert.deepEqual(readFileSync(join(dir, "src/assets/crystal-ball.png")), before);
});

test("--json, --review and --open go only with what they belong to", () => {
  const dir = project({ images: ["src/assets/crystal-ball.png"] });
  const before = readFileSync(join(dir, "src/assets/crystal-ball.png"));
  const cases = [
    [["src/assets/crystal-ball.png", "--json"], "--json requires --check"],
    [["--flagged", "--json"], "--json requires --check"],
    [["--review", "--check"], "--review cannot be combined with --check, -o or --json"],
    [["--review", "--json"], "--review cannot be combined with --check, -o or --json"],
    [["--review", "src/assets/crystal-ball.png", "-o", "x.png"], "--review cannot be combined with --check, -o or --json"],
    [["--check", "--open"], "--open requires --review"],
    [["src/assets/crystal-ball.png", "--open"], "--open requires --review"],
    [["src/assets/crystal-ball.png", "--exclude", "public"], "--min-saved-bytes, --min-saved-percent, --exclude and --cache-dir require --check or --review"],
    // --review --flagged shows what the lint chose, by the lint's own thresholds and exclusions
    [["--review", "--flagged", "--check"], "--review cannot be combined with --check, -o or --json"],
    [["--review", "--flagged", "--json"], "--review cannot be combined with --check, -o or --json"],
    [["--flagged", "--review", "-o", "x.png"], "--review cannot be combined with --check, -o or --json"],
    [["--review", "--flagged", "src/assets/crystal-ball.png"], "--flagged takes no images and no -o"],
    [["--review", "--flagged", "--exclude", "public"], "--review --flagged cannot be combined with --exclude, --min-saved-bytes or --min-saved-percent"],
    [["--review", "--flagged", "--min-saved-bytes=100"], "--review --flagged cannot be combined with --exclude, --min-saved-bytes or --min-saved-percent"],
    [["--review", "--flagged", "--min-saved-percent", "5"], "--review --flagged cannot be combined with --exclude, --min-saved-bytes or --min-saved-percent"],
  ];
  for (const [args, message] of cases) {
    const run = pngdeer(dir, ...args);
    assert.equal(run.status, 2, args.join(" "));
    assert.match(run.stderr, mistake(message), args.join(" "));
  }
  assert.deepEqual(readFileSync(join(dir, "src/assets/crystal-ball.png")), before);
});

test("the help covers every mode and option in 100 columns", () => {
  const help = pngdeer(plugin, "--help").stdout;
  for (const option of ["--check", "--json", "--review", "--open", "--flagged", "-o OUT", "--target", "--min-saved-bytes", "--min-saved-percent", "--exclude", "--cache-dir", "--target=80"]) assert.ok(help.includes(option), option);
  assert.match(help, /looks about the same/);
  assert.match(help, /warms the lint's cache/);
  // a page that ticks every image would offer to shrink what the rule's exclude keeps
  assert.match(help, /\nLike --check, it reads no linter configuration; with --flagged, it shows what the lint flagged\.\n/);
  assert.ok(help.split("\n").every((line) => line.length <= 100), help);
  assert.ok(help.split("\n").length <= 45);
});

/** The command's run in `cwd` with its stdout closed before it writes (with `both`, its stderr too), as `| head -1` closes it early. */
async function cutShort(cwd, args, { both = false } = {}) {
  const child = spawn(process.execPath, [join(plugin, "bin", "pngdeer.js"), ...args], { cwd, stdio: ["ignore", "pipe", "pipe"] });
  child.stdout.destroy();
  let stderr = "";
  if (both) child.stderr.destroy();
  else child.stderr.on("data", (chunk) => (stderr += chunk));
  const [status] = await once(child, "close");
  return { status, stderr };
}

test("a reader that stops reading stops the printing, not the work", async () => {
  const dir = project({ images: ["src/assets/crystal-ball.png", "public/photo.jpg", "public/unused-fire.png"] });
  const images = ["src/assets/crystal-ball.png", "public/photo.jpg", "public/unused-fire.png"];
  const run = await cutShort(dir, images);
  assert.equal(run.status, 0, run.stderr);
  assert.doesNotMatch(run.stderr, /EPIPE|Unhandled/);
  // every image shrunk, and the total said where it can still be read
  for (const image of images) assert.equal(marked(readFileSync(join(dir, image))), true, image);
  assert.match(run.stderr, /^pngdeer: 3 images, .* smaller\)\. Lint again to check\.$/m);
  // --check, with both streams gone: the exit code still tells, and the cache is warm
  const other = project({ images: ["src/assets/crystal-ball.png"] });
  assert.equal((await cutShort(other, ["--check"], { both: true })).status, 1);
  assert.match(pngdeer(other, "--check").stdout, /1 cached/);
});

test("the same image named twice is shrunk once", () => {
  const dir = project({ images: ["src/assets/crystal-ball.png"] });
  const run = pngdeer(dir, "src/assets/crystal-ball.png", "./src/assets/crystal-ball.png");
  assert.equal(run.status, 0, run.stderr);
  assert.deepEqual(handled(run.stdout), ["src/assets/crystal-ball.png"]);
});

test("the same image named in another letter case is shrunk once", (t) => {
  const dir = project({ images: ["src/assets/crystal-ball.png"] });
  if (!existsSync(join(dir, "src/assets/Crystal-Ball.png"))) return t.skip("this file system tells letter case apart");
  const run = pngdeer(dir, "src/assets/crystal-ball.png", "src/assets/Crystal-Ball.png");
  assert.equal(run.status, 0, run.stderr);
  assert.deepEqual(handled(run.stdout), ["src/assets/crystal-ball.png"]);
});

test("check options reject mistakes before changing an image", () => {
  const dir = project({ images: ["src/assets/crystal-ball.png"] });
  const file = "src/assets/crystal-ball.png";
  const before = readFileSync(join(dir, file));
  const cases = [
    ["--check", file, "-o", "preview.png"],
    ["--check", "--flagged"],
    ["--check", "--min-saved-bytes", "-1"],
    ["--check", "--min-saved-bytes", "0.5"],
    ["--check", "--min-saved-percent", "101"],
    ["--check", "--min-saved-percent", "NaN"],
    ["--check", "--exclude", ""],
    ["--check", "--cache-dir"],
    [file, "--exclude", "public"],
    [file, "--min-saved-bytes", "4096"],
    [file, "--cache-dir", ".pngdeer"],
    [file, "-o", "--check"],
  ];
  for (const args of cases) {
    const run = pngdeer(dir, ...args);
    assert.equal(run.status, 2, `${args.join(" ")}\n${run.stderr}`);
    assert.match(run.stderr, /^oxlint-plugin-pngdeer: .*\nRun npx oxlint-plugin-pngdeer --help to see every option\.\n$/);
  }
  assert.deepEqual(readFileSync(join(dir, file)), before);
});

test("-- accepts image names starting with a hyphen", () => {
  const dir = project({ images: ["src/assets/crystal-ball.png"] });
  writeFileSync(join(dir, "-image.png"), readFileSync(join(dir, "src/assets/crystal-ball.png")));
  const run = pngdeer(dir, "--", "-image.png");
  assert.equal(run.status, 0, run.stderr);
  assert.equal(marked(readFileSync(join(dir, "-image.png"))), true);
});

test("shrinking through a symlink preserves the link and updates its target once", (t) => {
  const dir = project({ images: ["src/assets/crystal-ball.png"] });
  const source = join(dir, "src/assets/crystal-ball.png");
  const link = join(dir, "linked.png");
  try {
    symlinkSync(source, link);
  } catch (error) {
    if (process.platform === "win32" && error.code === "EPERM") return t.skip("symlinks require Windows Developer Mode");
    throw error;
  }
  const run = pngdeer(dir, "linked.png", "src/assets/crystal-ball.png");
  assert.equal(run.status, 0, run.stderr);
  assert.deepEqual(handled(run.stdout), ["linked.png"]);
  assert.equal(lstatSync(link).isSymbolicLink(), true);
  assert.equal(marked(readFileSync(source)), true);
});

test("a closed stderr while another lint holds the lock changes nothing but the printing", async () => {
  const dir = project({ images: ["src/assets/crystal-ball.png"] });
  const lock = join(cacheDir(dir), "measuring.lock");
  mkdirSync(cacheDir(dir), { recursive: true });
  // another live process holds it (this one), so the check says it waits, to a stderr that's gone
  writeFileSync(lock, `${process.pid} 0`);
  const run = cutShort(dir, ["--check"], { both: true });
  // then lets it go: the check measures, as it would have with stderr open
  const release = setTimeout(() => rmSync(lock, { force: true }), 1500);
  const { status } = await run;
  clearTimeout(release);
  assert.equal(status, 1);
  assert.match(pngdeer(dir, "--check").stdout, /1 cached/);
});

// Windows refuses control characters in file names
test("a file name's control characters reach no line the command or the lint prints", { skip: process.platform === "win32" }, () => {
  // an escape sequence that would turn the terminal red, a bell, and a line break
  const odd = "public/a\x1b[31mred\x07\nline.png";
  const shown = "public/a\uFFFD[31mred\uFFFD\uFFFDline.png";
  const bad = "public/b\x1b\x07\n.png";
  const code = 'export const bad = "/b\\x1b\\x07\\n.png";\nexport const odd = "/a\\x1b[31mred\\x07\\nline.png";\n';
  const dir = project({ images: ["src/assets/crystal-ball.png", "public/photo.jpg"], files: { [bad]: "not an image ".repeat(400), "src/App.jsx": code } });
  copyFileSync(join(dir, "src/assets/crystal-ball.png"), join(dir, odd));
  // whole lines, each control character one U+FFFD, and the name on the line it's on
  const clean = (run, ...names) => {
    const out = `${run.stdout}${run.stderr}`;
    assert.doesNotMatch(out.replaceAll("\n", ""), /\p{Cc}/u, out);
    for (const name of names) assert.ok(out.split("\n").some((line) => line.includes(name)), `${name} in\n${out}`);
    return out;
  };
  // in a command, each name as a POSIX shell reads it back: a U+FFFD there would name another file
  const typed = "public/a$'\\x1b''[31mred'$'\\x07\\x0a'line.png";
  // --check's rows, error, note and commands
  const check = pngdeer(dir, "--check", "public");
  assert.equal(check.status, 2);
  const checked = clean(check, `${shown}: could be`, "public/b\uFFFD\uFFFD\uFFFD.png: not a PNG or JPEG", "--exclude public/b$'\\x1b\\x07\\x0a'.png");
  const shrink = checked.match(/^pngdeer: to shrink them in place .*?, run: npx oxlint-plugin-pngdeer (.*)$/m)[1];
  assert.equal(shrink, `public/photo.jpg ${typed}`);
  // the review's lines and errors
  clean(pngdeer(dir, "--review", "public"), "public/b\uFFFD\uFFFD\uFFFD.png: not a PNG or JPEG", "pngdeer: 1 file named like an image");
  // the lint's warning for an image so named, with its command, and its line for an image it skips
  const lint = spawnSync(process.execPath, [join(plugin, "node_modules", "oxlint", "bin", "oxlint"), "--format", "unix"], { cwd: dir, encoding: "utf8" });
  assert.equal(lint.status, 0, lint.stderr);
  clean(lint, "a\uFFFD[31mred\uFFFD\uFFFDline.png could be", `Run: npx oxlint-plugin-pngdeer ${typed}`, "pngdeer: skipped public/b\uFFFD\uFFFD\uFFFD.png: not a PNG or JPEG");
  // the shrink's lines: several (from the command --check printed, as a shell runs it), one, and one that fails
  const printed = spawnSync("bash", ["-c", `"$0" "$1" ${shrink}`, process.execPath, join(plugin, "bin", "pngdeer.js")], { cwd: dir, encoding: "utf8", timeout: 300_000 });
  assert.equal(printed.status, 0, printed.stderr);
  clean(printed, `${shown}: 35 kB`);
  clean(pngdeer(dir, odd), `${shown}: already pngdeer's; left as is`);
  clean(pngdeer(dir, bad), "public/b\uFFFD\uFFFD\uFFFD.png: not a PNG or JPEG");
  // and a mistake in the arguments
  clean(pngdeer(dir, odd, "--frobnicate\x1b"), "unknown option --frobnicate\uFFFD");
});
