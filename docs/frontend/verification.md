# Frontend verification

Evidence per session, against the exact revision and environment. Fixture
evidence, live reads and authorized live writes are reported separately.
Screenshots alone never establish security or settlement correctness.

## F01 — shared design system (2026-09-24)

Environment: build container, Node 22.22.2, pnpm 10.33.0, Next.js 16.3.6,
Chromium build 1194 via Playwright 1.56.0 (desktop 1280×800 and Pixel 7
profile at 320×640 CSS px). No backend, wallet or provider involved.

| Check | Command | Result |
| ----- | ------- | ------ |
| Lint and format | `pnpm lint` | clean (Biome, 1 informational suggestion) |
| Typecheck | `pnpm typecheck` (backend graph, test config, formatters, ui, web) | clean |
| Unit and component tests | `pnpm exec vitest run --project web` | 9 files, 37 tests passed: formatters exactness and round trips, token contrast, `cn` token groups, button disabled explanation and focus, dialog focus move/return, exact amount and percent editing, field wiring, validation summary, tabs keyboard, axe on a composed page, web env guards |
| Token drift | `pnpm tokens:check` | current |
| Production build | `MARKOV_ENV=test MARKOV_WEB_INTERNAL_ROUTES=true pnpm web:build` | 3 routes (`/`, `/_not-found`, `/dev/components`), no warnings |
| Production guard | `MARKOV_ENV=production NEXT_PUBLIC_APP_ORIGIN=https://markov.pet MARKOV_WEB_FIXTURES=true pnpm web:build` | refused: "fixture adapters cannot be enabled in production" (exit 1) |
| Browser evidence | `pnpm web:e2e` | 8 passed on desktop and phone: every section renders; no page-level horizontal scroll at 320 CSS px; validation summary takes focus and its links focus fields; dialog opens, closes on Escape and returns focus; axe (WCAG 2.0/2.1/2.2 A+AA tags) reports no serious or critical violations; baseline security headers present |
| Screenshots | `docs/frontend/evidence/F01/` | `reference-desktop-chromium.png`, `reference-phone-chromium.png`, `dialog-desktop-chromium.png`, `dialog-phone-chromium.png` |

Defect found and fixed by the browser run: tailwind-merge dropped
`text-accent-ink` after `text-body`, so primary buttons rendered light text
on the accent fill (axe `color-contrast`, serious). `cn()` now registers the
token names as font-size and colour groups; the regression test is
`packages/ui/test/cn.test.ts`.

Readiness: IMPLEMENTED and FIXTURE_VERIFIED. No live read or live write
applies to F01.

## F02 — full-screen Mark I shell and home (2026-09-24)

Environment as for F01. Backend still not involved.

| Check | Command | Result |
| ----- | ------- | ------ |
| Component tests | `pnpm exec vitest run --project web` | 10 files, 43 tests: shell landmarks, skip link, `aria-current`, mode and focus attributes, focus persistence across remount, storage failure tolerance, route matching, decorative eyes with textual status, plus the F01 suites |
| Production build | `pnpm web:build` | 11 routes: `/`, `/explore`, `/strategies/new`, `/portfolio`, `/activity`, `/rankings`, `/automations`, `/settings`, `/status`, `/dev/components`, not-found |
| Browser evidence | `pnpm web:e2e` | 28 passed on desktop and phone profiles: at 320, 390, 768, 1280 and 1440 CSS px the frame spans exactly the viewport, no page-level horizontal scroll, Home → Explore navigation with `aria-current`, mode switches companion → workspace; long content scrolls inside the screen while the page stays at 0; deep link to `/portfolio` opens in workspace mode without an intro; More menu reaches Rankings; focus preference persists across reload; skip link focuses the content; F01 suites still pass inside the shell |
| Lab performance baseline | `docs/frontend/evidence/F02/perf-baseline.json` | Home at 390×844 over loopback: DOMContentLoaded 29 ms, load 169 ms, LCP 156 ms, 1.05 MB transferred (the two Inter variable files account for about 740 KB; subsetting is an open item). Lab numbers on the build container, not field data. |
| Screenshots | `docs/frontend/evidence/F02/` | `home-{320,390,768,1280,1440}.png`, `explore-{…}.png`, `focus-1280.png` |

Not verified in F02: mobile keyboard and `VisualViewport` behaviour on a
device, 200 percent text resize and 400 percent zoom on real screens
(the 320 px reflow check is the desktop-zoom equivalent), screen-reader
journeys.

## F03 — one authentication and session experience (2026-09-24)

