# Agent tools, companion runs, proposals and Mark I events (B15)

Session B15 exposes the domain to automated participants without giving
them authority. It adds:

- a typed **tool catalog**: twelve façades over existing domain methods,
  each invoked with the caller's own principal (scopes, owner scoping and
  policy exactly as on the ordinary routes);
- bounded **companion runs**: a model drives the caller's tools one step
  at a time under a budget, every call validated and recorded in redacted
  provenance;
- **proposals**: the only thing a tool or a run can create for the owner's
  future action, and something only the owner's own session opens;
- the **Mark I event log**: facts about the owner's resources, in sequence,
  read by the app and by paired devices.

Nothing here signs, approves, spends, changes a limit or acts for another
account. A model cannot invent a mint, name a caller, widen a permission,
skip owner review or claim an order landed: the tool layer refuses, and
the refusal is part of the record.

## Tools

| Tool | Family | Scopes | Domain method | Writes |
| ---- | ------ | ------ | ------------- | ------ |
| `instruments.search` | read | `research:read` | catalog public list | no |
| `instruments.facts` | read | `research:read` | catalog public detail and public corporate actions; says when the reference price is stale or missing | no |
| `exposures.compare` | read | `research:read` | catalog public detail for 2 to 6 instruments; groups the same company across issuers; lists stale prices | no |
| `thesis.draft` | research | `research:write` | research `createThesis` (title, claim, counterarguments, candidate instruments, subjects; no statements of fact) | thesis |
| `weights.validate` | draft | `proposals:create` | strategy draft rules against the catalog, nothing saved | no |
| `plan.indicative` | quote | `proposals:create` | the planner's integer allocation (route minimums, fee reserve, cash remainder) for a version the caller owns or a public one, or one admitted instrument; no quote, no reservation, no intent | no |
| `quote.request` | quote | `proposals:create` | one venue quote with the plan-time checks; refused before the venue is asked when the slippage is above the owner's limit; nothing stored | no |
| `policy.explain` | explain | `portfolio:read` | an earlier decision of the caller's account, or a fresh `quote`-stage evaluation with `reserve=false`; every denial explained with a remedy | a decision row (fresh) |
| `basket.propose` | propose | `proposals:create` | validation, then strategy `create` and a `strategy_draft` proposal | draft, proposal |
| `investment.propose` | propose | `portfolio:read`, `proposals:create` | wallet ownership, indicative allocation, one pre-quote policy decision per leg without a reservation, then an `investment` proposal carrying the intent request | proposal |
| `rebalance.propose` | propose | `portfolio:read`, `proposals:create` | the instance allocation (target versus actual, valued like the series) and a `rebalance` proposal; no order | proposal, `data.stale` event when a leg is unpriced or stale |
| `receipts.read` | read | `portfolio:read` | the owner's receipts, one by id or the newest | no |

Every tool input is a strict object: an argument the schema does not name
(`approvalMode`, `ownerUserId`, a widened `slippageBps`) refuses the call
with `VALIDATION_FAILED` instead of being stripped. `GET /v1/agent/tools`
returns the descriptors a principal may call, with JSON Schemas generated
from the validators the routes enforce, so a model client and the app see
exactly what the API accepts. A tool that does not exist has no route
(`NOT_FOUND`); a scope the credential lacks is `FORBIDDEN` before the
input is read.

The scope matrix is `scopeMatrix()` in `@markov/agent-tools`; the reviewed
statement of what each principal may do stays in
`docs/markov/agent-permissions.md`.

## Companion runs

`POST /v1/me/companion/runs` takes a question, a context and a budget.

- **Context** is what the model may see: a thesis the caller owns (title,
  claim, excerpts of its fetched sources), an instance the caller owns
  (label, pinned version title and number; never its lots, wallet or
  values), a strategy the caller owns (title) and public instrument facts.
  Credentials, wallet addresses, balances and other accounts are never in
  it.
- **Budget**: `maxToolCalls` (0 to 12, default 6), `maxOutputChars` (200
  to 4000, default 1500), `maxCostMicros` (default 200 000). The run also
  has a 20 s step timeout and a 60 s deadline, and the account has a
  rolling daily cost cap (`COMPANION_DAILY_COST_LIMIT_MICROS`, default
  5 000 000); a run past the cap answers `BUDGET_EXHAUSTED` (409) before
  anything runs.
