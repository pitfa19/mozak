# MOZAK reference: frozen features

Frozen in 0.12: Improve Lab, knowledge packages, package import, legacy execution bundles, and retired adapters. They keep working and stay tested, but get no new development. Load this only when the owner explicitly asks for one of them.

## Self Improvement Lab

- The Lab turns a scoped improvement question into reviewable implementation plans. It is planning-only: it never edits MOZAK, and a run stops at `owner_reviewed`.
- MOZAK is six modules, and each one is also the improvement target that governs it: `scope`, `research`, `plans`, `meta-kb`, `improve-lab`, and `skill`. `mozak lab modules` is authoritative and returns each id, a one-line summary, and the source files it governs.
- Open a run with `mozak lab start RUN_DIR SCOPE_ID MODULE QUESTION MCP_TOOL_ID [MCP_TOOL_ID ...]`, where MODULE is one of the six ids above and each MCP_TOOL_ID is a shipped catalog MCP tool id such as `arxiv-mcp`. Unknown ids, non-MCP entries, and retired adapter or binding ids are refused; no adapter registry is read. Inspect progress with `mozak lab status RUN_DIR`. An existing run directory is never overwritten.
- The ordered steps are `refresh` (ingest a validated tool-evidence run), `select`, `read`, `mechanisms`, `plans`, then `review`. Each step records an immutable transition with the actor, time, and input hash, and a skipped or out-of-order step is rejected.
- Refresh with `mozak lab refresh RUN_DIR TOOL_EVIDENCE_RUN_JSON`, using a run written by `research record-tool`. It must re-derive cleanly, have `tool.kind` `mcp`, a `tool_id` exactly equal to one id given at `lab start`, the Lab's `scope_id`, and remain `accepted: false` and `proposal_only`. Candidates come only from the run's selected excerpt records. Historical adapter runs are refused. Lab runs opened with binding ids before the retirement stay readable but cannot ingest new evidence.
- `refresh` classifies every candidate as new or unchanged by content hash, so a repeated refresh does not re-read unchanged sources.
- `select` requires an inclusion or exclusion reason for every refreshed candidate, so silent omission is impossible.
- `read` records claim-level findings with locators, limitations, and the source class. Full text must be temporary: a reading that sets `retained_full_text` is rejected, and only hashes, claims, and provenance persist.
- Each claim is labeled `source_claim` or `lab_inference`. A proposed mechanism must cite at least one real source claim, so a mechanism resting only on Lab inference is rejected.
- Each plan card must cite a known mechanism and carry at least two acceptance checks. `review` renders the owner packet, including limitations, and closes the run.
- A completed run authorizes nothing. Implementation, evaluation, beta composition, and promotion are separate owner-authorized phases.
- Improvement evaluation is public, create-only, and non-authoritative. Use `mozak lab evaluation failure PROJECT_ID PROBLEM_JSON FAILURE_JSON` to classify an observed problem as `content`, `schema`, or `tool_behavior` and to reproduce stale-DAIR through real `project browse`, `project current`, and `project why` observations. Use `mozak lab evaluation observe FAILURE_JSON LABEL ATTRIBUTED_LAYER EXPECTED_STDOUT_SHA256 OBSERVATION_JSON` to capture the fixed CLI command set and derive pass/fail/inconclusive from pinned stdout/stderr hashes rather than caller-authored outcomes. Use `mozak lab evaluation compare FAILURE_JSON BEFORE_JSON AFTER_JSON COMPARISON_JSON` for paired before/after CLI observations with fixed project inputs and exact stdout/stderr hashes. It refuses fixed-input drift, tampered failure records, fabricated observation outcomes, stale after observations, and multiple attributed layers unless a dependency justification is supplied. Failed or inconclusive comparisons authorize no implementation or promotion; passing comparisons still require separate exact owner approval. Use `mozak lab evaluation review COMPARISON_JSON FAILURE_JSON BEFORE_JSON AFTER_JSON REVIEW_PACKET_JSON` to create the proposal-only owner packet only after replaying comparison validation against the supplied evidence, which rejects forged comparison JSON. Evaluation output paths are create-only and reject symlinked ancestors before writing.
- The group workflow is proposal-only until a strict approval is supplied. Define groups with `mozak lab group define`, synthesize them with `mozak lab group synthesize`, and record the proposal with `mozak lab group skill`; these files do not create a real skill.
- Materialize a real explanatory skill only with `mozak lab group materialize RUN_DIR APPROVAL_JSON OUTPUT_SKILL_DIR <PREDECESSOR_MANIFEST|none>` after `owner_reviewed`. The approval must set `decision: true` and pin the exact run id, scope id, topic id, skill id, revision, group-skill SHA-256, output directory, and predecessor manifest hash. The first revision uses `null` and `none`; later revisions must pin the previous published `manifest.json` hash.
- Materialization is create-only and fail-closed: it refuses existing output directories, implicit predecessor guesses, path/hash mismatches, and unapproved proposals. Prefer versioned output directories such as `skill-name-r1` and `skill-name-r2`; do not mutate an older published skill.
- Generated `SKILL.md` may explain only validated group skill fields, group synthesis, claim locators, source identifiers, and hashes. Paper full text is never retained, and proposal-only Concept candidates remain unaccepted.

## Knowledge packages

- `package validate` and `package list` inspect one closed local package. `package history validate` checks only the package roots explicitly supplied by the caller.
- Package inspection routes are deterministic, offline, machine-consumable, and read-only. They do not publish, download, sign, choose trust, transfer authority, or perform network discovery.
- Supplied history may branch. Never infer or claim a latest, official, preferred, or canonical branch from argument order, accepted-state version, or package digest.
- A request to inspect, verify, list, or check package history maps to the implemented routes. Package import maps only to the owner-gated route below. Publishing, downloading, selecting trust, or self-improvement remains unsupported.

## Owner-approved package import

- Exact route: `mozak kb import-package PACKAGE_ROOT INPUT_REGISTRY_ROOT APPROVAL_JSON OUTPUT_KB_ROOT`.
- Before import, inspect `mozak package validate PACKAGE_ROOT` and `mozak kb validate INPUT_REGISTRY_ROOT`. Summarize the exact `package_id`, `project_id`, `release_id`, target `kb.json` SHA-256, and new output path.
- Require an explicit owner approval artifact with `decision: true` and those exact four pins. General permission to import, inspect, or update a KB is not this approval.
- Never create or guess the approval, select a latest/official/trusted package, use a network source, overwrite an output, or treat an imported package as authorization.
- The route reconstructs a new KB root, copies immutable bytes into KB-owned content-addressed storage, rejects exact duplicates explicitly, and emits the exact receipt. The source package and input registry remain unmodified.

## Bounded external-agent workflow

MOZAK does not claim autonomous research, background agents, automatic Meta KB ingestion, networking, hosted registry behavior, or self-improvement. When another agent is available, keep delegation explicit and bounded:

1. Inspect local project state and select one accepted goal or question.
2. Give the external agent the objective, allowed paths/sources, relevant validated context-note paths and claim boundaries, constraints, expected artifacts, and stop conditions.
3. Require the agent to return artifacts and evidence in the foreground interaction. Do not imply MOZAK spawned or monitored it in the background.
4. Review the diff/artifacts locally, then run `research validate` or `execution validate` as appropriate.
5. Present failures and decisions to the owner. Do not accept planning state, execute further work, or release without explicit owner acceptance.
