# Implementation package 1: mozak plan state and review

**Status: the bounded package-1 build and A01–A15 verification are complete on October 12, 2026. Build succeeds and 239/239 tests pass at implementation checkpoint `78896e9`. See `implementation-package-1-acceptance.md` for evidence and limits. Owner approval was granted at `2026-10-12T08:16:20.810Z` for checkpoint `caffffa`. All exclusions below remain in force.**

Prepared after the owner's `2026-10-11T23:32:29.420Z` approval to detail the first package. That approval authorises this planning document, not code, installation, migration or execution of the real pilot. Product direction and P1–P5 are recorded in `idea-oriented-planning-and-monokl-spec.md`. The proposed real pilot remains in `idea-transfer-pilot.md` and is not run by this package.

## 1. Outcome and approval scope

**Deliverable:** a local, testable mozak foundation in which an owner or host can create several high-level plans, discuss pending changes without replacing accepted direction, record observations, make narrowly bound review decisions, and recover the resulting context through a new CLI/MCP process. All supported changes use the same guarded JSON store and generated bridge.

This is the first engineering slice, not the whole product. Completing it must not be reported as completion of Monokl, the polished conversational skill, accepted cross-scope transfer, the fresh-host usefulness pilot or migration.

### Included

1. A closed versioned JSON model, deterministic Markdown projection and strict local scope selection.
2. Plan drafts, pending revisions, observations, direction decisions, rejection/reconsideration, pause/resume and evidence-backed completion.
3. Shared context/review/check views, thin CLI routes and an agent-safe MCP subset.
4. Scope-wide CAS, operation receipts, conservative locking, interrupted-projection detection and explicit repair.
5. Tests using actual files, CLI subprocesses and MCP stdio, plus documentation of permission and recovery limits.

### Excluded, retained for later packages

- Monokl code, validators, adapters, discovery/ranking, source analysis and the real transfer pilot.
- Connection proposal/acceptance/traversal, automatic source-impact analysis, implementation-grant issuance and downstream task execution.
- Changes to installed skills, the polished host interview/handoff integration, global CLI/config/registration changes, and onboarding actual user projects.
- Conversion of existing scopes, deletion, publication, remote builds, new services and new runtime dependencies.
- A task scheduler, task dependency DAG, general knowledge store, permanent dual-format runtime or unattended lock recovery.

The missing capabilities are explicit package boundaries, not removed product requirements. In particular, U01's genuine fresh-host understanding and U25's migration remain open after this package.

## 2. Observed baseline and proposed file boundary

Inspected source tree: `b74be59ef5a6e81f48750b44cc583fe862009205`, clean before this document. The latest commits there are documentation approvals. Current installed mozak still resolves `mozak` to the legacy repository, with no ready goals in its context. This package follows the newly approved direction, not legacy execution records. Do not change that registration or create a legacy feature record as a side effect.

Static observations, not new test results:

| Existing boundary | Relevant finding |
| --- | --- |
| `packages/core/src/write.ts:51–95` | Lock reclaim uses age, then unlinks by path. The writer guards one file only. Do not reuse this transaction protocol for format 2. |
| `packages/core/src/init.ts:18–45` | Current scaffold emits format 1 and tells agents to edit Plan freely. That instruction cannot be used for the new store. |
| `packages/core/src/graph.ts:45–112` | Discovery starts from Markdown, silently bounds depth, and retains one duplicate identity. New context must remain recoverable with a missing/stale bridge and reject duplicate identities. |
| `packages/cli/src/index.ts:52–95` and `packages/mcp/src/server.ts:76–99` | Legacy translation/resolve and raw Plan replacement can write Markdown without semantic approval. They cannot remain write paths into format 2. |
| `package.json:6–9`, core/MCP test directories | Current scripts build with TypeScript and run core/MCP tests. There is no CLI test glob. Tests include real writer children and real MCP stdio, useful patterns rather than proof of the new contract. |

### Allowed implementation edits after separate approval

| Area | Proposed files and responsibility |
| --- | --- |
| Core model | New `packages/core/src/understanding.ts` for closed types, validation, canonical serialization and digest helpers. New `review.ts` for pure transitions and derived review views. |
| Storage/resolution | New `scope-store.ts` for snapshot/transaction/projection/repair and `scope-index.ts` for explicit local inventory. Existing `index.ts`, `check.ts`, `init.ts` and `write.ts` only as needed to route supported operations and close old write paths. |
| Public interfaces | `packages/cli/src/index.ts`, `packages/mcp/src/server.ts`, and `packages/mcp/src/index.ts` only if transport wiring needs it. Keep both interfaces thin and core validation authoritative. |
| Tests | New core understanding/review/store/index tests, process fixtures under core test, new `packages/cli/test/*.test.ts`, and updated MCP tests. Update the root test script to include CLI tests. |
| Documentation | `README.md`, relevant existing docs and this package's acceptance evidence. Package metadata may change for exports/scripts only, with no new runtime dependency. |

