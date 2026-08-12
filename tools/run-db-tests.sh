#!/usr/bin/env bash
#
# Runs the database test scripts in supabase/tests/ against a Postgres database.
#
#   ./tools/run-db-tests.sh "postgresql://postgres:postgres@127.0.0.1:54322/postgres"
#
# These are NOT pgTAP, despite years of being described that way. They are plain
# psql scripts using `do $$ ... raise exception` assertions, so `supabase test db`
# (which runs pg_prove and expects TAP output) cannot run them. They are executed
# with ON_ERROR_STOP=1, so a raised assertion fails the script and the run.
#
# Their real value is RLS regression coverage: 004 (role hierarchy), 008
# (profiles write lockdown) and 009 (business_holidays RLS) assert the boundaries
# that separate one ISO's data from another's.
#
# Run against a database built by `supabase db reset`. They assume a clean
# schema and insert their own fixtures.

set -uo pipefail

DB_URL="${1:-}"
if [ -z "$DB_URL" ]; then
  echo "usage: $0 <postgres-connection-string>" >&2
  exit 2
fi

# Not executable tests, excluded deliberately rather than deleted:
#
#   demo_data_reset.sql    Documented manual checks. Needs a signed-in JWT
#                          context that psql cannot provide.
#
#   business_days_parity.sql
#                          Tests add_business_days() and
#                          disposition_business_days(), which exist in NO
#                          migration. Its own header says it was "written ahead
#                          of time so it can be run the moment 003 lands" —
#                          that migration never landed. Follow-up scheduling is
#                          implemented in TypeScript only
#                          (apps/app/src/lib/followUpScheduling.ts,
#                          calculateFollowUpDate). Kept so it is ready if a SQL
#                          implementation is ever added; until then there is
#                          nothing for it to check.
EXCLUDE=("demo_data_reset.sql" "business_days_parity.sql")

# Prefer a local psql (present on GitHub's ubuntu-latest runners). Fall back to
# running psql inside the local Supabase container, so the script also works on a
# developer machine that has Docker but no postgresql-client installed, which is
# the case on the machine this was written on.
if command -v psql >/dev/null 2>&1; then
  run_sql() { psql "$DB_URL" -v ON_ERROR_STOP=1 -q -f "$1" 2>&1 >/dev/null; }
else
  DB_CONTAINER="$(docker ps --format '{{.Names}}' 2>/dev/null | grep '^supabase_db_' | head -1)"
  if [ -z "$DB_CONTAINER" ]; then
    echo "Neither psql nor a running supabase_db_* container was found." >&2
    echo "Install postgresql-client, or run 'supabase start' first." >&2
    exit 2
  fi
  echo "psql not found; using container $DB_CONTAINER"
  run_sql() { docker exec -i "$DB_CONTAINER" psql -v ON_ERROR_STOP=1 -q -U postgres -d postgres -f - < "$1" 2>&1 >/dev/null; }
fi

failed=0
ran=0

for f in supabase/tests/*.sql; do
  base="$(basename "$f")"

  skip=""
  for e in "${EXCLUDE[@]}"; do
    [ "$base" = "$e" ] && skip=1
  done
  if [ -n "$skip" ]; then
    printf '  %-38s SKIP\n' "$base"
    continue
  fi

  ran=$((ran + 1))
  if err="$(run_sql "$f")"; then
    printf '  %-38s PASS\n' "$base"
  else
    printf '  %-38s FAIL\n' "$base"
    printf '%s\n' "$err" | grep -iE 'ERROR|exception' | head -3 | sed 's/^/        /'
    failed=$((failed + 1))
  fi
done

echo
if [ "$failed" -gt 0 ]; then
  echo "$failed of $ran database tests failed."
  exit 1
fi
echo "All $ran database tests passed."
