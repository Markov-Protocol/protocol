# Design reference screens

Three reference screens for the markov.pet application, supplied by the
product owner as the exact visual target for the app. They are the
authority for the app's look from the next frontend session on; where the
current implementation (F01 to F09) differs, the frontend sessions align to
these screens rather than the other way round. The screens are
illustrations with placeholder numbers ("Illustrative data"); nothing in
them is a data source, a quote or an eligibility statement.

| File | Screen | Route it governs | Scope |
| ---- | ------ | ---------------- | ----- |
| `explore-strategies.png` | Explore, Strategies tab: "Find a thesis worth building." | `/explore` (F05 Explore, F06 research entry points, F08 public strategies) | Stocks release |
| `build-set-rules.png` | Build, stage 3 "Set Rules": "Shape your strategy." | `/strategies/new`, `/strategies/{strategyId}/edit` (F07 builder), the rules that F09's review reads | Stocks release |
| `perps-future-preview.png` | Build, perpetual strategy concept: "Plan both sides of the market." | none | **Future preview only.** The screen itself says "simulation only", "Future preview" and "Perps follow the stocks release". It fixes the visual language (risk envelope rail, long/short chips, stress preview rows) and nothing else; no perps feature, route or data model is built from it in the stocks release. |

## What every screen fixes

- **Mark I frame.** The app fills a device: a warm cream bezel (sampled
  `#E6DCD1`, rounded outer corners, a small camera notch at the top
  centre), an inset near-black screen (sampled `#070909`) with large
  rounded corners, and the `markov` wordmark on the bezel below the
  screen. The shell (`@markov/shell`, F02) already draws the frame; the
  bezel tone and the wordmark placement follow this reference.
- **Top bar.** Left: the two blue pixel eyes (sampled `#578FFE`) and the
  `markov.pet` wordmark in white. Centre: four text links `Explore`,
  `Build`, `Portfolio`, `Activity`; the active one is white with a
  periwinkle underline, the others muted. Right: a small outlined chip
  naming the build state (`Concept`, `Future preview`; the app shows the
  real mode label from the shell, never a made-up one), a thin vertical
  divider, then `Account` with a person icon. There is no `Home` link and
  no hamburger in this state; `Research`, `Rankings`, `Automations` and
  `Settings` are reached from within `Explore`, `Portfolio` and `Account`.
- **Typography.** One geometric grotesque for text (Inter, already
  self-hosted); display headlines are large, tight, white, and end with a
  full stop ("Find a thesis worth building."); the subtitle under a
  headline is muted grey at roughly half the display size. Column headers
  and small labels are uppercase, letter-spaced, muted, in the monospace
  face; every number, ticker, amount and market code (`4 assets`,
  `$200.00`, `SOL-PERP`, `0.50%`) is set in the monospace face with
  tabular figures. The exact formatters of `@markov/formatters` produce
  the strings; the monospace face renders them.
- **Colour.** Fills sampled from the PNGs (dominant colour of the
  region): primary buttons `#8299FD` with dark text; the slider fill
  `#7C95FC`, its knob white, its track `#22262F`; the active step circle
  `#698BFD` to `#7995FD`; completed step circles `#1A2334` with a check;
  connector lines `#191B1F`; inputs, selects and chips `#121416` on the
  screen with a one-pixel lighter border; the selected tab chip `#121B2B`
  with a periwinkle border; row icon tiles `#13171F`; the `Long` chip a
  green tint `#0B1912` with a green border and text, the `Short` chip a red
  tint `#280F11` with a red border and text. Body text is white; muted
  text is a cool grey (thin strokes do not sample cleanly; the frontend
  session measures it and records the contrast in
  `docs/frontend/design-system.md`). The current tokens differ: `accent`
  is the light blue `#89C9FF` and `frameCream` is `#ECEBE6`; the
  realignment pass moves the accent to the periwinkle above, keeps the
  measured-contrast table current and keeps the pixel eyes blue.
