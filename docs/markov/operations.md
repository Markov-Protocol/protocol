# Operations

Status: B01 slice. Everything below is implemented unless marked *planned*.

## Processes and exit codes

| Process        | Entry                      | Exit codes |
| -------------- | -------------------------- | ---------- |
| API            | `node apps/api/dist/main.js` | 0 clean shutdown; 78 configuration/identity contradiction; 69 database or listener unavailable; 70 unexpected software error |
| Worker         | `node apps/worker/dist/main.js` | same mapping; Temporal connection failures after bounded retries exit 69 |
| Indexer        | `node apps/indexer/dist/main.js [--once]` | same mapping; idle (exit 0 with `{"idle":true}` for `--once`) when no registry program is configured |
| CLI            | `node apps/cli/dist/main.js` (`pnpm markov`) | 0 ok; 1 not ready; 64 usage; 69 unavailable; 78 configuration |

Boot order and fail-closed checks are described in `architecture.md`.

## Local development

```
pnpm install --frozen-lockfile
bash scripts/dev/install-temporal-cli.sh      # once
bash scripts/dev/temporal-dev.sh              # terminal 1 (or docker compose up)
cp .env.example .env                          # edit DATABASE_URL etc.
pnpm build
pnpm markov db migrate                        # migrates, binds identity, seeds readiness
pnpm dev:api                                  # terminal 2
pnpm dev:worker                               # terminal 3
pnpm markov health
pnpm markov worker ping
```

`scripts/dev/postgres-local.sh` prepares a PostgreSQL 16 server without
Docker; `docker-compose.yml` provides PostgreSQL and Temporal with Docker
(not executed in B01, see OD-16).

## Migrations

1. Change `packages/db/src/schema.ts`.
2. `pnpm db:generate` writes a new SQL file under `packages/db/migrations/`.
3. Review the SQL by hand (expand/backfill/contract; never destructive without
   a documented rollback) and commit it with the journal.
4. Deploy: `markov db migrate` (production requires `--allow-production` and
   an attributable `--bound-by`). The process refuses to bind an identity that
   contradicts the one already stored.
5. CI fails if `drizzle-kit check` or a regenerated migration differs from
   the committed files.

## Operator credentials

Operators never sign in through the public API. With database access:

```
pnpm markov operators create --label "on-call" --scopes ops:read,ops:credentials:revoke --expires-days 30
```

The token is printed once; only its peppered hash is stored, and the
creation is written to `audit_events`. Revoke by expiring or through a
future operator route (B18). Rotate `CREDENTIAL_PEPPER` only with a
documented re-issuance of every credential; changing it invalidates all
sessions and credentials at once.

## Catalog admission

Operators with `ops:catalog:write` run the lifecycle through the API or the
CLI:

```
markov catalog ingest --issuer prestocks --source configured_url --token <op> --url https://api…
markov catalog list --status quarantined --token <op> --url …
markov catalog verify-mint <instrumentId> --token <op> --url …
markov catalog decide <instrumentId> --decision admit --reason "terms reviewed" --evidence review=TR-12 --token <op> --url …
```

`fixture` sources exist only in local and test. Admission is refused
without a `verified` mint verification recorded after the last upstream
change. Pause when an issuer notice or a suspicious upstream change arrives;
delist when the issuer withdraws. Every decision is audited with the reason
and evidence references (never secrets). Until OD-17 is resolved
`PRESTOCKS_FEED_URL` stays unset and the capability is BLOCKED.

## Corporate actions and halts

```
markov catalog events ingest --issuer xstocks --source configured_url --token <op> --url …
markov catalog events list --issuer xstocks --status pending --token <op> --url …
markov catalog events apply <actionId> --reason "issuer notice verified" --evidence notice=… --token <op> --url …
markov catalog events reject <actionId> --reason "issuer withdrew" --token <op> --url …
markov catalog multiplier <instrumentId> --as-of 2026-09-21T00:00:00Z --url …
markov catalog convert <instrumentId> --raw 150000000 --as-of … --url …
```

