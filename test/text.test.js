import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { marked } from "../src/marker.js";
import { quote, shrinkCommand } from "../src/text.js";
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
