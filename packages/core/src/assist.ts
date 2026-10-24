// Agent ergonomics: flag-shaped routes that build the request envelope from a fresh read, so agents never
// hand-write `expected`, `operationId`, `revisionId` or `reviewDigest`. Every helper composes the public
// executeOperation seam, so core validation, owner-only checks and CAS stay authoritative.
// Owner provenance (ownerRef, ownerMessageAt) is always passed in by the caller. It is never synthesized here.

import { randomBytes, randomUUID } from "node:crypto";
import { executeOperation, type OperationOutput } from "./api.ts";
import { resolveScope, type ScopeInventory } from "./scope-index.ts";
import { readScopeView } from "./scope-store.ts";
import { outcomeStatus, contextView } from "./review.ts";
import { DomainError } from "./errors.ts";
import type { Plan, ScopeState } from "./understanding.ts";

type Data = Record<string, any>;
const shortId = () => randomBytes(4).toString("hex");
const fail = (code: string, message: string, exitCode = 2): OperationOutput => ({
  exitCode,
  data: { status: code, committed: false, snapshot: null, projectionStatus: null, projectionUpdated: false, issues: [{ code, message }] },
});
const str = (v: unknown, name: string): string => {
  if (typeof v !== "string" || !v.trim()) throw new DomainError("invalid-input", `${name} must be a nonempty string`, 2);
  return v;
};
const optStr = (v: unknown, name: string): string | undefined => (v === undefined ? undefined : str(v, name));
function guard(fn: () => OperationOutput): OperationOutput {
  try { return fn(); } catch (err) {
    if (err instanceof DomainError) return fail(err.code, err.message, err.exitCode);
    throw err;
  }
}
function closedArgs(a: unknown, allowed: string[], name: string): Data {
  if (typeof a !== "object" || a === null || Array.isArray(a)) throw new DomainError("invalid-input", `${name} arguments must be an object`, 2);
  for (const k of Object.keys(a)) if (!allowed.includes(k)) throw new DomainError("invalid-input", `unknown argument "${k}" for ${name}`, 2);
  return a as Data;
}

/** Command a host can run next. INVENTORY is replaced by the CLI with the real --config path. */
export const decideCommand = (scope: string, plan: string, purpose: string, extra = "") =>
  `mozak review decide --config INVENTORY --scope ${scope} --plan ${plan} --purpose ${purpose}${extra} --owner-ref REF --owner-message-at ISO --reason TEXT`;

// ---------- warnings: what a write leaves for the owner ----------

interface OutcomeRow { id: string; acceptance: string; status: string }
function outcomeRows(state: ScopeState, plan: Plan): OutcomeRow[] {
  return (plan.accepted?.content.outcomes ?? []).map((o) => ({ id: o.id, acceptance: o.acceptance, status: outcomeStatus(state, plan, o.id) }));
}

/** Before/after snapshot of one plan used to derive warnings. */
export interface PlanTrace { outcomes: OutcomeRow[]; implementationAuthorized: boolean; acceptedId: string | null; permittedNextAction: string; hasCandidate: boolean }
export function tracePlan(state: ScopeState, planId: string): PlanTrace | null {
  const plan = state.plans.find((p) => p.id === planId);
  if (!plan) return null;
  const ctx = contextView(state).plans.find((p) => p.id === planId)!;
  return {
    outcomes: outcomeRows(state, plan),
    implementationAuthorized: ctx.handoff.implementationAuthorized,
    acceptedId: plan.accepted?.id ?? null,
    permittedNextAction: ctx.permittedNextAction,
    hasCandidate: plan.downstreamSpec !== null && !plan.implementationAuthorizations.some((a) => a.specificationId === plan.downstreamSpec),
  };
}

export interface Warning { code: string; message: string; command?: string }

/** After `revise`: outcomes that count as done now and will need new links (and owner re-acceptance) once approved. */
export function reviseWarnings(scope: string, planId: string, before: PlanTrace | null): Warning[] {
  if (!before) return [];
  const out: Warning[] = [];
  for (const o of before.outcomes.filter((r) => r.status === "done")) {
    out.push(o.acceptance === "owner"
      ? { code: "outcome-reacceptance-needed", message: `outcome ${o.id} is accepted on revision ${before.acceptedId}. Once the owner approves this revision it needs its evidence linked to the new revision and a fresh owner acceptance.`, command: decideCommand(scope, planId, "accept-outcome", ` --outcome ${o.id}`) }
      : { code: "outcome-relink-needed", message: `outcome ${o.id} is done on revision ${before.acceptedId}. Once this revision is approved, record its evidence again against the new revision (mozak observe --outcome ${o.id}).` });
  }
  if (before.implementationAuthorized) {
    out.push({ code: "implementation-reapproval-needed", message: "the current implementation authorization is bound to the accepted revision. Approving this revision ends it: attach a spec for the new revision, then the owner approves implementation again." });
  }
  return out;
}

