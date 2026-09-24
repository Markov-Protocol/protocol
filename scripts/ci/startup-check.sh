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

export MARKOV_ENV=test SERVICE_VERSION=startup-check LOG_LEVEL=warn LOG_FORMAT=json RESEARCH_MODEL_PROVIDER=fixture
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

echo "== listed stocks journey: xStocks fixture products and events -> extension policy -> split -> exact quantities"
node apps/cli/dist/main.js catalog ingest --issuer xstocks --source fixture --token "$OPERATOR_TOKEN" --url "http://127.0.0.1:$API_PORT" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{const j=JSON.parse(d);console.log("xstocks products inserted: "+j.counts.inserted)})'
XSA_ID=$(node apps/cli/dist/main.js catalog list --status quarantined --q XSFXA --token "$OPERATOR_TOKEN" --url "http://127.0.0.1:$API_PORT" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>console.log(JSON.parse(d).instruments[0].instrumentId))')
XSB_ID=$(node apps/cli/dist/main.js catalog list --status quarantined --q XSFXB --token "$OPERATOR_TOKEN" --url "http://127.0.0.1:$API_PORT" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>console.log(JSON.parse(d).instruments[0].instrumentId))')
XSA_COMPAT=$(node apps/cli/dist/main.js catalog verify-mint "$XSA_ID" --token "$OPERATOR_TOKEN" --url "http://127.0.0.1:$API_PORT" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{const j=JSON.parse(d);console.log(j.result+":"+j.compatibility.compatibility+":"+j.compatibility.scaledUiAmount.multiplier)})')
echo "XSFXA verification: $XSA_COMPAT"; [ "$XSA_COMPAT" = "verified:supported:2" ]
XSB_COMPAT=$(node apps/cli/dist/main.js catalog verify-mint "$XSB_ID" --token "$OPERATOR_TOKEN" --url "http://127.0.0.1:$API_PORT" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>console.log(JSON.parse(d).compatibility.compatibility))')
echo "XSFXB extension policy: $XSB_COMPAT"; [ "$XSB_COMPAT" = "unsupported" ]
set +e
node apps/cli/dist/main.js catalog decide "$XSB_ID" --decision admit --reason "must be refused" --token "$OPERATOR_TOKEN" --url "http://127.0.0.1:$API_PORT" > /dev/null 2>&1
XSB_ADMIT=$?
set -e
echo "admitting the fee-bearing mint exits with: $XSB_ADMIT"; [ "$XSB_ADMIT" -ne 0 ]
node apps/cli/dist/main.js catalog decide "$XSA_ID" --decision admit --reason "startup check: extension policy supported" --token "$OPERATOR_TOKEN" --url "http://127.0.0.1:$API_PORT" > /dev/null
node apps/cli/dist/main.js catalog events ingest --issuer xstocks --source fixture --token "$OPERATOR_TOKEN" --url "http://127.0.0.1:$API_PORT" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{const j=JSON.parse(d);console.log("events: "+JSON.stringify(j.counts))})'
SPLIT_ID=$(node apps/cli/dist/main.js catalog events list --issuer xstocks --status pending --token "$OPERATOR_TOKEN" --url "http://127.0.0.1:$API_PORT" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{const a=JSON.parse(d).actions.find(x=>x.externalId==="xs-ev-001");console.log(a.actionId)})')
SPLIT_MULT=$(node apps/cli/dist/main.js catalog events apply "$SPLIT_ID" --reason "startup check: issuer notice fixture" --evidence notice=fixture --token "$OPERATOR_TOKEN" --url "http://127.0.0.1:$API_PORT" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>console.log(JSON.parse(d).multiplier.multiplier))')
echo "multiplier after split: $SPLIT_MULT"; [ "$SPLIT_MULT" = "2" ]
CONVERTED=$(node apps/cli/dist/main.js catalog convert "$XSA_ID" --raw 150000000 --as-of 2026-09-21T00:00:00Z --url "http://127.0.0.1:$API_PORT" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{const j=JSON.parse(d);console.log(j.scaled+":"+j.multiplier+":"+j.rounded)})')
echo "150000000 raw at 8 decimals after the split = $CONVERTED"; [ "$CONVERTED" = "3:2:false" ]

