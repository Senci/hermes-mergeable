#!/bin/sh
# Pinned esbuild goes into a cache dir outside the plugin tree, so the plugin never carries a package.json.
# Usage: sh scripts/rebuild.sh (needs node and npm; MERGEABLE_BUILD_DIR overrides the cache dir)
set -eu

here=$(cd "$(dirname "$0")" && pwd)
cache=${MERGEABLE_BUILD_DIR:-${XDG_CACHE_HOME:-$HOME/.cache}/mergeable-build}

mkdir -p "$cache"
cat > "$cache/package.json" <<'JSON'
{
  "name": "mergeable-build",
  "private": true,
  "devDependencies": {
    "esbuild": "0.28.2"
  }
}
JSON
cp "$here/esbuild-lock.json" "$cache/package-lock.json"
(cd "$cache" && npm ci --ignore-scripts --no-audit --no-fund)

ESBUILD_DIR=$cache node "$here/build.mjs"
