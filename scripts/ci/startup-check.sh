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
  [ -n "${KEY_DIR:-}" ] && rm -rf "$KEY_DIR" || true
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
# Strategy registry (B08): the development placeholder program id served by the fixture ledger.
export REGISTRY_PROGRAM_ID="${MARKOV_FIXTURE_REGISTRY_PROGRAM_ID:-6SAPG2iavaEAv628NpuZuSwgKxGhqU23C769w7FfGpuZ}"
# Execution planning (B09): the synthetic stablecoin the fixture RPC serves balances for, and the fixture venue.
export FUNDING_STABLECOIN_MINT=GGN3oqBE6a9iJ5icpTXu1FPpXVRx1hHgQdjk5Dcmd9ts EXECUTION_VENUE_PROVIDER=fixture
# Execution (B10): writes are enabled for the fixture chain; the demo wallet key lives in a temp dir for the check only.
export EXECUTION_WRITES_ENABLED=true
KEY_DIR=$(mktemp -d)
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
# Since B10 execution writes are enabled for the fixture chain and the venue is fixture-verified: an eligible person can be quoted and can buy.
echo "capability states: $AVAIL"; [ "$AVAIL" = "true:true:true:" ]
ALLOWED=$(node apps/cli/dist/main.js policy evaluate --instrument "$AERO_ID" --notional 100000000 --intent startup-1 --cash 1000000000 --reserve --token "$SESSION_TOKEN" --url "http://127.0.0.1:$API_PORT" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{const j=JSON.parse(d);console.log(j.outcome+":"+(j.reservation?j.reservation.status:"none")+":"+j.budget.dailyUsedUsdcRaw)})')
echo "quote-stage evaluation with reservation: $ALLOWED"; [ "$ALLOWED" = "allow:held:100000000" ]
SUBMIT=$(node apps/cli/dist/main.js policy evaluate --instrument "$AERO_ID" --notional 100000000 --intent startup-1 --stage submit --cash 1000000000 --token "$SESSION_TOKEN" --url "http://127.0.0.1:$API_PORT" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{const j=JSON.parse(d);console.log(j.outcome+":"+j.denials.map(x=>x.code).join(","))})')
echo "submit-stage evaluation with declared exposure: $SUBMIT"; [ "$SUBMIT" = "allow:" ]
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

