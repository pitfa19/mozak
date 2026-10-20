// S2 `plan prune --rejected`: owner removes rejected plans; the receipt is the prune record that refs resolve through.
// Synthetic temp scopes only.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { cleanup, content, world, NOW } from "./annotations-fixture.ts";
import { readScope, validateScope } from "../src/index.ts";
import { resolveRef } from "../src/annotations.ts";
import { executeOperation } from "../src/api.ts";

after(cleanup);

function setup() {
  const w = world(["alpha", "beta"]);
  w.propose("alpha", "keep");
  w.propose("alpha", "dropped", {}, false);
  w.reject("alpha", "dropped");
  w.propose("alpha", "dropped-too", {}, false);
  w.reject("alpha", "dropped-too");
  w.propose("beta", "user");
  // An owner ref from another scope to the rejected plan, made while it still existed.
  const annotated = w.annotate("beta", [{ kind: "ref", planId: "user", target: "alpha/dropped", relation: "needs", evidence: "synthetic evidence" }]);
  assert.equal(annotated.exitCode, 0, JSON.stringify(annotated.data));
  const prune = (planIds: string[], actor: "owner" | "agent" = "owner", operationId = `prune-${planIds.join("+")}`) =>
    executeAs(w, { operationId, scopeId: "alpha", expected: readScope(w.entries.alpha).snapshot, planIds, ownerRef: "synthetic:owner-prune", ownerMessageAt: NOW }, actor);
  return { w, prune };
}
function executeAs(w: ReturnType<typeof world>, request: Record<string, unknown>, actor: "owner" | "agent") {
  return executeOperation(w.inv(), "prune", { scope: "alpha", request }, actor);
}

test("prune removes only the listed rejected plans, leaves a receipt record, and refs resolve as pruned", () => {
  const { w, prune } = setup();
  const before = readScope(w.entries.alpha);
  const out = prune(["dropped"]);
  assert.equal(out.exitCode, 0, JSON.stringify(out.data));
  const after = readScope(w.entries.alpha);
  assert.deepEqual(after.state.plans.map((p) => p.id).sort(), ["dropped-too", "keep"]);
  assert.notEqual(after.snapshot.revision, before.snapshot.revision, "a prune is a normal write with a new revision");
  const receipt = after.state.receipts["prune-dropped"];
  assert.deepEqual(receipt?.result, { action: "prune-rejected", ids: ["dropped"] });
  assert.equal(after.projectionStatus, "current");
  assert.doesNotThrow(() => validateScope(JSON.parse(readFileSync(join(w.entries.alpha.root, "mozak.json"), "utf8"))));
  // S4 resolver: the pruned id resolves through its record, not as a dangling ref.
  const lookup = (id: string) => (id === "alpha" ? after.state : id === "beta" ? readScope(w.entries.beta).state : "unknown" as const);
  const r = resolveRef("alpha/dropped", lookup);
  assert.equal(r.status, "pruned");
  assert.equal(r.status === "pruned" && r.prunedBy, "prune-dropped");
  assert.equal(resolveRef("alpha/never-existed", lookup).status, "dangling");
  const check = w.op("check", { scope: "beta" });
  const codes = (check.data.issues as { code: string }[]).map((i) => i.code);
  assert.ok(codes.includes("ref-target-pruned"), codes.join(","));
  assert.equal(codes.includes("ref-dangling"), false);
  const ready = w.op("ready", { scope: "beta" });
  const blocked = (ready.data.ready as { blocked: { planId: string; needs: { reason?: string }[] }[] }).blocked;
  assert.equal(blocked.find((b) => b.planId === "user")?.needs[0]?.reason, "target rejected and pruned");
  const graph = w.op("graph", { scope: "beta" });
  assert.equal((graph.data.graph as { edges: { resolution: { status: string } }[] }).edges.filter((e) => e.resolution.status === "pruned").length, 1);
  // The id stays reserved.
  assert.throws(() => w.change("alpha", "propose", { planId: "dropped", content: content("dropped") }), /pruned rejected plan/);
  // Replaying the same request is idempotent.
  assert.equal(executeAs(w, { operationId: "prune-dropped", scopeId: "alpha", expected: before.snapshot, planIds: ["dropped"], ownerRef: "synthetic:owner-prune", ownerMessageAt: NOW }, "owner").data.status, "replayed");
});

test("prune refuses agents, accepted plans, unknown ids, stale snapshots and empty lists, writing nothing", () => {
  const { w, prune } = setup();
  const bytes = w.bytes("alpha");
  assert.equal(prune(["dropped"], "agent").data.status, "not-permitted");
  assert.equal(prune(["keep"]).data.status, "prune-not-rejected");
  assert.equal(prune(["dropped", "keep"]).data.status, "prune-not-rejected");
  assert.equal(prune(["nope"]).data.status, "stale-reference");
  assert.equal(prune([]).data.status, "invalid-input");
  const stale = { operationId: "prune-stale", scopeId: "alpha", expected: readScope(w.entries.alpha).snapshot, planIds: ["dropped"], ownerRef: "synthetic:owner-prune", ownerMessageAt: NOW };
  w.propose("alpha", "moves-revision");
  const newer = w.bytes("alpha");
  assert.equal(executeAs(w, stale, "owner").data.status, "stale-input", "prune is never rebased");
  assert.deepEqual(w.bytes("alpha"), newer);
  assert.notDeepEqual(bytes, newer);
});

test("prune refuses a rejected plan another plan still references", () => {
  const { w, prune } = setup();
  const target = w.plan("alpha", "keep");
  const merged = w.change("alpha", "revise", { planId: "keep", acceptedRevisionId: target.accepted!.id, pendingRevisionId: null, mergeFromPlanId: "dropped-too", content: content("keep", { title: "Unified keep" }) });
  assert.equal(merged.status, "ok");
  const bytes = w.bytes("alpha");
  const out = prune(["dropped", "dropped-too"]);
  assert.equal(out.data.status, "prune-referenced");
  assert.match(JSON.stringify(out.data.issues), /dropped-too/);
  assert.deepEqual(w.bytes("alpha"), bytes);
  assert.equal(prune(["dropped"]).exitCode, 0);
});
