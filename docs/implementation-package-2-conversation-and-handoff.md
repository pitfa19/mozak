# Implementation package 2: conversation, continuity and implementation handoff

**Status: approved to build within this document's bounded scope.** The actual owner message at `2026-10-12T17:48:24.249Z`, “approved”, answers the preceding explicit Package 2 build-approval request and approves this proposal as present at checkpoint `e5d80b9` (proposal bytes originally committed in `7da7e41`). This authorizes sections 3–9 repository/test implementation and isolated-trial preparation. It does not manufacture the live trial's separate owner direction, implementation, pause, resume or usability decisions, and does not authorize installation, migration, publication or global changes. The earlier `2026-10-12T14:03:25.600Z` approval was drafting-only. Historical proposed/unexecuted wording below describes the reviewed proposal, not evidence of implementation results.

## 1. Outcome and accepted expectations

**Outcome:** in an explicitly activated local MOZAK conversation, the owner sees what is completed, open and awaiting approval, clarifies only unresolved questions, approves a reviewed implementation package separately from its direction, and can later continue that same work without repeating the interview. A saved pause prevents continuation until explicit resume.

MOZAK stores understanding and permission. Existing host workflows write specifications and execute work. This package does not introduce a task runner.

### Accepted conversation decisions

| ID | Accepted expectation | Actual owner response, UTC |
| --- | --- | --- |
| Q1 | Opening a project automatically shows **Completed briefly → Open → Awaiting approval**, with one recommended next action. Do not repeat the full overview every turn. | `2026-10-12T13:27:36.009Z`, “1 yes 2 yes” |
| Q2 | Direction approval immediately starts focused grilling/specification, without reasking settled decisions. It does not authorise coding. | Same response as Q1 |
| Q3 | Include explicit implementation approval bound to the reviewed specification and bounded work, record it durably, and hand off to existing implementation workflows. | `2026-10-12T13:47:20.054Z`, “yes” |
| Q4 | Actual implementation approval starts bounded work immediately. A later requested session may resume unchanged approved work after checking saved authority and current state. | `2026-10-12T13:54:19.014Z`, “4 yes 5 yes” |
| Q5 | Prove the conversation with the real owner in an isolated local test project, followed by genuinely fresh-session recovery. No migration or global setup change. | Same response as Q4 |
| Q6 | Persist an explicit pause, stop further work promptly without undoing progress, and require explicit resume before continuation. | `2026-10-12T13:57:37.547Z`, “6 yes 7 yes” |
| Q7 | Record routine evidence quietly, report meaningful milestones briefly, and interrupt for decisions/blockers. Full overview remains available on request. | Same response as Q6 |

The consolidated confirmation at `2026-10-12T14:03:25.600Z` approves this understanding and **drafting**, not implementation. These references are provenance for the proposal, not synthetic runtime grant records.

### Included after separate build approval

1. A repository-owned conversation skill with explicit local activation, consistent presentation and durable clarification recovery.
2. Local specification attachment, separately bound owner implementation approval, withdrawal and derived execution eligibility.
3. Thin CLI/MCP extensions over the existing guarded store, with no owner-authorisation route in agent MCP.
4. Handoff, current-state rechecking, pause/resume and quiet progress instructions for existing host workflows.
5. Deterministic regression checks plus an actual owner conversation and fresh-host trial in isolated scratch roots.

### Excluded

- Monokl, adapters, accepted cross-scope connections, source discovery and the later `idea-transfer-pilot.md` experiment.
- Installed skill changes, global configuration/registration, automatic project discovery, onboarding actual user projects or migration of existing graphs.
- Task DAGs, schedulers, watchers, autonomous background work, model routing, general memory, transcript ingestion or a new execution engine.
- New dependencies/services, remote builds, network acquisition, issue publication, deployment, payments or credentials.
- Replacing existing `/grill-me` and implementation workflows, or asserting that a host convention authenticates a human or confines arbitrary shell tools.

## 2. Observed baseline and authority

Repository inspected: `/home/pitfa/Documents/mozak-v1`, clean checkpoint `236f48f543728a81d6cea41ca0bf93f09ad1f54b`. Package 1 implementation checkpoint `78896e902954336f4b2ad02fcf28442598d16b30` has a recorded successful build and 239/239 tests. That historical evidence is in `implementation-package-1-acceptance.md`; it is not evidence for package 2.

Fresh installed `mozak project context mozak` still selects `/home/pitfa/Documents/mozak`, with no ready goals and no validated context notes. Its config digest is `a50738be25634e57cd51284a0ba8c1b8a4434aaff2597e06ae777c5527ee3ddb`. This work follows the separate accepted design and package approvals. Do not change the legacy registration or create legacy feature records to disguise that boundary.

