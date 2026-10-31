// mozak-tend helpers (Goal 5, proposal). Pure and deterministic: no file system, no network, no clock, no model.
// The caller reads the monthly usage aggregates, file sizes, decisions and rejections, and passes them in. The
// functions compute the monthly health report, the patch outcome table, surface refusals, size budgets, the owner
// "yes" budget, the kill rule and the re-proposal block. They never write anything and never decide for the owner.

import type { UsageAggregate } from "./usage.ts";

export const TEND_FORMAT = "mozak.tend-report/v1" as const;
/** Each of the two windows (before and after a patch) needs at least this many events, else "not measurable". */
export const TEND_MIN_WINDOW_EVENTS = 30;
export const TEND_MAX_PATCHES = 3;
export const TEND_MAX_OWNER_YES_PER_MONTH = 2;
/** Owner yeses one monthly plan needs: approve-direction and approve-implementation. */
export const TEND_PLAN_OWNER_YES = 2;
export const TEND_KILL_AFTER_REPORTS = 3;
export const TEND_REPROPOSAL_BLOCK_DAYS = 90;
export const TEND_PENDING_DAYS = 7;
/** A change smaller than this share of the before value counts as no change. */
export const TEND_MIN_RELATIVE_CHANGE = 0.1;
export const TEND_META_SCOPE = "mozak-meta";

export type TendSurfaceKind = "scope-agents" | "root-agents" | "folder-index" | "annotation-proposal";
/** Size budgets in UTF-8 bytes (4 KB = 4096 bytes). null means no budget. */
export const TEND_SIZE_BUDGETS: Readonly<Record<TendSurfaceKind, number | null>> = Object.freeze({
  "scope-agents": 4096, "root-agents": 8192, "folder-index": 2048, "annotation-proposal": null,
});

export type TendMetric = "context-bytes-per-session" | "stale-per-100-writes" | "check-findings" | "eval-dev-score" | "owner-edits";
export const TEND_METRICS: readonly TendMetric[] = ["context-bytes-per-session", "stale-per-100-writes", "check-findings", "eval-dev-score", "owner-edits"];
const HIGHER_IS_BETTER: ReadonlySet<TendMetric> = new Set(["eval-dev-score"]);
/** Metrics that the counts-only usage aggregates can give. The others need explicit samples. */
const FROM_AGGREGATES: ReadonlySet<TendMetric> = new Set(["context-bytes-per-session", "stale-per-100-writes"]);

export type RepoVisibility = "private" | "public" | "none" | "unknown";

export interface TendSurfaceCandidate {
  /** Path relative to the repo (vault) root, forward slashes. */
  path: string;
  /** Visibility of the repo's remote. "none" is a repo with no remote. "unknown" is refused (fail closed). */
  repoVisibility: RepoVisibility;
  /** Scope roots relative to the same repo root. "" is a scope at the repo root. */
  scopeRoots: string[];
  /** Notes the owner declared as folder index notes. index.md and INDEX.md count without a declaration. */
  indexNotes?: string[];
  /** Extra eval folders, relative to the repo root. `.mozak-eval` is always refused. */
  evalDirs?: string[];
  beforeBytes?: number;
  afterBytes?: number;
}

export interface TendRefusal { code: string; message: string }
export interface TendBudgetCheck { limit: number | null; before: number; after: number; ok: boolean }
export interface TendSurfaceCheck { path: string; kind: TendSurfaceKind | null; allowed: boolean; refusal: TendRefusal | null; budget: TendBudgetCheck | null }

const segs = (p: string) => p.split("/").filter((s) => s !== "");
const dirOf = (p: string) => { const s = segs(p); return s.slice(0, -1).join("/"); };
const baseOf = (p: string) => segs(p).at(-1) ?? "";
const normRel = (p: string) => segs(p.trim()).join("/");
const under = (p: string, dir: string) => { const d = normRel(dir); return d === "" ? true : p === d || p.startsWith(`${d}/`); };
const refuse = (path: string, code: string, message: string, kind: TendSurfaceKind | null = null): TendSurfaceCheck =>
  ({ path, kind, allowed: false, refusal: { code, message }, budget: null });

