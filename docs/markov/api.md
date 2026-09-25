# API

Status: platform (B01), identity (B02), catalog (B03/B04), policy (B05), funding (F04), research (B06) and watchlist (F05) endpoints are live. The committed OpenAPI document is
`docs/markov/openapi.json`; `pnpm openapi:generate` regenerates it from the
runtime validators and `pnpm openapi:check` fails CI on drift.

## Conventions

- Base path for versioned resources: `/v1`. Health endpoints are unversioned.
- Every response carries `x-request-id`. A caller-supplied
  `x-request-id` matching `^[A-Za-z0-9._:-]{1,128}$` is echoed; anything
  else is replaced with a UUID. The id appears in logs as `requestId`.
- Errors use one envelope: `{ "error": { "code", "message", "requestId", "details"? } }`.
  Codes and their fixed HTTP statuses are defined in `@markov/contracts`
  (`ERROR_CODES`, `ERROR_HTTP_STATUS`): AUTH_REQUIRED 401, FORBIDDEN 403,
  NOT_FOUND 404, VALIDATION_FAILED 400, RATE_LIMITED 429, ELIGIBILITY_UNKNOWN,
  ASSET_NOT_ADMITTED, QUOTE_EXPIRED, INSUFFICIENT_FUNDS, PLAN_CHANGED,
  SIGNATURE_MISMATCH, PARTIAL_EXECUTION, SUBMISSION_UNKNOWN,
  IDEMPOTENCY_CONFLICT 409, POLICY_DENIED 403, STEP_UP_REQUIRED 401,
  CHALLENGE_INVALID 409, WALLET_ALREADY_LINKED 409, ADMISSION_BLOCKED 409,
  PROVIDER_UNAVAILABLE and
  SERVICE_NOT_READY 503, INTERNAL 500. Messages never include secrets or
  another principal's resource existence.
- Request bodies are limited to `API_BODY_LIMIT_BYTES` (default 256 KiB);
  a global rate limit of `API_RATE_LIMIT_MAX_PER_MINUTE` applies per client
  address (per-route limits arrive with the routes that need them).
- CORS: only exact origins from `API_ALLOWED_ORIGINS`; no origins configured
  means no CORS headers at all. Credentialed wildcard is impossible by
  configuration.

## Authentication

`Authorization: Bearer <token>` with a session, agent, operator or device
credential (`docs/markov/identity-and-principals.md`). A malformed or
unknown bearer is answered with `AUTH_REQUIRED` before any route runs; an
absent header is anonymous and only the public routes accept it. Security-
sensitive routes additionally answer `STEP_UP_REQUIRED` when the sign-in is
older than the configured window.

## Endpoints (B01)

| Method | Path            | Purpose |
| ------ | --------------- | ------- |
| GET    | /healthz        | Liveness: `{ status: "ok", service, version, uptimeSeconds, timestamp }` |
| GET    | /readyz         | Readiness: 200/503 with `checks.database`, `checks.schema`, `checks.platform_identity`, `checks.solana_rpc` (`pass`, `fail` or `unverified`) and the platform identity block |
| GET    | /v1/platform    | Identity (`markovEnv`, `solanaCluster`, `genesisHash`), `executionWritesEnabled`, capability readiness |
| GET    | /openapi.json   | Generated OpenAPI 3.1 document (hidden from itself) |

Example readiness response (abridged):

```json
{
  "status": "ready",
  "service": "markov-api",
  "timestamp": "2026-09-24T17:05:00.000Z",
  "checks": {
    "database": { "status": "pass", "required": true, "detail": "SELECT 1 succeeded", "observedAt": "…", "durationMs": 2 },
    "schema": { "status": "pass", "required": true, "detail": "schema current at 0000_platform_identity", "observedAt": "…", "durationMs": 3 },
    "platform_identity": { "status": "pass", "required": true, "detail": "bound to test/devnet (EtWT…) by startup-check at …", "observedAt": "…", "durationMs": 2 },
    "solana_rpc": { "status": "pass", "required": true, "detail": "127.0.0.1:2xxxx: genesis hash matches", "observedAt": "…", "durationMs": 4 }
  },
  "platform": { "markovEnv": "test", "solanaCluster": "devnet", "expectedGenesisHash": "EtWT…", "observedGenesisHash": "EtWT…", "schemaVersion": "0000_platform_identity" }
}
```

`GET /v1/platform` additionally reports `identityProvider` (`test` or
`oidc`, F03) so the app can offer exactly the sign-in path the backend runs.

