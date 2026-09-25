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
| Wallets page: verified list (`GET /api/markov/v1/me/wallets`) | `GET /v1/me/wallets` | B02 | `AUTH_REQUIRED` → session revalidated; unreachable → error block, never an empty list | IMPLEMENTED, FIXTURE_VERIFIED (proxy and jsdom tests), e2e against the local API (F04) |
| Ownership verification (challenge → `solana:signMessage` → link) | `POST /v1/me/wallets/challenges`, `POST /v1/me/wallets` | B02 | `CHALLENGE_INVALID` (replay/expiry), `WALLET_ALREADY_LINKED` (recovery guidance, no automatic transfer), `STEP_UP_REQUIRED`, `RATE_LIMITED`; wallet declined/altered message; session or wallet changed mid-flow → nothing submitted | IMPLEMENTED, FIXTURE_VERIFIED, e2e with an injected Wallet Standard wallet (F04) |
| Unlink (confirm dialog, step-up) | `DELETE /v1/me/wallets/{walletId}` | B02 | `STEP_UP_REQUIRED` → "sign in again"; `NOT_FOUND` | IMPLEMENTED, e2e-adjacent (dialog covered in jsdom) |
| Receive and funding panel | `GET /v1/me/wallets/{walletId}/funding` (added in F04) | B02/B01 RPC reads | `PROVIDER_UNAVAILABLE` → "Balances unknown right now" (never zero); `NOT_FOUND` for foreign wallets | IMPLEMENTED, FIXTURE_VERIFIED against the fixture RPC; live cluster reads not yet verified |
| Eligibility page and home checklist | `GET /v1/me/eligibility`, `POST /v1/me/eligibility/declarations`, `GET /v1/terms/current`, `POST /v1/me/terms/acknowledgements` | B05 | `VALIDATION_FAILED` (hash mismatch, bad code), `RATE_LIMITED`; unknown outcome shown as unknown | IMPLEMENTED, FIXTURE_VERIFIED, e2e with the fixture rule set (F04) |
| Explore: Instruments tab (`GET /api/markov/v1/catalog/instruments?q&issuer&kind&limit&cursor`) | `GET /v1/catalog/instruments` | B03/B04 | `VALIDATION_FAILED`, `RATE_LIMITED`, `PROVIDER_UNAVAILABLE` and unreachable → error block with retry; contract mismatch → "unexpected shape", never an empty catalog | IMPLEMENTED, FIXTURE_VERIFIED (proxy and jsdom), e2e against the local API with admitted fixture instruments (F05) |
| Market detail: identity, price, verification, lifecycle, availability | `GET /v1/catalog/instruments/{instrumentId}` | B03/B04 | `NOT_FOUND` → "No admitted instrument with that id"; unreachable → error block | IMPLEMENTED, FIXTURE_VERIFIED, e2e (F05) |
| Market detail: corporate actions and multiplier history | `GET /v1/catalog/instruments/{instrumentId}/corporate-actions`, `…/multipliers` | B04 | `NOT_FOUND`; a failed read leaves the section out rather than inventing history | IMPLEMENTED, FIXTURE_VERIFIED (F05) |
| Market detail: what you can do now (signed in) | `GET /v1/me/instruments/{instrumentId}/availability` | B05 | `AUTH_REQUIRED` → session revalidated; a failed read keeps the public availability and says so | IMPLEMENTED, FIXTURE_VERIFIED, e2e (F05) |
| Watchlist tab and Save controls | `GET /v1/me/watchlist`, `PUT /v1/me/watchlist/items/{instrumentId}`, `DELETE /v1/me/watchlist/items/{instrumentId}?ifVersion=` (added in F05) | F05 backend addition | `IDEMPOTENCY_CONFLICT` → refreshed with "changed on another device"; `ASSET_NOT_ADMITTED`; `NOT_FOUND`; `AUTH_REQUIRED` | IMPLEMENTED, FIXTURE_VERIFIED (API, proxy, jsdom), e2e (F05) |
| Research workspace and instrument Research tab | `GET /v1/me/theses` (`?instrumentId=` and `instrumentIds` added in F06), `POST /v1/me/theses` | B06 | `AUTH_REQUIRED` → session revalidated; `VALIDATION_FAILED` (markup, empty) shown on the field; unreachable → error block, never an empty workspace | IMPLEMENTED, FIXTURE_VERIFIED (proxy and jsdom), e2e against the local API (F06) |
| Thesis editor | `GET /v1/me/theses/{thesisId}`, `POST …/revisions`, `GET …/revisions`, `PATCH /v1/me/theses/{thesisId}` | B06 | `NOT_FOUND` → falls back to the public projection, then "not found or private"; `VALIDATION_FAILED` → rules listed by field with the edits kept; `RATE_LIMITED`; `FORBIDDEN` (agent publishing) | IMPLEMENTED, FIXTURE_VERIFIED, e2e (F06) |
| Sources panel | `POST /v1/me/theses/{thesisId}/sources`, `GET …/sources` | B06 (safe retrieval in the API) | a `blocked` or `failed` record is a 201 with its reason, shown as such; `VALIDATION_FAILED` (non-https) on the field; `RATE_LIMITED` | IMPLEMENTED, FIXTURE_VERIFIED, e2e with the fixture issuer source and a refused metadata address (F06) |
| Research runs | `POST /v1/me/research/runs`, `GET /v1/me/research/runs?thesisId=`, `GET …/runs/{runId}` (polled while queued or running), `POST …/runs/{runId}/cancel` | B06 | `PROVIDER_UNAVAILABLE` → "runs are not available in this deployment"; `RATE_LIMITED`; `NOT_FOUND` | IMPLEMENTED, FIXTURE_VERIFIED (jsdom: progress, cancel, adoption), e2e with the fixture adapter (F06); no hosted provider (OD-19) |
| Shortlist mapping | `POST /v1/me/research/mappings` | B06 | `VALIDATION_FAILED` | IMPLEMENTED, FIXTURE_VERIFIED (F06) |
| Public thesis page | `GET /v1/research/theses/{thesisId}` (anonymous) | B06 | `NOT_FOUND` → "not found or private" | IMPLEMENTED, FIXTURE_VERIFIED, e2e (F06) |
| Shortlist to basket, "Add to a new basket draft", Build page draft list | `GET /v1/strategies/limits`, `POST /v1/me/strategies`, `GET /v1/me/strategies` | B07 | `VALIDATION_FAILED` shown verbatim from the backend's validation; `AUTH_REQUIRED` | IMPLEMENTED, FIXTURE_VERIFIED, e2e (F06) |
| Basket builder: draft identity, revision-checked autosave, archive | `GET /v1/me/strategies/{strategyId}`, `PUT /v1/me/strategies/{strategyId}/draft` (`ifRevision`), `PATCH /v1/me/strategies/{strategyId}` | B07 (draft legs may carry 0 bps since F07; `ZERO_WEIGHT` reported) | `IDEMPOTENCY_CONFLICT` → conflict panel with compare and restore; unreachable → "Offline changes" kept on the device with retry; `VALIDATION_FAILED` (archived) → not saved with the reason; `NOT_FOUND` → not found | IMPLEMENTED, FIXTURE_VERIFIED (jsdom: 9,999/10,000/10,001, duplicates, cash-only, two-tab, offline), e2e against the local API (F07) |
| Set Rules: the person's effective limits | `GET /v1/me/limits` | B05 | `AUTH_REQUIRED`; a failed read says the backend still enforces them | IMPLEMENTED, FIXTURE_VERIFIED (F07) |
| Activate: wallets, balances, eligibility, per-constituent availability | `GET /v1/me/wallets`, `GET /v1/me/wallets/{walletId}/funding`, `GET /v1/me/eligibility`, `GET /v1/me/instruments/{instrumentId}/availability` | B02/B05/F04 | as in F04/F05; unknown shown as unknown | IMPLEMENTED, FIXTURE_VERIFIED, e2e with the fixture wallet and fixture RPC funding (F07) |
| Component reference | none (fixture data, internal route) | n/a | n/a | IMPLEMENTED |
| Formatters (`@markov/formatters`) | consume `TypedPrice`, raw amounts, basis points from `@markov/contracts` | contracts | n/a | FIXTURE_VERIFIED |

Watchlists were added to the backend in F05 as a versioned owner-scoped
contract (`docs/markov/api.md`); F06 added the `instrumentId` filter and
`instrumentIds` to the thesis list. The other contract additions proposed by
the frontend prompt and not yet present in the backend (capability
bootstrap, preferences, notification read status, stream configuration,
privacy export/deletion, device status, simulation reports) are tracked as
contract gaps in the session that first
needs them; none is assumed to exist. F03 added two fields to existing
contracts in the backend's own architecture (`identityProvider` on
`/v1/platform`, `session` on `/v1/me`), regenerated the OpenAPI document and
updated the API tests.
