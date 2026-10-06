# MOZAK MCP-only adapter retirement: independent review

Verdict: **PASS**. No HIGH or MEDIUM defects. (v2 corrects only the receipt counts in check 3. v1 wrongly counted object keys as records. The verdict is unchanged.)

- Core review applies to commits `ca1859b` and `0bd14a4` (on top of plan commit `b267e13`).
- `3de281a` is a 1-line wording fix in `skills/mozak/tool-stack.json:20`, and I checked it. It closes my only LOW finding: the "configured" rung no longer mentions adapter bindings.
- Reviewer: read-only. I made no repo edits or commits, installed nothing, spawned no child agents, and used no network.

## Checks and evidence

1. **record-tool is MCP-only.** `crates/mozak-cli/src/tool_evidence_workflow.rs:34-38` rejects any non-`mcp` kind and any id that is not an exact catalog `mcp_server` entry, before writing output. `verify-tool` and `validate` do not gate on kind, so historical CLI, skill and API runs stay readable. Test: `tests/tool_evidence_commands.rs:99`.
2. **Adapter CLI is retired with no side effects.** `main.rs:420`: `adapter`, `adapter catalog`, `adapter run arxiv` and `adapter list` each exited 1 with the "retired ... MCP-only" message. Run with HOME and XDG_CONFIG_HOME set to the empty dir `~/.jcode/scratch/probe1/home`, and the dir was still empty afterwards. `adapter_workflow.rs` and all `scripts/adapters/*` runners are deleted. `stack_workflow` reads no adapter registry. Only host MCP entries count as `configured`.
3. **Historical project views are preserved.** `project_registry.rs:566-616` and `2960-2979`: pin drift and a deleted runner or request no longer hide runs. Bindings report `state: historical`, `callable: false` and informational `pin_drift`. The guards are kept: no symlink as the runs_dir root, the 512-candidate bound, and `validate_run_json`. Test: `deleted_runner_and_request_keep_history_readable_in_current_browse_and_why`.
   - Receipts `~/.jcode/scratch/mozak-mcp-only-{before,after}-current.json`, rechecked in v2. adapter_freshness: total_count 17, returned 12 of limit 12 (truncated), both before and after. proposal_only_research: total_count 40, returned 12 of limit 12 (truncated), both before and after. The returned research record_id sets are identical. Every returned binding moved from state ready, callable true to state historical, callable false.
   - `sha256sum -c ~/.jcode/scratch/mozak-mcp-only-preserved.sha256` passed for `~/.config/mozak/adapters.json` and `mozak-kb/kb.json`. The adapters.json mtime is still 2026-10-01 23:36.
4. **Catalog.** There are no adapter tools, no `adapter`/`adapter_bindings`/`adapter_registry_path` fields and no `legacy_alternative`, and parser tests reject all of these shapes.
   - tooling-watch requires `fetch-mcp`, with `github-mcp` optional.
   - deep-research requires `firecrawl-mcp`. The `policy.spend` field and the Firecrawl upstream warning both require explicit owner consent before credits are used.
   - `policy.workflows` states: "Batch parity with the retired adapters is not claimed."
5. **Lab** (`lab_workflow.rs` and `mozak-core/src/lab.rs`, frozen).
   - start: needs exact, distinct catalog MCP ids, at most 16. It reads no registry.
   - refresh: checks the request hash against ledger transition 0, including the case where an objective was added after start. It refuses historical adapter-bound runs.
   - Accepted evidence must come from a declared tool, the same scope, kind mcp, and the record-tool identity, and must stay proposal_only and not `supported`.
   - Candidates come only from `raw-sel-*` records. Each label is prefixed "untrusted <tool> excerpt (not a verified title)".
   - New fields use `skip_serializing_if`, so historical bytes and hashes are unchanged.
6. **Historical Lab compatibility.** All 12 real historical Lab runs under `~/Documents/mozak-kb` were copied to `~/.jcode/scratch/histlab/`, and the originals were not touched. `lab status` and `lab review` output were compared by sha256 between the installed 0.7.1 binary (before install) and the new build. Result: 24 of 24 identical.
7. **Tests.** `cargo test --workspace` on the frozen tree in the isolated target `~/.jcode/scratch/rev-target`: **525 passed, 0 failed**, 58 suites. I did not run clippy, fmt or Python tests myself; the coordinator reports them passing.

## Limitations

- I did not independently re-run the live MCP probe. I only read `~/.jcode/scratch/mozak-mcp-only-live-probe-v3/acceptance.json` (state passed).
- I did not review `3de281a`'s build, install or archive beyond the one-line diff.
- I did not inspect the separate Zotero removal in duckling.
- Leave the untracked `.mozak/adapters/requests/potjera-app-hyperresearch.json` (dated 2026-10-01) alone. It is not part of this change.
