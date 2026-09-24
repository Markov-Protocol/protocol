#!/usr/bin/env bash
# Headless startup verification used by CI and docs/sessions/B01.md:
# 1. migrate + bind a fresh database,
# 2. start the API against a fixture RPC that reports the devnet genesis,
# 3. assert /healthz and /readyz, run the CLI health command,
# 4. assert the API refuses to start when configuration contradicts the bound identity.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
ADMIN_URL="${MARKOV_TEST_DATABASE_URL:?set MARKOV_TEST_DATABASE_URL}"
DBNAME="markov_startup_$(date +%s)_$RANDOM"
psql "$ADMIN_URL" -v ON_ERROR_STOP=1 -qc "CREATE DATABASE \"$DBNAME\"" >/dev/null
DB_URL="${ADMIN_URL%/*}/$DBNAME"
cleanup() {
  [ -n "${API_PID:-}" ] && kill "$API_PID" 2>/dev/null || true
  [ -n "${RPC_PID:-}" ] && kill "$RPC_PID" 2>/dev/null || true
  psql "$ADMIN_URL" -qc "DROP DATABASE IF EXISTS \"$DBNAME\" WITH (FORCE)" >/dev/null || true
}
trap cleanup EXIT

# Fixture RPC (scripts/dev/fixture-rpc.mjs): devnet genesis plus the synthetic catalog mints.
RPC_PORT=$((20000 + RANDOM % 20000))
node scripts/dev/fixture-rpc.mjs "$RPC_PORT" &
RPC_PID=$!

export MARKOV_ENV=test SERVICE_VERSION=startup-check LOG_LEVEL=warn LOG_FORMAT=json
export DATABASE_URL="$DB_URL" SOLANA_CLUSTER=devnet SOLANA_RPC_PRIMARY_URL="http://127.0.0.1:$RPC_PORT"
API_PORT=$((30000 + RANDOM % 20000)); export API_PORT API_HOST=127.0.0.1

echo "== markov db migrate"
node apps/cli/dist/main.js db migrate --bound-by startup-check

echo "== start api"
node apps/api/dist/main.js &
API_PID=$!
for i in $(seq 1 30); do
  if curl -fsS "http://127.0.0.1:$API_PORT/healthz" >/dev/null 2>&1; then break; fi
  sleep 0.5
done
curl -fsS "http://127.0.0.1:$API_PORT/healthz"; echo
READY_STATUS=$(curl -s -o /dev/null -w "%{http_code}" "http://127.0.0.1:$API_PORT/readyz")
echo "readyz status: $READY_STATUS"
[ "$READY_STATUS" = "200" ]

echo "== markov health"
node apps/cli/dist/main.js health --url "http://127.0.0.1:$API_PORT"

echo "== identity journey (test issuer): token -> session -> whoami -> wallet link"
IDENTITY_TOKEN=$(node apps/cli/dist/main.js auth test-token --subject did:test:alice --url "http://127.0.0.1:$API_PORT")
SESSION_JSON=$(node apps/cli/dist/main.js auth session --identity-token "$IDENTITY_TOKEN" --url "http://127.0.0.1:$API_PORT")
SESSION_TOKEN=$(echo "$SESSION_JSON" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>console.log(JSON.parse(d).sessionToken))')
node apps/cli/dist/main.js auth whoami --token "$SESSION_TOKEN" --url "http://127.0.0.1:$API_PORT" | head -12
node apps/cli/dist/main.js auth demo-wallet-link --token "$SESSION_TOKEN" --url "http://127.0.0.1:$API_PORT"
echo "== an unknown bearer token must be rejected"
UNAUTH=$(curl -s -o /dev/null -w "%{http_code}" -H "Authorization: Bearer mkv_ss_notreal00_$(printf 'a%.0s' $(seq 1 43))" "http://127.0.0.1:$API_PORT/v1/me")
echo "status: $UNAUTH"; [ "$UNAUTH" = "401" ]

echo "== catalog journey: operator token -> fixture ingestion -> mint verification -> admission -> public search"
OPERATOR_TOKEN=$(node apps/cli/dist/main.js operators create --label startup-check --scopes ops:catalog:read,ops:catalog:write --expires-days 1 | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{const m=d.match(/mkv_op_[1-9A-HJ-NP-Za-km-z]+_[A-Za-z0-9_-]+/);if(!m){console.error(d);process.exit(1)}console.log(m[0])})')
node apps/cli/dist/main.js catalog ingest --issuer prestocks --source fixture --token "$OPERATOR_TOKEN" --url "http://127.0.0.1:$API_PORT" | head -20
AERO_ID=$(node apps/cli/dist/main.js catalog list --status quarantined --q FXAERO --token "$OPERATOR_TOKEN" --url "http://127.0.0.1:$API_PORT" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>console.log(JSON.parse(d).instruments[0].instrumentId))')
echo "quarantined FXAERO: $AERO_ID"
VERIFY_RESULT=$(node apps/cli/dist/main.js catalog verify-mint "$AERO_ID" --token "$OPERATOR_TOKEN" --url "http://127.0.0.1:$API_PORT" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>console.log(JSON.parse(d).result))')
echo "mint verification: $VERIFY_RESULT"; [ "$VERIFY_RESULT" = "verified" ]
node apps/cli/dist/main.js catalog decide "$AERO_ID" --decision admit --reason "startup check: terms fixture reviewed" --evidence review=startup-check --token "$OPERATOR_TOKEN" --url "http://127.0.0.1:$API_PORT" | head -12
PUBLIC_COUNT=$(curl -fsS "http://127.0.0.1:$API_PORT/v1/catalog/instruments?q=FXAERO" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{const j=JSON.parse(d);console.log(j.instruments.length+":"+(j.instruments[0]?.referencePrice?.kind??"none")+":"+j.instruments[0]?.availability?.trade)})')
echo "public search result count:kind:trade = $PUBLIC_COUNT"; [ "$PUBLIC_COUNT" = "1:issuer_mark:false" ]
QUARANTINE_PUBLIC=$(curl -s -o /dev/null -w "%{http_code}" "http://127.0.0.1:$API_PORT/v1/ops/catalog/instruments")
echo "operator route without token: $QUARANTINE_PUBLIC"; [ "$QUARANTINE_PUBLIC" = "401" ]

echo "== graceful shutdown"
kill -TERM "$API_PID"; wait "$API_PID" || true; API_PID=""

echo "== wrong cluster must refuse to start"
set +e
SOLANA_CLUSTER=testnet node apps/api/dist/main.js
CODE=$?
set -e
echo "exit code: $CODE"
[ "$CODE" = "78" ]

echo "== rpc reporting another chain must refuse to start"
WRONG_PORT=$((20000 + RANDOM % 20000))
node -e '
const http = require("node:http");
http.createServer((req, res) => { let b=""; req.on("data",(c)=>b+=c); req.on("end",()=>{ const {id}=JSON.parse(b||"{}"); res.setHeader("content-type","application/json"); res.end(JSON.stringify({jsonrpc:"2.0",id,result:"5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d"})); }); }).listen(Number(process.argv[1]),"127.0.0.1");
' "$WRONG_PORT" &
WRONG_PID=$!
set +e
SOLANA_RPC_PRIMARY_URL="http://127.0.0.1:$WRONG_PORT" node apps/api/dist/main.js
CODE=$?
set -e
kill "$WRONG_PID" 2>/dev/null || true
echo "exit code: $CODE"
[ "$CODE" = "78" ]
echo "startup check passed"
