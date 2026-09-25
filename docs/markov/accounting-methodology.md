# Accounting methodology

Status: the units section is implemented in B04 (`@markov/amounts`,
catalog quantities); the journal, lots and attribution, chain
reconciliation and receipts are implemented in B12 (`@markov/accounting`,
`packages/db/src/accounting-store.ts`, `apps/api/src/accounting`);
valuation, performance and ranking rules are implemented in B13
(`@markov/analytics`, `packages/db/src/analytics-store.ts`,
`apps/api/src/analytics`) under methodology version `stocks-v1`.

## Units

- **Raw base units** are the chain's integers (`u64`), carried as digit
  strings. They are the only stored quantity and the only thing a
  transaction moves.
- **Decimals** come from the verified mint, never from the feed alone.
- **Multiplier** is the scaled-UI-amount factor in force at a time. It is
  recorded as evidence with its source: an on-chain read (`on_chain`), an
  applied corporate action (`corporate_action`), an operator entry or an
  issuer feed. On-chain doubles are converted once into two decimal
  strings: the shortest round-trip form and the exact binary expansion.
- **Scaled (display) quantity** = raw × multiplier / 10^decimals, computed
  with BigInt decimals and rounded once with a named mode (`down`, `up`,
  `half_up`, `half_even`); every conversion returns the exact value, the
  rounded value, the multiplier used and whether rounding lost information.
- **Never twice.** A valuation uses either raw units with a raw-unit price
  or scaled units with a per-share price, never a scaled quantity with a
  raw-token quote. A price move caused only by a multiplier change is not a
  profit.
- **History.** The multiplier at time t is the latest evidence effective at
  or before t. Evidence points carry their basis: an on-chain read, a
  corporate action derived from the previous multiplier, or a corporate
  action whose value was observed on chain after its effective time. No evidence means the period is *incomplete*; nothing
  assumes 1, and analytics must show the period as incomplete rather than
  as zero return.

## Where the on-chain helpers differ