/** After an owner decision: what is still open, so one owner message is not mistaken for two approvals. */
export function decideWarnings(scope: string, planId: string, purpose: string, before: PlanTrace | null, after: PlanTrace | null): Warning[] {
  const out: Warning[] = [];
  if (!after) return out;
  if (purpose === "approve-direction" && before) {
    for (const o of before.outcomes.filter((r) => r.status === "done")) {
      const now = after.outcomes.find((r) => r.id === o.id);
      if (now && now.status === "done") continue;
      out.push(o.acceptance === "owner"
        ? { code: "outcome-reacceptance-needed", message: `outcome ${o.id} was accepted on the previous revision and now needs evidence linked to ${after.acceptedId} and a new owner acceptance.`, command: decideCommand(scope, planId, "accept-outcome", ` --outcome ${o.id}`) }
        : { code: "outcome-relink-needed", message: `outcome ${o.id} was done on the previous revision. Record its evidence again against ${after.acceptedId} (mozak observe --outcome ${o.id}).` });
    }
  }
  if (purpose === "approve-direction" || purpose === "reconsider" || purpose === "resume") {
    const lostGrant = before?.implementationAuthorized === true && !after.implementationAuthorized;
    if (!after.implementationAuthorized && (lostGrant || after.hasCandidate)) {
      const step = after.hasCandidate ? "" : ": the previous authorization ended with this revision, attach a spec for the new revision first";
      out.push({
        code: "implementation-approval-still-needed",
        message: `this message covers 1 approval (${purpose}). Implementation approval is still needed${step}. It is a separate owner decision: ask for it, or record it only if the owner's message explicitly approved implementation too.`,
        command: decideCommand(scope, planId, "approve-implementation"),
      });
    }
  }
  if (after.permittedNextAction === "owner-review-outcome") {
    for (const o of after.outcomes.filter((r) => r.status === "evidence")) {
      if (out.some((w) => w.command?.includes(`--outcome ${o.id}`))) continue;
      out.push({ code: "outcome-acceptance-awaiting", message: `outcome ${o.id} has evidence and awaits owner acceptance.`, command: decideCommand(scope, planId, "accept-outcome", ` --outcome ${o.id}`) });
    }
  }
  return out;
}

function readState(inv: ScopeInventory, scope: string): ScopeState | null {
  try { return readScopeView(resolveScope(inv, scope)).state; } catch { return null; }
}

// ---------- review decide with flags ----------

export interface DecideArgs {
  scope: string; plan: string; purpose: string; outcome?: string; spec?: string;
  ownerRef: string; ownerMessageAt: string; reason: string; dryRun?: boolean;
}

const subjectKey = (r: Data) => JSON.stringify([r.scopeId, r.planId, r.purpose, r.outcomeId ?? null, r.revisionId, r.contentDigest, r.reviewDigest, r.specificationId ?? null, r.authorizationId ?? null]);

function decisionPayload(review: Data, a: DecideArgs): Data {
  return {
    planId: review.planId, revisionId: review.revisionId, reviewDigest: review.reviewDigest,
    ownerRef: a.ownerRef, ownerMessageAt: a.ownerMessageAt, reason: a.reason,
    ...(a.purpose === "approve-implementation" ? { specificationId: review.specificationId } : {}),
    ...(a.purpose === "revoke-implementation" ? { authorizationId: review.authorizationId } : {}),
    ...(a.purpose === "accept-outcome" ? { outcomeId: review.outcomeId } : {}),
  };
}

function showReview(inv: ScopeInventory, a: DecideArgs): OperationOutput {
  return executeOperation(inv, "review", { scope: a.scope, plan: a.plan, purpose: a.purpose, ...(a.outcome !== undefined ? { outcome: a.outcome } : {}) }, "agent");
}

function subjectSummary(review: Data) {
  return {
    question: review.question, purpose: review.purpose, planId: review.planId, outcomeId: review.outcomeId ?? null,
    revisionId: review.revisionId, reviewDigest: review.reviewDigest, changedFields: review.changedFields,
    ...(review.specificationId !== undefined ? { specificationId: review.specificationId } : {}),
    ...(review.authorizationId !== undefined ? { authorizationId: review.authorizationId } : {}),
    ...(review.approvalAvailable !== undefined ? { approvalAvailable: review.approvalAvailable, approvalReasons: review.approvalReasons } : {}),
  };
}

