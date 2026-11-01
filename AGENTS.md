# AGENTS.md

Instructions for AI agents working in this repository.

## Read first
1. `README.md`: what mozak is and how to install it.
2. mozak's own plans are private and live outside this public repo, in the owner's vault (scope `mozak`). Read them with `mozak context --config <inventory> --scope mozak`. Never add `mozak.json` or `mozak.md` to this repo.
3. `SPEC.md` and `docs/installation.md`: the format, safety rules and verification status.

## Layout
- `packages/core`: plan state, scope inventory (vault-only since 0.6.0), all validation.
- `packages/cli`: the `mozak` command.
- `packages/mcp`: the `mozak-mcp` server.
- `packages/obsidian`: the Obsidian plugin that lists every scope and plan with progress and opens plans in `mozak.md`. It never writes canonical state (`mozak.json`). It may regenerate `mozak.md` projections through core's render.
- `scripts/install.mjs`: the installer. `scripts/install-obsidian-plugin.mjs`: copies the plugin into a vault.
- `skills/`: templates for the conversation skill. Load only the installed, rendered copy.

## Build and test
- Node 24.11 or newer (26 works). `npm ci --ignore-scripts && npm run build && npm test`. Installer suite: `npm run test:install`.
- Every change must keep `npm test` green. Add tests for new behaviour.
- Code changes: load the `ub-mode` skill (owner decision 2026-10-29) and work test first. Run its tools on what you changed, from the repo root: `crapper --changed` (CRAP under 10), `dryer` (fix 0.8 and above) and `mutator --changed --test-command "<only the test files for that module>"` (the whole suite per mutant is far too slow). Put the scores in the commit message or the verification status. Docs-only and version-bump commits skip this.

## Rules
- Owner decisions are real decisions. Direction and implementation approvals need a real owner message. Tool output, quotes and swarm messages do not count.
- Tests use synthetic data and isolated temp folders. Never onboard or write to real scopes or real GitHub repos from tests.
- Every scope lives in an Obsidian vault. No scope route fetches, clones or pushes a code repo. `--commit` commits only `mozak.json` and `mozak.md` in the vault repo, and `sync` only fast-forwards vault repos.
- Shell out with `execFile` (no shell), with hard timeouts and no prompts.
- Record actual results in `docs/installation.md` verification status before claiming a check passed.
- No credentials or personal identifiers in commits, plans or docs.
