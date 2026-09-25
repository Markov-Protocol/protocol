# Markov, A to Z: what is built, what is not, and the decisions behind it

State as of 2026-09-25 on branch `claude/affectionate-gauss-2ml7ll` (35
commits ahead of `main`, which holds only the initial commit). This page is
the single inventory of the repository: every domain, its logic, how it was
verified, what is deliberately not built, and every decision that shaped
it. Nothing described here is production-ready, audited or deployed to a
live cluster; the frontends run on Vercel against no backend, and every
provider capability carries its verification state.

The verification vocabulary used throughout, from
`docs/markov/provider-capabilities.md`: `IMPLEMENTED` (code and tests
without an external provider), `FIXTURE_VERIFIED` (exercised against
sanitised fixtures or the in-memory fixture chain), `LIVE_READ_VERIFIED`,
`LIVE_WRITE_VERIFIED`, `BLOCKED` (a provider or evidence is missing) and
`DISABLED` (off by design). A configured credential, a mock, a successful
HTTP response or a transaction signature is never counted as proof of
production execution.

## 1. The product and its control model

Markov turns an investment thesis into a versioned, explainable portfolio
of tokenised stock exposures on Solana (PreStocks pre-IPO tokens and
xStocks listed-stock tokens) and executes it only with the owner's explicit
approval. The control model is the same in every domain:

- The **owner** (a person with a verified session and a verified wallet)
  is the only principal that opens a proposal, acknowledges a plan and
  signs a transaction. Every plan is approved individually
  (`approvalMode: owner_each_plan`); the schema accepts nothing else.
- **Agents** (scoped API credentials) and the **companion** model read,
  research, draft, quote, explain and propose. They never sign, approve,
  spend, change limits, move a follower's pin or read another account.
- **Schedules** act through an internal agent-class principal that can
  only propose; a recurring "investment" is a proposal for the owner's
  review, never automatic investing.
- **Operators** admit instruments, publish rules and terms, moderate
  listings, run maintenance passes and requeue dead deliveries; they cannot
  use owner routes.
- **Workers** (the Temporal worker) reconcile chain evidence and ask the
  API for maintenance passes with a scoped worker credential; they hold no
  owner authority.
- **Unattended execution** is a capability (`automation.unattended`) that
  stays `DISABLED`; no configuration flag enables it.

Two more principles run through everything. Configuration fails closed
(an invalid combination refuses to boot; production writes need approved
caps and a release evidence reference). Screens and answers are honest:
no fabricated data, no fixture in production, an unreachable provider is
shown as unreachable, a reference price is not a quote, a signature is
not settlement, and a model series is not anyone's account.

## 2. Repository map

