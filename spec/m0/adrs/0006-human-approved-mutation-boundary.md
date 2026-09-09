# ADR 0006: patches and human-approved canonical mutation

Status: accepted for alpha planning.

## Decision

Agents and deterministic processes may propose patches, but only an authorized owner review can accept, supersede, retract, or release canonical knowledge in the alpha. Every patch names its base generation and is rejected closed if that generation is stale.

## Consequences

The application service exposes proposal and review operations rather than direct record mutation. Approval identity, time, decision, and rationale are auditable. Automated acceptance is deferred until a later ADR defines policy and assurance requirements.
