# Idea-oriented MOZAK and simple Monokl

**Status: owner design choices P1–P5 approved individually, completed at `2026-10-11T23:28:21.909Z`. Remaining engineering details are proposals for implementation planning. No implementation, pilot execution, migration or publication authorised.**

This specification implements the expectations accepted at **2026-10-11T23:09:39Z**. The owner subsequently requested the detailed specification, not coding. Accepted product requirements are marked **R**. Concrete engineering choices made in this document remain **proposed** except for the explicitly recorded P1–P5 approvals below, and are not retroactively attributed to the owner. Approval of this document must name whether it approves the design only or also authorises a bounded implementation package.

## Problem Statement

I work across projects and research topics. I need an agent to understand my direction, explain what is open, remember why I accepted or rejected an idea, and continue approved work without another context interview. Multiple task plans and copied versions made that harder rather than easier.

I also want to give an agent a source and find out how its mechanism could help my work. A summary, a generic connection between projects, or a checklist marked “translated” is not enough. I need a concrete adaptation proposal with evidence and limitations, without adopting a deep-research platform or authorising experiments implicitly.

## Solution

**MOZAK owns understanding and review. Monokl produces mechanism-grounded adaptation proposals. The host agent reasons and uses existing implementation workflows.**

MOZAK's skill presents **Completed briefly → Open → Awaiting approval**, consistently. Discussions create drafts without rewriting accepted direction. Direction approval starts detailed planning. Implementation approval is a separate, scoped decision. Completion means the expected outcome was verified.

Monokl is one simple entry skill with a small deterministic packet contract. The host reads and reasons about the source. Optional adapters supply source material, project context and draft delivery. No fixed research stages, model service, scheduler or compulsory vault belongs in its core.

### Accepted invariants

- **R1 Understanding, not tasks:** one shared JSON graph per scope, several high-level plans, expectations, observations, decisions and questions. Detailed execution tasks remain downstream.
- **R2 Owner authority:** observations update automatically. New direction, changed constraints and reversed decisions need approval. A stored draft is not a grant or an established fact.
- **R3 Useful transfer:** inspect mechanisms and assumptions, adapt to the target, cite evidence, expose uncertainty and allow no useful fit. Experiments need separate approval.
- **R4 Scope and simplicity:** explicit cross-scope connections through the bridge, ordinary note links unrestricted, standalone Monokl, optional external adapters and on-demand operation.
- **R5 Honest progress:** dated decisions, meaningful change review, verified outcomes, remembered rejections, concurrency protection, and fresh-session recovery.

## User Stories

### Reviewing and discussing work

1. **U01.** As an owner, I want a fresh session to recover my expectations, decisions and open questions, so I do not repeat the previous conversation.
2. **U02.** As an owner, I want current-scope and grouped all-scope plan views with dates, so I can understand what is done, open and awaiting me.
3. **U03.** As an owner, I want to discuss and revise one plan without changing its accepted version, so exploration does not alter authorised work.
4. **U04.** As an owner, I want direction approval separated from implementation approval, so “yes” to an idea does not launch coding.
5. **U05.** As an owner, I want several independent high-level plans in one scope, so I can explore alternatives without maintaining separate planning systems.

### Progress and continuity

6. **U06.** As an agent, I want to record findings and evidence without repeatedly asking permission, so the understanding stays current.
7. **U07.** As an owner, I want downstream outcomes linked back to expectations without copying task lists, so MOZAK remains high-level.
8. **U08.** As an owner, I want completed work backed by the agreed outcome, with my review for subjective acceptance, so “done” is meaningful.
9. **U09.** As an owner, I want rejected ideas retained with a dated reason but hidden normally, so agents do not repeatedly propose them.
10. **U10.** As an owner, I want source changes assessed for actual impact, so timestamps do not silently invalidate accepted plans.

### Understanding and adapting sources

11. **U11.** As an owner, I want Monokl to explain how and why a source works, so I receive more than a summary.
12. **U12.** As an owner, I want a named target to constrain the analysis, so unrelated projects are not investigated.
13. **U13.** As an owner, I want destination discovery when I omit a target, so useful applications are found across my configured scopes.
14. **U14.** As an owner, I want an evidence-grounded adaptation and a proposed smallest test, so I can evaluate whether it is worth pursuing.
15. **U15.** As an owner, I want no-fit, incomplete-access and uncertain results to be explicit, so weak analogies do not become confident proposals.

