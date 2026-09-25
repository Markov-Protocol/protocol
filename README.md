# Markov protocol backend

Markov stocks V1: versioned, executable portfolios of admitted tokenized
stock exposures on Solana, with explicit owner permissions and inspectable
results. This repository holds the backend (domain API, durable workers, CLI,
data pipelines, on-chain registry) and, since ADR-0006, the markov.pet web
application, with a mechanically enforced boundary between them.

Status: backend sessions **B01** (runnable foundation), **B02** (verified
accounts), **B03** (admitted PreStocks catalog, fixture-verified) and
**B04** (xStocks quantities and lifecycle events, fixture-verified),
**B05** (eligibility, terms, limits and deterministic policy decisions),
**B06** (sourced research, safe retrieval and bounded model runs),
**B07** (immutable stock basket versions with explicit follower pins),
**B08** (on-chain strategy registry program, verified registration flow
and indexer, fixture-verified),
**B09** (deterministic budget allocation and bounded, hashed execution
plans, fixture-verified),
**F04** (verified wallet and trading readiness flows),
**F05** (issuer-aware discovery and watchlists),
**F06** (instrument evidence and strategy theses),
**F07** (complete stock basket builder),
**F08** (public publishing, versions and forks on the registry routes),
**F09** (one review for basket investments and single buys over the B09
plans),
**B10** (validated single-stock execution and recovery against the fixture
chain),
**B11** (atomic and staged basket execution with partial completion and
reviewed continuation, fixture-verified),
**B12** (reconciled quantity journal, FIFO lots and attribution, chain
reconciliation with acknowledged external flows, signed verifiable
receipts),
**F10** (wallet signing of the exact prepared transaction, submission,
per-transaction execution timeline with recovery, activity, receipts;
design-reference realignment of tokens and navigation),
**B13** (recorded price observations, valuation with historical
multipliers, model and actual performance series with cash-flow-aware
returns, completeness and model-only rankings) and
frontend sessions **F01** (shared design system), **F02** (Mark I shell) and
**F03** (app sessions and account recovery) are complete. Backend sessions B02 to B18 and
frontend sessions F02 to F20 follow in dependency order; see
`docs/sessions/` for evidence, `docs/markov/product-scope.md` for the
release boundaries and `docs/frontend/README.md` for the app. Nothing here
is production-ready, audited or deployed.

## Supported modes

`MARKOV_ENV` selects a mode and every mode fails closed on contradictory
configuration (`docs/markov/architecture.md`):

| Mode              | Chain                       | Execution writes |
| ----------------- | --------------------------- | ---------------- |
| local             | localnet/devnet/testnet, read-only mainnet | not on mainnet |
| test              | localnet/devnet/testnet     | allowed          |
| staging           | devnet/testnet, read-only mainnet | not on mainnet |
| mainnet-read-only | mainnet-beta                | never            |
| production        | mainnet-beta                | only with approved beta caps and release evidence |

## Clean-checkout startup

Prerequisites: Node 22, pnpm 10.33 (`corepack enable` or install), PostgreSQL
16 (Docker or a local server), the Temporal CLI for the worker.

```sh
pnpm install --frozen-lockfile
pnpm hooks:install                              # commit-message policy hook

# dependencies: either
docker compose up -d                            # postgres + temporal (unverified in B01, see OD-16)
# or
bash scripts/dev/postgres-local.sh              # role + databases on a local PostgreSQL
bash scripts/dev/install-temporal-cli.sh        # pinned, checksum-verified
bash scripts/dev/temporal-dev.sh &              # headless dev server on 127.0.0.1:7233

cp .env.example .env                            # defaults target local devnet; set SOLANA_RPC_PRIMARY_URL
pnpm build
pnpm markov config check                        # validates and prints a secret-free summary
pnpm markov db migrate                          # applies reviewed migrations, binds the platform identity
pnpm dev:api                                    # http://127.0.0.1:3000
pnpm dev:worker                                 # in another terminal
pnpm markov health                              # liveness + readiness
pnpm markov auth test-token --subject did:test:alice   # nonproduction identity token
pnpm markov auth session --identity-token <token>      # exchange for a session (printed once)
pnpm markov auth whoami --token <session-token>
pnpm markov catalog list --q FX                         # public catalog search
pnpm markov catalog ingest --issuer prestocks --source fixture --token <operator-token>   # local/test only
pnpm markov worker ping                         # runs the platform health workflow end to end
pnpm markov solana probe                        # read-only genesis/health/version check of the RPC endpoints
```

The API exposes `GET /healthz`, `GET /readyz`, `GET /v1/platform` and
`GET /openapi.json` (`docs/markov/api.md`). A process whose configuration
disagrees with the database's bound identity, or whose RPC endpoint reports a
different genesis hash, exits with code 78 instead of serving.

## Verification commands

```sh
pnpm verify          # lint, build + typecheck, tests, boundaries, OpenAPI drift, migration drift, web and docs builds
pnpm test            # unit tests; integration tests run when MARKOV_TEST_DATABASE_URL / MARKOV_TEST_TEMPORAL_ADDRESS are set
pnpm secrets:scan    # gitleaks over staged changes (scripts/dev/install-gitleaks.sh)
bash scripts/ci/startup-check.sh   # headless: migrate, boot, health, graceful stop, wrong-config refusal
pnpm docs:build && pnpm docs:e2e   # the documentation site (markov.pet/docs): generated references, broken links fail, browser checks
```