echo "== strategy journey: draft -> validation errors -> freeze v1 -> fork -> instance pinned -> creator v2 -> pin unchanged -> explicit acceptance -> diff"
DRAFT_OK="{\"title\":\"Aerospace tilt\",\"thesis\":\"Launch cadence is underestimated.\",\"legs\":[{\"instrumentId\":\"$AERO_ID\",\"weightBps\":6000},{\"instrumentId\":\"$XSA_ID\",\"weightBps\":3000}],\"cashWeightBps\":1000}"
STRATEGY_JSON=$(node apps/cli/dist/main.js strategy create --input "$DRAFT_OK" --token "$SESSION_TOKEN" --url "http://127.0.0.1:$API_PORT")
STRATEGY_ID=$(echo "$STRATEGY_JSON" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{const j=JSON.parse(d);console.log(j.strategy.strategyId+":"+j.draft.validation.valid+":"+j.draft.validation.totals.totalBps+":"+j.draft.revision)})')
echo "strategy id:valid:total:revision = $STRATEGY_ID"; case "$STRATEGY_ID" in *:true:10000:1) ;; *) exit 1;; esac
STRATEGY_ID=${STRATEGY_ID%%:*}
BAD_TOTAL=$(node apps/cli/dist/main.js strategy draft "$STRATEGY_ID" --if-revision 1 --input "{\"title\":\"Aerospace tilt\",\"thesis\":\"t\",\"legs\":[{\"instrumentId\":\"$AERO_ID\",\"weightBps\":6000},{\"instrumentId\":\"$AERO_ID\",\"weightBps\":3000},{\"instrumentId\":\"$XSB_ID\",\"weightBps\":999}],\"cashWeightBps\":0}" --token "$SESSION_TOKEN" --url "http://127.0.0.1:$API_PORT" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{const j=JSON.parse(d);console.log(j.validation.valid+":"+j.validation.issues.filter(i=>i.severity==="error").map(i=>i.code).sort().join(",")+":"+j.revision)})')
echo "invalid draft valid:errors:revision = $BAD_TOTAL"; [ "$BAD_TOTAL" = "false:DUPLICATE_INSTRUMENT,INSTRUMENT_NOT_ADMITTED,WEIGHTS_TOTAL:2" ]
set +e
node apps/cli/dist/main.js strategy freeze "$STRATEGY_ID" --token "$SESSION_TOKEN" --url "http://127.0.0.1:$API_PORT" > /dev/null 2>&1
FREEZE_BAD=$?
set -e
echo "freezing the invalid draft exits with: $FREEZE_BAD"; [ "$FREEZE_BAD" -ne 0 ]
STALE=$(node apps/cli/dist/main.js strategy draft "$STRATEGY_ID" --if-revision 1 --input "$DRAFT_OK" --token "$SESSION_TOKEN" --url "http://127.0.0.1:$API_PORT" 2>&1 | grep -c "IDEMPOTENCY_CONFLICT" || true)
echo "stale revision refused: $STALE"; [ "$STALE" = "1" ]
node apps/cli/dist/main.js strategy draft "$STRATEGY_ID" --if-revision 2 --input "$DRAFT_OK" --token "$SESSION_TOKEN" --url "http://127.0.0.1:$API_PORT" > /dev/null
V1=$(node apps/cli/dist/main.js strategy freeze "$STRATEGY_ID" --if-revision 3 --token "$SESSION_TOKEN" --url "http://127.0.0.1:$API_PORT" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{const j=JSON.parse(d);console.log(j.versionId+":"+j.versionNumber+":"+j.legs.length+":"+j.manifestHash.length+":"+j.disclosures.issuers.map(x=>x.issuer+"="+x.weightBps).join("|"))})')
echo "v1 id:number:legs:hashlen:issuers = $V1"; case "$V1" in *:1:2:64:prestocks=6000\|xstocks=3000) ;; *) exit 1;; esac
V1_ID=${V1%%:*}
FORK=$(node apps/cli/dist/main.js strategy fork "$STRATEGY_ID" --version-id "$V1_ID" --token "$SESSION_TOKEN" --url "http://127.0.0.1:$API_PORT" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{const j=JSON.parse(d);console.log((j.strategy.forkOf.versionId===process.argv[1])+":"+j.draft.content.title)})' "$V1_ID")
echo "fork provenance:title = $FORK"; [ "$FORK" = "true:Aerospace tilt (fork)" ]
WALLET_ID=$(node apps/cli/dist/main.js auth whoami --token "$SESSION_TOKEN" --url "http://127.0.0.1:$API_PORT" > /dev/null; curl -fsS -H "Authorization: Bearer $SESSION_TOKEN" "http://127.0.0.1:$API_PORT/v1/me/wallets" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>console.log(JSON.parse(d).wallets[0].walletId))')
INSTANCE=$(node apps/cli/dist/main.js instance create --strategy "$STRATEGY_ID" --version-id "$V1_ID" --wallet "$WALLET_ID" --label "startup" --token "$SESSION_TOKEN" --url "http://127.0.0.1:$API_PORT" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{const j=JSON.parse(d);console.log(j.instanceId+":"+j.pinnedVersionNumber+":"+j.proposedVersionId)})')
echo "instance id:pinned:proposed = $INSTANCE"; case "$INSTANCE" in *:1:null) ;; *) exit 1;; esac
INSTANCE_ID=${INSTANCE%%:*}
node apps/cli/dist/main.js strategy draft "$STRATEGY_ID" --input "{\"title\":\"Aerospace tilt v2\",\"thesis\":\"Launch cadence is underestimated.\",\"legs\":[{\"instrumentId\":\"$AERO_ID\",\"weightBps\":5000},{\"instrumentId\":\"$XSA_ID\",\"weightBps\":3000}],\"cashWeightBps\":2000}" --token "$SESSION_TOKEN" --url "http://127.0.0.1:$API_PORT" > /dev/null
V2_ID=$(node apps/cli/dist/main.js strategy freeze "$STRATEGY_ID" --token "$SESSION_TOKEN" --url "http://127.0.0.1:$API_PORT" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>console.log(JSON.parse(d).versionId))')
AFTER_V2=$(node apps/cli/dist/main.js instance list --token "$SESSION_TOKEN" --url "http://127.0.0.1:$API_PORT" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{const i=JSON.parse(d).instances.find(x=>x.instanceId===process.argv[1]);console.log(i.pinnedVersionNumber+":"+(i.proposedVersionId===process.argv[2]))})' "$INSTANCE_ID" "$V2_ID")
echo "after creator v2, instance pinned:proposed-is-v2 = $AFTER_V2"; [ "$AFTER_V2" = "1:true" ]
PINNED=$(node apps/cli/dist/main.js instance pin "$INSTANCE_ID" --version-id "$V2_ID" --token "$SESSION_TOKEN" --url "http://127.0.0.1:$API_PORT" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{const j=JSON.parse(d);console.log(j.pinnedVersionNumber+":"+j.proposedVersionId)})')
echo "after explicit acceptance pinned:proposed = $PINNED"; [ "$PINNED" = "2:null" ]
DIFF=$(node apps/cli/dist/main.js strategy diff "$STRATEGY_ID" "$V2_ID" --against "$V1_ID" --token "$SESSION_TOKEN" --url "http://127.0.0.1:$API_PORT" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{const j=JSON.parse(d);console.log(j.legs.changed.length+":"+j.cashWeightBps.from+"->"+j.cashWeightBps.to+":"+j.turnoverBps)})')
echo "diff changed:cash:turnover = $DIFF"; [ "$DIFF" = "1:1000->2000:1000" ]
V1_AGAIN=$(curl -fsS -H "Authorization: Bearer $SESSION_TOKEN" "http://127.0.0.1:$API_PORT/v1/me/strategies/$STRATEGY_ID/versions/$V1_ID" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{const j=JSON.parse(d);console.log(j.versionNumber+":"+j.legs.find(l=>l.instrumentId===process.argv[1]).weightBps+":"+j.cashWeightBps)})' "$AERO_ID")
echo "v1 unchanged after v2 = $V1_AGAIN"; [ "$V1_AGAIN" = "1:6000:1000" ]

