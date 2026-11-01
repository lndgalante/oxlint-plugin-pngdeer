#!/bin/sh
set -eu

# Each invocation starts in a fresh container, with no target artifacts or network access.
build=$1
mkdir "$build"
cp -a /source/. "$build/"
cd "$build"
export CARGO_TARGET_DIR=/target
export RUSTFLAGS="--remap-path-prefix=$build=/src --remap-path-prefix=/opt/cargo=/cargo"
export CFLAGS_wasm32_unknown_unknown="-ffile-prefix-map=$build=/src -ffile-prefix-map=/opt/cargo=/cargo"
cargo build --frozen --release --target wasm32-unknown-unknown -p pngdeer-wasm
wasm-bindgen --target web --no-typescript --out-dir /output /target/wasm32-unknown-unknown/release/pngdeer_wasm.wasm
cp web/THIRD_PARTY_LICENSES.txt /output/
