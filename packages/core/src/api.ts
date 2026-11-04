// Shared operation facade for the CLI and the agent-safe MCP subset.
// Closed argument schemas, actor gating and exit-code mapping live here. Storage rules stay in
// scope-store.ts and review rules in review.ts. The actor comes only from the caller, never from data.

import { DomainError } from "./errors.ts";
import { nonEmptyString as nonEmpty } from "./validate.ts";
import { resolveScope, type ScopeEntry, type ScopeInventory } from "./scope-index.ts";
import {
  initScopeState,
  mutateScope,
  pruneRejectedPlans,
  readScope,
  readScopeView,
  repairProjection,
  renderProjection,
  renameScopeFiles,
  retitleScope,
  deletePlans,
  type OperationResult,
  type ScopeRead,
} from "./scope-store.ts";
import { contextView, reviewRows, reviewShow, keptOnApproval } from "./review.ts";
import { selectContext } from "./context-selection.ts";
import { scopeIndex } from "./scope-list.ts";
import { leftoverTempFiles } from "./durable.ts";
import { cachedUpdateNotice, installedVersion, npmInstall, refreshUpdateCacheIfStale } from "./update.ts";
import { canonical, digest } from "./understanding.ts";
import { decideWarnings, reviseWarnings, tracePlan } from "./assist.ts";
import { annotateScope } from "./scope-store.ts";
import { readAnnotations, type AnnotationsDoc, type AnnotationsRead } from "./annotations.ts";
import { annotationFindings, graphView, readyView, type Universe } from "./crossplan.ts";
import { effectiveDeadline, planDeadline, today } from "./deadlines.ts";
import { annotationsEnabled, annotationsMode, ignoredScopeSettingsFile, loadSettings, rebaseEnabled, SETTINGS_FILE, usageLogSetting } from "./settings.ts";
import type { ScopeState } from "./understanding.ts";
import { inspectLock, recoverLock } from "./lock-recover.ts";
import { handEditHistory, MAX_HISTORY } from "./history.ts";
import { LOCAL_SYNC_OK, localEntries, syncLocal, type LocalSyncRow } from "./local-sync.ts";
import { appendUsage, usageLine, usageLogEnabled } from "./usage.ts";
import { dirname } from "node:path";
import { readFocus } from "./focus.ts";
import { citedNoteChanges, LocatorResolver, planCitations } from "./locators.ts";
import { similarReport } from "./similar.ts";
import { plansIndex } from "./plans-index.ts";
import { readScopeQuiet } from "./scope-store.ts";

/**
 * The scopes index's update notice: reads the cache only, and starts a background refresh when it is old.
 * Only an installed mozak (a portable installation or the npm package) checks; a source checkout or test run never does.
 */
function scopesUpdateIssue(): Record<string, unknown> | null {
  const version = installedVersion()?.version ?? npmInstall()?.version;
  if (!version) return null;
  refreshUpdateCacheIfStale();
  const n = cachedUpdateNotice(version);
  return n ? { code: "update-available", message: `mozak ${n.latest} is available (installed ${n.installed}). Run: ${n.command}`, installed: n.installed, latest: n.latest, command: n.command } : null;
}

export type Actor = "agent" | "owner";
export interface OperationOutput {
  exitCode: number;
  data: Record<string, unknown>;
}

export const OPERATIONS = [
  "context",
  "plans",
  "scopes",
  "review",
  "check",
  "operation",
  "propose",
  "revise",
  "observe",
  "complete",
  "save-discussion",
  "attach-spec",
  "decide",
  "init",
  "repair",
  "sync",
  "render",
  "rename-files",
  "retitle",
  "delete",
  "annotate",
  "graph",
  "ready",
  "recover",
  "prune",
  "similar",
  "locators",
  "plans-md",
] as const;

/** Owner-only: refused for every other actor before any file is touched. */
const OWNER_ONLY = new Set(["decide", "init", "repair", "rename-files", "retitle", "delete", "annotate", "recover", "prune"]);
/** Route name must equal request.action for these routes. */
const ROUTE_ACTIONS = new Set(["propose", "revise", "observe", "complete", "save-discussion", "attach-spec"]);
export const DECISION_ACTIONS = [
  "approve-direction",
  "reject-pending",
  "reconsider",
  "pause",
  "resume",
  "accept-outcome",
  "approve-implementation",
  "revoke-implementation",
] as const;
export const DECISION_PURPOSES = DECISION_ACTIONS;
/** Visible review groups in fixed order. "rejected" appears only when explicitly requested. */
export const GROUPS = ["completed", "open", "awaiting"] as const;
const ALL_GROUPS = ["completed", "open", "awaiting", "rejected"] as const;
type Group = (typeof ALL_GROUPS)[number];

const DEFAULT_LIMIT = 5;
const MAX_LIMIT = 100;

const LEGACY_OPERATIONS = new Set(["translate", "resolve", "set_plan", "legacy-init"]);
/** Check errors that stay errors, not findings: unavailable selection, unsupported input, busy. */
const CHECK_PASSTHROUGH = new Set([
  "scope-uninitialized",
  "scope-root-missing",
  "scope-root-unreadable",
  "scope-root-not-directory",
  "scope-symlink-forbidden",
  "scope-file-not-regular",
  "scope-lock-not-directory",
  "scope-file-unreadable",
  "unsupported-format",
  "unsupported-capability",
  "unsupported-legacy-operation",
  "busy",
  "recovery-required",
]);

function invalid(message: string): DomainError {
  return new DomainError("invalid-input", message, 2);
}

function isPlain(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Closed object: every key must be required or optional, and every required key present. */
function closed(value: unknown, name: string, required: readonly string[], optional: readonly string[] = []): Record<string, unknown> {
  if (!isPlain(value)) throw invalid(`${name} must be an object`);
  for (const key of Object.keys(value)) {
    if (!required.includes(key) && !optional.includes(key)) throw invalid(`unknown field "${key}" in ${name}`);
  }
  for (const key of required) {
    if (!Object.prototype.hasOwnProperty.call(value, key)) throw invalid(`missing "${key}" in ${name}`);
  }
  return value;
}

/** Strict: only a real boolean. Absent means false. Any other type is rejected, never coerced. */
function strictBoolean(value: unknown, name: string): boolean {
  if (value === undefined) return false;
  if (typeof value !== "boolean") throw invalid(`${name} must be a boolean`);
  return value;
}

function limitOf(value: unknown): number {
  if (value === undefined) return DEFAULT_LIMIT;
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1 || value > MAX_LIMIT) {
    throw invalid(`limit must be an integer from 1 to ${MAX_LIMIT}`);
  }
  return value;
}

/**
 * Exit mapping. A result is unfinished (exit 5) when anything was committed or any projection was
 * updated and the projection is not proven current, or cleanup/lock release failed.
 * Replayed receipts are still committed results and follow the same rule.
 */
function resultExit(r: OperationResult): number {
  const lockOrCleanup = r.status.startsWith("committed-") || r.status === "projection-updated-lock-held";
  const unfinished = r.projectionStatus !== "current" || lockOrCleanup;
  if ((r.committed || r.projectionUpdated) && unfinished) return 5;
  if (r.status === "ok" || r.status === "replayed" || r.status === "already-current") return 0;
  return 3;
}

