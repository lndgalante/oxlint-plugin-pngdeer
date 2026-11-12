// oxlint-plugin-pngdeer was renamed oxlint-plugin-slimdeer: this last version only says so. The
// default export is never reached; it lets `import plugin from` link, so ESLint shows this message.
throw new Error("oxlint-plugin-pngdeer is now oxlint-plugin-slimdeer, and its rule is slimdeer/compressible-image. To move: npm uninstall oxlint-plugin-pngdeer && npm install --save-dev oxlint-plugin-slimdeer, then replace pngdeer with slimdeer in your lint config. Every step: https://github.com/lndgalante/oxlint-plugin-slimdeer#moving-from-oxlint-plugin-pngdeer");
export default {};