| Inspected source | Existing capability or gap |
| --- | --- |
| `packages/core/src/understanding.ts` | Closed `mozak.scope/v2` model. `downstreamSpec` and `implementationAuthorization` must be null. Decisions currently cover direction, rejection, reconsideration, pause/resume and outcome acceptance only. |
| `packages/core/src/review.ts` | Pure validated transitions and rich semantic context/review. Package 1 always reports `implementationAuthorized: false`. No clarification checkpoint, specification attachment or implementation grant. |
| `packages/core/src/scope-store.ts` | Scope CAS, receipts, ownership-safe cooperative locking, canonical-first publication, explicit repair and preserved local reads. Extend these guarantees rather than creating another writer. |
| `packages/core/src/api.ts`, CLI and MCP | Shared facade, explicit inventory, owner CLI convention and agent-only MCP. Closed payloads and real-process test patterns already exist. |
| Local Jcode help and bundled docs | Explicit skill loading is supported. `read` can load a repository file directly. `jcode --help` exposes `--cwd`, `--no-update`, `--resume` and `run`; it does not establish a stable user-message-ID API or guarantee that every new launch has no injected memory. |

Host evidence inspected through `jcode_docs` first: bundled `README.md` (“Misc.”) documents manual skill activation; `docs/HOOKS.md` distinguishes session creation, attachment and resume; `docs/RESUME_BEHAVIOR.md` describes restored sessions. No private transcript parser or new host plugin is justified by these facts. The real trial must verify actual activation and fresh-session isolation, not infer them from a launch command.

## 3. Implementation and storage boundary

### Allowed files

| Area | Allowed responsibility |
| --- | --- |
| Repository skill | New `skills/mozak-conversation/SKILL.md`, bounded references and examples underneath it. Use a distinct temporary name so the installed `mozak` skill is not shadowed. |
| Core | Extend `understanding.ts`, `review.ts`, `api.ts`, `scope-store.ts`, `errors.ts`, `index.ts`. A small `conversation.ts` or `handoff.ts` module may isolate pure rules and local specification inspection. `scope-index.ts` only if necessary for shared error/selection handling, not new discovery. |
| Interfaces | Extend `packages/cli/src/index.ts` and `packages/mcp/src/server.ts`, with transport entrypoints only if required for the new typed tools. No unrestricted mutation route. |
| Tests | Core/CLI/MCP tests and local process fixtures under their existing test directories. Scratch roots hold generated trial scopes and evidence, never actual user projects. |
| Documentation/build exports | This proposal, a new package-2 acceptance report, relevant README/docs and export/test-script metadata only. Do not rewrite historical package-1 evidence as if rerun. |

File splits may change within these responsibilities. A new dependency, runtime host integration, migration route, capability or write outside the repo/test scratch roots needs a scope revision. The user's later implementation preference is Haiku 5.5 high for smaller assignments, not a core routing requirement.

### Explicit format change, no migration

**Proposal:** new scopes use `mozak.scope/v3` and generated format-3 `MOZAK.md`. Keep the explicit local inventory format `mozak.local/v2` unchanged. The new reader rejects older scope formats clearly as unsupported; it never silently upgrades, rewrites or reinitialises them. Package-1 code remains available at its checkpoint for old test scopes. This is not a permanent dual-format runtime.

This format bump is a proposed engineering choice, not an already accepted owner decision. It makes the newly non-null authority fields and closed decision shapes explicit. New regression fixtures use v3 while retaining package-1 safety assertions. Add explicit refusal tests for old formats. Do not “fix” tests by deleting their behavioural guarantees.

Canonical JSON remains the sole durable authority. Store raw-byte digests, fresh storage revision identities and operation receipts using package-1 limits/protocol. Preserve existing README/AGENTS bytes. The bridge remains a projection, not a grant or a conversation database. It may summarise grant status but must not claim that a spec is currently readable without checking it.

## 4. Proposed closed model additions

All new objects are closed. IDs are nonempty, immutable and unique in the appropriate plan record namespace. UTC timestamps, digest encoding, finite limits, receipt rules and canonical serialization retain package-1 semantics. Generated IDs/times come from core, not caller fields. Whole graph and request limits remain 4 MiB and 1 MiB. Capacity refusal occurs before commit and never silently truncates reasoning or history.

### Clarification checkpoint, not a second plan

Add `discussion: null | Discussion` to each plan. `Discussion` has exactly:

- `id`, `updatedAt`, `acceptedRevisionId: string|null`, `pendingRevisionId: string|null`.
- `summary: string`, `stage: "clarifying"|"ready-for-spec"`, `questions: Question[]`.

