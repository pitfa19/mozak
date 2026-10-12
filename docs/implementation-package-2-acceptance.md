# Package 2 acceptance and live-trial handoff

**Current status (October 12, 2026, after 20:04 UTC): implementation verification and the objective formatter trial passed; strict fresh-host isolation and actual owner usability acceptance remain open.** The rebuilt clean-checkpoint gate passed 334/334 tests. The actual formatter passed an independent 75/75 run and its objective was completed through the CLI. See `implementation-package-2-live-trial.md` for the real approvals, pause/resume, recovery-report limitations, requirement mapping and completion pins. No overall Package 2 acceptance is claimed.

The implementation-gate matrices and preparation narrative below are the historical pre-trial baseline, not the current trial state. The live-trial report supersedes their unexecuted-trial entries without converting reported recovery into verified host isolation.

## Authority and boundaries

The actual owner message at `2026-10-12T17:48:24.249Z`, `approved`, answered the explicit Package 2 build-approval request. Commit `4735bb6` records that approval against the reviewed proposal at `e5d80b9`. It authorizes repository implementation and isolated-trial preparation, not synthetic decisions for the trial, installation, migration, Monokl, publication or global changes.

The registered installed project still resolves to `/home/pitfa/Documents/mozak`, with no ready goals or validated notes. Work here follows the separately approved `/home/pitfa/Documents/mozak-v1` package. Its old registration and project files were not changed. The inventory format stays `mozak.local/v2`; new canonical scopes use `mozak.scope/v3`. Old scope formats refuse rather than migrate. Package-1 historical acceptance remains unchanged.

The original Package 2 `approved` message was not reused as trial direction, trial specification, pause, resume or outcome consent. Initialization below was restricted to authorized preparation. Subsequent distinct actual owner decisions and objective completion are documented in `implementation-package-2-live-trial.md`.

## Implemented behavior and checkpoints

- `ca00fdd`: closed v3 model, immutable specifications/implementation grants, durable discussion history, derived handoff, guarded IO integration, new facade routes and real store/crash tests.
- `c5b3a2b`, `7f8871d`, `f2d91ae`: bounded raw-byte Markdown inspection, symlink/special-file refusal and metadata/error hardening. These are local checks, not absolute filesystem confinement.
- `a0eb323`: independent review found that equivalent UTC strings could reuse one owner message. Shared normalized provenance now refuses this across implementation decisions and reuse for resume while preserving submillisecond identity and exact receipt replay.
- `ab3f82e`: exact-path conversation contract now explicitly reads plans, reports partial coverage, distinguishes completed plans from direction milestones, preserves read-only requests and handles unchanged-subject CAS retries. A deterministic transition test covers mixed UTC precision including implementation rows.
- Repository-local skill and interface revisions are recorded in Git. The installed skill is not replaced. CLI/MCP command fixtures test mechanics, not actual owner conversation.

## Commands and evidence

Environment observed October 12, 2026: Linux x86_64, Node `v24.11.0`, Jcode `v0.95.0 (6487bbd7e)`. This records the local runtime at execution, rather than assuming the older session-start version.

First integration gate, on a changing implementation worktree:

```bash
cd /home/pitfa/Documents/mozak-v1
npm run build
npm test
```

Observed **304 passed, zero failures/skips**, log `/home/pitfa/.jcode/scratch/package2/full-gate-first.log`. This was an intermediate milestone, not the final checkpoint claim.

### Final pinned gate

- Checkpoint: `3f21a791583baf929eda5b19919c2f3b31404f37`.
- Packages tree: `ba25e84783eb1812aba9ce98f8667d8dd653b0d1`.
- Execution: `2026-10-12T18:22:31Z` through `2026-10-12T18:23:35Z`, `npm run build` followed by `TMPDIR="$JCODE_SCRATCH_DIR" npm test`.
- Result: **build exit 0; 334 tests passed, zero failed/cancelled/skipped**. The command verified identical HEAD and a clean worktree before and after the run, then ran `git diff --check`.
- Log: `/home/pitfa/.jcode/scratch/package2/full-gate-final-3f21a79.log`, SHA-256 `cc43f7728472448cb625e0b75c6da01fd18dd2978fba90ebb8aa395ee94bfaa8`.

