# Package 3 proposal: official delivery and portable workspace

Status: the complete workspace roadmap remains proposed. **Package 3A (section 6) was separately approved for implementation on 2026-10-12 at 20:36:36 UTC**, against commit `8fc2340` and document SHA-256 `28bd938ea7dc28d2264f67011bb4dd5e43d157d297d7e97b1ffea80458e67445`. The owner also requested a clear, comprehensive repository README. This approval covers only 3A's listed source changes and isolated checks, not publication, private restore or global cutover.

## Owner direction and unresolved boundary

The owner requested GitHub plus a private Obsidian vault and mozak as the reproducible source of their local setup on 2026-10-12. The owner then requested preparation of the official mozak repository and identified a new Mac as the real acceptance machine. Linux and macOS are both required targets.

This package follows that direction. The exact installer, catalog, migration and publishing choices below are proposals. Packages 1 and 2 did not grant installation, global changes, legacy migration or publication. Their approvals are not reused here.

Interpretation to confirm: "local setup" includes project repositories, knowledge, mozak scope discovery and selected agent/tool configuration. It does not mean cloning credentials, browser sessions, OS preferences, every installed application, caches or every GitHub repository. Missing desired setup components must be listed, not silently excluded. The selected tool list requires an explicit inventory before claiming setup parity.

## 1. Delivery boundaries

1. Public product: this repository, `pitfa19/mozak`, is the intended official mozak code repository. Prepare reviewed source, locked build instructions, an installer, portable skill delivery and Linux/macOS CI. Do not claim a release is published before a remote read verifies it.
2. Private workspace: the private vault holds the portable workspace catalog, selected setup declarations and reviewed knowledge content. Never put private repository names, the owner's registry, machine configurations, transcripts or credentials into the public product repository.
3. Repository-owned understanding: each project or topic keeps its own canonical mozak state. The private catalog locates it. The catalog does not copy plan authority, create approvals or mark a project complete.
4. Machine-local state: installation paths, generated inventory, local checkout roots, caches and credential-store bindings are reconstructed on each machine. Existing credentials are not exported.
5. Legacy transition: preserve old checkouts and knowledge while their useful content is mapped and verified. Do not retain the old runtime as a permanent architectural dependency. No deletion, overwrite or silent conversion is part of preparation.

The existing registered `mozak` project still points to the old checkout. The new repository is not treated as registered merely because it has the intended GitHub remote. Switching the installed command, skill or project binding is an explicit cutover step with a recorded prior state and rollback instructions.

## 2. Observed readiness and blockers

Baseline source checkpoint: `a638ea55dc6c1cf0529f5fa09c10a318836c8b0d`.

| Observation | Delivery consequence |
| --- | --- |
| The new remote already has the intended official name. Local code was ahead of the checked remote. | Recheck the remote immediately before publishing. Identity is not publication evidence. |
| Packages 1 and 2 implement scope understanding, discussion and bounded implementation review. | Preserve these contracts. Setup is an external delivery layer, not a task engine or another planning database. |
| The repository-local conversation skill names a single developer checkout path. | Generate or resolve an exact installation path at activation. Never fall back silently to an unrelated installed CLI or skill. |
| Package manifests use development version `0.0.0`; no release installer or CI workflow is tracked. | Define a versioned, reproducible source-based delivery route before calling this installable. Do not publish individual workspace packages that depend on unpublished siblings. |
| Existing workspace registries and Notes bindings may contain machine-specific absolute roots. | Derive portable repository-relative mappings, then generate local bindings. Never copy old absolute paths into a Mac inventory. |
| Local-only knowledge and concurrent vault changes require private reconciliation. | Verify remote availability and preserve both local and remote work before publishing a private restore source. No pull/reset/stash of user changes as a shortcut. |
| Existing knowledge includes legacy formats. | Report legacy content explicitly. A clone is not a successful semantic migration or native-v3 index. |

### Linux source-relocation check already executed

