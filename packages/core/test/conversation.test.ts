import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { applyMutation, contextView, reviewRows, reviewShow, specificationKey } from "../src/review.ts";
import { discussionDigest } from "../src/understanding.ts";

const NOW = "2026-10-12T09:00:00.000Z", LATER = "2026-10-12T10:00:00.000Z";
let message = 0;
const content = (title = "Export") => ({ title, purpose: "Export reports", outcomes: [{ id: "o", statement: "Export works", acceptance: "objective", criterion: "test passes" }], constraints: [], nonGoals: [], rationale: "Owner request", questions: [], sources: [] });
const empty = () => ({ format: "mozak.scope/v3", scope: { id: "s", kind: "project", title: "Sample", createdAt: NOW, initialization: { operationId: "init", ownerRef: "init-owner", ownerMessageAt: NOW, recordedAt: NOW } }, storage: { revision: "r1", updatedAt: NOW, previousBridge: { exists: false, sha256: null } }, plans: [], connections: [], receipts: {} });
const mutate = (s, action, p, env?, actor = "agent", now = NOW) => applyMutation(s, action, p, actor, now, env).state;
const plan = s => s.plans[0];
const payload = (s, purpose, env?, ownerRef = `test-owner-${++message}`, outcomeId?) => {
  const r = reviewShow(s, "p", purpose, outcomeId, env);
  return { planId: "p", revisionId: r.revisionId, reviewDigest: r.reviewDigest, ownerRef, ownerMessageAt: NOW, reason: "Reviewed exact subject", ...(purpose === "approve-implementation" ? { specificationId: r.specificationId } : {}), ...(purpose === "revoke-implementation" ? { authorizationId: r.authorizationId } : {}), ...(outcomeId ? { outcomeId } : {}) };
};
const decide = (s, purpose, env?, ref?, outcome?) => mutate(s, purpose, payload(s, purpose, env, ref, outcome), env, "owner");
function accepted() { return decide(mutate(empty(), "propose", { planId: "p", content: content() }), "approve-direction"); }
const text = "# Specification\nImplement export, no network.\n";
const attachment = { path: "spec.md", content: text, sha256: createHash("sha256").update(text).digest("hex"), byteLength: Buffer.byteLength(text) };
const bounds = { summary: "Export only", allowedPaths: ["src/export.ts"], excludedActions: ["network"], outcomeChecks: [{ outcomeId: "o", criterion: "export test passes" }], limitations: [] };
const attachmentEnv = { storageUsable: true, specifications: {}, attachment };
const attachPayload = s => ({ planId: "p", acceptedRevisionId: plan(s).accepted.id, path: "spec.md", bounds, discussionDigest: plan(s).discussion ? discussionDigest(plan(s).discussion) : null });
const attach = s => mutate(s, "attach-spec", attachPayload(s), attachmentEnv);
const environment = (s, health = "current") => ({ storageUsable: true, specifications: Object.fromEntries(plan(s).specifications.map(spec => [specificationKey("p", spec.id), { health, content: text }])) });
const handoff = (s, env?) => contextView(s, env).plans[0].handoff;
const grant = s => decide(s, "approve-implementation", environment(s));
const question = (status = "open", answers = []) => ({ id: null, text: "What format?", status, answers, reopenReason: null });
const answer = (summary = "CSV") => ({ summary, basis: "owner", ownerRef: "actual-test-message", ownerMessageAt: NOW, evidence: [] });
const discussionPayload = (s, questions, stage = "clarifying", summary = "Clarifying output") => ({ planId: "p", acceptedRevisionId: plan(s).accepted?.id ?? null, pendingRevisionId: plan(s).pending?.id ?? null, summary, stage, questions });
const inputs = s => plan(s).discussion.questions.map(({ reopenings, ...q }) => ({ ...q, reopenReason: null, answers: q.answers.map(({ recordedAt, ...a }) => a) }));
const save = (s, qs, stage?, summary?, now = NOW) => mutate(s, "save-discussion", discussionPayload(s, qs, stage, summary), undefined, "agent", now);

