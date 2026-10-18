#!/usr/bin/env sh
# Packs the Lens for upload to My Lenses: index.html at the zip root,
# relative paths only, nothing fetched at runtime.
set -e
cd "$(dirname "$0")/.."
mkdir -p dist
rm -f dist/bloom-guard.zip
zip -9 -q dist/bloom-guard.zip index.html style.css game.js snap-api.js
ls -l dist/bloom-guard.zip
