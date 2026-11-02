// ESLint's version of .oxlintrc.json: npx eslint .
import pngdeer from "../src/index.js";

export default [
  {
    files: ["**/*.{js,jsx}"],
    languageOptions: { parserOptions: { ecmaFeatures: { jsx: true } } },
    plugins: { pngdeer },
    rules: { "pngdeer/compressible-image": "warn" },
  },
];
