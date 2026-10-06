---
name: mozak-sequence-commitment
description: Preserve the full owner-approved scope of sequences, plans, batches, phases, checklists and equivalent work commitments. Prevent premature stopping, silent deferral and milestone substitution.
---

# Owner-approved work must reach its agreed finish

## Trigger and authority

Apply this contract semantically whenever the owner authorizes a sequence, plan, roadmap, batch, phases, steps, checklist, work package, workflow, or equivalent request such as "do all", "finish these", "start that sequence and finish it", or "continue the agreed work". Synonyms and misspellings do not change the obligation. Asking what comes next or discussing a plan alone is NOT execution authorization. Higher-priority safety instructions and an explicit owner stop always win.

## Capture and retain the commitment

Before execution, record the owner's request/reference, the complete original requirement IDs, acceptance checks, dependencies, exclusions, authorized actions and genuine approval boundaries. Maintain a stable parent goal and todos. Persist the contract and checkpoints in the registered project's `.mozak/evidence/<commitment-id>/` (or the resolved Scope's appropriate evidence location). These are operational records, not approval artifacts. Never rewrite an accepted plan, approval, index or historical evidence to fit new work.

On resume, compaction or delegation, recover the original commitment first. Give workers their slice AND the parent acceptance boundary. A worker completion is not parent completion.

## Continue, do not silently rescope

- Keep every original requirement visible until verified or explicitly removed by the owner. Only the owner can authorize a successor scope. Preserve the predecessor contract and the exact change request.
- Do not replace the agreed finish with a passing milestone, candidate, smoke test, partial backend, narrower goal or new todo group. Do not mark cancelled, deferred or removed work as completed to clear reminders or improve goal assessments.
- Missing implementation, internal defects, compiler errors, failing tests and packaging bugs are work to finish, not external blockers. Fix them and continue.
- A blocker on one branch does not stop other authorized, safe, ready branches. Approval for package acquisition, payment, publishing or another sensitive action blocks only that exact action and dependents, not already-authorized implementation or verification.
- Do not ask the owner to approve the same authorized work again. Ask only for a genuinely new decision or boundary that cannot safely be resolved within the agreement.
- Short status messages do not imply short execution scope. Keep working after a progress update.

## Evidence and final stop gate

Map EACH original requirement and changed public output to concrete observed acceptance checks. Exercise the real project's public interfaces, end-user workflow and relevant installation/packaging boundaries, plus hostile and failure cases. Run broad checks over the final coherent source, not only earlier slices. Inspection, synthetic fixtures, unit tests and aggregate counts are useful but cannot substitute for a required real acceptance path. An engineering candidate is not an accepted public backend.

Before stopping, audit the entire original scope:
1. Is any required implementation or locally fixable failure left?
2. Is any safe authorized branch ready despite another blocker?
3. Does every acceptance check have current, appropriately direct evidence?
4. Were any requirements hidden by cancellation, deferral, renaming or milestone substitution?
5. Are source, installed artifact and observed result the same verified revision where required?

If any answer prevents completion, continue the work. A completion claim requires every original requirement verified, or an explicit owner-approved successor scope whose own requirements are all verified.

A pause is justified only by an explicit owner stop/rescope, a genuine external dependency blocking ALL remaining authorized work, a safety/resource boundary, or a forced session interruption. Report an INCOMPLETE checkpoint, exact affected requirements, actual blocker, work still authorized, evidence collected and an actionable resume path. Leave unfinished todos open. Never present a forced final response or a harness timeout as successful completion.

## Read-only closure audit

Run `python3 scripts/check_sequence.py CONTRACT.json CHECKPOINT.json` from this skill before claiming completion. Contract schema: `{ "sequence_id": "...", "requirements": [{"id":"...", "checks":[{"id":"...", "real_required":true}]}] }`. Checkpoint schema: `{ "sequence_id":"...", "contract_sha256":"<exact contract bytes hash>", "requirements":[{"id":"...", "status":"verified|pending|in_progress|blocked", "checks":[{"id":"...", "passed":true, "observation":"real|synthetic|inspection", "evidence":"nonempty observation reference"}]}] }`.

The checker refuses lost scope, cancelled/deferred statuses, contract drift, missing/failed checks and synthetic substitutes for required real observations. It audits declared records only. It cannot authenticate an owner's decision, prove evidence is truthful, replace MOZAK approval gates, enforce execution in the CLI, or guarantee that an agent obeys this policy. A checker pass alone is not acceptance evidence. If unavailable, perform and record the same whole-scope audit manually rather than silently omitting it.

## Regression that must not recur

An owner approves five steps. Two candidate steps pass, authenticated import and a nontrivial comparison are still unimplemented, and package staging awaits approval. The sequence remains incomplete. Continue import/comparison implementation and all safe verification. Do not cancel those steps, stop at the candidate, or use the staging approval to block the entire sequence.