Function/file splits may be adjusted within these responsibilities during implementation. Adding a dependency, platform-specific lock backend, additional product capability or writes outside this repository and test scratch roots requires an explicit scope revision. Read-only inspection of `parse.ts`, `graph.ts`, `plan.ts`, `translate.ts` and `stale.ts` is expected. Their legacy public routes must be disabled where necessary rather than silently reinterpreted as format 2.

## 3. Local files and exact scope selection

### Storage layout proposal

- `mozak.json`: the sole authoritative understanding graph, discriminator `format: "mozak.scope/v2"`.
- `mozak.md`: entirely generated format-2 bridge. Contains scope identity, canonical-file link, current snapshot digest, concise review summaries and an explicit statement that this package supports no accepted cross-scope declarations.
- `README.md` and `AGENTS.md`: existing documents preserved byte-for-byte by store operations. Missing files are reported by check, not silently manufactured during a plan mutation.
- `.mozak-write-lock/`: transient coordination directory, never an authority or archive. Temporary graph/bridge files have unique names in the same directory as their destination and are never input authorities.
- Git stores historical versions. There is no per-plan version directory or second editable Markdown plan.

### Pilot-local inventory, not global registration

New routes take an explicit `--config FILE` with this proposed shape:

```json
{
  "format": "mozak.local/v2",
  "scopes": [
    { "id": "sample-project", "root": "./sample-project" },
    { "id": "sample-topic", "root": "./sample-topic" }
  ]
}
```

Resolve relative roots against the config file directory, canonicalize them, and reject duplicate IDs, duplicate physical roots and scope/config identity mismatch. Do not scan the home directory, consult the legacy default config, guess by basename, or follow a URL. Each listed root is the allowed root for that scope's files. Reject symlinked graph, bridge or lock paths and path escapes. Config roots must exist before normal operations.

Read one selected scope or explicitly `--all`. With all scopes, return per-scope failures, coverage counts and `complete: false` if any configured scope cannot be read. Never omit failed scopes and call the result complete. A duplicate ID makes selection ambiguous and blocks use of that inventory until corrected.

### Explicit bootstrap, no user-project onboarding in this package

Provide a create-only `scope init` route so real-interface tests do not handwrite authoritative graph fixtures. It requires an explicit inventoried empty/new test scope, ID, kind, title, operation ID and owner-init decision reference. Refuse any existing `mozak.json`, `mozak.md` or detected legacy `.mozak` state. Do not convert it. Require existing README/AGENTS for a valid scope, or return a read-only list of missing entry documents before writing.

Tests create ordinary README/AGENTS fixture files themselves, then invoke init. Product store operations must never write or rewrite AGENTS instructions. Init publishes canonical JSON before the bridge under the same lock protocol, so a crash after JSON creation is recoverable through canonical reads and explicit repair with an expected-absent prior bridge. The only existing-state exception is an exact matching init receipt: return its recorded result and current projection health, without overwriting or silently repairing anything. An existing graph without that matching receipt is refused.

## 4. Canonical model and validation contract

All objects have closed fields. Unknown discriminator versions, invalid enums, unknown fields, duplicate IDs, non-finite numbers, malformed timestamps and invalid references are visible errors. Timestamps are RFC 3339 UTC. Mutations generate their own recorded-at time. An actual owner-message timestamp is retained separately and may be earlier. No timestamp is derived from mtime and called creation time.

Store UTF-8 JSON with recursively sorted object keys, array order preserved, two-space indentation and one trailing newline. Digests are SHA-256 over the specified UTF-8 bytes. Semantic digest input is the canonical content object only, not progress metadata. Storage digest input is the entire canonical file. Compare actual file bytes, not a reparsed approximation, for CAS and bridge digest checks.

### Envelope and plan records

