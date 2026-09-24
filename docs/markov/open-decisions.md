# Open decisions

Decisions that need real evidence, credentials or an accountable owner.
None blocks local implementation of independent modules. Each entry names
the session where it must be resolved at the latest.

| ID    | Decision                                                                 | Needed by | Owner (to assign) | Notes |
| ----- | ------------------------------------------------------------------------ | --------- | ----------------- | ----- |
| OD-01 | Solana SDK family (`@solana/kit` vs `@solana/web3.js`) and conversion isolation | B09 | engineering | ADR-0004 keeps B01 SDK-free; decide with instruction-decoding compatibility tests. |
| OD-02 | TypeScript 6/7 upgrade                                                   | any       | engineering | Re-run the full gate; note in ADR-0002. |
| OD-03 | OpenTelemetry exporter and tracing backend                               | B18       | operations | Logs are structured now; traces from request to receipt are required before release candidate. |
| OD-04 | Primary and independent secondary RPC providers, credentials and rate limits | B03 | operations | Required for staging; keys must be redacted from URLs in logs (implemented). |
| OD-05 | Production identity-provider account (existing provider or Privy)        | F03       | product/security | B02 shipped a provider-neutral verifier (issuer, audience, JWKS, asymmetric algorithms). Privy documentation was unreachable; confirm its issuer string, audience (app id), key publication (JWKS vs PEM) and `auth_time` semantics, then add PEM support if needed. |
| OD-06 | Launch jurisdictions, product classification, distribution permissions   | before beta | counsel/product | Backend supports eligibility decisions; it cannot invent the rule. |
| OD-07 | First admitted instruments (PreStocks/xStocks) and issuer terms          | B03/B04   | product/counsel | Admission needs on-chain mint verification and terms review. |
| OD-08 | Licensed research/price data rights                                      | B06/B13   | product | A reachable endpoint is not a redistribution right. |
| OD-09 | Independent reviewers and review scope (backend, registry program)        | B08/B18   | security | No unresolved critical/high findings before beta. |
| OD-10 | Registry upgrade authority signers and change process                    | B08       | security/ops | Never renounced automatically; multisig held independently. |
| OD-11 | Hosting provider, budget and operations ownership                        | B18       | operations | One write region with PITR; compose file is a local convenience only. |
| OD-12 | Approved mainnet beta caps (`BETA_*`) and participant allowlist          | before beta | product/risk | Config refuses production writes without them (implemented). |
| OD-13 | Hardware capability and pairing model for Mark I                         | B15       | product/hardware | Event contracts only in this repository. |
| OD-14 | Future perps venue                                                       | after stock release | product | No venue selected by the specification. |
| OD-15 | Tessera API access, schema and terms                                     | B17       | product | Endpoint returned 403 in planning; disabled until verified. |
| OD-16 | Docker-based local dependency path verification                          | next environment with Docker | engineering | `docker-compose.yml` was not executed in B01. |
