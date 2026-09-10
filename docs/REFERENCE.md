# MOZAK reference

Every route, what to say to get it, and what it guarantees. For the short
version see the [README](../README.md). For the model see
[ARCHITECTURE.md](ARCHITECTURE.md).

You talk to your agent, not to the CLI. Each section below gives the phrasing
first, then the exact command, then the rule. `mozak` with no arguments prints
the authoritative usage.

Read-only routes are safe to ask for at any time. Anything marked **mutation**
needs your explicit approval, and some need an approval file. MOZAK core routes
are offline; configured adapters may use the network and must declare it.

Exit codes: `0` valid, `2` incomplete, `3` invalid, `1` bad invocation.

## Start of session

| Say this | Agent runs |
|---|---|
| "Work on mozak." | `mozak project context mozak` |
| "What's the status of this project?" | `mozak project status .` then `mozak project overview .` |
| "What should I do next here?" | `mozak project overview .` |
| "Onboard this repo into MOZAK." | `mozak project init .` (creates two files) |
| "Show me my knowledge base." | `mozak kb tree` |

## Every route, by module

### Scope

| Say this | Agent runs |
|---|---|
| "Is this project valid?" | `mozak project validate .` |
| "List everything MOZAK recognises here." | `mozak project list .` |
| "Show this project's dependency graph." | `mozak project graph .` |
| "Find my MOZAK projects under ~/code." | `mozak project discover <kb-root> ~/code` |
| "Review that discovery before registering." | `mozak project review <discovery.json>` |
| "Start a topic for X." | `mozak scope init <root> <id> "<title>" "<intent>"` **(mutation)** |
| "Bind this repo into the scope as a project." | `mozak scope add-project ...` **(mutation)** |
| "Is my scope's source still fresh?" | `mozak scope source-check ...` |

```bash
mozak project init|status|validate|overview|list|graph-source|graph [project-directory]
mozak project discover <kb-root> <workspace-root> [workspace-root ...]
mozak project review <discovery.json>
mozak project register <discovery.json> <approval.json>          # mutation
mozak project refresh <discovery.json> <approval.json>           # mutation
mozak project context <project-id>
mozak scope init|add-topic <scope-root> <scope-id> <title> <intent>          # mutation
mozak scope add-project <scope-root> <scope-id> <title> <intent> <project-root>  # mutation
mozak scope add-goal <scope-root> <goal-id> <title> <scope-id> [scope-id ...]    # mutation
mozak scope validate|list|graph-source|graph|export <scope-root>
mozak scope source-check <scope-root> <source-id> <source-root> <observed-revision>
mozak scope ingest-links <scope-root> <source-root> <observed-revision> <plan.json> <output-root>  # mutation
```

### Research

| Say this | Agent runs |
|---|---|
| "Which adapters do I have?" | `mozak adapter catalog` then `mozak adapter list` |
| "Tell me about one of my bindings." | `mozak adapter show <binding-id>` |
| "Fetch new papers for this topic." | `mozak adapter run <binding-id>` |
| "Turn that fetch into a research run." | `mozak research normalize <source> <fixture.json> <run.json>` |
| "Check this research run is valid." | `mozak research validate <run.json>` |
| "Validate this case record." | `mozak case validate <case.json>` |
| "Build a packet so someone can reproduce this case." | `mozak case reproduce-packet <case.json>` |

```bash
mozak adapter catalog
mozak adapter setup <dair-ai|mcp-registry|github-tooling> <binding-id> <scope-id> <request.json> <runner> <runs-dir>  # mutation
mozak adapter list|show <id>|run <id>|recheck <id>
mozak research normalize <arxiv|dair-ai|mcp-registry|github-tooling> <fixture.json> <run.json>
mozak research validate <run.json>
mozak research landmarks <run.json> <landmarks.json>
mozak case validate|list|reproduce-packet <case.json>
```

`adapter show` and `adapter run` take a **binding id** from `adapter list`, not
an adapter name from `adapter catalog`. A binding pins its request and runner by
SHA-256; editing either moves the binding to `needs_recheck` and makes it
non-callable until `adapter recheck` re-pins the observed hashes. Recheck
records hashes only. It approves nothing and accepts no prior run.

MOZAK performs no networking. An adapter fetches outside MOZAK and MOZAK
validates the recorded snapshot. `research normalize` refuses any adapter that
declares a write, a mutation, an irreversible effect, or a pending approval.

