// Pure view models. Turns core ScopeState plus review rows into plain data for the UI. No IO.
// Plans are read in mozak.md, so the sidebar only needs identity, state, progress and a heading to jump to.
import { completedPlanLine, isBridgeFileName, planDisplayState, planHeading, planRoadmap, repoLinkLabel, repoLinkUrl, resolveRef, type AnnotationsDoc, type Plan, type PlanDisplayState, type ScopeLookup, type ScopeState } from "@mozak/core";

export type PlanStateKey = PlanDisplayState;
export type StopKey = "done" | "evidence" | "current" | "todo";

/** One sidebar segment per outcome, in roadmap order. */
export interface StripVM { stops: { key: StopKey; label: string }[]; done: number; total: number }
/** One cross-plan reference from owner annotations, seen from one plan. */
export interface RefVM {
  direction: "out" | "in";
  relation: "needs" | "informs" | "supersedes";
  /** Short reading: "needs", "needed by", "informs", "informed by", "supersedes", "superseded by". */
  verb: string;
  /** The other plan as scope/plan[#outcome]. */
  other: string;
  /** Title of the other plan when it resolves, else the raw target. */
  label: string;
  status: "resolved" | "dangling" | "unavailable" | "pruned";
  evidence: string;
}
export interface PlanVM {
  scopeId: string;
  id: string;
  title: string;
  state: PlanStateKey;
  stateLabel: string;
  /** Extra review signals, for example "implementation awaiting approval". */
  flags: string[];
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  /** Reason recorded for a pause or a rejection, when present. */
  reason: string | null;
  /** Progress over accepted outcomes. Null before the first approval. */
  strip: StripVM | null;
  /** Exact heading or collapsed completed-plan line in mozak.md. */
  heading: string;
  /** Owner annotation refs from this plan and to it. Present only when there is at least one. */
  refs?: RefVM[];
  /** The owner starred this plan: its id is in the scope's inventory `focus` list. */
  focused: boolean;
}
export interface ScopeCounts { completed: number; open: number; awaiting: number }
export interface ScopeVM {
  id: string;
  root: string;
  status: "ok" | "failed";
  title: string;
  kind: string;
  counts: ScopeCounts;
  plans: PlanVM[];
  entryFiles: string[];
  hasMozakMd: boolean;
  /** Actual note file name: mozak.md, or MOZAK.md for a scope not yet renamed. Null when absent. */
  bridgeFile: string | null;
  /** Display-only link to the code repo, when the inventory entry has one. Never fetched. */
  repo: RepoVM | null;
  errorCode: string | null;
  errorMessage: string | null;
}
/** A scope's repo link for the sidebar: the inventory value, a browsable URL and a short label. */
export interface RepoVM { spec: string; url: string; label: string }
export interface ScopesModel {
  inventoryPath: string;
  loadedAt: string;
  scopes: ScopeVM[];
  totals: ScopeCounts & { scopes: number; failed: number };
}

/** Input for one scope: either a read state with review facts, or an error. */
export interface ScopeLoad {
  id: string;
  root: string;
  entryFiles: string[];
  state?: ScopeState;
  counts?: ScopeCounts;
  /** Awaiting rows from core reviewRows, only identity is used. */
  awaitingRows?: { planId: string; rowKind: string }[];
  reviewNeededPlanIds?: string[];
  /** The entry's display-only repo link, when it has one. */
  repo?: string;
  error?: { code: string; message: string };
  /** Parsed mozak.annotations.json, when the scope has a valid one. */
  annotations?: AnnotationsDoc | null;
  /** Plan ids from this scope's inventory `focus` list. Ids that are not plans are ignored. */
  focus?: string[];
}

const STATE_LABEL: Record<PlanStateKey, string> = {
  completed: "Completed",
  open: "Open",
  paused: "Paused",
  awaiting: "Awaiting approval",
  rejected: "Rejected",
};
const ROW_FLAG: Record<string, string> = {
  pending: "revision awaiting approval",
  implementation: "implementation awaiting approval",
  outcome: "outcome awaiting acceptance",
};
const STATE_ORDER: Record<PlanStateKey, number> = { awaiting: 0, open: 1, paused: 2, completed: 3, rejected: 4 };

export function stripVM(state: ScopeState, plan: Plan): StripVM | null {
  const r = planRoadmap(state, plan);
  if (!r || r.total === 0) return null;
  return {
    stops: r.stops.map((s) => ({ key: s.current ? "current" : s.status, label: s.statement })),
    done: r.done,
    total: r.total,
  };
}

