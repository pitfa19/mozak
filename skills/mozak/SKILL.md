---
name: mozak
description: Operate MOZAK projects, Scopes, explicit KB registries, and local Meta KBs through natural-language onboarding, status, research, planning, next-goal, packet, execution, evaluation, release, validation, parity, listing, tree, and graph requests using only the current local CLI. Every use loads i-have-adhd, reads project context, and checks the explicit tool stack (arXiv, Zotero, Overleaf, Fetch, GitHub) only for the applicable use case.
---

# MOZAK

## Owner-approved sequence completion

When the owner authorizes a sequence, plan, batch, phases, checklist or synonymous work commitment, load `mozak-sequence-commitment` and retain the complete original scope across delegation and resume. A passing candidate or milestone is not completion. Never silently cancel, defer or narrow agreed requirements. Continue every safe authorized unblocked branch, even when another branch needs approval. Finish only after every original requirement has direct, current acceptance evidence, or the owner explicitly changes the scope. A forced interruption must be reported as incomplete with open todos and a resume path. These core rules apply even if the companion is unavailable, in which case record the same whole-scope audit manually. The companion is shipped by `mozak setup install`; it does not grant approvals or guarantee agent obedience.

Natural language is the user interface. Translate the request into the smallest current MOZAK command, inspect its result, and answer with terminal bullet lists or a `Termaid` diagram. Never direct the user to a web dashboard.

## Every MOZAK use starts the same way

This is a standing rule, like the ADHD rule. It applies to every MOZAK request in every session, not only the first one.

1. Load the `i-have-adhd` skill and keep its output rules on.
2. For project work, run `mozak project context PROJECT_ID` and work only from its result.
3. Run `mozak stack check HOME baseline` (or `mozak stack check HOME USE_CASE`, which always includes `baseline`). When the request also matches a specialized use case, run `mozak stack recommend USE_CASE` first and use only the tools that check reports for the selected use case(s). With no specialized match, `baseline` alone applies; do not activate every tool.

The local CLI checks observable facts: files, hashes, host configuration, and recorded evidence. It cannot force an agent to follow these instructions. Following them is the agent's job.

## Explicit tool stack

- Catalog: `tool-stack.json`, shipped next to this skill and versioned with the binary. It is the source of truth for which MCP servers and skills serve which use case. `companion-recommendations.json` still ships for compatibility; its entries are now stack catalog policies, mainly the always-on `baseline` use case.
- Read the catalog with `mozak stack catalog`. Get the tools for one use case with `mozak stack recommend USE_CASE`. Observe local readiness with `mozak stack check HOME [USE_CASE]`. All three are read-only and offline, install nothing, and perform no MCP handshake.
- New retrieval recorded through MOZAK is MCP-only. Host built-in web search and reading may support deep research when available, outside this catalog and its evidence recorder. Never relabel built-in results as MCP evidence. The agent host calls a catalog MCP server; MOZAK records and validates the bytes. MOZAK ships no live source adapter, and there is no adapter fallback, setup, run, or recheck. Never recommend a `mozak adapter` command.
- Use cases and catalog tool ids: `baseline` (always: `adhd-skill`, `notes-skills`, `sequence-commitment`, `termaid`), `literature` (`arxiv-mcp` required; `fetch-mcp` and `github-mcp` optional for curated DAIR.AI snapshots), `references` (`zotero-mcp`), `manuscript` (`overleaf-mcp`, optional, needs credentials), `tooling-watch` (`fetch-mcp` required; `github-mcp` optional), `deep-research` (`fetch-mcp` optional; host built-in search outside the catalog). `mozak stack catalog` is authoritative if this list ever disagrees.
- Activate a tool only for its applicable use case: arXiv for literature, Zotero for references and reading, Overleaf for manuscripts, Fetch and GitHub for tooling watch, Fetch for exact known URLs in deep research. A literature question does not justify opening Zotero or Overleaf.
- Readiness is a ladder, and each rung is a separate fact: `missing`, `installed`, `configured`, `handshake_ok`, `usable`, `write_granted`. An installed package is not a configured server. A successful handshake is not a usable library. Read access is not write permission. `prerequisite_missing` means configured but a declared prerequisite is absent, for example Zotero with no `zotero.sqlite` at the default path or `ZOTERO_DB_PATH`.
- `stack check` observes only up to `configured` from host files (executables on PATH, skill directories, `~/.jcode/mcp.json`, `~/.claude.json`, `~/.codex/config.toml`). Beyond that it reports `handshake: "not_observed"`, `usable: "unknown"`, and `write_grant: "not_observed"`. Do not upgrade those values from memory or assumption. Only the agent host calls an MCP server, and only that call can show a handshake or real library access.
- Exit codes: `stack check` returns 0 when every required tool of the checked use case(s) reaches its declared `ready_at` rung (`installed` for baseline skills and executables, `configured` for MCP servers) with its declared prerequisites and required credentials present, and each `any_of` group has at least one member ready. It returns 2 when incomplete and 3 for invalid input. An unknown use case returns 3 and lists the valid ids.
- Missing required MCP configuration or a missing required credential means incomplete. Report it and stop. Never substitute another retrieval path.
- When a tool is unavailable, show the exact installation steps and prerequisites from the shipped catalog. Never invent package names, versions, or commands.
- Installing is a separate owner decision per tool. Show the step, wait for consent, and never install every recommended tool at once.
- Credentials: MOZAK never emits or stores credential values. It inspects only declared key names and their presence in the environment and host config files, and reports names such as `OVERLEAF_SESSION` or `GITHUB_PERSONAL_ACCESS_TOKEN`. A write grant is never implied by setup or by the catalog.
- MOZAK maintains no live tool runtime. It does not start, supervise, or keep MCP servers alive. The agent host does that.
- What an MCP tool returns is research evidence, not knowledge. Record it as an immutable proposal-only snapshot (see source-neutral evidence below), and keep acceptance a separate explicit owner decision.

