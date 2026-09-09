# Evaluation contract

## Layers

1. Deterministic invariants: schemas, hashing, replay, lifecycle, permissions, path confinement, and stale-generation rejection.
2. Public component adapters: licensed subsets for retrieval, citation accuracy, claim verification, and temporal questions.
3. Product scenarios: initialize, ingest, correct, dispute, generate views and packets, export, restore, and independently verify.

## Reproducibility record

Every result records corpus and snapshot hashes, fixture version, baseline adapter, software revision, model and prompt when used, seed, evidence budget, host profile, start time, and metrics. Model-dependent results never replace deterministic acceptance checks.

## Initial baselines

- Raw file scan.
- Exact and lexical retrieval.
- Embedding, hybrid, temporal, and graph methods are later comparative adapters.

## Initial metrics

- Canonical replay equality and hash equality.
- Evidence-span precision and citation correctness.
- Unsupported acceptance count, which must be zero.
- Conflict and temporal-state accuracy.
- Query latency, replay time, peak memory, disk use, and external/model cost.
- Fresh-agent task completion from a bounded packet.

Development fixtures are versioned under `fixtures/`. Held-out evaluation data must live separately and must not be writable by the evaluated agent. Public datasets require recorded license and redistribution decisions before inclusion.
