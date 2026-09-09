# Phase 1 first-slice verification

## Scope

This report covers only the first production slice introduced in commit `f7369fd`: the Rust workspace, `mozak-core` event projector and canonical hashing, and the `mozak` CLI `validate` and `replay` commands. It does not claim completion of the full Phase 1 packet.

## Requirement-to-check traceability

| Requirement or changed public output | Executed check | Observed result |
|---|---|---|
| Rust workspace builds as the planned standalone core and CLI boundary | `cargo build --release --workspace` | Release library and CLI binary built successfully on 64-bit Linux. |
| Rust source follows project formatting and lint policy | `cargo fmt --all -- --check`; `cargo clippy --workspace --all-targets -- -D warnings` | Formatting passed and Clippy reported no warnings. |
| P1-R04 deterministic accepted-state projection | Rust fixture integration test; release `mozak replay` | All 12 histories produced projections byte-equivalent as JSON values to M0 expected state and the exact expected SHA-256 hashes. |
| P1-R05 stale patches cannot mutate canonical state | `stale_non_rejection_fails_closed` | A stale non-rejection event was rejected rather than projected. |
| Append-only event integrity | duplicate-ID and non-increasing-generation integration tests | Both failure modes failed closed. |
| Typed external event boundary | unknown-event and unknown-field integration test | Unsupported variants and undeclared fields were rejected during deserialization. |
| Canonical JSON public behavior | canonical JSON integration test and all fixture hashes | Output is compact, Unicode-preserving, recursively key-sorted, and stable enough to reproduce all M0 golden hashes. |
| `mozak validate <fixtures>` public CLI | debug integration test and release binary invocation | Printed `validated 12 fixtures` and exited zero for the canonical fixture file. |
| `mozak replay <fixtures>` public CLI | debug integration test and release binary invocation | Returned parseable JSON containing exactly 12 IDs, projections, and expected hashes. |
| CLI failure behavior | missing-command, invalid-JSON, and invalid-usage integration checks | Each invalid invocation returned non-zero and did not emit a successful validation result. |
| M0 compatibility boundary | `python3 scripts/verify_m0_requirements.py` after Rust checks | The complete M0 executable specification and negative boundaries remained green. |

## Whole-result verification

```bash
./scripts/verify_phase1_slice.sh
```

The script exercises formatting, lints, debug tests, release packaging, both public CLI commands, invalid input behavior, exact Rust-to-M0 projection and hash parity, and the complete M0 regression workflow.

## Phase 1 requirements not implemented by this slice

P1-R01 through P1-R03 and P1-R06 through P1-R14 remain open except for the narrow replay, stale-write, and CLI behaviors explicitly mapped above. Brain initialization, immutable object storage, exact span resolution, full lifecycle and permission enforcement, ingestion, queries, views, packet persistence, export/restore, path and secret confinement, and resource-profile benchmarks are future slices.