Environment as for F01, plus the real Markov API (B02 build, PostgreSQL 16,
`IDENTITY_PROVIDER=test`, `API_TRUST_PROXY=true`) started by
`scripts/dev/web-e2e-api.sh` on port 3900 for the browser journeys. No
hosted identity provider, wallet or mainnet involved.

| Check | Command | Result |
| ----- | ------- | ------ |
| Contract matrix | `pnpm exec vitest run --project node packages/api-client` | 5 tests: every matrix operation exists in `docs/markov/openapi.json` with the same required response fields; a renamed field, an unknown principal class and a missing `session` are rejected at runtime |
| Generated client drift | `pnpm api-client:check` | current |
| Server session layer | `pnpm exec vitest run --project node apps/web/test/server` | 13 tests: return-path vectors (external, protocol-relative, backslash, scheme, encoded, auth loop, control characters, length), cookie policy (`__Host-`, Secure, HttpOnly, SameSite=Lax, Path=/, no Domain; plain name only for local http), same-origin guard (Sec-Fetch-Site, Origin, forwarded host), sign-in → session → sign-out → replayed cookie refused, validated `next`, cross-origin/form/malformed refused before any API call, hosted provider / unreachable backend / rate limit / production honest failures, account change revokes the previous session, malformed cookie cleared, unreachable backend keeps the cookie and reports `revoked: false`, client address forwarded to both identity calls |
| Client session state | `pnpm exec vitest run --project web apps/web/test/session-context.test.tsx` | 5 tests: a slow private response from account A is aborted or discarded after account B signs in; one query cache per principal, disposed on sign-out; expiry flips to *expired* at the declared time; back/forward-cache restore re-verifies; sign-in posts only to the app origin with a validated return path |
| Web environment | `pnpm exec vitest run --project web apps/web/test/web-env.test.ts` | 5 tests including the server-only `MARKOV_API_ORIGIN` rules |
| Full unit and integration run | `pnpm test` (inside `pnpm verify`, PostgreSQL and the Temporal dev server running) | 27 files, 158 tests passed |
| Production build | `pnpm web:build` | 16 routes, all server-rendered on demand (`ƒ`), including `/sign-in`, `/auth/callback` and the three `/api/auth/*` handlers |
| Browser evidence | `MARKOV_TEST_DATABASE_URL=… pnpm web:e2e` | 40 passed on desktop and phone profiles: 12 auth journeys (below) plus the F01/F02 suites inside the signed-out shell |
| Screenshots | `docs/frontend/evidence/F03/` | `sign-in-1280.png`, `home-signed-in-1280.png`, `account-menu-1280.png`, `expired-1280.png`, `callback-cancelled-390.png` |

Auth journeys (each on desktop 1280×800 and the Pixel 7 profile):

1. Sign in from `/portfolio` returns to `/portfolio`; cookie is `__Host-markov_session`, HttpOnly, Secure, SameSite=Lax, host-only; the token appears in neither the URL nor the page; the session survives a reload; `GET /api/auth/session` is `no-store`; the signed-in home shows the account and the next-step checklist; sign-out; the old cookie is refused afterwards and cleared. The sign-in screen has no serious or critical axe violations (WCAG 2.0/2.1/2.2 A+AA tags).
2. Expired session: the API session is revoked, a back/forward-cache restore re-verifies, the top bar and a notice offer "Sign in again", the return path `/rankings` is preserved and the person is back on `/rankings` signed in.
3. Account switch: alice → bob through the account menu; the previous session answers 401 at the API; no alice data remains on the page.
4. Return targets `https://…`, `//…`, `/\…` and `/sign-in` fall back to `/`; a sign-in with an external target lands on the app origin.
5. Unauthorized direct API access: anonymous and garbage bearers get 401; a browser fetch to the API origin is blocked (no CORS allowance); cross-origin `POST /api/auth/sign-out` and a form-encoded cross-origin sign-in get 403; the anonymous session route reveals nothing.
6. Callback outcomes: cancelled, failed (sanitised provider message), unsupported hosted callback (BLOCKED, OD-05) and no-flow.

Not verified in F03: a hosted identity provider (no account and no reachable
documentation; OD-05), Safari cookie behaviour on `http://localhost`, real
network expiry after `AUTH_SESSION_TTL_SECONDS` (revocation stood in for it;
the client path is identical), screen-reader journeys through sign-in.

Readiness: IMPLEMENTED and FIXTURE_VERIFIED for the app; LIVE_READ_VERIFIED
and LIVE_WRITE_VERIFIED only against the local B02 API in test mode, which
is not production evidence. Hosted provider sign-in: BLOCKED.

