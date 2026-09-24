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
every row. Audit actions: `strategy.*`, `instance.*`. Publication and
on-chain registration do not exist yet (B08): every version reads
`publication: unpublished`.

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
