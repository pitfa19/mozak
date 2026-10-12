// MOZAK v2 understanding model: closed types, validators, canonical bytes and digests.
// Package 1 public seam. Owner refs are trusted-host claims, not cryptographic verification.
// No JSON Schema dependency, no generic unchecked cast as validation.

import { createHash, randomUUID } from "node:crypto";
import { DomainError } from "./errors.ts";

export const SCOPE_FORMAT = "mozak.scope/v2";
export const MAX_REQUEST_BYTES = 1048576;
export const MAX_SCOPE_BYTES = 4194304;

/** Lowercase hex SHA-256 of UTF-8 bytes, 64 characters. */
export type Digest = string;
/** RFC 3339 UTC timestamp, for example 2026-10-12T08:18:39.488Z. */
export type UtcTimestamp = string;

export type ModelErrorCode =
  | "invalid-model"
  | "unsupported-format"
  | "unsupported-capability"
  | "invalid-reference"
  | "duplicate-id"
  | "digest-mismatch";

export interface FileToken {
  exists: boolean;
  sha256: Digest | null;
}

export interface ScopeInitialization {
  operationId: string;
  ownerRef: string;
  ownerMessageAt: UtcTimestamp;
  recordedAt: UtcTimestamp;
}

export interface ScopeRecord {
  id: string;
  kind: "project" | "topic";
  title: string;
  createdAt: UtcTimestamp;
  initialization: ScopeInitialization;
}

export interface StorageRecord {
  revision: string;
  updatedAt: UtcTimestamp;
  previousBridge: FileToken;
}

export interface ScopeState {
  format: "mozak.scope/v2";
  scope: ScopeRecord;
  storage: StorageRecord;
  plans: Plan[];
  connections: never[];
  receipts: Record<string, Receipt>;
}

export interface Plan {
  id: string;
  createdAt: UtcTimestamp;
  updatedAt: UtcTimestamp;
  accepted: AcceptedRevision | null;
  pending: PendingRevision | null;
  lifecycle: Lifecycle;
  observations: Observation[];
  decisions: Decision[];
  reasoningLinks: ReasoningLink[];
  completionRecords: CompletionRecord[];
  downstreamSpec: null;
  implementationAuthorization: null;
}

export interface Revision {
  id: string;
  createdAt: UtcTimestamp;
  content: PlanContent;
  contentDigest: Digest;
}

export interface AcceptedRevision extends Revision {
  acceptedFromRevision: string;
  directionDecisionId: string;
}

export interface PendingRevision extends Revision {
  baseAcceptedRevision: string | null;
  baseAcceptedDigest: Digest | null;
  reviewState: "awaiting" | "rejected";
  rejectionDecisionId: string | null;
}

export type Lifecycle =
  | { state: "unaccepted" }
  | { state: "open" }
  | { state: "paused"; decisionId: string }
  | { state: "completed"; completionId: string };

export interface PlanContent {
  title: string;
  purpose: string;
  outcomes: Outcome[];
  constraints: TextItem[];
  nonGoals: string[];
  rationale: string;
  questions: TextItem[];
  sources: Source[];
}

export interface Outcome {
  id: string;
  statement: string;
  acceptance: "objective" | "owner";
  criterion: string;
}

export interface TextItem {
  id: string;
  text: string;
}

export interface Source {
  id: string;
  locator: string;
  anchor: string | null;
  observedAt: UtcTimestamp;
  version: string | null;
  limitations: string[];
}

export interface Observation {
  id: string;
  recordedAt: UtcTimestamp;
  classification: "observed" | "inferred" | "unverified";
  summary: string;
  evidence: Evidence[];
  supersedesObservationId?: string;
}

export interface Evidence {
  id: string;
  locator: string;
  anchor: string | null;
  version: string | null;
  inspectedAt: UtcTimestamp;
  activity: { kind: "read" | "run"; description: string };
  result: { verdict: "pass" | "fail" | "not-assessed"; summary: string };
  limitations: string[];
}

export interface Endpoint {
  planId: string;
  revisionId: string | null;
  kind: "observation" | "outcome";
  id: string;
}

export interface ReasoningLink {
  id: string;
  relation: "supports" | "challenges";
  from: Endpoint;
  to: Endpoint;
  rationale: string;
}

