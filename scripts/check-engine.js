import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

const dir = new URL("../engine/", import.meta.url);
const provenance = JSON.parse(readFileSync(new URL("provenance.json", dir), "utf8"));
for (const [file, expected] of Object.entries(provenance.files)) {
  const actual = createHash("sha256").update(readFileSync(new URL(file, dir))).digest("hex");
  assert.equal(actual, expected, `${file}: update provenance only after reviewing the engine change`);
  console.log(`${actual}  ${file}`);
}
const wasm = new WebAssembly.Module(readFileSync(new URL("pngdeer_wasm_bg.wasm", dir)));
const producers = WebAssembly.Module.customSections(wasm, "producers").map((section) => Buffer.from(section).toString()).join("");
for (const [tool, version] of Object.entries(provenance.observedProducers)) {
  assert.ok(producers.includes(version), `the WASM producers section must identify ${tool} ${version}`);
}
console.log("Vendored engine hashes and recorded compiler versions verified.");
