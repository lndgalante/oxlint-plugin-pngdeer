#!/bin/sh
set -eu

work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
cd "$work"

install_rust() {
  component=$1
  checksum=$2
  curl --fail --location --retry 3 --proto '=https' --tlsv1.2 \
    "https://static.rust-lang.org/dist/2026-10-15/$component.tar.xz" -o component.tar.xz
  echo "$checksum  component.tar.xz" | sha256sum -c -
  tar -xf component.tar.xz
  sh "$component/install.sh" --prefix=/opt/rust --disable-ldconfig
}

install_rust rustc-1.99.1-x86_64-unknown-linux-gnu 2ff05ff9c08a90861e7f6e4065b40a8b87463b4576186fd613871c3e37f2091f
install_rust cargo-1.99.1-x86_64-unknown-linux-gnu 53f3521949404d595efb06a55c12c5658d4ed1c75566f33d3d514eaebe70bd8a
install_rust rust-std-1.99.1-x86_64-unknown-linux-gnu 109b074225bf5b9ea3820890876bfdf4ed161adbfaf94b2b4b5984c85ee5d958
install_rust rust-std-1.99.1-wasm32-unknown-unknown 5f628f857dd00a8aa3fcac2e275665d2782066a5795274ed124c5b560f46423c

curl --fail --location --retry 3 --proto '=https' --tlsv1.2 \
  https://github.com/wasm-bindgen/wasm-bindgen/releases/download/0.2.129/wasm-bindgen-0.2.129-x86_64-unknown-linux-musl.tar.gz -o bindgen.tar.gz
echo '82d12bb940e2d4e72e0d5605387fc1b8ca179044e012b620f0ce4e7440e8320e  bindgen.tar.gz' | sha256sum -c -
mkdir -p /opt/bindgen
tar -xf bindgen.tar.gz
cp wasm-bindgen-0.2.129-x86_64-unknown-linux-musl/wasm-bindgen /opt/bindgen/
/opt/rust/bin/rustc --version
/opt/bindgen/wasm-bindgen --version
clang --version
