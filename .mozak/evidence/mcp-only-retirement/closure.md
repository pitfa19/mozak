# MCP-only adapter retirement closure

Recorded on 2026-10-05. Owner: pitfa. Scope: the approved `mcp-only-retirement` goal, not research-content acceptance.

## Delivered change

- Live adapter execution, setup, recheck and catalog CLI routes are retired with an effect-free error. `adapter_workflow.rs` and all 30 tracked source adapter scripts/tests are removed.
- The shipped stack offers explicit catalog MCP servers. Historical adapter bindings cannot satisfy readiness, and stack inspection never reads the adapter registry. Fetch is required for tooling-watch, GitHub is optional, and Firecrawl is required for deep-research.
- New `research record-tool` accepts only kind `mcp` and an exact catalog MCP-server ID. Historical verification, validation and offline source-specific normalization remain readable without current catalog membership.
- New Lab requests name catalog `tool_ids`, not adapter bindings. Refresh ingests validated proposal-only MCP evidence from those exact tools and the same Scope. Selected excerpt records, never embedded fixture JSON, become explicitly untrusted candidate labels. Historical Lab requests and reviews retain their serialization/hashes and cannot ingest new adapter evidence.
- Local managed build `0.7.1-main-3de281a0ba98` is activated. Previous build `0.7.1-main-eceddef3b7c0`, stable tracking and disabled automatic updates are preserved. Source feature commits: `0bd14a4`, `ca1859b`, `3de281a`.

## Requirement-to-observation map

| Requirement | Actual observation | Pinned evidence |
|---|---|---|
| MCP-only new retrieval is usable without adapters | An existing arXiv MCP server initialized and returned metadata for `1706.03762`. The exact sanitized metadata snapshot passed record, replay and validation. With a fresh HOME and no adapter registry, the previous installed Lab rejected the same `arxiv-mcp` request, while the new Lab started, refreshed and reported status successfully. | `live-acceptance.json`, `live-fixture.json`, `live-response.json`, `live-run.json` |
| Adapter invocation cannot run or write | Every retired command form fails without stdout. Four CLI tests verify no process execution, registry mutation or run output. Installed `adapter run` exits 1 with the retired message. | `workspace-tests.log`, `installed-observations.json` |
| Preserve historical research after runner deletion | Before and after actual `project current mozak`, research `total_count` is 40. The returned bounded 12 research records are equal, including IDs, freshness and proposal-only authority. The 12 returned binding views, out of 17 total, report historical/non-callable. Current, browse and why still work. A dedicated test deletes both runner and request and checks all three views. | `before-current.json`, `after-current.json`, `installed-observations.json`, `workspace-tests.log` |
| Preserve original registry and KB state | SHA-256 checks of the original adapter registry and KB registry pass after code removal and installation. The existing untracked Potjera request is untouched. | `preserved-history.sha256`, `installed-observations.json` |
| Preserve historical Lab compatibility | Independent reviewer copied 12 real historical Labs without changing originals. Previous/new status and review output hashes matched in all 24 comparisons. New fields are omitted from historical serialization. | corrected independent review, `workspace-tests.log` |
| Fail closed on wrong evidence | Tests reject non-MCP/unknown catalog IDs, wrong Scope, unselected tool, legacy research, altered request/evidence, malformed schemas, unsafe effects and symlink paths. Historical non-MCP and old tool IDs still verify. | `workspace-tests.log` |
| Local managed payload is actually active | Installed setup and doctor report ready. Installed stdio MCP `stack_catalog` returns catalog `2026-10-05.2` without adapter entries. Managed install/update/rollback acceptance passes. Installed skill tests pass. | `installed-observations.json`, `install.log`, `release-manifest.json`, `fresh-release.log`, `delivery-update.log`, `bootstrap.log`, `installed-skill-tests.log` |

## Verified gates

- Frozen workspace: **525 Rust tests passed**, no failures. Strict all-target Clippy with warnings denied and rustfmt pass.
- Skill: **42 tests passed** in source. Installed-copy suite also ran 42 tests, with four source-only checks skipped as declared.
- Python delivery/scripts: **37 tests passed**. M0 validation, documentation-vs-binary and phase-1 compatibility checks pass.
- Release archive checksum verified before activation. Real disposable managed installation, update, rollback and bootstrap checks passed before installation. The final subsequent catalog edit changed only readiness wording and was followed by workspace, strict lint and skill gates plus a rebuilt checksum-verified archive.
- Independent review: PASS, no HIGH or MEDIUM defects. Its sole LOW stale wording issue was corrected in `3de281a`.

## Reproduce retained live evidence

```sh
mozak research verify-tool .mozak/evidence/mcp-only-retirement/live-fixture.json .mozak/evidence/mcp-only-retirement/live-response.json .mozak/evidence/mcp-only-retirement/live-run.json
mozak research validate .mozak/evidence/mcp-only-retirement/live-run.json
mozak setup check "$HOME"
mozak stack catalog
mozak stack check "$HOME" literature
```

## Explicit limitations and remaining owner decisions

- Fetch, GitHub and Firecrawl services were not installed, configured or called. Their provider versions were verified against primary sources for the catalog, but service usability is untested. Tooling-watch and deep-research correctly report **incomplete**, with no adapter fallback. Installation/credentials and any paid Firecrawl call need separate explicit consent.
- Specialized weekly/Monokl/HyperResearch batch automation was retired, not silently reproduced. Future retrieval is an explicit bounded agent-host MCP workflow.
- Zotero was separately removed in the original session at owner request. This migration did not reinstall or re-register it. References report incomplete.
- The actual historical comparison checks total count and the returned bounded 12 records, not an unbounded dump of all 40 runs. Test fixtures additionally exercise deletion/drift edge cases. The first independent review draft miscounted object keys as records, corrected by a separate review version before plan pinning.
- Retained response bytes are an allowlisted metadata snapshot excluding abstracts and full text. The hash pins that sanitized snapshot, not an upstream transport frame. Integrity does not establish scientific truth or upstream authenticity.
- All recorded research remains `accepted: false`, `proposal_only`. No content acceptance, knowledge promotion, paper-quality improvement, paid usage or remote release is claimed.
- Software rollback preserves the previous managed binary/payload. It does not recreate deliberately retired source-tree runner scripts.