/** operationId is reported whenever the request names one readably, even when validation fails. */
function readableOperationId(args: unknown): string | undefined {
  if (!isPlain(args)) return undefined;
  const request = isPlain(args.request) ? args.request : undefined;
  const candidate = request?.operationId ?? args.id;
  return typeof candidate === "string" && candidate.trim() !== "" ? candidate : undefined;
}

export function errorOutput(err: DomainError, operation?: string, args?: unknown): OperationOutput {
  const operationId = readableOperationId(args);
  // A failed observation returns its unsaved request, never an implied persisted record. It goes last, after the
  // issues, so output truncated by a host still shows why the request failed.
  const unsaved = operation === "observe" && isPlain(args) && isPlain(args.request) ? { unsavedRequest: args.request } : {};
  return {
    exitCode: err.exitCode,
    data: {
      status: err.code,
      issues: [{ code: err.code, message: err.message }],
      committed: false,
      ...(operation ? { operation } : {}),
      ...(operationId ? { operationId } : {}),
      snapshot: null,
      projectionStatus: null,
      projectionUpdated: false,
      ...unsaved,
    },
  };
}

function requireOwner(operation: string, actor: Actor): void {
  if (actor !== "owner") {
    throw new DomainError("not-permitted", `${operation} is owner-only and cannot run as ${actor}`, 2);
  }
}

// ---------- continuation tokens ----------

interface Continuation {
  v: 2;
  inventory: string;
  selector: { scope: string | null; all: boolean };
  includeRejected: boolean;
  limit: number;
  binding: string;
  group: Group;
  /** Composite key of the last row returned for this group. */
  after: string;
  /** Sort timestamp of that same row, so a changed underlying row invalidates the token. */
  lastSortAt: string;
  /** Present only for `plans --sort deadline`. */
  sort?: "deadline";
}

const CONTINUATION_KEYS = ["v", "inventory", "selector", "includeRejected", "limit", "binding", "group", "after", "lastSortAt"] as const;

function encodeContinuation(c: Continuation): string {
  return Buffer.from(canonical(c), "utf8").toString("base64url");
}

function decodeContinuation(text: unknown): Continuation {
  const bad = (why: string) => new DomainError("invalid-input", `continuation token is malformed: ${why}`, 2);
  if (typeof text !== "string" || text.length === 0) throw bad("not a string");
  let raw: unknown;
  try {
    raw = JSON.parse(Buffer.from(text, "base64url").toString("utf8"));
  } catch {
    throw bad("not decodable");
  }
  if (!isPlain(raw) || raw.v !== 2) throw bad("unknown version");
  const c = closed(raw, "continuation", CONTINUATION_KEYS, ["sort"]);
  if (c.sort !== undefined && c.sort !== "deadline") throw bad("unknown sort");
  const selector = closed(c.selector, "continuation selector", ["scope", "all"]);
  if (typeof selector.all !== "boolean") throw bad("selector.all must be a boolean");
  if (selector.all) {
    if (selector.scope !== null) throw bad("selector.scope must be null when all is true");
  } else if (typeof selector.scope !== "string" || selector.scope.trim() === "") {
    throw bad("selector.scope must be a nonempty string when all is false");
  }
  if (typeof c.includeRejected !== "boolean") throw bad("includeRejected must be a boolean");
  if (typeof c.limit !== "number" || !Number.isInteger(c.limit) || c.limit < 1 || c.limit > MAX_LIMIT) throw bad("limit out of range");
  if (!(ALL_GROUPS as readonly string[]).includes(c.group as string)) throw bad("unknown group");
  if (c.group === "rejected" && c.includeRejected !== true) throw bad("rejected group requires includeRejected");
  return {
    v: 2,
    inventory: nonEmpty(c.inventory, "continuation inventory"),
    selector: { scope: selector.scope, all: selector.all },
    includeRejected: c.includeRejected,
    limit: c.limit,
    binding: nonEmpty(c.binding, "continuation binding"),
    group: c.group as Group,
    after: nonEmpty(c.after, "continuation after"),
    lastSortAt: nonEmpty(c.lastSortAt, "continuation lastSortAt"),
    ...(c.sort === "deadline" ? { sort: "deadline" as const } : {}),
  };
}

// ---------- plans ----------

/** Row shape returned by reviewRows, normalized here so every group uses one identity rule. */
interface NormalizedRow {
  scope: string;
  planId: string;
  rowKind: string;
  rowId: string;
  group: Group;
  sortAt: string;
  /** Parsed instant of sortAt, used for ordering. */
  ms: number;
  compositeKey: string;
  row: Record<string, unknown>;
}

export type ScopeBinding =
  | { scope: string; status: "ok"; revision: string; graphHash: string }
  | { scope: string; status: "failed"; code: string; message: string };

interface ScopeLoad {
  binding: ScopeBinding;
  read: ScopeRead | null;
  error: DomainError | null;
}

function loadScope(entry: ScopeEntry): ScopeLoad {
  try {
    const read = readScope(entry);
    return {
      binding: { scope: entry.id, status: "ok", revision: read.snapshot.revision, graphHash: read.snapshot.graphHash },
      read,
      error: null,
    };
  } catch (err) {
    if (!(err instanceof DomainError)) throw err;
    return {
      binding: { scope: entry.id, status: "failed", code: err.code, message: err.message },
      read: null,
      error: err,
    };
  }
}

/**
 * Normalize reviewRows(state, includeRejected) output. The agreed contract is an object keyed by
 * group. Each row carries its own identity fields. Malformed output is an internal fault, not
 * silently skipped.
 */
function normalizeRows(scope: string, raw: unknown, includeRejected: boolean): NormalizedRow[] {
  if (!isPlain(raw)) throw new DomainError("invalid-model", "reviewRows must return an object keyed by group", 5);
  const out: NormalizedRow[] = [];
  for (const [group, rows] of Object.entries(raw)) {
    if (!(ALL_GROUPS as readonly string[]).includes(group)) {
      throw new DomainError("invalid-model", `reviewRows returned unknown group "${group}"`, 5);
    }
    if (group === "rejected" && !includeRejected) continue;
    if (!Array.isArray(rows)) throw new DomainError("invalid-model", `reviewRows group "${group}" must be an array`, 5);
    for (const row of rows) {
      if (!isPlain(row)) throw new DomainError("invalid-model", `reviewRows row in "${group}" must be an object`, 5);
      const planId = typeof row.planId === "string" ? row.planId : null;
      const rowKind = typeof row.rowKind === "string" ? row.rowKind : null;
      const rowId =
        typeof row.id === "string" ? row.id : typeof row.revisionId === "string" ? row.revisionId : typeof row.outcomeId === "string" ? row.outcomeId : null;
      const sortAt = typeof row.reviewAt === "string" ? row.reviewAt : typeof row.date === "string" ? row.date : null;
      if (!planId || !rowKind || !rowId || !sortAt) {
        throw new DomainError("invalid-model", `reviewRows row in "${group}" lacks planId, rowKind, id or date`, 5);
      }
      const ms = instantOf(sortAt, `reviewRows date for plan "${planId}"`);
      const rowScope = typeof row.scopeId === "string" ? row.scopeId : scope;
      if (rowScope !== scope) throw new DomainError("invalid-model", "reviewRows row names a different scope", 5);
      // review.ts owns the canonical composite key. It must be the 5-part tuple
      // [scope, planId, rowKind, revisionId, outcomeId-or-id]. Anything else is a model fault.
      const compositeKey = canonicalKeyOf(row.compositeKey, scope, planId, rowKind);
      out.push({
        scope,
        planId,
        rowKind,
        rowId,
        group: group as Group,
        sortAt,
        ms,
        compositeKey,
        row,
      });
    }
  }
  return out;
}

