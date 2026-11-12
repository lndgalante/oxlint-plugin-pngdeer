// The old word "pngdeer" may stay only where the package's history or its users' files need it:
// this test lists every other line, and every file name, that still has it.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const listed = spawnSync("git", ["ls-files", "-z"], { cwd: root, encoding: "buffer", maxBuffer: 64 * 1024 * 1024 });

const WHOLE_FILES = new Set([
  "CHANGELOG.md",
  "FINDINGS.md",
  "bench/README.md",
  "bench/TRIALS.md",
  "docs/releases/0.4.0.md",
  "docs/releases/0.5.0.md",
  "docs/showcase.md",
  "src/marker.js",
  "src/compat.js",
  "test/rename-compat.test.js",
  "test/compat.test.js",
  "test/legacy-stub.test.js",
  "test/naming.test.js",
]);
const OLD = /pngdeer/i;
// the mark's size, not a version like "pngdeer 0.5.0"
const MARK_OR_ENGINE = /pngdeer[_-]wasm|heydeer\/pngdeer|\bpngdeer (?:\d+(?!\.?\d)|<size>|<n>)/i;
const SAYS_FORMER = /formerly|former name|old name/i;

const kept = (file) => WHOLE_FILES.has(file) || file.startsWith("engine/") || file.startsWith("legacy/");

/** The lines of `lines` that say the old word where nothing allows it, as "file:line: text". */
function stray(file, lines) {
  if (kept(file)) return [];
  const found = [];
  const levels = []; // headings of the sections the line is in, outermost first: [{ level, old }]
  let fenced = false;
  lines.forEach((line, i) => {
    if (file.endsWith(".md")) {
      if (/^\s*(```|~~~)/.test(line)) fenced = !fenced;
      const heading = fenced ? null : /^(#{1,6})\s+(.*)$/.exec(line);
      if (heading) {
        while (levels.length && levels.at(-1).level >= heading[1].length) levels.pop();
        levels.push({ level: heading[1].length, old: OLD.test(heading[2]) });
      }
    }
    if (!OLD.test(line)) return;
    if (MARK_OR_ENGINE.test(line) || SAYS_FORMER.test(line)) return;
    if (file.endsWith(".md") && levels.some((section) => section.old)) return;
    if (file === "package.json" && /^"pngdeer",?$/.test(line.trim())) return;
    found.push(`${file}:${i + 1}: ${line.trim().slice(0, 120)}`);
  });
  return found;
}

test("the old name stays only where it is allowed", { skip: listed.status !== 0 && "git is not available here" }, () => {
  const strays = [];
  for (const file of listed.stdout.toString("utf8").split("\0").filter(Boolean)) {
    if (OLD.test(file) && !kept(file)) strays.push(`${file}: the old name in a file name`);
    let bytes;
    try {
      bytes = readFileSync(join(root, file));
    } catch {
      continue; // listed but not on disk
    }
    if (bytes.subarray(0, 8000).includes(0)) continue; // a binary file
    // a Windows checkout ends lines with CRLF, and "\r" would hide every Markdown heading
    strays.push(...stray(file, bytes.toString("utf8").split(/\r?\n/)));
  }
  assert.deepEqual(strays, [], `the old name where it must not stay:\n${strays.join("\n")}`);
});
