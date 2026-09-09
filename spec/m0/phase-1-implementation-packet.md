# Phase 1 implementation packet

Status: draft, not released. This packet plans the first production vertical slice after M0. Its exit gate has not passed.

## Scope and objective

Implement a local CPU-only vertical slice that initializes one brain, registers one project, ingests local and manually supplied web content into immutable snapshots, proposes exact-span claims, applies owner-reviewed patches, projects accepted state, renders bounded human/agent/formal views, creates an implementation packet, and exports/restores canonical state with hash equality.

Out of scope remains governed by `non-goals.md`. Phase 1 must not make replay correctness depend on models, embeddings, a network connection, Jcode, or a cloud service.

## Required implementation boundaries

1. **Core domain:** identifiers, statements, temporal values, evidence, claims, events, patches, lifecycles, and projection rules.
2. **Canonical persistence:** transactional append-only event storage and content-addressed snapshot storage behind interfaces.
3. **Application services:** initialization, registration, ingestion, proposal, review, projection, query, packet generation, export, and restore.
4. **Adapters:** CLI, local-file acquisition, bounded URL acquisition, parsing, hashing, and deterministic lexical retrieval.
5. **Derived state:** rebuildable indexes and views that are excluded from canonical hashes.

## Requirements-to-tests traceability

| ID | Requirement | Verification test | Pass evidence required |
|---|---|---|---|
| P1-R01 | Initialize a brain and project without network or GPU. | CLI integration test on a clean temporary root with network disabled. | Exit zero, declared layout, project event at generation 1. |
| P1-R02 | Snapshot bytes are immutable and addressed by lowercase SHA-256. | Ingest identical bytes twice, then changed bytes from the same origin. | One object for identical bytes, a second hash for changed bytes, old object unchanged. |
| P1-R03 | Evidence resolves to an exact valid span in its named snapshot. | Property and boundary tests for byte, character, line, page, and field spans. | Invalid or mismatched spans fail closed; extracted bytes match expected content. |
| P1-R04 | Accepted state is projected deterministically from authorized events. | Replay the canonical adversarial histories twice and after export/restore. | Equal canonical state and hash for every replay. |
| P1-R05 | Stale patches cannot mutate canonical state. | Submit a patch whose base generation predates an accepted event. | Patch is marked stale/rejected and generation never decreases. |
| P1-R06 | Claim lifecycle transitions obey `state-model.md`. | Table-driven transition tests including every allowed and forbidden edge. | All allowed edges succeed only with required guard; all other edges fail. |
| P1-R07 | Owner approval gates acceptance, retraction, policy changes, external writes, and packet release. | Permission-matrix integration tests for owner, process, agent, and connector actors. | Unauthorized operations leave canonical state and external targets unchanged. |
| P1-R08 | Source-embedded instructions remain untrusted data. | Ingest the malicious-instruction fixture through each parser adapter. | No capability, policy, approval, or external-write action is invoked. |
| P1-R09 | Current, historical, scoped, disputed, superseded, and retracted answers are distinguishable. | Query tests over correction, conflict, valid-time, and scope fixtures. | Results match fixture accepted, historical, and conflict declarations. |
| P1-R10 | Human, agent, and formal views are bounded projections of the same generation. | Golden tests with strict size budget and shared generation marker. | No candidate is rendered as accepted; provenance and unresolved conflicts remain present. |
| P1-R11 | Implementation packets satisfy the packet schema and release immutability. | Generate, validate, release, then attempt in-place modification. | Schema validation passes and released bytes cannot change; revision creates a version. |
| P1-R12 | Export and restore are path-independent. | Export, restore beneath a different absolute path, rebuild derived state, replay. | Canonical hashes match and no canonical record contains the original absolute root. |
| P1-R13 | Paths, secrets, budgets, and connector actions are confined. | Traversal, symlink escape, redaction, budget exhaustion, and denied capability tests. | Operations fail closed with audit events and no escaped write or durable secret. |
| P1-R14 | Smoke and personal profiles run on CPU with measured resources. | Reproducible benchmark against both profiles. | Raw measurements recorded; thresholds proposed but not invented before measurement. |

