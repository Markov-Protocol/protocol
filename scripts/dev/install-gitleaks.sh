#!/usr/bin/env bash
# Install a pinned gitleaks binary for local and CI secret scanning.
# Checksums are from the upstream release checksums file retrieved 2026-09-24
# (docs/markov/source-register.md, SR-GITLEAKS-01).
set -euo pipefail
VERSION="8.30.1"
DEST="${1:-$HOME/.local/bin}"
case "$(uname -s)-$(uname -m)" in
  Linux-x86_64)  ASSET="linux_x64";    SHA="551f6fc83ea457d62a0d98237cbad105af8d557003051f41f3e7ca7b3f2470eb" ;;
  Linux-aarch64) ASSET="linux_arm64";  SHA="e4a487ee7ccd7d3a7f7ec08657610aa3606637dab924210b3aee62570fb4b080" ;;
  Darwin-x86_64) ASSET="darwin_x64";   SHA="dfe101a4db2255fc85120ac7f3d25e4342c3c20cf749f2c20a18081af1952709" ;;
  Darwin-arm64)  ASSET="darwin_arm64"; SHA="b40ab0ae55c505963e365f271a8d3846efbc170aa17f2607f13df610a9aeb6a5" ;;
  *) echo "unsupported platform $(uname -s)-$(uname -m)" >&2; exit 1 ;;
esac
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
URL="https://github.com/gitleaks/gitleaks/releases/download/v${VERSION}/gitleaks_${VERSION}_${ASSET}.tar.gz"
echo "downloading ${URL}"
curl -fsSL -o "$TMP/gitleaks.tar.gz" "$URL"
echo "${SHA}  $TMP/gitleaks.tar.gz" | sha256sum -c -
mkdir -p "$DEST"
tar -xzf "$TMP/gitleaks.tar.gz" -C "$DEST" gitleaks
chmod +x "$DEST/gitleaks"
"$DEST/gitleaks" version
echo "installed gitleaks to $DEST (add it to PATH if needed)"
