// Pure MOZAK package-1 transitions and derived review views. No IO, storage or receipts.
// Owner authority is a trusted-host claim: the core checks consistency, not a human's identity.
// Sorting uses binary code-unit comparison only. Source text is data, never instructions.

import { randomUUID } from "node:crypto";
import { DomainError } from "./errors.ts";
import {
  canonical,
  digest,
  evidenceDigest,
  isDigest,
  isUtcTimestamp,
  newRevision,
  validateContent,
  validateObservation,
  validateScope,
} from "./understanding.ts";
import type {
  AcceptedRevision,
  CompletionRecord,
  Decision,
  DecisionPurpose,
  Evidence,
  Observation,
  OutcomeEvidence,
  PendingRevision,
  Plan,
  PlanContent,
  ReasoningLink,
  ScopeState,
  UtcTimestamp,
} from "./understanding.ts";

export type MutationAction =
  | "propose"
  | "revise"
  | "observe"
  | "approve-direction"
  | "reject-pending"
  | "reconsider"
  | "pause"
  | "resume"
  | "accept-outcome"
  | "complete";

type Actor = "agent" | "owner";

export interface MutationResult {
  state: ScopeState;
  result: { action: string; ids: string[] };
}

const DECISION_FIELDS = ["planId", "revisionId", "reviewDigest", "ownerRef", "ownerMessageAt", "reason"];
const OWNER_ACTIONS = new Set<string>([
  "approve-direction",
  "reject-pending",
  "reconsider",
  "pause",
  "resume",
  "accept-outcome",
]);
const PURPOSES = new Set<string>([...OWNER_ACTIONS]);

const SHAPES: Record<MutationAction, { required: string[]; optional: string[] }> = {
  propose: { required: ["planId", "content"], optional: [] },
  revise: { required: ["planId", "pendingRevisionId", "acceptedRevisionId", "content"], optional: [] },
  observe: { required: ["planId", "observation"], optional: ["reasoningLinks"] },
  "approve-direction": { required: DECISION_FIELDS, optional: [] },
  "reject-pending": { required: DECISION_FIELDS, optional: [] },
  reconsider: { required: DECISION_FIELDS, optional: [] },
  pause: { required: DECISION_FIELDS, optional: [] },
  resume: { required: DECISION_FIELDS, optional: [] },
  "accept-outcome": { required: [...DECISION_FIELDS, "outcomeId"], optional: [] },
  complete: { required: ["planId", "revisionId"], optional: ["limitations"] },
};

// ---------- errors and closed-shape helpers ----------

const invalid = (message: string) => new DomainError("invalid-payload", message, 2);
const stale = (message: string) => new DomainError("stale-reference", message, 3);
const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/** Refuses unknown fields and missing required fields. Protected fields cannot be injected this way. */
function requireClosed(value: unknown, path: string, required: string[], optional: string[] = []): Record<string, unknown> {
  if (!isPlainObject(value)) throw invalid(`${path} must be an object`);
  const allowed = new Set([...required, ...optional]);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) throw invalid(`${path} has unknown field "${key}"`);
  }
  for (const key of required) {
    if (value[key] === undefined) throw invalid(`${path} is missing "${key}"`);
  }
  return value;
}

function assertFinite(value: unknown, path: string): void {
  if (typeof value === "number" && !Number.isFinite(value)) throw invalid(`${path} must be a finite number`);
  if (Array.isArray(value)) value.forEach((item, i) => assertFinite(item, `${path}[${i}]`));
  else if (isPlainObject(value)) for (const [k, v] of Object.entries(value)) assertFinite(v, `${path}.${k}`);
}

function nonEmpty(value: unknown, path: string): string {
  if (typeof value !== "string" || value.trim() === "") throw invalid(`${path} must be a nonempty string`);
  return value;
}

function checkContent(value: unknown): PlanContent {
  try {
    return validateContent(value);
  } catch (err) {
    throw invalid(`content is invalid: ${(err as Error).message}`);
  }
}

function checkEndpoint(value: unknown, path: string, kind: "observation" | "outcome"): void {
  const e = requireClosed(value, path, ["planId", "revisionId", "kind", "id"]);
  nonEmpty(e.planId, `${path}.planId`);
  nonEmpty(e.id, `${path}.id`);
  if (e.kind !== kind) throw invalid(`${path}.kind must be ${kind}`);
  if (kind === "observation" && e.revisionId !== null) throw invalid(`${path}.revisionId must be null for an observation`);
  if (kind === "outcome") nonEmpty(e.revisionId, `${path}.revisionId`);
}