Apply an event only once it is effective and after reading the issuer's
notice; splits and multiplier changes need prior multiplier evidence (a
verified mint read) or the application is refused. A halt (applied event
or an on-chain pause seen by verification) blocks new strategy versions
immediately and is visible on every public instrument. A migration or
sunset keeps research available and blocks strategies; holders are
notified through the notification sessions (B15). Never apply an event to
"fix" a valuation; corrections are new evidence, not rewrites.

## Eligibility, terms and policy

```
markov policy rules publish --file rules.json --token <op> --url …        # counsel-approved rule set (versions immutable)
markov policy rules list --token <op> --url …
markov policy terms publish --file terms.json --token <op> --url …        # https URL and SHA-256 of the shown text
markov policy revoke <decisionId> --reason "counsel update" --token <op> --url …
markov policy participants add <userId> --note "pilot cohort" --token <op> --url …
markov policy eligibility --token <session> --url …                       # what a person still has to do
markov policy evaluate --instrument <id> --notional 100000000 --intent <id> --cash 1000000000 --reserve --token <session> --url …
```

Operators hold `ops:policy:read` / `ops:policy:write`. `--fixture` publishes
the user-assigned-code fixtures and works only in local and test. Publishing
a new rule set does not extend anyone's eligibility: decisions made under
another version are superseded and people declare again. Revocation is
immediate and audited. Limits can only be tightened by owners; loosening
the ceiling means changing policy defaults in code or the approved `BETA_*`
caps (OD-12), never a per-user override. Beta caps apply to every account
as soon as they are configured; the participant allowlist is enforced only
when `BETA_PARTICIPANT_ALLOWLIST_ENABLED=true`.

## Research

```
markov research thesis create --title … --claim … --token <session> --url …
markov research source attach <thesisId> --source-url https://… --role issuer --token <session> --url …
markov research run create --thesis <thesisId> --question "…" --source <sourceId> --token <session> --url …
markov research thesis publish <thesisId> --visibility public --token <session> --url …
```

`RESEARCH_MODEL_PROVIDER` is `disabled` by default: theses, sources and
mapping work without a model, and runs answer 503. `fixture` is a
deterministic adapter for local and test only (configuration refuses it
elsewhere); no hosted provider exists yet (OD-19). Source retrieval goes
out from the API process under the safe-retrieval policy
(`docs/markov/research.md`): if the deployment sits behind an egress
proxy, allow public https to the sources people cite; nothing needs
access to internal names, and the policy refuses them anyway. A blocked
or failed source is recorded with its reason and can be re-attached later.
Audit actions: `research.*`.

## Strategies

```
markov strategy limits --url …
markov strategy create --input '{"title":"…","thesis":"…","legs":[{"instrumentId":"…","weightBps":6000}],"cashWeightBps":4000}' --token <session> --url …
markov strategy freeze <strategyId> --if-revision <n> --token <session> --url …
markov instance create --strategy <strategyId> --version-id <versionId> --wallet <walletId> --token <session> --url …
```

`STRATEGY_MAX_LEGS` (default and maximum 10) may be lowered for a beta;
raising it above 10 is refused by configuration. Lowering it affects
drafts and freezes from then on and never invalidates a frozen version.
Concentration ceilings come from the policy defaults or the configured
`BETA_*` caps (`GET /v1/strategies/limits` shows which). Migration
`0007_strategies` adds `strategies`, `strategy_drafts`,
`strategy_versions` and `portfolio_instances`; versions are never
updated or deleted by the application, and an archived strategy keeps
every row. Audit actions: `strategy.*`, `instance.*`.

## Registry

