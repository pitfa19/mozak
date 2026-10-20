import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync, readdirSync, chmodSync, symlinkSync, unlinkSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { initScopeState, readScope, mutateScope, repairProjection } from "../src/scope-store.ts";
import { contextView, reviewShow, reviewRows } from "../src/review.ts";

const scratch = process.env.JCODE_SCRATCH_DIR ?? process.env.TMPDIR;
if (!scratch) throw new Error("tests require JCODE_SCRATCH_DIR or TMPDIR");
const roots: string[] = [];
after(() => { for (const root of roots) rmSync(root, { recursive: true, force: true }); });
export function world() {
  const root = mkdtempSync(join(scratch!, "mozak-store-"));
  roots.push(root);
  writeFileSync(join(root, "README.md"), "Human instructions\n");
  writeFileSync(join(root, "AGENTS.md"), "Existing agent instructions\n");
  const entry = { id: "sample", root };
  const request = { operationId: "init-1", scopeId: "sample", kind: "project", title: "Sample", expectedAbsent: { graph: true, bridge: true }, ownerRef: "synthetic-owner:init", ownerMessageAt: "2026-10-12T08:00:00.000Z" };
  return { entry, request };
}
export const content = { title: "Understand plans", purpose: "Keep agreed direction", outcomes: [{ id: "outcome", statement: "Context can be recovered", acceptance: "objective", criterion: "A new process reads the same direction" }], constraints: [], nonGoals: [], rationale: "Avoid repeated context interviews", questions: [], sources: [] };

test("ambiguous active evidence identities are refused before graph, bridge or receipt publication", () => {
  const { entry, request } = world(); initScopeState(entry, request);
  let count = 0;
  const change = (action, payload, actor = "agent") => mutateScope(entry, {
    operationId: `change-${++count}`, scopeId: entry.id, expected: readScope(entry).snapshot, action, payload,
  }, actor);
  for (const planId of ["a", "b"]) change("propose", { planId, content });
  const shown = reviewShow(readScope(entry).state, "a", "approve-direction");
  change("approve-direction", { planId: "a", revisionId: shown.revisionId, reviewDigest: shown.reviewDigest, ownerRef: "synthetic-owner:approval", ownerMessageAt: request.ownerMessageAt, reason: "fixture approval" }, "owner");
  const revisionId = readScope(entry).state.plans[0].accepted!.id;
  const payload = (planId) => ({ planId, observation: {
    id: "obs", classification: "observed", summary: "reported pass", evidence: [{
      id: "shared-evidence", locator: `test:${planId}`, anchor: null, version: null, inspectedAt: request.ownerMessageAt,
      activity: { kind: "run", description: "synthetic test" }, result: { verdict: "pass", summary: "passed" }, limitations: [],
    }],
  }, reasoningLinks: [{ id: "support", relation: "supports", from: { planId, revisionId: null, kind: "observation", id: "obs" }, to: { planId: "a", revisionId, kind: "outcome", id: "outcome" }, rationale: "support fixture" }] });
  change("observe", payload("a"));
  const before = ["mozak.json", "mozak.md"].map(name => readFileSync(join(entry.root, name)));
  const snapshot = readScope(entry).snapshot;
  assert.throws(() => change("observe", payload("b")), { code: "invalid-payload" });
  assert.deepEqual(["mozak.json", "mozak.md"].map(name => readFileSync(join(entry.root, name))), before);
  const fresh = readScope(entry);
  assert.deepEqual(fresh.snapshot, snapshot);
  assert.equal(fresh.state.receipts[`change-${count}`], undefined);
  assert.equal(fresh.state.plans[1].observations.length, 0);
  assert.doesNotThrow(() => contextView(fresh.state));
  assert.doesNotThrow(() => reviewRows(fresh.state));
  assert.equal(readdirSync(entry.root).includes(".mozak-write-lock"), false);
});

test("A01: create-only init publishes one canonical graph and matching bridge without touching instructions", () => {
  const { entry, request } = world();
  const result = initScopeState(entry, request);
  assert.equal(result.status, "ok");
  assert.equal(result.committed, true);
  const read = readScope(entry);
  assert.equal(read.projectionStatus, "current");
  assert.equal(read.state.scope.id, "sample");
  assert.deepEqual(read.state.plans, []);
  assert.equal(readFileSync(join(entry.root, "AGENTS.md"), "utf8"), "Existing agent instructions\n");
  assert.equal(readdirSync(entry.root).includes(".mozak-write-lock"), false);
  assert.equal(initScopeState(entry, request).status, "replayed");
  assert.throws(() => initScopeState(entry, { ...request, title: "Other" }), { code: "operation-conflict" });
});