function checkLinks(value: unknown): void {
  if (!Array.isArray(value)) throw invalid("reasoningLinks must be an array");
  value.forEach((raw, i) => {
    const link = requireClosed(raw, `reasoningLinks[${i}]`, ["id", "relation", "from", "to", "rationale"]);
    nonEmpty(link.id, `reasoningLinks[${i}].id`);
    nonEmpty(link.rationale, `reasoningLinks[${i}].rationale`);
    if (link.relation !== "supports" && link.relation !== "challenges") {
      throw invalid("reasoning link relation must be supports or challenges");
    }
    checkEndpoint(link.from, `reasoningLinks[${i}].from`, "observation");
    checkEndpoint(link.to, `reasoningLinks[${i}].to`, "outcome");
  });
}

function checkObservationPayload(value: unknown): void {
  const o = requireClosed(value, "observation", ["id", "classification", "summary", "evidence"], ["supersedesObservationId"]);
  nonEmpty(o.id, "observation.id");
  nonEmpty(o.summary, "observation.summary");
  if (!["observed", "inferred", "unverified"].includes(o.classification as string)) {
    throw invalid("observation.classification must be observed, inferred or unverified");
  }
  if (!Array.isArray(o.evidence)) throw invalid("observation.evidence must be an array");
  if (o.classification === "observed" && o.evidence.length === 0) throw invalid("an observed claim requires evidence");
  if (o.supersedesObservationId !== undefined) nonEmpty(o.supersedesObservationId, "observation.supersedesObservationId");
  try { validateObservation({ ...o, recordedAt: "2000-01-01T00:00:00.000Z" }); }
  catch (error) { throw invalid((error as Error).message); }
}

function checkDecisionPayload(p: Record<string, unknown>, action: MutationAction): void {
  nonEmpty(p.planId, "planId");
  nonEmpty(p.revisionId, "revisionId");
  if (typeof p.reviewDigest !== "string" || !isDigest(p.reviewDigest)) throw invalid("reviewDigest must be a SHA-256 hex digest");
  nonEmpty(p.ownerRef, "ownerRef");
  if (!isUtcTimestamp(p.ownerMessageAt)) throw invalid("ownerMessageAt must be an RFC 3339 UTC timestamp");
  nonEmpty(p.reason, "reason");
  if (action === "accept-outcome") nonEmpty(p.outcomeId, "outcomeId");
}

/** Closed action-specific shape and actor class. Runs before any state change. */
export function validateMutation(action: unknown, payload: unknown, actor: unknown): void {
  if (typeof action !== "string" || !Object.prototype.hasOwnProperty.call(SHAPES, action)) {
    throw new DomainError("unsupported-action", `unsupported action "${String(action)}"`, 2);
  }
  if (actor !== "agent" && actor !== "owner") throw invalid("actor must be agent or owner");
  if (OWNER_ACTIONS.has(action) && actor !== "owner") {
    throw new DomainError("not-permitted", `${action} requires the owner path`, 2);
  }
  try { canonical(payload); } catch (error) { throw invalid((error as Error).message); }
  const shape = SHAPES[action as MutationAction];
  const p = requireClosed(payload, "payload", shape.required, shape.optional);

  switch (action as MutationAction) {
    case "propose":
      nonEmpty(p.planId, "planId");
      checkContent(p.content);
      return;
    case "revise":
      nonEmpty(p.planId, "planId");
      if (p.pendingRevisionId !== null) nonEmpty(p.pendingRevisionId, "pendingRevisionId");
      if (p.acceptedRevisionId !== null) nonEmpty(p.acceptedRevisionId, "acceptedRevisionId");
      checkContent(p.content);
      return;
    case "observe":
      nonEmpty(p.planId, "planId");
      checkObservationPayload(p.observation);
      if (p.reasoningLinks !== undefined) checkLinks(p.reasoningLinks);
      return;
    case "complete":
      nonEmpty(p.planId, "planId");
      nonEmpty(p.revisionId, "revisionId");
      if (p.limitations !== undefined && (!Array.isArray(p.limitations) || p.limitations.some((x) => typeof x !== "string"))) {
        throw invalid("limitations must be a string array");
      }
      return;
    default:
      checkDecisionPayload(p, action as MutationAction);
  }
}

// ---------- state helpers ----------

type Subject = { id: string; contentDigest: string; content: PlanContent };

function findPlan(state: ScopeState, planId: string): Plan {
  const plan = state.plans.find((x) => x.id === planId);
  if (!plan) throw stale(`unknown plan "${planId}"`);
  return plan;
}

function acceptedOf(plan: Plan): AcceptedRevision {
  if (!plan.accepted) throw stale(`plan "${plan.id}" has no accepted direction`);
  return plan.accepted;
}

function awaitingOf(plan: Plan): PendingRevision {
  if (!plan.pending || plan.pending.reviewState !== "awaiting") throw stale(`plan "${plan.id}" has no awaiting proposal`);
  return plan.pending;
}