/**
 * Validate the review.ts composite key: a JSON array [scope, planId, rowKind, revisionId, outcomeOrId].
 * The scope and plan must match the row, so a key cannot silently name a different row.
 */
function canonicalKeyOf(value: unknown, scope: string, planId: string, rowKind: string): string {
  const bad = (why: string): DomainError => new DomainError("invalid-model", `reviewRows compositeKey ${why}`, 5);
  if (typeof value !== "string") throw bad("must be a string");
  let parts: unknown;
  try {
    parts = JSON.parse(value);
  } catch {
    throw bad("is not a JSON tuple");
  }
  if (!Array.isArray(parts) || parts.length !== 5 || !parts.every((p) => typeof p === "string" && p.length > 0)) {
    throw bad("must be a 5-element tuple of nonempty strings");
  }
  if (parts[0] !== scope || parts[1] !== planId || parts[2] !== rowKind) {
    throw bad("does not match its scope, plan or row kind");
  }
  return value;
}

/**
 * Instant in epoch milliseconds for an RFC 3339 UTC timestamp, with or without fractional seconds.
 * Lexicographic order is wrong across those forms ("." sorts before "Z"), so ordering uses this.
 */
const RFC3339_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;
function instantOf(text: string, where: string): number {
  const ms = RFC3339_UTC.test(text) ? Date.parse(text) : Number.NaN;
  if (Number.isNaN(ms)) throw new DomainError("invalid-model", `${where} is not an RFC 3339 UTC timestamp`, 5);
  return ms;
}

function sortRows(rows: NormalizedRow[]): NormalizedRow[] {
  // Newest instant first, then composite key ascending. Ties are never left unordered.
  return rows.sort((x, y) => {
    if (x.ms !== y.ms) return x.ms < y.ms ? 1 : -1;
    return x.compositeKey < y.compositeKey ? -1 : x.compositeKey > y.compositeKey ? 1 : 0;
  });
}

// ---------- annotations ----------

function entryOf(inv: ScopeInventory, id: string): ScopeEntry | undefined {
  return inv.scopes.find((s) => s.id === id);
}

const NO_SIDECAR: AnnotationsRead = { token: { exists: false, sha256: null }, doc: null, issues: [] };

/** The sidecar of a scope, read only when annotations are on for it. Off (the default) reads as absent, like 0.4.7. */
function sidecarOf(inv: ScopeInventory, entry: ScopeEntry, scopeId?: string): AnnotationsRead {
  return annotationsEnabled(inv, entry) ? readAnnotations(entry.root, scopeId) : NO_SIDECAR;
}

/** Sidecar token of one scope, for continuation bindings. */
function annotationsToken(inv: ScopeInventory, id: string): unknown {
  const entry = entryOf(inv, id);
  if (!entry) return null;
  try { return sidecarOf(inv, entry).token; } catch { return "unreadable"; }
}

/**
 * Read-only, cached view of every inventoried scope for cross-plan resolution. Never fetches.
 * A scope that cannot be read is "unavailable", an id not in the inventory "unknown".
 */
function universeOf(inv: ScopeInventory, seed: Record<string, ScopeState> = {}): Universe {
  const states = new Map<string, ScopeState | "unknown" | "unavailable">(Object.entries(seed));
  const docs = new Map<string, AnnotationsDoc | null>();
  return {
    state(id) {
      if (!states.has(id)) {
        if (!entryOf(inv, id)) states.set(id, "unknown");
        else {
          try { states.set(id, readScope(resolveScope(inv, id)).state); }
          catch (err) { if (!(err instanceof DomainError)) throw err; states.set(id, "unavailable"); }
        }
      }
      return states.get(id)!;
    },
    annotations(id) {
      if (!docs.has(id)) {
        const entry = entryOf(inv, id);
        let doc: AnnotationsDoc | null = null;
        if (entry) { try { doc = sidecarOf(inv, entry, id).doc; } catch { doc = null; } }
        docs.set(id, doc);
      }
      return docs.get(id)!;
    },
  };
}

/** Stable deadline order: earliest owner or inferred deadline first, plans without one keep their order after. */
function sortByDeadline(rows: NormalizedRow[], loads: ScopeLoad[], inv: ScopeInventory): NormalizedRow[] {
  const u = universeOf(inv);
  const day = today();
  const cache = new Map<string, { deadline: string | null; status: string }>();
  const info = (r: NormalizedRow) => {
    const k = JSON.stringify([r.scope, r.planId]);
    if (!cache.has(k)) {
      const state = loads.find((l) => l.binding.scope === r.scope)?.read?.state;
      const plan = state?.plans.find((p) => p.id === r.planId);
      const d = state && plan ? planDeadline(state, plan, u.annotations(r.scope), day) : { status: "none" as const };
      cache.set(k, { deadline: effectiveDeadline(d), status: d.status });
    }
    return cache.get(k)!;
  };
  const indexed = rows.map((r, i) => ({ r, i, d: info(r) }));
  indexed.sort((x, y) => {
    if (x.d.deadline !== y.d.deadline) return x.d.deadline === null ? 1 : y.d.deadline === null ? -1 : x.d.deadline < y.d.deadline ? -1 : 1;
    return x.i - y.i;
  });
  return indexed.map(({ r, d }) => ({ ...r, row: { ...r.row, deadline: d.deadline, deadlineStatus: d.status } }));
}

/** graph and ready: exactly one of scope or all. Every selected scope is attempted; failures are coverage. */
function crossPlanOp(inv: ScopeInventory, operation: "graph" | "ready", a: Record<string, unknown>): OperationOutput {
  const o = closed(a, `${operation} arguments`, [], ["scope", "all"]);
  const all = strictBoolean(o.all, "all");
  if ((o.scope === undefined) === !all) throw invalid(`${operation} needs exactly one of scope or all`);
  const ids = all ? inv.scopes.map((s) => s.id) : [nonEmpty(o.scope, "scope")];
  const seed: Record<string, ScopeState> = {};
  const coverage: ScopeBinding[] = [];
  const issues: { code: string; message: string; scope?: string }[] = [];
  let single: ScopeRead | null = null;
  // Sidecar tokens: the owner route annotate takes the reviewed token as expectedAnnotations.
  const tokens: Record<string, unknown> = {};
  for (const id of ids) {
    try {
      const read = readScope(resolveScope(inv, id));
      seed[id] = read.state;
      if (!all) single = read;
      coverage.push({ scope: id, status: "ok", revision: read.snapshot.revision, graphHash: read.snapshot.graphHash });
      const entry = entryOf(inv, id)!;
      const side = sidecarOf(inv, entry, id);
      tokens[id] = side.token;
      for (const issue of side.issues) issues.push({ ...issue, scope: id });
    } catch (err) {
      if (!(err instanceof DomainError)) throw err;
      if (!all) throw err;
      coverage.push({ scope: id, status: "failed", code: err.code, message: err.message });
      issues.push({ code: err.code, message: err.message, scope: id });
    }
  }
  const u = universeOf(inv, seed);
  const okIds = ids.filter((id) => seed[id]);
  const complete = coverage.every((c) => c.status === "ok");
  const view = operation === "graph" ? { graph: graphView(u, okIds) } : { ready: readyView(u, okIds) };
  return {
    exitCode: complete ? 0 : 6,
    data: {
      status: complete ? "ok" : "partial-coverage",
      committed: false,
      operation,
      snapshot: single?.snapshot ?? null,
      projectionStatus: single?.projectionStatus ?? null,
      projectionUpdated: false,
      issues,
      coverage: { selected: ids.length, complete, scopes: coverage },
      annotations: tokens,
      ...view,
    },
  };
}

