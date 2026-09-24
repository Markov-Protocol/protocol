#!/usr/bin/env bash
# Run a local Temporal dev server (headless, SQLite persistence under .temporal/).
# The UI is available with --ui. Requires scripts/dev/install-temporal-cli.sh.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
mkdir -p .temporal
ARGS=(server start-dev --ip 127.0.0.1 --port 7233 --db-filename .temporal/dev.db --log-level warn)
if [ "${1:-}" != "--ui" ]; then
  ARGS+=(--headless)
fi
exec temporal "${ARGS[@]}"
