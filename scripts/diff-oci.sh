#!/usr/bin/env bash
# Lists what differs between two single platform OCI archives: config, layer
# digests, then the files inside each layer that differ.
# Usage: scripts/diff-oci.sh image-a.tar image-b.tar
set -euo pipefail

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

for side in a b; do
  mkdir -p "$work/$side"
done
tar -xf "$1" -C "$work/a"
tar -xf "$2" -C "$work/b"

blob() { echo "$work/$1/blobs/sha256/${2#sha256:}"; }
manifest() { blob "$1" "$(jq -r '.manifests[0].digest' "$work/$1/index.json")"; }

ma="$(manifest a)"
mb="$(manifest b)"

if [ "$(jq -r .config.digest "$ma")" != "$(jq -r .config.digest "$mb")" ]; then
  echo "Config differs:"
  diff <(jq -S 'del(.rootfs)' "$(blob a "$(jq -r .config.digest "$ma")")") \
    <(jq -S 'del(.rootfs)' "$(blob b "$(jq -r .config.digest "$mb")")") || true
fi

count="$(jq '.layers | length' "$ma")"
for ((i = 0; i < count; i++)); do
  la="$(jq -r ".layers[$i].digest" "$ma")"
  lb="$(jq -r ".layers[$i].digest" "$mb" 2>/dev/null || echo none)"
  [ "$la" = "$lb" ] && continue
  echo "Layer $i differs"
  for side in a b; do
    dir="$work/layer-$side"
    rm -rf "$dir" && mkdir -p "$dir"
    digest="$la"
    [ "$side" = b ] && digest="$lb"
    tar -xzf "$(blob "$side" "$digest")" -C "$dir" 2>/dev/null ||
      tar -xf "$(blob "$side" "$digest")" -C "$dir"
    (cd "$dir" && find . -type f -print0 | sort -z | xargs -0 -r sha256sum) >"$work/sum-$side"
  done
  diff "$work/sum-a" "$work/sum-b" | head -50 || true
done
