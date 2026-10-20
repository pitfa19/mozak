// Owner annotations: cross-plan references and deadline overrides in mozak.annotations.json, next to mozak.json.
// The sidecar is not part of the canonical graph. mozak.json and mozak.md never change because of it, a 0.4.0
// client never reads it, and agent writes never carry its hash, so an annotation never makes an agent stale.
// Only the owner route `annotate` writes it (scope-store.ts annotateScope). Everything here is pure or read-only.

import { createHash } from "node:crypto";
import { lstatSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { DomainError } from "./errors.ts";
import { canonical, digest, isObject, isUtcTimestamp, type Digest, type FileToken, type Plan, type ScopeState, type UtcTimestamp } from "./understanding.ts";

export const ANNOTATIONS_FILE = "mozak.annotations.json";
export const ANNOTATIONS_FORMAT = "mozak.annotations/v1";
export const REF_RELATIONS = ["needs", "informs", "supersedes"] as const;
export type RefRelation = (typeof REF_RELATIONS)[number];
/** Owner batches stay small so each item can be read and approved on its own. */
export const MAX_ANNOTATE_ITEMS = 7;
export const MAX_ANNOTATIONS_BYTES = 1048576;
const MAX_EVIDENCE = 2000;

export interface OwnerProvenance {
  ownerRef: string;
  ownerMessageAt: UtcTimestamp;
  recordedAt: UtcTimestamp;
  operationId: string;
  itemDigest: Digest;
}
export interface PlanRef {
  id: string;
  /** `scope/plan` or `scope/plan#outcome`. */
  target: string;
  relation: RefRelation;
  fromOutcome?: string;
  /** The sentence that justifies the reference, shown to the owner. */
  evidence: string;
  provenance: OwnerProvenance;
}
export interface DeadlineOverride { date: string; evidence: string; provenance: OwnerProvenance }
export interface PlanAnnotations { refs: PlanRef[]; deadline?: DeadlineOverride }
export interface AnnotationReceipt { requestDigest: Digest; revision: string; recordedAt: UtcTimestamp; result: { action: "annotate"; ids: string[] } }
export interface AnnotationsDoc {
  format: typeof ANNOTATIONS_FORMAT;
  scopeId: string;
  revision: string;
  updatedAt: UtcTimestamp;
  plans: Record<string, PlanAnnotations>;
  receipts: Record<string, AnnotationReceipt>;
}

function bad(message: string, code = "annotations-invalid"): never { throw new DomainError(code, message, 2); }
function closedObject(value: unknown, path: string, required: readonly string[], optional: readonly string[] = []): Record<string, unknown> {
  if (!isObject(value)) bad(`${path}: expected an object`);
  for (const key of required) if (!Object.hasOwn(value, key)) bad(`${path}.${key}: required field missing`);
  for (const key of Object.keys(value)) if (!required.includes(key) && !optional.includes(key)) bad(`${path}.${key}: unknown field`);
  return value;
}
function text(value: unknown, path: string, max = 400): string {
  if (typeof value !== "string" || !value.trim()) bad(`${path}: expected a nonempty string`);
  if (value.length > max) bad(`${path}: longer than ${max} characters`);
  return value;
}
function timestamp(value: unknown, path: string): void { if (!isUtcTimestamp(value)) bad(`${path}: expected a UTC timestamp`); }
function sha(value: unknown, path: string): void { if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value)) bad(`${path}: expected lowercase SHA-256`); }

/** Real calendar day in YYYY-MM-DD form. */
export function isCalendarDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split("-").map(Number) as [number, number, number];
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
}

export interface RefTarget { scope: string; planId: string; outcomeId?: string }
/** `scope/plan[#outcome]`. The scope part ends at the first slash, the outcome starts at the last hash. */
export function parseTarget(target: unknown): RefTarget {
  if (typeof target !== "string" || /\s/.test(target)) bad("ref target must look like scope/plan or scope/plan#outcome", "invalid-input");
  const slash = target.indexOf("/");
  if (slash <= 0) bad("ref target must look like scope/plan or scope/plan#outcome", "invalid-input");
  const scope = target.slice(0, slash);
  const rest = target.slice(slash + 1);
  const hash = rest.lastIndexOf("#");
  const planId = hash < 0 ? rest : rest.slice(0, hash);
  const outcomeId = hash < 0 ? undefined : rest.slice(hash + 1);
  if (!planId || outcomeId === "") bad("ref target must look like scope/plan or scope/plan#outcome", "invalid-input");
  return outcomeId === undefined ? { scope, planId } : { scope, planId, outcomeId };
}

