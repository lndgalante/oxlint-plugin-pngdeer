// The lines of a project that still name an image (mentions.js): what the command lists once it has
// written a copy, and what --check --json gives agents.
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { mentions } from "../src/mentions.js";
import { pathFrom } from "../src/text.js";
import { project } from "./helpers.js";

/** `mentions()` of the image at `path` in `dir`, as [file from `dir`, line, text, markdown]. */
const found = (dir, path) => mentions(join(dir, path), dir).map(({ file, line, text, markdown }) => [pathFrom(dir, file), line, text, markdown]);

test("an image is named by a path from its file, from the project, or from a public folder, code before Markdown", () => {
  const files = {
    "README.md": "# Example\n\nThe logo is `src/assets/logo.png`.\n",
    "config.json": '{\n  "icon": "src/assets/logo.png"\n}\n',
    "src/App.jsx": [
      'import logo from "./assets/logo.png";',
      'const name = "logo.png";',
      '  export const Hero = () => <img src="/hero.png" alt="" />;',
      'export const Photo = () => <img src="/my%20photo.png" alt="" />;',
      'export const Robots = () => <img src="/robots.png" alt="" />;',
      'export const Other = () => <img src="/my-hero.png" alt="" />;',
    ].join("\n"),
    "src/styles/site.css": ".a {\n  background: url(../assets/logo.png);\n}\n",
    "public/index.html": '<img src="hero.png">\n',
  };
  const dir = project({ images: [], files });
  assert.deepEqual(found(dir, "src/assets/logo.png"), [
    ["src/styles/site.css", 2, "background: url(../assets/logo.png);", false],
    ["config.json", 2, '"icon": "src/assets/logo.png"', false],
    ["src/App.jsx", 1, 'import logo from "./assets/logo.png";', false],
    ["README.md", 3, "The logo is `src/assets/logo.png`.", true],
  ]);
  // "/hero.png" from public/, and "hero.png" from public/index.html; my-hero.png is another image
  assert.deepEqual(found(dir, "public/hero.png"), [
    ["public/index.html", 1, '<img src="hero.png">', false],
    ["src/App.jsx", 3, 'export const Hero = () => <img src="/hero.png" alt="" />;', false],
  ]);
  assert.deepEqual(found(dir, "public/my photo.png"), [["src/App.jsx", 4, 'export const Photo = () => <img src="/my%20photo.png" alt="" />;', false]]);
  // static/ is a public folder too
  assert.deepEqual(found(dir, "static/robots.png"), [["src/App.jsx", 5, 'export const Robots = () => <img src="/robots.png" alt="" />;', false]]);
  assert.deepEqual(found(dir, "public/missing.png"), []);
});

test("an image is named by its name alone only where no line names it by a path", () => {
  const files = {
    "src/data.js": 'export const icons = ["lonely.png", "my-lonely.png"];\nexport const logo = "logo.png";\n',
    "src/App.jsx": 'import logo from "./assets/logo.png";\n',
  };
  const dir = project({ images: [], files });
  assert.deepEqual(found(dir, "public/lonely.png"), [["src/data.js", 1, 'export const icons = ["lonely.png", "my-lonely.png"];', false]]);
  assert.deepEqual(found(dir, "src/assets/logo.png"), [["src/App.jsx", 1, 'import logo from "./assets/logo.png";', false]]);
});

test("a long line is cut at 100 characters, and Windows line ends count as the others", () => {
  const long = `export const hero = { src: "/hero.png", alt: "${"An arcade stick, ".repeat(10)}" };`;
  const emoji = `// 🕹️ ${"🕹️".repeat(60)} /hero.png`;
  const lines = ["// the hero", long, "", emoji, '<img src="/hero.png" />'];
  const dir = project({ images: [], files: { "src/lf.js": lines.join("\n"), "src/crlf.jsx": lines.join("\r\n") } });
  const result = found(dir, "public/hero.png");
  const shown = [
    [2, `${long.slice(0, 99)}…`],
    [4, `${Array.from(emoji).slice(0, 99).join("")}…`],
    [5, '<img src="/hero.png" />'],
  ];
  assert.deepEqual(result, [...shown.map(([line, text]) => ["src/lf.js", line, text, false]), ...shown.map(([line, text]) => ["src/crlf.jsx", line, text, false])]);
  for (const [, , text] of result) assert.ok(Array.from(text).length <= 100);
});