- **Layout.** A two-column screen: the main column carries the headline,
  subtitle, stepper or tabs and the content table; a right rail (about a
  third of the width, separated by a hairline) carries the contextual
  panel: "Your rules travel with the strategy." with three icon rows and
  one primary button on Explore; "Your execution rules" with three labelled
  selects, a note about whose limits apply and the `Save draft` /
  `Review plan →` pair on Build; "Risk envelope" with three rows and the
  `Simulate strategy →` / `Save draft` pair on the perps concept. Tables
  are hairline-ruled rows, no zebra striping, uppercase monospace column
  headers, actions as small filled buttons with a trailing arrow. Every
  screen ends with a muted one-line disclaimer ("Illustrative values.",
  "Publishing a strategy does not invest funds.", "Availability depends on
  issuer, jurisdiction and liquidity.") and, where the data has a date,
  the date at the right edge.
- **Stepper.** `Research`, `Assemble`, `Set Rules`, `Activate` on one
  line: numbered circles, checks for completed stages, the active stage
  filled periwinkle with white text, muted labels for the rest. The
  builder (F07) already carries these four stages under these names.
- **Buttons.** Primary: periwinkle fill, dark text, trailing `→`, fully
  rounded corners (`View thesis →`, `Start a draft →`, `Create strategy
  →`, `Review plan →`, `Simulate strategy →`). Secondary: transparent with
  a periwinkle outline and periwinkle text (`Save draft`). Chips: small
  outlined pills (`Concept`, `Strategies`).

## Explore (`explore-strategies.png`)

Tabs `Strategies`, `Stocks`, `Research` (the current Explore has
`Instruments` and `Watchlist`; the realignment renames `Instruments` to
`Stocks`, adds `Strategies` as the first tab over the public strategies
of F08 and `Research` over F06, and keeps the watchlist reachable from
`Stocks`). One search field spans the rest of the row ("Search a company,
theme or strategy"). The strategies table has the columns `STRATEGY`
(an icon tile, the title and a one-line description; eligibility notes
such as "eligibility required" belong in the description line),
`UNIVERSE` (`Listed stocks`, `Pre-IPO exposure`, `Custom`), `ALLOCATION`
(`4 assets`, `Your weights`) and `ACTION` (`View thesis →`, `Start a draft
→`). The last row is always "Build your own". The rail lists the three
promises with icons (verified instruments, assets stay in the wallet,
review before execution) and `Create strategy →`. Footer: "Illustrative
concepts. Availability depends on issuer, jurisdiction and liquidity."
In the app the rows are real backend data and the footer states the real
data source and time instead of "Illustrative".

## Build, Set Rules (`build-set-rules.png`)

"Shape your strategy." with the draft label (`Private AI · Draft v1`).
"Allocate your budget" lists each constituent as `Company · Issuer`
with a slider, a percent field and the resulting amount in USDC; below
the list the allocated total ("100% allocated") and the total budget
field. The rail "Your execution rules" carries three selects: `APPROVAL`
(`Review every order`), `SLIPPAGE CAP` (`0.50%`), `REBALANCING`
(`Suggest only`), the note "Limits apply to your account, not to everyone
following this strategy.", and `Save draft` / `Review plan →`. An info
line says "Publishing a strategy does not invest funds." and the footer
"Quotes and eligibility checked at review (date)". The current builder
keeps its exact basis-point semantics (weights are integers in basis
points, the cash remainder is explicit) and its policy-derived limits; the
realignment gives it this arrangement: sliders bound to the same
basis-point values, the amount column, the three selects (approval mode,
slippage cap within the person's limit, rebalancing preference as
"suggest only" until B16 exists), and the budget field kept apart from
the weights as the specification requires.

## Perps concept (`perps-future-preview.png`)

Reference for the visual language only: a `Long`/`Short` side column with
green and red outlined chips, a `TARGET NOTIONAL` monospace column, a
summary strip (`COLLATERAL`, `GROSS EXPOSURE`, `NET EXPOSURE`) with a
plain-language caveat under it ("different assets are not a matched
hedge"), a "Stress preview" list whose rows say what is unavailable
("Awaiting venue data", "Unavailable in this preview"), and a rail with a
risk envelope (leverage, approvals, reduce-only agent permissions). Perps
follow the stocks release (`docs/markov/product-scope.md`); this screen
must not be built, routed or linked in the stocks app.

## How the frontend sessions use this

1. The next frontend session (F10) builds its new screens to this
   language directly and runs a realignment pass over the shell (top bar,
   bezel tone, wordmark), Explore (tabs and table) and the builder's Set
   Rules stage, updating tokens, the measured-contrast table and the
   evidence screenshots in the same session.
2. Every visual change keeps the documented rules: exact formatters, no
   fabricated data, honest unavailable states, the production guards, and
   WCAG 2.2 AA contrast measured in `packages/ui/test/tokens.test.ts`.
3. The images are the reference, not the implementation: nothing in them
   becomes copy or data without the backend contract behind it.
