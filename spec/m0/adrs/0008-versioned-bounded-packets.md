# ADR 0008: versioned bounded packets as handoff units

Status: accepted for alpha planning.

## Decision

Research, decision, implementation, and operations handoffs use bounded packets. A released packet is immutable and records its canonical generation, evidence snapshot hashes, scope, constraints, dependencies, acceptance checks, risks, and freshness threshold.

## Consequences

Changing released content creates a new version linked to the prior packet. Consumers can reject expired packets or request refresh. Packet generation is deterministic where possible, but release remains an authorized human action in the alpha.
