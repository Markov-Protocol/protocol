# API

Status: platform (B01), identity (B02), catalog (B03/B04), policy (B05), funding (F04) and research (B06) endpoints are live. The committed OpenAPI document is
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
| GET    | /v1/me/theses                                            | user, agent `research:read`                | Own theses with the current title and claim |
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

## Planned surface

Strategies, discovery, portfolio,
execution, receipts, maintenance, agents and operations routes are specified
in the build document and arrive with sessions B07 to B18. Authentication,
idempotency keys, cursor pagination and streaming are introduced with the
first routes that need them (B02, B07, B10).