| Path | What it is | Session |
| ---- | ---------- | ------- |
| `apps/api` | Fastify API: every route, service and boot check; exports the OpenAPI document | B01 onward |
| `apps/worker` | Temporal worker: platform health, execution reconciliation, journal projection, maintenance loop | B01, B10, B12, B16 |
| `apps/indexer` | Registry indexer: reads chain records of published versions into the database | B08 |
| `apps/cli` | `markov` command tree (database, credentials, every domain journey) | B01 onward |
| `apps/web` | markov.pet Next.js app (App Router, server session layer, BFF proxy, Mark I shell) | F01 to F12 |
| `apps/docs` | Docusaurus documentation site generated from the repository at build time | D01 |
| `packages/contracts` | Zod contracts for every domain (the single source of API and CLI types) | all |
| `packages/config` | Environment schema, runtime modes and fail-closed invariants | B01 |
| `packages/observability` | Logging with redaction | B01 |
| `packages/solana-rpc` | JSON-RPC client with pinned genesis verification, timeouts and byte caps | B01, B03, F04, B10 |
| `packages/solana-codec` | SDK-free Solana primitives: keys, PDAs, token layouts, legacy and v0 message codecs, Ed25519, the in-memory fixture chain | B08 to B10 (ADR-0009) |
| `packages/db` | Drizzle schema, 18 migrations, owner-scoped stores, platform identity binding, capability readiness | all |
| `packages/auth` | Identity token verification, test issuer, wallet challenges, credential secrets, principals, scopes, step-up | B02 |
| `packages/amounts` | Exact BigInt decimal arithmetic, raw and scaled conversions with explicit rounding | B04 |
| `packages/catalog` | Issuer feed contract, sanitiser, normaliser, mint verification, Token-2022 policy, corporate actions | B03, B04 |
| `packages/issuer-prestocks`, `packages/issuer-xstocks` | Issuer sources: bundled fixtures (local/test) and configured URLs | B03, B04 |
| `packages/policy` | Eligibility, terms, effective limits, capability states, deterministic policy decisions | B05 |
| `packages/research` | Thesis rules, safe retrieval policy, sanitiser, company mapping, model adapter contract with fixture | B06 |
| `packages/strategy` | Draft validation, admission snapshots, canonical manifest and hash, version diff | B07 |
| `packages/registry` | Registry program SDK: PDAs, borsh encodings, rules mirror, publication helpers, fixture ledger | B08 |
| `programs/strategy-registry` | The Anchor program (Rust) with its program-test suite and shared vectors; `programs/idl-build` | B08 |
| `packages/planning` | Allocation, fee policy, quote checks, route-program matrix, plan assembly and hash, intent state machine | B09, B11 |
| `packages/venue-jupiter` | Venue adapters: synthetic fixture venue and configured-URL gateway for the Markov quote, build and compose contracts | B09 to B11 |
| `packages/execution` | Instruction decoding, effect validation, signature checks, reconciliation decisions, fills | B10, B11 |
| `packages/accounting` | Balanced journal, FIFO lots, reconciliation, signed receipts | B12 |
| `packages/analytics` | Price resolution, valuation, series, returns, rankings | B13 |
| `packages/agent-tools` | Tool catalog and scope matrix, strict inputs, redaction, budgets, companion adapter contract with fixture | B15 |
| `packages/maintenance` | Cadence and occurrence math with time zones, missed-run policy, drift decisions, leg sizing, mandate dry run | B16 |
| `packages/notifications` | Event routing, channel selection, credential-free rendering, email adapters, retry backoff | B16 |
| `packages/model-xai` | xAI (Grok) adapters for research runs and companion steps over chat completions | B17 (first increment) |
| `packages/api-client` | Client generated from the OpenAPI document with runtime validation, used by the app | F03 |
| `packages/ui`, `packages/formatters`, `packages/markov-shell` | Design system, exact formatters, the Mark I shell | F01, F02 |
| `packages/testkit` | Test-only helpers (temporary databases, fixture RPC, env) | all |
| `tooling/` | Commit policy hook and range check, boundary checker, secret scan | B01 |
| `scripts/ci/startup-check.sh` | The headless journey: boots the API with fixtures and drives every domain through the CLI | B01 onward |
| `docs/markov`, `docs/frontend`, `docs/sessions`, `docs/markov/adr` | Contracts, registers, decisions, per-session evidence | all |

Boundaries are mechanical (`tooling/boundaries/rules.json`): domain
packages import only contracts and pure packages; provider SDK families are
allowed only in named integration packages (today none: Solana, Jupiter and
Meteora SDKs are not used anywhere); apps never import other apps; the
frontend imports only `@markov/contracts` and the frontend packages.

## 3. Runtime, modes and configuration

- Toolchain: Node 22, pnpm 10.33 (scripts blocked at install unless
  allowlisted, 24-hour minimum release age), TypeScript strict with exact
  optional properties, Biome, Vitest, Drizzle, Fastify with Zod type
  provider, Temporal SDK 1.24 (worker and CLI only), Next.js 16, Docusaurus
  3.10, Anchor 0.31 for the program.