function rejectedOf(plan: Plan): PendingRevision {
  if (!plan.pending || plan.pending.reviewState !== "rejected") throw stale(`plan "${plan.id}" has no rejected proposal`);
  return plan.pending;
}

/** Evidence-backed corrections retire prior reports, even when the new result is a failure. */
function isPassingObserved(o: Observation): boolean {
  return o.classification === "observed" && o.evidence.length > 0 && o.evidence.every(e => e.result.verdict === "pass");
}

function retiredIds(state: ScopeState): Set<string> {
  const out = new Set<string>();
  for (const plan of state.plans) for (const o of plan.observations) {
    if (o.supersedesObservationId && o.classification === "observed" && o.evidence.length) {
      out.add(JSON.stringify([plan.id, o.supersedesObservationId]));
    }
  }
  return out;
}

function findObservation(state: ScopeState, planId: string, observationId: string): Observation | undefined {
  return state.plans.find((p) => p.id === planId)?.observations.find((o) => o.id === observationId);
}

interface ReviewContribution {
  containerPlanId: string;
  planId: string;
  observation: Observation;
  link: ReasoningLink;
}
interface OutcomeReview {
  outcomeId: string;
  criterionDigest: string;
  evidenceIds: string[];
  evidenceDigest: string;
  challengeIds: string[];
  latestSupportAt: UtcTimestamp | null;
  evidence: Evidence[];
  supports: ReviewContribution[];
  challenges: ReviewContribution[];
}

/**
 * Derives the exact supporting evidence and unresolved challenges for one accepted outcome.
 * Links bind to the accepted revision ID, so links to older revisions stay historical and are never rebound.
 */
function outcomeReview(state: ScopeState, plan: Plan, accepted: AcceptedRevision, outcomeId: string): OutcomeReview {
  const outcome = accepted.content.outcomes.find((o) => o.id === outcomeId);
  if (!outcome) throw stale(`outcome "${outcomeId}" is not in the accepted revision`);
  const retired = retiredIds(state);
  const supports: ReviewContribution[] = [], challenges: ReviewContribution[] = [];
  for (const container of state.plans) for (const link of container.reasoningLinks) {
    if (link.to.planId !== plan.id || link.to.id !== outcomeId || link.to.revisionId !== accepted.id) continue;
    const obs = findObservation(state, link.from.planId, link.from.id);
    if (!obs || retired.has(JSON.stringify([link.from.planId, obs.id]))) continue;
    const contribution = { containerPlanId: container.id, planId: link.from.planId, observation: obs, link };
    if (link.relation === "challenges") challenges.push(contribution);
    else if (isPassingObserved(obs)) supports.push(contribution);
  }
  const key = (r: ReviewContribution) => JSON.stringify([r.containerPlanId, r.link.id]);
  supports.sort((a, b) => cmp(key(a), key(b))); challenges.sort((a, b) => cmp(key(a), key(b)));
  const byId = new Map<string, Evidence>();
  for (const support of supports) for (const evidence of support.observation.evidence) {
    const prior = byId.get(evidence.id);
    if (prior && digest(prior) !== digest(evidence)) throw invalid("ambiguous evidence ID across supporting plans");
    byId.set(evidence.id, evidence);
  }
  const evidence = [...byId.values()].sort((a, b) => cmp(a.id, b.id));
  const times = [...supports, ...challenges].map(r => Date.parse(r.observation.recordedAt));
  return {
    outcomeId, criterionDigest: digest(outcome.criterion), evidenceIds: evidence.map(e => e.id),
    evidenceDigest: evidenceDigest(evidence), challengeIds: challenges.map(key),
    latestSupportAt: times.length ? new Date(Math.max(...times)).toISOString() : null,
    evidence, supports, challenges,
  };
}

/** The owner decision that acknowledges this outcome's exact current evidence and challenge set. */
function boundDecision(state: ScopeState, plan: Plan, accepted: AcceptedRevision, review: OutcomeReview): Decision | undefined {
  return plan.decisions.find(
    (d) =>
      d.purpose === "accept-outcome" &&
      d.outcomeId === review.outcomeId &&
      d.revisionId === accepted.id &&
      d.contentDigest === accepted.contentDigest &&
      d.evidenceDigest === review.evidenceDigest &&
      d.reviewDigest === reviewDigestOf(state, "accept-outcome", plan.id, accepted, review) &&
      canonical(d.challengeIds ?? []) === canonical(review.challengeIds),
  );
}

/** Direction digest excludes unrelated observations. Outcome digest adds evidence and challenge sets. */
function reviewDigestOf(state: ScopeState, purpose: DecisionPurpose, planId: string, subject: Subject, review?: OutcomeReview): string {
  const base = { scopeId: state.scope.id, purpose, planId, revisionId: subject.id, contentDigest: subject.contentDigest };
  const displayed = displayPayload(findPlan(state, planId), purpose, review);
  if (!review) return digest({ ...base, displayed });
  return digest({
    ...base,
    displayed,
    outcomeId: review.outcomeId,
    criterionDigest: review.criterionDigest,
    evidenceDigest: review.evidenceDigest,
    challengeIds: review.challengeIds,
  });
}

