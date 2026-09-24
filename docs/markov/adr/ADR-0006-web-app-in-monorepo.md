# ADR-0006: The markov.pet web application lives in this monorepo

Date: 2026-09-24 · Status: accepted · Session: F01

## Context

The frontend master build prompt (v1.0) instructs the implementation agent
to build the markov.pet application "in the existing repository", with
`apps/web`, `packages/ui`, `packages/formatters` and related packages placed
beside the existing `packages/contracts`, the generated SDK and the B01
workspace conventions. ADR-0001 recorded the *backend build task's* boundary
("no frontend in this build"); it did not decide where the application
would eventually live. No separate application repository exists in this
session's scope.

## Decision

- The web application (`apps/web`, Next.js App Router) and its frontend
  packages (`packages/ui`, `packages/formatters`, later `markov-shell`,
  `companion`, `api-client`, `wallet-ui`, `frontend-testkit`) are part of
  this monorepo.
- The backend ownership boundary is preserved mechanically: frontend
  packages may import `@markov/contracts` and `@markov/formatters` only;
  they never import `@markov/db`, `@markov/config`, `@markov/solana-rpc`,
  the API, the worker or any signer. Backend packages never import UI.
  `tooling/boundaries/rules.json` encodes this and CI enforces it.
- Frontend packages are source-exported and transpiled by Next.js
  (`transpilePackages`); backend packages keep their compiled `dist`
  exports. Frontend type checks run through `next build`/`tsc --noEmit`,
  separate from the backend `tsc -b` graph.
- The storefront (`markov.trade`) is not part of this repository.

## Consequences

- `AGENTS.md` ownership boundaries are updated: the repository hosts the
  backend and the markov.pet app as separate workspaces; the storefront,
  DNS and payment code remain out of scope.
- A single CI workflow runs both graphs; frontend jobs can be split later
  if build time requires it.