/** focus-unknown-plan for each starred id of this scope that is not a plan in it. Empty without an inventory file. */
function focusWarnings(inv: ScopeInventory, scopeId: string, state: ScopeState): { code: string; message: string }[] {
  if (!inv.path) return [];
  const ids = new Set(state.plans.map((p) => p.id));
  return (readFocus(inv.path)[scopeId] ?? []).filter((id) => !ids.has(id))
    .map((id) => ({ code: "focus-unknown-plan", message: `focus lists "${id}", which is not a plan in this scope; the owner can clear it with mozak focus remove` }));
}

/** Annotation and settings findings for check. Empty when the scope has no sidecar and settings are clean. */
function annotationCheck(inv: ScopeInventory, entry: ScopeEntry, read: ScopeRead): { code: string; message: string }[] {
  const out: { code: string; message: string }[] = [];
  const side = sidecarOf(inv, entry, entry.id);
  out.push(...side.issues);
  if (ignoredScopeSettingsFile(inv, entry)) {
    out.push({ code: "settings-scope-file-deprecated", message: `${SETTINGS_FILE} in the scope folder is ignored. Put concurrency.rebase under scopes.${entry.id}.concurrency in the ${SETTINGS_FILE} next to the inventory file` });
  }
  try {
    const settings = loadSettings(inv);
    out.push(...settings.issues);
  } catch (err) {
    if (!(err instanceof DomainError)) throw err;
    out.push({ code: err.code, message: err.message });
  }
  if (side.doc) out.push(...annotationFindings(universeOf(inv, { [entry.id]: read.state }), entry.id).map(({ code, message }) => ({ code, message })));
  return out;
}

function annotateOp(inv: ScopeInventory, a: Record<string, unknown>, actor: Actor): OperationOutput {
  requireOwner("annotate", actor);
  const o = closed(a, "annotate arguments", ["scope", "request"]);
  if (!isPlain(o.request)) throw invalid("request must be an object");
  const entry = resolveScope(inv, nonEmpty(o.scope, "scope"));
  const mode = annotationsMode(loadSettings(inv), entry);
  if (!mode.enabled) throw new DomainError("annotations-disabled", `annotations are off for scope "${entry.id}"; the owner turns them on with "scopes": { "${entry.id}": { "annotations": true } } in the mozak-settings.json next to the inventory`, 2);
  const result = annotateScope(entry, o.request, universeOf(inv).state);
  const lockOrCleanup = result.status.startsWith("committed-") || result.status === "projection-updated-lock-held";
  const exitCode = lockOrCleanup ? 5 : result.status === "ok" || result.status === "replayed" ? 0 : 3;
  return { exitCode, data: { ...result, operation: "annotate" } };
}

/** Owner-only: remove one named write lock from another host or a dead local pid. Never touches mozak.json. */
function recoverOp(inv: ScopeInventory, a: Record<string, unknown>): OperationOutput {
  const o = closed(a, "recover arguments", ["scope", "request"]);
  const entry = resolveScope(inv, nonEmpty(o.scope, "scope"));
  const out = recoverLock(entry, o.request);
  const issues: { code: string; message: string }[] = [];
  let read: ScopeRead | null = null;
  try { read = readScope(entry); issues.push(...read.issues.filter((i) => i.code === "lock-in-git" || i.code === "lock-not-ignored")); } catch { /* the lock is gone either way */ }
  return {
    exitCode: 0,
    data: { status: out.status, committed: false, operation: "recover", requestId: (o.request as Record<string, unknown>).requestId, snapshot: read?.snapshot ?? null, projectionStatus: read?.projectionStatus ?? null, projectionUpdated: false, issues, recovered: out.recovered, reason: out.reason },
  };
}

/** Lock finding for check: a stuck lock is reported with what recover needs; a lock held by a live local writer is informational. */
function lockFinding(entry: ScopeEntry): { finding: Record<string, unknown> | null; info: Record<string, unknown> | null } {
  let lock;
  try { lock = inspectLock(entry.root); } catch (err) { if (!(err instanceof DomainError)) throw err; return { finding: { code: err.code, message: err.message }, info: null }; }
  if (!lock.present) return { finding: null, info: null };
  const shown = { token: lock.token, host: lock.host, pid: lock.pid, acquiredAt: lock.acquiredAt, verdict: lock.verdict, ...(lock.extraEntries.length ? { extraEntries: lock.extraEntries } : {}) };
  if (lock.verdict === "live-local-pid") return { finding: null, info: { code: "write-lock-held", message: `pid ${lock.pid} on this host holds the write lock`, lock: shown } };
  const how = lock.verdict === "other-host" ? `it names host ${lock.host}, so it arrived by sync; the owner may run mozak recover`
    : lock.verdict === "dead-local-pid" ? `pid ${lock.pid} on this host is no longer running; the owner may run mozak recover`
    : lock.verdict === "host-unknown" ? "it records no host (older mozak); remove it by hand after making sure no writer runs anywhere"
    : "its metadata is unavailable; remove it by hand after making sure no writer runs anywhere";
  return { finding: { code: "write-lock-stuck", message: `a write lock blocks writes: ${how}`, lock: shown }, info: null };
}