A `git archive` of the pinned committed source was unpacked into a new scratch directory, not the development checkout. The check used a new empty HOME, Node `v24.11.0`, `npm ci --offline --ignore-scripts` with an existing dependency cache, a fresh build, the full test suite, and the built CLI's help route.

Observed: installation and build exited 0; **334 tests passed, 0 failed, 0 skipped**; built CLI help exited 0.

Limits: this reused the machine's Node/npm executables and package cache. It is not a public GitHub download test, a network bootstrap test, a clean physical machine, a portable skill activation test, or macOS evidence. The private workspace was not restored. Local evidence paths belong in the private preparation record, not the public instructions.

## 3. Proposed restore flow

### First installation

1. Check supported OS, Node, Git and GitHub CLI prerequisites. Explain missing prerequisites without silently installing package managers or modifying shell profiles. Initial supported runtime is Node 24, the tested major, with precise minimum version determined by CI before release.
2. Obtain an explicit official release revision. Verify the checkout revision and locked dependencies. Install into a new user-owned location without sudo and without replacing an existing `mozak` command implicitly.
3. Authenticate to GitHub interactively using the user's normal GitHub CLI login. mozak neither requests credentials in chat nor copies credentials from another laptop. Verify access without printing tokens.
4. Clone the explicitly selected private vault into a new location. Load its reviewed workspace catalog as data, not as instructions to run scripts.
5. Show a bounded restore plan, then apply the approved plan. Fetch only declared repositories, reconstruct local scope/Notes bindings, and report restored, missing, inaccessible, legacy-format and conflicting entries separately.

Initial catalog indexing means explicit scope discovery and validation plus existing context/plans reads. It does not add embeddings, cloud search, automatic crawling, background synchronization or an alternate knowledge authority.

### Proposed portable catalog contract

Use a versioned, closed JSON format with the following data categories. Exact serialization and command signatures must be pinned in the approved implementation contract, not invented during implementation.

- Repositories: stable ID, explicit GitHub owner/repository locator, reviewed full commit revision and workspace-relative checkout location. A branch may be a human update hint, never the effective immutable pin.
- Scopes: stable catalog identity, repository ID, repository-relative directory, native or legacy format classification, and expected native scope identity where available. Legacy registry IDs and topic identities are not assumed interchangeable. Reject duplicate canonical native scope identities even if their catalog IDs differ.
- Setup selections: explicit named tool/skill configuration entries with reviewed sources and platform support. No arbitrary shell commands, environment dumps, credential values or executable install hooks in catalog data.
- Local resolution: one chosen workspace root, generated inventory outside canonical project state, and a report of unavailable or unmigrated entries. Roots are reconstructed rather than copied from the source laptop.
- Provenance: source revision and mapping evidence sufficient to identify omitted files, source ownership and migration limitations. Existing approval records are preserved only as actual historical records, never synthesized from catalog membership.

The private vault's selected revision and manifest digest are the restore inputs, supplied by the bootstrap request rather than requiring the vault to contain its own commit hash. An updated remote branch or changed catalog requires a newly displayed plan. Repo content cannot expand the selected list or grant setup actions.

### Safe repeat and interruption behavior

- Existing matching clean checkouts can be reused after verifying identity and revision. Dirty, wrong-origin, diverged, untracked-overlap or unexpectedly existing directories are conflicts, not reset candidates.
- Never automatically pull, force-push, rewrite history, delete unrelated files, recurse through submodules, follow Git redirects to unreviewed hosts, or execute repository hooks/setup scripts. Private clones stay private local inputs. Tests must exercise inherited Git filters, templates/hooks and submodule configuration, not just repository hooks. Isolate executable checkout behavior while retaining explicitly trusted authentication helpers. Dependency bootstrap uses `--ignore-scripts` while the reviewed dependency contract allows it.
- Reject unsafe relative paths, symlink escapes, duplicate physical roots, overlapping clone destinations and case-insensitive path collisions before writes. Test names with spaces and Unicode.
- Stage new clones and generated configuration separately. Publish generated configuration only when the approved entries have truthful results. Partial restore must remain visibly partial and must not silently erase prior entries.
- Interrupted or repeated restores must be inspectable and resumable without treating unknown partial directories as valid repositories. No automatic lock theft or permission inheritance.
- Updates remain on demand. A catalog revision does not approve coding in restored scopes. Paused plans remain paused after restore.

