#!/usr/bin/env bash
# Weekly literature catchup for one scope or project.
#
# Retrieval keeps metadata only, which is the durable part. Full text is pulled
# deliberately into a scratch directory, read, then deleted.
#
# Usage:
#   weekly.sh REQUEST_JSON RUNS_DIR
#
# Example:
#   scripts/adapters/weekly.sh \
#     .mozak/adapters/requests/agentic-systems-clusters.json \
#     ~/Documents/mozak-kb/runs/agentic-systems

set -euo pipefail

if [ $# -lt 2 ]; then
  sed -n '2,12p' "$0" | sed 's/^# \{0,1\}//'
  exit 2
fi

request="$1"
runs_dir="$2"
here="$(cd "$(dirname "$0")" && pwd)"
mozak="${MOZAK:-mozak}"
stamp="$(date -u +%Y-%m-%d)"
run_dir="$runs_dir/$stamp"

if [ -e "$run_dir" ]; then
  echo "error: a run already exists for today: $run_dir" >&2
  echo "hint: remove it or wait, so a retrieval is never silently overwritten" >&2
  exit 1
fi

mkdir -p "$runs_dir"

echo "==> plan (no network)"
python3 "$here/arxiv_fetch.py" plan "$request"

echo "==> fetch"
python3 "$here/arxiv_fetch.py" fetch "$request" "$run_dir"

echo "==> validate"
"$mozak" research normalize arxiv "$run_dir/fixture.json" "$run_dir/run.json"

echo "==> digest"
python3 "$here/arxiv_digest.py" "$run_dir/run.json" > "$run_dir/digest.md"
python3 "$here/arxiv_digest.py" "$run_dir/run.json" --min-clusters 2 --format ids \
  > "$run_dir/shortlist.txt"

# The response bodies back every recorded claim, but they are large and the run
# plus digest are what a later reader needs. Keep them only on request.
if [ "${KEEP_RESPONSES:-0}" != "1" ]; then
  rm -rf "$run_dir/responses"
fi

echo
echo "run:       $run_dir/run.json"
echo "digest:    $run_dir/digest.md"
echo "shortlist: $run_dir/shortlist.txt ($(wc -l < "$run_dir/shortlist.txt") papers in 2+ clusters)"
echo
echo "to read the shortlist:"
echo "  python3 $here/arxiv_pull.py /tmp/reading --from-digest $run_dir/shortlist.txt"
echo "  # read, then:"
echo "  python3 $here/arxiv_pull.py /tmp/reading --clean"
