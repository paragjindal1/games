#!/usr/bin/env sh
# Packs the Lens for upload to My Lenses: index.html at the zip root,
# relative paths only, nothing fetched at runtime.
set -e
cd "$(dirname "$0")/.."
mkdir -p release
rm -f release/bridge-war.zip
zip -9 -q -r release/bridge-war.zip index.html style.css game.js snap-api.js three.bundle.js LICENSE-three.txt fonts
ls -l release/bridge-war.zip
# The upload kit: the Lens plus its icon and preview video, ready for My Lenses.
rm -f release/bridge-war-upload-kit.zip
mkdir -p release/.kit && cp release/bridge-war.zip marketing/icon.png marketing/icon-512.png marketing/preview.mp4 release/.kit/
(cd release/.kit && zip -9 -q ../bridge-war-upload-kit.zip bridge-war.zip icon.png icon-512.png preview.mp4)
rm -rf release/.kit
ls -l release/bridge-war-upload-kit.zip