- Modes (`MARKOV_ENV`): `local`, `test`, `staging`, `mainnet-read-only`,
  `production`. Fixture providers (issuer feeds, venue, model, email) are
  refused outside local and test. Staging and production require explicit
  TLS to the database, an independent secondary RPC, a 32+ character
  credential pepper and a real identity provider. Production writes need
  every `BETA_*` cap and `RELEASE_EVIDENCE_REF`; mainnet execution is
  refused elsewhere.
- Platform identity: the database stores the mode, cluster and genesis
  hash it was bound to (`markov db migrate --bound-by`); the API and worker
  refuse to start against a database bound to another cluster, verify the
  RPC's genesis hash at boot and every 15 s, and fail closed on mismatch.
- Secrets: peppered hashes only; URLs and keys redacted from logs and
  `markov config show`; configuration issues never echo values.
- Health: `/healthz` (liveness) and `/readyz` (database, Temporal,
  identity); graceful shutdown; exact-origin CORS; rate limits per route;
  body limits.
- CI (`.github/workflows/ci.yml`): lint, typecheck (including web and
  docs), tests against PostgreSQL 16 and the Temporal dev server,
  boundaries, OpenAPI and client drift, migration snapshot check, design
  tokens check, web build, docs build and e2e, the Rust program job (fmt,
  clippy, `cargo test` under `solana-program-test`), gitleaks over the whole
  history, dependency advisories and licence inventory, and the commit
  policy over the range.

## 4. Data model (migrations)

| Migration | Adds |
| --------- | ---- |
| `0000_platform_identity` | the platform identity row and capability readiness |
| `0001_identity` | users, identities, sessions, wallet links, challenges, API credentials (agent, operator, later worker), devices and pairings, audit events |
| `0002_catalog` | issuers, instruments, feed snapshots, admission decisions, mint verifications |
| `0003_listed_stocks` | Token-2022 extension records, corporate actions, multiplier history |
| `0004_policy` | jurisdiction rules, terms and acknowledgements, eligibility decisions, owner limits, spend reservations, policy decisions |
| `0005_research` | theses, revisions, source records, research runs, subjects |
| `0006_watchlists` | watchlists and items |
| `0007_strategies` | strategies, drafts with revisions, immutable versions, instances with pins |
| `0008_registry` | registrations, chain records, indexer cursor |
| `0009_follows` | follows |
| `0010_planning` | intents, plans, plan legs, acknowledgements |
| `0011_execution` | attempts, transactions, fills, outbox events |
| `0012_continuations` | staged batches and continuation intents |
| `0013_accounting` | journal entries and lines, lots and consumptions, reconciliation checkpoints, receipts, signing keys |
| `0014_analytics` | price observations |
| `0015_discovery` | moderation decisions |
| `0016_agents` | companion runs, agent proposals, Mark I events |
| `0017_maintenance` | schedules, occurrences, notifications, deliveries, preferences, projection cursor, proposal dedup columns |

Every table is owner-scoped where it holds a person's data; append-only
tables (journal, events, audit, decisions) are never rewritten.

## 5. Backend domains

Each entry: what is built, the logic that matters, how it is verified,
what is not built.

### B01 Foundation
Built: configuration and modes, logging, contracts, RPC client, database
with migrations and identity binding, API skeleton with health and
platform info, Temporal worker with the health workflow, CLI, tooling and
CI. Verified: `IMPLEMENTED` against PostgreSQL 16 and the Temporal dev
server. Not built: OpenTelemetry exporter (OD-03), Docker images.

