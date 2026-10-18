#!/usr/bin/env sh
# Packs the Lens for upload to My Lenses: index.html at the zip root,
# relative paths only, nothing fetched at runtime.
set -e
cd "$(dirname "$0")/.."
mkdir -p release
rm -f release/bowbots.zip
zip -9 -q -r release/bowbots.zip index.html style.css game.js snap-api.js fonts
ls -l release/bowbots.zip
