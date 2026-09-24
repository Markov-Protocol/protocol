# Screen to contract map

The app calls the Markov API only from its own server. `packages/api-client`
(`@markov/api-client`) is generated from the backend's frozen OpenAPI
document (`docs/markov/openapi.json`) by `pnpm api-client:generate`;
`pnpm api-client:check` fails CI when the committed types drift. Responses
the app relies on are validated at runtime with the shared zod contracts,
so a renamed field or an unknown enum value surfaces as
`MarkovContractMismatchError` and a visible failure, never as a guess. The
matrix below is code (`packages/api-client/src/matrix.ts`) and is proven
against the document by `packages/api-client/test/compatibility.test.ts`.

| Screen / component | SDK operation | Backend owner | Errors handled | Readiness |
| ------------------ | ------------- | ------------- | -------------- | --------- |
| Top bar connection status; sign-in provider availability | `GET /v1/platform` | B01/B02 (`identityProvider` added in F03) | unreachable → "Backend unreachable"; contract mismatch → unreachable | IMPLEMENTED, FIXTURE_VERIFIED, LIVE_READ_VERIFIED against the local API |
| Sign-in (`POST /api/auth/sign-in` → server exchange) | `POST /v1/auth/sessions` (and the hidden nonproduction `POST /v1/auth/test-tokens`) | B02 | `AUTH_REQUIRED` (token refused), `RATE_LIMITED` (429 with retry copy), `VALIDATION_FAILED`, unreachable (503) | IMPLEMENTED, FIXTURE_VERIFIED (handler tests), LIVE_READ/WRITE against the local API in e2e; hosted provider BLOCKED (OD-05) |
| Session resolution (`GET /api/auth/session`, root layout) | `GET /v1/me` (`session.expiresAt` added in F03) | B02 | `AUTH_REQUIRED` → signed-out and cookie cleared; unreachable → "unavailable" (cookie kept, nothing private shown) | IMPLEMENTED, FIXTURE_VERIFIED, e2e against the local API |
| Sign out (`POST /api/auth/sign-out`) | `DELETE /v1/auth/sessions/current` | B02 | `AUTH_REQUIRED` counts as signed out; unreachable → cookie cleared, `revoked: false` reported | IMPLEMENTED, FIXTURE_VERIFIED, e2e |
| Component reference | none (fixture data, internal route) | n/a | n/a | IMPLEMENTED |
| Formatters (`@markov/formatters`) | consume `TypedPrice`, raw amounts, basis points from `@markov/contracts` | contracts | n/a | FIXTURE_VERIFIED |

Contract additions proposed by the frontend prompt and not yet present in the
backend (capability bootstrap, watchlists, preferences, notification read
status, stream configuration, privacy export/deletion, device status,
simulation reports) are tracked as contract gaps in the session that first
needs them; none is assumed to exist. F03 added two fields to existing
contracts in the backend's own architecture (`identityProvider` on
`/v1/platform`, `session` on `/v1/me`), regenerated the OpenAPI document and
updated the API tests.
