# Current-state projection

Status: Stage 1 implemented contract. This is not the `project current` CLI.

## Purpose

The current-state projection is a deterministic, read-only view over artifacts
that a caller has already validated. It gives later presentation layers one
closed shape for typed items and relationships without creating a second source
of truth.

## Boundary

- The projection emits no discovery, networking, writes, acceptance,
  recommendation, execution, or promotion. Source constructors may invoke their
  corresponding validators, including `kb::load_registry` for the KB registry
  root, but projection emission is deterministic and read-only over those sealed
  results.
- Projection sources cannot be constructed generically. Project, adapter, and
  research bytes pass through their real MOZAK validators; the KB source accepts
  only a registry root path and constructs its source by invoking
  `kb::load_registry` itself. Source identity, digest, and authority are derived
  by those constructors rather than supplied by the caller. Projection sources
  and inputs are construction-only Rust types rather than deserializable
  bypasses.
- Nodes inherit authority from their sealed source and retain private domain ids
  derived from validated artifacts. Each source also retains private validator
  facts: project id/name, adapter binding ids and target Scope ids, loaded KB
  Scope ids/titles, or research run id. Node constructors reject caller-passed
  public domain structs that were forged or mutated after validation and no
  longer match those private facts. Relationships can only be created through
  the closed `observes`, `registered_in`, and `targets` constructors, each of
  which enforces endpoint kinds and provenance. Adapter target edges additionally
  require a binding contained in the validated adapter source and reject any
  Scope whose private domain id does not equal `target_scope_id`. A
  proposal-only research source therefore cannot manufacture an authoritative
  edge.
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