export type DecisionPurpose =
  | "approve-direction"
  | "reject-pending"
  | "reconsider"
  | "pause"
  | "resume"
  | "accept-outcome";

export interface Decision {
  id: string;
  purpose: DecisionPurpose;
  ownerRef: string;
  ownerMessageAt: UtcTimestamp;
  recordedAt: UtcTimestamp;
  planId: string;
  revisionId: string;
  contentDigest: Digest;
  reviewDigest: Digest;
  reason: string;
  outcomeId?: string;
  evidenceDigest?: Digest;
  challengeIds?: string[];
}

export interface OutcomeEvidence {
  outcomeId: string;
  criterionDigest: Digest;
  evidenceIds: string[];
  evidenceDigest: Digest;
  result: "pass";
}

export interface CompletionRecord {
  id: string;
  acceptedRevisionId: string;
  recordedAt: UtcTimestamp;
  outcomeEvidence: OutcomeEvidence[];
  ownerDecisionIds: string[];
  limitations: string[];
}

export interface Receipt {
  requestDigest: Digest;
  storageRevision: string;
  recordedAt: UtcTimestamp;
  result: { action: string; ids: string[] };
}

/** Sorted-key, two-space JSON with one trailing newline. Array order is preserved. */
export function canonical(value: unknown): string {
  const seen = new Set<object>();
  function encode(v: unknown, depth: number): string {
    if (depth > 128) fail("JSON nesting exceeds 128 levels");
    if (v === null) return "null";
    if (typeof v === "string") { unicode(v, "JSON string"); return JSON.stringify(v); }
    if (typeof v === "boolean") return String(v);
    if (typeof v === "number") { if (!Number.isFinite(v)) fail("JSON numbers must be finite"); return JSON.stringify(v); }
    if (typeof v !== "object" || (!Array.isArray(v) && !isObject(v))) fail("value is not JSON data");
    if (seen.has(v)) fail("cyclic JSON data");
    seen.add(v);
    const pad = "  ".repeat(depth), child = pad + "  ";
    let result: string;
    if (Array.isArray(v)) {
      const items = Array.from(v, x => encode(x, depth + 1));
      result = items.length ? `[\n${child}${items.join(`,\n${child}`)}\n${pad}]` : "[]";
    } else {
      if (Object.getOwnPropertySymbols(v).length) fail("symbol keys are not JSON data");
      const items: string[] = [];
      for (const key of Object.keys(v).sort()) {
        unicode(key, "JSON key");
        const desc = Object.getOwnPropertyDescriptor(v, key)!;
        if (!Object.hasOwn(desc, "value")) fail("accessors are not JSON data");
        if (desc.value !== undefined) items.push(`${JSON.stringify(key)}: ${encode(desc.value, depth + 1)}`);
      }
      result = items.length ? `{\n${child}${items.join(`,\n${child}`)}\n${pad}}` : "{}";
    }
    seen.delete(v);
    return result;
  }
  return encode(value, 0) + "\n";
}
export function hashBytes(text: string): Digest { return createHash("sha256").update(text, "utf8").digest("hex"); }
export function digest(value: unknown): Digest { return hashBytes(canonical(value)); }
export function evidenceDigest(evidence: Evidence[]): Digest {
  return digest([...evidence].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}
export function isDigest(value: unknown): value is Digest { return typeof value === "string" && /^[a-f0-9]{64}$/.test(value); }
export function isUtcTimestamp(value: unknown): value is UtcTimestamp {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/.test(value)) return false;
  const time = Date.parse(value);
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 19) === value.slice(0, 19);
}
export function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}
function fail(message: string, code: ModelErrorCode = "invalid-model"): never { throw new DomainError(code, message, 2); }
function unicode(value: string, path: string): void {
  if (/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(value)) fail(`${path}: malformed Unicode`);
}
export function assertClosed(value: unknown, path: string, required: readonly string[], optional: readonly string[] = []): asserts value is Record<string, unknown> {
  if (!isObject(value)) fail(`${path}: expected plain object`);
  for (const key of required) if (!Object.hasOwn(value, key)) fail(`${path}.${key}: required field missing`);
  for (const key of Object.keys(value)) if (!required.includes(key) && !optional.includes(key)) fail(`${path}.${key}: unknown field`);
}
function record(value: unknown, path: string, required: readonly string[], optional: readonly string[] = []): Record<string, unknown> {
  assertClosed(value, path, required, optional); return value;
}
function str(value: unknown, path: string): asserts value is string {
  if (typeof value !== "string" || !value.trim()) fail(`${path}: expected nonempty string`);
  unicode(value, path);
}
function date(value: unknown, path: string): void { if (!isUtcTimestamp(value)) fail(`${path}: expected a real UTC timestamp`); }
function sha(value: unknown, path: string): void { if (!isDigest(value)) fail(`${path}: expected lowercase SHA-256`); }
function choice(value: unknown, values: readonly unknown[], path: string): void { if (!values.includes(value)) fail(`${path}: invalid enum`); }
function array(value: unknown, path: string): unknown[] { if (!Array.isArray(value)) fail(`${path}: expected array`); return value; }
function strings(value: unknown, path: string): string[] { const a = array(value, path); a.forEach((v, i) => str(v, `${path}[${i}]`)); return a as string[]; }
function nullableText(value: unknown, path: string): void { if (value !== null && typeof value !== "string") fail(`${path}: expected string or null`); if (typeof value === "string") unicode(value, path); }
function unique(ids: string[], path: string): void { if (new Set(ids).size !== ids.length) fail(`${path}: duplicate id`, "duplicate-id"); }
function identified(values: unknown, path: string, check: (v: unknown) => unknown): void {
  const a = array(values, path); a.forEach(check); unique(a.map(v => (v as { id: string }).id), path);
}
function textItem(value: unknown): void { const o = record(value, "text item", ["id", "text"]); str(o.id, "id"); str(o.text, "text"); }
export function validateContent(value: unknown): PlanContent {
  const o = record(value, "content", ["title", "purpose", "outcomes", "constraints", "nonGoals", "rationale", "questions", "sources"]);
  for (const k of ["title", "purpose", "rationale"]) str(o[k], `content.${k}`);
  if (!array(o.outcomes, "outcomes").length) fail("content.outcomes: at least one required");
  identified(o.outcomes, "outcomes", v => {
    const r = record(v, "outcome", ["id", "statement", "acceptance", "criterion"]);
    for (const k of ["id", "statement", "criterion"]) str(r[k], `outcome.${k}`);
    choice(r.acceptance, ["objective", "owner"], "outcome.acceptance");
  });
  identified(o.constraints, "constraints", textItem); identified(o.questions, "questions", textItem);
  strings(o.nonGoals, "nonGoals");
  identified(o.sources, "sources", v => {
    const r = record(v, "source", ["id", "locator", "anchor", "observedAt", "version", "limitations"]);
    str(r.id, "source.id"); str(r.locator, "source.locator"); date(r.observedAt, "source.observedAt");
    nullableText(r.anchor, "source.anchor"); nullableText(r.version, "source.version"); strings(r.limitations, "source.limitations");
  });
  return value as PlanContent;
}
function validateEvidence(value: unknown): Evidence {
  const o = record(value, "evidence", ["id", "locator", "anchor", "version", "inspectedAt", "activity", "result", "limitations"]);
  str(o.id, "evidence.id"); str(o.locator, "evidence.locator"); date(o.inspectedAt, "evidence.inspectedAt");
  nullableText(o.anchor, "evidence.anchor"); nullableText(o.version, "evidence.version"); strings(o.limitations, "evidence.limitations");
  const a = record(o.activity, "evidence.activity", ["kind", "description"]);
  choice(a.kind, ["read", "run"], "activity.kind"); str(a.description, "activity.description");
  const r = record(o.result, "evidence.result", ["verdict", "summary"]);
  choice(r.verdict, ["pass", "fail", "not-assessed"], "result.verdict"); str(r.summary, "result.summary");
  return value as Evidence;
}
export function validateObservation(value: unknown): Observation {
  const o = record(value, "observation", ["id", "recordedAt", "classification", "summary", "evidence"], ["supersedesObservationId"]);
  str(o.id, "observation.id"); str(o.summary, "observation.summary"); date(o.recordedAt, "observation.recordedAt");
  choice(o.classification, ["observed", "inferred", "unverified"], "observation.classification");
  identified(o.evidence, "observation.evidence", validateEvidence);
  if (o.classification === "observed" && !(o.evidence as unknown[]).length) fail("observed claims require evidence");
  if (Object.hasOwn(o, "supersedesObservationId")) str(o.supersedesObservationId, "supersedesObservationId");
  return value as Observation;
}
export function validateDecision(value: unknown): Decision {
  const o = record(value, "decision", ["id", "purpose", "ownerRef", "ownerMessageAt", "recordedAt", "planId", "revisionId", "contentDigest", "reviewDigest", "reason"], ["outcomeId", "evidenceDigest", "challengeIds"]);
  for (const k of ["id", "ownerRef", "planId", "revisionId", "reason"]) str(o[k], `decision.${k}`);
  choice(o.purpose, ["approve-direction", "reject-pending", "reconsider", "pause", "resume", "accept-outcome"], "decision.purpose");
  date(o.ownerMessageAt, "decision.ownerMessageAt"); date(o.recordedAt, "decision.recordedAt");
  sha(o.contentDigest, "decision.contentDigest"); sha(o.reviewDigest, "decision.reviewDigest");
  if (o.purpose === "accept-outcome") {
    str(o.outcomeId, "decision.outcomeId"); sha(o.evidenceDigest, "decision.evidenceDigest"); unique(strings(o.challengeIds, "decision.challengeIds"), "challengeIds");
  } else if (["outcomeId", "evidenceDigest", "challengeIds"].some(k => Object.hasOwn(o, k))) fail("outcome fields belong only to accept-outcome decisions");
  return value as Decision;
}
function revision(value: unknown, accepted: boolean): void {
  const extras = accepted ? ["acceptedFromRevision", "directionDecisionId"] : ["baseAcceptedRevision", "baseAcceptedDigest", "reviewState", "rejectionDecisionId"];
  const o = record(value, "revision", ["id", "createdAt", "content", "contentDigest", ...extras]);
  str(o.id, "revision.id"); date(o.createdAt, "revision.createdAt"); validateContent(o.content); sha(o.contentDigest, "contentDigest");
  if (digest(o.content) !== o.contentDigest) fail("revision content digest mismatch", "digest-mismatch");
  if (accepted) { str(o.acceptedFromRevision, "acceptedFromRevision"); str(o.directionDecisionId, "directionDecisionId"); if (o.id === o.acceptedFromRevision) fail("accepted revision must have a fresh identity"); }
  else {
    if (o.baseAcceptedRevision !== null) str(o.baseAcceptedRevision, "baseAcceptedRevision");
    if (o.baseAcceptedDigest !== null) sha(o.baseAcceptedDigest, "baseAcceptedDigest");
    choice(o.reviewState, ["awaiting", "rejected"], "reviewState");
    if (o.reviewState === "awaiting" ? o.rejectionDecisionId !== null : typeof o.rejectionDecisionId !== "string") fail("pending rejection reference inconsistent");
    if (o.reviewState === "rejected") str(o.rejectionDecisionId, "rejectionDecisionId");
  }
}
function endpoint(value: unknown, kind: string): void {
  const o = record(value, "endpoint", ["planId", "revisionId", "kind", "id"]);
  str(o.planId, "endpoint.planId"); str(o.id, "endpoint.id"); choice(o.kind, [kind], "endpoint.kind");
  if (kind === "observation") { if (o.revisionId !== null) fail("observation endpoint revision must be null"); }
  else str(o.revisionId, "endpoint.revisionId");
}
function completion(value: unknown): void {
  const o = record(value, "completion", ["id", "acceptedRevisionId", "recordedAt", "outcomeEvidence", "ownerDecisionIds", "limitations"]);
  str(o.id, "completion.id"); str(o.acceptedRevisionId, "acceptedRevisionId"); date(o.recordedAt, "completion.recordedAt");
  unique(strings(o.ownerDecisionIds, "ownerDecisionIds"), "ownerDecisionIds"); strings(o.limitations, "completion.limitations");
  const rows = array(o.outcomeEvidence, "outcomeEvidence");
  for (const v of rows) {
    const r = record(v, "outcome evidence", ["outcomeId", "criterionDigest", "evidenceIds", "evidenceDigest", "result"]);
    str(r.outcomeId, "outcomeId"); sha(r.criterionDigest, "criterionDigest"); sha(r.evidenceDigest, "evidenceDigest");
    const ids = strings(r.evidenceIds, "evidenceIds"); if (!ids.length) fail("completion evidence must not be empty"); unique(ids, "evidenceIds"); choice(r.result, ["pass"], "verification result");
  }
  unique(rows.map(r => (r as OutcomeEvidence).outcomeId), "completion outcomes");
}
function planShape(value: unknown): void {
  const o = record(value, "plan", ["id", "createdAt", "updatedAt", "accepted", "pending", "lifecycle", "observations", "decisions", "reasoningLinks", "completionRecords", "downstreamSpec", "implementationAuthorization"]);
  str(o.id, "plan.id"); date(o.createdAt, "plan.createdAt"); date(o.updatedAt, "plan.updatedAt");
  if (o.downstreamSpec !== null || o.implementationAuthorization !== null) fail("package 1 does not support attachments or implementation grants", "unsupported-capability");
  if (o.accepted === null && o.pending === null) fail("plan requires accepted or pending content");
  if (o.accepted !== null) revision(o.accepted, true);
  if (o.pending !== null) revision(o.pending, false);
  if (!isObject(o.lifecycle)) fail("lifecycle must be tagged object");
  choice(o.lifecycle.state, ["unaccepted", "open", "paused", "completed"], "lifecycle.state");
  const extra = o.lifecycle.state === "paused" ? ["decisionId"] : o.lifecycle.state === "completed" ? ["completionId"] : [];
  assertClosed(o.lifecycle, "lifecycle", ["state", ...extra]); extra.forEach(k => str((o.lifecycle as Record<string, unknown>)[k], `lifecycle.${k}`));
  if ((o.accepted === null) !== (o.lifecycle.state === "unaccepted")) fail("lifecycle and accepted content disagree");
  identified(o.observations, "observations", validateObservation); identified(o.decisions, "decisions", validateDecision); identified(o.completionRecords, "completions", completion);
  identified(o.reasoningLinks, "reasoningLinks", v => {
    const r = record(v, "reasoning link", ["id", "relation", "from", "to", "rationale"]);
    str(r.id, "link.id"); str(r.rationale, "link.rationale"); choice(r.relation, ["supports", "challenges"], "link.relation"); endpoint(r.from, "observation"); endpoint(r.to, "outcome");
  });
  const p = value as Plan;
  unique([...p.observations, ...p.decisions, ...p.reasoningLinks, ...p.completionRecords, ...p.observations.flatMap(x => x.evidence), ...(p.accepted ? [p.accepted] : []), ...(p.pending ? [p.pending] : [])].map(x => x.id), "plan record IDs");
}
function requireRef(condition: unknown, message: string): asserts condition { if (!condition) fail(message, "invalid-reference"); }
function requireDigest(condition: unknown, message: string): void { if (!condition) fail(message, "digest-mismatch"); }
function planReferences(p: Plan, plans: Map<string, Plan>): void {
  const decisions = new Map(p.decisions.map(d => [d.id, d]));
  const challengeLinks = new Map([...plans.values()].flatMap(container => container.reasoningLinks.map(link => [JSON.stringify([container.id, link.id]), link] as const)));
  for (const d of p.decisions) {
    requireRef(d.planId === p.id, "decision belongs to another plan");
    const subject = [p.accepted, p.pending].find(r => r?.id === d.revisionId)
      ?? (p.accepted?.acceptedFromRevision === d.revisionId ? p.accepted : undefined);
    if (subject) {
      requireDigest(d.contentDigest === subject.contentDigest, "decision content digest mismatch");
      if (d.purpose === "accept-outcome") requireRef(subject.content.outcomes.some(o => o.id === d.outcomeId), "decision outcome missing");
    }
    for (const id of d.challengeIds ?? []) {
      const link = challengeLinks.get(id);
      requireRef(link && link.relation === "challenges" && link.to.planId === p.id && link.to.revisionId === d.revisionId && link.to.id === d.outcomeId, "decision challenge reference mismatch");
    }
    // Old acceptance remains valid history when later observations change current evidence.
  }
  const bound = (id: string, purpose: DecisionPurpose, rev: string, contentDigest: string) => {
    const d = decisions.get(id); requireRef(d && d.purpose === purpose && d.revisionId === rev, "decision subject or purpose mismatch");
    requireDigest(d.contentDigest === contentDigest, "decision content digest mismatch"); return d;
  };
  if (p.accepted) bound(p.accepted.directionDecisionId, "approve-direction", p.accepted.acceptedFromRevision, p.accepted.contentDigest);
  if (p.pending) {
    const consumed = new Set([
      ...(p.accepted ? [p.accepted.acceptedFromRevision] : []),
      ...p.decisions.filter(d => !["reject-pending", "reconsider"].includes(d.purpose)).map(d => d.revisionId),
      ...p.completionRecords.map(c => c.acceptedRevisionId),
    ]);
    requireRef(!consumed.has(p.pending.id), "pending revision reuses a consumed identity");
    if ((p.pending.baseAcceptedRevision === null) !== (p.accepted === null) || (p.pending.baseAcceptedDigest === null) !== (p.accepted === null)) fail("pending null base differs from accepted state");
    requireRef(p.pending.baseAcceptedRevision === (p.accepted?.id ?? null), "pending base revision is stale");
    requireDigest(p.pending.baseAcceptedDigest === (p.accepted?.contentDigest ?? null), "pending base digest is stale");
    if (p.pending.reviewState === "rejected") bound(p.pending.rejectionDecisionId!, "reject-pending", p.pending.id, p.pending.contentDigest);
  }
  const prior = new Set<string>();
  for (const o of p.observations) {
    if (o.supersedesObservationId !== undefined) requireRef(prior.has(o.supersedesObservationId), "correction must reference an earlier observation");
    prior.add(o.id);
  }
  for (const link of p.reasoningLinks) {
    const source = plans.get(link.from.planId), target = plans.get(link.to.planId);
    requireRef(source?.observations.some(o => o.id === link.from.id), "missing source observation"); requireRef(target, "missing target plan");
    const rev = [target.accepted, target.pending].find(r => r?.id === link.to.revisionId);
    if (rev) requireRef(rev.content.outcomes.some(o => o.id === link.to.id), "missing current outcome");
    // A non-current pinned revision is historical/unresolved. Creation checks live in the transition.
  }
  if (p.lifecycle.state === "paused") bound(p.lifecycle.decisionId, "pause", p.accepted!.id, p.accepted!.contentDigest);
  for (const c of p.completionRecords) {
    for (const id of c.ownerDecisionIds) {
      const d = decisions.get(id);
      requireRef(d?.purpose === "accept-outcome" && d.revisionId === c.acceptedRevisionId && c.outcomeEvidence.some(row => row.outcomeId === d.outcomeId && row.evidenceDigest === d.evidenceDigest), "completion owner decision binding mismatch");
    }
    for (const row of c.outcomeEvidence) {
      const linked = [...plans.values()].flatMap(container => container.reasoningLinks.filter(link => link.relation === "supports" && link.to.planId === p.id && link.to.revisionId === c.acceptedRevisionId && link.to.id === row.outcomeId).map(link => plans.get(link.from.planId)!.observations.find(o => o.id === link.from.id)!));
      // Explicit support links pin source identity. Unrelated later local records cannot shadow it.
      const candidates = (linked.length ? linked : p.observations).flatMap(observation => observation.evidence.map(evidence => ({ observation, evidence })));
      const ev = row.evidenceIds.map(id => {
        const matches = candidates.filter(item => item.evidence.id === id);
        requireRef(matches.length > 0, "missing completion evidence");
        requireRef(matches.every(item => digest(item.evidence) === digest(matches[0].evidence)), "ambiguous completion evidence identity");
        const item = matches.find(item => item.observation.classification === "observed" && item.evidence.result.verdict === "pass");
        if (!item) fail("completion requires observed passing evidence");
        return item.evidence;
      });
      requireDigest(evidenceDigest(ev) === row.evidenceDigest, "completion evidence digest mismatch");
    }
    if (c.acceptedRevisionId === p.accepted?.id) {
      const outcomes = p.accepted.content.outcomes;
      if (c.outcomeEvidence.length !== outcomes.length) fail("completion does not cover every outcome");
      for (const out of outcomes) {
        const row = c.outcomeEvidence.find(r => r.outcomeId === out.id); requireRef(row, "completion outcome missing");
        requireDigest(row.criterionDigest === digest(out.criterion), "completion criterion digest mismatch");
        if (out.acceptance === "owner" && !c.ownerDecisionIds.some(id => {
          const d = decisions.get(id)!; return d.revisionId === c.acceptedRevisionId && d.contentDigest === p.accepted!.contentDigest && d.outcomeId === out.id && d.evidenceDigest === row.evidenceDigest;
        })) fail("owner outcome completion lacks matching acceptance");
      }
    }
  }
  if (p.lifecycle.state === "completed") {
    const id = p.lifecycle.completionId;
    requireRef(p.completionRecords.some(c => c.id === id && c.acceptedRevisionId === p.accepted!.id), "lifecycle completion does not match accepted revision");
  }
}
/** Closed structural validation plus cross-reference, digest, lifecycle and capability checks. */
export function validateScope(value: unknown): ScopeState {
  if (!isObject(value) || value.format !== SCOPE_FORMAT) fail("expected mozak.scope/v2; conversion is not automatic", "unsupported-format");
  const o = record(value, "scope envelope", ["format", "scope", "storage", "plans", "connections", "receipts"]);
  const s = record(o.scope, "scope", ["id", "kind", "title", "createdAt", "initialization"]);
  str(s.id, "scope.id"); str(s.title, "scope.title"); choice(s.kind, ["project", "topic"], "scope.kind"); date(s.createdAt, "scope.createdAt");
  const init = record(s.initialization, "initialization", ["operationId", "ownerRef", "ownerMessageAt", "recordedAt"]);
  str(init.operationId, "initialization.operationId"); str(init.ownerRef, "initialization.ownerRef"); date(init.ownerMessageAt, "initialization.ownerMessageAt"); date(init.recordedAt, "initialization.recordedAt");
  const st = record(o.storage, "storage", ["revision", "updatedAt", "previousBridge"]);
  str(st.revision, "storage.revision"); date(st.updatedAt, "storage.updatedAt");
  const token = record(st.previousBridge, "previousBridge", ["exists", "sha256"]);
  if (typeof token.exists !== "boolean") fail("previousBridge.exists must be boolean");
  if (token.exists) sha(token.sha256, "previousBridge.sha256"); else if (token.sha256 !== null) fail("absent bridge hash must be null");
  if (array(o.connections, "connections").length) fail("cross-scope connections are unsupported in package 1", "unsupported-capability");
  identified(o.plans, "plans", planShape);
  const plans = o.plans as Plan[];
  unique(plans.flatMap(p => [p.accepted?.id, p.pending?.id].filter((id): id is string => id !== undefined)), "scope revisions");
  const map = new Map(plans.map(p => [p.id, p])); plans.forEach(p => planReferences(p, map));
  if (!isObject(o.receipts)) fail("receipts must be an operation-keyed record");
  for (const [id, v] of Object.entries(o.receipts)) {
    str(id, "operation id"); const r = record(v, "receipt", ["requestDigest", "storageRevision", "recordedAt", "result"]);
    sha(r.requestDigest, "receipt.requestDigest"); str(r.storageRevision, "receipt.storageRevision"); date(r.recordedAt, "receipt.recordedAt");
    const result = record(r.result, "receipt.result", ["action", "ids"]); str(result.action, "receipt.action"); strings(result.ids, "receipt.ids");
  }
  canonical(value); // Reject hidden non-JSON values, cycles and malformed Unicode throughout.
  return value as unknown as ScopeState;
}
export function newRevision(content: PlanContent, now: UtcTimestamp): Revision {
  validateContent(content); date(now, "revision.createdAt");
  return { id: randomUUID(), createdAt: now, content: structuredClone(content), contentDigest: digest(content) };
}