`research landmarks` makes a condensed statement addressable: each statement
records the evidence id it came from and pins that evidence's content hash, so
altered evidence fails closed rather than silently repointing the statement.
Landmarks add addressing only; they promote nothing.

`case reproduce-packet` inverts a case record for one reader, handing over
pinned inputs and locators rather than conclusions. A case must separate
measured observation from interpretation, record its own limitations, and
cannot report a comparative result without a control that declares itself
comparable. Case proposals stay `proposal_only`.

### Plans

| Say this | Agent runs |
|---|---|
| "What's the next goal I can start?" | `mozak planning next <accepted-inputs.json> <plan.json>` |
| "Show the current plan and ready goals." | `mozak project overview .` |
| "Verify this package." | `mozak package validate <package-root>` |
| "Make this package verifiable outside MOZAK." | `mozak package attest <package-root>` |
| "Check this package lineage." | `mozak package history validate <root> [root ...]` |
| "Publish a release for this project." | `mozak project release ...` **(mutation)** |

```bash
mozak planning next <accepted-inputs.json> <plan.json>
mozak execution validate <bundle.json> <observed-revision> <observed-at>
mozak project release <project-root> <accepted-state.json> <output.json>   # mutation
mozak package validate|list|attest <package-root>
mozak package history validate <package-root> [package-root ...]
mozak validate|replay <fixture-file>
```

`package attest` emits an in-toto v1 Statement to stdout for a validated
package, each artifact a subject identified by its SHA-256 digest under a
MOZAK-owned `predicateType`. It is derived on every call and never stored, so
the package remains the single source of truth. It attests identity and
derivation only, never correctness or quality, and a tampered package produces
no statement rather than a wrong one.

`execution validate` is compatibility-only for legacy bundles. It is not the
current core architecture and not the fresh-agent entry point.

### Meta KB

| Say this | Agent runs |
|---|---|
| "Validate my KB." | `mozak kb validate` |
| "Show only Concepts in my KB." | `mozak kb tree --concept` |
| "Show Projects and Topics, but not Concepts." | `mozak kb tree --project --topic` |
| "Draw the KB relationships." | `mozak kb graph` |
| "Register this scope in my KB." | `mozak kb register <registry> <id> <scope-root>` **(mutation)** |
| "I edited a registered scope, fix the pin." | `mozak kb repin <registry> <id> <scope-root>` **(mutation)** |
| "Import this package into my KB." | `mozak kb import-package ...` **(mutation, needs an approval file)** |
| "Draw how my projects relate." | `mozak meta graph <meta-kb-root>` |
| "Did we re-derive this concept's assumptions?" | `mozak concept translation validate <concept.json> <translation.json>` |

```bash
mozak kb validate|list|graph-source|graph [registry-root]
mozak kb tree [registry-root] [--concept] [--project] [--topic]
mozak kb register|repin <registry-root> <registration-id> <scope-root>   # mutation
mozak kb parity <registry-root> <observations.json>
mozak kb import-package <package-root> <input-registry-root> <approval.json> <output-kb-root>  # mutation
mozak meta validate|list|graph-source|graph <meta-kb-root>
mozak concept validate|list <concept.json>
mozak concept list <concept.json> <translation.json>
mozak concept translation validate <concept.json> <translation.json>
```

Omitting `registry-root` resolves the exact owner-registered KB from the local
config and fails closed when it is missing, malformed, or hash-drifted.
Tree filters form a union and may be combined in any order. Root lines remain
as hierarchy; filtered output omits Meta Goals and owned packages. With no
filter, the complete existing tree is unchanged.

A Concept is advisory only. It records a reusable mechanism, the invariant that
must hold, applicability limits, evidence, and the assumptions it rests on. It
authorizes no adoption, execution, or mutation. A Translation is owned by the
adopting target and is valid only when that target re-derived every source
assumption as `holds`, `replaced`, `rejected`, or `could_not_check`. A holding
assumption requires evidence observed in the target, not in the source.
Replacing or rejecting one is qualified adoption; a load-bearing assumption
rejected or never checked is not adoption at all. A Translation pins the exact
Concept hash and fails closed on drift.

### Improve Lab

| Say this | Agent runs |
|---|---|
| "What can the Lab improve?" | `mozak lab modules` |
| "Open a Lab run on the plans module." | `mozak lab start <run-dir> <scope-id> plans "<question>" <binding-id>` |
| "Ingest this adapter run into the Lab." | `mozak lab refresh <run-dir> <adapter-run.json>` |
| "Where is this Lab run up to?" | `mozak lab status <run-dir>` |
| "Show me the Lab's proposed plans." | `mozak lab review <run-dir>` |

