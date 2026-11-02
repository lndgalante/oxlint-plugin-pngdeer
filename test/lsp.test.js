// oxlint's language server, as the Oxc extensions start it: the first lint returns at once, the
// warning comes on a later lint, and nothing but LSP frames reaches stdout.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";
import { cacheDir, key } from "../src/cache.js";
import { plugin, project } from "./helpers.js";

/** `oxlint --lsp` in `dir`, with request(method, params) and notify(method, params) over stdio. */
function server(dir) {
  // oxlint's own script, not node_modules/.bin's shim, which is a .cmd file on Windows
  const child = spawn(process.execPath, [join(plugin, "node_modules", "oxlint", "bin", "oxlint"), "--lsp"], { cwd: dir });
  const exited = new Promise((resolve) => child.on("exit", resolve));
  const waiting = new Map();
  let buffer = Buffer.alloc(0);
  let stray = "";
  let log = "";
  let id = 0;
  child.stderr.setEncoding("utf8").on("data", (chunk) => (log += chunk));
  child.stdout.on("data", (chunk) => {
    buffer = Buffer.concat([buffer, chunk]);
    for (;;) {
      const end = buffer.indexOf("\r\n\r\n");
      if (end < 0) return;
      // a frame's header is Content-Length, maybe with Content-Type: anything before it is stray
      const header = /^([\s\S]*?)Content-Length: (\d+)(?:\r\nContent-Type: [^\r\n]*)?$/i.exec(buffer.subarray(0, end).toString());
      if (!header) {
        stray += buffer.subarray(0, end + 4).toString();
        buffer = buffer.subarray(end + 4);
        continue;
      }
      stray += header[1];
      const length = Number(header[2]);
      if (buffer.length < end + 4 + length) return;
      const message = JSON.parse(buffer.subarray(end + 4, end + 4 + length).toString());
      buffer = buffer.subarray(end + 4 + length);
      // the server's own requests (configuration, registering capabilities): answered with nothing
      if (message.method && message.id !== undefined) send({ id: message.id, result: null });
      else if (waiting.has(message.id)) {
        waiting.get(message.id).resolve(message.result);
        waiting.delete(message.id);
      }
    }
  });
  // a server that dies fails what waits on it, rather than leaving the test hanging
  exited.then((code) => waiting.forEach(({ reject }) => reject(new Error(`oxlint --lsp exited (${code}): ${log}`))));
  const send = (message) => {
    const body = Buffer.from(JSON.stringify({ jsonrpc: "2.0", ...message }));
    child.stdin.write(Buffer.concat([Buffer.from(`Content-Length: ${body.length}\r\n\r\n`), body]));
  };
  return {
    request: (method, params) => new Promise((resolve, reject) => {
      waiting.set(++id, { resolve, reject });
      send({ id, method, params });
    }),
    notify: (method, params) => send({ method, params }),
    // and what's left after the last frame, unless it starts the next one
    stray: () => {
      const rest = buffer.toString();
      return stray + ("Content-Length: ".startsWith(rest) || rest.startsWith("Content-Length: ") ? "" : rest);
    },
    // waits for the exit, so the project's folder can be removed after (Windows)
    stop: () => {
      child.kill();
      return exited;
    },
  };
}

test("oxlint's language server answers at once and shows the warning on a later lint", { timeout: 120_000 }, async (t) => {
  const text = 'import ball from "./assets/crystal-ball.png";\n';
  // bigger images the file doesn't name, which the first lint measures too, after the file's own
  const others = ["public/hero.png", "src/assets/diagram.png", "public/photo.jpg"];
  // the server matches files to its workspace by real path: macOS's tmpdir is a symlink, and
  // Windows' can be a short 8.3 name
  const dir = realpathSync.native(project({ files: { "src/App.jsx": text }, images: ["src/assets/crystal-ball.png", ...others] }));
  const measured = (image) => existsSync(join(cacheDir(dir), `${key(readFileSync(join(dir, image)))}.json`));
  const lsp = server(dir);
  t.after(() => lsp.stop());
  const root = pathToFileURL(dir).href;
  const uri = pathToFileURL(join(dir, "src", "App.jsx")).href;
  await lsp.request("initialize", {
    processId: process.pid,
    rootUri: root,
    workspaceFolders: [{ uri: root, name: "project" }],
    // what VS Code's client declares; with less, the server pushes diagnostics instead of answering pulls
    capabilities: { textDocument: { diagnostic: { dynamicRegistration: true } }, workspace: { configuration: true, diagnostics: { refreshSupport: true } } },
    initializationOptions: [{ workspaceUri: root, options: { run: "onType" } }],
  });
  lsp.notify("initialized", {});
  lsp.notify("textDocument/didOpen", { textDocument: { uri, languageId: "javascriptreact", version: 1, text } });
  const warnings = async () => {
    const { items } = await lsp.request("textDocument/diagnostic", { textDocument: { uri } });
    return items.filter((d) => JSON.stringify(d.code).includes("compressible-image"));
  };

  // a lint that waited for measuring would already have the warning
  assert.deepEqual(await warnings(), [], "the first lint doesn't wait for measuring");
  let found = [];
  for (let version = 2; found.length === 0; version++) {
    await new Promise((resolve) => setTimeout(resolve, 250));
    lsp.notify("textDocument/didChange", { textDocument: { uri, version }, contentChanges: [{ text }] });
    found = await warnings();
  }
  assert.equal(found.length, 1);
  assert.match(found[0].message, /^crystal-ball\.png could be \d+% smaller/);
  // the file's own image went first, in a batch of its own: one batch, biggest first, would have
  // started the others first wherever there are fewer engines than images (CI's 2 to 4 cores)
  assert.deepEqual(others.filter(measured), [], "the warning didn't wait for the project's images");
  assert.equal(lsp.stray(), "", "only LSP frames on stdout");
});
