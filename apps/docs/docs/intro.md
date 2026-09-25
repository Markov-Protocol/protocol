---
title: "What Markov is"
sidebar_label: "Introduction"
sidebar_position: 0
description: "Markov turns an investment thesis into a versioned, executable portfolio of admitted tokenized stock exposures on Solana, with explicit owner permissions and inspectable results."
---

Markov turns an investment thesis into a **versioned, executable portfolio
of admitted tokenized stock exposures** on Solana, with explicit owner
permissions and inspectable results. The product app is
[markov.pet](https://markov.pet); the commercial site for Mark I devices
is markov.trade. These pages document the backend (domain API, durable
workers, on-chain registry, accounting, analytics, CLI), the app, and the
evidence behind every claim.

## The four steps

| Step | Label | What you do | What the backend produces |
| ---- | ----- | ----------- | ------------------------- |
| 01 | Research | Find the companies and exposures behind your idea. | A sourced thesis and an eligible instrument shortlist |
| 02 | Assemble | Turn your thesis into a portfolio you can explain. | Explicit instrument selection and exact weights |
| 03 | Set Rules | Choose your budget, limits and approval preferences. | A validated allocation plus owner-specific policy |
| 04 | Activate | Review the plan, authorize execution and follow the results. | Approved transactions and reconciled holdings |

Publishing is a separate action: **Publish strategy** records an immutable
recipe on the registry; **Invest in strategy** funds your own
implementation of that recipe. Publishing never buys assets, never creates
a pooled fund and never authorizes an agent.

## What a basket means

- A **strategy version** is a public or private recipe: instrument
  identities, exact weights, cash allocation, thesis, references and the
  intended maintenance policy. Versions are immutable; a creator's edit is
  a new version, and a follower's pin never moves without an explicit
  acceptance.
- A **portfolio instance** is one person's tracked implementation of a
  pinned recipe in a verified wallet.
- An **execution intent** is a bounded request to acquire, reduce, exit or
  rebalance that implementation. It becomes a hashed plan you approve, then
  transactions you sign in your own wallet.
- A **mandate** records any owner-authorized ongoing permission; it is
  never inherited from a creator's recipe. Unattended execution is a
  separate release gate and stays disabled.

You hold the constituent tokens yourself. V1 issues no transferable basket
share, holds no pooled customer funds, promises no redemption and creates
no exchange.

## How to read the evidence

Every capability carries one of six verification states and the site never
rounds them up:

| State | Meaning |
| ----- | ------- |
| `IMPLEMENTED` | Code and tests exist; no external evidence. |
| `FIXTURE_VERIFIED` | Exercised end to end against deterministic fixtures: sanitised recorded provider responses where they exist, otherwise synthetic stand-ins of the provider contract or the in-memory fixture chain. It says nothing about the live provider. |
| `LIVE_READ_VERIFIED` | Verified against the real provider with read-only calls. |
| `LIVE_WRITE_VERIFIED` | Verified with a real, authorized, bounded write. |
| `BLOCKED` | A named external dependency prevents verification. |
| `DISABLED` | Deliberately off by policy or release gate. |

The current table is [Provider and capability readiness](./reference/markov/provider-capabilities.md);
decisions that still need evidence or an owner are in
[Open decisions](./reference/markov/open-decisions.md). As of the latest
session nothing is production-ready or audited and nothing financial is
live. The app (in staging mode against a placeholder API origin, so it
reports the backend as unreachable) and this site are hosted on Vercel;
markov.pet itself is not routed to them. No backend is hosted anywhere
(Railway is the chosen host, not yet provisioned) and no program is
deployed on any cluster. Execution, accounting and analytics are
fixture-verified; the live venue, the live issuer feeds, the identity
provider facts and the price sources are open; the chosen model provider
(xAI) has an implemented adapter that has never been called live.

## Where the site comes from

The site is generated from the repository at build time
(`pnpm docs:build`): the [API reference](./api/index.md) from the OpenAPI
document the API exports, the [CLI reference](./cli/index.md) from the
command tree, and the backend, app and session documents from `docs/`.
Every page carries an edit link to its source; nothing here is written
twice.

## Start

- [Run it locally](./getting-started/run-locally.md) and then run
  [the startup check](./getting-started/startup-check.md), the headless
  journey the CI workflow runs from a clean checkout (GitHub Actions runs
  start with P01; until then the evidence is local runs).
- [The markov.pet app](./guides/app.md), [the CLI](./guides/cli.md) and
  [the API](./guides/api.md).
- [Accounting and performance](./guides/performance.md): why a deposit is
  never a return and how a ranking is earned.
- [Security](./guides/security.md) and [contributing](./contributing.md).