Token-2022's `amount_to_ui_amount` computes `trunc(amount_f64 ×
multiplier) / 10^decimals` in floating point and `try_ui_amount_into_amount`
truncates `parse_f64(ui) / (multiplier / 10^decimals)`. `@markov/amounts`
mirrors both only to measure divergence: for example 3 raw units at 0
decimals with multiplier 0.3 are exactly 0.9 scaled but the helper answers
0, and raw amounts above 2^53 lose precision in the helper but not in the
exact path. Markov never stores or accounts with the helper's result.

## Quantity journal (B12)

The journal is the platform's record of what moved, in raw base units,
one asset at a time. It never values anything.

- **Append-only.** Entries are inserted and never updated or deleted. A
  mistake is corrected by a `correction` entry that reverses the original
  line for line (`reversesEntryId`, source `reverse:<entryId>`) followed by
  a replacement; history stays readable.
- **Balanced per asset.** Every entry's lines sum to zero for each asset
  it touches (`assertBalanced`). Accounts: `wallet` (the owner's verified
  wallet), `venue` (the counterparty of a swap), `network_fee`, `rent`
  (lamports locked in accounts the transaction created), `external`
  (anything that entered or left the wallet outside the platform) and
  `correction`. USDC and a stock mint are different assets and never share
  a balancing equation.
- **Idempotent by source reference.** Each entry names its source
  (`execution_fill`, `chain_reconciliation`, `operator`) and a reference
  that is unique per owner: `fill:<signature>:<legIndex>`,
  `fee:<signature>:<legIndex>`, `rent:<signature>:<legIndex>`,
  `chain:<walletId>:<checkpointId>:<slot>:<asset>`. Recording the same observation twice
  is one entry (`journal_entries (owner_user_id, source_ref)` is unique and
  the projection skips existing references), so duplicate projections do
  not change totals (`apps/api/test/accounting.test.ts`,
  `scripts/ci/startup-check.sh`).
- **Fills.** A settled fill (B10/B11, one per signature and leg) becomes a
  `fill` entry (wallet gives the exact input to the venue, receives the
  observed output), a `network_fee` entry when the fill carries the
  transaction fee (the first leg's fill) and a `rent` entry for lamports
  spent beyond the fee. Quantities are the observed balance changes of the
  landed transaction, never the quote.
- **Projection.** `projectFills` (`@markov/accounting`) runs the same rules
  in the API (before every holdings, journal and reconciliation answer,
  and on `POST /v1/me/journal/projections`) and in the worker's
  reconciliation round (`projectJournal`, every 5 s over every owner). It
  lists fills without a journal entry, oldest slot first, and appends
  their entries, lots and consumptions in one transaction.

## Lots and attribution (B12)

- **Attribution** is decided per intent from the record, never by
  guessing: a `basket_investment` is attributed to the one active
  portfolio instance of the same wallet and strategy; a single buy or sell,
  or a basket without exactly one matching instance, stays at wallet level
  (`unassigned`); an external flow awaiting the owner's explanation is
  `needs_reconciliation`. A token counts towards one instance only; the
  wallet-level remainder can be negative when tokens left the wallet
  outside the platform, which the holdings answer shows instead of
  silently reducing a strategy's lots.
- **Lots.** Every buy opens a lot (asset, quantity, cost in the input
  asset, lamports spent, the fill entry that opened it, the instance or
  none). A sell consumes the wallet's open lots of the asset **first in,
  first out** (`LOT_ATTRIBUTION_POLICY = 'fifo'`), recording a consumption
  per lot with an integer proportional cost; consuming more than the lots
  hold is reported as a shortfall and left visible, never invented. FIFO is
  analytics bookkeeping, not tax advice for any jurisdiction.
- **Instance holdings** (`GET /v1/me/instances/{id}/holdings`) are the open
  lots per asset with their remaining quantity, the cost basis they carry
  and the fees they paid. **Wallet holdings** are the journal's `wallet`
  balances with, per asset, the portion attributed to instances (open
  lots), the portion awaiting reconciliation and the rest. The two totals
  are shown separately and never added.

## Chain reconciliation (B12)

`POST /v1/me/wallets/{id}/reconciliations` reads the wallet's lamports and
every SPL and Token-2022 account from the node at the configured read
commitment, sums them per mint and compares them with the journal's
`wallet` balances (`reconcileBalances`):

- a matching asset is `matched`;
- a difference in an asset the platform can name (the journal, the
  configured stablecoin or the catalog knows the mint) becomes an
  `external_inflow` or `external_outflow` entry between `wallet` and
  `external`, attributed `needs_reconciliation`, so the ledger now equals
  the chain and the person is asked to explain the flow (`deposit`,
  `withdrawal`, `transfer`, `other`) through
  `POST /v1/me/journal/{entryId}/acknowledgements`, which moves it to
  wallet level and never to a strategy;
- a difference already awaiting an explanation is not flagged twice;
- an asset nobody can name stays visible as `unassigned_asset` and is not
  journaled.

Each run records a **checkpoint** (slot, commitment, observation time,
per-asset ledger-before, chain, difference and outcome, entry ids) and the
holdings answer carries the latest one. Holding statuses: `matched`,
`unobserved` (no checkpoint knows the asset), `stale` (the journal moved
after the last observation), `needs_reconciliation` (an explanation is
pending, or the observation differs), `unassigned_asset`. The first
reconciliation of a wallet funded before the platform recorded anything
therefore records the funding as inflows to acknowledge, while a trade the
platform executed reconciles without any external flow; a transfer out of
the wallet made elsewhere is detected as an outflow and the strategy's
lots stay exactly as they were (`apps/api/test/accounting.test.ts`).

## Receipts (B12)

A receipt is a canonical JSON document about one intent, signed with a
versioned Ed25519 key:

- **Kinds.** A `decision` receipt records the acknowledged plan (plan id
  and hash, strategy version and manifest hash, policy version, decision
  ids, the effective limits and slippage, the venue and quote references,
  the approved bounds per leg). An `execution` receipt adds the message
  hashes, the chain signatures, slots and finality, the observed fills and
  fees, the timestamps and the terminal or recovery status. Issuing is
  idempotent per intent, kind and intent state.
- **Canonical form and signature.** The body is serialised with
  `canonicalJson` (sorted keys, no whitespace) and signed over
  `markov-receipt/v1` + a zero byte + the canonical body; `canonicalHash`
  is the SHA-256 of those bytes. The signer publishes `keyId`,
  `algorithm: ed25519` and the public key; `GET /v1/receipts/keys` lists
  every key with its status and validity, and a retired key still verifies
  what it signed while active.
- **Verification** needs only the receipt and the keys document:
  `verifyReceipt` (`@markov/accounting`) and `markov receipts verify
  --file <receipt> [--keys-file <keys>]` check the body shape, the hash,
  the key, the signer and the signature and report `BODY_INVALID`,
  `HASH_MISMATCH`, `KEY_UNKNOWN`, `KEY_RETIRED`, `SIGNER_MISMATCH` or
  `SIGNATURE_INVALID`.
- **Meaning.** A valid signature proves the platform attested to this
  record; settlement is established by the chain evidence the record
  references (signatures and slots anyone can check on the network). The
  body says so itself (`scope: attests record, settlement chain_evidence,
  ownership not_asserted, policy evaluated_as_recorded`): a receipt is
  never a proof of lawful stock ownership or of flawless policy
  enforcement.
- **Privacy.** The signed body carries no raw account identifier: the
  owner and the actor appear as SHA-256 commitments. Receipts are private
  by default (owner and read-scoped agents); the owner opts one into
  public reading, where the answer omits the owner id. Redaction applies
  to the answer, not the signed body, so a public receipt still verifies.
- **Keys.** `RECEIPT_SIGNING_PROVIDER=local_key` with a PKCS#8 Ed25519 key
  is for local, test and non-production environments and is refused in
  production; the KMS-backed signer is open decision OD-22. The boot
  records the configured key as active and retires the others.

## Valuation and performance (B13)

Methodology version `stocks-v1` (`GET /v1/performance/methodology`). The
implementation is `@markov/analytics`; every number below is computed with
exact rational arithmetic and rounded once when reported (values to 6
decimals, returns and ratios to 8, round half to even).

### Price observations

- **What is recorded.** A price observation is a typed value with a kind
  (`secondary_market`, `issuer_mark`, `underlying_equity`,
  `implied_valuation`), a unit, an observation time, a source and a source
  kind (`issuer_feed` from a catalog ingestion, `operator` from
  `POST /v1/operator/prices/observations` with evidence, `fixture` outside
  production only). Observations are append-only and unique per asset,
  kind, source and time; recording the same point twice is one row. They
  are never execution quotes and are never presented as offers.
- **Which observation values a token.** At a point in time the latest
  observation at or before it, taking `secondary_market` first (the token's
  own market), `issuer_mark` second, and `underlying_equity` third as a
  stated assumption (`underlying_as_token_price`: the token is taken at the
  underlying share price on the issuer's claim, which is a caveat, not a
  fact). `implied_valuation` never prices a token (`excluded_price_kind`).
  An observation older than `priceMaxAgeMs` (24 h) at the point, or in a
  unit other than the valuation currency (USD), values nothing: the point
  is incomplete with `stale_price`, `price_unit_mismatch` or
  `no_observation`.
- **Cash.** The configured stablecoin is valued at a fresh observation when
  one exists (flagged `stablecoin_depeg` when more than 50 bps from par)
  and otherwise at par as the stated assumption `stablecoin_par`.
  Lamports are valued only from recorded `SOL` observations.
- **Multipliers.** A scaled Token-2022 mint is valued as raw units × the
  multiplier in force at the point (the latest evidence effective at or
  before it, from the B04 history) × the price per display unit. No
  evidence at that time means `multiplier_unknown` and an incomplete point;
  nothing assumes 1. A split changes the multiplier and the price together
  and leaves the value alone (fixture `model-split`).

### Series

- **Points.** A series has a point at its start, at every UTC midnight
  between start and end, at the exact time of every external flow and at
  the end (the request time). A point is *complete* when every non-zero
  position is priced and multiplier-known and every flow of its subperiod
  is valued; otherwise its value is null and the reasons are listed.
- **Actual series, wallet.** The journal's `wallet` balances from the
  wallet's first reconciliation checkpoint, the first time the platform
  observed it on chain; fills journaled before that form the opening
  position (a wallet never reconciled starts at its first journal entry
  and shows `negative_quantity` where it spent before any recorded
  inflow). Deposits, withdrawals and transfers
  (`external_inflow`/`external_outflow` entries, acknowledged or still
  awaiting acknowledgement) are external flows valued at their own time;
  fills are conversions between the wallet's assets, never flows; fees
  reduce lamports.
- **Actual series, instance.** The lots attributed to the instance: a
  purchase is a contribution of its cost (flow), immediately converted into
  the tokens bought; a sale converts tokens into proceeds that leave as a
  withdrawal (flow). Execution cost therefore shows up as return relative
  to the reference price, and the instance never sees the wallet's cash.
- **Model series, version.** The published recipe held from its start: at
  the first point at or after the freeze where every leg is priced and
  every multiplier known, the model buys whole base units (rounded half to
  even) of each leg for its weight of an opening notional of 10,000 and
  holds the cash weight in the stablecoin. It never rebalances and carries
  no fees, slippage or taxes (`model_buy_and_hold`, `model_no_costs`). It
  is not anyone's account, and an account is never ranked as a model.
- **Chain.** With `V_k` the value at point *k* and `F_k` the net flow in
  its subperiod (valued at the flow's own time; each flow closes its own
  subperiod), the subperiod return is `r_k = (V_k − F_k) / V_{k−1} − 1` and
  the index chains `I_k = I_{k−1} × (1 + r_k)` from 100. A non-positive
  base (`zero_base`), an incomplete point or an unvalued flow breaks the
  chain; it is never bridged.

### Window metrics

For a period (`7d`, `30d`, `90d`, `365d`, `all`) the window starts at the
last point at or before `end − N days` (`insufficient_history` when there
is none) and ends at the last point.

- **Time-weighted return** = the chained index over the window − 1. Null,
  with the reason, whenever a point in the window is incomplete
  (`incomplete_points`, `unpriced_flow`, `zero_base`, and `stale_end` when
  the end point's price is stale).
- **Money-weighted return** = Modified Dietz:
  `(V_end − V_start − ΣF) / (V_start + Σ F_k × w_k)` with
  `w_k = (T_end − t_k) / (T_end − T_start)` in milliseconds; null when the
  denominator is not positive or an end value is unknown. It is reported
  separately and answers a different question (how the person's money
  fared, given when it moved).
- **Drawdown** = the largest peak-to-trough decline of the chained index
  inside the window, with the peak and trough times.
- **Turnover** = the traded value in the window (the stablecoin side of
  every fill at par, purchases at the window start included) over the
  average of the window's valuations; 0 for a model series.
- **Realized P&L** = proceeds minus the FIFO cost of the lots consumed in
  the window; **unrealized P&L** = the end value minus the remaining cost of
  the open lots (null while the end is incomplete). Both are null for a
  model series. **Fees** are the lamports of the window's `network_fee` and
  `rent` entries, valued at the end's SOL observation when one is fresh.
- **Completeness** reports the expected and complete points, the ratio,
  the first thirty incomplete points with their reasons, the history in
  whole days and whether the end point is fresh.

### Rankings

`GET /v1/rankings/model` ranks registered, unmoderated versions by the
time-weighted return of their **model** series over one period under one
methodology version. A version ranks only with at least
`rankingMinHistoryDays` (30, a product rule, not a statistical claim) of
complete history, a complete window and a fresh end price; anything else
is listed with `rank: null`, `timeWeightedReturn: null` and the reasons
(`insufficient_history`, `incomplete_window`, `stale_end`, `zero_base`,
`no_series`). An actual series is refused by kind (`not_model_series`), so
deposits, transaction counts and unverified claims cannot enter a
ranking. Ties break by lower drawdown, then version id.

### Worked fixtures (independently derived)

`packages/analytics/fixtures/performance-vectors.json` was derived by
`packages/analytics/fixtures/derive-vectors.py` (Python fractions, no
shared code) and is replayed exactly by
`packages/analytics/test/analytics.test.ts`.

| Scenario | Setup | Result |
| -------- | ----- | ------ |
| `deposit-not-profit` | 1,000 USDC on day 1, another 1,000 on day 2, at par | Value 1,000 → 2,000; `netFlows` 1,000; time-weighted **0**, Modified Dietz **0** (flow at mid-window, `w` = 0.5, denominator 1,500, numerator 0) |
| `price-return-with-deposit` | 10 FXA at 10 and 100 USDC; FXA 11 on day 2, 9.90 on day 3; 500 USDC deposited at noon on day 2 | Points 200, 210, 710 (flow point, `r` = 0), 699; index 100, 105, 105, 103.37323944; time-weighted **+3.37323943%**; Modified Dietz **−0.30769231%** (denominator 200 + 500 × 0.25 = 325, numerator −1); drawdown 1.549296% from day 2 to day 3; a 7-day window is `insufficient_history` |
| `model-split` | 50/40/10 recipe; XSB (8 decimals) splits 2:1 on day 2 (multiplier 1 → 2, price 50 → 25); FXA 20 → 22 → 21, XSB 26 on day 3 | Raw units 250,000,000 FXA, 8,000,000,000 XSB, 1,000,000,000 cash; values 10,000, 10,500, 10,410; time-weighted **4.1%**; drawdown 0.857143%; the split changed nothing |
| `model-missing-observation` | As above with no XSB observation on day 2 (its last is 36 h old) | Day 2 incomplete (`stale_price`), chain broken, **no return** although day 3 is valued at 10,410; completeness 2/3; unrankable |
| `model-stale-end` | FXA's last observation 30 h before the end | End point incomplete, reasons `incomplete_points`, `stale_end`; no return; unrankable |
| `zero-base` | 100 USDC, all withdrawn on day 2, 50 deposited on day 3 | `zero_base`: time-weighted null; Modified Dietz 0 |
| `instance-trade` | Buy 10 FXA for 100 USDC, sell 4 at 12 (proceeds 48, FIFO cost 40), hold 6 at 11; 5,000 lamports fee, SOL 150 | Points 100, 72 (flow −48), 66; time-weighted **10%** (12/10 × 11/12 − 1); Modified Dietz 18.421053%; drawdown 8.333333%; turnover 148 / 79.33 = 1.86554622; realized 8, unrealized 6; fees 0.00075 |
| `model-long-a`, `model-long-b` | Forty daily observations rising 0.10 and 0.05 a day | Rankable over 30 days at 27.272727% and 14.285714%; the short and incomplete scenarios above are listed unranked beside them, and an account series is refused as `not_model_series` |

### Limits

Series are computed on read from the journal and every observation of the
subject's assets; the observation history is bounded (20,000 rows) and
rankings read every registered version, so the routes are rate limited
and a persisted snapshot job is a later session's work. The only price
sources recorded today are the fixture feeds and operator entries; live
reference feeds and a SOL price source are open decision OD-23, and until
they exist a production series is incomplete rather than invented.

