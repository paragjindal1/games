#!/usr/bin/env sh
# Packs the Lens for upload to My Lenses: index.html at the zip root,
# relative paths only, nothing fetched at runtime.
set -e
cd "$(dirname "$0")/.."
mkdir -p release
rm -f release/wordwow.zip
zip -9 -q -r release/wordwow.zip index.html style.css game.js levels.js snap-api.js fonts
ls -l release/wordwow.zip
