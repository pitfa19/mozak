# Obsidian community plugin submission checklist

Status of the mozak plugin against the Obsidian community directory rules. First checked on 2026-10-21 at version 0.4.0. Rechecked on 2026-11-01 for 0.5.0 on the `release/0.5.0` branch. The plugin is already listed in the directory ([community.obsidian.md/plugins/mozak](https://community.obsidian.md/plugins/mozak)), so 0.5.0 is an update, not a new submission: Obsidian picks up a new GitHub release whose tag equals the manifest version. The owner publishes. No agent signs in to the owner's Obsidian or GitHub account.

Sources, read on 2026-10-21 from [obsidianmd/obsidian-developer-docs](https://github.com/obsidianmd/obsidian-developer-docs) (`main`):

- [Submit your plugin](https://docs.obsidian.md/Plugins/Releasing/Submit+your+plugin)
- [Submission requirements for plugins](https://docs.obsidian.md/Plugins/Releasing/Submission+requirements+for+plugins)
- [Developer policies](https://docs.obsidian.md/Developer+policies)
- [Plugin guidelines](https://docs.obsidian.md/Plugins/Releasing/Plugin+guidelines)

Status key: **Met** means checked in this repo. **Owner** means only the owner can do it. **Check** means met as far as a file check can tell, but the owner should confirm by hand.

## Files and release

| # | Requirement | Status | Evidence or owner action |
| --- | --- | --- | --- |
| 1 | `README.md` at the repo root that says what the plugin does and how to use it. The directory shows an excerpt and rewrites relative links and images. | Met | Root `README.md`. The plugin section is "See everything in Obsidian". Relative image `docs/assets/mozak-hero-wide.png` exists. |
| 2 | `LICENSE` at the repo root. | Met | MIT. Checked by the test in `packages/obsidian/test/model.test.ts`. |
| 3 | `manifest.json` at the root of the default branch. The directory reads it at HEAD of the default branch. | Met on `release/0.5.0` | Root `manifest.json` equals `packages/obsidian/manifest.json` (test). The directory sees 0.5.0 once `main` is fast-forwarded to the release branch. |
| 4 | `id` is unique among published plugins and does not contain `obsidian`. | Met | `id` is `mozak`, listed in the directory. |
| 5 | `version` is `x.y.z`. | Met | `0.5.0`. |
| 6 | A GitHub release whose tag equals the manifest `version`, with `main.js`, `manifest.json` and `styles.css` attached. | Owner | `.github/workflows/release.yml` builds on a `v*.*.*` tag, refuses a tag that does not match `package.json` and both manifests, runs the tests, creates the exact-version plugin tag (`0.5.0`) on the same commit and attaches the three files with build provenance. Push `v0.5.0`, then check the release page. |
| 7 | `versions.json` (optional) maps plugin versions to the lowest Obsidian version. | Met | `"0.5.0": "1.14.4"`, the same `minAppVersion` as every 0.4 release (test in `packages/obsidian/test/submission.test.ts`). |

## Manifest and code rules

| # | Requirement | Status | Evidence or owner action |
| --- | --- | --- | --- |
| 8 | Only use `fundingUrl` for donations. | Met | No `fundingUrl`. |
| 9 | Set an appropriate `minAppVersion`. | Met | `1.14.4`, the version the owner runs (since 0.4.0). |
| 10 | Description: 250 characters or less, ends with a period, no emoji, correct capitalization. Starting with an action verb is recommended. | Met | "Project scopes and plans shared with AI agents, stored as plain files." (70 characters). Optional: an action wording such as "Show the plans you share with AI agents, stored as plain files, in a sidebar." Change both manifests if you want it. |
| 11 | `isDesktopOnly: true` when Node.js or Electron APIs are used. | Met | `true`. The plugin uses `node:fs`, `node:path`, `node:os` and `node:child_process`. |
| 12 | Command IDs do not include the plugin ID. | Met | One command, `open-scopes`, named "Open scopes". |
| 13 | Remove the sample plugin code. | Met | No sample classes or settings in `packages/obsidian/src`. |
| 14 | No `innerHTML`, `outerHTML` or `insertAdjacentHTML`. | Met | Checked by the test. |
| 15 | No needless console logging. | Met | No `console.log`, `debug` or `info` (test). |
| 16 | No default hotkeys. | Met | Test. |
| 17 | Sentence case in UI text, no "settings" in settings headings. | Met | "Open mozak scopes", "Inventory path", "Auto-refresh", "Repo sync interval (seconds)", "Sync vaults and repos", tabs "Open", "Focus", "Done", star labels "Add to Focus" and "Remove from Focus". The settings tab has no heading. |
| 18 | Clean up resources on unload, and do not detach leaves in `onunload`. | Met | `onunload` stops the file watchers and clears the sync interval. Leftover leaves of the retired plan view are closed on layout ready, not on unload. |
| 19 | No hardcoded inline styles. | Met | No `.style` assignments in `src`. Styling is in `styles.css`. |

## Developer policies

| # | Requirement | Status | Evidence or owner action |
| --- | --- | --- | --- |
| 20 | No obfuscated code. | Met | `main.js` is an esbuild bundle, not minified. |
| 21 | No ads. No client-side telemetry. | Met | None. |
| 22 | Does not install or update itself or its dependencies. | Met | The plugin only reads the update cache (`cachedUpdateNotice`). The bundle has no release-tag fetch and no `spawn(` (test). Updates come through Obsidian or `mozak upgrade`. |
| 23 | Disclose network use: which services and why. | Met | `packages/obsidian/README.md`, "Disclosures": `git fetch` for remote scopes (default every 60 seconds while Auto-refresh is on), the sync button's fast-forward of local vault repos, the unauthenticated GitHub API visibility check (at most once a day per repo), and the update notice, which reads a local cache only. |
| 24 | Disclose access to files outside the vault, and why. | Met | Same section: the scope files the inventory names (`mozak.annotations.json` only for scopes with annotations on), the upward lookup for `mozak-inventory.json`, and what the plugin writes: a stale `mozak.md` it regenerates, and the `focus` lists in `mozak-inventory.json` through the star. It never writes plan state. |
| 25 | Disclose payments, accounts, ads and server-side telemetry if any. | Met | None. The README says so. |
| 26 | Include a license and respect the licenses of bundled code. | Met | The bundle contains mozak's own `@mozak/core` and esbuild helpers. `obsidian`, `electron` and Node built-ins are external. The fonts with OFL notices are in `docs/assets/brand/` and are not bundled. |
| 27 | Do not suggest the plugin is made by Obsidian. | Met | The plugin name is "mozak". The headline is "One approved plan per project, shared by your coding agents, visible in Obsidian." |
| 28 | Not a fork. | Met | Original code. |

## Risks for the automated review

- **A. Update and spawn code in the bundle.** Fixed in 0.4.x: the plugin bundle has no release-tag fetch, no refresher script and no `spawn(` (test `the plugin bundle has no update refresher` in `packages/obsidian/test/model.test.ts`).
- **B. `child_process` use.** The plugin runs `git` for remote scopes and the sync button, and `curl` for the public visibility check. It is disclosed. Reviewers sometimes ask why. The answer: mozak reads plan files from your own git remotes with your existing login.
- **C. Writes outside plan state.** New in 0.5.0: the star edits `mozak-inventory.json`. It is disclosed in row 24 and in both READMEs.

## What the owner does for 0.5.0, in order

1. Fast-forward `main` to `release/0.5.0` after CI is green, so the root `manifest.json` and both READMEs with the new disclosures are on the default branch.
2. Tag `v0.5.0`. The release workflow checks the versions, creates the `0.5.0` plugin tag and attaches `main.js`, `manifest.json` and `styles.css` (row 6).
3. Check the release page, then update the plugin from Settings, Community plugins on one vault to confirm Obsidian offers 0.5.0.
