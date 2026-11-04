#!/bin/bash
# Release gate: the same steps as CI, run in this checkout.
# npm ci, build, npm test under three TMPDIR settings, then the installer suite.
# JCODE_SCRATCH_DIR is unset so agent scratch never replaces the TMPDIR under test.
# Usage: scripts/gate.sh [LOG]   (default log: ./gate-<timestamp>.log; summary at the end of stdout)
set -uo pipefail
unset JCODE_SCRATCH_DIR MOZAK_TEST_SCRATCH
REPO="$(cd "$(dirname "$0")/.." && pwd)"
LOG="${1:-$REPO/gate-$(date +%Y%m%d-%H%M%S).log}"
BASE="$(mktemp -d)"
mkdir -p "$BASE/plain" "$BASE/with space Ž" "$BASE/slash"
SUMMARY=()
FAILED=0
cd "$REPO" || exit 2
: > "$LOG"

step() { # step NAME CMD...
  local name="$1"; shift
  echo "== $name" | tee -a "$LOG"
  "$@" >> "$LOG" 2>&1
  local code=$?
  local counts
  counts="$(tail -n 40 "$LOG" | grep -E '^ℹ (pass|fail) ' | tr '\n' ' ')"
  SUMMARY+=("$name: exit $code ${counts}")
  [ "$code" -eq 0 ] || FAILED=1
}

step "npm ci" npm ci --ignore-scripts
step "build" npm run build
step "test TMPDIR=default" env -u TMPDIR npm test
step "test TMPDIR=space+unicode" env TMPDIR="$BASE/with space Ž" npm test
step "test TMPDIR=trailing slash" env TMPDIR="$BASE/slash/" npm test
step "test:install" npm run test:install

rm -rf "$BASE"
echo "== summary (full log: $LOG)"
printf '%s\n' "${SUMMARY[@]}"
[ "$FAILED" -eq 0 ] && echo "GATE GREEN" || echo "GATE RED"
exit "$FAILED"