### MCP workflows

If any permitted tool would spend credits, get explicit owner consent before
network or credit use. This policy grants no permission to add tools.

Every MCP workflow ends the same way: save the exact response bytes, write one `mozak.tool-evidence.v1` fixture per call with the catalog tool id, and run `mozak research record-tool FIXTURE_JSON RESPONSE_BYTES RUN_JSON`. Coverage of a source through an MCP tool counts as tested only after a real recorded run through that tool.

- Literature: `mozak stack check HOME literature`, then search and read through `arxiv-mcp`, one section at a time. A curated DAIR.AI snapshot is read through `fetch-mcp` or `github-mcp` at an exact commit of `dair-ai/AI-Papers-of-the-Week`. Its upstream declares no license, so retain only titles, links, week labels, and exact source provenance; use curator prose transiently. DAIR.AI is a curated complement, not a complete literature search.
- Tooling watch: `mozak stack check HOME tooling-watch`.
  1. Repository discovery: run owner-declared topic and keyword searches against the public GitHub API through `fetch-mcp`, or through `github-mcp` when configured. Discovery proposes and never promotes. A repository becomes watched only when the owner adds it to the watchlist.
  2. Repository watch: for each repository on the owner's explicit watchlist, record the latest release when one exists, otherwise the head commit, so an active repository without releases is never shown as dormant.
  3. MCP registry: read the official registry's public v0 API through `fetch-mcp`. It paginates by server name, not by date, so read every page of the `updated_since` window before picking the newest, one fixture per page with the exact URL and cursor in the call arguments. Stopping at a page ceiling sets `truncated: true` and records a high-impact gap saying unread pages may contain newer entries.
  4. Retain only release facts (identity, version, repository and website links, timestamps, `isLatest`, status). Never retain descriptions or READMEs.
  5. Disclose in every record: stars and pushes measure attention rather than quality, security or fitness; licences vary and some are undeclared; discovery cannot see a repository that declares no matching topic; registry entries are self-published, so presence is not assessment; the registry lists MCP servers only. Unauthenticated public API reads are rate limited, so keep requests bounded. MOZAK schedules nothing; a watch runs when the owner asks.
- Deep research: `mozak stack check HOME deep-research` checks baseline and optional `fetch-mcp`, not host search availability. Use the host's built-in web search and reading when available, with explicit source citations and limitations. If unavailable, report the missing search capability rather than claiming research readiness. Use `fetch-mcp` only for exact known URLs, and `arxiv-mcp` for papers when `literature` checks ready. Record only actual catalog MCP calls with `mozak research record-tool`. Built-in tool results cannot be recorded as MCP evidence or used as a Lab refresh run. This is not the old HyperResearch or MONOKL pipeline: do not claim their vault, ranking, contradiction analysis, or citation checks ran. Say which steps actually ran.
- Not every API is reachable through the catalog tools. A source no catalog MCP server can read is out of scope; say so instead of improvising a fetcher.
- A handshake can succeed while the library is unusable. The owner's first Zotero trial (2026-10-05) did exactly that: the local MCP handshake succeeded, but no Zotero database existed at the configured or default path. Report that state as `prerequisite_missing`, not as usable.

## MCP transport

- Prefer the installed `mozak-mcp` stdio server when the agent host supports MCP. Its managed descriptor is `mcp.json` in this skill directory.
- Use its closed typed tools for project context, project overview, project validation, KB tree, and next-goal recommendation.
- Fall back to the `mozak` CLI for unsupported tools, mutations, or hosts without MCP. MCP does not weaken any approval, trust, or fail-closed boundary.

## Command runner

- Prefer `mozak ...` only when `mozak --help` or its usage shows the requested route.
- If `mozak` is absent or the route is unavailable, inspect `mozak --help`/usage, then run the repository implementation as `cargo run -q -p mozak-cli -- ...` from the MOZAK source tree.
- Map only to these implemented/current routes. Do not invent flags, subcommands, services, or state transitions.

## Local production setup