| Record | Required fields and constraints |
| --- | --- |
| Scope envelope | `format`, `scope`, `storage`, `plans`, `connections`, `receipts`. `scope` contains stable `id`, `kind` (project or topic), `title`, `createdAt` and `initialization: { operationId, ownerRef, ownerMessageAt, recordedAt }`. |
| Storage | Unique `revision` regenerated on every canonical mutation, `updatedAt`, and `previousBridge: { exists, sha256 }`. Absent and empty files are distinct. An absent file has `sha256: null`. No current bridge hash is embedded, avoiding circular hashes. |
| Plan | Stable `id`, `createdAt`, `updatedAt`, nullable `accepted`, nullable `pending`, `lifecycle`, `observations`, `decisions`, `reasoningLinks`, `completionRecords`, `downstreamSpec: null`, and `implementationAuthorization: null`. At least accepted or pending content exists. |
| Revision | Unique `id`, `createdAt`, `content`, calculated `contentDigest`. Pending adds `baseAcceptedRevision`, `baseAcceptedDigest`, and `reviewState` (awaiting or rejected) with rejection reference when rejected. A new plan's base is explicitly null. |
| Accepted/lifecycle | Accepted includes `acceptedFromRevision` and `directionDecisionId`. Lifecycle is a tagged object: `{ state: unaccepted }`, `{ state: open }`, `{ state: paused, decisionId }` or `{ state: completed, completionId }`. Decision/completion references supply dates and reasons. Accepted content is required except for unaccepted. |

`connections` must be an empty array in package 1. Reject nonempty data as an unsupported capability, not as a valid graph with silently ignored edges. Implementation authorizations are likewise unsupported and cannot be injected through raw JSON or an observation. The later packages must extend the versioned contract deliberately.

### Revision content

`content` contains `title`, `purpose`, `outcomes`, `constraints`, `nonGoals`, `rationale`, `questions`, and `sources`.

- Outcomes are nonempty `{ id, statement, acceptance: objective|owner, criterion }` records. The criterion says what evidence would satisfy this outcome, not a task list.
- Constraints and questions use stable `{ id, text }` records. Non-goals are strings. Open questions may remain unresolved during direction approval.
- Sources use `{ id, locator, anchor, observedAt, version, limitations }`: locator and ID are nonempty strings, anchor/version are string or null, observedAt is a UTC timestamp, and limitations is a string array (empty only when none are known). Locators are evidence text, not commands or permission to fetch.
- Title, purpose, rationale and individual statements cannot be empty. Empty arrays are valid where there is nothing to record. There is no generic unrestricted properties map.
- A revision amendment generates a new semantic ID even if text returns to an earlier value. Acceptance creates a new accepted ID linked to the exact displayed pending ID. Reusing identical text cannot resurrect an old decision's authority.

### Observations, evidence and reasoning

An observation has `id`, `recordedAt`, `classification: observed|inferred|unverified`, `summary`, `evidence[]`, and optional `supersedesObservationId`. Corrections append a superseding observation rather than silently changing historical evidence. Each evidence item has the closed shape `{ id, locator, anchor, version, inspectedAt, activity, result, limitations }`. Anchor/version are string or null, inspectedAt is a UTC timestamp, activity is `{ kind: read|run, description }`, result is `{ verdict: pass|fail|not-assessed, summary }`, and limitations is a string array. Other string fields are nonempty. An observed claim requires evidence, while inferred/unverified records may explicitly report that evidence is missing. No code is executed to validate these strings.

Reasoning links are closed typed records with `id`, `relation`, `from`, `to`, `rationale`. Package relations are observation-to-outcome `supports|challenges` only. Decision-to-question answer links are deferred rather than exposed without an operation. Endpoints identify plan, revision where relevant, entity kind and entity ID. Current content references must resolve. A link to a superseded revision remains visible as historical/unresolved with its pinned revision identity, rather than being rebound to a newer entity or dropped. This is a reasoning graph, not a prerequisite scheduler.

Direction approval preserves observations and decisions. Contradictory observations yield a visible review-needed flag, not automatic rewriting or revocation. A new question that would alter accepted meaning is a draft change, while an observation can record uncertainty immediately. `downstreamSpec` is reserved as null in this slice. Downstream document locators/digests may be recorded as ordinary observation evidence, but there is no dedicated spec-attachment operation or implementation grant. The later handoff package owns that typed attachment capability.

`completionRecords` retain `{ id, acceptedRevisionId, recordedAt, outcomeEvidence, ownerDecisionIds, limitations }`. Each outcome-evidence row binds an outcome ID, the accepted criterion digest, evidence IDs/digests and an explicit reported verification result. All outcomes need supporting observed evidence with a reported pass. Owner-type outcomes additionally need matching `accept-outcome` decisions. Active challenges to an outcome require either an evidence-backed superseding observation or explicit owner acknowledgement in that outcome's review payload. Completion checks recompute the current evidence/challenge set. Changed evidence, new challenges and superseded acceptance bindings cannot silently reuse an old approval. Old completion records survive direction changes but never satisfy a new accepted revision automatically.

