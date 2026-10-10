# MOZAK reference: request routing examples

Load this to map a natural-language request to the exact route.

## Request routing examples

- “Find papers on X” → `mozak stack recommend literature`, then `mozak stack check HOME literature`; use `arxiv-mcp` only if check reports it configured, otherwise report incomplete, show the catalog's exact install steps, and ask before installing. There is no adapter fallback. Record the result with `mozak research record-tool` as proposal-only evidence.
- “What's new in agent tooling?” or “watch these repos” → `mozak stack recommend tooling-watch`, then `mozak stack check HOME tooling-watch`; follow the tooling-watch workflow through `fetch-mcp` (and `github-mcp` if configured), disclose pagination and truncation, keep discovery separate from the owner's watchlist, and record each call as proposal-only evidence.
- “Research this question deeply” → `mozak stack recommend deep-research`, then `mozak stack check HOME deep-research`; use host built-in search and reading when available, disclose when unavailable, and optionally read exact URLs through `fetch-mcp`. Record only actual MCP calls, never fabricate MCP evidence from built-in results. Do not claim the old HyperResearch or MONOKL pipeline ran.
- “Run the Lab on these findings” → `mozak lab start RUN_DIR SCOPE_ID MODULE QUESTION MCP_TOOL_ID [MCP_TOOL_ID ...]` with the catalog ids actually used, then `mozak lab refresh RUN_DIR TOOL_EVIDENCE_RUN_JSON` for each recorded run.
- “Check my references” or “what did I read on X” → `mozak stack recommend references`, then `mozak stack check HOME references`; on `prerequisite_missing`, report the missing Zotero database and stop instead of calling the tool.
- “Edit my manuscript” → `mozak stack recommend manuscript`, then `mozak stack check HOME manuscript`; name the required credential variables, and treat any write to Overleaf as a separate owner-approved action.
- “What tools do I need?” → `mozak stack catalog` for the full list, or `mozak stack check HOME` for local readiness across every use case.
- “Onboard this repo” → inspect with `project status`; explain missing control files; run `project init` only after confirming the proposed creation is wanted.
- “What is the project status?” → `project status`, then `project overview` when available.
- “Work on PROJECT_ID” → first run `mozak project context PROJECT_ID`; use only its exact registration, drift report, ready goals, validated context-note paths, and detail commands.
- “Discover my projects” → run `mozak project discover KB_ROOT WORKSPACE_ROOT [WORKSPACE_ROOT ...]` only for the explicit roots, save it, run `mozak project review DISCOVERY_JSON`, present the exact review JSON, and stop before registration or refresh unless the owner supplies the matching strict approval.
- “Show my Meta KB” → run `mozak kb tree` directly. For relationships, run `mozak kb graph`. Do not search for, guess, or ask for the configured KB path.
- “Research this goal” → first run `mozak project overview [PROJECT]`, read the relevant validated context notes, identify the run file and explicit observation boundary, then define the bounded question and evidence deliverable; let an external agent do the research; validate the returned local artifact with the exact argv `mozak research validate RUN_JSON`.
- “Plan the next goal” → first run `mozak project overview [PROJECT]`, read the relevant validated context notes, and identify the selected accepted-inputs and plan files plus the explicit observation boundary; invoke the exact argv `mozak planning next ACCEPTED_INPUTS_JSON PLAN_JSON`; present the recommendation without accepting it.
- “Inspect or verify this package” → `mozak package validate PACKAGE_ROOT`; report only local contract validity and immutable identity, not trust or publication status.
- “List this package” → `mozak package list PACKAGE_ROOT`; do not infer authority from included context artifacts.
- “Validate this package history” → `mozak package history validate PACKAGE_ROOT [PACKAGE_ROOT ...]`; use only the supplied roots and do not select a head.
- “Publish, download, trust-select, or self-improve from a package” → explain that package inspection commands are read-only and these networking, authority, and self-improvement operations are unsupported. Import is supported only through the separate exact owner-approved `kb import-package` route below.
- “Show the packet” → `project overview` and/or `project graph-source`; summarize the current packet without changing it.
- “Validate a legacy execution artifact” → use compatibility-only `mozak execution validate BUNDLE_JSON OBSERVED_REVISION OBSERVED_AT`; do not treat Execution Bundle as the current core architecture or the fresh-agent entry point.
- “Release it” → inspect and validate, show accepted-state input plus a new output path, require explicit owner acceptance, then `project release`.
- “Show dependencies” → `project graph-source` for machine-readable source or `project graph` for terminal rendering.
- “Import this package into my KB” → validate the exact package and input registry, present their identity and registry pin plus a new output root, require the strict owner approval artifact, then invoke the exact `kb import-package` argv and inspect `kb validate`, `kb list`, `kb tree`, and `kb graph-source` on the output.
- “Ingest these linked notes” → validate the Scope and present the exact pinned plan and new output root; only after explicit owner approval run the exact argv `mozak scope ingest-links SCOPE_ROOT SOURCE_ROOT OBSERVED_REVISION PLAN_JSON OUTPUT_ROOT`.
- “Validate my Meta KB” → `mozak meta validate META_KB_ROOT`; report invalid hashes, identities, paths, or relationships without changing files.
- “List or graph my projects” → `mozak meta list META_KB_ROOT` or `mozak meta graph META_KB_ROOT`; treat relationships as bounded metadata rather than transferred truth.
- “Validate this Scope” → `mozak scope validate SCOPE_ROOT`; report snapshot validity and state explicitly that source freshness was not checked.
- “Is this Scope source fresh?” → observe the source repository revision, then run `mozak scope source-check SCOPE_ROOT SOURCE_ID SOURCE_ROOT OBSERVED_REVISION`; this compares only safe relative local source bytes and the explicit observed revision, with no networking.
- “Show my unified KB” → run `mozak kb validate REGISTRY_ROOT`, then `mozak kb tree REGISTRY_ROOT` or `mozak kb graph REGISTRY_ROOT`; do not add or discover roots implicitly.
- “Find reusable knowledge for this target” → run `mozak kb concept candidates TARGET_SCOPE_ID [RESEARCH_RUN_JSON ...]`; report that Concepts are advisory, supplied research is proposal-only, results are not ranked, and nothing was accepted or changed.
- “Prepare to apply this Concept to the target” → run `mozak kb concept translation-packet TARGET_SCOPE_ID CONCEPT_ID CONCEPT_SHA256`; hand the assumption checks to the target agent, require target-side evidence, and do not call the packet a Translation or adoption.
- “Do we have migration parity?” → run `mozak kb parity REGISTRY_ROOT OBSERVATIONS_JSON`; report every gate and never claim parity when the command exits 2 or any gate is failed, unsupported, or blocked.
