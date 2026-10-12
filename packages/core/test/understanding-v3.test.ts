import { test } from "node:test";
import assert from "node:assert/strict";
import { digest, hashBytes, validateScope, validateDiscussion, discussionDigest, validateBounds, validateDecision, validateAnswerInput, validateQuestionInput, ownerMessageKey } from "../src/understanding.ts";

const T = "2026-10-12T08:00:00.000Z";
const T2 = "2026-10-12T09:00:00.000Z";
const D = hashBytes("review");
function bounds(): any { return { summary: "Tiny package", allowedPaths: ["src/format.ts", "test"], excludedActions: ["network"], outcomeChecks: [{ outcomeId: "o", criterion: "Local tests pass" }], limitations: [] }; }
function answer(): any { return { summary: "Only local edits", basis: "owner", ownerRef: "host:answer", ownerMessageAt: T, evidence: [], recordedAt: T }; }
function discussion(): any { return { id: "discussion", updatedAt: T, acceptedRevisionId: "a", pendingRevisionId: null, summary: "Settled package", stage: "ready-for-spec", questions: [{ id: "q", text: "What boundary?", status: "answered", answers: [answer()], reopenings: [] }] }; }
function fixture(): any {
  const content = { title: "Tiny plan", purpose: "Local work", outcomes: [{ id: "o", statement: "Works", acceptance: "objective", criterion: "Tests pass" }], constraints: [], nonGoals: [], rationale: "Requested", questions: [], sources: [] };
  const direction = { id: "direction", purpose: "approve-direction", ownerRef: "host:direction", ownerMessageAt: T, recordedAt: T, planId: "p", revisionId: "pending-original", contentDigest: digest(content), reviewDigest: D, reason: "Approved direction" };
  return { format: "mozak.scope/v3", scope: { id: "s", kind: "project", title: "Scratch", createdAt: T, initialization: { operationId: "init", ownerRef: "host:init", ownerMessageAt: T, recordedAt: T } }, storage: { revision: "storage", updatedAt: T, previousBridge: { exists: false, sha256: null } }, plans: [{ id: "p", createdAt: T, updatedAt: T, accepted: { id: "a", createdAt: T, content, contentDigest: digest(content), acceptedFromRevision: "pending-original", directionDecisionId: "direction" }, pending: null, lifecycle: { state: "open" }, observations: [], decisions: [direction], reasoningLinks: [], completionRecords: [], discussion: null, specifications: [], implementationAuthorizations: [], downstreamSpec: null, implementationAuthorization: null }], connections: [], receipts: {} };
}
function grant(state = fixture()): any {
  const p = state.plans[0];
  const spec = { id: "spec", recordedAt: T, acceptedRevisionId: "a", acceptedContentDigest: p.accepted.contentDigest, path: "docs/spec.md", sha256: hashBytes("# Spec"), byteLength: 6, discussionDigest: null, bounds: bounds(), boundsDigest: digest(bounds()) };
  const decision = { ...p.decisions[0], id: "grant-decision", purpose: "approve-implementation", ownerRef: "host:grant", revisionId: "a", specificationId: "spec", authorizationId: "grant" };
  p.specifications.push(spec); p.downstreamSpec = spec.id;
  p.decisions.push(decision);
  p.implementationAuthorizations.push({ id: "grant", decisionId: decision.id, recordedAt: T, acceptedRevisionId: "a", acceptedContentDigest: p.accepted.contentDigest, specificationId: "spec", specificationDigest: spec.sha256, boundsDigest: spec.boundsDigest });
  p.implementationAuthorization = "grant";
  return state;
}
function revoke(state: any): void {
  const p = state.plans[0];
  p.decisions.push({ ...p.decisions[0], id: "revoke", purpose: "revoke-implementation", ownerRef: "host:revoke", revisionId: "a", authorizationId: "grant" });
  p.implementationAuthorization = null;
  if (p.downstreamSpec === "spec") p.downstreamSpec = null;
}
function advance(state: any): void {
  const p = state.plans[0];
  const content = { ...p.accepted.content, title: "Changed direction" };
  p.decisions.push({ ...p.decisions[0], id: "direction-2", revisionId: "pending-2", ownerRef: "host:direction-2", contentDigest: digest(content) });
  p.accepted = { ...p.accepted, id: "a2", content, contentDigest: digest(content), acceptedFromRevision: "pending-2", directionDecisionId: "direction-2" };
  p.implementationAuthorization = null; p.downstreamSpec = null;
}
const refuses = (fn: () => unknown) => assert.throws(fn);

