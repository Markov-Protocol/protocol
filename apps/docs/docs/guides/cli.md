---
title: "Using the CLI"
sidebar_label: "CLI"
sidebar_position: 2
description: "The markov command line drives every backend capability; these flows are the ones the startup check runs and asserts, with the same commands."
---

`markov` (`apps/cli`) is the operator's and the developer's door to the
API and the database. The complete command tree, with every flag, is
generated into the [CLI reference](../cli/index.md); this page walks the
flows that [the startup check](../getting-started/startup-check.md)
executes, in the same order, with the commands it runs.

```bash
pnpm build
alias markov='node apps/cli/dist/main.js'
markov --help
export URL=http://127.0.0.1:3000          # the API (pnpm dev:api)
```

Every API command takes `--url` and, where a principal is needed, a
bearer `--token`: a **session** (a person), an **agent credential** (a
scoped delegate) or an **operator credential**. Read
[identity and principals](../reference/markov/identity-and-principals.md).
Commands print JSON; the startup check pipes it through `node -e` to
assert on fields.

## A person: session and wallet

```bash
IDENTITY=$(markov auth test-token --subject did:test:alice --url $URL)      # nonproduction test issuer only
SESSION=$(markov auth session --identity-token "$IDENTITY" --url $URL \
  | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>console.log(JSON.parse(d).sessionToken))')
markov auth whoami --token "$SESSION" --url $URL
markov auth demo-wallet-link --token "$SESSION" --url $URL                  # a throwaway key signs the ownership challenge
```

The test issuer is refused outside local and test; production expects the
configured identity provider ([open decision OD-05](../reference/markov/open-decisions.md)).

## An operator: catalog and listed stocks

```bash
OPERATOR=$(markov operators create --label local --scopes ops:catalog:read,ops:catalog:write --expires-days 1)
markov catalog ingest --issuer prestocks --source fixture --token "$OPERATOR" --url $URL
markov catalog list --status quarantined --q FXAERO --token "$OPERATOR" --url $URL
markov catalog verify-mint <instrumentId> --token "$OPERATOR" --url $URL
markov catalog decide <instrumentId> --decision admit --reason "terms reviewed" --evidence review=local --token "$OPERATOR" --url $URL
markov catalog ingest --issuer xstocks --source fixture --token "$OPERATOR" --url $URL
markov catalog events ingest --issuer xstocks --source fixture --token "$OPERATOR" --url $URL
markov catalog events list --issuer xstocks --status pending --token "$OPERATOR" --url $URL
markov catalog events apply <actionId> --reason "issuer notice" --evidence notice=fixture --token "$OPERATOR" --url $URL
markov catalog convert <instrumentId> --raw 150000000 --as-of 2026-09-21T00:00:00Z --url $URL
```

`operators create` talks to the database directly and prints the
credential once. Ingestion sanitises every snapshot, quarantines
newcomers, refuses counterfeits and collisions, and admits nothing without
a matching on-chain mint verification ([catalog](../reference/markov/catalog.md),
[instrument admission](../reference/markov/instrument-admission.md)).

## Policy

```bash
POLICY=$(markov operators create --label policy --scopes ops:policy:read,ops:policy:write --expires-days 1)
markov policy rules publish --fixture --token "$POLICY" --url $URL
markov policy terms publish --fixture --token "$POLICY" --url $URL
markov policy declare --jurisdiction ZZ --token "$SESSION" --url $URL
markov policy terms current --url $URL
markov policy terms acknowledge --terms-version <version> --content-hash <hash> --token "$SESSION" --url $URL
markov policy eligibility --token "$SESSION" --url $URL
markov policy availability <instrumentId> --token "$SESSION" --url $URL
markov policy evaluate --instrument <instrumentId> --notional 100000000 --intent demo-1 --cash 1000000000 --reserve --token "$SESSION" --url $URL
markov policy reservations release demo-1 --token "$SESSION" --url $URL
```

An evaluation before the declaration and the acknowledgement is denied
with machine-readable reasons; `--reserve` holds the notional against the
daily limit in the same transaction; `--stage submit` re-evaluates at
submission ([eligibility and policy](../reference/markov/eligibility-and-policy.md)).

## Research and strategies

```bash
THESIS=$(markov research thesis create --title "Fixture Aerospace exposure" --claim "…" --token "$SESSION" --url $URL)
markov research source attach <thesisId> --source-url https://example.invalid/issuer/terms --role issuer --token "$SESSION" --url $URL
markov research run create --thesis <thesisId> --question "…" --source <sourceId> --token "$SESSION" --url $URL
markov research map --company "Fixture Aerospace, Inc." --token "$SESSION" --url $URL
markov research thesis publish <thesisId> --visibility public --token "$SESSION" --url $URL

markov strategy create --input '{"title":"Aerospace tilt","thesis":"…","legs":[{"instrumentId":"…","weightBps":6000}],"cashBps":4000}' --token "$SESSION" --url $URL
markov strategy draft <strategyId> --if-revision 1 --input '{…}' --token "$SESSION" --url $URL
markov strategy freeze <strategyId> --token "$SESSION" --url $URL
markov strategy fork <strategyId> --version-id <versionId> --token "$SESSION" --url $URL
markov strategy diff <strategyId> <versionId> --against <otherVersionId> --token "$SESSION" --url $URL
markov instance create --strategy <strategyId> --version-id <versionId> --wallet <walletId> --label mine --token "$SESSION" --url $URL
markov instance pin <instanceId> --version-id <versionId> --token "$SESSION" --url $URL
```

