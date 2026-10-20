// Cross-plan views over owner annotations: graph, ready and check findings. Pure: callers pass a Universe that
// loads scope states and sidecars read-only. `needs` is advisory: it orders and explains, it never refuses a write.

import { planContent, resolveRef, type AnnotationsDoc, type PlanRef, type RefResolution, type ScopeLookup } from "./annotations.ts";
import { effectiveDeadline, planDeadline, today, type PlanDeadline } from "./deadlines.ts";
import { planDisplayState, type PlanDisplayState } from "./bridge.ts";
import { contextView, outcomeStatus } from "./review.ts";
import type { Plan, ScopeState } from "./understanding.ts";

export interface Universe {
  state: ScopeLookup;
  annotations(scopeId: string): AnnotationsDoc | null;
}

const key = (scope: string, planId: string) => `${scope}/${planId}`;
const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

function planOf(u: Universe, scope: string, planId: string): Plan | null {
  const s = u.state(scope);
  return typeof s === "object" ? s.plans.find((p) => p.id === planId) ?? null : null;
}
const isRejected = (p: Plan) => !p.accepted && p.pending?.reviewState === "rejected";
const isCompleted = (p: Plan) => p.lifecycle.state === "completed";
const isOpen = (p: Plan) => !!p.accepted && (p.lifecycle.state === "open" || p.lifecycle.state === "paused");

export interface Edge {
  id: string;
  from: string;
  fromOutcome?: string;
  target: string;
  relation: PlanRef["relation"];
  evidence: string;
  resolution: RefResolution;
  /** scope/plan the target resolves to, or null when it does not resolve. */
  to: string | null;
}

/** Every ref of the given scopes as an edge with its resolution. */
export function edgesOf(u: Universe, scopeIds: string[]): Edge[] {
  const edges: Edge[] = [];
  for (const scope of scopeIds) {
    const doc = u.annotations(scope);
    if (!doc) continue;
    for (const planId of Object.keys(doc.plans).sort()) {
      for (const ref of doc.plans[planId]!.refs) {
        const resolution = resolveRef(ref.target, u.state);
        edges.push({
          id: ref.id, from: key(scope, planId), ...(ref.fromOutcome !== undefined ? { fromOutcome: ref.fromOutcome } : {}),
          target: ref.target, relation: ref.relation, evidence: ref.evidence, resolution,
          to: resolution.status === "resolved" ? key(resolution.scope, resolution.planId) : null,
        });
      }
    }
  }
  return edges;
}

export interface RefGraphNode { id: string; scope: string; planId: string; title: string; state: PlanDisplayState; deadline: PlanDeadline }
export interface RefGraphView { nodes: RefGraphNode[]; edges: Edge[]; counts: { nodes: number; edges: number; dangling: number; unavailable: number } }

/** Plans of the selected scopes plus every plan they reference, and all refs between them. */
export function graphView(u: Universe, scopeIds: string[], day = today()): RefGraphView {
  const edges = edgesOf(u, scopeIds);
  const ids = new Set<string>();
  for (const scope of scopeIds) {
    const s = u.state(scope);
    if (typeof s === "object") for (const p of s.plans) ids.add(key(scope, p.id));
  }
  for (const e of edges) if (e.to) ids.add(e.to);
  const nodes: RefGraphNode[] = [];
  for (const id of [...ids].sort(cmp)) {
    const slash = id.indexOf("/");
    const scope = id.slice(0, slash), planId = id.slice(slash + 1);
    const s = u.state(scope);
    const plan = planOf(u, scope, planId);
    if (!plan || typeof s !== "object") continue;
    nodes.push({ id, scope, planId, title: planContent(plan)?.title ?? planId, state: planDisplayState(plan), deadline: planDeadline(s, plan, u.annotations(scope), day) });
  }
  return {
    nodes, edges,
    counts: { nodes: nodes.length, edges: edges.length, dangling: edges.filter((e) => e.resolution.status === "dangling").length, unavailable: edges.filter((e) => e.resolution.status === "unavailable").length },
  };
}

/** Why a `needs` edge is not yet satisfied, or null when it is. */
export function needUnmet(u: Universe, e: Edge): string | null {
  const r = e.resolution;
  if (r.status === "dangling") return `dangling (${r.reason})`;
  if (r.status === "unavailable") return "target scope unavailable";
  if (r.status === "pruned") return "target rejected and pruned";
  const state = u.state(r.scope);
  const plan = planOf(u, r.scope, r.planId);
  if (!plan || typeof state !== "object") return "target missing";
  if (isRejected(plan)) return "target rejected";
  if (r.outcomeId !== undefined) return outcomeStatus(state, plan, r.outcomeId) === "done" ? null : `outcome ${r.outcomeId} not done`;
  return isCompleted(plan) ? null : `plan ${planDisplayState(plan)}`;
}