## 4. Private knowledge and setup reconciliation

Before any private publication, produce a read-only inventory of the existing KB registry, Notes mappings, curated setup documentation, registered repository identities and local-only repositories. Use those as evidence, not as permission to clone everything accessible to the GitHub account.

Propose a file-by-file destination map for knowledge that is currently local-only. Keep canonical source ownership explicit. The vault may hold the selected knowledge directly or reference a separate private knowledge repository, but there must not be two editable authorities. Choosing the vault as the default destination is a proposal, not authorization to copy all KB internals blindly.

Reconcile local and remote vault changes in an isolated staging location after reading both revisions. Before reconciliation, verify a private recovery snapshot of original histories, tracked modifications and deletion state, untracked content and reviewed required ignored files. Preserve required bytes, not just Git-tracked files. Classify generated outputs, caches, external nested repositories and required source content explicitly. Verify content hashes, internal links, manifest-relative references and scope identities before marking a mapping complete.

Notes semantics must survive relocation: the profile remains the sole destination-root authority; the links file maps scope IDs to destination IDs and safe relative path prefixes. Preserve destination IDs, multi-destination mappings, preferences, purpose, routing signals, trimming/default/Obsidian settings and exclusions. Explicit reviewed scope mappings retain their exact prefix semantics, including approved mappings into otherwise excluded trees. Do not filter them out using blanket destination exclusions. Rewrite only reviewed device-root bindings.

Legacy registries pin exact manifest bytes, and their configuration may pin registry bytes as well. Preserve the original registry as provenance and generate a separately reviewed local mapping. Replacing absolute paths changes the registry digest and cannot reuse the old configured pin. Never silently re-pin or put legacy `scope.json` roots into a native-v3 inventory as if they were compatible. Check relocated evidence references as well as manifest hashes.

Preserve required legacy metadata as provenance. Translating legacy projects into native-v3 understanding requires a reviewed mapping of expectations, decisions, questions, evidence and dates. Missing approval provenance or dates stays unknown. Do not fabricate native approvals or call a root "indexed and ready" merely because it was cloned. A preview that needs owner review remains visible.

Selected skill/MCP/tool setup is inventoried separately from secrets. Restore safe configuration templates with unresolved credential placeholders, then verify each selected tool's actual readiness on the target. Optional tools remain optional, unsupported platform entries remain visible, and no global setup is changed before the displayed cutover is approved.

## 5. Acceptance and publication gates

| Requirement | Concrete acceptance observation |
| --- | --- |
| Public code reproducible | Fresh checkout of the eventual published revision, locked dependency install, build, full tests and CLI/MCP smoke checks. The local source-relocation result is only a preliminary check. |
| Linux and macOS | Same public-interface suite on Linux and macOS CI, a complete isolated Linux restore, and an actual new-Mac installation and restore. A workflow file is not a passing CI run. Record architecture, tool versions and any FIFO/permission test skips. Resolve canonical scratch paths on each OS. |
| Portable skill | Move installation to paths containing spaces/Unicode, activate the exact delivered skill, and verify CLI resolution without the original developer path or global legacy fallback. |
| GitHub plus vault restore | On the new Mac, log in normally, retrieve the selected private vault revision, review the restore plan and materialize the declared repository pins. Record absent/private-access failures honestly. |
| Registry and scope coverage | Reconcile every source registration to restored native, retained legacy, conflict, unavailable or explicitly owner-excluded. No unexplained omissions. Native context/plans outputs match their durable source state. |
| Knowledge parity | Verify required files and hashes, reference resolution, unresolved legacy mappings and local-only content coverage. A repository count is insufficient. |
| Safe repeated restore | Repeat unchanged restore as a no-op. Dirty checkout, wrong origin, unavailable remote, missing credentials, changed manifest, malicious paths, case collision, symlink escape and interrupted clone are refused or resumed without losing user bytes. |
| Configuration cutover | Verify the selected executable, skill, MCP command and local inventory all resolve to the new installation. Preserve prior configuration and demonstrate rollback without altering project state. |
| Permission preservation | Recover a paused plan and a separately approved open plan from durable native state without creating decisions or widening bounds. Keep freshness evidence distinct from functional reconstruction. |
| Owner usability | Owner can open a chosen project on the new Mac, see Completed/Open/Awaiting approval and identify the next permitted action without reconstructing the setup from old chat. Record the owner's actual verdict. |