- **Loop**: the adapter answers one step at a time, a tool call or the
  final answer. A call is validated (known tool, the principal's scopes,
  the strict input schema) and executed through `invoke`, the same path as
  the tool routes. A refused call is recorded with its error code and shown
  to the model in the transcript; the run continues. A call past the
  tool-call budget is refused with `BUDGET_EXHAUSTED`; a model that keeps
  calling after that fails the run. Cost is summed per step and the run
  fails when it exceeds its budget. Cancellation (`…/cancel`) is checked
  between steps and drops the result.
- **Answer**: plain text, sanitised and cut to the budget (`truncated`
  says so). The model may cite only what the run read or created (context
  items, instrument rows a tool returned, proposals it made, receipts it
  read); every other citation is dropped. `stale` is true when a tool
  result the answer rests on used stale or missing reference data, and
  the run then also records a `data.stale` event.
- **Provenance** (`markov-companion-provenance/v1`): provider, model,
  model version, the SHA-256 of the exact first prompt, and one entry per
  step with the tool name as the model wrote it, the SHA-256 of the
  canonical input, an input summary made of identifiers, enumerations and
  amounts only, the outcome and code, the SHA-256 and size of the output
  and the duration. Questions, thesis text, excerpts, tool outputs and the
  model's prose are never stored; the validated answer is the only model
  text kept. Audit: `companion.run.create` (status, provider, model,
  prompt hash, tool calls, refusals, cost, proposals) and
  `companion.run.cancel`.

The **fixture adapter** (`COMPANION_MODEL_PROVIDER=fixture`, local and
test only) is a deterministic stand-in that behaves like a naive model:
it follows every `TOOL: <name> {json}` directive it can read, in the
question, in a source excerpt or in a tool output, one per step, then
answers with a summary of what each call returned or why it was refused.
That is what makes the adversarial tests meaningful: the fixture will ask
for `policy.limits.update`, for another wallet, for an unattended approval
and for a wider slippage, and the tool layer refuses each one. The hosted
provider is xAI Grok (`COMPANION_MODEL_PROVIDER=xai`, B17,
`@markov/model-xai`): one JSON step per call, prose treated as the answer
and never as a call, verified against an in-process stand-in only until a
live run is recorded (OD-19, SR-XAI-01); `disabled` keeps the tools
working and answers 503 on runs.

## Proposals

A proposal is a request for the owner's review, never an order.