```
markov registry status --url …
markov strategy publish <strategyId> --version-id <versionId> --wallet <walletId> --token <session> --url …
markov registry submit <publicationId> --signed <base64> --token <session> --url …
markov registry publication <publicationId> --token <session> --url …
markov registry public-version <strategyId> <versionId> --url …
markov-indexer            # apps/indexer: loops every REGISTRY_INDEX_INTERVAL_SECONDS
markov-indexer --once     # one pass, prints the report as JSON
```

`REGISTRY_PROGRAM_ID` names the deployed program; unset, publication is
disabled, the indexer is idle and the public registry routes answer 503.
`mainnet-read-only` indexes and serves records but never publishes;
production publication requires `RELEASE_EVIDENCE_REF`. Migration
`0008_registry` adds `strategy_publications`, `registry_records` and
`registry_indexer_state`. Audit actions: `strategy.publication.prepare`,
`strategy.publication.submit`, `strategy.publication.rejected`,
`strategy.publication.deprecate`, `strategy.publication.reactivate`.
Records are never updated by the application except by mirroring finalized
chain state; a version's `publication` column follows its publication.

Operating the indexer: run one `markov-indexer` per deployment next to the
API (it shares the database and the primary RPC). `GET /v1/registry`
reports `indexer.lastRunAt`, `lastObservedSlot` and `recordsIndexed`;
alert when `lastRunAt` is older than three intervals or
`registry_indexer_state.last_error` is set (registry-index lag). A stuck
`submitted` publication resolves to `expired` once its blockhash is past;
`unknown` means the node could not be asked and clears on the next
successful pass. Deployment, upgrade authority and review gates:
`docs/markov/strategy-registry.md`.

## Execution planning

```
markov intents create --version-id <versionId> --wallet <walletId> --budget <raw> --token <session> --url …
markov intents create --instrument <instrumentId> --wallet <walletId> --budget <raw> --token <session> --url …
markov intents list --token <session|agent> --url …
markov intents show <intentId> --token <session|agent> --url …
markov intents plan <intentId> --token <session> --url …
markov intents plan-show <intentId> <planId> --token <session|agent> --url …
markov intents acknowledge <intentId> <planId> --plan-hash <hash> [--staged] --token <session> --url …
markov intents cancel <intentId> --token <session> --url …
markov intents verify-plan --file plan.json      # offline: hash, conservation, bounds
```

`EXECUTION_VENUE_PROVIDER` selects the venue adapter: `disabled` (every
plan build answers 503), `fixture` (local/test only; synthetic quotes for
the fixture mints) or `configured_url` (`EXECUTION_VENUE_QUOTE_URL`, an
operator-run gateway serving the Markov quote contract over https, with an
optional bearer key in `EXECUTION_VENUE_API_KEY`). Any venue needs
`FUNDING_STABLECOIN_MINT` (plans are budgeted in that stablecoin); the
configuration fails closed otherwise. Migration `0010_planning` adds
`intents`, `execution_plans` and `venue_quotes`. Audit actions:
`planning.intent.created`, `planning.plan.built`, `planning.plan.refused`,
`planning.plan.acknowledged`, `planning.intent.cancelled`.

Operating: plan builds are rate-limited to 20 per minute per client and
intent creation to 30; watch the audit log for `planning.plan.refused` and
the API's 503s on `/plans` (venue unreachable, refused quotes) separately
from 403s (`POLICY_DENIED`) and 409s (`INSUFFICIENT_FUNDS`). Rows in
`venue_quotes` with `accepted = false` list why a quote was refused; a
burst of `PROGRAM_NOT_REVIEWED` means the venue routes through a program
the matrix has not reviewed (`packages/planning/src/programs.ts`), which
is a review task, never a config switch. Plans expire with their quotes
(30 s from the fixture venue) and policy decisions; an open intent expires
after 24 hours. Contract: `docs/markov/execution-planning.md`.

## Execution

