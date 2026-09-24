# Strategies: versioned stock recipes (B07)

A strategy is a person's recipe for a basket of admitted tokenised stocks
plus explicit cash, expressed in integer basis points. It exists in two
forms: a **draft** that its owner (or an agent acting for them) edits, and
**versions** that are frozen from the draft and never change. Followers
pin an explicit version; a creator's later edit proposes a new version and
moves nobody's pin. This document is the contract for
`@markov/strategy`, the `strategies`, `strategy_drafts`,
`strategy_versions` and `portfolio_instances` tables (migration
`0007_strategies`) and the `/v1/me/strategies` and `/v1/me/instances`
routes. Publication and on-chain registration are B08; execution is B09
and B10; nothing here places an order.

## Draft content

`strategyDraftContentSchema` (`packages/contracts/src/strategy.ts`):

| Field | Rule |
| ----- | ---- |
| `title` | plain text, ≤ 120 characters, no markup or control characters |
| `thesis` | plain text, ≤ 4,000 characters |
| `thesisId` | optional link to one of the owner's theses (B06); the thesis itself is not copied |
| `kind` | `stock_spot_basket` (the only V1 kind) |
| `legs[]` | `instrumentId` (catalog id), `weightBps` ≥ 1, optional `note` (≤ 200); the schema accepts up to 20 entries so that validation can report every problem, the leg cap is enforced by validation |
| `cashWeightBps` | integer basis points held as the stablecoin, 0 allowed |
| `maintenance` | `suggestion` ∈ `hold`, `rebalance_on_drift`, `review_periodically`; optional `driftThresholdBps`, `reviewEveryDays` (1–365). A suggestion, never an instruction: no rebalance is ever automatic |
| `references[]` | ≤ 10 https URLs the author cites; stored as text, never fetched |

Weights are integers. Nothing is renormalised: a draft whose legs and cash
sum to 9,999 or 10,001 basis points stays exactly that and is reported.

## Validation

`validateDraft` (`packages/strategy/src/validate.ts`) is pure and
deterministic. Every draft save and every read carries the result; a
freeze refuses a draft with any `error` issue. Issues carry `code`,
`severity`, `path` (`legs`, `legs/<index>` or `cashWeightBps`), a message
and the numeric `limit` and `observed` values where they apply.

| Code | Severity | Meaning |
| ---- | -------- | ------- |
| `NO_LEGS` | error | cash alone is not a strategy |
| `TOO_MANY_LEGS` | error | more constituents than `maxLegs` (`STRATEGY_MAX_LEGS`, default and maximum 10; a deployment may only lower it) |
| `WEIGHTS_TOTAL` | error | legs plus cash ≠ 10,000 basis points; `observed` is the actual total |
| `DUPLICATE_INSTRUMENT` | error | the same instrument id appears twice |
| `DUPLICATE_MINT` | error | two instruments share a token-program and mint identity |
| `UNKNOWN_INSTRUMENT` | error | not in the catalog |
| `INSTRUMENT_NOT_ADMITTED` | error | any status other than `admitted` (quarantined, paused, delisted, rejected); a draft can name it, a version cannot |
| `ISSUER_CONCENTRATION` | warning | one issuer carries more than the policy ceiling for a single issuer (`maxIssuerConcentrationBps`) |
| `COMPANY_CONCENTRATION` | warning | one underlying company (across issuers, by the shared `companyKey`) carries more than `maxCompanyConcentrationBps` |

Concentration is advisory here because a recipe is not a position: the
execution policy (B05, B09) checks the account's real exposure with actual
holdings and limits at order time. Hidden leverage cannot be expressed:
the only kind is a spot basket of admitted mints, weights are positive
integers and the total is exact.

`GET /v1/strategies/limits` publishes the rules a deployment enforces:
`schemaVersion`, `kinds`, `totalBps`, `maxLegs`, both concentration
ceilings and `ceilingSource` (`policy_defaults` or `beta_caps`, from
`ceilingLimits` in `@markov/policy`).

## Revisions and optimistic concurrency

