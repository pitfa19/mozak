# mozak 0.6.0 release notes (DRAFT)

> **DRAFT.** Not published and not tagged. The owner edits, approves and publishes this. Numbers below come from [installation.md, verification status](installation.md#8-verification-status). Recheck them on the release commit.

## In one line

mozak is vault-only: every plan lives in a folder of your Obsidian vault, code repos never carry plans, and `mozak scope move` brings older scopes over without changing a byte of a plan.

## Breaking

- **GitHub repo scopes are gone.** Inventory entries with `remote`, `ref` or `plans`, `mozak pull`, the remote part of `mozak sync`, the MCP tool `mozak_sync`, the `.mozak-cache` sparse clones and the public-repo check are removed. Such an entry now shows as a failed scope (`legacy-repo-scope`) with the exact command that moves it. Every other scope keeps working.
- **Scopes must be inside a vault.** A scope folder needs a folder holding `.obsidian` at or above it. A scope elsewhere (for example a code repo with `mozak.json` in it) shows as `scope-outside-vault`, with the same move command.
- **No scope from the current folder.** `context`, `check`, `review show` and `plan show` need `--scope`, also inside a code repo.

## Highlights

- **`mozak scope move`** (owner) copies a scope's plan files, annotations, `README.md` and `AGENTS.md` into a vault folder, checks every byte, and points the inventory entry there under the inventory lock. It refuses a target outside a vault or one that already holds mozak files, and a source that fails `check`. A failure leaves everything as it was, and the old files stay until you delete them. `--dry-run` shows the plan first. `--drop` removes an empty entry.
- **Display-only repo links.** `mozak scope link --scope ID --repo github:owner/repo` adds a link the Obsidian sidebar and `mozak scopes` show. mozak never fetches it.
- **A quieter plugin.** No background git and no GitHub API calls. **Sync vaults** fast-forwards your vault repositories on click, under the scope locks, and never pushes.

The full list is in [CHANGELOG.md](../CHANGELOG.md).

## Moving over

Follow [Moving to 0.6.0](installation.md#moving-to-060). In short:

1. On 0.5, run `mozak sync --scope ID` for every repo scope whose plans live in its repo.
2. With the 0.6.0 CLI, run `mozak scope move ... --dry-run` for each failed scope, check the list, then run it for real. The moves write only `root` entries, so 0.5 on your other machines keeps reading the inventory.
3. `mozak scopes` shows 0 failed. Commit and push the vault.
4. Upgrade every machine (`mozak upgrade --vault ~/path/to/your/vault`), then add repo links.
5. Delete the old plan files from code repos when you are happy.

## Known limits

- mozak before 0.6.0 refuses an inventory with a `repo` key. Add links only after every machine runs 0.6.0.
- Attached specification files are not moved. `scope move` lists each one so you can copy it.
- Approval follows a trusted-host convention. It is not authentication.
- Linux and macOS only. The Obsidian plugin is desktop only.
- Linux was not checked locally. CI runs it on the pull request.

## Release steps (owner)

1. Push `release/0.6.0` and open a draft pull request into `main` so CI runs on Linux and macOS with Node 24.11 and 26. Wait for green.
2. Migrate the real inventory with the branch build from a scratch prefix (dry run first), before any 0.6.0 install.
3. Fast-forward `main` to `release/0.6.0`.
4. Change the CHANGELOG heading `0.6.0 (not yet tagged)` to `0.6.0 (YYYY-MM-DD)` if you want the date in the tag.
5. Tag `v0.6.0` on that commit and push the tag. `.github/workflows/release.yml` refuses a tag that does not match `package.json` and both manifests, runs the tests, creates the plugin tag `0.6.0` on the same commit and attaches `main.js`, `manifest.json` and `styles.css`.
6. Paste these notes into the GitHub release, without the DRAFT banner.
7. npm publishing (`npm run build:npm`) is a separate step.
