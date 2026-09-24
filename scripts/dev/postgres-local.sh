#!/usr/bin/env bash
# Create the local development role and databases on an existing PostgreSQL 16
# server (for machines without Docker). Idempotent. Uses the postgres superuser
# through peer auth or PGADMIN_URL when set.
set -euo pipefail
ADMIN="${PGADMIN_URL:-}"
run_sql() {
  if [ -n "$ADMIN" ]; then psql "$ADMIN" -v ON_ERROR_STOP=1 -tAc "$1"; else sudo -u postgres psql -v ON_ERROR_STOP=1 -tAc "$1"; fi
}
run_sql "DO \$\$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'markov') THEN CREATE ROLE markov LOGIN PASSWORD 'markov' CREATEDB; END IF; END \$\$;"
for db in markov_dev markov_test; do
  if [ "$(run_sql "SELECT 1 FROM pg_database WHERE datname = '$db'")" != "1" ]; then
    run_sql "CREATE DATABASE $db OWNER markov"
  fi
done
echo "local databases ready: postgres://markov:markov@127.0.0.1:5432/markov_dev and /markov_test"
