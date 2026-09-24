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
| Screenshots | `docs/frontend/evidence/F06/` | `market-liquidity-*.png`, `thesis-new-*.png`, `thesis-sources-*.png`, `thesis-run-*.png`, `thesis-published-*.png`, `thesis-public-*.png`, `basket-drafts-*.png` |

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
   "Open in Build" lists it as just created → the workspace lists the
   thesis as public and the instrument page links to it.
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

## Acceptance matrix (build prompt section 12)

| Journey or risk | Evidence | Status |
| --------------- | -------- | ------ |
| Anonymous home → Explore → instrument | Shell fills the viewport at five widths, navigation works, home shows no fabricated personal data (F02); F05 journey 1 browses real admitted fixture instruments, searches, filters by issuer and opens the exact detail page anonymously | complete for fixture instruments (F05); live issuer feeds BLOCKED (OD-17, OD-18) |
| Sign in, reload, expire and recover, sign out, change accounts without private data crossing sessions | F03 browser journeys 1 to 3 against the real API; jsdom late-response and cache-disposal tests; server handler tests | complete for the development issuer (F03); hosted provider BLOCKED (OD-05) |
| Sign-in → wallet verify → eligibility | F04 journeys 1 and 5 with an injected Wallet Standard wallet against the local API; wallet tests for replay, wrong network, already linked, account switch, altered signature | complete for the fixture wallet (F04); real wallets and the hosted embedded wallet not verified |
| CSRF or login redirect abuse | Same-origin guard tests, open-redirect vectors in node and browser tests | complete (F03) |
| Private SSR/CDN response cached publicly | All routes dynamic, session responses `no-store` (build output and e2e header assertion); deployment headers still to be checked in F20 | partial (F03) |
| Research → builder → saved draft | F06 journey 1: thesis started from an admitted instrument, fixture issuer source fetched and cited, a metadata address refused and recorded, a bounded run adopted as labelled interpretations, revisions saved, publication with "what becomes public", a basket draft created from the saved shortlist with exact integer weights and the backend's validation shown; jsdom tests for a refused save keeping the edits and for the two-tab revision notice | research and the saved draft complete (F06); the basket editor, revision conflict recovery for drafts and small-notional limits arrive with F07 |
| Untrusted research, token image or assistant content executes | jsdom asserts excerpts with markup render as text (no element created), a `javascript:` source URL is never linked, model output is labelled and adopted only by the person; the API sanitises and refuses retrievals (B06); no images are fetched (F05) | complete for research content (F06); assistant content arrives with F14 |

Every other row is filled by the session that delivers it.