function provenance(value: unknown, path: string): OwnerProvenance {
  const o = closedObject(value, path, ["ownerRef", "ownerMessageAt", "recordedAt", "operationId", "itemDigest"]);
  text(o.ownerRef, `${path}.ownerRef`); timestamp(o.ownerMessageAt, `${path}.ownerMessageAt`); timestamp(o.recordedAt, `${path}.recordedAt`);
  text(o.operationId, `${path}.operationId`); sha(o.itemDigest, `${path}.itemDigest`);
  return o as unknown as OwnerProvenance;
}

/** Validate a parsed sidecar. Closed objects throughout: an unknown key is a finding, never silently kept. */
export function validateAnnotations(value: unknown, scopeId?: string): AnnotationsDoc {
  const o = closedObject(value, "annotations", ["format", "scopeId", "revision", "updatedAt", "plans", "receipts"]);
  if (o.format !== ANNOTATIONS_FORMAT) bad(`annotations.format must be "${ANNOTATIONS_FORMAT}"`, "unsupported-format");
  text(o.scopeId, "annotations.scopeId"); text(o.revision, "annotations.revision"); timestamp(o.updatedAt, "annotations.updatedAt");
  if (scopeId !== undefined && o.scopeId !== scopeId) bad("annotations.scopeId does not match the scope", "scope-mismatch");
  if (!isObject(o.plans)) bad("annotations.plans: expected an object");
  for (const [planId, entry] of Object.entries(o.plans)) {
    const p = closedObject(entry, `plans.${planId}`, ["refs"], ["deadline"]);
    if (!Array.isArray(p.refs)) bad(`plans.${planId}.refs: expected an array`);
    const ids = new Set<string>();
    for (const [i, ref] of p.refs.entries()) {
      const path = `plans.${planId}.refs[${i}]`;
      const r = closedObject(ref, path, ["id", "target", "relation", "evidence", "provenance"], ["fromOutcome"]);
      text(r.id, `${path}.id`);
      if (ids.has(r.id as string)) bad(`${path}.id: duplicate ref id`);
      ids.add(r.id as string);
      parseTarget(r.target);
      if (!(REF_RELATIONS as readonly unknown[]).includes(r.relation)) bad(`${path}.relation: must be one of ${REF_RELATIONS.join(", ")}`);
      if (r.fromOutcome !== undefined) text(r.fromOutcome, `${path}.fromOutcome`);
      text(r.evidence, `${path}.evidence`, MAX_EVIDENCE);
      provenance(r.provenance, `${path}.provenance`);
    }
    if (p.deadline !== undefined) {
      const d = closedObject(p.deadline, `plans.${planId}.deadline`, ["date", "evidence", "provenance"]);
      if (!isCalendarDate(d.date)) bad(`plans.${planId}.deadline.date: expected YYYY-MM-DD`);
      text(d.evidence, `plans.${planId}.deadline.evidence`, MAX_EVIDENCE);
      provenance(d.provenance, `plans.${planId}.deadline.provenance`);
    }
  }
  if (!isObject(o.receipts)) bad("annotations.receipts: expected an object");
  for (const [id, receipt] of Object.entries(o.receipts)) {
    const r = closedObject(receipt, `receipts.${id}`, ["requestDigest", "revision", "recordedAt", "result"]);
    sha(r.requestDigest, `receipts.${id}.requestDigest`); text(r.revision, `receipts.${id}.revision`); timestamp(r.recordedAt, `receipts.${id}.recordedAt`);
    const res = closedObject(r.result, `receipts.${id}.result`, ["action", "ids"]);
    if (res.action !== "annotate" || !Array.isArray(res.ids) || res.ids.some((x) => typeof x !== "string")) bad(`receipts.${id}.result: invalid`);
  }
  return o as unknown as AnnotationsDoc;
}

export function emptyAnnotations(scopeId: string, now: UtcTimestamp): AnnotationsDoc {
  return { format: ANNOTATIONS_FORMAT, scopeId, revision: "none", updatedAt: now, plans: {}, receipts: {} };
}

export interface AnnotationsRead { token: FileToken; doc: AnnotationsDoc | null; issues: { code: string; message: string }[] }

/**
 * Read the sidecar of a scope root. Absent is normal (token exists:false, doc null). A symlink, an oversized file,
 * bad JSON or an invalid document is reported as an issue and gives doc null, so a broken sidecar never hides plans.
 */
