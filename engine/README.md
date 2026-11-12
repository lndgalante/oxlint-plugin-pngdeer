# engine

slimdeer 0.3.1's single-threaded WebAssembly build with AVIF output, and its wasm-bindgen glue: upstream's `web/pkg-avif`, built with `-p slimdeer-wasm --features avif` (`web/build.sh`). One build writes PNG, JPEG, WebP and AVIF. Its source is [heydeer/slimdeer at 38ce560d4ac3016118799db8499487433bfd5d9b](https://github.com/heydeer/slimdeer/tree/38ce560d4ac3016118799db8499487433bfd5d9b) (tag v0.3.1). heydeer/slimdeer's main at eafae5e changes only the command line, its tests, the README and the web page since then, so it compiles the same WebAssembly sources from the same Cargo.lock. It is the build heydeer.ai deploys: on November 12, 2026, heydeer.ai served these same three files (the WASM and glue under heydeer.ai/open-source/slimdeer/pkg-avif/).

| File | SHA-256 |
|---|---|
| `slimdeer_wasm_bg.wasm` | `42eac0c5b6eaada24c0137b6fa180d4c8dc53752dee01c3faef745c00f16a0a9` |
| `slimdeer_wasm.js` | `4e7d7b2fa503072522e64d535ed107a170e3b50a3276ceb522d714cbe5467274` |
| `THIRD_PARTY_LICENSES.txt` | `c87ddc19882afc2246fded2d13cdb27565079635f8787b46a0b1b7bea7aec8be` |

## The cache's identity

The cache names the engine output its entries describe with `outputIdentity` in [provenance.json](provenance.json), `ad2351d25459d45c`, which is `ENGINE` in `src/cache.js`. It is the first 16 hex digits of the SHA-256 of the build whose PNG and JPEG output the entries describe: the wasm that 0.1.0 to 0.5.0 shipped. It is not this wasm's hash because this build writes the same PNG and JPEG bytes as that one, so results measured by earlier versions still count.

`test/engine-output.test.js` guards this, and checks that `ENGINE` and `outputIdentity` agree. It compresses five of `example/`'s six images (all but `hero.png`) at the automatic target and at 80, and compares each file's hash, outcome and score with the ones recorded from the old build. It also pins one WebP and one AVIF file from this build, with their score, mode and reported target, because the WebP and AVIF cache keys name `ENGINE` too. If it fails after an engine change, `ENGINE` and `outputIdentity` become the new wasm's first 16 hex digits, and every image is measured again once.

## Licenses

[THIRD_PARTY_LICENSES.txt](THIRD_PARTY_LICENSES.txt) is upstream's `web/THIRD_PARTY_LICENSES.txt` at 38ce560, unchanged; it covers all of upstream's browser builds. Next to the notice 0.5.0 shipped, it adds the entries of slimdeer-libaom 3.15.2: libaom's BSD-2-Clause license, the Alliance for Open Media Patent License 1.0, and the licenses of fastfeat (Edward Rosten), vector (Peter Goldsborough) and SIMDe (Evan Nemerson), listed under the same crate. JPEG output is encoded with mozjpeg: this software is based in part on the work of the Independent JPEG Group.

## Verify the shipped files

```bash
node scripts/check-engine.js
```

[provenance.json](provenance.json) records the source revision and tag, the source's Cargo.lock hash, the package and feature built, the cache's output identity, the clean-build verification, the three shipped file hashes, and the compiler versions read from the wasm's `producers` section:

- Rust 1.99.1 (`58cf8f9c3`, October 13, 2026)
- Clang 23.1.0 from wasi-sdk 34 (`23.1.0-wasi-sdk`, LLVM `895aa2c896ada719451be2e3673c83da8ddf1141`)
- wasm-bindgen 0.2.129 (`165586f85`) and its walrus 0.27.2

0.5.0's engine was compiled with Amazon Linux's Clang 15. This one uses wasi-sdk's Clang 23, as upstream's own deploy does (`web/vercel-build.sh`), because upstream says Amazon Linux's Clang 15 builds libaom's SIMD code into code that writes other AVIF files.

The check compares the three files with their recorded hashes and the `producers` section with the recorded versions. The notice in the source matches the shipped notice byte for byte. Rebuilding, below, verifies that the files come from the pinned source.

## Build and compare

Requires Node and Docker with `linux/amd64` support. Run from the repository root:

```bash
node scripts/build-engine.js --output /tmp/slimdeer-engine-build
```

The output directory must not exist. Omitting `--output` creates a temporary one. The command never replaces `engine/`.

The recipe in [scripts/engine](../scripts/engine) pins the source commit, the Cargo.lock checksum, the Amazon Linux image digest and repository release, and SHA-256 hashes for the Rust components, the wasm-bindgen release and wasi-sdk 34, whose clang and llvm-ar compile the C code (libdeflate, libwebp, mozjpeg and libaom). Cargo downloads dependencies using the checked-in lockfile. The recipe then builds `-p slimdeer-wasm --features avif` twice in separate clean containers with networking disabled, different source directories, fixed timestamps and remapped source paths. It runs wasm-bindgen directly; neither wasm-pack nor wasm-opt is part of upstream's build.

The output holds `first/`, `second/` and `results.json`. The command prints each file's hash and whether both builds agree and match the shipped file, then fails if the two builds differ from each other or from the shipped files. The [Engine build workflow](../.github/workflows/engine.yml) runs it on relevant pushes and pull requests, reports each file as an annotation, and saves both builds as an artifact.

The [November 12, 2026 verification](https://github.com/lndgalante/oxlint-plugin-slimdeer/actions/runs/43150215691) built the pinned source twice in clean containers in 9 minutes 19 seconds, with rustc 1.99.1 and wasi-sdk 34's clang 23.1.0. Both builds reproduced the shipped WASM, JavaScript and license notice byte for byte (`repeatable=true; matches vendored=true` for all three files). This verifies both repeatability and source correspondence for the pinned inputs. The recipe remaps dependency paths to `/rust`, the path embedded in the shipped WASM; another prefix changes panic-location strings and the file's hash.

To update the engine, review upstream's changes and licenses, update the pinned inputs, and get a passing clean-build comparison. Replace the WASM, glue and notice together, update `provenance.json`, and run `node scripts/check-engine.js`, `npm test` and `npm run check:package`. If `test/engine-output.test.js` fails, change the cache's identity as described above. The test checks a sample, so before keeping `ENGINE`, also compare the old and new engine's `compress()` (output hash, outcome and score) on the example, docs and benchmark images (`bench/fetch.js` downloads them) at the automatic target and at 60, 80 and 95, and their `convert()` to WebP and AVIF at a few of those scores. Note the engine change in the release notes.

0.1.0 to 0.5.0 vendored heydeer/pngdeer at a8e8826, the engine's former name.
