# Package 1 acceptance evidence

**Scope:** the owner-approved local mozak plan-state and review package, not the entire mozak product.

Approval: `2026-10-12T08:16:20.810Z`, against package checkpoint `caffffa`. Tested implementation checkpoint: `78896e9` (the following documentation-only commit records these results).

## Verification record

**Final gate passed on October 12, 2026:** build succeeded and **239/239 tests passed**, with zero failures, cancellations, skips or todos. The complete test run took 57.6 seconds. All A01–A15 requirements below have passing evidence at committed source checkpoint `78896e902954336f4b2ad02fcf28442598d16b30`.

```bash
npm run build
TMPDIR="$JCODE_SCRATCH_DIR" npm test
```

| Environment | Observed value |
| --- | --- |
| Date | October 12, 2026, UTC |
| Node | v24.11.0 |
| Platform | Linux 7.0.0-38-generic, x86_64 |
| Filesystem | `stat -f` reports `ext2/ext3` for the repository and scratch filesystem. No narrower filesystem claim is made. |
| Test-owned files | Under `/home/pitfa/.jcode/scratch`, using `JCODE_SCRATCH_DIR` and `TMPDIR` |
| Final local log | `/home/pitfa/.jcode/scratch/mozak-package1-acceptance.log` |
| Log SHA-256 | `b96d57b6447410a28bcb97842a3359372a2c34064fe498ec85e01b5402f85798` |

The gate builds the real workspace first. CLI tests execute `packages/cli/dist/index.js`; MCP integration tests launch the actual stdio entrypoint. The process suite imports the real store/model/review modules, not a copied implementation. Internal phase barriers are not exposed as CLI flags or MCP arguments.

## A01–A15 traceability

Paths below are relative to the repository. The named test prefixes are searchable, stable anchors rather than shifting line numbers.

### Model and workflow

| ID | Concrete test and observed acceptance boundary | Result |
| --- | --- | --- |
| A01 | `packages/cli/test/acceptance.test.ts`, `A01: built CLI init...`: preserves README/AGENTS; exact receipt replay; changed operation input and unrelated re-init refuse; existing manual bridge/legacy state, duplicate inventory IDs/roots and graph/bridge/lock symlink escapes refuse without changing sentinel bytes. Supplemented by `scope-index.test.ts` identity/path checks and `scope-store.test.ts` create-only init. | Passed |
| A02 | CLI acceptance `A02/A03/A04/A05/A08`: independent plans, accepted-only amendment creation, accepted content retained during proposal, fresh process reconstruction, and distinct A→B→A semantic IDs. | Passed |
| A03 | CLI acceptance `A03/A07` plus model/review tests: exact owner-purpose/revision/review digest bindings, stale/altered approval refusal, detailed-planning next action with implementation authorization false. | Passed |
| A04 | CLI `A04: observe with protected nested fields...` and actual MCP stdio `A04` cases: observed/inferred/unverified claims and corrections, unchanged accepted meaning, protected `accepted`, `decisions` and `implementationAuthorization` injection refusal. The valid non-injected control commits; rejected requests leave graph/bridge bytes unchanged. | Passed |
| A05 | CLI acceptance lifecycle test and `cli.test.ts` real owner-path human-output tests: reject/reconsider, retained reason/date, default-hidden rejected group, pause/resume and completed-direction amendment without reusing old completion. | Passed |

### Presentation, boundaries and recovery of meaning

| ID | Concrete test and observed acceptance boundary | Result |
| --- | --- | --- |
| A06 | CLI acceptance `A06/A10`: two scopes, six rows per displayed group, five-row defaults, next page, distinct plan/review counts, changed-snapshot continuation refusal and missing-scope partial coverage. CLI cursor test verifies token anchor equals emitted composite key. `review.test.ts` explicitly compares whole-second and fractional-second UTC timestamps. | Passed |
| A07 | Three CLI `A07` workflows plus model/review regressions: every objective outcome needs observed passing evidence; inferred/unverified reports cannot complete; subjective acceptance binds current evidence/challenges and creates recoverable Awaiting approval rows. Post-completion withdrawal/new findings remain visible without rewriting completion history. | Passed |
| A08 | CLI accepted/amended reconstruction and MCP `A08/A09: a real built CLI scenario...`: accepted/pending meaning, sources, evidence provenance, effective decisions and next permitted action survive new processes that read files only. | Passed |
| A09 | The same MCP parity test deep-compares normalized CLI context/review responses with fresh real stdio responses. Runtime nested-field/action/actor checks, disabled legacy mutations, request capacity and proposed canonical-file overflow are exercised. Large-response EOF and malformed UTF-8 transport regressions pass. | Passed |
| A10 | CLI `A06/A10` read-only byte/lock checks and store `A10`/`A14` tests: context/plans/check/operation reads do not write; stale/missing/unavailable bridges retain canonical context; ancillary read problems are diagnostics. Fresh locale processes render identical bridge bytes. Unsupported connections remain closed and source locators are never fetched. | Passed |

