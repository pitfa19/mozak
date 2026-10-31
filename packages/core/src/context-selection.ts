// Pure presentation transform. Full context remains the canonical recovery DTO.
import type { contextView } from "./review.ts";
import { DomainError } from "./errors.ts";

type Context = ReturnType<typeof contextView>;
type ContextPlan = Context["plans"][number];
const BRIEF_BYTES = 6000;
const HISTORY_LIMIT = 2;
const isHistory = (plan: ContextPlan) => plan.lifecycle.state === "completed" &&
  !plan.pending && !plan.reviewNeeded;
const priority = (plan: ContextPlan) => isHistory(plan) ? 4 : plan.handoff.executionEligible ? 0 :
  plan.handoff.implementationAuthorized ? 1 : plan.pending || plan.reviewNeeded ? 2 : 3;

// Bound display text at code-point boundaries; report removed source bytes, not JSON bytes.
function briefTitle(title: string | undefined) {
  if (title === undefined || Buffer.byteLength(title) <= 160) return { title };
  let prefix = "";
  let bytes = 0;
  for (const char of title) {
    const size = Buffer.byteLength(char);
    if (bytes + size > 160) break;
    prefix += char; bytes += size;
  }
  return { title: `${prefix}…`, titleOmittedBytes: Buffer.byteLength(title) - bytes };
}

function planBrief(plan: ContextPlan) {
  const { bounds: _bounds, ...handoff } = plan.handoff;
  return {
    planId: plan.id,
    ...briefTitle(plan.accepted?.content.title ?? plan.pending?.content.title),
    lifecycle: plan.lifecycle,
    accepted: plan.accepted ? { id: plan.accepted.id } : null,
    pending: plan.pending ? { id: plan.pending.id, reviewState: plan.pending.reviewState } : null,
    handoff: { ...handoff, boundsOmitted: true },
    discussionStatus: plan.discussionStatus,
    reviewNeeded: plan.reviewNeeded,
    permittedNextAction: plan.permittedNextAction,
  };
}

export function selectContext(context: Context, brief: boolean, planId?: string) {
  const plans = planId === undefined ? context.plans : context.plans.filter(plan => plan.id === planId);
  if (planId !== undefined && plans.length === 0) {
    throw new DomainError("plan-not-found", `no plan "${planId}" in scope "${context.scopeId}"; run mozak plans (MCP mozak_plans) to list the plan ids`, 2);
  }
  const selected = planId === undefined ? context : {
    ...context, plans, implementationAuthorized: plans.some(plan => plan.implementationAuthorized),
  };
  if (!brief) return selected;
  const history = plans.filter(isHistory).length;
  const nextActions: Record<string, { total: number; included: number; omitted: number }> = {};
  for (const action of [...new Set(plans.map(plan => plan.permittedNextAction))].sort()) {
    const total = plans.filter(plan => plan.permittedNextAction === action).length;
    nextActions[action] = { total, included: 0, omitted: total };
  }
  const result = {
    scope: { id: context.scope.id, kind: context.scope.kind, ...briefTitle(context.scope.title) },
    scopeId: context.scopeId,
    implementationAuthorized: selected.implementationAuthorized,
    brief: true,
    summary: {
      total: plans.length,
      active: { total: plans.length - history, included: 0, omitted: plans.length - history },
      history: { total: history, included: 0, omitted: history },
      nextActions,
      authorization: {
        implementationAuthorized: plans.filter(plan => plan.handoff.implementationAuthorized).length,
        executionEligible: plans.filter(plan => plan.handoff.executionEligible).length,
      },
    },
    followUp: {
      plans: "mozak plans --config INVENTORY --scope SCOPE_ID --json",
      plan: "mozak context --config INVENTORY --scope SCOPE_ID --plan PLAN_ID --json",
      notice: "Replace placeholders with the same inventory/scope and an exact plan ID. Omitted plans are not absent. Read the full plan and bounds before execution; a read grants no approval.",
    },
    plans: [] as ReturnType<typeof planBrief>[],
  };
  // Prefer actionable work, then stable ID order. Completed history never crowds it out.
  for (const plan of [...plans].sort((a, b) => priority(a) - priority(b) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))) {
    const group = isHistory(plan) ? result.summary.history : result.summary.active;
    if (isHistory(plan) && group.included >= HISTORY_LIMIT) continue;
    const action = nextActions[plan.permittedNextAction]!;
    result.plans.push(planBrief(plan));
    group.included++; group.omitted--;
    action.included++; action.omitted--;
    // Match the CLI/MCP's pretty JSON nesting; never slice serialized JSON or IDs.
    if (Buffer.byteLength(JSON.stringify({ context: result }, null, 2)) > BRIEF_BYTES) {
      result.plans.pop(); group.included--; group.omitted++;
      action.included--; action.omitted++;
    }
  }
  return result;
}