### Integration and safe boundaries

16. **U16.** As a standalone user, I want Monokl to work with supplied source and target context, so MOZAK installation is optional.
17. **U17.** As an owner, I want useful Monokl results to enter Awaiting approval as drafts, so they are not lost in chat.
18. **U18.** As an adapter author, I want small data contracts without approval or execution authority, so integrations cannot take over the core workflow.
19. **U19.** As an owner, I want source text and repository instructions treated as untrusted evidence during analysis, so they cannot grant permissions.
20. **U20.** As an owner, I want both tools to operate only on request or within authorised work, so there is no unsolicited monitoring or proposal stream.

### Integrity and rollout

21. **U21.** As a concurrent agent, I want stale writes and stale approvals refused, so another session's work is not overwritten.
22. **U22.** As an owner, I want ordinary note links preserved while declared idea connections remain explicit, so adopting MOZAK does not require reorganising my vault.
23. **U23.** As an owner, I want duplicate identities, inaccessible inputs and interrupted writes reported accurately, so failures cannot look like success.
24. **U24.** As an owner, I want source access and resource use bounded, so one idea analysis does not become an unapproved crawl or experiment.
25. **U25.** As an owner, I want a real end-to-end pilot and safe direct migration, so a clean demo does not hide lost evidence or broken global routing.

## Implementation Decisions

The following contracts are proposed engineering decisions. They preserve R1–R5 but still require design approval.

### D1. Product boundaries and responsibilities

| Component | Owns | Does not own |
| --- | --- | --- |
| MOZAK core | Scope understanding, plan revisions, review records, declared connections, validation, guarded storage and derived views | Model reasoning, task scheduling, experiments, general-purpose memory |
| MOZAK CLI and MCP | Thin public read and operation-specific mutation interfaces over the same core | A second state store or a raw unrestricted JSON replacement API |
| MOZAK skill | Consistent presentation, discussions, reading context, recording actual owner decisions and handoff to existing workflows | Inventing approval or keeping authoritative state only in chat |
| Monokl skill and packet validator | Source-mechanism analysis contract, target adaptation result, evidence and uncertainty validation | Mandatory research stages, internal model routing, crawling engine or experiment runner |
| External adapters | Bounded source/context acquisition and submission of unapproved proposals | Marking approval, accepting connections, changing expectations or executing work |

The model and tool-use loop stay in the existing agent host. A list of analysis obligations is not a fixed stage runner. The agent may inspect more deeply where the source requires it, within the authorised bounds.

### D2. One authoritative graph, one readable bridge

**Proposal:** the per-scope JSON graph is authoritative for understanding, plan content, observations, approval references and connection records. The Markdown bridge is a deterministic projection and entrypoint, not another independently editable plan database. Existing human and agent instruction documents are preserved.

The bridge exposes scope identity, a concise plan summary, links to local details, and **accepted cross-scope connection declarations**. Cross-scope traversal begins from those declarations. Draft connection candidates are not graph edges. A raw external source can remain a provenance reference without becoming an invented scope.

This resolves the older contradiction between “one living plan in Markdown” and the later accepted JSON graph. No automatic two-way synchronisation is proposed. If the owner wants Markdown to be independently authoritative, this decision must be redesigned before implementation.

Use an explicit new bridge format and a versioned graph contract. The current Markdown-only format must not be silently treated as the new model. Unknown formats fail with an explanation, not a best-effort rewrite.

### D3. Domain vocabulary and data contract

