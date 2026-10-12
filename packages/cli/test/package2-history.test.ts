import { test, after } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { readScope } from "../../core/src/scope-store.ts";
import { loadInventory } from "../../core/src/scope-index.ts";

// B03 through the real built CLI. Clarification checkpoint: null-ID questions get core-assigned IDs, answers append
// by ID, a settled question reopens only with a reason, and the answer prefix and reopening history are kept.
// Every owner reference is a synthetic fixture value, never a real owner message.

const scratch = process.env.JCODE_SCRATCH_DIR ?? process.env.TMPDIR;
if (!scratch) throw new Error("scratch directory required");
const roots: string[] = [];
after(() => { for (const root of roots) rmSync(root, { recursive: true, force: true }); });
const cliPath = fileURLToPath(new URL("../dist/index.js", import.meta.url));
const ownerAt = "2026-10-12T08:00:00.000Z";
const OWNER = { basis: "owner", ownerRef: "synthetic-owner:fixture", ownerMessageAt: ownerAt, evidence: [] };

const content = {
  title: "Clarify formatter",
  purpose: "Keep agreed meaning",
  outcomes: [{ id: "o1", statement: "Formatter choice is recorded", acceptance: "owner", criterion: "Owner accepts" }],
  constraints: [],
  nonGoals: [],
  rationale: "Avoid repeated interviews",
  questions: [],
  sources: [{ id: "source", locator: "synthetic:source", anchor: null, observedAt: ownerAt, version: "fixture-v1", limitations: ["Synthetic fixture"] }],
};

function fixture() {
  const root = mkdtempSync(join(scratch!, "mozak-history-"));
  roots.push(root);
  const path = join(root, "one");
  mkdirSync(path);
  writeFileSync(join(path, "README.md"), "# readme\n");
  writeFileSync(join(path, "AGENTS.md"), "# agents\n");
  const config = join(root, "inventory.json");
  writeFileSync(config, JSON.stringify({ format: "mozak.local/v2", scopes: [{ id: "one", root: "./one" }] }));
  let seq = 0;
  const run = (args: string[]) => spawnSync(process.execPath, ["--no-warnings", cliPath, ...args, "--config", config, "--json"], { encoding: "utf8", timeout: 15000 });
  const request = (args: string[], body: object) => {
    const file = join(root, `request-${seq++}.json`);
    writeFileSync(file, JSON.stringify(body));
    return run([...args, "--request", file]);
  };
  const snapshot = () => JSON.parse(run(["context", "--scope", "one"]).stdout).snapshot;
  const plan = (id: string) => readScope(loadInventory(config).scopes[0]).state.plans.find((p) => p.id === id)!;
  const discuss = (payload: object, label: string) =>
    request(["discussion", "save", "--scope", "one"], { operationId: `op-${label}`, scopeId: "one", expected: snapshot(), action: "save-discussion", payload });
  return { root, config, run, request, snapshot, plan, discuss };
}

test("B03: question IDs are assigned, answers append by ID, reopen needs a reason, and history is kept", () => {
  const f = fixture();
  const init = f.request(["scope", "init", "--scope", "one"], { operationId: "init-one", scopeId: "one", kind: "project", title: "one", expectedAbsent: { graph: true, bridge: true }, ownerRef: "synthetic-owner:init", ownerMessageAt: ownerAt });
  assert.equal(init.status, 0, init.stdout + init.stderr);
  const proposed = f.request(["plan", "propose", "--scope", "one"], { operationId: "op-propose", scopeId: "one", expected: f.snapshot(), action: "propose", payload: { planId: "plan-a", content } });
  assert.equal(proposed.status, 0, proposed.stdout + proposed.stderr);
  const accepted = f.request(["review", "decide", "--scope", "one"], { operationId: "op-accept", scopeId: "one", expected: f.snapshot(), action: "approve-direction", payload: { planId: "plan-a", revisionId: f.plan("plan-a").pending!.id, reviewDigest: JSON.parse(f.run(["review", "show", "--scope", "one", "--plan", "plan-a", "--purpose", "approve-direction"]).stdout).review.reviewDigest, ownerRef: OWNER.ownerRef, ownerMessageAt: ownerAt, reason: "Synthetic owner direction for fixture" } });
  assert.equal(accepted.status, 0, accepted.stdout + accepted.stderr);
  const acceptedId = f.plan("plan-a").accepted!.id;
  const base = { planId: "plan-a", acceptedRevisionId: acceptedId, pendingRevisionId: null, stage: "clarifying" };

  // 1. A null ID creates a new question. Core assigns its ID, and the result returns it in input order.
  const created = f.discuss({ ...base, summary: "Open", questions: [{ id: null, text: "Which formatter?", status: "open", answers: [], reopenReason: null }] }, "create");
  assert.equal(created.status, 0, created.stdout + created.stderr);
  const qid = f.plan("plan-a").discussion!.questions[0]!.id;
  assert.match(qid, /^[0-9a-f-]{36}$/, "core assigned a generated ID");

  // 2. Settle the question with an answer, referenced by the returned ID.
  const settled = f.discuss({ ...base, summary: "Settled", questions: [{ id: qid, text: "Which formatter?", status: "answered", answers: [{ summary: "Use the project formatter", ...OWNER }], reopenReason: null }] }, "settle");
  assert.equal(settled.status, 0, settled.stdout + settled.stderr);

  // 3. Reopening a settled question keeps its answer and records the reason.
  const first = f.plan("plan-a").discussion!.questions[0]!.answers[0]!;
  const reopened = f.discuss({ ...base, summary: "Reopened", questions: [{ id: qid, text: "Which formatter?", status: "open", answers: [{ summary: first.summary, ...OWNER }], reopenReason: "Owner wants to revisit" }] }, "reopen");
  assert.equal(reopened.status, 0, reopened.stdout + reopened.stderr);
  const afterReopen = f.plan("plan-a").discussion!.questions[0]!;
  assert.equal(afterReopen.status, "open");
  assert.equal(afterReopen.answers.length, 1, "the prior answer is retained");
  assert.equal(afterReopen.reopenings.length, 1, "the reopening is recorded");
  assert.equal(afterReopen.reopenings[0]!.reason, "Owner wants to revisit");

  // 4. Re-answering needs the exact stored prefix plus one additional answer.
  const prefix = afterReopen.answers.map(({ recordedAt: _t, ...a }) => a);
  const reanswered = f.discuss({ ...base, summary: "Re-answered", questions: [{ id: qid, text: "Which formatter?", status: "answered", answers: [...prefix, { summary: "Use prettier, confirmed", ...OWNER }], reopenReason: null }] }, "reanswer");
  assert.equal(reanswered.status, 0, reanswered.stdout + reanswered.stderr);
  const final = f.plan("plan-a").discussion!.questions[0]!;
  assert.equal(final.answers.length, 2, "the new answer appends and the old one stays");
  assert.equal(final.reopenings.length, 1, "the earlier reopening is still recorded");
});