Each strategy has exactly one draft with an integer `revision` that
increases on every save. `PUT …/draft` and `POST …/versions` accept
`ifRevision`; when it does not match, the API answers
`IDEMPOTENCY_CONFLICT` (409) with the current revision in
`details[0].message` and changes nothing. Saves and freezes take a row
lock on the strategy, so concurrent saves that name the same revision
apply exactly once and concurrent freezes produce exactly one version
(`packages/db/test/strategy-store.test.ts`).

## Freezing a version

`POST /v1/me/strategies/{strategyId}/versions` (person only, 10 per minute)
validates the draft against the catalog as it is at that moment, then
records for every leg an **admission snapshot**: `status`, `admittedAt`,
the latest mint verification (`verificationId`, `verifiedAt`), `mint`,
`tokenProgram`, `decimals` and the network `genesisHash`, next to the
instrument's `issuer`, `symbol` and `companyName`. Legs are stored sorted
by instrument id. `disclosures` aggregate weight by issuer and by
underlying company. `authorPrincipal` is `user:<id>` or
`agent:<credential id>`; it is API-visible to the owner and never part of
the manifest. `parentVersionId` is the strategy's previous version;
`forkOf` names the strategy and version a fork came from.

A freeze of a draft whose economic content equals the current version's
answers that version with status 200 instead of creating a twin (201).
Versions carry `publication: unpublished` and `moderation: none` until
B08 introduces registration and review; `deprecatedBy` links a version a
creator has superseded on purpose (B08).

There is no route that edits or deletes a version. Archiving a strategy
(`PATCH …/{strategyId}` with `status: archived`) stops edits, freezes and
forks of it and hides it from the default list; every version, instance
and audit row stays readable. Restoring sets `status: active`.

## Canonical manifest and hashes

Two encodings exist, both canonical JSON: object keys sorted, legs sorted
by `instrumentId`, references sorted, no whitespace, UTF-8.

**Manifest** (`canonicalManifest`): the version's identity, including its
lineage. Fields: `schemaVersion`, `kind`, `network` (`{chain: "solana",
genesisHash}`), `strategyId`, `versionNumber`, `parentVersionId`, `forkOf`,
`title`, `thesis`, `thesisId`, `legs[]` (`instrumentId`, `mint`,
`tokenProgram`, `weightBps`), `cashWeightBps`, `maintenance`,
`references`. It contains no author, wallet, budget or holding.

```
manifestHash = SHA-256( "markov-strategy-manifest/v" + schemaVersion + "/" + genesisHash + "\n" + canonicalManifest )
```

**Content** (`canonicalContent`): the same without `strategyId`,
`versionNumber`, `parentVersionId` and `forkOf`, i.e. what a follower
accepts. Two versions of the same recipe share one digest whatever their
number or parent.

```
contentDigest = SHA-256( "markov-strategy-content/v" + schemaVersion + "/" + genesisHash + "\n" + canonicalContent )
```

The domain prefixes bind every hash to the schema version and to the
network identity, so a devnet manifest can never verify as a mainnet
one and the two hashes can never collide.

Test vectors (`packages/strategy/test/strategy.test.ts`, genesis
`EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG`, strategy
`55555555-5555-4555-8555-555555555555`, version 1, no parent, no fork,
title `Aerospace tilt`, thesis `Launch cadence is underestimated.`, legs
`11111111-…` M1 spl-token 3000, `22222222-…` M2 token-2022 2000,
`33333333-…` M3 token-2022 3000, cash 2000, maintenance `hold`,
references `https://b.example.com/x`, `https://a.example.com/y`):

```
canonicalManifest = {"cashWeightBps":2000,"forkOf":null,"kind":"stock_spot_basket","legs":[{"instrumentId":"11111111-1111-4111-8111-111111111111","mint":"M1","tokenProgram":"spl-token","weightBps":3000},{"instrumentId":"22222222-2222-4222-8222-222222222222","mint":"M2","tokenProgram":"token-2022","weightBps":2000},{"instrumentId":"33333333-3333-4333-8333-333333333333","mint":"M3","tokenProgram":"token-2022","weightBps":3000}],"maintenance":{"driftThresholdBps":null,"reviewEveryDays":null,"suggestion":"hold"},"network":{"chain":"solana","genesisHash":"EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG"},"parentVersionId":null,"references":["https://a.example.com/y","https://b.example.com/x"],"schemaVersion":"1","strategyId":"55555555-5555-4555-8555-555555555555","thesis":"Launch cadence is underestimated.","thesisId":null,"title":"Aerospace tilt","versionNumber":1}
manifestHash      = d324b072007fd7af46659406f5bb90b373ef088bc19774b99a726d9a95dacc1a
canonicalContent  = {"cashWeightBps":2000,"kind":"stock_spot_basket","legs":[…same legs…],"maintenance":{…},"network":{…},"references":[…],"schemaVersion":"1","thesis":"Launch cadence is underestimated.","thesisId":null,"title":"Aerospace tilt"}
contentDigest     = 910207cf06da18bcbf497381e9ac8f209e8c0ab895c1ae011bf36390102e0819
```

