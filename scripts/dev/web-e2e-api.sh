#!/usr/bin/env bash
# Starts a migrated, bound Markov API with the nonproduction test issuer for
# the web app's Playwright suite (apps/web/playwright.config.ts starts it when
# MARKOV_TEST_DATABASE_URL is set). A fresh database is created and dropped
# around the run; the fixture RPC (scripts/dev/fixture-rpc.mjs) answers the
# network identity, the synthetic catalog mints, funding reads and the
# in-memory registry ledger that the browser tests drive through its control
# endpoints on MARKOV_E2E_RPC_PORT.
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

RPC_PORT="${MARKOV_E2E_RPC_PORT:-3901}"
node scripts/dev/fixture-rpc.mjs "$RPC_PORT" &
RPC_PID=$!

export MARKOV_ENV=test SERVICE_VERSION=web-e2e LOG_LEVEL=warn LOG_FORMAT=json
export DATABASE_URL="$DB_URL" SOLANA_CLUSTER=devnet SOLANA_RPC_PRIMARY_URL="http://127.0.0.1:$RPC_PORT"
export API_PORT="$PORT" API_HOST=127.0.0.1 IDENTITY_PROVIDER=test
export AUTH_SESSION_TTL_SECONDS="${MARKOV_E2E_SESSION_TTL_SECONDS:-3600}"
# The web server is the only caller and forwards the browser's address.
export API_TRUST_PROXY=true
# Deterministic fixture model adapter (refused outside local/test) so research-run journeys can run.
export RESEARCH_MODEL_PROVIDER=fixture
# Synthetic stablecoin mint served by the fixture RPC (never a real token).
export FUNDING_STABLECOIN_MINT=GGN3oqBE6a9iJ5icpTXu1FPpXVRx1hHgQdjk5Dcmd9ts
# Execution planning (B09): synthetic venue quotes for the review journeys (F09).
export EXECUTION_VENUE_PROVIDER=fixture
# The web journeys review a staged basket: the fixture venue composes at most one leg per transaction here.
export EXECUTION_VENUE_FIXTURE_COMPOSE_MAX_LEGS=1
# Execution (F10): submissions go to the fixture chain; receipts are signed with a throwaway key for this run only.
export EXECUTION_WRITES_ENABLED=true RECEIPT_SIGNING_PROVIDER=local_key RECEIPT_SIGNING_KEY_ID=web-e2e-key-1
RECEIPT_SIGNING_KEY=$(node -e 'console.log(require("node:crypto").generateKeyPairSync("ed25519").privateKey.export({format:"der",type:"pkcs8"}).toString("base64"))')
export RECEIPT_SIGNING_KEY
# Development placeholder registry program id: the fixture RPC's in-memory ledger executes the
# program's rules under it (scripts/dev/fixture-rpc.mjs), so publishing journeys sign real
# transactions that never leave this machine. Nothing is deployed anywhere.
export REGISTRY_PROGRAM_ID=6SAPG2iavaEAv628NpuZuSwgKxGhqU23C769w7FfGpuZ

node apps/cli/dist/main.js db migrate --bound-by web-e2e >/dev/null
node apps/api/dist/main.js &
API_PID=$!

# Publish the fixture jurisdiction rules and terms (user-assigned ISO codes only,
# refused outside local/test) so eligibility journeys can be exercised.
for _ in $(seq 1 50); do
  if curl -fsS "http://127.0.0.1:$PORT/healthz" >/dev/null 2>&1; then
    break
  fi
  sleep 0.2
done
POLICY_TOKEN=$(node apps/cli/dist/main.js operators create --label web-e2e --scopes ops:policy:read,ops:policy:write --expires-days 1 | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{const m=d.match(/mkv_op_[1-9A-HJ-NP-Za-km-z]+_[A-Za-z0-9_-]+/);if(!m){console.error(d);process.exit(1)}console.log(m[0])})')
node apps/cli/dist/main.js policy rules publish --fixture --token "$POLICY_TOKEN" --url "http://127.0.0.1:$PORT" >/dev/null
node apps/cli/dist/main.js policy terms publish --fixture --token "$POLICY_TOKEN" --url "http://127.0.0.1:$PORT" >/dev/null
unset POLICY_TOKEN