function displayPayload(plan: Plan, purpose: DecisionPurpose, review?: OutcomeReview) {
  const pendingAction = ["approve-direction", "reject-pending", "reconsider"].includes(purpose);
  return {
    accepted: plan.accepted ? { id: plan.accepted.id, content: plan.accepted.content, contentDigest: plan.accepted.contentDigest } : null,
    proposal: pendingAction ? plan.pending : null,
    ...(purpose === "pause" || purpose === "resume" ? { lifecycle: plan.lifecycle } : {}),
    ...(review ? { outcome: plan.accepted!.content.outcomes.find(o => o.id === review.outcomeId), evidence: review.evidence, supports: review.supports, challenges: review.challenges } : {}),
  };
}

function reviewFor(state: ScopeState, plan: Plan, purpose: DecisionPurpose, accepted: AcceptedRevision, outcomeId?: string): OutcomeReview | undefined {
  if (purpose !== "accept-outcome") return undefined;
  if (outcomeId === undefined) throw invalid("accept-outcome needs an outcomeId");
  return outcomeReview(state, plan, accepted, outcomeId);
}

function changedKeys(before: PlanContent | undefined, after: PlanContent): string[] {
  return (Object.keys(after) as (keyof PlanContent)[])
    .filter((k) => !before || canonical(before[k]) !== canonical(after[k]))
    .map(String);
}

function recordDecision(
  plan: Plan,
  purpose: DecisionPurpose,
  p: Record<string, unknown>,
  subject: Subject,
  now: UtcTimestamp,
  review?: OutcomeReview,
): Decision {
  const decision: Decision = {
    id: randomUUID(),
    purpose,
    ownerRef: p.ownerRef as string,
    ownerMessageAt: p.ownerMessageAt as string,
    recordedAt: now,
    planId: plan.id,
    revisionId: subject.id,
    contentDigest: subject.contentDigest,
    reviewDigest: p.reviewDigest as string,
    reason: p.reason as string,
  };
  if (review) {
    decision.outcomeId = review.outcomeId;
    decision.evidenceDigest = review.evidenceDigest;
    decision.challengeIds = review.challengeIds;
  }
  plan.decisions.push(decision);
  return decision;
}

function requireReviewDigest(state: ScopeState, plan: Plan, purpose: DecisionPurpose, subject: Subject, p: Record<string, unknown>, outcomeId?: string) {
  const accepted = purpose === "accept-outcome" ? acceptedOf(plan) : undefined;
  const review = accepted ? reviewFor(state, plan, purpose, accepted, outcomeId) : undefined;
  if (p.reviewDigest !== reviewDigestOf(state, purpose, plan.id, subject, review)) {
    throw stale("reviewDigest does not match the displayed review");
  }
  return review;
}

// ---------- transitions ----------

