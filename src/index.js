import { readFileSync } from "node:fs";
import compressibleImage from "./rule.js";

// ESLint's --cache keys on the plugin's version, so a new version (and engine) is linted afresh.
const { version } = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));

const plugin = {
  meta: { name: "slimdeer", version },
  rules: { "compressible-image": compressibleImage },
};

// No `files`: it runs on the files the rest of the config lints, so it never pulls in JSX or
// TypeScript the config can't parse. oxlint ignores it.
plugin.configs = {
  recommended: {
    name: "slimdeer/recommended",
    plugins: { slimdeer: plugin },
    rules: { "slimdeer/compressible-image": "warn" },
  },
};

export default plugin;
