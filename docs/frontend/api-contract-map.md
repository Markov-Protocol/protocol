# Screen to contract map

Status after F01: no screen calls the backend yet. The generated client
(`packages/api-client`, F03) will be produced from the backend's frozen
OpenAPI document (`docs/markov/openapi.json`), never hand-written.

| Screen / component        | SDK operation | Backend owner | Errors handled | Readiness |
| ------------------------- | ------------- | ------------- | -------------- | --------- |
| Component reference        | none (fixture data, internal route) | n/a | n/a | IMPLEMENTED |
| Formatters (`@markov/formatters`) | consume `TypedPrice`, raw amounts, basis points from `@markov/contracts` | contracts | n/a | FIXTURE_VERIFIED |

Contract additions proposed by the frontend prompt and not yet present in the
backend (capability bootstrap, watchlists, preferences, notification read
status, stream configuration, privacy export/deletion, device status,
simulation reports) are tracked as contract gaps in the session that first
needs them; none is assumed to exist.
