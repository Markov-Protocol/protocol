# Execution planning (B09)

An **intent** is the owner's request to invest a stablecoin budget from one
verified wallet into a pinned strategy version (`basket_investment`) or one
admitted instrument (`single_buy`). A **plan** is the immutable, hashed
answer: an integer allocation that conserves the budget exactly, one checked
venue quote and one policy decision per constituent, a separate SOL fee
budget with an explicit upper bound, the transaction grouping, the
executable bounds and the evidence the plan rests on, with an expiry.
Building a plan reserves nothing and moves nothing. The owner acknowledges
a plan by its hash; the wallet signature, submission and recovery arrive
with B10, whole-basket composition and simulation with B11.

Contracts: `packages/contracts/src/planning.ts`. Pure rules:
`packages/planning`. Venue adapters: `packages/venue-jupiter`. Service and
routes: `apps/api/src/planning`, `apps/api/src/routes/planning.ts`.
Persistence: migration `0010_planning` (`intents`, `execution_plans`,
`venue_quotes`).

## Intents

- Created with `POST /v1/me/intents` by the signed-in person (agents read,
  never create). The request names the wallet (one of the caller's verified
  wallets), the budget in raw base units of the platform stablecoin
  (`FUNDING_STABLECOIN_MINT`; USDC on mainnet-beta), the budget mode, the
  execution preference (`atomic_or_explicit_staged_review`), the approval
  mode (`owner_each_plan`), an optional slippage in basis points (never
  above the owner's effective limit; the platform default is 50 bps) and an
  idempotency key.
- Idempotency: the key is scoped to the owner. The same key with the same
  canonical request answers the existing intent (200); the same key with
  another request is `IDEMPOTENCY_CONFLICT`. Uniqueness is a database
  constraint, not a lock.
- A basket investment may name a version the person owns or a public
  (registered, unmoderated) version; anything else is `NOT_FOUND`. A single
  buy needs an admitted instrument (`ASSET_NOT_ADMITTED` otherwise).
- States (`INTENT_STATES`): `DRAFT` → `QUOTED` (a plan exists) →
  `AWAITING_APPROVAL` (the owner acknowledged the current plan) → `AUTHORIZED`
  … `FINALIZED` (B10/B11), with `EXPIRED`, `REJECTED`, `CANCELLED`, `FAILED`
  and `UNKNOWN_REQUIRES_RECONCILIATION`. Valid transitions are the table in
  `packages/planning/src/states.ts`; every change is a guarded
  `UPDATE … WHERE state IN (…)`, so two requests cannot both win. An intent
  expires 24 hours after creation whatever its plans say. Cancellation is
  possible before any signature and is idempotent.

## Allocation

`allocateBudget` (`packages/planning/src/allocate.ts`) works in integer
base units only:

- Budget modes: `all_in_stablecoin` (the budget is the most that leaves the
  wallet; stablecoin-denominated fees are set aside first) or
  `investable_notional` (fees come on top). Under the beta fee policy the
  fee reserve is zero, so both modes spend the budget.
- Largest-remainder rounding: every constituent and the cash sleeve get
  `floor(investable × weight / 10,000)`; the units the floors leave over go
  one each to the entries with the largest fractional remainders, ties by
  position. The targets plus cash equal the investable amount exactly
  (`allocation.conserved`), which the property tests assert over random
  budgets and weights.
- Route minimums are refused, never reshaped: when a constituent's target is
  below the venue's documented minimum the plan is refused
  (`VALIDATION_FAILED`) with the smallest workable budget and the shortfall
  per constituent; the recipe's weights are never changed.
- Cash is an explicit entry. Input the quotes do not consume (the quote's
  exact input below the target) is reported as `dustRaw` and stays in the
  wallet; `bounds.residualCashRaw` is the cash target plus dust.

## Fee policy

`packages/planning/src/fees.ts`, versioned as `beta-0`: no Markov execution
fee (`feeBps` 0). Network fees are paid in SOL by the owner's wallet, never
in stablecoin, so a plan carries a separate SOL budget:
`baseFeeLamportsPerSignature` (5,000, SR-SOL-FEE-01) × signatures × batches,
a priority-fee cap of 100,000 lamports per batch (the build step may use
less, never more), and rent for one new token account per constituent at the
network's observed rent-exempt minimum (worst case). `totalLamportsMax` is
the bound; `bounds.maxTotalLamports` repeats it. Sponsorship, if ever
added, needs its own cap and authorization.

## Venue quotes

Quotes are taken through Markov's own contract (`venueQuoteRequestSchema` →
`venueQuoteSchema`, version 1): exact-in swaps from the stablecoin into the
constituent mint at the intent's slippage, answered with the exact input,
the expected output, the minimum output the route commits to, the price
impact, the route programs, observation and expiry instants and a source
reference (never a credential).

Two adapters exist (`packages/venue-jupiter`):

- `fixture` (local and test only; configuration refuses it elsewhere):
  deterministic synthetic prices for the fixture mints, a 30 bps spread,
  input-proportional price impact, one route step through a synthetic
  program id that exists on no network, a 30 second validity. Plans built
  from it are labelled `mode: fixture`, carry a warning and can never be
  executed.
- `configured_url`: `EXECUTION_VENUE_QUOTE_URL` names an operator-run
  gateway that already serves the contract (https outside local/test, no
  embedded credentials, optional bearer key `EXECUTION_VENUE_API_KEY`, no
  redirects, 5 s, 256 KiB). The gateway's answer is validated against the
  contract and its `mode` must say `configured_url`; the source reference
  is replaced by ours.

