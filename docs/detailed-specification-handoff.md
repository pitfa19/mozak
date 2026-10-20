# Detailed specification: design review and handoff

**Design-authoring workflow complete. Product implementation and pilot acceptance are separate.** This record closes the requested specification/review/handoff deliverable, not every capability described in the design. It creates no new owner approval.

## Delivered artifacts and review sequence

| Step | Concrete evidence | Scope of the result |
| --- | --- | --- |
| Accepted expectations | Owner acceptance at `2026-10-11T23:09:39Z`; immutable expectations brief, SHA-256 `23e4718ab4e224c120adc03967467d419e9f0ebe45ea67b78d4d0417980ca696` | Idea-oriented mozak, simple Monokl, optional external adapters, separate approval purposes and real proof before rollout. |
| Detailed specification and pilot protocol | `7014969` added `idea-oriented-planning-and-monokl-spec.md` and `idea-transfer-pilot.md` | Concrete proposed design, user stories, requirement-to-check matrix, bounded real-pilot protocol and explicit exclusions. Not implementation. |
| Independent design review | Parent specification, “Design review status”; recorded read-only review recommended owner review | Review findings informed data ownership, permission, storage, adapter and pilot boundaries. Static review is not runtime evidence. |
| Actual owner design review | P1–P5 below, completed at `2026-10-11T23:28:21.909Z`; recorded through `b74be59` | Named choices accepted individually. Remaining engineering details still require bounded package review. |
| Bounded implementation handoff | Package 1 proposed at `caffffa`, separately approved at `2026-10-12T08:16:20.810Z` and recorded by `acc0bd7` | The specification was actually used to define and execute one approved slice, rather than left as an unreviewed draft. |

## Owner feedback closes the design-choice loop

The authoritative approval wording remains in the parent specification's “Owner review points.” This table is an index, not a replacement decision record.

| Decision | Actual owner response time, UTC | Accepted choice and limit |
| --- | --- | --- |
| P1 | `2026-10-11T23:23:28.952Z` | Canonical JSON plus generated checked Markdown bridge. Not blanket approval of all storage mechanisms. |
| P2 | `2026-10-11T23:24:14.417Z` | One accepted and one pending revision, exact review binding, direction approval starts planning rather than coding. |
| P3 | `2026-10-11T23:24:58.254Z` | Simple skill-first Monokl, zero required standalone adapters, optional Python validator, no HyperResearch core dependency. |
| P4 | `2026-10-11T23:26:34.289Z` | Local grilling method as pilot source, mozak discussion as target, real owner usefulness and genuinely fresh-session recovery required. Design/source selection only. |
| P5 | `2026-10-11T23:28:21.909Z` | Jcode-first bounded local proof, portability and no global setup change. Not pilot execution, installation or migration approval. |

## Requirement-to-design-delivery mapping

| Accepted invariant | Delivered specification content | Feedback or downstream observation |
| --- | --- | --- |
| R1 understanding, not tasks | D1/D3/D5, high-level plan content and downstream implementation boundary | Accepted brief and P2; package-1 actual CLI reconstructs accepted/pending meaning and provenance. |
| R2 owner authority | D4, separate direction/implementation/connection decisions and exact confirmation binding | P2; package-1 actual CLI/MCP refuses nested protected-field injection and reports no implementation grant. Future grants remain separate. |
| R3 useful transfer | D8/D9, mechanism/assumptions/fit/evidence/no-fit contract and companion pilot | P3/P4. Actual adaptation usefulness is deliberately unproven until the authorised real pilot. |
| R4 scope and simplicity | D1/D6/D9/D10, optional adapters, local bounds, declared connections and on-demand work | P1/P3/P5. No implicit permission for a pipeline, watcher, network service or global rollout. |
| R5 honest progress and recovery | D3–D7, C01–C10 checks, pilot acceptance criteria and migration obligations | P2/P4/P5; package-1 evidence-backed outcomes, actual concurrent writers and crash-recovery checks pass. Conversational recovery and migration are not substituted by those tests. |

This establishes completion of authoring, review, recorded owner design choices and the first bounded handoff. It does not claim every proposed field or engineering mechanism was approved during P1–P5. Package-specific choices are reviewed and authorised separately.

## Actual implementation feedback and remaining handoff

Package 1's implementation and A01–A15 evidence are recorded in `implementation-package-1-acceptance.md`. A fresh audit at repository checkpoint `7da7e41` rebuilt the real workspace and ran all 239 tests successfully on October 12, 2026. Actual built CLI, fresh stdio MCP, concurrent writers and crash/recovery paths ran. Source/tests/manifests were unchanged from implementation checkpoint `78896e9`.

The fresh audit log is `/home/pitfa/.jcode/scratch/mozak-evidence-audit-20261012-1430/full-gate.log`, SHA-256 `047b8c641911d0ab0ccd4c4c50616bc829476ff985f4958dea1837c483f7aad3`. Its adjacent `requirement-evidence.md` maps A01–A15, C01–C10 and Q1–Q7 to observations or explicit gaps. Synthetic owner fixtures prove mechanical binding only, not actual human consent or usefulness.

| Downstream work | Current state | Authority boundary |
| --- | --- | --- |
| Package 1: plan state/review | Implemented and mechanically verified through the actual local interfaces | Existing bounded build approval only. No real user migration or global switch. |
| Package 2: conversation/handoff | `implementation-package-2-conversation-and-handoff.md`, reviewed proposal at `7da7e41` | Drafting approved at `2026-10-12T14:03:25.600Z`. No separate build approval yet; Q1–Q7 behavior approval is not coding permission. |
| Monokl and optional integration | Described in parent sequence, not implemented by these packages | Requires its own bounded approval. |
| Real transfer pilot and rollout | Protocol/design accepted, execution unperformed | Requires actual owner decisions and explicit execution/migration authority. Automated continuation messages do not supply it. |

The earlier assessment mixed two different outcomes: completing a detailed-design deliverable and completing the entire designed product. The former has a real review/owner-decision/handoff chain. The latter remains partially implemented and must not be reported complete. Closing this design-authoring goal does not waive any runtime, usefulness, fresh-host or migration acceptance requirement.
