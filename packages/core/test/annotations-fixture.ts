// Synthetic temp scopes for annotation tests. Never touches a real inventory or vault.
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { initScopeState, mutateScope, readScope } from "../src/scope-store.ts";
import { reviewShow } from "../src/review.ts";
import { executeOperation } from "../src/api.ts";
import { loadInventory } from "../src/scope-index.ts";
import { readAnnotations } from "../src/annotations.ts";

export const NOW = "2026-10-20T09:00:00.000Z";
const roots: string[] = [];
export function cleanup() { for (const r of roots.splice(0)) rmSync(r, { recursive: true, force: true }); }

export interface PlanSpec { title?: string; purpose?: string; rationale?: string; outcomes?: { id: string; statement?: string; criterion?: string }[]; constraints?: string[] }
// Keys in sorted order on purpose: pendingChangedFields lists changed fields in the request's key order, while a
// re-read state has sorted keys, so unsorted content makes a revised accepted plan render differently after reread.
export const content = (id: string, spec: PlanSpec = {}) => ({
  constraints: (spec.constraints ?? []).map((text, i) => ({ id: `c${i + 1}`, text })),
  nonGoals: [],
  outcomes: (spec.outcomes ?? [{ id: "done" }]).map((o) => ({ acceptance: "objective", criterion: o.criterion ?? "Synthetic check passes", id: o.id, statement: o.statement ?? `Outcome ${o.id} of ${id}` })),
  purpose: spec.purpose ?? `Exercise synthetic plan ${id}`,
  questions: [],
  rationale: spec.rationale ?? `Synthetic rationale for ${id}`,
  sources: [],
  title: spec.title ?? `Synthetic ${id} work`,
});

export function world(scopeIds: string[] = ["alpha"], options: { git?: boolean; settings?: unknown } = {}) {
  const base = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), "mozak-annot-"));
  roots.push(base);
  const entries: Record<string, { id: string; root: string }> = {};
  for (const id of scopeIds) {
    const root = join(base, id);
    mkdirSync(root);
    if (options.git) execFileSync("git", ["init", "-q", root], { timeout: 5000 });
    writeFileSync(join(root, "README.md"), "Synthetic scope\n");
    writeFileSync(join(root, "AGENTS.md"), "Synthetic instructions\n");
    entries[id] = { id, root };
    initScopeState(entries[id], { operationId: `init-${id}`, scopeId: id, kind: "project", title: `Synthetic ${id}`, expectedAbsent: { graph: true, bridge: true }, ownerRef: "synthetic:init", ownerMessageAt: NOW });
  }
  const config = join(base, "inventory.json");
  writeFileSync(config, JSON.stringify({ format: "mozak.local/v3", scopes: scopeIds.map((id) => ({ id, root: entries[id].root })) }));
  if (options.settings !== undefined) writeFileSync(join(base, "mozak-settings.json"), JSON.stringify(options.settings));
  let seq = 0;
  const inv = () => loadInventory(config);
  const change = (scope: string, action: string, payload: unknown, actor: "agent" | "owner" = "agent") =>
    mutateScope(entries[scope], { operationId: `op-${++seq}`, scopeId: scope, expected: readScope(entries[scope]).snapshot, action, payload }, actor);
  const plan = (scope: string, planId: string) => readScope(entries[scope]).state.plans.find((p) => p.id === planId)!;
  const approve = (scope: string, planId: string) => {
    const shown = reviewShow(readScope(entries[scope]).state, planId, "approve-direction");
    return change(scope, "approve-direction", { planId, revisionId: shown.revisionId, reviewDigest: shown.reviewDigest, ownerRef: `synthetic:approve-${++seq}`, ownerMessageAt: NOW, reason: "Synthetic approval" }, "owner");
  };
  const propose = (scope: string, planId: string, spec: PlanSpec = {}, accept = true) => {
    change(scope, "propose", { planId, content: content(planId, spec), distinctFromPlanIds: readScope(entries[scope]).state.plans.map((p) => p.id) });
    if (accept) approve(scope, planId);
  };
  const reject = (scope: string, planId: string) => {
    const shown = reviewShow(readScope(entries[scope]).state, planId, "reject-pending");
    return change(scope, "reject-pending", { planId, revisionId: shown.revisionId, reviewDigest: shown.reviewDigest, ownerRef: `synthetic:reject-${++seq}`, ownerMessageAt: NOW, reason: "Synthetic rejection" }, "owner");
  };
  const pass = (scope: string, planId: string, outcomeId: string) => {
    const p = plan(scope, planId);
    const id = `obs-${++seq}`;
    const evidence = { id: `${id}-e`, locator: "synthetic.ts", anchor: null, version: null, inspectedAt: NOW, activity: { kind: "run", description: "synthetic" }, result: { verdict: "pass", summary: "passed" }, limitations: [] };
    return change(scope, "observe", { planId, observation: { id, classification: "observed", summary: id, evidence: [evidence] }, reasoningLinks: [{ id: `${id}-link`, relation: "supports", from: { planId, revisionId: null, kind: "observation", id }, to: { planId, revisionId: p.accepted!.id, kind: "outcome", id: outcomeId }, rationale: "synthetic" }] });
  };
  const complete = (scope: string, planId: string) => {
    for (const o of plan(scope, planId).accepted!.content.outcomes) pass(scope, planId, o.id);
    return change(scope, "complete", { planId, revisionId: plan(scope, planId).accepted!.id });
  };
  const merge = (scope: string, target: string, source: string) => {
    const t = plan(scope, target);
    change(scope, "revise", { planId: target, acceptedRevisionId: t.accepted?.id ?? null, pendingRevisionId: t.pending?.id ?? null, mergeFromPlanId: source, content: content(target, { title: `Unified ${target}` }) });
    return approve(scope, target);
  };
  const token = (scope: string) => readAnnotations(entries[scope].root).token;
  const annotate = (scope: string, items: unknown[], extra: Record<string, unknown> = {}, actor: "owner" | "agent" = "owner") =>
    executeOperation(inv(), "annotate", { scope, request: { operationId: `annot-${++seq}`, scopeId: scope, expectedAnnotations: token(scope), ownerRef: "synthetic:owner-message", ownerMessageAt: NOW, items, ...extra } }, actor);
  const bytes = (scope: string) => ["mozak.json", "mozak.md"].map((n) => readFileSync(join(entries[scope].root, n)));
  const op = (operation: string, args: Record<string, unknown>) => executeOperation(inv(), operation, args);
  return { base, config, entries, inv, change, plan, approve, propose, reject, pass, complete, merge, token, annotate, bytes, op };
}