A `Question` has `id`, `text`, `status: "open"|"answered"|"deferred"`, `answers: Answer[]` and `reopenings: {reason, recordedAt}[]`. An `Answer` has `summary`, `basis: "owner"|"inspection"`, `ownerRef: string|null`, `ownerMessageAt: UTC|null`, `evidence: Evidence[]`, and generated `recordedAt`. Owner basis requires a real reference/time; inspection basis requires nonempty evidence and null owner fields. Open questions have no effective answer. Answered/deferred questions have at least one answer, with the last answer effective. Deferral must explain its effect on the proposed package.

The agent may save this advisory checkpoint through a typed operation. Its presence, an answer's owner reference or `ready-for-spec` **never grants authority or edits accepted content**. It does not create decision-to-question graph edges in this slice. Semantic direction changes discovered while grilling become normal pending revisions and need direction approval.

On same-revision updates preserve existing question IDs, text and answer history. Additional answers append; reopening a settled question appends a generated-timestamp entry to `reopenings` and retains prior answers. For reopening, `status: open` permits retained answers but none is treated as effective. New questions may be added; dropping existing questions is refused. When revision bindings change, the old checkpoint remains readable but is labelled stale and is not used as current clarification or attachment input. The next explicit save rebases the checkpoint onto current revision IDs, carrying forward still-applicable answers and identifying changed assumptions in its summary. Normal Git history may retain the prior whole checkpoint; MOZAK does not claim to commit Git automatically. Do not pretend old answers approve new meaning.

The exact question input is `{id: string|null, text, status, answers, reopenReason: string|null}`. Null ID means new question: core generates the ID, `reopenReason` must be null and `reopenings` starts empty. A string ID must name an existing question, never a new caller-chosen ID. Answer input has exactly the stored Answer fields except `recordedAt`; an existing answer prefix must match all other fields and keeps its original times, while new suffix entries get generated times. Existing question reopenings are carried by core, never accepted from input. A nonempty `reopenReason` is required only for a settled-to-open transition, and otherwise must be null. Re-answering a reopened question requires an additional answer. Results return the saved checkpoint with assigned IDs in input order, so the next CLI/MCP save can reference them.

Use at most 32 questions, 16 short answers and 16 reopening records per question, and 2,000 UTF-8 bytes per summary/text/reopening reason. `ready-for-spec` requires no open question; explicitly deferred limitations must be represented in the specification before approval. These are proposed bounded storage limits, not a full transcript archive. A checkpoint's digest is calculated from its canonical object excluding generated `id` and `updatedAt`. A save with no semantic change is a receipt-recorded no-op rather than gratuitously replacing clarification identity.

### Specification reference and bounds

Add `specifications: Specification[]`; change `downstreamSpec` to a specification ID or null. Each immutable `Specification` has exactly:

`id`, `recordedAt`, `acceptedRevisionId`, `acceptedContentDigest`, `path`, `sha256`, `byteLength`, `discussionDigest: Digest|null`, `bounds`, `boundsDigest`.

`bounds` has exactly `summary: string`, `allowedPaths: string[]`, `excludedActions: string[]`, `outcomeChecks: {outcomeId, criterion}[]`, `limitations: string[]`. These are readable scope declarations, **not shell capabilities, a task list or a filesystem sandbox**. Paths are scope-relative explicit file/directory entries without glob interpretation. The host can use a declared directory for new files inside it; it may not treat a file entry as permission for siblings. Include every accepted outcome, or state explicitly in the corresponding criterion that this bounded package covers only a part and cannot complete the parent plan.

`boundsDigest` is the digest of canonical bounds. `discussionDigest` is null if no checkpoint was needed. Otherwise it must match the checkpoint inspected during attachment. Later routine clarification notes do not alone revoke a grant; material scope changes require a new specification/direction review. Descriptors retain historical accepted IDs/digests even after direction advances. Validate all currently resolvable bindings and retained record consistency without pretending historical plan content is still in the graph.

`path` resolves only to a regular UTF-8 Markdown file **inside the explicitly selected scope root**, maximum 256 KiB. Refuse absolute paths, `..` traversal, NULs, symlink components including the final file, unsafe special files and malformed UTF-8. Read and hash actual bytes with a bounded descriptor-based read. Do not fetch URLs, evaluate content, follow Markdown links or accept a caller-supplied digest as verification. A file changing during inspection is a conflict, not a valid attachment.

Attaching creates a fresh immutable descriptor and sets `downstreamSpec`; it does not copy the specification into JSON, create a grant or erase the previous descriptor. Existing workflows write the file first. Changed drafts can use another path so an approved artifact remains usable. Reattaching identical bytes still cannot revive an old permission identity.

### Implementation authority and history

Add `implementationAuthorizations: Authorization[]`; change `implementationAuthorization` to the current authorization ID or null. An immutable `Authorization` has exactly:

