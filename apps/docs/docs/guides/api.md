---
title: "API conventions"
sidebar_label: "API"
sidebar_position: 3
description: "Principals and scopes, the error envelope, idempotency, rate limits and the verification states, before the generated reference."
---

The API (`apps/api`, Fastify with zod-validated routes) exports its own
OpenAPI 3.1 document (`pnpm openapi:generate`, checked for drift in CI);
the [API reference](../api/index.md) is generated from it. This page is
the part a reference cannot generate: who may call what, how errors look
and what a successful answer does and does not mean. The canonical text is
[the API contract](../reference/markov/api.md).

## Principals

Send `Authorization: Bearer <token>`. Four principal classes exist:

| Class | Token | Can |
| ----- | ----- | --- |
| user | a session from an identity token (`POST /v1/auth/sessions`) | everything about their own account; mutations of wallets, credentials and devices need a recent sign-in (step-up) |
| agent | a scoped credential the person created | read, research, draft, quote and explain within its scopes; never sign, never create credentials |
| device | a paired Mark I device credential | device routes only |
| operator | an operator credential with `ops:*` scopes | catalog, policy and price observation writes; never owner routes |

Every store function scopes by the verified owner: another person's
resource answers `NOT_FOUND`, never `FORBIDDEN`, so existence is not
revealed. Public routes (catalog reads, public strategies and receipts,
methodology, rankings) take no token and accept one for a fuller answer.

## Errors

Every error is one envelope:

```json
{
  "error": {
    "code": "POLICY_DENIED",
    "message": "the request exceeds the daily budget",
    "requestId": "req-…",
    "details": [{ "path": "budget", "message": "…" }]
  }
}
```

Codes are an enum (`AUTH_REQUIRED`, `FORBIDDEN`, `NOT_FOUND`,
`VALIDATION_FAILED`, `RATE_LIMITED`, `ELIGIBILITY_UNKNOWN`,
`ASSET_NOT_ADMITTED`, `QUOTE_EXPIRED`, `INSUFFICIENT_FUNDS`,
`POLICY_DENIED`, `PLAN_CHANGED`, `SIGNATURE_MISMATCH`, `PARTIAL_EXECUTION`,
`SUBMISSION_UNKNOWN`, `PUBLICATION_EXPIRED`, `TRANSACTION_REFUSED`,
`PROVIDER_UNAVAILABLE`, `IDEMPOTENCY_CONFLICT`, `STEP_UP_REQUIRED`,
`CHALLENGE_INVALID`, `WALLET_ALREADY_LINKED`, `ADMISSION_BLOCKED`,
`SERVICE_NOT_READY`, `INTERNAL`). A refusal from the transaction validator
names its reason in `details[0].message`; a policy denial lists every
denial with its code.

## Idempotency and concurrency

Intents carry an `idempotencyKey`: the same key answers the same intent and
a different payload answers `IDEMPOTENCY_CONFLICT`. Submissions are
idempotent per prepared transaction: the same signed bytes never create a
second attempt, and a lost answer is reconciled from the chain instead of
resent as a new purchase. Reservations and policy decisions run in one
transaction under a per-user advisory lock.

## Rate limits and bounds

Routes carry per-client limits (for example reconciliation 30/min,
receipts 60/min, performance series 60/min, rankings 20/min) and answer
`RATE_LIMITED` with `429`. Bodies are capped (`API_BODY_LIMIT_BYTES`),
lists are bounded and paginated by cursor where they can grow.

## What an answer means

- A `200` from a quote or a plan is a bounded proposal with an expiry, not
  an executable offer; a reference price is never a quote.
- A `201` from a submission means the bytes were broadcast once; the
  state is read from the chain until finality. A transaction signature is
  not settlement.
- A receipt's signature proves the platform attested to the record;
  settlement is the chain evidence it references; ownership is not
  asserted.
- A performance figure is null with a reason whenever a point is
  incomplete; a ranking never shows a return next to an unranked entry.
- Each capability answers with its verification state on
  `GET /v1/platform`; a successful call is never itself evidence of a
  live integration.

## Route groups

| Tag | Routes | Contract |
| --- | ------ | -------- |
| platform | health, readiness, platform identity and capabilities | [architecture](../reference/markov/architecture.md) |
| identity | sessions, wallets, credentials, devices, audit | [identity and principals](../reference/markov/identity-and-principals.md) |
| catalog | instruments, verification, lifecycle, corporate actions, multipliers, quantities | [catalog](../reference/markov/catalog.md) |
| policy | eligibility, terms, limits, evaluations, reservations | [eligibility and policy](../reference/markov/eligibility-and-policy.md) |
| research | theses, sources, runs, mapping | [research](../reference/markov/research.md) |
| watchlists, strategies, follows | lists, drafts, versions, instances, follows | [strategies](../reference/markov/strategies.md) |
| registry | prepare, submit, status, public versions | [strategy registry](../reference/markov/strategy-registry.md) |
| execution | intents, plans, acknowledgements, transactions, submissions, reconciliation | [execution planning](../reference/markov/execution-planning.md), [state machine](../reference/markov/execution-state-machine.md) |
| accounting | holdings, journal, reconciliation, receipts, keys | [accounting methodology](../reference/markov/accounting-methodology.md) |
| analytics | performance series, rankings, methodology, price observations | [valuation and performance](../reference/markov/accounting-methodology.md#valuation-and-performance-b13) |

The generated client (`packages/api-client`) validates every response at
runtime against these schemas and is what the app's server uses.
