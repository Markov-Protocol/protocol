# Product contract (frontend)

Fixed decisions the application must not drift from. The backend
counterpart is `docs/markov/product-scope.md`.

- **Domains.** `markov.pet` is the software application. `markov.trade` is
  the commercial device and pricing site. This repository changes neither
  DNS nor storefront code.
- **Mark I fills the viewport.** A thin cream perimeter surrounds a black
  application display; every route lives inside that display (F02).
- **Stocks first.** Admitted PreStocks and xStocks exposures as the backend
  admits them. Tessera is a conditional, honestly gated path; perps are a
  later release boundary with separate contracts.
- **One of each.** One identity system, one wallet-selection model, one
  design system (`@markov/ui`), one review flow, one transaction-status
  vocabulary, one receipt system.
- **Recipe versus holdings.** A basket is a recipe plus the user's own
  holdings. No pooled fund, no basket-share token, no exchange.
- **Publish and invest are separate actions.** Following grants no spending
  authority; a new creator version never changes a follower's portfolio.
- **Owner approval.** Every V1 trade needs approval of the current plan.
  Recurring buys and rebalances create proposals ("Prepare for my
  approval"); nothing is unattended investing.
- **Honest availability.** App access, execution, issuer operations, price
  freshness and market hours are separate facts shown as such.
- **Original wording.** Research / Assemble / Set Rules / Activate;
  *Publish strategy* and *Review investment* are separate CTAs; no
  ambiguous Deploy button.

## Readiness labels used in evidence

`IMPLEMENTED`, `FIXTURE_VERIFIED`, `LIVE_READ_VERIFIED`,
`LIVE_WRITE_VERIFIED`, `BLOCKED`, `DISABLED`, as defined in the backend
capability contract. They are evidence labels; runtime capability state
comes from the backend.

## Capability gates in the UI

Every visible control navigates, mutates through a real contract, explains
a disabled capability (`Button` `disabledReason`) or opens a clearly labeled
simulation. Fixture data appears only behind `MARKOV_WEB_FIXTURES` or on
internal routes, and both are refused in production.
