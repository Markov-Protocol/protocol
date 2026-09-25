# Markov strategy registry program

A noncustodial Solana program (Anchor 0.31.1) that records the recipe of a
frozen strategy version as an immutable account keyed by its manifest hash.
Contract, encodings, authorities, state machine, vectors and the deployment
and review gates: `docs/markov/strategy-registry.md`. Design decision:
`docs/markov/adr/ADR-0008-strategy-registry-program.md`.

```
cargo fmt --check
cargo clippy --all-targets --locked -- -D warnings
cargo test --locked                      # program-test suite + vectors assertion
MARKOV_WRITE_VECTORS=1 cargo test        # regenerate vectors/registry-vectors.json
cargo run --manifest-path ../idl-build/Cargo.toml   # regenerate idl/markov_strategy_registry.json
```

The tests run the program under `solana-program-test` with the native
processor (an adapter unifies Anchor's entry lifetimes); no SBF toolchain
is needed for them. Building a deployable artifact needs the Solana
platform tools (`cargo build-sbf`) and is part of the release process, not
of this crate's tests. `declare_id!` holds a development placeholder whose
secret was discarded; a deployment replaces it with its own program keypair
held by the upgrade-authority multisig.