- Version: `mozak --version`
- Delivery status: `mozak delivery status`
- Verified update: `mozak update [--channel stable|main] [--enable-auto|--disable-auto]`
- Offline rollback: `mozak rollback`
- Install the exact embedded managed skill payload: `mozak setup install HOME`
- Verify exact installed parity without mutation: `mozak setup check HOME`
- Check skill parity, Termaid on PATH, and optionally a real KB:
  `mozak doctor HOME [KB_ROOT]`
- The managed payload ships `tool-stack.json` (the use-case catalog, see Explicit tool stack) and, for compatibility, `companion-recommendations.json`. `setup` and `doctor` keep the companion output shape and add a nonblocking `stack_onboarding` object that points to `mozak stack recommend` and `mozak stack check`. Termaid is required.
  The owner-approved sequence contract `mozak-sequence-commitment`, ADHD skill,
  and Notes `note`, `note-healthcheck`, and `note-voice-census`
  are MOZAK-managed, version-matched embedded payloads installed and checked
  under `.agents`, `.jcode`, `.claude`, and `.codex`. The Notes payload is pinned
  to Notes commit `91a2b675bf876e71433bec7d0d0cb6ef080d957c` with file hashes in
  `skills/notes-vendor-manifest.json`. mmdr, an exact Caveman skill when present,
  and drawing-family skills remain recommendations only.

The installed `mozak` command is a versioned launcher. It may contact GitHub
only for tool updates, using environment or `gh` authentication without
persisting a token. It works with a private or public repository, validates the
release manifest and SHA-256, preserves the previous build, and never treats
projects, registries, Scopes, recorded evidence, or KB roots as delivery state.
Automatic check failure continues with the current verified build.

The real binary's setup is offline, idempotent, and limited to MOZAK-managed
files under `.agents`, `.jcode`, `.claude`, and `.codex`. It refuses drift
rather than overwriting it and rejects symlink/path hazards. Doctor reports
deterministic JSON with ready/0, incomplete/2, or invalid/3 semantics. Neither
delivery nor setup makes automatic trust, authority, discovery, or
package-selection claims.

## Read-only routes