/** Over budget is allowed only when the patch does not grow the file: delete as much as you add. */
export function checkTendSizeBudget(kind: TendSurfaceKind, beforeBytes: number, afterBytes: number): TendBudgetCheck {
  const limit = TEND_SIZE_BUDGETS[kind];
  const ok = limit === null || afterBytes <= limit || afterBytes <= beforeBytes;
  return { limit, before: beforeBytes, after: afterBytes, ok };
}

/**
 * Classify one target file and check it against the surface list. Order: unsafe path, repo visibility, eval folder,
 * then the surface kind. Only scope and root AGENTS.md, folder index notes and the annotation sidecar are surfaces.
 */
export function checkTendSurface(c: TendSurfaceCandidate): TendSurfaceCheck {
  const raw = c.path ?? "";
  if (raw === "" || raw.startsWith("/") || raw.includes("\\") || /^[A-Za-z]:/.test(raw) || segs(raw).some((s) => s === ".." || s === "."))
    return refuse(raw, "surface-unsafe-path", "the path must be relative to the repo root, with no . or .. parts");
  const path = normRel(raw);
  if (c.repoVisibility === "public") return refuse(path, "surface-public-remote", "the file is in a repo with a public remote; tend never patches it");
  if (c.repoVisibility !== "private" && c.repoVisibility !== "none") return refuse(path, "surface-remote-unknown", "the repo's remote visibility is unknown; tend refuses until the owner declares it private");
  if (segs(path).includes(".mozak-eval") || (c.evalDirs ?? []).some((d) => normRel(d) !== "" && under(path, d)))
    return refuse(path, "surface-eval-folder", "the eval folder is never a tend surface");
  const base = baseOf(path);
  const dir = dirOf(path);
  const scopes = new Set(c.scopeRoots.map(normRel));
  const declared = new Set((c.indexNotes ?? []).map(normRel));
  let kind: TendSurfaceKind | null = null;
  if (base === "AGENTS.md") kind = dir === "" ? "root-agents" : scopes.has(dir) ? "scope-agents" : null;
  else if (base === "mozak.annotations.json") kind = scopes.has(dir) ? "annotation-proposal" : null;
  else if (declared.has(path) || base === "index.md" || base === "INDEX.md") kind = "folder-index";
  if (kind === null) {
    if (base.toLowerCase().endsWith(".md") && base !== "AGENTS.md" && base !== "mozak.md") return refuse(path, "surface-prose-note", "prose notes are never a tend surface");
    return refuse(path, "surface-not-listed", "only scope and root AGENTS.md, folder index notes and annotation proposals are tend surfaces");
  }
  if (c.beforeBytes === undefined || c.afterBytes === undefined) return { path, kind, allowed: true, refusal: null, budget: null };
  const budget = checkTendSizeBudget(kind, c.beforeBytes, c.afterBytes);
  if (!budget.ok) return { path, kind, allowed: false, refusal: { code: "size-over-budget", message: `${kind} budget is ${budget.limit} bytes; an over-budget file may not grow (before ${budget.before}, after ${budget.after})` }, budget };
  return { path, kind, allowed: true, refusal: null, budget };
}

// ---- metrics ----

export interface MetricWindow { events: number; value: number | null }
/** A window is either counts-only usage aggregates (one or more host-months) or an explicit sample. */
export type TendWindowInput = { aggregates: UsageAggregate[] } | MetricWindow;
export type TendOutcome = "improved" | "no-change" | "worse" | "not-measurable";

/** Context calls stand in for sessions: the aggregates hold no session ids. */
export function metricFromAggregates(metric: TendMetric, aggs: UsageAggregate[]): MetricWindow {
  if (!FROM_AGGREGATES.has(metric)) return { events: 0, value: null };
  if (metric === "context-bytes-per-session") {
    let calls = 0, bytes = 0;
    for (const a of aggs) { const op = a.byOperation?.context; if (op) { calls += op.calls; bytes += op.bytesTotal; } }
    return { events: calls, value: calls > 0 ? bytes / calls : null };
  }
  let writes = 0, stale = 0;
  for (const a of aggs) { writes += a.writes; stale += a.staleRefusals; }
  return { events: writes, value: writes > 0 ? (100 * stale) / writes : null };
}

