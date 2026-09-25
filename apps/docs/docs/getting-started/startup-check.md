---
title: "The startup check"
sidebar_label: "Startup check"
sidebar_position: 2
description: "The headless journey the CI workflow runs from a clean checkout, exercising the capabilities of backend sessions B01 to B16 against the fixture chain and asserting each result."
---

`scripts/ci/startup-check.sh` is the reference run of the whole backend.
It starts the fixture RPC, migrates a throwaway database, boots the API,
walks every journey with the CLI and `curl`, asserts the exact outcomes,
shuts down cleanly, and then proves that a wrong cluster or a node
reporting another chain refuses to start. The CI workflow
(`.github/workflows/ci.yml`) runs it on every push, on pull requests and
on manual dispatch; GitHub Actions runs start with P01, and until then the
evidence is local runs. The commands on these pages are the ones it
executes.

```bash
MARKOV_TEST_DATABASE_URL=postgres://markov:markov@127.0.0.1:5432/markov_test \
  bash scripts/ci/startup-check.sh
```

It needs a PostgreSQL admin connection (it creates and drops its own
database), a built workspace (`pnpm build`) and nothing else. It never
contacts a live cluster or a provider.

## What it proves, in order

1. **Migrate and bind**: `markov db migrate` applies every migration,
   binds the platform identity and seeds capability readiness.
2. **Health**: `markov health` against the running API.
3. **Identity** (B02): a test-issuer identity token becomes a session;
   `whoami`; a wallet ownership challenge is signed and linked; an unknown
   bearer token is rejected.
4. **Catalog** (B03): an operator credential; the PreStocks fixture feed is
   ingested; a mint is verified on the fixture chain and admitted; public
   search answers; the operator route refuses an anonymous call.
5. **Listed stocks** (B04): xStocks fixture products and corporate-action
   events; the Token-2022 extension policy admits one mint and refuses
   another; a split is applied and exact quantities follow the multiplier.
6. **Policy** (B05): fixture rules and terms are published; the person
   declares a jurisdiction and acknowledges terms; evaluations deny before
   and allow after, with a race-safe reservation; denials are machine
   readable.
7. **Research** (B06): a thesis, a fixture issuer source, a sourced
   revision, a fixture model run, mapping, the public projection, and an
   SSRF refusal.
8. **Strategies** (B07): a draft, validation errors, freeze v1, fork, an
   instance pinned to v1, the creator's v2, the pin unchanged, explicit
   acceptance, the diff.
9. **Registry** (B08): prepare (what becomes public), sign, submit,
   finalize, registered, the indexer, public verification, deprecation.
10. **Planning** (B09): fund the wallet; an intent (idempotent); a fixture
    plan with conservation, bounds and hash; acknowledgement rules; cancel.
11. **Execution** (B10): buy, sign, submit, finality, sell; a changed
    signature is refused; a retry resends the same bytes; a lost answer is
    reconciled; no second purchase.
12. **Baskets** (B11): a two-constituent version composed into one atomic
    transaction, one signature, finality with a fill per leg.
13. **Accounting** (B12): fills projected once; funding reconciled as
    acknowledged deposits; matched holdings; an unexplained transfer
    detected; a signed receipt verified online and offline; a tampered
    receipt refused; public redaction.
14. **Performance** (B13): operator price observations over forty days (the
    same point recorded twice is one observation); the wallet series with
    its funding as a flow and not a return; the basket version's model
    series; the ranking listing the version unranked for insufficient
    history with no return shown; price history; the methodology.
15. **Discovery** (B14): the explorer lists the young version without a
    rank and without private identifiers; the creator page from chain
    records; a second person follows and pins v1; the creator registers
    v2 and the follower is offered it, never moved; moderation hides v2
    from listings and public reads while its chain record and the pin
    stay untouched, then restores it; explicit acceptance.
16. **Agents** (B15): a scoped agent credential and its typed tool
    catalog; an unknown tool argument and a tool outside the scopes are
    refused; a poisoned companion run has each injected tool call refused
    and the owner's limits unchanged; a proposal that only the owner can
    open into an intent; the owner's event log, which the agent cannot
    read.
17. **Maintenance** (B16): a schedule due now; an unattended mode refused
    at the contract; a maintenance pass refused to the session, the agent
    and an operator without the maintenance scope; the worker's pass
    prepares one proposal and a second pass on the same occurrence
    prepares nothing; pause; in-app notifications; an email address
    verified and a proposal email delivered through the fixture provider;
    a mandate dry run with `automation.unattended` still `DISABLED`, and a
    reduce-only mandate denied a buy.
18. **Graceful shutdown**, then two refusals: `SOLANA_CLUSTER=testnet`
    against a devnet-bound database exits 78, and an RPC that reports
    another genesis exits 78.

Each session's log under [Session evidence](../reference/sessions/b01.md)
records the run and its output for that session.

## Reading a failure

The script uses `set -euo pipefail` and asserts with `[ … ]` after printing
the observed value, so the last printed line names the assertion that did
not hold. Exit codes follow [operations](../reference/markov/operations.md):
78 is a configuration or identity contradiction, 69 an unavailable
dependency, 70 an unexpected error.
