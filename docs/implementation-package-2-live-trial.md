# Package 2 live trial: October 12, 2026

## Result and limits

The isolated `count-formatter` objective is **completed**. The coordinator independently inspected the actual files, reran the actual exported-function tests (75/75 passing), bound observed evidence to the objective through the CLI, and verified the completed state and overview.

**Overall Package 2 acceptance is still incomplete.** Owner-supplied session reports describe correct paused and unpaused recovery, but explicitly cannot certify initial-context isolation. A mistakenly reused session correctly refused the fresh-host check. Actual owner usability acceptance has not been supplied. No test count or objective completion substitutes for either requirement.

This is a follow-up to `implementation-package-2-acceptance.md`, not a new schema, implementation grant, installation or rollout. Repository documentation updates follow the original Package 2 approval. The formatter grant itself allowed only the two scratch application files.

## Durable location and authority

- Trial root: `/home/pitfa/.jcode/scratch/mozak-package2-live-20261012-174824/project`.
- Inventory: `/home/pitfa/.jcode/scratch/mozak-package2-live-20261012-174824/inventory.json`.
- Scope/plan: `package2-trial` / `count-formatter`.
- Accepted revision: `bbfcee30-a0ed-499a-ae9b-1bfebaeda84a`.
- Spec descriptor: `a5a2516b-d5a3-4d09-b232-53a0b4f26fc5`.
- Unchanged implementation grant: `a6d23c9e-9074-4076-af9c-feb28929f000`.

Owner references are explicitly host assertions using actual session IDs, supplied message times and exact-response hashes. They are not native authenticated message IDs. Pasted reports are evidence reports, not new owner decisions.

## Actual sequence and observed checks

All times below are UTC on October 12, 2026.

| Step | Evidence and observation | Limit |
| --- | --- | --- |
| Direction | Actual owner `approved` at 18:33:41.568; decision `d05d8752-9cee-4eb3-8dff-026ecd0cc5f1` persisted and read back. | Direction only, not coding consent. |
| Clarification | Actual replies at 18:38:22.518 and 18:41:40.161 saved strict non-negative safe integers and fixed labels/order including zeros. Both answers recovered later. | No fabricated answers or satisfaction verdict. |
| Implementation | Distinct actual approval at 18:45:04.769; decision `093372e5-6a89-4777-b089-262bebca73cd`, pinned spec and two allowed paths, eligibility reread true. Test writing began in that turn. | Inherited worker is not a fresh-host witness. |
| Safe checkpoint | Test file created, implementation absent; independent real run at 18:47:43.409 failed loading the missing module, 0 pass/1 file fail. Partial evidence persisted. | Individual test cases had not run. Host checkpointing was not falsely labelled owner pause. |
| Pause | Actual `okay pause it` at 18:52:30.654; CLI operation `trial-pause-20261012-185230654`, decision `ba3479c3-8c93-4599-933c-8292e902a940`. Reread showed paused, ineligible, retained grant/answers, unchanged spec/tests, implementation absent. Worker was idle. | Restrictive instruction preceded mechanically generated review under the approved pause exception. |
| Paused recovery | Owner pasted a new-session report at 19:16:05.837: correct pause, both answers, approval, bounds, partial progress and required explicit resume, no writes. | Reported no contamination observed, not independently certified isolation. |
| Resume | Owner message at 19:56:45.040 in session `session_owl_1791832308616_4c08ecea46274281`; decision `5c3ceec7-b496-4ad4-a966-53962784d2c2` persisted at 19:57:05.257. Coordinator independently read open/eligible/current and the same grant. | Owner explicitly said do not implement yet; no duplicate implementation launched here. |
| Contaminated attempt | Owner supplied owl's refusal at 20:01:03.087: same session already contained the recovery and resume history, so it did not code or claim a clean pass. | This attempt does not count as fresh-host evidence. |
| Unpaused continuation | Owner pasted another report at 20:02:25.894 describing recovery without repeated questions/reapproval, spec-hash check, implementation creation and 75 passing tests. Actual saved observation `trial-green-checkpoint` at 20:02:08.258 and actual files corroborate the result. | Initial context was reported bootstrap-only, but hidden injection could not be ruled out. Initial-context isolation remains unverified. |
| Independent verification | Coordinator inspected implementation/test/spec and hashes, ran `node --test --test-reporter=dot formatter.test.mjs` with exit 0, then `node --test formatter.test.mjs`, reporting 75 tests, 10 suites, 75 pass, 0 failed/cancelled/skipped/todo at 20:03:07. | Real application interface, not a copied function or stub. Not a fresh-host check. |
| Objective completion | Added observed support and ran CLI `plan complete`. Completion `e6c3973d-d22c-4d1b-a065-5fffbe10472f` at 20:04:19.426. Fresh CLI context/overview showed completed, 1 completed/0 open/0 awaiting, `executionEligible:false` due to `lifecycle-completed`, no review-needed issue. | Objective formatter outcome only. No owner usability acceptance manufactured. |

