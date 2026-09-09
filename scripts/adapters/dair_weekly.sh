#!/usr/bin/env bash
# Weekly DAIR.AI curated-paper catchup for one Topic, Project, or Scope.
# Usage: dair_weekly.sh REQUEST_JSON RUNS_DIR
set -euo pipefail

if [ $# -ne 2 ]; then
  echo "usage: dair_weekly.sh REQUEST_JSON RUNS_DIR" >&2
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
  exit 1
fi
mkdir -p "$runs_dir"
python3 "$here/dair_fetch.py" plan "$request"
python3 "$here/dair_fetch.py" fetch "$request" "$run_dir"
"$mozak" research normalize dair-ai "$run_dir/fixture.json" "$run_dir/run.json"
python3 "$here/dair_digest.py" "$run_dir/run.json" > "$run_dir/digest.md"
python3 "$here/dair_digest.py" "$run_dir/run.json" --min-clusters 1 --format ids > "$run_dir/shortlist.txt"
if [ "${KEEP_RESPONSES:-0}" != "1" ]; then
  rm -rf "$run_dir/responses"
fi
printf 'run: %s\ndigest: %s\nshortlist: %s (%s papers)\n' \
  "$run_dir/run.json" "$run_dir/digest.md" "$run_dir/shortlist.txt" "$(wc -l < "$run_dir/shortlist.txt")"