- Fresh-agent context by exact registered ID: `mozak project context PROJECT_ID`. The inline `knowledge.linked_scopes` array is capped deterministically and carries total/count/truncation metadata plus a detail command. Retrieve the bounded full detail with `mozak project linked-scopes PROJECT_ID [--limit N] [--offset N]`; records remain advisory-only, `accepted: false`, `trust_transfer: false`, and fail closed on configured KB drift. Context also includes a bounded `notes` summary with state/count/truncation and a detail command; absent device-local Notes config reports `needs_input` without invalidating context.
- Device-local Notes bridge: `mozak project notes PROJECT_ID [--limit N] [--offset N]`, `mozak notes scope SCOPE_ID [--limit N] [--offset N]`, and `mozak notes meta-goal META_GOAL_ID [--limit N] [--offset N]`. The bridge validates two strict files independently. `~/.config/notes/profile.json` is the only destination-root authority and uses the existing Notes profile shape: `{ "schema_version": 1, "destinations": [{ "id": "research", "root": "/absolute/vault" }] }`; optional purpose, routing, trim, default, Obsidian, and safe relative exclusion controls are validated, with at most one default. `~/.config/notes/mozak-links.json` contains only MOZAK scope mappings: `{ "schema_version": 1, "links": { "scope_id": [{ "destination_id": "research", "safe_relative_path_prefixes": ["safe/relative/path"] }] } }`. A scope may bind to multiple destinations. Project notes include the direct Project Scope plus scopes related through shared Meta Goals and promotions while preserving each relationship. Context reports only bounded counts/state and does not read note bodies, derive titles, or hash note bytes. Detail commands stream exact hashes only for the requested page, never output note bodies or absolute vault roots, scan only safe relative prefixes inside real destination roots, and fail closed on configured KB drift, malformed files, path escapes, `..`, symlinks, or scan ceiling overflow.
- Fresh-install Notes onboarding is proposal-first: `mozak notes onboard propose OUTPUT_JSON` validates the existing profile controls, scans only destination roots explicitly named by that profile, skips hidden vault metadata such as `.obsidian` and every configured `excluded_paths` tree, validates that the output is outside all Notes roots before creating parent directories, and creates one deterministic proposal without overwriting. Owner-approved explicit mappings keep their exact prefix semantics even when they name an excluded tree. Matching uses every registered Project or Topic Scope from id/title/intent tokens. Path and heading evidence outweigh bounded body evidence; body-only or ambiguous matches remain unresolved for owner review. The proposal contains relative paths, evidence, confidence, config/profile/KB/current-links pins, `accepted: false`, and `trust_transfer: false`, but no note bodies or absolute vault roots. Apply only with `mozak notes onboard apply PROPOSAL_JSON APPROVAL_JSON` and a separate approval pinning the exact proposal digest, target, current links state, profile digest, KB digest, configured owner, rationale, canonical UTC time, and intent `notes onboard apply`. Apply rejects symlinked input ancestors, revalidates every live pin under the exclusive links lock immediately before commit, performs locked readback and directory fsync while rollback remains available, preserves the previous mapping on failure, treats post-commit cleanup and unlock as best-effort, and never writes to destination roots.
- `mozak notes check` is read-only mapping integrity: it validates the Notes profile, mapping schema, registered Scope ids, destination containment, symlink refusal, and mapped-prefix existence. It does not audit Markdown quality, links, formatting, or trust metadata inside notes. Use the separate `note-healthcheck` skill for Markdown auditing and repair proposals.
- Bounded current-state view by exact registered ID: `mozak project current PROJECT_ID`. It uses the sealed Stage 1 current-state projection and reports goal state, historical adapter-run freshness (field `adapter_freshness`, kept for hash compatibility, now `historical` with `callable: false` and informational pin drift; it describes artifact age, never runtime availability), newest proposal-only research, superseded artifacts, and next owner decision while distinguishing latest recorded, latest observed, and accepted. Navigation uses `mozak project browse PROJECT_ID`, `mozak project resolve PROJECT_ID RECORD_ID`, and `mozak project why PROJECT_ID RECORD_ID`. Browse lists only explicitly configured records and never presents order as recommendation, acceptance, or truth. Resolve follows only declared Stage 1 projection relationships and refuses stale hashes/freshness or undeclared records. Why explains inclusion, freshness, authority, and blocking conditions, including why a newer DAIR run supersedes an older recorded run without accepting either. These commands are bounded, dump no note bodies/full KB, mutate nothing, transfer no trust, and promote nothing. Use the `configured_owner` field from `project context` as the stable actor for authored plan and approval actor fields. Do not infer the actor from latest approval owner because refresh approvals can be authored by a different person.
- Bounded registration preview: `mozak project discover KB_ROOT WORKSPACE_ROOT [WORKSPACE_ROOT ...]`
- Strict read-only registration delta: `mozak project review DISCOVERY_JSON`
- Onboarding inspection, project status: `mozak project status [PROJECT]`
- Contract validation: `mozak project validate [PROJECT]`
- Project summary: `mozak project overview [PROJECT]`
- Project inventory: `mozak project list [ROOT]`
- Graph source: `mozak project graph-source [PROJECT]`
- Project graph: `mozak project graph [PROJECT]`
- Research validation: select a research run artifact from `project overview`, then run `mozak research validate RUN_JSON`
- Historical fixture normalization (offline, already-recorded fixtures only, never retrieval): `mozak research normalize SOURCE FIXTURE_JSON OUTPUT_RUN_JSON`
- Condensation addressability: `mozak research landmarks RUN_JSON LANDMARKS_JSON`. A digest or Scope input derived from a run is read instead of the run, so each condensed statement records the evidence id it came from and pins that evidence's content hash. Altered evidence fails closed rather than silently repointing the statement. Landmarks add addressing only; they accept and promote nothing.
- Next-goal recommendation: select accepted inputs and a plan from `project overview`, then run `mozak planning next ACCEPTED_INPUTS_JSON PLAN_JSON`
- Compatibility-only legacy execution validation: `mozak execution validate BUNDLE_JSON OBSERVED_REVISION OBSERVED_AT`
- Knowledge package validation: `mozak package validate PACKAGE_ROOT`
- External attestation projection: `mozak package attest PACKAGE_ROOT`. Emits an in-toto v1 Statement to stdout for a validated package, with each artifact as a subject identified by its SHA-256 digest and a MOZAK-owned `predicateType`. It is derived on every call and never stored, so the package stays the single source of truth. It attests to identity and derivation only and asserts nothing about the correctness or quality of the knowledge. A tampered or unvalidatable package produces no statement rather than a wrong one.
- Knowledge package inventory: `mozak package list PACKAGE_ROOT`
- Supplied package history validation: `mozak package history validate PACKAGE_ROOT [PACKAGE_ROOT ...]`
- Pinned case-record validation: `mozak case validate CASE_JSON`
- Pinned case-record inventory: `mozak case list CASE_JSON`
- Reviewer reproduction packet from a case: `mozak case reproduce-packet CASE_JSON`. It inverts the record for one reader, handing over the pinned inputs and locators rather than the conclusion.
- Concept validation: `mozak concept validate CONCEPT_JSON`
- Concept and Translation inventory: `mozak concept list CONCEPT_JSON [TRANSLATION_JSON]`
- Target-owned Translation validation: `mozak concept translation validate CONCEPT_JSON TRANSLATION_JSON`
- Deterministic external Concept inventory for one registered target: `mozak kb concept candidates TARGET_SCOPE_ID [RESEARCH_RUN_JSON ...]`. It uses the exact configured KB, excludes target-owned Concepts, performs no relevance ranking, and labels explicitly supplied validated research runs `proposal_only` and `accepted: false`.
- Hash-pinned Translation preparation: `mozak kb concept translation-packet TARGET_SCOPE_ID CONCEPT_ID CONCEPT_SHA256`. The packet enumerates the source assumptions and target-evidence requirements. It is not a Translation, changes nothing, and authorizes no adoption.
- Local Meta KB validation: `mozak meta validate META_KB_ROOT`
- Local Meta KB inventory: `mozak meta list META_KB_ROOT`
- Local Meta KB graph source: `mozak meta graph-source META_KB_ROOT`
- Local Meta KB graph: `mozak meta graph META_KB_ROOT`
- Scope snapshot validation: `mozak scope validate SCOPE_ROOT` (snapshot validity only)
- Scope inventory/export: `mozak scope list SCOPE_ROOT`, `mozak scope export SCOPE_ROOT`
- Scope graph source/rendering: `mozak scope graph-source SCOPE_ROOT`, `mozak scope graph SCOPE_ROOT`
- Create an empty Topic Scope: `mozak scope init SCOPE_ROOT SCOPE_ID TITLE INTENT`. The route is create-only, writes a schema-v2 manifest with no accepted inputs, validates what it wrote, and removes the file if validation fails. It never infers a title or intent.
- Add another Scope entry to an existing root: `mozak scope add-topic SCOPE_ROOT SCOPE_ID TITLE INTENT`. One Scope root can hold many Scope entries, which is how a family of related projects and topics shares one manifest, one evidence store, and one history.
- Bind an existing repository as a Project Scope: `mozak scope add-project SCOPE_ROOT SCOPE_ID TITLE INTENT PROJECT_ROOT`. The Scope id must equal the project id. The route copies `.mozak/project.yml` into `projects/SCOPE_ID/.mozak/project.yml`, pins its SHA-256, and mirrors the identity, revision, and owned paths the manifest declares. The repository stays authoritative; the copy makes the Scope verifiable on its own and drift fails closed.
- Group Scopes with an advisory Meta Goal: `mozak scope add-goal SCOPE_ROOT GOAL_ID TITLE SCOPE_ID [SCOPE_ID ...]`. Every named Scope must already exist in that root. Authority is always `advisory_only`, Meta Goals may overlap freely, and they transfer no truth, mutation, or execution authority.
- Every authoring route validates the whole root after writing and rolls back on any failure, so a rejected edit never leaves a partial Scope or an orphaned manifest copy. Each receipt states that the change requires re-pinning a registered KB.
- Index an existing Scope in a KB registry: `mozak kb register REGISTRY_ROOT REGISTRATION_ID SCOPE_ROOT`. It refuses an invalid Scope, a duplicate id, and an already-registered root, pins the observed manifest hash, and records a location only. Registration transfers no trust, truth, or authority. Changing `kb.json` invalidates a configured KB pin, so follow it with the `project discover`, `project review`, `project refresh` route.
- Re-pin a registration after a legitimate Scope edit: `mozak kb repin REGISTRY_ROOT REGISTRATION_ID SCOPE_ROOT`. Editing a registered Scope invalidates its recorded hash, and validation fails closed until the pin moves. Repin refuses an unknown registration, an already-current pin, a different Scope root, and an invalid Scope. It records an observed hash only; it accepts no content and transfers no trust. If the KB is also the configured one, follow it with `project discover`, `project review`, `project refresh`.
- Local source freshness: `mozak scope source-check SCOPE_ROOT SOURCE_ID SOURCE_ROOT OBSERVED_REVISION`
- Explicit KB registry validation: `mozak kb validate REGISTRY_ROOT`
- Unified KB inventory and tree: `mozak kb list REGISTRY_ROOT`, `mozak kb tree REGISTRY_ROOT`. Filter the tree with any union of `--concept`, `--project`, and `--topic`, for example `mozak kb tree --concept --project` against the configured KB.
- Unified KB graph source/rendering: `mozak kb graph-source REGISTRY_ROOT`, `mozak kb graph REGISTRY_ROOT`
- Configured current Meta KB, without knowing its path: `mozak kb validate`, `mozak kb list`, `mozak kb tree [--concept] [--project] [--topic]`, `mozak kb graph-source`, `mozak kb graph`
- Evidence-based parity assessment: `mozak kb parity REGISTRY_ROOT OBSERVATIONS_JSON`

