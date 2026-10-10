# MOZAK reference: full command routes

Load this when you need an exact route that the core skill does not list, or the full safety text of a mutating route.

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
  The ADHD skill and Notes `note`, `note-healthcheck`, and `note-voice-census`
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
