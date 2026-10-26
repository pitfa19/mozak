# Changelog

User-visible changes, newest first. Releases are git tags `vX.Y.Z` on `main`; `mozak upgrade` installs the newest one.

## Unreleased

### Fixed
- Tests no longer read the developer's global git config: `npm test` and `npm run test:install` preload `scripts/test-git-isolation.mjs` (private `GIT_CONFIG_GLOBAL`). A global `core.hooksPath` pre-push guard made 20 remote and vault tests fail.

### Changed
- Skill: when the owner asks to complete or finish a plan, record evidence and in the same reply ask for the outstanding outcome acceptances, saying the plan stays at 0 of N until they are accepted.

### Added
- `--commit` on every write route: commits the scope's mozak.json and mozak.md in the containing git repo, then `pull --rebase` and push when there is an upstream. Never forces, stops on conflict (exit 5). Local write output now says "written ... not committed to git" instead of a bare "(committed)".
- `examples/save-discussion.json`, and the save-discussion payload and `executionEligible` explained in `references/payloads.md`.

- Flag forms, so agents need no request file for owner decisions, deletes or evidence:
  - `mozak review decide --scope ID --plan PLAN --purpose P [--outcome O] [--spec SPEC] --owner-ref REF --owner-message-at ISO --reason TEXT [--dry-run]` reads the fresh review subject and snapshot, builds the request with a new operationId and submits as owner. On stale-input it retries once only when the subject is unchanged, else `subject-changed`. Owner provenance stays explicit.
  - `mozak plan delete --scope ID --plans a,b --owner-ref REF --owner-message-at ISO --reason TEXT [--allow-completed] [--dry-run]`.
  - `mozak observe --scope ID --plan PLAN --summary TEXT --locator WHERE [--outcome O] [--verdict pass|fail|not-assessed] [--activity TEXT] ...` builds one observation with evidence and an outcome link, up to 3 attempts on stale-input. `observe --payload FILE` takes the `payload` of `examples/observe.json` with the same retries (replaces the hand-installed `mozak-observe` script).
  - The `--request FILE` forms keep working and cannot be mixed with the flags. Human summary by default, `--json` for the full envelope.
- `mozak plan show --plan PLAN` (and the `mozak_plan_show` MCP tool): one plan in about 1 KB with lifecycle, executionEligible and reasons, authorizations, outcomes with evidence and acceptance state, spec path and next action.
- Warnings: `plan revise` and `review decide` return `warnings` with the exact next command when accepted outcomes need re-linking and owner re-acceptance after a revision, and when a direction approval leaves implementation approval still needed ("this message covers 1 approval").
- `mozak-mcp --owner-decisions` adds a `mozak_decide` tool with the same safety rules as the CLI flag form. Without the flag the MCP surface stays agent-only.
- `context --brief` and `context --plan` (from `hermes/context-brief`), with a bounded brief that lists actionable plans first and counts omitted ones (from `hermes/brief-budget`).
- `mozak plan delete` (owner only): removes named plans from a scope so they no longer exist in `mozak.json` or `mozak.md`. Snapshot-checked and replay-safe like every write. The receipt `{ action: "delete-plans", ids }` is kept as the record, and a deleted id cannot be proposed again. Completed plans need `allowCompleted: true`. Plans still referenced by another plan (a pending merge, a reasoning link) are refused until both are deleted together or merged.

## 0.4.5 (2026-10-22)

### Added

- Official MCP Registry metadata: `server.json` (name `io.github.pitfa19/mozak`) and the matching `mcpName` field in the npm package, so mozak can be listed in the registry that MCP clients search.
- `mozak-mcp` accepts `--config=FILE` as well as `--config FILE`, the form MCP registries pass. Duplicates across both forms are still refused.
- README: one-line setup for Claude Code and Codex. Claude Code was checked calling the MCP server from the npm package.

### Fixed

- The CLI, `doctor`, `upgrade` and the plugin installer find a vault's config folder even when it was renamed, instead of assuming the default name. This clears the Obsidian directory scan's `hardcoded-config-path` warnings (0 findings now).
- The plugin build is byte-reproducible (`absWorkingDir`, `legalComments`), so a clean build from the tag matches the released `main.js`.

## 0.4.4 (2026-10-21)

### Fixed

- Obsidian directory review: the source scan reported hundreds of "unsafe any" warnings because its TypeScript 6 tooling did not load Node's type definitions. `tsconfig.base.json` now declares `"types": ["node"]`. No code change: the plugin bundle and the CLI behave exactly as in 0.4.3.

## 0.4.3 (2026-10-21)

### Changed

- README: full-width hero banner, and the headline "Use Obsidian as your IDE" is replaced by "One approved plan per project, shared by your coding agents, visible in Obsidian." The Obsidian plugin is a read-only view, so the old line overclaimed.
- npm package: README image and file links point to GitHub, so they work on npmjs.com.

## 0.4.2 (2026-10-21)

### Added

- npm package `mozak` (`npm install -g mozak`): one bundled CLI and MCP server, no dependencies, no install scripts. Built with `npm run build:npm` into `npm-package/`. `mozak upgrade` tells npm users to run `npm install -g mozak@latest`, the update notice shows that command, and `mozak doctor --fix` renders the skill for the npm install and links it into the agent skills folders.

### Changed

