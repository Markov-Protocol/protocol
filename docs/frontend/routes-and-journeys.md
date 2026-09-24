# Routes and journeys

Status after F01. The full route inventory of the frontend build prompt is
the target; only the rows marked *implemented* exist.

| Route             | Purpose                                      | Access                      | Status |
| ----------------- | -------------------------------------------- | --------------------------- | ------ |
| `/`               | Mark I home                                  | public shell                | placeholder page (shell in F02) |
| `/dev/components` | Internal component reference                 | internal; `MARKOV_WEB_INTERNAL_ROUTES=true`; refused in production | implemented |
| `/explore`, `/markets/[instrumentId]`, `/research/*`, `/strategies/*`, `/portfolio/*`, `/review/[intentId]`, `/activity/*`, `/receipts/[receiptId]`, `/rankings`, `/automations`, `/settings/*`, `/status`, `/ops/*` | product routes | per the build prompt | not started (F02 onward) |

Rules that already apply:

- Static paths such as `/strategies/new` must never be mistaken for a dynamic
  id; route folders will be ordered so the static segment wins.
- Private pages are excluded from indexing and shared caching; `noindex` is
  not access control. Until a public product surface exists the root layout
  sets `robots: noindex, nofollow`.
- Unknown routes render `not-found.tsx` inside the app, without private data.
