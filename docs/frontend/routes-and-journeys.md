# Routes and journeys

Status after F01. The full route inventory of the frontend build prompt is
the target; only the rows marked *implemented* exist.

| Route             | Purpose                                      | Access                      | Status |
| ----------------- | -------------------------------------------- | --------------------------- | ------ |
| `/`               | Mark I companion home: anonymous, verifying, signed-in (next-step checklist with honest availability) and backend-unavailable variants | public shell; variant chosen from the verified session | implemented (F02, F03) |
| `/sign-in`        | The one sign-in screen; offers exactly the identity path the backend runs (development issuer in local/test; hosted provider BLOCKED until OD-05); `?next=` is a validated local path; `?switch=1` switches accounts | public | implemented (F03) |
| `/auth/callback`  | Provider redirect target with explicit cancelled, failed, unsupported and empty outcomes | public | implemented (F03) |
| `/api/auth/session`, `/api/auth/sign-in`, `/api/auth/sign-out` | Same-origin session routes (`Cache-Control: no-store`); mutations require a same-origin browser request with a JSON body | app server only | implemented (F03) |
| `/dev/components` | Internal component reference inside the shell | internal; `MARKOV_WEB_INTERNAL_ROUTES=true`; refused in production | implemented |
| `/explore` | Instruments tab over admitted and paused instruments (search, category, issuer collections, bounded pagination, watchlist toggles), Watchlist tab (account-scoped), Strategies tab (arrives with F12); filter and tab state in the URL (`q`, `issuer`, `kind`, `tab`, validated values only) | public; watchlist authenticated | implemented (F05) |
| `/markets/[instrumentId]` | Exact-id instrument page: Overview, Research (F06), Liquidity (F09/B17), Instrument tabs; save control; public availability refined by the person's capability states when signed in | public where the instrument is admitted or paused; personal states authenticated | implemented (F05) |
| `/strategies/new`, `/portfolio`, `/activity`, `/rankings`, `/automations`, `/status` | navigation targets | public shell | honest unavailable pages naming the delivering session (F02); real features arrive with F07 onward |
| `/research/*`, `/strategies/[strategyId]/*`, `/portfolio/[instanceId]`, `/review/[intentId]`, `/activity/[intentId]`, `/receipts/[receiptId]`, other `/settings/*`, `/ops/*` | product routes | per the build prompt | not started |

## Session journeys (F03)

- **Sign in.** Any "Sign in" control links to `/sign-in?next=<current path>`.
  The page reads the backend's platform facts: with the nonproduction test
  issuer it shows a subject form labelled *Nonproduction*; with a hosted
  provider it says the browser adapter is not configured (BLOCKED) and offers
  no substitute. The app server exchanges the identity token for an opaque
  Markov session and sets the HttpOnly cookie; the browser only ever receives
  the account summary and the validated return path.
- **Reload and return.** Every request resolves the session on the server
  before the first paint. Back/forward-cache restores and tabs hidden for
  more than 30 seconds re-verify before private views render again.
- **Expiry.** The client schedules a re-verification at the server-declared
  expiry; when the server no longer confirms a session that was signed in,
  the state becomes *expired*: the top bar and a notice on every route
  offer "Sign in again" with the current path preserved, and the private
  query cache of the ended session is disposed.
- **Sign out.** Revokes the API session and clears the cookie. If the API is
  unreachable the cookie is still cleared and the person is told the server
  session expires on its own. A replayed cookie is refused afterwards.
- **Switch account.** Signing in while signed in revokes the previous session
  server-side; the client bumps its session epoch so requests started under
  the previous account are aborted and any late response is discarded.
- **Cancelled or failed provider login.** `/auth/callback` explains the
  outcome from the OAuth-shaped `error`/`error_description` parameters
  (sanitised, length-limited) and offers to try again or go home.

## Session journeys (F04)

- **Choose a wallet.** `/settings/wallets` lists every Solana wallet the
  page discovers through the Wallet Standard with its declared capabilities
  (message signing, transaction signing and versions, sign-and-send, chains).
  Nothing connects until the person chooses; a wallet with several accounts
  asks which one will sign. The Markov-managed (embedded) wallet is listed
  as not available (OD-05).
- **Network check.** The connected account's chains are compared with the
  platform cluster; on a mismatch the page explains what to switch and asks
  for no signature.