# Admit the synthetic fixture instruments (PreStocks FXAERO and FXBIO, xStocks
# XSFXA) so discovery journeys browse real backend-admitted instruments;
# FXGRID stays quarantined (absent on the fixture chain) and XSFXB is refused
# by the extension policy, exactly as in scripts/ci/startup-check.sh.
CATALOG_TOKEN=$(node apps/cli/dist/main.js operators create --label web-e2e-catalog --scopes ops:catalog:read,ops:catalog:write --expires-days 1 | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{const m=d.match(/mkv_op_[1-9A-HJ-NP-Za-km-z]+_[A-Za-z0-9_-]+/);if(!m){console.error(d);process.exit(1)}console.log(m[0])})')
API_URL="http://127.0.0.1:$PORT"
node apps/cli/dist/main.js catalog ingest --issuer prestocks --source fixture --token "$CATALOG_TOKEN" --url "$API_URL" >/dev/null
node apps/cli/dist/main.js catalog ingest --issuer xstocks --source fixture --token "$CATALOG_TOKEN" --url "$API_URL" >/dev/null
for SYMBOL in FXAERO FXBIO XSFXA; do
  ID=$(node apps/cli/dist/main.js catalog list --status quarantined --q "$SYMBOL" --token "$CATALOG_TOKEN" --url "$API_URL" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{const j=JSON.parse(d);const i=j.instruments.find(x=>x.symbol===process.argv[1]);if(!i){console.error("missing "+process.argv[1]);process.exit(1)}console.log(i.instrumentId)})' "$SYMBOL")
  node apps/cli/dist/main.js catalog verify-mint "$ID" --token "$CATALOG_TOKEN" --url "$API_URL" >/dev/null
  node apps/cli/dist/main.js catalog decide "$ID" --decision admit --reason "web e2e: fixture instrument" --evidence review=web-e2e --token "$CATALOG_TOKEN" --url "$API_URL" >/dev/null
done
node apps/cli/dist/main.js catalog events ingest --issuer xstocks --source fixture --token "$CATALOG_TOKEN" --url "$API_URL" >/dev/null
# Valuation (F11 over B13): ingestion recorded the fixture feeds' reference prices; one operator SOL
# observation lets network fees and lamports be valued too. A synthetic figure for this run only.
node apps/cli/dist/main.js prices record --sol --kind secondary_market --value 150 --observed-at "$(date -u +%Y-%m-%dT%H:%M:%SZ)" --source web-e2e --evidence run=web-e2e --token "$CATALOG_TOKEN" --url "$API_URL" >/dev/null
# The fixture split (xs-ev-001) is already effective: until an operator applies
# it, policy keeps XSFXA unquoteable (corporate_action_pending), exactly as in
# scripts/ci/startup-check.sh. Apply it so review journeys can quote the basket.
SPLIT_ID=$(node apps/cli/dist/main.js catalog events list --issuer xstocks --status pending --token "$CATALOG_TOKEN" --url "$API_URL" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{const a=JSON.parse(d).actions.find(x=>x.externalId==="xs-ev-001");if(!a){console.error("missing xs-ev-001");process.exit(1)}console.log(a.actionId)})')
node apps/cli/dist/main.js catalog events apply "$SPLIT_ID" --reason "web e2e: issuer notice fixture" --evidence notice=fixture --token "$CATALOG_TOKEN" --url "$API_URL" >/dev/null
unset CATALOG_TOKEN SPLIT_ID
# Tell Playwright the API is seeded (apps/web/playwright.config.ts waits on this flag).
curl -fsS -X POST "http://127.0.0.1:$RPC_PORT/fixture/ready" >/dev/null
wait "$API_PID"
