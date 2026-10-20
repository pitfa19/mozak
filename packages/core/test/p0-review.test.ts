import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { initScopeState, readScope, mutateScope } from "../src/scope-store.ts";
import { findSimilarPlans, reviewShow } from "../src/review.ts";

const roots: string[] = [];
after(() => { for (const root of roots) rmSync(root, { recursive: true, force: true }); });
const NOW = "2026-10-20T09:00:00.000Z";
const content = (title = "Synthetic export pipeline") => ({ title, purpose: "Validate synthetic fixtures", outcomes: [{ id: "verified", statement: "Synthetic fixture passes", acceptance: "objective", criterion: "Tests pass" }], constraints: [], nonGoals: [], rationale: "Synthetic regression coverage", questions: [], sources: [] });
function world() {
  const root = mkdtempSync(join(process.env.TMPDIR!, "mozak-p0-"));
  roots.push(root);
  for (const name of ["README.md", "AGENTS.md"]) writeFileSync(join(root, name), "Synthetic test scope\n");
  const entry = { id: "synthetic", root };
  initScopeState(entry, { operationId: "init", scopeId: entry.id, kind: "project", title: "Synthetic", expectedAbsent: { graph: true, bridge: true }, ownerRef: "synthetic:init", ownerMessageAt: NOW });
  let sequence = 0;
  const change = (action, payload, actor = "agent") => mutateScope(entry, { operationId: `operation-${++sequence}`, scopeId: entry.id, expected: readScope(entry).snapshot, action, payload }, actor);
  const bytes = () => ["mozak.json", "mozak.md"].map(name => readFileSync(join(root, name)));
  const approve = (planId) => {
    const shown = reviewShow(readScope(entry).state, planId, "approve-direction");
    return change("approve-direction", { planId, revisionId: shown.revisionId, reviewDigest: shown.reviewDigest, ownerRef: `synthetic:approval-${sequence}`, ownerMessageAt: NOW, reason: "Synthetic fixture approval" }, "owner");
  };
  return { entry, change, bytes, approve };
}

for (const [index, title] of ["Cedar export pipeline", "Lunar archive validation", "Harbor invoice reconciliation", "Quartz telemetry transport"].entries()) {
  test(`P0.1 exact copy ${index + 1} under a neutral ID is flagged and refused without writing`, () => {
    const w = world();
    const existingId = `fixture-${index + 1}`;
    const value = content(title);
    w.change("propose", { planId: existingId, content: value });
    const before = w.bytes();
    assert.deepEqual(findSimilarPlans(readScope(w.entry).state, { planId: "neutral", content: value }).map(p => p.planId), [existingId]);
    assert.throws(() => w.change("propose", { planId: "neutral", content: value }), { code: "duplicate-plan-candidate", exitCode: 3 });
    assert.deepEqual(w.bytes(), before);
  });
}

test("P0.1 shared outcome templates with unrelated titles are not duplicates", () => {
  const w = world();
  w.change("propose", { planId: "fixture-1", content: content("Cedar export pipeline") });
  const value = content("Lunar archive validation");
  assert.deepEqual(findSimilarPlans(readScope(w.entry).state, { planId: "fixture-2", content: value }), []);
  assert.equal(w.change("propose", { planId: "fixture-2", content: value }).committed, true);
});

function saveQuestions(w, planId, texts) {
  const plan = readScope(w.entry).state.plans.find(p => p.id === planId)!;
  const existing = plan.discussion?.questions ?? [];
  w.change("save-discussion", { planId, acceptedRevisionId: plan.accepted?.id ?? null, pendingRevisionId: plan.pending?.id ?? null, summary: "Synthetic discussion", stage: "clarifying", questions: [
    ...existing.map(({ reopenings, ...q }) => ({ ...q, reopenReason: null })),
    ...texts.map(text => ({ id: null, text, status: "open", answers: [], reopenReason: null })),
  ] });
}
function mergeWorld(targetCount: number, sourceCount: number, shared = 0) {
  const w = world();
  w.change("propose", { planId: "target", content: content() });
  w.change("propose", { planId: "source", content: content(), distinctFromPlanIds: ["target"] });
  const targetTexts = Array.from({ length: targetCount }, (_, i) => `Target question ${i}?`);
  if (targetCount > 0) saveQuestions(w, "target", targetTexts);
  saveQuestions(w, "source", Array.from({ length: sourceCount }, (_, i) => i < shared ? `  ${targetTexts[i].toUpperCase()}  ` : `Source question ${i}?`));
  const revise = () => {
    const target = readScope(w.entry).state.plans.find(p => p.id === "target")!;
    return w.change("revise", { planId: "target", acceptedRevisionId: target.accepted?.id ?? null, pendingRevisionId: target.pending?.id ?? null, mergeFromPlanId: "source", content: content("Unified synthetic pipeline") });
  };
  return { ...w, revise };
}

test("P0.2 revise refuses 20+20 unique questions with merge-capacity and no graph, bridge or receipt write", () => {
  const w = mergeWorld(20, 20);
  const before = w.bytes();
  const snapshot = readScope(w.entry).snapshot;
  assert.throws(w.revise, { code: "merge-capacity", exitCode: 2 });
  assert.deepEqual(w.bytes(), before);
  assert.deepEqual(readScope(w.entry).snapshot, snapshot);
});

for (const [target, source, shared, expected] of [[10, 10, 0, 20], [20, 20, 8, 32], [0, 32, 0, 32]]) {
  test(`P0.2 ${target}+${source} questions with ${shared} normalized duplicates merge without truncation`, () => {
    const w = mergeWorld(target, source, shared);
    const before = readScope(w.entry).state.plans;
    const expectedTexts = [...new Set(before.flatMap(p => p.discussion?.questions.map(q => q.text.trim().toLowerCase()) ?? []))].sort();
    w.revise();
    assert.equal(w.approve("target").committed, true);
    const plans = readScope(w.entry).state.plans;
    assert.equal(plans.length, 1);
    assert.equal(plans[0].discussion!.questions.length, expected);
    assert.deepEqual(plans[0].discussion!.questions.map(q => q.text.trim().toLowerCase()).sort(), expectedTexts);
  });
}

test("P0.2 deduplicated count of 33 is refused without writing", () => {
  const w = mergeWorld(20, 20, 7);
  const before = w.bytes();
  assert.throws(w.revise, { code: "merge-capacity", exitCode: 2 });
  assert.deepEqual(w.bytes(), before);
});

for (const changedPlan of ["target", "source"]) {
  test(`P0.2 approval rechecks capacity after ${changedPlan} discussion grows following revise`, () => {
    const w = mergeWorld(16, 16);
    w.revise();
    saveQuestions(w, changedPlan, ["An additional question after revise?"]);
    const before = w.bytes();
    const snapshot = readScope(w.entry).snapshot;
    assert.throws(() => w.approve("target"), { code: "merge-capacity", exitCode: 2 });
    assert.deepEqual(w.bytes(), before);
    assert.deepEqual(readScope(w.entry).snapshot, snapshot);
    assert.equal(readScope(w.entry).state.plans.length, 2);
  });
}