Before that gate, `npm run build && node --test --experimental-strip-types packages/cli/test/package2-*.test.ts packages/mcp/test/package2-protected.test.ts` passed **15/15**. Log: `/home/pitfa/.jcode/scratch/package2/final-interfaces.log`. These cases launch the built CLI and fresh built `packages/mcp/dist/index.js` processes. They actually commit direction, discussion, spec and implementation decisions through the CLI owner convention, then compare full context/review DTOs and assert recovered meaning/provenance. Owner references remain synthetic fixtures. Neither those children nor this continued coordinator session count as a genuinely fresh conversational host.

Real store checks run with:

```bash
node --test --experimental-strip-types packages/core/test/handoff-store.test.ts
```

The ten initial cases all passed, including actual child `SIGKILL` after a grant's canonical commit, offline-only recovery after joining the child, exact receipt replay, projection repair and current eligibility reread. No test merely interprets a thrown exception as proof of a process crash.

## Requirement-to-observation matrix: implementation-gate baseline

Test paths below are under `packages/`. A synthetic owner reference in an automated fixture is explicitly not live owner evidence.

| ID | Concrete check and observed boundary | State |
| --- | --- | --- |
| B01 | Exact repo skill read at `/home/pitfa/Documents/mozak-v1/skills/mozak-conversation/SKILL.md`; built CLI `--help`; `handoff-store.test.ts` B01 old-format refusal compares bytes. Isolated trial create-only init below leaves ordinary entry files unchanged. Installed/global fingerprints recorded below. | Local activation/preparation checked; no installed rollout claimed |
| B02 | Built CLI fixed-group and paused/rejected tests. `cli/test/package2-mixed-rows.test.ts` emits direction/outcome/implementation rows on one plan, then pages one item at a time, checking cursor keys and no repeats. Actual pending trial overview prints Completed 0, Open 0, Awaiting 1 with its date. User-open, ordinary-turn non-repetition and explicit show-plans behavior still need actual conversation. | Automated/local preview passed; live portion open |
| B03 | `core/test/conversation.test.ts` history/no-op/reopen/current-rebase cases and v3 model limits. New built CLI history tests exercise null IDs, settled answers, reopen reasons and unchanged refusals. Real owner clarifications are not fabricated. | Automated history checked; actual owner interview open |
| B04 | Purpose/actor/identity checks, nested protected-field refusal and equivalent-time owner-message regression. Source/tool/quoted text cannot invoke owner-only MCP routes. Actual host ambiguous-yes behavior needs an actual attributed conversation. | Runtime boundaries checked; conversational consent trial open |
| B05 | `handoff-store.test.ts` B05 demonstrates only explicit bound grant enables execution and status does not write. Actual tiny local change beginning after a real trial implementation confirmation has not happened. | Authority mechanics checked; real handoff open |
| B06 | `core/test/spec-file.test.ts`: raw digest/BOM/CRLF, missing/malformed/oversized, path escape/symlink/root, FIFO, changed-during-read and metadata cases. `handoff-store.test.ts` checks canonical readability and separate candidate/current-grant health. | Automated filesystem and integration evidence |
| B07 | `conversation.test.ts` A→B→A, replaced identities, unrelated observations and same-byte attachment. `handoff-store.test.ts` real receipt replay after revoke stays ineligible; file restoration clears only the unchanged current grant's health block. | Automated model/store evidence |
| B08 | Actual store pause/revoke/resume succeed with missing specs. Direction changes preserve paused lifecycle and retire old grant. Lock/projection failures withhold eligibility. A real owner pause, stopping batches and a genuinely fresh paused host still must run. | Automated persistence checked; actual host portion open |
| B09 | Distinct candidate survives revocation without inheriting permission, exact spec requeue requires fresh attachment. Supported vs unsupported challenges use bound evidence/acknowledgement, not a raw review-needed flag. Completed plans cannot execute or requeue automatically. | Automated transition/store evidence |
| B10 | Rich context contains discussion, spec, grant, accepted/pending meaning and provenance. CLI/fresh-stdio parity is only process evidence, not a fresh conversational host. Neither paused nor eligible-unpaused genuinely new-host recovery is claimed. | Fresh conversational host trial open |
| B11 | `cli/test/package2-parity.test.ts` commits actual CLI grants and pause, compares full DTOs to fresh built MCP, and checks accepted meaning, saved answer/provenance, deferred question, bounds, grant, current/changed/missing file health and eligibility. `cli/test/package2-protected.test.ts` and `mcp/test/package2-protected.test.ts` inject nested authority/forged descriptor fields into valid requests: exact refusals and byte-identical graph/bridge. Clean agent controls commit advisory discussion/descriptors without grants. | Public-interface checks passed, synthetic owner fixtures only |
| B12 | Preserved actual subprocess CAS/live-lock/offline-recovery/publication tests plus `handoff-store.test.ts` child crash after grant commit. Reread after replay remains ineligible until explicit repair. Tests establish quiescence only for their own joined child. | Automated actual-process evidence |
| B13 | Final clean fixed-checkpoint rebuild passed 334/334. `core/test/conversation.test.ts` explicitly gives implementation/pending rows whole-second vs fractional timestamps and checks instant order. Actual CLI mixed-kind cursor test checks exact keys and no omissions/repeats. Package-1 test diff preserves safety assertions, with only required v3 fixture fields; manifests/dependencies unchanged. | Final gate passed |
| B14 | No actual owner usability feedback about the new conversation has been received yet. Design/build approval is not that feedback. | Open |
| B15 | This report maps the complete original scope and pins final checkpoint, commands, results, corrections and limitations. Live evidence fields remain open until real attributable observations exist. | Implementation handoff recorded; overall acceptance incomplete |

