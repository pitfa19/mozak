#!/usr/bin/env bash
# Install a HyperResearch vault for one MOZAK Scope family.
#
# A Scope already is the container for a family of related repositories:
# rinalmo2 holds RiNALMo and RiNALMo2, genome holds the MCP and its benchmark.
# Research belongs at that level rather than in any one repository, because a
# question about the family is rarely a question about one checkout.
#
# The vault deliberately lives outside both the Scope root and the project
# repositories. Fetching a source would otherwise change bytes that a Scope
# pins or that a project declares it owns, so every fetch would register as
# drift and the family would fail validation for doing its job.
#
# usage: hyperresearch_scope_install.sh SCOPE_ID [VAULT_PARENT]
set -euo pipefail

SCOPE_ID="${1:?usage: hyperresearch_scope_install.sh SCOPE_ID [VAULT_PARENT]}"
VAULT_PARENT="${2:-$HOME/Documents/research-vaults}"

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$HERE/../.." && pwd)"
MOZAK="${MOZAK:-mozak}"
export PATH="$HOME/.local/bin:$PATH"

if ! [[ "$SCOPE_ID" =~ ^[a-z0-9][a-z0-9-]*$ ]]; then
  echo "error: scope id must be lowercase-hyphenated: $SCOPE_ID" >&2
  exit 2
fi

command -v hyperresearch >/dev/null 2>&1 || {
  echo "error: hyperresearch not on PATH; run: pipx install hyperresearch" >&2
  exit 1
}

# The Scope must already be registered. Creating a vault for a Scope MOZAK does
# not know would leave an orphan directory that nothing validates.
if ! "$MOZAK" kb tree 2>/dev/null | grep -q "Scope: $SCOPE_ID "; then
  echo "error: $SCOPE_ID is not a registered Scope in the current KB" >&2
  echo "       inspect with: $MOZAK kb tree" >&2
  exit 1
fi

VAULT="$VAULT_PARENT/$SCOPE_ID"
REQUEST="$REPO/.mozak/adapters/requests/$SCOPE_ID-hyperresearch.json"
RUNS_DIR="$(dirname "$(dirname "$("$MOZAK" adapter list 2>/dev/null \
  | python3 -c 'import json,sys; b=json.load(sys.stdin)["bindings"]; print(b[0]["runs_dir"] if b else "")' \
  2>/dev/null)")")/runs/$SCOPE_ID-hyperresearch"
RUNS_DIR="${RUNS_DIR:-$HOME/Documents/mozak-kb/runs/$SCOPE_ID-hyperresearch}"
BINDING="$SCOPE_ID-hyperresearch"

echo "Scope:   $SCOPE_ID"
echo "Vault:   $VAULT"
echo "Request: $REQUEST"
echo "Runs:    $RUNS_DIR"
echo "Binding: $BINDING"
echo

if [ -d "$VAULT/research" ]; then
  echo "vault already initialized, reusing it"
else
  mkdir -p "$VAULT"
  hyperresearch init "$VAULT" --name "$SCOPE_ID research" --json >/dev/null
  echo "vault initialized"
fi

if [ -e "$REQUEST" ]; then
  echo "request already exists, leaving it unchanged"
else
  cat > "$REQUEST" <<JSON
{
  "schema_version": 1,
  "scope_id": "$SCOPE_ID",
  "vault_root": "$VAULT",
  "select": {
    "note_ids": [],
    "tags": []
  },
  "max_records": 100,
  "question": "Which sources has HyperResearch read into the $SCOPE_ID vault as candidate evidence for this Scope family?"
}
JSON
  echo "request written"
fi

mkdir -p "$RUNS_DIR"

if "$MOZAK" adapter show "$BINDING" >/dev/null 2>&1; then
  echo "binding already registered, rechecking its pins"
  "$MOZAK" adapter recheck "$BINDING" >/dev/null 2>&1 || true
else
  "$MOZAK" adapter setup hyperresearch "$BINDING" "$SCOPE_ID" \
    "$REQUEST" "$HERE/hyperresearch_run.sh" "$RUNS_DIR" >/dev/null
  echo "binding registered"
fi

echo
echo "Ready. Research into this Scope's vault, then record it:"
echo
echo "  cd $VAULT && claude        # then: /hyperresearch <question>"
echo "  # or, with no account needed:"
echo "  cd $VAULT && hyperresearch fetch <url> --json"
echo
echo "  MOZAK=$MOZAK \"\$MOZAK\" adapter run $BINDING"
echo
echo "Evidence stays proposal-only until you accept an input."
