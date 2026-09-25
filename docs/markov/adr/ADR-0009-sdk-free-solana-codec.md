# ADR-0009: Transaction building, decoding and validation without a Solana SDK

Date: 2026-09-25 · Status: accepted · Session: B10 · Resolves OD-01

## Context

ADR-0004 kept B01 free of a Solana SDK and deferred the choice between
`@solana/kit` and `@solana/web3.js` to the session that needs transaction
composition and instruction validation. B08 wrote a legacy message codec
with Ed25519 verification for registry publication inside `@markov/registry`.
B10 needs the same codec for versioned (v0) messages, address lookup tables,
associated token accounts, compute budget and token instructions, exhaustive
instruction decoding, transaction-effect validation against a reviewed plan,
signing (tests and the nonproduction CLI only) and an in-memory chain to
execute real bytes under test. Both SDK families were unreachable from the
build environment for verification against current documentation, and an
SDK's decoders would still need to be wrapped by our own fail-closed
validator.

## Decision

- The wire formats are implemented in a dedicated pure package,
  `@markov/solana-codec` (extracted from `@markov/registry`): base58 and
  base64, Ed25519 verification through Node's crypto, program-derived and
  associated-token addresses, SPL token account and mint layouts, legacy and
  v0 messages with address lookup tables, message hashing, signing, and the
  `FixtureChain` that executes system, compute-budget, associated-token and
  token instructions plus registered program executors with agave-shaped
  JSON-RPC answers.
- `@markov/execution` (pure) decodes every instruction of a built
  transaction into a named effect, validates the transaction against the
  plan, verifies signed submissions against the stored message, decides
  reconciliation from chain evidence and reads fills from transaction
  metadata. `@markov/venue-jupiter` owns the fixture route program's
  semantics; `@markov/registry` keeps the registry program's.
- The `@solana/` scope stays without an owner in `tooling/boundaries/rules.json`,
  apart from the two Wallet Standard feature and chain packages that ADR-0007
  gives to `@markov/web`. If a live route later needs an SDK decoder (for
  example for a venue's program), it enters one integration package behind
  fixture tests and the validator keeps deciding from our own decoded
  effects.

## Consequences

- One internal representation of addresses, messages and amounts across the
  registry and execution; conversions to an SDK do not exist, so nothing
  needs isolating.
- The codec is fixture-verified against real byte layouts (test vectors
  shared with the Anchor program for the registry; agave-shaped RPC answers
  for the chain). It has not been exercised against a live cluster; the
  first live submission on devnet is the evidence the capability rows ask
  for.
- Instruction coverage is explicit: instructions outside the decoder's
  vocabulary are `unknown` and refused, which is the intended behaviour for
  a fail-closed validator and the reason live routes need a review step.
