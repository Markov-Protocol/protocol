# API

Status: B01 exposes only platform endpoints. The committed OpenAPI document is
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

Catalog prices are typed reference marks (`issuer_mark`,
`implied_valuation`, `secondary_market`), never `execution_quote`.
`ADMISSION_BLOCKED` (409) answers an admit or resume without a current
matching mint verification. Details: `docs/markov/catalog.md`.

## Planned surface

Identity, catalog, eligibility, research, strategies, discovery, portfolio,
execution, receipts, maintenance, agents and operations routes are specified
in the build document and arrive with sessions B02 to B18. Authentication,
idempotency keys, cursor pagination and streaming are introduced with the
first routes that need them (B02, B07, B10).
