#!/usr/bin/env bash
# Spins up a throwaway Postgres, applies supabase/schemas/*.sql in order, runs tests/*.test.sql.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"; D="${PGTMP:-/tmp/eq_pg}"; PORT=54999
BIN=$(ls -d /usr/lib/postgresql/*/bin | tail -1)
rm -rf "$D"; mkdir -p "$D"; chown postgres "$D" 2>/dev/null || true
as_pg() { if [ "$(id -u)" = 0 ]; then runuser -u postgres -- "$@"; else "$@"; fi; }
as_pg $BIN/initdb -D "$D/data" -A trust >/dev/null
as_pg $BIN/pg_ctl -D "$D/data" -o "-p $PORT -k $D" -l "$D/log" -w start >/dev/null
trap 'as_pg $BIN/pg_ctl -D "$D/data" -m immediate stop >/dev/null' EXIT
P="psql -h $D -p $PORT -U postgres -v ON_ERROR_STOP=1 -q -X"
as_pg createdb -h "$D" -p $PORT eq
P="$P -d eq"
as_pg $P -f "$ROOT/tests/bootstrap.sql"
for f in "$ROOT"/schemas/*.sql; do echo "apply $(basename $f)"; as_pg $P -f "$f"; done
for t in "$ROOT"/tests/*.test.sql; do echo "== $(basename $t)"; as_pg $P -f "$t"; done
echo "ALL DATABASE TESTS PASSED"