`id`, `decisionId`, `recordedAt`, `acceptedRevisionId`, `acceptedContentDigest`, `specificationId`, `specificationDigest`, `boundsDigest`.

Add decision purposes `approve-implementation` and `revoke-implementation`. Keep the common decision fields from package 1. The first additionally requires `specificationId` and `authorizationId`, and the second requires `authorizationId` and a nonempty reason. No unrelated outcome/evidence fields are legal on either. Core validates each new decision against its linked descriptor/authorization and its bound plan revision/content. `reviewDigest` is independently derived, not supplied proof of authority.

Only the owner action path may issue/revoke grants. Approval creates a new authorization, retains all old records and replaces the current pointer. Revocation records the decision and clears that pointer. It withdraws coding permission without changing the idea. The same actual owner-message reference/time cannot create another implementation decision; exact operation-receipt replay is the exception and creates nothing. A later fresh owner confirmation is required to grant again.

Approving a changed direction clears the current authorization and downstream-spec candidate pointers, while retaining their historical records and the stale-readable discussion checkpoint. **If the plan was paused, direction approval preserves its paused lifecycle and original pause decision reference.** A pause decision may consequently refer to the preceding accepted revision: validation requires it to be the retained effective pause, not to pretend it approved the new direction. Only an explicit resume against the current direction and current grant identity/null may open that plan. All other package-1 direction-transition rules remain unchanged. Pause preserves an existing grant but blocks use. Resume does not create, widen or restore a revoked/superseded authorization. Completion preserves history but blocks new execution. An unapproved pending revision, another spec candidate or an unrelated observation does not replace the accepted direction or revoke its still-applicable grant.

An old grant never becomes current merely because the plan text or spec bytes return to a previous hash. A spec mismatch suspends eligibility while present. Restoring the exact pinned bytes may clear that file-health block for an otherwise unchanged current grant, but never restores a cleared/replaced pointer or semantic revision identity. This distinction must be stated in results and tested.

## 5. Operations, approval binding and derived views

### Typed operations

Use existing mutation envelope, snapshots, receipts and errors. No client payload can set protected plan fields, IDs of generated records, dates or grant pointers directly.

| Operation | Closed payload beyond existing envelope | Actor and behaviour |
| --- | --- | --- |
| `save-discussion` | `planId`, `acceptedRevisionId`, `pendingRevisionId`, `summary`, `stage`, `questions` (the exact QuestionInput above, including null IDs for new questions) | Agent or owner. Bind current revisions, validate preserved question/answer history, stamp only new answers. Existing answer timestamps are matched from canonical state, not client authority. |
| `attach-spec` | `planId`, `acceptedRevisionId`, `path`, `bounds`, `discussionDigest` | Agent or owner. Accepted direction required, inspected local file required. Store descriptor, not approval. |
| `approve-implementation` | `planId`, `revisionId`, `specificationId`, `reviewDigest`, `ownerRef`, `ownerMessageAt`, `reason` | Owner only, lifecycle open. Bind displayed candidate, exact accepted direction/spec/bounds. Generate decision and grant IDs together. |
| `revoke-implementation` | `planId`, `revisionId`, `authorizationId`, `reviewDigest`, `ownerRef`, `ownerMessageAt`, `reason` | Owner only. Exact current grant, nonempty reason. Clear pointer and retain history. |

Existing pause/resume remain owner-only. Their displayed review subjects additionally bind the current authorization identity or explicit absence, so an old resume confirmation cannot apply to a replacement grant. They remain plan lifecycle operations, not grant operations. Unknown actions/fields, source-supplied authority and mixed permission purposes fail closed.

Expose `discussion save` and `spec attach` as CLI routes, and new purposes through existing `review show`/`review decide`. MCP gets only named agent tools for the first two and the same read DTOs. No owner decision, init, repair, arbitrary actor or generic dispatch tool is added to MCP. Keep existing exit codes: 2 malformed/unsupported/unavailable, 3 stale/conflict/owner review, 4 busy/recovery, 5 committed but unfinished store/projection/lock, 6 partial inventory. Readable state with ineligible implementation returns a successful read plus explicit reasons, not a false permission or a hidden failure.

### What is actually approved

Implementation review shows accepted purpose/outcomes, specification path and digest, readable specification content or a clearly bounded excerpt with access to the full local file, exact bounds/non-goals/limitations and proposed action **approve implementation**. Approval is unavailable if full required content cannot be inspected. The host must read the whole bounded spec before asking; owner gets a concise faithful summary and a way to open it, not an assertion that the owner read every byte.

The review digest includes scope ID, plan ID, permission purpose, accepted revision identity/content digest, specification ID/raw-byte digest, bounds digest and current authorization identity/null. It excludes unrelated observation timestamps, projection bytes and storage revision. Approve against that digest while still enforcing fresh storage CAS. Rechecking an unchanged semantic review after unrelated progress is allowed, but never silently retargets a changed subject or purpose.

