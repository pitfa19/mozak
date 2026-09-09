# Project Framework ADR 0001: terminology direction and M0 disposition

Status: accepted by PF-0001.

## Context

M0 described a local personal "brain" and its knowledge engine. The current roadmap generalizes the useful contracts into a repository-local **Project Framework** for research, planning, execution, and release. Brain-first words are historical design context, not required product or storage architecture.

## Decision

Use the Project Framework glossary for PF-0002 onward. Interpret **brain repository/root/export/brainpack** as historical M0 names for a framework control repository/root/portable canonical export when the safety contract applies. Do not require a central brain, database, model, agent host, or provider. Project-local accepted knowledge remains scoped and must not be silently promoted into cross-project truth.

M0 safety properties remain binding through the invariant catalog. This ADR changes terminology and scope, not the trust, evidence, history, authorization, portability, or bounded-handoff guarantees.

## M0 ADR dispositions

| M0 ADR | Disposition | Reason and Project Framework interpretation |
|---|---|---|
| ADR-0001 modular monolith and standalone core | Scoped | Retain standalone, provider-independent core boundaries. A modular monolith is an allowed implementation choice, not a required architecture for onboarded projects. |
| ADR-0002 event-projected state | Retained | Append-only canonical history, deterministic projection, base generation, replay, and stale-work rejection remain mandatory. Revision may be the repository-equivalent freshness token. |
| ADR-0003 immutable evidence | Retained | Immutable content hashes and exact spans remain required for accepted factual findings. Project Framework calls acquired source material raw records. |
| ADR-0004 local canonical store | Superseded in mechanism, retained in safety | A SQLite-plus-object-directory mechanism is no longer prescribed. Repository-local portable canonical records and rebuildable derived state remain required, without database or cloud dependence. |
| ADR-0005 bitemporal scoped statements | Scoped | Explicit project scope, valid time where applicable, and transaction revision/generation remain required. Not every framework artifact is a subject-predicate-object statement. |
| ADR-0006 human-approved mutation boundary | Retained for current direction | Proposal is distinct from acceptance. Authorized review remains required for accepted knowledge, policy, releases, and external writes unless a later ADR defines an equally auditable policy-based authorization. |
| ADR-0007 untrusted input capabilities | Retained | Source and generated content remain untrusted data. Deny-by-default capabilities, confinement, redaction, budgets, audit, and external-write approval remain mandatory. |
| ADR-0008 versioned bounded packets | Retained and generalized | Bounded immutable released packets are the provider-neutral execution handoff. The canonical generation becomes a declared project revision/generation and evidence hashes remain addressable. |

Every one of the eight M0 ADRs has exactly one disposition. No M0 safety invariant is rejected.

## Consequences

- New contracts use Project Framework terms and may cite M0 lineage.
- Legacy brain-first documents remain historical and need not be rewritten.
- Implementations may choose storage and execution mechanisms if observable contracts and invariants hold.
- Supersession is versioned and explicit, allowing terminology to evolve after real onboarding.
