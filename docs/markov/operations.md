# Operations

Status: B01 slice. Everything below is implemented unless marked *planned*.

## Processes and exit codes

| Process        | Entry                      | Exit codes |
| -------------- | -------------------------- | ---------- |
| API            | `node apps/api/dist/main.js` | 0 clean shutdown; 78 configuration/identity contradiction; 69 database or listener unavailable; 70 unexpected software error |
| Worker         | `node apps/worker/dist/main.js` | same mapping; Temporal connection failures after bounded retries exit 69 |
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
