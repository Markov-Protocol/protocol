# Agent permissions, tools and model handling

This file is the reviewed statement of what any automated participant
(a scoped agent credential, the research model adapter, a future worker)
may do in Markov, what it may see, and what evidence exists. It is
required by the build specification and must change together with the
code that enforces it.

## Principals and scopes

| Principal | How it exists | Scopes | Cannot |
| --------- | ------------- | ------ | ------ |
| agent (`mkv_ag_…`) | created by a person with a fresh sign-in (B02) | `research:read`, `research:write`, `portfolio:read`, `proposals:create` | sign, approve, spend, change security settings, publish a thesis, freeze, fork or archive a strategy, create a portfolio instance or move its pin, create credentials, read another account |
| operator (`mkv_op_…`) | `markov operators create` with database access | `ops:*` scopes only | use owner routes or read private research |
| device (`mkv_dv_…`) | pairing code | `preferences:sync`, `status:read`, `notifications:receive` | read accounts, research or holdings |
| worker | process identity | Temporal activities only | act as a person |

An agent acts *for* one person and only inside that person's resources:
every store call is scoped by the verified owner. Nothing an agent does is
an approval; approvals and signatures stay with the person's wallet.

## Tools available to a model

Since B15 a model has tools, and only through the typed catalog
(`docs/markov/agents.md`). Every tool is a façade over one domain method,
invoked with the principal that started the run: a person's session holds
every owner scope, an agent credential only the scopes it was issued
with. The catalog a principal may call is what the model is shown, and
the tool layer checks scope and input again on every call. Nothing a
model says is an instruction to the platform; it is text to validate.

| Family | Tools | Scopes |
| ------ | ----- | ------ |
| read | `instruments.search`, `instruments.facts`, `exposures.compare` | `research:read` |
| read | `receipts.read` | `portfolio:read` |
| research | `thesis.draft` (title, claim, counterarguments, candidates; no statements of fact) | `research:write` |
| draft | `weights.validate` (nothing saved) | `proposals:create` |
| quote | `plan.indicative`, `quote.request` (no reservation, no intent, nothing stored) | `proposals:create` |
| explain | `policy.explain` (an earlier decision, or an evaluation with `reserve=false`) | `portfolio:read` |
| propose | `basket.propose` | `proposals:create` |
| propose | `investment.propose`, `rebalance.propose` | `portfolio:read` and `proposals:create` |

Tool inputs are strict objects: an argument a schema does not name (an
approval mode, a caller identity, a widened slippage) refuses the call.
Every mutation is audited (`agent.tool.invoke`) with the input's digest
and an identifier-only summary. The research model adapter of B06 is
unchanged: `ResearchModelAdapter` still has no tools and `toolCalls` in a
research run's provenance stays empty; the companion adapter is a
separate contract (`CompanionModelAdapter`) whose every call is recorded.

## Policy boundary

- Retrieved text, provider responses and documents are data. They are
  sanitised to plain text, bounded and never executed, rendered as HTML or
  treated as instructions. A phrase such as "ignore previous
  instructions" in a page is content in an excerpt, nothing more.
- Model output is validated deterministically before it is stored:
  statements are labelled `model_inference` and bound to the run,
  instrument ids must be admitted or paused catalog candidates, companies
  without a catalog match are reported as unmatched, everything else is
  rejected and listed. A model can therefore suggest an admitted
  instrument; it cannot introduce a mint.
- A draft enters a thesis only through a revision that a person or a
  `research:write` agent appends, with the run id checked against the
  thesis's succeeded runs.
- The model never sees private holdings, wallet addresses, credentials or
  another person's data. Its input is exactly the question, the thesis
  title and claim, the excerpts of the sources the person named and the
  admitted candidates (id, symbol, company, issuer).
- Budgets bound the output (`maxStatements`, `maxOutputChars`) and time
  (20 s). Runs can be cancelled; a cancelled run drops its result.
- No agent scope grants publishing: visibility changes and archiving are
  user-only, interactive operations.
- `proposals:create` lets an agent create and edit strategy drafts, which
  are proposals: validated recipes that hold nothing and order nothing.
  Freezing a version, forking, archiving, following a version in a wallet
  and moving a pin are interactive, user-only operations
  (`docs/markov/strategies.md`).
- No agent scope covers on-chain registration: preparing a publication,
  submitting the wallet-signed transaction and changing a record's status
  are user-only operations bound to one of the person's verified wallets;
  `portfolio:read` agents may read publication state
  (`docs/markov/strategy-registry.md`).

## Model and data handling

| Item | V1 |
| ---- | -- |
| Provider | `RESEARCH_MODEL_PROVIDER=disabled` (default) or `fixture` (deterministic, refused outside local/test). `COMPANION_MODEL_PROVIDER` (B15) takes the same values for the companion adapter. No hosted provider is integrated; selecting one is OD-19. |
| Provenance recorded per run | provider, model, model version, SHA-256 of the exact prompt text, tool calls (empty), budget used, timestamps, error message on failure |
| Prompt text | hashed, not stored. A companion run stores the SHA-256 of its first prompt and, per step, the SHA-256 of the canonical tool input, an identifier-only summary, the outcome and the SHA-256 and size of the output (`markov-companion-provenance/v1`); tool outputs and model prose are never stored, only the validated answer |
| Data sent to a provider | see the input above; never holdings, keys, tokens or emails. A companion run (B15) adds the tool catalog the principal may call, a redacted context (a thesis title, claim and fetched excerpts; an instance label and pinned version; public instrument facts) and the tool outputs the run produced; never lots, wallet addresses, balances, credentials or another account |
| Retention | runs and their validated output are kept with the thesis; deleting the person's account cascades |
| Audit | `research.thesis.create`, `research.thesis.update`, `research.revision.create`, `research.source.attach`, `research.run.create`, `research.run.cancel`, and since B15 `agent.tool.invoke` (mutations), `agent.proposal.create`, `agent.proposal.open`, `agent.proposal.dismiss`, `companion.run.create`, `companion.run.cancel`, with the acting principal and secret-free details |
| Budgets (B15) | per run: tool calls (at most 12), answer characters (at most 4000), cost micros (at most 2 000 000), a 20 s step timeout and a 60 s deadline; per account: a rolling daily cost cap (`COMPANION_DAILY_COST_LIMIT_MICROS`) that refuses runs with `BUDGET_EXHAUSTED` |

## Verification

`apps/api/test/research.test.ts` proves the scope split (read vs write vs
publish), owner scoping, that an unknown company never becomes an
instrument id and that model inferences carry provenance;
`apps/api/test/agents.test.ts` (B15) proves the tool catalog per scope,
strict inputs, that a malicious retrieved document and a model asking for
escalation are refused at the tool layer with the owner's limits
unchanged, that only the owner opens a proposal, and who may read events;
`packages/agent-tools/test` proves the pure rules (scope matrix, strict
parsing, redaction, budgets, the fixture adapter's behaviour);
`apps/api/test/research-retrieval.test.ts` and `packages/research/test`
prove the retrieval policy and sanitisation. Any change to scopes, tools
or data flow updates this file in the same commit.
