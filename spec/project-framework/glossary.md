# Project Framework glossary

This glossary is normative for PF-0002 through PF-0008. Machine-readable definitions and packet coverage live in [`contract.json`](contract.json). Terms are singular concepts; capitalization and ordinary grammatical plurals do not create new meanings.

| Term | Normative definition |
|---|---|
| **Project Framework** | The provider-neutral, repository-local contracts and lifecycle that turn a project idea into auditable research, plans, bounded execution, and knowledge releases. |
| **project** | A repository and its explicitly declared framework control state, identity, roots, and revision. |
| **project manifest** | The versioned canonical declaration of project identity, repository revision, owned paths, and framework contract version. |
| **idea document** | A human-authored statement of project intent, desired outcomes, boundaries, assumptions, and unresolved questions; it is accepted planning input, not executable authority. |
| **raw record** | Immutable acquired or observed bytes and metadata preserved with provenance; raw records are untrusted data and are not accepted knowledge or active procedures. |
| **snapshot** | A content-addressed immutable raw record of acquired bytes plus metadata and a cryptographic hash. |
| **evidence** | An addressable exact span or structured location in an immutable raw record, linked with provenance and stance to a finding or claim. |
| **accepted knowledge** | A finding, decision, claim, plan, or release admitted through an authorized review boundary and reconstructable from canonical history. |
| **active procedure** | A versioned policy, packet, capability, or instruction explicitly authorized to control framework work; source content and generated text never become active procedures by being ingested. |
| **finding** | A bounded proposition produced by research or codebase observation with evidence, scope, confidence, and lifecycle state. |
| **planning input** | An explicitly accepted, provenance-backed finding, decision, constraint, or observation eligible to inform a goal plan without silently mutating it. |
| **goal** | A versioned desired outcome with acceptance conditions and lifecycle state in a goal DAG. |
| **goal DAG** | A directed acyclic graph of goals and typed dependency edges that permits shared dependencies without duplication. |
| **dependency** | A directed prerequisite relation whose provenance is exactly one of declared, observed, or inferred. |
| **declared dependency** | A dependency explicitly stated by an authorized project artifact or owner. |
| **observed dependency** | A dependency supported by reproducible repository or execution evidence. |
| **inferred dependency** | A provisional dependency derived by analysis and never silently promoted to declared or observed status. |
| **packet** | A bounded, versioned, provider-neutral handoff containing scope, objective, inputs, constraints, dependencies, acceptance checks, risks, freshness, and evidence references. |
| **released packet** | An authorized immutable packet version; any content change creates a linked successor version. |
| **execution result** | An immutable record of an execution attempt, including artifacts, observed dependencies, validation evidence, failures, and retry or supersession state. |
| **independent evaluator** | An evaluator distinct from the execution attempt that maps each acceptance condition to observed evidence and cannot rely only on the executor's assertion. |
| **research run** | An immutable, bounded execution of a declared research pipeline preserving scope, sources, evidence, gaps, synthesis, audit, and receipt. |
| **research pipeline** | A versioned active procedure defining bounded research stages, source policy, budgets, outputs, and audit requirements without naming a required provider. |
| **run receipt** | An immutable audit record identifying the procedure version, actors or adapters, inputs, capabilities, outputs, policy, timing, and result of a run. |
| **project knowledge release** | A bounded immutable export of accepted project-local findings, decisions, patterns, gaps, implementation state, provenance, and supersession links. |
| **derived state** | A rebuildable index, graph, cache, embedding, summary, or rendered view that is never authoritative by itself. |
| **canonical state** | Accepted state deterministically reconstructed only from authorized append-only events and referenced immutable records. |
| **temporary artifact** | A bounded working artifact that may inform proposals but is non-canonical, expires or is discarded, and cannot directly mutate accepted state. |
| **accepted artifact** | A versioned artifact admitted through its required authorization boundary and present in canonical history. |
| **superseded artifact** | An immutable historical artifact replaced by an explicitly linked newer version and no longer current. |
| **rejected artifact** | A preserved proposal denied at review with rationale and prohibited from appearing as accepted or current. |
| **allowed artifact** | An artifact whose type, location, version, provenance, and lifecycle transition satisfy the applicable contract and policy. |
| **provider-neutral** | Specified by observable inputs, outputs, and behavior without requiring a particular agent, model, hosted service, database, or vendor. |
| **freshness** | The declared revision, generation, source hash, or time condition under which an artifact remains eligible for use. |
| **supersession** | An explicit immutable relation from an older artifact to its replacement, preserving both history and current selection. |
| **provenance** | The recorded origin, actor, procedure, source location, version, and transformation chain sufficient to audit an artifact. |

## Lifecycle vocabulary

- **Allowed** means contract-valid, not automatically accepted.
- **Temporary** means usable only in a bounded non-canonical workspace.
- **Accepted** means authorized and recorded in canonical history.
- **Superseded** means historical, immutable, and explicitly replaced.
- **Rejected** means reviewed and denied, with rationale retained.

These states do not collapse into each other. In particular, allowed or temporary artifacts are not accepted knowledge.