export function applyMutation(
  state: ScopeState,
  action: MutationAction,
  payload: unknown,
  actor: Actor,
  now: UtcTimestamp,
): MutationResult {
  validateMutation(action, payload, actor);
  validateScope(state);
  if (!isUtcTimestamp(now)) throw invalid("now must be an RFC 3339 UTC timestamp");
  const next = structuredClone(state) as ScopeState;
  const p = structuredClone(payload) as Record<string, unknown>;
  const ids: string[] = [];

  switch (action) {
    case "propose": {
      const planId = p.planId as string;
      if (next.plans.some((x) => x.id === planId)) throw invalid(`plan "${planId}" already exists`);
      const rev = newRevision(checkContent(p.content), now);
      next.plans.push({
        id: planId,
        createdAt: now,
        updatedAt: now,
        accepted: null,
        pending: { ...rev, baseAcceptedRevision: null, baseAcceptedDigest: null, reviewState: "awaiting", rejectionDecisionId: null },
        lifecycle: { state: "unaccepted" },
        observations: [],
        decisions: [],
        reasoningLinks: [],
        completionRecords: [],
        downstreamSpec: null,
        implementationAuthorization: null,
      });
      ids.push(planId, rev.id);
      break;
    }

    case "revise": {
      const plan = findPlan(next, p.planId as string);
      if (p.acceptedRevisionId !== (plan.accepted?.id ?? null)) throw stale("acceptedRevisionId does not match the plan");
      if (p.pendingRevisionId !== (plan.pending?.id ?? null)) throw stale("pendingRevisionId does not match the plan");
      if (plan.pending?.reviewState === "rejected") {
        throw new DomainError("owner-review-required", "a rejected candidate requires explicit reconsideration first", 3);
      }
      const rev = newRevision(checkContent(p.content), now);
      plan.pending = {
        ...rev,
        baseAcceptedRevision: plan.accepted?.id ?? null,
        baseAcceptedDigest: plan.accepted?.contentDigest ?? null,
        reviewState: "awaiting",
        rejectionDecisionId: null,
      };
      plan.updatedAt = now;
      ids.push(plan.id, rev.id);
      break;
    }

    case "observe": {
      const plan = findPlan(next, p.planId as string);
      const raw = p.observation as Record<string, unknown>;
      if (plan.observations.some((o) => o.id === raw.id)) throw invalid(`observation "${String(raw.id)}" already exists`);
      if (raw.supersedesObservationId !== undefined && !plan.observations.some((o) => o.id === raw.supersedesObservationId)) {
        throw stale("supersedesObservationId does not match an observation in this plan");
      }
      const observation = validateObservation(structuredClone({ ...raw, recordedAt: now }));
      plan.observations.push(observation);
      ids.push(observation.id);
      for (const link of (p.reasoningLinks as ReasoningLink[] | undefined) ?? []) {
        if (plan.reasoningLinks.some((l) => l.id === link.id)) throw invalid(`reasoning link "${link.id}" already exists in this plan`);
        const source = findObservation(next, link.from.planId, link.from.id);
        if (!source) throw stale(`link source observation "${link.from.id}" does not exist`);
        const target = next.plans.find((q) => q.id === link.to.planId);
        if (!target) throw stale(`link target plan "${link.to.planId}" does not exist`);
        const revisionOk = [target.accepted, target.pending].some(
          (r) => r !== null && r.id === link.to.revisionId && r.content.outcomes.some((o) => o.id === link.to.id),
        );
        if (!revisionOk) throw stale("link must target a current accepted or pending revision and an outcome in it");
        plan.reasoningLinks.push(link);
        ids.push(link.id);
      }
      plan.updatedAt = now;
      break;
    }

    case "approve-direction": {
      const plan = findPlan(next, p.planId as string);
      const pending = awaitingOf(plan);
      if (pending.id !== p.revisionId) throw stale("approve-direction needs the exact displayed pending revision");
      requireReviewDigest(next, plan, "approve-direction", pending, p);
      const decision = recordDecision(plan, "approve-direction", p, pending, now);
      const promoted = newRevision(pending.content, now);
      plan.accepted = {
        id: promoted.id,
        createdAt: now,
        content: pending.content,
        contentDigest: pending.contentDigest,
        acceptedFromRevision: pending.id,
        directionDecisionId: decision.id,
      };
      plan.pending = null;
      plan.lifecycle = { state: "open" };
      plan.updatedAt = now;
      ids.push(decision.id, promoted.id);
      break;
    }

    case "reject-pending": {
      const plan = findPlan(next, p.planId as string);
      const pending = awaitingOf(plan);
      if (pending.id !== p.revisionId) throw stale("reject-pending needs the exact displayed pending revision");
      requireReviewDigest(next, plan, "reject-pending", pending, p);
      const decision = recordDecision(plan, "reject-pending", p, pending, now);
      pending.reviewState = "rejected";
      pending.rejectionDecisionId = decision.id;
      plan.updatedAt = now;
      ids.push(decision.id);
      break;
    }

    case "reconsider": {
      const plan = findPlan(next, p.planId as string);
      const rejected = rejectedOf(plan);
      if (rejected.id !== p.revisionId) throw stale("reconsider needs the exact displayed rejected revision");
      requireReviewDigest(next, plan, "reconsider", rejected, p);
      const decision = recordDecision(plan, "reconsider", p, rejected, now);
      const rev = newRevision(rejected.content, now);
      plan.pending = {
        ...rev,
        baseAcceptedRevision: rejected.baseAcceptedRevision,
        baseAcceptedDigest: rejected.baseAcceptedDigest,
        reviewState: "awaiting",
        rejectionDecisionId: null,
      };
      plan.updatedAt = now;
      ids.push(decision.id, rev.id);
      break;
    }

    case "pause":
    case "resume": {
      const plan = findPlan(next, p.planId as string);
      const accepted = acceptedOf(plan);
      if (accepted.id !== p.revisionId) throw stale(`${action} binds the accepted revision`);
      requireReviewDigest(next, plan, action, accepted, p);
      if (action === "pause") {
        if (plan.lifecycle.state !== "open") throw new DomainError("invalid-lifecycle", "only an open plan can pause", 3);
        const decision = recordDecision(plan, "pause", p, accepted, now);
        plan.lifecycle = { state: "paused", decisionId: decision.id };
        ids.push(decision.id);
      } else {
        if (plan.lifecycle.state !== "paused") throw new DomainError("invalid-lifecycle", "only a paused plan can resume", 3);
        const decision = recordDecision(plan, "resume", p, accepted, now);
        plan.lifecycle = { state: "open" };
        ids.push(decision.id);
      }
      plan.updatedAt = now;
      break;
    }

    case "accept-outcome": {
      const plan = findPlan(next, p.planId as string);
      const accepted = acceptedOf(plan);
      if (accepted.id !== p.revisionId) throw stale("accept-outcome binds the accepted revision");
      const outcomeId = p.outcomeId as string;
      const outcome = accepted.content.outcomes.find((o) => o.id === outcomeId);
      if (!outcome) throw stale(`outcome "${outcomeId}" is not in the accepted revision`);
      const review = requireReviewDigest(next, plan, "accept-outcome", accepted, p, outcomeId) as OutcomeReview;
      if (outcome.acceptance !== "owner" && review.challengeIds.length === 0) {
        throw invalid("acceptance applies to owner-type outcomes or to outcomes with active challenges");
      }
      if (review.evidenceIds.length === 0) throw invalid("cannot accept an outcome without supporting observed evidence");
      const decision = recordDecision(plan, "accept-outcome", p, accepted, now, review);
      plan.updatedAt = now;
      ids.push(decision.id);
      break;
    }

    case "complete": {
      const plan = findPlan(next, p.planId as string);
      const accepted = acceptedOf(plan);
      if (accepted.id !== p.revisionId) throw stale("complete binds the accepted revision");
      if (plan.lifecycle.state === "paused") throw new DomainError("invalid-lifecycle", "a paused plan must be resumed before completion", 3);
      if (plan.lifecycle.state !== "open") throw new DomainError("invalid-lifecycle", "only an open plan can complete", 3);
      if (plan.pending?.reviewState === "awaiting") {
        throw new DomainError("owner-review-required", "an awaiting pending revision must be resolved first", 3);
      }
      const rows: OutcomeEvidence[] = [];
      const ownerDecisionIds: string[] = [];
      for (const outcome of accepted.content.outcomes) {
        const review = outcomeReview(next, plan, accepted, outcome.id);
        if (review.evidenceIds.length === 0) {
          throw new DomainError("insufficient-evidence", `outcome "${outcome.id}" has no supporting observed pass`, 3);
        }
        if (outcome.acceptance === "owner" || review.challengeIds.length > 0) {
          const bound = boundDecision(next, plan, accepted, review);
          if (!bound) {
            throw new DomainError("owner-review-required", `outcome "${outcome.id}" needs owner acceptance bound to its current evidence and challenges`, 3);
          }
          ownerDecisionIds.push(bound.id);
        }
        rows.push({
          outcomeId: outcome.id,
          criterionDigest: review.criterionDigest,
          evidenceIds: review.evidenceIds,
          evidenceDigest: review.evidenceDigest,
          result: "pass",
        } as OutcomeEvidence);
      }
      const record: CompletionRecord = {
        id: randomUUID(),
        acceptedRevisionId: accepted.id,
        recordedAt: now,
        outcomeEvidence: rows,
        ownerDecisionIds,
        limitations: (p.limitations as string[] | undefined) ?? [],
      };
      plan.completionRecords.push(record);
      plan.lifecycle = { state: "completed", completionId: record.id };
      plan.updatedAt = now;
      ids.push(record.id);
      break;
    }
  }

  // Store-visible resulting graph must pass the canonical model, not only the transition checks.
  return { state: validateScope(next), result: { action, ids } };
}