```bash
mozak lab modules
mozak lab start <run-dir> <scope-id> <module> <question> <binding-id> [binding-id ...]
mozak lab refresh <run-dir> <adapter-run.json>
mozak lab select|read|mechanisms|plans <run-dir> <input.json>
mozak lab review|status <run-dir>
```

`<module>` is one of `scope`, `research`, `plans`, `meta-kb`, `improve-lab`,
`skill`. `mozak lab modules` is authoritative and returns each id, a one-line
summary, and the source files it governs.

The ordered steps are `refresh`, `select`, `read`, `mechanisms`, `plans`,
`review`. Each records an immutable transition with actor, time, and input
hash; a skipped or out-of-order step is rejected. `refresh` classifies every
candidate as new or unchanged by content hash. `select` requires an inclusion
or exclusion reason for every candidate, so silent omission is impossible.
`read` records claim-level findings with locators, limitations, and source
class, and a reading that sets `retained_full_text` is rejected. Each claim is
labeled `source_claim` or `lab_inference`, and a mechanism resting only on Lab
inference is rejected. Each plan card cites a known mechanism and carries at
least two acceptance checks.

The Lab is planning-only. A run stops at `owner_reviewed` and authorizes
nothing. Implementation, evaluation, and promotion are separate owner-authorized
phases.

### Skill

These you usually type yourself.

```bash
mozak doctor "$HOME"      # is MOZAK healthy and is the skill installed?
mozak setup check "$HOME" # has anything drifted?
mozak delivery status     # which build is active
mozak update              # latest stable
mozak rollback            # back to the previous build
mozak --version
```

Full forms:

```bash
mozak update [--channel stable|main] [--enable-auto|--disable-auto]
mozak setup install|check <HOME>
mozak doctor <HOME> [KB_ROOT]
```

## What an agent will refuse

- Registering, refreshing, importing or releasing without an explicit approval file.
- Overwriting an existing accepted state or output path.
- Treating adapter output, an imported package, or a registered scope as true.
- Advancing a Lab run past your review.

## Distribution and managed setup

The installed command is a small managed launcher pointing at immutable,
versioned binaries. Stable releases follow version tags. The opt-in `main`
channel follows every successful push to `main`.

```bash
mozak delivery status
mozak update
mozak update --channel main --enable-auto
mozak rollback
```

GitHub Actions builds a static Linux x86-64 archive with a pinned manifest and
SHA-256, and exercises install, update, failed update, rollback, and
state preservation.

The launcher updates only its own version directories, symlinks, delivery
config, and managed skill files. Project repositories, registries, Scopes,
adapters, and KB roots are **not** delivery state.

The real binary retains the offline setup and verification routes:

```bash
mozak setup install "$HOME"
mozak setup check "$HOME"
mozak doctor "$HOME" [/path/to/kb-root]
```

- `setup install` places the embedded agent skill in `.agents`, `.jcode`,
  `.claude`, and `.codex`. Offline, idempotent, and refuses drift rather than
  overwriting it.
- `setup check` verifies installed parity without mutating anything, reporting
  each managed file as matching or drifted.
- `doctor` emits deterministic JSON: ready/0, incomplete/2, invalid/3.

See [`distribution/INSTALL.md`](distribution/INSTALL.md) for install, update,
rollback, backup, and the safety boundary. The delivery contract behind it is
[`spec/github-delivery.md`](../spec/github-delivery.md).

## Contracts in detail

The routes above are the surface. These are the rules each contract enforces.

`kb import-package` is the smallest supported mutation for package ingestion. It
requires a strict owner approval pinned to the exact package tuple and current
`kb.json` SHA-256, validates all source bytes first, then reconstructs a new KB
root and atomically publishes KB-owned bytes at
`packages/sha256/<package-digest>`. It is offline, never modifies the source
package or input registry, explicitly rejects exact duplicates and conflicts,
and never infers latest, official, trusted, preferred, or canonical status. See
[`package-import.md`](../spec/project-framework/package-import.md).

### Immutable knowledge packages

A knowledge package is a closed, offline-verifiable directory containing exactly
one identity-matched `ProjectRelease`, one UTF-8 Markdown human overview, and an
optional bounded set of public Markdown research or planning artifacts. The
strict manifest denies unknown fields and kinds, pins every byte and size by
SHA-256, recursively rejects undeclared files, unneeded directories, symlinks,
non-regular entries, and case-colliding paths, and has a content-digest identity
derived by the algorithm in
[`spec/project-framework/knowledge-package.md`](../spec/project-framework/knowledge-package.md).