| Term | Meaning and minimum content |
| --- | --- |
| Scope | A project or topic with stable identity, kind, entrypoint and locally resolved location. Duplicate identity is an error, not first-match selection. |
| High-level plan | An idea being considered or pursued, with purpose, expected outcome, constraints, non-goals, rationale and unresolved questions. It is not a task, priority queue or goal-DAG node. |
| Understanding | Accepted plan content plus dated decisions, observations, evidence references and unresolved questions. Each observation distinguishes observed, inferred and unverified content. |
| Revision | The semantic content under review, identified by a unique revision identity and a content digest. Reaccepting identical text creates a new revision identity rather than reviving an old grant. There is at most one accepted revision and one editable pending revision per plan in the initial design. Git retains older versions. |
| Connection | A specific idea-level relationship, its source and target context, relevance, required adaptation and uncertainty. Acceptance is independent of the truth of its claims. |

The scope envelope contains a format discriminator, identity, plan records, connection records and storage metadata. It does not contain an executable task DAG.

The local graph is made of explicit, stable references within that understanding: an observation can support or challenge an expectation, a decision can answer a question, and an evidence-backed finding can motivate a proposed plan revision. These are reasoning relationships, not task prerequisites. Every relationship has typed endpoints and a short rationale. A reference to missing material is surfaced as unresolved, not silently dropped. No extensible ontology or generic knowledge-store API is required for the initial scope.

**Plan content:** stable plan identity and human title, purpose, expected outcome, constraints, non-goals, rationale, open questions and source references. A plan may have accepted content, pending content or both. A new draft has no accepted version. The pending revision stores its base accepted revision identity and digest so a proposal cannot quietly target a later accepted revision. Storage revisions change on every mutation, while semantic revision identities change only when plan meaning is revised or accepted.

**Progress and review:** dated observations and evidence references, owner decision references, downstream specification reference and digest, implementation authorisation reference, outcome verification and any rejection or pause reason. Store short explanations, not full chat transcripts or duplicate implementation tickets.

**Evidence reference:** source locator, local anchor or section, observed source version or digest where available, observation time, what was read or run, and limitations. Structural validation confirms that required references exist. It cannot prove semantic correctness or that an experiment actually happened.

**Dates:** creation and material updates use explicit UTC timestamps. Owner decisions and completion carry their own dates. Git provides history, not invented node creation dates. Missing legacy dates stay unknown unless a reliable record exists. Do not substitute file modification time and pretend it is creation time.

**Identity:** use explicit scope references and stable plan or idea identifiers as structured data. Do not revive colon-delimited scope-to-goal dependencies or compute next work through task topological sorting. A suggested next action is an agent interpretation, labelled with its rationale and authority boundary.

### D4. Approval and lifecycle contract

| Event | Preconditions | Durable result and permitted next step |
| --- | --- | --- |
| Propose or discuss | Source/request is in bounds and target is known | Create or revise pending content. Preserve accepted content and existing authorisations. |
| Approve direction | An actual owner decision names the displayed plan and semantic revision | Accept that direction and record the decision. Detailed clarification/specification may start. No coding grant is created. |
| Approve implementation | An actual owner decision identifies the accepted plan revision, reviewed specification digest and bounded work | Record implementation authorisation for exactly that scope. Resume within it without repeated approval. |
| Record observation | Operation contains evidence or clearly labelled inference, not protected-content changes | Update facts, questions and progress. Do not alter expectations or fabricate an owner decision. |
| Complete | Outcome evidence covers the agreed expectation, with owner acceptance when subjective | Record completion date, verification and limitations. A finished task list alone is insufficient. |

A revised direction needs its own approval. Until then, the accepted version remains authoritative. If that revision is accepted, an old implementation grant does not automatically cover the changed expectations. A factual progress update alone does not invalidate an otherwise unchanged approval.

Connection acceptance is an explicit owner decision over the displayed connection revision and its publication into the bridge. Approving plan direction alone does not accept every suggested connection. A combined confirmation may cover both only when both exact changes are displayed and named. The connection remains a draft until that decision is recorded.

Rejection records the reason and date without deleting history. Reconsideration requires an explicit request or materially new evidence with an explanation of why it matters. A changed file hash alone is not material novelty and is not permission to requeue a rejected idea.

A proposal may remain open without being actively worked on. A pause must have an explicit reason and cannot be mistaken for completion. Contradictory evidence can block the affected next action without rewriting the accepted plan or erasing earlier verified outcomes.

