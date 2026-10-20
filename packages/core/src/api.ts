// Shared operation facade for the CLI and the agent-safe MCP subset.
// Closed argument schemas, actor gating and exit-code mapping live here. Storage rules stay in
// scope-store.ts and review rules in review.ts. The actor comes only from the caller, never from data.

import { DomainError } from "./errors.ts";
import { existsSync } from "node:fs";
import { resolveScope, type ScopeEntry, type ScopeInventory } from "./scope-index.ts";
import {
  initScopeState,
  mutateScope,
  readScope,
  readScopeView,
  repairProjection,
  renderProjection,
  renameScopeFiles,
  retitleScope,
  type OperationResult,
  type ScopeRead,
} from "./scope-store.ts";
import { contextView, reviewRows, reviewShow } from "./review.ts";
import { selectContext } from "./context-selection.ts";
import { scopeIndex } from "./scope-list.ts";
import { cacheIgnoreWarning, commitAndPush, pullRemote, remoteEntries, repoEntries, statusOf, syncRemote } from "./remote.ts";
import type { RemoteStatus } from "./remote-meta.ts";
import { cachedVisibility, publicRepoPlansMessage, scopeVisibility } from "./visibility.ts";
import { leftoverTempFiles } from "./durable.ts";
import { cachedUpdateNotice, installedVersion, refreshUpdateCacheIfStale } from "./update.ts";
import { canonical, digest } from "./understanding.ts";
import { annotateScope } from "./scope-store.ts";
import { readAnnotations, type AnnotationsDoc } from "./annotations.ts";
import { annotationFindings, graphView, readyView, type Universe } from "./crossplan.ts";
import { effectiveDeadline, planDeadline, today } from "./deadlines.ts";
import { annotationsMode, ignoredScopeSettingsFile, loadSettings, rebaseEnabled, SETTINGS_FILE } from "./settings.ts";
import type { ScopeState } from "./understanding.ts";

/**
 * The scopes index's update notice: reads the cache only, and starts a background refresh when it is old.
 * Only an installed mozak (one with installation.json) checks; a source checkout or test run never does.
 */
function scopesUpdateIssue(): Record<string, unknown> | null {
  const installed = installedVersion();
  if (!installed) return null;
  refreshUpdateCacheIfStale();
  const n = cachedUpdateNotice(installed.version);
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
  "pull",
  "render",
  "rename-files",
  "retitle",
  "annotate",
  "graph",
  "ready",
] as const;

/** Owner-only: refused for every other actor before any file is touched. */
const OWNER_ONLY = new Set(["decide", "init", "repair", "pull", "rename-files", "retitle", "annotate"]);
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