## Endpoints (B02)

| Method | Path                                   | Principal            | Purpose |
| ------ | -------------------------------------- | -------------------- | ------- |
| POST   | /v1/auth/sessions                      | anonymous            | Exchange an identity token for a session (token returned once) |
| DELETE | /v1/auth/sessions/current              | user                 | Sign out |
| GET    | /v1/me                                 | user, agent          | Principal and account summary, step-up freshness and, for sessions, `session.expiresAt` (F03) |
| POST   | /v1/me/wallets/challenges              | user (fresh)         | Start wallet ownership verification |
| POST   | /v1/me/wallets                         | user (fresh)         | Link a wallet with the signed challenge |
| GET    | /v1/me/wallets                         | user, agent `portfolio:read` | List verified wallets |
| DELETE | /v1/me/wallets/{walletId}              | user (fresh)         | Unlink |
| POST   | /v1/me/api-credentials                 | user (fresh)         | Create a scoped, expiring agent credential (token returned once) |
| GET    | /v1/me/api-credentials                 | user                 | List (never secrets) |
| DELETE | /v1/me/api-credentials/{credentialId}  | user (fresh)         | Revoke |
| POST   | /v1/me/devices/pairings                | user (fresh)         | Create a single-use pairing code |
| POST   | /v1/devices/pair                       | anonymous (rate limited) | Pair a device; device credential returned once |
| GET    | /v1/me/devices                         | user                 | List devices |
| DELETE | /v1/me/devices/{deviceId}              | user (fresh)         | Revoke a device |
| GET    | /v1/ops/users/{userId}                 | operator `ops:read`  | Account summary without secrets |
| DELETE | /v1/ops/api-credentials/{credentialId} | operator `ops:credentials:revoke` | Revoke any agent credential |
| GET    | /v1/ops/audit                          | operator `ops:read`  | Recent audit events |

`POST /v1/auth/test-tokens` exists only with the test identity provider and
is not part of the committed contract.

## Endpoints (B03)

| Method | Path                                                     | Principal                     | Purpose |
| ------ | -------------------------------------------------------- | ----------------------------- | ------- |
| GET    | /v1/catalog/instruments                                  | anonymous                     | Search admitted and paused instruments (`q`, `issuer`, `kind`, keyset `cursor`, `limit`) |
| GET    | /v1/catalog/instruments/{instrumentId}                   | anonymous                     | Detail with the latest mint verification; 404 unless admitted or paused |
| GET    | /v1/ops/catalog/instruments                              | operator `ops:catalog:read`   | Every status, including quarantine |
| GET    | /v1/ops/catalog/instruments/{instrumentId}               | operator `ops:catalog:read`   | Detail in any status |
| GET    | /v1/ops/catalog/instruments/{instrumentId}/decisions     | operator `ops:catalog:read`   | Decision history |
| POST   | /v1/ops/catalog/ingestions                               | operator `ops:catalog:write`  | Ingest a feed (`fixture` in local/test, `configured_url`) into quarantine |
| POST   | /v1/ops/catalog/instruments/{instrumentId}/mint-verifications | operator `ops:catalog:write` | Compare the declared mint with the chain |
| POST   | /v1/ops/catalog/instruments/{instrumentId}/decisions     | operator `ops:catalog:write`  | admit, reject, pause, resume, delist |
| GET    | /v1/ops/catalog/snapshots                                | operator `ops:catalog:read`   | Recent snapshots with content hashes and rejection reasons |

| GET    | /v1/catalog/instruments/{instrumentId}/corporate-actions  | anonymous                     | Pending and applied corporate actions of a visible instrument (B04) |
| GET    | /v1/catalog/instruments/{instrumentId}/multipliers        | anonymous                     | Multiplier evidence history (B04) |
| GET    | /v1/catalog/instruments/{instrumentId}/multiplier         | anonymous                     | Multiplier in force at `asOf`, with completeness (B04) |
| GET    | /v1/catalog/instruments/{instrumentId}/quantities         | anonymous                     | Exact raw ↔ scaled conversion with explicit rounding (B04) |
| POST   | /v1/ops/catalog/corporate-actions/ingestions              | operator `ops:catalog:write`  | Ingest a corporate-action feed as pending events (B04) |
| GET    | /v1/ops/catalog/corporate-actions                         | operator `ops:catalog:read`   | Corporate actions in any status (B04) |
| POST   | /v1/ops/catalog/corporate-actions/{actionId}/apply        | operator `ops:catalog:write`  | Apply an effective pending action; records multiplier evidence (B04) |
| POST   | /v1/ops/catalog/corporate-actions/{actionId}/reject       | operator `ops:catalog:write`  | Reject a pending action (B04) |