echo "== policy journey: fixture rules and terms -> declaration -> acknowledgement -> evaluation with reservation -> denials"
POLICY_TOKEN=$(node apps/cli/dist/main.js operators create --label startup-policy --scopes ops:policy:read,ops:policy:write --expires-days 1 | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{const m=d.match(/mkv_op_[1-9A-HJ-NP-Za-km-z]+_[A-Za-z0-9_-]+/);if(!m){console.error(d);process.exit(1)}console.log(m[0])})')
node apps/cli/dist/main.js policy rules publish --fixture --token "$POLICY_TOKEN" --url "http://127.0.0.1:$API_PORT" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{const j=JSON.parse(d);console.log("rules published: "+j.policyVersion+" active="+j.active+" rules="+j.rules.length)})'
node apps/cli/dist/main.js policy terms publish --fixture --token "$POLICY_TOKEN" --url "http://127.0.0.1:$API_PORT" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{const j=JSON.parse(d);console.log("terms published: "+j.termsVersion+" hash="+j.contentHash.slice(0,12))})'
BEFORE=$(node apps/cli/dist/main.js policy evaluate --instrument "$AERO_ID" --notional 100000000 --intent startup-0 --cash 1000000000 --token "$SESSION_TOKEN" --url "http://127.0.0.1:$API_PORT" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{const j=JSON.parse(d);console.log(j.outcome+":"+j.denials.map(x=>x.code).join(","))})')
echo "evaluation before declaring: $BEFORE"; [ "$BEFORE" = "deny:ELIGIBILITY_UNKNOWN,TERMS_NOT_ACKNOWLEDGED" ]
DECLARED=$(node apps/cli/dist/main.js policy declare --jurisdiction ZZ --token "$SESSION_TOKEN" --url "http://127.0.0.1:$API_PORT" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{const j=JSON.parse(d);console.log(j.outcome+":"+j.policyVersion+":"+j.issuers.length)})')
echo "declaration ZZ: $DECLARED"; [ "$DECLARED" = "eligible:2026-09-24:3" ]
TERMS_HASH=$(node apps/cli/dist/main.js policy terms current --url "http://127.0.0.1:$API_PORT" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>console.log(JSON.parse(d).documents[0].contentHash))')
node apps/cli/dist/main.js policy terms acknowledge --terms-version 2026-09-24 --content-hash "$TERMS_HASH" --token "$SESSION_TOKEN" --url "http://127.0.0.1:$API_PORT" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{const j=JSON.parse(d);console.log("acknowledged "+j.termsVersion+" via "+j.channel)})'
STEPS=$(node apps/cli/dist/main.js policy eligibility --token "$SESSION_TOKEN" --url "http://127.0.0.1:$API_PORT" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{const j=JSON.parse(d);console.log(j.outcome+":"+j.terms.complete+":"+j.steps.join(","))})')
echo "eligibility status: $STEPS"; [ "$STEPS" = "eligible:true:" ]
AVAIL=$(node apps/cli/dist/main.js policy availability "$AERO_ID" --token "$SESSION_TOKEN" --url "http://127.0.0.1:$API_PORT" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{const j=JSON.parse(d);console.log(j.capabilities.discoverable+":"+j.capabilities.quoteable+":"+j.capabilities.buyable+":"+j.conditions.join(","))})')
echo "capability states: $AVAIL"; [ "$AVAIL" = "true:false:false:venue_disabled,execution_disabled" ]
ALLOWED=$(node apps/cli/dist/main.js policy evaluate --instrument "$AERO_ID" --notional 100000000 --intent startup-1 --cash 1000000000 --reserve --token "$SESSION_TOKEN" --url "http://127.0.0.1:$API_PORT" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{const j=JSON.parse(d);console.log(j.outcome+":"+(j.reservation?j.reservation.status:"none")+":"+j.budget.dailyUsedUsdcRaw)})')
echo "quote-stage evaluation with reservation: $ALLOWED"; [ "$ALLOWED" = "allow:held:100000000" ]
SUBMIT=$(node apps/cli/dist/main.js policy evaluate --instrument "$AERO_ID" --notional 100000000 --intent startup-1 --stage submit --cash 1000000000 --token "$SESSION_TOKEN" --url "http://127.0.0.1:$API_PORT" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{const j=JSON.parse(d);console.log(j.outcome+":"+j.denials.map(x=>x.code).join(","))})')
echo "submit-stage evaluation: $SUBMIT"; [ "$SUBMIT" = "deny:EXECUTION_DISABLED,VENUE_DISABLED" ]
CAPPED=$(node apps/cli/dist/main.js policy evaluate --instrument "$AERO_ID" --notional 1500000000 --intent startup-2 --cash 100000000000 --token "$SESSION_TOKEN" --url "http://127.0.0.1:$API_PORT" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{const j=JSON.parse(d);const x=j.denials[0];console.log(x.code+":"+x.limit+":"+x.observed)})')
echo "order above the cap: $CAPPED"; [ "$CAPPED" = "ORDER_CAP_EXCEEDED:1000000000:1500000000" ]
RELEASED=$(node apps/cli/dist/main.js policy reservations release startup-1 --token "$SESSION_TOKEN" --url "http://127.0.0.1:$API_PORT" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>console.log(JSON.parse(d).status))')
echo "reservation released: $RELEASED"; [ "$RELEASED" = "released" ]

