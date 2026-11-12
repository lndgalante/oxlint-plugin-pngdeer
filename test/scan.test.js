import assert from "node:assert/strict";
import { symlinkSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { test } from "node:test";
import { excluded, projectImages } from "../src/scan.js";
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

test("a nested walk enters nested packages, with exclusions from each package's folder or from the top", () => {
  const png = "x".repeat(5000);
  const files = {
    "package.json": "{}",
    "packages/a/package.json": "{}",
    "packages/a/src/a.png": png,
    "packages/a/fixtures/f.png": png,
    "packages/a/node_modules/dep/d.png": png,
    "packages/a/dist/built.png": png,
    "packages/b/package.json": "{}",
    "packages/b/public/b.png": png,
    "packages/b/fixtures/g.png": png,
    "tools/fixtures/t.png": png,
  };
  const dir = project({ files, images: [] });
  const found = (exclude, options) => projectImages(dir, 0, exclude, options).map((file) => relative(dir, file).split(sep).join("/")).sort();
  // dependencies and build output stay skipped inside each package
  assert.deepEqual(found([], { nested: true }), ["packages/a/fixtures/f.png", "packages/a/src/a.png", "packages/b/fixtures/g.png", "packages/b/public/b.png", "tools/fixtures/t.png"]);
  // "fixtures" starts at each package's own folder, as the rule's option does, and at the root's
  assert.deepEqual(found(["fixtures", "public"], { nested: true }), ["packages/a/src/a.png", "tools/fixtures/t.png"]);
  // from the top, a path as typed there: one package's folder, or a glob across packages
  assert.deepEqual(found(["packages/*/fixtures", "packages/b"], { nested: true, top: dir }), ["packages/a/src/a.png", "tools/fixtures/t.png"]);
  // without nested, as the lint scans: the packages are another project's
  assert.deepEqual(found([]), ["tools/fixtures/t.png"]);
});

test("a linked file is left out when an exclusion matches where it leads", (t) => {
  const dir = project({ images: [], files: { "design/mark.png": "mark", "public/keep.png": "keep" } });
  try {
    symlinkSync(join(dir, "design/mark.png"), join(dir, "public/mark.png"));
    symlinkSync(join(dir, "design/missing.png"), join(dir, "public/broken.png"));
  } catch (error) {
    if (process.platform === "win32" && error.code === "EPERM") return t.skip("symlinks require Windows Developer Mode");
    throw error;
  }
  const errors = [];
  const found = (exclude) => projectImages(join(dir, "public"), 0, exclude, { base: dir, onError: (path) => errors.push(relative(dir, path).split(sep).join("/")) }).map((file) => relative(dir, file).split(sep).join("/")).sort();
  assert.deepEqual(found([]), ["public/keep.png", "public/mark.png"]);
  assert.deepEqual(found(["design"]), ["public/keep.png"]);
  // a broken link is reported, excluded or not
  assert.deepEqual(errors, ["public/broken.png", "public/broken.png"]);
});

test("exclusions match root-relative files, directories and simple globs", () => {
  const root = project({ images: [] });
  const matches = (path, pattern) => excluded(root, join(root, path), [pattern]);
  assert.equal(matches("public/raw/photo.png", "public/raw"), true);
  assert.equal(matches("public/raw/photo.png", "./public/raw/"), true);
  assert.equal(matches("public/raw-extra/photo.png", "public/raw"), false);
  assert.equal(matches("other/public/raw/photo.png", "public/raw"), false);
  assert.equal(matches("photo.png", "**/*.png"), true);
  assert.equal(matches("public/photo.png", "**/*.png"), true);
  assert.equal(matches("public/photo.jpg", "**/*.png"), false);
  assert.equal(matches("public/raw/photo.png", "public/*.png"), false);
  assert.equal(matches("public/photo1.png", "public/photo?.png"), true);
  assert.equal(matches("public/photo12.png", "public/photo?.png"), false);
  assert.equal(matches("public/raw", "public/raw/**"), true);
  assert.equal(matches("public/a[1].png", "public/a[1].png"), true);
  assert.equal(matches("public/a1.png", "public/a[1].png"), false);
});

test("excluded directories are pruned with exclusions relative to the requested base", () => {
  const dir = project({ images: [], files: {
    "public/raw/large.png": "large",
    "public/raw-extra/keep.png": "keep",
    "public/logo.png": "logo",
  } });
  const found = projectImages(join(dir, "public"), 0, ["public/raw"], { base: dir });
  assert.deepEqual(found.map((file) => relative(dir, file).split(sep).join("/")).sort(), ["public/logo.png", "public/raw-extra/keep.png"]);
  const errors = [];
  projectImages(join(dir, "missing"), 0, [], { onError: (path, error) => errors.push([path, error.code]) });
  assert.deepEqual(errors, [[join(dir, "missing"), "ENOENT"]]);
});

test("scans include linked image files without following directory links", (t) => {
  const dir = project({ images: [], files: {
    "source/image.png": "image",
    "public/keep.png": "keep",
  } });
  try {
    symlinkSync(join(dir, "source/image.png"), join(dir, "public/linked.png"));
    symlinkSync(join(dir, "missing.png"), join(dir, "public/missing.png"));
    symlinkSync(dir, join(dir, "public/loop"), process.platform === "win32" ? "junction" : "dir");
  } catch (error) {
    if (process.platform === "win32" && error.code === "EPERM") return t.skip("symlinks require Windows Developer Mode");
    throw error;
  }
  const errors = [];
  const found = projectImages(join(dir, "public"), 0, [], { onError: (path, error) => errors.push([path, error.code]) });
  assert.deepEqual(found.map((file) => relative(dir, file).split(sep).join("/")).sort(), ["public/keep.png", "public/linked.png"]);
  assert.deepEqual(errors, [[join(dir, "public/missing.png"), "ENOENT"]]);
});
