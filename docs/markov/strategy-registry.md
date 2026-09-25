# Strategy registry: on-chain registration of versions (B08)

The strategy registry is a small noncustodial Solana program
(`programs/strategy-registry`, Anchor) that records the recipe of a frozen
strategy version as an immutable account, plus the backend that prepares,
verifies, submits and indexes registrations (`@markov/registry`,
`apps/api/src/registry`, `apps/indexer`). A registration binds a version's
economic content and its manifest hash to the publisher wallet's signature
and to a slot and time on the ledger, so anyone can verify a published
recipe without trusting Markov's database. This document is the contract:
encodings, hashes, seeds, authorities, the state machine, the interface
description, test vectors and the deployment and review process.

Registration is permanent public metadata. A record can be marked
deprecated by its publisher; it can never be edited or deleted, and Markov
cannot remove it. Nothing here places an order, holds tokens or approves
an issuer's legality.

## Program

| Item | Value |
| ---- | ----- |
| Source | `programs/strategy-registry/src/lib.rs` |
| Framework | Anchor 0.31.1 on `solana-program` 2.3 (see ADR-0008 for why not the 1.x line yet) |
| Toolchain | `rust-toolchain.toml`: Rust 1.94.1 with rustfmt and clippy; `Cargo.lock` committed; dependencies pinned exactly |
| Development program id | `6SAPG2iavaEAv628NpuZuSwgKxGhqU23C769w7FfGpuZ` (a placeholder whose secret was discarded; every deployment replaces it, see below) |
| Instructions | `register_version(args)`, `set_status(status)` |
| Accounts | `VersionRecord` (832 bytes with the discriminator) |
| CPI | one `system_program::create_account` when a record is created; nothing else |
| Custody, swaps, fees, delegates, keys | none |

### Record derivation

A record lives at the program-derived address

```
seeds = ["version", manifest_hash]          (manifest_hash: 32 raw bytes)
```

with the canonical bump found by `find_program_address`. One manifest hash
therefore has exactly one possible record, a recipe version can be
registered once, and anyone who holds a manifest can locate and verify its
record without an index.

### Rules enforced on chain (`check_register_args` and the account constraints)

| Rule | Error (code) |
| ---- | ------------ |
| `schema_version == 1` | `UnsupportedSchema` (6000) |
| `manifest_hash` and `content_digest` are not all zeros | `EmptyHash` (6001) |
| 1 ≤ legs ≤ 10 | `NoLegs` (6002), `TooManyLegs` (6003) |
| every `weight_bps ≥ 1` | `ZeroWeight` (6004) |
| every mint ≠ the default public key | `InvalidMint` (6005) |
| every `token_program` ∈ {SPL Token, Token-2022} | `UnsupportedTokenProgram` (6006) |
| legs strictly ascending by mint bytes (no duplicates) | `LegsNotSorted` (6007) |
| Σ weights + cash == 10,000 exactly (u32 arithmetic, checked) | `WeightTotal` (6008) |
| `relation` ∈ {0 none, 1 revision, 2 fork} | `UnknownRelation` (6009) |
| `relation = none` ⇒ zero parent hash and no parent account; otherwise a registered parent record must be passed whose `manifest_hash` equals `parent_manifest_hash` (≠ the child's) | `InvalidParent` (6010) |
| `status` ∈ {0 active, 1 deprecated} | `UnknownStatus` (6011) |
| `set_status` signer == `record.publisher` | `NotPublisher` (6012) |
| publisher signs | Anchor `AccountNotSigner` (3010) |
| record address == the derived PDA | Anchor `ConstraintSeeds` (2006) |
| system program is the system program | Anchor `InvalidProgramId` (3008) |
| parent account owned by the program with the record discriminator | Anchor 3007 / 3012 / 3002 |
| record not already initialised | system program `AccountAlreadyInUse` (custom 0 from the CPI) |

Weights and cash are `u16`; with at most ten legs the `u32` sum cannot
overflow, and the addition is checked anyway.

### Authorities

- **Publisher**: the wallet that signs `register_version`. It pays the rent
  and is the only key that may call `set_status` on that record. There is
  no authority transfer: a lost publisher key leaves the record exactly as
  it is, forever active or forever deprecated. A later version is a new
  record by whichever wallet the owner chooses; the off-chain lineage is in
  the manifest, the on-chain lineage in `relation`/`parent_manifest_hash`.
- **Operator**: none. No instruction lets Markov or anyone else change,
  hide, close or rewrite a record. Platform discovery moderation
  (`strategy_versions.moderation`, OD-20) only decides what the public API
  lists; the chain record exists regardless.
- **Upgrade authority**: the deployment's BPF upgradeable loader authority
  (OD-10). It is never renounced automatically and never held by the
  development session. Production requires an independently held multisig
  and a written change process before the first deployment.

### Binary encoding

Anchor's default serde (Borsh, little-endian, fixed arrays verbatim,
vectors with a `u32` length prefix) with the standard discriminators
(`sha256("global:<instruction>")[0..8]`, `sha256("account:VersionRecord")[0..8]`).