test("discussion preserves IDs, timestamps, history, reopenings and exact no-op identity", () => {
  let s = save(accepted(), [question("answered", [answer()])], "ready-for-spec");
  const saved = structuredClone(plan(s).discussion);
  const noOp = applyMutation(s, "save-discussion", discussionPayload(s, inputs(s), "ready-for-spec"), "agent", LATER);
  assert.deepEqual(noOp.state, s); assert.deepEqual(noOp.result.discussion, saved);
  for (const qs of [[], [{ ...inputs(s)[0], text: "changed?" }], [{ ...inputs(s)[0], answers: [] }], [{ ...inputs(s)[0], answers: [answer("JSON")] }]]) assert.throws(() => save(s, qs));
  assert.throws(() => save(s, [{ ...inputs(s)[0], status: "open" }]));
  s = save(s, [{ ...inputs(s)[0], status: "open", reopenReason: "Need delimiter decision" }], "clarifying", undefined, LATER);
  assert.equal(plan(s).discussion.questions[0].answers[0].recordedAt, NOW);
  assert.equal(plan(s).discussion.questions[0].reopenings[0].recordedAt, LATER);
  assert.throws(() => save(s, [{ ...inputs(s)[0], status: "answered" }]));
  assert.throws(() => save(s, inputs(s), "ready-for-spec"));
  s = save(s, [{ ...inputs(s)[0], status: "answered", answers: [...inputs(s)[0].answers, answer("CSV with comma")] }], "ready-for-spec");
  assert.equal(plan(s).discussion.questions[0].id, saved.questions[0].id);
  assert.equal(plan(s).discussion.questions[0].answers.length, 2);
  assert.equal(handoff(s).implementationAuthorized, false);
});

test("question IDs, generated fields, answer authority and capacity are closed", () => {
  const s = accepted();
  for (const q of [{ ...question(), id: "caller-generated" }, { ...question(), reopenings: [] }, { ...question(), reopenReason: "new" }, question("answered", [{ ...answer(), recordedAt: NOW }]), question("answered", [{ ...answer(), implementationAuthorization: "yes" }]), question("answered", [{ ...answer(), basis: "inspection", ownerRef: null, ownerMessageAt: null }]), question("answered", [{ ...answer(), ownerRef: null }])]) assert.throws(() => save(s, [q]));
  assert.throws(() => save(s, Array.from({ length: 33 }, () => question())));
  assert.throws(() => save(s, [question("answered", Array.from({ length: 17 }, () => answer()))]));
  assert.throws(() => save(s, [{ ...question(), text: "a".repeat(2001) }]));
});

test("attachment requires separate trusted bytes and current discussion with covered outcomes", () => {
  let s = accepted();
  assert.throws(() => mutate(s, "attach-spec", attachPayload(s)));
  for (const extra of [{ sha256: attachment.sha256 }, { inspection: attachment }, { storageUsable: true }, { implementationAuthorization: "forged" }]) assert.throws(() => mutate(s, "attach-spec", { ...attachPayload(s), ...extra }, attachmentEnv));
  assert.throws(() => mutate(s, "attach-spec", { ...attachPayload(s), bounds: { ...bounds, outcomeChecks: [] } }, attachmentEnv));
  s = save(s, [question()]);
  assert.throws(() => attach(s));
  s = save(s, [{ ...inputs(s)[0], status: "answered", answers: [answer()] }], "ready-for-spec");
  assert.throws(() => mutate(s, "attach-spec", { ...attachPayload(s), discussionDigest: null }, attachmentEnv));
  s = attach(s);
  assert.equal(plan(s).specifications.length, 1); assert.equal(plan(s).implementationAuthorization, null);
  assert.equal(reviewRows(s).awaiting[0].rowKind, "implementation");
  const r = reviewShow(s, "p", "approve-implementation", undefined, environment(s));
  assert.equal(r.specificationContent, text); assert.deepEqual(r.specification.bounds, bounds); assert.equal(r.approvalAvailable, true);
});