echo "== registry journey: status -> prepare (what becomes public) -> sign -> submit -> finalize -> registered -> indexer -> public verification -> deprecate"
REGISTRY_STATUS=$(node apps/cli/dist/main.js registry status --url "http://127.0.0.1:$API_PORT" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{const j=JSON.parse(d);console.log(j.publicationEnabled+":"+j.programId+":"+j.network.cluster)})')
echo "registry enabled:program:cluster = $REGISTRY_STATUS"; [ "$REGISTRY_STATUS" = "true:$REGISTRY_PROGRAM_ID:devnet" ]
# Registration: prepare with a fresh in-process wallet, fund it on the fixture ledger, sign, submit, follow.
DEMO_OUT=$(node apps/cli/dist/main.js strategy publish-demo "$STRATEGY_ID" --version-id "$V1_ID" --token "$SESSION_TOKEN" --url "http://127.0.0.1:$API_PORT" --fixture-control "http://127.0.0.1:$RPC_PORT/fixture/registry" --status deprecated)
REG=$(echo "$DEMO_OUT" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{const j=JSON.parse(d);console.log(j.registration.state+":"+(j.registration.evidence?j.registration.evidence.status:"none")+":"+(j.statusChange?j.statusChange.state+"/"+j.statusChange.evidence.status:"none")+":"+(j.registration.signature?"sig":"nosig"))})')
echo "registration state:status:statusChange:signature = $REG"; [ "$REG" = "registered:active:registered/deprecated:sig" ]
RECORD_ADDRESS=$(echo "$DEMO_OUT" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>console.log(JSON.parse(d).registration.recordAddress))')
INDEX=$(node apps/indexer/dist/main.js --once | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{const j=JSON.parse(d);console.log(j.accountsObserved+":"+j.recordsIndexed+":"+j.errors.length)})')
echo "indexer accounts:records:errors = $INDEX"; [ "$INDEX" = "1:1:0" ]
PUBLIC=$(node apps/cli/dist/main.js registry public-version "$STRATEGY_ID" "$V1_ID" --url "http://127.0.0.1:$API_PORT" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{const j=JSON.parse(d);console.log(j.verification.manifestHashMatches+":"+j.verification.contentMatches+":"+j.registration.status+":"+(j.registration.recordAddress===process.argv[1]))})' "$RECORD_ADDRESS")
echo "public verification hash:content:status:address = $PUBLIC"; [ "$PUBLIC" = "true:true:deprecated:true" ]
RECORD=$(node apps/cli/dist/main.js registry record "$RECORD_ADDRESS" --url "http://127.0.0.1:$API_PORT" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{const j=JSON.parse(d);console.log(j.status+":"+(j.version?j.version.versionNumber:"none"))})')
echo "indexed record status:version = $RECORD"; [ "$RECORD" = "deprecated:1" ]
STATUS_AFTER=$(node apps/cli/dist/main.js registry status --url "http://127.0.0.1:$API_PORT" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{const j=JSON.parse(d);console.log(j.indexer.recordsIndexed+":"+(j.indexer.lastRunAt!==null))})')
echo "registry indexer records:ran = $STATUS_AFTER"; [ "$STATUS_AFTER" = "1:true" ]