export function readAnnotations(root: string, scopeId?: string): AnnotationsRead {
  const path = join(root, ANNOTATIONS_FILE);
  let raw: Buffer;
  try {
    const st = lstatSync(path);
    if (!st.isFile() || st.isSymbolicLink()) return { token: { exists: true, sha256: null }, doc: null, issues: [{ code: "annotations-unsafe-path", message: `${ANNOTATIONS_FILE} must be a regular non-symlink file` }] };
    if (st.size > MAX_ANNOTATIONS_BYTES) return { token: { exists: true, sha256: null }, doc: null, issues: [{ code: "annotations-too-large", message: `${ANNOTATIONS_FILE} exceeds 1 MiB` }] };
    raw = readFileSync(path);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return { token: { exists: false, sha256: null }, doc: null, issues: [] };
    throw e;
  }
  const token: FileToken = { exists: true, sha256: createHash("sha256").update(raw).digest("hex") };
  try {
    return { token, doc: validateAnnotations(JSON.parse(raw.toString("utf8")), scopeId), issues: [] };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return { token, doc: null, issues: [{ code: "annotations-invalid", message: `${ANNOTATIONS_FILE}: ${message}` }] };
  }
}

// ---------- owner items ----------

export type AnnotateItem =
  | { kind: "ref"; planId: string; target: string; relation: RefRelation; fromOutcome?: string; evidence: string }
  | { kind: "deadline"; planId: string; date: string; evidence: string }
  | { kind: "remove-ref"; planId: string; refId: string }
  | { kind: "clear-deadline"; planId: string };

/** Validate one item's shape. Returns the item without its optional itemDigest. */
export function validateItem(value: unknown, path = "item"): AnnotateItem {
  if (!isObject(value)) bad(`${path}: expected an object`, "invalid-input");
  const kind = value.kind;
  const fail = (m: string): never => bad(`${path}: ${m}`, "invalid-input");
  const strict = (req: string[], opt: string[] = []) => {
    for (const k of req) if (!Object.hasOwn(value, k)) fail(`missing "${k}"`);
    for (const k of Object.keys(value)) if (!req.includes(k) && !opt.includes(k) && k !== "itemDigest") fail(`unknown field "${k}"`);
  };
  const str = (k: string, max = 400) => { const v = value[k]; if (typeof v !== "string" || !v.trim() || v.length > max) fail(`"${k}" must be a nonempty string of at most ${max} characters`); return v as string; };
  let item: AnnotateItem;
  if (kind === "ref") {
    strict(["kind", "planId", "target", "relation", "evidence"], ["fromOutcome"]);
    parseTarget(value.target);
    if (!(REF_RELATIONS as readonly unknown[]).includes(value.relation)) fail(`relation must be one of ${REF_RELATIONS.join(", ")}`);
    item = { kind, planId: str("planId"), target: value.target as string, relation: value.relation as RefRelation, evidence: str("evidence", MAX_EVIDENCE) };
    if (value.fromOutcome !== undefined) item.fromOutcome = str("fromOutcome");
  } else if (kind === "deadline") {
    strict(["kind", "planId", "date", "evidence"]);
    if (!isCalendarDate(value.date)) fail("date must be a real day as YYYY-MM-DD");
    item = { kind, planId: str("planId"), date: value.date as string, evidence: str("evidence", MAX_EVIDENCE) };
  } else if (kind === "remove-ref") {
    strict(["kind", "planId", "refId"]);
    item = { kind, planId: str("planId"), refId: str("refId") };
  } else if (kind === "clear-deadline") {
    strict(["kind", "planId"]);
    item = { kind, planId: str("planId") };
  } else {
    return fail("kind must be ref, deadline, remove-ref or clear-deadline");
  }
  if (value.itemDigest !== undefined && value.itemDigest !== itemDigest(item)) {
    throw new DomainError("item-digest-mismatch", `${path}: itemDigest does not match the item; show the item again and ask the owner`, 3);
  }
  return item;
}

/** Digest of exactly what the owner sees for one item. */
export function itemDigest(item: AnnotateItem): Digest { return digest(item); }

/** Stable ref id: the same reference proposed twice gets the same id. */
export function refIdOf(item: { planId: string; target: string; relation: RefRelation; fromOutcome?: string }): string {
  return `ref-${digest({ planId: item.planId, target: item.target, relation: item.relation, fromOutcome: item.fromOutcome ?? null }).slice(0, 12)}`;
}

