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
| `/sign-in`, `/auth/callback`, `/settings` | Identity-token sessions with expiry recovery and account switching, the provider callback's cancelled, failed and unsupported outcomes, and the settings index (profile, sessions, notifications, devices and agent credentials are not built yet; the page names the planned session) | F03, F04 |
| `/settings/eligibility`, `/settings/wallets` | Jurisdiction declaration, terms by content hash, wallet linking with ownership challenges, observed balances, receive panel | F04 |
| `/explore`, `/markets/[instrumentId]` | Strategies tab (registered recipes with chain provenance, follower counts and the model ranking entry with its reason, filters, stable pages, a Following list), Stocks tab with issuer-aware discovery, typed reference prices, availability, lifecycle notices, watchlists | F05, F12 |
| `/rankings`, `/creators/[publisherWallet]` | One model cohort per period with the methodology beside it and a reason for every unranked entry; creator pages from chain records | F12 |
| `/research`, `/research/[thesisId]` | Theses with typed statements, safe source citations, bounded model runs, shortlist to a basket draft; the published projection for anyone else | F06 |
| `/strategies/new`, `/strategies/[strategyId]/edit` | The basket builder: Research, Assemble, Set Rules, Activate on one server draft with exact basis points | F07 |
| `/strategies/[strategyId]`, `/strategies/[strategyId]/versions/[versionId]` | Publishing, immutable versions with chain evidence, follow, fork, diff, deprecation | F08 |
| `/review`, `/review/new`, `/review/[intentId]` | The person's reviews; one review for basket investments and single buys: the API-built plan, fees, bounds, hash-bound approval | F09 |
| `/activity`, `/activity/[intentId]` | Wallet signing of the exact prepared transaction, submission, the per-transaction timeline with recovery | F10 |
| `/receipts/[receiptId]` | Signed receipts with their verification key status, requested against filled, the fee cap, public opt-in and a JSON download | F10, F11 |
| `/portfolio`, `/portfolio/[instanceId]` | Holdings against the chain, reconciliation, external flows explained, strategy instances with allocation drift, lots, cost and fees, personal against model performance with methodology labels, history, exports; a creator's newer version offered with its exact difference and accepted only explicitly | F11, F12 |
| `/automations`, `/status` | Unavailable pages naming the session that delivers them: P14 for automations (maintenance proposals over B16, formerly F13) and P18 for operations status (formerly F19) | F02 |

The authoritative table with journeys and states is
[routes and journeys](../reference/frontend/routes-and-journeys.md).

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
the local API (test mode) with the fixture chain and a fixture wallet, at
desktop and phone widths, with screenshots under `docs/frontend/evidence/`.
The index is [verification](../reference/frontend/verification.md).

The app is hosted on Vercel at https://markov-web-theta.vercel.app in
staging mode against a placeholder API origin, so it shows "Backend
unreachable"; no backend is hosted yet, and markov.pet itself is not
routed to this deployment.
