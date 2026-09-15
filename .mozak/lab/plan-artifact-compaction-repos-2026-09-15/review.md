# Improvement review: improve-5c50dfdabeda3c132e4d669f

- Scope: `topic-agentic-systems`
- Module: `plans`
- Question: Which current repository mechanisms should MOZAK adopt to compact superseded plans and lifecycle artifacts while preserving exact history, hashes, validation, rollback, packaging, and offline portability?
- Candidates: 40 (40 new, 0 unchanged)
- Read: 6 of 6 selected
- Acceptance: **self-review** (pitfa both performed and accepted this run)

## Objective

Identify repository-backed mechanisms for a lossless MOZAK artifact archive with a small active working set.

Complete when:

- Relevant repositories are separated from unrelated discovery results with explicit reasons.
- Repository-derived claims are limited to what was actually observed and do not treat popularity as quality.
- Any mechanism proposed from repositories preserves local-first operation, stable addressing, and reversible recovery.
- The review states the discovery truncation and topic-filter limitations.

Deliberately excluded:

- Adopting a repository or dependency.
- Treating stars or recent pushes as evidence of fitness.
- Retaining repository README prose.
- Implementing or promoting the resulting plan.

## Carried from earlier runs

Preservation requirements. Later work must honour these or retire them with a reason.

- `paper-0004::pg-c1` A Procedural Graph keeps an explicit editable directed graph of procedures outside the model and retrieves only the active node neighbourhood for situational guidance. (recorded by improve-515e558a8f7d263647c8613d, at §1 Introduction)
- `paper-0004::pg-c2` Rejected graph edits are retained as negative constraints while only candidates that preserve or improve held-out validation are adopted. (recorded by improve-515e558a8f7d263647c8613d, at §1 Introduction)
- `paper-0011::ss-c1` SKILL.state separates an immutable procedural specification, current structured execution state, and latest observation instead of replaying append-only history. (recorded by improve-515e558a8f7d263647c8613d, at §1 Introduction, Equation 1)
- `paper-0011::ss-c2` Intermediate reasoning is discarded only after producing a validated state update, making current state authoritative for execution. (recorded by improve-515e558a8f7d263647c8613d, at §1 Introduction)
- `paper-0012::sf-c1` The evaluated forgetting policy scores nodes by recency, access frequency, degree centrality, and age rather than applying one uniform compression rate. (recorded by improve-515e558a8f7d263647c8613d, at §1 Introduction and forgetting module)
- `paper-0012::sf-c2` The reported pruning removed 9.8 percent of nodes and 9.5 percent of bytes with token F1 unchanged, but the result is limited to one graph pipeline and benchmark. (recorded by improve-515e558a8f7d263647c8613d, at Abstract)
- `paper-0013::ri-c1` A continuity-bearing substrate is separated from replaceable execution bindings, so migration preserves identity and attributable lineage rather than creating new state. (recorded by improve-515e558a8f7d263647c8613d, at §2.1 Persistent substrate)
- `paper-0013::ri-c2` The migration protocol is quiesce, checkpoint, validate, bind, rehydrate, resume with explicit failure semantics. (recorded by improve-515e558a8f7d263647c8613d, at Abstract and migration protocol)
- `paper-0017::ws-c1` WikiSkill separates immutable raw execution traces, a persistent structured wiki, and evolving executable skills into layers with different write rules. (recorded by improve-515e558a8f7d263647c8613d, at §1 Introduction)
- `paper-0017::ws-c2` Skill updates are gated and reversible while the accumulated wiki persists, allowing active procedures to change without erasing evidence. (recorded by improve-515e558a8f7d263647c8613d, at §1 Introduction)
- `paper-0019::ts-c1` Trace as State places a compact task-state proxy before the long context on a fresh pass, so the state guides rereading rather than being appended after history. (recorded by improve-515e558a8f7d263647c8613d, at §1 Introduction)
- `paper-0019::ts-c2` The matched placement control used identical trace content after the context and lost in 26 of 27 reported combinations, showing that working-set ordering matters independently of retained source content. (recorded by improve-515e558a8f7d263647c8613d, at Abstract)

proposal_only: carried evidence informs a later run and constrains what it may silently discard; it accepts nothing and remains subject to the ordinary owner approval before becoming a planning input

## Sources read

