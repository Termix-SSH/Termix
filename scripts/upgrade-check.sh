#!/usr/bin/env bash
# Upgrades a 2.9.1 database to this tree on real Postgres and MySQL servers,
# then runs the dialect-aware backend tests against both.
#
# Needs Docker and the 2.9.1 tag (git fetch --tags). Run from anywhere:
#   bash scripts/upgrade-check.sh            # both engines
#   bash scripts/upgrade-check.sh mysql      # one engine
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TAG="release-2.9.1-tag"
PG="termix-upgrade-check-pg"
MY="termix-upgrade-check-mysql"
if [ "$#" -gt 0 ]; then
  DIALECTS=("$@")
else
  DIALECTS=(postgres mysql)
fi

cd "$ROOT"

if ! git rev-parse -q --verify "refs/tags/$TAG" >/dev/null; then
  echo "Tag $TAG is missing. Run git fetch --tags first." >&2
  exit 1
fi

WORK="$(mktemp -d)"
cleanup() {
  docker rm -f "$PG" "$MY" >/dev/null 2>&1 || true
  rm -rf "$WORK"
}
trap cleanup EXIT

git archive "$TAG" drizzle | tar -x -C "$WORK"
mkdir -p "$WORK/data"

docker rm -f "$PG" "$MY" >/dev/null 2>&1 || true
docker run -d --name "$PG" -e POSTGRES_USER=termix -e POSTGRES_PASSWORD=termix \
  -e POSTGRES_DB=termix -p 55433:5432 postgres:16 >/dev/null
docker run -d --name "$MY" -e MYSQL_ROOT_PASSWORD=termix -e MYSQL_DATABASE=termix \
  -p 33307:3306 mysql:8 >/dev/null

wait_for() {
  for _ in $(seq 1 60); do
    if "$@" >/dev/null 2>&1; then return 0; fi
    sleep 2
  done
  echo "Timed out waiting for: $*" >&2
  exit 1
}
wait_for docker exec "$PG" pg_isready -U termix -d termix
wait_for docker exec "$MY" mysql -uroot -ptermix -e "SELECT 1"
docker exec "$PG" psql -U termix -c "CREATE DATABASE termix_test" >/dev/null
docker exec "$MY" mysql -uroot -ptermix -e "CREATE DATABASE termix_test" 2>/dev/null

TESTS=$(grep -rl "test-support" src/backend/tests --include="*.test.ts")

status=0
for dialect in "${DIALECTS[@]}"; do
  case "$dialect" in
    postgres) base="postgres://termix:termix@127.0.0.1:55433" ;;
    mysql) base="mysql://root:termix@127.0.0.1:33307" ;;
    *)
      echo "Unknown dialect $dialect (postgres or mysql)" >&2
      exit 2
      ;;
  esac
  echo
  echo "== 2.9.1 to this tree on $dialect"
  if ! DATA_DIR="$WORK/data" npx tsx scripts/upgrade-check.mjs \
    "$dialect" "$base/termix" "$WORK/drizzle"; then
    status=1
  fi
  echo
  echo "== dialect tests on $dialect"
  # One file at a time: they share the database and wipe it between tests.
  # shellcheck disable=SC2086
  if ! TEST_DIALECT="$dialect" TEST_DATABASE_URL="$base/termix_test" \
    npx vitest run --project backend --no-file-parallelism $TESTS; then
    status=1
  fi
done

exit "$status"
