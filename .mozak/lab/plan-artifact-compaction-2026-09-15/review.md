# Improvement review: improve-515e558a8f7d263647c8613d

- Scope: `topic-agentic-systems`
- Module: `plans`
- Question: How should MOZAK compact superseded plans and other lifecycle artifacts so active project folders stay cognitively small while exact history, hashes, provenance, validation, rollback, packaging, and offline portability remain lossless?
- Candidates: 20 (20 new, 0 unchanged)
- Read: 6 of 6 selected
- Acceptance: **self-review** (pitfa both performed and accepted this run)

## Objective

Produce implementation-ready plan cards for keeping MOZAK project working directories small without losing authoritative lifecycle history.

Complete when:

- The review distinguishes navigational summarization from authoritative lossless storage.
- Every proposed compaction mechanism preserves stable identity, hashes, supersession history, offline validation, packaging, and rollback.
- The plan defines a dry-run acceptance workflow against the real Genome project and a fail-closed recovery path.
- The review identifies which existing MOZAK mechanisms already satisfy part of the design and what remains open.

Deliberately excluded:

- Deleting authoritative artifacts based only on age or completion status.
- Using Git history as the only archive.
- Automatically accepting or implementing the resulting plans.
- Compacting model prompts or chat transcripts except where their mechanisms transfer to durable project artifacts.

## Sources read

- `paper-0004` (preprint, full_text) sha256 `66f84584c5ea56845969e9c23ae3f9232eba706e6a1201ff16ad33021c838a32`
- `paper-0011` (preprint, full_text) sha256 `06302a1cf9d54cc00153d13141fdb46b1d45e3f9496a088a3c4e78c51d6928ad`
- `paper-0012` (preprint, full_text) sha256 `4c04cebbd347127086c1c894296f6ab30accae9c20be4eafb3f29170ec2a6aac`
- `paper-0013` (preprint, full_text) sha256 `04c08ebe659020b20f7825916d7251d5579836bfdf9f084d3dd4a82cd43b8245`
- `paper-0017` (preprint, full_text) sha256 `b0ba804bf393c19196a0c5054db9130ac2f96d71aa5e47e1d8d16f56d8a5e158`
- `paper-0019` (preprint, full_text) sha256 `da0659b0bcc73dbbd06e00486977794bae408605f13b9679d3e961551d1411a3`

## Proposed mechanisms

### m-active-projection-over-lossless-history

- Change: Keep the complete immutable lifecycle history authoritative, but derive a small active projection containing the current plan, ready goals, active input set, unresolved failures, and direct hash-addressed links to archived predecessors.
- Contract: plans module project overview, planning inventory, and a new artifact index contract
- Benefit: Reduces directory and agent orientation cost without asking a summary to become the source of truth.
- Risks: The active projection can drift from the archive unless derived and validated; A user may mistake the projection for a complete export
- Support: ss-c1, ss-c2, ws-c1, ts-c1

### m-class-aware-retention

- Change: Assign lifecycle artifacts a retention class: verbatim constraints and approvals, current structured state, recoverable superseded history, or disposable derived cache. Only disposable caches may be deleted; superseded history may be packed but not semantically summarized away.
- Contract: planning artifact classification and compaction manifest
- Benefit: Prevents uniform compaction from erasing exact constraints while allowing low-value projections to stay small.
- Risks: Misclassification can erase required evidence; Retention classes add migration work for existing projects
- Support: sf-c1, sf-c2, ws-c1

### m-checkpoint-validate-rebind

- Change: Treat compaction as a migration: quiesce the project, checkpoint all artifact hashes, build archive and active projection in staging, validate both representations, atomically bind the new layout, then verify rehydration and retain rollback metadata.
- Contract: new project compact lifecycle and receipt
- Benefit: Makes compaction reversible and fail-closed instead of a best-effort file move.
- Risks: Atomic replacement is platform-sensitive; Large histories may make validation slower
- Support: ri-c1, ri-c2

### m-rejection-and-supersession-memory

