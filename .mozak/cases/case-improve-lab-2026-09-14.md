# Case study: running the Self Improvement Lab

**Date:** 14 September 2026 · **Scope:** `topic-agentic-systems` · **Record:** `.mozak/cases/case-improve-lab-2026-09-14.json`

---

## What happened, in one line

We ran MOZAK's Self Improvement Lab against HyperResearch, got 3 reviewable plan cards, then built the integration those plans pointed at.

---

## The numbers

| | |
|---|---|
| Evidence records gathered | **73** |
| Records actually read | **1** |
| Mechanisms proposed | **5** |
| Plan cards produced | **3** |
| Real defects found | **3** |
| Commits | **11** |
| Sources blocked, then recovered | **1** |

---

## What we did, in order

1. **Ran three adapters.** DAIR.AI returned 20 curated papers, GitHub watch returned 12 repos, GitHub discovery returned 40. arXiv returned nothing: HTTP 429, six times.
2. **Opened a Lab run** on the `improve-lab` module, scoped to HyperResearch because you pointed at it.
3. **Read one source** at documentation depth. The Lab refused to accept an abstract-only reading, so a real read was the only option.
4. **Got 5 mechanisms and 3 plan cards**, each with at least two acceptance checks.
5. **Built the adapter** those plans implied, then swept the whole result and found three defects.

---

## What actually worked

**The abstract-only gate changed behaviour.** It refused to let a mechanism rest on a summary. That is the difference between citing a claim and citing a claim's advertisement.

**Every exclusion carried a written reason.** Eleven candidates were dropped, and each has a sentence saying why. The narrowness is visible in the record instead of hidden by it.

**A blocked paper became a citable one.** Oxford's bot wall stopped the QUAST fetch. Open-access recovery pulled 4,051 words of the published version through Unpaywall and disclosed the substitution in four places.

**arXiv failed honestly.** Six attempts, all 429, no run written. No half-artifact entered the evidence store pretending to be a survey.

---

## What went wrong

**Three defects survived until the final sweep.**

1. A failed snapshot left a directory behind that blocked every retry.
2. The installer reported KB drift as "unregistered Scope", sending you to fix the wrong thing.
3. A new-scope install died mid-way and left partial state.

All three were caught **after** the work looked finished, not while writing it. All three are now fixed with regression tests.

**I broke two working bindings.** Retargeting adapter requests moved them to `needs_recheck`. The contract refused the Scope change by design. Restored from git, pins verified byte-identical.

**The test harness cried wolf twelve times.** `set -o pipefail` treated expected non-zero exits as failures. Every false alarm had to be reproduced in isolation before it could be dismissed.

---

## What this case does not show

Read this part before citing anything above.

- **Nothing was implemented from the plan cards.** Five mechanisms, zero adopted.
- **No comparison was run.** Whether MOZAK helped is untested. There is no control.
- **Self-review only.** The same agent did the work and judged it.
- **One source, and a self-interested one.** HyperResearch's own README, whose headline benchmark is explicitly internally projected and awaiting third-party validation.
- **Mutation testing was not done**, so a passing suite says nothing about whether the checks would catch an injected defect.

---

## What to do next

1. **Read the backlog.** 72 records were gathered and never opened. Two are directly on-topic: *Harness-of-Harness* (multi-day autonomous development with continual improvement) and *Judges as a Lifecycle*.
2. **Implement P1**, multi-source refresh, so one question can draw on DAIR.AI, arXiv, and GitHub together instead of one at a time.
3. **Sweep earlier.** Every real defect was caught by the whole-result sweep. Run it when work first looks done, not after reporting it done.
4. **Fetch by DOI, not publisher URL.** A bot wall then routes into open-access recovery instead of just failing.

---

## Provenance

- **Baseline:** `391c088` → **Final:** `b9bf981`
- **Case hash:** `aecf5dbfb06fc0546bf83e0375f2ade710e748c053b225c11598ad5f0f7acfcc`
- **Verify:** `mozak case validate .mozak/cases/case-improve-lab-2026-09-14.json`
- **Reproduce:** `mozak case reproduce-packet .mozak/cases/case-improve-lab-2026-09-14.json`

Every proposal here is `proposal_only`. Recording a case accepts nothing.
