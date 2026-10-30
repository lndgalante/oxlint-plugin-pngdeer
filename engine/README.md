# engine

pngdeer's single-threaded WebAssembly build and its wasm-bindgen glue (`web/build.sh`'s `web/pkg`), as deployed at heydeer.ai/open-source/pngdeer on October 30, 2026. It matches [heydeer/pngdeer](https://github.com/heydeer/pngdeer) at `a8e8826` (0.2.1, plus JPEG input and output), the last commit to touch its code before that deploy. It was not built from source here.

| File | SHA-256 |
|---|---|
| `pngdeer_wasm_bg.wasm` | `ad2351d25459d45c84a22b847c932b01dfa31cfea1f9ca4b89d5139bff72cd8e` |
| `pngdeer_wasm.js` | `9e990aa28b18e2ea58dcaf31a4d091db8dd5ce4a2ba13c579c31a127dc4aa21f` |

The cache keys results by the wasm's hash (`src/cache.js`), so a new engine measures everything again.

[THIRD_PARTY_LICENSES.txt](THIRD_PARTY_LICENSES.txt) is pngdeer's notice file for the same browser build, from `web/THIRD_PARTY_LICENSES.txt` at that commit. JPEG output is encoded with mozjpeg: this software is based in part on the work of the Independent JPEG Group.