test("v3 rejects v1 and v2 rather than upgrading and requires all new empty fields", () => {
  assert.doesNotThrow(() => validateScope(fixture()));
  for (const format of ["mozak.scope/v1", "mozak.scope/v2"]) refuses(() => validateScope({ ...fixture(), format }));
  for (const key of ["discussion", "specifications", "implementationAuthorizations"]) { const s = fixture(); delete s.plans[0][key]; refuses(() => validateScope(s)); }
});

test("discussion digest excludes only generated checkpoint identity and update time", () => {
  const d = discussion();
  assert.equal(discussionDigest(d), discussionDigest({ ...d, id: "new", updatedAt: T2 }));
  assert.notEqual(discussionDigest(d), discussionDigest({ ...d, summary: "Changed meaning" }));
  const altered = structuredClone(d); altered.questions[0].answers[0].recordedAt = T2;
  assert.notEqual(discussionDigest(d), discussionDigest(altered));
});

test("discussion and nested records are closed and have bounded UTF-8 text", () => {
  for (const mutate of [
    (d: any) => d.extra = true,
    (d: any) => d.questions[0].authority = true,
    (d: any) => d.questions[0].answers[0].grant = true,
    (d: any) => d.summary = "é".repeat(1001),
    (d: any) => d.questions[0].text = " ",
    (d: any) => d.questions = Array.from({ length: 33 }, (_, n) => ({ ...d.questions[0], id: `q${n}` })),
    (d: any) => d.questions[0].answers = Array.from({ length: 17 }, answer),
    (d: any) => d.questions[0].reopenings = Array.from({ length: 17 }, () => ({ reason: "Again", recordedAt: T })),
  ]) { const d = discussion(); mutate(d); refuses(() => validateDiscussion(d)); }
  assert.doesNotThrow(() => validateDiscussion({ ...discussion(), summary: "é".repeat(1000) }));
});

test("answers require real-shaped owner provenance or inspected evidence, never mixed authority", () => {
  const { recordedAt, ...input } = answer();
  assert.doesNotThrow(() => validateAnswerInput(input));
  refuses(() => validateAnswerInput(answer()));
  refuses(() => validateAnswerInput({ ...input, ownerRef: null }));
  refuses(() => validateAnswerInput({ ...input, ownerMessageAt: "yesterday" }));
  refuses(() => validateAnswerInput({ ...input, basis: "inspection", ownerRef: null, ownerMessageAt: null }));
  const evidence = { id: "e", locator: "src/format.ts", anchor: null, version: null, inspectedAt: T, activity: { kind: "read", description: "Read file" }, result: { verdict: "pass", summary: "Verified" }, limitations: [] };
  assert.doesNotThrow(() => validateAnswerInput({ ...input, basis: "inspection", ownerRef: null, ownerMessageAt: null, evidence: [evidence] }));
  refuses(() => validateAnswerInput({ ...input, basis: "inspection", evidence: [evidence] }));
});

test("question input forbids generated fields, invalid new IDs and empty settled answers", () => {
  const q = { id: null, text: "Boundary?", status: "open", answers: [], reopenReason: null };
  assert.doesNotThrow(() => validateQuestionInput(q));
  refuses(() => validateQuestionInput({ ...q, reopenings: [] }));
  refuses(() => validateQuestionInput({ ...q, reopenReason: "Again" }));
  refuses(() => validateQuestionInput({ ...q, status: "deferred" }));
});

test("reopened questions retain answers but cannot masquerade as ready-for-spec", () => {
  const d = discussion(); d.questions[0].status = "open"; d.stage = "clarifying";
  refuses(() => validateDiscussion(d));
  d.questions[0].reopenings.push({ reason: "Changed assumption", recordedAt: T2 });
  assert.doesNotThrow(() => validateDiscussion(d));
  refuses(() => validateDiscussion({ ...d, stage: "ready-for-spec" }));
});

test("a settled reopened question must retain a new answer for each reopening", () => {
  const d = discussion(); d.questions[0].reopenings.push({ reason: "Changed assumption", recordedAt: T });
  refuses(() => validateDiscussion(d));
  d.questions[0].answers.push({ ...answer(), recordedAt: T2 });
  assert.doesNotThrow(() => validateDiscussion(d));
});

