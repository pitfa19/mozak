// Pure view models. Turns core ScopeState plus review rows into plain data for the UI. No IO.
import type { Plan, PlanContent, ScopeState } from "@mozak/core";

export type PlanStateKey = "completed" | "open" | "paused" | "awaiting" | "rejected";

export interface OutcomeVM { id: string; statement: string; acceptance: string; criterion: string }
export interface ContentVM {
  title: string;
  purpose: string;
  outcomes: OutcomeVM[];
  constraints: string[];
  nonGoals: string[];
  rationale: string;
  questions: string[];
  sources: { locator: string; anchor: string | null; version: string | null }[];
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
  limitations: string[];
  /** Reason recorded for a pause or a rejection, when present. */
  reason: string | null;
  content: ContentVM;
  /** A pending revision shown next to an accepted plan. Null when there is none. */
  pendingRevision: ContentVM | null;
  observations: { id: string; classification: string; summary: string; recordedAt: string }[];
}
export interface RemoteVM {
  spec: string;
  ref: string;
  /** Last fetch failed, never happened, or is older than ten minutes. The cached copy is still shown. */
  stale: boolean;
  lastFetchAt: string | null;
  staleReason: string | null;
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
  /** Null for a local scope. */
  remote: RemoteVM | null;
  errorCode: string | null;
  errorMessage: string | null;
}
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
  remote?: RemoteVM;
  error?: { code: string; message: string };
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

export function contentVM(c: PlanContent): ContentVM {
  return {
    title: c.title,
    purpose: c.purpose,
    outcomes: c.outcomes.map((o) => ({ id: o.id, statement: o.statement, acceptance: o.acceptance, criterion: o.criterion })),
    constraints: c.constraints.map((t) => t.text),
    nonGoals: [...c.nonGoals],
    rationale: c.rationale,
    questions: c.questions.map((t) => t.text),
    sources: c.sources.map((s) => ({ locator: s.locator, anchor: s.anchor, version: s.version })),
  };
}

export function planState(plan: Plan): PlanStateKey {
  if (plan.lifecycle.state === "completed") return "completed";
  if (plan.lifecycle.state === "paused") return "paused";
  if (plan.accepted) return "open";
  return plan.pending?.reviewState === "rejected" ? "rejected" : "awaiting";
}

export function planViewModel(
  scopeId: string,
  plan: Plan,
  awaitingRows: { planId: string; rowKind: string }[] = [],
  reviewNeeded = false,
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
    limitations: completion ? [...completion.limitations] : [],
    reason,
    content: contentVM(shown.content),
    pendingRevision: plan.accepted && plan.pending?.reviewState === "awaiting" ? contentVM(plan.pending.content) : null,
    observations: plan.observations.map((o) => ({ id: o.id, classification: o.classification, summary: o.summary, recordedAt: o.recordedAt })),
  };
}

export function scopeViewModel(load: ScopeLoad): ScopeVM {
  const hasMozakMd = load.entryFiles.includes("MOZAK.md");
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
      remote: load.remote ?? null,
      errorCode: load.error?.code ?? "unknown",
      errorMessage: load.error?.message ?? "scope could not be read",
    };
  }
  const needed = new Set(load.reviewNeededPlanIds ?? []);
  const plans = load.state.plans
    .map((p) => planViewModel(load.id, p, load.awaitingRows ?? [], needed.has(p.id)))
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
    remote: load.remote ?? null,
    errorCode: null,
    errorMessage: null,
  };
}

export function scopesModel(inventoryPath: string, loads: ScopeLoad[], now = new Date()): ScopesModel {
  const scopes = loads.map(scopeViewModel);
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

export type PlanFilter = "all" | "open" | "completed";

/** Open means still in play: open, awaiting approval, or paused. Rejected plans only show under All. */
export function planMatches(plan: Pick<PlanVM, "state">, filter: PlanFilter): boolean {
  if (filter === "all") return true;
  if (filter === "completed") return plan.state === "completed";
  return plan.state === "open" || plan.state === "awaiting" || plan.state === "paused";
}

/** Staleness of a remote scope's cached copy without touching the network. Mirrors core's ten minute window. */
export function remoteVM(
  spec: string,
  ref: string,
  meta: { lastFetchAt: string | null; lastError: string | null },
  now = new Date(),
  freshMs = 10 * 60 * 1000,
): RemoteVM {
  const age = meta.lastFetchAt ? now.getTime() - Date.parse(meta.lastFetchAt) : Infinity;
  let staleReason: string | null = null;
  if (meta.lastError) staleReason = meta.lastError;
  else if (!meta.lastFetchAt) staleReason = "never fetched";
  else if (age >= freshMs) staleReason = "last fetch older than 10 minutes";
  return { spec, ref, stale: staleReason !== null, lastFetchAt: meta.lastFetchAt, staleReason };
}

export function countRemote(scopes: ScopeVM[]): { remote: number; stale: number } {
  const remote = scopes.filter((s) => s.remote);
  return { remote: remote.length, stale: remote.filter((s) => s.remote?.stale).length };
}

export type OpenTarget = { kind: "vault"; path: string } | { kind: "external"; path: string };

/** Decide whether a file lives inside the vault (open in Obsidian) or outside (OS default app). */
export function resolveOpenTarget(vaultBase: string, file: string): OpenTarget {
  const base = vaultBase.replace(/\/+$/, "");
  if (base && file.startsWith(base + "/")) return { kind: "vault", path: file.slice(base.length + 1) };
  return { kind: "external", path: file };
}