function nonEmpty(value: unknown, name: string): string {
  if (typeof value !== "string" || value.trim() === "") throw invalid(`${name} must be a nonempty string`);
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
  // A failed observation returns its unsaved request, never an implied persisted record.
  const unsaved = operation === "observe" && isPlain(args) && isPlain(args.request) ? { unsavedRequest: args.request } : {};
  return {
    exitCode: err.exitCode,
    data: {
      status: err.code,
      committed: false,
      ...(operation ? { operation } : {}),
      ...(operationId ? { operationId } : {}),
      ...unsaved,
      snapshot: null,
      projectionStatus: null,
      projectionUpdated: false,
      issues: [{ code: err.code, message: err.message }],
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
    selector: { scope: selector.scope as string | null, all: selector.all },
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

/** Sidecar token of one scope, for continuation bindings. */
function annotationsToken(inv: ScopeInventory, id: string): unknown {
  const entry = entryOf(inv, id);
  if (!entry) return null;
  try { return readAnnotations(entry.root).token; } catch { return "unreadable"; }
}

/**
 * Read-only, cached view of every inventoried scope for cross-plan resolution. Never fetches: a remote scope is read
 * from its local copy as it is. A scope that cannot be read is "unavailable", an id not in the inventory "unknown".
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
        if (entry) { try { doc = readAnnotations(entry.root, id).doc; } catch { doc = null; } }
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
      const side = readAnnotations(entry.root, id);
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

/** Annotation and settings findings for check. Empty when the scope has no sidecar and settings are clean. */
function annotationCheck(inv: ScopeInventory, entry: ScopeEntry, read: ScopeRead): { code: string; message: string }[] {
  const out: { code: string; message: string }[] = [];
  const side = readAnnotations(entry.root, entry.id);
  out.push(...side.issues);
  if (ignoredScopeSettingsFile(inv, entry)) {
    out.push({ code: "settings-scope-file-deprecated", message: `${SETTINGS_FILE} in the scope folder is ignored. Put concurrency.rebase under scopes.${entry.id}.concurrency in the ${SETTINGS_FILE} next to the inventory file` });
  }
  try {
    const settings = loadSettings(inv);
    out.push(...settings.issues);
    if (side.token.exists && annotationsMode(settings, entry).source === "repo-mode") {
      out.push({ code: "annotations-on-remote", message: "mozak.annotations.json exists in a repo-mode remote scope; annotate refuses these scopes, and the file is ignored by owner routes" });
    }
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
  if (mode.source === "repo-mode") throw new DomainError("annotations-refused-remote", "annotations are refused on repo-mode remote scopes: their plans are committed and pushed to a repository", 2);
  if (!mode.enabled) throw new DomainError("annotations-disabled", `annotations are off for scope "${entry.id}" in mozak-settings.json`, 2);
  const result = annotateScope(entry, o.request, universeOf(inv).state);
  const lockOrCleanup = result.status.startsWith("committed-") || result.status === "projection-updated-lock-held";
  const exitCode = lockOrCleanup ? 5 : result.status === "ok" || result.status === "replayed" ? 0 : 3;
  return { exitCode, data: { ...result, operation: "annotate" } };
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
      throw new DomainError("continuation-stale", "inventory changed since this continuation was issued", 3);
    }
    if (continuation.binding !== bindingDigest) {
      throw new DomainError("continuation-stale", "scope snapshots changed since this continuation was issued", 3);
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

  const o = closed(a, `${operation} arguments`, operation === "operation" ? ["scope", "id"] : ["scope"], operation === "context" ? ["brief", "plan"] : []);
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
  const findings = [...read.issues, ...annotationCheck(inv, entry, read)];
  // Leftover temp files from an interrupted write are informational: the next write removes them.
  const leftovers = leftoverTempFiles(entry.root).map((name) => ({ code: "leftover-temp-file", message: `${name} is left over from an interrupted write; the next write removes it` }));
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
  else result = mutateScope(entry, request, actor, { rebase: rebaseEnabled(inv, entry.id) });
  return { exitCode: resultExit(result), data: { ...result, operation } };
}

const REMOTE_READ_OPS = new Set(["context", "plans", "scopes", "review", "check", "operation", "graph", "ready"]);

function plainScope(args: unknown): string | undefined {
  return isPlain(args) && typeof args.scope === "string" && args.scope.trim() !== "" ? args.scope : undefined;
}

/** Remote scopes an operation touches: one selected scope, or every remote scope for index and all-scope reads. */
function touchedRemotes(inv: ScopeInventory, operation: string, args: unknown): ScopeEntry[] {
  const all = remoteEntries(inv);
  if (all.length === 0) return [];
  const scope = plainScope(args);
  if (operation === "scopes") return all;
  if (operation === "plans") {
    if (scope !== undefined) return all.filter((e) => e.id === scope);
    return all;
  }
  if (operation === "graph" || operation === "ready") return scope === undefined ? all : all.filter((e) => e.id === scope);
  return scope === undefined ? [] : all.filter((e) => e.id === scope);
}

function remoteOp(inv: ScopeInventory, operation: string, a: Record<string, unknown>): OperationOutput {
  const base = { committed: false, operation, snapshot: null, projectionStatus: null, projectionUpdated: false } as const;
  if (operation === "sync") {
    const o = closed(a, "sync arguments", [], ["scope"]);
    const targets = o.scope === undefined ? remoteEntries(inv) : [resolveRemoteTarget(inv, nonEmpty(o.scope, "scope"))];
    const remote = targets.map((e) => syncRemote(e, { force: true }));
    const stale = remote.filter((r) => r.stale).length;
    const bases = [...new Set(targets.map((e) => e.remote?.baseDir).filter((b): b is string => b !== undefined))];
    const warnings = bases.flatMap((b) => { const w = cacheIgnoreWarning(b); return w ? [{ code: "cache-not-ignored", message: w }] : []; });
    // Uses the 24-hour cached answer: the plugin syncs every minute and the unauthenticated API allows 60 calls an hour.
    // Every remote scope gets an answer for the sidebar label; only repo-mode scopes publish plans, so only they warn.
    const exposed = targets.filter((e) => scopeVisibility(e) === "public" && e.remote?.plansMode === "repo").map((e) => ({ code: "public-repo-plans", message: publicRepoPlansMessage(e), scope: e.id }));
    return {
      exitCode: stale > 0 ? 6 : 0,
      data: { status: stale > 0 ? "partial" : "ok", ...base, issues: [...remote.filter((r) => r.stale).map((r) => ({ code: "remote-stale", message: `${r.scope}: ${r.error ?? "stale"}`, scope: r.scope })), ...warnings, ...exposed], remote },
    };
  }
  const o = closed(a, "pull arguments", ["scope"], ["into"]);
  const entry = resolveRemoteTarget(inv, nonEmpty(o.scope, "scope"));
  if (entry.remote?.plansMode !== "vault") {
    const synced = syncRemote(entry, { force: true });
    if (synced.stale && !existsSync(entry.root)) throw new DomainError("remote-unavailable", `cannot fetch ${synced.remote}: ${synced.error ?? "unknown error"}`, 2);
  }
  const pulled = pullRemote(entry, o.into === undefined ? undefined : nonEmpty(o.into, "into"));
  return { exitCode: 0, data: { status: "ok", ...base, issues: [], pull: pulled } };
}

function resolveRemoteTarget(inv: ScopeInventory, id: string): ScopeEntry {
  const entry = inv.scopes.find((s) => s.id === id);
  if (!entry) throw new DomainError("scope-not-found", `no scope "${id}" in the inventory`);
  if (!entry.remote) throw new DomainError("scope-not-remote", `scope "${id}" is a local scope, there is nothing to sync`);
  return entry;
}

function attachRemote(output: OperationOutput, statuses: RemoteStatus[]): OperationOutput {
  if (statuses.length === 0) return output;
  const data: Record<string, unknown> = { ...output.data, remote: statuses };
  const rows = data.scopes;
  if (Array.isArray(rows)) {
    data.scopes = rows.map((row: Record<string, unknown>) => {
      const st = statuses.find((x) => x.scope === row.id);
      return st ? { ...row, remote: st.remote, ref: st.ref, stale: st.stale, lastFetchAt: st.lastFetchAt, source: st.source, ...(st.error ? { staleReason: st.error } : {}) } : row;
    });
  }
  const stale = statuses.filter((s) => s.stale);
  if (stale.length > 0 && Array.isArray(data.issues)) {
    data.issues = [...data.issues, ...stale.map((s) => ({ code: "remote-stale", message: `${s.scope}: using cached copy, fetch failed (${s.error ?? "unknown"})`, scope: s.scope }))];
  }
  return { ...output, data };
}

/**
 * Regenerate stale mozak.md projections for one local scope or every local scope. Writes only mozak.md.
 * Remote scopes are skipped: their projection follows their next sync or write. Conflicts are reported, not overwritten.
 */
function renderOp(inv: ScopeInventory, a: Record<string, unknown>): OperationOutput {
  const o = closed(a, "render arguments", [], ["scope", "all"]);
  const all = strictBoolean(o.all, "all");
  if ((o.scope === undefined) === !all) throw invalid("render needs exactly one of scope or all");
  const targets = all ? inv.scopes : [resolveScope(inv, nonEmpty(o.scope, "scope"))];
  const rows = targets.map((entry) => {
    if (entry.remote && entry.remote.plansMode === "repo") return { scope: entry.id, result: "remote-skipped", exitCode: 0 };
    try {
      const { result, outcome } = renderProjection(entry);
      return { scope: entry.id, result, exitCode: resultExit(outcome), code: outcome.status, projectionUpdated: outcome.projectionUpdated, projectionStatus: outcome.projectionStatus, ...(outcome.issues.length ? { issues: outcome.issues } : {}) };
    } catch (err) {
      if (!(err instanceof DomainError)) throw err;
      return { scope: entry.id, result: "failed", exitCode: err.exitCode, code: err.code, message: err.message };
    }
  });
  const bad = rows.filter((r) => r.result === "conflict" || r.result === "failed").length;
  const exitCode = bad === 0 ? 0 : all ? 6 : rows[0]!.exitCode;
  return {
    exitCode,
    data: {
      status: bad === 0 ? "ok" : all ? "partial" : rows[0]!.result,
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
 * Rename pre-0.4 MOZAK.json / MOZAK.md to mozak.json / mozak.md for one local scope or every local scope.
 * Repo-mode remote scopes are skipped: rename those in their own clone and push. Never changes plan content.
 */
function renameFilesOp(inv: ScopeInventory, a: Record<string, unknown>): OperationOutput {
  const o = closed(a, "rename-files arguments", [], ["scope", "all"]);
  const all = strictBoolean(o.all, "all");
  if ((o.scope === undefined) === !all) throw invalid("rename-files needs exactly one of scope or all");
  const targets = all ? inv.scopes : [resolveScope(inv, nonEmpty(o.scope, "scope"))];
  const rows = targets.map((entry) => {
    if (entry.remote && entry.remote.plansMode === "repo") return { scope: entry.id, result: "remote-skipped", exitCode: 0 };
    try {
      const { result, outcome } = renameScopeFiles(entry);
      return { scope: entry.id, result, exitCode: resultExit(outcome), code: outcome.status, ...(outcome.issues.length ? { issues: outcome.issues } : {}) };
    } catch (err) {
      if (!(err instanceof DomainError)) throw err;
      return { scope: entry.id, result: "failed", exitCode: err.exitCode, code: err.code, message: err.message };
    }
  });
  const bad = rows.filter((r) => r.result === "failed").length;
  const exitCode = bad === 0 ? 0 : all ? 6 : rows[0]!.exitCode;
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

/**
 * Single entry point for every operation. Expected domain failures come back as a structured
 * envelope with an exit code. Only unexpected, non-domain errors are rethrown. The caller's
 * transport supplies the actor. This function never reads it from the arguments.
 */
export function executeOperation(inv: ScopeInventory, operation: string, args: unknown, actor: Actor = "agent"): OperationOutput {
  try {
    if (actor !== "agent" && actor !== "owner") throw invalid("actor must be agent or owner");
    if (LEGACY_OPERATIONS.has(operation)) {
      throw new DomainError("unsupported-legacy-operation", `${operation} is retired; create a v3 scope with scope init and propose plans`, 2);
    }
    if (!(OPERATIONS as readonly string[]).includes(operation)) {
      throw new DomainError("unsupported-operation", `unknown operation "${operation}"`, 2);
    }
    if (operation === "sync" || operation === "pull") {
      if (OWNER_ONLY.has(operation)) requireOwner(operation, actor);
      if (!isPlain(args)) throw invalid("arguments must be an object");
      return remoteOp(inv, operation, args);
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
    if (operation === "annotate") {
      // Never routed through remoteWrite: annotations never commit or push. Repo-mode scopes are refused inside.
      requireOwner(operation, actor);
      if (!isPlain(args)) throw invalid("arguments must be an object");
      return annotateOp(inv, args, actor);
    }
    if (REMOTE_READ_OPS.has(operation)) {
      if (!isPlain(args)) throw invalid("arguments must be an object");
      const touched = touchedRemotes(inv, operation, args);
      const statuses = touched.map((e) => syncRemote(e));
      const out = attachRemote(readOp(inv, operation, args), statuses);
      if (operation !== "scopes") return out;
      // Reads never wait on the network for this: only an already cached "public" answer warns.
      const exposed = repoEntries(inv).filter((e) => cachedVisibility(e) === "public");
      const update = scopesUpdateIssue();
      if ((exposed.length === 0 && !update) || !Array.isArray(out.data.issues)) return out;
      return { ...out, data: { ...out.data, issues: [...out.data.issues, ...exposed.map((e) => ({ code: "public-repo-plans", message: publicRepoPlansMessage(e), scope: e.id })), ...(update ? [update] : [])] } };
    }
    const input = isPlain(args) ? args : {};
    // Only repo-mode remote scopes commit and push. Vault-plans scopes write like local scopes.
    const target = touchedRemotes(inv, operation, input).find((e) => e.remote?.plansMode === "repo");
    if (target === undefined) return attachRemote(writeOp(inv, operation, input, actor), touchedRemotes(inv, operation, input).map((e) => statusOf(e, false)));
    return remoteWrite(inv, operation, input, actor, target);
  } catch (err) {
    if (err instanceof DomainError) return errorOutput(err, operation, args);
    throw err;
  }
}

/** Write against a remote scope: refresh first, refuse on a stale base, then commit mozak.json and mozak.md and push. */
function remoteWrite(inv: ScopeInventory, operation: string, input: Record<string, unknown>, actor: Actor, entry: ScopeEntry): OperationOutput {
  if (OWNER_ONLY.has(operation)) requireOwner(operation, actor);
  if (scopeVisibility(entry) === "public") throw new DomainError("public-repo-plans", `refusing to write: ${publicRepoPlansMessage(entry)}`, 3);
  const status = syncRemote(entry, { force: true });
  if (status.stale) {
    throw new DomainError("remote-stale", `refusing to write: cannot refresh ${status.remote} (${status.error ?? "unknown"}). Run \`mozak sync\` when online.`, 3);
  }
  const output = writeOp(inv, operation, input, actor);
  const data = output.data as { committed?: boolean; projectionUpdated?: boolean; issues?: { code: string; message: string }[] };
  if (!data.committed && !data.projectionUpdated) return attachRemote(output, [status]);
  try {
    const done = commitAndPush(entry, `mozak: ${operation} ${plainScope(input) ?? entry.id}`);
    const after = syncRemote(entry, { force: false });
    return attachRemote({ exitCode: output.exitCode, data: { ...output.data, remotePush: done } }, [after]);
  } catch (err) {
    if (!(err instanceof Error) || err instanceof DomainError) throw err;
    const issue = { code: "remote-push-failed", message: `committed locally but not pushed: ${err.message}. It is pushed on the next \`mozak sync\`.` };
    return attachRemote({ exitCode: 5, data: { ...output.data, issues: [...(data.issues ?? []), issue] } }, [{ ...statusOf(entry, true, err.message) }]);
  }
}

export { DEFAULT_LIMIT, MAX_LIMIT, OWNER_ONLY, ROUTE_ACTIONS };
