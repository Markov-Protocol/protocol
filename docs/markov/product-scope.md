# Product scope: Markov stocks V1

Status: decision record for the backend build. Describes what the backend
implements and where its boundaries are. Nothing here claims a feature is
live until its session log says so.

## What Markov is

Markov turns an investment thesis into a versioned, executable portfolio of
supported tokenized stock exposures, with explicit owner permissions and
inspectable results. The initial user is a self-directed investor or strategy
creator in an eligible jurisdiction who wants to understand, assemble and
maintain a small portfolio. The AI companion is an optional interface to the
same deterministic services.

Positioning hypothesis (to be tested, not asserted): "Build a stock strategy
you can explain. Give it only the permissions you choose."

## Product wording and backend result

| Step | Label     | Backend result                                            |
| ---- | --------- | --------------------------------------------------------- |
| 01   | Research  | Sourced thesis and eligible instrument shortlist          |
| 02   | Assemble  | Explicit instrument selection and weights                 |
| 03   | Set Rules | Validated allocation plus owner-specific policy           |
| 04   | Activate  | Approved transactions and reconciled holdings             |

Publishing is a separate action. *Publish strategy* records an immutable
recipe; *Invest in strategy* funds a user's own implementation of that recipe.
Publishing does not buy assets, create a pooled fund or authorize an agent.

## What a basket means

- A **StrategyVersion** is a public or private recipe: instrument identities,
  weights in basis points, cash allocation, thesis, source references and an
  intended maintenance policy. Frozen on publication.
- A **PortfolioInstance** is one user's tracked implementation of a pinned
  recipe in a verified wallet.
- An **ExecutionIntent** is a bounded request to acquire, reduce, exit or
  rebalance that implementation.
- A **Mandate** records owner-authorized ongoing permissions. It is never
  inherited from the creator's recipe.

The user holds constituent tokens. V1 does not issue a transferable basket
share, hold pooled customer funds, promise redemption of an index token or
create an exchange. Software that avoids pooling can still carry legal
obligations; the architecture implies no exemption.

## Release scope

| Capability         | V1 core                                                          | Later, gated                                   |
| ------------------ | ---------------------------------------------------------------- | ---------------------------------------------- |
| Listed stocks      | Admitted xStocks instruments after extension/eligibility checks  | Additional issuers and chains                  |
| Pre-IPO exposure   | Admitted PreStocks instruments                                   | Tessera after terms/API/admission validation   |
| Research           | Sourced theses, comparison, deterministic validation             | Licensed research data                         |
| Publishing         | Immutable recipe, on-chain registration, history, follow/fork    | Creator commercial programs                    |
| Execution          | Owner-approved spot buys/sells and baskets                       | Independently constrained unattended execution |
| Maintenance        | Drift detection, recurring buy/rebalance proposals               | Capped recurring execution after mandate review|
| Discovery          | Explorer, transparent model-performance rankings                 | Copy-trading monetization, sponsored placement |
| Agent access       | Read, research, draft, quote, explain, propose                   | Narrow execution scopes                        |
| Meteora            | Existing routes; read-only pool analysis                         | DBC issuer configuration/launch tools          |
| Perps              | Shared extension contracts and documented requirements only      | Separate engine, margin, liquidation controls  |

The extension column is a release boundary, not permission to replace core
integrations with stubs. An inaccessible provider blocks only the capabilities
that depend on it; the dependency is recorded and the provider stays disabled
until evidence supports enabling it.

## Commercial and validation notes

Start with a narrow admitted universe and a few clearly explained strategies.
Measure research-to-draft, draft-to-reviewed-plan and reviewed-plan-to-
execution conversion, cost/slippage versus reviewed terms, repeat maintenance
use and support burden. Beta pricing starts with no Markov execution fee until
the accounting and disclosure path is verified. A versioned fee-policy
interface and usage metering are required before any fee exists. Growth is
never funded by hidden spreads, inflated backtests or unapproved referral fees.

## Session map

Session logs are in `docs/sessions/`. Backend sessions B01 to B16 are
complete; B17 closed after its first increment (the xAI model adapter, the
Vercel deployment records and the status inventory). Since
[ADR-0006](adr/ADR-0006-web-app-in-monorepo.md) the frontend sessions run in
this repository: the app sessions F01 to F12 and the documentation site D01
are complete. The product owner replaced B18 and the remaining B17 scope with
the production completion plan (P01 to P24; P01 complete, P02 next) and the
documentation plan (D02 to D09). F13 to F20 are not built; the plan carries
them as P14 (maintenance proposals UI), P16 (companion), E01 (voice), P17
(account and devices), E02 (Tessera), E04 (Meteora read-only observation and
DBC simulation), P18 (operations status) and P19 (restore).
[`release-readiness.md`](release-readiness.md) records where the candidate
stands.
