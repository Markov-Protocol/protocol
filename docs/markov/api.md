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
  IDEMPOTENCY_CONFLICT 409, POLICY_DENIED 403, PROVIDER_UNAVAILABLE and
  SERVICE_NOT_READY 503, INTERNAL 500. Messages never include secrets or
  another principal's resource existence.
- Request bodies are limited to `API_BODY_LIMIT_BYTES` (default 256 KiB);
  a global rate limit of `API_RATE_LIMIT_MAX_PER_MINUTE` applies per client
  address (per-route limits arrive with the routes that need them).
- CORS: only exact origins from `API_ALLOWED_ORIGINS`; no origins configured
  means no CORS headers at all. Credentialed wildcard is impossible by
  configuration.

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

## Planned surface

Identity, catalog, eligibility, research, strategies, discovery, portfolio,
execution, receipts, maintenance, agents and operations routes are specified
in the build document and arrive with sessions B02 to B18. Authentication,
idempotency keys, cursor pagination and streaming are introduced with the
first routes that need them (B02, B07, B10).
