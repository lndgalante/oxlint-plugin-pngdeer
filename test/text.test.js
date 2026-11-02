import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { marked } from "../src/marker.js";
import { checkCommand, quote, shrinkCommand } from "../src/text.js";
import { project } from "./helpers.js";

test("Windows fix commands use literal PowerShell arguments when a path needs quoting", () => {
  assert.equal(quote("$name's %PATH% `image.png", "win32"), "'$name''s %PATH% `image.png'");
  assert.equal(quote("@image.png", "win32"), "'@image.png'");
  assert.equal(quote("left‘right’low‚reversed‛.png", "win32"), "'left‘‘right’’low‚‚reversed‛‛.png'");
  assert.equal(quote("one,two.png", "win32"), "'one,two.png'");
  assert.equal(shrinkCommand(["public/hero.png"], 90, "win32").text, "npx oxlint-plugin-pngdeer public/hero.png --target 90");
  assert.equal(shrinkCommand(["-image.png"], undefined, "win32").text, "npx oxlint-plugin-pngdeer ./-image.png");
  const command = shrinkCommand(["public/$name's %PATH%.png"], 90, "win32");
  assert.equal(command.shell, " in PowerShell");
  assert.match(command.text, /^& /);
  assert.match(command.text, / 'public\/\$name''s %PATH%\.png' --target 90$/);
  assert.doesNotMatch(command.text, /npx/);
});

test("the command that checks skipped packages picks its shell the same way", () => {
  assert.deepEqual(checkCommand(["packages/docs", "packages/web"], {}, "win32"), { text: "npx oxlint-plugin-pngdeer --check packages/docs packages/web", shell: "" });
  const command = checkCommand(["packages/my app"], { target: 90 }, "win32");
  assert.equal(command.shell, " in PowerShell");
  assert.match(command.text, /^& .+ --check 'packages\/my app' --target 90$/);
  assert.doesNotMatch(command.text, /npx/);
  assert.equal(checkCommand(["packages/my app"], {}, "linux").text, "npx oxlint-plugin-pngdeer --check 'packages/my app'");
  // options at their defaults are left out; values are quoted as values, not as paths
  const options = { exclude: ["**/fixtures/**", "-old.png"], cacheDir: ".pngdeer", minSavedBytes: 4096, minSavedPercent: 30 };
  assert.equal(checkCommand(["packages/web"], options, "linux").text, "npx oxlint-plugin-pngdeer --check packages/web --exclude '**/fixtures/**' --exclude -old.png --cache-dir .pngdeer --min-saved-percent 30");
  // cmd.exe would keep the quotes, so a quoted pattern needs PowerShell
  assert.equal(checkCommand(["packages/web"], options, "win32").shell, " in PowerShell");
});

for (const shell of ["powershell.exe", "pwsh.exe"]) {
  test(`${shell}: generated Windows commands preserve shell metacharacters without evaluating them`, { skip: process.platform !== "win32" }, () => {
    const dir = project({ images: ["src/assets/crystal-ball.png"] });
    const file = "$(ni injected.txt) %PNGDEER_TEST% !bang! `tick & quote'‘’‚‛,comma.png";
    writeFileSync(join(dir, file), readFileSync(join(dir, "src/assets/crystal-ball.png")));
    const command = shrinkCommand([file]);
    const run = spawnSync(shell, ["-NoProfile", "-NonInteractive", "-Command", command.text], {
      cwd: dir,
      encoding: "utf8",
      env: { ...process.env, PNGDEER_TEST: "expanded" },
      timeout: 60_000,
    });
    assert.equal(run.status, 0, `${run.error ?? ""}\n${run.stderr}\n${run.stdout}`);
    assert.equal(marked(readFileSync(join(dir, file))), true);
    assert.equal(existsSync(join(dir, "injected.txt")), false);
  });
}
