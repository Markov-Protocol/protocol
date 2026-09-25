# Accounting methodology

Status: the units section is implemented in B04 (`@markov/amounts`,
catalog quantities); the journal, lots and attribution, chain
reconciliation and receipts are implemented in B12 (`@markov/accounting`,
`packages/db/src/accounting-store.ts`, `apps/api/src/accounting`).
Valuation, performance and ranking rules arrive with B13 and will extend
this document.

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