```
markov intents create --instrument <instrumentId> --sell --wallet <walletId> --budget <rawInstrumentUnits> --token <session> --url …
markov intents create --version-id <versionId> --continue-intent <partiallyCompletedIntentId> --wallet <walletId> --budget <sumOfUnfilledTargets> --token <session> --url …   # reviewed completion (B11)
markov intents build <intentId> --token <session> --url …          # build, validate, simulate the plan's next transaction; answers the prepared transaction
markov intents sign --key-file <path> --input '<prepared json>' [--message-hash <hex>]   # NONPRODUCTION: demo wallet key from `auth demo-wallet-link --keep-key`
markov intents submit <intentId> --signed <base64> [--transaction-index 0] --token <session> --url …
markov intents execution <intentId> --token <session|agent> --url … # status with attempts, fills, evidence
markov intents reconcile <intentId> --token <session> --url …
```

`EXECUTION_WRITES_ENABLED=true` is required for any submission (policy
denies with `EXECUTION_DISABLED` otherwise); it is refused outside the
write-capable modes and on mainnet outside production, where it also needs
the `BETA_*` caps, the allowlist and `RELEASE_EVIDENCE_REF`. A
`configured_url` venue builds only with `EXECUTION_VENUE_BUILD_URL` (https
outside local/test); without it plans are quoted but every build answers
`PROVIDER_UNAVAILABLE`. Migration `0011_execution` adds
`prepared_transactions`, `execution_attempts` (at most one live attempt per
intent), `execution_fills` (one per signature and leg) and `outbox_events`;
`0012_continuations` adds the continuation columns on `intents` and the
`execution.partial` outbox kind. `EXECUTION_VENUE_FIXTURE_COMPOSE_MAX_LEGS`
(fixture venue only; refused with any other provider) caps how many
constituents the fixture venue composes into one transaction so tests and
the web journeys can keep a staged basket; leave it unset elsewhere.
Audit actions: `execution.transaction.prepared`,
`execution.transaction.refused` (with the refusal codes),
`execution.submission.refused`, `execution.attempt.persisted`,
`execution.attempt.submitted`, `execution.attempt.failed`,
`execution.attempt.unknown`, `execution.reconciled`,
`planning.intent.cancel_requested`.