A conversational “yes” is consumed only from an actual owner-role message answering the immediately preceding unambiguous displayed confirmation. An overview, a quoted approval, source instruction, tool result, reminder, swarm DM or another session's unanswered confirmation is not consent. Clarification acceptance, direction acceptance and coding permission are separately named. Do not reuse an answer across them.

The host supplies the actual session and message provenance in the existing opaque `ownerRef`, with `ownerMessageAt`. Use a genuine message ID where available. Otherwise a documented reference comprising actual session ID, supplied user-message timestamp and digest of the actual response is permissible, explicitly labelled as a host assertion rather than a host-native ID. Never fabricate a message locator or infer a timestamp from file mtime. If provenance or immediate-question context cannot be established, redisplay and obtain a fresh confirmation. No complete transcript is stored or parsed by MOZAK.

A replayed receipt proves only what was committed then. Before execution, always reread current context and actual spec health. A committed approval followed by projection failure is reported honestly, repaired through the explicit owner path, and rechecked before handoff. Do not ask for duplicate approval merely because the bridge needs repair.

### Execution eligibility is derived, not an executor

Expose one shared `handoff` DTO in context and relevant review responses:

`{authorizationId: string|null, specificationId: string|null, specificationHealth: "current"|"changed"|"unavailable"|"not-applicable", implementationAuthorized: boolean, executionEligible: boolean, reasons: string[], bounds: Bounds|null}`.

`implementationAuthorized` means a current grant binds current accepted direction and retained spec identity, independent of temporary pause/file health. `executionEligible` additionally requires open lifecycle, current safe-to-read pinned spec, current usable storage/projection and no unresolved material review block. Missing grant is not an error. A paused but granted plan is authorised yet ineligible. Missing/changed spec leaves canonical context readable, with an explicit health reason. Never return a cached affirmative `executionEligible` without the required file check.

The execution-review predicate is **not** the raw package-1 `reviewNeeded` boolean. For the current accepted revision, `active-outcome-challenge` blocks only when that outcome has no existing `accept-outcome` decision bound to its exact current evidence and challenge set. Clear it through evidence-backed supersession of the challenge, that existing bound owner acknowledgement, or a separately accepted revised direction. A challenge with no qualifying supporting evidence cannot use outcome acceptance as a workaround: it remains blocked pending correction or revised direction. Absence of completion evidence alone does not block ordinary implementation. `completion-evidence-withdrawn` and `outcome-acceptance-stale` remain visible historical diagnostics; completed lifecycle already blocks execution. Apply this same predicate before implementation approval, refusing with `owner-review-required` rather than issuing an immediately unusable grant. Unrelated observations do not affect it. The host still assesses newly observed facts for safety/scope and stops if unsure; no general risk-override engine is added. This DTO is point-in-time permission information, not a capability token or a guarantee that another process cannot change state a moment later.

Derive an Awaiting approval implementation row only when the latest spec candidate binds the current accepted revision and has never been the subject of an implementation authorization. Retain outcome and pending-direction rows; none hides another. Candidate rows for a paused plan show the pause and never imply automatic resume. Revocation clears the current grant pointer. It clears `downstreamSpec` only if that pointer names the revoked grant's own specification; a distinct candidate already attached before revocation remains an unapproved proposal. Descriptors remain discoverable as history, not rejected or deleted. **A new `attach-spec` mutation creating a fresh descriptor is the sole route to requeue the revoked specification**, even for identical bytes. A read-only review request never persists or requeues anything. The distinct pending candidate may receive its own later explicit approval, never inherit the revoked grant. Superseded/revoked authorizations remain historical, and completed plans do not acquire new execution requests automatically.

Keep deterministic group/date ordering and five-part composite keys. Use `rowKind: "implementation"` plus specification ID for the new review row, distinct from outcome/revision IDs. Counts distinguish plans from review rows. Extend cursor/version handling so a pre-change token is refused, not decoded with a different meaning. All-scope inventory is still not cross-scope idea traversal.

## 6. Storage, file races and recovery

Store-specific spec inspection occurs at the IO boundary, not by letting pure review transitions read arbitrary paths. Core validation still controls all bindings. Under the existing scope lock: verify request CAS and bridge token, inspect only the files required by that operation, validate the transition and derived views, publish canonical, then project, record actual result and release safely. Keep package-1 raw-byte/manual-edit checks, offline-only lock recovery and no online age reclaim.

