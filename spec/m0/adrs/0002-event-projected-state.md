# ADR 0002: append-only events and projected accepted state

Status: accepted for alpha planning.

Canonical history is append-only. Current accepted state is a deterministic projection. Agents mutate state only by proposing patches against a named base generation. This preserves auditability, replay, historical queries, and stale-worker rejection.
