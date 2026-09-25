# Markov web application (markov.pet)

Status: session **F01** delivered the shared design system, the exact
formatters, the Next.js workspace and an internal component reference;
session **F02** delivered the full-screen Mark I shell, the companion home
and honest placeholder routes for every navigation target; session **F03**
delivered the one authentication and session experience (server-verified
HttpOnly session cookie, sign-in, expiry recovery, sign-out, account switch
isolation) and the generated API client; session **F04** delivered wallet
selection and ownership verification, receive/funding status, eligibility
and terms screens and the live readiness checklist; session **F05**
delivered Explore's Instruments tab over real backend-admitted
instruments, the exact-id market detail page and account-scoped
watchlists; sessions **F06** to **F08** delivered sourced research, the
basket builder and publishing with version history; session **F09**
delivered the one review screen for basket investments and single buys
over the B09 execution plans (every term, bound to the plan hash, approved
before any wallet is asked to sign). Nothing in this app is deployed.

## Design reference

`docs/frontend/design-reference/` holds the three reference screens the
product owner supplied as the exact visual target (Explore with the
Strategies tab, the builder's Set Rules stage, and a perpetual-strategy
concept that is a future preview only) with notes on what each fixes and
how the current screens are realigned to them from F10 on (F10: tokens,
navigation, environment chip; the top-bar link row and the reference
tables remain for a shell pass).

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
MARKOV_TEST_DATABASE_URL=postgres://markov:markov@127.0.0.1:5432/markov_test pnpm web:e2e   # also the auth and wallet journeys against a real API (fixture RPC on 3901)

