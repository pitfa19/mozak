#!/usr/bin/env bash
# Recurring MCP registry tooling catchup for one Topic, Project, or Scope.
# Usage: mcp_registry_weekly.sh REQUEST_JSON RUNS_DIR
set -euo pipefail

if [ $# -ne 2 ]; then
  echo "usage: mcp_registry_weekly.sh REQUEST_JSON RUNS_DIR" >&2
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
python3 "$here/mcp_registry_fetch.py" plan "$request"
python3 "$here/mcp_registry_fetch.py" fetch "$request" "$run_dir"
"$mozak" research normalize mcp-registry "$run_dir/fixture.json" "$run_dir/run.json"
python3 "$here/mcp_registry_digest.py" "$run_dir/run.json" > "$run_dir/digest.md"
if [ "${KEEP_RESPONSES:-0}" != "1" ]; then
  rm -rf "$run_dir/responses"
fi
printf 'run: %s\ndigest: %s\n' "$run_dir/run.json" "$run_dir/digest.md"
