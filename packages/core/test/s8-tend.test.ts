// V-improve: mozak-tend helpers. Pure functions on synthetic inputs only; no file is read or written.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  TEND_SIZE_BUDGETS, TEND_MIN_WINDOW_EVENTS, checkTendSizeBudget, checkTendSurface, countTendOwnerYes, measureTendPatch,
  metricFromAggregates, renderTendReport, tendKillState, tendReport, tendReproposalBlock,
  type TendPatchProposal, type TendSurfaceCandidate,
} from "../src/tend.ts";
import { aggregateUsage, type UsageAggregate, type UsageLine } from "../src/usage.ts";

const NOW = "2026-11-03T10:00:00.000Z";
const base: Omit<TendSurfaceCandidate, "path"> = { repoVisibility: "private", scopeRoots: ["alpha", "beta/gamma"], indexNotes: ["alpha/notes/README.md"] };
const cand = (path: string, extra: Partial<TendSurfaceCandidate> = {}): TendSurfaceCandidate => ({ ...base, path, ...extra });
const patch = (id: string, path: string, extra: Partial<TendPatchProposal> = {}): TendPatchProposal =>
  ({ ...base, id, path, heading: "## Search", metric: "stale-per-100-writes", beforeBytes: 1000, afterBytes: 1200, ...extra });

function agg(month: string, o: { writes?: number; stale?: number; contextCalls?: number; contextBytes?: number; host?: string } = {}): UsageAggregate {
  const byOperation: UsageAggregate["byOperation"] = {};
  if (o.contextCalls) byOperation.context = { calls: o.contextCalls, exits: { "0": o.contextCalls }, statuses: { ok: o.contextCalls }, msP50: 1, msP95: 2, bytesTotal: o.contextBytes ?? 0 };
  return { format: "mozak.usage-aggregate/v1", host: o.host ?? "h1", month, calls: (o.writes ?? 0) + (o.stale ?? 0) + (o.contextCalls ?? 0), writes: o.writes ?? 0, staleRefusals: o.stale ?? 0, rebased: 0, byOperation, byActor: {} };
}

test("V-improve surface list: allowed kinds are root and scope AGENTS.md, folder index notes and annotation sidecars", () => {
  assert.equal(checkTendSurface(cand("AGENTS.md")).kind, "root-agents");
  assert.equal(checkTendSurface(cand("alpha/AGENTS.md")).kind, "scope-agents");
  assert.equal(checkTendSurface(cand("beta/gamma/AGENTS.md")).kind, "scope-agents");
  assert.equal(checkTendSurface(cand("alpha/notes/README.md")).kind, "folder-index");
  assert.equal(checkTendSurface(cand("alpha/projects/index.md")).kind, "folder-index");
  assert.equal(checkTendSurface(cand("alpha/mozak.annotations.json")).kind, "annotation-proposal");
  assert.equal(checkTendSurface(cand("alpha/AGENTS.md", { repoVisibility: "none" })).allowed, true);
  for (const p of ["AGENTS.md", "alpha/AGENTS.md", "alpha/notes/README.md", "alpha/mozak.annotations.json"]) assert.equal(checkTendSurface(cand(p)).allowed, true, p);
});

test("V-improve surface refusals: public remote, unknown remote, eval folder, prose notes, unlisted and unsafe paths", () => {
  const code = (c: TendSurfaceCandidate) => checkTendSurface(c).refusal?.code;
  assert.equal(code(cand("alpha/AGENTS.md", { repoVisibility: "public" })), "surface-public-remote");
  assert.equal(code(cand("AGENTS.md", { repoVisibility: "public" })), "surface-public-remote");
  assert.equal(code(cand("alpha/AGENTS.md", { repoVisibility: "unknown" })), "surface-remote-unknown");
  assert.equal(code(cand("alpha/AGENTS.md", { repoVisibility: "weird" as never })), "surface-remote-unknown");
  assert.equal(code(cand(".mozak-eval/s7a/AGENTS.md", { scopeRoots: [".mozak-eval/s7a"] })), "surface-eval-folder");
  assert.equal(code(cand("alpha/.mozak-eval/index.md")), "surface-eval-folder");
  assert.equal(code(cand("lab/eval/AGENTS.md", { scopeRoots: ["lab/eval"], evalDirs: ["lab/eval"] })), "surface-eval-folder");
  assert.equal(code(cand("alpha/notes/meeting 2026-10-12.md")), "surface-prose-note");
  assert.equal(code(cand("alpha/README.md")), "surface-prose-note", "an undeclared README is prose");
  assert.equal(code(cand("alpha/sub/AGENTS.md")), "surface-not-listed", "AGENTS.md outside a scope root");
  assert.equal(code(cand("alpha/mozak.json")), "surface-not-listed");
  assert.equal(code(cand("alpha/mozak.md")), "surface-not-listed");
  assert.equal(code(cand("other/mozak.annotations.json")), "surface-not-listed");
  assert.equal(code(cand("alpha/script.sh")), "surface-not-listed");
  for (const p of ["/abs/AGENTS.md", "../AGENTS.md", "alpha/../AGENTS.md", "./AGENTS.md", "alpha\\AGENTS.md", "C:/x/AGENTS.md", ""]) assert.equal(code(cand(p)), "surface-unsafe-path", p);
  // The public-remote check wins over every other rule, so no file of a public repo ever passes.
  assert.equal(code(cand(".mozak-eval/x.md", { repoVisibility: "public" })), "surface-public-remote");
});