## F04 — wallet, eligibility and funding readiness (2026-09-24)

Environment as for F03, plus the B05 API build with the fixture rule set
and terms published by `scripts/dev/web-e2e-api.sh`, the fixture RPC on
port 3901 answering funding reads from a test control endpoint, and an
injected Wallet Standard wallet (`apps/web/e2e/fixture-wallet.ts`) that
signs with WebCrypto Ed25519 and approves every request. No real browser
wallet, hosted embedded wallet or live cluster was involved.

| Check | Command | Result |
| ----- | ------- | ------ |
| Backend funding read | `pnpm exec vitest run --project node apps/api/test/funding.test.ts packages/solana-rpc/test/client.test.ts packages/config/test/config.test.ts` | funding: unfunded → needs SOL (two token accounts) → funded → needs stablecoin, unreadable RPC answers 503 (never zero), foreign wallets 404, agent scopes; RPC client: balances, token accounts and rent exemption, unsafe integers refused; config: USDC default on mainnet-beta only |
| App-owned API proxy | `pnpm exec vitest run --project node apps/web/test/server/proxy.test.ts` | 7 tests: exact allowlist, bearer from the HttpOnly cookie, client address forwarded, upstream headers dropped, `no-store`; 404 outside the allowlist; 401 without a session except the public terms; cross-origin, form, malformed and oversized mutations refused before any API call; error envelopes and 204 passed through; unreachable backend → 503 |
| Wallet and funding client | `pnpm exec vitest run --project web apps/web/test/wallets.test.tsx` | 10 tests: capability discovery and no connection without a choice, account choice, wrong-network refusal (no signature, no challenge), disconnect keeps the session and a session change forgets the wallet, challenge shown verbatim and presented once with replay and already-linked mapping, signatures obtained under a previous account or after an account change never submitted, altered messages refused, step-up required, funding panel with copy/QR/balances/requirements, unknown balances shown as unknown |
| Full unit and integration run | `pnpm test` (inside `pnpm verify`, PostgreSQL and the Temporal dev server running) | 42 files, 229 tests passed (one earlier run hit a temporary-database teardown race in `apps/api/test/boot.test.ts`, unrelated to F04; the recorded gate run was clean) |
| Production build | `pnpm web:build` | 19 routes, all server-rendered on demand (`ƒ`), including `/settings`, `/settings/wallets`, `/settings/eligibility` and the `/api/markov/[...path]` proxy |
| Browser evidence | `MARKOV_TEST_DATABASE_URL=… pnpm web:e2e` | 50 passed on desktop and phone profiles: 5 wallet, eligibility and funding journeys (below) plus the F01 to F03 suites; each profile uses its own accounts |
| Screenshots | `docs/frontend/evidence/F04/` | `wallets-choose-*.png`, `wallets-verified-*.png`, `funding-needs-sol-*.png`, `home-readiness-*.png`, `wallets-wrong-network-*.png`, `wallets-already-linked-*.png`, `eligibility-unknown-*.png`, `eligibility-denied-*.png`, `eligibility-eligible-*.png` |

Wallet journeys (desktop 1280×800 and the Pixel 7 profile):

1. Explicit choice → connect → network check → verified ownership through the shown challenge → verified list and top-bar chip → funding: needs SOL (9,000 lamports, 250 USDC) with the requirement basis, then funded after the network shows 1 SOL → home checklist marks the wallet done and links eligibility → disconnect keeps the session.
2. Wrong network: a mainnet-only wallet gets the explanation, the verify control is disabled, no signature and no challenge request happen.
3. Replay and already linked: the same signed challenge presented again answers `CHALLENGE_INVALID` (409) through the app's proxy; a second account with the same wallet sees the recovery guidance and keeps no wallet.
4. Account switch mid-flow: the signature is held while another tab signs in as someone else; when released, nothing is posted and the new account has no wallets.
5. Eligibility: unknown → denied (`XX`, with the no-evasion notice) → eligible (`ZZ`) → terms acknowledged by content hash → wallet step remains → home shows the eligibility fact.

Not verified in F04: any real browser wallet (Phantom, Solflare, hardware
wallets), the hosted embedded wallet (OD-05), mobile wallet handoff, live
cluster balance reads (fixture RPC only), screen-reader journeys through
the wallet dialog, and transaction signing paths (F10).

Readiness: IMPLEMENTED and FIXTURE_VERIFIED; LIVE_READ_VERIFIED and
LIVE_WRITE_VERIFIED only against the local B02/B05 API in test mode, which
is not production evidence. Real wallets and live funding reads: not
verified.