/** An agent proposal: items with their digests and evidence, at most seven per batch. Never written anywhere. */
export function proposeItems(values: unknown[]): { items: (AnnotateItem & { itemDigest: Digest })[] } {
  if (!Array.isArray(values) || values.length === 0 || values.length > MAX_ANNOTATE_ITEMS) bad(`a proposal has 1 to ${MAX_ANNOTATE_ITEMS} items`, "invalid-input");
  return { items: values.map((v, i) => { const item = validateItem(v, `items[${i}]`); return { ...item, itemDigest: itemDigest(item) }; }) };
}

// ---------- resolution ----------

export type ScopeLookup = (scopeId: string) => ScopeState | "unknown" | "unavailable";
export type RefResolution =
  | { status: "resolved"; via: "plan" | "merged"; scope: string; planId: string; outcomeId?: string; mergedFrom?: string }
  | { status: "dangling"; reason: "scope-unknown" | "plan-missing" | "outcome-missing"; scope: string; planId: string; outcomeId?: string }
  | { status: "unavailable"; scope: string; planId: string };

export function planContent(plan: Plan) { return plan.accepted?.content ?? plan.pending?.content ?? null; }

/** Live plan that recorded folding `planId` in through an approve-direction decision with mergedPlanId. */
function mergedInto(state: ScopeState, planId: string): Plan | null {
  return state.plans.find((p) => p.decisions.some((d) => d.mergedPlanId === planId)) ?? null;
}

/** Every ref resolves through a live plan, through decision.mergedPlanId, or is reported dangling or unavailable. */
export function resolveRef(target: string, lookup: ScopeLookup): RefResolution {
  const t = parseTarget(target);
  const state = lookup(t.scope);
  const base = { scope: t.scope, planId: t.planId, ...(t.outcomeId !== undefined ? { outcomeId: t.outcomeId } : {}) };
  if (state === "unknown") return { status: "dangling", reason: "scope-unknown", ...base };
  if (state === "unavailable") return { status: "unavailable", scope: t.scope, planId: t.planId };
  const plan = state.plans.find((p) => p.id === t.planId);
  if (plan) {
    if (t.outcomeId !== undefined) {
      const content = planContent(plan);
      if (!content?.outcomes.some((o) => o.id === t.outcomeId)) return { status: "dangling", reason: "outcome-missing", ...base };
    }
    return { status: "resolved", via: "plan", ...base };
  }
  const host = mergedInto(state, t.planId);
  if (host) {
    const outcomeOk = t.outcomeId === undefined || planContent(host)?.outcomes.some((o) => o.id === t.outcomeId);
    return { status: "resolved", via: "merged", scope: t.scope, planId: host.id, mergedFrom: t.planId, ...(t.outcomeId !== undefined && outcomeOk ? { outcomeId: t.outcomeId } : {}) };
  }
  return { status: "dangling", reason: "plan-missing", ...base };
}

/** Canonical bytes of a sidecar document. */
export function annotationsBytes(doc: AnnotationsDoc): string {
  validateAnnotations(doc);
  const bytes = canonical(doc);
  if (Buffer.byteLength(bytes) > MAX_ANNOTATIONS_BYTES) bad("annotations would exceed 1 MiB", "capacity-exceeded");
  return bytes;
}

export interface AnnotateRequest {
  operationId: string;
  scopeId: string;
  /** Sidecar snapshot the owner reviewed: { exists, sha256 }. This is the only CAS input; the graph hash is not part of it. */
  expectedAnnotations: FileToken;
  ownerRef: string;
  ownerMessageAt: UtcTimestamp;
  items: unknown[];
}

