# Operations

Status: covers B01 to B16, the B17 xAI adapter, the documentation site
(D01) and the Vercel deployments of both frontends. Everything below is
implemented unless marked *planned*; no backend is hosted anywhere yet and
no program is deployed on any cluster.

## Processes and exit codes

| Process        | Entry                      | Exit codes |
| -------------- | -------------------------- | ---------- |
| API            | `node apps/api/dist/main.js` | 0 clean shutdown; 78 configuration/identity contradiction; 69 database or listener unavailable; 70 unexpected software error |
| Worker         | `node apps/worker/dist/main.js` | same mapping; Temporal connection failures after bounded retries exit 69 |
| Indexer        | `node apps/indexer/dist/main.js [--once]` | same mapping; idle (exit 0 with `{"idle":true}` for `--once`) when no registry program is configured |
| CLI            | `node apps/cli/dist/main.js` (`pnpm markov`) | 0 ok; 1 not ready, an error answer from the API or a failed receipt verification; 64 usage (2 for `agent call --input` that is not JSON); 65 a plan or keys document not in the expected shape; 69 unavailable; 70 unexpected software error; 78 configuration |

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
5. The migration drift step of `.github/workflows/ci.yml` fails if
   `drizzle-kit check` fails or a regenerated migration differs from the
   committed files; CI runs start with P01, and `pnpm verify` runs
   `pnpm db:check` locally.

## Operator credentials

Operators never sign in through the public API. With database access:

```
pnpm markov operators create --label "on-call" --scopes ops:read,ops:credentials:revoke --expires-days 30
```

The token is printed once; only its peppered hash is stored, and the
creation is written to `audit_events`. Revoke by expiring or through a
future operator route (planned for B18, whose scope moved to the
production completion plan). Rotate `CREDENTIAL_PEPPER` only with a
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
sunset keeps research available and blocks strategies; holders are not
yet notified (the event contract has no instrument lifecycle kind; B16
notifications cover proposals, reviews, execution, stale data, device
revocation and schedule outcomes). Never apply an event to
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
elsewhere); `xai` (B17) is the chosen hosted provider, configured as
described under Agents and companion below and unverified live from the
build environment (OD-19, SR-XAI-01). Source retrieval goes
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

## Discovery and moderation

```
markov discovery explore [--q …] [--issuer …] [--instrument <id>] [--creator <wallet>] [--period 30d|90d|365d] [--sort rank|newest|followers] [--limit n] [--cursor c] --url …
markov discovery creator <publisherWallet> --url …
markov discovery follows|follow <strategyId>|unfollow <strategyId> --token <session> --url …
markov strategy moderate <strategyId> <versionId> --status hidden|none --reason "…" [--reference <url>] --token <operator> --url …
markov strategy moderation <strategyId> --token <operator> --url …
```

Migration `0015_discovery` adds `moderation_decisions` (append-only
history of every moderation decision with reason, reference and the
operator credential id). The explorer and creator pages are public,
computed on read from the registered population (bounded at 500
versions) and the B13 model ranking, rate limited at 60/min per client.
Moderation needs an operator credential with `ops:discovery:write`
(`markov operators create --scopes ops:discovery:read,ops:discovery:write`);
each decision is audited as `strategy.moderate`. Hiding a version is a
listing decision: it never touches the chain record, the owner's own
reads or anyone's pin, and it withdraws proposals of that version from
other people's instances. Restore visibility with `--status none` and a
reason; the history shows both decisions.

Operating: an explorer row with `rank: null` is the methodology speaking
(`insufficient_history`, `incomplete_window`, `stale_end`), not a fault;
record the missing observations rather than relaxing a rule. A creator
page 404 means the wallet registered no listed strategy (archived and
hidden versions do not count). Archiving a strategy removes it from the
explorer and the ranking while everything it published stays readable.

## Agents and companion

```
markov agent tools --token <session|agent> --url …
markov agent call instruments.search --input '{"q":"aero"}' --token <agent> --url …
markov agent call investment.propose --input '{"strategyVersionId":"…","walletId":"…","budget":{"rawAmount":"1000000000"}}' --token <agent> --url …
markov companion ask "Compare the two aerospace exposures." --instrument <id> --token <session> --url …
markov companion runs|run <runId>|cancel <runId> --token <session> --url …
markov proposals list|show <id> --token <session|agent>; markov proposals open|dismiss <id> --token <session> --url …
markov events --after <seq> --token <session|device> --url …
```

