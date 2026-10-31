import { DomainError } from "./errors.ts";
import { outcomeStatus } from "./review.ts";
import type { Observation, Plan, Receipt, ReasoningLink, ScopeState } from "./understanding.ts";

/**
 * Read-set rebase (S1b), used only when `concurrency.rebase` is on in mozak-settings.json.
 *
 * A write whose `expected` snapshot is stale may still commit when every write since that snapshot commutes
 * with it. Only appends are rebased: observe, save-discussion and propose of a new plan. Everything else,
 * including every owner decision, revise, complete and attach-spec, keeps the exact snapshot check.
 *
 * The writes since the snapshot are found through receipts: the snapshot revision must be the current revision
 * or the storageRevision of a retained receipt, and the later receipts are those recorded after it. The state
 * at the snapshot is reconstructed by removing what those appends added. Receipt order comes from recordedAt,
 * so a write merged by git from a host whose clock lags can be missed. As a guard, any non-rebasable receipt
 * recorded up to REBASE_GUARD_MS before the snapshot's receipt also refuses the rebase.
 */
export const REBASABLE_ACTIONS: ReadonlySet<string> = new Set(["observe", "save-discussion", "propose"]);
export const REBASE_GUARD_MS = 1000;

export interface Rebased { from: string; onto: string }
interface Snap { revision: string; graphHash: string }

function refuse(why: string): never {
  throw new DomainError("stale-input", `snapshot changed and rebase was refused: ${why}; reread before submitting a new operation`, 3);
}

const key = (planId: string, id: string) => JSON.stringify([planId, id]);

/** Throws stale-input unless the request's read set is unchanged between `expected` and the fresh state. */
export function checkRebase(fresh: ScopeState, current: Snap, expected: Snap, action: string, payload: Record<string, unknown>, guardMs = REBASE_GUARD_MS): Rebased {
  if (!REBASABLE_ACTIONS.has(action)) refuse(`${action} is never rebased`);
  const receipts = Object.values(fresh.receipts);
  let later: Receipt[] = [];
  if (expected.revision === current.revision) {
    // Same revision with other graph bytes is a hand edit: what changed is unknown.
    if (expected.graphHash !== current.graphHash) refuse("mozak.json changed without a new revision");
  } else {
    const base = receipts.find(r => r.storageRevision === expected.revision);
    if (!base) refuse("the snapshot revision is neither current nor a retained receipt");
    const at = Date.parse(base.recordedAt);
    later = receipts.filter(r => r !== base && Date.parse(r.recordedAt) >= at);
    const head = receipts.find(r => r.storageRevision === current.revision);
    if (!head || !later.includes(head)) refuse("the writes since the snapshot cannot be ordered");
    const blocking = receipts.find(r => r !== base && Date.parse(r.recordedAt) >= at - guardMs && !REBASABLE_ACTIONS.has(r.result.action));
    if (blocking) refuse(`an intervening ${blocking.result.action} does not commute`);
  }
  const before = structuredClone(fresh);
  const added = new Set<string>(); // plan, observation or link added since the snapshot
  const addedPlans = new Set<string>();
  const superseded = new Set<string>(); // plan, observation superseded since the snapshot
  const discussions = new Set<string>();
  for (const r of later) {
    const [first, ...rest] = r.result.ids;
    if (r.result.action === "propose") {
      before.plans = before.plans.filter(p => !(p.id === first && p.createdAt === r.recordedAt));
      addedPlans.add(first!);
    } else if (r.result.action === "observe") {
      for (const plan of before.plans) {
        const hit = plan.observations.filter(o => o.id === first && o.recordedAt === r.recordedAt);
        if (!hit.length) continue;
        for (const o of hit) {
          added.add(key(plan.id, o.id));
          if (o.supersedesObservationId !== undefined) superseded.add(key(plan.id, o.supersedesObservationId));
        }
        plan.observations = plan.observations.filter(o => !hit.includes(o));
        const links = new Set(rest);
        for (const l of plan.reasoningLinks) if (links.has(l.id)) added.add(key(plan.id, l.id));
        plan.reasoningLinks = plan.reasoningLinks.filter(l => !links.has(l.id));
      }
    } else {
      discussions.add(first!);
      if (r.result.discussion) discussions.add(r.result.discussion.id);
    }
  }
  const planId = payload.planId as string;
  const freshPlan = fresh.plans.find(p => p.id === planId);
  const oldPlan = before.plans.find(p => p.id === planId);
  if (action === "propose") {
    if (addedPlans.has(planId) && freshPlan) refuse(`plan id "${planId}" was taken since the snapshot`);
    return { from: expected.revision, onto: current.revision };
  }
  if (!freshPlan || !oldPlan) refuse(`plan "${planId}" changed since the snapshot`);
  if (action === "save-discussion") {
    if (freshPlan.discussion && discussions.has(freshPlan.discussion.id)) refuse(`the discussion of "${planId}" was saved since the snapshot`);
    return { from: expected.revision, onto: current.revision };
  }
  const observation = payload.observation as Observation;
  const links = (payload.reasoningLinks as ReasoningLink[] | undefined) ?? [];
  if (added.has(key(planId, observation.id))) refuse(`observation id "${observation.id}" was used since the snapshot`);
  for (const l of links) if (added.has(key(planId, l.id))) refuse(`reasoning link id "${l.id}" was used since the snapshot`);
  if (observation.supersedesObservationId !== undefined && superseded.has(key(planId, observation.supersedesObservationId))) {
    refuse(`observation "${observation.supersedesObservationId}" was superseded since the snapshot`);
  }
  for (const l of links) {
    if (added.has(key(l.from.planId, l.from.id))) refuse(`link source "${l.from.id}" was added since the snapshot`);
    if (superseded.has(key(l.from.planId, l.from.id))) refuse(`link source "${l.from.id}" was superseded since the snapshot`);
    const now = fresh.plans.find(p => p.id === l.to.planId);
    const then = before.plans.find(p => p.id === l.to.planId);
    if (!now || !then || revisions(now) !== revisions(then)) refuse(`plan "${l.to.planId}" changed revision since the snapshot`);
    if (outcomeStatus(fresh, now, l.to.id) !== outcomeStatus(before, then, l.to.id)) refuse(`outcome "${l.to.id}" changed status since the snapshot`);
  }
  return { from: expected.revision, onto: current.revision };
}

function revisions(plan: Plan): string {
  return JSON.stringify([plan.accepted?.id ?? null, plan.pending?.id ?? null, plan.lifecycle.state]);
}
