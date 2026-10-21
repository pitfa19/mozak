# mozak Obsidian plugin

Read-only Obsidian sidebar for [mozak](../../README.md). Shows every scope from your `mozak-inventory.json`, its plans, and each plan's progress strip. Clicking a plan opens its section in the scope's `mozak.md` note (`purpose`, outcome roadmap, status table, and full plan).

## Use

- Ribbon icon (**Open mozak scopes**) or command (**mozak: Open scopes**) opens the sidebar. It refreshes on open, when plan files change on disk, and when you click the refresh button.
- Filter by **All**, **Open** (open, awaiting approval, paused), or **Done** (completed).
- Search filters by scope title, scope id, or plan title. Matching scopes open automatically while searching.
- Each open plan row shows a small outcome strip (green = done, gold = evidence recorded, purple = current stop, faint = not started) and `done/total`.
- Click a plan row to open its `## Title · \`plan-id\`` section in the scope's `mozak.md` note (or its line under `## Completed` for completed plans). If the scope is outside the current vault, the plugin opens `mozak.md` in your system default viewer.
- Each GitHub remote scope shows a `globe` (public) or `lock` (private) badge, plus quick links to its GitHub repository and `README.md`.
- When the owner has added cross-plan refs with `mozak annotate` (see [docs/annotations.md](../../docs/annotations.md)), a plan row lists them: what it needs, informs or supersedes, both ways. Display only. The plugin never writes `mozak.annotations.json`.
- Settings (**Settings → mozak**):
  - **Inventory path**: path to `mozak-inventory.json` (leave empty to auto-discover by walking upward from the vault root).
  - **Auto-refresh**: watch `mozak-inventory.json` and each scope's `mozak.json` / `mozak.md` with `fs.watch` and redraw on change.
  - **Repo sync interval (seconds)**: how often remote (`github:owner/repo`) scopes are pulled in the background (`0` disables background git polling; minimum `15`).

## Disclosures (Obsidian community plugin policy)

- **Desktop only (`isDesktopOnly: true`).** The plugin uses Node.js APIs (`node:fs`, `node:path`, `node:child_process`) to read your local scope files and optional git remotes.
- **Files accessed outside the vault.** When your `mozak-inventory.json` lists scopes outside the current vault (for example local code repositories or other folders you own), the plugin reads their `mozak.json`, `mozak.md`, `mozak.annotations.json` (when present), `README.md`, and `AGENTS.md` files from those configured paths, and watches them when **Auto-refresh** is enabled. It never scans or crawls directories not listed in `mozak-inventory.json`. To find the inventory when **Inventory path** is empty, it checks whether a file named `mozak-inventory.json` exists in the vault folder and in each parent folder up to the filesystem root. It only checks that one file name and reads the first match.
- **What the plugin writes.** The plugin never modifies canonical plan state (`mozak.json`) and never approves or mutates plans. When a scope's derived `mozak.md` note is out of date with its `mozak.json` and has no unmerged hand edits, the plugin regenerates `mozak.md` on disk (the same projection as `mozak render`).
- **Network and child-process activity.**
  1. If your inventory contains remote GitHub scopes (`"remote": "github:owner/repo"` without vault-hosted `"plans"`), the plugin runs your local `git` binary (`git fetch` / `git pull --ff-only`) with your existing git credentials to refresh cached scope files in a `.mozak-cache` folder next to your `mozak-inventory.json`. This happens when you click **Sync remote scopes**, and in the background every **Repo sync interval (seconds)** while **Auto-refresh** is on. The default is every 60 seconds. Set the interval to `0` to turn background git fetches off. With no remote scopes the plugin runs no git command.
  2. The same sync asks the public GitHub API (`https://api.github.com/repos/OWNER/REPO`, no login, through your local `curl` with a 5 second timeout) whether each remote GitHub scope is public. This includes vault-plans scopes (`"plans"` set), which are never fetched with git but still get the badge. It asks at most once per 24 hours per scope (once per hour while the answer is unknown) and stores the answer in that scope's `.mozak-cache` meta file. The answer drives the public or private badge and the warning when plans would be published in a public repo. Local scopes are never checked.
  3. **Update notice.** The plugin makes no network call for this. It only reads `~/.local/state/mozak/update.json` (or `$XDG_STATE_HOME/mozak/update.json`), which the installed mozak CLI writes after it checks `https://api.github.com/repos/pitfa19/mozak/tags` at most once per 24 hours. When that file names a newer release, the sidebar shows one line such as `mozak X.Y.Z available`. Set `MOZAK_NO_UPDATE_CHECK=1` to turn the CLI check and the notice off.
- **No self-update.** The plugin never installs or updates itself, the CLI or anything else. Updates come through Obsidian's Community plugins screen or `mozak upgrade`, which you run yourself.
- **No telemetry, accounts, payments, ads or cloud service.** All plans and evidence stay in your local folders and git repositories.

## Build and install

The plugin is not in the Obsidian community directory yet. Until it is, build and copy it from the repository root:

```bash
npm run build
node scripts/install-obsidian-plugin.mjs /path/to/your/vault
```

Or in one step:

```bash
node scripts/install-obsidian-plugin.mjs /path/to/your/vault --build
```

This copies `main.js`, `manifest.json`, and `styles.css` into `<vault>/.obsidian/plugins/mozak/`. In Obsidian: **Settings → Community plugins → Installed plugins → enable mozak**.

## Layout

- `src/discover.ts`: inventory path discovery (`chooseInventory`, `discoverInventory`).
- `src/model.ts`: pure view-model construction (`scopesModel`, `stripVM`, `headingLine`), tested without Obsidian.
- `src/load.ts`: loads the inventory via `@mozak/core` and refreshes stale `mozak.md` projections.
- `src/views.ts`: Obsidian `ItemView` for the scopes sidebar (`ScopesView`).
- `src/main.ts`: plugin lifecycle, file watchers, settings tab, and note navigation.
