# Execution state machine (B10, B11)

Execution turns an acknowledged plan into exactly one owner-signed
transaction per batch, submitted by Markov and observed to finality. B10
delivered the single-leg lifecycle (a buy or a sell); B11 adds baskets: one
composed transaction when the whole basket fits and passes simulation at
plan time (`atomic`), otherwise one transaction per constituent, built one
after another with the intent returning to the owner between them
(`staged`), partial completion on evidence, and reviewed completion of what
was left unfilled. The rules below are the contract every implementation
and test in the repository follows.

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
6. **Atomic only with evidence; staged means one leg at a time.** A basket
   is one transaction only when the venue composed every leg into bytes
   that fit the packet and simulated successfully when the plan was built
   (the plan records the size, the reason and the simulation). Otherwise
   the legs land one by one: the next transaction is built only after the
   previous one finalized with its fills recorded, its leg is quoted again
   and refused when the fresh terms cannot meet the approved bounds, and a
   run that stops after a fill is `PARTIALLY_COMPLETED`: what landed stays,
   nothing is re-weighted, and no budget moves between constituents on its
   own. Completing the rest is a new, reviewed intent.

## Intent states

```
DRAFT → QUOTED → AWAITING_APPROVAL → AUTHORIZED → SUBMITTING → SUBMITTED → CONFIRMED → FINALIZED
                                        ▲  │           │            │            │
                                        │  │           ├─ FAILED    ├─ FAILED    ├─ AUTHORIZED (staged: next transaction)
                                        │  │           └─ UNKNOWN…  ├─ EXPIRED   └─ UNKNOWN_REQUIRES_RECONCILIATION
                                        │  └─ CANCEL_REQUESTED      └─ UNKNOWN_REQUIRES_RECONCILIATION
                                        └──────────────── a non-final transaction finalized ─────────────┘
                     after at least one fill, FAILED / EXPIRED / CANCELLED become PARTIALLY_COMPLETED
```

| State | Meaning | Leaves it |
| ----- | ------- | --------- |
| `AWAITING_APPROVAL` | The plan is acknowledged by hash; no transaction exists yet | build → `AUTHORIZED`; a new plan → `QUOTED`; cancel → `CANCELLED`; plan expiry at build → `EXPIRED` |
| `AUTHORIZED` | A validated, simulated transaction is stored and waits for the owner's signature; a rebuild (new blockhash) supersedes it. For a staged plan this is also the state between transactions: the previous one finalized, the next is not built yet | submit → `SUBMITTING`; cancel → `CANCELLED` (no fill yet) or `PARTIALLY_COMPLETED` (earlier legs filled); plan expiry → `EXPIRED` or `PARTIALLY_COMPLETED`; a later leg's fresh quote outside the approved bounds → `PARTIALLY_COMPLETED` |
| `SUBMITTING` | Attempt persisted; the broadcast has not been answered | node accepted → `SUBMITTED`; node refused before broadcast → `FAILED` (or `PARTIALLY_COMPLETED` after earlier fills); no answer → `UNKNOWN_REQUIRES_RECONCILIATION` |
| `SUBMITTED` | The node accepted the transaction | observed at confirmed depth → `CONFIRMED`; landed with an error → `FAILED`; blockhash expired unseen → `FAILED` (attempt `expired`); both `PARTIALLY_COMPLETED` after earlier fills |
| `CONFIRMED` | Observed at confirmed depth | finalized → `FINALIZED` with the fills when it was the plan's last transaction, else `AUTHORIZED` for the next one; a bound violation in a fill → `UNKNOWN_REQUIRES_RECONCILIATION` (frozen for review) |
| `FINALIZED` | Terminal; every fill is recorded from the transaction meta | — |
| `PARTIALLY_COMPLETED` | Terminal for this intent: at least one transaction filled and the run stopped (a later leg failed, expired unseen, went stale before it was built, or was cancelled). What landed stays; the remaining legs are completed only by a reviewed continuation intent or left | — (`continuedByIntentId` records the continuation) |
| `UNKNOWN_REQUIRES_RECONCILIATION` | The node could not be asked, gave no answer, or a fill violated a bound; frozen until evidence | observed → `CONFIRMED`/`FINALIZED`/`AUTHORIZED`; landed with an error → `FAILED`/`PARTIALLY_COMPLETED` |
| `CANCEL_REQUESTED` | Cancellation asked after a broadcast; the transaction can still land | expired unseen → `CANCELLED` (or `PARTIALLY_COMPLETED` after earlier fills); observed → `SUBMITTED`/`CONFIRMED`; unknown → `UNKNOWN…` |
| `FAILED`, `EXPIRED`, `CANCELLED` | Terminal; nothing of this intent filled | — |

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
hash and still valid builds the plan's **next** transaction: the first
batch whose legs have not all filled (an atomic plan has one batch carrying
every leg; a staged plan one per leg). Earlier batches are complete by
construction, because a later batch is never built before the previous one
finalized with its fills recorded; when every batch finalized the answer is
`PLAN_COMPLETED`.

