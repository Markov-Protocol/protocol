# ADR-0010: Retained CI evidence and a descriptive release status manifest

Date: 2026-09-25 · Status: accepted · Session: P01

## Context

Until P01 the workflow in `.github/workflows/ci.yml` ran only on pushes to
`main` and on pull requests. `main` holds only the initial commit and no pull
request exists, so GitHub Actions had never run for any commit of the
working branch: every "verified" statement in the session logs came from
local runs. The workflow's last step echoed the path of a JUnit file and
uploaded nothing, so even a run would have left no reviewable record.
Status was spread over prose documents that aged at different speeds (the
release gates still read "after B01"), and the author rewrite of 2026-09-25
changed the hash of every commit ahead of `main`, so the three branch hashes
the older records cited no longer resolve on the branch.

The production completion plan asks for a candidate whose checks anyone can
run and inspect, retained evidence rather than log lines, and a
machine-readable status record that is linked to evidence and grants
nothing by itself.

## Decision

1. **Triggers.** CI runs on every push (development branches included), on
   pull requests and on manual dispatch. GitHub offers manual dispatch only
   for a workflow that exists on the default branch, so until `ci.yml`
   reaches `main` the push trigger is the path that runs it. Runs of the same
   event and ref cancel superseded ones. Independent checks keep running
   after an earlier failure once their prerequisites succeeded, so one
   failing suite does not suppress the other suites' evidence; `test.only`
   fails a CI run; Node is pinned exactly in `.node-version` like pnpm and
   the Rust toolchain. A push checks the commit policy over
   `before..head` when `before` is a known ancestor and otherwise (a new
   branch, a force push, a manual run) over every commit not on the default
   branch (`scripts/ci/commit-policy-range.sh`).
2. **Retained evidence.** Every job writes its logs and reports to
   `ci-evidence/<artifact>/` and uploads them: `checks-reports` (commit
   policy, lint, typecheck, release status check, boundaries, tokens,
   generated-contract drift, migrations, the Vitest JUnit report and log,
   the startup check log, both Playwright JUnit reports, the web build id
   and static-asset digest, the docs site digest; 30 days),
   `browser-evidence` (Playwright HTML reports, traces and screenshots of
   failed tests, the evidence screenshots the run regenerated; 14 days,
   because traces hold test-session cookies from the run's throwaway
   database), `program-reports` (Rust toolchain, `Cargo.lock` digest, fmt,
   clippy and test logs; 30 days) and `supply-chain-reports` (a secret
   scan of the full history of the candidate commit, advisories, licence
   inventory; 30 days). The final job
   downloads them and writes `candidate-evidence` (90 days): the commit and
   tree (on a pull request also the branch head, since the built commit is
   GitHub's temporary merge commit), the run URL, every job's result and
   every file's SHA-256
   (`tooling/release/evidence.mjs`).
3. **Redaction before upload.** `scripts/ci/evidence-gate.sh` first
   rewrites credential-shaped values (`tooling/release/redact.mjs`: private
   keys, including the base64 Ed25519 PKCS#8 shape, `mkv_*` credentials,
   JWTs, bearer tokens, URL passwords, cookie and authorization headers in
   log form and in the `{"name":…,"value":…}` form Playwright traces
   record) in text files, in the text entries of ZIP archives (Playwright
   traces, nested archives included) and in the archive a Playwright HTML
   report embeds in its `index.html`; an archive it cannot read (encrypted,
   ZIP64, unknown compression) is deleted and listed. Patterns tolerate
   terminal colour codes between a prefix and a value, and placeholders use
   square brackets (`[redacted]`) so a redacted JUnit XML file still parses.
   It then verifies that no credential-shaped value remains anywhere, and
   finally scans the directory with the pinned gitleaks using the default
   rules plus the Markov credential and fixture key formats
   (`tooling/release/evidence-gitleaks.toml`), and scans the archives HTML
   reports embed as data URLs separately, because gitleaks does not decode
   them. A finding fails the step with exit 1 and prints what tripped it
   with values redacted; a missing or failing scanner fails it with exit 2;
   either way the upload does not run. Traces of failed browser tests carry
   the session identifiers of the run's throwaway test accounts until this
   pass replaces them; the e2e fixture wallet keeps its private key in the
   test process and signs through a function exposed to the page, so no
   key reaches a trace. CI holds no secrets; checkouts do not persist the
   token.
4. **Release status manifest.** `docs/markov/release-status.json` records
   the sessions and the commits that delivered them, every capability with
   its state and evidence, the release gates and the mainnet checklist, the
   open decisions, the deployments that exist and the CI runs observed. It
   is reviewed data, not configuration: `grantsCapabilities` is `false`, no
   runtime package may read it, and `tooling/release/status.mjs --check`
   (in `pnpm verify` and CI) fails when it drifts from its sources
   (`CAPABILITY_IDS`, the migration seeds, `provider-capabilities.md`,
   `release-readiness.md`, `open-decisions.md`, the session logs and the
   git history of the branch).
5. **Binding a session to its commit.** A session log cannot contain its own
   commit hash. The manifest lists the newest session with
   `bindsTo: "next-manifest-update"`; the next update records the hash, and
   the check refuses more than one unbound session.
6. **Pinned actions.** Actions are pinned to full commit hashes with the
   release tag in a comment; each pin is checked against the upstream tag
   (`git ls-remote --tags`) when it changes, and the result is recorded in
   the session log.

## Consequences

- A candidate's evidence is a set of artifacts tied to one commit and one
  run URL, reviewable without trusting a local log. Artifacts expire; a
  release that needs them longer copies the bundle into its release record.
- A local `pnpm verify` stays the contributor's gate but is no longer the
  only record: the session logs cite CI runs once they exist.
- A capability, gate or checklist row changes state only through a reviewed
  change to the documents and the manifest together; nothing about a CI
  run, a deployment or the manifest itself enables anything at runtime.
- Running on every branch push spends runner minutes on each push; the
  concurrency group cancels superseded runs.