### Bounded implementation proposal

Prepare changes only in this repository's delivery scripts, package metadata/lockfile, CI, portable skill templates, setup adapter, relevant tests and documentation. Preserve the tested core permission model. Any core contract changes or native migration rules require a separately reviewed addition.

Prepare private workspace catalog and reconciliation artifacts outside the public repository. No public push of personal data, no vault overwrite, no deletion of the old checkout, no automatic legacy conversion, no token transfer and no unattended execution of fetched code.

Before implementation: review this package and pin the exact setup catalog and operation contracts, allowed file set, platform prerequisites and cutover procedure. The executable contract must include restore-plan identity/digest, allowed network destinations, create-only staging and configuration publication, interruption recovery and exact rollback files. A human outcome proposal alone is not that contract.

Before publication: review every reachable object of the proposed public ref, including ancestor versions and binary media, not just the final diff. Existing engineering journals contain machine/session provenance and the animated demo has not been cleared frame-by-frame. A scan with no common credential-pattern matches is not comprehensive clearance. Preserve the current local history. Decide explicitly between approved existing history and a sanitized publication successor based on the already-published tip, retaining the unpublished engineering history privately. No force push or history deletion is implied. Obtain distinct authorization for the exact public ref and private destination changes after that review.

Any delivery artifact other than the tested source checkout needs its own unpacked-artifact test outside the development workspace, including sibling dependency resolution and executable permissions. Before laptop completion, run the actual workflow and keep failed or unavailable acceptance checks open.

### Visible delivery milestones

1. Portable source release: pinned runtime/build contract, portable CLI/MCP/skill installation, Linux/macOS CI and installation smoke tests. No private cloning, cutover or publication implied.
2. Private workspace preparation and restore: reviewed source preservation, catalog and restore contract, safe private publication, explicit local mapping and configuration cutover. Native conversion must not be hidden inside path relocation.
3. Both-platform acceptance: complete Linux restore, actual new-Mac restore, repeated restore and failure checks, published-ref verification and owner usability.

## 6. First implementation contract: portable local installation (3A)

This is the first separately bounded implementation slice, approved as recorded above. It leaves the complete workspace outcome above open. No GitHub/vault restore operation is implemented in 3A.

### Public entrypoints and inputs

Proposed source command: `node scripts/install.mjs --prefix ABSOLUTE_PATH [--check] --json`.

- Only these flags are accepted; duplicate/unknown flags and extra positionals fail. `--prefix` is mandatory, absolute and names a dedicated installation directory. `--json` is mandatory for this initial interface. No implicit HOME, global config or PATH installation.
- Supported hosts: Linux and macOS. Require Node 24.11.0 or later within major 24 initially, matching the observed runtime. A wider range requires explicit test evidence. Unsupported OS/runtime fails before writes.
- The source root is derived from the installer module location, never the caller's current directory. Require all expected package manifests, built outputs and skill-template inputs. No network, Git command, package install or build is executed by the installer.
- `--check` validates source inputs and the target, returns the planned paths and prospective final installation digest for this canonical prefix, and performs zero writes, including no staging or lock creation. It is a preflight, not authorization and not a reservation. A matching existing target still returns status `checked`, committed false.
- New installation requires an absent target; an existing target is permitted only for the verified no-op described below. Require an existing canonical nonsymlink parent and no source symlinks. Reject any ancestor/descendant overlap between target and source. Source inputs are bounded to the three explicitly named product manifests, their built runtime output trees and explicit skill template files, without requiring `.git` or invoking Git. Hash every selected file before copying and verify the same content after copying. Refuse unreadable, missing, unsupported or changing inputs. Cap inputs at 4,096 files, 16 MiB per file and 64 MiB total; generated files count against the same bounds.
- All selected paths use portable case-unique names. Reject unsafe segments or filesystem aliases. Use canonical parent paths on macOS rather than assuming a syntactic `/tmp` path identifies the actual directory.