### Owner decisions and receipts

An owner decision contains `id`, `purpose`, `ownerRef`, `ownerMessageAt`, `recordedAt`, exact subject plan/revision/content digest, displayed review digest, and a short reason. Rejection, pause and reconsideration require reasons. Completion decisions additionally bind the specific outcome/evidence set. An owner reference is a host/session/message locator or direct-owner-invocation reference, never a source quote promoted to consent.

The core checks internal consistency, not whether a human really spoke. Local JSON and CLI arguments are not cryptographically authenticated. A fabricated decision supplied by a fully privileged host cannot be ruled out by a hash. Agent-safe MCP tools must not expose the owner-decision operation.

Receipts are keyed by unique operation ID with a normalized request digest, resulting storage revision and semantic result IDs. They stay in the single graph and are not a replay engine. No automatic pruning in this package. An identical retry returns the recorded semantic result plus current projection status. Same ID with different input is an error. A receipt does not embed the final graph hash inside the graph.

Proposed conservative limits: 1 MiB per mutation input and 4 MiB per canonical file, checked before publishing. Capacity exhaustion is an explicit non-write error. Do not silently truncate evidence, delete receipts or auto-compact approval records to fit.

## 5. Public operations and authority

**All command/tool names below are proposed, not currently available commands.** CLI routes operate through the same core schemas and transitions. New CLI routes require `--config FILE` and a scope selector. The package's MCP server likewise starts with an explicit `--config FILE` supplied by its trusted launcher, never a per-tool arbitrary config path or a fallback to the installed global config. Tests launch the actual server against their scratch inventory. JSON request files are read as data, never sourced or evaluated.

### Read routes

| CLI | Agent-safe MCP counterpart | Result |
| --- | --- | --- |
| `mozak context --scope ID --json` | `mozak_context` | Canonical understanding, accepted/pending IDs, provenance, effective decisions, `implementationAuthorized: false`, permitted next action and snapshot tokens. |
| `mozak plans --scope ID` or `--all` | `mozak_plans` | Fixed Completed/Open/Awaiting approval groups, exact counts, bounded pages, per-scope coverage and errors. |
| `mozak review show --scope ID --plan ID --json` | `mozak_review_show` | Accepted meaning, pending proposal, changed fields, question and calculated review digest for one exact action/revision. No stored approval is created by reading. |
| `mozak check --scope ID --json` | `mozak_check` | Schema, reference, approval-consistency, entry-document and projection findings, with no repair. |
| `mozak operation --scope ID --id OP --json` | `mozak_operation` | Receipt status, semantic result and current projection state. Never resubmits the operation. |

Review show takes a purpose selector when more than one owner action is possible. Its digest covers that purpose, scope, plan, subject revision/content digest, and displayed action payload. Harmless unrelated observations do not change a direction-review digest. Completion review includes its evidence IDs/digests, so changed evidence requires a new review.

### Mutation routes

| CLI route and allowed caller | Typed request action | Rules |
| --- | --- | --- |
| `mozak plan propose`, invoked agent | `propose` | Create one pending plan, no accepted content or owner decisions. |
| `mozak plan revise`, invoked agent | `revise` | If pending is null and accepted exists, create a new awaiting revision based on the exact accepted ID/digest, with expected pending explicitly null. Otherwise replace an awaiting pending revision against its exact ID and base-accepted snapshot. Preserve accepted direction. A rejected candidate requires explicit reconsideration first. |
| `mozak observe`, invoked agent | `observe` | Append classified observations, evidence and allowed reasoning links. Reject any protected-content/decision/authorization fields. |
| `mozak review decide`, owner path only | `approve-direction`, `reject-pending`, `reconsider`, `pause`, `resume`, `accept-outcome` | Bind to the exact action and subject displayed by review show. No blanket approval, hidden connection grant or implementation grant. |
| `mozak plan complete`, invoked agent or owner path as needed | `complete` | Require evidence coverage for every accepted outcome and owner acceptance for every subjective outcome. No task-count shortcut. |

All mutations use `--request FILE`. Init and explicit `mozak projection repair` are separate typed operations, not generic write capabilities. MCP exposes `mozak_propose`, `mozak_revise`, `mozak_observe` and objective `mozak_complete` only, alongside the read tools. Owner decisions, init and repair stay on the direct/trusted CLI path for this package. No Monokl adapter is created here. Full host owner-action wiring belongs to the later conversation package.

