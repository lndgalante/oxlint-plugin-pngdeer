# Security

Report a vulnerability privately at https://github.com/lndgalante/oxlint-plugin-slimdeer/security/advisories/new, not in a public issue. Include the version, the command or lint configuration, and an image or steps that reproduce it. If that page has no form, open an issue that asks for a private contact, with no details. Fixes go into the latest release. If the problem is in the engine itself, say so in your report, and we'll pass it to slimdeer's maintainers at HeyDeer privately.

What the package does on your machine:

- The rule and the command read your project's source files and images. Images are decoded and compressed by the slimdeer WebAssembly engine in the package. Nothing is uploaded.
- Results are cached in `node_modules/.cache/slimdeer`, or in the folder `settings.slimdeer.cacheDir` or `--cache-dir` names. A lint also leaves the list that `--flagged` reads in `node_modules/.cache/slimdeer` of the folder it ran from.
- `--review` writes previews and one page into `node_modules/.cache/slimdeer/review` of the project it runs in, and removes anything else in that folder. The page loads nothing from the network: its Content-Security-Policy allows only files on your disk. `--open` asks your system's opener (`open`, `xdg-open` or `explorer.exe`) to show it.
- Images change only when you run `npx oxlint-plugin-slimdeer` with image paths or `--flagged`. `--check` and `--review` never change them, and with `-o OUT` the command writes a new file and leaves the image as it is.
- No dependencies, no install scripts and no native binaries. Releases 0.2.0 to 0.5.0, published under this package's former name, oxlint-plugin-pngdeer, came from GitHub Actions with npm provenance. oxlint-plugin-slimdeer 0.6.0 has no npm provenance: it was published by hand, to create the package. Later releases come from GitHub Actions with npm provenance.
- The engine rebuilds byte for byte from pinned source: two clean builds in GitHub Actions reproduced the shipped files ([the run](https://github.com/lndgalante/oxlint-plugin-slimdeer/actions/runs/43168095056)). See [engine/README.md](engine/README.md) to build it yourself.
