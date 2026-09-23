#!/usr/bin/env bash
# Is the MONOKL integration actually working?
#
# Answers the question in layers, because the two halves fail differently. The
# vault CLI needs no account and either runs or does not. The full pipeline
# needs Claude Code and an Anthropic plan, which is a separate thing to be
# missing, so a missing pipeline is reported as such rather than as a broken
# integration.
#
# usage: monokl_check.sh [VAULT_ROOT]
set -euo pipefail

VAULT="${1:-$HOME/Documents/monokl-vault}"
export PATH="$HOME/.local/bin:$PATH"
MOZAK="${MOZAK:-mozak}"

pass() { printf '  ok    %s\n' "$1"; }
fail() { printf '  FAIL  %s\n' "$1"; FAILED=1; }
note() { printf '  --    %s\n' "$1"; }
FAILED=0

echo "Layer 1: vault CLI (no account needed)"
if command -v monokl >/dev/null 2>&1; then
  pass "monokl $(monokl --version 2>&1 | head -1)"
else
  fail "monokl not on PATH; run: pipx install monokl"
fi

if [ -d "$VAULT/research" ]; then
  pass "vault at $VAULT"
else
  fail "no vault at $VAULT; run: monokl init $VAULT"
fi

if [ "$FAILED" = 0 ]; then
  notes="$(cd "$VAULT" && monokl status 2>/dev/null | grep -oP 'Total: \K[0-9,]+' | head -1)"
  pass "vault readable, ${notes:-0} notes"
fi

echo
echo "Layer 2: MOZAK adapter"
if "$MOZAK" adapter show agentic-systems-monokl >/dev/null 2>&1; then
  state="$("$MOZAK" adapter show agentic-systems-monokl 2>/dev/null \
    | python3 -c 'import json,sys; print(json.load(sys.stdin)["binding"]["state"])' 2>/dev/null || echo unknown)"
  if [ "$state" = "ready" ]; then
    pass "binding agentic-systems-monokl is $state"
  else
    fail "binding is $state; run: $MOZAK adapter recheck agentic-systems-monokl"
  fi
else
  fail "binding not registered; see docs/MONOKL.md"
fi

# The normalizer is what makes a vault snapshot MOZAK evidence. An installed
# release may predate it, which is a specific and fixable situation.
if "$MOZAK" adapter catalog 2>/dev/null | grep -q monokl; then
  pass "$MOZAK knows the monokl adapter"
else
  fail "$MOZAK build predates the adapter; set MOZAK=<repo>/target/release/mozak"
fi

echo
echo "Layer 3: full pipeline (needs Claude Code + an Anthropic plan)"
if command -v claude >/dev/null 2>&1; then
  pass "claude $(claude --version 2>&1 | head -1)"
  if [ -f "$HOME/.claude/.credentials.json" ] || [ -n "${ANTHROPIC_API_KEY:-}" ]; then
    pass "Anthropic credentials present"
  else
    note "no Anthropic credentials; run: claude  (then log in)"
  fi
  if [ -d "$VAULT/.claude/skills" ]; then
    pass "monokl skills installed in the vault project"
  else
    note "skills not installed here; run: cd $VAULT && monokl install"
  fi
else
  note "claude not installed; /monokl unavailable"
  note "the CLI path below still works without it"
fi

echo
echo "Optional keys (each unlocks one source; none are required)"
for pair in \
  "MONOKL_CONTACT_EMAIL:Unpaywall open-access recovery + polite pools" \
  "CORE_API_KEY:CORE full-text aggregator" \
  "FRED_API_KEY:Federal Reserve economic series"; do
  key="${pair%%:*}"; what="${pair#*:}"
  if [ -n "$(eval echo "\${$key:-}")" ]; then pass "$key set ($what)"; else note "$key unset ($what)"; fi
done

echo
if [ "$FAILED" = 0 ]; then
  echo "Integration is working. Record a snapshot with:"
  echo "  $MOZAK adapter run agentic-systems-monokl"
else
  echo "Integration has a failure above. Fix it, then re-run this check."
  exit 1
fi
