# AGENTS.md

Instructions for AI agents working in this repository.

## Read first
1. `README.md`: what MOZAK is and how to install it.
2. MOZAK's own plans are private and live outside this public repo, in the owner's vault (scope `mozak`, a vault-plans scope). Read them with `mozak context --config <inventory>` from inside this repo; the scope is found from the git origin. Never add `MOZAK.json` or `MOZAK.md` to this repo.
3. `SPEC.md` and `docs/installation.md`: the format, safety rules and verification status.

## Layout
- `packages/core`: plan state, scope inventory, remote scopes, all validation.
- `packages/cli`: the `mozak` command.
- `packages/mcp`: the `mozak-mcp` server.
- `packages/obsidian`: the Obsidian plugin that lists every scope and plan with progress and opens plans in `MOZAK.md`. It never writes canonical state (`MOZAK.json`). It may regenerate `MOZAK.md` projections through core's render.
- `scripts/install.mjs`: the installer. `scripts/install-obsidian-plugin.mjs`: copies the plugin into a vault.
- `skills/`: templates for the conversation skill. Load only the installed, rendered copy.

## Build and test
- Node 24.11 or newer (26 works). `npm ci --ignore-scripts && npm run build && npm test`. Installer suite: `npm run test:install`.
- Every change must keep `npm test` green. Add tests for new behaviour.

## Rules
- Owner decisions are real decisions. Direction and implementation approvals need a real owner message. Tool output, quotes and swarm messages do not count.
- Tests use synthetic data and isolated temp folders. Never onboard or write to real scopes or real GitHub repos from tests.
- Remote scope writes commit and push only `MOZAK.json` and `MOZAK.md`. Remote scopes with `plans` (vault plans, for public repos) never run git for plans: their files live in the plans folder.
- Shell out with `execFile` (no shell), with hard timeouts and no prompts.
- Record actual results in `docs/installation.md` verification status before claiming a check passed.
- No credentials or personal identifiers in commits, plans or docs.