### B02 Identity and principals
Built: identity tokens (an in-process test issuer for local and test; an
OIDC verifier against a JWKS with an asymmetric algorithm allowlist),
opaque sessions (`mkv_ss_`), step-up (security changes need a recent
sign-in), wallet ownership by a single-use challenge signed by the wallet
and bound to owner, address, chain and time, agent credentials
(`mkv_ag_`, scopes `research:read`, `research:write`, `portfolio:read`,
`proposals:create`), operator credentials (`mkv_op_`, `ops:*` scopes),
device pairing codes and device credentials (`mkv_dv_`, capabilities
`preferences:sync`, `status:read`, `notifications:receive`), worker
credentials (`mkv_wk_`, `maintenance:run`, B16), the audit log and
owner-scoped stores. Verified: `IMPLEMENTED`; the hosted identity provider
is unconfigured (OD-05). Not built: account deletion flows beyond cascade,
multi-factor beyond the provider's own.

### B03 Catalog (PreStocks)
Built: the Markov issuer feed contract, a sanitiser that strips markup and
bounds text, normalisation into instruments, quarantine on ingestion,
operator admission decisions with reason and evidence, SPL and Token-2022
mint verification against the chain (owner program, decimals, supply,
authorities), counterfeit and symbol-collision rules, public search with
typed reference prices (`issuer_mark` and others, with staleness) and
availability, snapshots and decision history. Verified:
`FIXTURE_VERIFIED` with a synthetic feed and the fixture RPC's mint
accounts; the live PreStocks feed is `BLOCKED` (OD-17: endpoint, schema and
terms unverified).

### B04 Listed stocks (xStocks)
Built: Token-2022 extension policy (which extensions are compatible,
which refuse admission), scaled-amount multiplier evidence and history,
exact raw and scaled quantities through `@markov/amounts`, the
corporate-action feed contract and lifecycle (splits, halts, migrations,
sunsets) with operator application and evidence, availability derived from
lifecycle state. Verified: `FIXTURE_VERIFIED`; live xStocks endpoints
`BLOCKED` (OD-18).

### B05 Eligibility and policy
Built: operator-published jurisdiction rules and terms, acknowledgements
by content hash, versioned eligibility decisions per person, tighten-only
owner limits under beta caps (with step-up), capability states, a
deterministic policy decision with machine-readable denial codes, race-safe
spend reservations (per-order, per-day, per-account notional), per-user
instrument availability, operator revocation. Verified: `IMPLEMENTED`
including concurrency tests on reservations; the real rules and terms are
`BLOCKED` on counsel (OD-06, OD-07, OD-08).

### B06 Research
Built: theses with immutable revisions and typed statements (sourced
fact, issuer assertion, opinion, labelled model interpretation) under
citation rules; source records fetched by a safe retriever (URL and
address policy refusing private ranges and special-use names, DNS pinning
of the socket, redirect revalidation, byte caps, sanitised excerpts);
deterministic company-to-instrument mapping (an unknown company never
becomes an instrument id); bounded model runs with provenance (provider,
model, prompt hash, budget); public projection that never includes private
notes. Verified: `IMPLEMENTED`; the model is the fixture or, since B17,
the xAI adapter, neither called live yet (`research.model.generate`
`BLOCKED`, OD-19); the https transport is tested through an in-memory
stand-in, no live page retrieved.

### B07 Strategies
Built: drafts with revisions and optimistic concurrency; validation with
exact basis points (weights and cash sum to 10 000), duplicates,
admission, a leg cap (`STRATEGY_MAX_LEGS`, default 10) and concentration
advisories; freeze into immutable versions carrying admission snapshots
and disclosures; a canonical manifest with a domain-separated SHA-256
digest and test vectors; version diffs; forks with provenance; portfolio
instances that pin a version explicitly. A creator's later version never
moves a follower's pin; acceptance is an explicit action. Verified:
`IMPLEMENTED`.

