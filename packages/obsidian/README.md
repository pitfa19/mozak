# mozak Obsidian plugin

Obsidian sidebar for [mozak](../../README.md). Shows every scope from your `mozak-inventory.json`, its plans, and each plan's progress strip. Clicking a plan opens its section in the scope's `mozak.md` note (`purpose`, outcome roadmap, status table, and full plan). It never writes plan state.

## Use

- Ribbon icon (**Open mozak scopes**) or command (**mozak: Open scopes**) opens the sidebar. It refreshes on open, when plan files change on disk, and when you click the refresh button.
- Tabs: **Open** (open, awaiting approval, paused), **Focus** (plans you starred that are still open) and **Done** (completed). A focused plan that completes shows only under Done. Rejected plans show in no tab (`mozak plans --include-rejected` still lists them). The sidebar opens on Focus when it has plans, else Open, and remembers the last tab you chose.
- Click the star on a plan row to add it to Focus or take it out. Clicking the rest of the row still opens the plan. The star writes only the scope's `focus` list in `mozak-inventory.json` (the same as `mozak focus add|remove`). Focus is a marker for you: agents can read it but never change it, and it is not plan state.
- Search filters by scope title, scope id, or plan title. Matching scopes open automatically while searching.
- Each open plan row shows a small outcome strip (green = done, gold = evidence recorded, purple = current stop, faint = not started) and `done/total`.
- Click a plan row to open its `## Title · \`plan-id\`` section in the scope's `mozak.md` note (or its line under `## Completed` for completed plans). If the scope is outside the current vault, the plugin opens `mozak.md` in your system default viewer.
- A scope with a `repo` link (set with `mozak scope link`) shows a link icon on its row and, when opened, quick links to the code repo and its `README.md`. The link opens in your browser. The plugin never fetches it.
- When annotations are on for a scope (off by default, see [docs/annotations.md](../../docs/annotations.md)) and the owner has added cross-plan refs with `mozak annotate`, a plan row lists them: what it needs, informs or supersedes, both ways. Display only. The plugin never writes `mozak.annotations.json`.
- Settings (**Settings → mozak**):
  - **Inventory path**: path to `mozak-inventory.json` (leave empty to auto-discover by walking upward from the vault root).
  - **Auto-refresh**: watch `mozak-inventory.json` and each scope's `mozak.json` / `mozak.md` with `fs.watch` and redraw on change.

Every scope lives in an Obsidian vault (mozak 0.6.0 and later). A pre-0.6 repo scope or a scope outside a vault shows as a failed row with the `mozak scope move` command that fixes it.

## Disclosures (Obsidian community plugin policy)

- **Desktop only (`isDesktopOnly: true`).** The plugin uses Node.js APIs (`node:fs`, `node:path`, `node:child_process`) to read your local scope files and to run `git` for the **Sync vaults** button.
- **Files accessed outside the vault.** When your `mozak-inventory.json` lists scopes outside the current vault (in your other vaults), the plugin reads their `mozak.json`, `mozak.md`, `mozak.annotations.json` (when present and annotations are on for that scope), `README.md`, and `AGENTS.md` files from those configured paths, and watches them when **Auto-refresh** is enabled. It never scans or crawls directories not listed in `mozak-inventory.json`. To find the inventory when **Inventory path** is empty, it checks whether a file named `mozak-inventory.json` exists in the vault folder and in each parent folder up to the filesystem root. It only checks that one file name and reads the first match.
- **What the plugin writes.** The plugin never modifies canonical plan state (`mozak.json`) and never approves or mutates plans. It writes two things: when a scope's derived `mozak.md` note is out of date with its `mozak.json` and has no unmerged hand edits, it regenerates `mozak.md` on disk (the same projection as `mozak render`), and the star toggle edits the `focus` list of that scope's entry in `mozak-inventory.json` under the inventory lock (every other key and the entry order stay as they were).
- **Network and child-process activity.**
  1. **Sync vaults** syncs each git repository (usually a vault) that holds a scope, the same as `mozak sync`: `git fetch` from that repository's upstream with your local `git` and your existing git credentials, then `git merge --ff-only` while holding the mozak write locks of every scope inside it. It never pushes, never rebases and never merges a diverged history: a vault with local commits is reported as having unpushed commits, and a diverged vault is reported and left alone. This only happens when you click the button, never in the background. With no scope inside a git repository, the plugin runs no git command.
  2. **Repo links.** A scope's `repo` link is a plain link. The plugin never contacts GitHub or any other host for it. Your browser opens it only when you click it.
  3. **Update notice.** The plugin makes no network call for this. It only reads `~/.local/state/mozak/update.json` (or `$XDG_STATE_HOME/mozak/update.json`), which the installed mozak CLI writes after it checks `https://api.github.com/repos/pitfa19/mozak/tags` at most once per 24 hours. When that file names a newer release, the sidebar shows one line such as `mozak X.Y.Z available`. Set `MOZAK_NO_UPDATE_CHECK=1` to turn the CLI check and the notice off.
- **No self-update.** The plugin never installs or updates itself, the CLI or anything else. Updates come through Obsidian's Community plugins screen or `mozak upgrade`, which you run yourself.
- **No telemetry, accounts, payments, ads or cloud service.** All plans and evidence stay in your vault folders and their git repositories.

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
