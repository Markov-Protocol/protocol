# Release readiness

Launch-readiness reports distinguish: code complete, tested locally, provider
read verified, provider write verified, reviewed, deployed, monitored.
Credentials, audits and jurisdiction decisions cannot be produced by a coding
agent.

## Gate status after B01

| Gate                         | Required evidence                                                                 | Status |
| ---------------------------- | --------------------------------------------------------------------------------- | ------ |
| Local feature completion     | SDK/CLI journey, deterministic tests, database/registry consistency, no mock leakage | In progress: B01 foundation only (`docs/sessions/B01.md`) |
| Staging integration          | Real provider contracts/credentials, network checks, signed-path verification, restore drill | Not started |
| Security review              | Backend authorization/execution review; registry independent review; no critical/high open | Not started |
| Product/issuer clearance     | Jurisdictions, distribution/terms, instrument admission, data rights, support ownership | Not started (OD-06, OD-07, OD-08) |
| Capped private mainnet beta  | Named participants, asset allowlist, order/account/daily caps, owner review, monitoring, rollback | Not started; configuration already refuses production writes without `BETA_*` caps and evidence |
| Broader stock release        | Observed reconciliation/execution reliability, incidents handled, capacity validated | Not started |
| Unattended automation        | Independently enforced scoped authority, recovery/revocation evidence, review, pilot | Disabled by design |
| Perps                        | Separate venue, margin/oracle/execution/accounting review, capped pilot           | Not started |

## Mainnet approval procedure (planned)

An attributable operator sets the beta caps and `RELEASE_EVIDENCE_REF`
pointing at an immutable evidence bundle (commit, test results, review
findings, provider verification records). Production writes stay refused
until every value is present; a cap limits authorized exposure and does not
make an investment safe.