/**
 * Owner decision from flags. Reads the fresh review subject and snapshot, builds the envelope with a new
 * operationId and submits it as the owner. On stale-input it rereads once and retries only when the subject
 * (plan, purpose, outcome, revision, digests, specification, authorization) is unchanged.
 */
export function decideWithFlags(inv: ScopeInventory, raw: unknown): OperationOutput {
  return guard(() => {
    const o = closedArgs(raw, ["scope", "plan", "purpose", "outcome", "spec", "ownerRef", "ownerMessageAt", "reason", "dryRun"], "decide");
    const a: DecideArgs = {
      scope: str(o.scope, "scope"), plan: str(o.plan, "plan"), purpose: str(o.purpose, "purpose"),
      outcome: optStr(o.outcome, "outcome"), spec: optStr(o.spec, "spec"),
      ownerRef: str(o.ownerRef, "ownerRef"), ownerMessageAt: str(o.ownerMessageAt, "ownerMessageAt"), reason: str(o.reason, "reason"),
      dryRun: o.dryRun === true,
    };
    if (a.purpose === "accept-outcome" && a.outcome === undefined) return fail("invalid-input", "accept-outcome needs --outcome");
    const before = readState(inv, a.scope);
    const beforeTrace = before ? tracePlan(before, a.plan) : null; // only for dry-run predictions; real warnings come from the decide route
    let attempts = 0;
    let firstKey: string | null = null;
    for (;;) {
      attempts++;
      const shown = showReview(inv, a);
      if (shown.exitCode !== 0) return { exitCode: shown.exitCode, data: { ...shown.data, operation: "decide", attempts } };
      const review = shown.data.review as Data;
      const key = subjectKey(review);
      if (firstKey !== null && key !== firstKey) {
        return fail("subject-changed", "the review subject changed after a stale-input; show the new subject to the owner and get a fresh confirmation", 3);
      }
      firstKey = key;
      if (a.spec !== undefined && review.specificationId !== a.spec) {
        return fail("subject-changed", `the current specification is ${String(review.specificationId)}, not ${a.spec}; show the current subject to the owner`, 3);
      }
      const request = { operationId: `decide-${randomUUID()}`, scopeId: a.scope, expected: shown.data.snapshot, action: a.purpose, payload: decisionPayload(review, a) };
      const warningsAhead = a.purpose === "approve-direction" && beforeTrace
        ? decideWarnings(a.scope, a.plan, a.purpose, beforeTrace, { ...beforeTrace, outcomes: beforeTrace.outcomes.map((r) => ({ ...r, status: "todo" })), implementationAuthorized: false })
        : [];
      if (a.dryRun) {
        return { exitCode: 0, data: { status: "dry-run", committed: false, operation: "decide", snapshot: shown.data.snapshot, projectionStatus: null, projectionUpdated: false, issues: [], subject: subjectSummary(review), request, warnings: warningsAhead } };
      }
      const out = executeOperation(inv, "decide", { scope: a.scope, request }, "owner");
      if (out.data.status === "stale-input" && attempts < 2) continue;
      return { exitCode: out.exitCode, data: { ...out.data, operationId: request.operationId, attempts, subject: subjectSummary(review), warnings: (out.data.warnings as Warning[] | undefined) ?? [] } };
    }
  });
}

// ---------- plan delete with flags ----------