## F05 — issuer-aware discovery and watchlists (2026-09-24)

Environment as for F04, plus `scripts/dev/web-e2e-api.sh` ingesting the
PreStocks and xStocks fixture feeds and admitting FXAERO, FXBIO and XSFXA
after mint verification against the fixture RPC (FXGRID stays quarantined,
XSFXB is refused by the extension policy); Playwright waits on the fixture
RPC's `/fixture/ready` flag, raised after seeding. No live issuer feed, no
live cluster and no real page were involved.

| Check | Command | Result |
| ----- | ------- | ------ |
| Backend watchlist contract | `pnpm exec vitest run --project node apps/api/test/watchlists.test.ts` | 1 journey: empty list (version 0) → save with the version → idempotent re-save → stale `ifVersion` refused with the current version → second save → quarantined and unknown instruments refused (`ASSET_NOT_ADMITTED`, `NOT_FOUND`), markup in a note refused → another person sees an empty list, a `research:read` agent reads but cannot write → delisting keeps the item visible as delisted while the public catalog answers 404 → versioned, idempotent removal → anonymous 401 |
| App-owned API proxy | `pnpm exec vitest run --project node apps/web/test/server/proxy.test.ts` | 10 tests: public catalog reads reachable anonymously with a re-encoded bounded query (8 keys, 512 characters, no control characters), queries refused on other routes, watchlist operations allowlisted, everything else as in F04 |
| Discovery and watchlist client | `pnpm exec vitest run --project web apps/web/test/markets.test.tsx` | 12 tests: identity and typed prices with an issuer-distinguished twin, paused and stale states, URL filter state and debounced search, unknown URL values dropped, late-response guard, schema drift and provider outage as failures with retry, bounded pagination, save/remove with the list version and a cross-device conflict, delisted saved instrument, anonymous sign-in prompt and honest Strategies tab, market detail with sanitised description, explorer link, verification evidence, honest actions, personal capability states and lifecycle notices, unknown id |
| Contract matrix | `pnpm exec vitest run --project node packages/api-client` | 11 entries proven against the frozen OpenAPI document (catalog list, detail, corporate actions and the three watchlist operations added) |
| Full unit and integration run | `pnpm test` (inside `pnpm verify`) | 49 files, 276 tests passed |
| Production build | `pnpm web:build` | 20 routes, all server-rendered on demand, including `/explore` and `/markets/[instrumentId]` |
| Browser evidence | `MARKOV_TEST_DATABASE_URL=… pnpm web:e2e` | 54 passed on desktop and phone profiles: 2 discovery journeys (below) plus the F01 to F04 suites; each profile uses its own accounts |
| Screenshots | `docs/frontend/evidence/F05/` | `explore-anonymous-*.png`, `explore-search-*.png`, `market-overview-*.png`, `market-instrument-*.png`, `watchlist-*.png` |

Discovery journeys (desktop 1280×800 and the Pixel 7 profile):

1. Anonymous Explore lists FXAERO (PreStocks, Solana devnet, 18.25 USD
   issuer mark) and XSFXA (xStocks, listed stock FXA on FIXTURE) and none
   of the unadmitted fixtures → search "Aerospace" narrows to FXAERO with
   `q=Aerospace` in the URL → the xStocks filter shows XSFXA only → the row
   link opens `/markets/<uuid>` → Overview shows the identity, admitted
   status, "History unavailable" and what you can do now → Instrument shows
   the mint, a devnet explorer link and the verification result → "Sign in
   to save" returns to the same page → Save marks the instrument saved and
   the personal capability states appear → the Watchlist tab lists it
   (survives a reload) → Remove empties it.
2. A malformed id answers the app's not-found page; an unknown id answers
   "No admitted instrument with that id" with a way back to Explore.

Not verified in F05: any live issuer feed or real instrument (OD-17,
OD-18), a live cluster, screen-reader journeys through the filters, and the
Strategies tab (F12). Provider descriptions and images: the catalog carries
no image URLs and the app fetches none (a deterministic monogram is
drawn); descriptions are plain text from the backend's sanitiser and are
rendered as text only.

Readiness: IMPLEMENTED and FIXTURE_VERIFIED; LIVE_READ_VERIFIED only
against the local B03/B04/B05 API in test mode with fixture instruments,
which is not production evidence.

## F06 — instrument research and saved theses (2026-09-24)

Environment as for F05, plus `scripts/dev/web-e2e-api.sh` exporting
`RESEARCH_MODEL_PROVIDER=fixture` (the deterministic adapter the backend
refuses outside local/test) so bounded runs can be exercised; the fixture
issuer source `https://fixture.markov.invalid/issuer/terms` is served from
the API's memory in test mode. No hosted model provider, no live page and
no live cluster were involved.

