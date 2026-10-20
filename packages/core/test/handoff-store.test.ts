import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync, mkdirSync, unlinkSync, rmSync, existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { initScopeState, readScope, readScopeView, mutateScope, repairProjection } from "../src/scope-store.ts";
import { contextView, reviewShow } from "../src/review.ts";
import { loadInventory } from "../src/scope-index.ts";
import { executeOperation } from "../src/api.ts";
import { discussionDigest } from "../src/understanding.ts";

const scratch = process.env.JCODE_SCRATCH_DIR ?? process.env.TMPDIR;
if (!scratch) throw new Error("tests require JCODE_SCRATCH_DIR or TMPDIR");
const roots: string[] = [];
after(() => { for (const root of roots) rmSync(root, { recursive: true, force: true }); });
const content = { title: "Bounded formatter", purpose: "Recover exact bounded work", outcomes: [{ id: "out", statement: "String formatter works", acceptance: "objective", criterion: "Local unit tests pass" }], constraints: [], nonGoals: [], rationale: "No repeated interview", questions: [], sources: [] };
const bounds = { summary: "Implement formatter only", allowedPaths: ["src/format.ts", "test/format.test.ts"], excludedActions: ["network", "installation"], outcomeChecks: [{ outcomeId: "out", criterion: "Local formatter test passes" }], limitations: ["Synthetic automated owner references, not live acceptance"] };
function world() {
  const root = mkdtempSync(join(scratch!, "mozak-handoff-")); roots.push(root);
  writeFileSync(join(root, "README.md"), "Fixture README\n"); writeFileSync(join(root, "AGENTS.md"), "Fixture instructions\n");
  const entry = { id: "scope", root };
  const inventoryPath = join(root, "inventory.json");
  writeFileSync(inventoryPath, JSON.stringify({ format: "mozak.local/v2", scopes: [entry] }));
  const inv = loadInventory(inventoryPath);
  let serial = 0;
  initScopeState(entry, { operationId: "init", scopeId: entry.id, kind: "project", title: "Fixture", expectedAbsent: { graph: true, bridge: true }, ownerRef: "synthetic:init", ownerMessageAt: "2026-10-12T10:00:00Z" });
  const request = (action, payload) => ({ operationId: `op-${++serial}`, scopeId: entry.id, expected: readScope(entry).snapshot, action, payload });
  const change = (action, payload, actor: "agent" | "owner" = "agent", options = {}) => mutateScope(entry, request(action, payload), actor, options);
  const show = (purpose, planId = "p") => {
    const read = readScopeView(entry, purpose === "approve-implementation" ? planId : undefined);
    return reviewShow(read.state, planId, purpose, undefined, read.environment);
  };
  const decisionPayload = (purpose, planId = "p") => {
    const shown = show(purpose, planId);
    return { planId, revisionId: shown.revisionId, reviewDigest: shown.reviewDigest, ownerRef: `synthetic:decision-${++serial}`, ownerMessageAt: "2026-10-12T10:01:00Z", reason: "Synthetic automated decision", ...(purpose === "approve-implementation" ? { specificationId: shown.specificationId } : {}), ...(purpose === "revoke-implementation" ? { authorizationId: shown.authorizationId } : {}) };
  };
  const decide = (purpose, planId = "p", options = {}) => change(purpose, decisionPayload(purpose, planId), "owner", options);
  const plan = () => readScope(entry).state.plans.find(p => p.id === "p")!;
  const attach = (path = "spec.md") => change("attach-spec", { planId: "p", acceptedRevisionId: plan().accepted!.id, path, bounds, discussionDigest: plan().discussion ? discussionDigest(plan().discussion!) : null });
  const view = () => {
    const read = readScopeView(entry);
    return contextView(read.state, read.environment).plans.find(p => p.id === "p")!;
  };
  change("propose", { planId: "p", content }); decide("approve-direction");
  writeFileSync(join(root, "spec.md"), "# Formatter\n\nImplement formatter with local tests.\n");
  return { root, entry, inv, request, change, show, decide, decisionPayload, plan, attach, view };
}
const bytes = root => ["mozak.json", "mozak.md"].map(name => readFileSync(join(root, name)));

test("B01/B06: v3 init and old-format refusal never rewrite old bytes", () => {
  const w = world();
  assert.equal(readScope(w.entry).state.format, "mozak.scope/v3");
  assert.match(readFileSync(join(w.root, "mozak.md"), "utf8"), /format: 3/);
  const raw = JSON.parse(readFileSync(join(w.root, "mozak.json"), "utf8")); raw.format = "mozak.scope/v2";
  writeFileSync(join(w.root, "mozak.json"), JSON.stringify(raw));
  const before = bytes(w.root);
  const read = executeOperation(w.inv, "context", { scope: "scope" });
  assert.equal(read.exitCode, 2); assert.equal(read.data.status, "unsupported-format");
  assert.deepEqual(bytes(w.root), before);
});