function toWindow(metric: TendMetric, w: TendWindowInput): MetricWindow {
  if ("aggregates" in w) return metricFromAggregates(metric, w.aggregates);
  return { events: Math.max(0, Math.floor(w.events)), value: typeof w.value === "number" && Number.isFinite(w.value) ? w.value : null };
}

export interface TendOutcomeRow {
  patchId: string; path: string; metric: TendMetric; before: MetricWindow; after: MetricWindow;
  outcome: TendOutcome; change: number | null; reason: string | null;
}

/** Compare two windows. Both need at least 30 events and a value, else "not measurable". */
export function measureTendPatch(metric: TendMetric, before: TendWindowInput, after: TendWindowInput, minRelativeChange = TEND_MIN_RELATIVE_CHANGE): Omit<TendOutcomeRow, "patchId" | "path"> {
  const b = toWindow(metric, before), a = toWindow(metric, after);
  const base = { metric, before: b, after: a };
  if (!TEND_METRICS.includes(metric)) return { ...base, outcome: "not-measurable", change: null, reason: "unknown metric" };
  if (b.events < TEND_MIN_WINDOW_EVENTS || a.events < TEND_MIN_WINDOW_EVENTS)
    return { ...base, outcome: "not-measurable", change: null, reason: `each window needs at least ${TEND_MIN_WINDOW_EVENTS} events (before ${b.events}, after ${a.events})` };
  if (b.value === null || a.value === null) return { ...base, outcome: "not-measurable", change: null, reason: "a window has no value for this metric" };
  const sign = HIGHER_IS_BETTER.has(metric) ? 1 : -1;
  const change = b.value === 0 ? (a.value === 0 ? 0 : Math.sign(a.value) * Infinity) : (a.value - b.value) / Math.abs(b.value);
  const gain = sign * change;
  const outcome: TendOutcome = gain >= minRelativeChange ? "improved" : gain <= -minRelativeChange ? "worse" : "no-change";
  return { ...base, outcome, change: Number.isFinite(change) ? Math.round(change * 1e4) / 1e4 : null, reason: null };
}

// ---- owner burden, kill rule, re-proposal block ----

export interface TendDecision { scope: string; action: string; at: string }
const YES_ACTIONS = new Set(["approve-direction", "approve-implementation", "accept-outcome", "resume"]);

/** Owner yeses in the tend scope for one month. Rejections and pauses are not yeses. */
export function countTendOwnerYes(decisions: TendDecision[], month: string, scope = TEND_META_SCOPE): number {
  return decisions.filter((d) => d.scope === scope && YES_ACTIONS.has(d.action) && typeof d.at === "string" && d.at.startsWith(month)).length;
}

export interface TendPastReport { month: string; improved: number }
export interface TendKillState { consecutiveNoImprovement: number; limit: number; reportOnly: boolean }

/** Trailing run of monthly reports with no measured improvement, the current one included. Reports before resetMonth are ignored. */
export function tendKillState(history: TendPastReport[], currentImproved: number, currentMonth: string, resetMonth?: string): TendKillState {
  const seq = [...history.filter((h) => h.month < currentMonth && (!resetMonth || h.month >= resetMonth))]
    .sort((x, y) => (x.month < y.month ? -1 : x.month > y.month ? 1 : 0)).map((h) => h.improved);
  seq.push(currentImproved);
  let run = 0;
  for (let i = seq.length - 1; i >= 0 && seq[i]! <= 0; i--) run++;
  return { consecutiveNoImprovement: run, limit: TEND_KILL_AFTER_REPORTS, reportOnly: run >= TEND_KILL_AFTER_REPORTS };
}