| Check | Command | Result |
| ----- | ------- | ------ |
| Backend list filter | `pnpm exec vitest run --project node apps/api/test/research.test.ts` | 3 journeys, now also asserting `instrumentIds` on list rows, `?instrumentId=` narrowing to the referencing thesis, an empty answer for an unreferenced instrument and 400 for a malformed id |
| App-owned API proxy | `pnpm exec vitest run --project node apps/web/test/server/proxy.test.ts` | 12 tests: the research and strategy-draft operations allowlisted (freeze, fork, pins and operator routes are not), PATCH forwarded with its JSON body under the same-origin and JSON rules (415 without JSON, 403 cross-origin), the public thesis read reachable anonymously without a bearer, the private list refused anonymously |
| Editor helpers | `pnpm exec vitest run --project web apps/web/test/research-state.test.ts` | 5 tests: equal weights with the exact cash remainder sum to 10,000 for 1 to 20 legs; local checks by field (markup, uncited fact, refused source, model statement without a run); API detail paths mapped to fields; revision input trimming; https-only outbound links (`javascript:`, `http:`, `data:` withheld) |
| Research client | `pnpm exec vitest run --project web apps/web/test/research.test.tsx` | 11 tests: workspace list and creation (markup refused locally, private by default); editor with sources as data (`<b>` in an excerpt stays text, a `javascript:` URL is never linked, refusals and failures stated with reasons), private notes in the form, a save appending revision 2 with the notes and shortlist intact; a refused save keeping the edits and mapping the API's rule to the statement, a local rule stopping the round trip; run progress and cancellation; an absent provider reported; a finished run adopted only as labelled interpretations, a suggested instrument confirmed into the shortlist, an unmatched company added as a subject; shortlist to basket with 3 × 3,333 bps and 1 bp cash posted verbatim and the backend's totals shown; another person and anonymous readers get "not found or private"; the public projection without notes, with labelled model output, citations and instrument links, touching no private route; market detail: rights and evidence, add to a basket draft (10,000 bps, no cash), theses per instrument, start a thesis with the instrument shortlisted, route observations "not observed", anonymous sign-in prompt |
| Contract matrix | `pnpm exec vitest run --project node packages/api-client` | 29 entries proven against the frozen OpenAPI document (18 research and strategy-draft operations added) |
| Full unit and integration run | `pnpm test` (inside `pnpm verify`) | 54 files, 325 tests passed |
| Production build | `pnpm web:build` | 22 routes, all server-rendered on demand, including `/research`, `/research/[thesisId]` and the draft list on `/strategies/new` |
| Browser evidence | `MARKOV_TEST_DATABASE_URL=… pnpm web:e2e` | 58 passed on desktop and phone profiles: 2 research journeys (below) plus the F01 to F05 suites; each profile uses its own accounts |
| Screenshots | `docs/frontend/evidence/F06/` | `market-liquidity-*.png`, `thesis-new-*.png`, `thesis-sources-*.png`, `thesis-run-*.png`, `thesis-published-*.png`, `thesis-public-*.png`, `basket-editor-*.png` |

Research journeys (desktop 1280×800 and the Pixel 7 profile):

1. Open FXAERO by id and sign in → Overview states the rights basis and
   where evidence lives; Liquidity shows route observations with every
   field "Not observed" → the Research tab starts a private thesis with
   FXAERO shortlisted → the fixture issuer terms are fetched and shown as
   an excerpt; a metadata address is refused and recorded with "address
   literals are not allowed" → an opinion is added and a bounded run over
   the fetched source succeeds with provenance (`fixture /
   fixture-research`), its output labelled "Model interpretation, not an
   issuer fact" and adopted → saved as revision 2 → private notes saved as
   revision 3 → "Publish…" lists what becomes public (notes excluded) and
   publishes → an anonymous context reads the projection without the
   notes → "Start a basket draft" creates a B07 draft (total 100.00%) and
   "Open in Build" opens it in the basket builder (F07) with its one
   constituent → the workspace lists the thesis as public and the
   instrument page links to it.
2. Another person's private thesis answers "not found or private" to an
   anonymous reader and to a different signed-in account; a malformed id
   answers the app's not-found page.

Not verified in F06: a hosted model provider (OD-19), a live retrieved
page, screen-reader journeys through the editor, and the basket editor
itself (F07). Hostile content: excerpts, titles and model output are
rendered as text only (jsdom asserts no `<b>` element and no
`javascript:` link); the API's sanitiser and retrieval policy are the
first line and are tested in B06.

