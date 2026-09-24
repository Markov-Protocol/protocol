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

## Acceptance matrix (build prompt section 12)

| Journey or risk | Evidence | Status |
| --------------- | -------- | ------ |
| Anonymous home → Explore → instrument | Shell fills the viewport at five widths, navigation works, home shows no fabricated personal data (F02 browser suite and screenshots); the instrument page arrives with F05 | partial (F02) |

Every other row is filled by the session that delivers it.
