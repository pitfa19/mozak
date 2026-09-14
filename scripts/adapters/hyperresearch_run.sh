#!/usr/bin/env bash
# Record one HyperResearch vault snapshot as MOZAK research evidence.
#
# HyperResearch executes the research itself, driven by Claude Code. This
# runner reads the vault it left behind, normalizes the snapshot, and writes a
# dated run directory. It never promotes anything: the output is proposal-only
# evidence until the owner accepts an input.
#
# usage: hyperresearch_run.sh REQUEST_JSON RUNS_DIR
set -euo pipefail

REQUEST="${1:?usage: hyperresearch_run.sh REQUEST_JSON RUNS_DIR}"
RUNS_DIR="${2:?usage: hyperresearch_run.sh REQUEST_JSON RUNS_DIR}"

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ADAPTER="$HERE/hyperresearch_fetch.py"

# The installed launcher runs a released build, which may predate a locally
# added adapter. MOZAK lets a caller point at the build that has it.
MOZAK="${MOZAK:-mozak}"

# pipx installs the CLI here, and a non-login shell may not have it on PATH.
export PATH="$HOME/.local/bin:$PATH"

DAY="$(date -u +%Y-%m-%d)"
OUT="$RUNS_DIR/$DAY"

# A run is an immutable observation. Refusing an existing directory is what
# keeps a re-run from quietly replacing the evidence an earlier one recorded.
if [ -e "$OUT" ]; then
  echo "error: a run already exists for today: $OUT" >&2
  exit 1
fi

mkdir -p "$RUNS_DIR"

python3 "$ADAPTER" plan "$REQUEST"
python3 "$ADAPTER" fetch "$REQUEST" "$OUT"
"$MOZAK" research normalize hyperresearch "$OUT/fixture.json" "$OUT/run.json"
python3 "$HERE/hyperresearch_digest.py" "$OUT/run.json" > "$OUT/report.md"

# The pinned export is large and already hashed into the run. Keeping it is
# opt-in so a vault snapshot does not accumulate a second copy of the vault.
if [ "${KEEP_RESPONSES:-0}" != "1" ]; then
  rm -rf "$OUT/responses"
fi

printf 'run: %s\nreport: %s\n' "$OUT/run.json" "$OUT/report.md"
echo "authority: proposal_only; accepting an input remains an owner decision"
