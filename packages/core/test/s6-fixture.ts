// Synthetic temp vaults for S6 tests (plans.md, locators, cited-note staleness). Never touches a real inventory.
// Layout: <base>/vault is one git repo with scopes under personal/ and research/; <base>/company is a second git
// repo whose scope sits at the repo root, like a shared company vault.
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { initScopeState, mutateScope, readScope } from "../src/scope-store.ts";
import { reviewShow } from "../src/review.ts";
import { executeOperation } from "../src/api.ts";
import { loadInventory } from "../src/scope-index.ts";

export const NOW = "2026-10-20T09:00:00.000Z";
const roots: string[] = [];
export function cleanupS6() { for (const r of roots.splice(0)) rmSync(r, { recursive: true, force: true }); }

export function git(dir: string, args: string[], date?: string) {
  const env = { ...process.env, GIT_AUTHOR_NAME: "Synthetic", GIT_AUTHOR_EMAIL: "synthetic@example.invalid", GIT_COMMITTER_NAME: "Synthetic", GIT_COMMITTER_EMAIL: "synthetic@example.invalid", ...(date ? { GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date } : {}) };
  return execFileSync("git", ["-C", dir, ...args], { encoding: "utf8", env, timeout: 10000 });
}

export interface SourceSpec { locator: string; anchor?: string | null; observedAt?: string }
export interface S6PlanSpec { title?: string; purpose?: string; outcomes?: { id: string; statement?: string }[]; sources?: SourceSpec[] }

export const s6content = (id: string, spec: S6PlanSpec = {}) => ({
  constraints: [],
  nonGoals: [],
  outcomes: (spec.outcomes ?? [{ id: "done" }]).map((o) => ({ acceptance: "objective", criterion: "Synthetic check passes", id: o.id, statement: o.statement ?? `Outcome ${o.id} of ${id}` })),
  purpose: spec.purpose ?? `Exercise synthetic plan ${id}`,
  questions: [],
  rationale: `Synthetic rationale for ${id}`,
  sources: (spec.sources ?? []).map((s, i) => ({ id: `s${i + 1}`, locator: s.locator, anchor: s.anchor ?? null, observedAt: s.observedAt ?? NOW, version: null, limitations: [] })),
  title: spec.title ?? `Synthetic ${id} work`,
});

/** scopes: id -> folder relative to base (for example "vault/personal/p"). */
export function s6world(scopes: Record<string, string>, options: { repos?: string[]; settings?: unknown } = {}) {
  const base = mkdtempSync(join(process.env.JCODE_SCRATCH_DIR ?? process.env.TMPDIR ?? tmpdir(), "mozak-s6-"));
  roots.push(base);
  for (const repo of options.repos ?? []) {
    mkdirSync(join(base, repo), { recursive: true });
    execFileSync("git", ["init", "-q", join(base, repo)], { timeout: 5000 });
  }
  const entries: Record<string, { id: string; root: string }> = {};
  for (const [id, rel] of Object.entries(scopes)) {
    const root = join(base, rel);
    mkdirSync(root, { recursive: true });
    writeFileSync(join(root, "README.md"), "Synthetic scope\n");
    writeFileSync(join(root, "AGENTS.md"), "Synthetic instructions\n");
    entries[id] = { id, root };
    initScopeState(entries[id], { operationId: `init-${id}`, scopeId: id, kind: "project", title: `Synthetic ${id} scope`, expectedAbsent: { graph: true, bridge: true }, ownerRef: "synthetic:init", ownerMessageAt: NOW });
  }
  const config = join(base, "inventory.json");
  writeFileSync(config, JSON.stringify({ format: "mozak.local/v3", scopes: Object.keys(scopes).map((id) => ({ id, root: entries[id].root })) }));
  if (options.settings !== undefined) writeFileSync(join(base, "mozak-settings.json"), JSON.stringify(options.settings));
  let seq = 0;
  const inv = () => loadInventory(config);
  const change = (scope: string, action: string, payload: unknown, actor: "agent" | "owner" = "agent") =>
    mutateScope(entries[scope], { operationId: `op-${++seq}`, scopeId: scope, expected: readScope(entries[scope]).snapshot, action, payload }, actor);
  const decide = (scope: string, planId: string, purpose: "approve-direction" | "reject-pending", reason = "Synthetic decision") => {
    const shown = reviewShow(readScope(entries[scope]).state, planId, purpose);
    return change(scope, purpose, { planId, revisionId: shown.revisionId, reviewDigest: shown.reviewDigest, ownerRef: `synthetic:${purpose}-${++seq}`, ownerMessageAt: NOW, reason }, "owner");
  };
  const propose = (scope: string, planId: string, spec: S6PlanSpec = {}, then: "approve" | "reject" | "await" = "approve", reason?: string) => {
    change(scope, "propose", { planId, content: s6content(planId, spec), distinctFromPlanIds: readScope(entries[scope]).state.plans.map((p) => p.id) });
    if (then === "approve") decide(scope, planId, "approve-direction");
    if (then === "reject") decide(scope, planId, "reject-pending", reason);
  };
  const observe = (scope: string, planId: string, locator: string, inspectedAt: string, anchor: string | null = null) => {
    const p = readScope(entries[scope]).state.plans.find((x) => x.id === planId)!;
    const id = `obs-${++seq}`;
    const evidence = { id: `${id}-e`, locator, anchor, version: null, inspectedAt, activity: { kind: "read", description: "synthetic read" }, result: { verdict: "pass", summary: "passed" }, limitations: [] };
    return change(scope, "observe", { planId, observation: { id, classification: "observed", summary: id, evidence: [evidence] }, reasoningLinks: [{ id: `${id}-link`, relation: "supports", from: { planId, revisionId: null, kind: "observation", id }, to: { planId, revisionId: p.accepted!.id, kind: "outcome", id: p.accepted!.content.outcomes[0].id }, rationale: "synthetic" }] });
  };
  const op = (operation: string, args: Record<string, unknown>, actor: "agent" | "owner" = "agent") => executeOperation(inv(), operation, args, actor);
  return { base, config, entries, inv, change, decide, propose, observe, op };
}
