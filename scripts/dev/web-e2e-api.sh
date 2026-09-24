#!/usr/bin/env bash
# Starts a migrated, bound Markov API with the nonproduction test issuer for
# the web app's Playwright suite (apps/web/playwright.config.ts starts it when
# MARKOV_TEST_DATABASE_URL is set). A fresh database is created and dropped
# around the run; the fixture RPC answers only getGenesisHash/getHealth.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
ADMIN_URL="${MARKOV_TEST_DATABASE_URL:?set MARKOV_TEST_DATABASE_URL}"
PORT="${MARKOV_E2E_API_PORT:-3900}"
DBNAME="markov_web_e2e_$(date +%s)_$RANDOM"
psql "$ADMIN_URL" -v ON_ERROR_STOP=1 -qc "CREATE DATABASE \"$DBNAME\"" >/dev/null
DB_URL="${ADMIN_URL%/*}/$DBNAME"
cleanup() {
  [ -n "${API_PID:-}" ] && kill "$API_PID" 2>/dev/null || true
  [ -n "${RPC_PID:-}" ] && kill "$RPC_PID" 2>/dev/null || true
  psql "$ADMIN_URL" -qc "DROP DATABASE IF EXISTS \"$DBNAME\" WITH (FORCE)" >/dev/null || true
}
trap cleanup EXIT INT TERM

RPC_PORT=$((20000 + RANDOM % 20000))
node -e '
const http = require("node:http");
const port = Number(process.argv[1]);
http.createServer((req, res) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    const { id, method } = JSON.parse(body || "{}");
    const result = method === "getGenesisHash" ? "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG" : method === "getHealth" ? "ok" : { "solana-core": "fixture" };
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ jsonrpc: "2.0", id, result }));
  });
}).listen(port, "127.0.0.1");
' "$RPC_PORT" &
RPC_PID=$!

export MARKOV_ENV=test SERVICE_VERSION=web-e2e LOG_LEVEL=warn LOG_FORMAT=json
export DATABASE_URL="$DB_URL" SOLANA_CLUSTER=devnet SOLANA_RPC_PRIMARY_URL="http://127.0.0.1:$RPC_PORT"
export API_PORT="$PORT" API_HOST=127.0.0.1 IDENTITY_PROVIDER=test
export AUTH_SESSION_TTL_SECONDS="${MARKOV_E2E_SESSION_TTL_SECONDS:-3600}"
# The web server is the only caller and forwards the browser's address.
export API_TRUST_PROXY=true

node apps/cli/dist/main.js db migrate --bound-by web-e2e >/dev/null
node apps/api/dist/main.js &
API_PID=$!
wait "$API_PID"
