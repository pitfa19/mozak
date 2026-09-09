#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

cargo fmt --all -- --check
cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace
cargo build --release --workspace

BIN="$ROOT/target/release/mozak"
FIXTURES="$ROOT/spec/m0/fixtures/canonical-state.json"

"$BIN" validate "$FIXTURES"
REPLAY_OUTPUT="$(mktemp)"
trap 'rm -f "$REPLAY_OUTPUT"' EXIT
"$BIN" replay "$FIXTURES" > "$REPLAY_OUTPUT"

python3 - "$REPLAY_OUTPUT" "$FIXTURES" <<'PY'
import json
import sys

actual = json.load(open(sys.argv[1]))
fixtures = json.load(open(sys.argv[2]))
assert len(actual) == len(fixtures) == 12
expected = {fixture["id"]: fixture["expected"]["canonical_hash"] for fixture in fixtures}
observed = {item["id"]: item["canonical_hash"] for item in actual}
assert observed == expected
assert all(item["projection"] == next(f["expected"]["projection"] for f in fixtures if f["id"] == item["id"]) for item in actual)
print("ok: release CLI reproduced all 12 expected projections and hashes")
PY

if "$BIN" >/dev/null 2>&1; then
  echo "error: CLI accepted missing command" >&2
  exit 1
fi

INVALID_JSON="$(mktemp)"
trap 'rm -f "$REPLAY_OUTPUT" "$INVALID_JSON"' EXIT
printf '{not-json}\n' > "$INVALID_JSON"
if "$BIN" validate "$INVALID_JSON" >/dev/null 2>&1; then
  echo "error: CLI accepted invalid JSON" >&2
  exit 1
fi
echo "ok: release CLI rejects missing commands and invalid JSON"

python3 scripts/verify_m0_requirements.py
echo "Phase 1 first-slice verification passed"
