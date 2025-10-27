#!/bin/bash
set -e

# This script prepares the Flatpak submission files
# It should be run from the repository root

VERSION="$1"
CHECKSUM="$2"
RELEASE_DATE="$3"

if [ -z "$VERSION" ] || [ -z "$CHECKSUM" ] || [ -z "$RELEASE_DATE" ]; then
  echo "Usage: $0 <version> <checksum> <release-date>"
  echo "Example: $0 1.8.0 abc123... 2025-10-26"
  exit 1
fi

echo "Preparing Flatpak submission for version $VERSION"

# Copy icon files
cp public/icon.svg flatpak/com.karmaa.termix.svg
echo "✓ Copied SVG icon"

# Generate PNG icons if ImageMagick is available
if command -v convert &> /dev/null; then
  convert public/icon.png -resize 256x256 flatpak/icon-256.png
  convert public/icon.png -resize 128x128 flatpak/icon-128.png
  echo "✓ Generated PNG icons"
else
  # Fallback: just copy the original PNG
  cp public/icon.png flatpak/icon-256.png
  cp public/icon.png flatpak/icon-128.png
  echo "⚠ ImageMagick not found, using original icon"
fi

# Update manifest with version and checksum
sed -i "s/VERSION_PLACEHOLDER/$VERSION/g" flatpak/com.karmaa.termix.yml
sed -i "s/CHECKSUM_PLACEHOLDER/$CHECKSUM/g" flatpak/com.karmaa.termix.yml
echo "✓ Updated manifest with version $VERSION"

# Update metainfo with version and date
sed -i "s/VERSION_PLACEHOLDER/$VERSION/g" flatpak/com.karmaa.termix.metainfo.xml
sed -i "s/DATE_PLACEHOLDER/$RELEASE_DATE/g" flatpak/com.karmaa.termix.metainfo.xml
echo "✓ Updated metainfo with version $VERSION and date $RELEASE_DATE"

echo ""
echo "✅ Flatpak submission files prepared!"
echo ""
echo "Next steps:"
echo "1. Review the files in the flatpak/ directory"
echo "2. Fork https://github.com/flathub/flathub"
echo "3. Create a new branch named 'com.karmaa.termix'"
echo "4. Copy all files from flatpak/ to the root of your fork"
echo "5. Commit and push to your fork"
echo "6. Open a PR to flathub/flathub"
