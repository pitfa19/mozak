# mozak 0.5.0 release notes (DRAFT)

> **DRAFT.** Not published and not tagged. The owner edits, approves and publishes this. Numbers below come from [installation.md, verification status](installation.md#8-verification-status). Recheck them on the release commit.

## In one line

Shorter context reads for agents, owner links and deadlines between plans, and an opt-in way for parallel agents to stop wasting stale writes.

## Highlights

- **Shorter reads for agents.** `mozak context --brief` gives one short summary per plan. `mozak context --plan ID` gives the full state of one plan. Both work in the MCP tool `mozak_context`.
- **Links and deadlines between plans.** The owner can record that a plan needs, informs or supersedes another, and set deadlines, with `mozak annotate`. `mozak graph`, `mozak ready` and `mozak plans --sort deadline` read them. They live in a separate `mozak.annotations.json`, so `mozak.json` and `mozak.md` do not change and 0.4.0 clients keep working. See [annotations.md](annotations.md).
- **Parallel agents (experimental, off by default).** With `concurrency.rebase` on, a stale append (an observation, a discussion save, a new plan) can commit onto the fresh state when nothing it read has changed. In a synthetic run of 3 agents writing 10 observations each to one plan, 35 of 65 attempts were wasted on stale refusals with the default, and 0 of 30 with rebase on. 0 writes were lost either way.
- **Safer storage.** `scope init` and `projection repair` add ignore lines for the write lock and temp files. `check` warns when the lock is not ignored or is tracked by git. A write refuses if the files changed under it right before the replace.
- **Fixes.** The duplicate-plan guard catches copies that differ only in ID numbers. Plan merges refuse to drop discussion questions. The Obsidian plugin opens plans in a vault opened through a symlink.

The full list is in [CHANGELOG.md](../CHANGELOG.md).

## Upgrade

```bash
mozak upgrade --vault ~/path/to/your/vault
mozak doctor --fix
```

Nothing changes in existing scopes until you use a new feature. `concurrency.rebase` stays off unless a scope has `mozak-settings.json` with `{ "concurrency": { "rebase": true } }`. Read [installation.md](installation.md#parallel-writes-concurrencyrebase-experimental-off-by-default) before you turn it on.

## Known limits

- `concurrency.rebase` relies on receipt times. A write merged by git from a machine whose clock is behind can be missed. The 300 ms p95 commit target was not met at 1000 write attempts (p95 385 ms).
- The rename rehash narrows the race with a direct editor. It does not close it.
- Approval follows a trusted-host convention. It is not authentication.
- Linux and macOS only. The Obsidian plugin is desktop only.
- Not on npm yet. Install from source.

## Release steps (owner)

1. Decide whether `v0.4.0` gets its own tag on the current `main` first. The 0.4.0 entry in the CHANGELOG is still marked unreleased.
2. Merge `hermes/vnext` into `main`.
3. Bump `0.4.0` to `0.5.0` in `package.json`, `package-lock.json`, `packages/core/package.json`, `packages/cli/package.json`, `packages/mcp/package.json`, `packages/obsidian/package.json`, `manifest.json` and `packages/obsidian/manifest.json`. Add `"0.5.0": "1.5.0"` to `versions.json`. Change the CHANGELOG heading to `0.5.0 (YYYY-MM-DD)`.
4. Run `npm run build`, `npm test` and `npm run test:install`.
5. Tag `v0.5.0` and push the tag. `.github/workflows/release.yml` refuses a tag that does not match the manifests, then attaches `main.js`, `manifest.json` and `styles.css`.
6. Paste these notes into the GitHub release, without the DRAFT banner.
