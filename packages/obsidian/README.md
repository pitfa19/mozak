# MOZAK Obsidian plugin

Desktop-only Obsidian plugin that lists every MOZAK scope from `mozak-inventory.json` and its plans with progress. Plans are read in each scope's `MOZAK.md`, not in a plugin pane. **It never writes canonical state (`MOZAK.json`). It may regenerate `MOZAK.md` projections**, through core's render (the same code as `mozak render`). It has no approve, reject or propose actions. Parsing, validation, roadmap status and rendering reuse `@mozak/core`, bundled with esbuild.

## Use

- Ribbon icon or command **MOZAK: open scopes** opens the sidebar. It refreshes on open, when plan files change, and with the refresh button.
- Each scope shows title, kind and completed/open/awaiting counts. Unreadable scopes show their error code. Expand a scope for its plans. Open plans show a **progress strip**: one segment per outcome in roadmap order (green done, gold evidence waiting for owner acceptance, purple outline the current stop, grey todo), then `done/total`. Awaiting, paused and rejected plans show their state instead.
- **Click a plan** to open the scope's `MOZAK.md` at that plan's heading. There you read the purpose, a mermaid roadmap of the outcomes, a status table and the full plan text. Status is computed from `MOZAK.json` and nothing in the file is clickable. Files outside the vault open with the OS default app.
- The **refresh button** first regenerates any stale `MOZAK.md` (for example after a MOZAK upgrade changes the format), then reloads. A `MOZAK.md` that was edited by hand is never overwritten. The plugin shows a notice instead, and the owner repairs it with `mozak projection repair`. Automatic refreshes from file changes only read.
- **Remote scopes** (inventory entries with `remote` instead of `root`) show a `remote` badge, plus a `stale` badge when the cached copy is older than 10 minutes, the last fetch failed, or it was never fetched. The header shows **Sync remote scopes** when the inventory has any. It runs core's sync (the same code as `mozak sync`), then refreshes. Refreshing the view alone never touches the network. The plugin never pushes plans, and it never regenerates remote projections.
- Setting **Inventory path**: empty means walk up from the vault folder looking for `mozak-inventory.json`.

## Build and install

```sh
npm install
npm run build -w @mozak/obsidian        # dist/plugin/{main.js,manifest.json,styles.css}
node scripts/install-obsidian-plugin.mjs <vault-folder> [--build]
npm test -w @mozak/obsidian
node --experimental-strip-types packages/obsidian/scripts/dump-model.mjs <inventory.json>
```

Then enable "MOZAK" under Settings > Community plugins. The sidebar is a snapshot taken at the last refresh.

## Layout

`src/model.ts` pure view models, `src/discover.ts` inventory discovery, `src/load.ts` core adapter, `src/views.ts` and `src/main.ts` Obsidian UI.
