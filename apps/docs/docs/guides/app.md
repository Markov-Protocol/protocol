---
title: "The markov.pet app"
sidebar_label: "App"
sidebar_position: 1
description: "Mark I fills the browser; inside its screen the app walks Research, Assemble, Set Rules and Activate against the same deterministic backend the CLI uses."
---

The app (`apps/web`, Next.js App Router) is experienced through a
persistent digital **Mark I**: a thin cream perimeter frames a black
display that fills the viewport, and the application lives inside the
screen. This site borrows the same frame.

The app imports only the shared contracts and the frontend packages; it
never holds a database, a signer or a provider secret. Every backend call
goes through its own server (the BFF proxy) with an exact route allowlist,
the session attached as a bearer token, and the same error envelope the
API returns. Details: [security and privacy](../reference/frontend/security-and-privacy.md)
and the [API contract map](../reference/frontend/api-contract-map.md).

## Routes

| Route | What it does | Session |
| ----- | ------------ | ------- |
| `/` | Home: the checklist to trading readiness and the four steps | F02, F03 |
| `/sign-in`, `/settings` | Identity-token sessions, wallet linking with ownership challenges, credentials, devices, account recovery | F03, F04 |
| `/settings/eligibility`, `/settings/wallets` | Jurisdiction declaration, terms by content hash, observed balances, receive panel | F04 |
| `/explore`, `/markets/[instrumentId]` | Issuer-aware discovery with typed reference prices, availability, lifecycle notices, watchlists | F05 |
| `/research` | Theses with typed statements, safe source citations, bounded model runs, shortlist to a basket draft | F06 |
| `/strategies/new`, `/strategies/[strategyId]/edit` | The basket builder: Research, Assemble, Set Rules, Activate on one server draft with exact basis points | F07 |
| `/strategies/[strategyId]`, `/strategies/[strategyId]/versions/[n]` | Publishing, immutable versions with chain evidence, follow, fork, diff, deprecation | F08 |
| `/review/new`, `/review/[intentId]` | One review for basket investments and single buys: the API-built plan, fees, bounds, hash-bound approval | F09 |
| `/activity`, `/activity/[intentId]` | Wallet signing of the exact prepared transaction, submission, the per-transaction timeline with recovery | F10 |
| `/receipts/[receiptId]` | Signed receipts with their verification key status and public opt-in | F10 |

The authoritative table with journeys and states is
[routes and journeys](../reference/frontend/routes-and-journeys.md).
Portfolio, rankings and automations arrive with F11 to F13 over B13 and
B14.

## Wallets and signing

The app discovers wallets through the Wallet Standard, checks the chain and
the signing capability, and links a wallet only after a challenge signed
by that wallet. A transaction is built by the API, decoded, validated
against the approved plan and simulated before the wallet ever sees it;
the app checks the returned bytes against the prepared message and submits
once. Wallet decline, silence, mutation, account or session changes and
lost answers end with nothing sent and no second intent. See
[the execution state machine](../reference/markov/execution-state-machine.md).

## Design

Tokens, contrast measurements, type scale and motion are in the
[design system](../reference/frontend/design-system.md); the shell
geometry in [the Mark I shell](../reference/frontend/mark-i-shell.md); the
reference screens in the [design reference](../reference/frontend/design-reference/readme.md).
Accessibility rules and checks are in
[accessibility](../reference/frontend/accessibility.md).

## Verification

Every frontend session records jsdom tests and Playwright journeys against
the real API with the fixture chain and a fixture wallet, at desktop and
phone widths, with screenshots under `docs/frontend/evidence/`. The index
is [verification](../reference/frontend/verification.md).