function plansOp(inv: ScopeInventory, a: Record<string, unknown>): OperationOutput {
  closed(a, "plans arguments", [], ["scope", "all", "includeRejected", "limit", "continuation", "sort"]);
  let selector: { scope: string | null; all: boolean };
  let includeRejected: boolean;
  let limit: number;
  let sort: "deadline" | undefined;
  let continuation: Continuation | null = null;

  if (a.continuation !== undefined) {
    for (const key of ["scope", "all", "includeRejected", "limit", "sort"]) {
      if (a[key] !== undefined) throw invalid(`a continuation pins its selector and filters; remove "${key}"`);
    }
    continuation = decodeContinuation(a.continuation);
    selector = continuation.selector;
    includeRejected = continuation.includeRejected;
    limit = continuation.limit;
    sort = continuation.sort;
  } else {
    const hasScope = a.scope !== undefined;
    const hasAll = a.all !== undefined;
    if (hasScope === hasAll) throw invalid(`plans requires exactly one of "scope" or "all"`);
    if (hasAll && a.all !== true) throw invalid(`"all" must be true when given`);
    selector = hasScope ? { scope: nonEmpty(a.scope, "scope"), all: false } : { scope: null, all: true };
    includeRejected = strictBoolean(a.includeRejected, "includeRejected");
    limit = limitOf(a.limit);
    if (a.sort !== undefined && a.sort !== "deadline") throw invalid(`sort must be "deadline"`);
    sort = a.sort as "deadline" | undefined;
  }

  const ids = selector.all ? inv.scopes.map((s) => s.id) : [selector.scope as string];
  const loads: ScopeLoad[] = [];
  for (const id of ids) {
    if (selector.all) {
      // Every configured scope is attempted. Failures are reported as coverage, never omitted.
      try {
        loads.push(loadScope(resolveScope(inv, id)));
      } catch (err) {
        if (!(err instanceof DomainError)) throw err;
        loads.push({ binding: { scope: id, status: "failed", code: err.code, message: err.message }, read: null, error: err });
      }
    } else {
      // A single selected scope that cannot be read is an unavailable selection, not partial coverage.
      const load = loadScope(resolveScope(inv, id));
      if (load.error) throw load.error;
      loads.push(load);
    }
  }

  const binding = loads.map((l) => l.binding);
  // A deadline order also depends on owner annotations, so their tokens join the binding.
  const sidecars = sort ? loads.map((l) => ({ scope: l.binding.scope, annotations: l.read ? annotationsToken(inv, l.binding.scope) : null })) : null;
  const bindingDigest = sidecars ? digest({ binding, sidecars }) : digest(binding);
  if (continuation) {
    if (continuation.inventory !== inv.digest) {
      throw new DomainError("continuation-stale", "inventory changed since this continuation was issued; request the first page again without a continuation", 3);
    }
    if (continuation.binding !== bindingDigest) {
      throw new DomainError("continuation-stale", "scope snapshots changed since this continuation was issued; request the first page again without a continuation", 3);
    }
  }

  const issues: { code: string; message: string; scope?: string }[] = [];
  const rows: NormalizedRow[] = [];
  for (const load of loads) {
    const scope = load.binding.scope;
    if (load.read) {
      for (const issue of load.read.issues) issues.push({ ...issue, scope });
      rows.push(...normalizeRows(scope, reviewRows(load.read.state, includeRejected), includeRejected));
    } else if (load.error) {
      issues.push({ code: load.error.code, message: load.error.message, scope });
    }
  }

  const byGroup = new Map<Group, NormalizedRow[]>();
  for (const group of includeRejected ? ALL_GROUPS : GROUPS) byGroup.set(group, []);
  for (const row of rows) byGroup.get(row.group)?.push(row);

  const pages: Record<string, unknown> = {};
  const groupsToRead: Group[] = continuation ? [continuation.group] : [...byGroup.keys()];
  for (const group of groupsToRead) {
    const all = sort ? sortByDeadline(sortRows(byGroup.get(group) ?? []), loads, inv) : sortRows(byGroup.get(group) ?? []);
    let start = 0;
    if (continuation) {
      const index = all.findIndex((r) => r.compositeKey === continuation.after);
      const anchor = all[index];
      if (index < 0 || anchor === undefined || anchor.sortAt !== continuation.lastSortAt) {
        throw new DomainError("continuation-stale", "the continuation row changed or disappeared; request a fresh page", 3);
      }
      start = index + 1;
    }
    const page = all.slice(start, start + limit);
    const hasMore = start + limit < all.length;
    const last = page[page.length - 1];
    const next: string | null =
      hasMore && last
        ? encodeContinuation({
            v: 2,
            inventory: inv.digest,
            selector,
            includeRejected,
            limit,
            binding: bindingDigest,
            group,
            after: last.compositeKey,
            lastSortAt: last.sortAt,
            ...(sort ? { sort } : {}),
          })
        : null;
    pages[group] = {
      count: all.length,
      rows: page.map((r) => ({
        ...r.row,
        scope: r.scope,
        planId: r.planId,
        rowKind: r.rowKind,
        id: r.rowId,
        sortAt: r.sortAt,
        compositeKey: r.compositeKey,
      })),
      hasMore,
      continuation: next,
    };
  }

  const uniquePlanCount = new Set(rows.map((r) => JSON.stringify([r.scope, r.planId]))).size;
  const complete = loads.every((l) => l.binding.status === "ok");
  return {
    exitCode: complete ? 0 : 6,
    data: {
      status: complete ? "ok" : "partial-coverage",
      committed: false,
      snapshot: null,
      projectionStatus: null,
      projectionUpdated: false,
      issues,
      inventory: inv.digest,
      coverage: { selected: ids.length, complete, scopes: binding },
      uniquePlanCount,
      reviewItemCount: rows.length,
      groups: pages,
    },
  };
}

// ---------- routes ----------