// ---------- derived views ----------

export interface ReviewDisplay {
  scopeId: string;
  planId: string;
  purpose: DecisionPurpose;
  outcomeId: string | null;
  revisionId: string;
  contentDigest: string;
  reviewDigest: string;
  changedFields: string[];
  question: string;
  evidenceIds: string[];
  evidenceDigest: string | null;
  challengeIds: string[];
  implementationAuthorized: false;
  accepted: ReturnType<typeof displayPayload>["accepted"];
  proposal: PendingRevision | null;
  evidence?: Evidence[];
  supports?: ReviewContribution[];
  challenges?: ReviewContribution[];
}

/** Positional signature agreed with the API: reviewShow(state, planId, purpose?, outcomeId?). */
export function reviewShow(state: ScopeState, planId: string, purpose?: string, outcomeId?: string): ReviewDisplay {
  const plan = findPlan(state, planId);
  const chosen = purpose ?? (plan.pending?.reviewState === "awaiting" ? "approve-direction" : undefined);
  if (chosen === undefined) throw invalid("select the exact review purpose");
  if (!PURPOSES.has(chosen)) throw invalid(`unsupported review purpose "${chosen}"`);
  const p = chosen as DecisionPurpose;
  if (outcomeId !== undefined && p !== "accept-outcome") throw invalid("outcomeId applies only to accept-outcome");
  if (p === "pause" && plan.lifecycle.state !== "open") throw stale("only an open plan can pause");
  if (p === "resume" && plan.lifecycle.state !== "paused") throw stale("only a paused plan can resume");

  let subject: Subject;
  let changedFields: string[] = [];
  if (p === "approve-direction" || p === "reject-pending") {
    const pending = awaitingOf(plan);
    subject = pending;
    changedFields = changedKeys(plan.accepted?.content, pending.content);
  } else if (p === "reconsider") {
    subject = rejectedOf(plan);
  } else {
    subject = acceptedOf(plan);
  }

  const review = reviewFor(state, plan, p, subject as AcceptedRevision, outcomeId);
  const ownQuestion: Record<DecisionPurpose, string> = {
    "approve-direction": `Approve the proposed direction for plan ${plan.id}?`,
    "reject-pending": `Reject the proposed direction for plan ${plan.id}?`,
    reconsider: `Reconsider the rejected proposal for plan ${plan.id}?`,
    pause: `Pause plan ${plan.id}?`,
    resume: `Resume plan ${plan.id}?`,
    "accept-outcome": `Accept outcome "${outcomeId}" for plan ${plan.id}?`,
  };
  return {
    ...displayPayload(plan, p, review),
    scopeId: state.scope.id,
    planId: plan.id,
    purpose: p,
    outcomeId: outcomeId ?? null,
    revisionId: subject.id,
    contentDigest: subject.contentDigest,
    reviewDigest: reviewDigestOf(state, p, plan.id, subject, review),
    changedFields,
    question: ownQuestion[p],
    evidenceIds: review?.evidenceIds ?? [],
    evidenceDigest: review?.evidenceDigest ?? null,
    challengeIds: review?.challengeIds ?? [],
    implementationAuthorized: false,
  };
}