Treat overview, list, graph-source, graph, validation, status, and next-goal recommendation as read-only even when they reveal work to do.

## Networking and historical adapter evidence

- The MOZAK binary's project, stack, and validation routes perform no networking: they check local config, files, and recorded evidence. Network access happens outside those routes, only in the agent host calling an MCP server, and MOZAK validates the recorded snapshot that came back. The managed launcher's update check is the one exception and contacts GitHub only for tool updates. Retrieved content enters under the `recorded` scheme as immutable untrusted data, never as a live resource.
- Live source adapters are retired. No adapter runner, adapter registry route, or adapter catalog entry remains, and nothing can launch one. Never suggest setting up, running, rechecking, listing, or showing an adapter, and never fall back to one when an MCP tool is missing.
- Runs that adapters already recorded are historical evidence and stay valid. Read them with `mozak research validate RUN_JSON`, `project current`, `project browse`, and `project why`, which report them as `historical` and `callable: false`. `research normalize` re-derives a run only from an already-recorded fixture, offline. Do not delete, rewrite, or re-pin historical adapter evidence.
- Every recorded run, historical or new, is proposal-only research evidence. Promoting a source to a Scope input or an accepted planning input remains an explicit owner decision. Recording makes no relevance-ranking claim.

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

## Concepts, Translations, and case records