test("V-improve size budgets: scope AGENTS.md 4 KB, root 8 KB, folder index 2 KB, over budget may not grow", () => {
  assert.deepEqual({ ...TEND_SIZE_BUDGETS }, { "scope-agents": 4096, "root-agents": 8192, "folder-index": 2048, "annotation-proposal": null });
  for (const [kind, limit] of [["scope-agents", 4096], ["root-agents", 8192], ["folder-index", 2048]] as const) {
    assert.equal(checkTendSizeBudget(kind, 100, limit).ok, true, `${kind} at the limit`);
    assert.equal(checkTendSizeBudget(kind, 100, limit + 1).ok, false, `${kind} one byte over`);
    assert.equal(checkTendSizeBudget(kind, limit + 500, limit + 500).ok, true, `${kind} over budget, same size`);
    assert.equal(checkTendSizeBudget(kind, limit + 500, limit + 400).ok, true, `${kind} over budget, shrinks`);
    assert.equal(checkTendSizeBudget(kind, limit + 500, limit + 501).ok, false, `${kind} over budget, grows`);
  }
  assert.equal(checkTendSizeBudget("annotation-proposal", 0, 1e9).ok, true);
  const r = checkTendSurface(cand("alpha/AGENTS.md", { beforeBytes: 4000, afterBytes: 4097 }));
  assert.equal(r.allowed, false);
  assert.equal(r.refusal?.code, "size-over-budget");
  assert.deepEqual(r.budget, { limit: 4096, before: 4000, after: 4097, ok: false });
  assert.equal(checkTendSurface(cand("AGENTS.md", { beforeBytes: 4000, afterBytes: 4097 })).allowed, true, "root budget is 8 KB");
});

test("V-improve metric windows: under 30 events in either window is not measurable", () => {
  assert.equal(TEND_MIN_WINDOW_EVENTS, 30);
  const s = (events: number, value: number) => ({ events, value });
  assert.equal(measureTendPatch("check-findings", s(29, 10), s(100, 1)).outcome, "not-measurable");
  assert.equal(measureTendPatch("check-findings", s(100, 10), s(29, 1)).outcome, "not-measurable");
  assert.match(measureTendPatch("check-findings", s(29, 10), s(100, 1)).reason ?? "", /at least 30 events \(before 29, after 100\)/);
  assert.equal(measureTendPatch("check-findings", s(30, 10), s(30, 5)).outcome, "improved");
  assert.equal(measureTendPatch("check-findings", s(30, 10), s(30, 12)).outcome, "worse");
  assert.equal(measureTendPatch("check-findings", s(30, 10), s(30, 9.5)).outcome, "no-change");
  assert.equal(measureTendPatch("eval-dev-score", s(40, 0.5), s(40, 0.6)).outcome, "improved", "higher is better for the eval score");
  assert.equal(measureTendPatch("eval-dev-score", s(40, 0.6), s(40, 0.5)).outcome, "worse");
  assert.equal(measureTendPatch("owner-edits", s(40, 0), s(40, 0)).outcome, "no-change");
  assert.equal(measureTendPatch("owner-edits", s(40, 0), s(40, 3)).outcome, "worse");
  // From aggregates: writes are the events of the stale rate, context calls the events of context bytes.
  assert.deepEqual(metricFromAggregates("stale-per-100-writes", [agg("2026-10", { writes: 40, stale: 10 })]), { events: 40, value: 25 });
  assert.deepEqual(metricFromAggregates("context-bytes-per-session", [agg("2026-10", { contextCalls: 20, contextBytes: 2000 }), agg("2026-10", { contextCalls: 20, contextBytes: 6000, host: "h2" })]), { events: 40, value: 200 });
  assert.deepEqual(metricFromAggregates("check-findings", [agg("2026-10", { writes: 99 })]), { events: 0, value: null }, "not in the aggregates");
  const twoHosts = measureTendPatch("stale-per-100-writes", { aggregates: [agg("2026-09", { writes: 15, stale: 6 }), agg("2026-09", { writes: 15, stale: 6, host: "h2" })] }, { aggregates: [agg("2026-10", { writes: 30, stale: 3 })] });
  assert.equal(twoHosts.outcome, "improved", "hosts add up to one window");
  assert.equal(measureTendPatch("stale-per-100-writes", { aggregates: [agg("2026-09", { writes: 29, stale: 6 })] }, { aggregates: [agg("2026-10", { writes: 300 })] }).outcome, "not-measurable");
});