export interface ReviewRow {
  scopeId: string;
  planId: string;
  rowKind: "plan" | "pending" | "outcome" | "rejected";
  id: string;
  title: string;
  outcome: string;
  date: UtcTimestamp;
  revisionId: string;
  reviewAt?: UtcTimestamp;
  outcomeId?: string;
  reason?: string;
  paused?: boolean;
  reviewNeeded?: boolean;
  compositeKey: string;
}

export interface ReviewGroups {
  completed: ReviewRow[];
  open: ReviewRow[];
  awaiting: ReviewRow[];
  rejected: ReviewRow[];
}

/** Four fixed groups, sorted by time descending then composite key ascending, using binary comparison. */
export function reviewRows(state: ScopeState, includeRejected = false): ReviewGroups {
  const groups: ReviewGroups = { completed: [], open: [], awaiting: [], rejected: [] };
  const scopeId = state.scope.id;
  const keyOf = (rowKind: string, planId: string, revisionId: string, outcomeId: string | null, id: string) =>
    JSON.stringify([scopeId, planId, rowKind, revisionId, outcomeId ?? id]);

  for (const plan of state.plans) {
    const title = plan.accepted?.content.title ?? plan.pending?.content.title ?? plan.id;
    const purposeText = (plan.accepted?.content ?? plan.pending!.content).outcomes.map(o => o.statement).join(". ");
    const reviewNeeded = plan.accepted?.content.outcomes.some(o => outcomeReview(state, plan, plan.accepted!, o.id).challengeIds.length > 0) ?? false;

    if (plan.lifecycle.state === "completed" && plan.accepted) {
      const record = plan.completionRecords.find((r) => r.id === (plan.lifecycle as { completionId: string }).completionId);
      groups.completed.push({
        scopeId, planId: plan.id, rowKind: "plan", id: plan.id, title, outcome: purposeText,
        date: record?.recordedAt ?? plan.updatedAt, revisionId: plan.accepted.id, reviewNeeded,
        compositeKey: keyOf("plan", plan.id, plan.accepted.id, null, plan.id),
      });
    } else if (plan.accepted) {
      const paused = plan.lifecycle.state === "paused";
      const decision = paused ? plan.decisions.find((d) => d.id === (plan.lifecycle as { decisionId: string }).decisionId) : undefined;
      groups.open.push({
        scopeId, planId: plan.id, rowKind: "plan", id: plan.id, title, outcome: purposeText,
        date: plan.updatedAt, revisionId: plan.accepted.id, paused, reviewNeeded,
        ...(decision ? { reason: decision.reason } : {}),
        compositeKey: keyOf("plan", plan.id, plan.accepted.id, null, plan.id),
      });
      for (const o of plan.accepted.content.outcomes) {
        if (o.acceptance !== "owner" && outcomeReview(state, plan, plan.accepted, o.id).challengeIds.length === 0) continue;
        const review = outcomeReview(state, plan, plan.accepted, o.id);
        if (review.evidenceIds.length === 0 || boundDecision(state, plan, plan.accepted, review)) continue;
        const at = review.latestSupportAt ?? plan.updatedAt;
        groups.awaiting.push({
          scopeId, planId: plan.id, rowKind: "outcome", id: o.id, title, outcome: o.statement,
          date: at, reviewAt: at, revisionId: plan.accepted.id, outcomeId: o.id,
          compositeKey: keyOf("outcome", plan.id, plan.accepted.id, o.id, o.id),
        });
      }
    }

    if (plan.pending?.reviewState === "awaiting") {
      groups.awaiting.push({
        scopeId, planId: plan.id, rowKind: "pending", id: plan.pending.id, title: plan.pending.content.title,
        outcome: plan.pending.content.outcomes.map(o => o.statement).join(". "), date: plan.pending.createdAt, reviewAt: new Date(plan.pending.createdAt).toISOString(),
        revisionId: plan.pending.id, compositeKey: keyOf("pending", plan.id, plan.pending.id, null, plan.pending.id),
      });
    } else if (plan.pending?.reviewState === "rejected" && includeRejected) {
      const decision = plan.decisions.find((d) => d.id === plan.pending?.rejectionDecisionId);
      groups.rejected.push({
        scopeId, planId: plan.id, rowKind: "rejected", id: plan.pending.id, title: plan.pending.content.title,
        outcome: plan.pending.content.outcomes.map(o => o.statement).join(". "), date: decision?.recordedAt ?? plan.pending.createdAt,
        revisionId: plan.pending.id, ...(decision ? { reason: decision.reason } : {}),
        compositeKey: keyOf("rejected", plan.id, plan.pending.id, null, plan.pending.id),
      });
    }
  }

  const byTimeThenKey = (a: ReviewRow, b: ReviewRow) => {
    const ta = a.reviewAt ?? a.date;
    const tb = b.reviewAt ?? b.date;
    const delta = Date.parse(tb) - Date.parse(ta);
    if (delta) return delta;
    return cmp(a.compositeKey, b.compositeKey);
  };
  groups.completed.sort(byTimeThenKey);
  groups.open.sort(byTimeThenKey);
  groups.awaiting.sort(byTimeThenKey);
  groups.rejected.sort(byTimeThenKey);
  return groups;
}