export function deleteWithFlags(inv: ScopeInventory, raw: unknown): OperationOutput {
  return guard(() => {
    const o = closedArgs(raw, ["scope", "plans", "reason", "ownerRef", "ownerMessageAt", "allowCompleted", "dryRun"], "delete");
    const scope = str(o.scope, "scope");
    if (!Array.isArray(o.plans) || o.plans.length === 0) return fail("invalid-input", "plans must list at least one plan id");
    const planIds = o.plans.map((p: unknown) => str(p, "plans[]"));
    const ownerRef = str(o.ownerRef, "ownerRef"), ownerMessageAt = str(o.ownerMessageAt, "ownerMessageAt"), reason = str(o.reason, "reason");
    let firstKey: string | null = null;
    for (let attempts = 1; ; attempts++) {
      const ctx = executeOperation(inv, "context", { scope, brief: true }, "agent");
      if (ctx.exitCode !== 0) return ctx;
      const state = readState(inv, scope);
      const key = JSON.stringify(planIds.map((id) => { const p = state?.plans.find((x) => x.id === id); return p ? [id, p.accepted?.id ?? null, p.pending?.id ?? null, p.lifecycle.state] : [id, null]; }));
      if (firstKey !== null && key !== firstKey) return fail("subject-changed", "a plan named for deletion changed after a stale-input; confirm with the owner again", 3);
      firstKey = key;
      const request = { operationId: `delete-${randomUUID()}`, scopeId: scope, expected: ctx.data.snapshot, planIds, reason, ownerRef, ownerMessageAt, ...(o.allowCompleted === true ? { allowCompleted: true } : {}) };
      if (o.dryRun === true) {
        const missing = planIds.filter((id) => !state?.plans.some((p) => p.id === id));
        return { exitCode: missing.length ? 3 : 0, data: { status: missing.length ? "stale-reference" : "dry-run", committed: false, operation: "delete", snapshot: ctx.data.snapshot, projectionStatus: null, projectionUpdated: false, issues: missing.map((id) => ({ code: "stale-reference", message: `plan "${id}" is not in this scope` })), request } };
      }
      const out = executeOperation(inv, "delete", { scope, request }, "owner");
      if (out.data.status === "stale-input" && attempts < 2) continue;
      return { exitCode: out.exitCode, data: { ...out.data, operationId: request.operationId, attempts } };
    }
  });
}

// ---------- observe with flags ----------

export interface ObserveArgs {
  scope: string; plan: string; summary: string; locator?: string; verdict?: "pass" | "fail" | "not-assessed";
  activity?: string; activityKind?: "read" | "run"; outcome?: string; relation?: "supports" | "challenges";
  classification?: "observed" | "inferred" | "unverified"; anchor?: string; version?: string; limitations?: string[]; dryRun?: boolean;
}

/**
 * One observation from flags, with one evidence item and an optional link to an accepted outcome.
 * Fresh snapshot each attempt, new operationId and ids, up to 3 attempts on stale-input.
 */
export function observeWithFlags(inv: ScopeInventory, raw: unknown): OperationOutput {
  return guard(() => {
    const o = closedArgs(raw, ["scope", "plan", "summary", "locator", "verdict", "activity", "activityKind", "outcome", "relation", "classification", "anchor", "version", "limitations", "dryRun"], "observe");
    const scope = str(o.scope, "scope"), plan = str(o.plan, "plan"), summary = str(o.summary, "summary");
    const classification = (o.classification ?? "observed") as string;
    if (!["observed", "inferred", "unverified"].includes(classification)) return fail("invalid-input", "classification must be observed, inferred or unverified");
    const verdict = (o.verdict ?? "pass") as string;
    if (!["pass", "fail", "not-assessed"].includes(verdict)) return fail("invalid-input", "verdict must be pass, fail or not-assessed");
    const kind = (o.activityKind ?? "read") as string;
    if (!["read", "run"].includes(kind)) return fail("invalid-input", "activity kind must be read or run");
    const locator = optStr(o.locator, "locator");
    if (classification === "observed" && locator === undefined) return fail("invalid-input", "an observed claim needs evidence: pass --locator (and --activity)");
    const relation = (o.relation ?? (verdict === "fail" ? "challenges" : "supports")) as string;
    if (!["supports", "challenges"].includes(relation)) return fail("invalid-input", "relation must be supports or challenges");
    const outcome = optStr(o.outcome, "outcome");
    const limitations = o.limitations === undefined ? [] : (Array.isArray(o.limitations) ? o.limitations.map((l: unknown) => str(l, "limitations[]")) : [str(o.limitations, "limitations")]);
    for (let attempts = 1; ; attempts++) {
      const ctx = executeOperation(inv, "context", { scope, plan }, "agent");
      if (ctx.exitCode !== 0) return ctx;
      const p = (ctx.data.context as Data).plans[0];
      const acceptedId: string | null = p.accepted?.id ?? null;
      if (outcome !== undefined) {
        if (!acceptedId) return fail("owner-review-required", `plan ${plan} has no accepted revision yet; record without --outcome and link after the owner approves direction`, 3);
        if (!p.accepted.content.outcomes.some((x: Data) => x.id === outcome)) return fail("stale-reference", `outcome "${outcome}" is not in the accepted revision of ${plan}`, 3);
      }
      const tag = shortId();
      const obsId = `obs-${tag}`;
      const evidence = locator === undefined ? [] : [{
        id: `ev-${tag}`, locator, anchor: optStr(o.anchor, "anchor") ?? null, version: optStr(o.version, "version") ?? null,
        inspectedAt: new Date().toISOString(),
        activity: { kind, description: optStr(o.activity, "activity") ?? (kind === "run" ? "Ran the check." : "Read the source.") },
        result: { verdict, summary }, limitations,
      }];
      const payload: Data = { planId: plan, observation: { id: obsId, classification, summary, evidence } };
      if (outcome !== undefined) {
        payload.reasoningLinks = [{ id: `link-${tag}`, relation, from: { planId: plan, revisionId: null, kind: "observation", id: obsId }, to: { planId: plan, revisionId: acceptedId, kind: "outcome", id: outcome }, rationale: summary }];
      }
      const request = { operationId: `observe-${randomUUID()}`, scopeId: scope, expected: ctx.data.snapshot, action: "observe", payload };
      if (o.dryRun === true) return { exitCode: 0, data: { status: "dry-run", committed: false, operation: "observe", snapshot: ctx.data.snapshot, projectionStatus: null, projectionUpdated: false, issues: [], request } };
      const out = executeOperation(inv, "observe", { scope, request }, "agent");
      if (out.data.status === "stale-input" && attempts < 3) continue;
      return { exitCode: out.exitCode, data: { ...out.data, operationId: request.operationId, observationId: obsId, attempts } };
    }
  });
}