- `paper-0007` (documentation, documentation) sha256 `bdc4716de4c52884f83f21430a9759eb5c04d927235c7ef1e2a31e0b0698fa86`
- `paper-0015` (documentation, documentation) sha256 `b3a72dc5aa99ab403cdceaf1f6097d9bbd879bff73d94e856b5ce84370d4168c`
- `paper-0027` (documentation, documentation) sha256 `3fb5355c5d29a9a434a5efdcdef0dc35b4c59fe9f19afe96ce592fd35a09ef51`
- `paper-0028` (documentation, documentation) sha256 `aa8c01e8bfe7fbcff250bb4b3d3fdf20f562518875ed548f4b2e3e92ecb4591d`
- `paper-0032` (documentation, documentation) sha256 `8678dfd52b4fb229a58d1825404969a43e0451e6f13790dae1c91f4a181d29e2`
- `paper-0033` (documentation, documentation) sha256 `abc68ffd6add764fe94ceaa51f48554c3ab1a292a6efebb1341ff1d5463f1060`

## Proposed mechanisms

### m-project-local-derived-index

- Change: Build a deterministic project-local index over canonical archived artifacts, containing hashes, status, relationships, one-line summaries, and locators while keeping source artifacts independently portable.
- Contract: new project artifact index and list/overview readers
- Benefit: Gives agents and humans fast navigation without flattening authoritative files into a lossy summary.
- Risks: The index may become stale; SQLite or another binary index must remain rebuildable and must not become the only readable representation
- Support: atlas-c1, zen-c1, signet-c1

### m-portable-lossless-archive

- Change: Export packed history as a self-describing archive containing canonical JSON artifacts, a sorted manifest, content hashes, supersession links, and restoration metadata; active files remain ordinary readable files.
- Contract: new compaction archive and restore contracts
- Benefit: Moves cold history out of hot folders while preserving offline transfer and exact restoration.
- Risks: Archive corruption could hide multiple artifacts at once; Compression format availability can harm portability
- Support: edge-c1, utopia-c1, mem-c1

### m-raw-history-plus-derived-view

- Change: Keep raw history and exact evidence immutable, and treat summaries, graph projections, and active working sets as derived views with an audit path back to source identifiers.
- Contract: overview, graph, package, and compact receipts
- Benefit: Allows aggressive navigation compaction because every displayed statement remains recoverable.
- Risks: Derived views can overstate completeness; Source-linked retrieval needs exact integrity checks
- Support: signet-c1, utopia-c1, atlas-c1

## Implementation plans

### R1 Rebuildable project-local artifact index

- Mechanisms: m-project-local-derived-index, m-raw-history-plus-derived-view
- Deliverable: A deterministic index generated from canonical active files and archived manifests
- Deliverable: Terminal tree and overview projections that default to active state and expose explicit history detail commands
- Deliverable: A rebuild command or automatic deterministic rebuild after index loss
- Check: Deleting the derived index does not invalidate canonical project state and rebuilding produces the same hash
- Check: Every summary row resolves to an exact artifact hash and locator
- Check: The index never becomes a release or package source of truth

### R2 Portable self-describing history bundle

- Mechanisms: m-portable-lossless-archive
- Deliverable: A stable archive format using canonical JSON members plus a sorted JSON manifest
- Deliverable: Whole-archive and per-member SHA-256 integrity
- Deliverable: Versioned restoration metadata and no dependency on repository Git history
- Check: A bundle round-trip reproduces all source artifacts byte-for-byte
- Check: The bundle can be validated and restored on an offline clean machine with the installed MOZAK binary
- Check: Unknown archive versions and path traversal members fail before extraction
- Check: The archive format remains inspectable with standard tools even when the derived index is unavailable
- Depends on: R1

## Limitations

- paper-0007: Repository documentation is self-authored and was not independently verified.
- paper-0007: Discovery and documentation establish a mechanism candidate, not quality, security, or fitness for MOZAK.
- paper-0015: Repository documentation is self-authored and was not independently verified.
- paper-0015: Discovery and documentation establish a mechanism candidate, not quality, security, or fitness for MOZAK.
- paper-0027: Repository documentation is self-authored and was not independently verified.
- paper-0027: Discovery and documentation establish a mechanism candidate, not quality, security, or fitness for MOZAK.
- paper-0028: Repository documentation is self-authored and was not independently verified.
- paper-0028: Discovery and documentation establish a mechanism candidate, not quality, security, or fitness for MOZAK.
- paper-0032: Repository documentation is self-authored and was not independently verified.
- paper-0032: Discovery and documentation establish a mechanism candidate, not quality, security, or fitness for MOZAK.
- paper-0033: Repository documentation is self-authored and was not independently verified.
- paper-0033: Discovery and documentation establish a mechanism candidate, not quality, security, or fitness for MOZAK.

## Status

Planning only. No MOZAK code was changed. Implementation and promotion require explicit owner authorization.

Validation of this run checked structural conformance to the Lab contract. It did not assess whether the mechanisms are sound or the plans worth implementing, and a valid run is not evidence that they are.