- Change: Retain compact records for rejected or superseded states with exact identities, reasons, and predecessor-successor links so removed active files do not cause old proposals to recur or lineage to disappear.
- Contract: plan supersession index and Lab/project history
- Benefit: Keeps negative and historical knowledge navigable without keeping every version in the hot directory.
- Risks: A terse rejection record may omit the future-relevant reason; Index chains can become inconsistent without whole-history validation
- Support: pg-c2, ws-c2

## Implementation plans

### C1 Canonical archive and active planning projection

- Mechanisms: m-active-projection-over-lossless-history, m-class-aware-retention, m-rejection-and-supersession-memory
- Deliverable: A versioned compaction manifest classifying every planning artifact as active, verbatim, archived-lossless, or derived-disposable
- Deliverable: A content-addressed archive that stores canonical bytes for every superseded artifact
- Deliverable: A generated active index containing the current plan, ready goals, unresolved failures, direct hashes, and supersession links
- Deliverable: Overview, list, graph, planning-next, release, and package readers that resolve both active and archived artifacts
- Check: On a copy of the real Genome project, dry-run classifies all 39 planning files and proposes no deletion of authoritative bytes
- Check: After compaction, project validate and overview still report 21 valid planning artifacts, v12 current, and 11 superseded predecessors
- Check: planning next still accepts v12 and refuses v11 as superseded using the archived chain
- Check: Unpacking the archive reproduces every original artifact byte-for-byte by SHA-256
- Check: Deleting or altering one archived member makes validation fail naming the missing or changed artifact

### C2 Transactional compact, restore, and rollback workflow

- Mechanisms: m-checkpoint-validate-rebind
- Deliverable: A read-only `mozak project compact PROJECT --dry-run` report
- Deliverable: An owner-approved compact route that stages output outside the project and atomically swaps only after full validation
- Deliverable: A `mozak project restore` or rollback route driven by the compaction receipt
- Deliverable: A receipt pinning project identity, pre/post manifests, archive hash, active-index hash, and exact file movements
- Check: An interrupted staging run leaves the canonical project byte-for-byte unchanged
- Check: A compacted project copied offline validates and restores without Git or network access
- Check: A forced archive corruption blocks restore and preserves the current project
- Check: Compact then restore yields the original planning tree byte-for-byte
- Check: CLI and all five typed MCP tools return the same project state before and after compaction
- Depends on: C1

## Limitations

- paper-0004: The source concerns agent context or knowledge representations rather than filesystem lifecycle artifacts, so only the separation, addressing, and recovery mechanisms transfer.
- paper-0004: The paper is a preprint and does not independently validate a MOZAK implementation.
- paper-0011: The source concerns agent context or knowledge representations rather than filesystem lifecycle artifacts, so only the separation, addressing, and recovery mechanisms transfer.
- paper-0011: The paper is a preprint and does not independently validate a MOZAK implementation.
- paper-0012: The source concerns agent context or knowledge representations rather than filesystem lifecycle artifacts, so only the separation, addressing, and recovery mechanisms transfer.
- paper-0012: The paper is a preprint and does not independently validate a MOZAK implementation.
- paper-0013: The source concerns agent context or knowledge representations rather than filesystem lifecycle artifacts, so only the separation, addressing, and recovery mechanisms transfer.
- paper-0013: The paper is a preprint and does not independently validate a MOZAK implementation.
- paper-0017: The source concerns agent context or knowledge representations rather than filesystem lifecycle artifacts, so only the separation, addressing, and recovery mechanisms transfer.
- paper-0017: The paper is a preprint and does not independently validate a MOZAK implementation.
- paper-0019: The source concerns agent context or knowledge representations rather than filesystem lifecycle artifacts, so only the separation, addressing, and recovery mechanisms transfer.
- paper-0019: The paper is a preprint and does not independently validate a MOZAK implementation.

## Status

Planning only. No MOZAK code was changed. Implementation and promotion require explicit owner authorization.

Validation of this run checked structural conformance to the Lab contract. It did not assess whether the mechanisms are sound or the plans worth implementing, and a valid run is not evidence that they are.