echo "== planning journey: fund wallet -> intent (idempotent) -> fixture plan -> conservation, bounds and hash -> acknowledgement rules -> cancel"
WALLET_ADDRESS=$(curl -fsS -H "Authorization: Bearer $SESSION_TOKEN" "http://127.0.0.1:$API_PORT/v1/me/wallets" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>console.log(JSON.parse(d).wallets[0].address))')
INTENT=$(node apps/cli/dist/main.js intents create --version-id "$V1_ID" --wallet "$WALLET_ID" --budget 1000000000 --idempotency-key startup-intent-1 --token "$SESSION_TOKEN" --url "http://127.0.0.1:$API_PORT" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{const j=JSON.parse(d);console.log(j.intentId+":"+j.state+":"+j.kind+":"+j.budget.symbol+":"+j.slippageBps)})')
echo "intent id:state:kind:symbol:slippage = $INTENT"; case "$INTENT" in *:DRAFT:basket_investment:USDC:50) ;; *) exit 1;; esac
INTENT_ID=${INTENT%%:*}
SAME=$(node apps/cli/dist/main.js intents create --version-id "$V1_ID" --wallet "$WALLET_ID" --budget 1000000000 --idempotency-key startup-intent-1 --token "$SESSION_TOKEN" --url "http://127.0.0.1:$API_PORT" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>console.log(JSON.parse(d).intentId===process.argv[1]))' "$INTENT_ID")
echo "same key, same request answers the same intent: $SAME"; [ "$SAME" = "true" ]
CONFLICT=$(node apps/cli/dist/main.js intents create --version-id "$V1_ID" --wallet "$WALLET_ID" --budget 2000000000 --idempotency-key startup-intent-1 --token "$SESSION_TOKEN" --url "http://127.0.0.1:$API_PORT" 2>&1 | grep -c "IDEMPOTENCY_CONFLICT" || true)
echo "same key, other request refused: $CONFLICT"; [ "$CONFLICT" = "1" ]
UNFUNDED=$(node apps/cli/dist/main.js intents plan "$INTENT_ID" --token "$SESSION_TOKEN" --url "http://127.0.0.1:$API_PORT" 2>&1 | grep -c "INSUFFICIENT_FUNDS" || true)
echo "plan refused while the wallet is empty: $UNFUNDED"; [ "$UNFUNDED" = "1" ]
curl -fsS -X POST -H "content-type: application/json" -d "{\"address\":\"$WALLET_ADDRESS\",\"lamports\":50000000,\"stablecoinRaw\":\"2500000000\"}" "http://127.0.0.1:$RPC_PORT/fixture/funding" > /dev/null
PLAN_JSON=$(node apps/cli/dist/main.js intents plan "$INTENT_ID" --token "$SESSION_TOKEN" --url "http://127.0.0.1:$API_PORT")
PLAN=$(echo "$PLAN_JSON" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{const j=JSON.parse(d);const sum=j.allocation.legs.reduce((s,l)=>s+BigInt(l.targetRaw),0n)+BigInt(j.allocation.cash.targetRaw);const spend=j.legs.reduce((s,l)=>s+BigInt(l.maxInputRaw),0n)+BigInt(j.bounds.residualCashRaw);console.log(j.mode+":"+j.grouping.mode+":"+j.legs.length+":"+(sum===BigInt(j.allocation.investableRaw))+":"+(spend===BigInt(j.input.totalSpendRaw))+":"+j.status+":"+j.funds.sufficient+":"+j.legs.every(l=>l.policyDecision.outcome==="allow"&&BigInt(l.minimumOutputRaw)<=BigInt(l.expectedOutputRaw)))})')
echo "plan mode:grouping:legs:conserved:bounded:status:funded:legs-ok = $PLAN"; [ "$PLAN" = "fixture:staged:2:true:true:valid:true:true" ]
PLAN_ID=$(echo "$PLAN_JSON" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>console.log(JSON.parse(d).planId))')
PLAN_HASH=$(echo "$PLAN_JSON" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>console.log(JSON.parse(d).planHash))')
VERIFY=$(node apps/cli/dist/main.js intents verify-plan --input "$PLAN_JSON" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{const j=JSON.parse(d);console.log(j.matches+":"+j.conserved+":"+j.bounded)})')
echo "offline plan verification matches:conserved:bounded = $VERIFY"; [ "$VERIFY" = "true:true:true" ]
NO_STAGED=$(node apps/cli/dist/main.js intents acknowledge "$INTENT_ID" "$PLAN_ID" --plan-hash "$PLAN_HASH" --token "$SESSION_TOKEN" --url "http://127.0.0.1:$API_PORT" 2>&1 | grep -c "VALIDATION_FAILED" || true)
echo "staged plan without acknowledgement refused: $NO_STAGED"; [ "$NO_STAGED" = "1" ]
WRONG_HASH=$(node apps/cli/dist/main.js intents acknowledge "$INTENT_ID" "$PLAN_ID" --plan-hash "$(printf '0%.0s' $(seq 1 64))" --staged --token "$SESSION_TOKEN" --url "http://127.0.0.1:$API_PORT" 2>&1 | grep -c "PLAN_CHANGED" || true)
echo "other hash refused: $WRONG_HASH"; [ "$WRONG_HASH" = "1" ]
ACK=$(node apps/cli/dist/main.js intents acknowledge "$INTENT_ID" "$PLAN_ID" --plan-hash "$PLAN_HASH" --staged --token "$SESSION_TOKEN" --url "http://127.0.0.1:$API_PORT" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{const j=JSON.parse(d);console.log(j.review.stagedAcknowledged+":"+(j.review.acknowledgedHash===j.planHash))})')
echo "acknowledged staged:hash-bound = $ACK"; [ "$ACK" = "true:true" ]
INTENT_STATE=$(node apps/cli/dist/main.js intents show "$INTENT_ID" --token "$SESSION_TOKEN" --url "http://127.0.0.1:$API_PORT" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{const j=JSON.parse(d);console.log(j.state+":"+(j.latestPlanId===process.argv[1]))})' "$PLAN_ID")
echo "intent state:latest-plan = $INTENT_STATE"; [ "$INTENT_STATE" = "AWAITING_APPROVAL:true" ]
CANCELLED=$(node apps/cli/dist/main.js intents cancel "$INTENT_ID" --token "$SESSION_TOKEN" --url "http://127.0.0.1:$API_PORT" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>console.log(JSON.parse(d).state))')
echo "cancelled state = $CANCELLED"; [ "$CANCELLED" = "CANCELLED" ]