Catalog prices are typed reference marks (`issuer_mark`,
`implied_valuation`, `secondary_market`, `underlying_equity`), never
`execution_quote`. Mint verifications carry the token-extension assessment;
admission refuses unsupported extension sets and requires
`evidence.extensionReview` for review-required ones.
`ADMISSION_BLOCKED` (409) answers an admit or resume without a current
matching mint verification. Details: `docs/markov/catalog.md`.

## Endpoints (B05)

| Method | Path                                                     | Principal                                  | Purpose |
| ------ | -------------------------------------------------------- | ------------------------------------------ | ------- |
| GET    | /v1/me/eligibility                                       | user, agent `portfolio:read`               | Latest eligibility decision and its standing, terms to acknowledge, remaining steps, plain summary |
| POST   | /v1/me/eligibility/declarations                          | user (10/min)                              | Declare a jurisdiction (self-declared evidence); records a versioned decision with expiry |
| GET    | /v1/terms/current                                        | anonymous                                  | Active terms documents with content hashes |
| POST   | /v1/me/terms/acknowledgements                            | user (10/min)                              | Acknowledge a document by version and exact hash; idempotent |
| GET    | /v1/me/limits                                            | user, agent `portfolio:read`               | Effective limits, the owner's settings, the ceiling and its source |
| PUT    | /v1/me/limits                                            | user, step-up                              | Tighten owner limits; loosening is refused with the ceiling in `details` |
| GET    | /v1/me/instruments/{instrumentId}/availability           | user, agent `portfolio:read`               | Capability states with conditions; 404 unless the instrument is admitted or paused |
| POST   | /v1/me/policy/evaluations                                | user, agent `proposals:create`             | Deterministic policy decision (`stage` quote or submit); `reserve: true` holds the notional |
| GET    | /v1/me/reservations                                      | user, agent `portfolio:read`               | Pending-spend reservations (expired ones swept) |
| DELETE | /v1/me/reservations/{intentId}                           | user, agent `proposals:create`             | Release a held reservation; 404 when nothing is held |
| POST   | /v1/ops/policy/jurisdiction-rules                        | operator `ops:policy:write`                | Publish an immutable rule set version; becomes active |
| GET    | /v1/ops/policy/jurisdiction-rules                        | operator `ops:policy:read`                 | Published rule sets |
| POST   | /v1/ops/policy/terms                                     | operator `ops:policy:write`                | Publish a terms document (https only); retires the active one for the capability |
| POST   | /v1/ops/policy/eligibility/{decisionId}/revoke           | operator `ops:policy:write`                | Revoke a decision with a reason; 409 when already revoked |
| GET    | /v1/ops/policy/users/{userId}/eligibility                | operator `ops:policy:read`                 | Decision history of a user |
| GET/POST | /v1/ops/policy/participants, DELETE …/{userId}         | operator `ops:policy:read` / `ops:policy:write` | Beta participant allowlist (OD-12) |

Policy decisions answer 201 with `outcome: deny` and a `denials` array
(code, message, limit, observed, unit) rather than an error: a denial is a
successful evaluation. `POLICY_DENIED` remains reserved for execution
sessions that refuse to proceed on a denied decision. Version conflicts
answer `IDEMPOTENCY_CONFLICT` (409). Details: `docs/markov/eligibility-and-policy.md`.

## Endpoints (B06)

