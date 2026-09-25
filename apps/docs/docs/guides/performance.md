---
title: "Accounting and performance"
sidebar_label: "Performance"
sidebar_position: 4
description: "Raw units, a balanced journal, FIFO lots, chain reconciliation, signed receipts, then valuation, cash-flow-aware returns and model-only rankings, with fixtures derived independently."
---

Markov keeps quantities and values apart. The **journal** records what
moved, in raw base units, one asset at a time, and never values anything.
The **valuation layer** prices what the journal holds with recorded
reference observations and historical multipliers, and reports a return
only when every point of a window is complete. The full methodology is
[accounting methodology](../reference/markov/accounting-methodology.md);
this page is the short version with the rules that most often surprise.

## Quantities (B04, B12)

- Raw base units are the only stored quantity. A scaled Token-2022 token
  has a multiplier with evidence and an effective time; a display quantity
  is raw × multiplier / 10^decimals, computed exactly and rounded once.
  Nothing multiplies a valuation twice, and a period without multiplier
  evidence is incomplete, not zero.
- The journal is append-only and balanced per asset (USDC and a stock mint
  never share an equation). Fills, fees and rent are projected once per
  signature and leg; corrections reverse and replace.
- Lots open on buys and are consumed **first in, first out** on sells; a
  basket's lots are attributed to the one active instance of the same
  wallet and strategy, everything else stays at wallet level. FIFO is
  analytics bookkeeping, not tax advice.
- Reconciliation compares the journal with the chain and turns every
  unexplained difference into an external flow the owner explains
  (deposit, withdrawal, transfer, other). Nothing is attributed to a
  strategy by guessing.
- A receipt is canonical JSON signed with a versioned Ed25519 key; it
  attests to the record, settlement is the chain evidence it references,
  and verification needs only the published keys (`markov receipts
  verify`).

## Valuation (B13)

- A **price observation** is typed: kind (`secondary_market`,
  `issuer_mark`, `underlying_equity`, `implied_valuation`), unit, time,
  source. Observations are recorded from catalog ingestion and by
  operators with evidence, never from quotes.
- At a point, the latest observation at or before it values a token:
  secondary market first, issuer mark second, underlying equity third as a
  stated assumption; an implied company valuation never prices a token.
  Older than 24 hours, or in another unit, it values nothing.
- The stablecoin is valued at a fresh observation or at par as a stated
  assumption, with a depeg flagged above 50 bps. Lamports are valued only
  from recorded SOL observations.

## Returns

Points sit on every UTC midnight between the start and the end, plus the
exact time of every external flow, so each flow closes its own subperiod:

```
r_k = (V_k − F_k) / V_{k−1} − 1        index_k = index_{k−1} × (1 + r_k)
```

- **Time-weighted return** chains the subperiods. Money entering the
  subject is `F_k`, never gain: two deposits of 1,000 double the value and
  return exactly 0.
- **Money-weighted return** is Modified Dietz over the window, flows
  weighted by the time they were in the portfolio. It answers a different
  question and is reported separately.
- **Drawdown** is the largest peak-to-trough decline of the chained index;
  **turnover** the traded value over the average valuation; realized and
  unrealized **P&L** come from the lots; **fees** from the journal, valued
  at the end's SOL observation.
- Any incomplete point, unvalued flow or non-positive base leaves the
  window's return null with the reason (`incomplete_points`,
  `unpriced_flow`, `zero_base`, `stale_end`, `insufficient_history`).

## Series

- The **actual series** of a wallet starts at its first reconciliation
  checkpoint (the first time the platform observed it on chain) and treats
  deposits, withdrawals and transfers as flows; the actual series of an
  instance holds its lots, with purchases as contributions of their cost
  and sales as withdrawals of their proceeds.
- The **model series** of a published version buys whole base units at
  the first priced point after the freeze, holds the cash weight in the
  stablecoin, never rebalances and carries no costs. It is not anyone's
  account.

## Rankings

`GET /v1/rankings/model` ranks registered, unmoderated versions by the
time-weighted return of their model series over one period and one
methodology version. A version needs 30 days of complete history (a
product rule), a complete window and a fresh end price; otherwise it is
listed with `rank: null` and no return. An account's series is refused by
kind, so deposits, transaction counts and unverified claims cannot enter.

## Fixtures you can recompute

`packages/analytics/fixtures/performance-vectors.json` was derived with
Python fractions by `derive-vectors.py`, without sharing code with the
implementation, and the package tests replay it exactly. The scenarios
(deposit not profit, a price return with a deposit before a fall, a 2:1
split that changes nothing, a missing observation, a stale end, a zero
base, an instance trade, two rankable forty-day models) and their numbers
are tabulated in
[the methodology](../reference/markov/accounting-methodology.md#worked-fixtures-independently-derived).