Migration `0016_agents` adds `companion_runs`, `agent_proposals` and
`mark_events`. `COMPANION_MODEL_PROVIDER` is `disabled` by default: the
typed tools work with the caller's own authority and companion runs
answer 503; `fixture` is a deterministic adapter for local and test only
(configuration refuses it elsewhere) that follows every `TOOL:` directive
it reads, which is what the adversarial tests rely on. No hosted provider
is live-verified yet (OD-19, SR-XAI-01): xAI Grok is the selected provider
and its adapter exists (B17). Before `xai` is configured outside
local/test, record the provider's terms and retention in
`docs/markov/agent-permissions.md` (the data sent is recorded there since
B17).
`COMPANION_DAILY_COST_LIMIT_MICROS` (default 5 000 000) caps an account's
rolling daily spend; a refused run answers `BUDGET_EXHAUSTED`. `xai` (B17)
selects xAI Grok for either adapter through `@markov/model-xai`: set
`XAI_API_KEY` (refused without a provider set to `xai`, required with one),
`XAI_MODEL` (default `grok-4`), `XAI_BASE_URL` (https outside local/test),
`XAI_TIMEOUT_MS` and the per-token prices in micros
(`XAI_INPUT_MICROS_PER_TOKEN`, `XAI_OUTPUT_MICROS_PER_TOKEN`) that the
cost budgets are measured in. The key is never logged; `markov config
show` reports only that it is configured. A `401`/`403` from the provider
fails the run with `unauthorized` (fix the key), `429` and `5xx` fail it as
retryable (the person retries), and a reply that is not the JSON protocol
fails a research run and becomes plain answer text in a companion run;
nothing a model says can call an unlisted tool. No live call has been
verified from the build environment (SR-XAI-01); record the first one in
`docs/markov/provider-capabilities.md`.

Operating: a run's `provenance.steps` lists every tool call the model
asked for with its outcome; a burst of `refused` steps naming tools that
do not exist or arguments outside the schema is a model being steered by
something it read, and is exactly what the boundary is for. Proposals
expire on their own (30 days for a draft, one day for an investment, seven
for a rebalance); nothing opens them but the owner. Events are facts;
the maintenance pass projects them into the notification outbox (below).
Audit actions: `agent.*`, `companion.*`.

## Maintenance and notifications

```
markov workers create --label <worker> --expires-days 90            # database access; the token becomes MAINTENANCE_API_TOKEN
markov schedules create --input '{"kind":"recurring_investment","label":"…","cadence":{"unit":"month","dayOfMonth":1,"timeOfDay":"09:00","timeZone":"Europe/Berlin"},"target":{"strategyVersionId":"…","walletId":"…","budget":{"rawAmount":"1000000000"}}}' --token <session> --url …
markov schedules preview --input '{"cadence":{…},"count":5}' --token <session> --url …
markov schedules list|show <id>|occurrences <id> --token <session|agent>; markov schedules update|pause|resume|cancel <id> --token <session> --url …
markov maintenance run --token <worker|operator ops:maintenance:run> --url …
markov notifications list [--unread] [--category proposals] --token <session|device> --url …
markov notifications preferences [--input '{"categories":{"proposals":{"inApp":true,"email":true}}}'] --token <session> --url …
markov notifications email set <address>|verify <code>|clear --token <session> --url …
markov notifications dead-letter|retry <notificationId> --channel email|fixture-outbox --token <operator> --url …
markov mandates dry-run --input '{"mandate":{…},"action":{…}}' --token <session> --url …
```

Migration `0017_maintenance` adds `schedules`, `schedule_occurrences`,
`notifications`, `notification_deliveries`, `notification_preferences`
and `notification_projection_cursor`, and the proposal columns
`schedule_id`, `occurrence_id` and the unique `dedup_key`. The worker
drives passes when `MAINTENANCE_API_URL` and `MAINTENANCE_API_TOKEN` are
set (a `markov workers create` credential holding `maintenance:run`; the
API resolves the `mkv_wk_…` prefix like any credential and audits every
pass as `maintenance.run`); `MAINTENANCE_TICK_SECONDS` (default 60) is
the tick. Without them the worker logs that it is not driving schedules
and an operator with `ops:maintenance:run` can run passes by hand. Each
pass claims one due schedule per transaction, so several workers or an
operator running alongside never double-process a schedule, and a pass
repeated after a crash answers the existing proposal.

`NOTIFICATIONS_EMAIL_PROVIDER` is `disabled` by default: in-app
notifications work, email deliveries are `skipped` and setting an address
answers `unavailable`. `fixture` is a recording adapter for local and test
only (configuration refuses it elsewhere; operators read what it would have
sent through `notifications fixture-outbox`). `configured` needs
`NOTIFICATIONS_EMAIL_URL`, `NOTIFICATIONS_EMAIL_API_KEY` and
`NOTIFICATIONS_EMAIL_FROM` and posts each message as JSON with the
idempotency key as a header; no live provider is integrated (OD-25).
`NOTIFICATIONS_APP_ORIGIN` prefixes the app paths in emails.

