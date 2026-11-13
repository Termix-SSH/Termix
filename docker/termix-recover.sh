#!/bin/sh
# Break glass from inside the container: docker exec termix termix-recover ...
# Runs as the owner of the data folder, the same user as the server.
set -e
data="${DATA_DIR:-/app/data}"
owner="$(stat -c %u "$data")"
if [ "$(id -u)" = "0" ] && [ "$owner" != "0" ]; then
  exec gosu "$owner" node --disable-sigusr1 /app/dist/backend/recovery/cli.js "$@"
fi
exec node --disable-sigusr1 /app/dist/backend/recovery/cli.js "$@"
