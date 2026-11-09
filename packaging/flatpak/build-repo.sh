#!/usr/bin/env bash
# Builds a signed Flatpak repo and bundle from the release's portable tarballs.
# Usage: build-repo.sh <version> <tarball dir> <output dir>
# Env: FLATPAK_GPG_KEY_ID, FLATPAK_GPG_HOME, FLATPAK_REPO_URL, FLATPAK_ARCHES (optional),
#      FLATPAK_IMPORT (optional, folder of <arch>.flatpak bundles built on another machine)
set -euo pipefail

VERSION="$1"
TARBALLS="$(realpath "$2")"
mkdir -p "$3"
OUTPUT="$(realpath "$3")"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
ARCHES="${FLATPAK_ARCHES:-x86_64 aarch64}"
APP_ID=com.karmaa.termix
WORK="$OUTPUT/.work"
rm -rf "$WORK"
mkdir -p "$WORK"
trap 'rm -rf "$WORK"' EXIT

cd "$WORK"
cp "$ROOT"/packaging/flatpak/$APP_ID.{yml,desktop,metainfo.xml} .
cp "$ROOT/public/icon.svg" "$APP_ID.svg"
convert "$ROOT/public/icon.png" -resize 256x256 icon-256.png
convert "$ROOT/public/icon.png" -resize 128x128 icon-128.png
for arch in $ARCHES; do
  case "$arch" in
    x86_64) cp "$TARBALLS/termix_linux_x64_portable.tar.gz" termix-x86_64.tar.gz ;;
    aarch64) cp "$TARBALLS/termix_linux_arm64_portable.tar.gz" termix-aarch64.tar.gz ;;
  esac
done

sed -i "s/VERSION_PLACEHOLDER/$VERSION/g; s/DATE_PLACEHOLDER/$(date +%Y-%m-%d)/g" "$APP_ID.metainfo.xml"

for arch in $ARCHES; do
  flatpak-builder --user --arch="$arch" --install-deps-from=flathub \
    --default-branch=stable --force-clean --disable-rofiles-fuse --repo=repo \
    --gpg-sign="$FLATPAK_GPG_KEY_ID" --gpg-homedir="$FLATPAK_GPG_HOME" \
    "build-$arch" "$APP_ID.yml"
done

ALL_ARCHES="$ARCHES"
if [ -n "${FLATPAK_IMPORT:-}" ]; then
  for bundle in "$FLATPAK_IMPORT"/*.flatpak; do
    flatpak build-import-bundle --gpg-sign="$FLATPAK_GPG_KEY_ID" --gpg-homedir="$FLATPAK_GPG_HOME" \
      repo "$bundle"
    ALL_ARCHES="$ALL_ARCHES $(basename "$bundle" .flatpak)"
  done
fi

flatpak build-update-repo --title=Termix --default-branch=stable \
  --generate-static-deltas --prune \
  --gpg-sign="$FLATPAK_GPG_KEY_ID" --gpg-homedir="$FLATPAK_GPG_HOME" repo

gpg --homedir "$FLATPAK_GPG_HOME" --export "$FLATPAK_GPG_KEY_ID" > termix.gpg
GPG_KEY="$(base64 -w0 termix.gpg)"

for arch in $ALL_ARCHES; do
  name=termix_linux_flatpak.flatpak
  [ "$arch" = x86_64 ] || name="termix_linux_${arch}_flatpak.flatpak"
  flatpak build-bundle repo "$OUTPUT/$name" "$APP_ID" stable --arch="$arch" \
    --repo-url="$FLATPAK_REPO_URL" --gpg-keys=termix.gpg \
    --runtime-repo=https://flathub.org/repo/flathub.flatpakrepo
done

mv repo "$OUTPUT/site"
for file in $APP_ID.flatpakref termix.flatpakrepo; do
  sed "s|REPO_URL_PLACEHOLDER|$FLATPAK_REPO_URL|; s|GPG_KEY_PLACEHOLDER|$GPG_KEY|" \
    "$ROOT/packaging/flatpak/$file" > "$OUTPUT/site/$file"
done
cp "$OUTPUT/site/$APP_ID.flatpakref" "$OUTPUT/"
