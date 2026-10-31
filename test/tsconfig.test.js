// Aliases read from tsconfig/jsconfig paths the way TypeScript resolves them.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, test } from "node:test";
import { configAliases } from "../src/tsconfig.js";

const dirs = [];
after(() => dirs.forEach((dir) => rmSync(dir, { recursive: true, force: true })));

/** A folder with these files, and the aliases of its project at `root` (a subfolder, or the folder). */
function aliases(files, root = ".") {
  const dir = mkdtempSync(join(tmpdir(), "pngdeer-tsconfig-"));
  dirs.push(dir);
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), typeof text === "string" ? text : JSON.stringify(text));
  }
  return configAliases(join(dir, root));
}

test("paths relative to the config, through Vite's references, with comments and trailing commas", () => {
  const files = {
    "tsconfig.json": { files: [], references: [{ path: "./tsconfig.app.json" }] },
    "tsconfig.app.json": '{\n  // "@/*" for https://example.com style comments\n  "compilerOptions": { "paths": { "@/*": ["./src/*"], }, },\n}\n',
  };
  assert.deepEqual(aliases(files), { "@/": "src/" });
});

test("a BOM, and jsconfig.json when there's no tsconfig.json", () => {
  assert.deepEqual(aliases({ "tsconfig.json": `﻿${JSON.stringify({ compilerOptions: { paths: { "@img/*": ["./src/assets/*"] } } })}` }), { "@img/": "src/assets/" });
  assert.deepEqual(aliases({ "jsconfig.json": { compilerOptions: { paths: { "~/*": ["./*"] } } } }), { "~/": "" });
});

test("baseUrl: null unsets an inherited one, and odd values don't throw", () => {
  const files = {
    "tsconfig.base.json": { compilerOptions: { baseUrl: "./lib" } },
    "tsconfig.json": { extends: "./tsconfig.base.json", compilerOptions: { baseUrl: null, paths: { "@/*": ["./src/*"], "#bad/*": null } } },
  };
  assert.deepEqual(aliases(files), { "@/": "src/" });
  assert.equal(aliases({ "tsconfig.json": { compilerOptions: { paths: null } } }), null);
});

test("baseUrl comes from wherever in the extends chain it's set", () => {
  const files = {
    "tsconfig.base.json": { compilerOptions: { baseUrl: "." } },
    "apps/web/package.json": "{}",
    "apps/web/tsconfig.json": { extends: "../../tsconfig.base", compilerOptions: { paths: { "@ui/*": ["libs/ui/src/*"] } } },
  };
  // from the monorepo root's baseUrl, and an extends without ".json"
  assert.deepEqual(aliases(files, "apps/web"), { "@ui/": "../../libs/ui/src/" });
});

test("later extends win, and ${configDir} is the project's own folder", () => {
  const files = {
    "old.json": { compilerOptions: { paths: { "@/*": ["./old/*"] } } },
    "new.json": { compilerOptions: { paths: { "@/*": ["${configDir}/src/*"] } } },
    "apps/web/tsconfig.json": { extends: ["../../old.json", "../../new.json"] },
  };
  assert.deepEqual(aliases(files, "apps/web"), { "@/": "src/" });
});

test("a config edited since is read again", () => {
  const dir = mkdtempSync(join(tmpdir(), "pngdeer-tsconfig-"));
  dirs.push(dir);
  writeFileSync(join(dir, "tsconfig.json"), JSON.stringify({ compilerOptions: {} }));
  assert.equal(configAliases(dir), null);
  writeFileSync(join(dir, "tsconfig.json"), JSON.stringify({ compilerOptions: { paths: { "@/*": ["./app/*"] } } }));
  utimesSync(join(dir, "tsconfig.json"), new Date(), new Date(Date.now() + 5000));
  assert.deepEqual(configAliases(dir), { "@/": "app/" });
});