Operating: `schedules occurrences` explains every occurrence; a run of
`skipped` with `missed_window` means the worker was down or the review
window is shorter than the tick, and nothing was spent either way; a
`revoked` schedule names what disappeared (its wallet, version or
instance) and must be recreated by the owner. `notifications dead-letter`
lists deliveries that exhausted their retries with the provider's last
answer; fix the cause, then `notifications retry`. Nothing is resent on
its own. The mandate dry run stores nothing and `automation.unattended`
stays `DISABLED`; no configuration flag enables unattended execution.
Audit actions: `maintenance.*`, `notification.*`,
`worker.credential.created`.

## Documentation site

`apps/docs` is the Docusaurus site built for `https://markov.pet/docs`
(site `url` `https://markov.pet`, `baseUrl` `/docs/`); `markov.pet` is not
routed to it yet, and it is served on Vercel (below). It contains no
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
fallback. DNS for `markov.pet` stays out of scope (OD-24); the hosting of
both frontends on Vercel is described below.

## Frontends on Vercel

Two Vercel projects building this repository (monorepo, pnpm); they are not linked through the Vercel GitHub App (see below), so each deployment is created from the public repository as its git source:

| Project | Root directory | Settings source | Production output |
| ------- | -------------- | --------------- | ----------------- |
| `markov-web` | `apps/web` | `apps/web/vercel.json`: Next.js preset, install at the repository root with the pinned pnpm, `pnpm --filter @markov/web... run build` (builds the workspace packages the app imports, then `next build`) | the app at `https://markov-web-theta.vercel.app` (Vercel assigned the hostname), later `markov.pet` |
| `markov-docs` | `apps/docs` | `apps/docs/vercel.json`: no framework preset, install at the root, `pnpm run build` (the CLI reference needs `apps/cli/dist`) then `pnpm --filter @markov/docs run build:vercel`, output `out` (the site staged under `out/docs/`, clean URLs, `/` redirects to `/docs/`) | `https://markov-docs.vercel.app/docs/`, proxied by the app under `/docs` |

First deployed 2026-09-25 from commit `7840da2` of the branch under review
(a pre-rewrite hash; the rewritten commit `9b6bde3`, `build(web): describe
the Vercel projects for both frontends`, has the identical tree) through
the Vercel API with the repository as the git source: the repository is
public, so Vercel fetches it without the GitHub App, but
nothing deploys on push until the Vercel GitHub App is installed for the
`Markov-Protocol` organisation with access to `protocol` (linking a
project answers `repo_no_access` until then). Node 22.x in both projects,
deployment protection off (both are public), and the environment below.
Production deployments are created from the branch under review until
`main` carries the code.

Environment of `markov-web` (all targets unless noted):

| Variable | Value | Why |
| -------- | ----- | --- |
| `MARKOV_ENV` | `staging` | The web guards refuse fixtures and require an https API origin; `production` additionally requires the public origin and is reserved for the release candidate |
| `MARKOV_API_ORIGIN` | `https://api.markov.pet`, a placeholder until the API is hosted (then wherever it runs) | Server-only. Until the API is deployed the app reports the API as unreachable on every signed-in screen rather than showing fake data |
| `NEXT_PUBLIC_APP_ORIGIN` | the project's production URL, later `https://markov.pet` | Absolute links, callback validation, the session cookie's `Secure` attribute |
| `MARKOV_DOCS_ORIGIN` | `https://markov-docs.vercel.app` | Proxies `/docs` to the documentation site; unset means `/docs` is not served |
| `MARKOV_WEB_INTERNAL_ROUTES`, `MARKOV_WEB_FIXTURES` | `false` | Never enabled outside local and test |

`markov-docs` needs no variables. Neither project holds a secret: provider
keys, RPC credentials, signing keys and the credential pepper live with
the API and the worker, which Vercel does not host. The API, worker and
indexer go to Railway, selected by the product owner on 2026-09-25
(OD-11); the PostgreSQL service and the Temporal service (on Railway or
Temporal Cloud) are still open, and nothing is provisioned yet
(`docs/prompts/backend-railway.md`, P02). After the API exists, point
`MARKOV_API_ORIGIN` at it, add the app origin to the API's
`API_ALLOWED_ORIGINS`, and redeploy the app; the identity provider's
callback must list the app origin as well.

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
  thresholds with owners and runbooks (P18, OD-03); provider outage, stuck
  transaction, asset halt, emergency pause and restore procedures arrive with
  the features they cover.

## Emergency

*Planned*: scoped operator pause controls (P18) and restore and recovery
procedures (P22). Until then the controls are configuration
(`EXECUTION_WRITES_ENABLED` defaults to `false`; it is refused in
`mainnet-read-only` and on mainnet-beta outside production, and production
also needs the `BETA_*` caps, the allowlist and `RELEASE_EVIDENCE_REF`),
instrument `pause`/`delist` decisions, listing moderation, the owner's
schedule pause and cancel, and stopping the process.
