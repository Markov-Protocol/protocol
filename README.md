# Markov protocol backend

Markov stocks V1: versioned, executable portfolios of admitted tokenized
stock exposures on Solana, with explicit owner permissions and inspectable
results. This repository holds the backend (domain API, durable workers, CLI,
data pipelines, on-chain registry) and, since ADR-0006, the markov.pet web
application, with a mechanically enforced boundary between them.

Status: backend sessions **B01** (runnable foundation) and **B02** (verified
accounts) and frontend sessions **F01** (shared design system) and **F02**
(Mark I shell) are complete. Backend sessions B02 to B18 and
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
pnpm markov worker ping                         # runs the platform health workflow end to end
pnpm markov solana probe                        # read-only genesis/health/version check of the RPC endpoints
```

The API exposes `GET /healthz`, `GET /readyz`, `GET /v1/platform` and
`GET /openapi.json` (`docs/markov/api.md`). A process whose configuration
disagrees with the database's bound identity, or whose RPC endpoint reports a
different genesis hash, exits with code 78 instead of serving.

## Verification commands

```sh
pnpm verify          # lint, build + typecheck, tests, boundaries, OpenAPI drift, migration drift
pnpm test            # unit tests; integration tests run when MARKOV_TEST_DATABASE_URL / MARKOV_TEST_TEMPORAL_ADDRESS are set
pnpm secrets:scan    # gitleaks over staged changes (scripts/dev/install-gitleaks.sh)
bash scripts/ci/startup-check.sh   # headless: migrate, boot, health, graceful stop, wrong-config refusal
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
| Catalog, eligibility, research, strategies, registry, execution, accounting, discovery, agents, maintenance | not started (B03 onward) |
| Web design system, exact formatters, internal component reference, production guards | implemented, tested (F01) |
| Mark I shell, companion home, navigation with honest placeholder routes | implemented, tested (F02) |
| Product routes (discovery, research, builder, review, portfolio, rankings, automations, settings) | not started (F03 onward, each needing its backend session) |

Capability verification states are recorded in the database and in
`docs/markov/provider-capabilities.md`.

## Layout

```
apps/api  apps/worker  apps/cli  apps/web
packages/contracts  packages/config  packages/observability  packages/solana-rpc  packages/db  packages/testkit
packages/ui  packages/formatters
tooling/  scripts/  docs/markov/  docs/frontend/  docs/sessions/
```

Web app commands: `pnpm web:dev`, `pnpm web:build`, `pnpm web:e2e` (see `docs/frontend/README.md`).

Repository policy for contributors and agents: `AGENTS.md`.

## License

Apache-2.0 (see `LICENSE`).
