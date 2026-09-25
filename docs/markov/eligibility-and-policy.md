# Eligibility, terms, limits and trading policy (B05)

Session B05 makes the backend able to say, deterministically and with
evidence, whether a person may trade a given instrument now and within what
limits. Nothing here is a legal opinion: the service records decisions made
under operator-published rules, and answers **unknown** whenever it lacks
evidence. Unknown, expired, revoked or superseded eligibility blocks
execution.

## Concepts

| Term | Meaning |
| ---- | ------- |
| Jurisdiction rule set | Operator-published, versioned (`YYYY-MM-DD[.n]`) list of rules: jurisdiction × capability → `allow` / `deny` / `review`, the issuers covered, the minimum evidence required and a reason. One version is active; versions are immutable. |
| Evidence kind | `self_declared` (the person's own declaration, the only kind V1 collects), `operator_attested`, `provider_verified` (a future KYC provider). Stronger evidence satisfies weaker requirements, never the reverse. |
| Eligibility decision | Recorded per declaration: user, capability (`trade_stocks`), policy version, jurisdiction, evidence kind, outcome (`eligible` / `ineligible` / `unknown`), reasons, covered issuers, expiry, revocation. Decisions are never edited; a new declaration records a new one. |
| Standing | Whether a decision still answers: `in_force`, `missing`, `expired`, `revoked` or `superseded` (made under another policy version). Only `in_force` decisions count. |
| Terms document | Versioned terms/disclosure text with its SHA-256 and public https URL. One active document per capability; acknowledging requires the exact hash so nobody accepts text they were not shown. |
| Owner limits | Per-account settings that can only tighten the ceiling: order, daily and account notionals (raw USDC), issuer and company concentration (bps), slippage, quote age, cash reserve, allowed venues. |
| Ceiling | Policy defaults tightened by approved beta caps (`BETA_*`, OD-12) when configured. The API reports which applies (`ceilingSource`). |
| Capability states | Per person and instrument: `discoverable`, `researchable`, `quoteable`, `buyable`, `sellable`, `redeemable` (always false: redemption is the issuer's), `transferable` (the mint's own rule). Each false state lists its conditions. |
| Policy decision | Deterministic evaluation of an intent at `quote` or `submit` stage with machine-readable denials, the evidence versions it depended on, the limits applied, the budget after it and its expiry. |
| Spend reservation | A hold of an allowed intent's notional against the daily and account budgets, serialised per account. Statuses `held`, `released`, `consumed` (B10), `expired`. |

## Decision rules

Eligibility (`@markov/policy` `evaluateEligibility`):

1. No published rule set → `unknown` (OD-06), valid one day.
2. No rule for the jurisdiction and capability → `unknown`.
3. Any `deny` rule → `ineligible` for the rule set's validity.
4. An `allow` rule whose minimum evidence the person meets → `eligible`
   for the union of the covered issuers.
5. Otherwise (`review`, or evidence too weak) → `unknown` with the reason.

Policy (`evaluatePolicy`), every check runs and every failure is reported
with its limit and observed value in the same unit:

| Code | Trigger |
| ---- | ------- |
| `EXECUTION_DISABLED` | `submit` stage while `EXECUTION_WRITES_ENABLED=false` |
| `VENUE_DISABLED` | `submit` stage while the `execution.jupiter.quote` readiness row is missing, `BLOCKED` or `DISABLED`; `IMPLEMENTED`, `FIXTURE_VERIFIED` and the `LIVE_*` states count as enabled and `EXECUTION_VENUE_PROVIDER` is not read, so with the seeded `FIXTURE_VERIFIED` row this check passes in every environment and `EXECUTION_DISABLED` is the gate that holds |
| `PARTICIPANT_NOT_ALLOWLISTED` | `BETA_PARTICIPANT_ALLOWLIST_ENABLED=true` and the account is not on the list |
| `ELIGIBILITY_UNKNOWN` / `_EXPIRED` / `_SUPERSEDED` / `_DENIED` | decision missing or unknown / expired or revoked / made under another policy version / ineligible |
| `ISSUER_NOT_COVERED` | eligible, but not for this instrument's issuer |
| `TERMS_NOT_ACKNOWLEDGED` | an active terms document for the capability lacks a matching acknowledgement |
| `INSTRUMENT_NOT_ADMITTED`, `ISSUER_HALTED`, `CORPORATE_ACTION_PENDING`, `MIGRATION_REQUIRED`, `INSTRUMENT_SUNSET`, `MULTIPLIER_UNKNOWN`, `REFERENCE_STALE` | catalog status and lifecycle facts (B03/B04); stale reference data is a data-quality denial |
| `VENUE_NOT_ALLOWED`, `SLIPPAGE_LIMIT_EXCEEDED`, `QUOTE_STALE` | owner limits on venue, slippage and quote age |
| `ORDER_CAP_EXCEEDED`, `DAILY_CAP_EXCEEDED`, `ACCOUNT_CAP_EXCEEDED` | notionals in raw USDC; daily and account usage include held reservations |
| `ISSUER_CONCENTRATION_EXCEEDED`, `COMPANY_CONCENTRATION_EXCEEDED` | share of (positions + cash + this order) per issuer and per underlying company; company identity is normalised across issuers so two issuers' tokens for one company share a bucket |
| `CASH_RESERVE_BREACHED` | declared cash cannot cover the order or would fall below the reserve |
| `EXPOSURE_UNKNOWN` | `submit` stage without declared holdings and cash |
| `NOTIONAL_ZERO` | the notional is zero |

Concentration and reserve checks need exposure. The ledger (B12) does not
feed policy yet: the caller declares holdings (`exposure.source:
caller_declared`; the contract's `ledger` source has no producer) and the
decision records that source. Execution planning (B09) declares, for each
constituent it evaluates, the other constituents' targets as positions and
the cash the wallet keeps after the plan; submission (B10) declares the
plan's other legs as positions and the plan's recorded stablecoin balance as
cash. A quote-stage evaluation with `source: none` skips those checks; the
submit stage refuses.

A decision expires after 60 seconds, or earlier when the eligibility
decision or the quote (`quoteObservedAt` + `maxQuoteAgeSeconds`) expires.
Submission must re-evaluate; it never relies on an old decision.

## Budgets and reservations

- Daily usage = held and consumed reservations since 00:00 UTC.
- Account usage = declared positions + buy-side holds still in force.
- `reserve: true` evaluates and holds in one transaction under a per-user
  advisory lock, so concurrent intents queue and the sum of holds can never
  exceed what the deterministic decision allows (`packages/db/test/policy-store.test.ts`
  and `apps/api/test/policy.test.ts` race twelve and eight intents).
- Reservations are idempotent per `intentId`; a replay returns the existing
  hold. A settled intent id cannot be reused (`IDEMPOTENCY_CONFLICT`).
- Holds expire after 15 minutes unless released (`DELETE /v1/me/reservations/{intentId}`)
  or consumed by execution (B10).

## Limits

| Field | Policy default | Owner may |
| ----- | -------------- | --------- |
| `maxOrderNotionalUsdcRaw` | 1,000 USDC | lower |
| `maxDailyNotionalUsdcRaw` | 5,000 USDC | lower |
| `maxAccountNotionalUsdcRaw` | 25,000 USDC | lower |
| `maxIssuerConcentrationBps` | 5000 | lower |
| `maxCompanyConcentrationBps` | 3000 | lower |
| `maxSlippageBps` | 100 | lower |
| `maxQuoteAgeSeconds` | 60 | lower |
| `cashReserveBps` | 0 | raise |
| `allowedVenues` | `jupiter` | narrow |

Beta caps (`BETA_MAX_*_USDC_RAW`) tighten the three notionals below the
defaults; they never raise them. A looser owner value is refused with the
ceiling in the error details, never clamped silently. Changing limits needs
a fresh sign-in (`STEP_UP_REQUIRED` otherwise).

## Fixtures

`FIXTURE_JURISDICTION_RULE_SET` uses only user-assigned ISO 3166-1 codes
(`ZZ` allow all, `XX` deny, `XY` allow PreStocks with operator attestation,
`AA` review) so no real country is ever allowed by a fixture; the API
refuses those codes outside `local` and `test`. `FIXTURE_TERMS_DOCUMENT`
hashes `FIXTURE_TERMS_TEXT` so local journeys acknowledge a real hash of
real text. Real rules and terms are counsel-owned (OD-06).

## Surface

Routes are listed in `docs/markov/api.md` (B05 section); CLI commands under
`markov policy …`. The headless journey in `scripts/ci/startup-check.sh`
publishes the fixtures, declares, acknowledges, evaluates with a
reservation, re-checks at the submit stage and releases the hold.

## What this session does not claim

- No hosted KYC or residency provider is integrated; `provider_verified`
  evidence has no producer yet.
- No real jurisdiction rule or terms text exists in the repository.
- Exposure is caller-declared; the ledger (B12) exists but does not feed
  policy yet.
- Nothing executes on a live cluster: `submit` denies with
  `EXECUTION_DISABLED` while `EXECUTION_WRITES_ENABLED=false` (the default).
  `VENUE_DISABLED` no longer fires on a freshly seeded database because the
  `execution.jupiter.quote` row has been `FIXTURE_VERIFIED` since B09.
  Writes have run only against the fixture chain (B10).
