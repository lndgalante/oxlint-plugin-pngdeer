# engine

pngdeer's single-threaded WebAssembly build and its wasm-bindgen glue (`web/build.sh`'s `web/pkg`), as deployed at heydeer.ai/open-source/pngdeer on October 30, 2026. Its presumed source revision is [heydeer/pngdeer at a8e88267ba02cbaf66e746db93ed04242dca8450](https://github.com/heydeer/pngdeer/tree/a8e88267ba02cbaf66e746db93ed04242dca8450) (0.2.1, plus JPEG input and output), the last commit to touch its code before that deploy. The shipped files were downloaded, not built here. Their correspondence to that source remains unverified until the build comparison below reports a match.

| File | SHA-256 |
|---|---|
| `pngdeer_wasm_bg.wasm` | `ad2351d25459d45c84a22b847c932b01dfa31cfea1f9ca4b89d5139bff72cd8e` |
| `pngdeer_wasm.js` | `9e990aa28b18e2ea58dcaf31a4d091db8dd5ce4a2ba13c579c31a127dc4aa21f` |

The cache keys results by the wasm's hash (`src/cache.js`), so a new engine measures everything again.

[THIRD_PARTY_LICENSES.txt](THIRD_PARTY_LICENSES.txt) is pngdeer's notice file for the same browser build, from `web/THIRD_PARTY_LICENSES.txt` at that commit. JPEG output is encoded with mozjpeg: this software is based in part on the work of the Independent JPEG Group.

## Verify the shipped files

```bash
node scripts/check-engine.js
```

[provenance.json](provenance.json) records the full source revision, the source's Cargo.lock hash, the three shipped file hashes, and the compiler versions read directly from the WASM `producers` section:

- Rust 1.99.1 (`58cf8f9c3`, October 13, 2026)
- Clang 15.0.7, Amazon Linux package `15.0.7-3.amzn2023.0.4`
- wasm-bindgen 0.2.129 (`165586f85`) and its walrus 0.27.2

The source license notice matches the shipped notice byte for byte. These checks establish file integrity and observed build metadata, not source correspondence.

## Build and compare

Requires Node and Docker with `linux/amd64` support; an ARM host can use Docker's emulation. Run from the repository root:

```bash
node scripts/build-engine.js --output /tmp/pngdeer-engine-build
```

The output directory must not exist. Omitting `--output` creates a temporary one. The command never replaces `engine/`.

The recipe in [scripts/engine](../scripts/engine) pins the source commit, Cargo.lock checksum, Amazon Linux image digest and repository release, exact Clang/LLVM packages, and SHA-256 hashes for the Rust components and wasm-bindgen executable. Cargo downloads dependencies using the checked-in lockfile. It then builds the single-threaded `pngdeer-wasm` package twice in separate clean containers with networking disabled, different source directories, fixed timestamps and remapped source paths. It runs wasm-bindgen directly; neither wasm-pack nor wasm-opt is part of the upstream single-threaded build.

The output includes `first/`, `second/`, and `results.json`. The command fails if the two clean builds differ. It separately reports whether each generated file matches the shipped version. A repeatable build that differs from the shipped engine is a candidate for review, not proof of the shipped engine's source. This distinction is also reported as annotations by the [Engine build workflow](../.github/workflows/engine.yml), which runs on relevant pushes and pull requests and saves both outputs as an artifact.

The [November 1, 2026 verification](https://github.com/lndgalante/oxlint-plugin-pngdeer/actions/runs/41345127325) built the pinned source twice with identical results. Both the generated JavaScript and license notice matched the shipped files. The generated WASM hash was `1b323a92d27f69913706ea8e9fea20e823cd0df7e4bcccebb6e8c362fdca6cdc`; the shipped WASM hash remains `ad2351d25459d45c84a22b847c932b01dfa31cfea1f9ca4b89d5139bff72cd8e`. This verifies repeatability of the source build, while correspondence of the shipped WASM to that source remains unverified. The shipped files were not replaced.

To update the engine, review the upstream changes and licenses, update the pinned inputs, and obtain passing clean-build comparisons. Compare PNG and JPEG output against the fixtures and benchmark corpus before replacing the WASM, glue and notice together. Update `provenance.json`, run `node scripts/check-engine.js`, `npm test` and `npm run check:package`, and document the engine change in release notes. A change to the WASM invalidates users' measurement caches.
