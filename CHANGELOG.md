# Changelog

User-visible changes, newest first. Releases are git tags `vX.Y.Z` on `main`; `mozak upgrade` installs the newest one.

## 0.5.0 (unreleased)

Not tagged. The version in `package.json`, the package manifests and both plugin manifests is still 0.4.5. Bump it only in an owner-authorized release commit. These additions are unreleased.

### Added

- Bounded context reads. `mozak context --brief` returns one short, body-free summary per plan. `mozak context --plan ID` returns the full state of one plan, and an unknown ID is refused (`plan-not-found`) instead of falling back to all plans. MCP `mozak_context` takes the same `brief` and `plan` options. Every form keeps the whole-scope `snapshot`.
- Owner annotations in a `mozak.annotations.json` sidecar next to `mozak.json`: cross-plan refs (needs, informs, supersedes) and deadlines, written only through the owner route `mozak annotate`. New reads `mozak graph` and `mozak ready` (MCP `mozak_plan_graph` and `mozak_ready`), and `mozak plans --sort deadline`. `check` reports refs that do not resolve. `mozak.md` does not change because of the sidecar, and older clients leave it alone. The Obsidian sidebar shows refs under each plan. See [docs/annotations.md](docs/annotations.md).
- Experimental read-set rebase for parallel agents, off by default. With `concurrency.rebase: true` in the `mozak-settings.json` next to the inventory (per scope under `scopes.<id>.concurrency`, or top level for every scope), a stale `observe`, `save-discussion` or new-id `propose` commits onto the fresh state when nothing it read has changed, and the result reports `rebased: { from, onto }`. Decisions, `revise`, `complete` and `attach-spec` keep the exact snapshot check.
- Write-lock hygiene. `scope init` and an explicit `projection repair` add ignore lines for `.mozak-write-lock/` and the write temp files to the scope's `.gitignore`. `check` reports `lock-not-ignored` and `lock-in-git`.
- The inventory reserves an `x` key, on the inventory and on each entry, for extensions. It must be an object. mozak ignores its content.
- `scripts/check-links.mjs` checks every relative link and heading anchor in the repo's Markdown. `npm test` runs it.
- `scripts/readme-example.mjs` reproduces the README example on a throwaway scope.
- `docs/README.md` lists every doc and marks which ones are historical.
- `versions.json` at the repo root maps the plugin version to its lowest Obsidian version.
- Store hygiene. The lock owner record names its host. The owner route `mozak recover` clears a write lock left by another host or by a dead local process, and `check` reports a stuck lock (`write-lock-stuck`).
- `mozak plan prune --rejected` (owner) removes listed rejected plans. Its receipt is the prune record: refs to a pruned plan resolve as pruned, and the id cannot be proposed again.
- `mozak check --history N` reports commits in the last N where `mozak.json` changed without a new storage revision (hand edits).
- `mozak sync --local` and `sync --scope` for local scopes in a git repo: fetch outside the locks, then fast-forward only under the scope locks. It never pushes.
- A counts-only usage log in `.mozak-cache/usage/` next to the inventory (routes and exit codes; never prompts or plan text).

### Changed

- A late supporting observation no longer drops an owner-accepted outcome from `done` to `evidence` in the roadmap, `mozak.md` and `needs` checks. Only a new challenge reopens it. `plan complete` still needs an owner acceptance bound to the exact current evidence.
- Local and vault-plans scope reads never fetch. Remote reads mark `remoteFreshness` and skip the network for 10 minutes after a failed fetch.
- A `mozak.md` that differs only by CRLF line endings or trailing whitespace counts as current.
- Removed the dead format-1 modules from `@mozak/core` (`parse`, `check`, `graph`, `stale`, `translate`, `init`, `write`, `plan`) and their exports. No CLI, MCP or plugin route used them. Format-1 routes still refuse with `unsupported-legacy-operation`. See [docs/audit-2026-10.md](docs/audit-2026-10.md).
- Eleven common error messages now end with the next step (for example `stale-input`, `scope-not-found`, `plan-not-found`, `operation-conflict`). Codes and exit codes are unchanged.

### Fixed

- Revising an accepted plan with content keys in a different order than the schema no longer leaves `mozak.md` in `bridge-conflict` after a reread. Changed fields are listed in schema order.
- A failed MCP tool call now starts with a one-line `reason` and the `issues`, before the rest of the result. A failed `observe` echoes its `unsavedRequest` last, in the CLI JSON too. Hosts that cut long tool output still show why the call failed.
- The duplicate-plan guard no longer lets an exact copy of a plan through when only the numbers in the plan IDs differ.
- Merging plans refuses a merge whose combined discussion would exceed 32 questions (`merge-capacity`) instead of dropping questions. The check runs again at approval time.
- Before each file replace, a write rehashes the plan file and the note and refuses (`graph-changed-during-write`) if something else changed them. This narrows the race with a direct editor. It does not close it.
- The Obsidian plugin opens plans inside Obsidian when the vault was opened through a symlinked path.
- Tests pass with the default macOS `TMPDIR` (a symlinked path with a trailing slash).

### Docs

- README retains the 0.4.4 limitations and adds commands for the unreleased features without claiming measured agent benefit.
- `SPEC.md` is marked as legacy format 1. The README section "Reads and the network" says when a read can fetch, update a cache or push.
- The plugin README now also discloses the public GitHub API visibility check, the parent-folder inventory lookup, the 60 second default sync, and that the update notice only reads a cache.
- Removed the old generated demos with the uppercase name (`docs/assets/mozak-demo.*`, `docs/assets/mozak-agent-chat.*`) from the repo. Nothing linked to them.

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