### Q1–Q7 trace: implementation-gate baseline

| Expectation | Implementation and check | Still required |
| --- | --- | --- |
| Q1 overview | Ordered CLI groups, explicit approval-purpose rows, repo skill overview once | Owner interaction confirms presentation/non-repetition |
| Q2 direction then focused grilling | Direction decision and advisory checkpoint separated from grant; stale answers visible, no automatic coding | Actual direction confirmation followed by focused owner questions |
| Q3 separate implementation authority | Verified spec/bounds, owner-only grant/revoke, exact review identity and current handoff | Real trial specification review and separate implementation decision |
| Q4 start/continue without redundant approval | Current grant eligibility and unchanged-semantic CAS retry rules; no authority from receipts alone | Actual immediate tiny change and fresh eligible-unpaused continuation |
| Q5 isolated real trial | Isolated inventory and unapproved plan prepared below, no global setup | Real owner trial plus independently verified fresh-host isolation |
| Q6 persistent pause | Pause survives direction changes; missing files cannot prevent stopping; resume never grants | Real owner pause and fresh paused-host behavior, honest unsaved-pause handling |
| Q7 quiet routine evidence | Repo skill concise milestone and observations instructions; full overview on request | Actual owner usefulness feedback, not an inferred preference pass |

## Independent feedback and corrections

1. Authority reviewer reproduced reuse of the same owner message using equivalent `.000Z` and `Z` spellings, including resume that restored eligibility. The model and transitions now use one normalized owner-message key. Regression tests cover revoke, approve, resume and cross-plan reuse without rounding nonzero fractional precision. Coordinator reran `/home/pitfa/.jcode/scratch/giraffe-package2-owner-time-fixed-probe.ts` at `2026-10-12T18:14:11Z`: both bypasses reject and the paused grant stays ineligible. This is actual-core synthetic-fixture evidence, not a live owner message.
2. IO review and coordinator inspection hardened filesystem error conversion, root symlink refusal, descriptor/path metadata checks and descriptor lifetime. A caught intermediate edit was corrected before final acceptance. Reviewer's stable 37-case IO/store run passed; all six source hashes in `/home/pitfa/.jcode/scratch/package2-io-review/stable-before.sha256` still matched on the coordinator recheck. Coordinator reran the actual facade/store probes: current → changed → missing → exact restoration gave eligible → ineligible → ineligible → eligible without rewriting canonical state. The separate two-scope probe passed namespace isolation, missing-file pause/resume/observe/revoke and all-scope facade checks.
3. Coordinator found material skill mismatches: bare installed CLI usage, incorrectly claiming no persistence path for owner pause, unnecessary reapproval after unrelated CAS changes, confusing partial commit handling, and presenting direction approval as a completed plan. These were corrected through `84322ef` and `ab3f82e`. Normative instructions no longer substitute smoke-test anecdotes for the host contract. The independent authority reviewer read all four finalized skill files with stable hashes and found no material mismatch with approved section 7. That is static contract review, not live UX acceptance.
4. Same-path candidate/current-grant descriptors can be inspected at different instants if an external editor changes the file between reads. The independent IO review did not find a new permission bypass under the approved point-in-time contract. This implementation does not claim a single atomic snapshot of multiple spec files or direct-editor exclusion. Approval rereads the selected candidate under the cooperative scope lock, and the host must recheck current grant/spec before each bounded batch.