test("bounds reject traversal, absolute paths, globs, duplicate outcomes and hidden fields", () => {
  assert.doesNotThrow(() => validateBounds(bounds()));
  for (const path of ["../outside", "/tmp/file", "a/../file", "C:\\file", "a\\b", "a\0b", "src/*.ts", "src/[ab].ts", "https://example.test/spec.md"]) refuses(() => validateBounds({ ...bounds(), allowedPaths: [path] }));
  refuses(() => validateBounds({ ...bounds(), shell: "run anything" }));
  refuses(() => validateBounds({ ...bounds(), outcomeChecks: [...bounds().outcomeChecks, ...bounds().outcomeChecks] }));
});

test("valid spec and implementation grant bind exact records without filesystem IO", () => {
  assert.doesNotThrow(() => validateScope(grant()));
  for (const change of [
    (p: any) => p.specifications[0].boundsDigest = D,
    (p: any) => p.specifications[0].byteLength = 262145,
    (p: any) => p.specifications[0].path = "spec.txt",
    (p: any) => p.specifications[0].bounds.outcomeChecks = [],
    (p: any) => p.implementationAuthorizations[0].specificationDigest = D,
    (p: any) => p.implementationAuthorizations[0].boundsDigest = D,
    (p: any) => p.implementationAuthorizations[0].decisionId = "missing",
    (p: any) => p.implementationAuthorizations[0].recordedAt = T2,
    (p: any) => p.decisions[1].specificationId = "missing",
    (p: any) => p.implementationAuthorization = "missing",
    (p: any) => p.downstreamSpec = "missing",
  ]) { const s = grant(); change(s.plans[0]); refuses(() => validateScope(s)); }
});

test("implementation decisions are closed and purpose-specific", () => {
  const approval = grant().plans[0].decisions[1];
  for (const extra of [{ outcomeId: "o" }, { evidenceDigest: D }, { challengeIds: [] }, { arbitrary: true }]) refuses(() => validateDecision({ ...approval, ...extra }));
  const missing = { ...approval }; delete missing.authorizationId; refuses(() => validateDecision(missing));
  refuses(() => validateDecision({ ...approval, purpose: "revoke-implementation" }));
  refuses(() => validateDecision({ ...approval, purpose: "pause" }));
});

test("revocation preserves history, clears matching candidate and cannot be undone by pointer restoration", () => {
  const s = grant(); revoke(s); assert.doesNotThrow(() => validateScope(s));
  assert.equal(s.plans[0].specifications.length, 1); assert.equal(s.plans[0].implementationAuthorizations.length, 1);
  const restored = structuredClone(s); restored.plans[0].implementationAuthorization = "grant"; refuses(() => validateScope(restored));
  s.plans[0].downstreamSpec = "spec"; refuses(() => validateScope(s));
});

test("revocation retains a distinct unapproved candidate", () => {
  const s = grant(), p = s.plans[0]; p.specifications.push({ ...p.specifications[0], id: "spec-new" }); p.downstreamSpec = "spec-new";
  revoke(s); assert.doesNotThrow(() => validateScope(s));
});

test("direction change clears authority while historical spec and discussion remain readable", () => {
  const s = grant(); s.plans[0].discussion = discussion(); advance(s);
  assert.doesNotThrow(() => validateScope(s));
  s.plans[0].implementationAuthorization = "grant"; refuses(() => validateScope(s));
});

test("historical descriptor bindings must remain mutually consistent", () => {
  const s = grant(); advance(s); s.plans[0].specifications[0].acceptedContentDigest = D;
  refuses(() => validateScope(s));
});

test("pause survives direction change using the earlier effective pause, not arbitrary old pause", () => {
  const s = grant(), p = s.plans[0];
  p.decisions.push({ ...p.decisions[0], id: "pause", purpose: "pause", revisionId: "a", ownerRef: "host:pause" });
  p.lifecycle = { state: "paused", decisionId: "pause" };
  advance(s); assert.doesNotThrow(() => validateScope(s));
  const resumed = structuredClone(s); resumed.plans[0].decisions.push({ ...p.decisions.at(-1), id: "resume", purpose: "resume", revisionId: "a2", ownerRef: "host:resume" });
  refuses(() => validateScope(resumed));
  const wrong = structuredClone(s); wrong.plans[0].lifecycle.decisionId = "direction"; refuses(() => validateScope(wrong));
});

test("same owner message cannot create another implementation decision", () => {
  const s = grant(); revoke(s); const p = s.plans[0]; p.decisions.at(-1).ownerRef = "host:grant";
  refuses(() => validateScope(s));
});

