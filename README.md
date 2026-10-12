# MOZAK

**Idea-oriented project understanding, with explicit review rather than a task tracker.**

A scope is a project or research topic. Its `MOZAK.json` holds several high-level plans, accepted direction, proposed revisions, dated observations and owner decisions. `MOZAK.md` is a generated entrypoint, not a second editable authority. Ordinary links in other notes are unrestricted.

**Package 1: local plan state and review is implemented and verified.** The local Linux gate passes 239/239 tests, including built CLI/MCP workflows and real process crash recovery. See `docs/implementation-package-1-acceptance.md` for A01–A15 evidence and `docs/implementation-package-1-plan-state-review.md` for the approved boundary.

This is not completion of Monokl, accepted cross-scope connections, implementation grants, a polished installed conversational skill, automatic migration or the real-user transfer pilot. Those remain separate work.

## What belongs where

| File | Role |
| --- | --- |
| `MOZAK.json` | Canonical scope understanding, revisions, decisions, evidence and operation receipts. |
| `MOZAK.md` | Deterministic generated bridge, pinned to the canonical file digest. Do not edit it. |
| `README.md` | Human introduction, preserved by MOZAK operations. |
| `AGENTS.md` | Agent instructions, preserved by MOZAK operations. |

Git retains historical file versions. The store does not create per-plan version directories or auto-commit a user's repository.

## Review and permission model

1. **Propose or discuss:** create a pending revision without replacing accepted direction.
2. **Approve direction:** record an actual owner decision bound to the exact displayed revision. Detailed planning may start, but this is not permission to code.
3. **Record observations:** preserve provenance and distinguish observed, inferred and unverified claims. Facts do not silently rewrite expectations.
4. **Complete:** require evidence for agreed outcomes and owner acceptance for subjective outcomes. A checked task list is insufficient.
5. **Continue:** read saved context and the ordered Completed, Open and Awaiting approval views. Rejections retain their reason/date and are hidden by default.

The owner-action CLI path is a trusted-host convention, not authentication. An owner reference and matching digest check consistency, not whether a human really spoke. Source text cannot supply approval. A privileged host or direct filesystem editor is not made tamper-proof by MOZAK.

## Explicit local inventory

Every new CLI invocation requires `--config FILE`. The MCP server requires it at startup. Neither falls back to the installed global configuration. The inventory is a local list, not a home-directory crawler:

```json
{
  "format": "mozak.local/v2",
  "scopes": [
    { "id": "project", "root": "./isolated-project" },
    { "id": "research", "root": "./isolated-topic" }
  ]
}
```

Relative paths resolve against the inventory's directory. Duplicate IDs/physical roots and unsafe scope-file symlinks are rejected. All-scope views report inaccessible scopes explicitly, including partial coverage.

Use isolated test scopes while verifying this package. Building the repository is not permission to onboard real projects, modify installed skills, replace the global CLI or convert legacy state.

## Local development

Use the repository's existing dependencies and a configured test scratch directory:

```bash
npm run build
TMPDIR="$JCODE_SCRATCH_DIR" npm test
```

`JCODE_SCRATCH_DIR` must point to an existing writable scratch directory. The package is developed in a local Node 24/Linux environment. Do not infer untested platform compatibility from the plain TypeScript interfaces.

The CLI entrypoint is `node packages/cli/dist/index.js`. For example, after explicitly initializing an isolated test scope:

```bash
node packages/cli/dist/index.js context --config ./local-test.json --scope project --json
node packages/cli/dist/index.js plans --config ./local-test.json --all
node packages/cli/dist/index.js review show --config ./local-test.json --scope project --plan PLAN_ID --json
node packages/cli/dist/index.js check --config ./local-test.json --scope project --json
```

### Supported operation families

| Family | Purpose |
| --- | --- |
| `scope init` | Create-only format-2 initialization in an explicitly inventoried scope, with an owner-init reference. Requires existing README/AGENTS and refuses prior graph/bridge/legacy state. |
| `plan propose`, `plan revise`, `observe` | Typed pending-content changes and factual observations. |
| `review show`, `review decide`, `plan complete` | Exact review display, trusted owner decisions and outcome verification. |
| `context`, `plans`, `check`, `operation` | Read-only understanding, review views, integrity checks and receipt lookup. |
| `projection repair` | Explicit recovery of an interrupted generated bridge, preserving manual conflicts. |

Mutations take `--request FILE` containing a closed JSON request. Semantic mutations carry an operation ID, scope ID, exact expected storage/graph/bridge snapshot, an action and its typed payload. Unknown fields are errors. Request data is never evaluated as code.