**Confirmation binding:** a conversational “yes” applies to the immediately displayed, unambiguous question and revision. A general overview with several proposals cannot turn one “yes” into approval of all of them. CAS protects the write, while unique semantic revision identities, content digests, specification digests and permission purpose bind the approval's meaning. Returning to old text must not resurrect old approval automatically. Neither hashes nor an agent-supplied owner flag prove that a human consented.

The trusted host must pass an actual owner-decision reference through the owner-action path. In the initial conversational implementation this remains a host/agent trust boundary, not a cryptographic guarantee. Source adapters cannot access that path. Direct filesystem edits remain possible and must never be advertised as prevented by the CLI.

### D5. Review view and conversation behaviour

The same semantic view drives the skill, CLI and MCP. Group order is fixed:

1. **Completed:** short outcome and completion date, with evidence available on expansion.
2. **Open:** accepted plans with current understanding, what remains unresolved, any block and the suggested next action.
3. **Awaiting approval:** new proposals, pending revisions or explicit owner-review requests, with the exact decision being requested.

A plan with an accepted version and a proposed revision has one identity. Its pending-revision row points to the accepted plan rather than looking like an unrelated second plan. Counts must distinguish plans from pending reviews.

Default to the explicitly discussed scope. If there is no resolvable current scope, ask instead of guessing. The all-scope view groups by scope and exposes coverage errors. Rejected items are hidden by default and available on request.

For long lists, display bounded groups with an explicit total and continuation indicator. Never imply that a truncated list is complete. The initial proposed presentation limit is five visible items per group. The owner can request the rest or an expanded full view.

Discussing a plan first shows the accepted expectation and proposed change. Use focused questions only for unresolved decisions. Look up environmental facts rather than asking the owner to supply them. Do not rerun a complete interview for an unchanged, already-approved plan. Detailed implementation questions belong to the existing grill/spec workflow, not a second workflow engine in MOZAK.

### D6. Connections, source changes and graph ownership

Keep the existing relationship vocabulary, interpreted explicitly:

| Relation | Direction and interpretation |
| --- | --- |
| depends-on | Consumer to prerequisite scope or idea. A change at the prerequisite may require consumer review. |
| derived-from | Adapted idea to originating context. Origin changes are review signals, not transferred authority. |
| informs | Source to influenced target. Source changes may affect that target. |
| translates-to | Source idea to proposed or accepted target adaptation. Only accepted declarations enter the traversable graph. |

Each connection names the idea, relevance at both ends, required adaptations, evidence and open assumptions. “These projects are related” is insufficient. Open assumptions in a **draft** are valid uncertainty, not corruption of the whole scope. Accepting a proposal is not proof that every scientific or technical assumption has been tested.

Ordinary note links neither become accepted scope edges automatically nor invalidate a scope. Read local notes as evidence only when relevant to the request. A declared connection can refer to an unavailable local clone, in which case the result says unresolved or cannot assess, not up to date.

Change detection reports the exact comparison basis. On initial use without a trustworthy review baseline, report not yet reviewed. The host reviews relevant differences, records likely impact or uncertainty, and preserves approved direction. No background watcher, cross-project auto-implementation or automatic truth propagation is added.

### D7. Guarded storage and recovery

Retain the existing compare-and-swap boundary, but use a **scope-level** transaction owner for the graph and bridge projection. The mutation input includes a base graph storage revision/hash and the bridge snapshot observed by the caller. Re-read both under the scope lock before committing. Hold that same lock through projection publication so an earlier writer cannot publish after a later writer has committed.

1. Validate the typed operation and its permission class against the current canonical graph. Refuse stale snapshots or conflicting manual edits.
2. Atomically replace the canonical JSON. Store the previous bridge hash as projection-recovery metadata in this new graph state.
3. Deterministically generate the new bridge, including the committed graph's digest, and replace it atomically only if the bridge still matches the expected prior snapshot.
4. Release the lock and report the actual result. If the graph committed but the projection failed, report **state committed, bridge stale**, with the committed digest. Do not report a complete success or pretend both files changed atomically.
5. A later explicit repair may regenerate the bridge only when its bytes still match the recorded prior projection or the owner resolves a manual edit. Read-only checking never repairs or overwrites files.

