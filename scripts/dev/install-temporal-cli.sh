#!/usr/bin/env bash
# Install a pinned Temporal CLI (provides `temporal server start-dev`).
# Checksums are from the upstream release checksums.txt retrieved 2026-09-24
# (docs/markov/source-register.md, SR-TEMPORAL-01).
set -euo pipefail
VERSION="1.9.1"
DEST="${1:-$HOME/.local/bin}"
case "$(uname -s)-$(uname -m)" in
  Linux-x86_64)  ASSET="linux_amd64";  SHA="09a0326a51db84d02735e53542b9ebd8c4758daf47482a9ab0abce15844e60d5" ;;
  Linux-aarch64) ASSET="linux_arm64";  SHA="6c57c352d52fc3df34412376fd9ba6f74b7e3ace8e426e6cba8600156d36a145" ;;
  Darwin-x86_64) ASSET="darwin_amd64"; SHA="48cdd6c84c56e27ae8e4d9a47052b89289a9c552dee029b49dd312c6fb72873f" ;;
  Darwin-arm64)  ASSET="darwin_arm64"; SHA="41e0425378fcb4fb5766340b97435e20fe47bbff2d7bf644ec2d51f7662b7c56" ;;
  *) echo "unsupported platform $(uname -s)-$(uname -m)" >&2; exit 1 ;;
esac
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
URL="https://github.com/temporalio/cli/releases/download/v${VERSION}/temporal_cli_${VERSION}_${ASSET}.tar.gz"
echo "downloading ${URL}"
curl -fsSL -o "$TMP/temporal.tar.gz" "$URL"
echo "${SHA}  $TMP/temporal.tar.gz" | sha256sum -c -
mkdir -p "$DEST"
tar -xzf "$TMP/temporal.tar.gz" -C "$DEST" temporal
chmod +x "$DEST/temporal"
"$DEST/temporal" --version
echo "installed temporal to $DEST (add it to PATH if needed)"
