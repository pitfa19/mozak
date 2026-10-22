// `plan delete`: the owner removes plans from a scope's mozak.json so they no longer exist as plans.
// The record of the deletion is the operation's receipt `{ action: "delete-plans", ids }`. Receipts are kept, so
// the deletion stays auditable in mozak.json and in git history, and a deleted id cannot be silently re-used:
// `propose` of that id is refused (see isDeletedPlanId). A merge (`approve-direction` with mergeFromPlanId) already
// removes the source plan. `delete` covers every other case: a superseded plan, a duplicate in another scope, a
// draft the owner no longer wants. Completed plans are protected unless the owner passes `allowCompleted`.

import { DomainError } from "./errors.ts";
import { validateScope, type ScopeState } from "./understanding.ts";

export const DELETE_ACTION = "delete-plans";

export interface DeleteRecord { operationId: string; recordedAt: string }

/** The receipt that deleted `planId`, or null. */
export function deletedRecord(state: ScopeState, planId: string): DeleteRecord | null {
  for (const [operationId, r] of Object.entries(state.receipts)) {
    if (r.result.action === DELETE_ACTION && r.result.ids.includes(planId)) return { operationId, recordedAt: r.recordedAt };
  }
  return null;
}

export const isDeletedPlanId = (state: ScopeState, planId: string): boolean => deletedRecord(state, planId) !== null;

/** Plans in `state` that still point at `planId` through a reasoning link or a pending merge. */
function referencesTo(state: ScopeState, planId: string, dropping: Set<string>): string[] {
  const out = new Set<string>();
  for (const p of state.plans) {
    if (dropping.has(p.id)) continue;
    if (p.pending?.mergeFromPlanId === planId) out.add(`${p.id} (pending merge)`);
    for (const link of p.reasoningLinks) {
      if (link.from.planId === planId || link.to.planId === planId) out.add(`${p.id} (reasoning link ${link.id})`);
    }
  }
  return [...out].sort();
}

/**
 * Pure: a copy of `state` without the named plans. Refuses unknown ids, completed plans (unless allowed), and plans
 * that another remaining plan still references, because removing them would make mozak.json invalid. Delete the
 * referencing plan too, or merge instead.
 */
export function withoutPlans(state: ScopeState, planIds: string[], allowCompleted = false): ScopeState {
  if (!planIds.length) throw new DomainError("invalid-input", "name at least one plan to delete", 2);
  if (new Set(planIds).size !== planIds.length) throw new DomainError("invalid-input", "planIds must be unique", 2);
  const drop = new Set(planIds);
  for (const id of planIds) {
    const plan = state.plans.find((p) => p.id === id);
    if (!plan) throw new DomainError("stale-reference", `plan "${id}" is not in this scope`, 3);
    if (plan.lifecycle.state === "completed" && !allowCompleted) {
      throw new DomainError("delete-completed", `plan "${id}" is completed; pass allowCompleted: true to delete a completed plan`, 3);
    }
    const refs = referencesTo(state, id, drop);
    if (refs.length) throw new DomainError("delete-referenced", `plan "${id}" is still referenced by ${refs.join(", ")}; delete those too or merge instead`, 3);
  }
  const next = structuredClone(state);
  next.plans = next.plans.filter((p) => !drop.has(p.id));
  validateScope(next);
  return next;
}
