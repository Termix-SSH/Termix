#!/bin/bash
set -e

VERSION="$1"
CHECKSUM="$2"
RELEASE_DATE="$3"

if [ -z "$VERSION" ] || [ -z "$CHECKSUM" ] || [ -z "$RELEASE_DATE" ]; then
  echo "Usage: $0 <version> <checksum> <release-date>"
  echo "Example: $0 1.8.0 abc123... 2025-10-26"
  exit 1
fi

echo "Preparing Flatpak submission for version $VERSION"

cp public/icon.svg flatpak/com.karmaa.termix.svg
echo "✓ Copied SVG icon"

if command -v convert &> /dev/null; then
  convert public/icon.png -resize 256x256 flatpak/icon-256.png
  convert public/icon.png -resize 128x128 flatpak/icon-128.png
  echo "✓ Generated PNG icons"
else
  cp public/icon.png flatpak/icon-256.png
  cp public/icon.png flatpak/icon-128.png
  echo "⚠ ImageMagick not found, using original icon"
fi

sed -i "s/VERSION_PLACEHOLDER/$VERSION/g" flatpak/com.karmaa.termix.yml
sed -i "s/CHECKSUM_PLACEHOLDER/$CHECKSUM/g" flatpak/com.karmaa.termix.yml
echo "✓ Updated manifest with version $VERSION"

sed -i "s/VERSION_PLACEHOLDER/$VERSION/g" flatpak/com.karmaa.termix.metainfo.xml
sed -i "s/DATE_PLACEHOLDER/$RELEASE_DATE/g" flatpak/com.karmaa.termix.metainfo.xml