/** Zero-based line of a plan heading in mozak.md text, or null when the projection is stale or the plan is not rendered. */
export function headingLine(markdown: string, heading: string): number | null {
  const i = markdown.split("\n").indexOf(heading);
  return i < 0 ? null : i;
}

/** The sidebar uses the same state rule as mozak.md. */
export const planState: (plan: Plan) => PlanStateKey = planDisplayState;

export function planViewModel(
  scopeId: string,
  plan: Plan,
  awaitingRows: { planId: string; rowKind: string }[] = [],
  reviewNeeded = false,
  scopeState?: ScopeState,
  focused = false,
): PlanVM {
  const state = planState(plan);
  const shown = plan.accepted ?? plan.pending;
  if (!shown) throw new Error(`plan ${plan.id} has neither an accepted nor a pending revision`);
  const flags: string[] = [];
  for (const row of awaitingRows) {
    if (row.planId !== plan.id) continue;
    const flag = ROW_FLAG[row.rowKind];
    if (flag && !flags.includes(flag)) flags.push(flag);
  }
  if (reviewNeeded) flags.push("review needed");

  let reason: string | null = null;
  const life = plan.lifecycle;
  if (life.state === "paused") reason = plan.decisions.find((d) => d.id === life.decisionId)?.reason ?? null;
  else if (state === "rejected") reason = plan.decisions.find((d) => d.id === plan.pending?.rejectionDecisionId)?.reason ?? null;

  const completion = life.state === "completed" ? plan.completionRecords.find((r) => r.id === life.completionId) : undefined;
  return {
    scopeId,
    id: plan.id,
    title: shown.content.title || plan.id,
    state,
    stateLabel: STATE_LABEL[state],
    flags,
    createdAt: plan.createdAt,
    updatedAt: plan.updatedAt,
    completedAt: completion?.recordedAt ?? null,
    reason,
    strip: scopeState ? stripVM(scopeState, plan) : null,
    heading: state === "completed" ? completedPlanLine(plan) : planHeading(plan),
    focused,
  };
}

/** The sidebar form of a repo link. Pure. */
export function repoVM(spec: string | undefined): RepoVM | null {
  return spec === undefined ? null : { spec, url: repoLinkUrl(spec), label: repoLinkLabel(spec) };
}

export function scopeViewModel(load: ScopeLoad): ScopeVM {
  const bridgeName = load.entryFiles.find(isBridgeFileName) ?? null;
  const hasMozakMd = bridgeName !== null;
  if (!load.state || load.error) {
    return {
      id: load.id,
      root: load.root,
      status: "failed",
      title: load.id,
      kind: "unknown",
      counts: { completed: 0, open: 0, awaiting: 0 },
      plans: [],
      entryFiles: load.entryFiles,
      hasMozakMd,
      bridgeFile: bridgeName,
      repo: repoVM(load.repo),
      errorCode: load.error?.code ?? "unknown",
      errorMessage: load.error?.message ?? "scope could not be read",
    };
  }
  const needed = new Set(load.reviewNeededPlanIds ?? []);
  const focus = new Set(load.focus ?? []);
  const plans = load.state.plans
    .map((p) => planViewModel(load.id, p, load.awaitingRows ?? [], needed.has(p.id), load.state, focus.has(p.id)))
    .sort((a, b) => STATE_ORDER[a.state] - STATE_ORDER[b.state] || (a.title < b.title ? -1 : a.title > b.title ? 1 : 0));
  return {
    id: load.id,
    root: load.root,
    status: "ok",
    title: load.state.scope.title,
    kind: load.state.scope.kind,
    counts: load.counts ?? { completed: 0, open: 0, awaiting: 0 },
    plans,
    entryFiles: load.entryFiles,
    hasMozakMd,
    bridgeFile: bridgeName,
    repo: repoVM(load.repo),
    errorCode: null,
    errorMessage: null,
  };
}

const VERB: Record<RefVM["relation"], [string, string]> = { needs: ["needs", "needed by"], informs: ["informs", "informed by"], supersedes: ["supersedes", "superseded by"] };

/**
 * Attach owner annotation refs to plan view models, both directions, across every loaded scope. Pure: resolution
 * uses only the states already loaded. A scope that failed to load makes its targets "unavailable".
 */
