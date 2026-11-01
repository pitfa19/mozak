# Changelog

User-visible changes, newest first. Releases are git tags `vX.Y.Z` on `main`; `mozak upgrade` installs the newest one.

## Unreleased

## 0.6.0 (not yet tagged)

**Breaking: mozak is vault-only.** Plans live only in Obsidian vault folders. GitHub repo scopes are gone. Move every pre-0.6 entry with `mozak scope move` before you rely on 0.6.0, see [Moving to 0.6.0](docs/installation.md#moving-to-060). The moves write only `root` entries, so 0.5.0 keeps reading the migrated inventory as long as it has no `repo` keys.

### Added
- **`mozak scope move --scope ID (--to PATH [--repo SPEC] | --drop)`** (owner). Copies the scope's `mozak.json`, `mozak.md`, annotations sidecar, `README.md` and `AGENTS.md` into a vault folder, checks every copy byte for byte, then rewrites only that inventory entry to `{ "id", "root" }` under the inventory lock, with the same validated atomic write as `focus`. It reads a local folder, a vault-plans folder, a `mozak pull` clone or the `.mozak-cache` copy. It refuses a target outside a vault or one that already holds mozak files, a source that fails `check`, and an inventory that changed since it was read. A failure leaves the old files and the old inventory valid. The old files stay. `--dry-run` writes nothing. `--drop` removes a 0-plan entry. Attached spec files are listed as `spec-not-moved` warnings.
- **Display-only repo link.** An entry may carry `repo` (`github:owner/repo` or an https URL). `mozak scopes` prints it and the sidebar shows a link icon on the scope row. mozak never fetches it, and the inventory digest ignores it. `mozak scope link --scope ID (--repo SPEC | --clear)` (owner) sets it, and `scope move --repo` sets it while moving. mozak before 0.6.0 refuses an inventory with `repo`.
- **Vault rule.** Every scope root must have a folder holding `.obsidian` at or above it. A root outside a vault is a failed scope (`scope-outside-vault`) that names `mozak scope move`, and `mozak doctor` reports it. Other scopes keep working.

### Removed
- Repo scopes: inventory entries with `remote`, `ref` or `plans` are listed as failed scopes (`legacy-repo-scope`) with the exact `scope move` command, never a whole-inventory error. Every route refuses them, and nothing fetches or clones for them.
- `mozak pull`, the remote part of `mozak sync`, the MCP tool `mozak_sync`, the `.mozak-cache` sparse clones, repo-mode commit and push, the GitHub visibility check and `public-repo-plans`.
- Finding a scope from the current clone's git origin. `context`, `check`, `review show` and `plan show` need `--scope`. `plans` with neither `--scope` nor `--all` lists every scope.
- Obsidian plugin: the Repos group, stale and visibility badges, and the **Repo sync interval** setting with its background polling. The sync button is now **Sync vaults** and only fast-forwards vault repositories, on click.

### Changed
- `mozak sync` fast-forwards every vault repository that holds a scope (the same as `--local`, which is still accepted). It never pushes.
- Tests run in temp vaults (a `.obsidian` folder at the temp root).

## 0.5.0 (2026-11-01)

0.5.0 includes the fixes prepared as 0.4.8, which was never tagged.

**Upgrade every machine before you star a plan.** mozak before 0.5.0 refuses an inventory that has a `focus` list (`unknown key "focus"`).

### Added
- **Focus tab.** The Obsidian sidebar tabs are Open, Focus and Done; the All tab is gone and rejected plans show in no tab (`mozak plans --include-rejected` still lists them). A star on every plan row adds the plan to the scope's `focus` list in `mozak-inventory.json` or takes it out. The sidebar opens on Focus when it has plans, else Open, and remembers the last tab. `mozak focus list [--scope ID]` reads the lists, `mozak focus add|remove --scope ID --plan ID` (owner) changes them, and MCP has a read-only `mozak_focus`. Focus is a sidebar marker only: it is not plan state, `mozak.json` and `mozak.md` never change, and agents cannot write it. A starred id that is no longer a plan is a `check` warning (`focus-unknown-plan`). See [docs/installation.md](docs/installation.md#6a-focus-list).
- **Owner annotations, off by default.** Cross-plan refs (needs, informs, supersedes) and deadlines in a `mozak.annotations.json` sidecar, written only through the owner route `mozak annotate`, read by `mozak graph`, `mozak ready`, `mozak plans --sort deadline` (MCP `mozak_plan_graph`, `mozak_ready`) and the sidebar. Turn them on per scope with `scopes.<id>.annotations: true` in the `mozak-settings.json` next to the inventory. A scope without it behaves like 0.4.7: the sidecar is never read and `mozak.md` does not change. See [docs/annotations.md](docs/annotations.md).
- **Plans index, locators and similar plans.** `mozak plans-md` (owner) writes a `plans.md` with plan titles and states at each notes repo root. `mozak locators` shows where each source and evidence locator points. `check` lists cited notes that changed after they were cited. `mozak similar` (MCP `mozak_similar`) reports duplicate, overlapping and superseding plans across scopes. See [docs/plans-index.md](docs/plans-index.md).
- **Store hygiene.** The lock owner record names its host, and the owner route `mozak recover` clears a write lock left by another host or a dead local process (`check` reports `write-lock-stuck`). `mozak plan prune --rejected` (owner) removes listed rejected plans; refs to them resolve as pruned and the id cannot be proposed again. `mozak check --history N` reports hand edits to `mozak.json`. `mozak sync --local` fast-forwards git repos that hold local scopes, under the scope locks, and never pushes; the sidebar sync button does the same.
- **Experimental read-set rebase, off by default.** With `concurrency.rebase: true` in `mozak-settings.json` (top level or per scope), a stale `observe`, `save-discussion` or new-id `propose` commits onto the fresh state when nothing it read has changed. Decisions, `revise`, `complete` and `attach-spec` keep the exact snapshot check.
- **Counts-only usage log, opt-in.** With `MOZAK_USAGE_LOG=on` or `"usageLog": true` in `mozak-settings.json`, each call appends one line of counts and codes (never plan text) to `.mozak-cache/usage/` next to the inventory. Off by default.
- `npm run typecheck`, `npm run lint` (typecheck plus a relative-link check, also run in CI) and `npm run loc`. `scripts/readme-example.mjs` reproduces the README example on a throwaway scope.

### Fixed
- `propose` refuses an exact copy of a non-completed plan as `duplicate-plan-candidate` even when the plan ids carry different numbers.
- A merge whose combined discussion would exceed 32 questions is refused as `merge-capacity` at propose and at approval, instead of silently cutting questions.
- Writes hash `mozak.json` and `mozak.md` again right before each rename and stop with `graph-changed-during-write` when another editor changed them (also for `plan delete`). It narrows the race with editors that ignore the write lock, it does not close it.
- `init` and projection repair add ignore lines for the write lock and temp files, and `check` reports `lock-not-ignored` and `lock-in-git`.
- A late supporting observation no longer drops an owner-accepted outcome from `done` to `evidence`. Only a new challenge reopens it. `plan complete` still needs an owner acceptance bound to the exact current evidence.
- A `mozak.md` that differs only by CRLF line endings or trailing whitespace counts as current.
- The Obsidian plugin opens plans inside a vault that was opened through a symlink.
- The test suite passes with the default macOS `TMPDIR` and with `TMPDIR=/tmp`.

### Changed
- Removed the unused format-1 modules from `@mozak/core` (`parse`, `check`, `graph`, `stale`, `translate`, `init`, `write`, `plan`) and their exports. No CLI, MCP or plugin route used them, and format-1 routes still refuse with `unsupported-legacy-operation`. See [docs/audit-2026-10.md](docs/audit-2026-10.md).
- Common error messages end with the next step (`stale-input`, `scope-not-found`, `plan-not-found`, `operation-conflict`, `busy` and others). Codes and exit codes are unchanged.
- A failed MCP tool call starts with a one-line `reason` and the `issues`, before the rest of the result.
- Local and vault-plans scope reads never fetch. Remote reads mark `remoteFreshness` and skip the network for 10 minutes after a failed fetch.
- An inventory may carry a reserved `x` object at the top or in a scope entry. This client ignores it and `check` reports `inventory-x-ignored`.
- The compiler runs with `noUnusedLocals`, `noUnusedParameters`, `noImplicitReturns`, `noFallthroughCasesInSwitch` and `noImplicitOverride`.

### Docs
- README rewritten around the problem mozak solves, with a real example and the install line. New section "Reads and the network".
- The plugin README and disclosures say what the plugin writes: a stale `mozak.md` it regenerates, and the `focus` lists through the star. It never writes plan state.
- The installed skill no longer names one host's scheduler, and its examples say "the owner".

## 0.4.7 (2026-10-29)

### Changed
- `mozak spec attach`: `discussionDigest` is optional. When omitted, Core computes it from the plan's current discussion. A supplied digest is still validated, and a stale one is still refused. The skill's payload reference says so and points to `context --plan PLAN --json`.
- `mozak observe`: an invalid `--activity-kind`, `--relation`, `--classification` or `--verdict` error names the value and lists the allowed values.

### Fixed
- Pending summaries list changed fields in a deterministic order, and repair recognises the older field order (see docs/installation.md).

## 0.4.6 (2026-10-28)

### Internal
- The Obsidian sidebar now uses core's plan display state, so mozak.md and the sidebar can no longer disagree on whether a plan is open, paused, awaiting, completed or rejected.
- One shared nonempty-string check in core replaces five copies. Error codes and messages are unchanged.
- New tests pin parse warning line numbers (LF and CRLF), frontmatter checks, review stale-reference messages and continuation tokens with an empty field. Mutation score for `parse.ts` went from 55% to 78%.

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
