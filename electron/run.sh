#!/bin/bash
DIR="$(dirname "$(readlink -f "$0")")"
"$DIR/termix" --no-sandbox "$@"
