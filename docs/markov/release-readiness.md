# Release readiness

Launch-readiness reports distinguish: code complete, tested locally, CI
evidence retained, provider read verified, provider write verified,
reviewed, deployed, monitored. Credentials, audits, legal decisions and
funding approvals cannot be produced by a coding agent; a checked box needs
a reviewable artifact tied to the candidate.

The machine-readable record of this page is
[`release-status.json`](release-status.json): it lists the same gates and
checklist rows with their evidence, and `node tooling/release/status.mjs
--check` fails when the two disagree. Neither this page nor the manifest
enables anything: configuration, capability readiness rows and the
authorizations below decide what runs.

## Where the candidate stands (2026-09-25)

- Sessions B01 to B16 are complete, B17 closed after its xAI increment, the
  app sessions F01 to F12 and the documentation site D01 are complete. The
  production completion plan (P01 to P24) and the documentation plan (D02 to
  D09) continue from here; F13 to F20 are not built.
- Everything financial is verified against fixtures only: no live provider
  has been called, no program is deployed on any cluster and nothing has
  been signed with real funds.
- The web app and the documentation site are deployed on Vercel from this
  branch. The app runs in staging mode against a placeholder API origin and
  shows "Backend unreachable"; no backend is hosted (Railway is selected,
  not provisioned).
- P01 makes CI run on every push of this branch and keep redacted
  evidence as artifacts (ADR-0010). Observed runs are recorded in
  `release-status.json`; a gate moves only when such evidence exists.

## Gates

| Gate                         | Required evidence                                                                 | Status |
| ---------------------------- | --------------------------------------------------------------------------------- | ------ |
| Local feature completion     | SDK/CLI journey, deterministic tests, database/registry consistency, no mock leakage | In progress: B01 to B16, F01 to F12 and D01 complete against fixtures (`docs/sessions`); F13 to F20 and live integrations remain |
| Staging integration          | Real provider contracts/credentials, network checks, signed-path verification, restore drill | Not started: frontends deployed on Vercel without a backend; no provider credential, hosted API or restore drill exists |
| Security review              | Backend authorization/execution review; registry independent review; no critical/high open | Not started: no reviewer named (OD-09) |
| Product/issuer clearance     | Jurisdictions, distribution/terms, instrument admission, data rights, support ownership | Not started (OD-06, OD-07, OD-08) |
| Capped private mainnet beta  | Named participants, asset allowlist, order/account/daily caps, owner review, monitoring, rollback | Not started; configuration already refuses production writes without `BETA_*` caps and a release evidence reference |
| Broader stock release        | Observed reconciliation/execution reliability, incidents handled, capacity validated | Not started |
| Unattended automation        | Independently enforced scoped authority, recovery/revocation evidence, review, pilot | Disabled by design (`automation.unattended`, OD-26) |
| Perps                        | Separate venue, margin/oracle/execution/accounting review, capped pilot           | Not started (OD-14) |

## Mainnet release checklist

Each row needs a verifiable artifact tied to the candidate before it is
met. "Partly met" names what exists and what is missing.

| ID    | Requirement | Status |
| ----- | ----------- | ------ |
| RC-01 | Candidate revision and reproducible build artifacts identified; required CI checks pass and their artifacts are retained | Not met: P01 adds retained CI evidence (ADR-0010); no green run is recorded for a candidate and no container artifact exists (P02) |
| RC-02 | Production refuses test identity, fixtures, local receipt keys, internal development routes and unapproved capability overrides | Partly met: configuration refuses the test issuer, fixture providers and a local receipt key in production, and the web build refuses fixtures and internal routes (`packages/config/test/config.test.ts`, `apps/web/test/web-env.test.ts`, the CI refusal step); not yet exercised against a deployed production environment |
| RC-03 | Real authentication, wallet binding, recovery, account isolation and step-up behaviour verified | Not met: verified with the in-process test issuer only; no identity provider is configured (OD-05) |
| RC-04 | Approved issuer terms, jurisdictions, data rights, participant eligibility and instrument admission exist | Not met (OD-06, OD-07, OD-08, OD-12) |
| RC-05 | Actual upstream adapters work; live source freshness and unavailable-data behaviour verified | Not met: issuer, price and venue adapters consume Markov-shaped contracts from fixtures or configured gateways; no live read (OD-17, OD-18, OD-21, OD-23) |
| RC-06 | Every admitted route has reviewed decoding and account-effect rules, simulation evidence, supported extension behaviour and upgrade monitoring | Not met: the route-program matrix reviews no live program |
| RC-07 | Owner approval, signed-message equality, reservation concurrency, idempotency, expiry, partial execution and unknown-state recovery pass | Partly met: verified against the fixture chain (`apps/api/test/execution.test.ts`, `apps/api/test/basket-execution.test.ts`, the startup check); no live route or test network run |
| RC-08 | Registry artifact, program identity, upgrade authority and independent review verified for enabled publication | Not met: no SBF artifact, no deployment, no upgrade-authority process or review (OD-09, OD-10) |
| RC-09 | Production receipts, key rotation, old-key verification, journal reconciliation and exports work | Not met: receipts, the journal and exports are fixture-verified with a local key that production refuses; no KMS signer (OD-22) |
| RC-10 | Core app journeys, maintenance proposals, account settings, companion boundaries and session restore work against the intended backend | Not met: journeys pass against the local API with fixtures; no hosted backend and F13 to F20 are not built |
| RC-11 | Continuous monitoring, alert delivery, pause controls, support ownership, backup recovery and workflow replay safeguards exercised | Not met: no exporter, alerting, pause control or restore drill (OD-03, P18, P22) |
| RC-12 | Independent review has no unresolved critical or high finding in launch scope; residual findings have attributable disposition | Not met: no independent review (OD-09) |
| RC-13 | Numerical pilot caps, participant, mint and route allowlists, operating coverage and incident stop conditions selected and approved | Not met: configuration requires the caps; no values are approved (OD-12) |
| RC-14 | Release evidence bundle is immutable and accessible to reviewers; no sensitive records or secrets included | Not met: P01 makes CI retain per-run evidence (ADR-0010); no run is recorded yet (`ci.observedRuns` in the manifest is empty) and no release bundle has been assembled or reviewed |
| RC-15 | Actual financial deployment and funded pilot activity have specific authorization | Not met: no authorization exists; nothing is deployed or funded |
| RC-16 | Documentation matches the deployed version and distinguishes current, experimental and unavailable features | Partly met: status documents reconciled in P01 (`docs/markov/status-a-to-z.md`, this page); the user-facing availability guide is planned (D06) |

## Mainnet approval procedure (planned)

An attributable operator sets the beta caps and `RELEASE_EVIDENCE_REF`
pointing at an immutable evidence bundle (commit, CI evidence, review
findings, provider verification records). Production writes stay refused
until every value is present; a cap limits authorized exposure and does not
make an investment safe. A non-empty `RELEASE_EVIDENCE_REF` is a pointer
for reviewers, not an authorization: the funded pilot needs the owner's
specific approval of the exact deployment (P23).
