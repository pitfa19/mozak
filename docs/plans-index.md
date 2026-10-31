# Plans index, locators and similar plans

Four read-mostly helpers for finding plans and what they cite. None of them stores state or uses a model.

## `mozak plans-md`: a plans.md per repository

```
mozak plans-md --config INVENTORY --print     # show the files, write nothing
mozak plans-md --config INVENTORY             # owner: write them
```

- One `plans.md` per git repository that holds scopes, at that repository's root. A repository lists only its own scopes, so a company vault's file never names a personal plan, and the other way round.
- It holds titles and states only: open, paused, awaiting approval, completed. No purposes, outcomes, evidence or decisions. Rejected drafts are left out.
- The first line marks the file as generated. A `plans.md` without that line is never overwritten: the run reports `plans-md-conflict` (exit 3) and leaves it as it is. Same content means no write.
- Repo-mode remote scopes and scopes outside git are skipped and listed under `skipped`.
- Writing is an owner route. `--print` is a read, and agents may call it. mozak does not commit the file; commit it with the vault like any other note.

## `mozak locators`: where citations point

```
mozak locators --config INVENTORY (--scope ID | --all) [--plan ID] [--include-private] [--json]
```

Every `Source.locator` and `Evidence.locator` of the selected plans, with what it points to on this machine:

| status | meaning |
| --- | --- |
| `resolved` | a file or folder was found. `title` is its first heading or file name. For a Markdown note with an anchor, `anchorFound` says whether a heading matches it. |
| `missing` | looks like a path or a `[[note]]` link, nothing found |
| `ambiguous` | a `[[note]]` name matches several notes, none in the citing scope |
| `remote` | a relative path in a scope whose code lives in a remote repo that is not cloned here |
| `external` | a URL or a `git:` object, not checked |
| `not-checked` | prose, such as an owner message or a command |

Relative paths are tried against the scope folder, its repository root, and the index roots. `[[note]]` links use a note index built from the index roots for this call. Note names match without case and with Croatian letters folded (`č ć` to `c`, `š` to `s`, `ž` to `z`, `đ` to `d`). Wikilinks inside code fences and code spans do not count.

### Index roots and privacy

`indexRoots` in the `mozak-settings.json` next to the inventory lists the folders to search:

```json
{ "format": "mozak.settings/v1",
  "indexRoots": [ { "path": "../vault/personal", "private": true }, { "path": "../vault/research" } ] }
```

Paths are relative to the settings file. Without `indexRoots`, the roots are the top folders of each git repository that holds a scope. A folder named `personal` is private. A scope whose folder is a repository root (a shared company vault) is not a root; its own citations still resolve inside its own folder.

A file in a private root returns path and title only. `--include-private` (MCP and API: `includePrivate`) returns the excerpt too, and the usage log records that the call asked for it. Other files outside every root also return path and title only.

## Cited-note staleness in `mozak check`

`check` lists `cited-note-changed` for each file a live plan cites (source or evidence) that changed after the citation. Time comes from git. A citation counts from the first commit of the scope's `mozak.json` at or after its `observedAt` or `inspectedAt`, so a note committed while the citation itself was still uncommitted is not reported. Uncommitted edits count by file time. Files outside git are not judged.

These lines are information, like leftover temp files. They never change the exit code: a changed note does not mean the edit matters.

## `mozak similar`: similar and duplicate plans

```
mozak similar --config INVENTORY (--scope ID | --all) [--json]
```

MCP: `mozak_similar`. It pools every plan of the selected scopes and runs the same rules as the propose guard, with Croatian letters folded. A pair is reported only when at least one side is open, paused or awaiting: two completed or two rejected plans leave nothing to decide.

- **Template filter.** Two plans with the same outcome-id list and fewer than 2 shared title words are siblings from one template, not a match.
- **`duplicate`.** Same content, or at least 60% of the body words shared and every title word of each plan found in the other.
- **`supersedes-candidate`.** The newer plan names the older one, or the older one was rejected. `a` is the newer plan.
- **`overlap`.** Any other match.
- **`moved`.** Rejected plans whose rejection reason says "moved to", listed apart.

The report suggests; it never merges, rejects or links. Merges stay in one scope with `plan revise` and `mergeFromPlanId`. A cross-scope duplicate is usually a move: copy the plan, then reject the old one with a reason that says where it moved.

## Verifiers

- `node scripts/verify-dup.ts` builds the public synthetic mirror (12 bases, a third Croatian, exact copies under neutral ids, 60 mutations, templated siblings, a supersession pair, a moved reject) and checks: every exact copy is refused by `propose` in its own scope and labelled `duplicate` across scopes, the supersession pair is a `supersedes-candidate`, no templated pair is a `duplicate`, and `duplicate` precision is at least 0.95. `--config FILE` runs read only on a real inventory and fails above 4 pooled pairs (`--max-pairs N`). Exit 1 on any failure. `packages/core/test/vdup.test.ts` runs the mirror on every commit.
- `node scripts/verify-latency.ts [--config FILE]` times `plans.md` (budget 1 s, in process and through the CLI) and resolving every locator (budget 300 ms), on 23 synthetic scopes or a real inventory, read only. Exit 1 over budget.
