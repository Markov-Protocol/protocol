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

## Acceptance matrix (build prompt section 12)

| Journey or risk | Evidence | Status |
| --------------- | -------- | ------ |
| Anonymous home → Explore → instrument | Shell fills the viewport at five widths, navigation works, home shows no fabricated personal data (F02 browser suite and screenshots); the instrument page arrives with F05 | partial (F02) |
| Sign in, reload, expire and recover, sign out, change accounts without private data crossing sessions | F03 browser journeys 1 to 3 against the real API; jsdom late-response and cache-disposal tests; server handler tests | complete for the development issuer (F03); hosted provider BLOCKED (OD-05) |
| CSRF or login redirect abuse | Same-origin guard tests, open-redirect vectors in node and browser tests | complete (F03) |
| Private SSR/CDN response cached publicly | All routes dynamic, session responses `no-store` (build output and e2e header assertion); deployment headers still to be checked in F20 | partial (F03) |

Every other row is filled by the session that delivers it.
