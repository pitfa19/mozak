# M0: executable specification

M0 converts the MOZAK concept into contracts that can be reviewed and executed before production implementation begins. The files here are normative for the alpha unless an ADR explicitly changes them.

## Current scope

- `product-contract.md` defines the alpha user, workflow, outputs, approval boundary, and demonstration.
- `non-goals.md` keeps deferred capabilities out of the first vertical slice.
- `glossary.md` assigns one operational meaning to each canonical term.
- `state-model.md` defines source, claim, branch, job, and packet lifecycles.
- `threat-model.md` and `permission-matrix.md` define trust and authorization boundaries.
- `resource-contract.md` defines portability and provisional resource profiles.
- `evaluation-contract.md` defines reproducible validation and evaluation.
- `schemas/` contains machine-readable draft records.
- `fixtures/` contains adversarial event histories with expected and forbidden outcomes.
- `adrs/` records architectural decisions that production planning must respect.

## Status

This is M0 draft 0.2. The product contract, vocabulary, draft schemas, twelve canonical-state fixtures, deterministic replay model, scenario adapter, pinned raw-file and lexical baselines, lifecycle diagrams, ADR set, and Phase 1 implementation packet exist. Automated whole-result verification is recorded in `verification-report.md`. M0 has not passed its exit gate because manual cross-discipline fixture review, public benchmark licensing review, and supported-host verification remain open.

## Validation

From the repository root:

```bash
python3 scripts/validate_m0.py
python3 scripts/verify_m0_requirements.py
```

The validator checks document and schema presence, event schema fields, fixture identifiers, strict append order, exact replay projections, canonical hashes, forbidden outcomes, stale-generation protection, and coverage of all required adversarial cases. `scripts/m0_disposable_replay.py` is executable specification code only and is explicitly not a production implementation.