| Method | Path                                                     | Principal                                  | Purpose |
| ------ | -------------------------------------------------------- | ------------------------------------------ | ------- |
| POST   | /v1/me/theses                                            | user, agent `research:write`               | Create a thesis with its first revision; research rules apply (`docs/markov/research.md`) |
| GET    | /v1/me/theses                                            | user, agent `research:read`                | Own theses with the current title, claim and `instrumentIds`; `?instrumentId=` keeps only those whose current revision references it (F06 addition) |
| GET    | /v1/me/theses/{thesisId}                                 | user, agent `research:read`                | Thesis, current revision and source records |
| PATCH  | /v1/me/theses/{thesisId}                                 | user                                       | Set `visibility` (private/public) or `status` (archived) |
| POST   | /v1/me/theses/{thesisId}/revisions                       | user, agent `research:write`               | Append an immutable numbered revision; 400 with `details[].path` on a broken rule |
| GET    | /v1/me/theses/{thesisId}/revisions                       | user, agent `research:read`                | Every revision, newest first |
| POST   | /v1/me/theses/{thesisId}/sources                         | user, agent `research:write` (10/min)      | Retrieve a URL under the safe-retrieval policy and record it (`fetched`, `blocked` or `failed` with the reason) |
| GET    | /v1/me/theses/{thesisId}/sources                         | user, agent `research:read`                | Source records, newest first |
| POST   | /v1/me/research/mappings                                 | user, agent `research:read`                | Deterministic company → admitted/paused instrument mapping; unmatched names stay unmatched |
| POST   | /v1/me/research/runs                                     | user, agent `research:write` (10/min)      | Run the bounded model adapter over named fetched sources; 503 `PROVIDER_UNAVAILABLE` when no provider is configured |
| GET    | /v1/me/research/runs                                     | user, agent `research:read`                | Runs, newest first; `?thesisId=` filters |
| GET    | /v1/me/research/runs/{runId}                             | user, agent `research:read`                | Status, provenance and validated output |
| POST   | /v1/me/research/runs/{runId}/cancel                      | user, agent `research:write`               | Cancel a queued or running run; a finished run is returned unchanged |
| GET    | /v1/research/theses/{thesisId}                           | anonymous                                  | Public projection of a published thesis: no private notes, no owner |

Rule violations answer `VALIDATION_FAILED` with one `details` entry per
issue (`statements/0: a fact must cite at least one source`). A refused
retrieval is not an error: the source record says `blocked` and why, and
citing it is refused. Another person's thesis or run is `NOT_FOUND`.

## Endpoints (F04 additions)

| Method | Path                                                     | Principal                     | Purpose |
| ------ | -------------------------------------------------------- | ----------------------------- | ------- |
| GET    | /v1/me/wallets/{walletId}/funding                        | user, agent `portfolio:read`  | Observed SOL and stablecoin balances of one verified wallet from the configured RPC endpoint (`confirmed`), the rent-exempt minimum for a token account, the base fee allowance and a readiness verdict; 503 `PROVIDER_UNAVAILABLE` when the endpoint cannot be read (unknown, never zero) |

The stablecoin observed is USDC on mainnet-beta (`MAINNET_USDC_MINT`) or
`FUNDING_STABLECOIN_MINT` elsewhere; without one the response reports SOL
only and says why. Nothing here is a deposit address of Markov's: the
address is the person's own verified wallet.

## Endpoints (F05 additions)

| Method | Path                                                     | Principal                                  | Purpose |
| ------ | -------------------------------------------------------- | ------------------------------------------ | ------- |
| GET    | /v1/me/watchlist                                         | user, agent `research:read`                | The person's watchlist: contract version 1, a list version that moves on every change, items with the instrument's current public projection (any status, so delisted stays visible) |
| PUT    | /v1/me/watchlist/items/{instrumentId}                    | user                                       | Save an admitted or paused instrument (idempotent, updates the note); `ifVersion` detects an edit made elsewhere (`IDEMPOTENCY_CONFLICT`, 409, with the current version in `details`); `ASSET_NOT_ADMITTED` (409) for other statuses; at most 200 items |
| DELETE | /v1/me/watchlist/items/{instrumentId}?ifVersion=         | user                                       | Remove (idempotent, versioned) |

Watchlists are bookkeeping: saving implies nothing about eligibility,
execution or advice. Details: `packages/contracts/src/watchlist.ts`.

## Endpoints (B07)

