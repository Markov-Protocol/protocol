# Agent permissions, tools and model handling

This file is the reviewed statement of what any automated participant
(a scoped agent credential, the research model adapter, a future worker)
may do in Markov, what it may see, and what evidence exists. It is
required by the build specification and must change together with the
code that enforces it.

## Principals and scopes

| Principal | How it exists | Scopes | Cannot |
| --------- | ------------- | ------ | ------ |
| agent (`mkv_ag_…`) | created by a person with a fresh sign-in (B02) | `research:read`, `research:write`, `portfolio:read`, `proposals:create` | sign, approve, spend, change security settings, publish a thesis, create credentials, read another account |
| operator (`mkv_op_…`) | `markov operators create` with database access | `ops:*` scopes only | use owner routes or read private research |
| device (`mkv_dv_…`) | pairing code | `preferences:sync`, `status:read`, `notifications:receive` | read accounts, research or holdings |
| worker | process identity | Temporal activities only | act as a person |

An agent acts *for* one person and only inside that person's resources:
every store call is scoped by the verified owner. Nothing an agent does is
an approval; approvals and signatures stay with the person's wallet.

## Tools available to a model

None. The V1 model adapter (`ResearchModelAdapter`) is a pure function of
its input: it cannot fetch, call the API, read the database, sign or
send. Source retrieval is a system function that runs before the model,
under the safe-retrieval policy (`docs/markov/research.md`), and holds no
credentials. `toolCalls` in every run's provenance is therefore an empty
list; a future adapter that is given tools must record each call there
and must be reviewed against this file first.

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

## Model and data handling

| Item | V1 |
| ---- | -- |
| Provider | `RESEARCH_MODEL_PROVIDER=disabled` (default) or `fixture` (deterministic, refused outside local/test). No hosted provider is integrated; selecting one is OD-19. |
| Provenance recorded per run | provider, model, model version, SHA-256 of the exact prompt text, tool calls (empty), budget used, timestamps, error message on failure |
| Prompt text | hashed, not stored |
| Data sent to a provider | see the input above; never holdings, keys, tokens or emails |
| Retention | runs and their validated output are kept with the thesis; deleting the person's account cascades |
| Audit | `research.thesis.create`, `research.thesis.update`, `research.revision.create`, `research.source.attach`, `research.run.create`, `research.run.cancel` with the acting principal and secret-free details |

## Verification

`apps/api/test/research.test.ts` proves the scope split (read vs write vs
publish), owner scoping, that an unknown company never becomes an
instrument id and that model inferences carry provenance;
`apps/api/test/research-retrieval.test.ts` and `packages/research/test`
prove the retrieval policy and sanitisation. Any change to scopes, tools
or data flow updates this file in the same commit.