export interface TendRejection { path: string; heading: string; rejectedAt: string }
const normHeading = (h: string) => h.trim().replace(/^#+\s*/, "").replace(/\s+/g, " ").toLowerCase();
const DAY_MS = 86_400_000;

/** A rejected patch blocks the same file and heading for 90 days. Returns the block end, or null. */
export function tendReproposalBlock(path: string, heading: string, rejections: TendRejection[], now: string): string | null {
  const t = Date.parse(now);
  let until: number | null = null;
  for (const r of rejections) {
    if (normRel(r.path) !== normRel(path) || normHeading(r.heading) !== normHeading(heading)) continue;
    const end = Date.parse(r.rejectedAt) + TEND_REPROPOSAL_BLOCK_DAYS * DAY_MS;
    if (Number.isFinite(end) && end > t && (until === null || end > until)) until = end;
  }
  return until === null ? null : new Date(until).toISOString();
}

// ---- the report ----

export interface TendPatchProposal extends TendSurfaceCandidate { id: string; heading: string; metric: TendMetric }
export interface TendAppliedPatch { id: string; path: string; metric: TendMetric; before: TendWindowInput; after: TendWindowInput }
export interface TendPendingItem { since: string }

export interface TendReportOptions {
  /** Report month, yyyy-mm. */
  month: string;
  /** ISO time of the report; passed in so the function stays pure. */
  now: string;
  applied?: TendAppliedPatch[];
  history?: TendPastReport[];
  resetMonth?: string;
  rejections?: TendRejection[];
  decisions?: TendDecision[];
  pending?: TendPendingItem[];
  minRelativeChange?: number;
}

export interface TendProposalCheck { id: string; heading: string; metric: TendMetric | null; surface: TendSurfaceCheck; blockedUntil: string | null; allowed: boolean; refusal: TendRefusal | null }

export interface TendReport {
  format: typeof TEND_FORMAT; month: string; scope: string;
  health: {
    hosts: number; calls: number; writes: number; staleRefusals: number; rebased: number;
    stalePer100Writes: MetricWindow; contextBytesPerSession: MetricWindow; byOperation: Record<string, number>;
  };
  outcomes: TendOutcomeRow[];
  kill: TendKillState;
  burden: { ownerYes: number; limit: number; pendingOver7Days: number };
  proposals: TendProposalCheck[];
  plan: { allowed: boolean; patches: number; maxPatches: number; refusals: TendRefusal[] };
  mode: "patch" | "report-only";
}

/**
 * Monthly tend report. `aggregates` are counts-only usage aggregates; those of the report month feed the health
 * section. `surfaces` are this month's proposed patches. Nothing is written; the result is a plan the owner may
 * approve, or a report only.
 */
export function tendReport(aggregates: UsageAggregate[], surfaces: TendPatchProposal[], options: TendReportOptions): TendReport {
  const { month, now } = options;
  if (!/^\d{4}-\d{2}$/.test(month)) throw new TypeError("month must be yyyy-mm");
  if (!Number.isFinite(Date.parse(now))) throw new TypeError("now must be an ISO time");
  const cur = aggregates.filter((a) => a.month === month);
  const byOperation: Record<string, number> = {};
  for (const a of cur) for (const [op, v] of Object.entries(a.byOperation ?? {})) byOperation[op] = (byOperation[op] ?? 0) + v.calls;
  const health = {
    hosts: new Set(cur.map((a) => a.host)).size,
    calls: cur.reduce((n, a) => n + a.calls, 0), writes: cur.reduce((n, a) => n + a.writes, 0),
    staleRefusals: cur.reduce((n, a) => n + a.staleRefusals, 0), rebased: cur.reduce((n, a) => n + a.rebased, 0),
    stalePer100Writes: metricFromAggregates("stale-per-100-writes", cur),
    contextBytesPerSession: metricFromAggregates("context-bytes-per-session", cur),
    byOperation: Object.fromEntries(Object.entries(byOperation).sort(([x], [y]) => (x < y ? -1 : 1))),
  };

  const outcomes: TendOutcomeRow[] = (options.applied ?? []).map((p) => ({ patchId: p.id, path: normRel(p.path), ...measureTendPatch(p.metric, p.before, p.after, options.minRelativeChange) }));
  const improved = outcomes.filter((o) => o.outcome === "improved").length;
  const kill = tendKillState(options.history ?? [], improved, month, options.resetMonth);
  const t = Date.parse(now);
  const burden = {
    ownerYes: countTendOwnerYes(options.decisions ?? [], month),
    limit: TEND_MAX_OWNER_YES_PER_MONTH,
    pendingOver7Days: (options.pending ?? []).filter((p) => t - Date.parse(p.since) > TEND_PENDING_DAYS * DAY_MS).length,
  };

  const proposals: TendProposalCheck[] = surfaces.map((s) => {
    const surface = checkTendSurface(s);
    const metric = TEND_METRICS.includes(s.metric) ? s.metric : null;
    const blockedUntil = surface.refusal?.code === "surface-unsafe-path" ? null : tendReproposalBlock(surface.path, s.heading ?? "", options.rejections ?? [], now);
    let refusal: TendRefusal | null = surface.refusal;
    if (!refusal && metric === null) refusal = { code: "patch-metric-missing", message: `each patch needs one metric: ${TEND_METRICS.join(", ")}` };
    if (!refusal && blockedUntil) refusal = { code: "reproposal-blocked", message: `a rejected patch blocks this file and heading until ${blockedUntil}` };
    if (!refusal && kill.reportOnly) refusal = { code: "tend-report-only", message: `${kill.consecutiveNoImprovement} monthly reports without measured improvement; tend only reports` };
    return { id: s.id, heading: s.heading, metric, surface, blockedUntil, allowed: refusal === null, refusal };
  });

  const planRefusals: TendRefusal[] = [];
  if (kill.reportOnly) planRefusals.push({ code: "tend-report-only", message: "kill rule: tend stops patching and only reports" });
  if (surfaces.length > TEND_MAX_PATCHES) planRefusals.push({ code: "too-many-patches", message: `one plan holds at most ${TEND_MAX_PATCHES} patches, got ${surfaces.length}` });
  if (burden.ownerYes + TEND_PLAN_OWNER_YES > TEND_MAX_OWNER_YES_PER_MONTH) planRefusals.push({ code: "owner-yes-budget", message: `${burden.ownerYes} owner yeses already used this month; a plan needs ${TEND_PLAN_OWNER_YES} and the limit is ${TEND_MAX_OWNER_YES_PER_MONTH}` });
  if (surfaces.length > 0 && proposals.some((p) => !p.allowed)) planRefusals.push({ code: "patch-refused", message: "drop or fix the refused patches before proposing the plan" });
  const allowed = surfaces.length > 0 && planRefusals.length === 0;
  return {
    format: TEND_FORMAT, month, scope: TEND_META_SCOPE, health, outcomes, kill, burden, proposals,
    plan: { allowed, patches: surfaces.length, maxPatches: TEND_MAX_PATCHES, refusals: planRefusals },
    mode: kill.reportOnly ? "report-only" : "patch",
  };
}

const fmt = (w: MetricWindow) => (w.value === null ? `n/a (${w.events} events)` : `${Math.round(w.value * 100) / 100} (${w.events} events)`);

/** Short Markdown for the owner. Counts only, no plan text. */
export function renderTendReport(r: TendReport): string {
  const lines = [
    `# mozak-tend report ${r.month}`, "",
    `- Calls ${r.health.calls}, writes ${r.health.writes}, stale refusals ${r.health.staleRefusals}, hosts ${r.health.hosts}.`,
    `- Stale refusals per 100 writes: ${r.health.stalePer100Writes.events >= TEND_MIN_WINDOW_EVENTS ? fmt(r.health.stalePer100Writes) : `not measurable, ${r.health.stalePer100Writes.events} writes`}.`,
    `- Context bytes per session: ${r.health.contextBytesPerSession.events >= TEND_MIN_WINDOW_EVENTS ? fmt(r.health.contextBytesPerSession) : `not measurable, ${r.health.contextBytesPerSession.events} context calls`}.`,
    `- Owner yeses this month ${r.burden.ownerYes} of ${r.burden.limit}; items pending over ${TEND_PENDING_DAYS} days: ${r.burden.pendingOver7Days}.`,
    `- Reports without measured improvement in a row: ${r.kill.consecutiveNoImprovement} of ${r.kill.limit}. Mode: ${r.mode}.`, "",
    "| Patch | Metric | Before | After | Outcome |", "|---|---|---|---|---|",
    ...(r.outcomes.length ? r.outcomes.map((o) => `| ${o.patchId} | ${o.metric} | ${fmt(o.before)} | ${fmt(o.after)} | ${o.outcome === "not-measurable" ? "not measurable" : o.outcome} |`) : ["| none | | | | |"]),
    "",
    `Proposed patches: ${r.plan.patches} of at most ${r.plan.maxPatches}. Plan ${r.plan.allowed ? "can be proposed" : "not proposed"}${r.plan.refusals.length ? `: ${r.plan.refusals.map((x) => x.code).join(", ")}` : ""}.`,
  ];
  return `${lines.join("\n")}\n`;
}
