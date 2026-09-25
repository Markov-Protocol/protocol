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
| `/markets/[instrumentId]` | Exact-id instrument page: Overview (with rights and evidence, "Add to a new basket draft"), Research (the person's theses mentioning the instrument, start a thesis with it shortlisted, evidence rules), Liquidity (route observations, every field "Not observed" until B17/F09), Instrument tabs; save control; public availability refined by the person's capability states when signed in | public where the instrument is admitted or paused; personal states, theses and drafts authenticated | implemented (F05, F06) |
| `/research` | Research workspace: the person's theses (visibility, status, revision, instrument count) and a form that starts a private thesis | authenticated | implemented (F06) |
| `/research/[thesisId]` | Owner: the thesis editor (typed statements with citations, counterarguments, shortlist by canonical id with a catalog picker, research subjects with deterministic mapping, sources with fetched/refused/failed states and dates, bounded research runs with progress and cancel, private notes, publish with "what becomes public", archive, saved revisions, shortlist to basket draft). Anyone else: the published projection or "not found or private" | owner; published projection public | implemented (F06) |
| `/strategies/new` | Static path, never a strategy id: start a basket draft on the server or resume one; `?strategyId=` (older links) opens the editor | authenticated | implemented (F06, F07) |
| `/strategies/[strategyId]/edit` | The owner's basket builder on one draft identity: 01 Research (linked thesis, shortlist import), 02 Assemble (constituents by canonical id, exact basis-point weights with keyboard steps, explicit equal weights, cash remainder, notes), 03 Set Rules (title, thesis text, maintenance suggestion, references, the person's effective limits and approval preference read from the policy), 04 Activate (verified wallet and budget kept apart from the recipe, exact split estimates, availability and readiness, "Review investment" honestly unavailable until F09/F10); autosave with revision checks, Saving / Saved / Offline changes / Conflict states with compare and restore; archive and restore | owner | implemented (F07) |
| `/portfolio`, `/activity`, `/rankings`, `/automations`, `/status` | navigation targets | public shell | honest unavailable pages naming the delivering session (F02); real features arrive with F10 onward |
| `/strategies/[strategyId]` | Owner: the working draft's state, "Freeze as version N" (unavailable with its reason when the draft breaks a rule or the strategy is archived), every frozen version with its chain-derived registration state (Saved privately / Publishing / Registered on-chain / Failed / Expired / Status unknown), and what others see (registered versions, followers). Anyone else: the registered projection (title, registered versions with status marker, record address and date, follower count, fork attribution), Follow / Unfollow, Fork, "Review investment" honestly unavailable until F09 | owner; registered projection public | implemented (F08) |
| `/strategies/[strategyId]/versions/[versionId]` | Owner: the immutable version (recipe with mints, thesis, rules, disclosures, hashes, lineage and the difference from the previous version), the registration panel (prepare with a verified wallet → what becomes public, what never does, permanence, cost → sign with the connected publisher wallet through `solana:signTransaction` → submit → state read from the chain, restored on reload), registration evidence with explorer links and verification once registered, deprecation and reactivation by the publisher wallet, fork. Anyone else: the registered projection with evidence, verification, canonical bytes, the indexed record, the public difference from the previous public version, Follow and Fork | owner; registered projection public | implemented (F08) |
| `/portfolio/[instanceId]`, `/review/[intentId]`, `/activity/[intentId]`, `/receipts/[receiptId]`, other `/settings/*`, `/ops/*` | product routes | per the build prompt | not started |

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

## Session journeys (F06)

- **Start from an instrument.** The Research tab of `/markets/<id>` states
  the evidence rules (backing, rights, fees and redemption claims need an
  issuer, legal or filing source) and lists the person's theses whose
  current revision references that exact instrument
  (`GET /v1/me/theses?instrumentId=`). "Start a thesis" creates a private
  thesis with the instrument already shortlisted and opens the editor.
  Anonymous people get a sign-in link that returns to the page; no private
  route is touched.
- **Cite sources.** A source is attached by https URL; the API retrieves it
  under its safe-retrieval policy and records `fetched`, `blocked` or
  `failed` with the reason, the fetch time and any dates the author
  supplied. Every record is shown as a card (status, role, host, dates,
  plain-text excerpt, hash); only https destinations become links, and a
  refused or failed source cannot be cited. Facts and issuer assertions
  tick the fetched sources they rest on; opinions carry none.
- **Run bounded research.** A run reads only the ticked fetched sources
  within a fixed budget. Progress is polled and can be cancelled; the
  result shows labelled model interpretations, suggested admitted
  instruments (confirmed one by one), companies the catalog does not carry
  (added as research subjects) and what validation dropped, with the
  provider, model, prompt hash and budget used. Adopting the output only
  changes the unsaved form; a deployment without a model provider says so
  instead of pretending.
- **Save and keep private.** "Save revision" appends an immutable
  numbered revision; the status line reads Saving, Saved as revision N,
  or the failure with the edits kept in the form. Rules the API refuses are
  listed by field; a revision saved elsewhere (another tab) is announced
  and loadable, never silently overwritten. Private notes are excluded
  from the content hash and from any public page. Leaving with unsaved
  changes asks first.
- **Publish.** "Publish…" shows exactly what becomes public (the saved
  revision's statements, instruments, subjects, sources and content hash;
  never notes, account, wallets or budgets) before `PATCH visibility`. The
  public page `/research/<id>` is the API's projection; a private or
  unknown thesis answers "not found or private" to everyone else.