| Method | Path                                                     | Principal                                  | Purpose |
| ------ | -------------------------------------------------------- | ------------------------------------------ | ------- |
| GET    | /v1/strategies/limits                                    | anonymous                                  | Recipe rules this deployment enforces: schema version, kinds, exact total, `maxLegs`, issuer and company concentration ceilings and their source |
| POST   | /v1/me/strategies                                        | user, agent `proposals:create`             | Create a strategy with its first draft; the response carries the validation result (errors and warnings by path) |
| GET    | /v1/me/strategies                                        | user, agent `portfolio:read`               | Own strategies, newest first (`?status=archived` for archived ones) |
| GET    | /v1/me/strategies/{strategyId}                           | user, agent `portfolio:read`               | Strategy, validated draft with its revision and the version summaries |
| PATCH  | /v1/me/strategies/{strategyId}                           | user                                       | `status: archived` (no more edits, freezes or forks; history stays) or `active` |
| PUT    | /v1/me/strategies/{strategyId}/draft                     | user, agent `proposals:create`             | Replace the draft; `ifRevision` detects an edit made elsewhere (`IDEMPOTENCY_CONFLICT`, 409, current revision in `details`); invalid content is saved and reported, never renormalised; a constituent may carry 0 bps while drafting (`ZERO_WEIGHT`, F07 addition) |
| POST   | /v1/me/strategies/{strategyId}/versions                  | user (10/min)                              | Freeze the draft as the next immutable version with admission snapshots, disclosures, canonical manifest, `manifestHash` and `contentDigest`; 201, or 200 with the current version when the content is unchanged; 400 `VALIDATION_FAILED` with one `details` entry per error path |
| GET    | /v1/me/strategies/{strategyId}/versions                  | user, agent `portfolio:read`               | Every frozen version, newest first |
| GET    | /v1/me/strategies/{strategyId}/versions/{versionId}      | user, agent `portfolio:read`               | One frozen version |
| GET    | /v1/me/strategies/{strategyId}/versions/{versionId}/diff?against= | user, agent `portfolio:read`      | Machine-readable difference from another version of the same strategy (legs added, removed, changed; cash; turnover) |
| POST   | /v1/me/strategies/{strategyId}/forks                     | user                                       | Fork a version into a new strategy of the caller's own with `forkOf` provenance |
| POST   | /v1/me/instances                                         | user                                       | Follow a version in one of the caller's verified wallets; the pin is explicit |
| GET    | /v1/me/instances                                         | user, agent `portfolio:read`               | Own instances with pinned and proposed versions |
| GET    | /v1/me/instances/{instanceId}                            | user, agent `portfolio:read`               | One instance |
| POST   | /v1/me/instances/{instanceId}/pin                        | user                                       | Accept a version of the same strategy: the only way a pin moves; clears the proposal |

A creator's freeze proposes the new version to every active instance and
moves no pin. No route edits or deletes a version. Another person's
strategy, version or instance is `NOT_FOUND`. Rules, encodings and test
vectors: `docs/markov/strategies.md`.

## Endpoints (B08)

| Method | Path                                                     | Principal                                  | Purpose |
| ------ | -------------------------------------------------------- | ------------------------------------------ | ------- |
| GET    | /v1/registry                                             | anonymous                                  | Program id, network, whether publication is enabled (and why not), record space, leg cap, indexer state (last run, last observed slot, records) |
| POST   | /v1/me/strategies/{strategyId}/versions/{versionId}/publication | user (10/min)                       | Prepare the registration of a frozen version with one of the caller's verified wallets: validates against the program rules, shows `preview` (exactly what becomes public, what never does, the permanence statement) and answers the unsigned transaction; 201, or 200 with the in-flight or registered publication; 503 `PROVIDER_UNAVAILABLE` when no program is configured or the node gives no blockhash |
| GET    | /v1/me/strategies/{strategyId}/versions/{versionId}/publication | user, agent `portfolio:read`        | The latest registration attempt of the version, re-checked against the chain on read; 404 before any preparation |
| POST   | /v1/me/strategies/{strategyId}/versions/{versionId}/status-changes | user (10/min)                    | Prepare a deprecation or reactivation of a registered version; the wallet must be the publisher wallet |
| POST   | /v1/me/publications/{publicationId}/submit               | user (10/min)                              | Submit the wallet-signed transaction. Byte-identical prepared message and a valid publisher signature required (`SIGNATURE_MISMATCH`, 409, otherwise, nothing sent); `PUBLICATION_EXPIRED` (409) once the blockhash is past; a node preflight verdict is recorded as `failed`/`expired` and answered 200; another node error answers 503 and leaves the transaction valid; a lost response records `unknown` |
| GET    | /v1/me/publications/{publicationId}                      | user, agent `portfolio:read`               | A publication re-checked against the chain (`confirmationStatus`, `evidence`, `failure`) |
| GET    | /v1/strategies/{strategyId}                              | anonymous                                  | Public view: the strategy's registered, unmoderated versions with record addresses and status |
| GET    | /v1/strategies/{strategyId}/versions/{versionId}         | anonymous                                  | Public view of a registered version: manifest, canonical bytes, hashes, registration evidence with explorer links, and `verification` (manifest hash recomputed and compared with the indexed record; record content compared with the version) |
| GET    | /v1/registry/records/{address}                           | anonymous                                  | An indexed registry record (permissionless registrations included) with a version link only when that version is public |

