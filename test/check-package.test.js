// scripts/check-package.js starts npm's own script with node, so only npm can run it.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { test } from "node:test";
import { plugin } from "./helpers.js";

test("check:package under pnpm or bun says to use npm", () => {
  for (const execpath of ["/opt/homebrew/bin/pnpm", "/home/me/.bun/bin/bun", undefined]) {
    const run = spawnSync(process.execPath, [join(plugin, "scripts", "check-package.js")], { env: { ...process.env, npm_execpath: execpath }, encoding: "utf8", timeout: 60_000 });
    assert.equal(run.status, 1, run.stderr);
    assert.match(run.stderr, /Run this check with npm: npm run check:package/);
  }
});