- A Concept is owned by whoever authored it: a Topic or Project keeps its own under `concepts/` in its Scope root or `.mozak/concepts/` in its repository, and a Translation lives with the adopting target under `.mozak/translations/`. A Concept is advisory only. It records a reusable mechanism, the invariant that must still hold, applicability limits, evidence, and the assumptions it rests on. It never authorizes adoption, execution, or mutation.
- A Translation is owned by the adopting target. It is valid only when the target re-derived every source assumption as holds, replaced, rejected, or could_not_check. Replacing or rejecting an assumption is qualified adoption, never full adoption, and a load-bearing assumption that was rejected or never checked is not adoption at all.
- A holding assumption requires evidence observed in the target, not in the source. A Translation pins the exact Concept hash and fails closed on drift.
- Use `mozak kb concept candidates TARGET_SCOPE_ID [RESEARCH_RUN_JSON ...]` when an agent needs cross-project experience. The output is a deterministic inventory, not a recommendation. Registered Concepts remain `advisory_only`; supplied research runs remain `proposal_only`, are never accepted by this command, and are not discovered by scanning.
- After choosing one exact candidate, use `mozak kb concept translation-packet TARGET_SCOPE_ID CONCEPT_ID CONCEPT_SHA256`. The target must then author its own Translation, provide target-side evidence for `holds` and `replaced`, and validate it with `mozak concept translation validate`. The packet itself is never an adoption record.
- A case record is a pinned, calibrated observation of finished real work. Its derived proposals are `proposal_only` and must pass the ordinary planning gates; recording a case never accepts its proposals and never makes them another project's truth.
- A case must record its own limitations, must separate measured observations from qualitative interpretation, and cannot report a comparative result without a control that declares itself comparable.
- `mozak kb tree` lists scope-owned Concepts, and `mozak project overview` and `mozak project list` report project-owned Concepts and Translations. A Translation whose source Concept is authored by another owner is reported as an external pin rather than as verified or as a defect.
- Automatic case collection, a self-improvement daemon, and any route that feeds findings into accepted knowledge without owner acceptance remain unimplemented and unsupported.

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

## Local Meta KB

- A local Meta KB is rooted at a strict `meta-kb.json` manifest. `meta validate` is the authority for whether its release files, optional human overviews, hashes, identities, and relationships are valid.
- Use `meta list` for terminal inventory and `meta graph` for an actual Termaid relationship view.
- Knowledge releases remain immutable project publications. A cross-project relationship or reusable pattern is context for evaluation, not authorization and not automatically another project's truth.
- Current Meta KB commands are read-only. The configured KB can now inventory registered external Concepts and prepare target Translation packets, but MOZAK does not yet implement automatic import, relevance ranking, research discovery by scanning, networking, registry publication, hosted discovery, automatic adoption, or Meta KB mutation.

## Explicit KB registry

- For “my Meta KB”, “current Meta KB”, or an equivalent unqualified request, run the rootless configured route directly. Use `mozak kb tree` for a concise hierarchy and `mozak kb graph` for Termaid. Never search the filesystem for the KB path first.
- Rootless KB routes resolve only the exact owner-registered KB in the local MOZAK config and fail closed when the config is missing, malformed, or hash-drifted. Use a path argument only when the user explicitly identifies another KB root.
- A KB registry is rooted at strict `kb.json` and loads only explicitly registered canonical absolute Scope roots with exact `scope.json` hashes. It never scans for unregistered roots.
- Use `kb tree` for the deterministic combined hierarchy and `kb graph` for the actual Termaid view. Nested registrations appear nested only when both roots are explicit.
- `kb parity` reports every fixed gate as passed, failed, unsupported, or blocked. Exit 2 means parity was not demonstrated and must be reported honestly.
- Current import/export round trip, version history, and rollback/recovery gates are unsupported. Human editability remains blocked without a witnessed trial. Registered source vaults remain authoritative and must not be archived or deleted from these results.

## Project context

