#!/usr/bin/env bash
# Secret scan for staged changes (default) or a git range.
#   bash tooling/secrets/scan.sh            # staged changes
#   bash tooling/secrets/scan.sh <base>..<head>
# Requires gitleaks (scripts/dev/install-gitleaks.sh installs a pinned version).
set -euo pipefail
if ! command -v gitleaks >/dev/null 2>&1; then
  echo "gitleaks is not installed; run scripts/dev/install-gitleaks.sh" >&2
  exit 69
fi
cd "$(git rev-parse --show-toplevel)"
if [ "${1:-}" = "" ]; then
  exec gitleaks git --staged --redact --no-banner --config .gitleaks.toml .
fi
exec gitleaks git --redact --no-banner --config .gitleaks.toml --log-opts="$1" .
