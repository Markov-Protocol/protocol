# Execution state machine (B10)

Execution turns an acknowledged plan into exactly one owner-signed
transaction per batch, submitted by Markov and observed to finality. This
session delivers the single-leg lifecycle (a buy or a sell); staged basket
execution is B11 and is refused here (`STAGED_NOT_SUPPORTED`). The rules
below are the contract every implementation and test in the repository
follows.

## Principles

1. **What was reviewed is what is signed.** A transaction is built only for
   the plan the owner acknowledged by hash, from the exact quote of the
   plan's leg, and every instruction is decoded and compared with the plan
   before it is stored or shown. The owner signs the stored message; the
   submission is accepted only when the signed bytes carry that message.
2. **Fail closed.** An instruction the decoder cannot name, a program the
   matrix has not reviewed for the plan's mode, an account that could be
   written for no reason the plan explains, a fee above the plan's cap, an
   input above or a minimum output below the approved bounds, a second
   signer, a transfer, an approval, an authority change or a closure each
   refuse the whole transaction.
3. **Persist before broadcast.** The attempt (its signature, the signed
   bytes, the policy reservation) and its outbox event are written in one
   database transaction before the node is called. A crash between the
   write and the answer leaves an attempt reconciliation finishes.
4. **A signature is not settlement; a timeout is not failure.** States
   advance only on chain evidence: signature status, finalized block height
   against the blockhash's validity, the landed transaction's balance
   changes. No answer means `unknown`, never `FAILED`.
5. **One live attempt, the same bytes.** At most one attempt per intent is
   live (a partial unique index enforces it). Resubmitting the same signed
   bytes answers the same attempt; while the blockhash is valid and the
   signature unobserved, reconciliation resends the same bytes. Nothing is
   ever rebuilt or re-signed on the owner's behalf, so no retry can create a
   second economic purchase.

## Intent states

```
DRAFT → QUOTED → AWAITING_APPROVAL → AUTHORIZED → SUBMITTING → SUBMITTED → CONFIRMED → FINALIZED
                                        │              │            │            │
                                        │              ├─ FAILED    ├─ FAILED    └─ UNKNOWN_REQUIRES_RECONCILIATION
                                        │              └─ UNKNOWN…  ├─ EXPIRED
                                        └─ CANCEL_REQUESTED         └─ UNKNOWN_REQUIRES_RECONCILIATION
```

| State | Meaning | Leaves it |
| ----- | ------- | --------- |
| `AWAITING_APPROVAL` | The plan is acknowledged by hash; no transaction exists yet | build → `AUTHORIZED`; a new plan → `QUOTED`; cancel → `CANCELLED` |
| `AUTHORIZED` | A validated, simulated transaction is stored and waits for the owner's signature; a rebuild (new blockhash) supersedes it | submit → `SUBMITTING`; cancel → `CANCELLED`; plan expiry at submission → `EXPIRED` |
| `SUBMITTING` | Attempt persisted; the broadcast has not been answered | node accepted → `SUBMITTED`; node refused before broadcast → `FAILED`; no answer → `UNKNOWN_REQUIRES_RECONCILIATION` |
| `SUBMITTED` | The node accepted the transaction | observed at confirmed depth → `CONFIRMED`; landed with an error → `FAILED`; blockhash expired unseen → `FAILED` (attempt `expired`) |
| `CONFIRMED` | Observed at confirmed depth | finalized → `FINALIZED` with the fill; a bound violation in the fill → `UNKNOWN_REQUIRES_RECONCILIATION` (frozen for review) |
| `FINALIZED` | Terminal; the fill is recorded from the transaction meta | — |
| `UNKNOWN_REQUIRES_RECONCILIATION` | The node could not be asked, gave no answer, or the fill violated a bound; frozen until evidence | observed → `CONFIRMED`/`FINALIZED`; landed with an error → `FAILED` |
| `CANCEL_REQUESTED` | Cancellation asked after a broadcast; the transaction can still land | expired unseen → `CANCELLED`; observed → `SUBMITTED`/`CONFIRMED`; unknown → `UNKNOWN…` |
| `FAILED`, `EXPIRED`, `CANCELLED` | Terminal | — |

The full transition table is `INTENT_TRANSITIONS` in
`packages/planning/src/states.ts`; every transition in the database is
guarded by the source states, so a late worker or a second request never
moves an intent backwards.

## Attempt states

