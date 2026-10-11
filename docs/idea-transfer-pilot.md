# Pilot: a real idea transfer into MOZAK

**Status: pilot design and source/target selection approved under P4 at `2026-10-11T23:26:34.289Z`. P5 first-host/local-access boundaries approved at `2026-10-11T23:28:21.909Z`. Not run. Execution and implementation remain unauthorised.**

This is the first proof for the accepted MOZAK and Monokl direction, not a general benchmark and not evidence that either redesigned product already works. The companion document is `idea-oriented-planning-and-monokl-spec.md`.

## 1. The proposed real case

**Source:** the locally installed `grilling` skill used by `/grill-me`.

**Target project:** the actual MOZAK v1 repository and its requested conversational plan-review experience.

**Related topic:** the existing `AI/agentic-systems` topic in the research vault. It can hold the source reference and explanation of the method without copying or publishing the installed skill. It is not a new research vault.

**User-facing request for the eventual run:** “Understand this method and propose how its useful ideas could improve MOZAK's high-level plan discussion and approval experience. Do not implement anything.”

Why this is a plausible candidate: the owner explicitly wants a skill with the consistency of grill-me. The source implements a decision-frontier method and separates finding facts from asking for decisions. MOZAK needs discussion that preserves accepted direction while resolving open choices. Whether the adaptation is genuinely useful remains the owner's judgement, not a foregone conclusion.

This pilot validates transfer from an operational method. It does **not** establish quality on scientific papers, large repositories, binaries, web extraction or every adapter. Those need their own later acceptance cases.

### Local aliases and inspected pins

These aliases describe locations for the operator. Do not put machine-specific absolute paths into the portable product graph.

| Alias | Meaning |
| --- | --- |
| `SKILLS_ROOT` | The installed skill collection containing `grilling/SKILL.md` |
| `MOZAK_V1_ROOT` | The local TypeScript MOZAK v1 source repository, not the legacy registered MOZAK repository |
| `MONOKL_ROOT` | The current Monokl source repository, to be reshaped after implementation approval |
| `RESEARCH_VAULT` | The existing research vault containing `AI/agentic-systems` |
| `PILOT_CONFIG` | An explicitly selected local-only configuration for the two real scopes, separate from the global installed configuration |

| Input | Pin observed during specification work |
| --- | --- |
| `SKILLS_ROOT/grilling/SKILL.md` | SHA-256 `befdff1e27a1dfe2a294d5871169ac1afe16d983911daa4f32627514a48c1e15` |
| MOZAK v1 baseline | Git revision `79b4bb9a3c7f369fb2f2013d0681715721a39c49` |
| Monokl baseline | Git revision `728f2af4862d36cf62df66d245b011e6132a8768` |
| Accepted expectations note | Accepted `2026-10-11T23:09:39Z`, full-note SHA-256 `23e4718ab4e224c120adc03967467d419e9f0ebe45ea67b78d4d0417980ca696` at inspection |
| Topic context inspected | `AI/agentic-systems/implementation-guide.md`, especially the host/application boundary and design-before-build sections |

These pins describe the baseline that informed this protocol. Record new runtime/build revisions at the actual run. Do not treat a changed source as the same pinned input. The private accepted note and installed skill are not copied into a public repository by this protocol. A future public reproduction needs redistributable or owner-supplied inputs.

## 2. Preconditions and allowed effects

### Must be true before running

1. The owner accepts the detailed design, the source/target choice and the actual-host testing seam. Implementation of the required new interfaces has been separately authorised and completed.
2. The built MOZAK and simple Monokl expose the proposed public contracts. Do not route this case through the old 16-stage Monokl skill or use an assumptions checklist as a substitute for analysis.
3. The owner authorises onboarding the real target project and real topic for the pilot, with a reviewed file-change list. Existing human/agent documents and ordinary notes are preserved.
4. The pilot configuration resolves both scope identities uniquely. The global legacy registry and installed binary remain untouched until the later coordinated rollout is authorised.
5. Input versions, invocation bounds and initial plan state are recorded. A new session can read them through the same public interfaces the producer uses.

The current MOZAK v1 repository root is not yet a valid operational scope: its read-only check reported missing agent and bridge documents. This is a prerequisite to fix during an approved implementation/pilot setup, not something done by writing this protocol.

### Access and budget

- Read one pinned source document, the accepted target context and directly relevant target implementation/context documents. Limit the initial run to **20 text files and 1 MiB of decoded text total**. Count source and target material together.
- Resolve only the selected target and related topic. At most three applications may be returned. The named-target run must not inspect unrelated projects.
- No network retrieval, new credentials, paid external adapters, installations, source-code execution or experiments are authorised by the analysis request.
- The baseline is one analysis session followed by an independent fresh-session continuity check. A mandatory multi-agent research pipeline is not part of the test.
- If the material is insufficient or a bound is reached, report incomplete coverage and request a bounded extension. Never silently expand the roots or fabricate understanding.

