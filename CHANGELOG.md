# Changelog

User-visible changes, newest first. Releases are git tags `vX.Y.Z` on `main`; `mozak upgrade` installs the newest one.

## 0.5.0 (unreleased)

Not tagged. The version in `package.json`, the package manifests and both plugin manifests is still 0.4.0. Bump it in the release commit. None of these changes are in 0.4.0.

### Added

- Bounded context reads. `mozak context --brief` returns one short, body-free summary per plan. `mozak context --plan ID` returns the full state of one plan, and an unknown ID is refused (`plan-not-found`) instead of falling back to all plans. MCP `mozak_context` takes the same `brief` and `plan` options. Every form keeps the whole-scope `snapshot`.
- Owner annotations in a `mozak.annotations.json` sidecar next to `mozak.json`: cross-plan refs (needs, informs, supersedes) and deadlines, written only through the owner route `mozak annotate`. New reads `mozak graph` and `mozak ready` (MCP `mozak_plan_graph` and `mozak_ready`), and `mozak plans --sort deadline`. `check` reports refs that do not resolve. `mozak.md` does not change because of the sidecar, and older clients leave it alone. The Obsidian sidebar shows refs under each plan. See [docs/annotations.md](docs/annotations.md).
- Experimental read-set rebase for parallel agents, off by default. With `{ "concurrency": { "rebase": true } }` in a scope's `mozak-settings.json`, a stale `observe`, `save-discussion` or new-id `propose` commits onto the fresh state when nothing it read has changed, and the result reports `rebased: { from, onto }`. Decisions, `revise`, `complete` and `attach-spec` keep the exact snapshot check.
- Write-lock hygiene. `scope init` and an explicit `projection repair` add ignore lines for `.mozak-write-lock/` and the write temp files to the scope's `.gitignore`. `check` reports `lock-not-ignored` and `lock-in-git`.
- The inventory reserves an `x` key, on the inventory and on each entry, for extensions. It must be an object. mozak ignores its content.
- `scripts/check-links.mjs` checks every relative link and heading anchor in the repo's Markdown. `npm test` runs it.
- `scripts/readme-example.mjs` reproduces the README example on a throwaway scope.
- `docs/README.md` lists every doc and marks which ones are historical.
- `versions.json` at the repo root maps the plugin version to its lowest Obsidian version.

### Fixed

- The duplicate-plan guard no longer lets an exact copy of a plan through when only the numbers in the plan IDs differ.
- Merging plans refuses a merge whose combined discussion would exceed 32 questions (`merge-capacity`) instead of dropping questions. The check runs again at approval time.
- Before each file replace, a write rehashes the plan file and the note and refuses (`graph-changed-during-write`) if something else changed them. This narrows the race with a direct editor. It does not close it.
- The Obsidian plugin opens plans inside Obsidian when the vault was opened through a symlinked path.
- Tests pass with the default macOS `TMPDIR` (a symlinked path with a trailing slash).

### Docs

- README rewritten: the problem in plain words, a real example, a "why not X" table and a "when not to use mozak" list.
- `SPEC.md` is marked as legacy format 1. The README section "Reads and the network" says when a read can fetch, update a cache or push.
- The plugin README now also discloses the public GitHub API visibility check, the parent-folder inventory lookup, the 60 second default sync, and that the update notice only reads a cache.
- Removed the old generated demos with the uppercase name (`docs/assets/mozak-demo.*`, `docs/assets/mozak-agent-chat.*`) from the repo. Nothing linked to them.

## 0.4.0 (unreleased, tag when publishing)

### Changed

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
