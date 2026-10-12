import { test } from "node:test";
import assert from "node:assert/strict";
import { DomainError } from "../src/errors.ts";
import {
  MAX_REQUEST_BYTES,
  MAX_SCOPE_BYTES,
  assertClosed,
  canonical,
  digest,
  evidenceDigest,
  hashBytes,
  isDigest,
  isObject,
  isUtcTimestamp,
  newRevision,
  validateContent,
  validateDecision,
  validateObservation,
  validateScope,
} from "../src/understanding.ts";

const T0 = "2026-10-12T08:00:00.000Z";
const T1 = "2026-10-12T08:05:00.000Z";
const REVIEW = hashBytes("review-digest-fixture");

function expectCode(fn: () => unknown, code: string) {
  assert.throws(fn, (err: unknown) => err instanceof DomainError && err.code === code);
}

function content(): any {
  return {
    title: "Plan one",
    purpose: "Show the direction",
    outcomes: [{ id: "o1", statement: "Objective result", acceptance: "objective", criterion: "tests pass" }],
    constraints: [{ id: "c1", text: "stay local" }],
    nonGoals: ["no network"],
    rationale: "Owner asked for it",
    questions: [],
    sources: [{ id: "src1", locator: "README.md", anchor: null, observedAt: T0, version: null, limitations: [] }],
  };
}

function evidence(id: string): any {
  return {
    id,
    locator: "README.md",
    anchor: null,
    version: null,
    inspectedAt: T1,
    activity: { kind: "read", description: "read readme" },
    result: { verdict: "pass", summary: "present" },
    limitations: [],
  };
}

function observation(id: string, ev: any[] = [evidence(`ev-${id}`)], classification = "observed"): any {
  return { id, recordedAt: T1, classification, summary: "fact", evidence: ev };
}

function approveDecision(c: any): any {
  return {
    id: "dec-approve",
    purpose: "approve-direction",
    ownerRef: "host:session-1/message-7",
    ownerMessageAt: T0,
    recordedAt: T0,
    planId: "plan-1",
    revisionId: "rev-p",
    contentDigest: digest(c),
    reviewDigest: REVIEW,
    reason: "owner approved direction",
  };
}

function makeScope(): any {
  const c = content();
  const plan = {
    id: "plan-1",
    createdAt: T0,
    updatedAt: T1,
    accepted: {
      id: "rev-a",
      createdAt: T0,
      content: c,
      contentDigest: digest(c),
      acceptedFromRevision: "rev-p",
      directionDecisionId: "dec-approve",
    },
    pending: null,
    lifecycle: { state: "open" },
    observations: [],
    decisions: [approveDecision(c)],
    reasoningLinks: [],
    completionRecords: [],
    downstreamSpec: null,
    implementationAuthorization: null,
  };
  return {
    format: "mozak.scope/v2",
    scope: {
      id: "scope-1",
      kind: "project",
      title: "Scope one",
      createdAt: T0,
      initialization: { operationId: "op-init", ownerRef: "host:session-1/message-1", ownerMessageAt: T0, recordedAt: T0 },
    },
    storage: { revision: "r1", updatedAt: T0, previousBridge: { exists: false, sha256: null } },
    plans: [plan],
    connections: [],
    receipts: {
      "op-init": {
        requestDigest: hashBytes("request"),
        storageRevision: "r1",
        recordedAt: T0,
        result: { action: "init", ids: ["scope-1"] },
      },
    },
  };
}

// canonical bytes and digests

test("canonical sorts keys recursively, uses two spaces, keeps array order, ends with newline", () => {
  const out = canonical({ b: 1, a: { d: [3, 1, 2], c: null } });
  assert.equal(out, '{\n  "a": {\n    "c": null,\n    "d": [\n      3,\n      1,\n      2\n    ]\n  },\n  "b": 1\n}\n');
});

test("canonical omits undefined object properties but refuses undefined array items", () => {
  assert.equal(canonical({ a: undefined, b: 1 }), '{\n  "b": 1\n}\n');
  expectCode(() => canonical([undefined]), "invalid-model");
});

