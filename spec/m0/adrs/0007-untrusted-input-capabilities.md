# ADR 0007: untrusted inputs and deny-by-default capabilities

Status: accepted for alpha planning.

## Decision

Source content, connectors, parsers, models, agent hosts, and generated text are untrusted. They receive only explicit, scoped, revocable capabilities. Source text is never interpreted as authority to change policy, write externally, reveal secrets, or approve canonical state.

## Consequences

Path confinement, budget enforcement, redaction, capability checks, and audit records sit at application boundaries. External writes require separate owner approval. Tests must include prompt injection, traversal, stale-worker, and over-budget attempts.
