# Instrument catalog

Status: implemented in session B03 for the PreStocks issuer pipeline with
synthetic fixtures. The live PreStocks feed is BLOCKED (OD-17). xStocks
quantities and corporate actions arrive with B04.

## What an instrument is

A token issued by a known issuer (`prestocks`, later `xstocks`, `tessera`)
that an operator admitted after its mint was verified on chain. The catalog
records what the issuer published (sanitised), what the chain holds, and
every lifecycle decision. It never decides eligibility for a person (B05),
never quotes (B09) and never enables execution (B10).

## Lifecycle

```
ingest ──► quarantined ──admit (needs matching verification)──► admitted ──pause──► paused ──resume (needs verification)──► admitted
             │  └─reject──► rejected                              └─delist──► delisted      └─reject / delist
             └─ upstream invalid or collision on insert ──► rejected
admitted/paused + upstream changed mint or decimals ──► paused (review)
rejected + upstream record valid again ──► quarantined (re-review)
delisted ──► ignores upstream forever
```

Only admitted and paused instruments are visible without an operator
credential. `availability` says what the catalog alone permits: research
(admitted, paused), strategy building (admitted), trade (never; execution
sessions add per-action, per-owner checks and `EXECUTION_WRITES_ENABLED`).

## Ingestion

1. A source delivers the Markov issuer feed contract, version 1
   (`issuerFeedSchema`): `fixture` (synthetic products bundled in
   `packages/issuer-prestocks/fixtures`, refused outside local and test) or
   `configured_url` (`PRESTOCKS_FEED_URL`, https outside local/test, no
   credentials, no redirects, 10 s, 2 MiB). Fixture sources re-anchor the
   products' `referencePrice.observedAt` to the current hour relative to
   the fixtures' authoring instant (`FIXTURE_PRICE_ANCHOR`), so a fixture
   written as fresh stays fresh and one written as stale stays stale
   whatever the date; nothing else in a fixture moves and configured URLs
   are never touched.
2. The payload is hashed and recorded as a snapshot. Structural drift
   (renamed keys, unknown schema version, another issuer) rejects the whole
   snapshot and changes nothing.
3. Each product is sanitised (control characters, markup and scripts
   removed, lengths bounded, https-only websites) and validated. Invalid
   products are rejected with every reason; they are never repaired.
4. Rules (`packages/catalog/src/plan.ts`): new products enter quarantine; a
   symbol already used by a live instrument with a different mint is a
   counterfeit and is rejected; a mint already bound to another product is
   rejected; duplicates within a feed are rejected; an admitted or paused
   instrument whose mint or decimals changed upstream is paused for review;
   a delisted instrument ignores upstream.
5. The writes apply in one transaction; the report lists every product's
   outcome and reasons.

## Mint verification

`POST /v1/ops/catalog/instruments/{id}/mint-verifications` reads the mint
account through the bounded RPC client (`getAccountInfo`, base64) and parses
the SPL Token or Token-2022 layout (`packages/catalog/src/mint.ts`, verified
against the program sources; see the source register). The result is one
of `verified`, `mismatch` (decimals or token program disagree, unknown
Token-2022 extension types), `not_found`, `not_a_mint` or `error`. Token-2022
extensions are recorded by name; extensions that change what holding the
token means (transfer fees, permanent delegate, transfer hooks, non
transferable, pausable, confidential transfers, interest bearing, scaled UI
amounts, permissioned burn) are listed so B04 can evaluate compatibility
before any trade.

Admission and resumption require a `verified` result recorded after the
instrument's last upstream change; otherwise the API answers
`ADMISSION_BLOCKED` (409).

## Listed stocks (B04)

xStocks products are `listed_stock` instruments with an underlying ticker
and exchange as the issuer names them. Their Token-2022 mints are assessed
against the extension policy in `docs/markov/instrument-admission.md` at
every verification; a pause seen on chain halts the instrument.

Quantities: raw base units never change; the scaled display quantity is
raw × multiplier / 10^decimals, computed exactly by `@markov/amounts`
(`docs/markov/accounting-methodology.md`). `GET
/v1/catalog/instruments/{id}/quantities` converts either way with the
multiplier in force at `asOf` and refuses when no evidence covers that time.

Corporate actions arrive through the corporate-action feed contract
(splits, reverse splits, distributions, migrations, sunsets, halts,
resumes, multiplier changes) as pending events for known products only.
An operator applies an event once it is effective; the derived multiplier
is recorded with the previous multiplier and evidence references. The
lifecycle block on every instrument reports halts, pending actions,
migrations, sunsets and the multiplier in force.

## Prices

A catalog price is `issuer_mark`, `implied_valuation` or `secondary_market`
with its unit, observation time and source, `expiresAt: null`, and `stale`
computed at read time (older than 24 hours). It is never an
`execution_quote` and no consumer may treat it as one.

## Operator surface

`ops:catalog:read` lists every status, decisions and snapshots;
`ops:catalog:write` ingests, verifies and decides. Every write is audited
with the operator's credential id, the reason and the secret-free evidence
references. CLI: `markov catalog ingest|list|verify-mint|decide|snapshots`.

## Not in B03 and B04

The live PreStocks and xStocks endpoints and their mappings (OD-17,
OD-18), executable route tests, eligibility and terms evidence (B05),
scheduled re-ingestion (B16), Tessera (B17).