/** Closed request validation, before any file is touched. */
export function validateAnnotateRequest(input: unknown): { request: AnnotateRequest; items: AnnotateItem[] } {
  const o = closedObject(input, "annotate request", ["operationId", "scopeId", "expectedAnnotations", "ownerRef", "ownerMessageAt", "items"]);
  const invalid = (m: string): never => bad(m, "invalid-input");
  if (typeof o.operationId !== "string" || !o.operationId.trim()) invalid("operationId must be a nonempty string");
  if (typeof o.scopeId !== "string" || !o.scopeId.trim()) invalid("scopeId must be a nonempty string");
  const e = o.expectedAnnotations;
  if (!isObject(e) || Object.keys(e).sort().join() !== "exists,sha256" || typeof e.exists !== "boolean" ||
    (e.exists ? typeof e.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(e.sha256) : e.sha256 !== null)) invalid("expectedAnnotations must be { exists, sha256 } of the sidecar");
  if (typeof o.ownerRef !== "string" || !o.ownerRef.trim()) invalid("ownerRef must be a nonempty string");
  if (!isUtcTimestamp(o.ownerMessageAt)) invalid("ownerMessageAt must be a UTC timestamp");
  if (!Array.isArray(o.items) || o.items.length === 0 || o.items.length > MAX_ANNOTATE_ITEMS) invalid(`items must hold 1 to ${MAX_ANNOTATE_ITEMS} owner-approved items`);
  const items = (o.items as unknown[]).map((v, i) => validateItem(v, `items[${i}]`));
  return { request: o as unknown as AnnotateRequest, items };
}

/**
 * Apply owner-approved items to a sidecar document. Pure. Refuses an unknown source plan, an unknown source outcome,
 * a self reference, a target that does not resolve now, a duplicate ref and removing a ref that does not exist.
 * `needs` cycles are not refused here: `needs` is advisory and `check` reports cycles.
 */
export function applyAnnotate(doc: AnnotationsDoc, state: ScopeState, items: AnnotateItem[], request: AnnotateRequest, lookup: ScopeLookup, now: UtcTimestamp, revision: string): { doc: AnnotationsDoc; ids: string[] } {
  const next: AnnotationsDoc = structuredClone(doc);
  next.plans = Object.assign(Object.create(null), next.plans);
  const ids: string[] = [];
  for (const [i, item] of items.entries()) {
    const where = `items[${i}]`;
    const plan = state.plans.find((p) => p.id === item.planId);
    if (!plan) throw new DomainError("stale-reference", `${where}: plan "${item.planId}" is not in this scope`, 3);
    const entry: PlanAnnotations = next.plans[item.planId] ?? { refs: [] };
    const prov: OwnerProvenance = { ownerRef: request.ownerRef, ownerMessageAt: request.ownerMessageAt, recordedAt: now, operationId: request.operationId, itemDigest: itemDigest(item) };
    if (item.kind === "ref") {
      if (item.fromOutcome !== undefined && !planContent(plan)?.outcomes.some((o) => o.id === item.fromOutcome)) {
        throw new DomainError("stale-reference", `${where}: plan "${item.planId}" has no outcome "${item.fromOutcome}"`, 3);
      }
      const t = parseTarget(item.target);
      if (t.scope === state.scope.id && t.planId === item.planId) throw new DomainError("invalid-input", `${where}: a plan cannot reference itself`, 2);
      const resolved = resolveRef(item.target, lookup);
      if (resolved.status !== "resolved") throw new DomainError(resolved.status === "unavailable" ? "ref-target-unavailable" : "ref-dangling", `${where}: target ${item.target} ${resolved.status === "unavailable" ? "cannot be read now" : `does not resolve (${resolved.reason})`}`, 3);
      const id = refIdOf(item);
      if (entry.refs.some((r) => r.id === id)) throw new DomainError("duplicate-ref", `${where}: the same reference already exists as ${id}`, 3);
      const ref: PlanRef = { id, target: item.target, relation: item.relation, evidence: item.evidence, provenance: prov };
      if (item.fromOutcome !== undefined) ref.fromOutcome = item.fromOutcome;
      entry.refs = [...entry.refs, ref];
      ids.push(id);
    } else if (item.kind === "remove-ref") {
      if (!entry.refs.some((r) => r.id === item.refId)) throw new DomainError("stale-reference", `${where}: plan "${item.planId}" has no ref "${item.refId}"`, 3);
      entry.refs = entry.refs.filter((r) => r.id !== item.refId);
      ids.push(item.refId);
    } else if (item.kind === "deadline") {
      entry.deadline = { date: item.date, evidence: item.evidence, provenance: prov };
      ids.push(`deadline:${item.planId}`);
    } else {
      if (!entry.deadline) throw new DomainError("stale-reference", `${where}: plan "${item.planId}" has no deadline override`, 3);
      delete entry.deadline;
      ids.push(`deadline:${item.planId}`);
    }
    if (entry.refs.length === 0 && !entry.deadline) delete next.plans[item.planId];
    else next.plans[item.planId] = entry;
  }
  // Plain object again, sorted by canonical() on write.
  next.plans = { ...next.plans };
  next.revision = revision;
  next.updatedAt = now;
  return { doc: next, ids };
}
