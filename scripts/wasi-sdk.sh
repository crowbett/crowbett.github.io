#!/usr/bin/env bash
# Installs the pinned wasi-sdk that `wasm build` compiles C++ demos with (docs/demo-contract.md §C++ bridge).
set -euo pipefail

version=34.0
case "$(uname -sm)" in
  "Darwin arm64") plat=arm64-macos sha=9c59398106b417f8f14913380fdf0097a8cc0ff4af9eb3ce0065a859e88d49e9 ;;
  "Darwin x86_64") plat=x86_64-macos sha=87d27fa8adc68dee59bfbf2e22a6d34ef717c34d6bf1d8af2a56fc929d9ce0eb ;;
  "Linux x86_64") plat=x86_64-linux sha=b761e3a0721dbae9c09a0059e5fdb2bf917d1b4a8a7b430fb3b5aafb0984b2c4 ;;
  "Linux aarch64") plat=arm64-linux sha=f7e243dff54d60bcc576e94d6166b69f410f2500ae4a9ceef34315be10e77971 ;;
  *) echo "wasi-sdk: no pinned build for $(uname -sm)" >&2; exit 1 ;;
esac
name="wasi-sdk-$version-$plat"
base="${XDG_CACHE_HOME:-$HOME/.cache}/crowbett-wasm"
if [ "$(head -n1 "$base/$name/VERSION" 2>/dev/null)" = "$version" ]; then
  echo "$base/$name is installed"
  exit 0
fi
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
curl -fsSL -o "$work/$name.tar.gz" "https://github.com/WebAssembly/wasi-sdk/releases/download/wasi-sdk-${version%.0}/$name.tar.gz"
echo "$sha  $work/$name.tar.gz" | shasum -a 256 -c --quiet
mkdir -p "$base"
tar -xzf "$work/$name.tar.gz" -C "$work"
rm -rf "${base:?}/$name"
mv "$work/$name" "$base/$name"
echo "installed $base/$name"