test("B05/B06/B07: actual bytes govern current grant, independent candidate health and restoration", () => {
  const w = world(); w.attach();
  assert.equal(w.view().handoff.implementationAuthorized, false);
  const shown = w.show("approve-implementation");
  assert.equal(shown.approvalAvailable, true); assert.match(shown.specificationContent!, /Implement formatter/);
  w.decide("approve-implementation");
  const grant = w.view().handoff.authorizationId;
  assert.equal(w.view().handoff.executionEligible, true);
  const original = readFileSync(join(w.root, "spec.md"));
  const canonical = bytes(w.root);
  writeFileSync(join(w.root, "spec.md"), "# Edited after approval\n");
  assert.equal(w.view().handoff.implementationAuthorized, true);
  assert.equal(w.view().handoff.executionEligible, false);
  assert.equal(w.view().handoff.specificationHealth, "changed");
  assert.deepEqual(bytes(w.root), canonical);
  writeFileSync(join(w.root, "spec.md"), original);
  assert.equal(w.view().handoff.executionEligible, true); assert.equal(w.view().handoff.authorizationId, grant);
  writeFileSync(join(w.root, "candidate.md"), "# Different draft\n"); w.attach("candidate.md");
  unlinkSync(join(w.root, "candidate.md"));
  assert.equal(w.show("approve-implementation").approvalAvailable, false);
  assert.equal(w.show("approve-implementation").handoff.executionEligible, true);
  assert.equal(w.view().handoff.authorizationId, grant);
  assert.equal(w.view().handoff.specificationId, w.plan().implementationAuthorizations[0].specificationId);
  unlinkSync(join(w.root, "spec.md"));
  assert.equal(w.view().handoff.specificationHealth, "unavailable");
  assert.equal(w.view().handoff.executionEligible, false);
});

test("B08/B09: missing grant and candidate files cannot block pause, revoke or resume", () => {
  const w = world(); w.attach(); w.decide("approve-implementation");
  const currentSpec = w.plan().downstreamSpec;
  unlinkSync(join(w.root, "spec.md"));
  w.decide("pause"); assert.equal(w.plan().lifecycle.state, "paused");
  assert.equal(w.view().handoff.implementationAuthorized, true);
  w.decide("resume"); assert.equal(w.plan().lifecycle.state, "open");
  assert.equal(w.view().handoff.executionEligible, false);
  w.decide("revoke-implementation");
  assert.equal(w.plan().implementationAuthorization, null); assert.equal(w.plan().downstreamSpec, null);
  assert.equal(w.plan().specifications[0].id, currentSpec);
  assert.equal(w.plan().implementationAuthorizations.length, 1);
});

test("B07/B09: old approval receipt and file restoration never revive revoked authority", () => {
  const w = world(); w.attach();
  const approval = w.request("approve-implementation", w.decisionPayload("approve-implementation"));
  mutateScope(w.entry, approval, "owner");
  const oldSpec = w.plan().downstreamSpec;
  w.decide("revoke-implementation");
  const result = mutateScope(w.entry, approval, "owner");
  assert.equal(result.replayed, true); assert.equal(w.plan().implementationAuthorization, null);
  assert.equal(w.view().handoff.executionEligible, false);
  assert.equal(w.plan().downstreamSpec, null);
  w.attach(); assert.notEqual(w.plan().downstreamSpec, oldSpec);
  const before = bytes(w.root);
  const reused = { ...w.decisionPayload("approve-implementation"), ownerRef: approval.payload.ownerRef, ownerMessageAt: approval.payload.ownerMessageAt };
  assert.throws(() => w.change("approve-implementation", reused, "owner"));
  assert.deepEqual(bytes(w.root), before);
  w.decide("approve-implementation"); assert.equal(w.view().handoff.executionEligible, true);
});

test("B08: changed direction preserves pause, retires grant and cannot consume stale resume", () => {
  const w = world(); w.attach(); w.decide("approve-implementation"); w.decide("pause");
  const pause = structuredClone(w.plan().lifecycle);
  const staleResume = w.decisionPayload("resume");
  w.change("revise", { planId: "p", pendingRevisionId: null, acceptedRevisionId: w.plan().accepted!.id, content: { ...content, purpose: "Changed direction" } });
  w.decide("approve-direction");
  assert.deepEqual(w.plan().lifecycle, pause);
  assert.equal(w.plan().implementationAuthorization, null); assert.equal(w.plan().downstreamSpec, null);
  assert.throws(() => w.change("resume", staleResume, "owner"));
  w.decide("resume"); assert.equal(w.plan().lifecycle.state, "open");
  assert.equal(w.view().handoff.executionEligible, false);
});

