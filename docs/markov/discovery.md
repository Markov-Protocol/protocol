# Discovery, following and moderation (B14)

Status: implemented and fixture-verified in B14 (`apps/api/src/discovery`,
`packages/db/src/discovery-store.ts`, `packages/contracts/src/discovery.ts`).
The explorer is a projection over facts that already exist: registered
versions, their chain records, follower counts and the B13 model ranking.
It creates no new claim, no new price and no new authority over anyone's
holdings.

## What is public, by construction

A row of `GET /v1/strategies` is built from an **active** strategy with at
least one version that is **registered** on chain and **not withheld** by
platform moderation. The schema of a row has no field for an owner, an
instance, a wallet other than the publishing wallet, a draft, an
unpublished version, a hidden version or a budget; the store query joins
only `strategies`, `strategy_versions` (registered, moderation `none`) and
`registry_records`, plus a follower count. Private data cannot leak
through a field that does not exist (`apps/api/test/discovery.test.ts`
asserts that no user id, wallet id, instance id, `ownerUserId`,
`authorPrincipal` or draft text appears in the explorer or a creator
page).

Each row carries:

| Field | Source |
| ----- | ------ |
| `title`, `thesisExcerpt` (first 240 characters, cut at a word), `forkOf` | the newest public version and the strategy's lineage |
| `creator.publisherWallet` | the wallet that signed the newest public version's registration, from the indexed chain record; the platform asserts no name |
| `issuers`, `latestVersion.constituents` (instrument, symbol, company, issuer, weight), `legCount`, `cashWeightBps` | the frozen legs of that version |
| `latestVersion` (`versionId`, number, `manifestHash`, `recordAddress`, record `status`, `publisher`, `registeredAt`, `frozenAt`, `parentVersionId`) | the version row and its record |
| `versionCount` | registered, unwithheld versions of the strategy |
| `followerCount` | a count of follows (F08); never who |
| `performance` | the B13 model ranking entry of the newest public version for the requested period (below) |

Archiving a strategy (`PATCH /v1/me/strategies/{id}` with
`status: archived`) removes it from the explorer, from creator pages and
from `GET /v1/rankings/model`; its public version pages, series routes,
chain records and every instance pinned to it stay readable, and
restoring it lists it again. A registered version whose record the
publisher deprecated is still listed with `status: deprecated`: the
record is the creator's statement and the explorer shows it as is.

## Honest ranking column

`performance` is the entry `rankModelSeries` produces for the version
under one period (`30d`, `90d`, `365d`) and one methodology version
(`stocks-v1`), the same population and the same order as
`GET /v1/rankings/model`, so a rank shown in the explorer is the rank on
the leaderboard. An entry ranks only when the version's model series is
complete over the window, ends on a fresh price and has at least
`minHistoryDays` (30) of history; otherwise `rank`, `timeWeightedReturn`
and `maxDrawdown` are null and `reasons` says why (`insufficient_history`,
`incomplete_window`, `stale_end`, `zero_base`, `no_series`). The explorer
never fills a missing rank with deposits, transaction counts, follower
counts or a creator's own claim: `sort=rank` places ranked rows first by
rank and the rest by newest registration, `sort=newest` orders by
registration time, `sort=followers` by follower count (a popularity
signal, labelled as such in the response `sort`). The response note fixes
the wording of what is listed and what ranks.

## Query, filters and pages

