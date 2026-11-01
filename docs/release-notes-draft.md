# mozak 0.5.0 release notes (DRAFT)

> **DRAFT.** Not published and not tagged. The owner edits, approves and publishes this. Numbers below come from [installation.md, verification status](installation.md#8-verification-status). Recheck them on the release commit.

## In one line

A Focus tab for the plans you care about now, shorter context reads for agents, and safer storage, with every new switch off until you turn it on.

## Highlights

- **Focus tab in Obsidian.** The sidebar tabs are now Open, Focus and Done. Star a plan to put it in Focus. The star writes a `focus` list on that scope's entry in `mozak-inventory.json`, the same as `mozak focus add|remove`. Agents can read it with `mozak focus list` or MCP `mozak_focus` but never change it. Focus is a sidebar marker only, not plan state.
- **Shorter reads for agents.** `mozak context --brief` gives one short summary per plan. `mozak context --plan ID` gives the full state of one plan. Both work in the MCP tool `mozak_context`.
- **Links and deadlines between plans, off by default.** The owner can record that a plan needs, informs or supersedes another, and set deadlines, with `mozak annotate`. `mozak graph`, `mozak ready` and `mozak plans --sort deadline` read them. Turn them on per scope in `mozak-settings.json`. They live in a separate `mozak.annotations.json`, so `mozak.json` and `mozak.md` do not change. See [annotations.md](annotations.md).
- **Plans index, locators and similar plans.** `mozak plans-md` writes a `plans.md` with plan titles and states at each notes repo root. `mozak locators` shows where each source and evidence locator points, and `check` lists cited notes that changed after they were cited. `mozak similar` reports duplicate, overlapping and superseding plans across scopes. See [plans-index.md](plans-index.md).
- **Safer storage.** `scope init` and `projection repair` add ignore lines for the write lock and temp files, and `check` warns when the lock is not ignored or is tracked by git. A write refuses if the files changed under it right before the replace. `mozak recover` clears a stuck lock, `mozak plan prune --rejected` removes rejected plans, `mozak check --history N` finds hand edits, and `mozak sync --local` fast-forwards your vaults.
- **Parallel agents (experimental, off by default).** With `concurrency.rebase` on, a stale append (an observation, a discussion save, a new plan) can commit onto the fresh state when nothing it read has changed.
- **Fixes.** The duplicate-plan guard catches copies that differ only in ID numbers. Plan merges refuse to drop discussion questions. A late supporting observation keeps an accepted outcome done. The Obsidian plugin opens plans in a vault opened through a symlink.
- **Smaller core.** The unused format-1 modules are gone, error messages say what to do next, and the compiler runs stricter checks.

The full list is in [CHANGELOG.md](../CHANGELOG.md). 0.5.0 includes the fixes prepared as 0.4.8, which was never tagged.

## Upgrade

```bash
mozak upgrade --vault ~/path/to/your/vault
mozak doctor --fix
```

Nothing changes in existing scopes until you use a new feature.

**Upgrade every machine before you star a plan.** mozak before 0.5.0 refuses an inventory that has a `focus` list (`unknown key "focus"`). If one machine stars a plan while another still runs 0.4.x, that older mozak stops reading the shared inventory until it is upgraded.

Off unless you turn them on in the `mozak-settings.json` next to the inventory: owner annotations (`scopes.<id>.annotations: true`), `concurrency.rebase` (top level or `scopes.<id>.concurrency`) and the counts-only usage log (`"usageLog": true`, or `MOZAK_USAGE_LOG=on`). Read [installation.md](installation.md#parallel-writes-concurrencyrebase-experimental-off-by-default) before you turn rebase on.

## Known limits

- `concurrency.rebase` relies on receipt times. A write merged by git from a machine whose clock is behind can be missed. The 300 ms p95 commit target is not met on a large store at 1000 write attempts; see [installation.md](installation.md#8-verification-status) for the number measured on this release.
- The rename rehash narrows the race with a direct editor. It does not close it.
- Approval follows a trusted-host convention. It is not authentication.
- Linux and macOS only. The Obsidian plugin is desktop only.
- Linux CI and the Node 24.11 run happen on the pull request. The local checks for this release ran on macOS with Node 26.

## Release steps (owner)

1. Push `release/0.5.0` and open a draft pull request into `main` so CI runs on Linux and macOS with Node 24.11 and 26. Wait for green.
2. Fast-forward `main` to `release/0.5.0`.
3. Change the CHANGELOG heading `0.5.0 (not yet tagged)` to `0.5.0 (YYYY-MM-DD)` if you want the date in the tag.
4. Tag `v0.5.0` on that commit and push the tag. `.github/workflows/release.yml` refuses a tag that does not match `package.json` and both manifests, runs the tests, creates the plugin tag `0.5.0` on the same commit and attaches `main.js`, `manifest.json` and `styles.css`.
5. Paste these notes into the GitHub release, without the DRAFT banner.
6. npm publishing (`npm run build:npm`) is a separate step.