- For every fresh project request, first run `mozak project context PROJECT_ID`. Resolve exact registered IDs only. Do not guess, fuzzy-match, or scan implicitly.
- If the exact id is unknown or `project context` reports an unregistered id, run `mozak project registrations`. This lists the configured ids, names, and roots without consulting the live KB, so it remains usable during KB drift. Do not use rootless `mozak project list` for this purpose; that command inventories the current directory as a project.
- `project context` may atomically update only the selected existing registration's observed manifest/idea/revision pins when the live project is valid and its id, name, canonical root, manifest paths, manifest contract identity, owned paths, and configured KB are unchanged. It uses the same exclusive lock and config-digest compare-and-swap as approved refresh. It never scans for projects.
- Additions, removals, renames, root changes, KB changes, and manifest identity or authority changes still require `project discover`, `project review`, and the exact owner-approved `project refresh` route. If an older config has no manifest baseline, manifest drift fails closed until an approved refresh establishes one.
- Every automatic pin reconciliation preserves both config generations and writes a deterministic, digest-verified audit entry with the configured owner, canonical UTC time, reason, and old/new digests. Inspect it with `mozak project refresh history`; restore one preserved identity-equivalent generation with `mozak project refresh rollback CONFIG_SHA256`.
- Context is progressive disclosure. Use its matching KB Scopes/packages, validated absolute context-note paths, and detail commands as needed. Do not request or emit note bodies or a whole KB dump by default. Stop on an invalid context response instead of working from stale or malformed bytes.
- Goal closure, acceptance, audit, release-candidate, and handoff records are goal evidence, not project documentation. Write them under `.mozak/evidence/<goal-id>/`, never in the repository's `docs/`, and pin each one in the successor plan's goal as `evidence: [{path, sha256}]`. Supersede an old record by pinning a newer one; do not edit a pinned record, because `project overview` reports digest drift as invalid.
- `project overview` is the authority for current plans, input sets, and validated project contexts. Do not select an unversioned legacy file merely because its name looks canonical.
- When `project overview` returns `contexts`, read every listed `context_note` needed by the requested goal before researching, planning, executing, or evaluating work.
- Treat a context note as provenance-pinned project knowledge, not authorization. Its claim boundaries and refresh rule remain binding.
- When delegating to a fresh external agent, include the relevant context-note path and its constraints in the bounded task. Do not assume the agent discovered it independently.

## Source-neutral tool evidence

- Record one tool call as evidence with `mozak research record-tool FIXTURE_JSON RESPONSE_BYTES RUN_JSON`. It is create-only and writes a standard research run, so `mozak research validate RUN_JSON` and `research landmarks` work unchanged.
- Check a stored run against its inputs with `mozak research verify-tool FIXTURE_JSON RESPONSE_BYTES RUN_JSON`. It is read-only, re-derives the run, and requires a byte-for-byte match.
- The `mozak.tool-evidence.v1` fixture pins the catalog tool id, kind, exact version, operation, and MCP server; canonical call arguments and their hash; the UTC call window; declared effects; the exact response hash and length; and each selected excerpt with its locator and byte range. The full response is never stored.
- New recordings are MCP-only: `tool.kind` must be `mcp` and `tool_id` must be the shipped catalog id (for example `arxiv-mcp`), never a package name. The generic format still lets `verify-tool` and `research validate` read evidence recorded before this rule.
- Refused: response hash or length mismatch, an excerpt that differs from its byte range, declared external writes, mutations other than `none`, irreversible effects, pending owner approval, `latest`/unknown versions, credential-looking argument keys, `accepted: true`, symlinked paths, and an existing output. `dry_run_available` is recorded but not enforced, because a call that already happened has no meaningful dry run. The receipt `input_hash` is the SHA-256 of the canonical (key-sorted, compact) fixture JSON, so reformatting the fixture does not change it. Truncated results get a high-impact gap.
- The agent host makes the call. MOZAK only records and validates the bytes the host saved. See `docs/examples/tool-evidence-example.md`.

## Input provenance and owner acceptance

- Research evidence, from an MCP tool or a historical adapter run, is recorded once as an immutable snapshot with its exact source, time, and content hashes. Later edits fail validation; a correction is a new snapshot, never an overwrite.
- A recorded snapshot is `proposal_only`. It becomes a planning input only when the owner explicitly accepts it into a new input set. A tool call, a successful record, a stack check, or general approval of the migration is not that acceptance.
- Accepted inputs carry provenance (`human_decision`, `codebase_observation`, or recorded evidence) so any plan can be traced back to who decided what, from which bytes.

## Mutating routes

- Register an exact reviewed discovery proposal: `mozak project register DISCOVERY_JSON APPROVAL_JSON`
- Refresh an exact reviewed replacement: `mozak project refresh DISCOVERY_JSON APPROVAL_JSON`
- Register projects without a local checkout: `mozak project register-remote REMOTE_SPECS_JSON APPROVAL_JSON`. It performs no networking and needs an approval pinned to the exact specs file hash with `intent: "project register-remote"`. Each spec carries an https or `git@github.com:` URL, an exact pinned commit, and the expected manifest and idea hashes.
- Fetch a remote-only project: `mozak project fetch PROJECT_ID`. This is the only MOZAK command that touches the network. It fetches the registered URL at the pinned commit into `~/.cache/mozak/projects/PROJECT_ID` and removes the checkout unless its bytes match the registration. `project context` never clones: for an unfetched project it reports invalid and names `project fetch`, so run it first, then context.
- Remove cached remote checkouts: `mozak project prune [PROJECT_ID]`. It refuses a locally registered project.
- Inspect automatic refresh audit history: `mozak project refresh history`
- Roll back to a preserved identity-equivalent config generation: `mozak project refresh rollback CONFIG_SHA256`
- Registration is create-only and atomically creates only an absent local config. Never delete or replace it to force registration. Refresh requires an existing valid config, an exact matching `config_base_sha256`, and strict owner approval pinned to the digest and target with `intent: "project refresh"`, owner, canonical UTC time, and rationale.
- Treat the discovery project list as the entire reviewed replacement, including additions, removals, and changed pins. Refresh never auto-discovers or transfers trust and must preserve the prior config on failure.
- Initialize onboarding files: `mozak project init [PROJECT]`
- Import one exact owner-approved local package: `mozak kb import-package PACKAGE_ROOT INPUT_REGISTRY_ROOT APPROVAL_JSON OUTPUT_KB_ROOT`
- Produce a release artifact: `mozak project release PROJECT ACCEPTED_STATE OUTPUT`
- Apply an owner-approved closed-KB link plan: `mozak scope ingest-links SCOPE_ROOT SOURCE_ROOT OBSERVED_REVISION PLAN_JSON OUTPUT_ROOT`
- Planning acceptance, packet/state changes, execution, and release are mutations even when a future CLI exposes a direct route.

