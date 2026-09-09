# Threat and trust model

## Trust zones

- The local owner is trusted to approve canonical changes and configure policy.
- MOZAK core processes are trusted only within their declared permissions and must produce audit events.
- Agent hosts, connectors, parsers, models, fetched pages, repositories, documents, and generated text are untrusted inputs.
- Derived indexes and views are rebuildable and never authoritative.

## Primary threats

1. Prompt injection in source content being interpreted as control instructions.
2. Fabricated or mislocated evidence entering accepted state.
3. Stale workers overwriting newer state.
4. Source edits, deletion, or upstream duplication hiding provenance.
5. Secrets or personal information leaking through snapshots, logs, packets, or exports.
6. Malicious paths escaping the brain or project root.
7. Model or connector actions exceeding budget or permissions.

## Required controls

- Source bytes and extracted text are data, never instructions.
- Accepted factual claims require immutable snapshot hashes and exact spans.
- Patches name their base generation and fail closed when stale.
- External actions require an explicit capability and human approval.
- Secrets are excluded or redacted before durable ingestion and exports.
- Paths are normalized and confined to declared roots.
- Every model and tool action records actor, capability, inputs, outputs, policy version, and result.
- Brainpacks may be encrypted, but MOZAK does not implement credential reset or recover user passwords.