Inspection dependencies are explicit: `attach-spec` reads only its supplied candidate file; `approve-implementation` reads the exact selected current candidate. Context/handoff checks current-grant health independently of candidate health, while implementation review checks the candidate and reports the current grant separately. Pause, revoke, resume, discussion save, observations and direction decisions do **not** require readable spec bytes, so unavailable artifacts cannot prevent stopping or recording understanding. Resume can succeed while execution remains ineligible. Mutation responses that include handoff health convert optional file failures into diagnostics rather than masking the committed result. `specificationId`/`specificationHealth` in the handoff DTO always refer to the current grant's artifact, not a different pending candidate; candidate health lives alongside its review subject.

For a context/review read requiring spec health: read canonical, inspect the applicable candidate/current-grant file(s), reread canonical. Retry on canonical revision change using the existing bounded policy, otherwise return busy. Refuse a changing spec during its bounded inspection. Distinguish absent, unavailable and changed, never invent an absent file token after an IO failure. Auxiliary spec failure does not destroy otherwise valid canonical context or hide unrelated plans.

Do not read historical spec files merely to validate old grant records. Validate their retained references/digests internally. Reads inspect only the currently displayed candidate and current grant as needed. No external file-health result is persisted by a read, and a missing spec cannot create a new canonical revision or revoke a grant automatically.

All grants/spec descriptors/checkpoints live in the same JSON transaction and receipt scheme. There is no graph-plus-spec atomicity: attachment does not write a spec, and arbitrary external editors do not take the scope lock. Descriptor checks and graph/spec/graph reading reduce cooperative races but cannot prevent all direct-editor changes or prove absence of an ABA file rewrite. Advertise a checked snapshot, not absolute non-overwrite, confinement or durable execution.

The host rechecks eligibility immediately before handing off and between bounded editing/execution batches, and after any pause, reload or material finding. Already-running shell processes may not be instantly interruptible. Stop launching new batches when paused, request cooperative worker stops, retain actual partial progress, and report any outstanding operation. Do not kill unrelated processes or roll back owner changes automatically.

## 7. Conversation skill contract

### Explicit local activation only

Use the repository `skills/mozak-conversation/SKILL.md` via an explicit `read`/load request with its exact path. A named skill load is acceptable only if its returned base directory matches the repository copy. Do not install, symlink, copy over or shadow `~/.claude/skills/mozak`, modify global instructions or rely on auto-discovery. Use the built repository CLI with an explicit isolated inventory, not the installed bare `mozak` command for v3 operations.

Until a later rollout, “opening a project shows the overview” is proven **inside this explicitly activated local conversation**, not claimed for every installed host session. The new skill explains this temporary boundary and delegates detailed interviewing to the existing grilling skill. It must not silently publish an issue because an existing `/to-spec` default happens to do so; this package uses local documents only.

### Host behaviour

| User event | Required response and next step |
| --- | --- |
| Open/work on an explicit project | Read context and plans; show Completed → Open → Awaiting approval once, coverage/continuation honestly, and one recommended next action. Unresolved scope requires selection, not guessing. |
| Approve direction | Persist the correctly bound decision, then immediately ask only the next unresolved detailed question or draft the spec if nothing remains. Do not ask for permission to begin the already requested clarification. Exception: a paused plan stays paused and does not automatically begin further work; explicit owner-requested discussion may occur without granting resume or coding. |
| Approve implementation | Persist approval, check the current grant/spec, then start the bounded existing workflow in that turn. No redundant “shall I start?”. Failures/blockers are explicit. |
| Later request to continue | Recover saved direction, checkpoint, spec, grant, pause and evidence. Resume one unambiguously selected eligible plan without repeating approval; ask selection if several are eligible. A status-only request remains read-only. |
| Pause/resume | Stop new work immediately on clear pause intent. Persist owner pause; explicit resume changes lifecycle only after its bound confirmation. It never grants missing or widened work. |

For restrictive pause intent, an unambiguous “pause this plan” is already an owner instruction. Stop host work before any storage attempt. The host may mechanically derive the current pause review digest and persist that same restrictive instruction with its real provenance, clearly recording that the instruction preceded this generated review. This exception exists only for stopping the identified work, never approval, resume or broadening. If the plan cannot be identified, stop the current host work and ask which plan to persist. If saving fails, say **stopped here, pause not saved** and keep this host stopped; do not claim other sessions are blocked. A fresh process cannot recover an unsaved intent, which is an explicit limitation requiring repair or operator intervention.

Checkpoint updates happen after a meaningful answer, a clarified boundary or a handoff point, not every token/tool call. Store concise reasons, answer provenance and unresolved questions, not internal chain-of-thought or full messages. Do not treat a checkpoint summary as authority to mutate accepted expectations.

