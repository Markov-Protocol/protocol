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
| `/explore` | Strategies tab first and by default (F12): registered, unwithheld strategies as the API lists them, one row per strategy with its newest public version (title, thesis excerpt, universe and issuer mix, assets and cash, the registering wallet linked to its creator page, follower count) and the model ranking entry for the chosen period (rank with return, drawdown and history, or "Unranked" with the methodology's reason and no number), search, issuer, period and sort filters, instrument and creator filters from links, stable cursor pages with a cap, a "Build your own" row, the reference rail, the source line with the read time; a Following section and a Following badge for the signed-in person, composed from their private list. Stocks tab (`tab=instruments`) over admitted and paused instruments (search, category, issuer collections, bounded pagination, watchlist toggles), Watchlist tab (account-scoped); filter and tab state in the URL (`q`, `issuer`, `kind`, `instrumentId`, `creator`, `period`, `sort`, `tab`, validated values only) | public; following and watchlist authenticated | implemented (F05, F12) |
| `/markets/[instrumentId]` | Exact-id instrument page: Overview (with rights and evidence, "Add to a new basket draft"), Research (the person's theses mentioning the instrument, start a thesis with it shortlisted, evidence rules), Liquidity (route observations, every field "Not observed" until B17; a buy is reviewed through the review, which shows the venue's quote and route), Instrument tabs; save control; public availability refined by the person's capability states when signed in, "Review a buy" into `/review/new` when the person can quote the instrument, selling unavailable until F10 | public where the instrument is admitted or paused; personal states, theses and drafts authenticated | implemented (F05, F06, F09) |
| `/research` | Research workspace: the person's theses (visibility, status, revision, instrument count) and a form that starts a private thesis | authenticated | implemented (F06) |
| `/research/[thesisId]` | Owner: the thesis editor (typed statements with citations, counterarguments, shortlist by canonical id with a catalog picker, research subjects with deterministic mapping, sources with fetched/refused/failed states and dates, bounded research runs with progress and cancel, private notes, publish with "what becomes public", archive, saved revisions, shortlist to basket draft). Anyone else: the published projection or "not found or private" | owner; published projection public | implemented (F06) |
| `/strategies/new` | Static path, never a strategy id: start a basket draft on the server or resume one; `?strategyId=` (older links) opens the editor | authenticated | implemented (F06, F07) |
| `/strategies/[strategyId]/edit` | The owner's basket builder on one draft identity: 01 Research (linked thesis, shortlist import), 02 Assemble (constituents by canonical id, exact basis-point weights with keyboard steps, explicit equal weights, cash remainder, notes), 03 Set Rules (title, thesis text, maintenance suggestion, references, the person's effective limits and approval preference read from the policy), 04 Activate (verified wallet and budget kept apart from the recipe, exact split estimates, availability and readiness, "Review investment" opening `/review/new` for the newest frozen version with the wallet and budget carried over, unavailable with its reason until a version is frozen); autosave with revision checks, Saving / Saved / Offline changes / Conflict states with compare and restore; archive and restore | owner | implemented (F07) |
| `/rankings` | One model cohort at a time (`?period=30d|90d|365d`): every entry the API lists with rank, time-weighted return, drawdown, history days and points valued, or "Unranked" with the reason; the methodology panel beside it (cohort, currency, what a rank needs, costs excluded by the model, pricing) and the API's note with the read time; nothing here is anyone's account | public | implemented (F12) |
| `/creators/[publisherWallet]` | A creator as the chain knows it: the wallet (copy, explorer link), listed strategies, registered versions signed, followers across them, first and latest registration, the strategy rows as the explorer lists them, the API's note; "No listed strategy was registered by this wallet" otherwise | public | implemented (F12) |
| `/automations`, `/status` | navigation targets | public shell | honest unavailable pages naming the delivering session (F02); real features arrive with F13 onward |
| `/activity` | The person's orders newest first with URL filters (`?filter=open|in-flight|attention|settled`, validated values only): kind, state, budget, wallet, last update; each row a stable deep link to the review (while the plan is reviewed) or the execution timeline | owner | implemented (F10) |
| `/activity/[intentId]` | Restorable execution status and per-transaction timeline: state and its reason, the next real step (build, sign, waiting for the network, check with the network, review the unfilled legs, issue a receipt), the built transaction shown before the wallet opens (legs with max input and minimum output, network cost at most, signer, blockhash validity, simulation, decoded instructions, message hash), the signing preconditions checked in the browser and again by the API, the wallet handoff through `solana:signTransaction` with the returned bytes checked against the prepared message, cancel or cancellation request with the consequence spelled out, one stage list per transaction (built, signed, broadcast, confirmed, finalized, fills recorded) with the signature, explorer link, fills, the fee actually paid, the reconciliation evidence and the last check; receipts issued from here. Everything is server state: a reload, a second tab and a closed wallet popup come back to the same record. Another person's intent is "not found" | owner | implemented (F10) |
| `/receipts/[receiptId]` | One signed receipt: what was requested, approved, submitted, filled, charged and reconciled with timestamps and version references; the signing key with its published status, the canonical hash, the JSON to verify offline with the CLI; the owner opts the receipt into or out of public reading. Public receipts are readable by anyone with the link, with the owner id omitted; private ones are "not found" to anyone else | owner; public once opted in | implemented (F10); export and the requested-against-filled explanation added in F11 |
| `/strategies/[strategyId]` | Owner: the working draft's state, "Freeze as version N" (unavailable with its reason when the draft breaks a rule or the strategy is archived), every frozen version with its chain-derived registration state (Saved privately / Publishing / Registered on-chain / Failed / Expired / Status unknown), and what others see (registered versions, followers). Anyone else: the registered projection (title, registered versions with status marker, record address and date, follower count, fork attribution), the creator (the wallet that signed the newest registration, linked to its page) and the honest ranking line of the newest version (F12), Follow / Unfollow, Fork, "Review investment (version N)" into `/review/new` for the newest registered version | owner; registered projection public | implemented (F08, F09, F12) |
| `/strategies/[strategyId]/versions/[versionId]` | Owner: the immutable version (recipe with mints, thesis, rules, disclosures, hashes, lineage and the difference from the previous version), the registration panel (prepare with a verified wallet → what becomes public, what never does, permanence, cost → sign with the connected publisher wallet through `solana:signTransaction` → submit → state read from the chain, restored on reload), registration evidence with explorer links and verification once registered, deprecation and reactivation by the publisher wallet, fork. Anyone else: the registered projection with evidence, verification, canonical bytes, the indexed record, the public difference from the previous public version, Follow and Fork; both views offer "Review investment" for this exact version | owner; registered projection public | implemented (F08, F09) |
| `/review/new` | Start a review: the target from the query (`?strategyId=&versionId=` for a basket investment in that exact version, owner's copy or public projection; `?instrumentId=` for a single buy of an admitted instrument), one of the person's verified wallets with its observed balances, an exact stablecoin budget (`?walletId=&budget=` prefilled from the builder), budget mode, a slippage limit defaulting to the platform's 0.50% capped by the person's policy limit (tighten only), eligibility; "Get quotes and review" creates the intent with a per-visit idempotency key and opens the review. Nothing is quoted, reserved or bought here | authenticated | implemented (F09) |
| `/review/[intentId]` | The one review for basket investments and single buys: the plan the API built for the exact budget (input and allocation, constituents with max input, expected and minimum output, price impact, slippage limit and transaction, cash that stays, fees with basis and fee payer, signatures and transactions, atomic or staged semantics with batch order, policy evidence per leg, validity with countdown, funds observed, quote references, plan id and hash); approval bound to the plan hash with the staged acknowledgement when required; refusals as actions (add funds and check again, eligibility, another budget, try again); expired terms refreshed with a difference view before any approval; connected wallet, network and newer version differences called out; cancel; after approval the F10 execution panel builds, checks and signs each transaction and hands off to the timeline. Another person's intent is "not found" | owner | implemented (F09) |
| `/review` | The person's reviews, newest first, with state and budget | authenticated | implemented (F09) |
| `/portfolio` | One verified wallet at a time (`?walletId=`, `?period=`): the journal's holdings against the last chain observation (quantity with the multiplier the API reports, the API's valuation with its price kind, source and age, chain against record with the difference, matched, stale, unobserved, needs-reconciliation or unexplained status, attribution to instances or the wallet), the reconciliation checkpoint (slot, commitment, age) with "Reconcile with the chain now", the valued total or "Incomplete" with the unpriced assets named, the external flows the owner still has to explain (deposit, withdrawal, a transfer they made, other, with a note; recorded at wallet level, never to a strategy), the strategy instances in the wallet, the wallet's performance over a period labelled personal · methodology · currency with every unknown stated with its reason, an accessible chart summary and the exact figures behind the latest point, the complete record as a JSON download, and the history (journal entries newest first with their wallet-side movements, attribution, explanation and lines) | owner | implemented (F11) |
| `/portfolio/[instanceId]` | One tracked implementation of a pinned version: title and version with a link to the recipe, the wallet, and when the creator registered a newer version the proposal panel (F12): the exact difference against the pinned version (legs added, removed and changed, cash, one-sided turnover), a link to the new version's evidence, "Accept version N" that moves the pin and nothing else, or keep the current version; a proposed version that is no longer public cannot be accepted; target against actual allocation (the recipe's weight, the weight among invested legs since the cash share stays in the wallet, the attributed quantity, the value, the actual share and the drift in basis points, "Not reported" with the reasons while any leg is unpriced, legs not held and holdings outside the recipe named as such); lots in FIFO order with cost and fees, the cost basis (bookkeeping) or "Unknown", the reconciliation status, holdings as a JSON download; personal (actual) next to the version's model (buy and hold) series over the same period with the same labels, chart summaries and exact figures, each with its complete record as a download; the instance's own history. Another person's instance is "not found" | owner | implemented (F11) |
| `/receipts/[receiptId]` (F11 additions) | Requested against filled per approved leg (max in, min out, filled in, filled out, within bounds or not filled), the fees actually paid against the approved cap with the chain evidence (signatures, finality, slots), a JSON download, a link to the portfolio for the owner | owner; public once opted in | implemented (F11) |
| other `/settings/*`, `/ops/*` | product routes | per the build prompt | not started |

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
  a readiness list says what is missing. "Review investment" (F09) opens
  the review of the newest frozen version with the wallet and budget
  carried over, and is unavailable with its reason until a version is
  frozen; nothing is bought on this page.
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
  Anonymous readers get sign-in links. "Review investment" (F09) opens
  the review of that registered version for a signed-in person.