test("a project's files are read once, packages inside it too, leaving out build output and large files", () => {
  const files = {
    "src/App.jsx": 'import hero from "../public/hero.png";\n',
    // build output, and a file too large to be where people name images
    "dist/index.html": '<img src="/hero.png">\n',
    "data.json": `{ "hero": "/hero.png", "pad": "${"x".repeat(1.1e6)}" }`,
    // a package inside the project may use its images
    "packages/web/package.json": "{}",
    "packages/web/index.html": '<img src="../../public/hero.png">\n',
  };
  const dir = project({ images: [], files });
  const named = [["packages/web/index.html", 1, '<img src="../../public/hero.png">', false], ["src/App.jsx", 1, 'import hero from "../public/hero.png";', false]];
  assert.deepEqual(found(dir, "public/hero.png"), named);
  // the command asks for every image it wrote, and the files are read on the first
  writeFileSync(join(dir, "src/Late.jsx"), 'import hero from "../public/hero.png";\n');
  assert.deepEqual(found(dir, "public/hero.png"), named);
});

test("from a monorepo's root, the lines of its other packages are found too", (t) => {
  const files = {
    "package.json": '{ "workspaces": ["packages/*"] }',
    "assets/shared.png": "",
    "packages/web/package.json": "{}",
    "packages/web/src/shared.js": 'import shared from "../../../assets/shared.png";\n',
    "packages/web/public/hero.png": "",
    "packages/web/src/App.jsx": '<img src="/hero.png" />\n',
    "packages/docs/package.json": "{}",
    "packages/docs/guide.md": "The hero is `../web/public/hero.png`.\n",
  };
  const dir = project({ images: [], files });
  const cwd = process.cwd();
  t.after(() => process.chdir(cwd));
  process.chdir(dir);
  const root = process.cwd();
  const web = join(root, "packages/web");
  const at = (image, from) => mentions(join(root, image), from).map(({ file, line }) => `${pathFrom(root, file)}:${line}`);
  assert.deepEqual(at("assets/shared.png", root), ["packages/web/src/shared.js:1"]);
  assert.deepEqual(at("packages/web/public/hero.png", web), ["packages/web/src/App.jsx:1", "packages/docs/guide.md:1"]);
  // from inside a package, its own lines alone
  process.chdir(web);
  assert.deepEqual(at("packages/web/public/hero.png", web), ["packages/web/src/App.jsx:1"]);
  // from the folder given, wherever the process is: --check's, say
  const from = (cwd) => mentions(join(root, "packages/web/public/hero.png"), web, undefined, cwd).map(({ file, line }) => `${pathFrom(root, file)}:${line}`);
  assert.deepEqual(from(root), ["packages/web/src/App.jsx:1", "packages/docs/guide.md:1"]);
  process.chdir(root);
  assert.deepEqual(from(web), ["packages/web/src/App.jsx:1"]);
});

test("the lines of each kind come by file path, whatever order the file system lists them in", () => {
  const files = Object.fromEntries(["src/z.js", "src/a.js", "lib/m.js", "z.md", "a.md", "public/b.html", "a.css"].map((path) => [path, 'const hero = "/hero.png";\n']));
  const dir = project({ images: [], files });
  assert.deepEqual(found(dir, "public/hero.png").map(([file]) => file), ["a.css", "public/b.html", "lib/m.js", "src/a.js", "src/z.js", "a.md", "z.md"]);
});

test("a path that leads to another image of the same name is not one that names it", () => {
  // from public/, "hero.png" is this one, "img/hero.png" another
  const site = project({ images: [], files: { "public/page.html": '<img src="img/hero.png">\n<img src="./hero.png">\n' } });
  assert.deepEqual(found(site, "public/hero.png"), [["public/page.html", 2, '<img src="./hero.png">', false]]);
  // from the project's root, "./other/hero.png" and "../hero.png" are others, "/hero.png" this one
  const app = project({ images: [], files: { "app.js": 'import other from "./other/hero.png";\nconst root = "/hero.png";\nconst up = "../hero.png";\n' } });
  assert.deepEqual(found(app, "hero.png"), [["app.js", 2, 'const root = "/hero.png";', false]]);
});

test("a line is shown with its tabs as spaces, and where letter case doesn't count, named in any case", () => {
  const files = { "src/App.jsx": '\thero:\t\t"/Hero.PNG",\t// banner\nimport logo from "./Assets/logo.png";\n' };
  const dir = project({ images: [], files });
  const caseless = process.platform === "darwin" || process.platform === "win32";
  // public/hero.png and src/assets/logo.png, typed in other cases: code on a server that tells case
  // apart would miss them, but here they are these images
  assert.deepEqual(found(dir, "PUBLIC/HERO.png"), caseless ? [["src/App.jsx", 1, 'hero: "/Hero.PNG", // banner', false]] : []);
  assert.deepEqual(found(dir, "SRC/ASSETS/Logo.png"), caseless ? [["src/App.jsx", 2, 'import logo from "./Assets/logo.png";', false]] : []);
  const other = project({ images: [], files: { "src/App.jsx": '\thero:\t"/hero.png",\t// banner\n' } });
  assert.deepEqual(found(other, "public/hero.png"), [["src/App.jsx", 1, 'hero: "/hero.png", // banner', false]]);
});