function readOp(inv: ScopeInventory, operation: string, a: Record<string, unknown>): OperationOutput {
  if (operation === "plans") return plansOp(inv, a);
  if (operation === "graph" || operation === "ready") return crossPlanOp(inv, operation, a);

  if (operation === "scopes") {
    closed(a, "scopes arguments", [], []);
    const index = scopeIndex(inv);
    return {
      exitCode: index.coverage.complete ? 0 : 6,
      data: {
        status: "ok",
        committed: false,
        operation,
        snapshot: null,
        projectionStatus: null,
        projectionUpdated: false,
        issues: [],
        inventory: index.inventory,
        coverage: index.coverage,
        scopes: index.scopes,
      },
    };
  }

  if (operation === "review") {
    const o = closed(a, "review arguments", ["scope", "plan"], ["purpose", "outcome"]);
    const scope = nonEmpty(o.scope, "scope");
    const plan = nonEmpty(o.plan, "plan");
    if (o.purpose !== undefined && !(DECISION_PURPOSES as readonly string[]).includes(o.purpose as string)) {
      throw invalid(`purpose must be one of ${DECISION_PURPOSES.join(", ")}`);
    }
    const outcome = o.outcome === undefined ? undefined : nonEmpty(o.outcome, "outcome");
    const read = readScopeView(resolveScope(inv, scope), o.purpose === "approve-implementation" ? plan : undefined);
    const shown = reviewShow(read.state, plan, o.purpose as string | undefined, outcome, read.environment);
    return {
      exitCode: 0,
      data: {
        status: "ok",
        committed: false,
        operation,
        snapshot: read.snapshot,
        projectionStatus: read.projectionStatus,
        projectionUpdated: false,
        issues: read.issues,
        review: shown,
      },
    };
  }

  const o = closed(a, `${operation} arguments`, operation === "operation" ? ["scope", "id"] : ["scope"], operation === "context" ? ["brief", "plan"] : operation === "check" ? ["history"] : []);
  const scope = nonEmpty(o.scope, "scope");
  const entry = resolveScope(inv, scope);

  if (operation === "context") {
    const brief = strictBoolean(o.brief, "brief");
    const plan = o.plan === undefined ? undefined : nonEmpty(o.plan, "plan");
    const read = readScopeView(entry);
    return {
      exitCode: 0,
      data: {
        status: "ok",
        committed: false,
        operation,
        snapshot: read.snapshot,
        projectionStatus: read.projectionStatus,
        projectionUpdated: false,
        issues: read.issues,
        context: selectContext(contextView(read.state, read.environment), brief, plan),
      },
    };
  }

  if (operation === "operation") {
    const id = nonEmpty(o.id, "id");
    const read = readScope(entry);
    const receipt = Object.prototype.hasOwnProperty.call(read.state.receipts, id) ? read.state.receipts[id] : undefined;
    if (!receipt) {
      return {
        exitCode: 2,
        data: {
          status: "operation-not-found",
          committed: false,
          operation,
          operationId: id,
          snapshot: read.snapshot,
          projectionStatus: read.projectionStatus,
          projectionUpdated: false,
          issues: read.issues,
        },
      };
    }
    return {
      exitCode: 0,
      data: {
        status: "ok",
        committed: false,
        operation,
        operationId: id,
        receipt,
        snapshot: read.snapshot,
        projectionStatus: read.projectionStatus,
        projectionUpdated: false,
        issues: read.issues,
      },
    };
  }

  // check: findings are reported, never repaired. Unavailable selections keep their error exit.
  let history: number | undefined;
  if (o.history !== undefined) {
    if (typeof o.history !== "number" || !Number.isInteger(o.history) || o.history < 1 || o.history > MAX_HISTORY) throw invalid(`history must be an integer from 1 to ${MAX_HISTORY}`);
    history = o.history;
  }
  let read: ScopeRead;
  try {
    read = readScope(entry);
  } catch (err) {
    if (!(err instanceof DomainError) || CHECK_PASSTHROUGH.has(err.code)) throw err;
    return {
      exitCode: 3,
      data: {
        status: "findings",
        committed: false,
        operation,
        snapshot: null,
        projectionStatus: null,
        projectionUpdated: false,
        issues: [{ code: err.code, message: err.message }],
      },
    };
  }
  const lock = lockFinding(entry);
  const findings: object[] = [...read.issues, ...annotationCheck(inv, entry, read), ...(lock.finding ? [lock.finding] : [])];
  // check --history N: hand edits in the last N commits of mozak.json. Local git objects only, no fetch.
  const historyReport = history === undefined ? undefined : handEditHistory(entry.root, history);
  if (historyReport) findings.push(...historyReport.findings);
  // Leftover temp files from an interrupted write are informational: the next write removes them.
  const leftovers: object[] = leftoverTempFiles(entry.root).map((name) => ({ code: "leftover-temp-file", message: `${name} is left over from an interrupted write; the next write removes it` }));
  // A starred plan id that no longer exists is a warning only: the owner clears it with mozak focus remove.
  leftovers.push(...focusWarnings(inv, entry.id, read.state));
  if (lock.info) leftovers.push(lock.info);
  if (historyReport && !historyReport.available) leftovers.push({ code: "history-unavailable", message: `check --history skipped: ${historyReport.reason ?? "unavailable"}` });
  // Cited-note staleness: informational, like leftovers. A changed note does not mean the edit matters.
  try {
    for (const c of citedNoteChanges(inv, entry, read.state)) leftovers.push(c);
  } catch (err) {
    if (!(err instanceof DomainError)) throw err;
    leftovers.push({ code: "cited-notes-unavailable", message: `cited-note staleness skipped: ${err.message}` });
  }
  return {
    exitCode: findings.length > 0 ? 3 : 0,
    data: {
      status: findings.length > 0 ? "findings" : "ok",
      committed: false,
      operation,
      snapshot: read.snapshot,
      projectionStatus: read.projectionStatus,
      projectionUpdated: false,
      issues: [...findings, ...leftovers],
      ...(historyReport ? { history: { scanned: historyReport.scanned, available: historyReport.available, handEdits: historyReport.findings.length } } : {}),
    },
  };
}

function writeOp(inv: ScopeInventory, operation: string, a: Record<string, unknown>, actor: Actor): OperationOutput {
  const o = closed(a, `${operation} arguments`, ["scope", "request"]);
  const scope = nonEmpty(o.scope, "scope");
  if (!isPlain(o.request)) throw invalid("request must be an object");
  const request = o.request;
  if (OWNER_ONLY.has(operation)) requireOwner(operation, actor);

  if (ROUTE_ACTIONS.has(operation) && request.action !== operation) {
    throw invalid(`request.action must be "${operation}" on this route`);
  }
  if (operation === "decide" && !(DECISION_ACTIONS as readonly string[]).includes(request.action as string)) {
    throw invalid(`decision action must be one of ${DECISION_ACTIONS.join(", ")}`);
  }

  const entry = resolveScope(inv, scope);
  let result: OperationResult;
  if (operation === "init") result = initScopeState(entry, request);
  else if (operation === "repair") result = repairProjection(entry, request);
  else if (operation === "retitle") result = retitleScope(entry, request);
  else if (operation === "delete") result = deletePlans(entry, request);
  else if (operation === "prune") result = pruneRejectedPlans(entry, request);
  else {
    // After a revise, tell the host which accepted outcomes and grants will need the owner again once approved.
    let before: ReturnType<typeof tracePlan> = null;
    if ((operation === "revise" || operation === "decide") && isPlain(request.payload) && typeof request.payload.planId === "string") {
      try { before = tracePlan(readScopeView(entry).state, request.payload.planId); } catch { before = null; }
    }
    result = mutateScope(entry, request, actor, { rebase: rebaseEnabled(inv, entry.id) });
    if (operation === "revise" && result.committed && before) {
      const planId = (request.payload as Record<string, unknown>).planId as string;
      const warnings = reviseWarnings(scope, planId, before, keptOnApproval(readScopeView(entry).state.plans.find((x) => x.id === planId)));
      if (warnings.length) return { exitCode: resultExit(result), data: { ...result, operation, warnings } };
    }
    if (operation === "decide" && result.committed && before) {
      const planId = (request.payload as Record<string, unknown>).planId as string;
      let after: ReturnType<typeof tracePlan> = null;
      try { after = tracePlan(readScopeView(entry).state, planId); } catch { after = null; }
      const warnings = decideWarnings(scope, planId, request.action as string, before, after);
      if (warnings.length) return { exitCode: resultExit(result), data: { ...result, operation, warnings } };
    }
  }
  return { exitCode: resultExit(result), data: { ...result, operation } };
}

/** Read routes: no writes, no network. */
const READ_OPS = new Set(["context", "plans", "scopes", "review", "check", "operation", "graph", "ready"]);

/**
 * `mozak sync`: fetch, then fast-forward the git repo (vault) that holds each scope, under the locks of every scope in
 * it. `--scope ID` syncs the repo of that scope, otherwise every vault repo in the inventory (`--local` is the same and
 * is kept for older callers such as the plugin's sync button). Never pushes, never merges anything but a fast-forward,
 * and never touches a code repo: plans live only in vaults since 0.6.0.
 */
