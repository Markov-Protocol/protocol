---
title: "Run Markov locally"
sidebar_label: "Run locally"
sidebar_position: 1
description: "PostgreSQL 16, the Temporal dev server, the API, the worker, the CLI and the app from a clean checkout, with the fixture chain and fixture issuer feeds."
---

Everything runs on one machine against an in-memory fixture chain and
sanitised fixture feeds. No live cluster, venue or provider is contacted,
and every mode fails closed on a contradictory configuration.

## Prerequisites

| Tool | Version | Notes |
| ---- | ------- | ----- |
| Node.js | 22.12 or later (below 27) | `engines` in `package.json` |
| pnpm | 10.33.0 | `packageManager` is pinned; `corepack enable` selects it |
| PostgreSQL | 16 | `scripts/dev/postgres-local.sh` prepares a server without Docker; `docker-compose.yml` is the Docker route |
| Temporal CLI dev server | 1.9.1 (pinned, checksum verified) | `bash scripts/dev/install-temporal-cli.sh` |
| Chromium | pre-installed for Playwright | only for browser evidence |

## Install and configure

```bash
git clone https://github.com/Markov-Protocol/protocol.git
cd protocol
pnpm install --frozen-lockfile
bash scripts/dev/install-temporal-cli.sh      # once
bash scripts/dev/temporal-dev.sh              # terminal 1 (or: docker compose up)
cp .env.example .env                          # edit DATABASE_URL etc.
pnpm build
```

`.env.example` holds empty placeholders only; `.env` is ignored by git.
The variables that matter first:

| Variable | Local value | Meaning |
| -------- | ----------- | ------- |
| `MARKOV_ENV` | `local` | Runtime mode; every mode constrains the cluster and execution writes ([supported modes](../reference/markov/architecture.md)) |
| `DATABASE_URL` | `postgres://markov:markov@127.0.0.1:5432/markov_dev` | The database the process binds its platform identity to |
| `TEMPORAL_ADDRESS` | `127.0.0.1:7233` | The dev server |
| `SOLANA_CLUSTER` | `devnet` | The expected genesis is pinned per cluster and verified at boot |
| `SOLANA_RPC_PRIMARY_URL` | a fixture RPC (`node scripts/dev/fixture-rpc.mjs <port>`) or a devnet endpoint | Read-only until execution writes are enabled explicitly |

The complete list, with what production refuses, is in
[operations](../reference/markov/operations.md) and the
[configuration invariants](../reference/markov/architecture.md).

## Migrate, bind and start

```bash
pnpm markov db migrate                        # migrates, binds the platform identity, seeds readiness
pnpm dev:api                                  # terminal 2
pnpm dev:worker                               # terminal 3
pnpm markov health
pnpm markov worker ping
```

`markov db migrate` refuses to bind an identity that contradicts the one
already stored (cluster, genesis, environment), which is the check that
stops a production binary from starting against a devnet database.

## The app

```bash
pnpm web:dev                                  # http://127.0.0.1:3100
```

The app talks to the API only through its own server (a same-origin BFF
proxy with an allowlist); provider secrets never reach the browser. Local
and test modes may enable the internal component reference
(`MARKOV_WEB_INTERNAL_ROUTES=true`); production refuses it. See
[the app guide](../guides/app.md).

## Verify

```bash
pnpm verify        # lint, typecheck, tests, boundaries, OpenAPI, client, migrations, tokens, web build
pnpm web:e2e       # browser journeys against the real API (needs MARKOV_TEST_DATABASE_URL)
pnpm docs:build    # this site
```

`pnpm verify` needs `MARKOV_TEST_DATABASE_URL` (an admin connection that
may create throwaway databases) and the Temporal dev server. The full
clean-checkout journey is [the startup check](./startup-check.md).