test("A11: a stale second writer cannot overwrite a committed proposal", () => {
  const { entry, request } = world(); initScopeState(entry, request);
  const expected = readScope(entry).snapshot;
  const input = { operationId: "propose-1", scopeId: entry.id, expected, action: "propose", payload: { planId: "plan-1", content } };
  assert.equal(mutateScope(entry, input, "agent").status, "ok");
  assert.throws(() => mutateScope(entry, { ...input, operationId: "propose-2" }, "agent"), { code: "stale-input" });
  assert.equal(mutateScope(entry, input, "agent").status, "replayed");
  assert.equal(readScope(entry).state.plans.length, 1);
});

test("A14: partial publication is explicit, local plans stay readable and repair does not repeat semantics", () => {
  const { entry, request } = world(); initScopeState(entry, request);
  const expected = readScope(entry).snapshot;
  const input = { operationId: "partial-1", scopeId: entry.id, expected, action: "propose", payload: { planId: "plan-1", content } };
  const result = mutateScope(entry, input, "agent", { onPhase(phase) { if (phase === "after-graph") throw new Error("injected interruption"); } });
  assert.equal(result.status, "committed-bridge-stale");
  assert.equal(result.committed, true);
  const read = readScope(entry);
  assert.equal(read.projectionStatus, "bridge-stale");
  assert.equal(read.state.plans.length, 1);
  assert.equal(mutateScope(entry, input, "agent").status, "replayed");
  assert.throws(() => mutateScope(entry, { ...input, operationId: "later", expected: read.snapshot }, "agent"), { code: "bridge-stale" });
  const repair = { requestId: "repair-1", scopeId: entry.id, expected: read.snapshot };
  assert.equal(repairProjection(entry, repair).projectionUpdated, true);
  assert.equal(readScope(entry).projectionStatus, "current");
  assert.equal(repairProjection(entry, repair).status, "already-current");
  assert.equal(readScope(entry).state.storage.revision, read.state.storage.revision);
});

test("A10/A14: manual bridge conflict stays visible and is never overwritten by a read, mutation or repair", () => {
  const { entry, request } = world(); initScopeState(entry, request);
  const graph = readFileSync(join(entry.root, "mozak.json"), "utf8");
  writeFileSync(join(entry.root, "mozak.md"), "Owner's manual notes\n");
  const read = readScope(entry);
  assert.equal(read.projectionStatus, "bridge-conflict");
  assert.throws(() => repairProjection(entry, { requestId: "repair", scopeId: entry.id, expected: read.snapshot }), { code: "bridge-conflict" });
  assert.throws(() => mutateScope(entry, { operationId: "new", scopeId: entry.id, expected: read.snapshot, action: "propose", payload: { planId: "p", content } }, "agent"), { code: "bridge-conflict" });
  assert.equal(readFileSync(join(entry.root, "mozak.md"), "utf8"), "Owner's manual notes\n");
  assert.equal(readFileSync(join(entry.root, "mozak.json"), "utf8"), graph);
  assert.equal(readdirSync(entry.root).includes(".mozak-write-lock"), false);
});

test("A14: a canonical change during reads retries to a coherent snapshot or returns busy", () => {
  const { entry, request } = world(); initScopeState(entry, request);
  let writes = 0;
  const change = () => {
    const expected = readScope(entry).snapshot;
    mutateScope(entry, { operationId: `race-${writes}`, scopeId: entry.id, expected, action: "propose", payload: { planId: `race-${writes++}`, content } }, "agent");
  };
  const read = readScope(entry, { onPhase() { if (writes === 0) change(); } });
  assert.equal(read.state.plans.length, 1);
  assert.equal(read.projectionStatus, "current");
  assert.throws(() => readScope(entry, { onPhase: change }), { code: "busy" });
  assert.equal(readScope(entry).state.plans.length, 4);
});