function syncOp(inv: ScopeInventory, a: Record<string, unknown>): OperationOutput {
  const base = { committed: false, operation: "sync", snapshot: null, projectionStatus: null, projectionUpdated: false } as const;
  const o = closed(a, "sync arguments", [], ["scope", "local"]);
  const local = strictBoolean(o.local, "local");
  if (local && o.scope !== undefined) throw invalid("sync takes scope or local, not both");
  if (o.scope !== undefined) return localSyncOutput(inv, [resolveScope(inv, nonEmpty(o.scope, "scope"))], base);
  const rows = syncLocal(localEntries(inv.scopes), inv.scopes);
  const bad = rows.filter((r) => !LOCAL_SYNC_OK.has(r.status)).length;
  return { exitCode: bad > 0 ? 6 : 0, data: { status: bad > 0 ? "partial" : "ok", ...base, issues: localIssues(rows), local: rows } };
}

function localIssues(rows: LocalSyncRow[]): { code: string; message: string; scope?: string }[] {
  return rows.filter((r) => !LOCAL_SYNC_OK.has(r.status)).map((r) => ({ code: `local-sync-${r.status}`, message: `${r.repo ?? r.scopes.join(", ")}: ${r.error ?? r.status}`, scope: r.scopes[0] }));
}

/** `sync --scope ID`: fast-forward the git repo that holds one scope, under the locks of every scope in it. */
function localSyncOutput(inv: ScopeInventory, targets: ScopeEntry[], base: Record<string, unknown>): OperationOutput {
  const rows = syncLocal(targets, inv.scopes);
  const bad = rows.filter((r) => !LOCAL_SYNC_OK.has(r.status));
  const only = rows.length === 1 ? rows[0]! : null;
  const exitCode = bad.length === 0 ? 0 : only?.status === "not-fast-forward" ? 3 : only?.status === "busy" ? 4 : only?.status === "not-in-git" || only?.status === "no-upstream" || only?.status === "detached" ? 2 : 6;
  return { exitCode, data: { status: bad.length === 0 ? "ok" : only ? `local-sync-${only.status}` : "partial", ...base, issues: localIssues(rows), local: rows } };
}

/**
 * Regenerate stale mozak.md projections for one scope or every scope. Writes only mozak.md.
 * Conflicts are reported, not overwritten.
 */
function renderOp(inv: ScopeInventory, a: Record<string, unknown>): OperationOutput {
  const o = closed(a, "render arguments", [], ["scope", "all"]);
  const all = strictBoolean(o.all, "all");
  if ((o.scope === undefined) === !all) throw invalid("render needs exactly one of scope or all");
  const targets = all ? inv.scopes : [resolveScope(inv, nonEmpty(o.scope, "scope"))];
  const rows = targets.map((entry) => {
    try {
      const { result, outcome } = renderProjection(resolveScope(inv, entry.id));
      return { scope: entry.id, result, exitCode: resultExit(outcome), code: outcome.status, projectionUpdated: outcome.projectionUpdated, projectionStatus: outcome.projectionStatus, ...(outcome.issues.length ? { issues: outcome.issues } : {}) };
    } catch (err) {
      if (!(err instanceof DomainError)) throw err;
      return { scope: entry.id, result: "failed", exitCode: err.exitCode, code: err.code, message: err.message };
    }
  });
  const bad = rows.filter((r) => r.result === "conflict" || r.result === "failed").length;
  const exitCode = bad === 0 ? 0 : all ? 6 : rows[0].exitCode;
  return {
    exitCode,
    data: {
      status: bad === 0 ? "ok" : all ? "partial" : rows[0].result,
      committed: false,
      operation: "render",
      snapshot: null,
      projectionStatus: null,
      projectionUpdated: rows.some((r) => "projectionUpdated" in r && r.projectionUpdated),
      issues: rows.flatMap((r) => (r.result === "conflict" || r.result === "failed" ? [{ code: r.result === "conflict" ? "bridge-conflict" : (r as { code: string }).code, message: `${r.scope}: ${r.result}`, scope: r.scope }] : [])),
      scopes: rows,
    },
  };
}

/**
 * Rename pre-0.4 MOZAK.json / MOZAK.md to mozak.json / mozak.md for one scope or every scope. Never changes plan content.
 */
function renameFilesOp(inv: ScopeInventory, a: Record<string, unknown>): OperationOutput {
  const o = closed(a, "rename-files arguments", [], ["scope", "all"]);
  const all = strictBoolean(o.all, "all");
  if ((o.scope === undefined) === !all) throw invalid("rename-files needs exactly one of scope or all");
  const targets = all ? inv.scopes : [resolveScope(inv, nonEmpty(o.scope, "scope"))];
  const rows = targets.map((entry) => {
    try {
      const { result, outcome } = renameScopeFiles(resolveScope(inv, entry.id));
      return { scope: entry.id, result, exitCode: resultExit(outcome), code: outcome.status, ...(outcome.issues.length ? { issues: outcome.issues } : {}) };
    } catch (err) {
      if (!(err instanceof DomainError)) throw err;
      return { scope: entry.id, result: "failed", exitCode: err.exitCode, code: err.code, message: err.message };
    }
  });
  const bad = rows.filter((r) => r.result === "failed").length;
  const exitCode = bad === 0 ? 0 : all ? 6 : rows[0].exitCode;
  return {
    exitCode,
    data: {
      status: bad === 0 ? "ok" : all ? "partial" : "failed",
      committed: false,
      operation: "rename-files",
      snapshot: null,
      projectionStatus: null,
      projectionUpdated: rows.some((r) => r.result === "renamed"),
      issues: rows.flatMap((r) => (r.result === "failed" ? [{ code: (r as { code: string }).code, message: `${r.scope}: ${(r as { message?: string }).message ?? "failed"}`, scope: r.scope }] : [])),
      scopes: rows,
    },
  };
}

/** Selected scopes for an all-or-one report route: read each one quietly, failures become coverage. Never fetches. */
function reportScopes(inv: ScopeInventory, operation: string, o: Record<string, unknown>) {
  const all = strictBoolean(o.all, "all");
  if ((o.scope === undefined) === !all) throw invalid(`${operation} needs exactly one of scope or all`);
  const entries = all ? inv.scopes : [resolveScope(inv, nonEmpty(o.scope, "scope"))];
  const read: { entry: ScopeEntry; state: ScopeState }[] = [];
  const coverage: ScopeBinding[] = [];
  const issues: { code: string; message: string; scope?: string }[] = [];
  for (const entry of entries) {
    try {
      const r = readScopeQuiet(resolveScope(inv, entry.id));
      read.push({ entry, state: r.state });
      coverage.push({ scope: entry.id, status: "ok", revision: r.snapshot.revision, graphHash: r.snapshot.graphHash });
    } catch (err) {
      if (!(err instanceof DomainError)) throw err;
      if (!all) throw err;
      coverage.push({ scope: entry.id, status: "failed", code: err.code, message: err.message });
      issues.push({ code: err.code, message: err.message, scope: entry.id });
    }
  }
  const complete = coverage.every((c) => c.status === "ok");
  return { read, issues, complete, coverage: { selected: entries.length, complete, scopes: coverage } };
}