The worker starts one durable `executionReconciliationWorkflow` per task
queue (`execution-reconciliation:<queue>`) at boot and finds it running on
restarts; it runs one round every 5 s over every live attempt (signature
status, finalized block height, resend of the same bytes, settlement on
evidence). The API reconciles a live attempt on status reads too (throttled)
and on demand. Operating: a growing count of intents in
`UNKNOWN_REQUIRES_RECONCILIATION` means the node is not answering (the
attempts keep their signed bytes and settle once it does) or a fill
violated its bounds (`execution_fills.within_bounds = false`, frozen for a
person's review); `execution.transaction.refused` audit rows with
`VALIDATION_FAILED` codes mean the venue produced bytes the plan does not
explain, which is a venue incident, never a config switch. Never rebuild or
re-sign on a person's behalf: a stuck attempt is observed, resent as the
same bytes while its blockhash lives, and expires on evidence.

Baskets (B11): a plan is atomic only when its composed transaction fit and
simulated at plan time (`grouping.reason: composition_fits`); a staged plan
lands one leg per transaction, and its later legs are quoted again before
they are built. `PARTIALLY_COMPLETED` intents are not incidents: they are
the recorded outcome of a later leg failing, expiring, going stale
(`LEG_TERMS_CHANGED`, the refused fresh quote is stored in `venue_quotes`)
or being cancelled after an earlier leg filled. Nothing reallocates; the
person completes the rest with a continuation intent (`intents create
--continue-intent`) or leaves it. A growing count of `stale` batches across
intents means the venue's prices move faster than the plan validity, which
is a product or venue question, never a reason to loosen bounds. Contract:
`docs/markov/execution-state-machine.md`.

## Accounting and receipts

```
markov portfolio project --token <session> --url …                      # project settled fills into the journal now (idempotent)
markov portfolio holdings <walletId> --token <session|agent> --url …    # journal against the last chain observation, attribution per asset
markov portfolio reconcile <walletId> --token <session> --url …         # read the chain, record a checkpoint, flag unexplained flows
markov portfolio journal <walletId> --token <session|agent> --url …
markov portfolio acknowledge <entryId> --kind deposit|withdrawal|transfer|other [--note …] --token <session> --url …
markov portfolio instance-holdings <instanceId> --token <session|agent> --url …
markov receipts issue <intentId> [--kind decision|execution] --token <session> --url …
markov receipts list|show|keys …
markov receipts visibility <receiptId> --public|--private --token <session> --url …
markov receipts verify --file <receipt.json> [--keys-file <keys.json> | --url …]   # offline with a saved keys document
```

Migration `0013_accounting` adds `journal_entries` and `journal_lines`
(append-only; `(owner_user_id, source_ref)` unique), `lots` and
`lot_consumptions`, `reconciliation_checkpoints`, `receipt_signing_keys` and
`receipts` (one per intent, kind and intent state). The worker projects
fills in its reconciliation round (`projectJournal`); the API projects the
caller's fills before every holdings, journal and reconciliation answer.
Receipts need `RECEIPT_SIGNING_PROVIDER=local_key` with
`RECEIPT_SIGNING_KEY` (Ed25519 PKCS#8, base64) and `RECEIPT_SIGNING_KEY_ID`
outside production; production refuses a local key and the KMS signer is
OD-22, so production issues no receipts until then (the routes answer
`PROVIDER_UNAVAILABLE`, nothing else changes). At boot the configured key is
recorded as active in `receipt_signing_keys` and any other key is retired;
retired keys keep verifying the receipts they signed, so never delete a key
row. Rotating: start the API with the new key and id; the old key's row
turns `retired` with `valid_to` set. Audit actions:
`accounting.wallet.reconciled` (checkpoint, slot, status, flagged entries),
`accounting.flow.acknowledged`, `accounting.receipt.issued`,
`accounting.receipt.visibility`.

Operating: a wallet whose holdings show `needs_reconciliation` has an
external flow waiting for the person's explanation, which only they can
give (an operator never attributes a flow to a strategy). A checkpoint with
`unassigned_asset` means the wallet holds a mint the catalog does not know;
it is shown, never journaled. `stale` means fills settled after the last
observation and the next reconciliation will normally match. A lot
consumption shortfall in the worker log (`sell consumed more than the
attributed lots hold`) means the person sold tokens the platform did not
buy for them; the shortfall is recorded, nothing is invented. A receipt
whose verification fails against the published keys is an incident:
receipts are never re-signed in place; a corrected record is a new receipt
for the changed intent state.

## Performance analytics

```
markov performance wallet <walletId> [--period 7d|30d|90d|365d|all] [--export] --token <session|agent> --url …
markov performance instance <instanceId> [--period …] [--export] --token <session|agent> --url …
markov performance version <strategyId> <versionNumber> [--period …] [--export] [--token <session>] --url …
markov performance rankings [--period 30d|90d|365d] [--limit n] --url …
markov performance methodology --url …
markov prices record --instrument <instrumentId> | --sol --kind <kind> --value <decimal> --observed-at <iso> --source <name> [--evidence k=v …] --token <operator> --url …
markov prices history <instrumentId>|sol [--from <iso>] [--to <iso>] [--limit n] --url …
```

Migration `0014_analytics` adds `price_observations` (append-only, unique
per asset, kind, source and observation time). Ingestion records every
reference price a snapshot carries; operators record observations with
evidence through `ops:catalog:write` (`analytics.price.recorded` audit
action). Series are computed on read from the journal, the lots and every
observation of the subject's assets, bounded (20,000 observations; 5,000
journal entries) and rate limited (60/min per client, rankings 20/min);
there is no snapshot job yet (OD-23). The methodology version is
`stocks-v1`; changing a rule means a new version and a new ranking cohort.

Operating: a return of `null` with `stale_price` or `stale_end` means no
observation of an asset within 24 hours of the point; record or restore
the source rather than relaxing the rule. `multiplier_unknown` means a
scaled token has no multiplier evidence at that time (B04 verification or
an applied corporate action supplies it). `unpriced_flow` means a deposit
or withdrawal of an asset nobody can price at that moment. A ranking that
lists a version unranked with `insufficient_history` is the 30-day product
rule; `incomplete_window` means a day without an observation inside the
window. Rankings never include an account's series, whatever it shows.

## Documentation site

`apps/docs` is the Docusaurus site served at `https://markov.pet/docs`
(site `url` `https://markov.pet`, `baseUrl` `/docs/`). It contains no
hand-copied documentation: `pnpm docs:build` first runs
`apps/docs/scripts/sync-content.mjs` (every document under `docs/markov`,
`docs/markov/adr`, `docs/frontend`, `docs/frontend/design-reference` and
`docs/sessions`, with an edit link to the source file and links to
evidence or code rewritten to the repository), then
`generate-api-reference.mjs` (one page per tag of `docs/markov/openapi.json`
with parameters, bodies and responses) and `generate-cli-reference.mjs`
(the command tree of the built `apps/cli`, so `pnpm build` runs first),
then `docusaurus build` with broken links and anchors as errors. Generated
pages live under `apps/docs/docs/{reference,api,cli}` and are ignored by
git; the hand-written guides live under `apps/docs/docs/{intro.md,
getting-started,guides,contributing.md}`, and their commands are the ones
`scripts/ci/startup-check.sh` runs.

```
pnpm docs:start          # local preview, http://127.0.0.1:3200/docs/
pnpm docs:build          # sync, generate, build (part of pnpm verify and CI)
pnpm docs:serve          # serve the built site on 127.0.0.1:3200
pnpm docs:e2e            # Playwright against the served build at 1280 and 320 px (CI)
```

Serving: the built `apps/docs/build` directory is static and must be
served under the `/docs/` path prefix by any static host or by the docs
origin. The app (`apps/web`) proxies `/docs` and `/docs/*` to that origin
only when `MARKOV_DOCS_ORIGIN` is configured (a bare origin, https outside
local and test); unset means `/docs` is not served by the app, never a
fallback. Deploying the site to `markov.pet` is a deployment step outside
this repository (DNS and hosting are out of scope; see OD-24) and is not
performed by any session.

Theme: the site reads `packages/ui/src/styles/tokens.css` at build time
(`src/css/markov-tokens.generated.css`), uses the Inter files under
`apps/web/src/assets/fonts`, and reproduces the Mark I frame (cream
perimeter, dark screen) in both colour modes; the light mode uses the
darker accent from the design system for contrast on the cream frame.

## Readiness and monitoring

- Liveness (`/healthz`) restarts a hung process; readiness (`/readyz`) removes
  it from load balancing. A healthy API with an unverified network identity
  is *not ready* on purpose.
- The network identity monitor re-checks every configured RPC endpoint every
  15 seconds and logs at `fatal` on a mismatch.
- Logs are JSON with `service`, `version`, `env`, `requestId` and redaction of
  credential-bearing keys. RPC and database URLs are logged only in redacted
  form.
- *Planned*: OpenTelemetry traces from request to receipt, metrics and alert
  thresholds with owners and runbooks (B18); provider outage, stuck
  transaction, asset halt, emergency pause and restore procedures arrive with
  the features they cover.

## Emergency

*Planned*: operator pause/recovery commands (B18). In B01 the only controls
are configuration (`EXECUTION_WRITES_ENABLED=false` is the default and the
only permitted value outside production) and stopping the process.