The mutation envelope for semantic plan operations is `{ operationId, scopeId, expected, action, payload }`, where `expected` contains exact storage revision, graph digest and `{ exists, sha256 }` bridge snapshot. Init instead takes the closed request `{ operationId, scopeId, kind, title, expectedAbsent, ownerRef, ownerMessageAt }`, with `expectedAbsent` explicitly true for graph and bridge. The actual matching-receipt replay check precedes this absent-state refusal. Init does not require a plan/revision review digest because no plan exists yet. Repair uses the separate control schema in section 6. Dispatch-specific closed schemas prevent `action` from being used as a generic arbitrary-state replacement.

### Lifecycle details

- Approve-direction requires pending `awaiting`, a matching base accepted revision and review digest. It preserves a dated decision and clears pending after promoting to a new accepted revision. Lifecycle becomes open. Any old completion remains historical, not proof of the new direction.
- Reject-pending preserves the rejected content plus reason/date, hidden in normal review groups. If accepted content also exists, that accepted plan stays open/paused/completed. Reconsideration is owner-only in package 1 and creates a new pending revision. Automatic material-new-evidence reconsideration is deferred.
- Pause/resume never approves pending content, erases evidence or changes expectations. Completed direction is not resumed by this shortcut. Reopening a completed direction requires a reviewed pending revision.
- Complete requires accepted content in lifecycle open, no pending awaiting revision and no unresolved required outcome acceptance. A paused plan must be explicitly resumed first. Objective evidence is a host-reported verification result, not independently executed by this package. Subjective evidence without owner acceptance returns `owner-review-required` and does not mark done.
- Factual observations may still be appended to completed/rejected plans. Material challenges are shown with their limitations and review-needed state without silently changing lifecycle. Every supported next-action suggestion respects the current lifecycle and reports that coding is not authorised by this package.

### Review view

Completed briefly, then Open, then Awaiting approval. Show title, intended outcome and relevant dates. Open includes paused plans with their reason. One accepted plan with a pending proposal appears as a linked review entry, never counted as two plans. New unaccepted drafts appear only in Awaiting approval. Rejected-only drafts are hidden unless `--include-rejected` is explicit.

Awaiting approval also derives an outcome-review entry when a current owner-type outcome has supporting observed pass evidence but lacks acceptance for its current evidence/challenge set. It does not require a fake pending plan revision or a failed-complete request to have mutated the graph. Review show derives this evidence set deterministically from active observations/links, displays relevant challenges, and binds the decision to that set. These entries remain recoverable after process restart. For ordering, outcome-review entries use their latest contributing observation time and the composite key defined below.

Return unique plan totals separately from review-item totals. Default page size is five per group. Order Completed by completion time descending and Open by plan updatedAt descending. For Awaiting approval, normalize pending creation time and outcome latest-contributing-observation time into `reviewAt`, then sort descending. Break ties using a composite stable key `(scopeId, planId, rowKind, revisionId-or-outcomeId)` ascending, not a plan-local outcome ID alone. A continuation includes the inventory/snapshot identities, scope/group, last timestamp and composite key. A changed underlying revision invalidates that continuation rather than silently skipping or duplicating rows. Empty groups and partial scope coverage are explicit.

### Compatibility boundary

Disable `mozak_set_plan`, legacy `translate --write`, legacy `resolve` and format-1 init in the newly built local v1 artifact. Return `unsupported-legacy-operation` with conversion guidance. New routes never call old `setPlan`, `updateFile` or translation mutations on a generated bridge. Remove these as supported public mutation exports where appropriate. Legacy audit/read functions may remain explicit read-only inspection tools, not an executable old planning mode.

Format-1 documents, unknown formats and a config containing only legacy `roots` fail closed in new routes. Do not guess a conversion. Update route help and tests so no generated AGENTS instruction or tool description invites free editing. The installed legacy CLI is not changed by building this repository.

## 6. Guarded writes, lock ownership and repair

### Deliberate lock trade-off

Use atomic directory creation for a scope lock with a random ownership token. After acquiring, write owner metadata including process identity, process-start discriminator where available and token. There is **no age-based stealing, online reclaim or force-unlock API**. Timeout means busy, not proven process death. Missing/corrupt metadata, including a crash after mkdir but before metadata, fails closed with recovery guidance.