1. For the second and later transactions of a staged plan, the leg is
   quoted again now and checked as at plan time (mints, input, output,
   slippage, quote age, price impact, the reviewed route) and against the
   approved bounds: the fresh input must not exceed `maxInputRaw`, the fresh
   minimum output must not fall below `minimumOutputRaw`. The fresh quote is
   recorded with its verdict. When it cannot meet the bounds the build is
   refused with `LEG_TERMS_CHANGED`, the intent becomes
   `PARTIALLY_COMPLETED` (`execution.partial`) and no budget moves between
   constituents. A first transaction is built from the acknowledged quote,
   as in B10.
2. A finalized blockhash from the node; the venue is given that blockhash,
   the leg's quote (the fresh one for a re-quoted leg), the owner as fee
   payer and sole signer, the token programs of each mint, a compute budget
   within the plan's priority cap and, per leg, whether the owner's output
   token account must be created (read from the node). One leg goes through
   the venue's `build`; several legs through its `compose`, which puts the
   account creations first and the swaps in leg order, all debiting the
   owner's one input account.
3. The venue's bytes are parsed (legacy or v0; lookup tables are read from
   the node and refused when missing or malformed) and every instruction is
   decoded: compute budget, system transfer, associated-token creation,
   token transfer/approve/revoke/set-authority/close, the fixture route
   swap; anything else is `unknown`.
4. `validateSwapTransaction` compares the decoded transaction with the
   batch's legs: exactly one swap per leg (`ROUTE_MISSING` for an unserved
   leg, `ROUTE_DUPLICATED` for a second swap of a served pair,
   `MINT_MISMATCH` for a pair the batch does not carry), each swap within
   its leg's bounds, account creations only for the owner's token accounts
   of the batch's legs, writable accounts limited to the owner and those
   token accounts, rent per account created. The other refusal codes are
   `UNSUPPORTED_VERSION`, `LOOKUP_TABLE_UNRESOLVED`, `SIGNER_MISMATCH`,
   `EXTRA_SIGNER`, `PROGRAM_NOT_ALLOWED`, `INSTRUCTION_NOT_ALLOWED`,
   `UNEXPECTED_TRANSFER`, `DELEGATE_APPROVAL`, `AUTHORITY_CHANGE`,
   `ACCOUNT_CLOSURE`, `ACCOUNT_CREATION_NOT_ALLOWED`,
   `UNEXPECTED_WRITABLE_ACCOUNT`, `ROUTE_ACCOUNTS_MISMATCH`,
   `INPUT_ABOVE_BOUND`, `OUTPUT_BELOW_BOUND`, `SLIPPAGE_ABOVE_LIMIT`,
   `COMPUTE_BUDGET_DUPLICATED`, `FEE_ABOVE_CAP`, `MESSAGE_TOO_LARGE`.
5. The whole transaction is simulated on the node (`sigVerify: false`, the
   real blockhash); a failing or unavailable simulation refuses.
6. The prepared transaction is stored with its batch and leg indexes, its
   decoded instructions, the validated effects (side, input mint, the total
   input and one entry per leg with its mints, exact input, minimum output
   and token accounts, accounts created, compute budget, fee and rent
   bounds) and the simulation evidence (status, units, SHA-256 of the
   logs); the intent moves to `AUTHORIZED` ("transaction k of N prepared").
   A rebuild supersedes an unsigned or expired transaction of the same
   batch only.

