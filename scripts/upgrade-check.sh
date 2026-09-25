#!/usr/bin/env bash
# Upgrades the 2.8 fixture install to 2.9.0 on real Postgres and MySQL
# servers and runs the same checks the SQLite upgrade test runs.
#
# Needs Docker and a built tree (npm run build). Run from anywhere:
#   bash scripts/upgrade-check.sh            # both engines
#   bash scripts/upgrade-check.sh postgres   # one engine
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
COMPOSE=(docker compose -f "$ROOT/scripts/upgrade-check.compose.yml")
TAG="release-2.8.0-tag"
if [ "$#" -gt 0 ]; then
  DIALECTS=("$@")
else
  DIALECTS=(postgres mysql)
fi

cd "$ROOT"

if [ ! -f dist/plugins/snippets/dist/backend.js ]; then
  echo "dist/plugins is missing. Run npm run build first." >&2
  exit 1
fi
if ! git rev-parse -q --verify "refs/tags/$TAG" >/dev/null; then
  echo "Tag $TAG is missing. Run git fetch --tags first." >&2
  exit 1
fi

LEGACY="$(mktemp -d)"
cleanup() {
  "${COMPOSE[@]}" down -v >/dev/null 2>&1 || true
  rm -rf "$LEGACY"
}
trap cleanup EXIT

# 2.8's own drizzle migrations build the 2.8 schema on each server.
git archive "$TAG" drizzle | tar -x -C "$LEGACY"

"${COMPOSE[@]}" up -d --wait

status=0
for dialect in "${DIALECTS[@]}"; do
  case "$dialect" in
    postgres) url="postgres://termix:termix@127.0.0.1:55433/termix" ;;
    mysql) url="mysql://root:termix@127.0.0.1:33307/termix" ;;
    *)
      echo "Unknown dialect $dialect (postgres or mysql)" >&2
      exit 2
      ;;
  esac
  echo
  echo "== 2.8 to 2.9.0 on $dialect"
  if ! TEST_DIALECT="$dialect" TEST_DATABASE_URL="$url" \
    UPGRADE_LEGACY_MIGRATIONS_DIR="$LEGACY/drizzle" \
    npx vitest run src/backend/tests/plugins/upgrade-fixture.test.ts \
    --project backend; then
    status=1
  fi
done

exit "$status"
