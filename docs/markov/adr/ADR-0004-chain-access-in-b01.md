# ADR-0004: Chain access without a provider SDK in B01

Date: 2026-09-24 · Status: accepted (interim) · Session: B01

## Context

B01 needs only a handful of Solana reads (`getGenesisHash`, `getHealth`,
`getVersion`, `getSlot`). The specification requires one internal
representation of addresses, messages, amounts and commitments and isolation
of SDK conversions behind fixture tests. Two SDK families exist
(`@solana/kit` 8.x and `@solana/web3.js` 1.x); their selection should follow
compatibility tests against the instruction-validation and transaction
composition needs of B09 to B11, which do not exist yet.

## Decision

- `@markov/solana-rpc` implements the B01 reads as a bounded JSON-RPC client
  (timeout, response-size cap, envelope and result validation, error
  classification) with no SDK dependency.
- `@solana/*` packages have no owning package in `tooling/boundaries/rules.json`;
  importing them fails CI until the SDK decision is recorded in a follow-up
  ADR with compatibility evidence.
- Live cluster access was blocked by the build environment's egress policy;
  the client is `FIXTURE_VERIFIED` only. `markov solana probe` exists to
  produce `LIVE_READ_VERIFIED` evidence from an environment with access.

## Consequences

- No duplicated address or amount types exist yet; when an SDK is chosen,
  conversions are isolated in the integration package with fixture tests.