`GET /v1/strategies?q=&issuer=&instrumentId=&creator=&period=&sort=&limit=&cursor=`
(public, 60 requests per minute per client: every page values the whole
public population's model series on read, bounded at 500 versions).

- `q`: case-insensitive match on the title, the thesis excerpt, a
  constituent symbol or company name.
- `issuer`: at least one constituent from that issuer; `instrumentId`: the
  instrument among the constituents; `creator`: the wallet that registered
  the newest public version.
- `cursor`: opaque, bound to the `sort` and `period` it was issued for; a
  cursor from another query or one whose row left the population answers
  `VALIDATION_FAILED` with "restart from the first page". Pages are
  stable because the order has a total tie-break (strategy id).
- `matched` counts rows before pagination; `asOf` is the read time.

`GET /v1/creators/{publisherWallet}?period=` answers the strategies whose
newest public version that wallet registered, how many registered
versions it signed across them, the first and latest registration and
the follower total; `NOT_FOUND` when the wallet registered no listed
strategy. Provenance is the chain record's publisher: Markov attaches no
name, no track record and no claim beyond the registered versions and
their model series.

## Following and follower allocations

A follow (`PUT`/`DELETE /v1/me/follows/{strategyId}`, F08) is bookkeeping
on the follower's account. A follower's **allocation** is a portfolio
instance of their own pinned to a version (`POST /v1/me/instances`). Since
B14 anyone may create an instance pinned to a **registered, unwithheld**
version of an **active** strategy they do not own (the same rule as a
fork); the owner may pin any version of their own. What a creator does
later never moves that pin:

- A freeze of the creator's draft proposes the new version to the
  creator's own instances only. Other people's instances are offered a
  version when its registration reaches `registered` (they can read and
  pin nothing else); `proposedVersionId` is set, the pin stays.
- `POST /v1/me/instances/{id}/pin` with the explicit `versionId` is the
  only way a follower's pin changes; for an instance on someone else's
  strategy the target must itself be registered and unwithheld.
- Editing the draft, freezing without registering, deprecating a record,
  archiving the strategy or a moderation decision leaves every pin where
  it is. The startup check and the API test create a follower instance on
  v1, register v2, read the proposal, and accept explicitly.

## Platform moderation, separate from the chain

`POST /v1/operator/strategies/{strategyId}/versions/{versionId}/moderation`
(`ops:discovery:write`) with `{ status: 'hidden' | 'none', reason,
reference? }` sets `strategy_versions.moderation` and appends a row to
`moderation_decisions` (migration `0015_discovery`: version, status,
previous status, reason, optional reference, the operator credential id,
time). The same status applied twice answers 200 with the decision in
force; a change answers 201; the audit log records `strategy.moderate`.
`GET /v1/operator/strategies/{strategyId}/moderation`
(`ops:discovery:read`) lists every version's status and the decisions,
newest first.

A hidden version:

- leaves the explorer, creator pages, `GET /v1/rankings/model`,
  `GET /v1/strategies/{s}` and `GET /v1/strategies/{s}/versions/{v}`
  (404), and follow targets (a follow's `latestVersion` moves to the
  newest remaining public version or null);
- keeps its **chain record** readable at
  `GET /v1/registry/records/{address}` with `version: null`: the record
  exists permissionlessly and no Markov operator can hide, close or
  rewrite it (ADR-0008);
- stays readable to its owner (`moderation: 'hidden'` on their own
  version routes) and cannot be published again while hidden;
- moves no pin. Proposals of that version are withdrawn from other
  people's instances (they could no longer read what they were offered);
  making it visible again re-offers it when it is the strategy's newest
  public version.

Moderation is a listing decision with a recorded reason, never a
statement about the chain, the creator or anyone's holdings.

## CLI

```
markov discovery explore [--q text] [--issuer prestocks|xstocks|tessera] [--instrument <id>] [--creator <wallet>] [--period 30d|90d|365d] [--sort rank|newest|followers] [--limit n] [--cursor c] --url …
markov discovery creator <publisherWallet> [--period …] --url …
markov discovery follows --token <session|agent> --url …
markov discovery follow <strategyId> --token <session> --url …
markov discovery unfollow <strategyId> --token <session> --url …
markov strategy moderate <strategyId> <versionId> --status hidden|none --reason "…" [--reference <url>] --token <operator> --url …
markov strategy moderation <strategyId> --token <operator> --url …
```

`scripts/ci/startup-check.sh` (discovery journey) lists the registered
strategy without a rank (`insufficient_history`, no return), checks that
no private identifier appears in the explorer, reads the creator page,
follows as a second person, pins their instance to v1, refuses the
unregistered v2, registers v2 and reads the proposal without a move,
hides v2 (explorer back to v1, public read 404, chain record still
`active` with no version link, proposal withdrawn, history recorded),
refuses moderation without the scope, makes v2 visible again, and accepts
the pin explicitly. `apps/api/test/discovery.test.ts` adds a ranked
recipe with 31 days of daily observations next to the young one, filters,
sorts, cursors, the creator page, the follower rules, the archive rule and
the moderation flow.

## Not in this session

Leaderboard snapshots (rankings are computed on read, bounded by the
population limit), notifications to followers, per-issuer or per-period
cohorts beyond the methodology's periods, and the web explorer (F12).
