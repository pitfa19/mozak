# Cross-plan references and deadlines (owner annotations)

Plans can point at other plans. A plan can need another plan, inform it, or supersede it. A plan can also have a deadline the owner picked. These facts live in `mozak.annotations.json`, a sidecar next to `mozak.json`.

## Why a sidecar

- A change to plan content needs a new direction approval. That clears the spec and the implementation grant. A dependency or a deadline must not cost that.
- A new field in `mozak.json` would need a format bump, and a 0.4.0 client would then refuse the scope.
- The sidecar is invisible to 0.4.0 clients. `mozak.md` stays byte-identical with and without it.
- Agent writes never carry the sidecar hash, so an annotation never makes an agent stale.

## File format

```json
{
  "format": "mozak.annotations/v1",
  "scopeId": "ID",
  "revision": "uuid of the last write",
  "updatedAt": "UTC timestamp",
  "plans": {
    "PLAN": {
      "refs": [
        { "id": "ref-...", "target": "scope/plan#outcome", "relation": "needs", "fromOutcome": "optional", "evidence": "the sentence that justifies it",
          "provenance": { "ownerRef": "...", "ownerMessageAt": "...", "recordedAt": "...", "operationId": "...", "itemDigest": "..." } }
      ],
      "deadline": { "date": "YYYY-MM-DD", "evidence": "...", "provenance": { } }
    }
  },
  "receipts": { "OPERATION": { "requestDigest": "...", "revision": "...", "recordedAt": "...", "result": { "action": "annotate", "ids": [] } } }
}
```

Objects are closed. An unknown key makes the file invalid. `check` reports it and `annotate` refuses to write until it is fixed by hand. Plans are never hidden by a broken sidecar.

## Writing

Only the owner route `mozak annotate` writes the file. It takes the scope lock, writes one temp file and renames it once. The CAS input is the sidecar token in `expectedAnnotations`. `graph` returns the current token per scope in `annotations`. A retried identical request replays its receipt. The same operation ID with other input is refused (`operation-conflict`). See `skills/mozak/references/routes.md` for the request shape and the item kinds.

At write time each ref must resolve: the source plan and `fromOutcome` exist, the target scope is in the inventory, and the target plan (and outcome) exists or was merged into a live plan. A self reference and a duplicate ref are refused.

Temp files are named `mozak.annotations.json.<uuid>.tmp`. `init` and `projection repair` add `mozak.annotations.json.*.tmp` to `.gitignore`. The next write removes a leftover one, and `check` lists it meanwhile.

## Settings

`mozak-settings.json` sits next to the inventory file. It is optional.

```json
{ "format": "mozak.settings/v1",
  "annotations": { "personalVaults": ["../obsidian"] },
  "scopes": { "anpit": { "annotations": false } } }
```

- Repo-mode remote scopes are always refused. Their plans are pushed to a repository.
- A per-scope `annotations` value wins.
- Otherwise annotations are on for local and vault-plans scopes. When `annotations.personalVaults` is set, the default is on only for scope roots inside those folders.
- Keys reserved for later slices (`concurrency`, `indexRoots`) are accepted. Any other key is a `settings-unknown-key` finding with no effect.

## Resolution

A target `scope/plan[#outcome]` resolves in this order:

1. The plan exists in the target scope.
2. A live plan recorded folding it in (`decision.mergedPlanId`). The ref then points at that plan.
3. Otherwise it is reported: `dangling` (scope not in the inventory, plan missing, outcome missing) or `unavailable` (the target scope cannot be read now).

Reads never fetch for resolution. A remote scope is read from its local copy.

## Deadlines from prose

A date counts only when it directly follows a cue: `before`, `by`, `deadline`, `deadline is`, `due`, `until`, `rok`, `rok je`, `do`, `prije`. A weekday may sit in between, and a colon may follow the cue. Formats: `YYYY-MM-DD`, `D Mon YYYY`, `D. M. YYYY.`, `D. <Croatian month> YYYY.` A date without a year is not a date.

The rule reads the title, purpose, rationale, constraints and every outcome that is not done. Past dates are dropped. A completed plan has no deadline. One future date left gives an `inferred` deadline. Several give `candidates`, and the agent proposes one `deadline` item for the owner to pick. An owner deadline always wins.

## Views

- `mozak graph (--scope ID | --all)`: plans, refs and their resolution, with counts.
- `mozak ready (--scope ID | --all)`: open plans whose `needs` are met. A plan-level need blocks while the target plan is not completed. An outcome target blocks while that outcome is not done. A need from `fromOutcome` blocks only while that outcome is the plan's current outcome. Ready plans sort by deadline, then by how many plans need them. Plans superseded by a plan that is not rejected are listed apart.
- `mozak plans --sort deadline`: the usual groups, ordered by deadline. Rows gain `deadline` and `deadlineStatus`.
- MCP: `mozak_plan_graph`, `mozak_ready`, and `sort` on `mozak_plans`. There is no MCP annotate tool.
- The Obsidian sidebar lists outgoing and incoming refs under each plan row.

## Check findings

`ref-dangling`, `ref-target-unavailable`, `annotation-plan-missing`, `needs-cycle`, `needs-closed-target` (a need on a rejected or completed plan), `superseded-open` (an open plan superseded by an open plan), `superseded-next-action` (a superseded plan still has a next action), `annotations-invalid`, `annotations-on-remote`, `settings-invalid`, `settings-unknown-key`, `settings-unknown-scope`. Findings only. Nothing is repaired.

## Limits

- Prune records (`plan prune`, a later slice) are not consulted yet. A ref to a pruned plan is reported as dangling.
- `ready` and supersede detection only see refs stored in the selected scopes. Use `--all` to include refs from every scope.
- The deadline rule is lexical. It can pick a cued date that is not a deadline, for example "data until 2026-11-15".