## Feature status

| Area                         | Status after B01 |
| ---------------------------- | ---------------- |
| Configuration and runtime modes | implemented, tested |
| Database migrations, platform identity binding | implemented, tested against PostgreSQL 16 |
| API liveness/readiness/platform info, OpenAPI | implemented, tested |
| Temporal worker and health workflow | implemented, tested against a local dev server |
| Solana RPC reads and network identity verification | implemented; fixture-verified only (live access blocked in the build environment) |
| Accounts: identity-token sessions, wallet ownership challenges, scoped agent credentials, operator separation, device pairing, audit | implemented, tested (B02); live provider configuration unverified |
| Catalog: sanitised issuer snapshots, quarantine, counterfeit and collision rules, SPL/Token-2022 mint verification, operator admission, public search with typed reference prices | implemented, tested with synthetic fixtures (B03); live PreStocks feed BLOCKED (OD-17) |
| Listed stocks: Token-2022 extension policy, scaled-amount multiplier evidence, exact raw/scaled quantities, corporate-action lifecycle (splits, halts, migrations, sunsets) | implemented, tested with synthetic fixtures and events (B04); live xStocks endpoints BLOCKED (OD-18) |
| Eligibility: versioned decisions under operator-published rules, terms acknowledgements by content hash, tighten-only owner limits with beta caps, capability states, deterministic policy decisions with machine-readable denials, race-safe spend reservations | implemented, tested (B05); real rules and terms BLOCKED on counsel (OD-06) |
| Research: versioned theses with typed statements and citation rules, SSRF-safe source retrieval with sanitised excerpts, deterministic company mapping, bounded model runs with provenance, labelled public projections | implemented, tested (B06); model adapter fixture-only, no hosted provider (OD-19) |
| Strategies: exact-weight recipes with cash, deterministic validation, immutable versions with admission snapshots, canonical manifest and content digest with test vectors, forks with provenance, explicit follower pins that a creator's edit never moves, optimistic concurrency | implemented, tested (B07) |
| Registry: hash-keyed Anchor program with publisher-only status authority and immutable content, shared Rust/TypeScript vectors, publication flow (what-becomes-public preview, byte-exact signed submission, chain-derived states, deprecation), indexer, public verification on read | implemented, program-test and fixture-ledger verified (B08); no SBF build or validator run in this environment, nothing deployed (OD-09, OD-10) |
| Execution planning: intents with idempotency, largest-remainder base-unit allocation with conservation and explicit cash and dust, separate bounded SOL fee budget, per-constituent venue quotes checked against the request, owner limits and a reviewed program matrix, per-constituent policy decisions, immutable hashed plans with executable bounds and validity, atomic or explicitly staged grouping, owner acknowledgement by hash | implemented, tested (B09) with the fixture venue; live Jupiter interface BLOCKED (OD-21); nothing signs or submits |
| Execution: transactions built from the acknowledged plan's quote, decoded and validated against the plan (signer, accounts, mints, bounds, fees, reviewed programs), simulated, signed by the owner wallet, persisted before the one broadcast, reconciled from chain evidence to finality with fills from transaction meta, the same bytes resent while the blockhash lives, expiry and cancellation on evidence; buys and sells; durable worker reconciliation | implemented, tested (B10) against the fixture chain and fixture route program; no live venue builds (OD-21), nothing sent to a cluster; baskets are B11 |
| Basket execution: whole-basket composition measured and simulated at plan time (atomic only with that evidence, staged with the reason otherwise), one composed transaction validated leg by leg with a fill per leg, staged runs built one transaction at a time with later legs quoted again against the approved bounds, partial completion on failure, expiry, stale terms or cancel after a fill, reviewed completion of exactly the unfilled legs at their original targets, batch states in the execution status | implemented, tested (B11) against the fixture chain and fixture venue; no live venue composes (OD-21) |
| Accounting: append-only quantity journal balanced per asset in raw units, settled fills, fees and rent projected once, FIFO lots attributed to the matching instance or kept at wallet level, chain reconciliation with checkpoints that turns every unexplained difference into an external flow the owner acknowledges, wallet and instance holdings without valuation, canonical Ed25519-signed decision and execution receipts with published keys, offline CLI verification and opt-in redacted public reading | implemented, tested (B12) against the fixture chain; local signing key only, KMS signer open (OD-22); no live wallet reconciled |
| Performance analytics: recorded reference observations (issuer feeds on ingestion, operator entries with evidence), valuation with historical multipliers, actual series per wallet and instance with deposits, withdrawals, purchases and sales as flows, model series per version held from its start without costs, time-weighted and Modified Dietz returns, drawdown, turnover, realized and unrealized P&L, fees, completeness with reasons, model-only rankings with the 30-day rule, methodology route, exports | implemented, tested (B13) against independently derived fixture vectors and the fixture chain; no live price source (OD-23), so production series stay incomplete rather than invented |
| Discovery, agents, maintenance | not started (B14 onward) |
| Web design system, exact formatters, internal component reference, production guards | implemented, tested (F01) |
| Mark I shell, companion home, navigation with honest placeholder routes | implemented, tested (F02) |
| App sessions: server-verified HttpOnly cookie, sign-in, expiry recovery, sign-out, account switch isolation, generated API client | implemented, tested against the local API (F03); hosted identity provider adapter BLOCKED (OD-05) |
| Wallet readiness: Wallet Standard discovery with capability checks, explicit selection, ownership verification through the B02 challenge, network checks, unlink, receive/funding with observed balances, eligibility and terms screens, live home checklist | implemented, tested (F04) with an injected fixture wallet; real wallets, hosted embedded wallet (OD-05) and live cluster reads not verified |
| Discovery: Explore instruments over real admitted instruments with issuer identity, typed prices, availability and source timestamps; exact-id market pages with verification and lifecycle evidence; account-scoped versioned watchlists | implemented, tested (F05) with fixture instruments against the local API; live issuer feeds BLOCKED (OD-17, OD-18) |
| Research in the app: thesis editor with typed statements and citations, safe source cards, bounded runs with progress and cancel, shortlist by canonical id, private notes vs published projection, shortlist to basket draft, instrument evidence rules and honest route observations | implemented, tested (F06) against the local B06/B07 API with the fixture source and fixture model adapter; no hosted model provider (OD-19) |
| Basket builder: four stages on one server draft, exact basis-point allocations with explicit equal weighting and cash remainder, backend validation on every save, revision-checked autosave with offline and two-tab conflict handling, rules and effective limits, wallet and budget kept apart from the recipe with exact split estimates | implemented, tested (F07) against the local B05/B07 API; review and execution arrive with B09/B10 and F09/F10 |
| Publishing in the app: freeze, versions with chain-derived registration states, prepare with a verified wallet (what becomes public, permanence, cost), sign through `solana:signTransaction` with a byte check, submit, states restored on reload, registration evidence with explorer links and verification, deprecation, readable version differences, public strategy and version pages, follows (backend addition in F08), forks of registered versions with attribution | implemented, tested (F08) against the local B07/B08 API with the fixture ledger and the fixture wallet; no deployed program or live cluster (OD-09, OD-10) |
| Review in the app: one screen for a basket investment in a pinned version and a single buy of an instrument; wallet with observed balances, exact budget, policy-derived slippage; the API's plan with allocation, quotes, minimum outputs, fees and fee payer, signatures and transactions, atomic or staged semantics, policy evidence, validity with countdown, plan id and hash; approval bound to the hash with the staged acknowledgement, refresh with a difference view, actionable refusals, context differences | implemented, tested (F09) against the local B09 API with the fixture venue's synthetic quotes and the fixture wallet; no live venue (OD-21) |
| Execution in the app: the API-built transaction shown before the wallet opens, signing preconditions checked in the browser and again by the API, one `solana:signTransaction` request with the returned bytes checked against the prepared message, one submission, wallet decline, silence, mutation, account and session changes and lost answers handled without a second intent or transaction, a per-transaction timeline restored on reload and in other tabs (stages, fills, fees paid, signatures, evidence) on bounded polling with accessible announcements, cancel and cancellation requests, reviewed completion of a partially completed basket, activity list with deep links, receipts issued and read with public opt-in | implemented, tested (F10) against the local B10 to B12 API with the fixture chain, fixture venue and fixture wallet; no live venue or cluster (OD-21); receipts signed with a local key (OD-22) |
| Portfolio in the app: holdings against the chain with multiplier-aware quantities and the API's valuations, reconciliation on request, external flows explained at wallet level, strategy instances with target against actual allocation and drift, FIFO lots with cost and fees, personal against model performance with methodology labels, chart summaries, exact figures and JSON exports, journal history; receipts explain requested against filled | implemented, tested against the local API and the fixture chain (F11) |
| Product routes (rankings, automations) | not started (F12 onward, each needing its backend session) |

Capability verification states are recorded in the database and in
`docs/markov/provider-capabilities.md`.

## Layout

```
apps/api  apps/worker  apps/cli  apps/web  apps/docs
packages/contracts  packages/config  packages/observability  packages/solana-rpc  packages/db  packages/testkit
packages/ui  packages/formatters
tooling/  scripts/  docs/markov/  docs/frontend/  docs/sessions/
```

Web app commands: `pnpm web:dev`, `pnpm web:build`, `pnpm web:e2e` (see `docs/frontend/README.md`).

Documentation site (`apps/docs`, served at markov.pet/docs): `pnpm docs:start`
(local preview on http://127.0.0.1:3200/docs/), `pnpm docs:build`,
`pnpm docs:e2e`. The site is generated at build time from `docs/markov`,
`docs/frontend`, `docs/sessions`, the OpenAPI document and the CLI command
tree; generated pages are not committed (see
`docs/markov/operations.md`, "Documentation site").

Repository policy for contributors and agents: `AGENTS.md`.

## License

Apache-2.0 (see `LICENSE`).
