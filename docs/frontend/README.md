# Markov web application (markov.pet)

Status: session **F01** delivered the shared design system, the exact
formatters, the Next.js workspace and an internal component reference;
session **F02** delivered the full-screen Mark I shell, the companion home
and honest placeholder routes for every navigation target; session **F03**
delivered the one authentication and session experience (server-verified
HttpOnly session cookie, sign-in, expiry recovery, sign-out, account switch
isolation) and the generated API client. Nothing in this app is deployed.

## Install, run, build

```sh
pnpm install --frozen-lockfile
pnpm build                       # backend graph (contracts are consumed by the app)
pnpm dev:api                     # the API on http://127.0.0.1:3000 (needs PostgreSQL; IDENTITY_PROVIDER=test)
pnpm web:dev                     # http://127.0.0.1:3100 (Next.js dev server; MARKOV_API_ORIGIN defaults to the API above)
MARKOV_WEB_INTERNAL_ROUTES=true pnpm web:dev   # also serves /dev/components

pnpm web:typecheck               # formatters, ui and web
pnpm exec vitest run --project web
pnpm web:build                   # production build; fails on an unsafe MARKOV_ENV combination
pnpm api-client:generate         # regenerate packages/api-client from docs/markov/openapi.json
pnpm web:e2e                     # Playwright evidence (builds must exist; see docs/frontend/verification.md)
MARKOV_TEST_DATABASE_URL=postgres://markov:markov@127.0.0.1:5432/markov_test pnpm web:e2e   # also the auth journeys against a real API
```

## Environment

| Variable                      | Scope   | Meaning |
| ----------------------------- | ------- | ------- |
| `MARKOV_ENV`                  | server  | Runtime mode shared with the backend (`local`, `test`, `staging`, `mainnet-read-only`, `production`). |
| `MARKOV_WEB_INTERNAL_ROUTES`  | server  | Serves internal-only routes such as `/dev/components`. Refused in production. |
| `MARKOV_WEB_FIXTURES`         | server  | Enables development/test fixture adapters (none exist yet). Refused in production, staging and read-only mainnet. |
| `NEXT_PUBLIC_APP_ORIGIN`      | public  | Public origin of the deployment; required (https) in production. Also decides the session cookie's `Secure` attribute in local mode. |
| `MARKOV_API_ORIGIN`           | server  | Origin of the Markov API. Defaults to `http://127.0.0.1:3000` in local and test; required and https elsewhere. Never public. |

Provider secrets, RPC credentials and signing keys never appear in this
app's environment. `apps/web/src/config/web-env.ts` validates the
combination at build time (`next.config.ts`) and at server start
(`instrumentation.ts`).

## Feature map and readiness

| Area                                  | Session | Readiness after F01 |
| ------------------------------------- | ------- | ------------------- |
| Design tokens, typography, spacing    | F01     | IMPLEMENTED, FIXTURE_VERIFIED (contrast measured in tests) |
| Buttons, inputs, select, search, amount and percent fields, badges, notices, menus, dialogs, tabs, skeletons, empty and error states, tables, validation summary | F01 | IMPLEMENTED, FIXTURE_VERIFIED (component tests, axe) |
| Exact amount/basis-point/price/time/address formatting | F01 | IMPLEMENTED, FIXTURE_VERIFIED |
| Internal component reference route    | F01     | IMPLEMENTED (disabled in production) |
| Production guard against development switches | F01 | IMPLEMENTED, FIXTURE_VERIFIED |
| Baseline security headers             | F01     | IMPLEMENTED (full CSP in F19/F20) |
| Mark I shell (frame, screen, eyes, top bar, rail/bottom navigation, modes, focus preference), companion home, unavailable pages | F02 | IMPLEMENTED, FIXTURE_VERIFIED (jsdom tests, Playwright at five widths, lab performance baseline) |
| Sessions: server-verified HttpOnly cookie, sign-in with the development issuer, callback outcomes, expiry recovery with return path, sign-out, account switch isolation, principal-scoped caches, connection status | F03 | IMPLEMENTED, FIXTURE_VERIFIED (node and jsdom tests), verified against the local API in Playwright; hosted identity provider adapter BLOCKED (OD-05) |
| Generated API client (`@markov/api-client`) with contract matrix and drift check | F03 | IMPLEMENTED, FIXTURE_VERIFIED |
| Wallets, discovery, research, builder, publishing, review, execution, portfolio, rankings, maintenance, companion, settings | F04 onward | not started; each needs its backend session (B03 onward) |

## Backend prerequisites

F01 depends only on B01 (`@markov/contracts`, workspace conventions). F03
uses B02 (`/v1/auth/sessions`, `/v1/me`, `/v1/auth/sessions/current`) and
`/v1/platform`; later sessions require later backend sessions. The app never
reads provider endpoints directly and the browser never calls the API.
