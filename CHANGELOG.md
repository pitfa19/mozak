# Changelog

User-visible changes, newest first. Releases are git tags `vX.Y.Z` on `main`; `mozak upgrade` installs the newest one.

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