The stored bridge hash is the **previous** bridge hash, not the new one, avoiding a circular content digest. A retry with the same operation identity recognises an already-committed mutation and does not duplicate the proposal, decision or observation.

The initial design uses a whole-graph storage revision and digest for the projection. Any canonical update briefly makes an older bridge stale until publication completes. This is intentional and must be visible, not described as an approval revocation. Readers read canonical state, then the bridge, then canonical state again. If the canonical revision changed, retry within a bounded limit or return busy. Only a stable snapshot with a matching projection digest is authoritative for traversal. Do not use a connection-only digest to imply that all plan text is current.

An interrupted projection blocks subsequent mutations until explicit repair, preserving its recovery baseline. Local canonical reads and pending-review views remain available. If a manual conflict prevents repair, return the attempted observation to the caller as unsaved rather than pretending it was persisted or overwriting the conflict. This temporary availability trade-off keeps the initial protocol small.

Canonical plan reads can report valid state with a stale-bridge warning. Cross-scope traversal must not silently use inconsistent projected edges. An unknown manual bridge edit is a conflict to preserve and review, not material to overwrite. Manually edited protected canonical content without matching approval is reported as unapproved. These checks detect inconsistency, not a malicious local owner who can rewrite every file.

A lock must not be reclaimed merely because its modification time is old. Reclamation needs verified owner-process death or explicit operator recovery. Acquisition, recovery and release must be ownership-safe: an old holder must not remove a successor's lock, and a token checked before an unguarded unlink is not sufficient by itself. Test a slow still-live writer and stale-owner/successor interleavings. This is a required improvement over current locking, not a claim that it already satisfies the contract.

The guarded guarantee covers cooperative participants. Direct editors can race between comparison and rename, so absolute protection against arbitrary concurrent filesystem edits is not promised. Preserve conflicts that are observed and require guarded operations for the guaranteed path. Likewise, atomic rename is not a claim of power-loss durability. The first acceptance scope is process interruption and crash recovery, with platform and durability limits documented explicitly.

### D8. Public operation boundary

The following are **proposed operation contracts**, not commands claimed to exist today. CLI and MCP must call the same core, with closed inputs and machine-readable outcomes.

| Read operation | Required input | Output |
| --- | --- | --- |
| Context | Explicit scope identity | Understanding, current/pending revisions, approval limits, observation provenance, graph and bridge snapshot hashes |
| Review plans | Current scope or explicit all-scopes selector, optional continuation | Fixed view groups, dates, totals, scope coverage and review questions |
| Read connections | Scope identities and bounded traversal request | Only declared accepted edges, idea explanations and unresolved references |
| Check | Scope identity | Structural, approval-consistency and projection findings, no mutation |
| Review changes | Scope and comparison basis | Change evidence and review-needed items, not an automatic semantic verdict |

| Mutation class | Allowed authority | Required constraints |
| --- | --- | --- |
| Submit or revise draft | Invoked agent or draft adapter | Operation identity, target, source references, base snapshot, pending content only |
| Record observation or outcome evidence | Invoked agent within approved work | Evidence classification, provenance, timestamp, base snapshot, no expectation changes |
| Record owner decision | Trusted conversational owner path or direct owner invocation | Exact action, plan/revision/specification scope, decision reference and base snapshot |
| Complete | Agent with sufficient agreed evidence, or owner review when required | Outcome coverage, no unresolved required acceptance, protected expectations unchanged |
| Repair projection | Explicit repair request | Canonical validity, unchanged known prior bridge or separately resolved manual conflict |

The old unrestricted replacement of the Markdown Plan body must not remain an escape hatch into the new approval model. A legacy-format request must clearly fail or require explicit conversion. No secret compatibility mode restores the rejected old planning model.

### D9. Monokl packet and adapter contracts

**Core input:** a source reference, optional target context, invocation bounds and already-available host capabilities. **Core result:** a discriminated analysis result: proposals, no useful fit, incomplete access, or target context needed. A proposal result may contain up to the invocation's bounded number of target-specific packets. Non-proposal results carry inspected evidence, limitations and the next safe action instead of fabricated target or adaptation fields. Only valid target-specific proposals can enter a draft sink. No target is invented when context is absent.

