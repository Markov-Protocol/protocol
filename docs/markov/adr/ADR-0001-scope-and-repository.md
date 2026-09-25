# ADR-0001: Scope of this repository

Date: 2026-09-24 · Status: accepted; the frontend exclusion (Decision,
second bullet) is superseded by ADR-0006 (F01) for the markov.pet
application; the storefront and DNS stay out of scope · Session: B01

## Context

The Markov stocks V1 specification names this repository as the intended
backend codebase. At the start of B01 the repository (`Markov-Protocol/protocol`,
commit `09c7ce6`) contained only a one-line README and an Apache-2.0 LICENSE.
No prior prototype, auth system or schema exists here, so no existing security
boundary can be assumed.

## Decision

- This repository hosts the stock V1 backend as a pnpm monorepo: domain API,
  durable workers, indexer, CLI/SDK, on-chain registry program, infrastructure
  and documentation.
- Frontend code (pages, components, styling, wallet UI, storefront) is out of
  scope and is not added here. The canonical app domain (`markov.pet`) and the
  commercial site (`markov.trade`) are recorded for contracts and CORS
  configuration only; DNS and storefront are untouched.
- Stocks come first. Perpetuals, issuer launch tooling and unattended
  automation are gated extensions with their own release gates.
- The Apache-2.0 license already present is retained.

## Consequences

- Sessions B01 to B17 ran in this repository in dependency order; B17
  closed after its first increment, and the product owner replaced B18 and
  the rest of B17 with the production completion plan (P01 to P24).
- The commit and documentation policy in `AGENTS.md` applies from the first
  commit.
