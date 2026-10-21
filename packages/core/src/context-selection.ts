// Pure presentation transform. Full context remains the canonical recovery DTO.
import type { contextView } from "./review.ts";
import { DomainError } from "./errors.ts";

type Context = ReturnType<typeof contextView>;

export function selectContext(context: Context, brief: boolean, planId?: string) {
  const plans = planId === undefined ? context.plans : context.plans.filter(plan => plan.id === planId);
  if (planId !== undefined && plans.length === 0) {
    throw new DomainError("plan-not-found", `no plan "${planId}" in scope "${context.scopeId}"; run mozak plans (MCP mozak_plans) to list the plan ids`, 2);
  }
  const selected = planId === undefined ? context : {
    ...context, plans, implementationAuthorized: plans.some(plan => plan.implementationAuthorized),
  };
  if (!brief) return selected;
  return {
    scope: { id: context.scope.id, kind: context.scope.kind, title: context.scope.title },
    scopeId: context.scopeId,
    implementationAuthorized: selected.implementationAuthorized,
    brief: true,
    plans: plans.map(plan => {
      const { bounds: _bounds, ...handoff } = plan.handoff;
      return {
        planId: plan.id,
        title: plan.accepted?.content.title ?? plan.pending?.content.title,
        lifecycle: plan.lifecycle,
        accepted: plan.accepted ? { id: plan.accepted.id } : null,
        pending: plan.pending ? { id: plan.pending.id, reviewState: plan.pending.reviewState } : null,
        handoff: { ...handoff, boundsOmitted: true },
        discussionStatus: plan.discussionStatus,
        reviewNeeded: plan.reviewNeeded,
        permittedNextAction: plan.permittedNextAction,
      };
    }),
  };
}
