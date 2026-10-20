// Gap 8: a revise whose content keys are not in schema order must leave mozak.md current after a reread.
// Synthetic scope in a temp dir only.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { initScopeState, readScope, mutateScope } from "../src/scope-store.ts";
import { pendingChangedFields, reviewShow } from "../src/review.ts";

const scratch = process.env.JCODE_SCRATCH_DIR ?? process.env.TMPDIR;
if (!scratch) throw new Error("tests require JCODE_SCRATCH_DIR or TMPDIR");
const roots: string[] = [];
after(() => { for (const root of roots) rmSync(root, { recursive: true, force: true }); });

const OWNER_AT = "2026-10-12T08:00:00.000Z";
const content = (title: string, rationale: string, nonGoals: string[]) => ({
  title, purpose: "Synthetic purpose",
  outcomes: [{ id: "o1", statement: "Statement o1", acceptance: "objective", criterion: "Check o1 passes" }],
  constraints: [], nonGoals, rationale, questions: [], sources: [],
});

let counter = 0;
const op = () => `op-${++counter}`;
type Entry = { id: string; root: string };
function write(entry: Entry, action: string, payload: unknown, actor: "agent" | "owner" = "agent") {
  return mutateScope(entry, { operationId: op(), scopeId: entry.id, expected: readScope(entry).snapshot, action, payload }, actor);
}

test("gap 8: revise with content keys out of schema order keeps mozak.md current after a reread", () => {
  const root = mkdtempSync(join(scratch!, "mozak-keyorder-"));
  roots.push(root);
  writeFileSync(join(root, "README.md"), "Human instructions\n");
  writeFileSync(join(root, "AGENTS.md"), "Agent instructions\n");
  const entry = { id: "sample", root };
  initScopeState(entry, { operationId: "init-1", scopeId: "sample", kind: "project", title: "Sample", expectedAbsent: { graph: true, bridge: true }, ownerRef: "synthetic-owner:init", ownerMessageAt: OWNER_AT });
  write(entry, "propose", { planId: "p1", content: content("Plan one", "First reason", ["Fly"]) });
  const shown = reviewShow(readScope(entry).state, "p1", "approve-direction");
  write(entry, "approve-direction", { planId: "p1", revisionId: shown.revisionId, reviewDigest: shown.reviewDigest, ownerRef: "synthetic-owner:a", ownerMessageAt: OWNER_AT, reason: "fixture" }, "owner");

  // Keys in reverse schema order, and three changed fields whose request order differs from schema order.
  const changed = content("Plan one v2", "Second reason", ["Swim"]);
  const reversed = Object.fromEntries(Object.entries(changed).reverse());
  const plan = readScope(entry).state.plans[0];
  const result = write(entry, "revise", { planId: "p1", pendingRevisionId: null, acceptedRevisionId: plan.accepted!.id, content: reversed });
  assert.equal(result.status, "ok");

  const reread = readScope(entry);
  assert.equal(reread.projectionStatus, "current");
  assert.ok(!reread.issues.some(i => i.code === "bridge-conflict" || i.code === "bridge-stale"));
  assert.deepEqual(pendingChangedFields(reread.state.plans[0]), ["title", "nonGoals", "rationale"]);
});
