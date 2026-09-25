# ADR-0008: Strategy registry as a hash-keyed Anchor program with publisher-only authority

Date: 2026-09-25 · Status: accepted · Session: B08

## Context

B07 freezes strategy versions off chain with a domain-separated manifest
hash and content digest. The specification asks for a small noncustodial
Solana program that records recipes (mints, token programs, weights, cash,
manifest hash, parent reference, registration evidence) so a published
version can be verified independently of Markov's database, with
deterministic account derivation, bounded inputs, a separately authorized
status marker, conservative authority semantics and identical Rust and
TypeScript test vectors. No token custody, swaps, arbitrary CPI, fees,
delegates or key management belong in it. The build environment of this
session has crates.io and rustup but no Solana platform tools or validator
binaries (GitHub releases and the Anza release host are denied).

## Decision

- **Anchor, pinned to 0.31.1 on `solana-program` 2.3.** The 1.x line (1.2.0
  at the time of writing) routes CPI through `solana-invoke`, which has no
  host implementation; a program built on it cannot create accounts under
  `solana-program-test`'s native processor, the only runtime available
  here. 0.31.1 uses the stubbed `solana_cpi` path, so every program test
  runs under the real runtime (bank, rent, PDA signing, system program).
  The upgrade to the current Anchor line is a follow-up gated on SBF
  tooling and a validator run, not on program logic, which is framework
  neutral (two instructions, one account type).
- **Records are keyed by the manifest hash**: `["version", manifest_hash]`.
  A recipe version has exactly one possible record, can be registered
  once, and is locatable from its manifest without an index. Lineage on
  chain is an optional reference to a registered parent record
  (`relation`, `parent_manifest_hash`), verified to exist at registration.
- **The publisher wallet is the only authority.** It signs, pays and may
  later mark its record deprecated or active. There is no operator
  instruction, no authority transfer and no close: a lost key leaves the
  record as it is. Platform moderation is a database flag that decides
  what the public API lists, never what exists on chain.
- **Economic content is immutable by construction**: no instruction writes
  it after initialisation; `set_status` changes two fields and the tests
  compare the account bytes before and after.
- **Both encodings are canonical and shared.** The program's Borsh layout
  and the off-chain canonical JSON are documented, and the Rust tests write
  vectors under the real runtime at a fixed clock that the TypeScript SDK
  reproduces byte for byte. The SDK is hand-written against the layout
  (no provider SDK, no runtime IDL consumption); the IDL is generated and
  committed for reviewers and integrators.
- **Registration state is derived from chain observations only**
  (`derivePublicationOutcome`): finalized transaction, decoded record,
  matching content and publisher. A database row, a built transaction or
  an accepted submission never counts as registration.
- **Publication is a person's typed operation** with a verified wallet on
  the deployment's network; no agent scope covers it. Mainnet publication
  requires production mode and release evidence; read-only mode indexes
  only. The development program id is a placeholder whose secret was
  discarded; deployment, upgrade authority and independent review are
  release gates (OD-09, OD-10).

## Consequences

- Program behaviour is verified under `solana-program-test`; no SBF
  artifact was built and no local validator ran in this environment. The
  capability is `FIXTURE_VERIFIED` until a validator run is recorded
  (`docs/markov/strategy-registry.md`, "Deployment and review").
- The Anchor pin is deliberately behind the current line; upgrading it is a
  reviewed change with the shared vectors as the regression suite.
- A recipe registered by someone other than its Markov owner is a valid
  chain record (permissionless) but never that version's registration; the
  API distinguishes the two.
- `apps/indexer` is a new process to operate; `GET /v1/registry` exposes
  its lag.
