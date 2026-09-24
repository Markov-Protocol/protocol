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

## Acceptance matrix (build prompt section 12)

No journey row is claimable yet; rows are filled by the sessions that
deliver them, starting with "Anonymous home → Explore → instrument" in F02
and F05.
