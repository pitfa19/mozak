# Whole-result acceptance observation, 2026-10-05

This is a new observation over the complete final source revision `9dd5c0c5a952b6dc425e3777e0de9894b031c93d`, not an inference from earlier partial checks. It supplements the immutable v2 evidence without rewriting it. The owner installation remains `0.7.1-main-3de281a0ba98`; runtime parity was exercised there, and the exact final `9dd5c0c5a952` archive was separately installed into a disposable prefix.

## Requirement-to-check traceability

| Requirement / changed public output | Fresh whole-result check | Actual observation |
| --- | --- | --- |
| New retrieval is MCP-only, no native adapter execution | Workspace adapter refusal tests and live CLI `adapter run`; packaged CLI refusal | Pass. Retired route exits 1 with guidance. Malformed registry is not read or repaired, no registry/config directory created. Native runner files are absent. |
| New recordings use exact catalog MCP IDs | `new_recordings_refuse_non_mcp_but_historical_runs_remain_readable`, `tool_identity_and_version_must_be_exact`, live `record-tool`, `verify-tool`, `validate` | Pass. Catalog `arxiv-mcp` recording succeeds. Non-MCP/unknown new source identities and malformed/tampered evidence are rejected. Old runs still validate. |
| Lab starts without adapter bindings and ingests matching MCP evidence | Real existing arXiv MCP initialize/get_abstract, sanitized metadata record, fresh HOME and XDG Lab start/refresh/status; exact final packaged CLI start/refresh/verify | Pass. Old installed CLI cannot start this MCP-only request. Final CLI starts and ingests one selected excerpt with explicit untrusted label. No adapter registry created. Evidence remains accepted=false, proposal_only. |
| Lab rejects wrong source/scope/tamper/request swap and preserves state | Whole workspace tests `refresh_refuses_evidence_from_an_unselected_tool`, `refresh_refuses_evidence_recorded_for_another_scope`, `refresh_refuses_tampered_evidence_and_a_swapped_request`, legacy ingestion refusals | All passed. No safety gate was relaxed for acceptance. Multi-run provenance and transaction tests ran in the full workspace. |
| Catalog/onboarding contains no live adapter fallback | Actual source and installed CLI catalog/check, installed stdio MCP stack_catalog, source and installed skill suites, docs/binary parity | Pass. Catalog version 2026-10-05.2. Installed CLI and MCP agree. `existing_adapter_bindings_never_satisfy_mcp_readiness_and_are_never_read` passes. |
| Missing MCP prerequisites report incomplete | Actual installed stack check for literature/tooling-watch/deep-research/references and negative stack tests | Literature ready; tooling-watch, deep-research and references incomplete. No Fetch/GitHub/Firecrawl provider was installed, called, or used as a fallback. Readiness is not claimed to establish provider usability. |
| Historical research remains visible without live runners | Actual installed project current/browse/why plus preserved registry/KB hashes and baseline comparison | Pass. Research total remains 40. The bounded 12 returned historical research records match. This is not a claim that all 40 record payloads were individually compared. Registry and KB bytes remain unchanged. |
| Historical Lab state and hashes remain compatible | 12 real historical Lab fixtures, status and review on identical disposable old/new copies | 24/24 exit/stdout/stderr tuples match. 12 status successes, 12 matching review refusals. Historical papers-read state correctly cannot jump directly to owner review. This explicitly corrects an assumption that every review invocation should succeed. |
| Local packaging/update/rollback remains safe | Full fresh-release, update/rollback, bootstrap acceptance; exact final archive checksum and fresh install into disposable HOME/prefix | Pass. Exact archive build 0.7.1-main-9dd5c0c5a952 installs, setup check ready, catalog reads, real MCP evidence ingests and verifies, adapter route rejects. Owner active/previous build and update policy remain unchanged. |
| Full result has no integration regression or stale docs | `cargo fmt --all -- --check`, `cargo test --workspace --locked`, strict all-target workspace clippy, M0, docs, diagrams, compatibility slice, Python and skill suites | All passed on final revision. Rust 525 passed. Source skill 42 passed. Installed skill 42 run, 4 source-only skips. Python 37 passed. |

## Harness corrections and observed safety behavior

- Initial historical loop aborted on an old-binary review refusal. The corrected harness compares both successful and rejected public calls on identical twin copies. All 24 match. Refusals are valid expected behavior, not product defects.
- Exact-archive install initially refused a nonexistent prefix. Creating the required disposable prefix allowed installation. No user prefix or knowledge state was changed.
- Exact-archive Lab probe initially supplied the invalid module `literature`. The CLI correctly rejected it without creating a Lab. Supplying the valid `research` module passed.
- The corrected historical and exact-archive harnesses are included alongside receipts so these observations can be reproduced.

## Evidence and boundaries

All copied fresh logs and receipts are listed by SHA-256 in `SHA256SUMS`. Source runtime tests cover the entire implementation result, not just late edits. The follow-up changes only evidence and its planning record, so no new runtime change was introduced after these checks.

No remote release was published, no third-party credentials were acquired, no optional paid service was called, no research was accepted as knowledge, no notes were changed, and Zotero was not reinstalled. Fetch, GitHub and Firecrawl usability and automated weekly/deep-research equivalence remain unobserved. The delivered replacement is an explicit agent-host MCP workflow, not a claim of identical batch automation.