test("A14: delayed repair cannot publish an older canonical revision", () => {
  const { entry, request } = world(); initScopeState(entry, request);
  const old = readScope(entry).snapshot;
  mutateScope(entry, { operationId: "new", scopeId: entry.id, expected: old, action: "propose", payload: { planId: "p", content } }, "agent");
  const bridge = readFileSync(join(entry.root, "mozak.md"), "utf8");
  assert.throws(() => repairProjection(entry, { requestId: "old", scopeId: entry.id, expected: old }), { code: "stale-input" });
  assert.equal(readFileSync(join(entry.root, "mozak.md"), "utf8"), bridge);
});

test("A09: oversized requests and unknown envelope fields fail before acquiring a lock", () => {
  const { entry, request } = world(); initScopeState(entry, request);
  const expected = readScope(entry).snapshot;
  const original = readFileSync(join(entry.root, "mozak.json"), "utf8");
  const input = { operationId: "limit", scopeId: entry.id, expected, action: "propose", payload: { planId: "p", content } };
  assert.throws(() => mutateScope(entry, { ...input, actor: "owner" }, "agent"), { code: "invalid-input" });
  assert.throws(() => mutateScope(entry, { ...input, payload: { planId: "p", content: { ...content, rationale: "x".repeat(1048576) } } }, "agent"), { code: "capacity-exceeded" });
  assert.equal(readFileSync(join(entry.root, "mozak.json"), "utf8"), original);
  assert.equal(readdirSync(entry.root).includes(".mozak-write-lock"), false);
});

test("A13: a failed release preserves the committed graph and reports the held lock", () => {
  const { entry, request } = world();
  const result = initScopeState(entry, request, { onPhase(phase) {
    if (phase === "before-release") writeFileSync(join(entry.root, ".mozak-write-lock", "owner.json"), JSON.stringify({ token: "different-owner", pid: 1 }));
  } });
  assert.equal(result.status, "committed-lock-held");
  assert.equal(result.committed, true);
  assert.equal(result.projectionStatus, "current");
  assert.equal(readScope(entry).state.scope.id, entry.id);
  assert.equal(JSON.parse(readFileSync(join(entry.root, ".mozak-write-lock", "owner.json"), "utf8")).token, "different-owner");
});

test("A14: invalid UTF-8 cannot normalize to an apparently current bridge", () => {
  const { entry, request } = world(); initScopeState(entry, { ...request, title: "Marker\uFFFD" });
  const bridgePath = join(entry.root, "mozak.md");
  const raw = readFileSync(bridgePath);
  const at = raw.indexOf(Buffer.from("\uFFFD"));
  assert.ok(at >= 0);
  const corrupted = Buffer.concat([raw.subarray(0, at), Buffer.from([0xff]), raw.subarray(at + 3)]);
  assert.equal(corrupted.toString("utf8"), raw.toString("utf8"));
  writeFileSync(bridgePath, corrupted);
  const read = readScope(entry);
  assert.equal(read.projectionStatus, "bridge-conflict");
  assert.throws(() => repairProjection(entry, { requestId: "repair", scopeId: entry.id, expected: read.snapshot }), { code: "bridge-conflict" });
  assert.deepEqual(readFileSync(bridgePath), corrupted);
});

test("A10: oversized or unreadable ancillary files never hide valid canonical context", () => {
  const { entry, request } = world(); initScopeState(entry, request);
  const before = readScope(entry).snapshot;
  const graph = readFileSync(join(entry.root, "mozak.json"));
  writeFileSync(join(entry.root, "README.md"), "x".repeat(5 * 1024 * 1024));
  writeFileSync(join(entry.root, "mozak.md"), "x".repeat(9 * 1024 * 1024));
  const read = readScope(entry);
  assert.equal(read.state.scope.id, entry.id);
  assert.equal(read.snapshot.bridge, null, "unavailable must not be mistaken for absent");
  assert.ok(read.issues.some(i => i.code === "bridge-unavailable"));
  assert.throws(() => repairProjection(entry, { requestId: "r", scopeId: entry.id, expected: before }), { code: "bridge-unavailable" });
  assert.deepEqual(readFileSync(join(entry.root, "mozak.json")), graph);
  writeFileSync(join(entry.root, "mozak.md"), "manual text");
  chmodSync(join(entry.root, "mozak.md"), 0);
  try {
    const unreadable = readScope(entry);
    if (process.getuid?.() !== 0) assert.equal(unreadable.snapshot.bridge, null);
    assert.equal(unreadable.state.scope.id, entry.id);
  } finally { chmodSync(join(entry.root, "mozak.md"), 0o600); }
});