Before every mutation, run the relevant status, overview, validation, or next command and summarize the exact proposed files/state/output. Require explicit owner acceptance before accepting planning state, executing a packet, or releasing. A vague request for status, planning, a packet, or “what next?” is not acceptance. Never overwrite an existing file or accepted state destructively. Choose a new output path or stop and ask the owner.

For project registration on a fresh machine, first run the read-only bounded `project discover` route, save its exact JSON, then run `project review` on that file. Present the exact review JSON to the owner. If review reports `action: "none"`, stop without requesting approval or invoking a mutation. Otherwise require a separate strict owner approval artifact pinned to `decision: true`, that digest, target path, owner, canonical UTC approval time, and rationale before invoking the action reported by review. If the action is refresh, also require `intent: "project refresh"`. Invocation, discovery, review, setup, or general permission is not approval or trust transfer. Review is read-only and explicitly reports no automatic
discovery, trust transfer, or mutation. Never register or refresh automatically.

For project refresh, repeat that exact discovery and review against the existing config. Require the separate strict refresh approval and invoke only the reviewed proposal. Never merge, retain, add, or discover records outside its exact project list.

For `scope ingest-links`, first validate `SCOPE_ROOT`, inspect the schema-v1 plan, and require explicit owner approval of the exact `scope_id`, history entry, selected existing input IDs, inclusions, observed revision, and new `OUTPUT_ROOT`. Source paths and link targets must be ASCII-only safe relative paths. The output and sibling staging path must be outside the input Scope and source roots and must not already exist, including as dangling symlinks. Never generate inclusions by scanning, recursion, aliases, headings, empty links, or vault-root inference. The command must preserve `source_vault_remains_authoritative`; never run a real pilot unless separately and explicitly approved.

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

## Bounded external-agent workflow

MOZAK does not claim autonomous research, background agents, automatic Meta KB ingestion, networking, hosted registry behavior, or self-improvement. When another agent is available, keep delegation explicit and bounded:

1. Inspect local project state and select one accepted goal or question.
2. Give the external agent the objective, allowed paths/sources, relevant validated context-note paths and claim boundaries, constraints, expected artifacts, and stop conditions.
3. Require the agent to return artifacts and evidence in the foreground interaction. Do not imply MOZAK spawned or monitored it in the background.
4. Review the diff/artifacts locally, then run `research validate` or `execution validate` as appropriate.
5. Present failures and decisions to the owner. Do not accept planning state, execute further work, or release without explicit owner acceptance.

## Human output

MOZAK output is read by a person deciding what to do next, often mid-task and
low on working memory. Shape it so it can be acted on, not just verified.

Five rules, in priority order:

1. Lead with the action or the finding. If the answer is a command or a path, it goes first, before any explanation.
2. Number any sequence the reader must perform in order, one bounded action per step.
3. Restate where the work stands every turn. The reader cannot hold "step 3 of 5" between messages.
4. End with one concrete next step, small enough to start now.
5. Cap a list at five items. Past five, split into do-now and later, and say which is which.

Then:

- Use concise terminal bullet lists for status, checks, decisions, commands, and errors.
- Give a concrete estimate when the reader is deciding whether to start: minutes or steps, not "some work". Say so when you have not measured it.
- Report a failure as cause then fix, in that order. Never "uh oh" or "there seems to be a problem".
- Finish the current thing before raising a second. Surface the second once, at the end, as its own question.
- No preamble, no recap of what you just did, no closing pleasantry.

For relationships, run `mozak project graph [PROJECT]`, `mozak meta graph META_KB_ROOT`, `mozak kb graph REGISTRY_ROOT`, or pipe the corresponding `graph-source` through the installed `termaid` CLI, then present the resulting Unicode box-drawing output in a fenced `text` block. Never present Mermaid source as if it were a rendered Termaid diagram.

- Never promise a browser UI, web dashboard, autonomous research, persistent background work, hidden knowledge ingestion, or self-modification.
