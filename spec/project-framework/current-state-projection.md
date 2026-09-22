# Current-state projection

Status: Stage 1 implemented contract. This is not the `project current` CLI.

## Purpose

The current-state projection is a deterministic, read-only view over artifacts
that a caller has already validated. It gives later presentation layers one
closed shape for typed items and relationships without creating a second source
of truth.

## Boundary

- The projection performs no discovery, filesystem reads, networking, writes,
  acceptance, recommendation, execution, or promotion.
- Every source is constructed from its actual observed bytes. The projection
  computes the observed SHA-256 internally and compares it with the caller's
  pin. Callers cannot self-report an observed digest; any difference fails
  closed before the source can enter a projection. Projection sources and inputs
  are construction-only Rust types rather than deserializable bypasses.
- Every node and relationship names its provenance source and must carry exactly
  that source's authority. A proposal-only source cannot become accepted or
  authoritative in the projection.
- Freshness is observation metadata only. `current`, `stale`, and `not_checked`
  do not change authority.
- Input order is irrelevant. Sources, nodes, and relationships are sorted before
  output so unchanged inputs produce byte-identical canonical JSON.

## Shape

`CurrentStateInput` contains a project id, validated source records, typed state
nodes, and typed relationships. `CurrentStateProjection` emits those records in
canonical order and sets both `mutation` and `automatic_promotion` to `false`.
Source, node, and relationship kinds use closed enums. New semantic categories
therefore require an explicit contract change rather than an arbitrary string.

The public CLI, bounded current-state sections, adapter discovery, and navigation
operations are later stages and are intentionally absent from this contract.
