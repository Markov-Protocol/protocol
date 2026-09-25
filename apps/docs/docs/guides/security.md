---
title: "Security model"
sidebar_label: "Security"
sidebar_position: 5
description: "Fail-closed configuration, owner-scoped stores, byte-exact signing, no pooled funds, no secrets in the app, and every capability labelled with its verification state."
---

The threat model with its abuse cases, controls and the tests that
exercise them is [threat model](../reference/markov/threat-model.md); the
app's rules are in [security and privacy](../reference/frontend/security-and-privacy.md).
These are the properties everything else rests on.

## Configuration fails closed

`MARKOV_ENV` selects a mode; every mode constrains the cluster and whether
execution writes are allowed, and contradictory settings refuse to start
(exit 78). Production requires approved beta caps, an allowlist and an
evidence reference before any write; a local receipt signing key, the test
identity issuer and fixture adapters are refused outside local and test.
Nothing bypasses a boot check; the fix is always to supply the evidence
the check asks for.

## Identity and authority

- Identity tokens are verified against the provider's keys with an
  asymmetric algorithm allowlist; sessions expire; security changes need a
  recent sign-in.
- Wallet ownership is proven by a single-use challenge signed by the
  wallet, bound to owner, address, chain and time.
- Agents hold scoped credentials that can read, research, draft, quote
  and explain; they cannot sign, create credentials or widen their scopes.
  Operators cannot use owner routes. Every store function scopes by the
  verified owner.
- Secrets are stored only as peppered hashes; URLs and keys are redacted
  from logs; configuration issues never echo values.

## Execution

- A plan is hashed; the approval is bound to the hash; a changed plan
  needs a new approval.
- Every transaction the venue builds is decoded instruction by
  instruction, validated against the plan (fee payer and sole signer,
  owner token accounts, mints, exact input and minimum output, compute
  budget within the fee cap, reviewed route programs only, no transfers,
  approvals, authority changes or closures) and simulated before anyone
  signs. Eight malicious outputs are refused in the tests.
- The owner signs in their own wallet; the API verifies the signature over
  the exact prepared message and broadcasts once. The same bytes are
  resent while the blockhash lives; a lost answer is reconciled from the
  chain; no second purchase happens on a retry.
- Policy is re-evaluated at submission with a reservation, under a
  per-user lock.

## Custody and money

Markov never holds customer funds, never pools, never issues a basket
token and never promises redemption. Software that avoids pooling can
still carry legal obligations; nothing here infers an exemption
([product scope](../reference/markov/product-scope.md)).

## Data

- Retrieved pages, provider responses and documents are untrusted data,
  never instructions; retrieval is https-only through a pinned-DNS
  resolver with redirect revalidation, body caps and SSRF refusal.
- Receipts carry owner and actor as SHA-256 commitments; public reading is
  an explicit opt-in and redacts the answer, not the signed body.
- The app's server never exposes provider secrets, server RPC credentials,
  signing keys or issuer API keys to the browser, bundles, HTML, logs or
  source maps.

## Supply chain and provenance

Exact pins, a frozen lockfile, a minimum release age, an allowlist of
packages that may run install scripts, SHA-pinned CI actions,
checksum-verified tool downloads, a secret scan of every commit and a
commit-message policy that rejects bot co-author and tool attribution
trailers ([contributing](../contributing.md)).

## What is not verified

Live venue, live issuer feeds, the production identity provider, price
sources for valuation and the KMS-backed receipt signer are open
decisions; the corresponding capabilities are `BLOCKED` or
`FIXTURE_VERIFIED` in [provider capabilities](../reference/markov/provider-capabilities.md).
A successful HTTP response, a configured credential or a transaction
signature alone never upgrades a state.