Readiness: IMPLEMENTED and FIXTURE_VERIFIED; LIVE_READ/WRITE_VERIFIED only
against the local B06/B07 API in test mode with the fixture source and
adapter, which is not production evidence.

## F07 — complete stock basket builder (2026-09-25)

Environment as for F06 (real API in test mode with admitted fixture
instruments, the fixture RPC and the fixture wallet injected through the
Wallet Standard). No live cluster, issuer feed or real wallet was involved.

| Check | Command | Result |
| ----- | ------- | ------ |
| Backend draft rule | `pnpm exec vitest run --project node packages/strategy` | 9 tests: a zero-weight constituent is allowed in a draft and refused by validation (`ZERO_WEIGHT`, never in a version); everything from B07 unchanged |
| App-owned API proxy | `pnpm exec vitest run --project node apps/web/test/server/proxy.test.ts` | 13 tests: draft read, revision-checked save and archive allowlisted; freezing, forking, pinning, versions and limit changes are not |
| Basket arithmetic and local copies | `pnpm exec vitest run --project web apps/web/test/builder-state.test.ts` | 6 tests: exact totals (9,999 / 10,000 / 10,001), removal without redistribution, duplicate refusal, explicit equal weights with the remainder as cash, remainder to cash, move buttons, local issues (empty, cash-only, duplicate, over cap), conflict diff, exact budget split in raw units, account-scoped versioned short-lived local copies purged for other principals |
| Builder client | `pnpm exec vitest run --project web apps/web/test/builder.test.tsx` | 9 tests: one draft identity with symbols and a long name, 59.99 / 60.01 edits autosaved with `ifRevision` and the backend's `WEIGHTS_TOTAL` shown, three decimals refused; ±1% buttons, removal keeps the other weights, picker refuses a duplicate, equal weights 3 × 33.33% + 0.01% cash saved, remainder to cash; cash-only draft reported by the backend's rule; two-tab conflict compared (changed, added, removed, title) and kept as the next revision; offline edits kept on the device and saved on retry with the copy cleared; an earlier device copy restored only on request; Activate: no wallet → verify link, exact split estimates, budget above the per-order limit and too small to buy, availability from the policy, review button unavailable with its reason, no save; archived draft read-only; foreign id not found; start-a-basket creates and opens the editor, `?strategyId=` redirected |
| Contract matrix | `pnpm exec vitest run --project node packages/api-client` | 33 entries proven against the frozen OpenAPI document (draft read, save, archive and effective limits added) |
| Full unit and integration run | `pnpm test` (inside `pnpm verify`) | 56 files, 346 tests passed |
| Production build | `pnpm web:build` | 23 routes, all server-rendered on demand, including `/strategies/[strategyId]/edit` |
| Browser evidence | `MARKOV_TEST_DATABASE_URL=… pnpm web:e2e` | 62 passed on desktop and phone profiles: 2 builder journeys (below) plus the F01 to F06 suites; each profile uses its own accounts |
| Screenshots | `docs/frontend/evidence/F07/` | `builder-assemble-*.png`, `builder-invalid-*.png`, `builder-conflict-*.png`, `builder-rules-*.png`, `builder-activate-*.png` |

Builder journeys (desktop 1280×800 and the Pixel 7 profile):