export function attachRefs(loads: ScopeLoad[], scopes: ScopeVM[]): void {
  const lookup: ScopeLookup = (id) => {
    const load = loads.find((l) => l.id === id);
    if (!load) return "unknown";
    return load.state && !load.error ? load.state : "unavailable";
  };
  const plans = new Map<string, PlanVM>();
  for (const s of scopes) for (const p of s.plans) plans.set(`${s.id}/${p.id}`, p);
  const add = (key: string, ref: RefVM) => {
    const vm = plans.get(key);
    if (vm) vm.refs = [...(vm.refs ?? []), ref];
  };
  for (const load of loads) {
    const doc = load.state && !load.error ? load.annotations : null;
    if (!doc) continue;
    for (const planId of Object.keys(doc.plans).sort()) {
      for (const r of doc.plans[planId]!.refs) {
        const res = resolveRef(r.target, lookup);
        const to = res.status === "resolved" ? `${res.scope}/${res.planId}` : null;
        const from = `${load.id}/${planId}`;
        add(from, { direction: "out", relation: r.relation, verb: VERB[r.relation][0], other: r.target, label: to ? plans.get(to)?.title ?? r.target : r.target, status: res.status, evidence: r.evidence });
        if (to) add(to, { direction: "in", relation: r.relation, verb: VERB[r.relation][1], other: from, label: plans.get(from)?.title ?? from, status: "resolved", evidence: r.evidence });
      }
    }
  }
  // Outgoing first, then incoming; within each, the order the owner recorded them per scope.
  for (const vm of plans.values()) if (vm.refs) vm.refs = [...vm.refs.filter((r) => r.direction === "out"), ...vm.refs.filter((r) => r.direction === "in")];
}

export function scopesModel(inventoryPath: string, loads: ScopeLoad[], now = new Date()): ScopesModel {
  const scopes = loads.map(scopeViewModel);
  attachRefs(loads, scopes);
  const totals = { completed: 0, open: 0, awaiting: 0, scopes: scopes.length, failed: 0 };
  for (const s of scopes) {
    if (s.status === "failed") totals.failed++;
    totals.completed += s.counts.completed;
    totals.open += s.counts.open;
    totals.awaiting += s.counts.awaiting;
  }
  return { inventoryPath, loadedAt: now.toISOString(), scopes, totals };
}

/** "3 open, 1 awaiting, 2 completed", omitting zero parts. "no plans" when all are zero. */
export function countsSummary(c: ScopeCounts): string {
  const parts: string[] = [];
  if (c.open) parts.push(`${c.open} open`);
  if (c.awaiting) parts.push(`${c.awaiting} awaiting`);
  if (c.completed) parts.push(`${c.completed} completed`);
  return parts.length ? parts.join(", ") : "no plans";
}

export type PlanFilter = "open" | "focus" | "completed";

/** The sidebar tabs, in order. There is no All tab: rejected plans show in no tab (`mozak plans --include-rejected`). */
export const FILTERS: readonly { id: PlanFilter; label: string; tip: string }[] = [
  { id: "open", label: "Open", tip: "Open, awaiting approval or paused" },
  { id: "focus", label: "Focus", tip: "Starred plans that are still open" },
  { id: "completed", label: "Done", tip: "Completed plans" },
];

/**
 * Open means still in play: open, awaiting approval, or paused. Focus is a starred plan still in play, so a focused
 * plan that completes shows only under Done.
 */
export function planMatches(plan: Pick<PlanVM, "state" | "focused">, filter: PlanFilter): boolean {
  if (filter === "completed") return plan.state === "completed";
  const inPlay = plan.state === "open" || plan.state === "awaiting" || plan.state === "paused";
  return filter === "focus" ? inPlay && plan.focused : inPlay;
}

/** The tab to show: the remembered one when it still exists, else Focus when it has plans, else Open. */
export function defaultFilter(plans: Pick<PlanVM, "state" | "focused">[], remembered: PlanFilter | null): PlanFilter {
  if (remembered && FILTERS.some((f) => f.id === remembered)) return remembered;
  return plans.some((p) => planMatches(p, "focus")) ? "focus" : "open";
}

export type OpenTarget = { kind: "vault"; path: string } | { kind: "external"; path: string };

/**
 * Decide whether a file lives inside the vault (open in Obsidian) or outside (OS default app).
 * Core resolves scope roots through symlinks (macOS /var is /private/var), but Obsidian reports the vault path
 * as opened. The caller passes `real` (realpath with a fallback) so a vault reached through a symlink still
 * opens inside. This module stays free of IO.
 */
export function resolveOpenTarget(vaultBase: string, file: string, real: (path: string) => string = (p) => p): OpenTarget {
  const base = vaultBase.replace(/\/+$/, "");
  if (!base) return { kind: "external", path: file };
  if (file.startsWith(base + "/")) return { kind: "vault", path: file.slice(base.length + 1) };
  const realBase = real(base);
  const realFile = real(file);
  if (realFile.startsWith(realBase + "/")) return { kind: "vault", path: realFile.slice(realBase.length + 1) };
  return { kind: "external", path: file };
}
