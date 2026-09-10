# MOZAK modules

Six modules, in the order `mozak lab modules` prints them. Each names where its
design came from, so you can check the borrowing rather than trust it.

| Module | Owns |
|---|---|
| [Scope](#scope) | The container: a Topic you study or a Project you change |
| [Research](#research) | Bounded observation, always proposal-only |
| [Plans](#plans) | Accepted inputs to goal DAG to execution to sealed package |
| [Meta KB](#meta-kb) | Everything that crosses projects |
| [Improve Lab](#improve-lab) | An improvement question turned into reviewable plans |
| [Skill](#skill) | How MOZAK reaches you |

---

## Scope

**Id** `scope` · **Files** `scope.rs` `project_contract.rs` `project_context.rs` · **Commands** `mozak scope`, `mozak project`

The container for work. A Topic is something you study, a Project is a
repository you change, and a Project is a *kind* of Scope rather than a peer of
one. Inputs enter hashed and immutable, or they do not enter.

| Taken | From | What exactly |
|---|---|---|
| Repository-owned authority, database as projection | [MDKG](https://github.com/nickreames/mdkg) | Markdown plus Git history is the authority. Indexes and caches are projections, never truth. |
| Contract / evidence / derived / governance planes | [Tieline](https://github.com/knoxgraeme/tieline) | Keep the four planes distinct, and reject a stale base on every projection update. |
| Always print the resolved scope | [OpenSpec](https://github.com/Fission-AI/OpenSpec) | Emit the selected project and root, so an agent cannot act in the wrong knowledge scope. |
| Stable identity and typed relationships | [Backstage](https://backstage.io/docs/features/software-catalog/) | Repository-owned metadata with ownership and typed relations, without a central portal. |

**Not delegated.** Backstage's central catalog service. MOZAK has no portal and
no server, so identity lives in the repository rather than in a registry that
could outrank it.

---

## Research

**Id** `research` · **Files** `research.rs` `adapter_workflow.rs` `landmark.rs` `case_study.rs` · **Commands** `mozak research`, `mozak adapter`, `mozak case`

Bounded observation, either of the outside world through an adapter or of your
own finished work as a case. Adapters own any declared network access outside
the MOZAK core, and everything they produce is proposal-only.

### Runs and adapters

| Taken | From | What exactly |
|---|---|---|
| Run provenance fields | [DVC](https://dvc.org/doc/user-guide/pipelines), MLflow, OpenLineage | Explicit inputs, parameters, tool and environment versions, outputs, timestamps, baseline revision, reproducibility instructions. |
| Reproducible computation is evidence, not authority | Same | A run never becomes an accepted decision merely by existing. |
| Recorded time separate from valid time | [Graphiti](https://github.com/getzep/graphiti) | Keep raw source episodes; keep contradictions and superseded claims queryable. |
| Registry identity pinned to one URL | [MCP registry](https://registry.modelcontextprotocol.io) | The tooling adapter refuses any fixture whose registry identity is not the exact official URL. |
| A curated source read at an exact commit | [dair-ai](https://github.com/dair-ai/AI-Papers-of-the-Week) | A second, curated complement to arXiv. Only metadata is retained, because upstream declares no license. |

### Cases

A case is an observation of your own finished work, held to the same evidence
discipline as a paper. Four papers forced four specific rules.

| Taken | From | What exactly |
|---|---|---|
| Which conditions a case must declare | *Evaluating Skills, Not Just Agents* ([arXiv:2608.20614](https://arxiv.org/abs/2608.20614)) §7 | The condition set paired evaluation actually holds fixed: task, harness, model, scorer, sandbox, non-target skills. |
| Refusing the empty baseline | Same, §4.7 | A control described only as "the same work without MOZAK" conflates content with discoverability, so a control must state what it held fixed. |
| Naming residual variance | *E-Commerce Bench* ([arXiv:2608.30730](https://arxiv.org/abs/2608.30730)) §3.5.2 | A design that made determinism a goal still named the variance that survived, and which metric each source contaminated. |
| Inconclusive as a first-class state | *Harness-of-Harness* ([arXiv:2609.01481](https://arxiv.org/abs/2609.01481)) §3.4.3 | Record insufficient evidence as a gap, so absence of evidence cannot silently become evidence. |
| Independence is structural | Same | An evaluator who also performed the work is not an independent reviewer. |
| A reproduction packet, not a write-up | *Gemini in the Real World* ([arXiv:2608.26701](https://arxiv.org/abs/2608.26701)) appendix D.3 | Reviewers received logs and source rather than conclusions, so `case reproduce-packet` inverts the record for one reader. |

**Not delegated.** A research run with an explicit observation boundary and an
independent claim audit is MOZAK's own definition. The landscape review found
no reviewed project that had one.

---

## Plans

**Id** `plans` · **Files** `planning.rs` `execution.rs` `project_release.rs` `knowledge_package.rs` `attestation.rs` · **Commands** `mozak planning`, `mozak package`

Accepted inputs, the goal DAG derived from them, execution against an observed
revision, and the sealed package finished work becomes.

| Taken | From | What exactly |
|---|---|---|
| Descriptor shape | [OCI image spec](https://github.com/opencontainers/image-spec/blob/v1.1.1/manifest.md) | `mediaType`, digest and byte size on every declared artifact. |
| A tag is a pointer, never authority | [OCI distribution spec](https://github.com/opencontainers/distribution-spec/blob/main/spec.md) | Never infer latest, official or canonical from a tag, an upload time, or registry order. |
| Verifiable production provenance | [in-toto v1](https://github.com/in-toto/attestation/blob/main/spec/v1/statement.md), [SLSA](https://slsa.dev/spec/v1.2/build-provenance) | A package projects as an in-toto Statement pinning subjects by digest. Signing stays an optional layer. |
| Metadata beside a human preview | [RO-Crate 1.3](https://www.researchobject.org/ro-crate/specification/1.3/) | Machine-readable metadata sitting next to something a person can read. |
| Narrower preservation patterns | OCFL, BagIt, [W3C PROV](https://www.w3.org/TR/prov-overview/), nanopublications, [SWHID](https://docs.softwareheritage.org/devel/swh-model/persistent-identifiers.html), DataCite | Selective patterns for fixity, provenance vocabulary and persistent identifiers. |

**Not delegated.** Fixity and lineage are deliberately not delegated to
RO-Crate; MOZAK pins its own bytes. Two things were found nowhere and are
MOZAK's own: a dependency-aware goal DAG with immutable execution and
evaluation packets, and a content-addressed release with exact predecessor
lineage and monotonic accepted-state succession.

**Honest gap.** Of the standards listed in the last row, only in-toto is
implemented, in `attestation.rs`. The rest informed design and have no export
implementation.

---

## Meta KB

**Id** `meta-kb` · **Files** `kb.rs` `meta_kb.rs` `concept.rs` `package_import.rs` · **Commands** `mozak kb`, `mozak meta`, `mozak concept`

Everything that crosses projects: which Scopes are registered, how projects
relate, and which mechanisms generalise through a Concept and its Translation.

| Taken | From | What exactly |
|---|---|---|
| Cross-repo views stay read-only | [MDKG](https://github.com/nickreames/mdkg) | A view over other repositories is owned by its source, never by the viewer. |
| A catalog is a projection, never authority | [Tieline](https://github.com/knoxgraeme/tieline), [Backstage](https://backstage.io/docs/features/software-catalog/) | A Meta KB composes source releases and never becomes authority over them. |
| Lifecycle state instead of ranking | [MOOSEDev](https://github.com/Trivyn/moosedev) | Current truth is explicit lifecycle state, superseded records stay queryable, and high-stakes replacement is proposal-based and human-ratified. |
| Typed rationale relations | Same | Motivation, constraint, alternative and consequence are typed relations rather than prose. |

**Not delegated.** Bounded cross-project translation is MOZAK's own. A
Translation creates a new claim in the target while explicitly refusing to
transfer truth or execution authority, and it is invalid unless the target
re-derived every assumption the source Concept rests on.

---

## Improve Lab

**Id** `improve-lab` · **Files** `lab.rs` · **Command** `mozak lab`

An improvement question turned into reviewable plans. It never edits MOZAK.

| Taken | From | What exactly |
|---|---|---|
| Why the run stops at owner review | *On the Fragility of Self-Improving Agents* ([arXiv:2608.18066](https://arxiv.org/abs/2608.18066)) | Agent evaluation is noisy and a self-improving loop amplifies that noise; improvement depends on task order, which is a hidden prerequisite; underspecification calls for interfaces enabling human oversight. Stopping at owner review is that interface. |
| An explicit non-executor boundary | [MDKG](https://github.com/nickreames/mdkg) | No automatic agent work and no cross-repo mutation. |

**Honest gap.** `lab.rs` records the limitations of its own justification,
including that the paper's claims were read from the abstract rather than the
full text.

---

## Skill

**Id** `skill` · **Files** `distribution.rs` `skills/mozak/SKILL.md` · **Commands** `mozak setup`, `mozak doctor`

Which request maps to which route, the shape the answer takes, and
installation. Embedded in the binary and hash-pinned.

| Taken | From | What exactly |
|---|---|---|
| Output shape rules | [i-have-adhd](https://github.com/ayghri/i-have-adhd) | Lead with the action, number the steps, restate state, cap the list, no preamble. Adapted in turn from *The Adult ADHD Tool Kit* by Ramsay and Rostain. |

MOZAK output is read mid-task by someone deciding what to do next, with little
working memory to spare. Correct but unreadable output fails at the only moment
that matters. The five rules, in priority order:

1. Lead with the action or the finding, not with what you are about to do.
2. Number any sequence the reader must perform in order.
3. Restate where the work stands every turn.
4. End with one concrete next step.
5. Cap a list at five items, then split into do-now and later.

Also required: concrete estimates in minutes or steps, failures reported as
cause then fix, one thing finished before the next is raised, and no preamble
or closing pleasantry. Verify your installed copy with
`mozak setup check "$HOME"`, which reports drift rather than overwriting it.

The managed skill payload also ships a versioned companion recommendation
manifest. `termaid` stays required for graph rendering. `mmdr`, the ADHD skill,
an exact Caveman skill when present, and installed drawing-family skills are
reported as recommended companions only. `setup` and `doctor` report missing
recommended companions without installing external tools or changing setup
parity.

---

The flow diagram, why each thing sits where it does, and how a module absorbs
new work are in [ARCHITECTURE.md](ARCHITECTURE.md). Exact routes are in
[REFERENCE.md](REFERENCE.md).

Evidence for every claim above: `.mozak/research/runs/2026-09-02-mozak-landscape/`
and `.mozak/research/runs/2026-09-04-git-native-framing/`. That review covered a
bounded set of projects at a fixed date, so each "found nowhere" is relative to
what was reviewed.
