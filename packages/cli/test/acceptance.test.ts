import { test, after } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { readScope } from "../../core/src/scope-store.ts";

const scratch = process.env.JCODE_SCRATCH_DIR ?? process.env.TMPDIR;
if (!scratch) throw new Error("scratch directory required");
const roots: string[] = [];
after(() => { for (const root of roots) rmSync(root, { recursive: true, force: true }); });
const cliPath = fileURLToPath(new URL("../dist/index.js", import.meta.url));
const ownerAt = "2026-10-12T08:00:00.000Z";
const content = (title = "Recover understanding", acceptance = "objective") => ({ title, purpose: "Preserve agreed meaning", outcomes: [{ id: "o1", statement: "Fresh context is sufficient", acceptance, criterion: "A new process reports the accepted meaning" }], constraints: [], nonGoals: ["Automatic coding authorization"], rationale: "Avoid lost decisions", questions: [], sources: [{ id: "source", locator: "synthetic:source", anchor: null, observedAt: ownerAt, version: "fixture-v1", limitations: ["Synthetic transport fixture, not a real pilot"] }] });

function fixture(initialize = true) {
  const root = mkdtempSync(join(scratch!, "mozak-acceptance-")); roots.push(root);
  const entries = ["one", "two"].map(id => {
    const path = join(root, id); mkdirSync(path);
    writeFileSync(join(path, "README.md"), "Owner README\n");
    writeFileSync(join(path, "AGENTS.md"), "Owner agent instructions\n");
    return { id, root: path };
  });
  const config = join(root, "inventory.json");
  writeFileSync(config, JSON.stringify({ format: "mozak.local/v2", scopes: entries }));
  let seq = 0;
  function run(args: string[], expectedExit = 0) {
    const p = spawnSync(process.execPath, [cliPath, ...args, "--config", config, "--json"], { encoding: "utf8", timeout: 15000 });
    assert.equal(p.status, expectedExit, `${args.join(" ")}\n${p.stdout}\n${p.stderr}`);
    return JSON.parse(p.stdout);
  }
  function request(args: string[], body: object, expectedExit = 0) {
    const path = join(root, `request-${seq++}.json`); writeFileSync(path, JSON.stringify(body));
    return run([...args, "--request", path], expectedExit);
  }
  function mutate(scope: string, action: string, payload: unknown, expectedExit = 0) {
    const entry = entries.find(e => e.id === scope)!;
    const route = ["propose", "revise", "complete"].includes(action) ? ["plan", action] : action === "observe" ? ["observe"] : ["review", "decide"];
    return request([...route, "--scope", scope], { operationId: `op-${seq++}`, scopeId: scope, expected: readScope(entry).snapshot, action, payload }, expectedExit);
  }
  function plan(scope: string, id: string) { return readScope(entries.find(e => e.id === scope)!).state.plans.find(p => p.id === id)!; }
  function decide(scope: string, id: string, purpose: string, outcomeId?: string) {
    const shown = run(["review", "show", "--scope", scope, "--plan", id, "--purpose", purpose, ...(outcomeId ? ["--outcome", outcomeId] : [])]);
    const view = shown.review;
    assert.match(view.reviewDigest, /^[a-f0-9]{64}$/);
    const p = plan(scope, id);
    const revisionId = ["approve-direction", "reject-pending", "reconsider"].includes(purpose) ? p.pending!.id : p.accepted!.id;
    return mutate(scope, purpose, { planId: id, revisionId, reviewDigest: view.reviewDigest, ownerRef: "synthetic-owner:acceptance-fixture", ownerMessageAt: ownerAt, reason: "Synthetic owner decision for binding test", ...(outcomeId ? { outcomeId } : {}) });
  }
  function observe(scope: string, id: string, oid: string, classification = "observed", relation = "supports", supersedes?: string, outcomeId = "o1") {
    const p = plan(scope, id);
    return mutate(scope, "observe", { planId: id, observation: { id: oid, classification, summary: `Synthetic observation ${oid}`, evidence: [{ id: `e-${oid}`, locator: "synthetic:verification", anchor: null, version: "fixture-v1", inspectedAt: ownerAt, activity: { kind: "run", description: "Synthetic reported result, not independent execution" }, result: { verdict: relation === "challenges" ? "fail" : "pass", summary: "Fixture result" }, limitations: ["Synthetic evidence"] }], ...(supersedes ? { supersedesObservationId: supersedes } : {}) }, reasoningLinks: [{ id: `l-${oid}`, relation, from: { planId: id, revisionId: null, kind: "observation", id: oid }, to: { planId: id, revisionId: p.accepted!.id, kind: "outcome", id: outcomeId }, rationale: "Evidence is explicitly bound to the current outcome" }] });
  }
  if (initialize) for (const e of entries) request(["scope", "init", "--scope", e.id], { operationId: `init-${e.id}`, scopeId: e.id, kind: "project", title: e.id, expectedAbsent: { graph: true, bridge: true }, ownerRef: "synthetic-owner:init", ownerMessageAt: ownerAt });
  return { root, config, entries, run, request, mutate, decide, observe, plan };
}

