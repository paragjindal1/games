#!/usr/bin/env sh
# Packs the Lens for upload to My Lenses: index.html at the zip root,
# relative paths only, nothing fetched at runtime.
set -e
cd "$(dirname "$0")/.."
mkdir -p release
rm -f release/bridge-war.zip
zip -9 -q -r release/bridge-war.zip index.html style.css game.js snap-api.js three.bundle.js LICENSE-three.txt fonts
ls -l release/bridge-war.zip
# The store assets go in their own zip. It has no index.html, so it must never
# be uploaded as the Lens: upload release/bridge-war.zip.
rm -f release/bridge-war-upload-kit.zip release/bridge-war-icon-and-video.zip
(cd marketing && zip -9 -q ../release/bridge-war-icon-and-video.zip icon.png icon-512.png preview.mp4)
ls -l release/bridge-war-icon-and-video.zip