Normal release checks its ownership and removes only its own metadata and then the empty lock directory. Token mismatch or unexpected contents cause a visible error and no removal. All graph/bridge/temp-file work finishes before lock-directory removal. No filesystem cleanup by the old transaction may run after the directory becomes available to a successor.

A token check alone does not solve an unlink race. Safety here depends on the stronger cooperative invariant: **no participant can replace/reclaim a held lock online**. Consequently a successor cannot acquire while the previous holder is live and still releasing. Arbitrary direct filesystem manipulation is outside that guarantee.

After process death, an operator must stop all scope writers and acquirers, verify the holder is dead rather than paused or PID-reused, preserve recovery information and perform documented offline lock removal. Uncertain owner identity means do not remove. A test harness may establish quiescence by terminating and joining every child. A production agent cannot infer global quiescence from a timeout or a single PID lookup. The recovery runbook must state this operational precondition. No automatic crash-recovery claim is made.

This explicit offline-recovery requirement is a new implementation proposal for owner approval. It keeps the first protocol dependency-free, at the cost of writes remaining blocked after a crash. Canonical reads stay available. A later kernel-lock backend can be proposed separately, not added silently.

### Transaction sequence

1. Resolve the exact allowed scope, acquire its lock and reread canonical JSON and bridge. Validate schema, permission class and limits before any authoritative change. Check for a matching receipt before stale-base rejection so a completed retry is recognised.
2. For a new operation, compare storage revision plus actual graph and bridge snapshots. Refuse stale state, invalid approval binding, unsupported format or observed manual edits. Do not automatically rebase owner decisions.
3. Apply the pure transition, create its receipt and new unique storage revision, and store the previous bridge snapshot. Write a unique create-only temp JSON and atomically rename it over the canonical file.
4. Generate the deterministic bridge from the committed bytes. Recheck the bridge against the expected prior snapshot, then atomically publish a unique temp bridge under the same lock. Every canonical mutation refreshes the whole-graph digest in the bridge, even observation-only updates.
5. Determine the provisional result, clean this transaction's own temp files while still locked, then release ownership and only then emit the final result. If canonical commit succeeded but bridge publication failed, return `committed-bridge-stale` with the operation ID and committed snapshot. Never say rolled back or fully successful.

A graph rename and bridge rename are not a two-file atomic transaction. The initial guarantee is cooperative process interruption on the tested local filesystem, not power-loss durability, network-filesystem semantics or arbitrary concurrent editors. No new fsync guarantee is implied.

### Reader and repair behavior

Read graph, then bridge, then graph again. Compare storage identity and bytes across graph reads. Retry at most three times before `busy`. Invalid canonical data cannot be rescued by an apparently valid Markdown file. For a stable canonical snapshot, compare the bridge bytes against deterministic rendering and verify its full graph digest. Preserve local context/review availability with `bridge-stale` or `bridge-conflict` diagnostics.

Subsequent semantic writes are blocked while the projection is incomplete/conflicted so its prior-bridge recovery baseline cannot be lost. A failed observation returns its unsaved request, not an implied record. Cross-scope traversal is unsupported in this package regardless of bridge health.

Explicit repair acquires the same lock, checks expected current graph and observed bridge snapshots, and renders from that exact canonical revision. It may publish only when the bridge equals the recorded previous snapshot, including the expected-absent case, or is already exactly current. A bridge that differs from both is a manual conflict: preserve it and stop. Repair changes no semantic state, approval or canonical revision, and creates no second authority. Manual merge/conflict resolution remains an explicit owner operation outside automatic repair.

Repair is an explicit control request `{ requestId, scopeId, expected }`, not a semantic mutation with a canonical receipt. Its retry safety follows from checking the exact current graph and deterministic bridge, not recording a fake graph change. It reports `projectionUpdated` separately from canonical `committed`. Repeating an already successful repair for the same canonical revision may return already-current only if the bridge is exactly the expected rendering, even if the caller's older bridge snapshot differs. A changed canonical snapshot is still stale.

A delayed repair request cannot publish a projection of an older canonical revision. A matching mutation retry after partial commit reports its existing receipt and projection state, without rewriting semantics or silently repairing. Release failure after commit is reported as `committed-lock-held`, with whether the bridge is current. A caller must not assume every nonzero exit means no state changed.

### Error/result contract

Every result contains `status`, `committed`, `operationId` when applicable, `snapshot`, `projectionStatus`, `projectionUpdated`, and structured issues. For a mutation, `committed` identifies whether that operation's semantic canonical commit occurred, including a recognised prior attempt, not a guarantee that cleanup succeeded. Read responses report no new commit and expose receipt history separately. Unavailable snapshots are explicitly null. Distinguish at least stale input, busy, recovery required, duplicate operation with changed payload, unsupported format/capability, owner review required, bridge conflict, committed bridge stale, committed lock held and capacity exceeded.