Publication states: `awaiting_signature` → `submitted` → `registered`,
with `failed`, `expired` and `unknown` branches, every one decided from
chain observations (`docs/markov/strategy-registry.md`). `registered` is
terminal for a registration and idempotent to prepare or submit again.
Public routes answer 503 when the deployment has no registry program.

### Additions for the app (F08)

| Method | Path                                                     | Principal                                  | Purpose |
| ------ | -------------------------------------------------------- | ------------------------------------------ | ------- |
| GET    | /v1/me/strategies/{strategyId}/versions/{versionId}/status-changes | user, agent `portfolio:read`      | The latest deprecation or reactivation attempt of a version, re-checked against the chain; 404 before any was prepared. Registration attempts stay under `…/publication` |
| GET    | /v1/me/follows                                           | user, agent `research:read`                | The public strategies the person follows, newest follow first, each with the strategy's newest registered, unmoderated version at read time (null when none is public any more) |
| PUT    | /v1/me/follows/{strategyId}                              | user                                       | Follow a strategy that has a registered, unmoderated version (201 new, 200 existing; answers the list); `NOT_FOUND` otherwise, `VALIDATION_FAILED` for your own strategy or beyond 500 follows. A follow is bookkeeping: no instance, no pin, no order |
| DELETE | /v1/me/follows/{strategyId}                              | user                                       | Unfollow (idempotent; answers the list) |

`GET /v1/strategies/{strategyId}` carries `followerCount` (a count, never
who). `POST /v1/me/strategies/{strategyId}/forks` accepts, from any
signed-in person, a version that is registered and not withheld; the owner
keeps forking any of their versions (`docs/markov/strategies.md`).

### Additions for the app (F09)

None. The app's review (`/review/new`, `/review/{intentId}`) consumes the
B09 planning routes below through its own proxy: it creates the intent
with a per-visit idempotency key, asks for a plan with an empty JSON
object as the body (the proxy requires a JSON body on mutations; the
route ignores it), reads the plan it points to, acknowledges by plan hash
and cancels. Signing and submission arrive with B10/F10.

## Endpoints (B09)

| Method | Path                                                     | Principal                                  | Purpose |
| ------ | -------------------------------------------------------- | ------------------------------------------ | ------- |
| POST   | /v1/me/intents                                           | user (30/min)                              | Create an investment intent: a basket investment in a pinned version the caller owns or a public one, a single buy of an admitted instrument, or (B10) a single sell; the budget is raw units of the platform stablecoin from one of the caller's verified wallets; slippage never above the owner's limit. A reviewed completion (B11) sets `continuationOfIntentId` to one of the caller's `PARTIALLY_COMPLETED` baskets: same wallet and version, budget equal to the sum of the unfilled legs' original targets (`VALIDATION_FAILED` names the field; a basket continued once is refused again). 201 new, 200 for the same idempotency key with the same request, `IDEMPOTENCY_CONFLICT` (409) for the same key with another. Nothing is quoted or reserved |
| GET    | /v1/me/intents                                           | user, agent `portfolio:read`               | The caller's intents, newest first (at most 50) |
| GET    | /v1/me/intents/{intentId}                                | user, agent `portfolio:read`               | One intent with its state, reason and latest plan reference; an open intent past its 24-hour lifetime is answered as `EXPIRED` |
| POST   | /v1/me/intents/{intentId}/plans                          | user (20/min)                              | Build a bounded plan: admission re-checked per constituent, funds observed (`INSUFFICIENT_FUNDS`, 409, before any venue call), integer allocation (`VALIDATION_FAILED` with the smallest workable budget below a route minimum; a continuation keeps the original targets), one venue quote per constituent checked against the request, the owner's limits and the reviewed program matrix (`PROVIDER_UNAVAILABLE`, 503, when the venue fails or a quote is refused; also when no venue is configured), one policy decision per constituent (`POLICY_DENIED`, 403, with denials), for several constituents the whole-basket composition measured and simulated on the node (B11: `grouping.mode` `atomic` with `reason: composition_fits`, `composition` and `validity.simulation`, else `staged` with the reason), then the hashed plan (201). A new plan supersedes the intent's earlier ones |
| GET    | /v1/me/intents/{intentId}/plans/{planId}                 | user, agent `portfolio:read`               | A plan with its review state and current validity (`valid`, `expired`, `superseded`) |
| POST   | /v1/me/intents/{intentId}/plans/{planId}/acknowledgements | user                                      | Bind the owner's review to the plan hash: `PLAN_CHANGED` (409) for another hash or a superseded plan, `QUOTE_EXPIRED` (409) past validity, `VALIDATION_FAILED` for a staged plan without `stagedAcknowledged`; the intent moves to `AWAITING_APPROVAL`; idempotent for the same hash |
| POST   | /v1/me/intents/{intentId}/cancel                         | user                                       | Cancel before any signature (idempotent); after a broadcast a `CANCEL_REQUESTED` settled by reconciliation (B10); between the transactions of a staged basket that already filled a leg the intent ends `PARTIALLY_COMPLETED` with the prepared later transaction withdrawn (B11); refused for terminal intents |