// ---------- compact single-plan read ----------

/** Lifecycle, eligibility, authorizations, outcomes with accept/evidence state, spec path and next action. */
export function planShow(inv: ScopeInventory, raw: unknown): OperationOutput {
  return guard(() => {
    const o = closedArgs(raw, ["scope", "plan"], "plan show");
    const scope = str(o.scope, "scope"), planId = str(o.plan, "plan");
    const ctx = executeOperation(inv, "context", { scope, plan: planId }, "agent");
    if (ctx.exitCode !== 0) return ctx;
    const read = readScopeView(resolveScope(inv, scope), planId);
    const plan = read.state.plans.find((p) => p.id === planId)!;
    const c = contextView(read.state, read.environment).plans.find((p) => p.id === planId)!;
    const spec = plan.specifications.find((s) => s.id === (c.handoff.specificationId ?? plan.downstreamSpec));
    const outcomes = (plan.accepted?.content.outcomes ?? []).map((out) => {
      const links = read.state.plans.flatMap((pl) => pl.reasoningLinks).filter((l) => l.to.planId === planId && l.to.id === out.id && l.to.revisionId === plan.accepted!.id);
      const accepted = plan.decisions.some((d) => d.purpose === "accept-outcome" && d.outcomeId === out.id && d.revisionId === plan.accepted!.id);
      return {
        id: out.id, acceptance: out.acceptance, status: outcomeStatus(read.state, plan, out.id),
        supports: links.filter((l) => l.relation === "supports").length, challenges: links.filter((l) => l.relation === "challenges").length,
        ownerAccepted: accepted, statement: out.statement.length > 160 ? `${out.statement.slice(0, 159)}…` : out.statement,
      };
    });
    const show = {
      planId, title: plan.accepted?.content.title ?? plan.pending?.content.title ?? null,
      lifecycle: plan.lifecycle.state,
      accepted: plan.accepted ? { id: plan.accepted.id } : null,
      pending: plan.pending ? { id: plan.pending.id, reviewState: plan.pending.reviewState, ...(plan.pending.mergeFromPlanId ? { mergeFromPlanId: plan.pending.mergeFromPlanId } : {}) } : null,
      executionEligible: c.handoff.executionEligible, reasons: c.handoff.reasons,
      implementationAuthorized: c.handoff.implementationAuthorized, authorizationId: c.handoff.authorizationId,
      authorizations: plan.implementationAuthorizations.map((x) => ({ id: x.id, specificationId: x.specificationId, acceptedRevisionId: x.acceptedRevisionId, current: x.id === plan.implementationAuthorization })),
      specification: spec ? { id: spec.id, path: spec.path, health: c.handoff.specificationHealth === "not-applicable" ? (read.environment.specifications?.[JSON.stringify([planId, spec.id])]?.health ?? "unavailable") : c.handoff.specificationHealth, candidate: spec.id === plan.downstreamSpec } : null,
      outcomes, observations: plan.observations.length, discussionStatus: c.discussionStatus,
      reviewIssues: c.reviewIssues, permittedNextAction: c.permittedNextAction,
    };
    return { exitCode: 0, data: { status: "ok", committed: false, operation: "plan-show", snapshot: ctx.data.snapshot, projectionStatus: ctx.data.projectionStatus, projectionUpdated: false, issues: ctx.data.issues, plan: show } };
  });
}
