import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { marked } from "../src/marker.js";
import { checkCommand, printable, quote, reviewCommand, shrinkCommand, size, smaller } from "../src/text.js";
import { project } from "./helpers.js";

test("a size moves to the next unit when its rounding reaches 1000", () => {
  const cases = [
    [999, "999 B"], [1000, "1.0 kB"], [4096, "4.1 kB"], [9949, "9.9 kB"], [9960, "10 kB"], [10_000, "10 kB"],
    [999_499, "999 kB"], [999_500, "1.0 MB"], [999_999, "1.0 MB"], [8_164_066, "8.2 MB"],
    [999_949_999, "999.9 MB"], [999_950_000, "1.0 GB"], [1_234_567_890, "1.2 GB"],
  ];
  for (const [bytes, text] of cases) assert.equal(size(bytes), text, `${bytes}`);
});

test("a percentage says 100 only when nothing is left, and 0 only when nothing is saved", () => {
  assert.equal(smaller(100_000, 30_000), 70);
  assert.equal(smaller(100_000, 400), 99);
  assert.equal(smaller(100_000, 0), 100);
  assert.equal(smaller(100_000, 99_700), 1);
  assert.equal(smaller(100_000, 100_000), 0);
  assert.equal(smaller(100_000, 99_400), 1);
  assert.equal(smaller(100_000, 99_500), 1);
});

test("Windows fix commands use literal PowerShell arguments when a path needs quoting", () => {
  assert.equal(quote("$name's %PATH% `image.png", "win32"), "'$name''s %PATH% `image.png'");
  assert.equal(quote("@image.png", "win32"), "'@image.png'");
  // only a leading @ splats: React Native's scale variants run from cmd.exe and PowerShell alike
  assert.deepEqual(shrinkCommand(["assets/icon@3x.png"], undefined, "win32"), { text: "npx oxlint-plugin-slimdeer assets/icon@3x.png", shell: "" });
  assert.equal(quote("left‘right’low‚reversed‛.png", "win32"), "'left‘‘right’’low‚‚reversed‛‛.png'");
  assert.equal(quote("one,two.png", "win32"), "'one,two.png'");
  assert.equal(shrinkCommand(["public/hero.png"], 90, "win32").text, "npx oxlint-plugin-slimdeer public/hero.png --target 90");
  assert.equal(shrinkCommand(["-image.png"], undefined, "win32").text, "npx oxlint-plugin-slimdeer ./-image.png");
  const command = shrinkCommand(["public/$name's %PATH%.png"], 90, "win32");
  assert.equal(command.shell, " in PowerShell");
  assert.match(command.text, /^& /);
  assert.match(command.text, / 'public\/\$name''s %PATH%\.png' --target 90$/);
  assert.doesNotMatch(command.text, /npx/);
});

test("the --check command it prints picks its shell the same way", () => {
  assert.deepEqual(checkCommand(["packages/docs", "packages/web"], {}, "win32"), { text: "npx oxlint-plugin-slimdeer --check packages/docs packages/web", shell: "" });
  const command = checkCommand(["packages/my app"], { target: 90 }, "win32");
  assert.equal(command.shell, " in PowerShell");
  assert.match(command.text, /^& .+ --check 'packages\/my app' --target 90$/);
  assert.doesNotMatch(command.text, /npx/);
  assert.equal(checkCommand(["packages/my app"], {}, "linux").text, "npx oxlint-plugin-slimdeer --check 'packages/my app'");
  // options at their defaults are left out; values are quoted as values, not as paths
  const options = { exclude: ["**/fixtures/**", "-old.png"], cacheDir: ".slimdeer", minSavedBytes: 4096, minSavedPercent: 30 };
  assert.equal(checkCommand(["packages/web"], options, "linux").text, "npx oxlint-plugin-slimdeer --check packages/web --exclude '**/fixtures/**' --exclude -old.png --cache-dir .slimdeer --min-saved-percent 30");
  // cmd.exe would keep the quotes, so a quoted pattern needs PowerShell
  assert.equal(checkCommand(["packages/web"], options, "win32").shell, " in PowerShell");
});

test("on Windows, paths and patterns typed with backslashes are printed with forward slashes", () => {
  // so cmd.exe runs them too, and no quoted one ends in a backslash, which Windows PowerShell 5.1 garbles
  assert.deepEqual(checkCommand(["public\\images"], { exclude: ["src\\legacy"], cacheDir: ".cache\\slimdeer" }, "win32"), { text: "npx oxlint-plugin-slimdeer --check public/images --exclude src/legacy --cache-dir .cache/slimdeer", shell: "" });
  assert.match(reviewCommand([".\\my images\\"], {}, "win32").text, / --review '\.\/my images\/'$/);
  // and in a command printed there for a POSIX shell (a Windows runner's job summary); elsewhere a
  // backslash is part of a name
  const platform = Object.getOwnPropertyDescriptor(process, "platform");
  for (const [running, command] of [["win32", "npx oxlint-plugin-slimdeer --review apps/web --cache-dir .cache/slimdeer"], ["linux", "npx oxlint-plugin-slimdeer --review 'apps\\web' --cache-dir '.cache\\slimdeer'"]]) {
    Object.defineProperty(process, "platform", { ...platform, value: running });
    try {
      assert.equal(reviewCommand(["apps\\web"], { cacheDir: ".cache\\slimdeer" }, "linux").text, command);
    } finally {
      Object.defineProperty(process, "platform", platform);
    }
  }
});

