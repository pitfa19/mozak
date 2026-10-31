#!/bin/sh
# Old-client check on a synthetic temp scope: the installed mozak CLI (released code, no annotations support)
# reads and writes a scope that has a mozak.annotations.json made by this branch. Never touches a real inventory.
set -eu
NEW="$(cd "$(dirname "$0")/.." && pwd)/packages/cli/dist/index.js"
OLD="${OLD_CLI:-$HOME/.local/share/mozak-next/node_modules/@mozak/cli/dist/index.js}"
BASE="$(mktemp -d "${TMPDIR:-/tmp}/mozak-s4-old-client.XXXXXX")"
trap 'rm -rf "$BASE"' EXIT
mkdir -p "$BASE/alpha"; printf 'Synthetic\n' > "$BASE/alpha/README.md"; printf 'Synthetic\n' > "$BASE/alpha/AGENTS.md"
printf '{"format":"mozak.local/v3","scopes":[{"id":"alpha","root":"./alpha"}]}' > "$BASE/inv.json"
NOW=2026-10-21T08:00:00.000Z
printf '{"operationId":"init","scopeId":"alpha","kind":"project","title":"Synthetic","expectedAbsent":{"graph":true,"bridge":true},"ownerRef":"synthetic","ownerMessageAt":"%s"}' "$NOW" > "$BASE/init.json"
node "$NEW" scope init --config "$BASE/inv.json" --scope alpha --request "$BASE/init.json" > /dev/null
snap() { node "$1" context --config "$BASE/inv.json" --scope alpha --json | jq -c .snapshot; }
propose() { # $1 cli, $2 plan id
  printf '{"operationId":"p-%s","scopeId":"alpha","expected":%s,"action":"propose","payload":{"planId":"%s","content":{"constraints":[],"nonGoals":[],"outcomes":[{"acceptance":"objective","criterion":"c","id":"o","statement":"s"}],"purpose":"p","questions":[],"rationale":"r","sources":[],"title":"Synthetic %s"}}}' "$2" "$(snap "$1")" "$2" "$2" > "$BASE/p.json"
  node "$1" plan propose --config "$BASE/inv.json" --scope alpha --request "$BASE/p.json" > "$BASE/p.out"; echo "propose $2 via $3: exit 0"
}
propose "$NEW" a branch; propose "$NEW" b branch
printf '{"operationId":"annot-1","scopeId":"alpha","expectedAnnotations":{"exists":false,"sha256":null},"ownerRef":"synthetic","ownerMessageAt":"%s","items":[{"kind":"ref","planId":"b","target":"alpha/a","relation":"needs","evidence":"b needs a"}]}' "$NOW" > "$BASE/a.json"
node "$NEW" annotate --config "$BASE/inv.json" --scope alpha --request "$BASE/a.json" > /dev/null && echo "annotate via branch: exit 0"
SIDE="$(shasum -a 256 "$BASE/alpha/mozak.annotations.json" | cut -d' ' -f1)"
echo "old cli version: $(node "$OLD" --version)"
for r in "context --scope alpha --json" "plans --scope alpha --json" "check --scope alpha --json"; do
  set +e; node "$OLD" $r --config "$BASE/inv.json" > /dev/null; code=$?; set -e
  echo "old $r: exit $code"
done
propose "$OLD" c old-cli
set +e; node "$OLD" check --config "$BASE/inv.json" --scope alpha --json > /dev/null; echo "old check after old write: exit $?"; set -e
[ "$SIDE" = "$(shasum -a 256 "$BASE/alpha/mozak.annotations.json" | cut -d' ' -f1)" ] && echo "sidecar unchanged by old client"
set +e; node "$NEW" check --config "$BASE/inv.json" --scope alpha --json > /dev/null; echo "branch check after old write: exit $?"; set -e
node "$NEW" graph --config "$BASE/inv.json" --scope alpha --json | jq -c "{edges: .graph.counts.edges, dangling: .graph.counts.dangling, nodes: .graph.counts.nodes}"
