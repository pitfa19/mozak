# Obsidian community plugin submission checklist

Status of the mozak plugin against the Obsidian community directory rules, checked on 2026-10-21 on the `hermes/launch-docs` branch at version 0.4.0. The owner submits. No agent signs in to the owner's Obsidian or GitHub account or opens a pull request anywhere.

Sources, read on 2026-10-21 from [obsidianmd/obsidian-developer-docs](https://github.com/obsidianmd/obsidian-developer-docs) (`main`):

- [Submit your plugin](https://docs.obsidian.md/Plugins/Releasing/Submit+your+plugin)
- [Submission requirements for plugins](https://docs.obsidian.md/Plugins/Releasing/Submission+requirements+for+plugins)
- [Developer policies](https://docs.obsidian.md/Developer+policies)
- [Plugin guidelines](https://docs.obsidian.md/Plugins/Releasing/Plugin+guidelines)

Status key: **Met** means checked in this repo. **Owner** means only the owner can do it. **Check** means met as far as a file check can tell, but the owner should confirm by hand.

## Files and release

| # | Requirement | Status | Evidence or owner action |
| --- | --- | --- | --- |
| 1 | `README.md` at the repo root that says what the plugin does and how to use it. The directory shows an excerpt and rewrites relative links and images. | Met | Root `README.md`. The plugin section is "See everything in Obsidian". Relative image `docs/assets/mozak-logo-light.png` exists. |
| 2 | `LICENSE` at the repo root. | Met | MIT. Checked by the test in `packages/obsidian/test/model.test.ts`. |
| 3 | `manifest.json` at the root of the default branch. The directory reads it at HEAD of the default branch. | Met on `main` and on this branch | Root `manifest.json` equals `packages/obsidian/manifest.json` (test). Merge to `main` before you submit, so the directory sees the current file. |
| 4 | `id` is unique among published plugins and does not contain `obsidian`. | Met | `id` is `mozak`. Not in the 9,231 entries of `community-plugins.json` in obsidianmd/obsidian-releases on 2026-10-21 (checked by id and by name). |
| 5 | `version` is `x.y.z`. | Met | `0.4.0`. |
| 6 | A GitHub release whose tag equals the manifest `version`, with `main.js`, `manifest.json` and `styles.css` attached. | Owner | `.github/workflows/release.yml` builds on a `v*.*.*` tag, refuses a tag that does not match `package.json` and both manifests, runs the tests and attaches the three files. It worked for `v0.3.0`. `v0.4.0` is not tagged yet. Push the tag, then open the release page and check that the three files are attached. |
| 7 | `versions.json` (optional) maps plugin versions to the lowest Obsidian version. | Met | Added on this branch: `{"0.4.0": "1.5.0"}`. Add a line for each new version (test in `packages/obsidian/test/submission.test.ts`). |

## Manifest and code rules

| # | Requirement | Status | Evidence or owner action |
| --- | --- | --- | --- |
| 8 | Only use `fundingUrl` for donations. | Met | No `fundingUrl`. |
| 9 | Set an appropriate `minAppVersion`. | Check | `1.5.0`. The plugin uses `ItemView`, `Setting`, `setIcon`, `getRightLeaf`, `revealLeaf` and `getLeaf("tab")`. Nobody has run it on Obsidian 1.5. Either test on 1.5 or raise it to the oldest version you tested on, in both manifests and `versions.json`. |
| 10 | Description: 250 characters or less, ends with a period, no emoji, correct capitalization. Starting with an action verb is recommended. | Met | "Project scopes and plans shared with AI agents, stored as plain files." (70 characters). Optional: an action wording such as "Show the plans you share with AI agents, stored as plain files, in a sidebar." Change both manifests if you want it. |
| 11 | `isDesktopOnly: true` when Node.js or Electron APIs are used. | Met | `true`. The plugin uses `node:fs`, `node:path`, `node:os` and `node:child_process`. |
| 12 | Command IDs do not include the plugin ID. | Met | One command, `open-scopes`, named "Open scopes". |
| 13 | Remove the sample plugin code. | Met | No sample classes or settings in `packages/obsidian/src`. |
| 14 | No `innerHTML`, `outerHTML` or `insertAdjacentHTML`. | Met | Checked by the test. |
| 15 | No needless console logging. | Met | No `console.log`, `debug` or `info` (test). |
| 16 | No default hotkeys. | Met | Test. |
| 17 | Sentence case in UI text, no "settings" in settings headings. | Met | "Open mozak scopes", "Inventory path", "Auto-refresh", "Repo sync interval (seconds)", "Sync remote scopes". The settings tab has no heading. |
| 18 | Clean up resources on unload, and do not detach leaves in `onunload`. | Met | `onunload` stops the file watchers and clears the sync interval. Leftover leaves of the retired plan view are closed on layout ready, not on unload. |
| 19 | No hardcoded inline styles. | Met | No `.style` assignments in `src`. Styling is in `styles.css`. |

## Developer policies

| # | Requirement | Status | Evidence or owner action |
| --- | --- | --- | --- |
| 20 | No obfuscated code. | Met | `main.js` is an esbuild bundle, not minified. |
| 21 | No ads. No client-side telemetry. | Met | None. |
| 22 | Does not install or update itself or its dependencies. | Met, see risk A | The plugin only reads the update cache (`cachedUpdateNotice`). Updates come through Obsidian or `mozak upgrade`. |
| 23 | Disclose network use: which services and why. | Met on this branch | `packages/obsidian/README.md`, "Disclosures": `git fetch` and `git pull --ff-only` for remote scopes (default every 60 seconds while Auto-refresh is on), the unauthenticated GitHub API visibility check through `curl` (at most once a day per repo), and the update notice, which reads a local cache only. The visibility check and the 60 second default were missing on `main` and were added here. |
| 24 | Disclose access to files outside the vault, and why. | Met on this branch | Same section: the scope files the inventory names, and the upward lookup for `mozak-inventory.json` from the vault folder (added here). |
| 25 | Disclose payments, accounts, ads and server-side telemetry if any. | Met | None. The README says so. |
| 26 | Include a license and respect the licenses of bundled code. | Met | The bundle contains mozak's own `@mozak/core` and esbuild helpers. `obsidian`, `electron` and Node built-ins are external. The fonts with OFL notices are in `docs/assets/brand/` and are not bundled. |
| 27 | Do not suggest the plugin is made by Obsidian. | Check | The plugin name is "mozak". The repo headline "Use Obsidian as your IDE." is a slogan, not a product name. Low risk, your call. |
| 28 | Not a fork. | Met | Original code. |

## Risks for the automated review

- **A. Unreachable update and spawn code in the bundle.** `main.js` includes core code that the plugin never calls: `backgroundRefresh`, which spawns `process.execPath -e` with a script that fetches `https://api.github.com/repos/pitfa19/mozak/tags`. In the plugin it is unreachable, because `installedVersion()` returns null when `import.meta` is empty (the known esbuild `empty-import-meta` warning). A scanner may still flag it. Fix before submitting if review complains: stub `refreshUpdateCacheIfStale` in `packages/obsidian/scripts/build.mjs` (an esbuild alias or define), and add a test that `main.js` contains no `api.github.com/repos/${UPDATE_REPO}` and no `spawn(`. This is a code change, not done on this branch.
- **B. `child_process` use.** The plugin runs `git` and `curl` as child processes for remote scopes. It is disclosed. Reviewers sometimes ask why. The answer: mozak reads plan files from your own git remotes with your existing login.

## What the owner does, in order

1. Merge the release line into `main`, so the root `manifest.json` and both READMEs with the new disclosures are on the default branch.
2. Confirm or raise `minAppVersion` (row 9).
3. Tag the release that matches the manifest version and check that the release has `main.js`, `manifest.json` and `styles.css` (row 6).
4. Sign in at [community.obsidian.md](https://community.obsidian.md) with your Obsidian account, link GitHub, and add the plugin from `pitfa19/mozak`.
5. Read the automated review. Fix what it lists, bump the version, tag a new release. Risk A is the most likely finding.
6. When it is published, install mozak from Settings, Community plugins, Browse on a vault where it was not installed. That is the owner acceptance for the `directory-listed` outcome.
7. After it is listed, change "The plugin is not in the Obsidian community directory yet" in both READMEs to the directory link.
