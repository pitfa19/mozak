// `plan delete`: the owner removes plans so they no longer exist in mozak.json. Owner-only, snapshot-checked,
// replay-safe, refuses completed plans unless allowed, refuses plans other plans still reference, and a deleted id
// cannot be proposed again.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { executeOperation, initScopeState, loadInventory, readScope, resolveScope, withoutPlans, deletedRecord } from "../src/index.ts";

const OWNER_AT = "2026-10-22T08:00:00.000Z";

function scope(): { config: string; root: string } {
  const base = mkdtempSync(join(tmpdir(), "mozak-delete-"));
  const root = join(base, "alpha");
  mkdirSync(root);
  writeFileSync(join(root, "README.md"), "# Alpha\n");
  writeFileSync(join(root, "AGENTS.md"), "# Agents\n");
  const config = join(base, "mozak-inventory.json");
  writeFileSync(config, JSON.stringify({ format: "mozak.local/v3", scopes: [{ id: "alpha", root: "alpha" }] }));
  const out = initScopeState(resolveScope(loadInventory(config), "alpha"), {
    operationId: "init-1", scopeId: "alpha", kind: "project", title: "Alpha",
    expectedAbsent: { graph: true, bridge: true }, ownerRef: "owner-1", ownerMessageAt: OWNER_AT,
  });
  assert.equal(out.status, "ok");
  return { config, root };
}

const snap = (config: string) => readScope(resolveScope(loadInventory(config), "alpha")).snapshot;
const content = (title: string) => ({
  title, purpose: `Purpose of ${title}`,
  outcomes: [{ id: "o1", statement: `${title} done`, acceptance: "objective", criterion: "checked" }],
  constraints: [], nonGoals: [], rationale: "test", questions: [], sources: [],
});

function propose(config: string, planId: string, title: string) {
  const out = executeOperation(loadInventory(config), "propose", { scope: "alpha", request: {
    operationId: `propose-${planId}`, scopeId: "alpha", expected: snap(config), action: "propose",
    payload: { planId, content: content(title) },
  } }, "agent");
  assert.equal(out.exitCode, 0, JSON.stringify(out.data));
}

function del(config: string, planIds: string[], opId = `delete-${planIds.join("-")}`, extra: Record<string, unknown> = {}, actor: "owner" | "agent" = "owner") {
  return executeOperation(loadInventory(config), "delete", { scope: "alpha", request: {
    operationId: opId, scopeId: "alpha", expected: snap(config), planIds, reason: "owner asked to delete",
    ownerRef: "owner-msg-1", ownerMessageAt: OWNER_AT, ...extra,
  } }, actor);
}

const planIds = (config: string) => readScope(resolveScope(loadInventory(config), "alpha")).state.plans.map((p) => p.id).sort();

test("plan delete removes the plan from mozak.json and mozak.md, and the receipt records it", () => {
  const { config, root } = scope();
  propose(config, "alpha-one", "Alpha one");
  propose(config, "beta-two", "Beta two research");
  const out = del(config, ["alpha-one"]);
  assert.equal(out.exitCode, 0, JSON.stringify(out.data));
  assert.deepEqual(planIds(config), ["beta-two"]);
  const md = readFileSync(join(root, "mozak.md"), "utf8");
  assert.doesNotMatch(md, /alpha-one/, "the note no longer shows the deleted plan");
  assert.match(md, /beta-two/);
  const state = readScope(resolveScope(loadInventory(config), "alpha")).state;
  assert.equal(deletedRecord(state, "alpha-one")?.operationId, "delete-alpha-one");
  assert.equal(readScope(resolveScope(loadInventory(config), "alpha")).projectionStatus, "current");
});

test("plan delete is owner-only", () => {
  const { config } = scope();
  propose(config, "alpha-one", "Alpha one");
  const out = del(config, ["alpha-one"], "delete-agent", {}, "agent");
  assert.notEqual(out.exitCode, 0);
  assert.deepEqual(planIds(config), ["alpha-one"], "nothing deleted by an agent");
});

test("plan delete replays the same operation and refuses a stale snapshot", () => {
  const { config } = scope();
  propose(config, "alpha-one", "Alpha one");
  const request = { operationId: "delete-x", scopeId: "alpha", expected: snap(config), planIds: ["alpha-one"], reason: "r", ownerRef: "o", ownerMessageAt: OWNER_AT };
  const first = executeOperation(loadInventory(config), "delete", { scope: "alpha", request }, "owner");
  assert.equal(first.exitCode, 0, JSON.stringify(first.data));
  const replay = executeOperation(loadInventory(config), "delete", { scope: "alpha", request }, "owner");
  assert.equal(replay.exitCode, 0, "identical retry replays the receipt");
  propose(config, "beta-two", "Beta two research");
  const stale = executeOperation(loadInventory(config), "delete", { scope: "alpha", request: { ...request, operationId: "delete-y", planIds: ["beta-two"] } }, "owner");
  assert.equal(stale.exitCode, 3, "old snapshot is refused");
  assert.deepEqual(planIds(config), ["beta-two"]);
});

test("plan delete refuses unknown ids and empty lists, and a deleted id cannot be proposed again", () => {
  const { config } = scope();
  propose(config, "alpha-one", "Alpha one");
  assert.notEqual(del(config, ["missing"]).exitCode, 0);
  assert.notEqual(del(config, [], "delete-empty").exitCode, 0);
  assert.equal(del(config, ["alpha-one"]).exitCode, 0);
  const again = executeOperation(loadInventory(config), "propose", { scope: "alpha", request: {
    operationId: "propose-again", scopeId: "alpha", expected: snap(config), action: "propose",
    payload: { planId: "alpha-one", content: content("Alpha one again") },
  } }, "agent");
  assert.notEqual(again.exitCode, 0);
  assert.match(JSON.stringify(again.data), /was deleted/);
});

test("withoutPlans protects completed plans unless allowed, and refuses plans still referenced", () => {
  const { config } = scope();
  propose(config, "alpha-one", "Alpha one");
  propose(config, "beta-two", "Beta two research");
  const state = structuredClone(readScope(resolveScope(loadInventory(config), "alpha")).state);
  const a = state.plans.find((p) => p.id === "alpha-one")!;
  a.lifecycle = { state: "completed", completionId: "c1" } as typeof a.lifecycle;
  assert.throws(() => withoutPlans(state, ["alpha-one"]), /completed/);
  const b = state.plans.find((p) => p.id === "beta-two")!;
  b.pending = { ...b.pending!, mergeFromPlanId: "alpha-one" };
  assert.throws(() => withoutPlans(state, ["alpha-one"], true), /still referenced by beta-two \(pending merge\)/);
  const both = withoutPlans(state, ["alpha-one", "beta-two"], true);
  assert.equal(both.plans.length, 0, "deleting the referencing plan too is allowed");
});