test("V-burden: at most 2 owner yeses per month in the tend scope", () => {
  const d = (action: string, at: string, scope = "mozak-meta") => ({ scope, action, at });
  const decisions = [
    d("approve-direction", "2026-10-02T09:00:00Z"), d("approve-implementation", "2026-10-02T09:05:00Z"),
    d("reject", "2026-11-01T09:00:00Z"), d("pause", "2026-11-01T09:00:00Z"),
    d("approve-direction", "2026-11-01T09:00:00Z", "personal"),
  ];
  assert.equal(countTendOwnerYes(decisions, "2026-10"), 2);
  assert.equal(countTendOwnerYes(decisions, "2026-11"), 0, "rejections, pauses and other scopes are not tend yeses");
  const p = [patch("p1", "alpha/AGENTS.md")];
  assert.equal(tendReport([], p, { month: "2026-11", now: NOW, decisions }).plan.allowed, true);
  const used1 = [...decisions, d("accept-outcome", "2026-11-02T09:00:00Z")];
  const r = tendReport([], p, { month: "2026-11", now: NOW, decisions: used1 });
  assert.equal(r.burden.ownerYes, 1);
  assert.equal(r.plan.allowed, false);
  assert.ok(r.plan.refusals.some((x) => x.code === "owner-yes-budget"));
  assert.equal(tendReport([], p, { month: "2026-11", now: NOW, pending: [{ since: "2026-10-26T09:00:00Z" }, { since: "2026-10-28T09:00:00Z" }] }).burden.pendingOver7Days, 1);
});

test("one plan holds at most 3 patches, each with a metric", () => {
  const three = [patch("a", "alpha/AGENTS.md"), patch("b", "AGENTS.md"), patch("c", "alpha/notes/README.md", { afterBytes: 1500 })];
  assert.equal(tendReport([], three, { month: "2026-11", now: NOW }).plan.allowed, true);
  const four = tendReport([], [...three, patch("d", "beta/gamma/AGENTS.md")], { month: "2026-11", now: NOW });
  assert.equal(four.plan.allowed, false);
  assert.ok(four.plan.refusals.some((x) => x.code === "too-many-patches"));
  const noMetric = tendReport([], [patch("a", "alpha/AGENTS.md", { metric: "" as never })], { month: "2026-11", now: NOW });
  assert.equal(noMetric.proposals[0]!.refusal?.code, "patch-metric-missing");
  assert.equal(noMetric.plan.allowed, false);
  const refused = tendReport([], [patch("a", "alpha/AGENTS.md"), patch("b", "alpha/diary.md")], { month: "2026-11", now: NOW });
  assert.deepEqual(refused.proposals.map((x) => x.allowed), [true, false]);
  assert.ok(refused.plan.refusals.some((x) => x.code === "patch-refused"));
  assert.equal(tendReport([], [], { month: "2026-11", now: NOW }).plan.allowed, false, "no patches, report only");
});

test("kill rule: 3 monthly reports in a row without measured improvement switch tend to report only", () => {
  const h = (month: string, improved: number) => ({ month, improved });
  assert.equal(tendKillState([], 0, "2026-11").consecutiveNoImprovement, 1);
  assert.equal(tendKillState([h("2026-09", 0), h("2026-10", 0)], 0, "2026-11").reportOnly, true);
  assert.equal(tendKillState([h("2026-09", 0), h("2026-10", 0)], 1, "2026-11").reportOnly, false);
  assert.equal(tendKillState([h("2026-08", 0), h("2026-09", 1), h("2026-10", 0)], 0, "2026-11").consecutiveNoImprovement, 2);
  assert.equal(tendKillState([h("2026-10", 0), h("2026-09", 0)], 0, "2026-11").reportOnly, true, "order of history does not matter");
  assert.equal(tendKillState([h("2026-09", 0), h("2026-10", 0)], 0, "2026-11", "2026-10").reportOnly, false, "owner reset");
  const r = tendReport([], [patch("a", "alpha/AGENTS.md")], { month: "2026-11", now: NOW, history: [h("2026-09", 0), h("2026-10", 0)] });
  assert.equal(r.mode, "report-only");
  assert.equal(r.proposals[0]!.refusal?.code, "tend-report-only");
  assert.ok(r.plan.refusals.some((x) => x.code === "tend-report-only"));
  // Not measurable counts as no measured improvement.
  const nm = tendReport([], [], { month: "2026-11", now: NOW, history: [h("2026-09", 0), h("2026-10", 0)], applied: [{ id: "x", path: "alpha/AGENTS.md", metric: "check-findings", before: { events: 3, value: 9 }, after: { events: 2, value: 1 } }] });
  assert.equal(nm.outcomes[0]!.outcome, "not-measurable");
  assert.equal(nm.mode, "report-only");
});