`register_version` instruction data, 8-byte discriminator then:

| Field | Type | Bytes |
| ----- | ---- | ----- |
| `schema_version` | u16 | 2 |
| `manifest_hash` | [u8; 32] | 32 |
| `content_digest` | [u8; 32] | 32 |
| `relation` | u8 | 1 |
| `parent_manifest_hash` | [u8; 32] | 32 (zeros when none) |
| `cash_weight_bps` | u16 | 2 |
| `legs` | Vec\<Leg\> | 4 + n × 66 |
| `Leg.mint` | Pubkey | 32 |
| `Leg.token_program` | Pubkey | 32 |
| `Leg.weight_bps` | u16 | 2 |

Accounts: `publisher` (signer, writable), `record` (writable PDA),
`parent_record` (read-only, or the program id when absent, Anchor's
encoding of an optional account), `system_program`.

`set_status` instruction data: discriminator, `status: u8`. Accounts:
`publisher` (signer), `record` (writable).

`VersionRecord` account, 8-byte discriminator then:

| Field | Type |
| ----- | ---- |
| `layout_version` | u8 (1) |
| `schema_version` | u16 |
| `status` | u8 (0 active, 1 deprecated) |
| `bump` | u8 |
| `publisher` | Pubkey |
| `manifest_hash` | [u8; 32] |
| `content_digest` | [u8; 32] |
| `relation` | u8 |
| `parent_manifest_hash` | [u8; 32] |
| `cash_weight_bps` | u16 |
| `legs` | Vec\<Leg\> (max 10) |
| `registered_slot` | u64 |
| `registered_unix_time` | i64 |
| `status_updated_slot` | u64 |

The account is allocated at its maximum (832 bytes); bytes after the
fields are zero. Every field is written once at registration except
`status` and `status_updated_slot`, which `set_status` changes; the tests
prove that nothing else moves.

### Hashes

The chain stores the two off-chain hashes of B07 and verifies neither
(it cannot see the canonical JSON); it stores the economic fields
themselves so that a reader can compare them with a manifest:

```
manifestHash  = SHA-256( "markov-strategy-manifest/v1/" + genesisHash + "\n" + canonicalManifest )
contentDigest = SHA-256( "markov-strategy-content/v1/"  + genesisHash + "\n" + canonicalContent )
```

Both domains include the schema version and the network's genesis hash,
so a manifest for one cluster never verifies on another. The Rust tests
reimplement the canonical JSON writer (sorted keys, sorted legs and
references, `JSON.stringify` escaping) and reproduce the B07 vectors:

```
manifestHash  = d324b072007fd7af46659406f5bb90b373ef088bc19774b99a726d9a95dacc1a
contentDigest = 910207cf06da18bcbf497381e9ac8f209e8c0ab895c1ae011bf36390102e0819
```

### Shared test vectors

`programs/strategy-registry/vectors/registry-vectors.json` is written by
the Rust test `vectors_are_current` under the real runtime
(`solana-program-test`) at a fixed clock and asserted current on every run
(`MARKOV_WRITE_VECTORS=1 cargo test` regenerates it). It carries the
program id, discriminators, error table, the B07 manifest vectors, a
registrable manifest with the synthetic fixture mints, its
`register_version` instruction bytes and account metas, the derived record
address and bump, the 832 account bytes after registration and after
deprecation, and five `find_program_address` derivations.
`packages/registry/test/vectors.test.ts` proves the TypeScript SDK
reproduces every encoding byte for byte, and
`packages/strategy/test/registry-vectors.test.ts` proves the canonical
manifest, the manifest hash and the content digest against the same file.

### Interface description

The layout tables above are the authoritative interface description; the
TypeScript SDK is hand-written against them and proven by the vectors, so
a drift in either direction fails a test. The Anchor IDL is generated by
`cargo run --manifest-path programs/idl-build/Cargo.toml` (the same
builder `anchor idl build` uses, without the CLI) into
`programs/strategy-registry/idl/markov_strategy_registry.json`. In this
session's environment the generation did not succeed: Anchor's
`idl-build` feature changes the resolved feature set so that
`solana-packet` 2.2.1's serde derives fail to compile with the locked
`serde_derive` 1.0.229, and an older serde cannot be pinned under the
locked `serde_json`. No IDL is committed until a build environment with
the Anchor CLI or a compatible dependency set produces one; the SDK does
not consume it at runtime.

## SDK (`@markov/registry`)

