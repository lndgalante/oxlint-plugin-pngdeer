# oxlint-plugin-pngdeer is now oxlint-plugin-slimdeer

The engine this package runs was renamed slimdeer upstream, and the package followed. This last version only says so. 0.5.0 still installs and works, but gets no more updates.

    npm uninstall oxlint-plugin-pngdeer
    npm install --save-dev oxlint-plugin-slimdeer

Then replace `pngdeer` with `slimdeer` in your lint config (the package in `jsPlugins` or your ESLint import, the rule id `slimdeer/compressible-image`, `settings.slimdeer`) and in scripts (`npx oxlint-plugin-slimdeer`). Images it shrank need nothing: the new package recognizes them. [Every step](https://github.com/lndgalante/oxlint-plugin-slimdeer/blob/main/docs/rules/compressible-image.md#moving-from-oxlint-plugin-pngdeer)
