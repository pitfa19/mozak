# ADR 0005: scoped statements with valid and transaction time

Status: accepted for alpha planning.

## Decision

Statements carry an explicit scope and valid-time value. Canonical events carry transaction time and generation. Unknown, instantaneous, bounded, and unbounded valid time are represented explicitly rather than inferred from ingestion time.

## Consequences

Current queries select by scope and valid time, while historical reconstruction selects by transaction generation. Project and global answers may coexist without becoming a conflict. Temporal comparisons require normalized RFC 3339 UTC values.