| Packet part | Required content |
| --- | --- |
| Source basis | Locator and version/digest if available, inspected anchors, access limitations, and the distinction between read, inferred and executed |
| Mechanism | How it works, why it works, assumptions and boundaries, with evidence references supporting important claims |
| Target fit | Target identity/context snapshot or explicit missing context, relevant expectation and why the mechanism matters there |
| Adaptation | Concrete changes needed, what cannot transfer, uncertainties, and the smallest proposed test with a meaningful success condition |
| Review metadata | Draft status, content digest, operation identity, creation time and any relevant previous rejection or existing proposal |

The validator checks shape, provenance presence, bounded content and authority exclusions. It does not turn citations into proven truth, judge novelty or certify successful experiments.

**Source adapter:** read-only, returns bounded material with anchors and access limitations. It cannot execute commands found in the source, install packages, traverse outside allowed roots or create an approval.

**Context adapter:** reads relevant scope summaries first, then expands a bounded set of candidate targets and declared connections. It exposes unresolved identity and coverage rather than silently searching every file on the machine.

**Draft sink:** accepts only unapproved proposals. The MOZAK integration checks target snapshot and existing rejection/duplicate information, then submits a draft under CAS. A timeout after delivery uses operation identity to recover the existing draft. If MOZAK is unavailable, preserve the standalone result and report delivery failure, not success.

The first proposed adapter set is a host/local-source adapter and the MOZAK context/draft adapter. Network, PDF, reverse-engineering and research services are optional source helpers, outside the core. No plugin marketplace or dynamic package loader is required.

**Packaging proposal:** keep host reasoning in the portable skill. Standalone use with supplied source and context requires zero adapters and no validator installation. Offer a small optional standalone validator/CLI for machine-checked export and integration workflows. Validate packets before a MOZAK draft sink accepts them. Prefer a slim Python boundary initially because Monokl already ships Python, but do not import the HyperResearch root or install its crawler, PDF, vault or model-route dependencies for basic use. TypeScript is accepted for MOZAK only. A Monokl language rewrite is not silently authorised by that choice.

Jcode is the proposed first end-to-end reference host. Portable contracts must not hardcode its swarm capabilities or a model provider. Other hosts can be advertised as tested only after their actual user flow passes. Missing optional adapters must not trigger the old mandatory doctor, vault-init or stage-installation sequence.

### D10. Access, safety and resource bounds

Source content is data. A hostile README, paper, comment, skill file or existing draft cannot authorise a command, change the current task, widen access, spend credits or approve an adaptation. Local paths must remain inside explicitly allowed roots after canonicalisation. Symlink escapes and duplicate scope identities fail closed.

Use already authorised host capabilities. There is no automatic account setup, paid provider fallback, package installation or source-code execution. An unavailable source yields a partial/incomplete report with the missing evidence identified.

Proposed pilot bounds are local-only access, one source document, two explicitly selected scopes, at most three proposed applications and no experiments. For broader later use, the invocation records allowed roots/domains and a finite read budget. Increasing that budget, using a new paid capability or running an experiment requires explicit permission. A source reference never grants permission to upload private repository material to a new service.

The proposal output links to source anchors by default, not a copy of an entire repository or paper. Evidence and user data stay outside installed skill directories. Existing attribution and licences must be preserved when code or skill material is reused. Do not publish the local source skill unless its redistribution rights are established.

### D11. Implementation sequence after design approval

1. **Planning slice:** canonical understanding, pending revisions, typed operations, dates and the deterministic review view, including concurrency and projection recovery.
2. **Conversation slice:** MOZAK skill presentation, real owner-decision binding, downstream handoff and fresh-session recovery.
3. **Monokl slice:** the simple entry skill, standalone packet validation, bounded local input and explicit no-fit/incomplete outcomes.
4. **Integration and proof:** optional MOZAK context/draft adapter, duplicate/rejection handling and the real pilot described in the companion protocol.
5. **Rollout slice:** approved conversion, coordinated CLI/skill/config/global-routing switch and release validation. No broad migration before the pilot passes.