Intent states in B09: `DRAFT` → `QUOTED` → `AWAITING_APPROVAL`, with
`EXPIRED` and `CANCELLED`; the execution states follow in B10
(`docs/markov/execution-state-machine.md`). Plans built from the fixture
venue are labelled `mode: fixture` and execute only against the fixture
chain of local and test modes. The build document proposes these operations
under `/v1/intents`; this API keeps every owner-scoped resource under
`/v1/me/` as the other sessions do. Since B10 `POST /v1/me/intents` also
creates a `single_sell` (the budget is raw units of the instrument to sell
for the platform stablecoin) and `cancel` records a `CANCEL_REQUESTED` after
a broadcast (`PLAN_CHANGED` when the intent moves meanwhile).

## Endpoints (B10, B11)

| Method | Path                                                                   | Principal                    | Purpose |
| ------ | ---------------------------------------------------------------------- | ---------------------------- | ------- |
| POST   | /v1/me/intents/{intentId}/transactions                                 | user (20/min)                | Build, decode, validate against the acknowledged plan and simulate the plan's next transaction: one composed transaction for an atomic plan (a single leg, or every leg of a basket that fit and passed at plan time), or the next batch of a staged plan, built only after the previous one finalized with its fills recorded and after its leg was quoted again within the approved bounds (B11). Stored and answered as a `PreparedTransaction` (201) with `batch`, `legIndexes`, decoded instructions, validated effects (per leg) and simulation evidence; the intent moves to `AUTHORIZED`. `TRANSACTION_REFUSED` (409, `details[0]` names `PLAN_NOT_APPROVED`, `VALIDATION_FAILED` with one detail per failed check, `SIMULATION_FAILED`, `ATTEMPT_IN_FLIGHT`, `LEG_TERMS_CHANGED` with the intent ending `PARTIALLY_COMPLETED`, `BATCH_NOT_READY`, `PLAN_COMPLETED`), `QUOTE_EXPIRED` past the plan's validity (the intent ends `EXPIRED`, or `PARTIALLY_COMPLETED` after earlier fills), `PLAN_CHANGED` when the intent moved on, `PROVIDER_UNAVAILABLE` without a building or composing venue or node. A rebuild supersedes an unsigned or expired earlier transaction of the same batch |
| POST   | /v1/me/intents/{intentId}/transactions/{transactionIndex}/submissions  | user (20/min)                | Submit the owner-signed transaction: byte-identical prepared message, exactly one valid Ed25519 signature by the expected signer (`SIGNATURE_MISMATCH` otherwise, nothing sent); earlier batches finalized (`TRANSACTION_REFUSED`/`BATCH_NOT_READY`); plan still valid (`QUOTE_EXPIRED`) and blockhash still able to land (`TRANSACTION_REFUSED`/`TRANSACTION_EXPIRED`); policy at stage `submit` with one reservation per leg (`POLICY_DENIED`, every hold released); the attempt persisted before the one broadcast. 201 with the execution status for a new attempt (`SUBMITTED`, `FAILED` on a preflight verdict, `UNKNOWN_REQUIRES_RECONCILIATION` without an answer); 200 with the status when the same signed bytes were submitted before. A retry never creates a second attempt |
| GET    | /v1/me/intents/{intentId}/execution                                    | user, agent `portfolio:read` | Execution status: `batches` (one per batch of the plan: `pending`, `prepared`, `submitting`, `submitted`, `confirmed`, `finalized`, `failed`, `expired`, `cancelled`, `unknown`, `stale`, with transaction, attempt, signature and reason), current prepared transactions, attempts, fills (one per leg, from the landed transactions' balance changes), reconciliation evidence and `nextAction` (`build`, `sign`, `wait`, `reconcile`, `review`, `none`; `review` for a `PARTIALLY_COMPLETED` basket); a live attempt is reconciled from the node on the way (throttled to every 2 s) and unsigned transactions whose blockhash passed are marked expired |
| POST   | /v1/me/intents/{intentId}/execution/reconciliations                    | user (60/min)                | Reconcile a live attempt now: signature status and finalized block height, the same bytes resent while the blockhash lives, states settled on evidence only; a non-final transaction of a staged plan returns the intent to `AUTHORIZED` for the next one |

Error code added in B10: `TRANSACTION_REFUSED` (409). Capability rows:
`execution.jupiter.build` and `execution.spot.submit` are FIXTURE_VERIFIED
(B10 single legs, B11 composed and staged baskets).

## Endpoints (B12)

| Method | Path                                          | Principal                    | Purpose |
| ------ | --------------------------------------------- | ---------------------------- | ------- |
| GET    | /v1/me/wallets/{walletId}/holdings            | user, agent `portfolio:read` | Wallet holdings after projecting any settled fill not yet journaled: per asset the journal's wallet balance, the chain balance at the latest checkpoint, the difference, the status (`matched`, `unobserved`, `stale`, `needs_reconciliation`, `unassigned_asset`) and the attribution (open lots per instance, awaiting reconciliation, wallet level); the checkpoint, the unexplained entry ids, `lotPolicy: fifo`. Raw units only; nothing valued |
| POST   | /v1/me/wallets/{walletId}/reconciliations     | user (30/min)                | Read lamports and every SPL and Token-2022 balance from the node, compare with the journal, record a checkpoint and an `external_inflow`/`external_outflow` entry per unexplained difference in a known asset (`PROVIDER_UNAVAILABLE` when the node does not answer; nothing recorded then). Answers the holdings |
| GET    | /v1/me/wallets/{walletId}/journal             | user, agent `portfolio:read` | The append-only journal, oldest first (at most 200): balanced entries with lines per account and asset, source kind and reference, attribution, acknowledgement |
| POST   | /v1/me/journal/{entryId}/acknowledgements     | user                         | Explain an external flow (`deposit`, `withdrawal`, `transfer`, `other`, note): `needs_reconciliation` becomes `unassigned`; `VALIDATION_FAILED` for any other entry |
| POST   | /v1/me/journal/projections                    | user                         | Project the caller's settled fills into the journal now; the report counts fills seen, entries appended and existing, lots opened and consumed. Idempotent |
| GET    | /v1/me/instances/{instanceId}/holdings        | user, agent `portfolio:read` | Open lots attributed to the instance per asset, cost basis in the stablecoin and fees paid (bookkeeping, not a valuation), reconciliation status |
| POST   | /v1/me/intents/{intentId}/receipts            | user (60/min)                | Issue a signed `decision` or `execution` receipt (body `{kind}`; 201 new, 200 existing for the same intent, kind and state). `VALIDATION_FAILED` without an acknowledged plan or, for `execution`, without a submitted attempt; `PROVIDER_UNAVAILABLE` without a signing key |
| GET    | /v1/me/intents/{intentId}/receipts            | user, agent `portfolio:read` | Receipts of an intent, oldest first |
| GET    | /v1/me/receipts                               | user, agent `portfolio:read` | The caller's receipts, newest first (at most 100) |
| POST   | /v1/me/receipts/{receiptId}/visibility        | user                         | `{public}`: opt a receipt into or out of public reading |
| GET    | /v1/receipts/keys                             | public                       | Verification keys (key id, algorithm, public key, status, validity) and the signing domain |
| GET    | /v1/receipts/{receiptId}                      | public / user / agent        | The complete receipt for its owner and read-scoped agents; a public receipt with the owner id omitted for anyone else; `NOT_FOUND` otherwise (private receipts are not revealed) |

Capability rows: `accounting.journal` and `receipts.signing` are
FIXTURE_VERIFIED (B12). Contract: `docs/markov/accounting-methodology.md`.

## Planned surface

Discovery, valuation and rankings, maintenance, agents and operations
routes are specified in the build document and arrive with sessions B13 to
B18. Authentication,
idempotency keys, cursor pagination and streaming are introduced with the
first routes that need them (B02, B07, B10).