test("authority differs from checked eligibility and file restoration never changes identity", () => {
  const s = grant(attach(accepted())), id = plan(s).implementationAuthorization;
  assert.equal(handoff(s).implementationAuthorized, true); assert.equal(handoff(s).executionEligible, false);
  assert.equal(handoff(s, environment(s)).executionEligible, true);
  for (const health of ["changed", "unavailable"]) { assert.equal(handoff(s, environment(s, health)).implementationAuthorized, true); assert.equal(handoff(s, environment(s, health)).executionEligible, false); }
  assert.equal(handoff(s, { ...environment(s), storageUsable: false }).executionEligible, false);
  assert.equal(handoff(s, { storageUsable: true, specifications: { [plan(s).downstreamSpec]: { health: "current" } } }).executionEligible, false);
  assert.equal(handoff(s, environment(s)).authorizationId, id);
});

test("approval fails on agent, stale identity, missing inspection and reused owner message", () => {
  let s = attach(accepted()); const p = payload(s, "approve-implementation", environment(s), "unique-approval");
  assert.throws(() => mutate(s, "approve-implementation", p, environment(s)));
  assert.throws(() => mutate(s, "approve-implementation", p, undefined, "owner"));
  assert.throws(() => mutate(s, "approve-implementation", { ...p, specificationId: "wrong" }, environment(s), "owner"));
  assert.throws(() => mutate(s, "approve-implementation", { ...p, authorizationId: "forged" }, environment(s), "owner"));
  assert.throws(() => mutate(s, "approve-implementation", p, { ...environment(s), specifications: { [specificationKey("p", p.specificationId)]: { health: "current", content: "forged" } } }, "owner"));
  s = mutate(s, "approve-implementation", p, environment(s), "owner");
  assert.throws(() => mutate(s, "approve-implementation", p, environment(s), "owner"));
  assert.throws(() => decide(s, "revoke-implementation", undefined, "unique-approval"));
  assert.equal(reviewRows(s).awaiting.filter(r => r.rowKind === "implementation").length, 0);
});

test("revocation retains history, cannot requeue by read or resume, fresh attachment needed", () => {
  let s = grant(attach(accepted())); const oldSpec = plan(s).downstreamSpec, oldGrant = plan(s).implementationAuthorization;
  s = decide(s, "revoke-implementation");
  assert.equal(plan(s).downstreamSpec, null); assert.equal(plan(s).implementationAuthorization, null);
  assert.equal(plan(s).specifications[0].id, oldSpec); assert.equal(plan(s).implementationAuthorizations[0].id, oldGrant);
  assert.throws(() => reviewShow(s, "p", "approve-implementation"));
  s = decide(decide(s, "pause"), "resume");
  assert.equal(handoff(s, environment(s)).implementationAuthorized, false); assert.equal(reviewRows(s).awaiting.length, 0);
  s = attach(s); assert.notEqual(plan(s).downstreamSpec, oldSpec);
  s = grant(s); assert.notEqual(plan(s).implementationAuthorization, oldGrant);
});

test("distinct candidate survives revocation and never inherits current grant health or authority", () => {
  let s = grant(attach(accepted())); const original = plan(s).downstreamSpec;
  s = attach(s); const newer = plan(s).downstreamSpec;
  const env = { storageUsable: true, specifications: { [specificationKey("p", original)]: { health: "current", content: text }, [specificationKey("p", newer)]: { health: "unavailable" } } };
  assert.equal(handoff(s, env).specificationId, original); assert.equal(handoff(s, env).executionEligible, true);
  assert.equal(reviewShow(s, "p", "approve-implementation", undefined, env).candidateHealth, "unavailable");
  s = decide(s, "revoke-implementation");
  assert.equal(plan(s).downstreamSpec, newer); assert.equal(handoff(s, environment(s)).implementationAuthorized, false);
  assert.equal(reviewRows(s).awaiting[0].id, newer);
});