CLI exit proposal: 0 complete success, 2 invalid/unsupported/capacity-exceeded input or unavailable selected scope, 3 stale/conflict/owner-review-required without a canonical commit, 4 busy/recovery-required without a canonical commit, 5 any persistent canonical or projection change with unfinished projection/lock cleanup, and 6 partial all-scope read coverage. Init missing entry documents returns 2 without writes. Read-only checks with findings return 3 unless the more specific missing/unsupported input case applies. A repair that published a bridge but cannot release its lock returns 5 with `committed: false`, `projectionUpdated: true` and `projection-updated-lock-held`. MCP preserves the same JSON result even when `isError` is true. Missing/inaccessible files are never reported as empty valid scopes.

## 7. Implementation order after approval

These are package work units, not new mozak high-level plans. Keep them in the downstream implementation workflow.

1. **Model and pure transitions:** closed validators, deterministic bytes/digests, revision identities, decisions/observations and view DTOs. Test direction changes separately from facts.
2. **Storage proof:** scope index, lock invariant, CAS/receipts, dual-file publication and repair. Prove crash/interleaving behavior before exposing semantic mutations.
3. **CLI vertical slice:** explicit create-only init, propose/review/approve/observe/context, then rejection/pause/completion and all-scope pagination.
4. **MCP and bypass closure:** reuse core schemas, expose the non-owner subset, reject raw legacy writes and verify real stdio parity with CLI.
5. **Integration and documentation:** finish all acceptance cases, inspect allowed-file diff, record actual results and outstanding host/pilot limitations, then request review before any real scope onboarding.

Use Haiku 5.5 at high effort for smaller bounded implementation assignments, as the owner requested. Do not silently substitute if that route is unavailable. Storage design and verification need independent review, not an unreviewed low-effort implementation assignment. No agents implement anything while this document remains proposed.

## 8. Acceptance plan

**Planning-time baseline:** no test below had run when this package was proposed. **Implementation result:** all A01–A15 now have passing evidence in `implementation-package-1-acceptance.md`, with a successful build and 239/239 tests on the local Linux environment. The original acceptance requirements below are retained. Test-owned files live under the configured scratch root, not real user scopes.

### Model and workflow checks

| ID | Publicly observable acceptance | Product story coverage |
| --- | --- | --- |
| A01 | Actual built CLI initializes a new test scope through an explicit inventory, preserving README/AGENTS bytes. Existing graph/bridge/legacy state, duplicate identity and symlink escape attempts fail without overwrites. Exact init receipt replay is a no-op, while reusing its operation ID with different input fails. | U05, U22, U23, U24, partial U25 |
| A02 | Propose two independent plans, accept one (clearing its pending slot), revise that accepted-only plan to create a new pending revision, and restart the CLI. Accepted content stays unchanged while the proposal appears under Awaiting approval. Each amendment has a new semantic ID, including A→B→A text. | U01 storage portion, U03, U05, U21 |
| A03 | Approve direction with the exact displayed review digest and synthetic owner-message fixture. A stale revision, different purpose or altered digest is refused. Fresh context says detailed planning permitted and implementation not authorised. | U04, U21 |
| A04 | Append observed/inferred/unverified facts and a correction. Accepted semantic digest/approval remain effective. Protected-field injection is rejected by both CLI and MCP, including fields absent from advertised tool schemas. | U06, U19 |
| A05 | Reject a pending proposal, retain its reason/date and hide it normally. Reconsider requires an explicit owner decision. Pause/resume and completed-plan revision preserve existing evidence without falsely completing a draft. | U08, U09 |

### Presentation and outcome checks

