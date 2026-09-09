# Project release: mozak-2026-09-01-1

- Project: **MOZAK** (`mozak`)
- Generated at (accepted input): `2026-09-01T10:00:00Z`
- Accepted state SHA-256: `7d96a676664989da50488c7ee10da26127adb39dca9ea5ec029ccd52fba10991`
- Truth scopes: `project_local` is authoritative only here; `cross_project_inference` is reusable inference, not another project's truth.

## Accepted findings

### Initial execution finding (`finding-001`)

The first bounded execution contract was accepted.

- Truth scope: `project_local`
- Supersedes: none
- Provenance:
  - [prov-001](repo:.mozak/planning/packets/PF-0006.json) at `json:$` (SHA-256 `cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc`)

### Provider-neutral execution (`finding-002`)

Execution contracts do not require one agent provider.

- Truth scope: `project_local`
- Supersedes: [[finding-001]]
- Provenance:
  - [prov-002](repo:spec/m0/product-contract.md) at `lines:1-20` (SHA-256 `bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb`)

## Decisions

### Release accepted state only (`decision-001`)

Raw transcripts remain outside release truth.

- Truth scope: `project_local`
- Supersedes: none
- Provenance:
  - [prov-003](repo:.mozak/planning/packets/PF-0007.json) at `json:$.constraints` (SHA-256 `dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd`)

## Reusable patterns

### Canonical release boundary (`pattern-001`)

Other projects may evaluate this pattern, but it is not their local truth.

- Truth scope: `cross_project_inference`
- Supersedes: none
- Provenance:
  - [prov-004](repo:spec/project-framework/contract.json) at `json:$.terms[28]` (SHA-256 `eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee`)

## Open gaps

### Meta KB ingestion (`gap-001`)

Cross-project ingestion remains intentionally deferred.

- Truth scope: `project_local`
- Supersedes: none
- Provenance:
  - [prov-005](repo:.mozak/planning/goals.json) at `json:$.goals[4]` (SHA-256 `ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff`)

## Implementation state

### project release (`implementation-001`)

Canonical generation and validation are available in mozak-core.

- Truth scope: `project_local`
- State: `implemented`
- Supersedes: none
- Provenance:
  - [prov-006](repo:crates/mozak-core/src/project_release.rs) at `symbol:generate_project_release` (SHA-256 `1111111111111111111111111111111111111111111111111111111111111111`)
