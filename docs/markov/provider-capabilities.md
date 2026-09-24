# Provider and capability readiness

The database table `capability_readiness` is the runtime record
(`markov db status`, `GET /v1/platform`). This file is the reviewed narrative
and must agree with it. States: `IMPLEMENTED`, `FIXTURE_VERIFIED`,
`LIVE_READ_VERIFIED`, `LIVE_WRITE_VERIFIED`, `BLOCKED`, `DISABLED`.

| Capability                      | State after B01   | Evidence / blocker                                                                                   | Activation conditions |
| ------------------------------- | ----------------- | ---------------------------------------------------------------------------------------------------- | --------------------- |
| platform.api.health             | IMPLEMENTED       | `apps/api/test/app.test.ts`, `boot.test.ts`, `scripts/ci/startup-check.sh`                            | n/a |
| platform.db.migrations          | IMPLEMENTED       | `packages/db/test/db.test.ts` against PostgreSQL 16.13                                               | Managed PostgreSQL with PITR before staging |
| platform.worker.temporal        | IMPLEMENTED       | `apps/worker/test/worker.test.ts` against Temporal CLI 1.9.1 dev server                              | Namespace, TLS/API key and task-queue review before staging |
| solana.rpc.read                 | FIXTURE_VERIFIED  | `packages/solana-rpc/test`; live endpoints BLOCKED by egress in B01 (SR-SOL-01)                       | `markov solana probe` succeeds against primary and independent secondary; genesis matches |
| solana.rpc.submit               | DISABLED          | Not implemented before B10                                                                           | B10 validation, simulation and recovery tests |
| catalog.prestocks.ingest        | BLOCKED           | Pipeline IMPLEMENTED and FIXTURE_VERIFIED with synthetic feeds (B03): sanitised snapshots, quarantine, counterfeit and collision rules, on-chain mint verification, operator admission, public search. The live PreStocks endpoint and schema are unreachable (OD-17); no live read exists. | Feed endpoint, schema mapping and terms verified from an environment with access; first live snapshot recorded |
| catalog.xstocks.ingest          | DISABLED          | Not started (B04); xstocks.com BLOCKED in B01                                                        | Multiplier and extension compatibility verified |
| catalog.tessera.ingest          | DISABLED          | Not started (B17); endpoint returned 403 during planning                                             | Current API access, terms, mint identities verified |
| identity.provider.verify        | IMPLEMENTED       | Provider-neutral JWT/JWKS verification (`@markov/auth`) exercised end to end with the in-process test issuer (B02). Privy issuer/audience/key facts BLOCKED (docs.privy.io denied) | Production issuer, audience and JWKS URL verified against provider documentation; test issuer refused outside local/test (enforced) |
| execution.jupiter.quote / build | DISABLED          | Not started (B09); dev.jup.ag BLOCKED in B01                                                          | API key, compatible SDK, supported mints, exact instruction validation |
| execution.spot.submit           | DISABLED          | Not started (B10)                                                                                    | Validated transaction lifecycle and recovery |
| registry.strategy.publish       | DISABLED          | Not started (B08)                                                                                    | Reproducible build, independent review, upgrade-authority policy |
| research.model.generate         | DISABLED          | Not started (B06)                                                                                    | Model/version and data handling recorded; no signing access |
| notifications.email             | DISABLED          | Not started (B16)                                                                                    | Sender/domain and webhook security verified |
| liquidity.meteora.read / dbc-simulate | DISABLED    | Not started (B17)                                                                                    | Read-only pool observation; launches stay disabled |
| automation.unattended           | DISABLED          | Deliberate release gate                                                                              | Independently enforced scoped authority, revocation evidence, separate review and pilot |

Changing a row requires evidence in this file and, for production, an
attributable operator action (`upsertCapabilityReadiness` records `updated_by`).
