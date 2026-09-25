# Maintenance: schedules, rebalance proposals and notifications (B16)

Maintenance prepares work for the owner on a schedule. A recurring
investment schedule turns each occurrence into an investment proposal; a
drift schedule checks an instance's allocation and, when it drifted past
the threshold, into a rebalance proposal whose legs open into ordinary
reviewed intents. Every proposal still needs the owner's session to open
it, a plan, an acknowledgement and a wallet signature. The mode of every
schedule is the literal `prepare_for_approval`; the API accepts nothing
else, and a recurring proposal is not automatic investing.

Implementation: `packages/maintenance` (pure cadence, occurrence, drift
and mandate rules), `packages/notifications` (pure routing, rendering and
the email adapters), `packages/db/src/maintenance-store.ts` and
`notifications-store.ts`, `apps/api/src/maintenance/service.ts`,
`apps/api/src/notifications/service.ts`, the routes in
`apps/api/src/routes/maintenance.ts` and `notifications.ts`, and the
worker loop in `apps/worker/src/workflows/index.ts`
(`maintenanceWorkflow`) with its activity `runMaintenanceTick`.

## Schedules

| Field | Meaning |
| ----- | ------- |
| `kind` | `recurring_investment` (a version or a single instrument, a wallet, a budget) or `drift_rebalance` (an instance, an optional threshold override, a minimum interval) |
| `mode` | always `prepare_for_approval`: an occurrence creates a proposal and a notification, never a transaction |
| `cadence` | `unit` day, week or month; `interval` 1..12; `timeOfDay` HH:MM; `weekday` (weekly) or `dayOfMonth` (monthly, clamped to the month's last day); an IANA `timeZone` |
| `startAt`, `endAt` | the first occurrence is the first cadence point at or after `startAt` (creation time when unset); nothing is due after `endAt` |
| `reviewWindowHours` | 1..168 (default 24): how long an occurrence's proposal stays open; the occurrence is `missed_window` once the window closed before it was seen |
| `missedRunPolicy` | `skip` (default): every occurrence whose window closed is recorded as skipped and never proposed; `catch_up_latest`: the latest missed occurrence is proposed once, the earlier ones are recorded as `superseded_by_catch_up`. Several missed budgets are never accumulated |
| `status` | `active`, `paused` (keeps its place; `nextDueAt` is null), `cancelled` (final, by the owner), `revoked` (final, by the platform when the target disappeared) |

Occurrences are unique per `(schedule, sequence)` and carry a dedup key
`schedule:<id>:<sequence>` that the proposal stores in a unique column.
Each occurrence records `dueAt`, `windowEndsAt`, its status (`proposed`,
`skipped`, `failed`, `expired`; `opened` and `dismissed` are derived from
the proposal), a reason and the proposal it produced.

Wall-clock times are kept across daylight-saving changes: 09:00 in
`America/New_York` is 14:00 UTC in winter and 13:00 UTC in summer; a time
that does not exist on the change day (02:30 on the spring-forward day)
moves forward by the gap, and an ambiguous time takes the earlier
instant. `POST /v1/me/schedules/preview` shows the next occurrences with
their local wall clock and UTC offset before a schedule is created;
unknown time zones are refused.

## What a pass does

A pass (`POST /v1/ops/maintenance/run`) is asked for by a worker
credential (`maintenance:run`) or an operator (`ops:maintenance:run`);
users and agents are refused. It is idempotent per occurrence and safe to
repeat after a crash:

1. Claim one due schedule per database transaction (`FOR UPDATE SKIP
   LOCKED`), so concurrent passes never process the same schedule.
2. List the occurrences due since `lastSequence` (at most 25 per pass),
   apply the missed-run policy, and for each live occurrence act through
   the schedule's own principal: an agent-class principal
   `schedule:<id>` holding `proposals:create`, `portfolio:read` and
   `research:read` for the owner. It calls the same typed tools an agent
   credential would (`investment.propose`, `rebalance.propose`) with the
   same policy evaluation, so the proposal carries `createdBy:
   agent:schedule:<id>`, the schedule and occurrence ids, and expires at
   the occurrence's window end.
3. Record the occurrence and advance the schedule (`lastSequence`,
   `nextDueAt`, counts) in the same transaction as the claim.
4. A drift occurrence reads the instance allocation, refuses to propose
   when the creator's threshold (or the override) is unset, the
   allocation is incomplete, an open rebalance proposal exists for the
   instance, the minimum interval since the last proposal has not
   passed, or the largest drift is within the threshold; each reason is
   recorded (`threshold_unset`, `target_unavailable`,
   `open_proposal_exists`, `within_min_interval`, `no_drift`).
5. Expire review windows: an unopened proposal past its window marks the
   occurrence `expired` once and tells the owner (`schedule.expired`).
6. Project new Mark I events into notifications and attempt due
   deliveries (below).

Restart recovery: if a pass dies after the proposal insert and before the
occurrence and schedule rows commit, the next pass finds the same
occurrence due again, creates the proposal with the same dedup key,
receives the unique-violation and answers the existing proposal instead
of a second one. `apps/api/test/maintenance.test.ts` rewinds a schedule
through the store to exactly that state and shows one proposal, one
occurrence and `lastSequence` 1 afterwards.

Failures: a target that disappeared (the wallet unlinked, the version or
instance gone) records `failed` with `target_unavailable`, revokes the
schedule with the reason and notifies the owner; a policy denial records
`failed` with `policy_denied` and the schedule stays active; any other
error records `failed` with `error`.

## Why a schedule cannot spend

The schedule's principal holds `proposals:create` and read scopes only.
Nothing in the maintenance path builds, signs, submits or reserves funds:

- `investment.propose` creates a proposal whose intent request is fixed
  to `approvalMode: owner_each_plan`; the intent itself is created only
  when the owner's session opens the proposal, and it still needs a
  quoted plan, an acknowledgement bound to the plan hash and the wallet
  signature (`docs/markov/execution-planning.md`,
  `execution-state-machine.md`).
- The schedule principal, an agent credential and an operator are all
  refused by `POST /v1/me/proposals/{id}/open` (403); another account
  sees nothing (404).
- A rebalance proposal now carries sized `legs` (sells of the excess
  first, buys of the shortfall, dust below 25 bps ignored) and
  `executable`. Opening it as the owner creates one reviewed intent per
  leg (`single_sell` or `single_buy`, budget from the leg, key
  `proposal:<id>:<instrument>:<side>`, idempotent) and nothing else; each
  intent is planned, acknowledged and signed like any other, sells first.
  An instance with no holdings produces a report with no legs
  (`executable: false`).
- Unattended execution is a capability that stays `DISABLED`
  (`automation.unattended`); no configuration flag enables it.

## Mandate dry run

`POST /v1/me/mandates/dry-run` defines the interface a future mandate
mechanism must satisfy without granting anything. A mandate binds owner,
wallet, strategy version, chain (cluster and genesis hash), admitted
instruments and venues, actions, input and output destinations, per-order
and period budgets, cumulative turnover, maximum fee, maintenance
behaviour (buys, sells, reduce-only, maximum slippage), expiry, nonce and
revocation. `evaluateMandate` (`packages/maintenance/src/mandate.ts`)
checks an action against it deterministically and answers every check by
code: `MANDATE_ACTIVE`, `OWNER_MATCH`, `WALLET_MATCH`, `VERSION_MATCH`,
`CHAIN_MATCH`, `NONCE_MATCH`, `ACTION_PERMITTED`, `SIDES_PERMITTED`,
`INSTRUMENTS_ADMITTED`, `VENUE_ADMITTED`, `DESTINATIONS_MATCH`,
`PER_ORDER_BUDGET`, `PERIOD_BUDGET`, `CUMULATIVE_TURNOVER`, `FEE_CAP`,
`SLIPPAGE_CAP` and `TIME_WINDOW`. Reduce-only permission cannot buy or
rebalance two-sided; a widened version is a different version and fails
`VERSION_MATCH`; the owner may only dry-run a mandate naming themself.
The answer states the gate itself: `unattended.status` read from the
capability table, `DISABLED`. Nothing is stored and nothing executes.

## Notifications

Notifications are a durable outbox projected from the owner's Mark I
events (`proposal.created`, `execution.*`, `data.stale`,
`device.revoked`; `review.required` for a proposal is folded into its
`proposal.created`) and from schedule outcomes (`schedule.skipped` for a
missed window or a catch-up, `schedule.failed`, `schedule.expired`). A
global projection cursor and unique source keys make projection
idempotent. Each notification has a category (`proposals`, `execution`,
`schedules`, `data`, `security`), a title and body without credentials, a
link the app resolves to a path (`/proposals/{id}`, `/review/{id}`,
`/automations/{id}`, `/portfolio/{id}`, `/settings/devices`,
`/companion/{id}`), and deliveries per channel.

Channels: `in_app` is delivered by the row itself, read by the owner's
session or a paired device holding `notifications:receive`
(`GET /v1/me/notifications?after=&limit=&unread=&category=`, read and
read-all). `email` is queued only when the owner verified an address and
turned the category on (`security` is on by default, everything else
off); it is sent by the maintenance pass through the configured adapter
with the idempotency key `notification:<id>:email`, retried with a
1, 5, 15, 60, 240-minute backoff, dead-lettered after five attempts
(`dead`) or marked `failed` on a permanent refusal, and never sent when
no adapter is configured (`skipped`). Operators list dead letters
(`GET /v1/ops/notifications/dead-letter`) and requeue one delivery after
the cause is fixed (`POST /v1/ops/notifications/{id}/retry`); nothing is
resent on its own.

Email verification: `POST /v1/me/notification-preferences/email` stores
the address as pending and sends a six-digit code (HMAC-hashed with a
per-attempt salt and the credential pepper, valid 15 minutes, five
attempts); `…/email/verify` confirms it; `DELETE …/email` removes the
address and stops every email at once. The verification message and every
notification email carry no credential and no bearer link.

Adapters (`packages/notifications/src/email.ts`): `fixture` records what
it would have sent (local and test only; `GET
/v1/ops/notifications/fixture-outbox` shows it to operators),
`configured` posts the message as JSON to `NOTIFICATIONS_EMAIL_URL` with
`NOTIFICATIONS_EMAIL_API_KEY` as a bearer and the idempotency key as a
header, treating 5xx and transport errors as retryable and 4xx as
permanent. No live provider is integrated (OD-25); production ships with
in-app notifications only until one is chosen.

## Worker loop

The worker starts `maintenanceWorkflow` once per task queue
(`maintenance:<queue>`) when `MAINTENANCE_API_URL` and
`MAINTENANCE_API_TOKEN` (a `markov workers create` credential with
`maintenance:run`) are set, and logs that it is not driving schedules
otherwise. Every `MAINTENANCE_TICK_SECONDS` (default 60) the activity
`runMaintenanceTick` asks the API for one pass; the workflow counts passes
that ran, were refused (an expired or unscoped credential: reported, not
retried blindly), were unreachable (after the activity's retries) or
found no configuration, and rolls its history over every 500 rounds.
Temporal keeps the loop durable across worker restarts; the database
keeps the side effects idempotent, so a repeated tick prepares no second
proposal. The worker holds no database access for this path and no
authority beyond asking for passes.

## Surface

API: `docs/markov/api.md` (Endpoints B16). CLI: `markov schedules
create|preview|list|show|update|pause|resume|cancel|occurrences`,
`markov notifications list|read|read-all|preferences|email set|verify|clear|dead-letter|retry|fixture-outbox`,
`markov mandates dry-run`, `markov maintenance run`, `markov workers
create`. Audit actions: `maintenance.schedule.*`, `maintenance.run`,
`maintenance.mandate.dry_run`, `notification.*`, `worker.credential.created`.

## Verification

- `packages/maintenance/test`: DST in New York, Berlin and Sydney,
  monthly clamping, weekly cadence, missed-run policies, drift decisions,
  leg sizing, mandate attack fixtures (widened version, other owner,
  reduce-only buy, expired, revoked, over budget).
- `packages/notifications/test`: routing, channel selection, rendering
  without credentials, verification hashing, the fixture and configured
  adapters, the backoff.
- `apps/api/test/maintenance.test.ts`: a due occurrence becomes one
  proposal and one in-app notification; a second pass prepares nothing;
  the schedule principal, an agent and an operator cannot open it and the
  owner opens it into a `DRAFT` intent under `owner_each_plan`; restart
  recovery through the dedup key; three missed days skipped and one live
  occurrence proposed; pause, resume, update, cancel; review expiry;
  revocation after the wallet is unlinked; cross-account reads; a drift
  schedule that proposes once, skips while the proposal is open and
  proposes again after it was opened and the interval passed; verified
  email, a refusing provider retried to the dead letter and requeued by an
  operator; device and agent read boundaries; the mandate dry run.
- `apps/worker/test/worker.test.ts`: the loop drives passes through a
  stub API with the worker credential, reports a refusal and carries on,
  and starts no loop without configuration.
- `scripts/ci/startup-check.sh`: the maintenance journey with a real
  schedule due now, a worker credential, dedup on rerun, pause, in-app
  notifications, a verified address through the fixture outbox, an email
  delivery, the dead-letter queue and the mandate dry run.

## What B16 does not do

No unattended execution, no mandate storage or enforcement (the dry run
is an interface), no live email provider (OD-25), no push or SMS channel,
no snapshotting of holdings for drift (the allocation is read at pass
time from the journal and the reference prices, with the same freshness
rules as the portfolio view), and no app screens (F13).