Routine evidence uses existing observations. Brief milestone output names the delivered outcome and current blocker/next step. A test pass is not owner acceptance, and a completed downstream task does not automatically complete the high-level plan. Use package-1 outcome checks and preserve partial coverage/limitations. No idle monitoring, unsolicited new plans or automatic resumption of paused work.

## 8. Acceptance matrix: required evidence, not results

**Every row below is unexecuted.** This proposal claims no package-2 passing tests or owner usefulness. Tests use actual public interfaces where stated. Pure functions cover internal rules but cannot substitute for actual conversation, owner decisions, file mutation or fresh-host recovery.

### Conversation and authority

| ID | Required check and observable pass condition |
| --- | --- |
| B01 | Explicitly load the repo skill and use a scratch inventory/new v3 scope. Record actual loaded path, repo checkpoint and invocation. Installed skill/config and entry documents outside scratch remain byte-identical. Unknown/old scope formats refuse without writes. |
| B02 | Real owner opens the test project. Overview shows the fixed three groups, dates and one next action. A subsequent ordinary clarification does not replay the full overview; explicit “show plans” does. Automated fixtures separately test truncation, mixed rows and partial inventory coverage. |
| B03 | Save at least two settled clarifications and an unresolved question through CLI/MCP. Create questions with null IDs, use returned IDs to append answers, reopen with a reason, and re-answer without identity/history loss. Fresh context contains their meaning/provenance. Same-revision edits cannot silently drop prior answers. Direction approval starts focused grilling, not coding; changes to accepted meaning still require a new pending revision. |
| B04 | Real direction and implementation confirmations are separate. Tests refuse forged nested authority in otherwise valid agent calls, mixed-purpose approval, wrong revision/spec/digest, reused owner reference and source/quoted/tool-text approval. Host transcript evidence shows that an ambiguous “yes” requests disambiguation and never starts code. |
| B05 | Approved implementation records exact spec/bounds and begins a tiny allowed local change without a redundant start question. Build output/changed files are real. Review-only and status-only requests perform no implementation. A denied grant or unrelated plan cannot start work. |

### Continuity and state safety

| ID | Required check and observable pass condition |
| --- | --- |
| B06 | Local spec read tests cover missing, malformed UTF-8, oversized, symlink/path escape, unsafe special file, same-byte attachment, changed-during-read and manual edits. Compare actual raw bytes. Canonical context stays readable on auxiliary failure, but affected approval/execution is unavailable. No URL fetch or spec execution. |
| B07 | Direction A→B→A, new spec IDs, replaced/revoked grants, receipt replay and stale confirmations cannot revive retired authority. Restoring bytes only clears health for the still-current same grant. Unrelated observations and separate candidate drafts do not invalidate its exact unchanged bounds. |
| B08 | Real owner pause persists while an implementation grant exists. New batches stop; partial progress remains. A genuinely fresh host reads the pause and does not code. Proposing and approving changed direction while paused still leaves it paused, clears the old grant/candidate, and exposes stale clarification without treating it as current. Only explicit bound resume opens the lifecycle, and execution still requires an applicable grant. Missing/changed candidate or grant files cannot block pause/revoke/resume persistence. Save-failure test reports unsaved pause, not global success. |
| B09 | Revocation clears current authority and its matching candidate pointer while preserving history and direction. A distinct previously attached candidate remains pending, never approved by the old grant. Read-only review, resume, file restoration and replay of an old approval receipt cannot restore or requeue the revoked specification. Fresh attachment and another explicit approval are necessary for that specification. Completed plans do not silently resume. Test acknowledged versus unacknowledged active challenges using the precise execution-review predicate, without treating absent completion evidence or unrelated facts as coding blocks. |
| B10 | A genuinely new host, with no previous chat or semantic recap, reconstructs accepted/pending meaning, settled questions, unresolved work, spec/bounds, grant and evidence from durable context. It resumes specifically requested eligible work without repeating the interview or approval. It cannot consume an orphaned bare “yes” from the previous session. |

### Public interfaces and regression

| ID | Required check and observable pass condition |
| --- | --- |
| B11 | Built CLI and fresh stdio MCP return equivalent semantic discussion/spec/grant/context/review DTOs for the same state, including unavailable spec diagnostics. MCP cannot dispatch owner purposes. Valid nested protected-field attacks leave graph/bridge bytes unchanged; positive controls succeed. |
| B12 | Real subprocess tests preserve package-1 CAS, safe lock ownership, slow-live-holder behaviour, offline recovery, receipts, raw-byte manual conflict and canonical-first interrupted projection. Add crashes after grant commit and receipt replay plus explicit repair. Recheck current eligibility before execution. |
| B13 | Rebuilt full repository tests pass. Deterministic new review ordering/cursor tests include mixed UTC precision and new implementation rows; inspect no stale dist. No removed package-1 safety assertions, migration, dependencies or hidden global changes. |
| B14 | Actual owner conversation is useful: the owner confirms the overview, focused questions and handoff fit expectations. Record concise actual feedback and any corrections, not a synthetic “ownerRef” offered as real approval. Meaningful milestones are brief; routine evidence does not prompt constant approval. |
| B15 | Acceptance report maps Q1–Q7 and B01–B14 to exact commands/processes or actual owner/session references, checkpoint, observed result and limitations. Unavailable user/host isolation leaves the relevant row open. Automated greens alone are not package completion. |

