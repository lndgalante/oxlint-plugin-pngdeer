import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";
import { plugin, project } from "./helpers.js";

test("ESLint API workers run from node --input-type in both argument forms", () => {
  for (const args of [["--input-type=module"], ["--input-type", "module"]]) {
    const dir = project({
      images: ["src/assets/crystal-ball.png"],
      files: { "src/app.js": 'export const image = "./assets/crystal-ball.png";' },
    });
    const api = pathToFileURL(join(plugin, "node_modules/eslint/lib/api.js")).href;
    const script = `import { ESLint } from ${JSON.stringify(api)};
const results = await new ESLint({ cwd: ${JSON.stringify(dir)} }).lintFiles(["src/app.js"]);
console.log(JSON.stringify(results.flatMap((result) => result.messages)));
`;
    const run = spawnSync(process.execPath, [...args, "-e", script], { cwd: dir, encoding: "utf8", timeout: 60_000 });
    assert.equal(run.status, 0, run.error?.message ?? run.stderr);
    assert.ok(JSON.parse(run.stdout).some(({ ruleId }) => ruleId === "pngdeer/compressible-image"), run.stdout);
  }
});