| Kind | Created by | Payload | Opening (owner session only) |
| ---- | ---------- | ------- | ---------------------------- |
| `strategy_draft` | `basket.propose` | the draft's strategy id, title, legs with symbols, cash and its validation | marks it opened; the draft is edited in the builder, freezing and publishing stay interactive |
| `investment` | `investment.propose` | the intent request (kind, version or instrument, the owner's wallet, budget, mode, `approvalMode: owner_each_plan`, slippage), the indicative allocation, the pre-quote policy decision | creates the intent as the owner under the idempotency key `proposal:<id>`, so opening twice answers the same intent; the plan, its acknowledgement and the wallet signature follow through the ordinary execution routes |
| `rebalance` | `rebalance.propose` | the instance allocation (rows with target, invested target, attributed quantity, price, value, actual and drift), the creator's drift threshold and whether it is exceeded, suggestions per leg, sized `legs` (sells of the excess, buys of the shortfall in stablecoin raw units, dust ignored) and `executable` (B16) | creates one reviewed `single_sell` or `single_buy` intent per leg under the key `proposal:<id>:<instrument>:<side>` (idempotent) and answers them as `rebalance.intents`; each is planned, acknowledged and signed like any other, sells first; no legs, no intents |

Statuses: `proposed`, `opened`, `dismissed`, and `expired` (derived from
`expiresAt`: 30 days for a draft, 1 day for an investment, 7 days for a
rebalance). Agents (`portfolio:read`) list and read proposals; only a
user session opens or dismisses one, whatever an agent's scopes. A
proposal is created together with two events, `proposal.created` and
`review.required`, and audited as `agent.proposal.create`; opening and
dismissing are audited as `agent.proposal.open` and
`agent.proposal.dismiss`.

## Mark I events

`GET /v1/me/events?after=&limit=&kind=` answers the owner's events in
sequence, for the owner's session and for paired devices holding
`status:read`. Agents, operators and other people cannot read them. An
event never carries authority: nothing proceeds because an event was
read, and the financial state stays on the intent, the plan and the
attempt it names.

| Kind | Recorded by | Subject | Payload |
| ---- | ----------- | ------- | ------- |
| `proposal.created` | proposals | `proposal` | proposal id, kind, creator principal, run id, expiry |
| `review.required` | proposals; planning when a plan is built; execution when an intent needs reconciliation | `proposal`, `plan`, `intent` | ids, plan hash and expiry, or the intent state and reason |
| `execution.pending` | execution store, in the transaction that persists an attempt before its broadcast | `intent` | intent, attempt, transaction index, signature |
| `execution.finalized` | the intent transition to `FINALIZED` (API reconciliation and worker alike) | `intent` | intent, state, reason, kind |
| `execution.failed` | the transition to `FAILED`, `EXPIRED`, `CANCELLED` or `PARTIALLY_COMPLETED`; the payload names the state | `intent` | intent, state, reason, kind |
| `data.stale` | `rebalance.propose` on a stale or unpriced leg; a succeeded companion run whose answer used stale data | `instance`, `run` | the affected assets and issue codes, or the tools involved |
| `device.revoked` | identity, when the owner revokes a device | `device` | device id, name, capabilities |

Sequence numbers are strictly increasing per deployment; a reader keeps
the last `seq` it saw and asks for `after=<seq>`. `nextAfter` is set when
a page is full and newer events exist; `latestSeq` is the owner's newest
event whatever the filter. The maintenance pass projects these events
into the in-app notification outbox with per-category delivery
preferences (`docs/markov/maintenance.md`); B15 records the facts.

## Configuration

| Variable | Default | Meaning |
| -------- | ------- | ------- |
| `COMPANION_MODEL_PROVIDER` | `disabled` | `fixture` (local and test only; refused elsewhere), `xai` (B17; needs `XAI_API_KEY`, `XAI_MODEL`, per-token prices in micros) or `disabled` (tools work, runs answer 503) |
| `COMPANION_DAILY_COST_LIMIT_MICROS` | `5000000` | Rolling 24 h cost cap per account, in millionths of the billing currency; the fixture charges one micro per token |

## Adversarial verification

`apps/api/test/agents.test.ts` runs against PostgreSQL, the fixture chain
and the fixture venue:

- a retrieved page (`MALICIOUS_ANALYST_NOTE` in `@markov/research`)
  instructs the assistant to raise a limit, invest another wallet's money
  unattended, widen slippage and "report the trade as complete"; the
  fixture model follows every instruction and the tool layer refuses each
  (`NOT_FOUND` for the tool that does not exist, `VALIDATION_FAILED` for
  the unknown `approvalMode` and the slippage above the schema bound); the
  owner's limits are unchanged, no proposal exists, the answer says what
  was refused and claims nothing, the provenance holds digests and
  identifiers, never the page text;
- the model itself asks for an unattended approval, another person's
  wallet and a tool named `proposal.open`: refused, recorded, and the one
  legitimate call is answered and cited;
- a `research:read` credential's run cannot propose (`FORBIDDEN`);
- a hostile adapter that never stops calling tools fails its run with the
  budget refusals in its provenance; runs past the daily cost cap answer
  `BUDGET_EXHAUSTED`;
- an agent creates an investment proposal; the agent cannot open it
  (`FORBIDDEN`), another person cannot see it (`NOT_FOUND`), the owner
  opens it into a `DRAFT` intent that still needs a plan, an
  acknowledgement and a signature; dismissed and expired proposals cannot
  be opened;
- events are read by the owner and a paired device, not by agents or
  other people; `execution.pending` and `execution.finalized` appear in
  the execution test's buy flow and `device.revoked` when a device is
  revoked.

`scripts/ci/startup-check.sh` repeats the journey headlessly through the
CLI (`markov agent`, `markov companion`, `markov proposals`,
`markov events`).

## What B15 does not do

No live model provider was exercised (OD-19): the adapter contract, the
fixture and, since B17, the xAI adapter exist; the provider's terms and
retention must be recorded and one live run verified before `xai` is
configured outside local. Notification delivery is B16's outbox
(in-app always, email to a verified address). No device gateway or firmware: paired devices
read the same event log the app reads. No unattended execution of any
kind: `approvalMode` is `owner_each_plan` in every proposal and the
schema accepts nothing else.