test("pause survives accepted direction A-B-A and old grant plus confirmation never revive", () => {
  let s = save(accepted(), [question("answered", [answer()])], "ready-for-spec");
  s = grant(attach(s)); const oldGrant = plan(s).implementationAuthorization;
  s = decide(s, "pause"); const pauseId = plan(s).lifecycle.decisionId, oldResume = payload(s, "resume");
  for (const title of ["Different direction", "Export"]) {
    s = mutate(s, "revise", { planId: "p", acceptedRevisionId: plan(s).accepted.id, pendingRevisionId: null, content: content(title) });
    s = decide(s, "approve-direction");
    assert.equal(plan(s).lifecycle.state, "paused"); assert.equal(plan(s).lifecycle.decisionId, pauseId);
    assert.equal(plan(s).implementationAuthorization, null); assert.equal(plan(s).downstreamSpec, null);
    assert.equal(contextView(s).plans[0].discussionStatus, "stale");
    assert.throws(() => mutate(s, "resume", oldResume, undefined, "owner"));
  }
  assert.equal(plan(s).implementationAuthorizations[0].id, oldGrant);
  s = decide(s, "resume"); assert.equal(handoff(s, environment(s)).executionEligible, false);
});

test("pause/resume digests bind exact grant identity, stop operations require no spec IO", () => {
  let s = grant(attach(accepted())); const oldPause = payload(s, "pause");
  s = grant(attach(s)); assert.throws(() => mutate(s, "pause", oldPause, undefined, "owner"));
  s = decide(s, "pause"); assert.equal(handoff(s, environment(s)).implementationAuthorized, true); assert.equal(handoff(s, environment(s)).executionEligible, false);
  const oldResume = payload(s, "resume");
  s = decide(s, "revoke-implementation"); assert.throws(() => mutate(s, "resume", oldResume, undefined, "owner"));
  s = decide(s, "resume"); assert.equal(handoff(s).implementationAuthorized, false);
});

function observe(s, id, relation?, supersedesObservationId?) {
  const evidence = { id: `${id}-e`, locator: "test.ts", anchor: null, version: null, inspectedAt: NOW, activity: { kind: "run", description: "test" }, result: { verdict: "pass", summary: "passed" }, limitations: [] };
  return mutate(s, "observe", { planId: "p", observation: { id, classification: "observed", summary: id, evidence: [evidence], ...(supersedesObservationId ? { supersedesObservationId } : {}) }, ...(relation ? { reasoningLinks: [{ id: `${id}-link`, relation, from: { planId: "p", revisionId: null, kind: "observation", id }, to: { planId: "p", revisionId: plan(s).accepted.id, kind: "outcome", id: "o" }, rationale: relation }] } : {}) });
}

test("material review predicate acknowledges exact supported challenge, not raw reviewNeeded", () => {
  let s = attach(accepted());
  s = observe(s, "challenge", "challenges");
  assert.throws(() => grant(s), e => e.code === "owner-review-required");
  assert.throws(() => decide(s, "accept-outcome", undefined, undefined, "o"));
  s = observe(s, "support", "supports");
  assert.throws(() => grant(s), e => e.code === "owner-review-required");
  s = decide(s, "accept-outcome", undefined, undefined, "o");
  assert.equal(contextView(s).plans[0].reviewNeeded, true);
  s = grant(s); assert.equal(handoff(s, environment(s)).executionEligible, true);
  s = observe(s, "unrelated"); assert.equal(handoff(s, environment(s)).executionEligible, true);
  s = observe(s, "new-challenge", "challenges"); assert.equal(handoff(s, environment(s)).executionEligible, false);
  s = observe(s, "fixed", undefined, "new-challenge");
  assert.equal(handoff(s, environment(s)).executionEligible, true);
});

