# Canonical glossary

| Term | Meaning |
|---|---|
| source | A registered origin from which content may be acquired under a source profile. |
| source profile | Project policy describing authority, allowed locations, discovery boundaries, retention, and refresh behavior. |
| snapshot | Immutable acquired bytes plus metadata and a content hash. A changed page creates a new snapshot. |
| span | An exact byte, character, line, page, or structured-field location inside one snapshot. |
| entity | A stable scoped identity referred to by statements. |
| statement | A typed subject-predicate-object or n-ary assertion with scope and valid time. |
| claim | A statement together with lifecycle state and its supporting, opposing, or contextual evidence. |
| evidence | A source snapshot span connected to a claim with a stance and provenance. |
| event | An immutable, ordered record of a proposed or approved state transition. |
| patch | A reviewable set of proposed events. It is the only mutation boundary exposed to agents. |
| branch | A bounded temporary discovery or reasoning workspace that cannot directly mutate accepted state. |
| release | An immutable declared output of a reviewed branch or packet. |
| packet | A bounded, versioned handoff for research, decisions, implementation, or operations. |
| policy | Versioned rules governing sources, permissions, retention, budgets, and approval. |
| job | A durable execution request with generation, lifecycle, budget, and approval state. |
| canonical state | Accepted state reconstructed only from authorized append-only events. |
| derived state | Rebuildable indexes, graphs, summaries, caches, and views. |
| valid time | The interval during which a statement is asserted to be true in its domain. |
| transaction time | The time an event entered canonical history. |