Sources go through the pinned-DNS https retriever, so a link-local or
private address is refused ([research](../reference/markov/research.md)).
A frozen version is immutable and a follower's pin never moves without
`instance pin` ([strategies](../reference/markov/strategies.md)). The
registry flow is `strategy publish`, `registry submit`, `registry
publication`, `registry public-version` and `registry record`
([strategy registry](../reference/markov/strategy-registry.md)).

## Plan, sign, execute

```bash
markov intents create --version-id <versionId> --wallet <walletId> --budget 200000000 --idempotency-key demo-basket-1 --token "$SESSION" --url $URL
markov intents create --instrument <instrumentId> --wallet <walletId> --budget 100000000 --idempotency-key demo-buy-1 --token "$SESSION" --url $URL
markov intents plan <intentId> --token "$SESSION" --url $URL
markov intents verify-plan --input "$PLAN_JSON"                  # recomputes the hash offline
markov intents acknowledge <intentId> <planId> --plan-hash <planHash> --token "$SESSION" --url $URL
markov intents build <intentId> --token "$SESSION" --url $URL     # the venue transaction, validated and simulated
markov intents sign --key-file <file> --input "$BUILD_JSON" --message-hash <hash>   # fixture chain only
markov intents submit <intentId> --signed <base64> --token "$SESSION" --url $URL
markov intents execution <intentId> --token "$SESSION" --url $URL
markov intents reconcile <intentId> --token "$SESSION" --url $URL
markov intents cancel <intentId> --token "$SESSION" --url $URL
```

The same idempotency key with a different budget answers
`IDEMPOTENCY_CONFLICT`; a build before the acknowledgement is refused; a
wrong hash is `PLAN_CHANGED`; wrong bytes are `SIGNATURE_MISMATCH`; the
same signed bytes twice create one attempt. `intents sign` exists for the
fixture chain and the startup check; a real account signs in its own
wallet ([execution planning](../reference/markov/execution-planning.md),
[execution state machine](../reference/markov/execution-state-machine.md)).

## Holdings and receipts

```bash
markov portfolio project --token "$SESSION" --url $URL                      # finalized fills into the journal, once
markov portfolio journal <walletId> --token "$SESSION" --url $URL
markov portfolio reconcile <walletId> --token "$SESSION" --url $URL
markov portfolio acknowledge <entryId> --kind deposit --note "initial funding" --token "$SESSION" --url $URL
markov portfolio holdings <walletId> --token "$SESSION" --url $URL
markov portfolio instance-holdings <instanceId> --token "$SESSION" --url $URL
markov receipts issue <intentId> --kind execution --token "$SESSION" --url $URL
markov receipts keys --url $URL > keys.json
markov receipts verify --file receipt.json --keys-file keys.json           # offline
markov receipts visibility <receiptId> --public --token "$SESSION" --url $URL
markov receipts show <receiptId> --url $URL                                # redacted public read
```

Reconciliation lists unexplained chain differences; the owner explains
each one; a tampered receipt fails verification with a non-zero exit
([accounting methodology](../reference/markov/accounting-methodology.md)).

## Performance and prices

```bash
markov prices record --instrument <instrumentId> --kind issuer_mark --value 18.25 --observed-at 2026-09-01T00:00:00Z --source my-desk --evidence notice=file --token "$OPERATOR" --url $URL
markov prices record --sol --kind secondary_market --value 150 --observed-at 2026-09-25T00:00:00Z --source my-desk --token "$OPERATOR" --url $URL
markov prices history <instrumentId> --url $URL
markov performance wallet <walletId> --token "$SESSION" --url $URL
markov performance instance <instanceId> --period 30d --token "$SESSION" --url $URL
markov performance version <strategyId> 1 --period all --export --token "$SESSION" --url $URL
markov performance rankings --period 30d --url $URL
markov performance methodology --url $URL
```

A return is reported only for a complete window; a deposit shows up in
the flows, never in the return; a ranking lists a short or incomplete
history without a rank and without a number. The rules and the worked
fixtures are in [accounting and performance](./performance.md).

## Database and operations

```bash
markov db migrate --bound-by <who>       # production also needs --allow-production
markov db status
markov capabilities
markov config check
markov solana probe
markov worker ping
```

See [operations](../reference/markov/operations.md) for exit codes,
migration review, operator credentials, emergency procedures and the
capability readiness record.