/** Canonical understanding and the single permitted next action. Never authorises implementation. */
export function contextView(state: ScopeState) {
  return {
    scope: state.scope,
    scopeId: state.scope.id,
    implementationAuthorized: false as const,
    plans: state.plans.map((plan) => {
      const effectiveDecisions: Record<string, string> = {};
      if (plan.accepted) effectiveDecisions["approve-direction"] = plan.accepted.directionDecisionId;
      if (plan.pending?.rejectionDecisionId) effectiveDecisions["reject-pending"] = plan.pending.rejectionDecisionId;
      if (plan.lifecycle.state === "paused") effectiveDecisions.pause = plan.lifecycle.decisionId;
      let outcomeAwaiting = false;
      if (plan.accepted) {
        const accepted = plan.accepted;
        outcomeAwaiting = accepted.content.outcomes.some((o) => {
          const review = outcomeReview(state, plan, accepted, o.id);
          const decision = boundDecision(state, plan, accepted, review);
          if (decision) effectiveDecisions[JSON.stringify(["accept-outcome", o.id])] = decision.id;
          return review.evidenceIds.length > 0 && (o.acceptance === "owner" || review.challengeIds.length > 0) && !decision;
        });
      }
      let permittedNextAction: string;
      if (plan.pending?.reviewState === "awaiting") permittedNextAction = "owner-review-direction";
      else if (plan.pending?.reviewState === "rejected") permittedNextAction = "owner-reconsider";
      else if (plan.lifecycle.state === "completed") permittedNextAction = "none-completed";
      else if (plan.lifecycle.state === "paused") permittedNextAction = "owner-resume";
      else if (outcomeAwaiting) permittedNextAction = "owner-review-outcome";
      else if (plan.lifecycle.state === "open") permittedNextAction = "detailed-planning-observe-propose-revision-or-complete";
      else permittedNextAction = "owner-review-direction";
      return {
        ...plan,
        planId: plan.id,
        historicalLinks: plan.reasoningLinks.filter(link => {
          const target = findPlan(state, link.to.planId);
          return ![target.accepted, target.pending].some(r => r?.id === link.to.revisionId);
        }),
        reviewNeeded: plan.accepted?.content.outcomes.some(o => outcomeReview(state, plan, plan.accepted!, o.id).challengeIds.length > 0) ?? false,
        effectiveDecisions,
        permittedNextAction,
        nextAction: permittedNextAction,
        implementationAuthorized: false as const,
      };
    }),
  };
}
