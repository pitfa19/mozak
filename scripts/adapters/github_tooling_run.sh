#!/usr/bin/env bash
# Discover or watch agentic tooling repositories for one Scope.
# Usage: github_tooling_run.sh REQUEST_JSON RUNS_DIR
set -euo pipefail

if [ $# -ne 2 ]; then
  echo "usage: github_tooling_run.sh REQUEST_JSON RUNS_DIR" >&2
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
python3 "$here/github_tooling_fetch.py" plan "$request"
python3 "$here/github_tooling_fetch.py" fetch "$request" "$run_dir"
"$mozak" research normalize github-tooling "$run_dir/fixture.json" "$run_dir/run.json"
python3 "$here/github_tooling_digest.py" "$run_dir/run.json" > "$run_dir/report.md"
if [ "${KEEP_RESPONSES:-0}" != "1" ]; then
  rm -rf "$run_dir/responses"
fi
printf 'run: %s\nreport: %s\n' "$run_dir/run.json" "$run_dir/report.md"
