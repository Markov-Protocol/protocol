# Accessibility

Target: WCAG 2.2 AA for the complete user journey. Automated scans are one
input, not a conformance certificate.

## Verified in F01

- Contrast of every documented colour pair measured in
  `packages/ui/test/tokens.test.ts` (results in `design-system.md`).
- Component behaviour in jsdom: focusable disabled explanations, dialog focus
  move and return, label/description/error association, validation summary
  focus and links, tab arrow-key navigation, exact numeric editing with
  `inputmode="decimal"`.
- axe-core (WCAG 2.0/2.1/2.2 A and AA tags) on a composed page in jsdom and
  on the reference route in Chromium at 1280 and 320 CSS px.
- No page-level horizontal scrolling on the reference route at 320 CSS px.
- Reduced motion collapses animations globally (`base.css`).

## Conventions every screen follows

Semantic landmarks and headings; visible focus (2 px accent outline);
named controls; status conveyed by icon and text as well as colour; tables
with header scope inside labelled scroll regions; sliders (when added) with
numeric fields; tooltips never the only place for units, risk terms or
errors; touch targets 44 px preferred, never below the WCAG 2.2 24 px
minimum.

- F03: the sign-in screen passes axe (WCAG 2.0/2.1/2.2 A+AA tags) in
  Chromium; the subject field is labelled and described through `Field`,
  the submit explains why it is unavailable instead of hiding, the
  development issuer is marked *Nonproduction* in text; the expired-session
  notice and the unavailable-backend notice are polite live regions; the
  account menu trigger names the account; the verifying home reads as busy.

## Not yet verified

Live-region strategy for execution status, screen-reader journeys through
sign-in, allocation editing, review and wallet handoff, 200% text resize
and 400% zoom on real screens, iOS keyboard behaviour. These arrive with
the journeys that own them.
