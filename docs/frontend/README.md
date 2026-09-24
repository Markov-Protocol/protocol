# Markov web application (markov.pet)

Status: session **F01** delivered the shared design system, the exact
formatters, the Next.js workspace and an internal component reference;
session **F02** delivered the full-screen Mark I shell, the companion home
and honest placeholder routes for every navigation target. Product features
arrive with F03 onward; nothing in this app is deployed.

## Install, run, build

```sh
pnpm install --frozen-lockfile
pnpm build                       # backend graph (contracts are consumed by the app)
pnpm web:dev                     # http://127.0.0.1:3000 (Next.js dev server)
MARKOV_WEB_INTERNAL_ROUTES=true pnpm web:dev   # also serves /dev/components

pnpm web:typecheck               # formatters, ui and web
pnpm exec vitest run --project web
pnpm web:build                   # production build; fails on an unsafe MARKOV_ENV combination
pnpm web:e2e                     # Playwright evidence (builds must exist; see docs/frontend/verification.md)
```

## Environment

| Variable                      | Scope   | Meaning |
| ----------------------------- | ------- | ------- |
| `MARKOV_ENV`                  | server  | Runtime mode shared with the backend (`local`, `test`, `staging`, `mainnet-read-only`, `production`). |
| `MARKOV_WEB_INTERNAL_ROUTES`  | server  | Serves internal-only routes such as `/dev/components`. Refused in production. |
| `MARKOV_WEB_FIXTURES`         | server  | Enables development/test fixture adapters (none exist yet). Refused in production, staging and read-only mainnet. |
| `NEXT_PUBLIC_APP_ORIGIN`      | public  | Public origin of the deployment; required (https) in production. |

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
| Sessions, wallets, discovery, research, builder, publishing, review, execution, portfolio, rankings, maintenance, companion, settings | F03 onward | not started; each needs its backend session (B02 onward) |

## Backend prerequisites

F01 depends only on B01 (`@markov/contracts`, workspace conventions). F03
and later require B02 and later backend sessions; the app never reads
provider endpoints directly.