### Installed tree and source contract

The install prefix contains only:

- `LICENSE`, `package.json` declaring ESM, `bin/mozak` and `bin/mozak-mcp` executable Node wrappers. Preserve the source license notice.
- `node_modules/@mozak/{core,cli,mcp}/package.json` plus each package's built `dist/` files, copied as ordinary files. All three packages travel together; no unresolved workspace dependency or development-checkout symlink is permitted.
- `skills/mozak-conversation/` with the explicit skill and reference/example files rendered from generic templates using this installation's exact canonical CLI and skill paths. Quote paths safely in command examples. Never load an older installed skill implicitly.
- `installation.json` with exact keys `{ format, version, nodeRange, contentDigest, files }`, format `mozak.installation/v1`, version `0.1.0`, nodeRange `>=24.11.0 <25`, and files sorted by code-point relative path. Each file record has exact keys `{ path, byteLength, sha256, executable }`; lengths are non-negative safe integers, digests are lowercase 64-character SHA-256 hex and executable is boolean. Unknown keys, duplicate paths or unsupported values fail. The digest is SHA-256 of UTF-8 `JSON.stringify({format,version,nodeRange,files})` with keys in that order, file keys in the stated order, and no added whitespace. It covers the final target-specific rendered bytes, not a signed release identity. The manifest excludes itself from its file list. No Git revision claim is inferred.

Wrappers locate the installed modules relative to themselves and forward arguments and process exit status unchanged. They do not infer an inventory or modify the existing explicit `--config` requirement. CLI and MCP use the same installed core. The rendered skill is bound to the chosen canonical prefix: manual relocation of an installed tree is not a supported skill migration. Install afresh at the new prefix to render matching paths and verify its manifest.

Initial package version is proposed as `0.1.0` for all three packages, with matching exact sibling dependency versions and lockfile updates. This is local version preparation, not an npm publish, Git tag or GitHub release. Runtime engine declarations match the narrow tested range above. Source bootstrap documentation uses `npm ci --ignore-scripts`, then `npm run build`; dependencies come only from the lockfile. Document prerequisite installation separately, with no automatic package-manager or shell-profile modification.

### Create-only installation, re-run and failure behavior

Preflight validates inputs and computes the prospective final target-specific installation digest, including rendered wrappers and skills, excluding `installation.json` and ephemeral smoke inputs. Returned `contentDigest` has this same meaning for check, install and no-op. Identical source plus canonical prefix yields the same check/install digest; changing the prefix may change rendered bytes. Any raw source snapshot digest stays internal. The write operation revalidates rather than trusting an earlier check. Acquire the target with exclusive `mkdir` in the already-validated parent. Never rename over an existing target, reclaim a lock by age or replace an existing installation.

Populate the newly owned target and publish the success manifest only after copied hashes, executable modes and installed CLI/MCP smoke checks pass. Smoke checks use only a synthetic empty inventory in installer-owned temporary files under the new prefix, removed before final verification. Each child has a 10-second timeout; no user scope is initialized by installation. `--check` never launches these children. Until verification succeeds it is an incomplete installation, not a runnable supported release. A failure may leave this new partial directory for inspection, reports its path and does not delete or alter unrelated paths. Do not promise crash durability or filesystem-race immunity from exclusive creation alone.