## Dependency order

1. Freeze M0 schemas, transition tables, fixture review, replay semantics, and canonical hash rules.
2. Implement domain types and schema validation.
3. Implement canonical event and snapshot repositories with transaction and crash tests.
4. Implement projection, lifecycle guards, patch review, and stale-generation rejection.
5. Implement ingestion, exact spans, source trust boundaries, and lexical retrieval.
6. Implement views, packet generation, export/restore, and independent verification.
7. Run product scenarios and resource baselines, then review the exit gate.

External libraries must be pinned with license and portability review. Dataset adapters depend on recorded license and redistribution decisions. No model provider is a required dependency.

## Risks and mitigations

| Risk | Effect | Mitigation and verification |
|---|---|---|
| Canonical serialization is underspecified. | Cross-host hashes diverge. | Specify byte-level encoding and golden vectors before persistence; verify on Linux and macOS. |
| SQLite and object-directory updates split during failure. | Events reference missing snapshots or orphan objects. | Stage objects, commit metadata transactionally, recover idempotently, and inject crashes at each boundary. |
| Character offsets vary by parser or Unicode handling. | Citations point to wrong text. | Preserve original bytes, declare normalization, prefer byte spans, and test multibyte and newline variants. |
| Authorization leaks into adapter code. | Agents bypass owner approval. | Centralize capability and transition checks in application services; adversarial integration tests call every adapter. |
| Derived data enters canonical exports. | Hashes become machine dependent. | Allowlist canonical record types and test exports with caches and embeddings present. |
| Packets exceed useful context or omit uncertainty. | Fresh agents fail tasks or act on unsupported claims. | Enforce budgets, provenance, conflicts, assumptions, and freshness fields; run fresh-agent scenario evaluation. |
| Provisional performance targets become false promises. | Exit is claimed without evidence. | Record raw CPU, memory, disk, and latency results first; approve numeric gates only after baseline review. |

## Verification plan

- Run JSON Schema Draft 2020-12 validation for schemas, examples, fixtures, emitted events, patches, claims, and packets.
- Run deterministic unit, property, transition-table, crash-injection, and permission tests without network access.
- Run the twelve adversarial histories through the reference replay model and production projector and compare state plus canonical hashes.
- Run scenario adapter equivalence for initialize, ingest, correct, dispute, render, packet, export, restore, and verify.
- Run raw-file and lexical baselines with complete reproducibility records from `evaluation-contract.md`.
- Perform manual review of every fixture's expected and forbidden outcomes and record reviewer plus date.
- Verify on current 64-bit Linux and macOS; record WSL as supported through the stated compatibility boundary.

## Rollback and recovery

- Until the Phase 1 exit gate passes, keep the implementation opt-in and do not migrate authoritative user data into it.
- Before any schema or event-version migration, export and verify the current canonical archive and retain the prior reader.
- Roll back application binaries and derived indexes freely. Never delete or rewrite canonical events or referenced snapshots during rollback.
- If a write fails, reopen at the last committed generation, quarantine incomplete staged objects, rebuild derived state, and verify the canonical hash.
- If a released packet is wrong, mark it superseded or expired and release a corrected version. Do not edit it in place.

## Phase 1 exit gate

The gate may be marked passed only after all of the following have recorded evidence:

- Every P1-R01 through P1-R14 test passes with requirement-level traceability.
- M0's replay reference model, scenario adapter equivalence, baseline runner, and manual fixture review are complete.
- All twelve adversarial fixtures pass both reference and production projection.
- Export/restore hash equality passes on different absolute paths and supported host platforms.
- Security tests cover prompt injection, fabricated spans, stale writes, traversal, secrets, capability denial, and budget exhaustion.
- Raw resource measurements for smoke and personal profiles are reviewed and any numeric acceptance thresholds are approved.
- A fresh agent completes the bounded implementation-packet scenario without conversation history.
- An authorized owner reviews the evidence and explicitly records the release decision.

**Current gate decision: NOT PASSED.** This document supplies a plan, not implementation or test evidence. M0 also remains open until its separately listed remaining checks are completed.