test("A01: built CLI init preserves entry files, replays exactly and refuses existing or unsafe scope state", () => {
  const input = { operationId: "init-one", scopeId: "one", kind: "project", title: "one", expectedAbsent: { graph: true, bridge: true }, ownerRef: "synthetic-owner:init", ownerMessageAt: ownerAt };
  const init = (f, body = input, exit = 0) => f.request(["scope", "init", "--scope", "one"], body, exit);
  const f = fixture(false), root = f.entries[0].root;
  const entriesBefore = ["README.md", "AGENTS.md"].map(name => readFileSync(join(root, name)));
  assert.equal(init(f).committed, true);
  const saved = ["mozak.json", "mozak.md"].map(name => readFileSync(join(root, name)));
  assert.equal(init(f).status, "replayed");
  assert.equal(init(f, { ...input, title: "different request" }, 3).committed, false);
  assert.equal(init(f, { ...input, operationId: "unrelated-init" }, 3).committed, false);
  assert.deepEqual(["mozak.json", "mozak.md"].map(name => readFileSync(join(root, name))), saved);
  assert.deepEqual(["README.md", "AGENTS.md"].map(name => readFileSync(join(root, name))), entriesBefore);
  for (const kind of ["bridge", "legacy", "duplicate-id", "duplicate-root", "graph-link", "bridge-link", "lock-link"]) {
    const g = fixture(false), scopeRoot = g.entries[0].root;
    const outside = join(g.root, "outside"); mkdirSync(outside);
    const sentinel = join(outside, "sentinel"); writeFileSync(sentinel, "preserve outside bytes\n");
    if (kind === "bridge") writeFileSync(join(scopeRoot, "mozak.md"), "manual bridge\n");
    if (kind === "legacy") { mkdirSync(join(scopeRoot, ".mozak")); writeFileSync(join(scopeRoot, ".mozak", "legacy"), "legacy bytes\n"); }
    if (kind === "duplicate-id") writeFileSync(g.config, JSON.stringify({ format: "mozak.local/v2", scopes: [g.entries[0], { ...g.entries[1], id: "one" }] }));
    if (kind === "duplicate-root") writeFileSync(g.config, JSON.stringify({ format: "mozak.local/v2", scopes: [g.entries[0], { id: "alias", root: scopeRoot }] }));
    if (kind.endsWith("-link")) symlinkSync(kind === "lock-link" ? outside : sentinel, join(scopeRoot, kind === "graph-link" ? "mozak.json" : kind === "bridge-link" ? "mozak.md" : ".mozak-write-lock"));
    const before = readdirSync(scopeRoot).sort();
    assert.equal(init(g, input, ["bridge", "legacy"].includes(kind) ? 3 : 2).committed, false);
    assert.deepEqual(readdirSync(scopeRoot).sort(), before);
    assert.equal(readFileSync(sentinel, "utf8"), "preserve outside bytes\n");
    assert.equal(readFileSync(join(scopeRoot, "README.md"), "utf8"), "Owner README\n");
    assert.equal(readFileSync(join(scopeRoot, "AGENTS.md"), "utf8"), "Owner agent instructions\n");
    if (kind === "bridge") assert.equal(readFileSync(join(scopeRoot, "mozak.md"), "utf8"), "manual bridge\n");
    if (kind === "legacy") assert.equal(readFileSync(join(scopeRoot, ".mozak", "legacy"), "utf8"), "legacy bytes\n");
  }
});