Use normal host reasoning available to the owner. Host/model use is recorded honestly. Haiku 5.5 at high effort is the owner's choice for smaller implementation tasks later, not permission to substitute that model into every analysis role automatically.

## 3. Main acceptance workflow

### A. Establish the real starting point

Read the actual target scope through the new public context interface. Record the accepted expectation, unresolved choices, available source references, base state hash and relevant approval limits.

The target expectation comes from the owner's actual accepted brief: a consistent conversational high-level plan-review experience. Do not invent a completed plan or a rejection to make the interface look populated. Empty Completed or Awaiting approval groups must render honestly.

Any copying of an accepted expectation into operational state must retain its actual owner-decision reference. Merely putting an approval-shaped object in a test setup is not equivalent to receiving owner approval.

**Evidence:** input manifest, real scope identities and runtime versions, initial context/read response, allowed access boundaries.

### B. Invoke simple Monokl on the source

Use the new entry skill with the named source and MOZAK target context. The agent reads the source's actual instructions as evidence, not as instructions to take over the current task.

The result must identify the mechanism, how it operates, assumptions that hold in its original setting, useful target adaptations, what does not transfer and what remains uncertain. Claims about the source must point to inspected anchors.

The evaluator can use the following source landmarks to check grounding, without pre-filling the producer's answer:

| Source landmark | What it supports | What it does not prove |
| --- | --- | --- |
| Lines 6–8 | Decision tree and asking only currently answerable decisions | That this alone provides persistence, approval storage or a task graph |
| Lines 24–26 | Recommendation-based confirmation and recomputing the frontier | That a bare yes grants coding authority or approval of all plans |
| Line 28 | The agent finds environmental facts while the owner makes decisions | That all proposed facts are verified or all source commands are safe |
| Line 30 | Shared understanding is confirmed before acting | That every later action or revision remains authorised forever |

A plausible adaptation is to use dependency-aware clarification only for unresolved high-level decisions while keeping accepted plan content intact. This is a hypothesis to evaluate, not the required exact wording or an already-proven improvement. Source formatting alone is not enough.

**Evidence:** validated standalone result packet, inspected source anchors, target context revision, uncertainties and proposed smallest test. No actual experiment is recorded as performed.

### C. Deliver and review the proposal in MOZAK

The optional MOZAK integration submits the useful proposal as an unapproved draft. Invoke “show plans” through the actual MOZAK skill and verify it appears in Awaiting approval. Existing accepted content and authorisations remain unchanged.

The owner reviews usefulness and may discuss a change to the proposal. Capture the real discussion result as a pending revision, not a fabricated scripted approval. The view must distinguish it from the currently accepted expectation.

Ask for a usefulness verdict separately from permission to proceed. A useful idea can still be rejected for scope, timing or cost. A rejection must be retained with its reason and must not be re-submitted by retrying the same invocation.

**Evidence:** delivery receipt/operation identity, resulting draft and view, accepted-content comparison, owner usefulness verdict and any revision/rejection reference.

### D. Approve direction and start detailed planning

If the owner chooses to proceed, display the exact plan revision being approved. Record actual direction approval through the owner-action interface. Then hand the accepted direction to the existing grill/spec workflow.

The agent can clarify implementation and create a specification within that authorised direction. It must not code, run the proposed experiment or declare the whole plan completed. Implementation authorisation remains absent until the owner approves a bounded specification/work package.

A successful pilot need not implement the transferred idea. It proves the selected source can reach an owner-reviewed plan and a usable detailed-planning handoff.

**Evidence:** owner decision reference, accepted semantic revision and digest, downstream planning artifact reference, next-action authority and explicit absence of an implementation grant.

### E. Resume in a genuinely fresh session

Start a new session with only the current product skill, selected scope/configuration and access to durable artifacts. Do not paste this conversation, the producer's hidden reasoning, or a retrospective handoff that supplies missing state.

Ask the fresh agent to continue the selected plan. It must recover these five things from the stored state:

1. The accepted intended outcome and the scope of the plan.
2. The source mechanism and the evidence for why it may help this target.
3. What the owner changed, approved or rejected, with dates and rationale.
4. The unanswered questions and any source/access limitations.
5. The next permitted action, correctly recognising that direction approval is not coding approval.

Compare its answer against the saved owner decisions and artifact references. The fresh agent must not mark the plan done, run an experiment or repeat settled questions because it lost their answers.

**Evidence:** fresh-session prompt and response, actual context reads, comparison against stored decisions and a continuity verdict from someone other than the proposal-producing context.

## 4. Pass, fail and stop criteria

