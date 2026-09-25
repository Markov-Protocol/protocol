# Identity, principals and credentials

Status: implemented in session B02. Provider-specific facts for Privy remain
unverified (OD-05); the adapter is provider-neutral.

## Principal classes

| Class     | Credential                                   | Obtains it by                                            | Can |
| --------- | -------------------------------------------- | -------------------------------------------------------- | --- |
| user      | opaque session (`mkv_ss_…`)                  | exchanging a verified identity-provider token             | every owner operation on its own resources (`owner:*`) |
| agent     | scoped API credential (`mkv_ag_…`)           | a user with a fresh sign-in creates it                    | only its scopes: `research:read`, `research:write`, `portfolio:read`, `proposals:create`, through the ordinary routes or the typed tool catalog of B15 (`docs/markov/agents.md`); it proposes, never opens a proposal; never signing, approval, publishing or security changes |
| operator  | scoped credential (`mkv_op_…`)               | `markov operators create` with database access            | `ops:read`, `ops:credentials:revoke`, `ops:capabilities:write` and the later `ops:*` scopes (catalog, policy, discovery, `ops:maintenance:run` for passes and delivery requeues); no user resources |
| device    | device credential (`mkv_dv_…`)               | presenting a single-use pairing code                      | its capabilities (`preferences:sync`, `status:read`, `notifications:receive`); no account reads, no spending |
| worker    | worker credential (`mkv_wk_…`, B16)          | `markov workers create` with database access; the worker presents it as `MAINTENANCE_API_TOKEN` | `maintenance:run`: ask the API for maintenance passes; no user resources, never opens, signs or spends. Schedules themselves act inside the API through an agent-class principal `schedule:<id>` holding `proposals:create` and read scopes for the owner |

Identity and role come only from the credential the server verifies. No
header, query parameter or body field can name a user, wallet, tenant or
role.

## Identity tokens

`POST /v1/auth/sessions` verifies the identity-provider token with `jose`:
issuer, audience, expiry (30 s tolerance), required `sub`/`iat`/`exp`, an
asymmetric algorithm allowlist (`none` and HMAC are refused at
configuration), and key rotation through a cached remote JWKS. The
`auth_time` claim (or `iat`) becomes the session's authentication time.
The user record is keyed by issuer and subject; nothing else from the
provider is stored.

`IDENTITY_PROVIDER=test` runs an in-process ES256 issuer for local and test
modes only (configuration refuses it elsewhere) and exposes
`POST /v1/auth/test-tokens`, which is absent from the committed OpenAPI
document.

## Sessions

An exchange returns an opaque session token once; only its HMAC-SHA256 hash
(under `CREDENTIAL_PEPPER`) is stored, next to a non-secret prefix for
lookup. Sessions expire after `AUTH_SESSION_TTL_SECONDS` and can be revoked
with `DELETE /v1/auth/sessions/current`. The app layer (F03) stores the
token in a host-only, HttpOnly cookie; it never appears in a URL.

## Step-up

Linking or unlinking a wallet, creating or revoking an API credential and
creating a device pairing require an interactive session whose
authentication time is at most `AUTH_STEP_UP_MAX_AGE_SECONDS` old (600 by
default). Otherwise the API answers `STEP_UP_REQUIRED` (401) and the person
signs in again. Agents, operators and devices are never step-up fresh.

## Wallet ownership

1. `POST /v1/me/wallets/challenges` returns a canonical message bound to the
   origin host (`WALLET_CHALLENGE_DOMAIN`), the chain and genesis hash the
   process is bound to, the account, a random nonce and a time window
   (`WALLET_CHALLENGE_TTL_SECONDS`).
2. The wallet signs the exact text (Ed25519).
3. `POST /v1/me/wallets` consumes the challenge atomically (single use, owner
   and address bound, unexpired) and verifies the signature with Node's
   native Ed25519 over the stored message. A failed attempt consumes the
   challenge too, so a signature cannot be retried against it.
4. One active link per wallet across all accounts (partial unique index).
   `WALLET_ALREADY_LINKED` tells the person to unlink it from the other
   account first; there is no silent takeover.

Ownership verification proves control of the key at that moment; it does
not authorize any transaction and is separate from wallet connection in
the browser.

## Errors

`AUTH_REQUIRED` (401), `STEP_UP_REQUIRED` (401), `FORBIDDEN` (403),
`NOT_FOUND` (404, also for another account's resources),
`CHALLENGE_INVALID` (409), `SIGNATURE_MISMATCH` (409),
`WALLET_ALREADY_LINKED` (409), `RATE_LIMITED` (429; challenge, session,
pairing and device routes are limited to 10 per minute per client address).

## Audit

Every session, wallet, credential, device and operator action writes an
`audit_events` row with the actor class and id, action, target, request id
and secret-free details. `GET /v1/ops/audit` exposes it to operators.

## App layer (F03)

The web app keeps the session token in a host-only HttpOnly cookie and
verifies it against `GET /v1/me` on every request; the browser never sees
the token. Same-origin checks guard its sign-in and sign-out routes, return
paths are validated local paths, and an account switch revokes the previous
session through `DELETE /v1/auth/sessions/current`. Details:
`docs/frontend/security-and-privacy.md`.

## What is not implemented yet

The hosted identity provider's browser adapter (OD-05). Terms and
eligibility acknowledgements arrive with B05. Account disabling exists as a
column but has no operator route yet (B18).
