# Mark I shell

Status: delivered in F02 (`packages/markov-shell`, `apps/web/src/shell`).

## Viewport behaviour

- The frame is `position: fixed; inset: 0` with `height: 100dvh` and a
  `100vh` fallback; `viewport-fit=cover` plus `env(safe-area-inset-*)`
  padding keep the perimeter clear of notches and home indicators.
- The screen is the only scroll container (`#main-content`,
  `overscroll-behavior: contain`). The page itself never scrolls, so no
  route can produce page-level horizontal scrolling.
- Perimeter: 6 px on phones (< 640 px), 12 px on tablets, 16 px on desktop;
  screen radius 20 / 24 / 32 px. Focus preference reduces the perimeter to
  4 px and the radius to 12 px and hides the companion dock.
- Grid areas: top bar; navigation rail (168 px from 640 px, 200 px from
  1024 px); main; companion dock (240 px from 1024 px); bottom navigation
  (60 px below 640 px).

## Identity

Cream frame with a light highlight, black glass with an inset edge, two
blue pixel eyes (`PixelEyes`, 5×7 SVG matrices, occasional blink disabled
under reduced motion), a decorative upper sensor dot and a 9 px printed
wordmark in the desktop perimeter. No body or feet inside the app; no
photograph is stretched. The sensor is decorative and never requests
camera access. Clicking the frame, the sensor or the printed perimeter
wordmark never triggers any action; since F10 the compact eyes and the
`markov.pet` wordmark in the top bar are a link home.

## Modes

| Mode        | Trigger                 | Appearance |
| ----------- | ----------------------- | ---------- |
| companion   | `/`                     | hero eyes with a concise greeting, one primary action (Explore) and Sign in |
| workspace   | every other route       | compact eyes in the top bar and dock, full content area |
| review      | review routes (F09)     | same shell, distraction reduced; not used yet |
| focus       | preference (More menu)  | minimal perimeter, compact companion; stored per viewer in `localStorage` (`markov.shell.focus`) with try/catch |

Mode is a presentation attribute on the frame (`data-mode`, `data-focus`).
It is never derived from, and never feeds, account or order state.

## Navigation

Primary: Explore, Build (`/strategies/new`), Portfolio, Activity (F10,
following the design reference; the eyes and wordmark in the top bar lead
home); More opens a menu with Home, Research, Rankings, Automations,
Settings and the focus toggle.
The rail renders on wide screens and the bottom bar on phones; both carry
`aria-current="page"`. Targets whose feature is not delivered render an
honest unavailable page naming the delivering session; no decorative
controls remain.

## Motion and accessibility

Blink every 7 s (transform only); reduced motion collapses it. A skip link
targets `#main-content` (`tabindex="-1"`). Landmarks: banner (top bar),
navigation (rail and bottom bar, both labelled "Primary"), main, complementary
(dock and rail asides). The companion status text ("Markov is ready") is the
accessible source of truth for the eyes. Direct route entry never replays an
intro; no boot sequence exists.

## Assets

CSS and SVG only; no raster artwork. Font provenance is recorded in
`design-system.md`.

## Known limits after F02

Mobile keyboard and `VisualViewport` behaviour are not yet tested on a
device; `100dvh` reduces with browser chrome but not with every on-screen
keyboard. The review mode is still unused (the F09 review renders in
workspace mode; the app derives only companion or workspace from the path),
and the companion panel is empty until F14 (P16 in the production
completion plan).
