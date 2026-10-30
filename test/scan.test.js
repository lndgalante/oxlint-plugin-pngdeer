import assert from "node:assert/strict";
import { relative, sep } from "node:path";
import { test } from "node:test";
import { projectImages } from "../src/scan.js";
import { project } from "./helpers.js";

test("the project scan skips test output, nested packages and files too small to matter", () => {
  const png = "x".repeat(5000);
  const files = {
    "src/a.png": png,
    "src/tiny.png": "x",
    "public/b.jpg": png,
    "node_modules/pkg/c.png": png,
    ".storybook/d.png": png,
    "tests/home.spec.ts-snapshots/e.png": png,
    "test-results/f.png": png,
    "__screenshots__/g.png": png,
    "packages/other/package.json": "{}",
    "packages/other/h.png": png,
  };
  const dir = project({ files, images: [] });
  const found = projectImages(dir, 4096).map((file) => relative(dir, file).split(sep).join("/")).sort();
  assert.deepEqual(found, ["public/b.jpg", "src/a.png"]);
});