echo "== execution journey (B10): buy -> sign -> submit -> finality -> sell; changed signature, retry, lost answer, no second purchase"
J() { node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{const j=JSON.parse(d);console.log(eval(process.argv[1]))})' "$1"; }
KEY_FILE="$KEY_DIR/demo-wallet.key"
EXEC_WALLET=$(node apps/cli/dist/main.js auth demo-wallet-link --keep-key "$KEY_FILE" --token "$SESSION_TOKEN" --url "http://127.0.0.1:$API_PORT" 2>/dev/null)
EXEC_WALLET_ID=$(echo "$EXEC_WALLET" | J 'j.walletId')
EXEC_WALLET_ADDRESS=$(echo "$EXEC_WALLET" | J 'j.address')
curl -fsS -X POST -H "content-type: application/json" -d "{\"address\":\"$EXEC_WALLET_ADDRESS\",\"lamports\":50000000,\"stablecoinRaw\":\"1000000000\"}" "http://127.0.0.1:$RPC_PORT/fixture/funding" > /dev/null
# AERO_ID was admitted by the catalog journey above.
BUY_ID=$(node apps/cli/dist/main.js intents create --instrument "$AERO_ID" --wallet "$EXEC_WALLET_ID" --budget 100000000 --idempotency-key startup-buy-1 --token "$SESSION_TOKEN" --url "http://127.0.0.1:$API_PORT" | J 'j.intentId')
BUY_PLAN=$(node apps/cli/dist/main.js intents plan "$BUY_ID" --token "$SESSION_TOKEN" --url "http://127.0.0.1:$API_PORT")
BUY_PLAN_ID=$(echo "$BUY_PLAN" | J 'j.planId'); BUY_PLAN_HASH=$(echo "$BUY_PLAN" | J 'j.planHash')
BUY_MAX_IN=$(echo "$BUY_PLAN" | J 'j.legs[0].maxInputRaw'); BUY_EXPECTED=$(echo "$BUY_PLAN" | J 'j.legs[0].expectedOutputRaw')
BEFORE_ACK=$(node apps/cli/dist/main.js intents build "$BUY_ID" --token "$SESSION_TOKEN" --url "http://127.0.0.1:$API_PORT" 2>&1 | grep -c "PLAN_NOT_APPROVED" || true)
echo "build before acknowledgement refused: $BEFORE_ACK"; [ "$BEFORE_ACK" = "1" ]
node apps/cli/dist/main.js intents acknowledge "$BUY_ID" "$BUY_PLAN_ID" --plan-hash "$BUY_PLAN_HASH" --token "$SESSION_TOKEN" --url "http://127.0.0.1:$API_PORT" > /dev/null
BUY_TX=$(node apps/cli/dist/main.js intents build "$BUY_ID" --token "$SESSION_TOKEN" --url "http://127.0.0.1:$API_PORT")
BUY_TX_SUMMARY=$(echo "$BUY_TX" | BUY_MAX_IN="$BUY_MAX_IN" J 'j.state+":"+j.effects.side+":"+(j.effects.maxInputRaw===process.env.BUY_MAX_IN)+":"+j.simulation.status+":"+j.instructions.map(i=>i.kind).join(",")')
echo "prepared state:side:bounded:simulation:instructions = $BUY_TX_SUMMARY"; [ "$BUY_TX_SUMMARY" = "prepared:buy:true:ok:compute_unit_limit,compute_unit_price,ata_create,route_swap" ]
BUY_MESSAGE_HASH=$(echo "$BUY_TX" | J 'j.messageHash')
WRONG_SIG=$(node apps/cli/dist/main.js intents submit "$BUY_ID" --signed "$(head -c 200 /dev/zero | base64 -w0)" --token "$SESSION_TOKEN" --url "http://127.0.0.1:$API_PORT" 2>&1 | grep -c "SIGNATURE_MISMATCH" || true)
echo "changed signature refused: $WRONG_SIG"; [ "$WRONG_SIG" = "1" ]
BUY_SIGNED_JSON=$(node apps/cli/dist/main.js intents sign --key-file "$KEY_FILE" --input "$BUY_TX" --message-hash "$BUY_MESSAGE_HASH")
BUY_SIGNED=$(echo "$BUY_SIGNED_JSON" | J 'j.signedTransaction')
BUY_SUBMIT=$(node apps/cli/dist/main.js intents submit "$BUY_ID" --signed "$BUY_SIGNED" --token "$SESSION_TOKEN" --url "http://127.0.0.1:$API_PORT" | J 'j.state+":"+j.attempts.length+":"+j.attempts[0].state')
echo "submitted state:attempts:attempt-state = $BUY_SUBMIT"; [ "$BUY_SUBMIT" = "SUBMITTED:1:submitted" ]
RETRY=$(node apps/cli/dist/main.js intents submit "$BUY_ID" --signed "$BUY_SIGNED" --token "$SESSION_TOKEN" --url "http://127.0.0.1:$API_PORT" | J 'j.attempts.length')
echo "retry with the same bytes creates no second attempt: $RETRY"; [ "$RETRY" = "1" ]
curl -fsS -X POST -H "content-type: application/json" -d '{"action":"finalize"}' "http://127.0.0.1:$RPC_PORT/fixture/chain" > /dev/null
BUY_FINAL=$(node apps/cli/dist/main.js intents reconcile "$BUY_ID" --token "$SESSION_TOKEN" --url "http://127.0.0.1:$API_PORT")
BUY_FINAL_SUMMARY=$(echo "$BUY_FINAL" | BUY_MAX_IN="$BUY_MAX_IN" BUY_EXPECTED="$BUY_EXPECTED" J 'j.state+":"+j.fills.length+":"+(j.fills[0].inputSpentRaw===process.env.BUY_MAX_IN)+":"+(j.fills[0].outputReceivedRaw===process.env.BUY_EXPECTED)+":"+j.fills[0].withinBounds+":"+j.nextAction')
echo "finalized state:fills:spent-bounded:received-expected:within-bounds:next = $BUY_FINAL_SUMMARY"; [ "$BUY_FINAL_SUMMARY" = "FINALIZED:1:true:true:true:none" ]
BOUGHT=$(echo "$BUY_FINAL" | J 'j.fills[0].outputReceivedRaw')
SELL_ID=$(node apps/cli/dist/main.js intents create --instrument "$AERO_ID" --sell --wallet "$EXEC_WALLET_ID" --budget "$BOUGHT" --idempotency-key startup-sell-1 --token "$SESSION_TOKEN" --url "http://127.0.0.1:$API_PORT" | J 'j.intentId+":"+j.kind+":"+j.budget.symbol')
echo "sell intent id:kind:budget-symbol = $SELL_ID"; case "$SELL_ID" in *:single_sell:FXAERO) ;; *) exit 1;; esac
SELL_ID=${SELL_ID%%:*}
SELL_PLAN=$(node apps/cli/dist/main.js intents plan "$SELL_ID" --token "$SESSION_TOKEN" --url "http://127.0.0.1:$API_PORT")
SELL_PLAN_SUMMARY=$(echo "$SELL_PLAN" | BOUGHT="$BOUGHT" J 'j.side+":"+j.legs[0].side+":"+(j.legs[0].maxInputRaw===process.env.BOUGHT)+":"+(j.funds.inputRaw===process.env.BOUGHT)')
echo "sell plan side:leg-side:input-bounded:funds-observed = $SELL_PLAN_SUMMARY"; [ "$SELL_PLAN_SUMMARY" = "sell:sell:true:true" ]
node apps/cli/dist/main.js intents acknowledge "$SELL_ID" "$(echo "$SELL_PLAN" | J 'j.planId')" --plan-hash "$(echo "$SELL_PLAN" | J 'j.planHash')" --token "$SESSION_TOKEN" --url "http://127.0.0.1:$API_PORT" > /dev/null
SELL_TX=$(node apps/cli/dist/main.js intents build "$SELL_ID" --token "$SESSION_TOKEN" --url "http://127.0.0.1:$API_PORT")
SELL_SIGNED=$(node apps/cli/dist/main.js intents sign --key-file "$KEY_FILE" --input "$SELL_TX" | J 'j.signedTransaction')
# Timeout after broadcast: the node executes the sell but its answer is lost; reconciliation recovers it without a second send.
curl -fsS -X POST -H "content-type: application/json" -d '{"action":"lose-next-response"}' "http://127.0.0.1:$RPC_PORT/fixture/chain" > /dev/null
SELL_SUBMIT=$(node apps/cli/dist/main.js intents submit "$SELL_ID" --signed "$SELL_SIGNED" --token "$SESSION_TOKEN" --url "http://127.0.0.1:$API_PORT" | J 'j.state+":"+j.attempts[0].state+":"+j.reconciliation.frozen')
echo "lost answer state:attempt:frozen = $SELL_SUBMIT"; [ "$SELL_SUBMIT" = "UNKNOWN_REQUIRES_RECONCILIATION:unknown:true" ]
SELL_RETRY=$(node apps/cli/dist/main.js intents submit "$SELL_ID" --signed "$SELL_SIGNED" --token "$SESSION_TOKEN" --url "http://127.0.0.1:$API_PORT" | J 'j.attempts.length')
echo "retry during reconciliation creates no second attempt: $SELL_RETRY"; [ "$SELL_RETRY" = "1" ]
curl -fsS -X POST -H "content-type: application/json" -d '{"action":"finalize"}' "http://127.0.0.1:$RPC_PORT/fixture/chain" > /dev/null
SELL_FINAL=$(node apps/cli/dist/main.js intents reconcile "$SELL_ID" --token "$SESSION_TOKEN" --url "http://127.0.0.1:$API_PORT" | BOUGHT="$BOUGHT" J 'j.state+":"+j.fills.length+":"+j.fills[0].side+":"+(j.fills[0].inputSpentRaw===process.env.BOUGHT)+":"+j.attempts.length')
echo "sell finalized state:fills:side:spent-all:attempts = $SELL_FINAL"; [ "$SELL_FINAL" = "FINALIZED:1:sell:true:1" ]
EXEC_FUNDING=$(curl -fsS -H "Authorization: Bearer $SESSION_TOKEN" "http://127.0.0.1:$API_PORT/v1/me/wallets/$EXEC_WALLET_ID/funding" | J '(BigInt(j.stablecoin.raw) < 1000000000n && BigInt(j.stablecoin.raw) > 990000000n)+":"+(Number(j.sol.lamports) < 50000000)')
echo "wallet after buy and sell: stablecoin within the round trip, SOL paid fees = $EXEC_FUNDING"; [ "$EXEC_FUNDING" = "true:true" ]
rm -f "$KEY_FILE"

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
