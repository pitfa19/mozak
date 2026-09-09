#!/usr/bin/env bash
# Verify the committed diagrams, and verify that their gate is load-bearing.
#
# Two claims, checked separately. First, each committed source passes archify's
# showcase gate and reproduces its committed HTML byte for byte. Second, the
# gate refuses injected defects, because a gate that accepts a broken diagram
# proves nothing about the ones it accepted.
#
# Usage: scripts/check-diagrams.sh [ARCHIFY_DIR]
set -euo pipefail

archify="${1:-$HOME/.claude/skills/archify}"
cli="$archify/bin/archify.mjs"
here="$(cd "$(dirname "$0")/.." && pwd)"
diagrams="$here/docs/diagrams"

if [ ! -f "$cli" ]; then
  echo "skip: archify not installed at $archify" >&2
  echo "      install with: npx skills add tt-a1i/archify -g" >&2
  exit 0
fi

fail=0

echo "== committed sources pass the showcase gate"
while read -r kind source artifact; do
  if node "$cli" validate "$kind" "$diagrams/$source" --quality showcase --json \
       | python3 -c 'import json,sys; sys.exit(0 if json.load(sys.stdin).get("ok") else 1)'; then
    echo "  ok      $source"
  else
    echo "  FAILED  $source"; fail=1
  fi
done <<'LIST'
architecture mozak-modules.architecture.json mozak-modules.html
workflow mozak-improve-lab.workflow.json mozak-improve-lab.html
dataflow mozak-kb-and-meta.dataflow.json mozak-kb-and-meta.html
LIST

echo "== delivery reproduces the committed artifact byte for byte"
scratch="$(mktemp -d)"
trap 'rm -rf "$scratch"' EXIT
while read -r kind source artifact; do
  node "$cli" deliver "$kind" "$diagrams/$source" "$scratch/$artifact" \
    --quality showcase --json >/dev/null
  if cmp -s "$scratch/$artifact" "$diagrams/$artifact"; then
    echo "  ok      $artifact"
  else
    echo "  FAILED  $artifact differs from a fresh delivery"; fail=1
  fi
done <<'LIST'
architecture mozak-modules.architecture.json mozak-modules.html
workflow mozak-improve-lab.workflow.json mozak-improve-lab.html
dataflow mozak-kb-and-meta.dataflow.json mozak-kb-and-meta.html
LIST

echo "== motion is present exactly where it was authored"
python3 "$here/scripts/diagram_motion.py" "$diagrams" || fail=1

echo "== the gate refuses injected defects"
python3 "$here/scripts/diagram_mutations.py" "$cli" "$diagrams" || fail=1

if [ "$fail" -ne 0 ]; then
  echo "diagram checks failed" >&2
  exit 1
fi
echo "all diagram checks passed"