If the target already exists, recompute the exact expected target-specific rendered file set, modes and manifest from the currently validated source. Only an exact match against that expected product is an idempotent no-op; an internally self-consistent old or substituted manifest is insufficient. Extra files, changed bytes/modes, wrong content digest, symlinks, missing/corrupt manifest or incomplete installation is a conflict. Do not repair automatically or follow links. Re-run with a different new prefix; any later removal of a partial target is a separately scoped owner action.

Concurrent installers: only one exclusive creation may win. Others report existing/conflict, never assume a partially written tree is valid. Recheck source hashes and target identity around copying, and report uncertainty if cooperative filesystem assumptions no longer hold. Arbitrary hostile direct filesystem writers are outside an absolute non-overwrite guarantee.

Result JSON is closed: `{ status, committed, prefix, contentDigest, files, issues }`. `files` is the sorted planned or installed relative path list. `issues` contains `{ code, path, message }` records without file contents or environment values. `contentDigest` is null if inputs cannot be validated; `prefix` is null if invalid. Status values: `checked`, `installed`, `unchanged`, `invalid-input`, `unsupported-platform`, `source-unavailable`, `conflict`, `partial-install`. Exit 0 for checked/installed/unchanged; exit 2 for invalid/unsupported/source-unavailable; exit 3 for conflict; exit 5 for partial-install. `committed` means a verified successful installation exists, true only for installed/unchanged. A partial directory is not committed. `--check` always reports committed false even if it verifies an already matching installation.

No global cutover is in 3A: no edits to installed commands, shell rc files, agent configurations, legacy registration, vault or private KB. Rollback at this stage means continue using the unchanged old installation. Host configuration snippets are shown, not automatically applied.

### Allowed implementation files and checks

Allowed changes: `scripts/install.mjs`, `scripts/test-install.mjs`, `package.json`, `package-lock.json`, `packages/{core,cli,mcp}/package.json`, `skills/mozak-conversation/**`, `.github/workflows/ci.yml`, `README.md`, `docs/installation.md`, this package document and `docs/implementation-package-3a-acceptance.md`. New test fixtures live under `scripts/fixtures/` and contain synthetic data only. Existing core/CLI/MCP source, canonical scope models, old approvals and private setup are outside this slice. If tests expose a production-code platform bug, report and review the smallest scope addition rather than silently weakening tests.

CI runs the complete existing suite and installation checks on Ubuntu and macOS using Node 24.11.0 initially. Pin action revisions from their official sources when implementing. The installation check must use the built product's real interfaces, not copied business logic:

1. Install into a new path containing spaces and Unicode; execute installed CLI help and create/read an isolated synthetic scope using the installed CLI. Use a fresh installed MCP stdio process to read equivalent context. Confirm no source-checkout module is resolved.
2. Repeat installation as unchanged; run `--check` before and after and assert no writes and matching check/install content digests. Install source A, change valid source bytes to B, and verify reinstall at the same prefix conflicts without changing any target bytes. Run two simultaneous installers and inspect the final manifest/files. No stale lock reclamation exists.
3. Exercise missing built files, input changes during copying, unsupported input/runtime, bad prefix, symlinked source/target/parent, populated wrong target, partial target, changed/extra installed files and mode mismatch. Existing user bytes stay unchanged.
4. Activate the rendered skill by its exact installed path and verify command examples resolve to that installation without a developer home path or a legacy skill fallback. Static template checks alone do not establish host activation. This may require a separate real host session rather than CI; record it as incomplete if unavailable.
5. Test installation from a relocated source archive into two distinct canonical prefixes, outside workspace symlinks, on both platforms. Run installed commands from an unrelated working directory. Record skips, canonical-path behavior, tool versions, artifact digests and actual CI results. A Linux run cannot substitute for a macOS run.

Implementation approval for 3A covers only this local source change and isolated test work. Publication, private reconciliation/restore, global cutover and the actual Mac session remain separate visible gates, not silently removed from Package 3.

The complete requested outcome remains official code plus a reproducible organized personal workspace on both platforms. A source release alone does not close this package.