These are vertical delivery slices, not a replacement goal DAG. Detailed tickets and package-level authorisations follow this specification's review. Use Haiku 5.5 at high effort for smaller implementation tasks as requested. If that route is unavailable, report the constraint rather than silently substituting another model.

## Testing Decisions

### Highest acceptance boundary

The primary acceptance seam is the **actual host skill → public CLI/MCP operation → files → new host session** workflow. This directly tests the owner's promise. A passing parser test or schema-valid model response is not acceptance of usefulness or continuity.

Use deterministic public-interface tests for storage, permission classes and packet structure. Existing core guarded-write and real-process MCP tests are reusable patterns. Add actual CLI subprocess coverage where the current project has none. Reuse interface patterns, not old assumptions that an open translation invalidates an entire scope.

Usefulness and whether a fresh agent genuinely understood the same direction require the owner and a fresh session. Do not replace them with mocks and call the pilot passed. The owner must confirm this proposed test seam when approving the design.

### Requirement-to-check matrix

| Check | User stories | Observable acceptance |
| --- | --- | --- |
| C01 Context recovery | U01, U05, U07 | Fresh session reconstructs accepted expectations, pending revisions, decisions and next permitted action from saved state, without the earlier chat. |
| C02 Review view | U02, U03, U05 | Current and all-scope commands show the agreed group order, dates, counts and explicit continuation. One plan with a pending revision retains one identity. |
| C03 Approval boundaries | U03, U04, U06, U21 | Draft discussion leaves accepted bytes semantically unchanged. Direction approval grants no coding authority. A changed semantic revision or spec digest rejects the old grant. |
| C04 Outcomes and rejection | U08, U09 | A task-list-only completion is rejected. Objective evidence can complete agreed outcomes, subjective outcomes request owner review, rejected proposals do not reappear without grounds. |
| C05 Change review | U10, U22 | A source change yields evidence and review-needed state, never automatic plan rewriting. Ordinary note crosslinks do not become scope edges or structural errors. |

| Check | User stories | Observable acceptance |
| --- | --- | --- |
| C06 Source and fit | U11–U15 | Owner evaluates a proposal against inspected source anchors, mechanism, target-specific adaptation and explicit uncertainties. No-fit and partial access are valid visible results. |
| C07 Standalone and adapters | U16–U18 | Same packet is produced without MOZAK, an unavailable optional adapter does not block core use, and the draft sink cannot approve or execute. |
| C08 Adversarial and bounded input | U19, U20, U24 | Embedded approval text, source commands, path escapes, oversized input and requests to widen paid access cannot escape invocation bounds. No watcher or idle ingestion starts. |
| C09 Concurrency and recovery | U21, U23 | Two real writers cannot lose accepted state. Slow-live locks, stale-owner/successor races, return-to-identical-text approval attempts, inconsistent reader snapshots, post-commit crashes, manual bridge edits and retry-after-timeout yield explicit, recoverable outcomes without duplicates. |
| C10 Real pilot and conversion | U01, U17, U25 | Owner accepts usefulness, reviews an actual draft, authorises detailed planning, and a fresh session resumes correctly. Conversion reports all carry-forward material before any separately approved removal. |

Current tests have been **read**, not rerun as evidence for the new system. None of C01–C10 is claimed to have passed for this specification. The companion pilot defines exact inputs and required evidence.

## Out of Scope

- Implementing, installing or migrating anything during this specification task, publishing issues or posts, pushing commits, or approving coding by implication.
- A new task tracker, scheduler, goal-DAG engine, general memory/search product, event-sourcing framework or background daemon.
- The old mandatory deep-research stages, their model-routing matrix, a compulsory vault, or an internal model API in simple Monokl.
- Automatic experiments, self-approved connections, automatic truth transfer, filesystem tamper-proofing, or claims that evidence links alone prove correctness.
- Obsidian graph cosmetics, an Obsidian plugin, a dashboard, universal host compatibility claims, or an archive/dual-legacy product mode.

## Further Notes

### Observed baseline, not future claims