- README: claims checked against code and tests. Overstated lines rewritten, a "What is tested and what is not" section added (including the small pilot that found no measured agent benefit yet), and the plugin's git sync disclosure now says it can commit and push a pending plan change left by an earlier failed write. SPEC.md is marked historical.
- README previews re-encoded at 1280 px, full width, without the grey blocks in white areas.

## 0.4.1 (2026-10-21)

### Changed

- Obsidian review fixes: plugin settings use the declarative settings API, so they appear in Obsidian's settings search. Plugin timers use `window.setTimeout` for popout windows. Electron is imported instead of required.
- Release workflow attests build provenance for `main.js`, `manifest.json` and `styles.css` (`gh attestation verify`).
- Lint cleanup across core, CLI and MCP: unused code and no-op type assertions removed, `JSON.parse` results typed. No behaviour change.

## 0.4.0 (2026-10-21)

### Changed

- The Obsidian plugin conservatively requires Obsidian 1.14.4, the owner's current used version. Compatibility with older app runtimes is not claimed from type checks alone.
- Plugin releases use exact-version tags (`0.4.0`) as Obsidian requires, alongside the CLI updater's `v0.4.0` tag at the same commit.
- The plugin bundle excludes the CLI's unused background release-check process. Plugin network and update-cache disclosures now match the shipped code.
- The name is written `mozak` everywhere: the Obsidian sidebar title, plugin name, messages, CLI help and docs.
- Plan files are now `mozak.json` and `mozak.md`. Older scopes with `MOZAK.json` and `MOZAK.md` keep working unchanged: reads accept both names and writes keep the scope's existing names. New scopes get the lowercase names.

### Added

- Final 76 second demo video and the logo at the top of the README.
- `mozak scope retitle --scope ID --request FILE` (owner): change a scope's display title. Plans and approvals are untouched.
- `mozak rename-files (--scope ID | --all)` (owner): renames a scope's old `MOZAK.*` files to lowercase under the scope lock and regenerates the note so its link points to `mozak.json`. Plan bytes are unchanged. Refuses notes with hand edits. Repo scopes are skipped.

## 0.3.0 (2026-10-19)

### Added

- Duplicate-plan guard and post-hoc plan merging: `mozak plan propose` refuses proposals whose title or outcome statements overlap an existing open, awaiting or paused plan in the same scope (`duplicate-plan-candidate`, exit 3) unless `distinctFromPlanIds` names each reviewed plan after the owner confirms it is separate work. `mozak plan revise` accepts `mergeFromPlanId` to fold an overlapping plan into an existing plan on `approve-direction` (moving its observations, reasoning links and discussion questions and removing the duplicate).
- Obsidian community plugin publication readiness: root `manifest.json`, explicit outside-vault and `git` network disclosures in `README.md` and `packages/obsidian/README.md`, automated submission checklist test, and `.github/workflows/release.yml` attaching `main.js`, `manifest.json` and `styles.css` to GitHub Releases on `v*.*.*` tags.
- Under-the-hood vector diagram animation (`docs/assets/under-the-hood.svg`) and clean demo vault generator (`scripts/setup-demo-vault.mjs`).

### Fixed

- `mozak doctor` checks `mozak-mcp` with a real handshake (0.2.0 reported a false "did not answer" note) and fails the installation check when it does not answer.
- The MCP server reports its real version in the handshake instead of `0.0.0`.
- `mozak doctor` on a fresh setup: an MCP setting that names the standard `~/.local/bin/mozak-mcp` wrapper before it exists now points at `mozak doctor --fix` instead of asking you to edit the setting, its inventory is checked in the same run, and scopes without `MOZAK.json` get a "pull your notes or run scope init" hint.

## 0.2.0 (2026-10-19)

First tagged release.

### Added

- `mozak upgrade` moves an installation to the newest tagged release. It builds the tag from the checkout the installation came from, keeps the old installation as `PREFIX.previous-<version>`, puts it back if anything fails, and with `--vault PATH` updates the Obsidian plugin in that vault. `--check` only reports.
- `mozak doctor` checks Node, the installation, `PATH`, agent skill links, MCP config, the inventory and the Obsidian plugin, and prints the exact fix for each problem. `--fix` makes skill links and `~/.local/bin` wrappers and refreshes outdated plugin copies. It never edits MCP config, the inventory or plans.
- `mozak --version`. `--help` shows the version on its first line.
- Update notice: `mozak scopes` and the Obsidian sidebar mention a newer release. The check reads GitHub's public tag list at most once a day, in the background, and `MOZAK_NO_UPDATE_CHECK=1` turns it off.
- Plans for public repos can live in a private vault folder (`"plans": "<folder>"` on a remote inventory entry), and writes to plans inside a public repo are refused.
- Read commands run inside a clone of an inventoried repo find their scope from the git origin, so `--scope` can be left out.
- Obsidian sidebar: roadmap, plan navigation into `MOZAK.md`, public or private badge on repo scopes.

### Changed

- Plan writes are crash safe: each file is flushed to disk before it replaces the old one, and the folder is flushed after. A crash leaves the old or the new state, never a broken file. `check` reports leftover temp files, and the next write removes them.
- `installation.json` records the source checkout (`source`), used by `mozak upgrade`.

## 0.1.0

Initial local release: scopes, plans, owner approvals, evidence, the CLI, the MCP server, the agent skill and the Obsidian plugin.