/** similar: pooled report of similar plans (similar.ts). Read only, no stored state. */
function similarOp(inv: ScopeInventory, a: Record<string, unknown>): OperationOutput {
  const o = closed(a, "similar arguments", [], ["scope", "all"]);
  const r = reportScopes(inv, "similar", o);
  const report = similarReport(r.read.map((x) => ({ id: x.entry.id, state: x.state })));
  return {
    exitCode: r.complete ? 0 : 6,
    data: { status: r.complete ? "ok" : "partial-coverage", committed: false, operation: "similar", snapshot: null, projectionStatus: null, projectionUpdated: false, issues: r.issues, coverage: r.coverage, similar: report },
  };
}

/** locators: where each Source.locator and Evidence.locator points on this machine (locators.ts). Read only. */
function locatorsOp(inv: ScopeInventory, a: Record<string, unknown>): OperationOutput {
  const o = closed(a, "locators arguments", [], ["scope", "all", "plan", "includePrivate"]);
  const includePrivate = strictBoolean(o.includePrivate, "includePrivate");
  const plan = o.plan === undefined ? undefined : nonEmpty(o.plan, "plan");
  const r = reportScopes(inv, "locators", o);
  const resolver = new LocatorResolver(inv, { includePrivate });
  const rows: Record<string, unknown>[] = [];
  const counts: Record<string, number> = {};
  for (const { entry, state } of r.read) {
    for (const p of state.plans) {
      if (plan !== undefined && p.id !== plan) continue;
      for (const c of planCitations(p)) {
        const res = resolver.resolve(entry, c.locator, c.anchor);
        counts[res.status] = (counts[res.status] ?? 0) + 1;
        rows.push({ scope: entry.id, planId: c.planId, field: c.field, id: c.id, locator: c.locator, anchor: c.anchor, ...res });
      }
    }
  }
  if (plan !== undefined && !r.read.some(({ state }) => state.plans.some((p) => p.id === plan))) throw new DomainError("plan-not-found", `no plan "${plan}" in the selected scopes; run mozak plans (MCP mozak_plans) to list the plan ids`, 2);
  return {
    exitCode: r.complete ? 0 : 6,
    data: {
      status: r.complete ? "ok" : "partial-coverage", committed: false, operation: "locators", snapshot: null, projectionStatus: null, projectionUpdated: false,
      issues: r.issues, coverage: r.coverage, includePrivate,
      roots: resolver.roots.map((x) => ({ path: x.path, private: x.private, source: x.source })),
      counts, locators: rows,
    },
  };
}

/** plans-md: one generated plans.md per repository (plans-index.ts). print returns the text; writing is owner-only. */
function plansMdOp(inv: ScopeInventory, a: Record<string, unknown>, actor: Actor): OperationOutput {
  const o = closed(a, "plans-md arguments", [], ["print"]);
  const print = strictBoolean(o.print, "print");
  if (!print) requireOwner("plans-md", actor);
  const result = plansIndex(inv, { write: !print });
  const conflicts = result.files.filter((f) => f.result === "conflict");
  const failed = result.files.flatMap((f) => f.scopes.filter((s) => s.status === "failed").map((s) => ({ code: s.code ?? "scope-unavailable", message: `${s.id} could not be read; it is listed without plans`, scope: s.id })));
  return {
    exitCode: conflicts.length ? 3 : failed.length ? 6 : 0,
    data: {
      status: conflicts.length ? "conflict" : failed.length ? "partial-coverage" : "ok",
      committed: false, operation: "plans-md", snapshot: null, projectionStatus: null, projectionUpdated: false,
      issues: [...conflicts.map((f) => ({ code: "plans-md-conflict", message: `${f.path} exists and was not generated by mozak; it was left as it is` })), ...failed],
      files: result.files.map((f) => ({ repo: f.repo, path: f.path, result: f.result, plans: f.plans, scopes: f.scopes, ...(print ? { content: f.content } : {}) })),
      skipped: result.skipped,
    },
  };
}

/**
 * Single entry point for every operation. Expected domain failures come back as a structured
 * envelope with an exit code. Only unexpected, non-domain errors are rethrown. The caller's
 * transport supplies the actor. This function never reads it from the arguments.
 * Each call appends one counts-only line to the usage log next to a file-loaded inventory, only when the owner opted in
 * (MOZAK_USAGE_LOG=on, or `usageLog: true` in mozak-settings.json).
 */
export function executeOperation(inv: ScopeInventory, operation: string, args: unknown, actor: Actor = "agent"): OperationOutput {
  const started = performance.now();
  const output = runOperation(inv, operation, args, actor);
  if (inv.path && usageLogEnabled(process.env, usageLogSetting(inv))) {
    try { appendUsage(dirname(inv.path), usageLine(operation, args, String(actor), output.data, output.exitCode, performance.now() - started)); } catch { /* never affects the result */ }
  }
  return output;
}

function runOperation(inv: ScopeInventory, operation: string, args: unknown, actor: Actor): OperationOutput {
  try {
    if (actor !== "agent" && actor !== "owner") throw invalid("actor must be agent or owner");
    if (LEGACY_OPERATIONS.has(operation)) {
      throw new DomainError("unsupported-legacy-operation", `${operation} is retired; create a v3 scope with scope init and propose plans`, 2);
    }
    if (!(OPERATIONS as readonly string[]).includes(operation)) {
      throw new DomainError("unsupported-operation", `unknown operation "${operation}"`, 2);
    }
    if (operation === "sync") {
      if (!isPlain(args)) throw invalid("arguments must be an object");
      return syncOp(inv, args);
    }
    if (operation === "render") {
      if (!isPlain(args)) throw invalid("arguments must be an object");
      return renderOp(inv, args);
    }
    if (operation === "rename-files") {
      requireOwner(operation, actor);
      if (!isPlain(args)) throw invalid("arguments must be an object");
      return renameFilesOp(inv, args);
    }
    if (operation === "recover") {
      requireOwner(operation, actor);
      if (!isPlain(args)) throw invalid("arguments must be an object");
      return recoverOp(inv, args);
    }
    if (operation === "annotate") {
      // Annotations never commit or push.
      requireOwner(operation, actor);
      if (!isPlain(args)) throw invalid("arguments must be an object");
      return annotateOp(inv, args, actor);
    }
    // S6 reports: read the local copies only (never fetch). plans-md writes only plans.md files, owner only.
    if (operation === "similar" || operation === "locators" || operation === "plans-md") {
      if (!isPlain(args)) throw invalid("arguments must be an object");
      return operation === "similar" ? similarOp(inv, args) : operation === "locators" ? locatorsOp(inv, args) : plansMdOp(inv, args, actor);
    }
    if (READ_OPS.has(operation)) {
      if (!isPlain(args)) throw invalid("arguments must be an object");
      const out = readOp(inv, operation, args);
      if (operation !== "scopes") return out;
      // Reads never wait on the network for this: only an already cached newer release is reported.
      const update = scopesUpdateIssue();
      if (!update || !Array.isArray(out.data.issues)) return out;
      return { ...out, data: { ...out.data, issues: [...(out.data.issues as unknown[]), update] } };
    }
    return writeOp(inv, operation, isPlain(args) ? args : {}, actor);
  } catch (err) {
    if (err instanceof DomainError) return errorOutput(err, operation, args);
    throw err;
  }
}

export { DEFAULT_LIMIT, MAX_LIMIT, OWNER_ONLY, ROUTE_ACTIONS };