- **Verify ownership.** A fresh challenge from the API is shown verbatim,
  signed through `solana:signMessage`, and presented once. Replays, wallets
  verified on another account, stale sign-ins, declined or altered
  signatures and a session or wallet change mid-flow each end in a stated
  outcome with what to do next; nothing is linked in the failing cases.
- **Receive and funding.** Each verified wallet can show its own address
  (full text, copy, QR), the exact cluster and stablecoin mint, the SOL and
  stablecoin balances observed by the backend at a stated slot, and the fee
  requirement with its basis. Unknown balances are shown as unknown.
- **Disconnect vs sign out.** "Disconnect wallet" forgets the connection
  and the remembered choice; "Sign out" in the account menu ends the
  identity session. A reload resumes the previously chosen wallet silently
  when the wallet allows it; a session change disconnects the wallet and
  says so.
- **Eligibility and terms.** `/settings/eligibility` shows the latest
  decision and its standing, the summary from the API, the remaining steps
  (declare, await review, acknowledge terms by content hash, verify a
  wallet) and never suggests changing the declared jurisdiction to get
  around a denial.
- **Home checklist.** Lists only what the account still needs (wallet,
  eligibility and terms, funding once a wallet is verified, strategy later),
  from live readiness rather than a static list.

Rules that already apply:

- Static paths such as `/strategies/new` must never be mistaken for a dynamic
  id; `/strategies/new` exists as a static route before any
  `/strategies/[strategyId]` folder is added.
- Shell mode is derived from the path (`/` companion, everything else
  workspace); the More menu holds Activity, Rankings, Automations, Settings
  and the focus preference. `/settings`, `/settings/wallets` and
  `/settings/eligibility` are delivered; other settings areas say when they
  arrive.
- Private pages are excluded from indexing and shared caching; `noindex` is
  not access control. Until a public product surface exists the root layout
  sets `robots: noindex, nofollow`.
- Unknown routes render `not-found.tsx` inside the app, without private data.
- Return paths are validated local paths (`safeReturnPath`): no scheme, no
  protocol-relative URL, no backslash, no control character, never an auth
  route; anything else falls back to `/`.
- All routes render dynamically because the root layout reads the session
  cookie; nothing private is ever served from a static or shared cache.

## Session journeys (F05)

- **Browse.** `/explore` lists instruments the backend admitted (or paused)
  after mint verification, in symbol order, 25 per page with a cursor and
  a cap of 8 pages before asking for a narrower search. Each row names the
  company, the issuer (badge) and the network, the category (listed stock
  with its underlying ticker, or pre-IPO exposure), the backend-typed
  reference price with its kind and age (stale flagged, missing shown as
  "Unpriced"), the availability summary with reasons, and when the catalog
  last changed it from the issuer's feed. Two exposures to one company are
  told apart by issuer badge, symbol and category.
- **Search and filter.** Search is debounced (300 ms) and matches company,
  name or symbol prefix; the PreStocks collection and the xStocks filter
  set the issuer; the category select distinguishes listed stocks from
  pre-IPO exposures. Only validated values reach the URL and the API; a
  late answer to an older search lands in its own cache entry and never
  replaces newer results (the previous list stays visible, marked as
  updating, until the new one arrives).
- **Open an instrument.** Rows link to `/markets/<instrumentId>` (the
  canonical Markov id, never a ticker). Overview shows what the token is
  (issuer exposure, not shares, no implied relationship with the company),
  the issuer's sanitised description with its source and the catalog
  update time, the reference price basis, "History unavailable" instead of
  a chart, what the person can do now (public availability, refined by B05
  capability states after sign-in, with every reason), lifecycle notices
  (halt, migration, sunset, pending actions, pause) and corporate actions.
  Instrument shows the mint (copy, explorer link on public clusters),
  program, decimals, genesis, verification evidence, extension policy and
  multiplier evidence. Research and Liquidity say which session brings
  them. An unknown or unadmitted id answers "No admitted instrument with
  that id".
- **Save.** Anonymous people see "Sign in to save", which returns to the
  same page. Signed in, Save adds the instrument to the account's
  watchlist with the list version; the Watchlist tab lists saved
  instruments with their current status (a delisted one stays visible as
  delisted), and Remove takes it off. A list edited on another device is
  detected (`IDEMPOTENCY_CONFLICT`), refreshed and the person is asked to
  try again; nothing is overwritten silently.