test("B03 positive controls: refused discussion changes commit nothing and keep stored bytes", () => {
  const f = fixture();
  f.request(["scope", "init", "--scope", "one"], { operationId: "init-one", scopeId: "one", kind: "project", title: "one", expectedAbsent: { graph: true, bridge: true }, ownerRef: "synthetic-owner:init", ownerMessageAt: ownerAt });
  f.request(["plan", "propose", "--scope", "one"], { operationId: "op-propose", scopeId: "one", expected: f.snapshot(), action: "propose", payload: { planId: "plan-a", content } });
  const review = JSON.parse(f.run(["review", "show", "--scope", "one", "--plan", "plan-a", "--purpose", "approve-direction"]).stdout).review;
  f.request(["review", "decide", "--scope", "one"], { operationId: "op-accept", scopeId: "one", expected: f.snapshot(), action: "approve-direction", payload: { planId: "plan-a", revisionId: f.plan("plan-a").pending!.id, reviewDigest: review.reviewDigest, ownerRef: OWNER.ownerRef, ownerMessageAt: ownerAt, reason: "Synthetic owner direction for fixture" } });
  const acceptedId = f.plan("plan-a").accepted!.id;
  const base = { planId: "plan-a", acceptedRevisionId: acceptedId, pendingRevisionId: null, stage: "clarifying", summary: "Probe" };
  const seeded = f.discuss({ ...base, questions: [{ id: null, text: "Which formatter?", status: "answered", answers: [{ summary: "Use the project formatter", ...OWNER }], reopenReason: null }] }, "seed");
  assert.equal(seeded.status, 0, seeded.stdout + seeded.stderr);
  const q = f.plan("plan-a").discussion!.questions[0]!;
  const before = JSON.stringify(f.plan("plan-a").discussion);

  // Drop the stored answer history: the prefix must be kept.
  const dropped = f.discuss({ ...base, questions: [{ id: q.id, text: q.text, status: "answered", answers: [{ summary: "Different", ...OWNER }], reopenReason: null }] }, "drop");
  assert.equal(dropped.status, 2, "dropped answer history is refused");
  assert.equal(JSON.parse(dropped.stdout).committed, false);

  // Reopen a settled question with no reason: the reason rule refuses it.
  const noReason = f.discuss({ ...base, questions: [{ id: q.id, text: q.text, status: "open", answers: q.answers.map(({ recordedAt: _t, ...a }) => a), reopenReason: null }] }, "noreason");
  assert.equal(noReason.status, 2, "reopen without a reason is refused");
  assert.match(noReason.stdout, /reopenReason required/);

  // Drop an existing question entirely: refused.
  const dropQ = f.discuss({ ...base, questions: [] }, "dropq");
  assert.equal(dropQ.status, 2);
  assert.match(dropQ.stdout, /existing questions cannot be dropped/);

  // Invent a question ID that core never issued: refused as a stale reference.
  const invented = f.discuss({ ...base, questions: [{ id: "00000000-0000-4000-8000-000000000000", text: "x", status: "open", answers: [], reopenReason: null }] }, "invent");
  assert.equal(invented.status, 3);
  assert.match(invented.stdout, /must name a retained question/);

  assert.equal(JSON.stringify(f.plan("plan-a").discussion), before, "no refused change altered the stored checkpoint");
});