## Session journeys (F09)

- **One review for every trade.** A basket investment (from the builder's
  Activate stage, the strategy page or a version page) and a single buy
  (from an instrument page) open the same `/review/new` and the same
  `/review/[intentId]`. The target is exactly what the link named: a
  pinned version by id (never the working draft, never "the latest
  version") or one admitted instrument by canonical id. Assistant and
  maintenance proposals (F13/F14) will land on the same screen.
- **Start.** The person chooses one of their verified wallets (balances
  observed by the API through the RPC, shown with the slot), an exact
  stablecoin budget in base units and the budget mode. The slippage limit
  defaults to the platform's 0.50% capped by the person's effective policy
  limit, read from the API; it can only be tightened. Local hints name the
  per-order cap (for a basket, against the largest constituent's share)
  and the observed balance, but the API decides: creating the intent
  quotes nothing and reserves nothing, and the review page asks the API
  for a plan.
- **The plan.** The API builds the plan for the exact budget: the
  allocation in base units (largest remainder; targets plus cash equal the
  investable amount), one exact-in quote per constituent with the expected
  and minimum output at the slippage limit, price impact, the route's
  venue and mode (fixture quotes are labelled as such), every fee with its
  basis (base network fee, priority fee at most, token account rent at
  most, total SOL at most, the Markov fee under the published policy) and
  the fee payer (the person's wallet), the number of signatures and
  transactions, atomic or staged semantics (a staged basket lists its
  transactions in order with the worst-case spend after each and the cash
  still in the wallet, and needs a separate acknowledgement that later
  transactions can fail after earlier ones filled and nothing is rolled
  back), the policy version, eligibility decision and per-constituent
  decisions with their expiry, the plan's validity with a live countdown,
  the funds observed, the quote references and the plan id and hash. The
  page states what has not happened: nothing reserved, nothing signed (the
  simulation row reads the plan-time simulation of a composed basket, and
  every transaction is simulated again when it is built). A preview amount
  is not a reserved fill.
- **Approval bound to the hash.** "Approve plan" (or "Approve staged
  plan" after the acknowledgement) records the person's approval against
  the plan hash; the API refuses an approval whose hash is not the current
  plan (`PLAN_CHANGED`) or whose plan expired (`QUOTE_EXPIRED`). After
  approval the execution panel (F10) takes over with "Build transaction 1
  of N"; nothing says "investment complete".
- **Changed terms.** A refreshed plan (by choice, or because the terms
  expired) never replaces the one on screen behind an enabled approval
  button: the page shows what changed (budget, spend, cash, SOL bound,
  fee, transactions, semantics, fee payer, wallet, version, quote mode,
  validity; per constituent max input, expected, minimum, impact,
  slippage, transaction; changed constituents) and keeps approval
  unavailable until the person has read the new terms; a staged
  acknowledgement is asked again. Expired terms are labelled expired with
  a refresh; the old plan reads as superseded once a newer one exists. A
  connected wallet that differs from the plan's wallet, a wallet on
  another network, no connected wallet and a newer version of the strategy
  are called out on the page.
- **Refusals are actions, not workarounds.** Insufficient stablecoin or
  SOL names both shortfalls with "Add funds" and "Check again"; a policy
  denial shows the API's codes with eligibility and terms or another
  budget as the next step; a budget below the route minimum names the
  smallest workable budget without touching the weights; a constituent
  that is no longer admitted, unavailable quotes and rate limits each keep
  the intent open for another attempt. None of them bypasses the check.
- **Cancel and list.** Cancelling is explicit (confirm) and final for the
  intent; `/review` lists the person's reviews with their state. Another
  person's intent is "not found".

## Session journeys (F10)

- **From approval to a signed submission.** Under the recorded approval
  the execution panel asks the API to build the plan's next transaction
  (decoded, validated against the plan and simulated before anyone sees
  it) and shows exactly what the wallet will show: each leg's mint, the
  most it may spend and the least it must receive, the network cost at
  most (fee, priority, rent for the accounts it creates) and who pays it,
  the signer, the blockhash and the last block it can land in, the
  simulation result, the decoded instructions and the message hash. "Sign
  transaction k of N" stays unavailable, with the reason, until every
  check passes in the browser: the transaction belongs to this intent and
  to the plan whose hash the person approved, the connected wallet account
  is the plan's wallet and sits on the app's cluster, the wallet can sign
  transactions, the plan has not expired, the unsigned bytes hash to the
  message the API validated, and the simulation passed. The wallet
  receives the exact prepared bytes through `solana:signTransaction`; what
  comes back must be the same message with the fee-payer slot filled and
  must hash to the same message, or nothing is sent. One click, one
  wallet request, one submission; the API verifies the signature, the
  message, the plan, the blockhash and the policy again before the one
  broadcast.
- **Wallet outcomes.** A declined signature keeps the built transaction
  and sends nothing; a wallet that stays silent is called out after a
  while with "Stop waiting", after which a late signature is discarded;
  a wallet that returns different bytes, a wallet or account that changed
  while the popup was open, and a connected account that is not the plan's
  wallet all refuse without submitting. A session that changed mid-flow
  submits nothing. No wallet outcome creates a new intent or a new
  transaction on its own.
- **Submission outcomes.** A refusal from the API (signature mismatch,
  expired plan, expired blockhash, policy denial, an attempt already in
  flight, a batch not ready) says what was and was not sent and leaves
  the next real step (build again, review again, wait). An answer lost
  after the bytes left the browser is treated as unknown: the panel
  reconciles the existing attempt from chain evidence and never asks for
  a second signature; a node that gave no answer leaves the intent
  "Result unknown; reconciling" until the chain decides.
- **The timeline.** After a submission the review hands off to
  `/activity/[intentId]`, which survives reloads, wallet popups and other
  tabs because it is the API's record: per transaction, the stages built
  → signed → broadcast → confirmed → finalized → fills recorded, each
  done, now, pending, failed, unknown or skipped with its evidence (the
  node's confirmation and slot, resends of the same bytes, the landed
  error, the expiry), the signature with an explorer link where the
  cluster has one, the fills read from the landed transaction's balance
  changes with their bounds, the network fee actually paid, and the
  reconciliation evidence and last check. Status is read on a bounded
  schedule while the network is being watched (2 s, then 5 s, 15 s in a
  hidden tab, off when settled or when the person is the next actor); a
  failed read shows the last state as stale and retries with backoff;
  meaningful changes are announced to assistive technology, never every
  poll. A signature is never a result; "Finalized" and the recorded fills
  are.
- **Recovery.** Cancel is offered before any signature (with what it
  does: nothing sent, or "stop here" after earlier fills with what stays
  in the wallet), a cancellation request after a broadcast (the signed
  transaction can still land; the chain decides), and nothing once a
  transaction landed. A partially completed basket shows the filled leg
  and the stale or failed leg with its reason and offers "Review the
  unfilled legs": a reviewed completion on the same review screen with the
  budget equal to the unfilled targets, which the API refuses otherwise.
  An expired transaction is built again; an expired plan goes back to the
  review; a frozen intent (a fill outside its bounds, an unknown result)
  waits for a person and retries nothing.
- **Receipts.** Once every transaction finalized, "Issue a receipt" asks
  the API for the execution receipt (idempotent per intent, kind and
  state) and opens `/receipts/[receiptId]`: the signed record of what was
  requested, approved, submitted, filled, charged and reconciled, the
  signing key with its published status, the canonical hash and the JSON
  to verify offline (`markov receipts verify`). The receipt is private
  until the owner opts it into public reading, where the owner id is
  omitted and the signed body stays intact. The page says what a receipt
  is: an attestation to the record, with settlement resting on the chain
  evidence it references, never a proof of ownership.
- **Design reference.** The top bar now leads home through the eyes and
  wordmark, the primary sections are Explore, Build, Portfolio and
  Activity, a chip names the real environment outside production, and the
  tokens follow the reference (periwinkle accent, blue eyes, cream bezel,
  near-black screen) with the measured contrast table updated.