The live Jupiter quote API is unverified from the build environment (every
Jupiter host is unreachable; OD-21, SR-JUP-01). Nothing in this repository
is a claim about that API; mapping its real response onto the contract is
the gateway's job once the documentation has been read.

Every quote is untrusted data. `checkQuote` refuses a quote whose input or
output mint differs from the request, whose input exceeds the allocation
target or is zero, whose output is zero, whose minimum output is
inconsistent with the stated output and slippage, whose slippage is not
the requested one or is above the owner's limit, that is older than the
owner's quote-age limit or already expired, whose price impact is above
300 bps, whose route steps do not sum to 100 %, or that routes through a
program that is not in the reviewed matrix. A refused quote is stored with
its issues (`venue_quotes.accepted = false`) and the plan is not built.

## Route and program matrix

`packages/planning/src/programs.ts` is the reviewed route/program
compatibility matrix. A program may be `fixture_only`, `reviewed` or
`quarantined`; a live plan needs every route program `reviewed`. Only the
synthetic fixture program is listed, as `fixture_only`: no live program has
been reviewed, so a live quote fails closed until a reviewed entry with its
evidence exists. Instruction decoding, lookup-table resolution and the
account-level checks of the build document arrive with the transaction
builder (B10); a program allowlist alone is not validation of what a route
does.

## Policy per constituent

For every constituent the API evaluates policy (B05) at stage `quote` with
the quote's exact input as the notional, the quote's observation instant,
and the exposure declared as: the other constituents' targets as
`caller_declared` positions plus the cash the wallet keeps after the whole
plan. Concentration by issuer and by underlying company across issuers,
the order, daily and account caps, eligibility, terms, data quality (a
stale reference mark denies) and venue allowances apply exactly as they do
to any evaluation. A denial refuses the plan (`POLICY_DENIED`) with the
machine-readable denials; nothing is reserved at this stage (`reserve:
false`), so a plan never holds budget against the person's caps.

## The plan document

`executionPlanSchema`: identity (`planId`, `intentId`, `kind`, `mode`,
`network`, `wallet`, `strategy` with the version's manifest hash), `input`
(budget, mode, investable and total spend), `allocation`, `legs` (per
constituent: instrument identity, mint and token program, target, the
quote's exact input as `maxInputRaw`, expected and minimum outputs,
slippage, price impact, the quote itself, the policy decision reference and
its expiry, the batch), `fees`, `grouping`, `bounds`, `validity`, `funds`,
`warnings`, `review`, `status`.

The plan hash is `sha256(domain ‖ 0x00 ‖ canonical JSON)` with domain
`markov-execution-plan/v1/<genesisHash>` over the **binding** fields:
schema, intent, kind, mode, network, wallet address, version id and
manifest hash, input, allocation, every leg's economic fields (mints,
target, max input, expected and minimum output, slippage, quote reference
and route, policy decision id, batch), fees, grouping batches, bounds and
the expiry instants. Labels, warnings, the review state and status are not
bound. Canonical JSON sorts keys recursively and encodes every amount as a
decimal string. `verifyPlanHash` recomputes it; `markov intents verify-plan`
does so offline.

## Grouping: atomic or staged

A single constituent is one transaction (`atomic`): it lands entirely or
not at all. Two or more constituents are `staged` until whole-basket
composition and simulation exist (B11): one batch per constituent in weight
order, each with its worst-case cumulative spend and the cash remaining
after it, and `acknowledgementRequired: true`. The acknowledgement must
carry `stagedAcknowledged: true`; the plan's warning says that later
batches can fail or expire after earlier ones filled and that no budget is
ever moved between constituents on its own. A batch-signing wallet feature
does not make separate transactions atomic.

## Validity, funds and evidence

- `validity.expiresAt` is the earliest of every quote's expiry and every
  policy decision's expiry; nothing may be signed against an expired plan.
  `simulation` is `null` until B10/B11: no simulation has happened.
- `funds` is what the network reported when the plan was built (slot,
  stablecoin, lamports) and whether it covers the spend and the SOL bound;
  the API refuses to build at all (`INSUFFICIENT_FUNDS`, naming both
  assets) when it does not, before any venue call.
- `evidence` lists the eligibility decision, policy version, every policy
  decision id, every quote reference and the instruments' catalog update
  instants.

## Acknowledgement

`POST /v1/me/intents/{intentId}/plans/{planId}/acknowledgements` binds the
owner's review to the plan hash: `PLAN_CHANGED` when the hash differs or a
newer plan supersedes this one, `QUOTE_EXPIRED` when the validity has
passed, `VALIDATION_FAILED` for a staged plan without the staged
acknowledgement. The intent moves to `AWAITING_APPROVAL`; acknowledging
the same plan again is idempotent. Building a new plan supersedes the
acknowledged one and returns the intent to `QUOTED`. Audit actions:
`planning.intent.created`, `planning.plan.built`, `planning.plan.refused`,
`planning.plan.acknowledged`, `planning.intent.cancelled`.

## What is not built

No transaction is built, signed, simulated or submitted; no budget is
reserved; nothing rebalances or sells. The `AUTHORIZED` to `FINALIZED`
states, per-batch states, message and instruction validation, submission
identity and recovery are B10 and B11. Plans from the fixture venue are
never executable.