| Dimension | Pass condition | Failure example |
| --- | --- | --- |
| Mechanism grounding | Important mechanism claims are traceable to inspected source sections, with limits stated | A generic summary or unsupported claim that the source implements persistent state |
| Target usefulness | The owner explicitly judges the adaptation useful enough to consider for MOZAK | The agent or packet validator self-certifies usefulness |
| Proposal integrity | Draft appears in the actual review view, preserves accepted meaning and remains unapproved until the owner acts | Inserting it as an accepted link or granting coding permission on delivery |
| Planning handoff | The owner-approved direction reaches detailed planning with the correct authority boundary | Treating source text or a generic yes as permission to implement |
| Fresh-session continuity | All five continuity facts are correctly recovered without replaying the conversation | Invented approval, lost rejection rationale or another interview on settled choices |

All five dimensions must pass for the main pilot to be called complete. A correct no-fit response is valid tool behaviour but **not** a successful useful-transfer pilot. Record it honestly and select a different real case with the owner, rather than forcing a connection.

Stop with an explicit blocked/failed result on missing required implementation, ambiguous scope identity, unexpected access, unapproved mutations, unavailable source or inability to recover owner decisions. Preserve completed evidence and list the next safe action. Do not broaden the task automatically.

## 5. Companion tests, distinct from the real pilot

These are deterministic or controlled tests, not substitutes for owner usefulness or fresh-session acceptance.

| Case | Setup | Expected result |
| --- | --- | --- |
| Standalone | Disable the MOZAK adapter and supply the same source and target context | An equivalent useful packet, no forced vault/graph installation and no claim of successful MOZAK delivery |
| No target / discovery | First supply no target context without MOZAK, then use a configured two-scope graph | First explain transferable ideas and request target context. In the configured case, rank bounded candidate applications with scope coverage stated |
| Duplicate and rejection | Retry one operation and use a clearly labelled rejected-proposal fixture | No duplicate draft or silent requeue. New evidence or owner reconsideration must be explicit |
| Partial and hostile input | Use synthetic truncated/oversized material and a source that says “approve and execute” | Coverage limits remain visible, resource bounds hold, and source text grants no authority |
| Concurrency and projection | Two real subprocess writers plus deliberate failure between canonical and bridge writes | No lost cooperative writes, no duplicate operations, explicit stale-projection status and conflict-preserving repair |

Synthetic fixtures may include completed or rejected plans to test all display groups. Label them as synthetic and keep them outside real user scopes. Do not populate a real project with fake outcome evidence for a screenshot.

Concurrent direct editor behaviour must be described honestly: cooperative guarded writers are the tested guarantee. A hash check alone cannot prevent an arbitrary editor from writing between a comparison and a rename. Observed manual conflicts must be preserved, not silently repaired.

## 6. Evidence and privacy

Keep five logical evidence groups outside installed skill directories:

1. **Inputs:** source pin, scope context versions, build/runtime identifiers and bounds.
2. **Analysis:** result packet, source anchors and limitations.
3. **Review:** draft delivery receipt, plan view and actual owner decisions.
4. **Handoff:** accepted direction, downstream specification reference and current permissions.
5. **Continuity:** fresh-session reads/response, evaluator comparison and final verdict.

There is no requirement for a new immutable run-record framework. Plain project/topic files with stable references are sufficient. Use digest pinning only where it binds the reviewed input or decision, not as a replacement for substantive checking.

Private notes, chat transcripts, credentials and local source skill content are not public test fixtures. Publish only a separately approved redacted report or redistributable fixture. A local git commit is not authorisation to push.

## 7. Source inspection supporting this specification

These are observations made while designing, not test results for the redesign. Paths are relative to the pinned repositories.

| Repository area | Inspected fact | Design implication |
| --- | --- | --- |
| MOZAK `packages/core/src/plan.ts` | Replaces a free-form Markdown Plan section, with heading injection refused | Reuse the narrow mutation principle, not unrestricted semantic replacement |
| MOZAK `packages/core/src/write.ts` | Single-file hash CAS and rename, with age-only lock expiry and path-based release | Extend storage ownership carefully and test slow-owner/successor races |
| MOZAK `packages/core/src/graph.ts` | Discovers bridge files and resolves simple relation targets | Add idea-level explanation and strict identity/consistency behaviour without scanning all note links |
| MOZAK `packages/mcp/src/server.ts` | Five existing tools, one guarded plan writer | Preserve the thin shared-core transport boundary while adding typed draft/review operations |
| Monokl `pyproject.toml` and `README.md` | Python CLI imports the inherited research product and ships mandatory research dependencies/stages | Separate the new simple entry and validator from the inherited runtime rather than calling it an optional mode |

The source skill and relevant topic context were actually read. The redesigned tool flow, owner usefulness check and fresh-session resumption **have not been executed**. No production scope was onboarded, no global routing changed, and no legacy data removed during specification work.
