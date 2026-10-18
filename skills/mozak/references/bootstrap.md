# Bootstrap: first use on a machine or project

MOZAK has no global registry and never scans directories. Everything hangs off one explicit **inventory file** the owner controls. A fresh agent that was told "use mozak" but given no inventory path follows this page instead of reverse-engineering the core.

## 1. Find the inventory

In order:

1. Use the inventory path the owner gave in this conversation. It always wins.
2. Ask the owner where their inventory lives. One question, not a guess.
3. If the owner does not have one yet, this is first use: create it with the owner (section 2).

Only with the owner's explicit confirmation, a conventional filename to suggest is `mozak-inventory.json` in the directory where the owner keeps their projects or notes. Never search the filesystem for inventories and silently pick one.

## 2. Inventory file format

A single JSON file. Relative `root` paths resolve against the inventory file's own directory.

```json
{
  "format": "mozak.local/v3",
  "scopes": [
    { "id": "my-project", "root": "my-project" },
    { "id": "other", "root": "/absolute/path/to/other" },
    { "id": "shared", "remote": "github:owner/repo", "ref": "main" },
    { "id": "oss", "remote": "github:owner/public-repo", "plans": "notes/oss" }
  ]
}
```

Rules enforced by core:

- `format` is `"mozak.local/v3"` (v2 is accepted read-compatibly).
- Each scope entry has exactly `id` + `root` (local) or `id` + `remote` [+ `ref`] [+ `plans`] (remote).
- Routing rule: a **private** repo keeps plans inside the repo (shared with collaborators). A **public** repo gets `plans`, a folder for its MOZAK.json and MOZAK.md, usually in the owner's notes. Ask the owner which applies; never put plans in a public repo. MOZAK refuses writes to a repo-mode scope whose repo is public (`public-repo-plans`).
- A `plans` folder is initialized like a local scope: it needs its own `README.md` and `AGENTS.md` describing the project.
- Read routes (`context`, `plans`, `check`, `review show`) run inside a clone may omit `--scope`; the scope is found from the clone's git origin. Writes always name `--scope`.
- Scope ids are unique; two scopes may not resolve to the same root.
- Editing this file is an owner-approved act: confirm before adding or removing entries.

Every CLI call takes `--config INVENTORY`. There is no default path and no environment fallback.

## 3. Create a new scope

`scope init` is owner-only and refuses to run until the scope root is a real project entrance:

1. The root directory exists and contains **`README.md` and `AGENTS.md`**, written or reviewed explicitly for this scope. Core refuses init without them (`missing-entry-document`).
2. The root contains no `MOZAK.json`, no `MOZAK.md`, and no legacy `.mozak/` directory (legacy state needs separately approved conversion).
3. The scope has an entry in the inventory.
4. The owner has confirmed, in this conversation, initializing this scope id at this root.

Then:

```bash
node {{MOZAK_CLI}} scope init --config INVENTORY --scope ID --request init.json
```

`init.json` (note: not the mutation envelope; init has its own shape):

```json
{
  "operationId": "unique-id",
  "scopeId": "ID",
  "kind": "project",
  "title": "Human title for the scope",
  "expectedAbsent": { "graph": true, "bridge": true },
  "ownerRef": "real provenance of the owner's confirmation",
  "ownerMessageAt": "2026-01-01T00:00:00.000Z"
}
```

- `kind` is `project` or `topic`.
- `ownerRef` / `ownerMessageAt` follow the same provenance rules as decisions (see `routes.md`): a genuine owner message ID, or a labelled host assertion. Never fabricated.
- Success writes `MOZAK.json` + `MOZAK.md` into the root and returns the first `snapshot` for subsequent `expected` blocks.

## 4. After init

Continue with the normal loop in `SKILL.md`: `context` → `plans` → propose a plan → grilled clarification → owner direction approval → spec → owner implementation approval. Init grants nothing beyond an empty scope.

## 5. Checklist for a cold agent

- [ ] Inventory path confirmed by the owner (or created with them).
- [ ] `node {{MOZAK_CLI}} scopes --config INVENTORY` lists the scope, or the scope was just initialized.
- [ ] `context` read before any write; every mutation's `expected` block copied from a fresh `context` snapshot.
- [ ] No writes without the matching owner confirmation where the route is owner-only.
