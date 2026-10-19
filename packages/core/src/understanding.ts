// MOZAK v3 understanding model: closed types, validators, canonical bytes and digests.
// Owner refs are trusted-host claims, not cryptographic verification.
// No JSON Schema dependency, no generic unchecked cast as validation.

import { createHash, randomUUID } from "node:crypto";
import { DomainError } from "./errors.ts";

export const SCOPE_FORMAT = "mozak.scope/v3";
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
  format: "mozak.scope/v3";
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
  discussion: Discussion | null;
  specifications: Specification[];
  implementationAuthorizations: Authorization[];
  downstreamSpec: string | null;
  implementationAuthorization: string | null;
}

export interface AnswerInput {
  summary: string;
  basis: "owner" | "inspection";
  ownerRef: string | null;
  ownerMessageAt: UtcTimestamp | null;
  evidence: Evidence[];
}
export interface Answer extends AnswerInput { recordedAt: UtcTimestamp }
export interface QuestionInput {
  id: string | null;
  text: string;
  status: "open" | "answered" | "deferred";
  answers: AnswerInput[];
  reopenReason: string | null;
}
export interface Question {
  id: string;
  text: string;
  status: "open" | "answered" | "deferred";
  answers: Answer[];
  reopenings: { reason: string; recordedAt: UtcTimestamp }[];
}
export interface Discussion {
  id: string;
  updatedAt: UtcTimestamp;
  acceptedRevisionId: string | null;
  pendingRevisionId: string | null;
  summary: string;
  stage: "clarifying" | "ready-for-spec";
  questions: Question[];
}
export interface Bounds {
  summary: string;
  allowedPaths: string[];
  excludedActions: string[];
  outcomeChecks: { outcomeId: string; criterion: string }[];
  limitations: string[];
}
export interface Specification {
  id: string;
  recordedAt: UtcTimestamp;
  acceptedRevisionId: string;
  acceptedContentDigest: Digest;
  path: string;
  sha256: Digest;
  byteLength: number;
  discussionDigest: Digest | null;
  bounds: Bounds;
  boundsDigest: Digest;
}
export interface Authorization {
  id: string;
  decisionId: string;
  recordedAt: UtcTimestamp;
  acceptedRevisionId: string;
  acceptedContentDigest: Digest;
  specificationId: string;
  specificationDigest: Digest;
  boundsDigest: Digest;
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
  mergeFromPlanId?: string;
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
  | "accept-outcome"
  | "approve-implementation"
  | "revoke-implementation";

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
  specificationId?: string;
  authorizationId?: string;
  mergedPlanId?: string;
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
  result: { action: string; ids: string[]; discussion?: Discussion };
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
/** Provenance identity normalizes UTC spelling, never rounds sub-millisecond time. */
export function ownerMessageKey(ownerRef: string, ownerMessageAt: UtcTimestamp): string {
  str(ownerRef, "ownerRef"); date(ownerMessageAt, "ownerMessageAt");
  const normalized = ownerMessageAt.replace(/\.(\d+)Z$/, (_match, fraction: string) => {
    const significant = fraction.replace(/0+$/, "");
    return significant ? `.${significant}Z` : "Z";
  });
  return JSON.stringify([ownerRef, normalized]);
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
export function validateEvidence(value: unknown): Evidence {
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
  const o = record(value, "decision", ["id", "purpose", "ownerRef", "ownerMessageAt", "recordedAt", "planId", "revisionId", "contentDigest", "reviewDigest", "reason"], ["outcomeId", "evidenceDigest", "challengeIds", "specificationId", "authorizationId", "mergedPlanId"]);
  for (const k of ["id", "ownerRef", "planId", "revisionId", "reason"]) str(o[k], `decision.${k}`);
  choice(o.purpose, ["approve-direction", "reject-pending", "reconsider", "pause", "resume", "accept-outcome", "approve-implementation", "revoke-implementation"], "decision.purpose");
  date(o.ownerMessageAt, "decision.ownerMessageAt"); date(o.recordedAt, "decision.recordedAt");
  sha(o.contentDigest, "decision.contentDigest"); sha(o.reviewDigest, "decision.reviewDigest");
  if (o.purpose === "accept-outcome") {
    str(o.outcomeId, "decision.outcomeId"); sha(o.evidenceDigest, "decision.evidenceDigest"); unique(strings(o.challengeIds, "decision.challengeIds"), "challengeIds");
  } else if (["outcomeId", "evidenceDigest", "challengeIds"].some(k => Object.hasOwn(o, k))) fail("outcome fields belong only to accept-outcome decisions");
  if (o.purpose === "approve-implementation") {
    str(o.specificationId, "decision.specificationId"); str(o.authorizationId, "decision.authorizationId");
  } else if (o.purpose === "revoke-implementation") {
    str(o.authorizationId, "decision.authorizationId");
    if (Object.hasOwn(o, "specificationId")) fail("specificationId belongs only to implementation approval");
  } else if (["specificationId", "authorizationId"].some(k => Object.hasOwn(o, k))) fail("implementation fields belong only to implementation decisions");
  if (Object.hasOwn(o, "mergedPlanId")) {
    if (o.purpose !== "approve-direction") fail("mergedPlanId belongs only to approve-direction decisions");
    str(o.mergedPlanId, "decision.mergedPlanId");
  }
  return value as Decision;
}
function revision(value: unknown, accepted: boolean): void {
  const extras = accepted ? ["acceptedFromRevision", "directionDecisionId"] : ["baseAcceptedRevision", "baseAcceptedDigest", "reviewState", "rejectionDecisionId"];
  const o = record(value, "revision", ["id", "createdAt", "content", "contentDigest", ...extras], accepted ? [] : ["mergeFromPlanId"]);
  str(o.id, "revision.id"); date(o.createdAt, "revision.createdAt"); validateContent(o.content); sha(o.contentDigest, "contentDigest");
  if (digest(o.content) !== o.contentDigest) fail("revision content digest mismatch", "digest-mismatch");
  if (accepted) { str(o.acceptedFromRevision, "acceptedFromRevision"); str(o.directionDecisionId, "directionDecisionId"); if (o.id === o.acceptedFromRevision) fail("accepted revision must have a fresh identity"); }
  else {
    if (o.baseAcceptedRevision !== null) str(o.baseAcceptedRevision, "baseAcceptedRevision");
    if (o.baseAcceptedDigest !== null) sha(o.baseAcceptedDigest, "baseAcceptedDigest");
    choice(o.reviewState, ["awaiting", "rejected"], "reviewState");
    if (o.reviewState === "awaiting" ? o.rejectionDecisionId !== null : typeof o.rejectionDecisionId !== "string") fail("pending rejection reference inconsistent");
    if (o.reviewState === "rejected") str(o.rejectionDecisionId, "rejectionDecisionId");
    if (Object.hasOwn(o, "mergeFromPlanId")) str(o.mergeFromPlanId, "mergeFromPlanId");
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
function shortText(value: unknown, path: string): void {
  str(value, path);
  if (Buffer.byteLength(value, "utf8") > 2000) fail(`${path}: exceeds 2000 UTF-8 bytes`);
}
function boundedArray(value: unknown, path: string, max: number): unknown[] {
  const result = array(value, path);
  if (result.length > max) fail(`${path}: exceeds ${max} records`);
  return result;
}
export function validateAnswerInput(value: unknown): AnswerInput {
  const o = record(value, "answer", ["summary", "basis", "ownerRef", "ownerMessageAt", "evidence"]);
  shortText(o.summary, "answer.summary"); choice(o.basis, ["owner", "inspection"], "answer.basis");
  identified(o.evidence, "answer.evidence", validateEvidence);
  if (o.basis === "owner") { str(o.ownerRef, "answer.ownerRef"); date(o.ownerMessageAt, "answer.ownerMessageAt"); }
  else if (o.ownerRef !== null || o.ownerMessageAt !== null || !(o.evidence as unknown[]).length) fail("inspection answers require evidence and null owner provenance");
  return value as AnswerInput;
}
export function validateQuestionInput(value: unknown): QuestionInput {
  const o = record(value, "question input", ["id", "text", "status", "answers", "reopenReason"]);
  if (o.id !== null) str(o.id, "question.id");
  shortText(o.text, "question.text"); choice(o.status, ["open", "answered", "deferred"], "question.status");
  const answers = boundedArray(o.answers, "question.answers", 16); answers.forEach(validateAnswerInput);
  if (o.status !== "open" && !answers.length) fail("settled questions require an answer explaining the result or deferral");
  if (o.reopenReason !== null) shortText(o.reopenReason, "question.reopenReason");
  if (o.id === null && o.reopenReason !== null) fail("new question cannot have a reopening reason");
  return value as QuestionInput;
}
export function validateDiscussion(value: unknown): Discussion {
  const o = record(value, "discussion", ["id", "updatedAt", "acceptedRevisionId", "pendingRevisionId", "summary", "stage", "questions"]);
  str(o.id, "discussion.id"); date(o.updatedAt, "discussion.updatedAt"); shortText(o.summary, "discussion.summary");
  for (const key of ["acceptedRevisionId", "pendingRevisionId"]) if (o[key] !== null) str(o[key], `discussion.${key}`);
  choice(o.stage, ["clarifying", "ready-for-spec"], "discussion.stage");
  const questions = boundedArray(o.questions, "discussion.questions", 32);
  for (const value of questions) {
    const q = record(value, "question", ["id", "text", "status", "answers", "reopenings"]);
    str(q.id, "question.id"); shortText(q.text, "question.text"); choice(q.status, ["open", "answered", "deferred"], "question.status");
    const answers = boundedArray(q.answers, "question.answers", 16);
    for (const value of answers) {
      const answer = record(value, "answer", ["summary", "basis", "ownerRef", "ownerMessageAt", "evidence", "recordedAt"]);
      const { recordedAt, ...input } = answer; date(recordedAt, "answer.recordedAt"); validateAnswerInput(input);
    }
    const reopenings = boundedArray(q.reopenings, "question.reopenings", 16);
    for (const value of reopenings) {
      const r = record(value, "reopening", ["reason", "recordedAt"]); shortText(r.reason, "reopening.reason"); date(r.recordedAt, "reopening.recordedAt");
    }
    if (q.status !== "open" && !answers.length) fail("settled questions require an answer");
    if (q.status === "open" && answers.length && !reopenings.length) fail("open questions retaining answers require reopening history");
    if (reopenings.length && !answers.length) fail("reopening requires retained answers");
    if (reopenings.length > answers.length - (q.status === "open" ? 0 : 1)) fail("each settled reopening requires an additional retained answer");
    if (o.stage === "ready-for-spec" && q.status === "open") fail("ready-for-spec discussion has open questions");
  }
  unique(questions.map(q => (q as Question).id), "discussion questions");
  canonical(value);
  return value as Discussion;
}
export function discussionDigest(value: Discussion): Digest {
  validateDiscussion(value);
  const { id: _id, updatedAt: _updatedAt, ...semantic } = value;
  return digest(semantic);
}
/** Pure lexical check. The store separately rejects symlinks and unsafe file types. */
export function validateRelativePath(value: unknown): string {
  str(value, "path");
  if (/^[\/\\]|^[A-Za-z]:|[\0\\*?\[\]{}]/.test(value) || value.split("/").some(part => part === ".." || part === "." || part === "")) fail("path must be an explicit scope-relative path without traversal or globs");
  return value;
}
export function validateBounds(value: unknown): Bounds {
  const o = record(value, "bounds", ["summary", "allowedPaths", "excludedActions", "outcomeChecks", "limitations"]);
  str(o.summary, "bounds.summary");
  const paths = strings(o.allowedPaths, "bounds.allowedPaths"); paths.forEach(validateRelativePath); unique(paths, "bounds.allowedPaths");
  strings(o.excludedActions, "bounds.excludedActions"); strings(o.limitations, "bounds.limitations");
  const checks = array(o.outcomeChecks, "bounds.outcomeChecks");
  for (const value of checks) { const c = record(value, "outcome check", ["outcomeId", "criterion"]); str(c.outcomeId, "outcomeId"); str(c.criterion, "criterion"); }
  unique(checks.map(c => (c as Bounds["outcomeChecks"][number]).outcomeId), "bounds outcomes");
  return value as Bounds;
}
function specification(value: unknown): void {
  const o = record(value, "specification", ["id", "recordedAt", "acceptedRevisionId", "acceptedContentDigest", "path", "sha256", "byteLength", "discussionDigest", "bounds", "boundsDigest"]);
  str(o.id, "specification.id"); str(o.acceptedRevisionId, "specification.acceptedRevisionId"); date(o.recordedAt, "specification.recordedAt");
  validateRelativePath(o.path); if (!/\.md$/i.test(o.path as string)) fail("specification must be Markdown");
  for (const key of ["acceptedContentDigest", "sha256", "boundsDigest"]) sha(o[key], `specification.${key}`);
  if (o.discussionDigest !== null) sha(o.discussionDigest, "specification.discussionDigest");
  if (!Number.isSafeInteger(o.byteLength) || (o.byteLength as number) < 0 || (o.byteLength as number) > 262144) fail("specification byteLength exceeds bounded file size");
  validateBounds(o.bounds); requireDigest(digest(o.bounds) === o.boundsDigest, "specification bounds digest mismatch");
}
function authorization(value: unknown): void {
  const o = record(value, "authorization", ["id", "decisionId", "recordedAt", "acceptedRevisionId", "acceptedContentDigest", "specificationId", "specificationDigest", "boundsDigest"]);
  for (const key of ["id", "decisionId", "acceptedRevisionId", "specificationId"]) str(o[key], `authorization.${key}`);
  date(o.recordedAt, "authorization.recordedAt");
  for (const key of ["acceptedContentDigest", "specificationDigest", "boundsDigest"]) sha(o[key], `authorization.${key}`);
}
function planShape(value: unknown): void {
  const o = record(value, "plan", ["id", "createdAt", "updatedAt", "accepted", "pending", "lifecycle", "observations", "decisions", "reasoningLinks", "completionRecords", "discussion", "specifications", "implementationAuthorizations", "downstreamSpec", "implementationAuthorization"]);
  str(o.id, "plan.id"); date(o.createdAt, "plan.createdAt"); date(o.updatedAt, "plan.updatedAt");
  for (const key of ["downstreamSpec", "implementationAuthorization"]) if (o[key] !== null) {
    if (typeof o[key] !== "string") fail(`${key} must be a record identity or null`, "unsupported-capability");
    str(o[key], key);
  }
  if (o.discussion !== null) validateDiscussion(o.discussion);
  identified(o.specifications, "specifications", specification); identified(o.implementationAuthorizations, "implementationAuthorizations", authorization);
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
  unique([...p.observations, ...p.decisions, ...p.reasoningLinks, ...p.completionRecords, ...p.specifications, ...p.implementationAuthorizations, ...(p.discussion ? [p.discussion, ...p.discussion.questions] : []), ...p.observations.flatMap(x => x.evidence), ...(p.accepted ? [p.accepted] : []), ...(p.pending ? [p.pending] : [])].map(x => x.id), "plan record IDs");
}
function requireRef(condition: unknown, message: string): asserts condition { if (!condition) fail(message, "invalid-reference"); }
function requireDigest(condition: unknown, message: string): void { if (!condition) fail(message, "digest-mismatch"); }
function planReferences(p: Plan, plans: Map<string, Plan>): void {
  const decisions = new Map(p.decisions.map(d => [d.id, d]));
  const specifications = new Map(p.specifications.map(s => [s.id, s]));
  const authorizations = new Map(p.implementationAuthorizations.map(a => [a.id, a]));
  // Historical content is not retained, but every retained binding to its identity must agree.
  const revisionDigests = new Map<string, string>();
  const bindRevision = (id: string, sha256: string) => {
    const previous = revisionDigests.get(id);
    requireDigest(previous === undefined || previous === sha256, "retained revision content digest mismatch");
    revisionDigests.set(id, sha256);
  };
  for (const r of [p.accepted, p.pending]) if (r) bindRevision(r.id, r.contentDigest);
  for (const d of p.decisions) bindRevision(d.revisionId, d.contentDigest);
  for (const s of p.specifications) {
    bindRevision(s.acceptedRevisionId, s.acceptedContentDigest);
    if (s.acceptedRevisionId === p.accepted?.id) {
      const outcomes = p.accepted.content.outcomes;
      requireRef(s.bounds.outcomeChecks.length === outcomes.length && outcomes.every(o => s.bounds.outcomeChecks.some(c => c.outcomeId === o.id)), "specification bounds must cover every accepted outcome");
    }
  }
  for (const a of p.implementationAuthorizations) {
    bindRevision(a.acceptedRevisionId, a.acceptedContentDigest);
    const s = specifications.get(a.specificationId), d = decisions.get(a.decisionId);
    requireRef(s && d?.purpose === "approve-implementation" && d.authorizationId === a.id && d.specificationId === s.id, "authorization approval or specification missing");
    requireRef(a.acceptedRevisionId === s.acceptedRevisionId && d.revisionId === a.acceptedRevisionId && a.recordedAt === d.recordedAt, "authorization revision or recorded time mismatch");
    requireDigest(a.acceptedContentDigest === s.acceptedContentDigest && a.acceptedContentDigest === d.contentDigest && a.specificationDigest === s.sha256 && a.boundsDigest === s.boundsDigest, "authorization binding digest mismatch");
  }
  let effectiveAuthorization: string | null = null;
  const ownerMessages = new Set<string>();
  for (const d of p.decisions) {
    if (d.purpose === "approve-direction") effectiveAuthorization = null;
    if (d.purpose === "approve-implementation" || d.purpose === "revoke-implementation") {
      const provenance = ownerMessageKey(d.ownerRef, d.ownerMessageAt);
      requireRef(!ownerMessages.has(provenance), "owner message reused for implementation decision"); ownerMessages.add(provenance);
      const a = authorizations.get(d.authorizationId!);
      requireRef(a && d.revisionId === a.acceptedRevisionId, "implementation decision authorization mismatch");
      requireDigest(d.contentDigest === a.acceptedContentDigest, "implementation decision content mismatch");
      if (d.purpose === "approve-implementation") {
        requireRef(a.decisionId === d.id && a.specificationId === d.specificationId, "implementation approval backlink mismatch");
        effectiveAuthorization = a.id;
      } else {
        requireRef(effectiveAuthorization === a.id, "revocation must target the effective authorization"); effectiveAuthorization = null;
      }
    }
  }
  requireRef(p.implementationAuthorization === effectiveAuthorization, "current authorization disagrees with retained decision history");
  if (p.implementationAuthorization !== null) {
    const a = authorizations.get(p.implementationAuthorization)!;
    requireRef(a.acceptedRevisionId === p.accepted?.id, "current authorization belongs to historical direction");
  }
  if (p.downstreamSpec !== null) {
    const s = specifications.get(p.downstreamSpec);
    requireRef(s && s.acceptedRevisionId === p.accepted?.id, "candidate specification belongs to missing or historical direction");
    requireRef(!p.decisions.some(d => d.purpose === "revoke-implementation" && authorizations.get(d.authorizationId!)?.specificationId === s.id), "revoked specification cannot be requeued without a fresh descriptor");
  }
  const challengeLinks = new Map([...plans.values()].flatMap(container => container.reasoningLinks.map(link => [JSON.stringify([container.id, link.id]), link] as const)));
  for (const d of p.decisions) {
    requireRef(d.planId === p.id, "decision belongs to another plan");
    if (d.mergedPlanId !== undefined) requireRef(d.mergedPlanId !== p.id, "decision cannot record merging a plan into itself");
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
    if (p.pending.mergeFromPlanId !== undefined) {
      requireRef(p.pending.mergeFromPlanId !== p.id, "pending revision cannot merge a plan into itself");
      const source = plans.get(p.pending.mergeFromPlanId);
      requireRef(source && source.lifecycle.state !== "completed", "pending mergeFromPlanId must reference an existing non-completed plan");
    }
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
  const last = p.decisions.filter(d => d.purpose === "pause" || d.purpose === "resume").at(-1);
  if (last?.purpose === "pause") requireRef(p.lifecycle.state === "paused", "effective pause cannot be cleared without explicit resume");
  if (p.lifecycle.state === "paused") {
    requireRef(last?.purpose === "pause" && last.id === p.lifecycle.decisionId, "paused lifecycle must retain the effective pause decision");
    if (last.revisionId === p.accepted!.id) requireDigest(last.contentDigest === p.accepted!.contentDigest, "pause content digest mismatch");
    else requireRef(p.decisions.indexOf(last) < p.decisions.findIndex(d => d.id === p.accepted!.directionDecisionId), "historical pause must precede current direction approval");
  }
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
  if (!isObject(value) || value.format !== SCOPE_FORMAT) fail("expected mozak.scope/v3; conversion is not automatic", "unsupported-format");
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
  const allDecisions = plans.flatMap(p => p.decisions);
  const messageCounts = new Map<string, number>();
  for (const d of allDecisions) {
    const key = ownerMessageKey(d.ownerRef, d.ownerMessageAt);
    messageCounts.set(key, (messageCounts.get(key) ?? 0) + 1);
  }
  for (const d of allDecisions) if (d.purpose === "approve-implementation" || d.purpose === "revoke-implementation") {
    requireRef(messageCounts.get(ownerMessageKey(d.ownerRef, d.ownerMessageAt)) === 1, "implementation requires a separate owner message across scope decisions");
  }
  unique(plans.flatMap(p => [p.accepted?.id, p.pending?.id].filter((id): id is string => id !== undefined)), "scope revisions");
  const map = new Map(plans.map(p => [p.id, p])); plans.forEach(p => planReferences(p, map));
  if (!isObject(o.receipts)) fail("receipts must be an operation-keyed record");
  for (const [id, v] of Object.entries(o.receipts)) {
    str(id, "operation id"); const r = record(v, "receipt", ["requestDigest", "storageRevision", "recordedAt", "result"]);
    sha(r.requestDigest, "receipt.requestDigest"); str(r.storageRevision, "receipt.storageRevision"); date(r.recordedAt, "receipt.recordedAt");
    const result = record(r.result, "receipt.result", ["action", "ids"], ["discussion"]); str(result.action, "receipt.action"); strings(result.ids, "receipt.ids");
    if (Object.hasOwn(result, "discussion")) {
      if (result.action !== "save-discussion") fail("discussion receipt belongs only to save-discussion");
      validateDiscussion(result.discussion);
    }
  }
  canonical(value); // Reject hidden non-JSON values, cycles and malformed Unicode throughout.
  return value as unknown as ScopeState;
}
export function newRevision(content: PlanContent, now: UtcTimestamp): Revision {
  validateContent(content); date(now, "revision.createdAt");
  return { id: randomUUID(), createdAt: now, content: structuredClone(content), contentDigest: digest(content) };
}