The continuation's first passing observation had no outcome support link. The coordinator did not treat a passing summary as sufficient completion evidence: it recorded its own independent run and an explicit observation-to-accepted-outcome `supports` link, read the outcome review (observed passing evidence, no challenges), then used the agent-allowed objective completion route. No `accept-outcome` owner decision was invented.

## Formatter requirement-to-check mapping

The unchanged `formatter.test.mjs` imports the actual `formatPlanCounts` export from `formatter.mjs`. All mapped checks below ran successfully in the 75-test result.

| Requirement | Concrete test/check |
| --- | --- |
| Mixed example, zero/one, fixed labels, order and spacing | `formatPlanCounts output` exact-string cases. |
| Maximum safe integer and ordinary decimal text | Output MAX_SAFE_INTEGER assertions and per-field valid-boundary loop. |
| Each invalid required field | Per-field table covers undefined, null, negative/fractional numbers, strings, booleans, NaN, both infinities, bigint, unsafe integers, objects/arrays and missing keys, asserting exact TypeError name/message. |
| Invalid containers | Null, arrays including named fields, primitive string/number/boolean, omitted and undefined input cases. |
| Own properties, inherited counts and first-error order | Dedicated own/inherited suite and four ordered-error assertions. |
| Extra keys and negative zero | Exact-output assertions in output suite. |
| Frozen/unchanged input and deterministic repeats | Input safety suite compares values/keys, frozen flag, shallow snapshot and 25 repeated calls. |
| No disallowed implementation facilities | Inspected all 16 implementation lines: no imports, filesystem/network, logging, dynamic execution or dependencies. |
| Spec/test and ordinary entry documents preserved | SHA256 comparisons against pre-continuation values, below. This is not a system-wide write audit. |

## Pins and completion record

| File | SHA256 at independent verification |
| --- | --- |
| `formatter.mjs` | `50a5711cb90df971020c3e1c8ddc0bbedbb0e62f3ede9e5b10c6bc286956e040` |
| `formatter.test.mjs` | `3c6d2ff8c655fb045b9cba6c0e05f178fa01a3e2026f7d27cec38df69486c9d7` |
| `formatter-spec.md` | `53e0980045838b080487d9bc74e8429d5a0c6237a44a80a2bb4baf3b55439a8b` |
| `README.md` | `fe02e05f05bf0a36a4b552e387b0bb996e01316af3e953df7e80973edc09f872` |
| `AGENTS.md` | `5501cb1f70ba1b91ad2c43ea7226f9fc6c468de2ffbab892dc57738663823e06` |

- Observation operation: `trial-independent-green-20261012-200307`.
- Observation/evidence: `trial-independent-green-200307` / `independent-green-200307`.
- Link: `independent-green-supports-formatter-tested` to accepted revision `bbfcee30-a0ed-499a-ae9b-1bfebaeda84a`, outcome `formatter-tested`.
- Completion operation: `trial-objective-complete-20261012-2004`.
- Completion evidence digest: `74c1b06845f10ac575ba2063ab860b1adfcf48b4685a8fa82247aba2fa71e240`.
- Final observed canonical revision: `77cf71bc-d995-40a9-aaf7-0e9ee9c2ed2e`.
- Final graph hash: `f48cf0700d942fa0d10fb9505985db0252204a32906d1e668aa0f320c1df40b6`.
- Final bridge hash: `e4f8c0917d1049410a776aff4e4a96fe82ba2b5f1b27d574792d5d5356fcbb8e`; projection current.

Request artifacts remain beside the trial inventory: `pause-185230654.json`, `observe-independent-green-200307.json`, and `complete-objective-2004.json`. Exact retries use their original operation IDs; modified requests require new IDs.

## Still open, and observed UX friction

1. **Strict B10/Q5 fresh-host isolation:** neither user-supplied report certifies absence of injected project context. Record behavior as reported recovery, not a certified clean-host pass. Existing application success does not close this. No global configuration changes were made to force a result.
2. **B14/Q7 owner usability verdict:** the owner has not yet said whether the workflow meets expectations. The record shows requests to clarify which project/session was involved, a panel prompt that was not visible to the owner, and repeated automated incomplete-todo messages. These are concrete usability observations, not an inferred user satisfaction judgement. Prompt delivery was moved inline. Future approval of a design/build must not be relabelled usability acceptance.
3. **Overall acceptance:** the objective trial is complete, but Package 2 remains acceptance-incomplete until the outstanding original requirements have evidence or the owner explicitly changes their scope. No Monokl, global rollout, migration or production readiness is claimed.