### B08 Registry (on-chain publication)
Built: `programs/strategy-registry`, an Anchor program whose records are
program-derived accounts keyed by the manifest hash, with immutable
content, publisher-only status authority (deprecate and reactivate),
lineage and every rule tested under `solana-program-test` with vectors
shared with TypeScript; `@markov/registry` (PDAs, instruction and account
encodings, rules mirror, fixture ledger); the publication flow (prepare
with a what-becomes-public preview, byte-exact signed submission from the
owner's verified wallet, chain-derived states, deprecation); the indexer;
public verification on every read. Verified: `FIXTURE_VERIFIED` against the
fixture ledger; no SBF artifact was built, nothing was deployed, the
placeholder program id must be replaced at deployment (OD-09, OD-10). A
devnet deployer wallet and program keypair exist outside the repository;
the deployment is blocked on network access from the build environment.

### B09 Planning
Built: intents (single buy, single sell, basket investment) with
idempotency keys and the single approval mode; allocation by
largest-remainder rounding in base units with conservation, explicit cash
and dust; a separate bounded SOL fee budget; quotes from the venue adapter
checked against the request, owner limits and a reviewed route-program
matrix; per-leg policy decisions; immutable hashed plans with executable
bounds and validity windows; funds preflight; owner acknowledgement bound
to the plan hash; atomic-or-staged grouping from composition evidence.
Verified: `FIXTURE_VERIFIED` with the synthetic venue; the live Jupiter
interface is `BLOCKED` (OD-21) and the matrix lists no live program.

### B10 Execution (single stock)
Built: build from the acknowledged plan's quote; decode every instruction
of the built transaction (legacy and v0, lookup tables resolved) and
validate its effects against the plan (signer, accounts, mints, bounds,
fees, reviewed programs only); simulate; the owner wallet signs; the
signed bytes are persisted with the policy reservation before the one
broadcast; reconciliation from chain evidence to finality with fills read
from transaction meta; the same bytes are resent while the blockhash
lives; expiry and cancellation only on evidence; a durable Temporal
reconciliation workflow; retry never places a second purchase. Verified:
`FIXTURE_VERIFIED` against the fixture chain and fixture route program,
including a malicious output, a changed signature and a timeout after
broadcast.

### B11 Basket execution
Built: whole-basket composition measured and simulated at plan time
(atomic only with that evidence, otherwise staged with the reason), one
composed transaction validated leg by leg with a fill per leg, staged runs
built one transaction at a time with later legs quoted again against the
approved bounds, partial completion on failure, expiry, stale terms or
cancel after a fill, reviewed continuation intents for exactly the
unfilled legs at their original targets, batch states in the status.
Verified: `FIXTURE_VERIFIED`.

### B12 Accounting and receipts
Built: an append-only quantity journal balanced per asset in raw units;
settled fills, fees and rent projected exactly once (unique source
references); FIFO lots attributed to the matching instance or kept at
wallet level; chain reconciliation with checkpoints that records every
unexplained difference as an external flow the owner explains; holdings
without valuation; canonical Ed25519-signed decision and execution
receipts (`markov-receipt/v1`) with published versioned keys, offline
verification by CLI and SDK, opt-in redacted public reading. Verified:
`FIXTURE_VERIFIED`; the signing key is a configured local key refused in
production; the KMS signer is open (OD-22).

### B13 Performance analytics
Built: recorded price observations (issuer feeds on ingestion, operator
entries with evidence, never quotes) resolved by kind precedence and a
24-hour freshness rule; valuation with historical multipliers; model
series per version and actual series per wallet and instance on a daily
grid with a point at every flow; chained time-weighted and Modified Dietz
returns, drawdown, turnover, realised and unrealised P&L, fees;
completeness with reasons; model-only rankings with the 30-day rule;
methodology route; exports. Verified: `FIXTURE_VERIFIED` against vectors
derived independently in Python and the fixture chain; no live price
source (OD-23), so a production series is incomplete rather than
invented.

### B14 Discovery and moderation
Built: a public explorer over active strategies with registered,
unwithheld versions (title, thesis excerpt, lineage, publishing wallet,
constituents, follower count, the ranking entry with every ineligibility
reason and no return when unranked), text, issuer, instrument and creator
filters with stable cursor pages, creator pages from chain records,
follows, follower instances offered a new version only at registration and
moved only by explicit acceptance, operator moderation with recorded
reasons that never touches the chain record or a pin. Verified:
`IMPLEMENTED` against the fixture ledger and PostgreSQL.

### B15 Agent tools and companion
Built: twelve typed tools over the domain services with the caller's own
authority (`instruments.search`, `instruments.facts`, `exposures.compare`,
`thesis.draft`, `weights.validate`, `plan.indicative`, `quote.request`,
`policy.explain`, `basket.propose`, `investment.propose`,
`rebalance.propose`, `receipts.read`), strict inputs with JSON Schemas
generated from the validators, a scope matrix, a bounded companion loop
(tool-call, character and cost budgets, step timeout, run deadline, daily
cost cap, cancellation) with redacted provenance (digests and identifiers,
never text), proposals that only the owner's session opens, and the Mark I
event log resumable by sequence. Verified: `IMPLEMENTED`; a malicious
retrieved document and a model asking for escalation are refused at the
tool layer with the owner's limits unchanged; the model is fixture or xAI
(`companion.model.run` `BLOCKED` until a live run is recorded).

### B16 Maintenance and notifications
Built: recurring investment and drift-rebalance schedules with
time-zone-aware cadences (wall clock kept across daylight saving), review
windows, missed-run policies (`skip` by default, `catch_up_latest`
proposes one), occurrences unique per sequence with a proposal dedup key
(a pass repeated after a crash answers the existing proposal), one
schedule claimed per transaction, a schedule principal that can only
propose, expiry of unopened proposals, pause, cancel and revocation when a
target disappears, rebalance proposals with sized legs that open into one
reviewed intent per leg, the durable worker loop driving passes with a
worker credential, the in-app notification outbox projected from the event
log, per-category preferences, email to a verified address with retries,
dead letters and operator requeue, the fixture outbox for local and test,
and the mandate dry run (17 deterministic checks) with
`automation.unattended` `DISABLED`. Verified: `maintenance.scheduler`
`IMPLEMENTED` (API, worker and startup check); `notifications.email`
`BLOCKED` (no provider, OD-25); the mandate mechanism is open (OD-26).

### B17 first increment: xAI model provider
Built: `@markov/model-xai` over the OpenAI-compatible chat completions API
without a provider SDK: bearer authentication, https outside local and
test, timeout, byte cap, classified failures with the key redacted, usage
priced in micros per token; the research adapter sends the canonical
prompt verbatim and keeps only the run's own sources and candidates; the
companion adapter takes one JSON step per call and treats prose as an
answer, never a call. Configuration: `RESEARCH_MODEL_PROVIDER=xai`,
`COMPANION_MODEL_PROVIDER=xai`, `XAI_API_KEY`, `XAI_MODEL` (default
`grok-4`), `XAI_BASE_URL`, `XAI_TIMEOUT_MS`, per-token prices. Verified
against an in-process stand-in only; api.x.ai was unreachable from the
build environment (SR-XAI-01).

## 6. Frontend (markov.pet) and the documentation site

Built (F01 to F12, D01): the design system and exact formatters; the Mark
I shell (frame, screen, pixel eyes, top bar, navigation, modes, focus
preference); one authentication and session experience (host-only HttpOnly
cookie, same-origin mutation guard, validated return paths, principal-scoped
caches, expiry recovery, account switch isolation); wallet linking through
the Wallet Standard with the backend challenge; eligibility and funding
readiness; issuer-aware discovery, market detail and watchlists; the
research workspace and thesis editor with safe source cards and bounded
runs; the complete basket builder (Research, Assemble, Set Rules,
Activate) with exact basis points and save states; publishing with wallet
signing, versions, forks, public pages; the unified review screens with
plan hash binding and acknowledgement; signing and the execution timeline
with recovery; the portfolio with reconciled holdings, performance and
receipts; the strategy explorer, rankings and creator pages with
follower flows; and the docs site (API reference generated from OpenAPI,
CLI reference generated from the command tree, contracts, sessions,
guides). Every screen is fixture-verified in jsdom and driven in Playwright
against the local API; fixtures are refused in production, staging and
read-only mainnet; the BFF proxy allows only the routes the app uses;
provider secrets never reach the app.

Deployed: `https://markov-web-theta.vercel.app` (staging mode, honest
"Backend unreachable" until the API is hosted) and
`https://markov-docs.vercel.app/docs/`, both built from this branch.

Not built (F13 to F20): recurring and rebalance approval queues over B16;
the companion panel and typed proposals over B15; optional voice; account
settings and device continuity; the Tessera journey; Meteora insights and
DBC simulation views; operational status and administration; workspace
restoration and the release candidate.

## 7. API surface

157 paths and 183 operations in `docs/markov/openapi.json`, grouped per
session in `docs/markov/api.md`. Conventions: bearer tokens with the
principal's class and scopes checked per route; one error envelope
(`{error: {code, message, requestId}}`) with codes such as
`VALIDATION_FAILED`, `FORBIDDEN`, `NOT_FOUND`, `POLICY_DENIED`,
`PROVIDER_UNAVAILABLE`, `BUDGET_EXHAUSTED`; idempotency keys on creates that
spend; cursor pagination on public lists; rate limits per route; every
schema generated from the Zod contracts, with drift checks on the OpenAPI
document and the generated client.

| Principal | Credential | May |
| --------- | ---------- | --- |
| user | session | everything on its own resources; the only one that opens proposals, acknowledges plans and signs |
| agent | `mkv_ag_` with scopes | read, research, draft, quote, explain, propose through ordinary routes or the tool catalog |
| operator | `mkv_op_` with `ops:*` scopes | admission, rules, terms, moderation, maintenance passes, delivery requeue, audit reads |
| device | `mkv_dv_` with capabilities | preferences, status, notifications; no account reads, no spending |
| worker | `mkv_wk_` with `maintenance:run` | ask for maintenance passes |
| schedule (internal) | none | propose on the owner's cadence |

## 8. Verification and evidence

- Unit and integration tests: 93 files, 692 tests at the last full
  `pnpm verify` (lint, typecheck, tests, boundaries, drift checks, migration
  snapshots, tokens, web build, docs build).
- The headless journey `scripts/ci/startup-check.sh` boots the API with
  fixtures and drives, through the CLI and curl: accounts and wallets,
  catalog admission and public search, listed-stock events, eligibility
  and limits, research with a refused address and a public projection,
  strategies with pins and explicit acceptance, registry publication
  against the fixture ledger, planning, execution (buy, sign, submit,
  finality, sell, changed signature, retry, lost answer, no second
  purchase), baskets, accounting and receipts, analytics, discovery and
  moderation, agents and the companion with a poisoned run refused, and
  maintenance (schedule due now, one proposal, dedup on rerun, pause,
  notifications, verified email through the fixture outbox, mandate dry
  run). It ends by proving the API refuses the wrong cluster and an RPC on
  another chain.
- The program's Rust tests run under `solana-program-test` with vectors
  shared with TypeScript.
- Capability states today: `IMPLEMENTED` for platform health, migrations,
  the Temporal worker, identity verification and the scheduler;
  `FIXTURE_VERIFIED` for RPC reads and submits, quotes, builds, spot
  execution, the journal, receipts, analytics and registry publication;
  `BLOCKED` for PreStocks and xStocks ingestion, eligibility rules, the
  research and companion models and email; `DISABLED` for Tessera,
  Meteora and unattended automation.

## 9. Decisions

Architecture decision records (`docs/markov/adr`):

| ADR | Decision |
| --- | -------- |
| 0001 | Scope of this repository: backend, program, SDK and CLI; the storefront, DNS and payments stay out |
| 0002 | Runtime and toolchain pins (Node 22, pnpm, TypeScript strict, Biome, Vitest) |
| 0003 | Service topology, persistence and platform identity binding (API, worker, indexer over PostgreSQL and Temporal; the database is bound to one cluster) |
| 0004 | Chain access without a provider SDK in B01 (plain JSON-RPC with pinned genesis verification) |
| 0005 | Commit and documentation policy (scoped conventional commits, no co-author or tool trailers, session logs) |
| 0006 | The markov.pet web application lives in this monorepo with a mechanically enforced boundary |
| 0007 | Wallet access through the Wallet Standard, owned by the web app |
| 0008 | Strategy registry as a hash-keyed Anchor program with publisher-only authority |
| 0009 | Transaction building, decoding and validation without a Solana SDK (`@markov/solana-codec`) |

Design choices that recur in the code:

- Owner approval of every plan, bound to a plan hash; proposals never
  execute; unattended automation is a disabled capability.
- Fail-closed configuration; fixtures only in local and test; production
  writes gated by caps and evidence; the database bound to one cluster.
- Exact arithmetic everywhere money is counted (BigInt raw units, basis
  points, largest-remainder rounding with conservation).
- Immutable versions and hash-keyed chain records; explicit pins that only
  the follower moves.
- Every instruction decoded and validated before the owner signs; one
  broadcast per attempt; state changes only from chain evidence.
- Append-only journal and receipts; reconciliation turns differences into
  explicit flows rather than silent adjustments.
- Model output is data to validate: strict tool inputs, scopes checked
  per call, provenance as digests, prose never becomes an action.
- Idempotency and deduplication on everything a retry could double
  (intents, proposals, occurrences, journal entries, notifications).
- No provider SDKs in domain code; integration packages own them;
  retrieved pages and provider answers are untrusted data.

Open decisions (`docs/markov/open-decisions.md`): OD-01 Solana SDK family;
OD-02 TypeScript upgrade; OD-03 tracing backend; OD-04 RPC providers; OD-05
production identity provider; OD-06 jurisdictions and classification; OD-07
first admitted instruments and issuer terms; OD-08 research and price data
rights; OD-09 independent reviewers; OD-10 registry upgrade authority;
OD-11 hosting provider (Railway chosen for the backend, Vercel for the
frontends); OD-12 mainnet beta caps and allowlist; OD-13 Mark I hardware
pairing; OD-14 future perps venue; OD-15 Tessera access; OD-16 Docker
verification; OD-17 PreStocks feed; OD-18 xStocks feeds; OD-19 model
provider (decided: xAI; live verification open); OD-20 publication and
moderation (decided in B08 and B14); OD-21 Jupiter interface; OD-22 receipt
key management; OD-23 reference price sources; OD-24 docs hosting (decided:
Vercel); OD-25 email provider; OD-26 mandate mechanism.

## 10. What is not built or not verified

- Backend sessions B17 (Meteora read-only pool observation and DBC
  simulation, the Tessera dependency record, the readiness matrix) and B18
  (operator pause and recovery, beta caps, monitoring and alerts, backups
  and restore drill, deployment artifacts, release evidence).
- Frontend sessions F13 to F20.
- Any live provider: PreStocks and xStocks feeds, Jupiter quotes and
  builds, a price source, the identity provider, email, KMS signing, a
  live model call.
- The registry program on any cluster (devnet deployment prepared, blocked
  on network access); anything on mainnet; any spend of real funds.
- Backend hosting (Railway chosen, not yet configured); Docker images;
  monitoring, alerting and backups.
- Perps, Tessera, Meteora, voice, device firmware and gateway, hardware
  purchase entitlement.
- Unattended execution of any kind and any mandate storage or enforcement.