pnpm docs:start                  # the documentation site (apps/docs) on http://127.0.0.1:3200/docs/
MARKOV_DOCS_ORIGIN=http://127.0.0.1:3200 pnpm web:dev   # the app proxies /docs to it (unset: /docs is not served)
```

## Environment

| Variable                      | Scope   | Meaning |
| ----------------------------- | ------- | ------- |
| `MARKOV_ENV`                  | server  | Runtime mode shared with the backend (`local`, `test`, `staging`, `mainnet-read-only`, `production`). |
| `MARKOV_WEB_INTERNAL_ROUTES`  | server  | Serves internal-only routes such as `/dev/components`. Refused in production. |
| `MARKOV_WEB_FIXTURES`         | server  | Enables development/test fixture adapters (none exist yet). Refused in production, staging and read-only mainnet. |
| `NEXT_PUBLIC_APP_ORIGIN`      | public  | Public origin of the deployment; required (https) in production. Also decides the session cookie's `Secure` attribute in local mode. |
| `MARKOV_API_ORIGIN`           | server  | Origin of the Markov API. Defaults to `http://127.0.0.1:3000` in local and test; required and https elsewhere. Never public. |
| `MARKOV_DOCS_ORIGIN`          | server  | Origin serving the documentation site under `/docs` (`apps/docs`). A bare origin, https outside local and test. When set, `/docs` and `/docs/*` are rewritten to it; unset means `/docs` is not served. |

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
| Wallets: Wallet Standard discovery and capability checks, explicit selection and account choice, network check, ownership verification through the B02 challenge with replay/already-linked/stale-sign-in/altered-signature/context-change outcomes, unlink, disconnect vs sign out, wallet chip in the top bar | F04 | IMPLEMENTED, FIXTURE_VERIFIED (jsdom), verified in Playwright with an injected fixture wallet against the local API; real browser wallets and the hosted embedded wallet (OD-05) not verified |
| Receive and funding: own address with copy and QR, cluster and stablecoin mint, observed SOL/stablecoin balances, fee requirement with basis, unknown shown as unknown | F04 | IMPLEMENTED, FIXTURE_VERIFIED against the fixture RPC; live cluster reads not verified |
| Eligibility and terms screens, live home checklist, settings index, app-owned API proxy (`/api/markov/*`) | F04 | IMPLEMENTED, FIXTURE_VERIFIED, e2e with the fixture rule set (B05) |
| Explore Instruments tab: search, category and issuer filters kept in the URL, PreStocks collection and xStocks filter, bounded cursor pagination, Company · Issuer · Network identity, backend-typed reference prices with stale and unpriced states, availability with reasons, catalog source timestamps, late-response guard | F05 | IMPLEMENTED, FIXTURE_VERIFIED (jsdom), e2e against the local API with admitted fixture instruments; live issuer feeds BLOCKED (OD-17, OD-18) |
| Market detail `/markets/[instrumentId]`: Overview (sanitised issuer description with source, what the token is, reference price basis, what you can do now with public and personal capability states, lifecycle notices and corporate actions, "History unavailable"), Research and Liquidity placeholders naming their sessions, Instrument (mint with copy and explorer link, program, decimals, verification evidence, extension policy, multiplier evidence) | F05 | IMPLEMENTED, FIXTURE_VERIFIED, e2e |
| Watchlists: versioned owner-scoped contract (`GET /v1/me/watchlist`, `PUT`/`DELETE …/items/{instrumentId}`), save from rows and detail, Watchlist tab with current statuses (delisted stays visible), conflict detection across devices, sign-in prompt for anonymous browsing | F05 | IMPLEMENTED, FIXTURE_VERIFIED (API, proxy, jsdom), e2e |
| Research workspace `/research` and thesis editor `/research/[thesisId]`: typed statements (sourced fact, issuer assertion, opinion, labelled model interpretation) with citations, counterarguments, shortlist by canonical id with a catalog picker, research subjects with deterministic mapping, source records with fetched/refused/failed states and dates, bounded research runs with progress, cancel and adoption, private notes kept out of the hash and the public page, publish with "what becomes public", archive, saved revisions with two-tab notice, shortlist to a B07 basket draft; market Research tab (theses per instrument, start one), rights and evidence, honest route observations, "Add to a new basket draft"; Build page listing basket drafts | F06 | IMPLEMENTED, FIXTURE_VERIFIED (jsdom), e2e against the local API with the fixture issuer source and fixture model adapter; no hosted model provider (OD-19); the basket editor arrives with F07 |
| Basket builder `/strategies/new` and `/strategies/[strategyId]/edit`: four stages on one server draft identity (Research with linked thesis and shortlist import; Assemble with constituents by canonical id, exact basis-point weights, ±1% keyboard steps, move and remove buttons, explicit equal weights, cash remainder, notes; Set Rules with title, thesis, maintenance suggestion, references, effective limits and approval preference; Activate with wallet and budget apart from the recipe, exact split estimates, availability and readiness), revision-checked autosave with Saving / Saved / Offline changes / Conflict (compare and restore), archive and restore, persistent summary and phone sticky total | F07 | IMPLEMENTED, FIXTURE_VERIFIED (jsdom), e2e against the local API with fixture instruments and the fixture wallet; review and execution arrive with F09/F10 |
| Publishing `/strategies/[strategyId]` and `/strategies/[strategyId]/versions/[versionId]`: freeze the validated draft, versions with chain-derived registration states, prepare with a verified wallet (what becomes public and what never does, permanence, cost), sign through `solana:signTransaction` with the byte check, submit, Saved privately / Publishing / Registered on-chain / Failed / Expired / Status unknown restored on reload, registration evidence with explorer links and verification, deprecation and reactivation by the publisher wallet, readable version differences; public strategy and version pages with evidence, canonical bytes and the indexed record; follow and unfollow; fork into a new draft with attribution | F08 | IMPLEMENTED, FIXTURE_VERIFIED (jsdom), e2e against the local API with the fixture ledger and the fixture wallet signing real bytes; no deployed program or live cluster (OD-09, OD-10); review and execution arrive with F09/F10 |
| Review `/review/new` and `/review/[intentId]` (and the `/review` index): one screen for a basket investment in a pinned version and for a single buy from an instrument page; target, verified wallet with observed balances, exact stablecoin budget, budget mode, slippage default derived from the person's policy limit (tighten only), eligibility; the plan built by the API for that exact budget with input and allocation, per-constituent max input, expected and minimum output, price impact, slippage limit and transaction, cash that stays, every fee with basis and the fee payer, signatures and transactions, atomic or staged semantics with the batch order, policy evidence per leg, validity with a live countdown, funds observed, quote references, plan id and hash; approval bound to the hash (staged execution acknowledged separately), refused terms shown as actionable refusals (insufficient funds, policy denial, budget below the route minimum, no output, quotes unavailable, expired), expired terms refreshed with a difference view before any approval, a connected wallet or newer version that differs called out, after approval the F10 execution panel builds, checks and signs each transaction; entry points from the builder's Activate stage, the strategy and version pages and the market page's Buy | F09 | IMPLEMENTED, FIXTURE_VERIFIED (jsdom), e2e against the local API with the fixture venue's synthetic quotes, fixture instruments and the fixture wallet; no live venue (OD-21); signing and submission through the F10 execution panel |
| Execution `/activity/[intentId]` and the panel on the review: the API builds each transaction of the approved plan and the panel shows it before the wallet opens; signing preconditions checked in the browser (intent, plan hash, signer, cluster, capability, expiry, message hash, simulation) and again by the API; one `solana:signTransaction` request with the returned bytes checked against the prepared message; one submission; wallet decline, silence, mutation, account and session changes and lost answers handled without a second intent or transaction; per-transaction timeline with stages, fills, fees paid, signatures, explorer links and reconciliation evidence read on a bounded schedule and announced accessibly; cancel and cancellation requests with consequences; reviewed completion of a partially completed basket; `/activity` with URL filters and stable deep links; receipts issued and read at `/receipts/[receiptId]` with public opt-in | F10 | IMPLEMENTED, FIXTURE_VERIFIED (jsdom), e2e against the local B10 to B12 API with the fixture chain, fixture venue and fixture wallet; no live venue or cluster (OD-21); receipts signed with a local key (OD-22); in-browser cryptographic verification of receipts arrives with F11 |
| Design reference realignment: navigation (Explore, Build, Portfolio, Activity; eyes and wordmark lead home), environment chip, periwinkle accent with blue eyes, cream bezel and near-black screen, measured-contrast table | F10 | IMPLEMENTED, FIXTURE_VERIFIED (token contrast test); the reference's single-row top-bar link layout and its Explore and Set Rules tables are a shell and feature pass for a later session |
| Portfolio `/portfolio` and `/portfolio/[instanceId]`, receipt explanation: holdings against the last chain observation with multiplier-aware quantities and the API's valuations, reconciliation on request, external flows explained by the owner at wallet level, strategy instances (created by the review before a basket intent), target against actual allocation with drift among the invested legs, FIFO lots with cost and fees, personal against model performance over one period with methodology labels, accessible chart summaries, exact figures and JSON downloads, journal history; receipts show requested against filled and the fee cap | F11 | IMPLEMENTED, FIXTURE_VERIFIED (jsdom with independently expected sums), e2e against the real API and the fixture chain |
| Portfolio, rankings, maintenance, companion, other settings | F11 onward | not started; each needs its backend session |