`package validate`, `package list`, and `package history validate` are
machine-consumable, deterministic, local, and read-only. History is supplied
explicitly, may branch, requires exact predecessor and restore digests plus
gapless accepted-state versions, and permits restores only to a proper ancestor
of the predecessor. It never selects a latest, official, or preferred branch.
These commands perform no download, network lookup, import, publication,
signing, mutation, trust selection, or authority transfer.

### Generalized Scope foundation

The owner-approved `scope ingest-links` mutation applies a strict schema-v1 plan
pinned to the exact input manifest and observed source revision. It resolves only
selected existing notes against existing inputs plus declared inclusions, requires
one match per link and use of every inclusion, performs no discovery, and writes a
new validated Scope root atomically while the source vault remains authoritative.
Source paths and link targets are strict ASCII-only safe relative paths. Empty links,
output or staging locations within either input root, and existing entries including
dangling symlinks are rejected before installation; every failure cleans staging.
See [`spec/scope-wikilink-ingestion.md`](../spec/scope-wikilink-ingestion.md).

A Scope root contains one strict schema-version-2 `scope.json` manifest and locally
projected, content-addressed inputs. Scope `kind` is exactly `topic` or `project`.
Every Project Scope binds a copied, hashed `.mozak/project.yml`, either at the Scope
root or under `projects/<scope-id>/.mozak/project.yml`, reuses the Project
Framework validator, matches project identity, and exposes its pinned repository
revision and owned paths. Topic to Project promotion names both immutable identities
and pins a canonical hash of the complete source Topic snapshot. History has stable
unique IDs, canonical UTC timestamps, and strict chronological order. Meta Goals use
only the bounded `supports`, `depends_on`, and
`related_to` relationship vocabulary, require `authority: advisory_only`, and
never transfer truth, mutation, or execution authority.

External `note` and `attachment` inputs use immutable digest-derived paths of the
form `objects/sha256/<hash>`, closed media types, and a source descriptor containing
a safe relative path, explicit revision, and source SHA-256. Multiple provenance
records may deliberately reference the same immutable object when their content
digest is identical. Note bytes are never rewritten. Deterministic validation
metadata preserves extracted Markdown wikilinks and embeds and reports unresolved
targets.

All Scope routes are read-only and perform no networking. `validate` emits compact
JSON and claims only `snapshot_valid`, never source freshness. `source-check`
compares one declared source revision and local source file bytes against an
explicit source root and caller-observed 40-character Git revision. This keeps
research-only Topic sources checkable without pretending they are onboarded
Projects. `list` emits stable
terminal text, `graph-source` emits deterministic Mermaid, `graph` renders those
exact bytes through Termaid, and `export` emits deterministic human-readable
Markdown. Unknown fields, authority claims, unsafe or symlinked paths, hash
mismatches, duplicate IDs, invalid timestamps, control-character injection,
case-fold path ambiguity, dependency cycles, and invalid promotion lineage fail
nonzero with no successful stdout. This slice performs no initialization,
networking, hidden ingestion, source mutation, autonomous execution, or
self-improvement.

### Explicit KB registry and parity assessment

A KB registry is a directory containing one strict schema-version-1 `kb.json`.
Each registration has a terminal-safe ID, a canonical absolute Scope root path,
and the exact SHA-256 of that root's `scope.json`. Nested roots are allowed, so a
personal root and explicitly registered children such as Example Alpha can render as
one hierarchy. Roots outside that hierarchy, such as Explore, render alongside
it. MOZAK never scans for additional `scope.json` files. Unregistered roots are
not loaded, even when they are nested below a registered directory.

`kb validate`, `list`, `tree`, `graph-source`, and `graph` are read-only.
`tree` is deterministic Unicode terminal output. `graph` sends the exact bytes
from `graph-source` to Termaid stdin. Registry paths, manifest files, and source
observation files must be explicit regular non-symlink files or canonical
directories. Hash drift and unsafe, duplicate, unknown, or ambiguous entries
fail closed.

`kb parity REGISTRY OBSERVATIONS` is an executable acceptance harness. The
strict observation file pins the exact `kb.json` hash and may map registered
input IDs to canonical absolute source files plus caller-observed revisions. It
reports twelve fixed gates as `passed`, `failed`, `unsupported`, or `blocked`:
real Markdown wikilink and embed preservation and bounded resolution,
attachments, content hashes, deterministic export, import/export round trip,
version history, rollback/recovery, human editability, and agent discovery.
The command exits 0 only when every gate passes and exits 2 otherwise.