`prepared` (built, validated, simulated; awaiting the signature) →
`submitting` (signature verified, persisted, not yet answered) →
`submitted` → `confirmed` → `finalized`; terminal alternatives `failed`
(landed with an error, or refused by the node before broadcast; `reason`
says which), `expired` (blockhash expired without a trace), `superseded`
(replaced by a later build before any signature), `cancelled`. `unknown`
means the broadcast may or may not have happened.

## Build

`POST /v1/me/intents/{intentId}/transactions` for an intent in
`AWAITING_APPROVAL` or `AUTHORIZED` whose current plan is acknowledged by
hash and still valid:

1. A finalized blockhash from the node; the venue is given that blockhash,
   the plan's quote, the owner as fee payer and sole signer, the token
   programs of both mints, a compute budget within the plan's priority cap
   and whether the owner's output token account must be created (read from
   the node).
2. The venue's bytes are parsed (legacy or v0; lookup tables are read from
   the node and refused when missing or malformed) and every instruction is
   decoded: compute budget, system transfer, associated-token creation,
   token transfer/approve/revoke/set-authority/close, the fixture route
   swap; anything else is `unknown`.
3. `validateSwapTransaction` compares the decoded transaction with the
   plan's leg. Refusal codes: `UNSUPPORTED_VERSION`, `LOOKUP_TABLE_UNRESOLVED`,
   `SIGNER_MISMATCH`, `EXTRA_SIGNER`, `PROGRAM_NOT_ALLOWED`,
   `INSTRUCTION_NOT_ALLOWED`, `UNEXPECTED_TRANSFER`, `DELEGATE_APPROVAL`,
   `AUTHORITY_CHANGE`, `ACCOUNT_CLOSURE`, `ACCOUNT_CREATION_NOT_ALLOWED`,
   `UNEXPECTED_WRITABLE_ACCOUNT`, `ROUTE_MISSING`, `ROUTE_DUPLICATED`,
   `ROUTE_ACCOUNTS_MISMATCH`, `MINT_MISMATCH`, `INPUT_ABOVE_BOUND`,
   `OUTPUT_BELOW_BOUND`, `SLIPPAGE_ABOVE_LIMIT`, `COMPUTE_BUDGET_DUPLICATED`,
   `FEE_ABOVE_CAP`, `MESSAGE_TOO_LARGE`. Writable accounts are limited to
   the owner and the owner's associated token accounts for the two mints.
4. The whole transaction is simulated on the node (`sigVerify: false`, the
   real blockhash); a failing or unavailable simulation refuses.
5. The prepared transaction is stored with its decoded instructions, the
   validated effects (side, mints, exact input, minimum output, accounts
   created, compute budget, fee and rent bounds) and the simulation evidence
   (status, units, SHA-256 of the logs); the intent moves to `AUTHORIZED`.

Refusals answer `TRANSACTION_REFUSED` (409) with `details[0]` naming the
refusal (`PLAN_NOT_APPROVED`, `VALIDATION_FAILED`, `SIMULATION_FAILED`,
`STAGED_NOT_SUPPORTED`, `ATTEMPT_IN_FLIGHT`, `TRANSACTION_EXPIRED`) and,
for validation, one detail per failed check; `QUOTE_EXPIRED` when the plan's
validity passed, `PLAN_CHANGED` when the intent moved on,
`PROVIDER_UNAVAILABLE` when no venue builds or the node cannot be read. A
refused build stores nothing and is audited with its codes.

## Submission

`POST /v1/me/intents/{intentId}/transactions/{index}/submissions` with the
signed bytes:

1. `checkSignedSubmission`: the bytes parse, the message is byte-identical
   to the prepared one, exactly one signature slot, filled, the fee payer is
   the expected signer and the Ed25519 signature verifies over the message.
   Otherwise `SIGNATURE_MISMATCH` and nothing else runs.
2. Idempotency: the same signature with a live or settled attempt answers
   that attempt's status (200); another live attempt is
   `ATTEMPT_IN_FLIGHT`.
3. The plan must still be valid (`QUOTE_EXPIRED` otherwise; the intent
   expires) and the blockhash must still be able to land
   (`TRANSACTION_EXPIRED` otherwise; the transaction expires and can be
   rebuilt).
4. Policy at stage `submit` with a reservation: execution writes enabled, a
   verified venue, declared exposure, caps and limits (`POLICY_DENIED`
   otherwise; no reservation is left behind).
5. `beginSubmission`: one database transaction inserts the attempt with the
   signature and the signed bytes, moves the intent to `SUBMITTING`, marks
   the prepared transaction and writes `execution.pending` to the outbox.
