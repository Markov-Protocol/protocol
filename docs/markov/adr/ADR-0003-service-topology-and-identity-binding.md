# ADR-0003: Service topology, persistence and platform identity binding

Date: 2026-09-24 · Status: accepted · Session: B01

## Context

Financial services must never straddle two chains or two environments. The
specification requires validating network genesis and configuration at boot
and failing closed if the environment and configured chain disagree.

## Decision

1. Three processes from one codebase: `apps/api` (Fastify), `apps/worker`
   (Temporal), `apps/cli`. An indexer process is added with the registry.
2. PostgreSQL is the source of truth. Drizzle provides typed mapping and
   generates SQL migrations that are reviewed and committed; runtime
   migration is done by `markov db migrate`, never by `drizzle-kit push`.
3. Every database carries a single `platform_identity` row
   (`markov_env`, `solana_cluster`, `genesis_hash`, `bound_by`, `bound_at`),
   written once by `markov db migrate`. A database-level check constraint
   enforces the singleton. Every service process compares its configuration
   with this row at boot and exits with `EX_CONFIG` (78) on any difference.
4. Public cluster genesis hashes are pinned in code
   (`KNOWN_GENESIS_HASHES`). A configured override that contradicts them is a
   configuration error. Localnet binds to the genesis observed at migration
   time and then treats it as pinned.
5. RPC endpoints are asked for `getGenesisHash` at boot and every 15 seconds
   afterwards. A contradiction is fatal at boot and a readiness failure
   afterwards; an unreachable endpoint degrades readiness to `unverified`
   without pretending the check passed.
6. Capability readiness (`capability_readiness`) is stored next to the
   identity so `/v1/platform` and the CLI report the same verification state
   that release documents cite.

## Consequences

- An operator cannot point a production binary at a devnet database or a
  devnet RPC without the process refusing to start.
- Provider swaps that silently change networks surface within one monitor
  interval as a readiness failure.
- The transactional outbox, idempotency keys and financial tables are added
  by the sessions that introduce side effects; this ADR fixes only the
  foundation they build on.
