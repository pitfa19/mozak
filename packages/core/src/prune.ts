// S2 `plan prune --rejected`: remove owner-rejected plans from mozak.json. The prune record is the operation's
// receipt, `{ action: "prune-rejected", ids }`. Receipts are never pruned and a 0.4.0 client already accepts any
// receipt action, so the record needs no new key in mozak.json. Refs to a pruned id resolve through it, and the id
// cannot be proposed again.

import { DomainError } from "./errors.ts";
import { validateScope, type ScopeState } from "./understanding.ts";

export const PRUNE_ACTION = "prune-rejected";

export interface PruneRecord { operationId: string; recordedAt: string }

/** The receipt that pruned `planId`, or null. */
export function prunedRecord(state: ScopeState, planId: string): PruneRecord | null {
  for (const [operationId, r] of Object.entries(state.receipts)) {
    if (r.result.action === PRUNE_ACTION && r.result.ids.includes(planId)) return { operationId, recordedAt: r.recordedAt };
  }
  return null;
}

/** A plan the owner rejected outright: it was never accepted and its only revision is rejected. */
export function isRejectedPlan(state: ScopeState, planId: string): boolean {
  const p = state.plans.find((x) => x.id === planId);
  return !!p && !p.accepted && p.pending?.reviewState === "rejected";
}

export function rejectedPlanIds(state: ScopeState): string[] {
  return state.plans.filter((p) => isRejectedPlan(state, p.id)).map((p) => p.id).sort();
}

/**
 * Pure: a copy of `state` without the named plans. Refuses a plan that is not rejected, and a plan that another
 * plan still references (a merge, a reasoning link): removing it would make mozak.json invalid.
 */
export function withoutPlans(state: ScopeState, planIds: string[]): ScopeState {
  if (!planIds.length) throw new DomainError("invalid-input", "name at least one rejected plan to prune", 2);
  if (new Set(planIds).size !== planIds.length) throw new DomainError("invalid-input", "planIds must be unique", 2);
  for (const id of planIds) {
    if (!state.plans.some((p) => p.id === id)) throw new DomainError("stale-reference", `plan "${id}" is not in this scope`, 3);
    if (!isRejectedPlan(state, id)) throw new DomainError("prune-not-rejected", `plan "${id}" is not a rejected plan; only rejected plans can be pruned`, 3);
  }
  const drop = new Set(planIds);
  const next = structuredClone(state);
  next.plans = next.plans.filter((p) => !drop.has(p.id));
  try { validateScope(next); }
  catch (e) {
    if (!(e instanceof DomainError)) throw e;
    // Name the plan that is still referenced, so the owner can leave it out.
    const blocking = planIds.filter((id) => { const one = structuredClone(state); one.plans = one.plans.filter((p) => p.id !== id); try { validateScope(one); return false; } catch { return true; } });
    throw new DomainError("prune-referenced", `${blocking.length ? `plan ${blocking.join(", ")}` : "the selection"} is still referenced by another plan (${e.message}); leave it out`, 3);
  }
  return next;
}