test("A11: two actual CLI writers sharing one snapshot produce one commit and one stale result", async () => {
  const f = fixture(), expected = readScope(f.entries[0]).snapshot;
  const runWriter = (id: string) => new Promise<{ code: number | null; data: any }>((resolve, reject) => {
    const request = join(f.root, `concurrent-${id}.json`);
    writeFileSync(request, JSON.stringify({ operationId: id, scopeId: "one", expected, action: "propose", payload: { planId: id, content: content(id) } }));
    const child = spawn(process.execPath, [cliPath, "plan", "propose", "--config", f.config, "--scope", "one", "--request", request, "--json"], { timeout: 15000, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "", stderr = "";
    child.stdout.on("data", chunk => { stdout += chunk; }); child.stderr.on("data", chunk => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", code => { try { resolve({ code, data: JSON.parse(stdout) }); } catch { reject(new Error(`CLI output invalid: ${stdout} ${stderr}`)); } });
  });
  const results = await Promise.all([runWriter("writer-a"), runWriter("writer-b")]);
  assert.deepEqual(results.map(r => r.code).sort(), [0, 3]);
  assert.equal(results.filter(r => r.data.committed).length, 1);
  const state = readScope(f.entries[0]).state;
  assert.equal(state.plans.length, 1);
  assert.equal(Object.keys(state.receipts).filter(k => k.startsWith("writer-")).length, 1);
  assert.equal(readScope(f.entries[0]).projectionStatus, "current");
});

test("A02/A03/A04/A05/A08: real CLI reconstructs accepted and amended meaning across lifecycle decisions", () => {
  const f = fixture();
  f.mutate("one", "propose", { planId: "p", content: content("A") });
  f.mutate("one", "propose", { planId: "independent", content: content("Independent") });
  f.decide("one", "p", "approve-direction");
  const accepted = f.plan("one", "p").accepted!;
  f.observe("one", "p", "fact");
  assert.equal(f.plan("one", "p").accepted!.contentDigest, accepted.contentDigest);
  f.mutate("one", "revise", { planId: "p", pendingRevisionId: null, acceptedRevisionId: accepted.id, content: content("B") });
  const b = f.plan("one", "p").pending!.id;
  f.mutate("one", "revise", { planId: "p", pendingRevisionId: b, acceptedRevisionId: accepted.id, content: content("A") });
  const aAgain = f.plan("one", "p").pending!.id;
  assert.notEqual(aAgain, b); assert.notEqual(aAgain, accepted.id);
  assert.equal(f.plan("one", "p").accepted!.content.title, "A");
  const context = f.run(["context", "--scope", "one"]);
  assert.ok(JSON.stringify(context).includes(aAgain));
  assert.ok(JSON.stringify(context).includes(accepted.id));
  assert.ok(JSON.stringify(context).includes('"implementationAuthorized":false'));
  const recovered = context.context.plans.find(p => p.id === "p");
  assert.equal(recovered.accepted.content.title, "A");
  assert.equal(recovered.pending.content.title, "A");
  assert.equal(recovered.observations[0].id, "fact");
  assert.equal(recovered.observations[0].evidence[0].version, "fixture-v1");
  assert.equal(recovered.effectiveDecisions["approve-direction"], accepted.directionDecisionId);
  assert.equal(recovered.permittedNextAction, "owner-review-direction");
  const freshReview = f.run(["review", "show", "--scope", "one", "--plan", "p"]).review;
  assert.equal(freshReview.accepted.content.title, "A");
  assert.equal(freshReview.proposal.id, aAgain);
  assert.equal(freshReview.proposal.content.purpose, accepted.content.purpose);
  f.decide("one", "p", "reject-pending");
  const rejected = f.plan("one", "p").pending!;
  assert.equal(rejected.reviewState, "rejected");
  assert.ok(f.plan("one", "p").decisions.some(d => d.purpose === "reject-pending" && !!d.reason && !!d.recordedAt));
  f.decide("one", "p", "pause");
  assert.equal(f.plan("one", "p").lifecycle.state, "paused");
  f.decide("one", "p", "resume");
  f.decide("one", "p", "reconsider");
  assert.notEqual(f.plan("one", "p").pending!.id, rejected.id);
  assert.equal(f.plan("one", "p").observations.length, 1);
  assert.equal(f.plan("one", "p").implementationAuthorization, null);
});

test("A03/A07: review grants bind purpose and digest, every objective outcome needs evidence, pause blocks completion", () => {
  const f = fixture();
  const c = content(); c.outcomes.push({ ...c.outcomes[0], id: "o2", statement: "Every requirement covered" });
  f.mutate("one", "propose", { planId: "two-outcomes", content: c });
  const pending = f.plan("one", "two-outcomes").pending!;
  const shown = f.run(["review", "show", "--scope", "one", "--plan", "two-outcomes", "--purpose", "approve-direction"]).review;
  const decision = { planId: "two-outcomes", revisionId: pending.id, reviewDigest: shown.reviewDigest, ownerRef: "synthetic-owner:binding", ownerMessageAt: ownerAt, reason: "Binding test" };
  f.mutate("one", "approve-direction", { ...decision, reviewDigest: "a".repeat(64) }, 3);
  f.mutate("one", "reject-pending", decision, 3);
  f.mutate("one", "approve-direction", decision);
  f.observe("one", "two-outcomes", "proof-one");
  const completion = { planId: "two-outcomes", revisionId: f.plan("one", "two-outcomes").accepted!.id, limitations: [] };
  f.mutate("one", "complete", completion, 3);
  f.observe("one", "two-outcomes", "proof-two", "observed", "supports", undefined, "o2");
  f.decide("one", "two-outcomes", "pause");
  f.mutate("one", "complete", completion, 3);
  f.decide("one", "two-outcomes", "resume");
  f.mutate("one", "complete", completion);
  assert.equal(f.plan("one", "two-outcomes").completionRecords[0].outcomeEvidence.length, 2);
});

test("A07: new evidence invalidates subjective approval, and an unverified correction cannot conceal a challenge", () => {
  const f = fixture();
  f.mutate("one", "propose", { planId: "p", content: content("Owner acceptance", "owner") });
  f.decide("one", "p", "approve-direction");
  f.observe("one", "p", "pass");
  f.decide("one", "p", "accept-outcome", "o1");
  f.observe("one", "p", "new-pass");
  const completion = { planId: "p", revisionId: f.plan("one", "p").accepted!.id, limitations: [] };
  f.mutate("one", "complete", completion, 3);
  f.observe("one", "p", "challenge", "observed", "challenges");
  f.observe("one", "p", "unsupported-correction", "unverified", "supports", "challenge");
  const review = f.run(["review", "show", "--scope", "one", "--plan", "p", "--purpose", "accept-outcome", "--outcome", "o1"]);
  assert.ok(JSON.stringify(review).includes("challenge"));
  f.mutate("one", "complete", completion, 3);
  f.decide("one", "p", "accept-outcome", "o1");
  f.mutate("one", "complete", completion);
});

test("A07: inferred evidence cannot complete, subjective evidence produces recoverable owner review", () => {
  const f = fixture();
  f.mutate("one", "propose", { planId: "subjective", content: content("Owner usefulness", "owner") });
  f.decide("one", "subjective", "approve-direction");
  f.observe("one", "subjective", "inference", "inferred");
  const accepted = f.plan("one", "subjective").accepted!;
  const request = { planId: "subjective", revisionId: accepted.id, limitations: [] };
  f.mutate("one", "complete", request, 3);
  assert.equal(f.plan("one", "subjective").lifecycle.state, "open");
  f.observe("one", "subjective", "observed");
  const list = f.run(["plans", "--scope", "one"]);
  assert.ok(JSON.stringify(list).includes('"rowKind":"outcome"'));
  f.mutate("one", "complete", request, 3);
  f.decide("one", "subjective", "accept-outcome", "o1");
  f.mutate("one", "complete", request);
  assert.equal(f.plan("one", "subjective").lifecycle.state, "completed");
  f.observe("one", "subjective", "challenge", "observed", "challenges");
  const after = f.run(["context", "--scope", "one"]);
  assert.ok(JSON.stringify(after).includes('"reviewNeeded":true'));
  assert.equal(f.plan("one", "subjective").lifecycle.state, "completed", "a challenge does not silently revoke lifecycle");
  f.mutate("one", "revise", { planId: "subjective", pendingRevisionId: null, acceptedRevisionId: accepted.id, content: content("Changed criterion", "owner") });
  f.decide("one", "subjective", "approve-direction");
  assert.equal(f.plan("one", "subjective").completionRecords.length, 1, "historical completion survives");
  f.mutate("one", "complete", { ...request, revisionId: f.plan("one", "subjective").accepted!.id }, 3);
});

test("A06/A10: all-scope pages retain every group, invalidate stale cursors and expose missing scope coverage without writes", () => {
  const f = fixture();
  for (let i = 0; i < 6; i++) {
    const scope = i % 2 ? "one" : "two";
    const completed = `completed-${i}`; const open = `open-${i}`; const pending = `pending-${i}`;
    for (const id of [completed, open, pending]) f.mutate(scope, "propose", { planId: id, content: content(id) });
    f.decide(scope, completed, "approve-direction"); f.observe(scope, completed, `proof-${i}`);
    f.mutate(scope, "complete", { planId: completed, revisionId: f.plan(scope, completed).accepted!.id, limitations: [] });
    f.decide(scope, open, "approve-direction");
  }
  const names = ["mozak.json", "mozak.md", "README.md", "AGENTS.md"];
  const before = f.entries.flatMap(e => names.map(n => readFileSync(join(e.root, n))));
  const first = f.run(["plans", "--all"]);
  const groupOrder = Object.keys(first.groups);
  assert.deepEqual(groupOrder, ["completed", "open", "awaiting"]);
  for (const key of groupOrder) { assert.equal(first.groups[key].count, 6); assert.equal(first.groups[key].rows.length, 5); }
  assert.equal(first.uniquePlanCount, 18);
  assert.equal(first.reviewItemCount, 18);
  for (const key of groupOrder) {
    assert.ok(first.groups[key].continuation);
    const second = f.run(["plans", "--continuation", first.groups[key].continuation]);
    assert.equal(second.groups[key].rows.length, 1);
  }
  for (const e of f.entries) {
    f.run(["context", "--scope", e.id]); f.run(["check", "--scope", e.id]);
    f.run(["operation", "--scope", e.id, "--id", `init-${e.id}`]);
    assert.equal(readdirSync(e.root).includes(".mozak-write-lock"), false);
  }
  assert.deepEqual(f.entries.flatMap(e => names.map(n => readFileSync(join(e.root, n)))), before);
  f.mutate("one", "propose", { planId: "later", content: content() });
  f.run(["plans", "--continuation", first.groups.awaiting.continuation], 3);
  writeFileSync(f.config, JSON.stringify({ format: "mozak.local/v2", scopes: [...f.entries, { id: "missing", root: join(f.root, "missing") }] }));
  const partial = f.run(["plans", "--all"], 6);
  assert.equal(partial.coverage.complete, false);
  assert.ok(JSON.stringify(partial).includes("missing"));
});
