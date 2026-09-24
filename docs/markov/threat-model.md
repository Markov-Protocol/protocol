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

## Residual risks after B01

- Genesis constants are live-verified (SR-SOL-01), but the platform's own RPC
  client has not yet been exercised against a live endpoint; the first
  deployment must confirm with `markov solana probe`.
- No authentication exists yet; the API exposes only non-sensitive platform
  metadata and must not be deployed publicly before B02.
- The Docker path for local dependencies is unverified (OD-16).
