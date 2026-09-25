#!/usr/bin/env bash
# Choose the commit range CI checks against the commit policy, then check it.
#   pull_request: base..head of the pull request
#   push:         before..head when "before" is a known ancestor (an ordinary
#                 push); otherwise (a new branch, a force push, a manual run)
#                 every commit not on the default branch
# Inputs come from the environment (EVENT_NAME, PR_BASE, PR_HEAD, PUSH_BEFORE,
# HEAD_SHA, DEFAULT_BRANCH) so no event text is interpolated into the script.
set -euo pipefail
HEAD_SHA="${HEAD_SHA:-$(git rev-parse HEAD)}"
DEFAULT_BRANCH="${DEFAULT_BRANCH:-main}"
ZERO=0000000000000000000000000000000000000000
if [ "${EVENT_NAME:-}" = "pull_request" ]; then
  RANGE="${PR_BASE}..${PR_HEAD}"
  REASON="pull request base..head"
elif [ -n "${PUSH_BEFORE:-}" ] && [ "${PUSH_BEFORE}" != "$ZERO" ] \
  && git cat-file -e "${PUSH_BEFORE}^{commit}" 2>/dev/null \
  && git merge-base --is-ancestor "${PUSH_BEFORE}" "$HEAD_SHA"; then
  RANGE="${PUSH_BEFORE}..${HEAD_SHA}"
  REASON="ordinary push"
else
  BASE="$(git merge-base "origin/${DEFAULT_BRANCH}" "$HEAD_SHA")"
  RANGE="${BASE}..${HEAD_SHA}"
  REASON="new branch, force push or manual run: every commit not on ${DEFAULT_BRANCH}"
fi
echo "commit policy range: ${RANGE} (${REASON})"
node tooling/commit-policy/check-range.mjs "$RANGE"
