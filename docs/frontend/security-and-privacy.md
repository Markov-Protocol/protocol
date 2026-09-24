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

## Planned (with the sessions that own them)

Full CSP with exact identity/wallet allowances and report-only rollout,
HSTS at the deployment, the hosted identity provider browser adapter
(BLOCKED on OD-05), transaction signing-path validation (F10), analytics consent and retention (F14/F20). Threat-model rows from the
build prompt are tracked in `docs/frontend/verification.md` as they gain
tests.
