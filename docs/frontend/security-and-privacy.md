# Security and privacy (frontend)

Status: F01 slice. The browser is an untrusted client; UI guardrails aid
comprehension and never replace server authorization, policy or on-chain
constraints.

## Implemented in F01

| Control | Where | Verification |
| ------- | ----- | ------------ |
| Development switches refused in production (`MARKOV_WEB_FIXTURES`, `MARKOV_WEB_INTERNAL_ROUTES`), fixtures also refused in staging and read-only mainnet | `apps/web/src/config/web-env.ts`, enforced by `next.config.ts` (build) and `instrumentation.ts` (server start) | `apps/web/test/web-env.test.ts` |
| Internal reference route hidden unless explicitly enabled; `noindex` | `apps/web/src/app/dev/components/page.tsx` | e2e header check; guard tests |
| Baseline headers: `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `X-Frame-Options: DENY`, `Content-Security-Policy: frame-ancestors 'none'`, `Permissions-Policy` disabling camera, geolocation, microphone and payment | `apps/web/next.config.ts` | Playwright header assertions |
| No secrets in the app environment; only `NEXT_PUBLIC_APP_ORIGIN` is public | `docs/frontend/README.md` | build inspection in F20 |
| Frontend packages cannot import databases, config, RPC clients or signers | `tooling/boundaries/rules.json` (`appDeny`) | `pnpm boundaries:check` in CI |
| No remote images (`images.remotePatterns` empty) | `next.config.ts` | n/a |
| Server-only API origin (`MARKOV_API_ORIGIN`), required https outside local/test; the browser never calls the API directly | `apps/web/src/config/web-env.ts`, `apps/web/src/server/api.ts` | `apps/web/test/web-env.test.ts`; e2e asserts a browser fetch to the API origin is blocked |
| Host-only HttpOnly session cookie, same-origin mutation guard, validated return paths, replayed-cookie refusal | `apps/web/src/server/auth/*`, `apps/web/src/features/auth/return-path.ts` | `apps/web/test/server/auth.test.ts` (13 tests), `apps/web/e2e/auth.spec.ts` |
| Principal-scoped caches and late-response discard on account change | `apps/web/src/features/auth/session-context.tsx`, `private-query-provider.tsx` | `apps/web/test/session-context.test.tsx` |

## Session model (F03)

| Responsibility | Owner | Detail |
| -------------- | ----- | ------ |
| Provider session | Identity provider | Proves who the person is and issues an identity token. Not a Markov session. With `IDENTITY_PROVIDER=test` the API's in-process issuer plays this role in local and test only. |
| Markov session | API (`POST /v1/auth/sessions`) | Opaque `mkv_ss_…` bearer stored as a peppered hash; expires after `AUTH_SESSION_TTL_SECONDS`; revoked by `DELETE /v1/auth/sessions/current`. |
| Browser credential | App server (`apps/web/src/server/auth`) | The Markov session token lives only in the `__Host-markov_session` cookie: `Secure`, `HttpOnly`, `SameSite=Lax`, `Path=/`, no `Domain`. Local development over plain http uses `markov_session` without `Secure` because browsers refuse the prefix there. The token never appears in a URL, a response body, local storage or a log. |
| Renewal | none in V1 | A session is not silently extended; expiry leads to explicit recovery. |
| Invalidation | API + app server | Sign-out, account switch and operator/user revocation invalidate server-side; the app clears the cookie when the API answers `AUTH_REQUIRED`. |
| Role and identity | API only | The client renders from `GET /api/auth/session`, which is the server's verification of the cookie against `GET /v1/me`. No role or user id is read from a URL, header or storage. |

CSRF and origin: every state-changing app route (`/api/auth/sign-in`,
`/api/auth/sign-out`) requires `Sec-Fetch-Site: same-origin` or an `Origin`
that matches this deployment, and a JSON body where a body is expected.
`SameSite=Lax` keeps cross-site POSTs credential-less; the origin check
refuses them outright and refuses non-browser callers without an origin.

Cache isolation: session responses and every page are `no-store`; the root
layout reads the cookie, so no route is statically cached. In the browser,
one TanStack Query client exists per principal and session epoch; sign-out,
expiry and account switch cancel its queries, clear and unmount it, and the
subtree remounts. `useSessionFetch` aborts in-flight requests when the
principal changes and throws `StaleSessionError` for a response that
arrives afterwards, so account A's data can never render under account B.

Rate limits: the API limits sign-in attempts per client address; the app
server forwards the first `X-Forwarded-For` hop so the limit applies per
person. The API must set `API_TRUST_PROXY=true` only when the app server is
its sole caller.

## Shop and app session boundaries

`markov.pet` (this app) and `markov.trade` (the device storefront) are
separate origins and keep separate sessions. They cannot share a cookie
with a common `Domain` attribute and do not try to; nothing in this
repository changes the storefront, its DNS or its payment code. A handoff
between the two is an ordinary link to an allowlisted destination without
any credential, token or account identifier in it. If the same identity
provider is used on both sites, each site completes its own provider flow
and its own server-side exchange.

## Wallets, ownership and funding (F04)

- The browser reaches the API only through `/api/markov/*`, an explicit
  allowlist of operations (`apps/web/src/server/proxy/allowlist.ts`). The
  session token stays in the HttpOnly cookie and is attached server side;
  mutations must pass the same-origin check, bodies must be small JSON,
  responses are `no-store` and upstream headers are dropped.
- Wallet discovery uses the Wallet Standard events; Markov never picks
  `wallets[0]`, never connects silently and never creates a wallet. A wallet
  without `solana:signMessage` cannot verify ownership and is told so before
  any popup. The embedded-wallet option is shown as unavailable (OD-05).
- Ownership verification signs the API's fresh, account- and chain-bound
  challenge (B02). The exact text is displayed first; the wallet's
  `signedMessage` must equal it byte for byte and the signature must be 64
  bytes; a signature obtained under another session epoch or after the
  wallet's accounts changed is discarded without being submitted. Replay
  answers `CHALLENGE_INVALID`; a wallet verified elsewhere answers
  `WALLET_ALREADY_LINKED` with recovery guidance and no automatic transfer.
  Linking and unlinking need a recent sign-in (`STEP_UP_REQUIRED`).
- Network checks compare the account's declared chains with the platform's
  cluster (`/v1/platform`) before a signature is requested.
- Funding shows the person's own verified address only (full text, copy,
  QR drawn from the encoder's matrix, no injected markup), the exact cluster
  and stablecoin mint, and balances as observed by the backend at a stated
  slot. No pooled deposit address, bridge, onramp, fee sponsorship or deposit
  credit exists. An unreadable RPC endpoint is reported as unknown.
- Disconnecting a wallet never signs the identity session out; the two
  controls state their effects. The only wallet fact kept in the browser is
  the name of the wallet the person chose (`localStorage`,
  `markov.wallet.preferred`), used to resume that wallet silently after a
  reload; it is never the first wallet found, it is cleared on disconnect,
  a wallet that refuses a silent connect stays disconnected, and a session
  change disconnects regardless.

## Discovery and watchlists (F05)

- Public catalog reads go through the same `/api/markov/*` allowlist as
  private calls, anonymously and with a bounded query string: at most 8
  plain keys and 512 characters, values re-encoded, control characters
  refused; routes that take no query refuse any. The API decides what is
  public (admitted and paused instruments only); the app never widens it.
- Provider text (names, descriptions) is data: it is rendered as text
  through React, never as HTML, and the app draws a monogram instead of
  fetching issuer images. Issuer links open with `rel="noreferrer noopener"`
  and only when they are https.
- Filter and tab state in the URL is validated on the way in (`issuer` and
  `kind` against the contract enums, `q` trimmed to 60 characters, `tab`
  against the known tabs) and serialised on the way out; nothing else from
  the URL is forwarded or rendered.
- The watchlist is account-scoped on the server (owner-scoped tables,
  another person's list is never reachable) and versioned; the app sends
  the version it last saw and shows a conflict instead of overwriting a
  list edited on another device. Nothing about it is kept in browser
  storage. Saving an instrument implies nothing about eligibility,
  execution or advice, and unadmitted instruments cannot be saved.
- The market page reaches the person's capability states only when signed
  in and never suggests switching issuer or restating residence to change a
  decision.

## Research and theses (F06)

- Everything retrieved for research is retrieved by the API under its
  safe-retrieval policy; the browser never fetches a cited page. Source
  titles and excerpts arrive as sanitised plain text and are rendered as
  text through React, never as HTML; a `<b>` in an excerpt stays visible
  as characters. Only https destinations become outbound links
  (`rel="noreferrer noopener"`, the host shown); anything else, including
  a `javascript:` URL an author typed, is shown as text with the link
  withheld. A refused retrieval (private or literal address, non-https)
  is kept as a record with its reason and cannot be cited.
- Model output is data: statements from a run are labelled model
  interpretations, bound to the run and shown only after the API validated
  them; the run cannot suggest an instrument the catalog did not admit,
  and a suggestion becomes part of the thesis only when the person adds it
  and saves. No tool call exists in V1 (`toolCalls` is shown as none).
- Private notes are excluded from the content hash and from the public
  projection; the publish panel lists what becomes public before the
  visibility changes; the public page renders exactly what the API's
  projection returns (no owner id, no notes). A private or unknown thesis
  answers "not found or private" to another account and anonymously
  alike, so the page never reveals whose it is.
- The thesis form lives in React state only; nothing is written to browser
  storage. Saving appends an immutable revision through the proxy (same-
  origin JSON, `PATCH` now forwarded under the same rules as `POST`);
  a newer revision from another tab is announced and loadable, never
  overwritten.
- A basket draft created from a shortlist or an instrument page is a B07
  draft with stated integer weights; the app normalises nothing, holds
  nothing and places no order.

## Basket builder (F07)

- The draft is a server resource with one identity; every save carries
  the revision it started from and the API refuses a stale one, so two
  tabs can never overwrite each other silently. The conflict panel shows
  both revisions' differences and the person chooses; nothing merges on
  its own.
- Offline edits are kept in `sessionStorage` only while Markov cannot be
  reached: the key is scoped to the verified principal and the draft,
  the copy is versioned by its base revision and expires after a day,
  and every copy of another principal (or all of them when signed out)
  is purged when the session changes. It holds recipe content only:
  never a wallet, a budget, a signed message or a credential.
- Weights are integer basis points end to end; the app never rounds,
  renormalises or replaces a constituent. The backend re-validates every
  save and its issues are what the summary shows.
- The wallet and the budget chosen in Activate stay in memory, apart from
  the recipe and never written to the draft; the split shown is an
  estimate in exact base units, and the review button is unavailable
  with its reason until the execution sessions exist.

## Publishing and public pages (F08)

- The browser never builds, edits or sends a transaction. The API
  prepares the registration (message, blockhash, cost) for the verified
  wallet the owner chose; the app hands exactly those bytes to the wallet
  through `solana:signTransaction` and checks that what comes back is the
  same message with the fee-payer slot filled (`transaction-bytes.ts`).
  Anything else is refused before it leaves the page, and the API
  verifies the publisher's Ed25519 signature again before the node sees
  the transaction. The wallet is asked to sign only when it is the
  publisher wallet on the platform's network and the person has confirmed
  the permanence statement after reading what becomes public and the cost.
- Registration state is never a browser fact: every display (Saved
  privately, Publishing, Registered on-chain, Failed, Expired, Status
  unknown) is the API's chain-derived reading, polled while undecided and
  restored on reload. Explorer links, network, program id, record address
  and slot are shown only from the evidence the API validated against
  finalized chain state; before that the page shows the signature alone.
- What becomes public is what the API lists: the version's recipe by
  mint, weights, cash, hashes, title, thesis, rule, references, the
  publisher wallet address and the record address. The account, the
  wallet-to-account link, budgets, balances, holdings, orders, notes,
  chat, research runs and drafts never appear in a public payload, and
  the public pages call only anonymous routes (jsdom asserts no `/v1/me/`
  call on the anonymous version page).
- Page titles for public pages are read anonymously from the public
  projection on the server; a private or unknown id gets a generic title
  and `noindex`, so no draft or owner leaks into metadata or a crawler.
- Following and forking are bookkeeping and copying: neither places an
  order, moves a pin or changes the original strategy; a fork starts a
  private draft with `forkOf` attribution. Reference URLs on a version are
  rendered as links only when they are `https://`; everything else is
  text. The canonical manifest is rendered as text in a `<pre>`.

## Review (F09)

- Every number on the review is the API's: the allocation, quotes,
  minimum outputs, fees, fee payer, signatures, batches, policy decisions,
  validity and funds come from the plan the backend built for the exact
  budget. The browser computes nothing financial; it formats base units
  and compares two plans field by field to show what changed. Assembled
  routes are never modified in the browser.
- The visible review is bound to an immutable plan id and hash. Approval
  sends the hash the person saw; the API refuses a hash that is not the
  current plan or a plan that expired. A refreshed plan never appears
  behind an enabled approval button: the difference is shown first and
  approval (and the staged acknowledgement) is asked again. A countdown
  and an "expired" label come from the plan's own expiry against the
  clock; a superseded plan is read-only.
- Refusals are actions, never bypasses: the page cannot lower a limit,
  skip a policy decision, invent a quote or reshape the recipe. The
  smallest workable budget, the shortfalls and the denial codes are what
  the API answered.
- Context differences are visible: the connected wallet (or its network)
  differing from the plan's wallet, no connected wallet, and a newer
  version of the strategy are called out next to the approval. The final
  call to action names the next real step ("Sign transaction 1 of N")
  and is unavailable until F10 wires the wallet; nothing claims a trade
  or an investment completed.
- Intents are private: another person's intent is "not found" whoever
  asks, review pages are `noindex`, and the proxy allowlists only the
  intent, plan, acknowledgement and cancel routes (no operator routes).
  Nothing about a plan is stored in the browser beyond the query cache
  of the signed-in principal; a reload reads the plan from the API.

## Planned (with the sessions that own them)

Full CSP with exact identity/wallet allowances and report-only rollout,
HSTS at the deployment, the hosted identity provider browser adapter
(BLOCKED on OD-05), execution transaction signing-path validation (F10;
registration signing is validated in F08 and the reviewed plan is bound by
hash in F09), analytics consent and retention (F14/F20). Threat-model rows from the build prompt are tracked in
`docs/frontend/verification.md` as they gain tests.
