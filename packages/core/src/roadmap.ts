// Display-only roadmap over a plan's outcomes. Pure: reads state, never writes.
// Order is the outcome array order. Status follows the same evidence rules as `plan complete`.
import { outcomeStatus, type OutcomeStatus } from "./review.ts";
import type { Plan, ScopeState } from "./understanding.ts";

export interface RoadmapStop {
  id: string;
  statement: string;
  acceptance: "owner" | "objective";
  criterion: string;
  status: OutcomeStatus;
  /** The first stop in array order that is not done. At most one per roadmap. */
  current: boolean;
}
export interface Roadmap { stops: RoadmapStop[]; done: number; total: number; }

/** Null when the plan has no accepted revision yet: nothing is authorized, so there is no progress to show. */
export function planRoadmap(state: ScopeState, plan: Plan): Roadmap | null {
  if (!plan.accepted) return null;
  const stops: RoadmapStop[] = plan.accepted.content.outcomes.map((o) => ({
    id: o.id,
    statement: o.statement,
    acceptance: o.acceptance,
    criterion: o.criterion,
    status: outcomeStatus(state, plan, o.id),
    current: false,
  }));
  if (plan.lifecycle.state !== "completed") {
    const next = stops.find((s) => s.status !== "done");
    if (next) next.current = true;
  }
  const done = stops.filter((s) => s.status === "done").length;
  return { stops, done, total: stops.length };
}
