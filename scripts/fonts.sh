#!/usr/bin/env bash
# Rebuilds web/assets/fonts from google/fonts at a pinned commit (docs/design.md §Type).
set -euo pipefail

rev=e7db6ca603fd4862010383ff17ffd6cc4ffac1c0
base="https://raw.githubusercontent.com/google/fonts/$rev/ofl"
venv="${XDG_CACHE_HOME:-$HOME/.cache}/crowbett-fonts/venv"
out="$(cd "$(dirname "$0")/.." && pwd)/web/assets/fonts"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

if [ ! -x "$venv/bin/pyftsubset" ]; then
  python3 -m venv "$venv"
  "$venv/bin/pip" install -q "fonttools[woff]==4.67.0"
fi

fetch() { # dir file sha256
  curl -fsSLg -o "$work/$2" "$base/$1/$2"
  echo "$3  $work/$2" | shasum -a 256 -c --quiet
}
fetch archivo 'Archivo[wdth,wght].ttf' 0e094a7d3c7c4c25cf1310c4b30014f1dae9332220b1c2c88f4fa996f0b05053
fetch martianmono 'MartianMono[wdth,wght].ttf' c3467843ec1c2574b05fbcfd7147c7bfbcf63ddca8fc2bcb9d117f1bfb1b22e7
fetch doto 'Doto[ROND,wght].ttf' 6f4fe7d37853b91df3698daa84cde2dbe1c9695d88c986e6510134910337d426
curl -fsSL -o "$out/OFL-archivo.txt" "$base/archivo/OFL.txt"
curl -fsSL -o "$out/OFL-martian-mono.txt" "$base/martianmono/OFL.txt"
curl -fsSL -o "$out/OFL-doto.txt" "$base/doto/OFL.txt"

unicodes='U+0020-007E,U+00A0,U+00A9,U+00B1,U+00B5,U+00B7,U+00D7,U+2013,U+2014,U+2018,U+2019,U+201C,U+201D,U+2026,U+2190-2193,U+2212,U+2264,U+2265'

build() { # source name axes...
  local src="$1" name="$2"
  shift 2
  "$venv/bin/fonttools" varLib.instancer -q -o "$work/$name.ttf" "$work/$src" "$@"
  "$venv/bin/pyftsubset" "$work/$name.ttf" --output-file="$out/$name.woff2" --flavor=woff2 \
    --unicodes="$unicodes" --layout-features=kern,liga,tnum,zero --no-hinting --name-IDs='*'
}
build 'Archivo[wdth,wght].ttf' archivo-expanded-800 wdth=125 wght=800
build 'Archivo[wdth,wght].ttf' archivo-400 wdth=100 wght=400
build 'MartianMono[wdth,wght].ttf' martian-mono wdth=100 wght=400:700
build 'Doto[ROND,wght].ttf' doto-700 ROND=0 wght=700

wc -c "$out"/*.woff2