## Historical trial preparation (superseded by live-trial report)

- Root: `/home/pitfa/.jcode/scratch/mozak-package2-live-20261012-174824/project`.
- Inventory: `/home/pitfa/.jcode/scratch/mozak-package2-live-20261012-174824/inventory.json`.
- Scope: `package2-trial`. Plan: `count-formatter`.
- Init operation: `prepare-package2-trial-20261012-174824`, using a host-asserted reference to this actual session (`session_bird_1791757677481_6757ea5aaafec9b7`), the supplied approval timestamp, and SHA-256 of actual response text `approved` (`2687f86ed6784b8a5fca36e6c468e12aa44dc3c7e8137e3160d1a95079bdcd02`). It is not claimed to be a native host message ID or authentication.
- Pending direction: `6bea3508-3e19-4446-827d-2ad249a8ae72`. No direction decision, settled owner answers, attached spec, implementation grant, pause, resume, completion or usefulness feedback exists in this trial yet.

The first proposal request had an invalid object-valued `nonGoals` field and was refused with `committed:false`. The request was corrected to the actual string-array schema, retaining its meaning. The valid proposal committed at `2026-10-12T18:04:59.175Z`; this is preparation evidence, not successful interviewing.

Next actual owner question will present the tiny formatter trial's direction, explicitly separate from coding permission. On real direction confirmation, persist its exact review binding and ask only unresolved details. After a reviewed local spec and separate actual implementation approval, start the tiny change and exercise actual pause/resume. Do not prefill or simulate those decisions.

A fresh-host bootstrap may contain only exact skill/CLI/inventory paths, scope/plan IDs and the current owner request. No transcript, semantic recap, memory lookup or inherited worker handoff. Verify the new host's initial context before counting it. If supported per-session isolation cannot be established, record that boundary as blocked without changing globals. Both paused and eligible-unpaused recovery remain required.

## Unchanged boundaries and limitations

Observed fingerprints at `2026-10-12T18:01:16Z`, unchanged on the `2026-10-12T18:16:25Z` recheck:

| Item | SHA-256 |
| --- | --- |
| Installed MOZAK config | `a50738be25634e57cd51284a0ba8c1b8a4434aaff2597e06ae777c5527ee3ddb` |
| Installed `~/.claude/skills/mozak/SKILL.md` | `afa45da091e12fe6f72321e4eb0f5d21cc51d77c98f416e4abc09e7568d11346` |
| Accepted idea brief | `23e4718ab4e224c120adc03967467d419e9f0ebe45ea67b78d4d0417980ca696` |

Config and brief equal their pre-work recorded hashes. No implementation tool wrote installed/global skills or configuration. The installed-skill hash is a current fingerprint, not a retroactively invented earlier baseline. No dependency or package manifest changed against the approved proposal checkpoint. Trial entry-file fingerprints after initialization/read checks: README `fe02e05f05bf0a36a4b552e387b0bb996e01316af3e953df7e80973edc09f872`, AGENTS `5501cb1f70ba1b91ad2c43ea7226f9fc6c468de2ffbab892dc57738663823e06`.

Host-supplied owner provenance remains a trusted convention, not authentication. Bounds are declarations, not shell capabilities. Graph/spec/bridge operations are not atomic together. Direct editors, ABA rewrites, power-loss durability and untested filesystems remain outside the guarantees. No overall Package 2 completion, Monokl usefulness or global rollout is claimed until the still-open acceptance requirements have their own evidence.