Pure TypeScript, no provider SDK: base58 keys, ed25519 point
decompression for the on-curve test, `findProgramAddress`, the Borsh
encoders and decoders of the layout above, `checkRegisterArgs` (the
program's rules in the same order with the same codes), a legacy
transaction codec (compile, serialize, parse, sign, verify with Node's
ed25519), the binding of a frozen version to its on-chain arguments,
`derivePublicationOutcome` (the state machine below, decided from chain
observations only), `observeSubmission` (the RPC reads it needs), explorer
links for public clusters, and `FixtureLedger`: an in-memory stand-in that
executes the program's semantics (same rules, same error codes, same
account bytes, rent, blockhash validity, confirmation depth) for tests and
the local fixture RPC. The ledger is FIXTURE_VERIFIED evidence only.

## Publication flow

Publishing is the owner's own typed operation, separate from any
investment intent. Person only (no agent scope covers it); the wallet must
be one of the owner's verified wallets on the deployment's network.

```
unpublished ─prepare→ awaiting_signature ─submit→ submitted ─finalized+verified→ registered
                             │                        │  ├─ landed with error ────→ failed
                             │                        │  ├─ never landed, blockhash past → expired
                             │                        │  └─ node unreachable ────────→ unknown (re-checked)
                             └─ not signed before the blockhash expired ─→ expired
```

1. **Prepare** (`POST /v1/me/strategies/{s}/versions/{v}/publication`,
   `{ walletId }`): the version's stored canonical manifest must hash to
   its recorded `manifestHash`; the legs are bound to the chain arguments
   and checked against the program's rules locally (fail closed); the
   lineage decides `relation` (a registered previous version → `revision`,
   a registered fork source → `fork`, otherwise `none`); a finalized
   blockhash and the rent are read from the node; the unsigned legacy
   transaction is built with the wallet as fee payer. The answer carries
   `preview`: exactly the manifest and the on-chain fields that become
   public, what never does, and the permanence statement. 201 for a new
   publication; 200 with the existing one while a registration is in
   flight or already registered (a second wallet cannot displace it).
2. **Sign**: the app signs `transaction.unsignedTransaction` through the
   Wallet Standard (`solana:signTransaction`); the CLI demo signs in
   process. Nothing touches the chain yet.