test("canonical refuses non-finite numbers, lone surrogates and non-plain objects", () => {
  expectCode(() => canonical({ n: Number.NaN }), "invalid-model");
  expectCode(() => canonical({ n: Infinity }), "invalid-model");
  expectCode(() => canonical({ s: "\uD800" }), "invalid-model");
  expectCode(() => canonical({ d: new Date(0) }), "invalid-model");
});

test("canonical handles a __proto__ own key without changing the prototype", () => {
  const parsed = JSON.parse('{"__proto__": {"polluted": true}, "a": 1}');
  const out = canonical(parsed);
  assert.equal(out.includes('"polluted"'), true);
  assert.equal(({} as any).polluted, undefined);
});

test("hashBytes matches known SHA-256 vectors and digest is key-order independent", () => {
  assert.equal(hashBytes(""), "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
  assert.equal(hashBytes("abc"), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  assert.equal(digest({ a: 1, b: 2 }), digest({ b: 2, a: 1 }));
  assert.equal(digest({ a: 1 }), hashBytes(canonical({ a: 1 })));
  assert.equal(isDigest(digest("x")), true);
  assert.equal(isDigest("ABC"), false);
});

test("size limits are the approved byte values", () => {
  assert.equal(MAX_REQUEST_BYTES, 1048576);
  assert.equal(MAX_SCOPE_BYTES, 4194304);
});

test("UTC timestamps must be RFC 3339 with Z and a real date", () => {
  assert.equal(isUtcTimestamp(T0), true);
  assert.equal(isUtcTimestamp("2026-10-12T08:00:00Z"), true);
  assert.equal(isUtcTimestamp("2026-10-12T10:00:00+02:00"), false);
  assert.equal(isUtcTimestamp("2026-02-30T08:00:00.000Z"), false);
  assert.equal(isUtcTimestamp("yesterday"), false);
});

test("isObject is true only for plain objects", () => {
  assert.equal(isObject({}), true);
  assert.equal(isObject(Object.create(null)), true);
  assert.equal(isObject([]), false);
  assert.equal(isObject(null), false);
  assert.equal(isObject(new Date()), false);
});

test("assertClosed reports path for missing and unknown keys", () => {
  assert.throws(() => assertClosed({ a: 1 }, "x", ["a", "b"]), (e: any) => e instanceof DomainError && /x\.b/.test(e.message));
  assert.throws(() => assertClosed({ a: 1, z: 2 }, "x", ["a"]), (e: any) => e instanceof DomainError && /x\.z/.test(e.message));
  assert.doesNotThrow(() => assertClosed({ a: 1 }, "x", ["a"], ["c"]));
});

// content

test("validateContent accepts a valid fixture", () => {
  assert.doesNotThrow(() => validateContent(content()));
});

test("validateContent rejects unknown fields, empty text, empty outcomes and bad enums", () => {
  const extra = content();
  extra.extra = true;
  expectCode(() => validateContent(extra), "invalid-model");

  const empty = content();
  empty.title = "   ";
  expectCode(() => validateContent(empty), "invalid-model");

  const noOutcomes = content();
  noOutcomes.outcomes = [];
  expectCode(() => validateContent(noOutcomes), "invalid-model");

  const badAcceptance = content();
  badAcceptance.outcomes[0].acceptance = "maybe";
  expectCode(() => validateContent(badAcceptance), "invalid-model");
});

test("validateContent rejects duplicate outcome IDs and non-UTC source times", () => {
  const dup = content();
  dup.outcomes.push({ ...dup.outcomes[0], statement: "again" });
  expectCode(() => validateContent(dup), "duplicate-id");

  const badTime = content();
  badTime.sources[0].observedAt = "2026-10-12T10:00:00+02:00";
  expectCode(() => validateContent(badTime), "invalid-model");
});

test("validateContent treats a __proto__ key as an unknown field", () => {
  const polluted = JSON.parse(JSON.stringify(content()));
  Object.defineProperty(polluted, "__proto__", { value: { x: 1 }, enumerable: true, writable: true, configurable: true });
  assert.equal(Object.getPrototypeOf(polluted), Object.prototype);
  expectCode(() => validateContent(polluted), "invalid-model");
});

// observations and decisions

test("observed claims need evidence, inferred and unverified may report none", () => {
  assert.doesNotThrow(() => validateObservation(observation("obs-1")));
  expectCode(() => validateObservation(observation("obs-1", [])), "invalid-model");
  assert.doesNotThrow(() => validateObservation(observation("obs-2", [], "inferred")));
  assert.doesNotThrow(() => validateObservation(observation("obs-3", [], "unverified")));
});

test("evidence verdict and activity kind are enums", () => {
  const bad = observation("obs-1");
  bad.evidence[0].result.verdict = "maybe";
  expectCode(() => validateObservation(bad), "invalid-model");
  const badKind = observation("obs-1");
  badKind.evidence[0].activity.kind = "execute";
  expectCode(() => validateObservation(badKind), "invalid-model");
});

test("decisions require a reason and only accept-outcome may carry outcome fields", () => {
  const c = content();
  assert.doesNotThrow(() => validateDecision(approveDecision(c)));
  const noReason = approveDecision(c);
  noReason.reason = "";
  expectCode(() => validateDecision(noReason), "invalid-model");
  const stray = approveDecision(c);
  stray.outcomeId = "o1";
  expectCode(() => validateDecision(stray), "invalid-model");
});

// scope validation

test("validateScope accepts a complete valid fixture", () => {
  assert.doesNotThrow(() => validateScope(makeScope()));
});

test("validateScope refuses format 1, unknown format and nonempty capabilities as unsupported", () => {
  const v1 = makeScope();
  v1.format = "mozak.scope/v1";
  expectCode(() => validateScope(v1), "unsupported-format");

  const conn = makeScope();
  conn.connections = [{ id: "edge-1" }];
  expectCode(() => validateScope(conn), "unsupported-capability");

  const auth = makeScope();
  auth.plans[0].implementationAuthorization = { id: "grant" };
  expectCode(() => validateScope(auth), "unsupported-capability");

  const spec = makeScope();
  spec.plans[0].downstreamSpec = { locator: "x" };
  expectCode(() => validateScope(spec), "unsupported-capability");
});

test("validateScope rejects a plan with neither accepted nor pending content", () => {
  const s = makeScope();
  s.plans[0].accepted = null;
  s.plans[0].lifecycle = { state: "unaccepted" };
  expectCode(() => validateScope(s), "invalid-model");
});

test("validateScope detects accepted content whose digest does not match", () => {
  const s = makeScope();
  s.plans[0].accepted.contentDigest = hashBytes("other");
  expectCode(() => validateScope(s), "digest-mismatch");
});

test("validateScope requires the accepted direction decision to bind digest and source revision", () => {
  const missing = makeScope();
  missing.plans[0].decisions = [];
  expectCode(() => validateScope(missing), "invalid-reference");

  const wrongDigest = makeScope();
  wrongDigest.plans[0].decisions[0].contentDigest = hashBytes("wrong");
  expectCode(() => validateScope(wrongDigest), "digest-mismatch");

  const wrongRevision = makeScope();
  wrongRevision.plans[0].decisions[0].revisionId = "rev-other";
  expectCode(() => validateScope(wrongRevision), "invalid-reference");
});

test("duplicate plan IDs and duplicate IDs across record kinds are refused", () => {
  const dupPlan = makeScope();
  dupPlan.plans.push(structuredClone(dupPlan.plans[0]));
  expectCode(() => validateScope(dupPlan), "duplicate-id");

  const dupObs = makeScope();
  dupObs.plans[0].observations = [observation("dec-approve")];
  expectCode(() => validateScope(dupObs), "duplicate-id");
});

test("pending revision base must match the current accepted revision, and a new plan has null base", () => {
  const c2 = content();
  c2.purpose = "Amended purpose";
  const pendingOk = makeScope();
  pendingOk.plans[0].pending = {
    id: "rev-p2",
    createdAt: T1,
    content: c2,
    contentDigest: digest(c2),
    baseAcceptedRevision: "rev-a",
    baseAcceptedDigest: digest(content()),
    reviewState: "awaiting",
    rejectionDecisionId: null,
  };
  assert.doesNotThrow(() => validateScope(pendingOk));

  const wrongBase = structuredClone(pendingOk);
  wrongBase.plans[0].pending.baseAcceptedRevision = "rev-old";
  expectCode(() => validateScope(wrongBase), "invalid-reference");

  const nullBaseWithAccepted = structuredClone(pendingOk);
  nullBaseWithAccepted.plans[0].pending.baseAcceptedRevision = null;
  nullBaseWithAccepted.plans[0].pending.baseAcceptedDigest = null;
  expectCode(() => validateScope(nullBaseWithAccepted), "invalid-model");

  const awaitingWithRejection = structuredClone(pendingOk);
  awaitingWithRejection.plans[0].pending.rejectionDecisionId = "dec-x";
  expectCode(() => validateScope(awaitingWithRejection), "invalid-model");
});

test("rejected pending revision needs a reject-pending decision bound to its digest", () => {
  const c2 = content();
  c2.purpose = "Rejected purpose";
  const s = makeScope();
  s.plans[0].pending = {
    id: "rev-p2",
    createdAt: T1,
    content: c2,
    contentDigest: digest(c2),
    baseAcceptedRevision: "rev-a",
    baseAcceptedDigest: digest(content()),
    reviewState: "rejected",
    rejectionDecisionId: "dec-reject",
  };
  s.plans[0].decisions.push({
    id: "dec-reject",
    purpose: "reject-pending",
    ownerRef: "host:session-1/message-9",
    ownerMessageAt: T1,
    recordedAt: T1,
    planId: "plan-1",
    revisionId: "rev-p2",
    contentDigest: digest(c2),
    reviewDigest: REVIEW,
    reason: "too broad",
  });
  assert.doesNotThrow(() => validateScope(s));
  s.plans[0].decisions[1].contentDigest = hashBytes("x");
  expectCode(() => validateScope(s), "digest-mismatch");
});

test("lifecycle tags match their references", () => {
  const paused = makeScope();
  paused.plans[0].lifecycle = { state: "paused", decisionId: "dec-pause" };
  expectCode(() => validateScope(paused), "invalid-reference");

  const completed = makeScope();
  completed.plans[0].lifecycle = { state: "completed", completionId: "cmp-x" };
  expectCode(() => validateScope(completed), "invalid-reference");

  const unacceptedWithAccepted = makeScope();
  unacceptedWithAccepted.plans[0].lifecycle = { state: "unaccepted" };
  expectCode(() => validateScope(unacceptedWithAccepted), "invalid-model");
});

test("reasoning links connect observations to outcomes and refuse dangling current refs", () => {
  const s = makeScope();
  s.plans[0].observations = [observation("obs-1")];
  s.plans[0].reasoningLinks = [
    {
      id: "link-1",
      relation: "supports",
      from: { planId: "plan-1", revisionId: null, kind: "observation", id: "obs-1" },
      to: { planId: "plan-1", revisionId: "rev-a", kind: "outcome", id: "o1" },
      rationale: "test passed",
    },
  ];
  assert.doesNotThrow(() => validateScope(s));

  s.plans[0].reasoningLinks[0].from.id = "obs-missing";
  expectCode(() => validateScope(s), "invalid-reference");

  s.plans[0].reasoningLinks[0].from.id = "obs-1";
  s.plans[0].reasoningLinks[0].to.id = "o-missing";
  expectCode(() => validateScope(s), "invalid-reference");
});

test("a link to a superseded revision is visible but unresolved, not an error", () => {
  const s = makeScope();
  s.plans[0].observations = [observation("obs-1")];
  s.plans[0].reasoningLinks = [
    {
      id: "link-old",
      relation: "challenges",
      from: { planId: "plan-1", revisionId: null, kind: "observation", id: "obs-1" },
      to: { planId: "plan-1", revisionId: "rev-superseded", kind: "outcome", id: "o-gone" },
      rationale: "old direction",
    },
  ];
  assert.doesNotThrow(() => validateScope(s));
});

test("a superseding observation must reference an existing observation", () => {
  const s = makeScope();
  const corrected = observation("obs-2");
  corrected.supersedesObservationId = "obs-missing";
  s.plans[0].observations = [observation("obs-1"), corrected];
  expectCode(() => validateScope(s), "invalid-reference");
});

test("completion records must bind outcome criterion and evidence digest and cover every accepted outcome", () => {
  const c = content();
  const ev = evidence("ev-1");
  const s = makeScope();
  s.plans[0].observations = [observation("obs-1", [ev])];
  s.plans[0].completionRecords = [
    {
      id: "cmp-1",
      acceptedRevisionId: "rev-a",
      recordedAt: T1,
      outcomeEvidence: [
        {
          outcomeId: "o1",
          criterionDigest: digest(c.outcomes[0].criterion),
          evidenceIds: ["ev-1"],
          evidenceDigest: evidenceDigest([ev]),
          result: "pass",
        },
      ],
      ownerDecisionIds: [],
      limitations: [],
    },
  ];
  s.plans[0].lifecycle = { state: "completed", completionId: "cmp-1" };
  assert.doesNotThrow(() => validateScope(s));

  const badDigest = structuredClone(s);
  badDigest.plans[0].completionRecords[0].outcomeEvidence[0].evidenceDigest = hashBytes("changed");
  expectCode(() => validateScope(badDigest), "digest-mismatch");

  const badCriterion = structuredClone(s);
  badCriterion.plans[0].completionRecords[0].outcomeEvidence[0].criterionDigest = hashBytes("other");
  expectCode(() => validateScope(badCriterion), "digest-mismatch");

  const partial = structuredClone(s);
  partial.plans[0].completionRecords[0].outcomeEvidence = [];
  expectCode(() => validateScope(partial), "invalid-model");
});

test("owner-type outcomes need a matching accept-outcome decision in completion", () => {
  const c = content();
  c.outcomes.push({ id: "o2", statement: "Owner judgement", acceptance: "owner", criterion: "owner agrees" });
  const ev = evidence("ev-1");
  const s = makeScope();
  s.plans[0].accepted.content = c;
  s.plans[0].accepted.contentDigest = digest(c);
  s.plans[0].decisions[0].contentDigest = digest(c);
  s.plans[0].observations = [observation("obs-1", [ev])];
  const rows = [
    { outcomeId: "o1", criterionDigest: digest("tests pass"), evidenceIds: ["ev-1"], evidenceDigest: evidenceDigest([ev]), result: "pass" },
    { outcomeId: "o2", criterionDigest: digest("owner agrees"), evidenceIds: ["ev-1"], evidenceDigest: evidenceDigest([ev]), result: "pass" },
  ];
  s.plans[0].completionRecords = [
    { id: "cmp-1", acceptedRevisionId: "rev-a", recordedAt: T1, outcomeEvidence: rows, ownerDecisionIds: [], limitations: [] },
  ];
  s.plans[0].lifecycle = { state: "completed", completionId: "cmp-1" };
  expectCode(() => validateScope(s), "invalid-model");

  s.plans[0].decisions.push({
    id: "dec-o2",
    purpose: "accept-outcome",
    ownerRef: "host:session-1/message-12",
    ownerMessageAt: T1,
    recordedAt: T1,
    planId: "plan-1",
    revisionId: "rev-a",
    contentDigest: digest(c),
    reviewDigest: REVIEW,
    reason: "owner accepts",
    outcomeId: "o2",
    evidenceDigest: evidenceDigest([ev]),
    challengeIds: [],
  });
  s.plans[0].completionRecords[0].ownerDecisionIds = ["dec-o2"];
  assert.doesNotThrow(() => validateScope(s));
});

test("receipts are keyed by operation and keep their closed shape", () => {
  const s = makeScope();
  s.receipts["op-init"].extra = 1;
  expectCode(() => validateScope(s), "invalid-model");
});

test("a __proto__ receipt key is treated as data, not as prototype state", () => {
  const s = JSON.parse(JSON.stringify(makeScope()));
  s.receipts = JSON.parse(
    '{"__proto__": {"requestDigest": "' + hashBytes("p") + '", "storageRevision": "r1", "recordedAt": "' + T0 + '", "result": {"action": "init", "ids": []}}}',
  );
  assert.doesNotThrow(() => validateScope(s));
  assert.equal(({} as any).requestDigest, undefined);
});

// revisions

test("newRevision creates a UUID ID, the content digest and the supplied time", () => {
  const c = content();
  const rev = newRevision(c, T1);
  assert.match(rev.id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.equal(rev.createdAt, T1);
  assert.equal(rev.contentDigest, digest(c));
  assert.notEqual(newRevision(c, T1).id, rev.id);
});

test("newRevision refuses invalid content and a non-UTC time", () => {
  const bad = content();
  bad.title = "";
  expectCode(() => newRevision(bad, T1), "invalid-model");
  expectCode(() => newRevision(content(), "2026-10-12T10:00:00+02:00"), "invalid-model");
});

test("isDigest accepts only 64 lowercase hex characters", () => {
  assert.equal(isDigest(hashBytes("a")), true);
  assert.equal(isDigest("a".repeat(63)), false);
  assert.equal(isDigest(hashBytes("a").toUpperCase()), false);
});

function outcomeDecision(s: any, overrides: any = {}) {
  return { ...approveDecision(s.plans[0].accepted.content), id: "owner-outcome", purpose: "accept-outcome", revisionId: "rev-a", outcomeId: "o1", evidenceDigest: evidenceDigest([]), challengeIds: [], ...overrides };
}

test("every current decision validates content, outcome and challenge references even when unconsumed", () => {
  for (const [overrides, code] of [
    [{ contentDigest: hashBytes("wrong") }, "digest-mismatch"],
    [{ outcomeId: "missing" }, "invalid-reference"],
    [{ challengeIds: ["missing"] }, "invalid-reference"],
    [{ revisionId: "rev-p", contentDigest: hashBytes("wrong") }, "digest-mismatch"],
  ] as const) {
    const s = makeScope();
    s.plans[0].decisions.push(outcomeDecision(s, overrides));
    expectCode(() => validateScope(s), code);
  }
  const s = makeScope();
  s.plans[0].decisions.push(outcomeDecision(s));
  s.plans[0].observations.push(observation("later-evidence"));
  assert.doesNotThrow(() => validateScope(s), "new evidence may stale old acceptance without corrupting canonical history");
});

test("historical completions retain owner revision, outcome and evidence binding", () => {
  const ev = evidence("ev-history"), s = makeScope();
  s.plans[0].observations.push(observation("historical-observation", [ev]));
  s.plans[0].decisions.push(outcomeDecision(s, { revisionId: "old-accepted", evidenceDigest: evidenceDigest([ev]) }));
  s.plans[0].completionRecords.push({ id: "historical-completion", acceptedRevisionId: "old-accepted", recordedAt: T1, outcomeEvidence: [{ outcomeId: "o1", criterionDigest: digest("old criterion"), evidenceIds: [ev.id], evidenceDigest: evidenceDigest([ev]), result: "pass" }], ownerDecisionIds: ["owner-outcome"], limitations: [] });
  assert.doesNotThrow(() => validateScope(s));
  for (const change of [{ revisionId: "unrelated" }, { outcomeId: "unrelated" }, { evidenceDigest: hashBytes("unrelated") }]) {
    const bad = structuredClone(s); Object.assign(bad.plans[0].decisions[1], change);
    expectCode(() => validateScope(bad), "invalid-reference");
  }
});

test("pending revision identity cannot reuse a consumed source or known old accepted revision", () => {
  for (const id of ["rev-p", "old-accepted"]) {
    const s = makeScope(), p = s.plans[0];
    p.decisions.push(outcomeDecision(s, { revisionId: "old-accepted" }));
    p.pending = { id, createdAt: T1, content: content(), contentDigest: digest(content()), baseAcceptedRevision: "rev-a", baseAcceptedDigest: p.accepted.contentDigest, reviewState: "awaiting", rejectionDecisionId: null };
    expectCode(() => validateScope(s), "invalid-reference");
  }
});