## Backend prerequisites

F01 depends only on B01 (`@markov/contracts`, workspace conventions). F03
uses B02 (`/v1/auth/sessions`, `/v1/me`, `/v1/auth/sessions/current`) and
`/v1/platform`; F04 uses B02 wallet routes, B05 eligibility and terms routes
and the funding read added in F04 (`/v1/me/wallets/{walletId}/funding`);
F05 uses the public catalog reads of B03/B04 (`/v1/catalog/instruments`,
`…/{instrumentId}`, `…/corporate-actions`, `…/multipliers`), the B05
capability states (`/v1/me/instruments/{instrumentId}/availability`) and
the watchlist contract added in F05 (`/v1/me/watchlist`); F06 uses the B06
research routes (`/v1/me/theses`, revisions, sources, mappings, runs, the
public `/v1/research/theses/{thesisId}`) with the `instrumentId` filter
added in F06, and the B07 draft routes (`/v1/strategies/limits`,
`/v1/me/strategies`); F07 uses the B07 draft identity routes
(`/v1/me/strategies/{strategyId}`, `…/draft`) and the B05 limits
(`/v1/me/limits`); F08 uses the B07 version routes (`…/versions`,
`…/versions/{versionId}`, `…/forks`), the B08 registry routes
(`/v1/registry`, `…/publication`, `…/status-changes`,
`/v1/me/publications/{publicationId}`, `…/submit`, the public
`/v1/strategies/{strategyId}`, `…/versions/{versionId}` and
`/v1/registry/records/{address}`) and the follow contract added in F08
(`/v1/me/follows`); F09 uses the B09 planning routes (`/v1/me/intents`,
`…/intents/{intentId}`, `…/plans`, `…/plans/{planId}`,
`…/plans/{planId}/acknowledgements`, `…/cancel`) with the B05 limits,
eligibility and capability reads and the F04 funding read, and added
nothing to the backend; later sessions require later backend sessions. The app never reads provider
endpoints directly and the browser never calls the API: private calls go
through the app's own `/api/markov/*` allowlist.