echo "== research journey: thesis -> fixture issuer source -> sourced revision -> fixture model run -> mapping -> public projection -> SSRF refusal"
THESIS_ID=$(node apps/cli/dist/main.js research thesis create --title "Fixture Aerospace exposure" --claim "Tokenised pre-IPO exposure to Fixture Aerospace Inc is worth a small position." --token "$SESSION_TOKEN" --url "http://127.0.0.1:$API_PORT" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{const j=JSON.parse(d);console.log(j.thesis.thesisId)})')
echo "thesis: $THESIS_ID"
SOURCE_JSON=$(node apps/cli/dist/main.js research source attach "$THESIS_ID" --source-url "https://fixture.markov.invalid/issuer/terms" --role issuer --token "$SESSION_TOKEN" --url "http://127.0.0.1:$API_PORT")
SOURCE_ID=$(echo "$SOURCE_JSON" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{const j=JSON.parse(d);console.log(j.status+":"+j.sourceId+":"+(j.excerpt||"").includes("<script")+":"+j.title)})')
echo "issuer source status:id:script-leaked:title = $SOURCE_ID"
case "$SOURCE_ID" in fetched:*:false:*) ;; *) echo "unexpected source record"; exit 1;; esac
SOURCE_UUID=$(echo "$SOURCE_ID" | cut -d: -f2)
REVISION=$(node apps/cli/dist/main.js research thesis revise "$THESIS_ID" --input "{\"title\":\"Fixture Aerospace exposure\",\"claim\":\"Tokenised pre-IPO exposure to Fixture Aerospace Inc is worth a small position.\",\"statements\":[{\"statementId\":\"ia-1\",\"kind\":\"issuer_assertion\",\"topic\":\"rights\",\"text\":\"The issuer states that holders have no shareholder voting rights.\",\"sourceIds\":[\"$SOURCE_UUID\"]}],\"instruments\":[{\"instrumentId\":\"$AERO_ID\"}],\"subjects\":[{\"name\":\"Unknown Rocket Co\"}]}" --token "$SESSION_TOKEN" --url "http://127.0.0.1:$API_PORT" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{const j=JSON.parse(d);console.log(j.revisionNumber+":"+j.statements[0].kind+":"+j.contentHash.slice(0,12))})')
echo "revision number:kind:hash = $REVISION"; case "$REVISION" in 2:issuer_assertion:*) ;; *) exit 1;; esac
RUN=$(node apps/cli/dist/main.js research run create --thesis "$THESIS_ID" --question "Should I hold Fixture Aerospace Inc rather than Unknown Rocket Co?" --source "$SOURCE_UUID" --token "$SESSION_TOKEN" --url "http://127.0.0.1:$API_PORT" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{const j=JSON.parse(d);console.log(j.status+":"+j.provenance.provider+":"+j.output.draft.length+":"+j.output.draft[0].kind+":"+(j.output.suggestedInstrumentIds[0]===process.argv[1])+":"+j.output.unmatchedCompanies.join("|"))})' "$AERO_ID")
echo "run status:provider:draft:kind:suggests-aero:unmatched = $RUN"; [ "$RUN" = "succeeded:fixture:1:model_inference:true:Unknown Rocket Co" ]
MAPPED=$(node apps/cli/dist/main.js research map --company "Fixture Aerospace, Inc." "Unknown Rocket Co" --token "$SESSION_TOKEN" --url "http://127.0.0.1:$API_PORT" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{const j=JSON.parse(d);console.log(j.results.map(r=>r.unmatched+":"+r.matches.length).join(","))})')
echo "mapping (aero, unknown) = $MAPPED"; [ "$MAPPED" = "false:1,true:0" ]
PUBLIC_BEFORE=$(curl -s -o /dev/null -w "%{http_code}" "http://127.0.0.1:$API_PORT/v1/research/theses/$THESIS_ID")
echo "public projection before publishing: $PUBLIC_BEFORE"; [ "$PUBLIC_BEFORE" = "404" ]
node apps/cli/dist/main.js research thesis publish "$THESIS_ID" --visibility public --token "$SESSION_TOKEN" --url "http://127.0.0.1:$API_PORT" > /dev/null
PUBLIC_AFTER=$(curl -fsS "http://127.0.0.1:$API_PORT/v1/research/theses/$THESIS_ID" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{const j=JSON.parse(d);console.log(j.revisionNumber+":"+("privateNotes" in j)+":"+("ownerUserId" in j)+":"+j.sources.length)})')
echo "public projection revision:privateNotes:owner:sources = $PUBLIC_AFTER"; [ "$PUBLIC_AFTER" = "2:false:false:1" ]
SSRF=$(node apps/cli/dist/main.js research source attach "$THESIS_ID" --source-url "https://169.254.169.254/latest/meta-data/" --token "$SESSION_TOKEN" --url "http://127.0.0.1:$API_PORT" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{const j=JSON.parse(d);console.log(j.status+":"+j.blockedReason)})')
echo "metadata address: $SSRF"; case "$SSRF" in blocked:*) ;; *) exit 1;; esac

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