The B08 registry program must reproduce `manifestHash` from the same
bytes; the vectors above are the shared fixture for the Rust and
TypeScript implementations.

## Forks

`POST …/{strategyId}/forks` with a `versionId` creates a new strategy owned
by the caller whose draft is that version's content (title suffixed
` (fork)`), with `forkOf = {strategyId, versionId}` recorded on the
strategy and on every version it later freezes. The original is not
touched and its owner is not named in the fork.

## Diffs

`GET …/versions/{versionId}/diff?against={otherVersionId}` compares two
versions of the same strategy: legs `added`, `removed` and `changed`
(`fromBps`, `toBps`), cash `from`/`to`, whether title, thesis,
maintenance or references changed, and `turnoverBps`, the one-sided sum
of absolute weight moves (⌊Σ|Δ| / 2⌋). It is the machine-readable
"what would change" a follower sees before accepting a proposed version.

## Portfolio instances and pins

An instance is a person's decision to follow one version in one of their
own verified wallets (`walletId` from `/v1/me/wallets`). It pins
`pinnedVersionId` explicitly at creation. When the strategy's creator
freezes a newer version, every active instance of that strategy gets
`proposedVersionId` set and nothing else: the pin does not move, no
order is planned, no rebalance is implied. `POST
/v1/me/instances/{instanceId}/pin` with an explicit `versionId` of the
same strategy is the only way a pin changes; it clears the proposal. A
closed instance refuses pin changes. Instances have no holdings or
orders in B07; those arrive with execution and accounting (B09–B12).

## Principals and scopes

| Operation | Who |
| --------- | --- |
| Read strategies, drafts, versions, diffs, instances | user; agent with `portfolio:read` |
| Create a strategy, replace a draft | user; agent with `proposals:create` |
| Freeze, fork, archive or restore, create an instance, move a pin | user only (interactive) |
| Operator | no route; `ops:*` credentials cannot read private recipes |

Every write is audited (`strategy.create`, `strategy.draft.save`,
`strategy.version.freeze`, `strategy.fork`, `strategy.status`,
`instance.create`, `instance.pin`) with the acting principal and
secret-free details.

## CLI

```
markov strategy limits --url …
markov strategy create --input '{"title":…,"legs":[…],"cashWeightBps":1000}' --token <session> --url …
markov strategy draft <strategyId> --file draft.json --if-revision 3 --token <session> --url …
markov strategy freeze <strategyId> --if-revision 4 --token <session> --url …
markov strategy versions <strategyId> --token <session> --url …
markov strategy diff <strategyId> <versionId> --against <otherVersionId> --token <session> --url …
markov strategy fork <strategyId> --version-id <versionId> --token <session> --url …
markov strategy archive <strategyId> [--restore] --token <session> --url …
markov instance create --strategy <strategyId> --version-id <versionId> --wallet <walletId> --label … --token <session> --url …
markov instance list --token <session> --url …
markov instance pin <instanceId> --version-id <versionId> --token <session> --url …
```

`scripts/ci/startup-check.sh` runs this journey against a fresh database:
a valid basket, an invalid draft (duplicate, unadmitted, wrong total)
refused with every code, a stale revision refused, v1 frozen with
admission snapshots and issuer disclosures, a fork with provenance, an
instance pinned to v1, a creator's v2 proposed but not applied, explicit
acceptance, the diff and v1 unchanged afterwards.

## Not in this session

Publication and on-chain registration with a publisher wallet (B08),
moderation actions, allocation and orders from an instance (B09, B10),
holdings and accounting (B11, B12), maintenance notifications (B15) and
the app screens (F07).