| ID | Publicly observable acceptance | Product story coverage |
| --- | --- | --- |
| A06 | Two inventoried scopes with more than five rows per group produce fixed group order, distinct plan/review counts and usable continuation. A missing scope gives partial coverage. A changed snapshot invalidates a continuation. | U02, U05, U23 |
| A07 | Objective completion requires evidence for every outcome. Subjective completion requires owner acceptance bound to the current evidence, with a recoverable Awaiting approval outcome entry before acceptance. Contradictions show review-needed state. No task-list-only completion or observation-based coding grant succeeds. | U07 evidence-reference portion, U08, U10 recording portion |
| A08 | A new real CLI/MCP process reconstructs accepted/pending direction, provenance, decision limits and next permitted action from files only. Tests do not supply the prior in-memory objects as context. | U01 storage/transport portion, U07 evidence-reference portion |
| A09 | CLI and actual MCP stdio return equivalent normalized context/review DTOs. MCP owner-decision attempts and all raw legacy mutation routes fail. Unknown fields/types/actions are rejected by runtime core validation, not only tool metadata. Oversized requests and proposed canonical-file overflow are refused before publication without truncation. | U04, U18 boundary portion, U19 |
| A10 | Read context/plans/check/operation-status do not modify graph/bridge/entry files or create lock artifacts. A stale/missing bridge does not hide local pending reviews. The package never fetches sources, starts a watcher or creates accepted edges. | U20, U22, U23 |

### Concurrent processes and failure recovery

| ID | Publicly observable acceptance | Product story coverage |
| --- | --- | --- |
| A11 | Two CLI writers with the same snapshot yield one commit and one stale response. Three real writer processes append observations with explicit fresh reads after conflicts, losing no observations or receipts. | U21 |
| A12 | Pause a real holder beyond the former 30-second lease, or use a deterministic clock hook with an actually live child. Another writer cannot steal it. Metadata mismatch leaves the lock untouched. Unknown/corrupt metadata never triggers removal. | U21, U23 |
| A13 | Kill the writer after lock mkdir/before metadata, before graph publication, after graph publication and after bridge publication/before release. Inspect each state's actual bytes and receipt. Join all children and perform explicitly offline test recovery. Before the first graph exists, retry init after rechecking absent graph/bridge. After canonical commit, recover its receipt and invoke real projection repair. For an existing scope's precommit crash, keep its old state and retry only with a still-valid snapshot. No success result is fabricated. | U21, U23 |
| A14 | Manual bridge edits are preserved, interrupted projection blocks later writes, retry creates no duplicate semantic result, reusing an operation ID with changed input is refused, and a repair based on an old graph cannot overwrite a newer bridge. Reader race tests return a coherent snapshot or busy. | U21, U23 |
| A15 | Normal lock release completes all filesystem work before the successor acquires. Offline recovery is never concurrent with live holder/acquirer. Attempted online force-unlock is unavailable. No old release removes a successor's lock. | U21, U23 |

Fault-injection barriers belong in the test harness/internal dependency seams, not production command flags that can skip approval or release another process's lock. Use the real transaction module and filesystem. A copied implementation, monkeypatched fake store or hand-created final canonical JSON is not sufficient for A11–A15.

### Build and completion gate

During implementation, run `npm run build` and the expanded `npm test`, plus explicit built CLI subprocess and real MCP stdio checks. Existing expectations that require unsafe age-based reclamation or exactly five legacy tools must be replaced with tests of the new intended contract, not silently deleted with no replacement. Keep unaffected parser/audit coverage where those read-only functions remain.

Attach a concise result table mapping A01–A15 to actual tests, platform/Node version and observed outcomes. A skipped case is an open requirement, not a pass. The first verification platform is this local Linux/Jcode environment. Other platforms remain untested unless exercised. No remote builds or source sharing are authorised.

Owner-reference fixtures are explicitly synthetic and validate mechanical binding only. New-process context tests validate persistence/transport, not genuine human usefulness or independent fresh-host understanding. Those higher acceptance boundaries remain in the actual pilot and later conversation package.

## 9. Review and authorisation boundary

Independent static review identified gaps in lifecycle records, deferred attachment/answer capabilities, init/repair replay, result semantics, accepted-only revision creation and mixed-row pagination. The document now makes those boundaries explicit. Review supports presenting this package to the owner, not a claim that implementation or acceptance tests have passed.

**The owner is being asked to approve one bounded build:** implement sections 3–6 within the files/responsibilities in section 2, follow section 7, and meet A01–A15. That approval would include the explicit-inventory/no-automatic-conversion choice, the offline-quiescent lock-recovery trade-off and the CLI-only owner-decision boundary for this first slice.

It would not approve Monokl work, actual user-scope onboarding, the real pilot, installed skills/global routing, conversion/deletion, publication or later packages. It would not turn all proposed details in the parent specification into an unlimited implementation grant. If this package changes materially after approval, show the changed scope before proceeding.

**Current authorisation: implement this package at `caffffa`, granted at `2026-10-12T08:16:20.810Z`.** P1–P5 remain accepted product/design decisions. This grant covers only the build and A01–A15 verification scope described above. It does not approve real-scope onboarding, Monokl, the actual pilot, migration, global setup changes or publication.
