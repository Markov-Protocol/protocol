# ADR-0005: Commit and documentation policy

Date: 2026-09-24 · Status: accepted · Session: B01

## Decision

- Scoped Conventional Commits; subject at most 72 characters; no trailing
  period; allowed types listed in `tooling/commit-policy/policy.mjs`.
- No `Co-authored-by` trailers, no bot co-author attribution lines and no
  tool or session attribution trailers (`Claude-Session`, `Generated-By`,
  `Assisted-By` and similar). Enforced by `.githooks/commit-msg` (enable with `pnpm hooks:install`) and
  by `tooling/commit-policy/check-range.mjs` in CI over the pull request or
  push range.
- Merge commits and git-generated revert headers are accepted as-is.
- The repository's configured git author identity is preserved; history is
  not rewritten.
- Every feature commit updates the affected documentation, ADRs, migrations
  and the session log.

## Consequences

- A local hook can be bypassed with `--no-verify`; CI is the enforcement
  point and runs across the whole range.
