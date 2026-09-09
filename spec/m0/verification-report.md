# M0 verification report

## Decision

The automated M0 executable-specification workflow passes as a whole. This is materially stronger than the initial structural draft because fixture events now conform to the draft event contract, all expected states are produced by replay rather than asserted independently, canonical hashes are reproduced, scenario adaptation crosses a held-out verifier boundary, and recorded baselines are regenerated and compared. The M0 exit gate remains open for the manual and cross-platform checks listed below.

## Requirement-to-check traceability

| M0 package or requirement | Executed check | Observed result |
|---|---|---|
| 0.1 product contract and alpha workflow | `verify_artifacts`; document validation | Product contract and non-goals are present and included by the integrated validator. |
| 0.2 canonical vocabulary and lifecycles | glossary term checks; lifecycle artifact check | All required canonical terms and lifecycle diagrams are present. |
| 0.3 at least ten adversarial histories | replay of `canonical-state.json` | All 12 required cases reproduced their exact projections and SHA-256 hashes. |
| Corrected, disputed, duplicated, retracted, temporal, scoped, n-ary, edited, dependency, stale, injected, and deleted-source behavior | per-fixture replay plus forbidden-outcome assertions | Every named case passed. Retracted and injected claims remained outside accepted state; stale patches remained rejected. |
| 0.4 threat and trust boundaries | malicious-source fixture; scenario tamper tests; negative replay tests | Source instructions were quarantined. Modified identity, checkpoint log, duplicate IDs, stale accepted events, snapshot mutation, and unknown events failed closed. |
| Permission model | permission-matrix artifact check | The owner/process/agent/connector contract is present. Production enforcement is deferred to Phase 1 and is not claimed here. |
| 0.5 portability and resource contract | artifact check; standard-library CPU baseline | Resource profiles and stable encoding rules are present. Raw and lexical baselines run without GPU, cloud database, Jcode, or model service. |
| 0.6 evaluation contract | `run_m0_baseline.py --check-recorded` | Pinned config, CC0 corpus manifest, queries, metrics, corpus hashes, and recorded result matched exactly. |
| 0.7 architecture decisions | ADR inventory | Eight alpha ADRs are present, including modular boundary, event projection, immutable evidence, local store, bitemporal statements, approval boundary, untrusted capabilities, and bounded packets. |
| 0.8 machine-readable schemas and replay spike | schema validation; `m0_disposable_replay.py`; negative replay boundaries | Eight draft schemas are present. Replay is deterministic, and likely corruption/staleness failure modes are rejected. |
| 0.9 scenario contract | `test_m0_scenario_adapter.py` | Direct replay and scenario-adapter outcomes matched for all 12 fixtures after save/restore. Held-out, identity, and checkpoint tampering boundaries passed. |
| Public validation interface | `python3 scripts/validate_m0.py` | The complete integrated validator passed documents, schemas, replay, scenarios, and recorded evaluation. |
| Phase 1 handoff | implementation-packet artifact and traceability-table check | The packet exists with 14 requirements, dependencies, risks, verification, rollback, and an explicit not-passed gate. |

## Whole-result commands

```bash
python3 scripts/validate_m0.py
python3 scripts/verify_m0_requirements.py
python3 scripts/test_m0_scenario_adapter.py
python3 scripts/run_m0_baseline.py --check-recorded
python3 -m py_compile scripts/*.py
git diff --check
```

## Open exit-gate work

- Record manual fixture review from research, coding, non-coding planning, provenance, security, and migration perspectives.
- Record licensing decisions for any public benchmark adapters beyond the included CC0 corpus.
- Repeat supported-host checks on macOS and WSL. Current executable evidence is Linux-only.
- M0 schemas are drafts. Production conformance, persistence, export/restore, authorization enforcement, and resource-profile testing belong to Phase 1 and are not implied by these results.
