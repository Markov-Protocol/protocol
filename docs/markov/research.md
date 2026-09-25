# Sourced research and versioned theses (B06)

Session B06 gives the backend a place for a person's investment reasoning
that is honest about what rests on what: every statement is typed, facts
and issuer claims cite fetched sources, model output is a labelled draft
bound to the run that produced it, and a company the catalog does not
carry stays a research subject. Nothing in this module is investment
advice, and nothing here can place an order or name a mint that was not
admitted through the catalog (B03/B04).

## Concepts

| Term | Meaning |
| ---- | ------- |
| Thesis | Owned by one person; `private` or `public`; `draft` or `archived`. Its content lives in revisions. |
| Revision | Immutable, numbered in order: title, claim, statements, counterarguments, instrument references, research subjects, private notes, the author principal (`user:<id>` or `agent:<credential id>`) and the SHA-256 of the canonical public content. Editing means appending. |
| Statement kind | `fact` (must cite fetched sources), `issuer_assertion` (must cite fetched sources; on `backing`, `rights`, `fees` or `redemption` at least one `issuer`, `legal` or `filing` source), `user_opinion` (the author's own), `model_inference` (must name the succeeded run that produced it; no other kind may carry a run id). |
| Source record | The result of retrieving a URL under the safe-retrieval policy: role (`issuer`, `legal`, `filing`, `news`, `data`, `other`), the URL given and the final URL after validated redirects, title, status `fetched` / `blocked` / `failed` with the reason, content type, byte length, SHA-256 of the bytes, a sanitised plain-text excerpt (≤ 1,200 characters), the author-supplied `publishedAt` / `observedAt` and the retriever's `retrievedAt`. Only fetched sources can be cited. |
| Instrument reference | An admitted or paused catalog instrument id with an optional note. Quarantined, rejected, delisted or unknown ids are refused. |
| Research subject | A company named in the thesis that the catalog does not carry. It is text, never a token, and it may not duplicate a referenced instrument's company. |
| Mapping | Deterministic: the normalised company name (`companyKey`, shared with the policy's concentration rule) must equal an admitted or paused instrument's normalised company name. No fuzzy matching, no model. Unmatched names stay unmatched. |
| Research run | A bounded call of the model adapter over the question, the thesis title and claim, the excerpts of the named fetched sources and the admitted candidates. Statuses `queued` → `running` → `succeeded` / `failed` / `cancelled`. Output is validated before it is stored. |
| Public projection | The current revision's labelled statements, counterarguments, instrument references, subjects and dated source records. No private notes, no owner identity. Exists only while the owner keeps the thesis public and not archived. |

## Research rules

`@markov/research` (`validateRevision`) refuses a revision with the exact
issue paths and messages the API returns in `error.details`:

| Rule | Message |
| ---- | ------- |
| A fact or issuer assertion cites no source | `a fact must cite at least one source` |
| A statement cites an unknown or unfetched source | `unknown source <id>` / `source <id> was blocked; cite a fetched source` |
| An issuer assertion about backing, rights, fees or redemption rests only on news, data or other sources | `a claim about <topic> must cite an issuer, legal or filing source` |
| A model inference without a run, or any other kind with one | `a model inference must name the research run that produced it` / `only model inferences carry a run id` |
| A run id that is not a succeeded run of this thesis | `unknown research run <id>` |
| An instrument that is not admitted or paused | `instrument <id> is not in the admitted catalog` / `instrument <id> is quarantined; only admitted or paused instruments can be referenced` |
| A subject that duplicates a referenced instrument's company | `<name> is already referenced through an admitted instrument` |
| Duplicate statement ids, instruments or subjects | `duplicate statement id <id>`, `instrument <id> is referenced twice`, `subject <name> is listed twice` |

Text fields are plain text: markup characters and control characters are
refused by the contract, and imported text is sanitised before it is
stored. The content hash covers the public content with sorted keys and
sorted citations, so two revisions with the same public content hash
equally even if their private notes differ.

## Safe retrieval

Attaching a source runs the retriever (`apps/api/src/research/retrieval.ts`)
under the policy in `@markov/research`:

1. **URL policy** before any network activity: `https` only, no
   credentials, default port only, no address literal in any spelling
   (dotted, decimal, hexadecimal, bracketed IPv6), no local or special-use
   name (`localhost`, `metadata`, `*.local`, `*.internal`, `*.home.arpa`,
   `*.onion`, `*.test`, `*.example`, `*.invalid`, `*.localdomain`, `*.lan`,
   `*.intranet`, `*.corp`, …), a fully qualified name in the DNS alphabet,
   at most 2,048 characters. Fragments are dropped.
2. **Address classification**: every DNS answer for the host must be
   public. Refused: `0/8`, `10/8`, `100.64/10`, `127/8`, `169.254/16`,
   `172.16/12`, `192.0.0/24`, `192.0.2/24`, `192.88.99/24`, `192.168/16`,
   `198.18/15`, `198.51.100/24`, `203.0.113/24`, `224/4`, `240/4`; IPv6
   unspecified, loopback, IPv4-mapped (classified by the inner address),
   NAT64 `64:ff9b::/96`, 6to4 `2002::/16`, Teredo `2001::/32`,
   documentation `2001:db8::/32`, discard `100::/64`, unique local
   `fc00::/7`, link-local `fe80::/10`, multicast `ff00::/8`. An empty
   answer is refused.
3. **Pinned connection**: the request is sent to the address that was
   classified, with the URL host as SNI and `Host`, so a second lookup can
   never rebind the name to another address between check and use.
4. **Redirects** are never followed by the transport. Each `Location` is
   resolved against the current hop, must pass the URL policy again and
   the next hop resolves and classifies again. At most 3 hops; a downgrade
   to `http`, an address literal or a private target is refused.
5. **Content**: only `text/html`, `application/xhtml+xml`, `text/plain`
   and `application/json`; a declared or streamed body over 2 MiB is
   refused mid-stream; the whole retrieval is bounded by a 10 s timeout.
6. **Sanitisation**: HTML becomes plain text with `script`, `style`,
   `template`, `noscript`, `iframe`, `object`, `embed`, `svg`, `math`,
   comments and every tag removed, entities decoded, control characters
   and line separators dropped, whitespace collapsed; the excerpt is cut
   on a word boundary. Retrieved text is data: it never changes an
   instruction. The research model has no tools at all; the companion of
   B15 has typed tools behind a validating layer that refuses whatever a
   retrieved page asks for (`docs/markov/agents.md`, proven with the
   fixture page `MALICIOUS_ANALYST_NOTE`).
7. The retriever holds **no credentials** and sends none: no cookies, no
   authorization, a fixed `User-Agent`, `Accept-Encoding: identity`.

A refused fetch is still recorded (`blocked` with the reason) so the
thesis shows what could not be used; a network or HTTP failure is
`failed`. Neither can be cited.

Local and test serve the bundled fixture sources
(`FIXTURE_SOURCES` in `@markov/research`, host `fixture.markov.invalid`)
from memory; the same host is refused by the URL policy everywhere else,
so a fixture URL can never turn into a real fetch.

## Runs and the model adapter

`RESEARCH_MODEL_PROVIDER` selects the adapter: `disabled` (default; runs
answer `PROVIDER_UNAVAILABLE`, everything else works), `fixture`
(deterministic, local/test only) or `xai` (xAI Grok over the chat
completions API, B17, `@markov/model-xai`; the canonical prompt is sent
verbatim and the reply is validated as one JSON object). The adapter contract
(`ResearchModelAdapter`) receives a `ModelInput` and returns plain text
and identifiers; it has no tools, no network of its own and no
credentials. The companion adapter of B15 (`CompanionModelAdapter`) is a
separate contract whose only tools are the typed catalog of
`docs/markov/agents.md`, each call validated and authorised outside the
model. The service:

1. Refuses source ids that are not fetched sources of the thesis.
2. Builds the input from the current revision and hashes the exact prompt
   text (`promptHash`); the text itself is not stored.
3. Records the run (`queued`), marks it `running`, calls the adapter with
   a 20 s bound, then validates the output deterministically
   (`validateModelOutput`): statements become `model_inference` statements
   bound to the run and cut to the budget (`maxStatements`,
   `maxOutputChars`); instrument ids must be admitted candidates; company
   names that match a candidate are suggested, the rest are reported as
   `unmatchedCompanies`; everything else lands in `rejected`.
4. Stores provenance (`provider`, `model`, `modelVersion`, `promptHash`,
   `toolCalls` (always empty for a research run; companion runs keep
   theirs in their own redacted provenance, B15), `budgetUsed`) and the validated
   output. A run cancelled while running keeps `cancelled` and its result
   is dropped.

Drafts enter a thesis only when the person (or an agent with
`research:write`) appends a revision that carries them, and the run id
must be one of the thesis's succeeded runs.

## Visibility and scopes

| Operation | Principal |
| --------- | --------- |
| Read theses, revisions, sources, runs; map companies | user, agent `research:read` |
| Create theses, append revisions, attach sources, create or cancel runs | user, agent `research:write` |
| Publish, unpublish or archive | user only |
| Public projection | anonymous |

Everything is scoped by the verified owner: another person's thesis or
run answers `NOT_FOUND`. Source attachment and run creation are limited to
10 per minute per client address.

## CLI

```
markov research thesis create --title … --claim … --token <session> --url …
markov research thesis revise <thesisId> --file revision.json --token …
markov research source attach <thesisId> --source-url https://… --role issuer --token …
markov research map --company "Fixture Aerospace, Inc." "Unknown Rocket Co" --token …
markov research run create --thesis <thesisId> --question "…" --source <sourceId> --token …
markov research thesis publish <thesisId> --visibility public --token …
markov research thesis public <thesisId> --url …
```

## Verification

`packages/research/test` (rules, hashing, mapping, adapter validation,
URL/redirect policy, sanitiser), `packages/db/test/research-store.test.ts`
(owner scoping, ordered revision numbers under concurrency, run
transitions), `apps/api/test/research-retrieval.test.ts` (address
classification, pinned requests, redirect revalidation, caps, content
types, fixture serving), `apps/api/test/research.test.ts` (the manual
journey, refused retrievals as evidence, bounded runs, scopes and
ownership) and the research journey in `scripts/ci/startup-check.sh`.
