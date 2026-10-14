# MOZAK Obsidian plugin

Read-only, desktop-only Obsidian plugin that lists every MOZAK scope from `mozak-inventory.json` and its plans. It never writes MOZAK files and has no approve, reject or propose actions. Parsing and validation reuse `@mozak/core` (the same functions behind `mozak scopes` and `mozak plans`), bundled with esbuild.

## Use

- Ribbon icon or command **MOZAK: open scopes** opens the sidebar. It refreshes on open and with the refresh button.
- Each scope shows title, kind and completed/open/awaiting counts. Unreadable scopes show their error code. Expand a scope for its plans with state badges.
- Click a plan for a read-only detail tab (purpose, outcomes, constraints, non-goals, rationale, questions, sources, observations). **Open MOZAK.md** opens the file in Obsidian when it is inside the vault, otherwise with the OS default app.
- **Remote scopes** (inventory entries with `remote` instead of `root`) show a `remote` badge, plus a `stale` badge when the cached copy is older than 10 minutes, the last fetch failed, or it was never fetched. The header shows **Sync remote scopes** when the inventory has any. It runs core's sync (the same code as `mozak sync`), then refreshes. Refreshing the view alone never touches the network and shows the cache as it is. The plugin stays read-only: it never writes MOZAK files or pushes plans.
- Setting **Inventory path**: empty means walk up from the vault folder looking for `mozak-inventory.json`.

## Build and install

```sh
npm install
npm run build -w @mozak/obsidian        # dist/plugin/{main.js,manifest.json,styles.css}
node scripts/install-obsidian-plugin.mjs <vault-folder> [--build]
npm test -w @mozak/obsidian
node --experimental-strip-types packages/obsidian/scripts/dump-model.mjs <inventory.json>
```

Then enable "MOZAK" under Settings > Community plugins. Plan details are a snapshot taken at the last refresh.

## Layout

`src/model.ts` pure view models, `src/discover.ts` inventory discovery, `src/load.ts` core adapter, `src/views.ts` and `src/main.ts` Obsidian UI.
