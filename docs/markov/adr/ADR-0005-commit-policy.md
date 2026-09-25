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
  not rewritten. Exception (product owner's instruction, 2026-09-25): the 35
  commits of `claude/affectionate-gauss-2ml7ll` ahead of `main` were
  rewritten once with `git filter-branch --env-filter` to the owner's
  author and committer identity (trees identical, `check-range.mjs` clean;
  `docs/sessions/B17.md`); `main` (`09c7ce6`) was not rewritten. A
  pre-rewrite hash still cited in a document (for example `7840da2`, now
  `9b6bde3`) names the old commit; `docs/markov/release-status.json` binds
  each session to its current commits.
- Every feature commit updates the affected documentation, ADRs, migrations
  and the session log.

## Consequences

- A local hook can be bypassed with `--no-verify`; CI is the enforcement
  point and runs across the whole range. GitHub Actions runs for this
  repository start with P01; before them the range check was run by hand
  (B17).