The inspected MOZAK v1 source is **79b4bb9a3c7f369fb2f2013d0681715721a39c49**. Its current plan is free-form Markdown, its MCP surface exposes five tools and a single guarded plan replacement, and its translation helper builds an assumptions checklist. It does not contain the new understanding/revision/approval model. A read-only check of the repository root reports missing agent and bridge entry documents, so the source repository is not yet a valid operational v1 scope.

The inspected Monokl source is **728f2af4862d36cf62df66d245b011e6132a8768**. It currently packages the HyperResearch CLI, research engine and stage skills. Its current functionality and benchmarks do not prove the new simple tool works.

The installed MOZAK registration still resolves MOZAK to the legacy repository. That registry was read for orientation, not treated as permission to follow obsolete legacy goals or publish the old Monokl release. No new legacy feature or goal records were created for this redesign.

### Migration obligations

Audit and propose conversion, compact still-relevant direction and decisions, preserve important evidence as ordinary project/topic material, and retain unknown dates honestly. Completed implementation histories remain in git rather than new version-copy files. Existing human and agent instructions must be merged intentionally, not overwritten by scaffolding.

The earlier handoff identified untracked or ignored evidence and a large research pilot as special cases. Recheck actual recoverability at migration time. A remote repository alone does not prove every local file is recoverable. Do not delete ignored or untracked content, publish private evidence, or call a partially converted portfolio complete.

Use an explicit pilot-local configuration first. This is test isolation, not a permanent dual-runtime product. The final default CLI, config schema, skills and global agent routing must switch together after an approved rollback/recovery plan. Never point global instructions at unavailable commands.

### Design review status

Independent read-only review found no material blockers against the accepted expectations and recommended owner review, not implementation. Static source review also informed the storage, approval and adapter boundaries above. Document structure and story-to-check coverage were checked separately. This is design evidence only, not owner acceptance, a product-test result or a successful pilot.

### Owner review points

1. **P1 Data ownership: APPROVED.** Canonical JSON is the editable source of truth, with a generated, checked `MOZAK.md` bridge rather than two editable authorities. Owner confirmed at `2026-10-11T23:23:28.952Z`, responding to decision 1 of 5 after documentation checkpoint `7014969`. This accepts the data-ownership choice only, not every proposed storage mechanism, P2–P5, implementation, migration or publication.
2. **P2 Review semantics: APPROVED.** Keep one accepted version and one pending revision per plan, with proposed changes under Awaiting approval and approval bound to the exact displayed revision. Direction approval starts detailed planning, not coding. Owner confirmed at `2026-10-11T23:24:14.417Z`, responding to decision 2 of 5. This accepts the stated review semantics, not undisplayed connection declarations, P3–P5 or implementation.
3. **P3 Small core: APPROVED.** Monokl is a simple skill-first tool: the host agent investigates and produces an actionable adaptation proposal. Standalone use requires zero adapters. A small optional Python validator checks structured output, while source helpers and MOZAK integration remain external adapters with no HyperResearch dependencies. Owner confirmed at `2026-10-11T23:24:58.254Z`, responding to decision 3 of 5. This accepts the stated core and integration boundary, not every serialized field, P4–P5, implementation or pilot execution.
4. **P4 First proof: APPROVED.** Use the local `/grill-me` method as the source for an adaptation to MOZAK plan discussion, with the existing agentic-systems topic as related context. The pilot requires a real draft, owner usefulness review, direction approval into detailed planning and genuinely fresh-session recovery without the original chat. Owner confirmed at `2026-10-11T23:26:34.289Z`, responding to decision 4 of 5. This approves the pilot design and source/target selection only, not execution, implementation, P5 or a claim of success.
5. **P5 Delivery scope: APPROVED.** Prove the workflow in Jcode first through a bounded local-only pilot using selected local inputs, with no new paid services, installations, experiments or changes to global setup. Keep the design portable. Owner confirmed at `2026-10-11T23:28:21.909Z`, responding to decision 5 of 5. Implementation, pilot execution, migration and publication still require separate approval. This completes P1–P5 design review, not an implementation grant.

Issue-tracker publication and a ready-for-agent label are intentionally withheld. The current request authorises a local design, and public posting is manual. Keep the existing accepted brief unchanged as the requirements authority.
