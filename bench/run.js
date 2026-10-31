// The plugin's benchmark. Builds a realistic app from real images (bench/images.json, downloaded once)
// and generated components, in a temporary folder, then times what people run:
//
// - oxlint without the plugin, for the baseline
// - the first run with it (every image measured)
// - later runs, and a run after one image changed
// - ESLint
// - an editor's first lint (which mustn't wait)
// - shrinking everything flagged
//
//   node bench/run.js [--size small|medium|large] [--json results.json]
import { spawnSync } from "node:child_process";
import { copyFileSync, cpSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { cpus, platform, release, tmpdir, totalmem } from "node:os";
import { basename, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { crc32, deflateSync } from "node:zlib";
import { count } from "../src/text.js";
import { fetchImages } from "./fetch.js";

const plugin = fileURLToPath(new URL("..", import.meta.url));
const OXLINT = join(plugin, "node_modules", "oxlint", "bin", "oxlint");
const ESLINT = join(plugin, "node_modules", "eslint", "bin", "eslint.js");
const COMMAND = join(plugin, "bin", "pngdeer.js");

// How many components, and how many of each kind of image, per size.
const SIZES = {
  small: { files: 20, take: { "photo-as-png": 2, "3d-icon": 6, diagram: 2, "web-photo": 2, "camera-photo": 0 } },
  medium: { files: 200, take: { "photo-as-png": 8, "3d-icon": 16, diagram: 6, "web-photo": 6, "camera-photo": 0 } },
  large: { files: 1000, take: { "photo-as-png": 8, "3d-icon": 16, diagram: 6, "web-photo": 6, "camera-photo": 2 } },
};

const args = process.argv.slice(2);
const option = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
const size = option("--size", "medium");
if (!SIZES[size]) throw new Error(`--size is small, medium or large, not ${size}`);

const images = await fetchImages();
// outside this repo, whose .gitignore oxlint would follow
const work = join(tmpdir(), "oxlint-plugin-pngdeer-bench", size);
const app = build(work, images, SIZES[size]);
const results = [];

console.log(`oxlint-plugin-pngdeer ${version(plugin)} benchmark, ${size}: ${app.files} files (${app.tsx} .tsx), ${app.images} images (${mb(app.bytes)})`);
console.log(`${cpus()[0]?.model ?? "?"}, ${cpus().length} cores, ${Math.round(totalmem() / 1e9)} GB, ${platform()} ${release()}, Node ${process.versions.node}, oxlint ${version(join(plugin, "node_modules", "oxlint"))}, ESLint ${version(join(plugin, "node_modules", "eslint"))}`);

record("oxlint, without the plugin", run(OXLINT, ["-c", ".oxlintrc.base.json", "-f", "unix"]));
uncache();
record("oxlint + pngdeer, first run", run(OXLINT, ["-f", "unix"]));
record("oxlint + pngdeer, later runs (median of 3)", median([1, 2, 3].map(() => run(OXLINT, ["-f", "unix"]))));
copyFileSync(app.replacement, app.changed);
record("oxlint + pngdeer, after one image changed", run(OXLINT, ["-f", "unix"]));
const eslint = run(ESLINT, ["src"]);
record("ESLint + pngdeer, later run (.jsx files)", eslint);
uncache();
editor(warnings(eslint));
// --flagged writes over the images, so it runs on a copy, linted there first: the list it reads
// holds absolute paths
const copy = `${work}-flagged`;
rmSync(copy, { recursive: true, force: true });
cpSync(work, copy, { recursive: true });
run(OXLINT, ["-f", "unix"], copy);
record("npx oxlint-plugin-pngdeer --flagged", run(COMMAND, ["--flagged"], copy));
rmSync(copy, { recursive: true, force: true });

console.log("");
console.log("| What | Time | Peak memory | |");
console.log("|---|---:|---:|---|");
for (const { what, ms, rss, about } of results) console.log(`| ${what} | ${seconds(ms)} | ${rss ? mb(rss) : "n/a"} | ${about} |`);
const json = option("--json");
if (json) writeFileSync(json, `${JSON.stringify({ size, app, results }, null, 2)}\n`);

/** Runs `script` with Node in the app (or `cwd`): { ms, rss, stdout, stderr }, rss null where it can't be read. */
function run(script, scriptArgs, cwd = work) {
  // peak memory from the system's time command; the plugin's worker threads are in the same process
  const timer = platform() === "darwin" ? ["-l"] : platform() === "linux" ? ["-v"] : null;
  const timed = timer && existsSync("/usr/bin/time");
  const [command, commandArgs] = timed ? ["/usr/bin/time", [...timer, process.execPath, script, ...scriptArgs]] : [process.execPath, [script, ...scriptArgs]];
  const start = performance.now();
  const result = spawnSync(command, commandArgs, { cwd, encoding: "utf8", maxBuffer: 256e6 });
  const ms = performance.now() - start;
  if (result.status !== 0 && result.status !== 1) throw new Error(`bench: ${basename(script)} exited ${result.status}\n${result.stderr}`);
  let rss = null;
  const darwin = /(\d+)\s+maximum resident set size/.exec(result.stderr);
  const linux = /Maximum resident set size \(kbytes\): (\d+)/.exec(result.stderr);
  if (darwin) rss = Number(darwin[1]);
  else if (linux) rss = Number(linux[1]) * 1024;
  return { ms, rss, stdout: result.stdout, stderr: result.stderr };
}

/** Adds a run to the results, with what the plugin said it did. */
function record(what, result, about = said(result)) {
  const { ms, rss } = result;
  results.push({ what, ms, rss, about });
  process.stderr.write(`bench: ${what}: ${seconds(ms)}\n`);
}

/** An editor's first lint with nothing cached: how long it takes, and how long until all `expected` warnings show. */
function editor(expected) {
  const result = run(join(work, "eslintServer.mjs"), [work, `${expected}`]);
  const { first, warnings, ready } = JSON.parse(result.stdout);
  record("ESLint's language server, first lint, nothing cached", { ...result, ms: first }, `${warnings} warnings at once, all ${expected} after ${seconds(ready)} (measured in the background)`);
}

function said(result) {
  const measured = /measured (\d+) images? in/.exec(result.stderr)?.[1];
  const found = warnings(result);
  const shrunk = /pngdeer: (\d+) images?, .* smaller\)/.exec(result.stderr)?.[1];
  return [measured && `measured ${count(Number(measured), "image")}`, found && count(found, "warning"), shrunk && `shrank ${count(Number(shrunk), "image")}`].filter(Boolean).join(", ");
}

function warnings({ stdout, stderr }) {
  return (`${stdout}\n${stderr}`.match(/compressible-image/g) ?? []).length;
}

/** Removes the app's cache, as on a fresh clone. */
function uncache() {
  rmSync(join(work, "node_modules"), { recursive: true, force: true });
}

function median(runs) {
  return [...runs].sort((a, b) => a.ms - b.ms)[Math.floor(runs.length / 2)];
}

/**
 * Writes the app: images where apps keep them, components naming them every way the rule reads
 * (imports, a tsconfig alias, new URL, JSX src and srcSet, data), a logo named in many files,
 * images only CSS names, unused ones, and tiny icons below the rule's threshold.
 */
function build(dir, all, { files, take }) {
  rmSync(dir, { recursive: true, force: true });
  const write = (path, text) => {
    mkdirSync(join(dir, path, ".."), { recursive: true });
    writeFileSync(join(dir, path), text);
  };
  const placed = [];
  const place = (image, path) => {
    write(path, readFileSync(image.path));
    placed.push(path);
    return path;
  };
  const pick = (category) => all.filter((image) => image.category === category);
  // one icon is kept out, to change an image with later
  const replacement = pick("3d-icon").at(-1);
  const chosen = (category) => pick(category).filter((image) => image !== replacement).slice(0, take[category]);

  const refs = []; // { path, how, other }: how a component names it (other: srcSet's 2x image)
  const icons = chosen("3d-icon");
  place(icons[0], "src/assets/logo.png");
  icons.slice(1, -2).forEach((image, i) => refs.push({ path: place(image, `src/assets/icons/${image.name}`), how: ["import", "alias", "url"][i % 3] }));
  icons.slice(-2).forEach((image) => place(image, `src/assets/unused/${image.name}`));
  const heroes = chosen("photo-as-png").map((image) => place(image, `public/hero/${image.name}`));
  for (let i = 0; i < heroes.length; i += 2) refs.push(heroes[i + 1] ? { path: heroes[i], how: "srcset", other: heroes[i + 1] } : { path: heroes[i], how: "public" });
  chosen("web-photo").forEach((image) => refs.push({ path: place(image, `public/photos/${image.name}`), how: "public" }));
  chosen("camera-photo").forEach((image) => refs.push({ path: place(image, `public/camera/${image.name}`), how: "data" }));
  const diagrams = chosen("diagram").map((image) => place(image, `src/assets/diagrams/${image.name}`));
  diagrams.slice(0, Math.ceil(diagrams.length / 2)).forEach((path) => refs.push({ path, how: "import" }));
  const css = diagrams.slice(Math.ceil(diagrams.length / 2));
  for (let i = 0; i < 4; i++) {
    const path = `src/assets/tiny/dot-${i}.png`;
    write(path, tiny(i));
    placed.push(path);
    refs.push({ path, how: "import" });
  }
  const bytes = placed.reduce((sum, path) => sum + statSync(join(dir, path)).size, 0);
  let tsx = 0;
  for (let i = 0; i < files; i++) {
    const ts = i % 5 === 4;
    if (ts) tsx++;
    // the first files name the images (each about twice), the rest are plain code
    const own = i < refs.length * 2 ? [refs[i % refs.length]] : [];
    write(`src/components/Card${i}.${ts ? "tsx" : "jsx"}`, component(i, own, i % 10 === 0, ts));
  }
  write("src/styles.css", css.map((path, i) => `.panel-${i} { background: url("../${path.replace(/^src\//, "")}") center / cover; }`).join("\n") + "\n");
  write("package.json", JSON.stringify({ name: `bench-${basename(dir)}`, private: true, type: "module" }, null, 2));
  write("tsconfig.json", JSON.stringify({ compilerOptions: { jsx: "react-jsx", paths: { "@/*": ["./src/*"] } } }, null, 2));
  write(".oxlintrc.base.json", JSON.stringify({ plugins: ["react", "typescript", "oxc"] }, null, 2));
  write(".oxlintrc.json", JSON.stringify({ plugins: ["react", "typescript", "oxc"], jsPlugins: [join(plugin, "src", "index.js")], rules: { "pngdeer/compressible-image": "warn" } }, null, 2));
  const index = JSON.stringify(pathToFileURL(join(plugin, "src", "index.js")).href);
  write("eslint.config.js", `import pngdeer from ${index};\nexport default [{ files: ["**/*.jsx"], languageOptions: { parserOptions: { ecmaFeatures: { jsx: true } } }, plugins: { pngdeer }, rules: { "pngdeer/compressible-image": "warn" } }];\n`);
  const api = JSON.stringify(pathToFileURL(join(plugin, "node_modules", "eslint", "lib", "api.js")).href);
  write("eslintServer.mjs", `// ESLint's Node API, named as ESLint's language server is (the rule measures in the background
// there): lints at once, then each second, as an editor does while you type, until the warnings
// are all there.
import { ESLint } from ${api};
const [cwd, expected] = process.argv.slice(2);
const eslint = new ESLint({ cwd });
const count = async () => (await eslint.lintFiles(["src"])).flatMap((r) => r.messages).filter((m) => m.ruleId === "pngdeer/compressible-image").length;
const start = performance.now();
const warnings = await count();
const first = performance.now() - start;
for (let now = warnings; now < Number(expected) && performance.now() - start < 600e3; now = await count()) {
  await new Promise((resolve) => setTimeout(resolve, 1000));
}
console.log(JSON.stringify({ first, warnings, ready: performance.now() - start }));
`);
  const changed = refs.find((ref) => ref.how === "import" && ref.path.includes("/icons/")) ?? refs[0];
  return { files, tsx, images: placed.length, bytes, replacement: replacement.path, changed: join(dir, changed.path) };
}

/** A component naming `refs` (and the logo, if `logo`), with enough plain code around them to lint. */
function component(i, refs, logo, ts) {
  const imports = [];
  const tags = [];
  const data = [];
  if (logo) {
    imports.push(`import logo from "../assets/logo.png";`);
    tags.push(`<img src={logo} alt="Logo" width="32" />`);
  }
  refs.forEach((ref, n) => {
    const local = `image${n}`;
    const relative = `../${ref.path.replace(/^src\//, "")}`;
    const url = `/${ref.path.replace(/^public\//, "")}`;
    if (ref.how === "import") imports.push(`import ${local} from "${relative}";`), tags.push(`<img src={${local}} alt="" />`);
    else if (ref.how === "alias") imports.push(`import ${local} from "@/${ref.path.replace(/^src\//, "")}";`), tags.push(`<img src={${local}} alt="" />`);
    else if (ref.how === "url") tags.push(`<img src={new URL("${relative}", import.meta.url).href} alt="" />`);
    else if (ref.how === "public") tags.push(`<img src="${url}" alt="" loading="lazy" />`);
    else if (ref.how === "srcset") tags.push(`<img src="${url}" srcSet="${url} 1x, /${ref.other.replace(/^public\//, "")} 2x" alt="" />`);
    else if (ref.how === "data") data.push(`"${url}"`);
  });
  const props = ts ? `{ items = [], title }: { items?: { name: string; price: number }[]; title?: string }` : `{ items = [], title }`;
  return `${imports.join("\n")}
${data.length ? `export const gallery${i} = [${data.join(", ")}];\n` : ""}
function format${i}(price${ts ? ": number" : ""}) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(price);
}

export function Card${i}(${props}) {
  const total = items.reduce((sum, item) => sum + item.price, 0);
  const sorted = [...items].sort((a, b) => a.name.localeCompare(b.name));
  if (sorted.length === 0) return <p className="empty">Nothing here yet</p>;
  return (
    <section className="card card-${i % 7}">
      <h2>{title ?? "Card ${i}"}</h2>
      ${tags.join("\n      ")}
      <ul>
        {sorted.map((item) => (
          <li key={item.name}>
            {item.name}: {format${i}(item.price)}
          </li>
        ))}
      </ul>
      <p className="total">Total: {format${i}(total)}</p>
    </section>
  );
}
`;
}

/** A 16 × 16 PNG, well under the rule's 4 KiB threshold. */
function tiny(seed) {
  const chunk = (type, data) => {
    const out = Buffer.alloc(12 + data.length);
    out.writeUInt32BE(data.length, 0);
    out.write(type, 4, "latin1");
    data.copy(out, 8);
    out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
    return out;
  };
  const raw = Buffer.alloc((16 * 3 + 1) * 16, 40 + seed * 50);
  for (let y = 0; y < 16; y++) raw[y * 49] = 0;
  const header = Buffer.alloc(13);
  header.writeUInt32BE(16, 0);
  header.writeUInt32BE(16, 4);
  header.set([8, 2], 8);
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", header), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}

function version(dir) {
  try {
    return JSON.parse(readFileSync(join(dir, "package.json"), "utf8")).version;
  } catch {
    return "?";
  }
}

function seconds(ms) {
  return ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(1)} s`;
}

function mb(bytes) {
  return bytes < 1e9 ? `${Math.round(bytes / 1e6)} MB` : `${(bytes / 1e9).toFixed(1)} GB`;
}