test("the --review command it prints takes the paths and options as the --check one does", () => {
  const options = { exclude: ["**/fixtures/**"], cacheDir: ".slimdeer", minSavedBytes: 1000, minSavedPercent: 10, target: 80 };
  assert.equal(reviewCommand(["public", "src"], options, "linux").text, "npx oxlint-plugin-slimdeer --review public src --exclude '**/fixtures/**' --cache-dir .slimdeer --min-saved-bytes 1000 --target 80");
  assert.deepEqual(reviewCommand([], {}, "linux"), { text: "npx oxlint-plugin-slimdeer --review", shell: "" });
  const windows = reviewCommand(["my app"], {}, "win32");
  assert.equal(windows.shell, " in PowerShell");
  assert.match(windows.text, /^& .+ --review 'my app'$/);
});

test("a line for a terminal shows each control character as one replacement character", () => {
  assert.equal(printable("public/a\x1b[31mred\x07\nline.png: ok"), "public/a\uFFFD[31mred\uFFFD\uFFFDline.png: ok");
  assert.equal(printable("tab\there"), "tab\uFFFDhere");
  assert.equal(printable("café → 首页.png"), "café → 首页.png");
});

test("a name's control characters go in a command as escapes, never as the U+FFFD a line shows", () => {
  // printed as U+FFFD, the command would name another file, maybe one left out on purpose
  assert.equal(quote("public/logo\nx.png", "linux"), "public/logo$'\\x0a'x.png");
  // a run of them in one escape, a C1 control as its two UTF-8 bytes, and the rest quoted as usual
  assert.equal(quote("-\x1b[31m\x07\u0085.png", "darwin"), "./-$'\\x1b''[31m'$'\\x07\\xc2\\x85'.png");
  const command = shrinkCommand(["public/it's\n.png"], 90, "linux").text;
  assert.equal(command, "npx oxlint-plugin-slimdeer 'public/it'\\''s'$'\\x0a'.png --target 90");
  assert.equal(printable(command), command);
  // PowerShell and cmd.exe read no $'..' (NTFS allows DEL and C1 controls in a name)
  assert.doesNotMatch(quote("a\x7f\u0085.png", "win32"), /\$'/);
});

// the shells people paste a command into; -f: zsh without the user's startup files
for (const [shell, ...flags] of [["bash"], ["zsh", "-f"]]) {
  const skip = process.platform === "win32" ? "commands on Windows are for PowerShell" : spawnSync(shell, [...flags, "-c", ":"]).error && `no ${shell} here`;
  test(`${shell} reads a quoted name with control characters back as that name`, { skip }, () => {
    // zsh reads a word's leading = as a command's path (=x.png: "x.png not found"), and no other =
    for (const name of ["public/a\x1b[31mred\x07\nline.png", "-\x7f\u0085.png", "caf\u00e9 \t$HOME`x`.png", "=x.png", "a=b,c@2x.png"]) {
      const run = spawnSync(shell, [...flags, "-c", `printf %s ${quote(name, process.platform)}`], { encoding: "utf8" });
      assert.equal(run.stdout, name.startsWith("-") ? `./${name}` : name);
    }
  });
}

for (const shell of ["powershell.exe", "pwsh.exe"]) {
  test(`${shell}: generated Windows commands preserve shell metacharacters without evaluating them`, { skip: process.platform !== "win32" }, () => {
    const dir = project({ images: ["src/assets/crystal-ball.png"] });
    const file = "$(ni injected.txt) %SLIMDEER_TEST% !bang! `tick & quote'‘’‚‛,comma.png";
    writeFileSync(join(dir, file), readFileSync(join(dir, "src/assets/crystal-ball.png")));
    const command = shrinkCommand([file]);
    const run = spawnSync(shell, ["-NoProfile", "-NonInteractive", "-Command", command.text], {
      cwd: dir,
      encoding: "utf8",
      env: { ...process.env, SLIMDEER_TEST: "expanded" },
      timeout: 60_000,
    });
    assert.equal(run.status, 0, `${run.error ?? ""}\n${run.stderr}\n${run.stdout}`);
    assert.equal(marked(readFileSync(join(dir, file))), true);
    assert.equal(existsSync(join(dir, "injected.txt")), false);
  });
}