### Actual concurrent processes and crash recovery

| ID | Concrete test and observed acceptance boundary | Result |
| --- | --- | --- |
| A11 | CLI acceptance `A11: two actual CLI writers...` starts concurrent built CLI processes with one snapshot: exactly one commit and one stale response. `scope-process.test.ts`, `A11 three append writers...`, verifies fresh-read conflict retries preserve all observations and receipts. | Passed |
| A12 | Process `A12 slow live holder...`: the real holder remains live for 31 seconds, beyond the former lease. A contender cannot steal its lock. Token mismatch, missing metadata and unexpected contents remain fail-closed. | Passed |
| A13 | Process tests kill and join real writers after mkdir/before metadata, before initial graph, before an existing graph update, after canonical publication and after bridge publication. They inspect bytes/receipts, establish offline quiescence, retry init only where absent, or use real receipt recovery and projection repair. | Passed |
| A14 | Store manual-conflict, partial-publication, reader-race and delayed-repair tests plus process interrupted-projection test: no manual bridge overwrite, no duplicate semantic replay, changed-input operation ID refusal, no stale repair over newer state, coherent read or busy. | Passed |
| A15 | Process `release successor interleaving...` and `A15 offline-only recovery...`: all transaction filesystem work precedes lock removal, a successor cannot acquire early, and offline recovery occurs only after all owned children are joined. No online force-unlock route exists. | Passed |

## Independent review and corrections

| Axis | Reviewer and evidence | Resolution |
| --- | --- | --- |
| Storage/model safety | Fox used static inspection and read-only in-memory counterexamples, followed by targeted independent rechecks. | Raw-byte hashing, locale-stable projection, ancillary availability, decision/completion/revision binding, negative corrections and plan-qualified observation/challenge identity fixed. Final completed-findings/effective-decision probes passed at `30936f3`. |
| Specification/acceptance | Hamster independently inspected the approved package, ran source/store tests and real CLI/MCP interface tests. Final targeted results: 56/56 source/store and 11/11 interface tests. | Rich meaning/provenance views restored, human pause/reject output verified, actual parity and nested runtime injection checks added. Ambiguous active evidence now refuses before publishing any graph, bridge or receipt; the no-publication regression passed independently. No remaining material finding in the targeted fixes inspected. |
| Standards | Giraffe found no hard documented standard violation, but reproduced inconsistent timestamp ordering and duplicated pagination identity. | Parsed-instant sorting plus a true mixed-precision model regression. The facade now uses the same validated five-part row identity for sorting, cursor and output; a built-CLI regression checks equality and continuation. Giraffe independently rechecked `78896e9`, confirmed the regression assertions and closed the finding. No remaining standards findings reported. |

The failed intermediate gates were not counted as completion. Tests first reproduced the completed-evidence withdrawal, skipped effective-decision and unreadable cross-plan evidence defects, then passed after fixes. Worker-written replacement code was reconciled and committed before these final checks. No fake-harness smoke run substitutes for the actual process suite.

## Contract details confirmed by tests

- The bridge pins the **whole canonical file** SHA-256. Semantic content/review digests have distinct purposes. Observation changes can regenerate the bridge without silently revoking accepted direction.
- Observation IDs are plan-local. Challenge references bind `[containerPlanId, linkId]`, not the evidence source's plan. A single outcome cannot combine one evidence ID with conflicting bytes from two plans: the attempted mutation is refused before publication. Unrelated local evidence does not shadow historical external support.
- Evidence digests cover the canonical, ID-sorted evidence set. Owner acceptance also binds the current challenge set and displayed review content. Source text and synthetic owner references are not authentication or execution grants.
- Completed state is historical. Withdrawn supporting evidence or stale subjective acceptance surfaces review-needed state and, when applicable, an Awaiting approval outcome entry. It does not automatically reopen or rewrite prior completion.
- Lock age is never proof of process death. Only explicit offline recovery after all writers/acquirers are stopped is supported. JSON and Markdown are not jointly atomic; rename alone does not imply fsync or power-loss durability.

## Boundaries that remain open

This verifies package 1's local Linux workflows, not every platform or adversarial filesystem environment. Network filesystems, arbitrary concurrent manual editors and power-loss recovery were not tested. Synthetic owner/evidence fixtures prove mechanical binding, not authenticity, owner usefulness or successful independent fresh-host understanding.

No real user scope was onboarded or converted. No legacy registration, installed skill, global CLI/config, runtime dependency, service or remote repository was changed. The accepted product brief's SHA-256 remains `23e4718ab4e224c120adc03967467d419e9f0ebe45ea67b78d4d0417980ca696`.

Research-tool implementation, optional adapters, conversational skill polish, accepted cross-scope connections, implementation grants, migration, publication and the actual transfer pilot remain separately approved future work. No pilot success is claimed by this document.