test("re-proposal block: a rejected patch blocks the same file and heading for 90 days", () => {
  const rej = [{ path: "alpha/AGENTS.md", heading: "## Search", rejectedAt: "2026-08-06T10:00:00.000Z" }];
  assert.equal(tendReproposalBlock("alpha/AGENTS.md", "## Search", rej, "2026-11-03T10:00:00.000Z"), "2026-11-04T10:00:00.000Z", "89 days later");
  assert.equal(tendReproposalBlock("alpha/AGENTS.md", "search", rej, "2026-11-03T10:00:00.000Z"), "2026-11-04T10:00:00.000Z", "heading compared without marks and case");
  assert.equal(tendReproposalBlock("alpha/AGENTS.md", "## Search", rej, "2026-11-05T10:00:00.000Z"), null, "91 days later");
  assert.equal(tendReproposalBlock("alpha/AGENTS.md", "## Writing", rej, NOW), null, "other heading");
  assert.equal(tendReproposalBlock("AGENTS.md", "## Search", rej, NOW), null, "other file");
  const r = tendReport([], [patch("a", "alpha/AGENTS.md")], { month: "2026-11", now: NOW, rejections: rej });
  assert.equal(r.proposals[0]!.refusal?.code, "reproposal-blocked");
  assert.equal(r.plan.allowed, false);
});

test("tendReport over real aggregates of synthetic lines: health and outcome table, deterministic, counts only", () => {
  const line = (op: string, status: string, committed: boolean, ts: string, bytes = 100): UsageLine => ({ v: 1, ts, host: "h1", actor: "agent", op, scope: "alpha", exit: status === "ok" ? 0 : 3, status, ms: 5, bytes, ...(committed ? { committed: true } : {}) });
  const oct = aggregateUsage([
    ...Array.from({ length: 12 }, () => line("context", "ok", false, "2026-10-05T10:00:00Z", 3000)),
    ...Array.from({ length: 8 }, () => line("observe", "ok", true, "2026-10-05T10:00:00Z")),
    line("observe", "stale-input", false, "2026-10-05T10:00:00Z"),
  ], "h1", "2026-10");
  const opts = { month: "2026-10", now: "2026-11-01T08:00:00.000Z", applied: [{ id: "p1", path: "alpha/AGENTS.md", metric: "context-bytes-per-session" as const, before: { aggregates: [] }, after: { aggregates: [oct] } }] };
  const r = tendReport([oct], [], opts);
  assert.deepEqual([r.health.calls, r.health.writes, r.health.staleRefusals, r.health.hosts], [21, 8, 1, 1]);
  assert.deepEqual(r.health.stalePer100Writes, { events: 8, value: 12.5 });
  assert.deepEqual(r.health.contextBytesPerSession, { events: 12, value: 3000 });
  assert.equal(r.outcomes[0]!.outcome, "not-measurable");
  assert.deepEqual(r, tendReport([oct], [], opts), "same input, same report");
  const md = renderTendReport(r);
  assert.match(md, /not measurable, 8 writes/);
  assert.match(md, /\| p1 \| context-bytes-per-session \| n\/a \(0 events\) \| 3000 \(12 events\) \| not measurable \|/);
  assert.doesNotMatch(md, /alpha/, "the rendered report holds no scope ids or paths of applied patches");
});

test("tend core is pure: no file system, process, network or model calls", () => {
  const src = readFileSync(new URL("../src/tend.ts", import.meta.url), "utf8");
  const imports = [...src.matchAll(/^import\s.+?from\s+"([^"]+)"/gm)].map((m) => m[1]);
  assert.deepEqual(imports, ["./usage.ts"]);
  assert.match(src, /^import type \{ UsageAggregate \} from "\.\/usage\.ts";$/m, "type-only import");
  for (const word of ["fetch(", "process.", "Date.now(", "new Date()", "Math.random", "require("]) assert.equal(src.includes(word), false, word);
});
