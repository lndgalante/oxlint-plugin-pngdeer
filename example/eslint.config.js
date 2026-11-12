// ESLint's version of .oxlintrc.json: npx eslint .
import slimdeer from "../src/index.js";

export default [
  {
    files: ["**/*.{js,jsx}"],
    languageOptions: { parserOptions: { ecmaFeatures: { jsx: true } } },
    plugins: { slimdeer },
    rules: { "slimdeer/compressible-image": "warn" },
  },
];