test("B09: revoke preserves distinct pending candidate without passing it the grant", () => {
  const w = world(); w.attach(); w.decide("approve-implementation");
  w.attach(); const candidate = w.plan().downstreamSpec;
  w.decide("revoke-implementation");
  assert.equal(w.plan().downstreamSpec, candidate);
  assert.equal(w.view().handoff.implementationAuthorized, false);
  const plans = executeOperation(w.inv, "plans", { scope: "scope" });
  assert.equal(plans.exitCode, 0);
  assert.equal((plans.data.groups as any).awaiting.rows.filter(r => r.rowKind === "implementation").length, 1);
  w.decide("approve-implementation"); assert.equal(w.view().handoff.executionEligible, true);
});

test("B06/B12: graph/spec/graph rereads retry changed canonical and refuse perpetual churn", () => {
  const w = world(); w.attach(); w.decide("approve-implementation");
  let writes = 0;
  const mutate = () => w.change("observe", { planId: "p", observation: { id: `race-${++writes}`, classification: "unverified", summary: "Unrelated fact", evidence: [] } });
  const once = readScopeView(w.entry, undefined, { onPhase() { if (writes === 0) mutate(); } });
  assert.equal(once.state.plans[0].observations.length, 1);
  assert.equal(contextView(once.state, once.environment).plans[0].handoff.executionEligible, true);
  assert.throws(() => readScopeView(w.entry, undefined, { onPhase: mutate }), { code: "busy" });
});

test("B12: stale bridge and orphaned lock withhold execution while canonical context stays readable", () => {
  const w = world(); w.attach(); w.decide("approve-implementation");
  mkdirSync(join(w.root, ".mozak-write-lock"));
  assert.equal(w.view().handoff.implementationAuthorized, true);
  assert.equal(w.view().handoff.executionEligible, false);
  rmSync(join(w.root, ".mozak-write-lock"), { recursive: true }); // isolated fixture, no writer/acquirer exists
  const obs = { planId: "p", observation: { id: "partial", classification: "unverified", summary: "Progress", evidence: [] } };
  const result = w.change("observe", obs, "agent", { onPhase(phase) { if (phase === "after-graph") throw new Error("fixture interruption"); } });
  assert.equal(result.committed, true); assert.equal(result.projectionStatus, "bridge-stale");
  assert.equal(w.view().handoff.executionEligible, false);
  repairProjection(w.entry, { requestId: "repair", scopeId: "scope", expected: readScope(w.entry).snapshot });
  assert.equal(w.view().handoff.executionEligible, true);
});

test("B12: real child crash after grant commit preserves receipt, requires offline recovery and repair", () => {
  const w = world(); w.attach();
  const req = w.request("approve-implementation", w.decisionPayload("approve-implementation"));
  const job = join(w.root, "approval-request.json"); writeFileSync(job, JSON.stringify(req));
  const store = new URL("../src/scope-store.ts", import.meta.url).href;
  const script = `import { readFileSync } from 'node:fs'; import { mutateScope } from ${JSON.stringify(store)}; mutateScope({id:'scope',root:process.argv[1]},JSON.parse(readFileSync(process.argv[2],'utf8')),'owner',{onPhase(p){if(p==='after-graph')process.kill(process.pid,'SIGKILL')}});`;
  const child = spawnSync(process.execPath, ["--experimental-strip-types", "--input-type=module", "-e", script, w.root, job], { encoding: "utf8", timeout: 10000 });
  assert.equal(child.signal, "SIGKILL", child.stderr);
  assert.equal(existsSync(join(w.root, ".mozak-write-lock")), true);
  assert.equal(readScope(w.entry).projectionStatus, "bridge-stale");
  assert.equal(w.plan().implementationAuthorizations.length, 1);
  assert.equal(w.view().handoff.executionEligible, false);
  // Child has exited and this isolated test has no other acquirer. Only now recover offline.
  rmSync(join(w.root, ".mozak-write-lock"), { recursive: true });
  assert.equal(mutateScope(w.entry, req, "owner").replayed, true);
  assert.equal(w.plan().implementationAuthorizations.length, 1);
  assert.equal(w.view().handoff.executionEligible, false);
  repairProjection(w.entry, { requestId: "repair", scopeId: "scope", expected: readScope(w.entry).snapshot });
  assert.equal(w.view().handoff.executionEligible, true);
});

test("B13: old continuation version is refused, including structurally valid prior token", () => {
  const w = world();
  for (let i = 0; i < 6; i++) w.change("propose", { planId: `pending-${i}`, content });
  const result = executeOperation(w.inv, "plans", { scope: "scope" });
  const token = (result.data.groups as any).awaiting.continuation;
  const parsed = JSON.parse(Buffer.from(token, "base64url").toString("utf8"));
  assert.equal(parsed.v, 2); parsed.v = 1;
  const bad = executeOperation(w.inv, "plans", { continuation: Buffer.from(JSON.stringify(parsed)).toString("base64url") });
  assert.equal(bad.exitCode, 2); assert.equal(bad.data.status, "invalid-input");
});
