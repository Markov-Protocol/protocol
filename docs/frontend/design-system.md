# Design system

Package: `@markov/ui` (source-exported, transpiled by Next.js). Tokens are
defined once in `packages/ui/src/tokens.ts`; `pnpm tokens:build` renders
`packages/ui/src/styles/tokens.css` and CI fails on drift.

## Colour tokens

| Token          | Value     | Purpose |
| -------------- | --------- | ------- |
| frameCream     | `#ECEBE6` | Mark I exterior perimeter |
| frameLight     | `#F6F5F0` | Small material highlights |
| screen         | `#080B10` | Main display background |
| surface        | `#121820` | Panels and readable regions |
| surfaceRaised  | `#19212C` | Menus, dialogs, selected blocks |
| text           | `#F3F1E9` | Primary content |
| textMuted      | `#A8B2C1` | Supporting labels and timestamps |
| accent         | `#89C9FF` | Active affordances and pixel eyes |
| accentInk      | `#09121D` | Text on filled accent buttons |
| success        | `#80D8AE` | Verified positive status (always with icon and text) |
| attention      | `#F0C77A` | Pending review or stale information |
| error          | `#FF9C9C` | Failures with recovery text |
| border         | `#677487` | Control boundaries |

Tailwind utilities use the same names (`bg-surface`, `text-text-muted`,
`border-border`, `bg-accent text-accent-ink`).

## Measured contrast (WCAG 2.2, computed in `packages/ui/test/tokens.test.ts`)

| Use                                  | Pair                    | Ratio   | Minimum |
| ------------------------------------ | ----------------------- | ------- | ------- |
| body text on the screen              | text / screen           | 17.43:1 | 4.5:1 |
| body text on panels                  | text / surface          | 15.77:1 | 4.5:1 |
| body text on dialogs and menus       | text / surfaceRaised    | 14.34:1 | 4.5:1 |
| supporting labels and timestamps     | textMuted / surface     | 8.33:1  | 4.5:1 |
| supporting labels in dialogs         | textMuted / surfaceRaised | 7.57:1 | 4.5:1 |
| text on filled accent buttons        | accentInk / accent      | 10.63:1 | 4.5:1 |
| links and active labels              | accent / surface        | 10.08:1 | 4.5:1 |
| success status text                  | success / surface       | 10.49:1 | 4.5:1 |
| attention status text                | attention / surface     | 11.17:1 | 4.5:1 |
| error status text                    | error / surface         | 8.91:1  | 4.5:1 |
| control boundaries (non-text)        | border / surface        | 3.76:1  | 3:1 |
| focus ring against the screen        | accent / screen         | 11.13:1 | 3:1 |
| focus ring against panels            | accent / surface        | 10.08:1 | 3:1 |
| wordmark on the cream frame          | accentInk / frameCream  | 15.77:1 | 4.5:1 |

Hover states darken the fill by 10 percent. Disabled and `aria-disabled`
controls never rely on opacity: they switch to `textMuted` on
`surfaceRaised` with a `border` outline (7.57:1), so an explained-disabled
button stays readable. `cn()` configures tailwind-merge with the token
names so custom size utilities (`text-body`) never discard colour
utilities (`text-accent-ink`); the browser axe run caught exactly that
defect before this rule existed.

## Typography

Inter 4.1 (variable, self-hosted from the upstream release zip; SIL Open
Font License, `apps/web/src/assets/fonts/LICENSE-Inter.txt`; file hashes in
`docs/frontend/source-register.md`). Monospace uses the system stack
(`ui-monospace, SFMono-Regular, Menlo, Consolas`) for addresses and code.

| Token      | Size / line height | Use |
| ---------- | ------------------ | --- |
| caption    | 12 / 16 px         | Timestamps, ids |
| supporting | 14 / 20 px         | Labels, descriptions |
| body       | 16 / 24 px         | Content |
| headingSm  | 20 / 28 px         | Section and dialog titles |
| headingMd  | 24 / 32 px         | Page sections |
| headingLg  | 28 / 36 px         | Page titles |
| metricSm   | 28 / 34 px         | Primary metric on narrow screens |
| metricLg   | 40 / 46 px         | Primary metric on wide screens |

Amounts use tabular numerals (`tabular` class). Substantive terms are never
all-caps microcopy; no small type to fit more financial data.

## Spacing, radii, motion, layers

Spacing tokens 4, 8, 12, 16, 24, 32, 48 px map to Tailwind units 1, 2, 3, 4,
6, 8, 12. Radii: control 10 px, panel 16 px, screen 32 px desktop / 20 px
phone, pill. Motion 120/180/220 ms with `cubic-bezier(0.2, 0, 0, 1)`,
reduced-motion collapses animations. Layers: base 0, dock 10, nav 20,
overlay 30, dialog 40, toast 50. Touch targets: 44×44 px preferred (the
`md` size); the `sm` size (36 px) is for dense desktop tables and still
exceeds the WCAG 2.2 AA minimum of 24 px.

## Components and status patterns

- `Button`: primary, secondary, ghost, danger; `loading` (aria-busy);
  `disabledReason` keeps the control focusable, sets `aria-disabled` and
  renders the reason as visible text linked by `aria-describedby`.
- `Field` wires label, description and error to any control via a render
  prop; `ValidationSummary` lists errors as links that focus their fields.
- `AmountInput` / `PercentInput` report exact raw amounts and integer basis
  points on every change; they never round silently and never erase invalid
  input on blur.
- `StatusBadge` and `Notice` always pair colour with an icon and text;
  `Notice` announces only when `live` is set.
- `ErrorBlock` shows a failure as a failure (with the request id), never zeros
  or demo data. `EmptyState` gives a real next step.
- `Table` sits in a labelled, keyboard-focusable scroll region so wide tables
  never force page-level horizontal scrolling.
- `Dialog`, `Menu`, `Tabs`, `SelectInput` wrap Radix primitives (focus
  management, keyboard navigation, portals).

The internal reference route `/dev/components` shows every state with long
names, large values and validation errors; it is served only when
`MARKOV_WEB_INTERNAL_ROUTES=true`, which production refuses.