test("direction confirmation cannot be reused for implementation authorization", () => {
  const s = grant(); s.plans[0].decisions[1].ownerRef = "host:direction";
  refuses(() => validateScope(s));
});

test("save discussion receipt retains exact checkpoint and is purpose-bound", () => {
  const s = fixture(); s.receipts.save = { requestDigest: D, storageRevision: "r", recordedAt: T, result: { action: "save-discussion", ids: ["discussion"], discussion: discussion() } };
  assert.doesNotThrow(() => validateScope(s));
  s.receipts.save.result.action = "approve-implementation"; refuses(() => validateScope(s));
});

test("an effective pause cannot be erased by changing only lifecycle to open", () => {
  const s = grant(), p = s.plans[0];
  p.decisions.push({ ...p.decisions[0], id: "pause", purpose: "pause", revisionId: "a", ownerRef: "host:pause" });
  p.lifecycle = { state: "paused", decisionId: "pause" };
  advance(s); assert.doesNotThrow(() => validateScope(s));
  p.lifecycle = { state: "open" }; refuses(() => validateScope(s));
});

test("implementation owner-message replay is refused across plans in the same scope", () => {
  const s = grant(), other = grant().plans[0];
  other.id = "other"; other.accepted.id = "other-a"; other.accepted.acceptedFromRevision = "other-pending";
  other.decisions.forEach((d: any) => { d.planId = "other"; d.revisionId = d.purpose === "approve-direction" ? "other-pending" : "other-a"; });
  other.specifications[0].acceptedRevisionId = "other-a"; other.implementationAuthorizations[0].acceptedRevisionId = "other-a";
  s.plans.push(other); refuses(() => validateScope(s));
});

test("owner message keys normalize equivalent UTC spelling without rounding precision", () => {
  assert.equal(ownerMessageKey("owner", T), ownerMessageKey("owner", "2026-10-12T08:00:00Z"));
  assert.equal(ownerMessageKey("owner", "2026-10-12T08:00:00.120000Z"), ownerMessageKey("owner", "2026-10-12T08:00:00.12Z"));
  assert.notEqual(ownerMessageKey("owner", "2026-10-12T08:00:00.000001Z"), ownerMessageKey("owner", T));
  assert.notEqual(ownerMessageKey("owner", "2026-10-12T08:00:00.000001Z"), ownerMessageKey("owner", "2026-10-12T08:00:00.000002Z"));
  refuses(() => ownerMessageKey("owner", "2026-10-12T10:00:00+02:00"));
});

test("equivalent owner timestamps cannot bypass direction, revoke or resume purpose separation", () => {
  const sameTime = "2026-10-12T08:00:00Z";
  const direction = grant(); direction.plans[0].decisions[1].ownerRef = "host:direction"; direction.plans[0].decisions[1].ownerMessageAt = sameTime;
  refuses(() => validateScope(direction));
  const revoked = grant(); revoke(revoked); revoked.plans[0].decisions.at(-1).ownerRef = "host:grant"; revoked.plans[0].decisions.at(-1).ownerMessageAt = sameTime;
  refuses(() => validateScope(revoked));
  const resumed = grant(), p = resumed.plans[0];
  p.decisions.push({ ...p.decisions[0], id: "pause", purpose: "pause", revisionId: "a", ownerRef: "host:pause" });
  p.decisions.push({ ...p.decisions[0], id: "resume", purpose: "resume", revisionId: "a", ownerRef: "host:grant", ownerMessageAt: sameTime });
  refuses(() => validateScope(resumed));
  p.decisions.at(-1).ownerRef = "host:fresh-resume";
  assert.doesNotThrow(() => validateScope(resumed));
});

test("equivalent owner timestamps cannot bypass cross-plan implementation replay checks", () => {
  const s = grant(), other = grant().plans[0];
  other.id = "other"; other.accepted.id = "other-a"; other.accepted.acceptedFromRevision = "other-pending";
  other.decisions.forEach((d: any) => { d.planId = "other"; d.revisionId = d.purpose === "approve-direction" ? "other-pending" : "other-a"; d.ownerMessageAt = "2026-10-12T08:00:00Z"; });
  other.specifications[0].acceptedRevisionId = "other-a"; other.implementationAuthorizations[0].acceptedRevisionId = "other-a";
  s.plans.push(other); refuses(() => validateScope(s));
  other.decisions[1].ownerRef = "host:other-fresh-grant";
  assert.doesNotThrow(() => validateScope(s));
});