- **Shortlist to basket.** From the saved shortlist, "Start a basket draft"
  states the plan first (equal integer weights per leg, the exact remainder
  as cash, total 10,000 bps) and creates a B07 draft linked to the thesis.
  The backend's validation result is shown verbatim; "Open in Build" lands
  on `/strategies/new`, which lists the drafts with the new one
  highlighted. "Add to a new basket draft" on an instrument page does the
  same with one constituent at 100.00%. No weight is normalised by the app,
  nothing is bought.

## Session journeys (F07)

- **One draft identity.** `/strategies/new` creates a draft on the server
  (or resumes one) and opens `/strategies/<id>/edit`; every edit is saved
  against the revision it started from (`PUT …/draft` with `ifRevision`),
  and the backend's validation of exactly what was saved is shown in the
  persistent summary. Nothing lives only in the browser.
- **Assemble.** Constituents are added from the admitted catalog by
  canonical id (duplicates refused at the picker); weights are typed as
  percentages with at most two decimals and stored as integer basis
  points, or nudged with ±1% buttons; move up/down and remove are buttons.
  Removing a constituent leaves every other weight as it was and shows
  the remainder. "Set equal weights" and "Put the remainder in cash" are
  explicit actions. The total including cash must be exactly 100.00%:
  9,999 and 10,001 bps are reported as such by the local check and by the
  backend (`WEIGHTS_TOTAL`), never rounded away. A zero-weight
  constituent may sit in a draft (`ZERO_WEIGHT`), never in a version. An
  unavailable constituent is flagged with its status; nothing is swapped
  in for it.
- **Save states.** Saving, Saved as revision N, Offline changes (kept on
  this device under an account-scoped, versioned, short-lived key,
  purged for any other account) with Retry, Conflict when another tab
  saved first: the panel compares both revisions (added, removed and
  changed constituents, cash, title, rules) and the person keeps their
  edits as the next revision or takes the server's. Leaving with unsaved
  edits asks first.
- **Set Rules.** Title, thesis text, maintenance suggestion (a
  suggestion, never an instruction), references; the limits that apply
  to the person (per order, per day, per account, slippage, quote age,
  cash reserve, concentration ceilings, venues, ceiling source) read from
  `GET /v1/me/limits`; the approval preference is stated: the person
  approves every transaction in their own wallet.
- **Activate.** A verified wallet and a budget in the network's
  stablecoin are chosen apart from the recipe and never stored with it;
  the budget is split as floor(budget × weight) in exact base units with
  the remainder as cash, checked against the observed balance and the
  person's limits; per-constituent availability comes from the policy;
  a readiness list says what is missing. "Review investment" is
  unavailable with its reason until F09/F10; nothing is bought.
- **Safe return.** Sign-in returns to the edit page; verifying a wallet
  happens on `/settings/wallets` and the draft is on the server when the
  person comes back.

## Session journeys (F08)

- **From draft to version.** The builder header and the Build page link to
  `/strategies/<id>`, where "Freeze as version N" calls
  `POST …/versions` with the draft revision. A frozen version is
  immutable: the page says so, edits create a new version, and instances
  pinned to an older version stay pinned until their owner accepts a
  newer one (B07). Every version row carries its registration state as
  the API derives it from the chain, never from a saved flag.
- **Publish.** On the version page the owner chooses one of their
  verified wallets (the connected one is preselected) and prepares the
  registration. The API answers exactly what becomes public (version,
  title, thesis, constituents by mint and weight, cash, rule, references,
  manifest hash, content digest, publisher wallet, record address,
  lineage), what never does, the permanence statement, the cost in SOL and
  lamports, the fee payer and the block height after which the
  transaction expires. Nothing is sent yet. The person confirms the
  permanence statement; the sign button is unavailable with its reason
  until the connected wallet is the publisher wallet on the platform's
  network and can sign transactions. The wallet receives the prepared
  bytes through `solana:signTransaction`; the app checks that what comes
  back is the same message with the fee-payer slot filled, otherwise
  nothing is submitted. The API verifies the signature before the node
  sees the transaction.
- **States.** Saved privately, Publishing (prepared or sent), Registered
  on-chain, Failed (with the program's error), Expired and Status unknown
  are distinct and read from the API on every load, so a reload lands in
  the same place; while the network has not decided the page polls and
  offers "Re-check now". Explorer links appear only from the finalized
  evidence the API validated. A deployment without a registry program
  keeps the prepare step unavailable with the reason.
- **Deprecate.** Once registered, the publisher wallet can mark the record
  deprecated (or active again) through the same review, sign and submit
  steps; only the status byte moves and the public page shows the marker.
- **Public pages.** Anyone can open a registered strategy and version:
  the recipe, the hashes, the canonical bytes to recompute the hash, the
  registration evidence (network, program, record, transaction, slot,
  publisher, status) with explorer links, the API's verification of the
  version against the indexed record (a mismatch is shown as an error),
  the indexed record itself, and the readable difference from the
  previous public version. A private or unknown id answers "not found"
  whoever asks, without hinting at the owner.
- **Follow and fork.** A signed-in person follows a public strategy
  (bookkeeping on their account, listed with the newest registered
  version) or forks a registered version into a private draft of their
  own that opens in the editor with `forkOf` attribution; neither buys
  anything or moves a pin, and the original strategy is untouched.
  Anonymous readers get sign-in links. "Review investment" stays
  unavailable with its reason until F09/F10.