3. **Submit** (`POST /v1/me/publications/{id}/submit`,
   `{ signedTransaction }`): the bytes must parse as a legacy transaction
   whose message equals the prepared one byte for byte and whose
   fee-payer signature verifies for the publisher wallet; otherwise
   `SIGNATURE_MISMATCH` and nothing is sent. A blockhash already past its
   validity answers `PUBLICATION_EXPIRED` (state `expired`). The node's
   preflight verdict (-32002/-32003: simulation or signature failure) is
   recorded on the publication as `failed` (or `expired` for "Blockhash
   not found") and answered with 200, because the resource is the truth;
   any other node error (unhealthy, rate limited) leaves the prepared
   transaction valid and answers `PROVIDER_UNAVAILABLE`; a transport
   failure after the send records `unknown` with the signature. An
   accepted submission is `submitted`.
4. **Observe** (`GET …/publication`, `GET /v1/me/publications/{id}`,
   the indexer): `getSignatureStatuses` (history search), `getBlockHeight`,
   and once finalized `getTransaction` and `getAccountInfo` at
   `finalized`. `derivePublicationOutcome` moves the state only on what
   the node said: no status and a past blockhash → `expired`; an error →
   `failed` with the program code named; finalized → the record must
   exist, be owned by the program, decode, carry the version's legs, cash,
   hashes and the publisher, and (for status changes) the requested
   status → `registered` with evidence (signature, slot, block time,
   record address, publisher, status, explorer links). A finalized
   transaction without a readable record is `unknown`, never registered.
   `registered` is terminal for a registration; the version row then reads
   `publication: registered` and `publisherWallet`.
5. **Status changes** (`POST …/versions/{v}/status-changes`,
   `{ walletId, status }`): same flow with `set_status`; only the
   publisher wallet is accepted; the version and its record keep every
   economic byte.

A database row, a built transaction or an accepted submission is never
registration. The public API (`GET /v1/strategies/{s}`,
`GET /v1/strategies/{s}/versions/{v}`) shows only versions whose
registration reached `registered` and whose moderation is `none`, and it
verifies on every read: the manifest hash is recomputed from the stored
canonical bytes and compared with the record the indexer mirrored from
finalized chain state, and the record's legs, cash, digest and publisher
are compared with the version (`verification.manifestHashMatches`,
`verification.contentMatches`, `mismatches`).
`GET /v1/registry/records/{address}` serves any indexed record, whether
or not a Markov version matches it (permissionless registrations are
records too); it links a version only when that version is public.

## Indexer (`apps/indexer`)

A separate process (`markov-indexer`, `--once` for a single pass) with the
same boot checks as every Markov process. Each pass follows every
`submitted`, `unknown` and `awaiting_signature` publication with the state
machine above, then mirrors every account the program owns
(`getProgramAccounts` filtered by size and discriminator, at most 5,000
per pass) into `registry_records`, linking each to the version carrying
its manifest hash, and writes `registry_indexer_state` (last run, last
observed slot, records, last error). Network failures are recorded, never
mistaken for failures of a publication. `REGISTRY_INDEX_INTERVAL_SECONDS`
(5–3600, default 30) paces the loop. `GET /v1/registry` reports the
indexer's state so an operator can see lag.

## Configuration

| Variable | Meaning |
| -------- | ------- |
| `REGISTRY_PROGRAM_ID` | base58 program id. Unset: publication disabled, indexer idle, public registry routes answer 503 |
| `REGISTRY_INDEX_INTERVAL_SECONDS` | 5–3600, default 30 |

Invariants (`packages/config`): publication is enabled only with a program
id in a write-capable mode (`mainnet-read-only` indexes and reads only);
a mainnet-beta program id with publication requires `MARKOV_ENV=production`
and `RELEASE_EVIDENCE_REF`. Configuration fails closed.

## Threats and controls

| Threat | Control |
| ------ | ------- |
| Registering someone else's recipe under your key, or rewriting a record | the record address is the manifest hash; a hash registered once cannot be re-initialised (`duplicate_initialisation_is_refused…`); no instruction changes economic fields; `set_status` needs the publisher's signature (`NotPublisher`) |
| A wallet that is not the owner's, or on another network | the publication wallet must be one of the caller's verified links with this deployment's genesis hash; cross-owner reads are 404 |
| A wallet returning a different transaction than the one prepared (extra instructions, different fee payer, different data) | the submitted message must equal the prepared message byte for byte; the signature must verify for the publisher; otherwise `SIGNATURE_MISMATCH` and nothing is sent |
| Presenting a database save, a built transaction or an accepted submission as registration | states move only on chain observations; `registered` needs a finalized transaction and a decoded, matching record; public views verify on read |
| Malformed or hostile account data from a node | decoders check size, discriminator, layout version, bounded vectors and zero padding; a record that does not decode is `record_mismatch`, never trusted |
| Weight overflow, zero weights, duplicates, unsupported mints, wrong seeds, wrong programs, unauthorized signers | program tests under the real runtime for every rule; TypeScript mirror with the same codes; the fixture ledger reports the same errors |
| Private data in public metadata | the manifest carries no author, wallet-to-account link, budget, holding, note or email; the preview names what never leaves; public projections are built from explicit fields (the API test asserts the owner id and author principal are absent) |
| Explorer links to the wrong chain | links only for public clusters, built from validated results |

## Deployment and review process (release gates, nothing deployed by this session)

1. Replace `declare_id!` with the public key of the deployment's program
   keypair; keep that keypair and the upgrade authority in the independently
   held multisig (OD-10). Set `REGISTRY_PROGRAM_ID` from it.
2. Build with the pinned toolchain and the Solana platform tools (`cargo
   build-sbf`), record the verifiable build hash, and deploy to devnet
   first. `Cargo.lock` and `rust-toolchain.toml` are the pin.
3. Run `cargo test --locked` (program-test suite and vectors),
   `packages/registry` tests and `apps/api/test/registry.test.ts`; run the
   startup check against a local validator with the deployed program and
   compare its records with the fixture ledger's.
4. Independent security review of the program and of the backend's
   verification path (OD-09) with no unresolved critical or high finding.
5. Mainnet: production mode, release evidence reference, beta caps, and
   an explicit, attributable go decision. The development session never
   deploys, never holds a program keypair and never spends.

What this session verified and did not: the program's behaviour is proven
under `solana-program-test` (the real runtime with the native processor)
and the encodings are shared vectors; the publication flow is proven
against the fixture ledger and PostgreSQL. No SBF artifact was built and
no local validator ran, because the platform tools and the Agave releases
are unreachable from this build environment (GitHub releases and
`release.anza.xyz` are denied by the proxy). The capability stays
`FIXTURE_VERIFIED` until a validator run is recorded
(`docs/markov/provider-capabilities.md`).

## CLI

```
markov registry status --url …
markov strategy publish <strategyId> --version-id <versionId> --wallet <walletId> --token <session> --url …
markov registry submit <publicationId> --signed <base64> --token <session> --url …
markov registry publication <publicationId> --token <session> --url …
markov strategy publication <strategyId> --version-id <versionId> --token <session> --url …
markov registry public-version <strategyId> <versionId> --url …
markov registry record <address> --url …
markov strategy publish-demo <strategyId> --version-id <versionId> --token <session> --fixture-control http://127.0.0.1:<port>/fixture/registry --status deprecated --url …   (NONPRODUCTION)
markov-indexer --once
```
