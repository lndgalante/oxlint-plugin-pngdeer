import { readFileSync } from "node:fs";
import compressibleImage from "./rule.js";

// ESLint's --cache keys on the plugin's version, so a new version (and engine) is linted afresh.
const { version } = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));

export default {
  meta: { name: "pngdeer", version },
  rules: { "compressible-image": compressibleImage },
};