### Bounded real-host trial protocol

1. **Prepare locally after build approval.** Create a new scratch project with ordinary fixture README/AGENTS, an explicit local inventory and no secrets. Select a harmless tiny deliverable, such as a pure string-formatting function plus local tests. No network, external service, actual project migration or deployment. Record host version, loaded skill path and repo checkpoint.
2. **Discuss with the actual owner.** Open the test project, show review groups, obtain real direction approval, clarify a small ambiguity, persist answers and draft a local spec with explicit file bounds and tests. Ask separately for its implementation permission. Scripted synthetic owner references are acceptable only in automated tests, never as this step's evidence.
3. **Exercise work and pause.** On real implementation approval, begin bounded work. At an agreed safe intermediate point the owner pauses before the whole outcome is complete. Persist partial evidence and the pause. Record whether any tool was already in flight. Do not manufacture a pause message to finish the checklist.
4. **Recover in a genuinely fresh host.** Use a new session, not resume, fork, compaction or a worker inheriting this conversation. Bootstrap with only skill/CLI/inventory paths, scope/plan identifiers and the current user request. No answer recap, old transcript, swarm handoff, memory search or saved semantic summary outside the graph. Verify actual initial context; if host memory injection leaks answers, the run is contaminated and must be repeated with supported per-session isolation, or reported blocked without changing globals. Recover the pause, obtain actual explicit resume, and finish in unchanged bounds without another implementation approval.
5. **Record outcome honestly.** Exercise normal outcome verification and obtain actual owner usability feedback. Capture minimal attributable excerpts/references, artifact/test digests and isolation observations in the acceptance report. Do not store full private transcripts. No trial result is evidence of Monokl transfer usefulness or completed global rollout.

A later requested, eligible unpaused recovery path is also required by B10: use another clean session or a separate bounded trial phase before completion. A fresh CLI process is not a fresh conversational host. If host creation/isolation cannot be verified with available local tools, the actual owner may open a new session using a bootstrap prompt containing only the allowed pointers; do not invent unsupported flags or pretend a resumed session is fresh.

## 9. Implementation sequence and approval boundary

| Slice | Deliverable and gate |
| --- | --- |
| 1. Model and rules | Closed v3 types, discussion/spec/grant transitions and derived DTOs, red/green tests including replay/ABA and history consistency. No execution side effects. |
| 2. Store and interfaces | Safe local spec inspection, public operation routes, receipts and real CLI/MCP parity, retaining package-1 recovery guarantees. |
| 3. Repository skill | Explicit activation, focused grilling, permission checks, bounded handoff, pause handling and concise views. Document trust and local-only limits. |
| 4. Proof | Full rebuilt regression suite, independent authority/expectation review, real owner trial and genuinely fresh-host recovery. Fix material findings before claiming completion. |

Separate build approval would authorise these repository/test edits and preparing the isolated trial, not manufacture the trial owner's individual direction, implementation or resume decisions. It does not authorise publishing, installation, migration, Monokl or changes to global permissions.

If deterministic implementation passes but actual owner participation or host isolation is unavailable, report **implementation ready, live acceptance incomplete** and retain the full open scope. Do not quietly redefine success, mark the trial waived or ask for coding approval repeatedly. The owner can explicitly revise scope; otherwise continue safe authorised work and return to the outstanding trial when the blocking input is available.

**Owner review request:** approve or revise this bounded implementation package at its reviewed Git checkpoint. In particular, the proposed engineering scope includes a new scope format without migration, concise durable clarification, verified local spec references, separate historical implementation grants/revocation and an isolated actual-host acceptance run. No implementation is authorised by the existence or commit of this proposal.

### Draft verification record, October 12, 2026

Two independent read-only design reviews identified contract gaps in new-question inputs, pause preservation through direction changes, revoked-spec requeue and per-operation file-health dependencies. Those gaps and their acceptance cases were clarified above. A separate final read-only verifier checked the corrected proposal and the paused-conversation exception, reporting **ready for owner review**, not build approval. Document checks verified Q1–Q7/B01–B15 presence, explicit unexecuted status and clean diff formatting. The accepted brief and legacy config hashes remained unchanged. Only this proposal was added. No package-2 code, build, runtime test or live trial was executed during drafting.