Refusals answer `TRANSACTION_REFUSED` (409) with `details[0]` naming the
refusal (`PLAN_NOT_APPROVED`, `VALIDATION_FAILED`, `SIMULATION_FAILED`,
`ATTEMPT_IN_FLIGHT`, `TRANSACTION_EXPIRED`, `LEG_TERMS_CHANGED`,
`BATCH_NOT_READY`, `PLAN_COMPLETED`) and, for validation, one detail per
failed check; `QUOTE_EXPIRED` when the plan's validity passed (the intent
then ends as `EXPIRED`, or `PARTIALLY_COMPLETED` after earlier fills),
`PLAN_CHANGED` when the intent moved on, `PROVIDER_UNAVAILABLE` when no
venue builds or composes or the node cannot be read. A refused build stores
nothing and is audited with its codes. `STAGED_NOT_SUPPORTED` is no longer
answered.

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
3. A later transaction of a staged plan is accepted only when every earlier
   batch finalized with its fills recorded (`BATCH_NOT_READY` otherwise;
   nothing is broadcast out of order). The plan must still be valid
   (`QUOTE_EXPIRED` otherwise; the intent ends as `EXPIRED`, or
   `PARTIALLY_COMPLETED` after earlier fills) and the blockhash must still
   be able to land (`TRANSACTION_EXPIRED` otherwise; the transaction expires
   and can be rebuilt).
4. Policy at stage `submit`, one decision and one reservation per leg of
   the transaction: each leg's instrument checks at its own notional, the
   plan's other legs declared as exposure, execution writes enabled, a
   verified venue, caps and limits (`POLICY_DENIED` otherwise; every
   reservation taken so far is released). Reservations are keyed
   `<intentId>:<transactionId>[:<legIndex>]`, so a rebuilt transaction or a
   later batch never collides with an earlier hold, and the attempt settles
   all of them together (consumed at finality, released on failure or
   expiry).
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
| Observed at finalized depth | the transaction is read (`getTransaction`), one fill per leg computed from the owner's token balances before and after and the fee payer's lamports; within bounds → `FINALIZED` when it was the plan's last transaction, else `AUTHORIZED` ("transaction k of N finalized; transaction k+1 awaits its build and the owner's signature"), reservations consumed; outside → intent `UNKNOWN_REQUIRES_RECONCILIATION` (frozen for review) |
| Unknown, finalized height past `lastValidBlockHeight` | `expired`: attempt `expired`, reservations released, intent `FAILED` (or `CANCELLED` when cancellation was requested), or `PARTIALLY_COMPLETED` when an earlier transaction of the same intent filled |
| Unknown, blockhash still valid, last sent ≥ 5 s ago | the same signed bytes are sent again (`resendCount` grows) |
| Unknown, blockhash still valid, sent recently | wait |

A landed error after earlier fills likewise ends as `PARTIALLY_COMPLETED`
(the attempt is `failed`, its reservations released). Fills are recorded
once per signature and leg. For a multi-leg transaction each leg's input is
the validated exact input of its swap, the outputs are read per mint, the
observed total input must equal the sum (otherwise the fill is uncertain
and the intent freezes), and the fee and lamports are attributed to the
first leg's fill only. A fill's `withinBounds` compares the observed input
spent and output received with the leg's validated bounds.

## Cancel

`POST /v1/me/intents/{intentId}/cancel`: in the planning states and
`AUTHORIZED` the intent is `CANCELLED` and unsigned prepared transactions
are withdrawn (`execution.cancelled`); when an earlier transaction of a
staged plan already filled, the intent is `PARTIALLY_COMPLETED` instead
(`execution.partial`): what landed stays, the prepared later transaction is
withdrawn and its batch reads `cancelled`. After a broadcast (`SUBMITTING`,
`SUBMITTED`, `UNKNOWN_REQUIRES_RECONCILIATION`) the request is recorded as
`CANCEL_REQUESTED`: the signed transaction can still land, and
reconciliation settles the intent as `CANCELLED` (or `PARTIALLY_COMPLETED`
after earlier fills) only when the blockhash expires unseen; a landed
transaction is honoured as `CONFIRMED`/`FINALIZED`/`AUTHORIZED`. Terminal
intents, `PARTIALLY_COMPLETED` included, refuse cancellation.

Cleanup ordering is fixed: the intent's guarded transition comes first (so
no concurrent build or submission can start), then the prepared rows are
withdrawn, then the outbox event is written. Reservations belong to
attempts and are settled by reconciliation, never by a cancel.

## Staged baskets and reviewed completion

`GET …/execution` answers `batches`, one entry per batch of the plan
derived from what is stored: `pending` (not built), `prepared`,
`submitting`, `submitted`, `confirmed`, `finalized` (its legs filled),
`failed`, `expired`, `cancelled`, `unknown` (no answer yet) or `stale` (the
run ended before this batch was built: a later leg's fresh terms, a failure
or an expiry after earlier fills), with the transaction, attempt, signature
and reason when there is one. `nextAction` is `build` between transactions,
`sign` while one waits for its signature, `wait` while one is live and
`review` for a `PARTIALLY_COMPLETED` basket.

