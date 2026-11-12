# Security

Report a vulnerability privately at https://github.com/lndgalante/oxlint-plugin-slimdeer/security/advisories/new, not in a public issue. Include the version, the command or lint configuration, and an image or steps that reproduce it. If that page has no form, open an issue that asks for a private contact, with no details. Fixes go into the latest release. If the problem is in slimdeer's engine itself, say so in your report, and we'll pass it to slimdeer's maintainers privately.

What the package does on your machine:

- The rule and the command read your project's source files and images. Images are decoded and compressed by the slimdeer WebAssembly engine in the package. Nothing is uploaded.
- Results are cached in `node_modules/.cache/slimdeer`, or in the folder `settings.slimdeer.cacheDir` or `--cache-dir` names. A lint also leaves the list that `--flagged` reads in `node_modules/.cache/slimdeer` of the folder it ran from.
- Images change only when you run `npx oxlint-plugin-slimdeer` with image paths or `--flagged`. `--check` never changes them, and with `-o OUT` the command writes a new file and leaves the image as it is.
- No dependencies, no install scripts and no native binaries. Releases from 0.2.0 on are published from GitHub Actions with npm provenance.
- The engine rebuilds byte for byte from pinned source: see [engine/README.md](engine/README.md).