6. The one broadcast (`sendTransaction`, base64, preflight on). Accepted →
   `SUBMITTED` with `execution.submitted`. A preflight or signature verdict
   from the node (`-32002`, `-32003`) → attempt `failed`, reservation
   released, intent `FAILED`, `execution.failed`. Anything else (timeout,
   transport, node declining) → attempt `unknown`, intent
   `UNKNOWN_REQUIRES_RECONCILIATION`, `execution.unknown`.

## Reconciliation

`reconcileAttempt` (`@markov/execution`) runs the same logic in the API
(read-time on status, at most every 2 s per attempt; on demand through
`POST …/execution/reconciliations`) and in the worker (the durable
`executionReconciliationWorkflow`, one round every 5 s over every live
attempt). One round: `getSignatureStatuses` with history search, then, when
the signature is unknown, `getBlockHeight('finalized')`:

| Evidence | Decision |
| -------- | -------- |
| Node could not be asked | `unknown` (frozen until it answers) |
| Observed with an error at processed depth only | wait |
| Observed with an error at confirmed or finalized depth | `failed`: attempt `failed` with the chain error, reservation released, intent `FAILED` |
| Observed at processed depth | attempt `submitted`; the intent stays where it is |
| Observed at confirmed depth | attempt and intent `CONFIRMED` |
| Observed at finalized depth | the transaction is read (`getTransaction`), the fill computed from the owner's token balances before and after and the fee payer's lamports; within bounds → `FINALIZED`, reservation consumed; outside → intent `UNKNOWN_REQUIRES_RECONCILIATION` (frozen for review) |
| Unknown, finalized height past `lastValidBlockHeight` | `expired`: attempt `expired`, reservation released, intent `FAILED` (or `CANCELLED` when cancellation was requested) |
| Unknown, blockhash still valid, last sent ≥ 5 s ago | the same signed bytes are sent again (`resendCount` grows) |
| Unknown, blockhash still valid, sent recently | wait |

Fills are recorded once per signature and leg. A fill's `withinBounds`
compares the observed input spent and output received with the validated
effects' bounds.

## Cancel

`POST /v1/me/intents/{intentId}/cancel`: in the planning states and
`AUTHORIZED` the intent is `CANCELLED` and unsigned prepared transactions
are withdrawn (`execution.cancelled`). After a broadcast (`SUBMITTING`,
`SUBMITTED`, `UNKNOWN_REQUIRES_RECONCILIATION`) the request is recorded as
`CANCEL_REQUESTED`: the signed transaction can still land, and
reconciliation settles the intent as `CANCELLED` only when the blockhash
expires unseen; a landed transaction is honoured as `CONFIRMED`/`FINALIZED`.
Terminal intents refuse cancellation.

## Outbox

`outbox_events` rows are written in the same database transaction as the
state they announce (`execution.pending`, `execution.submitted`,
`execution.confirmed`, `execution.finalized`, `execution.failed`,
`execution.expired`, `execution.unknown`, `execution.cancelled`) with
`publishedAt` null; B18's notifications consume them. Nothing is sent
anywhere in B10.

## Evidence

`apps/api/test/execution.test.ts` against the fixture chain: buy and sell
to finality with fills read from the landed transactions; eight malicious
venue outputs (a lamport transfer to an attacker, an input above the bound,
a minimum output below the bound, the output paid to an attacker's account,
an unreviewed program, a second signer, a token approval, no swap) and a
foreign blockhash refused before anything is stored; garbage, a stranger's
key and a signed but altered message refused as `SIGNATURE_MISMATCH`; a lost
answer after the broadcast recovered by reconciliation without a second
send; a dropped transaction resent as the same bytes; expiry unseen settled
as `FAILED` with the reservation released; landed with an error settled as
`FAILED`; cancel before signature and after broadcast; a blockhash and a plan
expiring before the signature; policy denial without execution writes.
`scripts/ci/startup-check.sh` runs the buy, the changed signature, the
retry, the sell with a lost answer and the round trip through the CLI.

## Live-route limitations

Every run above is against the fixture chain and the fixture route program
(`FIXTURE_VERIFIED`). No live venue builds transactions (OD-21), the route
matrix reviews no live program, and no transaction has been sent to any
Solana cluster. A configured gateway (`EXECUTION_VENUE_BUILD_URL`) can
build; its bytes go through the same decoding, validation and simulation,
but a live route needs its programs reviewed into the matrix first. Priority
fees follow the plan's cap and no fee market estimate; versioned messages
with lookup tables are decoded and validated but no live route has exercised
them.
