# MOZAK Obsidian plugin

Desktop-only Obsidian plugin that lists every MOZAK scope from `mozak-inventory.json` and its plans with progress. Plans are read in each scope's `MOZAK.md`, not in a plugin pane. **It never writes canonical state (`MOZAK.json`). It may regenerate `MOZAK.md` projections**, through core's render (the same code as `mozak render`). It has no approve, reject or propose actions. Parsing, validation, roadmap status and rendering reuse `@mozak/core`, bundled with esbuild.

## Use

- Ribbon icon or command **MOZAK: open scopes** opens the sidebar. It refreshes on open, when plan files change, and with the refresh button.
- Each scope shows title, kind and completed/open/awaiting counts. Unreadable scopes show their error code. Expand a scope for its plans. Open plans show a **progress strip**: one segment per outcome in roadmap order (green done, gold evidence waiting for owner acceptance, purple outline the current stop, grey todo), then `done/total`. Awaiting, paused and rejected plans show their state instead.
- **Click a plan** to open the scope's `MOZAK.md` at that plan's heading. There you read the purpose, a mermaid roadmap of the outcomes, a status table and the full plan text. Status is computed from `MOZAK.json`, with no clickable status controls. Completed plans jump to their collapsed summary line. Rejected plans are omitted from the note and show a notice instead. Files outside the vault open with the OS default app, without a section jump.
- The **refresh button** first regenerates any stale `MOZAK.md` (for example after a MOZAK upgrade changes the format), then reloads. A `MOZAK.md` that was edited by hand is never overwritten. The plugin shows a notice instead. Unknown content must be preserved and reviewed by the owner: `mozak projection repair` also refuses manual conflicts. Automatic refreshes from file changes only read.
- **Remote scopes** (inventory entries with `remote` instead of `root`) show a GitHub badge, plus a `stale` badge when the cached copy is older than 10 minutes, the last fetch failed, or it was never fetched. The header shows **Sync remote scopes** when the inventory has any. It runs core's sync (the same code as `mozak sync`), then refreshes. Refreshing the view alone never touches the network. The plugin never pushes plans, and it never regenerates repo-held projections.
- Next to the GitHub badge, a **globe** marks a public repo and a **lock** a private one. Hover for where its plans live: private in your vault, or shared inside the repo. The answer comes from the last sync (cached for 24 hours), so a never-synced repo shows no mark.
- Remote scopes with `plans` keep their plans in a vault folder. They are never stale, their plans open inside the vault, and the plugin regenerates their `MOZAK.md` like a local scope.
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

## Verification of the roadmap change

Checked on macOS, 2026-10-17 at 23:55 UTC (2026-10-18 locally):

- `npm run build` and `npm run build -w @mozak/obsidian` passed. The full regression suite passed **399/399**, with global Git configuration isolated for the repository fixtures. No tests were skipped.
- The built CLI rendered copies of three real scopes through `render --all`, then reported all three current on the second call without changing any projection bytes. Public `check` passed on each copy. The three canonical JSON copies and all 12 real source files remained byte-identical.
- Before rendering, none of the eight displayed plans had a matching note target. Afterwards, all eight resolved through the plugin's actual loader and navigation model. The generated notes contained no task checkboxes. This verifies the data and file boundary, not an Obsidian click or scroll.
- Public CLI conflict checks returned exit 3 for one scope and exit 6 for partial coverage, preserving the deliberately edited scratch note. Regression tests additionally cover completed-plan summary targets, refusing unknown content even with a self-asserted digest, remote-render refusal, and reporting a failed cleanup after a projection write.
- **Owner acceptance passed on 2026-10-18.** The built plugin was installed in the isolated preview vault, pinned to its own inventory. The owner opened it in Obsidian and confirmed that the roadmap and the sidebar both work well. The full suite was rerun at 399/399 before shipping.

Reproducible local evidence is in the gitignored `scratch/preview/acceptance-run.mjs` and `scratch/preview/acceptance-20261018/results.json`.

## Layout

`src/model.ts` pure view models, `src/discover.ts` inventory discovery, `src/load.ts` core adapter, `src/views.ts` and `src/main.ts` Obsidian UI.