function currentStop(state: ScopeState, plan: Plan): string | null {
  if (!plan.accepted || isCompleted(plan)) return null;
  return plan.accepted.content.outcomes.find((o) => outcomeStatus(state, plan, o.id) !== "done")?.id ?? null;
}

export interface ReadyRow { scope: string; planId: string; title: string; deadline: string | null; deadlineStatus: PlanDeadline["status"]; neededBy: number; needs: { target: string; satisfied: boolean; reason?: string; fromOutcome?: string }[] }
export interface ReadyView {
  ready: ReadyRow[];
  blocked: ReadyRow[];
  superseded: { scope: string; planId: string; by: string[] }[];
}

/**
 * Open (not paused) accepted plans of the selected scopes. A plan is blocked while a plan-level `needs` is unmet, or
 * while a `needs` from its current outcome is unmet. Needs from later outcomes are listed but do not block yet.
 * Plans superseded by a plan that is not rejected are listed apart. Ready plans sort by deadline (owner or
 * inferred, earliest first, none last), then by how many plans need them, then by id.
 */
export function readyView(u: Universe, scopeIds: string[], day = today()): ReadyView {
  const edges = edgesOf(u, scopeIds);
  const supersededBy = new Map<string, string[]>();
  for (const e of edges) {
    if (e.relation !== "supersedes" || !e.to) continue;
    const slash = e.from.indexOf("/");
    const from = planOf(u, e.from.slice(0, slash), e.from.slice(slash + 1));
    if (!from || isRejected(from)) continue;
    supersededBy.set(e.to, [...(supersededBy.get(e.to) ?? []), e.from]);
  }
  const neededBy = new Map<string, number>();
  for (const e of edges) if (e.relation === "needs" && e.to) neededBy.set(e.to, (neededBy.get(e.to) ?? 0) + 1);
  const ready: ReadyRow[] = [], blocked: ReadyRow[] = [];
  const superseded: ReadyView["superseded"] = [];
  for (const scope of scopeIds) {
    const state = u.state(scope);
    if (typeof state !== "object") continue;
    const doc = u.annotations(scope);
    for (const plan of state.plans) {
      if (!plan.accepted || plan.lifecycle.state !== "open") continue;
      const id = key(scope, plan.id);
      if (supersededBy.has(id)) { superseded.push({ scope, planId: plan.id, by: supersededBy.get(id)!.sort(cmp) }); continue; }
      const stop = currentStop(state, plan);
      const needs: ReadyRow["needs"] = [];
      let isBlocked = false;
      for (const e of edges) {
        if (e.from !== id || e.relation !== "needs") continue;
        const reason = needUnmet(u, e);
        const blocking = reason !== null && (e.fromOutcome === undefined || e.fromOutcome === stop);
        if (blocking) isBlocked = true;
        needs.push({ target: e.target, satisfied: reason === null, ...(reason ? { reason: blocking ? reason : `${reason}; not blocking until outcome ${e.fromOutcome} is current` } : {}), ...(e.fromOutcome !== undefined ? { fromOutcome: e.fromOutcome } : {}) });
      }
      const d = planDeadline(state, plan, doc, day);
      const row: ReadyRow = { scope, planId: plan.id, title: plan.accepted.content.title, deadline: effectiveDeadline(d), deadlineStatus: d.status, neededBy: neededBy.get(id) ?? 0, needs };
      (isBlocked ? blocked : ready).push(row);
    }
  }
  const order = (a: ReadyRow, b: ReadyRow) => {
    if (a.deadline !== b.deadline) return a.deadline === null ? 1 : b.deadline === null ? -1 : cmp(a.deadline, b.deadline);
    if (a.neededBy !== b.neededBy) return b.neededBy - a.neededBy;
    return cmp(key(a.scope, a.planId), key(b.scope, b.planId));
  };
  return { ready: ready.sort(order), blocked: blocked.sort(order), superseded: superseded.sort((a, b) => cmp(key(a.scope, a.planId), key(b.scope, b.planId))) };
}

export interface Finding { code: string; message: string; planId?: string; refId?: string }