Shared route state: every swap of a composed transaction debits the owner's
one stablecoin account, so the validator accepts the same source account
across legs, the fill reader attributes the exact validated input per leg
and requires the observed total to match, and the fixture chain executes
the swaps in order on one ledger. A staged run shares nothing across
transactions except the plan: each batch carries its own blockhash,
signature, attempt and reservations.

A reviewed completion is a new `basket_investment` intent with
`continuationOfIntentId` naming the partially completed one: the same
wallet and pinned version, and a budget equal to the sum of the unfilled
legs' original targets (`VALIDATION_FAILED` names the field otherwise; an
intent continued once cannot be continued again). Its plan carries exactly
those legs at their original targets, with no re-weighting, no cash
remainder and no second protocol-fee reserve, quoted and policy-checked
afresh, and executes as any plan (one leg is atomic by construction; several
compose or stage as above). The original intent stays `PARTIALLY_COMPLETED`
as the record of what happened and points at the continuation
(`continuedByIntentId`); the continuation records `continuation.ofIntentId`,
`ofPlanId` and the leg indexes it completes.

## Outbox

`outbox_events` rows record each state change (`execution.pending`,
`execution.submitted`, `execution.confirmed`, `execution.finalized` with
`batch`, `batchCount` and `complete`, `execution.failed`,
`execution.expired`, `execution.unknown`, `execution.cancelled`,
`execution.partial` when a staged basket stopped after a fill) with
`publishedAt` null. Only `execution.pending` is written in the same database
transaction as the state it announces (the submission, `beginSubmission`);
the others are written right after their state change, so a crash between
the two can lose an announcement while the state itself stays derivable
from chain evidence. No process publishes these rows: the notifications of
B16 are projected from the Mark I event log (`mark_events`), not from this
outbox. Nothing is sent anywhere from it.

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

`apps/api/test/basket-execution.test.ts` (B11): a two-constituent basket
composed, measured and simulated at plan time and executed as one
transaction (both account creations first, both swaps debiting the one
stablecoin account, one signature, one reservation per leg, a fill per leg
with the fee on the first, every batch `finalized`); a staged basket
(fixture venue limited to one leg per transaction) landing leg by leg with
the intent returning to `AUTHORIZED` between them, the second transaction
refused before the first exists and while it is in flight, then a fresh
quote 2 % worse than approved refusing the second leg (`LEG_TERMS_CHANGED`,
`PARTIALLY_COMPLETED`, batch `stale`, nothing built or spent) and a reviewed
completion refused with the wrong budget, version or kind, accepted for
exactly the unfilled leg at its original target and executed to finality
while the original stays partially completed and cannot be continued twice;
a cancel between legs (`PARTIALLY_COMPLETED`, the prepared second
transaction `cancelled`, a late submission refused) and a second leg landing
with an error (`PARTIALLY_COMPLETED`, batch `failed`, its reservation
released, the first fill standing); and a composed basket that fails
simulation at plan time staying `staged` with
`composition_simulation_failed`. `packages/execution/test` covers the
multi-leg validator (a second swap of a served pair, an unserved leg, a
pair the batch does not carry), per-leg fills with the total check, and
the staged transitions; `packages/planning/test` the atomic, too-large,
simulation-failed and unavailable groupings; `packages/venue-jupiter/test`
the composition layout and the leg limit. The startup check runs the
atomic basket journey through the CLI.

## Live-route limitations

Every run above is against the fixture chain and the fixture route program
(`FIXTURE_VERIFIED`). No live venue builds transactions (OD-21), the route
matrix reviews no live program, and no transaction has been sent to any
Solana cluster. A configured gateway (`EXECUTION_VENUE_BUILD_URL`) can
build one leg; its bytes go through the same decoding, validation and
simulation, but a live route needs its programs reviewed into the matrix
first. No gateway composes several legs yet (`compose` is null for the
configured-URL venue), so a live basket would be staged with
`composition_unavailable` until a compose contract is verified. Priority
fees follow the plan's cap and no fee market estimate; versioned messages
with lookup tables are decoded and validated but no live route has exercised
them. The fixture venue's composition limit
(`EXECUTION_VENUE_FIXTURE_COMPOSE_MAX_LEGS`) exists for tests and the web
journeys only and is refused with any other provider.
