# Spec: plans for public repos live in the vault

Plan: `private-plan-storage` (scope `mozak`). Direction approved by the owner 2026-10-18T21:27:15Z.

## 1. Rule

- **Private repo**: plans stay inside the repo as today (`remote` scope, sparse cache, commit and push). Unchanged.
- **Public repo**: plans live in a vault folder. The repo is linked for display and cloning only.
- **Local folder scope** (`root`): unchanged.

## 2. Inventory shape

A new entry form, allowed only in `mozak.local/v3`:

```json
{ "id": "obsidian-plugins-mcp", "remote": "github:pitfa19/obsidian-community-plugins-mcp", "ref": "main", "plans": "creations/obsidian-plugins-mcp" }
```

- `plans` is a path, relative to the inventory file's folder or absolute. It must not be inside `.mozak-cache/`.
- The entry has exactly the keys `id`, `remote`, `plans` and optional `ref`. `root` together with `remote` stays an error.
- In core, `ScopeEntry.root` is the canonical plans folder and `ScopeEntry.remote` carries the repo info with a new `plansMode: "vault"`. Existing remote entries get `plansMode: "repo"`.
- The inventory digest includes `plans` only for vault entries, so digests of existing inventories do not change.
- Duplicate-root and duplicate-id checks treat the plans folder as the root.

## 3. Behaviour of a vault-plans scope

- **Reads and writes** go through the ordinary local path on the plans folder: lock, CAS, receipts, projection and `check`. No git command runs for this scope on any path, including recovery and `sync`. `mozak sync` reports it as `source: "vault"`, `stale: false`, and does not fetch.
- **Render** treats it as local: `render --all` regenerates its `mozak.md`.
- **scope init** works on it like a local scope, with `README.md` and `AGENTS.md` required in the plans folder.
- **Specs** are read relative to the plans folder.
- **Listing**: `scopes`, `plans`, `context` and the MCP tools show `remote`, `ref` and `source: "vault"` for it, exactly as other remote rows show their remote. No network.

## 4. Clone anywhere

- `mozak pull --scope ID [--into PATH]` for a vault scope clones the code (full clone, default destination `~/Documents/<repo>` as today) and never copies, moves or reads plans there. Nothing is recorded as `fullClone` for it, so reads keep using the vault folder.
- **Scope from the working directory**: `--scope` becomes optional for `context`, `plans`, `check` and `review show`. When omitted, the CLI looks for a git repository at or above the current directory. It reads `remote.origin.url`, normalizes it (https or ssh GitHub forms to `owner/repo`, lower case, no `.git`), and selects the one inventory entry whose `remote` matches. No match, or more than one, gives `scope-not-found` with a hint. This applies to every remote scope, vault or repo. Writes still require an explicit `--scope`. Because the scope is found from a clone, an agent in `~/Downloads/<repo>` reads the same plans.

## 5. Visibility guard (repo-mode scopes only)

- `visibility(spec)` asks `https://api.github.com/repos/<owner>/<repo>` with no credentials and a 5 second timeout. Answer: `public` when the API returns 200 with `private: false`, `private-or-missing` on 404, `unknown` on any other result or error. Non-GitHub remotes are `unknown`.
- The result is cached in the existing remote meta file (`visibility`, `visibilityCheckedAt`) for 24 hours.
- On `sync` and before every **write** to a repo-mode scope: if visibility is `public`, the write is refused with `public-repo-plans` (exit 3). The message says to move the plans to a vault folder by adding `plans` to the inventory entry. Reads are never blocked. `unknown` never blocks.
- `sync` and `scopes` add a `public-repo-plans` warning issue for such scopes.
- Tests inject the visibility function. No test touches the network.

## 6. Obsidian plugin

- A vault-plans scope shows the repo tag and GitHub link like other remote scopes. Its plans open inside the vault, because the plans folder is in the vault and `resolveOpenTarget` already handles that.
- The stale and "not fetched" note is hidden for `source: "vault"`.
- The scope is grouped with repos, not notes.

## 7. Migration (owner-approved rollout, after tests pass)

1. Back up the inventory, both `mozak.json` files and spec files.
2. `obsidian-plugins-mcp`: create `~/Documents/obsidian/creations/obsidian-plugins-mcp/` with `README.md` and `AGENTS.md` written for the scope, plus `mozak.json` and `.mozak/npm-publish-spec.md` restored from the 2026-10-18 backup (the spec file is restored from the repo's last commit if present, else the scope records its spec as missing, which `check` reports without failing reads). Add the vault entry to the inventory.
3. `mozak`: create `~/Documents/obsidian/creations/mozak/` with `README.md` and `AGENTS.md`, copy `mozak.json` and the referenced spec files (`docs/obsidian-roadmap-spec.md`, `docs/private-plan-storage-spec.md`) into the same relative paths. Replace the inventory entry with the vault form. Then `git rm --cached mozak.json mozak.md` in the mozak repo, add both to `.gitignore`, and update the repo's `AGENTS.md` and `README.md` to point to the vault.
4. `mozak render --all`, `mozak check` on both, and compare plans, observations, decisions and receipts before and after by canonical JSON.
5. Reinstall the CLI and the plugin into the vaults.

## 8. Tests

- `packages/core/test/vault-plans.test.ts`: inventory parsing (accepted shape, rejected key combinations, digest unchanged for old entries), reads and writes on a vault scope with a throwaway `file://` git repo whose history, refs and working tree stay byte-identical, `sync` does no git work, render covers it, specs resolve in the plans folder.
- `packages/cli/test/cwd-scope.test.ts`: `context` without `--scope` inside a plain git clone (https and ssh origin forms) resolves the scope, unrelated repo gives `scope-not-found`, writes without `--scope` are refused. `pull` for a vault scope clones code only and leaves the plans folder unchanged.
- `packages/core/test/visibility.test.ts`: stubbed public refuses writes with `public-repo-plans` and warns on sync and scopes, private and unknown do not block, cache honoured.
- `packages/obsidian/test/model.test.ts`: vault scope carries remote info, no stale note, grouped as repo.
- Full suite stays green.

## 9. Limitations

- Visibility checks only work for GitHub and only for repos the public API can see. A private repo shows as `private-or-missing`.
- Plans for public repos are private to this machine and its vault repo. Teammates cannot see them (a shared plans repo is a later non-goal).
- Earlier commits of the mozak repo keep their public `mozak.json` history.