This release deliberately reports import/export round trip, version history,
and rollback/recovery as `unsupported`, and human editability as `blocked`
without a witnessed editing trial. It does not claim parity, make MOZAK
authoritative, discover roots automatically, mutate a Scope or source, or
authorize vault archival or deletion. Source vaults remain authoritative.

### Local Meta KB public slice

A Meta KB is a local directory with the canonical manifest `meta-kb.json`. The
strict JSON manifest identifies immutable project knowledge release JSON files
by safe relative path and expected SHA-256, optionally identifies a hashed human
overview, and declares explicit relationships between known projects. Validation
uses the existing `ProjectRelease` contract and requires every manifest project
ID, release ID, file hash, and optional overview hash to match.

`meta validate` emits stable compact JSON, `meta list` emits stable terminal
text, and `meta graph-source` emits deterministic Mermaid. `meta graph` sends
those exact bytes to Termaid through stdin, using `MOZAK_TERMAID` when set.
Contract failures write only to stderr and exit nonzero.

Relationship kinds are a closed, case-sensitive snake_case vocabulary:
`informs`, `depends_on`, `derived_from`, `related_to`, `validates`,
`validated_by`, `uses`, and `supersedes`. Unknown values and whitespace or
casing variants are invalid. Project and release IDs contain 1 to 128 ASCII
characters, start with an ASCII alphanumeric character, and may otherwise use
only ASCII alphanumerics, `.`, `_`, or `-`. This keeps terminal and graph output
safe without escaping identifier data.

This smallest public slice is read-only and provider-neutral. It includes no
registry, networking, import, initialization or other mutation, and no
self-improvement behavior.


Project commands default to the current directory. `project init` creates only
`.mozak/project.yml` and `.mozak/idea.md`, creates missing files in a partial
layout, and never replaces an existing file. It reads a local Git-like `HEAD`
when available and performs no network access.

All project commands emit JSON with `schema_version`, `command`, absolute
`project_root`, aggregate `state` (`valid`, `incomplete`, or `invalid`), and a
stable `checks` array of `{path, status, message}` objects. `init` also emits
`created`. `project status` exits 0 for valid or incomplete state and 3 for
invalid state. `project validate` and `project init` exit 0 for valid, 2 for
incomplete, and 3 for invalid state. Invocation and path errors exit 1 and are
reported on stderr.

`project overview` is the versioned, compact JSON contract for agents. It
discovers recognized research runs at `.mozak/research/**/run.json`, accepted
planning inputs at `.mozak/planning/accepted-inputs.json`, plans under
`.mozak/planning/plans/**/*.json` and `.mozak/planning/goal-dag*.json`, execution
bundles under `.mozak/execution/bundles/*.json`, accepted project state under
`.mozak/releases`, and canonical releases under `.mozak/exports`.
It reports malformed and unknown artifacts, the latest valid plan,
deterministically ready goals, bounded findings, counts, and next actions
without changing the project. `project list` renders the same snapshot as
stable terminal text.

`project graph-source` emits deterministic Mermaid source. `project graph`
sends those exact bytes to the `termaid` executable through stdin and has no
web fallback. Set `MOZAK_TERMAID` to override the executable path. Missing or
failed Termaid executions are reported on stderr with a non-zero exit.

The research, planning, and execution lifecycle commands are read-only
wrappers around `mozak-core` validators. Their successful stdout is compact
versioned JSON. Contract and invocation failures produce no machine output,
write an actionable error to stderr, and exit non-zero. Execution observation
revision and time are always explicit arguments.

## Working on MOZAK itself

Every gate CI runs:

```bash
cargo fmt --all -- --check
cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace
python3 -m unittest discover -s scripts -p 'test_*.py'
python3 scripts/check_docs_match_binary.py   # docs may not outrun the binary
python3 scripts/validate_m0.py
./scripts/verify_phase1_slice.sh
```

`mozak-core` holds contracts and validators, `mozak-cli` holds routes, adapters
are Python under `scripts/adapters/` and stay proposal-only. Milestone 0 is an
executable specification rather than production code; its contracts, schemas,
adversarial histories, and reference validator live under
[`spec/m0`](../spec/m0/README.md). A change to a contract changes its
specification under `spec/` in the same commit.