1. Sign in → `/strategies/new` creates a draft and opens the editor on
   Assemble ("No constituent", the backend's `NO_LEGS`) → FXAERO and
   XSFXA added from the admitted catalog → 60 / 30 with 10 cash saved
   and validated by the backend ("valid recipe") → 59.99 reported as
   0.01% unallocated and `WEIGHTS_TOTAL` after the save → 60.001 refused
   → ±1% buttons → a reload shows exactly the saved weights → a second
   tab saves FXAERO at 55 first; the first tab's edit is refused with the
   revision, the panel compares both, "Keep my edits" saves the next
   revision and the other tab reads it → Set Rules shows the effective
   limits in USDC and the approval preference → Activate without a
   wallet offers to verify one, splits a 100 budget exactly and keeps
   "Review investment" unavailable → the Build page resumes the draft.
2. The fixture wallet is verified and funded through the fixture RPC
   (1000 USDC) → a one-constituent basket at equal weight → Activate
   selects the wallet, reads the balance, refuses a 2000 budget as more
   than observed, estimates a 100 budget and reports "within the limits";
   the review button stays unavailable.

Not verified in F07: real wallets, a live cluster, screen-reader
journeys through the stages, and execution (F09/F10). Long names are
truncated with the full name as a title; keyboard editing is covered by
the ±1% buttons and the numeric fields in jsdom and e2e.

Readiness: IMPLEMENTED and FIXTURE_VERIFIED; LIVE_READ/WRITE_VERIFIED only
against the local B05/B07 API in test mode, which is not production
evidence.

## F08 — public publishing, versions and forks (2026-09-25)

Environment as for F07 plus the registry: the real API in test mode with
`REGISTRY_PROGRAM_ID` set to the development placeholder program id, the
fixture RPC's in-memory ledger executing the program's rules (B08) and the
fixture wallet injected through the Wallet Standard signing legacy
transactions with WebCrypto Ed25519. No deployed program, live cluster,
issuer feed or real wallet was involved; nothing left this machine.

| Check | Command | Result |
| ----- | ------- | ------ |
| Backend additions | `MARKOV_TEST_DATABASE_URL=… pnpm exec vitest run --project node apps/api/test/registry.test.ts apps/api/test/strategies.test.ts` | 4 tests: follows (owner refused, unknown strategy 404, follow 201 then 200, list with the newest registered version and its chain-derived status after the deprecation, unfollow idempotent, no user id in the payload), `followerCount` on the public strategy, a stranger's fork of a registered version with attribution while the private routes stay 404, the latest status-change read apart from the registration read; everything from B07/B08 unchanged |
| App-owned API proxy | `pnpm exec vitest run --project node apps/web/test/server/proxy.test.ts` | 14 tests: freeze, version read, publication prepare/read, status changes, submit and publication read, forks, public strategy and version, registry status and records, follows allowlisted; diffs, record listings, pins and operator routes are not |
| Contract matrix | `pnpm exec vitest run --project node packages/api-client` | every F08 route proven against the frozen OpenAPI document (registry status, freeze, own version, prepare, publication reads, status changes, submit, fork, public strategy and version, records, follows) |
| Pure state and bytes | `pnpm exec vitest run --project web apps/web/test/publishing-state.test.ts` | 11 tests: the five displays from chain-derived states (a registered version stays registered under a later status change), failure text from the program error, status-change readings, polling only while undecided, lamports without floats, maintenance labels, the version difference with one-sided turnover (mirrors the backend), recipe legs from both version shapes, compact-u16 parsing and the signed-transaction check (message unchanged, fee-payer slot filled, signature count unchanged) |
| Publishing client | `pnpm exec vitest run --project web apps/web/test/publishing.test.tsx` | 13 tests: review of what becomes public (mints, hash, publisher, never-published list, permanence, cost shown before the wallet), sign with the connected publisher wallet through `solana:signTransaction`, submit exactly the prepared message with the signature filled, Publishing then Registered on-chain only after the API's re-check, evidence and explorer links from the API; wrong network and a wallet that is not the publisher never asked to sign; an altered message submits nothing; a double click submits once; submitted, failed (with the program error), expired and unknown restored from the API; a registry without a program; an in-flight deprecation restored after a reload, signed and read back as deprecated; a stranger's public page with follow, unfollow, follower count and fork into the editor, no owner controls; anonymous public version with verification, canonical bytes, indexed record and the difference from the previous public version, never a `/v1/me/` call; a verification mismatch shown as an error; a private version "not found" for another signed-in person; the owner's strategy page with chain-derived version rows, freeze into the new version page, what others see, and freezing unavailable for an invalid draft |
| Full unit and integration run | `pnpm test` (inside `pnpm verify`) | see the session log `docs/sessions/F08.md` |
| Production build | `pnpm web:build` | 25 routes, all server-rendered on demand, including `/strategies/[strategyId]` and `/strategies/[strategyId]/versions/[versionId]` |
| Browser evidence | `MARKOV_TEST_DATABASE_URL=… pnpm exec playwright test e2e/publishing.spec.ts` | 4 passed: the two journeys below on desktop and phone profiles |
| Screenshots | `docs/frontend/evidence/F08/` | `publish-review-*.png`, `publish-registered-*.png`, `version-public-*.png`, `strategy-public-*.png` |

Publishing journeys (desktop 1280×800 and the Pixel 7 profile):

1. Sign in → the fixture wallet is chosen, verified and given lamports on
   the fixture ledger → a two-constituent basket is built and saved →
   "Versions and publishing" → "Freeze as version 1" opens the version
   page as Saved privately → Prepare with the connected verified wallet
   → the review shows both constituents by mint, the publisher address,
   the permanence statement and the cost in SOL and lamports → the sign
   button is unavailable until the statement is confirmed → "Sign with
   Fixture Wallet" signs the real bytes → Publishing with the
   transaction signature and no explorer link → the ledger finalizes →
   "Re-check now" → Registered on-chain with the record and transaction
   explorer links and "Verified against the chain" → a reload shows the
   same state → Deprecate: prepared, signed, sent, finalized, registered;
   the button now offers reactivation → the strategy page lists the
   version as registered → an anonymous visitor sees the registered
   version with the Deprecated marker, verification, the canonical bytes
   and the indexed record, no registration panel, "Review investment"
   unavailable, the strategy page with 0 followers and sign-in links →
   another person signs in, follows (1 follower, kept after a reload) and
   forks; the editor opens the fork "(fork)" with the same weights → the
   owner's page counts the follower.
2. A registration whose transaction lands with the program's
   `WeightTotal` error on the fixture ledger is shown as Failed with that
   error, offers "Try again" with the prepare step, shows no evidence, and
   stays Failed after a reload.

Not verified in F08: a deployed program, a validator or live cluster,
real browser wallets (the fixture wallet signs whatever it is given), the
hosted embedded wallet (OD-05), screen-reader journeys through the review
and signing steps, and moderation (OD-20). Fees shown are the API's
estimate from the rent-exempt minimum and the base fee, not a priority
fee market.

Readiness: IMPLEMENTED and FIXTURE_VERIFIED; the chain is the fixture
ledger, which is not production evidence (`docs/markov/strategy-registry.md`
lists the release gates).

## Acceptance matrix (build prompt section 12)

| Journey or risk | Evidence | Status |
| --------------- | -------- | ------ |
| Anonymous home → Explore → instrument | Shell fills the viewport at five widths, navigation works, home shows no fabricated personal data (F02); F05 journey 1 browses real admitted fixture instruments, searches, filters by issuer and opens the exact detail page anonymously | complete for fixture instruments (F05); live issuer feeds BLOCKED (OD-17, OD-18) |
| Sign in, reload, expire and recover, sign out, change accounts without private data crossing sessions | F03 browser journeys 1 to 3 against the real API; jsdom late-response and cache-disposal tests; server handler tests | complete for the development issuer (F03); hosted provider BLOCKED (OD-05) |
| Sign-in → wallet verify → eligibility | F04 journeys 1 and 5 with an injected Wallet Standard wallet against the local API; wallet tests for replay, wrong network, already linked, account switch, altered signature | complete for the fixture wallet (F04); real wallets and the hosted embedded wallet not verified |
| CSRF or login redirect abuse | Same-origin guard tests, open-redirect vectors in node and browser tests | complete (F03) |
| Private SSR/CDN response cached publicly | All routes dynamic, session responses `no-store` (build output and e2e header assertion); deployment headers still to be checked in F20 | partial (F03) |
| Research → builder → saved draft | F06 journey 1: thesis started from an admitted instrument, fixture issuer source fetched and cited, a metadata address refused and recorded, a bounded run adopted as labelled interpretations, revisions saved, publication with "what becomes public", a basket draft created from the saved shortlist with exact integer weights and the backend's validation shown; jsdom tests for a refused save keeping the edits and for the two-tab revision notice | research, the saved draft (F06) and the builder (F07: exact weights, readable validation from the backend, two-tab revision conflict with compare and restore, offline copy, small-notional and limit checks in Activate) complete; review and execution arrive with F09/F10 |
| Publish privately/publicly: correct public payload, actual registration state distinguished from the database save | F08 journey 1: the review lists exactly the manifest the API will register (constituents by mint and weight, cash, hashes, publisher, record address) and what never becomes public; every state on screen is the API's chain-derived reading, evidence and explorer links appear only after finality was read back, and a reload restores the same state; jsdom tests for wrong network, altered message, double click, failed / expired / unknown, verification mismatch | complete on the fixture ledger (F08); a deployed program, validator run and independent review remain release gates (OD-09, OD-10) |
| Strategy registry: correct cluster, program, version and backend receipt | The registration panel and evidence show the platform network, the program id and genesis hash from `GET /v1/registry`, the version number and manifest hash, the record address, the finalized slot and transaction; the fixture wallet signs the prepared bytes and the API refuses anything else before the node (B08 tests); F08 journey 2 shows a landed program error truthfully | complete for the fixture ledger (F08) |
| Untrusted research, token image or assistant content executes | jsdom asserts excerpts with markup render as text (no element created), a `javascript:` source URL is never linked, model output is labelled and adopted only by the person; the API sanitises and refuses retrievals (B06); no images are fetched (F05) | complete for research content (F06); assistant content arrives with F14 |

Every other row is filled by the session that delivers it.
