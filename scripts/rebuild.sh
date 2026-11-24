#!/bin/sh
# Pinned esbuild and hermes-plugin-ui-kit go into .build/ (gitignored), so the plugin root never carries a
# package.json: Hermes would offer an npm install for it on every plugin install.
# Usage: sh scripts/rebuild.sh (needs node and npm)
set -eu

here=$(cd "$(dirname "$0")" && pwd)
build=$(dirname "$here")/.build

mkdir -p "$build"
cat > "$build/package.json" <<'JSON'
{
  "name": "plugin-build",
  "private": true,
  "devDependencies": {
    "esbuild": "0.28.2",
    "hermes-plugin-ui-kit": "0.1.0"
  }
}
JSON
cp "$here/build-lock.json" "$build/package-lock.json"
(cd "$build" && npm ci --ignore-scripts --no-audit --no-fund)

ESBUILD_DIR=$build node "$here/build.mjs"
