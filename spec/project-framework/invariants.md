# Normative Project Framework invariant catalog

The executable catalog is [`contract.json`](contract.json). Every implementation from PF-0002 onward MUST preserve all invariants below unless a later versioned ADR explicitly supersedes one without weakening its safety property.

| ID | Invariant | Normative rule | M0 lineage |
|---|---|---|---|
| PF-I01 | Trust-zone separation | Raw records MUST remain distinguishable from accepted knowledge and active procedures. Raw or generated content MUST NOT authorize control actions. | ADR-0003, ADR-0007 |
| PF-I02 | Append-only accepted history | Canonical history MUST be append-only and canonical state MUST be a deterministic projection. Correction MUST use an explicit lifecycle transition, never destructive rewrite. | ADR-0002 |
| PF-I03 | Immutable exact evidence | Accepted factual findings MUST cite immutable content hashes and exact spans unless explicitly typed as a human decision or assumption. | ADR-0003 |
| PF-I04 | Authorized mutation boundary | Untrusted or delegated actors MAY propose changes but MUST NOT accept, retract, supersede, release, change policy, or write externally without the required authorization. | ADR-0006, ADR-0007 |
| PF-I05 | Stale work fails closed | A mutating proposal MUST identify its base revision or generation and MUST fail closed when freshness no longer holds. | ADR-0002, ADR-0006, ADR-0008 |
| PF-I06 | Dependency provenance | Every dependency edge MUST be typed as declared, observed, or inferred. Inferred dependencies MUST NOT be silently promoted. | ADR-0005 |
| PF-I07 | Bounded immutable releases | Released packets and knowledge releases MUST be bounded, versioned, immutable, provenance-backed, and explicitly superseded when changed. | ADR-0008 |
| PF-I08 | Derived state is non-authoritative | Indexes, graphs, caches, embeddings, summaries, and views MUST be rebuildable and MUST NOT be the sole source of accepted truth. | ADR-0004 |
| PF-I09 | Scope and time remain explicit | Accepted assertions MUST preserve project scope and applicable valid time; historical order MUST preserve transaction revision or generation. | ADR-0005 |
| PF-I10 | Provider-neutral correctness | Correctness MUST NOT depend on a named agent, model, hosted service, cloud database, network, GPU, or architecture-specific repository layout. | ADR-0001, ADR-0004 |
| PF-I11 | Capabilities, confinement, and audit | Tool and external actions MUST use explicit deny-by-default capabilities, confined paths, bounded budgets, secret controls, and audit records. | ADR-0007 |
| PF-I12 | Independent acceptance evidence | Execution claims MUST map each acceptance condition to observed evidence and the executor MUST NOT be its only evaluator. | ADR-0008 |
