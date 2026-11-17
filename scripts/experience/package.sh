#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/../.."
output=${1:-dist/experience}
mkdir -p "$output"
output=$(cd "$output" && pwd)
scratch=$(mktemp -d)
trap 'rm -rf "$scratch"' EXIT

# Build from the release commit, without worktree changes, installed modules or home data.
source="$scratch/source"
mkdir "$source"
git archive HEAD backend frontend packages scripts/experience .nvmrc | tar -xf - -C "$source"
cd "$source"
version=$(cat .nvmrc)
test "$(node -v)" = "v$version"
npm ci --prefix frontend
npm run build --prefix frontend
npm ci --prefix backend --omit=dev --omit=optional --ignore-scripts

package="$scratch/Smart Home"
mkdir -p "$package/backend" "$package/frontend" "$package/runtime"
frontend/node_modules/.bin/esbuild backend/server.mjs --bundle --platform=node --format=esm --target=node26 \
  --banner:js='import { createRequire } from "node:module"; const require = createRequire(import.meta.url);' \
  --outfile="$package/backend/server.mjs"
find backend/node_modules frontend/node_modules -type f \( -iname 'license*' -o -iname 'copying*' -o -iname 'notice*' \) -print0 |
  while IFS= read -r -d '' notice; do
    printf '\n--- %s ---\n\n' "$notice"
    cat "$notice"
  done > "$package/THIRD-PARTY-NOTICES.txt"
mv frontend/dist "$package/frontend/"
test -f "$package/frontend/dist/index.html"
test ! -e "$package/backend/data"
test -z "$(find "$package" -name node_modules -print)"

dist="https://nodejs.org/dist/v$version"
prefix="node-v$version"
archives=("$prefix-darwin-arm64.tar.xz" "$prefix-darwin-x64.tar.xz" "$prefix-win-x64.zip")
downloads=()
for file in SHASUMS256.txt "${archives[@]}"; do
  downloads+=(-o "$scratch/$file" "$dist/$file")
done
curl -fsSL --parallel --fail-early --retry 2 "${downloads[@]}"

for archive in "${archives[@]}"; do
  (cd "$scratch" && awk -v archive="$archive" '$2 == archive' SHASUMS256.txt | shasum -a 256 -c -)

  if [[ "$archive" == *.zip ]]; then
    name=${archive%.zip}
    asset=smart-home-windows-x64.zip
    unzip -p "$scratch/$archive" "$name/node.exe" > "$package/runtime/node.exe"
    unzip -p "$scratch/$archive" "$name/LICENSE" > "$package/runtime/LICENSE"
    awk '{printf "%s\r\n", $0}' scripts/experience/start.cmd > "$package/Start Smart Home.cmd"
  else
    name=${archive%.tar.xz}
    asset="smart-home-macos-${name##*-}.zip"
    tar -xOf "$scratch/$archive" "$name/bin/node" > "$package/runtime/node"
    tar -xOf "$scratch/$archive" "$name/LICENSE" > "$package/runtime/LICENSE"
    cp scripts/experience/start.command "$package/Start Smart Home.command"
    chmod +x "$package/runtime/node" "$package/Start Smart Home.command"
  fi
  (cd "$scratch" && zip -Xqr "$asset" 'Smart Home' && unzip -tq "$asset")
  mv "$scratch/$asset" "$output/"
  rm -f "$package/Start Smart Home.cmd" "$package/Start Smart Home.command" "$package/runtime/node" "$package/runtime/node.exe"
done