test("A10: generated bridge order is identical across fresh process locales", () => {
  const { entry, request } = world(); initScopeState(entry, request);
  for (const id of ["z", "ä", "a"]) mutateScope(entry, { operationId: `add-${id}`, scopeId: entry.id, expected: readScope(entry).snapshot, action: "propose", payload: { planId: id, content } }, "agent");
  const store = new URL("../src/scope-store.ts", import.meta.url).href;
  const script = `import {readScope,renderBridge} from ${JSON.stringify(store)}; const r=readScope(${JSON.stringify(entry)}); console.log(JSON.stringify({status:r.projectionStatus,bridge:renderBridge(r.state,r.snapshot.graphHash)}));`;
  const outputs = ["en_US.UTF-8", "sv_SE.UTF-8"].map(locale => {
    const p = spawnSync(process.execPath, ["--experimental-strip-types", "--input-type=module", "-e", script], { encoding: "utf8", env: { ...process.env, LANG: locale, LC_ALL: locale } });
    assert.equal(p.status, 0, p.stderr);
    const result = JSON.parse(p.stdout); assert.equal(result.status, "current"); return result.bridge;
  });
  assert.equal(outputs[0], outputs[1]);
});

test("A09: canonical capacity fails without truncating receipts or replacing files", () => {
  const { entry, request } = world(); initScopeState(entry, request);
  const large = { ...content, rationale: "x".repeat(700_000) };
  for (let i = 0; i < 5; i++) assert.equal(mutateScope(entry, { operationId: `large-${i}`, scopeId: entry.id, expected: readScope(entry).snapshot, action: "propose", payload: { planId: `large-${i}`, content: large } }, "agent").status, "ok");
  const before = readFileSync(join(entry.root, "mozak.json"));
  const bridge = readFileSync(join(entry.root, "mozak.md"));
  // Explicitly distinct synthetic copies reach the canonical byte-capacity check.
  assert.throws(() => mutateScope(entry, { operationId: "too-large", scopeId: entry.id, expected: readScope(entry).snapshot, action: "propose", payload: { planId: "too-large", content: large, distinctFromPlanIds: readScope(entry).state.plans.map(p => p.id) } }, "agent"), { code: "capacity-exceeded" });
  assert.deepEqual(readFileSync(join(entry.root, "mozak.json")), before);
  assert.deepEqual(readFileSync(join(entry.root, "mozak.md")), bridge);
  assert.equal(Object.keys(readScope(entry).state.receipts).length, 6);
});

test("A09: prototype-named operation IDs remain ordinary durable receipt keys", () => {
  const { entry, request } = world(); initScopeState(entry, { ...request, operationId: "__proto__" });
  assert.equal(Object.hasOwn(readScope(entry).state.receipts, "__proto__"), true);
  assert.equal(initScopeState(entry, { ...request, operationId: "__proto__" }).status, "replayed");
  const mutation = { operationId: "constructor", scopeId: entry.id, expected: readScope(entry).snapshot, action: "propose", payload: { planId: "__proto__", content } };
  assert.equal(mutateScope(entry, mutation, "agent").status, "ok");
  assert.equal(mutateScope(entry, mutation, "agent").status, "replayed");
  assert.equal(Object.hasOwn(readScope(entry).state.receipts, "constructor"), true);
});

test("A10: absent and symlinked entry documents are diagnostics, not hidden canonical plans", () => {
  const { entry, request } = world(); initScopeState(entry, request);
  const before = readFileSync(join(entry.root, "mozak.json"));
  unlinkSync(join(entry.root, "README.md"));
  unlinkSync(join(entry.root, "AGENTS.md"));
  symlinkSync(join(entry.root, "mozak.json"), join(entry.root, "AGENTS.md"));
  const read = readScope(entry);
  assert.ok(read.issues.some(i => i.code === "missing-entry-document"));
  assert.ok(read.issues.some(i => i.code === "invalid-entry-document"));
  assert.equal(read.state.scope.id, entry.id);
  assert.deepEqual(readFileSync(join(entry.root, "mozak.json")), before);
});
