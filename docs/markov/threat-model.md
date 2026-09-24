# Threat model

Status: B01 slice covering configuration, identity binding, logging and the
build pipeline. Financial assets, execution, agents and data retrieval
sections are added by the sessions that introduce them; the required
verifications for those areas are listed in the build specification and are
not claimed here.

## Assets and trust boundaries in B01

- Database contents (identity, capability readiness) and the migration
  history.
- Configuration secrets: database password, RPC provider keys embedded in
  URLs, Temporal API key.
- The network identity of the process (which chain it believes it is on).
- Build artifacts and dependencies.

## Abuse cases and controls

| Risk | Control | Verification |
| ---- | ------- | ------------ |
| Process bound to the wrong chain or environment (production binary with devnet database, provider swapped to another cluster) | Platform identity row + boot comparison; pinned genesis constants; live genesis verification at boot and every 15 s; fail closed | `apps/api/test/boot.test.ts`, `scripts/ci/startup-check.sh` |
| Production writes enabled without approved limits | Config invariants require `BETA_*` caps, allowlist and evidence reference; mainnet writes only in `production` | `packages/config/test/config.test.ts` |
| Secrets in logs, errors or CLI output | URL redaction, key-based log redaction, config issues never echo values | `packages/config` and `packages/observability` tests |
| Wildcard or sloppy CORS with credentials | Exact-origin allowlist only; `*` rejected | config tests, `apps/api/test/app.test.ts` |
| Oversized or malicious RPC responses | Bounded timeouts, response-size cap, envelope/id/result validation, no redirects | `packages/solana-rpc/test` |
| Supply chain: new malicious package versions, install scripts, unpinned CI actions, secrets in git | Exact pins, frozen lockfile, `minimumReleaseAge`, `onlyBuiltDependencies` allowlist, SHA-pinned actions, checksum-verified tool downloads, gitleaks scan, `pnpm audit` | `.github/workflows/ci.yml` |
| Unattributed or co-authored commits masking provenance | Commit policy hook and CI range check | `tooling/commit-policy/policy.test.mjs` |
| Cross-account access (user A reads, changes or unlinks user B's wallets, credentials or devices) | Every store function scopes by the verified owner; foreign resources answer NOT_FOUND | `apps/api/test/identity.test.ts`, `packages/db/test/identity-store.test.ts` |
| Auth or link replay (expired, reused, wrong-account, wrong-address challenge; wrong key; wrong issuer/audience/expired identity token; symmetric algorithms) | Single-use atomic challenge consumption bound to owner, address, chain and time; Ed25519 verification over the stored message; jose verification with an asymmetric allowlist | `packages/auth/test`, identity API tests |
| Agent, device or operator escalation | Scope checks per route; agents cannot create credentials or challenges; devices cannot read accounts; operators cannot use owner routes; secrets stored only as peppered hashes | identity API tests |
| Stale sign-in used for security changes | Step-up window on wallet, credential and device mutations | identity API tests (`STEP_UP_REQUIRED`) |
| Counterfeit or colliding instrument (same symbol, different mint; same mint, another product; duplicate ids in a feed) | Ingestion rules reject the newcomer and keep the live instrument; live mints are unique in the database; admission needs a matching on-chain verification | `packages/catalog/test/feed-and-plan.test.ts`, `packages/db/test/catalog-store.test.ts`, `apps/api/test/catalog.test.ts` |
| Upstream schema drift or malicious feed content (markup, scripts, control characters, oversized bodies, redirects, credentialed URLs) | Whole-snapshot rejection on structural drift; per-field sanitisation and bounded lengths; https-only configured URL without redirects, credentials, or bodies over 2 MiB | catalog and issuer source tests, API drift test |
| Quantity scaled twice or rounded silently (scaled amount with a raw quote, multiplier applied to an already scaled value, floating-point conversion) | Raw base units are the only stored quantity; multipliers are decimal evidence with sources and effective times; conversions are exact with a named rounding and report information loss; helper divergence is measured, not used | `packages/amounts/test`, `apps/api/test/listed-stocks.test.ts` |
| Unsupported token extension admitted (transfer fee, hook, non-transferable, double rebasing) | Every verification assesses extensions against the policy; `unsupported` blocks admission; `review_required` needs recorded evidence | catalog and listed-stock API tests |
| Corporate action replayed, rewritten or invented (duplicate ids, events for unknown products, feed rewriting applied events, applying before the effective time) | Unique issuer/external id, unmatched products never create instruments, applied and rejected events are immutable to feeds, application refused before the effective time and without prior multiplier evidence | catalog planning tests, store tests, listed-stock API test |
| Catalog price presented as an executable quote | Catalog price kinds exclude `execution_quote`; `availability.trade` is a literal false until execution sessions | contract tests, API test asserts kinds |
| Execution reached without eligibility, terms or within-limit evidence (missing, expired, revoked or superseded decision; unacknowledged terms; order, daily, account, concentration, slippage, quote-age, venue or reserve breach) | Deterministic policy evaluation with every check reported; unknown blocks; submit stage re-evaluates and additionally requires execution writes, a verified venue and declared exposure; decisions expire within 60 s | `packages/policy/test`, `apps/api/test/policy.test.ts` |
| Concurrent intents overspending a shared budget | Reservation and decision in one transaction under a per-user advisory lock; idempotent per intent; expiry sweep | `packages/db/test/policy-store.test.ts` (12 parallel holds), API race test (8 parallel evaluations) |
| Owner or operator loosening limits silently; fixture rules reaching production | Owner limits validated against the ceiling (policy defaults tightened by `BETA_*`), refused with details, step-up required; rule and terms versions immutable; user-assigned jurisdiction codes refused outside local/test; https-only terms; acknowledgement requires the exact content hash | policy API tests |
| Hidden concentration across issuers (two issuers' tokens for one company) | Company identity normalised (`companyKeyOf`) so exposure is summed across issuers | domain and API concentration tests |
| Secret leakage through lists, audit or logs | Tokens returned once; lists and audit carry prefixes only; pepper redacted from configuration summaries | identity API tests assert no `mkv_` in audit or lists |

## Residual risks after B01

- Genesis constants are live-verified (SR-SOL-01), but the platform's own RPC
  client has not yet been exercised against a live endpoint; the first
  deployment must confirm with `markov solana probe`.
- The identity provider adapter is verified only against the in-process
  test issuer; Privy-specific issuer, audience and key configuration are
  unverified (OD-05). Cookie sessions and CSRF belong to the app layer (F03).
- Rate limits are per client address and rely on `API_TRUST_PROXY` being set
  correctly behind a load balancer.
- The Docker path for local dependencies is unverified (OD-16).
