# ADR 0004: local canonical store and rebuildable indexes

Status: accepted for alpha planning.

## Decision

Canonical events and snapshot metadata live in a local transactional store, while snapshot bytes live in a content-addressed local object directory. Search indexes, graphs, embeddings, caches, and rendered views are derived state and must be rebuildable from canonical events and snapshots.

## Consequences

Phase 1 may use SQLite plus a filesystem object directory behind repository interfaces. Correctness cannot depend on a cloud database, vector database, or hosted service. Export includes canonical records and referenced objects, but excludes rebuildable state.