For init, the request is separate because no graph snapshot exists yet:

```json
{
  "operationId": "unique-init-operation",
  "scopeId": "project",
  "kind": "project",
  "title": "Isolated test scope",
  "expectedAbsent": { "graph": true, "bridge": true },
  "ownerRef": "actual-owner-decision-reference",
  "ownerMessageAt": "2026-10-12T08:16:20.810Z"
}
```

Replace the example owner reference/date with the actual scoped decision. Test fixtures label synthetic owner references as synthetic. Do not reuse the package implementation approval as authorization to initialize a real user scope.

## Agent-safe MCP

Start the local stdio server with an explicit isolated inventory:

```bash
node packages/mcp/dist/index.js --config ./local-test.json
```

The read tools are `mozak_context`, `mozak_plans`, `mozak_review_show`, `mozak_check` and `mozak_operation`. Mutations are `mozak_propose`, `mozak_revise`, `mozak_observe` and `mozak_complete`. Tools share the core runtime validation, not just schema descriptions.

There is no MCP owner-decision, init, repair or generic arbitrary-operation tool. Callers cannot supply a different config or actor role. The full structured operation result remains available even when a partial-commit result is marked as an error.

## Concurrent writes and crash recovery

A scope-wide directory lock covers canonical CAS and bridge publication. Locks are **never stolen because they are old**. Matching operation-ID retries return the recorded result instead of creating duplicate decisions or observations. A reused ID with different input fails.

The canonical JSON and generated Markdown cannot be atomically replaced together. If JSON committed but bridge publication did not, the result says so. Local context remains readable, but later semantic writes wait for explicit repair. `check` does not repair anything.

If an ordinary bridge file is too large or unreadable, local canonical context still returns with a `bridge-unavailable` diagnostic and `snapshot.bridge: null`. This means **unavailable**, not absent. No mutation or repair may use that untrusted bridge snapshot. Missing/unreadable entry documents are also diagnostics, not substitutes for canonical state. Symlinked graph, bridge and lock paths remain refused.

### Offline lock recovery

1. Stop **all** scope writers and acquirers, including paused processes and child workers. A timeout, old timestamp or a single PID check does not prove quiescence.
2. Preserve the lock metadata and graph/bridge state. Verify that the holder is dead, accounting for PID reuse. If identity or quiescence is uncertain, do not remove anything.
3. Only under established offline quiescence, explicitly remove the abandoned `.mozak-write-lock` coordination directory. There is no online force-unlock command. Preserve unexpected contents for inspection.
4. Restart a read-only `context`/`check`. If canonical state exists with its prior bridge snapshot, invoke explicit `projection repair` against the current snapshot. If init died before any graph existed, recheck absence and retry the original init instead.
5. A manually changed bridge is preserved as a conflict. Automatic repair cannot merge or overwrite it. Resolve that conflict with the owner before continuing writes.

The process-start hint in lock metadata is diagnostic, not an authentication mechanism. Tests can prove quiescence by terminating and joining their own child processes. An agent must not assume the same proof exists for arbitrary user processes.

Guarantees cover cooperative processes on the tested local filesystem. They do not cover arbitrary concurrent editors, power-loss durability or network filesystems. No fsync guarantee is implied by rename.

### Result handling

Never assume a nonzero exit means nothing changed. Read `committed`, `projectionUpdated`, `projectionStatus` and the operation receipt.

| Exit | Meaning |
| --- | --- |
| 0 | Completed operation/read, including a recognized successful retry. |
| 2 | Invalid, unsupported, over-capacity or unavailable selected input. |
| 3 | Stale/conflicting state, required owner review or check findings. |
| 4 | Busy or offline recovery required. |
| 5 | Persistent change occurred but projection/cleanup is unfinished. |
| 6 | Partial all-scope read coverage. |

## Compatibility and remaining work

The old raw `mozak_set_plan`, `translate --write`, `resolve` and format-1 initialization paths are retired in this local build. They must not bypass the review model. Pure format-1 inspection/parser code is retained for explicit read-only analysis, not a permanent dual-runtime planning mode.

Older `SPEC.md`, demos and historical test evidence describe the earlier Markdown-only model. They are not evidence for package 1 and must not be used as current setup instructions. The current design is in `docs/idea-oriented-planning-and-monokl-spec.md`, the bounded build is in `docs/implementation-package-1-plan-state-review.md`, and the unexecuted real pilot is in `docs/idea-transfer-pilot.md`.

Package verification does not prove that an owner finds an adaptation useful or that an independent fresh host understands their direction. Those checks remain required in the actual later pilot. Migration, publication and changes to global agent setup remain separate approvals.

MIT licensed.
