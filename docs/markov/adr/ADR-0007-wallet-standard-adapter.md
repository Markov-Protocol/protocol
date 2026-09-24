# ADR-0007: Wallet access through the Wallet Standard, owned by the web app

Date: 2026-09-24 · Status: accepted · Session: F04

## Context

F04 needs the browser to discover installed Solana wallets, connect to the
one the person chooses, and sign the B02 ownership challenge. The frontend
prompt requires user-controlled selection (never `wallets[0]`), capability
discovery before any signature request, a sign-only path with backend
submission, and no embedded wallet unless a hosted provider is integrated
(OD-05). The boundary rules deny every `@solana/*` package to every
workspace package until an owner is named with an ADR.

## Decision

- The web app (`@markov/web`) is the only owner of `@wallet-standard/app`,
  `@wallet-standard/base`, `@solana/wallet-standard-features`,
  `@solana/wallet-standard-chains` and `qr` (a zero-dependency QR encoder
  whose matrix the app draws itself). No wallet-adapter framework, no
  `@solana/web3.js`/`@solana/kit` in the browser: transaction bytes come
  from the backend (B10) and the app only compares and signs.
- Wallets are discovered through the standard's registration events;
  capabilities are read from the declared features (`solana:signMessage`,
  `solana:signTransaction` with its versions, `solana:signAndSendTransaction`
  marked unsupported by Markov) and chains are compared with the platform
  cluster before a signature is requested.
- The boundary checker treats the most specific `externalOwners` entry as
  decisive so these packages are allowed for `@markov/web` while the
  `@solana/` scope stays denied everywhere else.
- Ownership proof stays the B02 challenge: the app shows the exact text,
  requires a byte-identical `signedMessage` and a 64-byte signature, and
  discards signatures obtained under another session epoch or after the
  wallet's accounts changed.

## Consequences

- Real wallets are exercised only through the standard; a wallet that does
  not implement it is not supported, and the page says so.
- The e2e suite injects a fixture wallet that speaks the standard and signs
  with WebCrypto Ed25519; real extensions remain unverified until a browser
  with them is available (recorded in `docs/frontend/verification.md`).
- Adding any other `@solana/*` package needs a new owner entry and an ADR.
