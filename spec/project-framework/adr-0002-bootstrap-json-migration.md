# Project Framework ADR 0002: bootstrap JSON migration

Status: accepted by PF-0002.

## Decision

Bootstrap `goals.json` and `packets/PF-*.json` remain immutable source records during migration. Migration copies their bytes into canonical append-only history, records source paths and content hashes, then projects equivalent versioned goal and packet records. It MUST preserve every packet ID and each packet-to-goal reference exactly. It MUST NOT rename, renumber, rewrite, move, or delete the bootstrap JSON files.

The executable fixture [`fixtures/pf-0002/bootstrap-migration.json`](fixtures/pf-0002/bootstrap-migration.json) records the reference-preservation decision. Actual event and storage shapes are deferred to the packet and canonical-history contracts. Until those contracts exist, bootstrap JSON remains authoritative and migration is a declared future operation rather than an implicit destructive conversion.

## Consequences

- Existing roadmap validators continue to operate unchanged.
- Migration can be replayed and compared without losing bootstrap provenance.
- A mismatch in packet IDs or goal references fails closed.
