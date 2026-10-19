# MOZAK Obsidian plugin

Read-only Obsidian sidebar for [MOZAK](../../README.md). Shows every scope from your `mozak-inventory.json`, its plans, and each plan's progress strip. Clicking a plan opens its section in the scope's `MOZAK.md` note (`purpose`, outcome roadmap, status table, and full plan).

## Use

- Ribbon icon (**Open MOZAK scopes**) or command (**MOZAK: Open scopes**) opens the sidebar. It refreshes on open, when plan files change on disk, and when you click the refresh button.
- Filter by **All**, **Open** (open, awaiting approval, paused), or **Done** (completed).
- Search filters by scope title, scope id, or plan title. Matching scopes open automatically while searching.
- Each open plan row shows a small outcome strip (green = done, gold = evidence recorded, purple = current stop, faint = not started) and `done/total`.
- Click a plan row to open its `## Title · \`plan-id\`` section in the scope's `MOZAK.md` note (or its line under `## Completed` for completed plans). If the scope is outside the current vault, the plugin opens `MOZAK.md` in your system default viewer.
- Each GitHub remote scope shows a `globe` (public) or `lock` (private) badge, plus quick links to its GitHub repository and `README.md`.
- Settings (**Settings → MOZAK**):
  - **Inventory path**: path to `mozak-inventory.json` (leave empty to auto-discover by walking upward from the vault root).
  - **Auto-refresh**: watch `mozak-inventory.json` and each scope's `MOZAK.json` / `MOZAK.md` with `fs.watch` and redraw on change.
  - **Repo sync interval (seconds)**: how often remote (`github:owner/repo`) scopes are pulled in the background (`0` disables background git polling; minimum `15`).

## Disclosures (Obsidian community plugin policy)

- **Desktop only (`isDesktopOnly: true`).** The plugin uses Node.js APIs (`node:fs`, `node:path`, `node:child_process`) to read your local scope files and optional git remotes.
- **Files accessed outside the vault.** When your `mozak-inventory.json` lists scopes outside the current vault (for example local code repositories or other folders you own), the plugin reads their `MOZAK.json`, `MOZAK.md`, `README.md`, and `AGENTS.md` files from those configured paths, and watches them when **Auto-refresh** is enabled. It never scans or crawls directories not listed in `mozak-inventory.json`.
- **What the plugin writes.** The plugin never modifies canonical plan state (`MOZAK.json`) and never approves or mutates plans. When a scope's derived `MOZAK.md` note is out of date with its `MOZAK.json` and has no unmerged hand edits, the plugin regenerates `MOZAK.md` on disk (the same projection as `mozak render`).
- **Network and child-process activity.**
  1. If your inventory contains remote GitHub scopes (`"remote": "github:owner/repo"` without vault-hosted `"plans"`), clicking refresh or enabling **Repo sync interval (seconds)** runs your local `git` binary (`git fetch` / `git pull --ff-only`) using your existing git credentials to refresh cached scope files under `~/.cache/mozak/remotes` (or `$XDG_CACHE_HOME/mozak/remotes`). Set **Repo sync interval (seconds)** to `0` to disable background git fetches.
  2. At most once per 24 hours, MOZAK checks `https://api.github.com/repos/pitfa19/mozak/tags` in the background to display a one-line notice when a newer release tag is available, storing the timestamp in `~/.cache/mozak/update-check.json`. Set `MOZAK_NO_UPDATE_CHECK=1` in your environment to disable this check completely.
- **No telemetry, accounts, or cloud service.** All plans and evidence stay in your local folders and git repositories.

## Build and install

From the repository root:

```bash
npm run build
node scripts/install-obsidian-plugin.mjs /path/to/your/vault
```

Or in one step:

```bash
node scripts/install-obsidian-plugin.mjs /path/to/your/vault --build
```

This copies `main.js`, `manifest.json`, and `styles.css` into `<vault>/.obsidian/plugins/mozak/`. In Obsidian: **Settings → Community plugins → Installed plugins → enable MOZAK**.

## Layout

- `src/discover.ts` — inventory path discovery (`chooseInventory`, `discoverInventory`).
- `src/model.ts` — pure view-model construction (`scopesModel`, `stripVM`, `headingLine`), tested without Obsidian.
- `src/load.ts` — loads the inventory via `@mozak/core` and refreshes stale `MOZAK.md` projections.
- `src/views.ts` — Obsidian `ItemView` for the scopes sidebar (`ScopesView`).
- `src/main.ts` — plugin lifecycle, file watchers, settings tab, and note navigation.
