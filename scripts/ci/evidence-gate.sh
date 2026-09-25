#!/usr/bin/env bash
# Prepare one CI evidence directory for upload:
#   1. redact credential-shaped values from text files and from the text
#      entries of archives, including the archive a Playwright HTML report
#      embeds (tooling/release/redact.mjs); uninspectable archives are removed;
#   2. verify that no credential-shaped value remains anywhere, archives
#      included (redact.mjs --verify);
#   3. scan the directory with the pinned gitleaks, default rules plus the
#      Markov credential and fixture key formats
#      (tooling/release/evidence-gitleaks.toml), and scan the archives that
#      HTML reports embed as data URLs, which gitleaks does not decode itself.
# A finding fails the step with exit 1 and prints what tripped it (values
# redacted); a scanner that is missing or errors fails it with exit 2. Either
# way the upload that depends on the step does not run.
#   bash scripts/ci/evidence-gate.sh <dir>
set -euo pipefail
DIR="${1:?usage: evidence-gate.sh <dir>}"
if [ ! -d "$DIR" ]; then
  echo "evidence gate: $DIR does not exist" >&2
  exit 2
fi
if ! command -v gitleaks >/dev/null 2>&1; then
  echo "evidence gate: gitleaks is not installed; nothing is uploaded" >&2
  exit 2
fi
node tooling/release/redact.mjs "$DIR"
node tooling/release/redact.mjs --verify "$DIR"

WORK="$(mktemp -d)"
trap 'rm -rf -- "$WORK"' EXIT
mkdir "$WORK/embedded"
node tooling/release/redact.mjs --extract-embedded "$DIR" "$WORK/embedded"

# Exit code 3 means "leaks found"; anything else non-zero is a scanner error.
scan() {
  local target="$1" report="$2" rc=0
  gitleaks dir --redact --no-banner --verbose --exit-code 3 \
    --config tooling/release/evidence-gitleaks.toml \
    --max-archive-depth 3 --report-format json --report-path "$report" "$target" || rc=$?
  if [ "$rc" -eq 3 ]; then
    echo "evidence gate: the secret scan found the values above in $DIR (redacted); nothing is uploaded" >&2
    cat "$report" >&2 || true
    exit 1
  elif [ "$rc" -ne 0 ]; then
    echo "evidence gate: gitleaks failed with exit code $rc; nothing is uploaded" >&2
    exit 2
  fi
}
scan "$DIR" "$WORK/secret-scan.json"
scan "$WORK/embedded" "$WORK/secret-scan-embedded.json"
mv "$WORK/secret-scan.json" "$DIR/secret-scan.json"
mv "$WORK/secret-scan-embedded.json" "$DIR/secret-scan-embedded.json"
echo "evidence gate: $DIR redacted, verified and scanned"