/** `needs` cycles reachable from the plans of one scope, each reported once as its sorted member list. */
function needsCycles(u: Universe, scope: string): string[][] {
  const adjacency = new Map<string, string[]>();
  const loaded = new Set<string>();
  const load = (s: string) => {
    if (loaded.has(s)) return;
    loaded.add(s);
    for (const e of edgesOf(u, [s])) if (e.relation === "needs" && e.to) adjacency.set(e.from, [...(adjacency.get(e.from) ?? []), e.to]);
  };
  load(scope);
  const cycles = new Map<string, string[]>();
  const stack: string[] = [];
  const onStack = new Set<string>();
  const done = new Set<string>();
  const visit = (n: string) => {
    load(n.slice(0, n.indexOf("/")));
    stack.push(n); onStack.add(n);
    for (const m of adjacency.get(n) ?? []) {
      if (onStack.has(m)) {
        const cycle = stack.slice(stack.indexOf(m));
        cycles.set([...cycle].sort(cmp).join(" "), cycle);
      } else if (!done.has(m)) visit(m);
    }
    stack.pop(); onStack.delete(n); done.add(n);
  };
  for (const n of [...adjacency.keys()].filter((k) => k.startsWith(`${scope}/`)).sort(cmp)) if (!done.has(n)) visit(n);
  return [...cycles.values()].filter((c) => c.some((n) => n.startsWith(`${scope}/`)));
}

const ACTION_DONE = new Set(["none-completed", "owner-review-completed-findings", "owner-reconsider"]);

/**
 * Annotation findings for one scope: dangling refs, unreadable targets, refs from unknown plans or outcomes,
 * `needs` cycles, `needs` to a rejected or completed plan, an open plan superseded by an open plan, and a next
 * action on a superseded plan. Findings only. Nothing is repaired.
 */
export function annotationFindings(u: Universe, scope: string): Finding[] {
  const state = u.state(scope);
  const doc = u.annotations(scope);
  if (typeof state !== "object" || !doc) return [];
  const out: Finding[] = [];
  for (const planId of Object.keys(doc.plans).sort()) {
    const plan = state.plans.find((p) => p.id === planId);
    if (!plan) out.push({ code: "annotation-plan-missing", planId, message: `annotations name plan ${planId}, which is not in this scope` });
  }
  const edges = edgesOf(u, [scope]);
  for (const e of edges) {
    const planId = e.from.slice(scope.length + 1);
    const plan = state.plans.find((p) => p.id === planId);
    if (plan && e.fromOutcome !== undefined && !planContent(plan)?.outcomes.some((o) => o.id === e.fromOutcome)) {
      out.push({ code: "ref-dangling", planId, refId: e.id, message: `${e.from} ref ${e.id}: source outcome ${e.fromOutcome} no longer exists` });
    }
    if (e.resolution.status === "dangling") out.push({ code: "ref-dangling", planId, refId: e.id, message: `${e.from} ${e.relation} ${e.target}: ${e.resolution.reason}` });
    else if (e.resolution.status === "unavailable") out.push({ code: "ref-target-unavailable", planId, refId: e.id, message: `${e.from} ${e.relation} ${e.target}: target scope cannot be read now` });
    else if (e.resolution.status === "pruned") out.push({ code: "ref-target-pruned", planId, refId: e.id, message: `${e.from} ${e.relation} ${e.target}: target was rejected and pruned (${e.resolution.prunedBy}); the owner may remove this ref` });
    if (!e.to) continue;
    const slash = e.to.indexOf("/");
    const target = planOf(u, e.to.slice(0, slash), e.to.slice(slash + 1));
    if (!target) continue;
    // A need on a completed plan is satisfied for good, and one on a rejected plan never will be. Both are
    // reported so the owner can drop or retarget the ref. A completed source plan is history and is not reported.
    if (e.relation === "needs" && plan && !isCompleted(plan) && (isRejected(target) || isCompleted(target))) {
      out.push({ code: "needs-closed-target", planId, refId: e.id, message: `${e.from} needs ${e.target}, which is ${isRejected(target) ? "rejected" : "completed"}` });
    }
    if (e.relation === "supersedes" && plan) {
      if (isOpen(plan) && isOpen(target)) out.push({ code: "superseded-open", planId, refId: e.id, message: `open plan ${e.to} is superseded by open plan ${e.from}; complete, pause or reject one of them` });
      const targetState = u.state(e.to.slice(0, slash));
      if (!isRejected(plan) && typeof targetState === "object") {
        const action = contextView(targetState).plans.find((p) => p.id === target.id)?.permittedNextAction;
        if (action && !ACTION_DONE.has(action)) out.push({ code: "superseded-next-action", planId, refId: e.id, message: `${e.to} is superseded by ${e.from} but still has next action ${action}` });
      }
    }
  }
  for (const cycle of needsCycles(u, scope)) out.push({ code: "needs-cycle", message: `needs cycle: ${[...cycle, cycle[0]].join(" -> ")}` });
  return out;
}
