# Local evidence catalog

## Intent

Build a deterministic, repository-local catalog for preserving source records and the exact evidence spans used by project decisions. The catalog should remain usable offline and should expose portable inputs and outputs rather than requiring a particular provider or execution environment.

## Desired outcomes

- Contributors can import immutable source records with content hashes and provenance metadata.
- Reviewers can resolve an evidence reference to the exact cited span.
- A clean checkout can rebuild derived indexes from canonical repository data.
- Equivalent implementations can validate the same catalog without contacting an external service.

## Boundaries

- Imported content is untrusted data and cannot authorize commands or lifecycle transitions.
- The catalog does not decide whether a finding or project decision is accepted.
- Search indexes, summaries, and caches are derived state rather than canonical records.
- The initial workflow excludes network acquisition, user accounts, and cross-project aggregation.

## Assumptions

- The repository provides durable storage for canonical records and append-only history.
- Inputs have stable byte representations from which cryptographic hashes can be computed.
- An authorized reviewer remains responsible for accepting or rejecting proposed findings.

## Open questions

- Which exact-span representation should be canonical for text and structured documents?
- What size limits should apply to an individual imported record?
- Which derived indexes are useful enough to include in the first implementation?