test("unrelated observation and pending proposal preserve review digest and current grant", () => {
  let s = attach(accepted()); const before = payload(s, "approve-implementation", environment(s));
  s = observe(s, "unrelated");
  assert.equal(reviewShow(s, "p", "approve-implementation").reviewDigest, before.reviewDigest);
  s = mutate(s, "approve-implementation", before, environment(s), "owner");
  s = mutate(s, "revise", { planId: "p", acceptedRevisionId: plan(s).accepted.id, pendingRevisionId: null, content: content("pending") });
  assert.equal(handoff(s, environment(s)).executionEligible, true);
});

test("completed plans retain authority history but cannot execute or queue another request", () => {
  let s = grant(attach(accepted())); s = observe(s, "support", "supports");
  s = mutate(s, "complete", { planId: "p", revisionId: plan(s).accepted.id });
  assert.equal(handoff(s, environment(s)).implementationAuthorized, true); assert.equal(handoff(s, environment(s)).executionEligible, false);
  s = attach(s); assert.equal(reviewRows(s).awaiting.filter(r => r.rowKind === "implementation").length, 0);
  assert.throws(() => grant(s));
});

test("direction approval message cannot double as implementation permission", () => {
  const s = attach(accepted());
  assert.throws(() => decide(s, "approve-implementation", environment(s), plan(s).decisions[0].ownerRef));
});

test("same-byte attachment changes review identity, stale confirmations cannot approve its replacement", () => {
  let s = attach(accepted()); const old = payload(s, "approve-implementation", environment(s));
  s = attach(s);
  assert.equal(plan(s).specifications[0].sha256, plan(s).specifications[1].sha256);
  assert.notEqual(reviewShow(s, "p", "approve-implementation").reviewDigest, old.reviewDigest);
  assert.throws(() => mutate(s, "approve-implementation", old, environment(s), "owner"));
});

test("stale discussion is readable but attachment requires explicit current rebase", () => {
  let s = save(accepted(), [question("answered", [answer()])], "ready-for-spec");
  const oldPayload = discussionPayload(s, inputs(s), "ready-for-spec");
  s = mutate(s, "revise", { planId: "p", acceptedRevisionId: plan(s).accepted.id, pendingRevisionId: null, content: content("New title") });
  assert.equal(contextView(s).plans[0].discussionStatus, "stale"); assert.throws(() => attach(s));
  assert.throws(() => mutate(s, "save-discussion", oldPayload));
  const oldAnswer = plan(s).discussion.questions[0].answers[0];
  s = save(s, inputs(s), "ready-for-spec", "Title changed, output format remains CSV");
  assert.equal(contextView(s).plans[0].discussionStatus, "current");
  assert.deepEqual(plan(s).discussion.questions[0].answers[0], oldAnswer);
  assert.doesNotThrow(() => attach(s));
});

test("mixed awaiting rows retain five-part unique keys and paused implementation annotation", () => {
  let s = attach(accepted());
  s = observe(s, "support", "supports"); s = observe(s, "challenge", "challenges");
  s = mutate(s, "revise", { planId: "p", acceptedRevisionId: plan(s).accepted.id, pendingRevisionId: null, content: content("Pending") });
  s = decide(s, "pause");
  const rows = reviewRows(s).awaiting;
  assert.deepEqual(new Set(rows.map(r => r.rowKind)), new Set(["implementation", "pending", "outcome"]));
  assert.equal(rows.find(r => r.rowKind === "implementation").paused, true);
  assert.equal(new Set(rows.map(r => r.compositeKey)).size, rows.length);
  for (const r of rows) assert.equal(JSON.parse(r.compositeKey).length, 5);
  assert.deepEqual(rows.map(r => r.compositeKey), [...rows.map(r => r.compositeKey)].sort());
});
